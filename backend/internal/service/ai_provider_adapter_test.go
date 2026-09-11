package service

import (
	"errors"
	"reflect"
	"testing"
)

type stubAIProviderAdapter struct {
	id            string
	displayName   string
	configured    bool
	classifyCalls int
	answerCalls   int
	completeCalls int
	// completeOpts records what the last Complete was asked for, so a test can
	// prove a caller passed no preference rather than merely assuming it.
	completeOpts aiProviderCompleteOptions
	classify     func(string) (AIRouterResult, error)
	answer       func(aiProviderAnswerRequest) (aiProviderAnswer, error)
	complete     func(string) (aiProviderAnswer, error)
}

func (a *stubAIProviderAdapter) ID() string          { return a.id }
func (a *stubAIProviderAdapter) DisplayName() string { return a.displayName }
func (a *stubAIProviderAdapter) Configured() bool    { return a.configured }

func (a *stubAIProviderAdapter) Classify(question string, _ []AIConversationMessage) (AIRouterResult, error) {
	a.classifyCalls++
	if a.classify == nil {
		return AIRouterResult{}, errors.New("classifier not stubbed")
	}
	return a.classify(question)
}

func (a *stubAIProviderAdapter) Answer(request aiProviderAnswerRequest) (aiProviderAnswer, error) {
	a.answerCalls++
	if a.answer == nil {
		return aiProviderAnswer{}, errors.New("answer not stubbed")
	}
	return a.answer(request)
}

func (a *stubAIProviderAdapter) Complete(prompt string, opts aiProviderCompleteOptions) (aiProviderAnswer, error) {
	a.completeCalls++
	a.completeOpts = opts
	if a.complete == nil {
		return aiProviderAnswer{}, errors.New("completion not stubbed")
	}
	return a.complete(prompt)
}

type scriptedAIProviderAdapter struct {
	t       *testing.T
	outputs []string
	calls   int
}

func (a *scriptedAIProviderAdapter) ID() string          { return "groq" }
func (a *scriptedAIProviderAdapter) DisplayName() string { return "Test Provider" }
func (a *scriptedAIProviderAdapter) Configured() bool    { return true }

func (a *scriptedAIProviderAdapter) next() (string, error) {
	a.t.Helper()
	if a.calls >= len(a.outputs) {
		return "", errors.New("scripted provider received an unexpected call")
	}
	output := a.outputs[a.calls]
	a.calls++
	return output, nil
}

func (a *scriptedAIProviderAdapter) Classify(string, []AIConversationMessage) (AIRouterResult, error) {
	raw, err := a.next()
	if err != nil {
		return AIRouterResult{}, err
	}
	return parseRouterJSON(raw)
}

func (a *scriptedAIProviderAdapter) Answer(aiProviderAnswerRequest) (aiProviderAnswer, error) {
	text, err := a.next()
	return aiProviderAnswer{Text: text, Model: "test-provider"}, err
}

func (a *scriptedAIProviderAdapter) Complete(string, aiProviderCompleteOptions) (aiProviderAnswer, error) {
	text, err := a.next()
	return aiProviderAnswer{Text: text, Model: "test-provider"}, err
}

func newScriptedProviderTestService(t *testing.T, outputs ...string) (*AIService, *scriptedAIProviderAdapter) {
	t.Helper()
	adapter := &scriptedAIProviderAdapter{t: t, outputs: outputs}
	service := &AIService{providerAdapters: []aiProviderAdapter{adapter}}
	t.Setenv("AI_PROVIDER", "auto")
	return service, adapter
}

func validConversationRoute() AIRouterResult {
	return AIRouterResult{
		Task:       AITaskGeneralChat,
		Confidence: 0.99,
		Risk:       "low",
	}
}

func TestDefaultAIProviderAdaptersContainOnlyGroqAndGemini(t *testing.T) {
	service := &AIService{}
	adapters := defaultAIProviderAdapters(service)
	ids := make([]string, 0, len(adapters))
	for _, adapter := range adapters {
		ids = append(ids, adapter.ID())
	}
	if !reflect.DeepEqual(ids, []string{"groq", "gemini"}) {
		t.Fatalf("default provider order = %v, want [groq gemini]", ids)
	}
}

func TestClassifyIntentAutoFallsBackAcrossProviderAdapters(t *testing.T) {
	t.Setenv("AI_PROVIDER", "auto")
	groq := &stubAIProviderAdapter{
		id: "groq", displayName: "Groq", configured: true,
		classify: func(string) (AIRouterResult, error) {
			return AIRouterResult{}, errors.New("temporary Groq failure")
		},
	}
	gemini := &stubAIProviderAdapter{
		id: "gemini", displayName: "Gemini", configured: true,
		classify: func(string) (AIRouterResult, error) {
			return validConversationRoute(), nil
		},
	}
	service := &AIService{providerAdapters: []aiProviderAdapter{groq, gemini}}

	result, err := service.classifyIntent("hello", nil)
	if err != nil {
		t.Fatalf("classifyIntent fallback: %v", err)
	}
	if result.Task != AITaskGeneralChat || groq.classifyCalls != 1 || gemini.classifyCalls != 1 {
		t.Fatalf("fallback result/calls = task %q, Groq %d, Gemini %d", result.Task, groq.classifyCalls, gemini.classifyCalls)
	}
}

func TestClassifyIntentExplicitProviderDoesNotFallThrough(t *testing.T) {
	t.Setenv("AI_PROVIDER", "groq")
	groq := &stubAIProviderAdapter{
		id: "groq", displayName: "Groq", configured: true,
		classify: func(string) (AIRouterResult, error) {
			return AIRouterResult{}, errors.New("Groq unavailable")
		},
	}
	gemini := &stubAIProviderAdapter{
		id: "gemini", displayName: "Gemini", configured: true,
		classify: func(string) (AIRouterResult, error) {
			return validConversationRoute(), nil
		},
	}
	service := &AIService{providerAdapters: []aiProviderAdapter{groq, gemini}}

	result, err := service.classifyIntent("hello", nil)
	if err == nil || result.Task != AITaskAnalyzeData {
		t.Fatalf("explicit provider failure = result %+v, err %v", result, err)
	}
	if groq.classifyCalls != 1 || gemini.classifyCalls != 0 {
		t.Fatalf("explicit provider calls = Groq %d, Gemini %d", groq.classifyCalls, gemini.classifyCalls)
	}
}

func TestSecondRoundAutoFallbackUsesProviderAdapters(t *testing.T) {
	t.Setenv("AI_PROVIDER", "auto")
	groq := &stubAIProviderAdapter{
		id: "groq", displayName: "Groq", configured: true,
		complete: func(string) (aiProviderAnswer, error) {
			return aiProviderAnswer{}, errors.New("Groq rate limited")
		},
	}
	gemini := &stubAIProviderAdapter{
		id: "gemini", displayName: "Gemini", configured: true,
		complete: func(string) (aiProviderAnswer, error) {
			return aiProviderAnswer{Text: "fallback answer", Model: "gemini-test"}, nil
		},
	}
	service := &AIService{providerAdapters: []aiProviderAdapter{groq, gemini}}

	answer, model, err := service.askSecondRoundWithRotation("prompt")
	if err != nil || answer != "fallback answer" || model != "gemini-test" {
		t.Fatalf("second-round fallback = %q/%q, err %v", answer, model, err)
	}
	if groq.completeCalls != 1 || gemini.completeCalls != 1 {
		t.Fatalf("second-round calls = Groq %d, Gemini %d", groq.completeCalls, gemini.completeCalls)
	}
}

func TestCloudAdaptersRejectAnalyticalRequestWithoutSnapshot(t *testing.T) {
	service := &AIService{}
	request := aiProviderAnswerRequest{Mode: aiProviderAnswerAnalytical}
	for _, adapter := range defaultAIProviderAdapters(service) {
		if _, err := adapter.Answer(request); err == nil {
			t.Errorf("%s accepted analytical request without snapshot", adapter.ID())
		}
	}
}

// The three legacy callers of this boundary never had a preference to express,
// and adding one to the interface must not invent one for them. askSecondRound
// is the path joyboy shares with the context rewriter and the out-of-scope
// reply, so an effort leaking in here would change two answers nobody asked to
// change.
func TestSecondRoundWithoutOptionsAsksForNoPreference(t *testing.T) {
	t.Setenv("AI_PROVIDER", "groq")
	groq := &stubAIProviderAdapter{
		id: "groq", displayName: "Groq", configured: true,
		complete: func(string) (aiProviderAnswer, error) {
			return aiProviderAnswer{Text: "answer", Model: "test"}, nil
		},
	}
	service := &AIService{providerAdapters: []aiProviderAdapter{groq}}

	if _, _, err := service.askSecondRoundWithRotation("prompt"); err != nil {
		t.Fatalf("second round failed: %v", err)
	}
	if groq.completeOpts != (aiProviderCompleteOptions{}) {
		t.Fatalf("a preference was invented for a caller that has none: %+v", groq.completeOpts)
	}
}

// And the caller that does have one must have it arrive intact, or joyboy would
// silently keep running at the provider default it is trying to move off.
func TestSecondRoundWithOptionsCarriesThePreferenceThrough(t *testing.T) {
	t.Setenv("AI_PROVIDER", "groq")
	groq := &stubAIProviderAdapter{
		id: "groq", displayName: "Groq", configured: true,
		complete: func(string) (aiProviderAnswer, error) {
			return aiProviderAnswer{Text: "answer", Model: "test"}, nil
		},
	}
	service := &AIService{providerAdapters: []aiProviderAdapter{groq}}

	_, _, err := service.askSecondRoundWithOptions("prompt", aiProviderCompleteOptions{ReasoningEffort: "low"})
	if err != nil {
		t.Fatalf("second round failed: %v", err)
	}
	if groq.completeOpts.ReasoningEffort != "low" {
		t.Fatalf("the preference was dropped on the way down: %+v", groq.completeOpts)
	}
}
