package service

import (
	"fmt"
	"strings"
	"errors"
	"net/http"
	"testing"
	"time"
)

func responseWith(status int, header http.Header) *http.Response {
	if header == nil {
		header = http.Header{}
	}
	return &http.Response{StatusCode: status, Header: header}
}

// A 404 must be told apart from other failures: every key answers the same way,
// so the caller has to stop rotating and report a configuration problem.
func TestClassifyProviderResponseDetectsWithdrawnModel(t *testing.T) {
	err := classifyProviderResponse("Groq", "classifier", "llama-3.3-70b-versatile", responseWith(http.StatusNotFound, nil))
	if !errors.Is(err, errModelUnavailable) {
		t.Fatalf("expected errModelUnavailable, got %v", err)
	}
	if !contains(err.Error(), "llama-3.3-70b-versatile") {
		t.Fatalf("expected the model name in the message, got %q", err.Error())
	}
}

func TestClassifyProviderResponseReadsRetryAfter(t *testing.T) {
	header := http.Header{}
	header.Set("retry-after", "7")
	err := classifyProviderResponse("Groq", "classifier", "m", responseWith(http.StatusTooManyRequests, header))
	if !errors.Is(err, errRateLimit) {
		t.Fatalf("expected errRateLimit, got %v", err)
	}
	if got := retryAfterOf(err); got != 7*time.Second {
		t.Fatalf("expected a 7s wait, got %s", got)
	}
}

// Groq reports the per-minute reset as a Go duration string, and it is present
// even when retry-after is not.
func TestRetryAfterFromHeadersFallsBackToResetHeaders(t *testing.T) {
	header := http.Header{}
	header.Set("x-ratelimit-reset-tokens", "7.66s")
	if got := retryAfterFromHeaders(header); got < 7*time.Second || got > 8*time.Second {
		t.Fatalf("expected roughly 7.66s, got %s", got)
	}

	empty := retryAfterFromHeaders(http.Header{})
	if empty != defaultKeyCooldown {
		t.Fatalf("expected the default cooldown, got %s", empty)
	}
}

func TestClassifyProviderResponsePassesSuccessAndOtherErrors(t *testing.T) {
	if err := classifyProviderResponse("Groq", "classifier", "m", responseWith(http.StatusOK, nil)); err != nil {
		t.Fatalf("expected 200 to be usable, got %v", err)
	}
	err := classifyProviderResponse("Groq", "classifier", "m", responseWith(http.StatusInternalServerError, nil))
	if err == nil || errors.Is(err, errRateLimit) || errors.Is(err, errModelUnavailable) {
		t.Fatalf("expected a plain provider error for 500, got %v", err)
	}
}

// A parked key is skipped until its window resets, then becomes usable again.
func TestKeyHealthParksAndReleases(t *testing.T) {
	now := time.Now()
	health := &providerKeyHealth{nowFunc: func() time.Time { return now }}

	health.park("groq", 1, now.Add(30*time.Second))
	if ok, _ := health.available("groq", 1); ok {
		t.Fatal("expected the parked key to be unavailable")
	}
	if ok, _ := health.available("groq", 0); !ok {
		t.Fatal("expected an untouched key to stay available")
	}

	now = now.Add(31 * time.Second)
	if ok, _ := health.available("groq", 1); !ok {
		t.Fatal("expected the key to be released once its window reset")
	}
}

func TestKeyHealthKeepsTheLongestPark(t *testing.T) {
	now := time.Now()
	health := &providerKeyHealth{nowFunc: func() time.Time { return now }}
	health.park("groq", 0, now.Add(time.Minute))
	health.park("groq", 0, now.Add(10*time.Second)) // must not shorten the wait

	now = now.Add(20 * time.Second)
	if ok, _ := health.available("groq", 0); ok {
		t.Fatal("expected the longer park to win")
	}
}

func TestNextProviderAttemptsSkipsParkedKeys(t *testing.T) {
	now := time.Now()
	health := &providerKeyHealth{nowFunc: func() time.Time { return now }}
	keys := []string{"k0", "k1", "k2", "k3"}
	var cursor uint32

	health.park("groq", 1, now.Add(time.Minute))
	health.park("groq", 2, now.Add(time.Minute))

	attempts, releaseAt := nextProviderAttempts(health, "groq", keys, &cursor)
	if !releaseAt.IsZero() {
		t.Fatalf("expected no release time while keys remain, got %s", releaseAt)
	}
	if len(attempts) != 2 {
		t.Fatalf("expected the 2 free keys, got %d", len(attempts))
	}
	for _, attempt := range attempts {
		if attempt.Index == 1 || attempt.Index == 2 {
			t.Fatalf("parked key %d should not be attempted", attempt.Index)
		}
		if attempt.Total != len(keys) {
			t.Fatalf("expected Total to stay %d, got %d", len(keys), attempt.Total)
		}
	}
}

// Only when every key is parked does the caller get a quota error — and it says
// how long the wait is.
func TestNextProviderAttemptsReportsWhenEveryKeyIsParked(t *testing.T) {
	now := time.Now()
	health := &providerKeyHealth{nowFunc: func() time.Time { return now }}
	keys := []string{"k0", "k1"}
	var cursor uint32

	health.park("groq", 0, now.Add(2*time.Minute))
	health.park("groq", 1, now.Add(45*time.Second))

	attempts, releaseAt := nextProviderAttempts(health, "groq", keys, &cursor)
	if len(attempts) != 0 {
		t.Fatalf("expected no attempts, got %d", len(attempts))
	}
	if releaseAt.IsZero() {
		t.Fatal("expected a release time for the soonest key")
	}

	err := allKeysRateLimitedError("Groq", len(keys), releaseAt)
	if !errors.Is(err, ErrAIQuotaExceeded) {
		t.Fatalf("expected ErrAIQuotaExceeded, got %v", err)
	}
	if !contains(err.Error(), "retry in") {
		t.Fatalf("expected the wait in the message, got %q", err.Error())
	}
}

func TestKeyHealthClearReleasesAfterSuccess(t *testing.T) {
	now := time.Now()
	health := &providerKeyHealth{nowFunc: func() time.Time { return now }}
	health.park("gemini", 0, now.Add(time.Minute))
	health.clear("gemini", 0)
	if ok, _ := health.available("gemini", 0); !ok {
		t.Fatal("expected a cleared key to be usable again")
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (haystack == needle || indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}

// One 429 must never retire a key for longer than the window it is waiting on.
// The daily reset header reads 24-46 minutes on these keys, and using it as the
// cooldown starved the rotation for the rest of an evaluation run.
func TestKeyCooldownIsBounded(t *testing.T) {
	// A wait the provider states outright is believed, because it is the only
	// signal that separates a per-minute window from an exhausted daily budget.
	// Groq answers 429 with retry-after 2919 ("tokens per day (TPD): Limit
	// 200000") once the organisation budget is gone; capping that to 90 seconds
	// produced twenty retries that could not have succeeded.
	explicit := http.Header{}
	explicit.Set("retry-after", "397") // 6m37s, as a provider actually returned
	if got := retryAfterFromHeaders(explicit); got != 397*time.Second {
		t.Fatalf("a stated retry-after must be honoured, got %s", got)
	}

	// It is still bounded: a stated wait longer than the cap is trimmed.
	veryLong := http.Header{}
	veryLong.Set("retry-after", "7200")
	if got := retryAfterFromHeaders(veryLong); got != maxStatedCooldown {
		t.Fatalf("a stated wait beyond the cap must be trimmed to %s, got %s", maxStatedCooldown, got)
	}

	// A wait we inferred ourselves stays on the short leash: it is a guess, and
	// holding a key back wrongly removes a quarter of the capacity.
	inferred := http.Header{}
	inferred.Set("x-ratelimit-reset-tokens", "5m")
	if got := retryAfterFromHeaders(inferred); got != maxKeyCooldown {
		t.Fatalf("an inferred wait must stay capped at %s, got %s", maxKeyCooldown, got)
	}

	// A short, honest wait is used as given.
	short := http.Header{}
	short.Set("retry-after", "7")
	if got := retryAfterFromHeaders(short); got != 7*time.Second {
		t.Fatalf("a short retry-after must be honoured, got %s", got)
	}

	// The daily reset window must not be mistaken for the per-minute one.
	daily := http.Header{}
	daily.Set("x-ratelimit-reset-requests", "24m28.8s")
	if got := retryAfterFromHeaders(daily); got != defaultKeyCooldown {
		t.Fatalf("the daily reset must not become the cooldown, got %s", got)
	}

	// The per-minute reset still drives the wait.
	perMinute := http.Header{}
	perMinute.Set("x-ratelimit-reset-tokens", "7.66s")
	if got := retryAfterFromHeaders(perMinute); got < 7*time.Second || got > 8*time.Second {
		t.Fatalf("expected roughly 7.66s from the per-minute reset, got %s", got)
	}
}

// Every key parked with the first one a moment from free used to answer the
// owner "เชื่อมต่อผู้ช่วย AI ไม่ได้" rather than wait out the moment.
func TestNextProviderAttemptsHoldsForAKeyThatIsAboutToFreeUp(t *testing.T) {
	var health providerKeyHealth
	var cursor uint32
	keys := []string{"a", "b"}
	health.park("groq", 0, time.Now().Add(80*time.Millisecond))
	health.park("groq", 1, time.Now().Add(120*time.Millisecond))

	started := time.Now()
	attempts, releaseAt := nextProviderAttempts(&health, "groq", keys, &cursor)
	if len(attempts) == 0 {
		t.Fatalf("a key frees up in 80ms, it should have been waited for (releaseAt=%v)", releaseAt)
	}
	if elapsed := time.Since(started); elapsed < 60*time.Millisecond {
		t.Errorf("returned after %s without waiting for the park to expire", elapsed)
	}
}

// A real quota outage must still fail fast rather than holding the request open.
func TestNextProviderAttemptsDoesNotHoldForALongPark(t *testing.T) {
	var health providerKeyHealth
	var cursor uint32
	health.park("groq", 0, time.Now().Add(time.Hour))

	started := time.Now()
	attempts, releaseAt := nextProviderAttempts(&health, "groq", []string{"a"}, &cursor)
	if len(attempts) != 0 {
		t.Fatalf("a key parked for an hour is not available")
	}
	if releaseAt.IsZero() {
		t.Errorf("the caller needs to know when it frees up")
	}
	if elapsed := time.Since(started); elapsed > maxRateLimitHold {
		t.Errorf("waited %s on an hour-long park", elapsed)
	}
}

// A rotation log has to name the key well enough to follow it through a file,
// and not well enough to use it. "key 3/3 failed" meant counting lines in .env to
// find the broken one, and pointed at the wrong one as soon as anybody reordered
// the list. Showing the first and last characters — the way a provider console
// does — was the first attempt, and the credential-material test rejected it;
// this is the version that keeps both properties.
func TestProviderAttemptLabelIdentifiesTheKeyWithoutExposingIt(t *testing.T) {
	const secret = "AIzaSyBuc7ExampleKeyMaterialThatMustNotLeak_i5Zs"
	attempt := providerAttempt{Key: secret, Position: 3, Total: 3}
	label := attempt.Label()

	// Nothing from the key itself, including the fragments the logging test bans.
	for _, fragment := range []string{secret, secret[:8], secret[len(secret)-8:], "ExampleKeyMaterial"} {
		if strings.Contains(label, fragment) {
			t.Fatalf("key material reached the log: %q", label)
		}
	}
	if !strings.Contains(label, "3/3") {
		t.Errorf("the label should still say which position failed: %q", label)
	}
	// Same key, same fingerprint — that is what makes a log followable.
	if again := attempt.Label(); again != label {
		t.Errorf("the fingerprint is not stable: %q then %q", label, again)
	}
	// Different keys must be told apart, or the fingerprint says nothing.
	other := providerAttempt{Key: secret + "x", Position: 3, Total: 3}.Label()
	if other == label {
		t.Errorf("two different keys produced the same label: %q", label)
	}
	// An empty key must not panic or invent a fingerprint.
	if got := (providerAttempt{Position: 1, Total: 2}).Label(); !strings.Contains(got, "1/2") {
		t.Errorf("an empty key should still report its position: %q", got)
	}
}

// A key the provider refuses outright (401/403) parks like a rate limit, but
// for an hour: retrying it once per rotation cycle was one wasted round trip
// per cycle, forever, with the answer still coming from the next key.
func TestClassifyProviderResponseParksRejectedKeyForAnHour(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		err := classifyProviderResponse("Gemini", "second-round", "gemini-3.5-flash-lite", responseWith(status, nil))
		if !errors.Is(err, errKeyRejected) {
			t.Fatalf("HTTP %d should be a rejected key, got %v", status, err)
		}
		if got := retryAfterOf(err); got != rejectedKeyCooldown {
			t.Fatalf("HTTP %d parked for %s, want %s", status, got, rejectedKeyCooldown)
		}
		if msg := err.Error(); !strings.Contains(msg, "rejected") || !strings.Contains(msg, fmt.Sprint(status)) {
			t.Fatalf("message should name the refusal and the status, got %q", msg)
		}
	}
	// A real 429 keeps its own wait.
	limited := classifyProviderResponse("Gemini", "second-round", "m", responseWith(http.StatusTooManyRequests, http.Header{"Retry-After": []string{"7"}}))
	if got := retryAfterOf(limited); got != 7*time.Second {
		t.Fatalf("429 wait = %s, want 7s", got)
	}
}
