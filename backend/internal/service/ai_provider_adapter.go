package service

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// aiProviderAnswerMode describes the current response path without exposing a
// provider's wire format to the orchestration layer.
type aiProviderAnswerMode uint8

const (
	aiProviderAnswerConversation aiProviderAnswerMode = iota + 1
	aiProviderAnswerAnalytical
)

type aiProviderAnswerRequest struct {
	Question       string
	History        []AIConversationMessage
	Snapshot       *AISnapshot
	Mode           aiProviderAnswerMode
	CandidateTools []AIToolName
}

type aiProviderAnswer struct {
	Text  string
	Model string
}

// aiProviderCompleteOptions carries per-call preferences to Complete. The zero
// value means "whatever the provider does by default", which is what every
// caller but joyboy passes, so adding a field here cannot change an existing
// request.
//
// It exists because joyboy makes two calls per question that want opposite
// things. Choosing tools is a judgement: at low effort it picked
// get_lowest_margin_menu for "เมนูไหนขายดีแต่กำไรน้อย", a tool that says nothing
// about how well anything sells, and then answered from it instead of saying the
// data was insufficient. Writing the answer is transcription: five of eight
// calls spent under twenty tokens thinking, and forcing more of it is what
// pushed two replies into the output ceiling mid-word.
//
// The preference is expressed here rather than by calling Groq directly, so that
// joyboy keeps going through this boundary. A path that named Groq would ignore
// AI_PROVIDER, and the setting would quietly stop being true for one caller.
type aiProviderCompleteOptions struct {
	// ReasoningEffort is "low", "medium" or "high" for models that support it.
	// Empty leaves the parameter out entirely.
	ReasoningEffort string
	// MaxCompletionTokens caps the reply — reasoning and written text together on
	// gpt-oss. Zero leaves the parameter out, so the provider default applies.
	//
	// It is here because the two settings have to move together for the write
	// round. Medium restores figure accuracy that low lost, but medium is also
	// what once thought for 1,917 tokens and ran the answer into the 2,048-token
	// provider default mid-word; a raised ceiling is what keeps that extra
	// thinking from being cut off. Groq reserves this against the daily budget at
	// request time, so it is set only where it is needed.
	MaxCompletionTokens int
	// Model overrides the provider's configured model for this one call. Empty
	// keeps whatever the provider is set to, which is what every caller wanted
	// until the free tier's numbers were actually read.
	//
	// On Gemini's free tier the daily request budget is per model, and the gap is
	// not small: the Flash-Lite models allow 500 requests a day while every Flash
	// model allows 20. A question costs about three calls, so putting all three
	// on one model caps the shop at 161 questions a day, and putting them on a
	// Flash model caps it at six.
	//
	// Only one of those three calls writes anything a person reads. The other two
	// pick a tool and shape a sentence into JSON — both structured, both work a
	// smaller model does well. Sending them to a different model spends a
	// different daily budget, and the one model that matters keeps its own.
	Model string
}

// aiProviderAdapter is the provider-neutral boundary used by AIService.
// Groq and Gemini keep their own HTTP payloads and response parsing behind this
// interface, while routing, fallback order, and backend policy remain shared.
type aiProviderAdapter interface {
	ID() string
	DisplayName() string
	Configured() bool
	Classify(question string, history []AIConversationMessage) (AIRouterResult, error)
	Answer(request aiProviderAnswerRequest) (aiProviderAnswer, error)
	Complete(prompt string, opts aiProviderCompleteOptions) (aiProviderAnswer, error)
}

type groqProviderAdapter struct {
	service *AIService
}

func (a *groqProviderAdapter) ID() string          { return "groq" }
func (a *groqProviderAdapter) DisplayName() string { return "Groq" }
func (a *groqProviderAdapter) Configured() bool    { return len(a.service.getGroqKeys()) > 0 }

func (a *groqProviderAdapter) Classify(question string, history []AIConversationMessage) (AIRouterResult, error) {
	keys := a.service.getGroqKeys()
	if len(keys) == 0 {
		return AIRouterResult{}, errors.New("GROQ_API_KEYS is not configured")
	}

	attempts, releaseAt := nextProviderAttempts(&a.service.keyHealth, "groq", keys, &a.service.groqKeyIndex)
	if len(attempts) == 0 {
		return AIRouterResult{}, allKeysRateLimitedError("Groq classifier", len(keys), releaseAt)
	}

	var lastErr error
	for _, attempt := range attempts {
		raw, err := a.service.executeClassifierGroq(question, history, attempt.Key)
		if err == nil {
			a.service.keyHealth.clear("groq", attempt.Index)
			result, parseErr := parseRouterJSON(raw)
			if parseErr == nil {
				return result, nil
			}
			lastErr = parseErr
			aiStage("warn", "Groq classifier returned invalid JSON (%v) → rotating", parseErr)
			continue
		}
		lastErr = err
		// A withdrawn model answers 404 for every key, so stop instead of spending
		// the remaining keys rediscovering the same failure.
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Groq classifier: %v — skipping remaining keys", err)
			return AIRouterResult{}, err
		}
		if errors.Is(err, errRateLimit) {
			wait := retryAfterOf(err)
			a.service.keyHealth.park("groq", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Groq classifier key %s rate limited → parked for %s", attempt.Label(), wait.Round(time.Second))
			continue
		}
		aiStage("warn", "Groq classifier key %s failed: %v → rotating", attempt.Label(), err)
	}
	return AIRouterResult{}, fmt.Errorf("Groq classifier exhausted configured keys: %w", lastErr)
}

func (a *groqProviderAdapter) Answer(request aiProviderAnswerRequest) (aiProviderAnswer, error) {
	if request.Mode == aiProviderAnswerConversation {
		text, model, err := a.service.askGroqWithRotation(request.Question, request.History, nil, true)
		return aiProviderAnswer{Text: text, Model: model}, err
	}
	if request.Mode != aiProviderAnswerAnalytical {
		return aiProviderAnswer{}, errors.New("unsupported AI provider answer mode")
	}
	if request.Snapshot == nil {
		return aiProviderAnswer{}, errors.New("analytical provider request requires a snapshot")
	}
	text, model, err := a.service.askGroqWithRotation(request.Question, request.History, request.Snapshot, false, request.CandidateTools)
	return aiProviderAnswer{Text: text, Model: model}, err
}

func (a *groqProviderAdapter) Complete(prompt string, opts aiProviderCompleteOptions) (aiProviderAnswer, error) {
	// Groq's model comes from GROQ_MODEL and this adapter has no per-call
	// override. Saying so out loud costs one log line and saves someone setting
	// AI_SUPPORT_MODEL, seeing no change, and having nothing to go on — a
	// setting that silently does nothing is worse than one that does not exist.
	if strings.TrimSpace(opts.Model) != "" {
		aiStage("warn", "AI_SUPPORT_MODEL=%q is ignored on Groq — only Gemini reads it", opts.Model)
	}
	text, model, err := a.service.askSecondRoundGroqWithRotation(prompt, opts)
	return aiProviderAnswer{Text: text, Model: model}, err
}

type geminiProviderAdapter struct {
	service *AIService
}

func (a *geminiProviderAdapter) ID() string          { return "gemini" }
func (a *geminiProviderAdapter) DisplayName() string { return "Gemini" }
func (a *geminiProviderAdapter) Configured() bool    { return len(a.service.getGeminiKeys()) > 0 }

func (a *geminiProviderAdapter) Classify(question string, history []AIConversationMessage) (AIRouterResult, error) {
	keys := a.service.getGeminiKeys()
	if len(keys) == 0 {
		return AIRouterResult{}, errors.New("GEMINI_API_KEYS is not configured")
	}

	attempts, releaseAt := nextProviderAttempts(&a.service.keyHealth, "gemini", keys, &a.service.geminiKeyIndex)
	if len(attempts) == 0 {
		return AIRouterResult{}, allKeysRateLimitedError("Gemini classifier", len(keys), releaseAt)
	}

	var lastErr error
	for _, attempt := range attempts {
		raw, err := a.service.executeClassifierGemini(question, history, attempt.Key)
		if err == nil {
			a.service.keyHealth.clear("gemini", attempt.Index)
			result, parseErr := parseRouterJSON(raw)
			if parseErr == nil {
				return result, nil
			}
			lastErr = parseErr
			aiStage("warn", "Gemini classifier returned invalid JSON (%v) → rotating", parseErr)
			continue
		}
		lastErr = err
		// A withdrawn model answers 404 for every key, so stop instead of spending
		// the remaining keys rediscovering the same failure.
		if errors.Is(err, errModelUnavailable) {
			aiStage("error", "Gemini classifier: %v — skipping remaining keys", err)
			return AIRouterResult{}, err
		}
		if errors.Is(err, errRateLimit) {
			wait := retryAfterOf(err)
			a.service.keyHealth.park("gemini", attempt.Index, time.Now().Add(wait))
			aiStage("warn", "Gemini classifier key %s rate limited → parked for %s", attempt.Label(), wait.Round(time.Second))
			continue
		}
		aiStage("warn", "Gemini classifier key %s failed: %v → rotating", attempt.Label(), err)
	}
	return AIRouterResult{}, fmt.Errorf("Gemini classifier exhausted configured keys: %w", lastErr)
}

func (a *geminiProviderAdapter) Answer(request aiProviderAnswerRequest) (aiProviderAnswer, error) {
	if request.Mode == aiProviderAnswerConversation {
		text, model, err := a.service.askGeminiWithRotation(request.Question, request.History, nil, true)
		return aiProviderAnswer{Text: text, Model: model}, err
	}
	if request.Mode != aiProviderAnswerAnalytical {
		return aiProviderAnswer{}, errors.New("unsupported AI provider answer mode")
	}
	if request.Snapshot == nil {
		return aiProviderAnswer{}, errors.New("analytical provider request requires a snapshot")
	}
	text, model, err := a.service.askGeminiWithRotation(request.Question, request.History, request.Snapshot, false, request.CandidateTools)
	return aiProviderAnswer{Text: text, Model: model}, err
}

// Complete ignores opts. Gemini has no equivalent of reasoning_effort on this
// path, and a preference that cannot be expressed is not a reason to refuse the
// call — the reply is still a reply. Dropping it here is what keeps the option a
// hint rather than a contract every provider has to honour.
func (a *geminiProviderAdapter) Complete(prompt string, opts aiProviderCompleteOptions) (aiProviderAnswer, error) {
	text, model, err := a.service.askSecondRoundGeminiWithRotation(prompt, opts.Model)
	return aiProviderAnswer{Text: text, Model: model}, err
}

func defaultAIProviderAdapters(service *AIService) []aiProviderAdapter {
	return []aiProviderAdapter{
		&groqProviderAdapter{service: service},
		&geminiProviderAdapter{service: service},
	}
}

func (s *AIService) allProviderAdapters() []aiProviderAdapter {
	if s.providerAdapters != nil {
		return s.providerAdapters
	}
	return defaultAIProviderAdapters(s)
}

// orderedProviderAdapters applies the public AI_PROVIDER policy in one place.
// Auto mode retains the established Groq -> Gemini fallback order; a chain
// ("gemini,groq") is tried in the order it is written, so the shop can name the
// voice it prefers and still have something to fall back to when that provider
// is having a bad afternoon.
func (s *AIService) orderedProviderAdapters() []aiProviderAdapter {
	adapters := s.allProviderAdapters()
	provider := s.getAIProvider()
	if provider == "auto" {
		return adapters
	}
	byID := make(map[string]aiProviderAdapter, len(adapters))
	for _, adapter := range adapters {
		byID[adapter.ID()] = adapter
	}
	ordered := make([]aiProviderAdapter, 0, len(adapters))
	for _, name := range aiProviderChain(provider) {
		if adapter, ok := byID[name]; ok {
			ordered = append(ordered, adapter)
		}
	}
	if len(ordered) == 0 {
		return nil
	}
	return ordered
}

func (s *AIService) hasConfiguredProvider() bool {
	for _, adapter := range s.orderedProviderAdapters() {
		if adapter.Configured() {
			return true
		}
	}
	return false
}

func missingProviderConfigurationError(provider string) error {
	return fmt.Errorf("%s_API_KEYS is not configured", strings.ToUpper(provider))
}
