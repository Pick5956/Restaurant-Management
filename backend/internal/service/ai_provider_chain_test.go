package service

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"
)

// AI_PROVIDER names the voice the shop wants. A chain names a fallback too:
// "gemini,groq" is "use Gemini, and when Gemini is having a bad afternoon use
// Groq rather than telling the owner nothing".
func TestAIProviderChainReadsAnOrderedList(t *testing.T) {
	service := &AIService{}
	for _, testCase := range []struct {
		env  string
		want string
	}{
		{"", "auto"},
		{"auto", "auto"},
		{"gemini", "gemini"},
		{"GEMINI, GROQ", "gemini, groq"},
		{"gemini,groq", "gemini,groq"},
		{"nonsense", "auto"},
		{"gemini,nonsense", "auto"},
	} {
		t.Setenv("AI_PROVIDER", testCase.env)
		if got := service.getAIProvider(); got != testCase.want {
			t.Errorf("AI_PROVIDER=%q → %q, want %q", testCase.env, got, testCase.want)
		}
	}
}

func TestAIProviderChainSplitsAndDeduplicates(t *testing.T) {
	got := aiProviderChain(" gemini , groq ,gemini, ")
	if len(got) != 2 || got[0] != "gemini" || got[1] != "groq" {
		t.Fatalf("chain = %v, want [gemini groq]", got)
	}
	if len(aiProviderChain("  ,  ")) != 0 {
		t.Error("a chain of nothing is no chain")
	}
}

// An overload is the provider saying "not now"; a rate limit is our own quota,
// and a withdrawn model is a configuration error. Only the first is worth
// setting the provider aside for.
func TestIsProviderOverloadedTellsOutagesFromOtherFailures(t *testing.T) {
	for _, status := range []int{http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout} {
		if !isProviderOverloaded(newAIProviderHTTPError("gemini", "second-round", status)) {
			t.Errorf("HTTP %d should read as an overload", status)
		}
	}
	for _, other := range []error{
		newAIProviderHTTPError("gemini", "second-round", http.StatusBadRequest),
		errRateLimit,
		errModelUnavailable,
		errors.New("something else"),
	} {
		if isProviderOverloaded(other) {
			t.Errorf("%v should not read as an overload", other)
		}
	}
}

// A key whose request never got headers back is a provider that is not
// answering, also after the classifier wraps it in "exhausted keys: %w" - the
// rotation stops on it instead of trying every key (28 ก.ย. 2569: 53 s).
func TestIsProviderOverloadedSeesAWrappedHeaderTimeout(t *testing.T) {
	timeout := &url.Error{Op: "Post", URL: "https://example.test", Err: headerTimeout{}}
	if !isProviderOverloaded(timeout) {
		t.Fatal("a header timeout should read as an overload")
	}
	if !isProviderOverloaded(fmt.Errorf("Gemini classifier exhausted configured keys: %w", timeout)) {
		t.Fatal("a wrapped header timeout should still read as an overload")
	}
}

type headerTimeout struct{}

func (headerTimeout) Error() string   { return "http2: timeout awaiting response headers" }
func (headerTimeout) Timeout() bool   { return true }
func (headerTimeout) Temporary() bool { return true }

// Parking a provider sets every one of its keys aside at once, and it frees
// itself when the window passes — the assistant must not stay down longer than
// the provider does.
func TestParkProviderSetsTheWholeProviderAsideThenReleasesIt(t *testing.T) {
	now := time.Now()
	health := providerKeyHealth{nowFunc: func() time.Time { return now }}

	if usable, _ := health.providerAvailable("gemini"); !usable {
		t.Fatal("a provider starts usable")
	}
	health.parkProvider("gemini", now.Add(aiProviderOverloadPark))
	usable, until := health.providerAvailable("gemini")
	if usable {
		t.Fatal("a parked provider must be skipped")
	}
	if !until.After(now) {
		t.Fatalf("park should end in the future, got %v", until)
	}
	// The other provider is untouched: that is the whole point of falling back.
	if usable, _ := health.providerAvailable("groq"); !usable {
		t.Fatal("parking one provider must not park the other")
	}

	now = now.Add(aiProviderOverloadPark + time.Second)
	if usable, _ := health.providerAvailable("gemini"); !usable {
		t.Fatal("the park must release itself once the window passes")
	}
}

// With one provider there is nothing to fall back to, so an overload must not
// set it aside: the owner's retry a few seconds later has to reach it again
// (28 ก.ย. 2569, AI_PROVIDER=gemini — every retry for 45 seconds failed in 3 ms
// without asking Gemini). With two, the overloaded one still sits out.
func TestOverloadDoesNotSetTheOnlyProviderAside(t *testing.T) {
	overloaded := func(string) (aiProviderAnswer, error) {
		return aiProviderAnswer{}, newAIProviderHTTPError("gemini", "second-round", http.StatusServiceUnavailable)
	}
	t.Setenv("AI_PROVIDER", "gemini")
	gemini := &stubAIProviderAdapter{id: "gemini", displayName: "Gemini", configured: true, complete: overloaded}
	service := &AIService{providerAdapters: []aiProviderAdapter{gemini}}
	for attempt := 0; attempt < 2; attempt++ {
		if _, _, err := service.askSecondRoundWithRotation("prompt"); err == nil {
			t.Fatal("an overloaded provider cannot answer")
		}
	}
	if gemini.completeCalls != 2 {
		t.Fatalf("the retry must reach the only provider again: %d calls, want 2", gemini.completeCalls)
	}

	t.Setenv("AI_PROVIDER", "gemini,groq")
	gemini = &stubAIProviderAdapter{id: "gemini", displayName: "Gemini", configured: true, complete: overloaded}
	groq := &stubAIProviderAdapter{id: "groq", displayName: "Groq", configured: true,
		complete: func(string) (aiProviderAnswer, error) { return aiProviderAnswer{Text: "ok", Model: "groq-test"}, nil }}
	service = &AIService{providerAdapters: []aiProviderAdapter{gemini, groq}}
	for attempt := 0; attempt < 2; attempt++ {
		if answer, _, err := service.askSecondRoundWithRotation("prompt"); err != nil || answer != "ok" {
			t.Fatalf("fallback answer = %q, err %v", answer, err)
		}
	}
	if gemini.completeCalls != 1 || groq.completeCalls != 2 {
		t.Fatalf("with a fallback the overloaded provider sits out: Gemini %d, Groq %d", gemini.completeCalls, groq.completeCalls)
	}
}
