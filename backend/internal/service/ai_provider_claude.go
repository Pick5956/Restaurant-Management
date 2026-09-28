package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Claude (Anthropic) as a provider - 28 ก.ย. 2569.
//
// Gemini 3.5 was down for hours that evening (503 on every key), and Groq could
// not stand in: the tool-choice prompt is about 11,000 tokens and Groq's free
// tier refuses any request over 8,000 (413 on every key and every model). This
// is a third provider that can take the whole question, ready to be named in
// AI_PROVIDER ("gemini,claude" = Gemini first, Claude when Gemini is down).
//
// It carries joyboy only - Complete and CompleteStream, which are the only
// calls joyboy makes. The legacy router's Classify/Answer have their own
// provider-specific prompts and are refused here rather than half-ported.
//
// Every call streams, including Complete. The client gives a provider twelve
// seconds to send headers (aiProviderHeaderWait), and a Messages call that does
// not stream sends none until the whole reply is written; a long answer would
// read as a stall. Streamed, the headers come back at once.

// claudeMessagesURL is a variable so a test can point it at a local server.
var claudeMessagesURL = "https://api.anthropic.com/v1/messages"

const (
	claudeAPIVersion = "2023-06-01"
	// claudeDefaultModel applies when CLAUDE_MODEL is unset.
	claudeDefaultModel = "claude-sonnet-5"
	// claudeDefaultMaxTokens is the reply ceiling when the caller sets none.
	// The Messages API requires one; joyboy's answers run to a few hundred.
	claudeDefaultMaxTokens = 4096
	// claudeOverloadedStatus is Anthropic's "overloaded" status, which the
	// rotation treats like a 503.
	claudeOverloadedStatus = 529
)

// getClaudeKeys reads CLAUDE_API_KEYS (comma or one per line, like the other
// providers), falling back to the single ANTHROPIC_API_KEY the SDKs use.
func (s *AIService) getClaudeKeys() []string {
	raw := os.Getenv("CLAUDE_API_KEYS")
	if strings.TrimSpace(raw) == "" {
		raw = os.Getenv("ANTHROPIC_API_KEY")
	}
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r < ' '
	})
	keys := make([]string, 0, len(parts))
	for _, part := range parts {
		if key := strings.TrimSpace(part); key != "" {
			keys = append(keys, key)
		}
	}
	if len(keys) == 0 {
		return nil
	}
	return keys
}

func claudeModel() string {
	if model := strings.TrimSpace(os.Getenv("CLAUDE_MODEL")); model != "" {
		return model
	}
	return claudeDefaultModel
}

type claudeProviderAdapter struct {
	service *AIService
}

func (a *claudeProviderAdapter) ID() string          { return "claude" }
func (a *claudeProviderAdapter) DisplayName() string { return "Claude" }
func (a *claudeProviderAdapter) Configured() bool    { return len(a.service.getClaudeKeys()) > 0 }

var errClaudeJoyboyOnly = errors.New("Claude is wired for the joyboy path only (AI_ORCHESTRATOR_MODE=joyboy)")

func (a *claudeProviderAdapter) Classify(string, []AIConversationMessage) (AIRouterResult, error) {
	return AIRouterResult{}, errClaudeJoyboyOnly
}

func (a *claudeProviderAdapter) Answer(aiProviderAnswerRequest) (aiProviderAnswer, error) {
	return aiProviderAnswer{}, errClaudeJoyboyOnly
}

func (a *claudeProviderAdapter) Complete(prompt string, opts aiProviderCompleteOptions) (aiProviderAnswer, error) {
	text, model, err := a.service.askClaudeWithRotation(prompt, opts, nil)
	return aiProviderAnswer{Text: text, Model: model}, err
}

func (a *claudeProviderAdapter) CompleteStream(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (aiProviderAnswer, error) {
	text, model, err := a.service.askClaudeWithRotation(prompt, opts, onDelta)
	return aiProviderAnswer{Text: text, Model: model}, err
}

func (s *AIService) askClaudeWithRotation(prompt string, opts aiProviderCompleteOptions, onDelta func(string)) (string, string, error) {
	keys := s.getClaudeKeys()
	if len(keys) == 0 {
		return "", "", errors.New("CLAUDE_API_KEYS is not configured")
	}
	// AI_SUPPORT_MODEL names a Gemini model; sent here it would be a 404.
	if strings.TrimSpace(opts.Model) != "" {
		aiStage("warn", "AI_SUPPORT_MODEL=%q is ignored on Claude — only Gemini reads it", opts.Model)
	}
	attempts, releaseAt := nextProviderAttempts(&s.keyHealth, "claude", keys, &s.claudeKeyIndex)
	if len(attempts) == 0 {
		return "", "", allKeysRateLimitedError("Claude second-round", len(keys), releaseAt)
	}
	var lastErr error
	stalls := 0
	for _, attempt := range attempts {
		answer, model, err := s.executeClaude(prompt, attempt.Key, opts, onDelta)
		if err == nil {
			s.keyHealth.clear("claude", attempt.Index)
			return answer, model, nil
		}
		lastErr = err
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Claude second-round: %v — skipping remaining keys", err)
			return "", "", err
		}
		if errors.Is(err, errRateLimit) || errors.Is(err, errKeyRejected) {
			wait := retryAfterOf(err)
			s.keyHealth.park("claude", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Claude second-round key %s parked for %s: %v", attempt.Label(), wait.Round(time.Second), err)
			continue
		}
		// Same rule as the other providers: one stall is retried on the next key,
		// a second in a row gives the provider up.
		if isProviderOverloaded(err) {
			stalls++
			if stalls >= 2 {
				aiStage("warn", "Claude second-round key %s: %v → second stall in a row, giving up on the provider", attempt.Label(), err)
				break
			}
			aiStage("warn", "Claude second-round key %s: %v → stalled, retrying once on the next key", attempt.Label(), err)
			continue
		}
		aiStage("warn", "Claude second-round key %s failed: %v → rotating", attempt.Label(), err)
	}
	return "", "", lastErr
}

type claudeMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type claudeRequest struct {
	Model     string          `json:"model"`
	MaxTokens int             `json:"max_tokens"`
	Messages  []claudeMessage `json:"messages"`
	Stream    bool            `json:"stream"`
}

type claudeUsage struct {
	InputTokens          int `json:"input_tokens"`
	OutputTokens         int `json:"output_tokens"`
	CacheReadInputTokens int `json:"cache_read_input_tokens"`
}

func (s *AIService) executeClaude(prompt, apiKey string, opts aiProviderCompleteOptions, onDelta func(string)) (string, string, error) {
	model := claudeModel()
	maxTokens := opts.MaxCompletionTokens
	if maxTokens <= 0 {
		maxTokens = claudeDefaultMaxTokens
	}
	aiStage("call", "Claude second-round model=%s", model)
	started := time.Now()
	body, err := json.Marshal(claudeRequest{
		Model:     model,
		MaxTokens: maxTokens,
		Messages:  []claudeMessage{{Role: "user", Content: prompt}},
		Stream:    true,
	})
	if err != nil {
		return "", "", err
	}
	httpReq, err := http.NewRequest(http.MethodPost, claudeMessagesURL, bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", claudeAPIVersion)
	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if statusErr := classifyProviderResponse("Claude", "second-round request", model, resp); statusErr != nil {
		return "", "", statusErr
	}
	text, stop, usage, firstAt, err := readClaudeSSE(resp.Body, onDelta)
	if err != nil {
		return "", "", err
	}
	first := int64(0)
	if !firstAt.IsZero() {
		first = firstAt.Sub(started).Milliseconds()
	}
	if stop == "max_tokens" {
		aiStage("warn", "Claude second-round hit the output ceiling → the answer is cut off (output_tokens=%d)", usage.OutputTokens)
	} else {
		aiStage("usage", "Claude second-round took=%dms first_text=%dms stop=%s input_tokens=%d cached_tokens=%d output_tokens=%d",
			time.Since(started).Milliseconds(), first, stop, usage.InputTokens, usage.CacheReadInputTokens, usage.OutputTokens)
	}
	if strings.TrimSpace(text) == "" {
		return "", "", errors.New("claude second round returned empty response")
	}
	return text, model, nil
}

// claudeStreamEvent is the part of each Messages stream event this reads.
type claudeStreamEvent struct {
	Type    string `json:"type"`
	Message struct {
		Usage claudeUsage `json:"usage"`
	} `json:"message"`
	Delta struct {
		Type       string `json:"type"`
		Text       string `json:"text"`
		StopReason string `json:"stop_reason"`
	} `json:"delta"`
	Usage *claudeUsage `json:"usage"`
	Error struct {
		Type string `json:"type"`
	} `json:"error"`
}

// readClaudeSSE folds a Messages stream into the full text, handing each piece
// of written text to onDelta as it lands. Thinking, if the model does any, is
// not text and is skipped. An error event mid-stream (Anthropic reports an
// overload this way once the stream has started) comes back as the same error
// the rotation reads for an HTTP status, so a mid-stream overload is still a
// stall and not a silent half-answer.
func readClaudeSSE(body io.Reader, onDelta func(string)) (text, stop string, usage claudeUsage, firstAt time.Time, err error) {
	var out strings.Builder
	var streamErr error
	err = forEachSSEData(body, func(data string) bool {
		var event claudeStreamEvent
		if json.Unmarshal([]byte(data), &event) != nil {
			return true
		}
		switch event.Type {
		case "message_start":
			usage.InputTokens = event.Message.Usage.InputTokens
			usage.CacheReadInputTokens = event.Message.Usage.CacheReadInputTokens
		case "content_block_delta":
			if event.Delta.Type != "text_delta" || event.Delta.Text == "" {
				return true
			}
			if firstAt.IsZero() {
				firstAt = time.Now()
			}
			out.WriteString(event.Delta.Text)
			if onDelta != nil {
				onDelta(event.Delta.Text)
			}
		case "message_delta":
			if event.Delta.StopReason != "" {
				stop = event.Delta.StopReason
			}
			if event.Usage != nil {
				usage.OutputTokens = event.Usage.OutputTokens
			}
		case "message_stop":
			return false
		case "error":
			streamErr = claudeStreamError(event.Error.Type)
			return false
		}
		return true
	})
	if err == nil {
		err = streamErr
	}
	return out.String(), stop, usage, firstAt, err
}

func claudeStreamError(kind string) error {
	switch kind {
	case "overloaded_error":
		return newAIProviderHTTPError("claude", "second-round stream", claudeOverloadedStatus)
	case "rate_limit_error":
		return &rateLimitedError{Provider: "Claude"}
	}
	return newAIProviderHTTPError("claude", "second-round stream", http.StatusInternalServerError)
}
