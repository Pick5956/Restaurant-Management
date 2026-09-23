package service

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Streaming the answer.
//
// The provider sends the reply as server-sent events and each piece is handed
// to onDelta as it lands; the whole reply is still returned at the end, so a
// streamed call is a drop-in for a plain one. Key rotation and the provider
// fallback are the same as the plain path — an adapter that cannot stream is
// simply called the plain way and onDelta never fires.

// aiProviderStreamer is an adapter that can stream a completion.
type aiProviderStreamer interface {
	CompleteStream(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (aiProviderAnswer, error)
}

// askSecondRoundStream is askSecondRoundWithOptions with the reply streamed to
// onDelta where the provider can.
func (s *AIService) askSecondRoundStream(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (string, string, error) {
	return s.askAcrossProviders(func(adapter aiProviderAdapter) (aiProviderAnswer, error) {
		if streamer, ok := adapter.(aiProviderStreamer); ok {
			return streamer.CompleteStream(prompt, opts, onDelta)
		}
		return adapter.Complete(prompt, opts)
	})
}

func (a *geminiProviderAdapter) CompleteStream(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (aiProviderAnswer, error) {
	text, model, err := a.service.askSecondRoundGeminiStreamWithRotation(prompt, opts.Model, onDelta)
	return aiProviderAnswer{Text: text, Model: model}, err
}

func (a *groqProviderAdapter) CompleteStream(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (aiProviderAnswer, error) {
	text, model, err := a.service.askSecondRoundGroqStreamWithRotation(prompt, opts, onDelta)
	return aiProviderAnswer{Text: text, Model: model}, err
}

// ---- Gemini ----

func (s *AIService) askSecondRoundGeminiStreamWithRotation(prompt string, override string, onDelta func(string)) (string, string, error) {
	keys := s.getGeminiKeys()
	if len(keys) == 0 {
		return "", "", errors.New("GEMINI_API_KEY is not configured")
	}
	attempts, releaseAt := nextProviderAttempts(&s.keyHealth, "gemini", keys, &s.geminiKeyIndex)
	if len(attempts) == 0 {
		return "", "", allKeysRateLimitedError("Gemini second-round", len(keys), releaseAt)
	}
	var lastErr error
	for _, attempt := range attempts {
		answer, model, err := s.executeSecondRoundGeminiStream(prompt, attempt.Key, override, onDelta)
		if err == nil {
			s.keyHealth.clear("gemini", attempt.Index)
			return answer, model, nil
		}
		lastErr = err
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Gemini second-round (stream): %v — skipping remaining keys", err)
			return "", "", err
		}
		if errors.Is(err, errRateLimit) || errors.Is(err, errKeyRejected) {
			wait := retryAfterOf(err)
			s.keyHealth.park("gemini", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Gemini second-round (stream) key %s parked for %s: %v", attempt.Label(), wait.Round(time.Second), err)
			continue
		}
		aiStage("warn", "Gemini second-round (stream) key %s failed: %v → rotating", attempt.Label(), err)
	}
	return "", "", lastErr
}

func (s *AIService) executeSecondRoundGeminiStream(prompt string, apiKey string, override string, onDelta func(string)) (string, string, error) {
	model := strings.TrimSpace(override)
	if model == "" {
		model = strings.TrimSpace(os.Getenv("GEMINI_MODEL"))
	}
	if model == "" {
		model = "gemini-3.5-flash-lite"
	}
	aiStage("call", "Gemini second-round (stream) model=%s", model)
	started := time.Now()
	body, err := json.Marshal(geminiGenerateRequest{Contents: []geminiContent{{Parts: []geminiPart{{Text: prompt}}}}})
	if err != nil {
		return "", "", err
	}
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:streamGenerateContent?alt=sse", model)
	httpReq, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", apiKey)
	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if statusErr := classifyProviderResponse("Gemini", "second-round stream request", model, resp); statusErr != nil {
		return "", "", statusErr
	}
	text, usage, firstAt, err := readGeminiSSE(resp.Body, onDelta)
	if err != nil {
		return "", "", err
	}
	first := int64(0)
	if !firstAt.IsZero() {
		first = firstAt.Sub(started).Milliseconds()
	}
	aiStage("usage", "Gemini second-round (stream) took=%dms first_text=%dms prompt_tokens=%d cached_tokens=%d thoughts_tokens=%d output_tokens=%d",
		time.Since(started).Milliseconds(), first, usage.PromptTokenCount, usage.CachedContentTokenCount,
		usage.ThoughtsTokenCount, usage.CandidatesTokenCount)
	if strings.TrimSpace(text) == "" {
		return "", "", errors.New("gemini second round (stream) returned empty response")
	}
	return text, model, nil
}

// geminiUsage is the usage block a streamed reply reports on its last event.
type geminiUsage = struct {
	PromptTokenCount        int `json:"promptTokenCount"`
	CachedContentTokenCount int `json:"cachedContentTokenCount"`
	CandidatesTokenCount    int `json:"candidatesTokenCount"`
	ThoughtsTokenCount      int `json:"thoughtsTokenCount"`
	TotalTokenCount         int `json:"totalTokenCount"`
}

// readGeminiSSE folds a streamGenerateContent?alt=sse body into the full text,
// handing each piece to onDelta as it arrives. firstAt is when the first
// piece of text landed — the moment the owner starts reading.
func readGeminiSSE(body io.Reader, onDelta func(string)) (text string, usage geminiUsage, firstAt time.Time, err error) {
	var out strings.Builder
	err = forEachSSEData(body, func(data string) bool {
		var chunk geminiGenerateResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return true // a keep-alive or a shape we do not read; the text so far stands
		}
		if chunk.UsageMetadata.TotalTokenCount > 0 {
			usage = chunk.UsageMetadata
		}
		for _, candidate := range chunk.Candidates {
			for _, part := range candidate.Content.Parts {
				if part.Text == "" {
					continue
				}
				if firstAt.IsZero() {
					firstAt = time.Now()
				}
				out.WriteString(part.Text)
				if onDelta != nil {
					onDelta(part.Text)
				}
			}
		}
		return true
	})
	return out.String(), usage, firstAt, err
}

// ---- Groq ----

func (s *AIService) askSecondRoundGroqStreamWithRotation(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (string, string, error) {
	keys := s.getGroqKeys()
	if len(keys) == 0 {
		return "", "", errors.New("GROQ_API_KEY is not configured")
	}
	attempts, releaseAt := nextProviderAttempts(&s.keyHealth, "groq", keys, &s.groqKeyIndex)
	if len(attempts) == 0 {
		return "", "", allKeysRateLimitedError("Groq second-round", len(keys), releaseAt)
	}
	var lastErr error
	for _, attempt := range attempts {
		answer, model, err := s.executeSecondRoundGroqStream(prompt, attempt.Key, opts, onDelta)
		if err == nil {
			s.keyHealth.clear("groq", attempt.Index)
			return answer, model, nil
		}
		lastErr = err
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Groq second-round (stream): %v — skipping remaining keys", err)
			return "", "", err
		}
		if errors.Is(err, errRateLimit) || errors.Is(err, errKeyRejected) {
			wait := retryAfterOf(err)
			s.keyHealth.park("groq", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Groq second-round (stream) key %s parked for %s: %v", attempt.Label(), wait.Round(time.Second), err)
			continue
		}
		aiStage("warn", "Groq second-round (stream) key %s failed: %v → rotating", attempt.Label(), err)
	}
	return "", "", lastErr
}

func (s *AIService) executeSecondRoundGroqStream(prompt string, apiKey string, opts aiProviderCompleteOptions, onDelta func(string)) (string, string, error) {
	model := strings.TrimSpace(os.Getenv("GROQ_MODEL"))
	if model == "" {
		model = "openai/gpt-oss-20b"
	}
	aiStage("call", "Groq second-round (stream) model=%s", model)
	started := time.Now()
	payload := groqRequest{
		Model:               model,
		Messages:            []groqMessage{{Role: "user", Content: prompt}},
		ReasoningEffort:     groqReasoningEffortFor(model, opts.ReasoningEffort),
		MaxCompletionTokens: positiveOrNil(opts.MaxCompletionTokens),
		Stream:              true,
		StreamOptions:       &groqStreamOptions{IncludeUsage: true},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	httpReq, err := http.NewRequest(http.MethodPost, "https://api.groq.com/openai/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if statusErr := classifyProviderResponse("Groq", "second-round stream request", model, resp); statusErr != nil {
		return "", "", statusErr
	}
	text, finish, usage, firstAt, err := readGroqSSE(resp.Body, onDelta)
	if err != nil {
		return "", "", err
	}
	first := int64(0)
	if !firstAt.IsZero() {
		first = firstAt.Sub(started).Milliseconds()
	}
	if finish == "length" {
		aiStage("warn", "Groq second-round (stream) hit the output ceiling → the answer is cut off (completion_tokens=%d reasoning_tokens=%d)",
			usage.CompletionTokens, usage.CompletionTokensDetails.ReasoningTokens)
	} else {
		aiStage("usage", "Groq second-round (stream) took=%dms first_text=%dms finish=%s completion_tokens=%d reasoning_tokens=%d prompt_tokens=%d cached_tokens=%d",
			time.Since(started).Milliseconds(), first, finish, usage.CompletionTokens,
			usage.CompletionTokensDetails.ReasoningTokens, usage.PromptTokens, usage.PromptTokensDetails.CachedTokens)
	}
	if strings.TrimSpace(text) == "" {
		return "", "", errors.New("groq second round (stream) returned empty response")
	}
	return text, model, nil
}

// readGroqSSE folds a streamed chat completion into the full text, handing
// each piece to onDelta as it arrives.
func readGroqSSE(body io.Reader, onDelta func(string)) (text, finish string, usage groqUsage, firstAt time.Time, err error) {
	var out strings.Builder
	err = forEachSSEData(body, func(data string) bool {
		if data == "[DONE]" {
			return false
		}
		var chunk groqStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return true
		}
		if chunk.Usage != nil {
			usage = *chunk.Usage
		}
		for _, choice := range chunk.Choices {
			if choice.FinishReason != "" {
				finish = choice.FinishReason
			}
			if choice.Delta.Content == "" {
				continue
			}
			if firstAt.IsZero() {
				firstAt = time.Now()
			}
			out.WriteString(choice.Delta.Content)
			if onDelta != nil {
				onDelta(choice.Delta.Content)
			}
		}
		return true
	})
	return out.String(), finish, usage, firstAt, err
}

// forEachSSEData hands the payload of every "data:" line of a server-sent
// event stream to fn, in order, the moment each line arrives — which is the
// whole point: collecting the lines first and walking them after would show
// the owner nothing until the model had finished. fn returns false to stop.
// Anything else on the wire — event names, comments, blank separators — is
// skipped.
func forEachSSEData(body io.Reader, fn func(data string) bool) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		if !fn(strings.TrimSpace(strings.TrimPrefix(line, "data:"))) {
			return nil
		}
	}
	return scanner.Err()
}
