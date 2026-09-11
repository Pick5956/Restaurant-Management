package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"testing"
)

type aiLoggingRoundTripperFunc func(*http.Request) (*http.Response, error)

func (fn aiLoggingRoundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func captureAILogs(t *testing.T, run func()) string {
	t.Helper()

	var output bytes.Buffer
	previousWriter := log.Writer()
	previousFlags := log.Flags()
	previousPrefix := log.Prefix()
	log.SetOutput(&output)
	log.SetFlags(0)
	log.SetPrefix("")
	t.Cleanup(func() {
		log.SetOutput(previousWriter)
		log.SetFlags(previousFlags)
		log.SetPrefix(previousPrefix)
	})

	run()
	return output.String()
}

func TestProviderCallLogsExcludeCredentialDerivedMaterial(t *testing.T) {
	credential := "<test-provider-secret>"
	groqBody := `{"choices":[{"message":{"content":"{}"}}]}`
	geminiBody := `{"candidates":[{"content":{"parts":[{"text":"{}"}]}}]}`
	client := &http.Client{Transport: aiLoggingRoundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body := groqBody
		if strings.Contains(request.URL.Host, "googleapis") {
			body = geminiBody
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    request,
		}, nil
	})}
	service := &AIService{httpClient: client}

	logs := captureAILogs(t, func() {
		if _, err := service.executeClassifierGroq("test question", nil, credential); err != nil {
			t.Fatalf("Groq classifier: %v", err)
		}
		if _, _, err := service.executeGroq("test question", nil, AISnapshot{}, credential, nil); err != nil {
			t.Fatalf("Groq analytical call: %v", err)
		}
		if _, _, err := service.executeGroqConversation("test question", nil, credential); err != nil {
			t.Fatalf("Groq conversation call: %v", err)
		}
		if _, _, err := service.executeSecondRoundGroq("test prompt", credential, aiProviderCompleteOptions{}); err != nil {
			t.Fatalf("Groq second-round call: %v", err)
		}
		if _, err := service.executeClassifierGemini("test question", nil, credential); err != nil {
			t.Fatalf("Gemini classifier: %v", err)
		}
		if _, _, err := service.executeGemini("test question", nil, AISnapshot{}, credential, nil); err != nil {
			t.Fatalf("Gemini analytical call: %v", err)
		}
		if _, _, err := service.executeGeminiConversation("test question", nil, credential); err != nil {
			t.Fatalf("Gemini conversation call: %v", err)
		}
		if _, _, err := service.executeSecondRoundGemini("test prompt", credential, ""); err != nil {
			t.Fatalf("Gemini second-round call: %v", err)
		}
	})

	for _, fragment := range []string{credential, credential[:6], credential[len(credential)-4:]} {
		if strings.Contains(logs, fragment) {
			t.Fatal("provider logs contain credential-derived material")
		}
	}
}

func TestAIRequestLogsExcludePromptContent(t *testing.T) {
	originalQuestion := "what about the private dining request marker"
	rewrittenQuestion := "standalone private planning request marker"
	service, _ := newScriptedProviderTestService(t,
		rewrittenQuestion,
		`{"task":"scope_question","confidence":0.97,"needs_restaurant_data":false,"needs_tool":false,"risk":"low","suggested_tool":""}`,
		"safe test answer",
	)

	logs := captureAILogs(t, func() {
		_, err := service.AskOperations(1, &AIAskRequest{
			Question: originalQuestion,
			History: []AIConversationMessage{{
				Role:    "user",
				Content: "earlier context",
			}},
		})
		if err != nil {
			t.Fatalf("AskOperations: %v", err)
		}
	})

	if strings.Contains(logs, originalQuestion) || strings.Contains(logs, rewrittenQuestion) {
		t.Fatal("AI request logs contain prompt content")
	}
	if !strings.Contains(logs, "question_length=") || !strings.Contains(logs, "context_rewritten=true") {
		t.Fatal("AI request logs are missing content-free request metadata")
	}
}

func TestProviderFailureErrorsAndLogsExcludeResponseBodyAndCredentialMaterial(t *testing.T) {
	credential := "<fake-provider-credential-material>"
	privateBodyMarker := "<private-provider-response-body>"
	credentialPrefix := credential[:8]
	credentialSuffix := credential[len(credential)-8:]
	t.Setenv("GROQ_API_KEYS", credential)
	t.Setenv("GEMINI_API_KEYS", credential)

	client := &http.Client{Transport: aiLoggingRoundTripperFunc(func(request *http.Request) (*http.Response, error) {
		body := privateBodyMarker + " " + credentialPrefix + " " + credentialSuffix
		return &http.Response{
			StatusCode: http.StatusBadRequest,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    request,
		}, nil
	})}
	service := &AIService{httpClient: client}
	snapshot := &AISnapshot{}

	calls := []struct {
		name string
		run  func() error
	}{
		{"Groq classifier", func() error {
			_, err := (&groqProviderAdapter{service: service}).Classify("private question", nil)
			return err
		}},
		{"Groq analytical", func() error {
			_, err := (&groqProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "private question", Snapshot: snapshot, Mode: aiProviderAnswerAnalytical})
			return err
		}},
		{"Groq conversation", func() error {
			_, err := (&groqProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "private question", Mode: aiProviderAnswerConversation})
			return err
		}},
		{"Groq second round", func() error {
			_, err := (&groqProviderAdapter{service: service}).Complete("private prompt", aiProviderCompleteOptions{})
			return err
		}},
		{"Gemini classifier", func() error {
			_, err := (&geminiProviderAdapter{service: service}).Classify("private question", nil)
			return err
		}},
		{"Gemini analytical", func() error {
			_, err := (&geminiProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "private question", Snapshot: snapshot, Mode: aiProviderAnswerAnalytical})
			return err
		}},
		{"Gemini conversation", func() error {
			_, err := (&geminiProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "private question", Mode: aiProviderAnswerConversation})
			return err
		}},
		{"Gemini second round", func() error {
			_, err := (&geminiProviderAdapter{service: service}).Complete("private prompt", aiProviderCompleteOptions{})
			return err
		}},
	}

	var returnedErrors []error
	logs := captureAILogs(t, func() {
		for _, call := range calls {
			err := call.run()
			if err == nil {
				t.Fatalf("%s returned nil error", call.name)
			}
			returnedErrors = append(returnedErrors, err)
		}
	})

	privateFragments := []string{privateBodyMarker, credential, credentialPrefix, credentialSuffix}
	for index, err := range returnedErrors {
		var statusErr *aiProviderHTTPError
		if !errors.As(err, &statusErr) || statusErr.StatusCode != http.StatusBadRequest {
			t.Fatalf("%s error = %v, want typed HTTP 400 error", calls[index].name, err)
		}
		for _, fragment := range privateFragments {
			if strings.Contains(err.Error(), fragment) {
				t.Fatalf("%s error contains private provider material", calls[index].name)
			}
		}
	}
	for _, fragment := range privateFragments {
		if strings.Contains(logs, fragment) {
			t.Fatal("provider failure logs contain private provider material")
		}
	}
}

func TestProviderHTTP429StillReturnsRateLimitSentinel(t *testing.T) {
	credential := "<fake-provider-credential-material>"
	t.Setenv("GROQ_API_KEYS", credential)
	t.Setenv("GEMINI_API_KEYS", credential)

	client := &http.Client{Transport: aiLoggingRoundTripperFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusTooManyRequests,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader("<private-rate-limit-body>")),
			Request:    request,
		}, nil
	})}
	service := &AIService{httpClient: client}
	snapshot := &AISnapshot{}

	calls := []struct {
		name string
		run  func() error
	}{
		{"Groq classifier", func() error { _, err := (&groqProviderAdapter{service: service}).Classify("question", nil); return err }},
		{"Groq analytical", func() error {
			_, err := (&groqProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "question", Snapshot: snapshot, Mode: aiProviderAnswerAnalytical})
			return err
		}},
		{"Groq conversation", func() error {
			_, err := (&groqProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "question", Mode: aiProviderAnswerConversation})
			return err
		}},
		{"Groq second round", func() error { _, err := (&groqProviderAdapter{service: service}).Complete("prompt", aiProviderCompleteOptions{}); return err }},
		{"Gemini classifier", func() error { _, err := (&geminiProviderAdapter{service: service}).Classify("question", nil); return err }},
		{"Gemini analytical", func() error {
			_, err := (&geminiProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "question", Snapshot: snapshot, Mode: aiProviderAnswerAnalytical})
			return err
		}},
		{"Gemini conversation", func() error {
			_, err := (&geminiProviderAdapter{service: service}).Answer(aiProviderAnswerRequest{Question: "question", Mode: aiProviderAnswerConversation})
			return err
		}},
		{"Gemini second round", func() error { _, err := (&geminiProviderAdapter{service: service}).Complete("prompt", aiProviderCompleteOptions{}); return err }},
	}

	captureAILogs(t, func() {
		for _, call := range calls {
			if err := call.run(); !errors.Is(err, errRateLimit) {
				t.Fatalf("%s error = %v, want rate-limit sentinel", call.name, err)
			}
		}
	})
}

func TestStructuredPlannerFailureLogsExcludeModelControlledContent(t *testing.T) {
	t.Setenv("AI_ORCHESTRATOR_MODE", "shadow")
	privatePlanMarker := "private-model-plan-marker"
	privateModelMarker := "private-model-metadata-marker"
	plan := structuredPlannerTestPlan("safe question")
	plan.Domain = ResolvedPlanDomain(privatePlanMarker)
	provider := &structuredPlannerMockProvider{
		name: StructuredPlannerProviderGroq,
		response: StructuredPlannerProviderResponse{
			RawJSON: structuredPlannerTestJSON(t, plan),
			Model:   privateModelMarker,
		},
	}
	service := &AIService{structuredPlannerProviders: []StructuredPlannerProvider{provider}}

	logs := captureAILogs(t, func() {
		prepared, err := service.prepareOwnerOrchestration(
			context.Background(),
			ownerActor(),
			&AIAskRequest{Question: "safe question"},
		)
		if err != nil || prepared != nil {
			t.Fatalf("prepareOwnerOrchestration() = (%+v, %v), want (nil, nil)", prepared, err)
		}
	})

	for _, privateMarker := range []string{privatePlanMarker, privateModelMarker} {
		if strings.Contains(logs, privateMarker) {
			t.Fatal("structured planner failure logs contain model-controlled content")
		}
	}
	if !strings.Contains(logs, "stage=validation") {
		t.Fatal("structured planner failure logs are missing the fixed failure stage")
	}
}
