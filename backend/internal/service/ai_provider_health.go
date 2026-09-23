package service

// Provider health: two failures that used to look identical in the logs and cost
// a full round of pointless retries.
//
//  1. A model that the provider has withdrawn answers 404 for EVERY key, so
//     rotating keys just burns latency. This happened in production with
//     llama-3.3-70b-versatile: 4 keys x 404 on every single question before the
//     fallback provider was reached. Model-unavailable now aborts rotation on the
//     first key and is reported as an operator-actionable error.
//
//  2. A key that is rate limited stays limited until its window resets. Groq
//     always returns the remaining budget in headers and adds `retry-after` on a
//     429, so a key that answers 429 is parked until that moment and skipped by
//     later calls. Only when every key is parked does the caller see a quota
//     error. Nothing is pre-flighted: a probe request would itself consume one of
//     the requests-per-day it is trying to protect. The headers ride along with
//     the calls that were happening anyway.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// errModelUnavailable means the configured model name no longer exists at the
// provider. Rotating keys cannot fix it — the configuration has to change.
var errModelUnavailable = errors.New("model unavailable at provider")

// errKeyRejected is the sentinel for a key the provider refused (401/403).
var errKeyRejected = errors.New("api key rejected by provider")

// modelUnavailableError carries what the operator needs in order to fix it.
type modelUnavailableError struct {
	Provider string
	Model    string
}

func (e *modelUnavailableError) Error() string {
	return fmt.Sprintf("%s model %q no longer exists (HTTP 404) — update the model in configuration", e.Provider, e.Model)
}

func (e *modelUnavailableError) Is(target error) bool { return target == errModelUnavailable }

func newModelUnavailableError(provider, model string) error {
	return &modelUnavailableError{Provider: provider, Model: model}
}

// rateLimitedError carries how long the provider asked us to wait, so the
// rotation loop can park the key for exactly that long.
type rateLimitedError struct {
	Provider   string
	RetryAfter time.Duration
}

func (e *rateLimitedError) Error() string {
	return fmt.Sprintf("%s rate limited (retry after %s)", e.Provider, e.RetryAfter.Round(time.Second))
}

func (e *rateLimitedError) Is(target error) bool { return target == errRateLimit }

// keyRejectedError is a 401 or 403: the provider refused the key itself —
// revoked, a wrong project, the API not enabled for it. Every call with that key
// fails the same way, so the rotation parks it like a rate limit, only for an
// hour rather than a minute: nothing but a change in .env brings it back.
//
// Before this it was a plain HTTP error, "rotated" and forgotten, and the next
// rotation cycle tried it again: on 23 ก.ย. 2569 key 1 of 5 answered 403 on
// every question, one wasted round trip per cycle, logged as a warning nobody
// acted on because the answer still came from key 2.
type keyRejectedError struct {
	Provider string
	Status   int
}

func (e *keyRejectedError) Error() string {
	return fmt.Sprintf("%s key rejected (HTTP %d) — revoked or not allowed for this API; check the key list in .env", e.Provider, e.Status)
}

func (e *keyRejectedError) Is(target error) bool { return target == errKeyRejected }

// rejectedKeyCooldown is how long a refused key stays out of rotation.
const rejectedKeyCooldown = time.Hour

// retryAfterOf reports the wait a rate-limit error asked for.
func retryAfterOf(err error) time.Duration {
	var rejected *keyRejectedError
	if errors.As(err, &rejected) {
		return rejectedKeyCooldown
	}
	var limited *rateLimitedError
	if errors.As(err, &limited) && limited.RetryAfter > 0 {
		return limited.RetryAfter
	}
	return defaultKeyCooldown
}

// defaultKeyCooldown is used when a 429 arrives without a usable `retry-after`.
const defaultKeyCooldown = time.Minute

// providerKeyHealth parks rate-limited keys until their window resets.
type providerKeyHealth struct {
	mu       sync.Mutex
	parked   map[string]time.Time
	nowFunc  func() time.Time // swapped in tests
	initOnce sync.Once
}

func (h *providerKeyHealth) init() {
	h.initOnce.Do(func() {
		if h.parked == nil {
			h.parked = make(map[string]time.Time)
		}
		if h.nowFunc == nil {
			h.nowFunc = time.Now
		}
	})
}

func keyHealthID(provider string, keyIndex int) string {
	return provider + "#" + strconv.Itoa(keyIndex)
}

// park marks a key unusable until `until`. A later reset never shortens an
// existing park, so the most pessimistic known reset wins.
func (h *providerKeyHealth) park(provider string, keyIndex int, until time.Time) {
	h.init()
	h.mu.Lock()
	defer h.mu.Unlock()
	id := keyHealthID(provider, keyIndex)
	if existing, ok := h.parked[id]; ok && existing.After(until) {
		return
	}
	h.parked[id] = until
}

// available reports whether the key can be tried now, and when it frees up if not.
func (h *providerKeyHealth) available(provider string, keyIndex int) (bool, time.Time) {
	h.init()
	h.mu.Lock()
	defer h.mu.Unlock()
	id := keyHealthID(provider, keyIndex)
	until, ok := h.parked[id]
	if !ok {
		return true, time.Time{}
	}
	if !until.After(h.nowFunc()) {
		delete(h.parked, id) // window has reset
		return true, time.Time{}
	}
	return false, until
}

// parkProvider marks a whole provider unusable until `until`, and available
// reads it back through the same keyed map by using a key index no real key can
// have. One question runs three to five model calls, each rotating every key, so
// a provider that is down costs fifteen to twenty-five attempts — several of
// them 30-second timeouts — before the owner is told anything. Once every key
// has answered "overloaded" for the same provider, the rest of that question
// skips it and goes straight to the fallback.
func (h *providerKeyHealth) parkProvider(provider string, until time.Time) {
	h.park(provider, providerWideKeyIndex, until)
}

// providerAvailable reports whether the provider as a whole may be tried.
func (h *providerKeyHealth) providerAvailable(provider string) (bool, time.Time) {
	return h.available(provider, providerWideKeyIndex)
}

// providerWideKeyIndex stands for "every key of this provider". Key indexes are
// positions in a list and never negative, so this can share the same map.
const providerWideKeyIndex = -1

// aiProviderOverloadPark is how long a provider sits out after every one of its
// keys reported an overload. Long enough to save the retries inside one
// question, short enough that a passing spike is not punished for minutes.
const aiProviderOverloadPark = 45 * time.Second

// isProviderOverloaded reports whether an error is the provider saying it is
// too busy right now — distinct from a rate limit, which is our own quota, and
// from a bad model name, which no amount of waiting fixes.
func isProviderOverloaded(err error) bool {
	var httpErr *aiProviderHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode == http.StatusServiceUnavailable ||
			httpErr.StatusCode == http.StatusBadGateway ||
			httpErr.StatusCode == http.StatusGatewayTimeout
	}
	// A request that never got headers back is the same story from the caller's
	// side: the provider is not answering.
	return errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err)
}

// clear releases a key after a successful call.
func (h *providerKeyHealth) clear(provider string, keyIndex int) {
	h.init()
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.parked, keyHealthID(provider, keyIndex))
}

// earliestRelease reports when the first of the given keys frees up, so the
// caller can tell the owner how long to wait instead of a bare "quota exceeded".
func (h *providerKeyHealth) earliestRelease(provider string, keyCount int) time.Time {
	h.init()
	h.mu.Lock()
	defer h.mu.Unlock()
	var earliest time.Time
	for i := 0; i < keyCount; i++ {
		until, ok := h.parked[keyHealthID(provider, i)]
		if !ok {
			return time.Time{} // a key is already free
		}
		if earliest.IsZero() || until.Before(earliest) {
			earliest = until
		}
	}
	return earliest
}

// retryAfterFromHeaders reads how long to park a key. `retry-after` is only sent
// on a 429; x-ratelimit-reset-tokens ("7.66s") covers the per-minute window and
// is present on every response.
func retryAfterFromHeaders(header http.Header) time.Duration {
	// An explicit retry-after is the provider stating the wait, not a guess, and
	// it is the only signal that distinguishes a per-minute window from a daily
	// one. Groq answers 429 with "tokens per day (TPD): Limit 200000 ... try again
	// in 48m38s" once the org budget is gone; clamping that to 90 seconds turned
	// one exhausted budget into twenty pointless retries that all looked like
	// unexplained provider failures.
	if raw := strings.TrimSpace(header.Get("retry-after")); raw != "" {
		if seconds, err := strconv.ParseFloat(raw, 64); err == nil && seconds > 0 {
			return capStatedCooldown(time.Duration(seconds * float64(time.Second)))
		}
	}
	// Only the per-minute reset is a useful stand-in. x-ratelimit-reset-requests
	// is the daily window — measured at 24 to 46 minutes on these keys — so using
	// it would retire a key for most of an hour over a limit that clears in one.
	if d, ok := parseGoDurationHeader(header.Get("x-ratelimit-reset-tokens")); ok {
		return capKeyCooldown(d)
	}
	return defaultKeyCooldown
}

// maxKeyCooldown bounds how long one 429 can take a key out of rotation.
// Parking too long is far more expensive than parking too briefly: a key that is
// still limited costs one cheap failed request and is parked again, while a key
// wrongly held back removes a quarter of the capacity for the whole window. A
// run of evaluations lost most of its keys this way and looked like a broken
// planner rather than a starved one.
const maxKeyCooldown = 90 * time.Second

// maxStatedCooldown bounds a wait the provider stated outright. It is far higher
// than maxKeyCooldown because the two answer different questions: 90 seconds is
// how long to trust our own inference from a per-minute header, while this is how
// long to believe the provider when it names the wait itself. A daily budget that
// is genuinely gone frees up in tens of minutes, and retrying through it wastes
// the requests-per-day budget as well.
const maxStatedCooldown = 30 * time.Minute

func capStatedCooldown(d time.Duration) time.Duration {
	if d > maxStatedCooldown {
		return maxStatedCooldown
	}
	if d <= 0 {
		return defaultKeyCooldown
	}
	return d
}

func capKeyCooldown(d time.Duration) time.Duration {
	if d > maxKeyCooldown {
		return maxKeyCooldown
	}
	if d <= 0 {
		return defaultKeyCooldown
	}
	return d
}

// parseGoDurationHeader reads Groq's "2m59.56s" / "7.66s" reset values.
func parseGoDurationHeader(raw string) (time.Duration, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, false
	}
	if d, err := time.ParseDuration(value); err == nil && d > 0 {
		return d, true
	}
	// Some responses report a bare number of seconds.
	if seconds, err := strconv.ParseFloat(value, 64); err == nil && seconds > 0 {
		return time.Duration(seconds * float64(time.Second)), true
	}
	return 0, false
}

// classifyProviderResponse turns a provider HTTP status into the error the
// rotation loops branch on. A nil result means the response is usable.
func classifyProviderResponse(provider, operation, model string, resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	switch resp.StatusCode {
	case http.StatusTooManyRequests:
		return &rateLimitedError{Provider: provider, RetryAfter: retryAfterFromHeaders(resp.Header)}
	case http.StatusNotFound:
		// The endpoint is fixed and correct, so a 404 here means the model name
		// was not recognised — every key will answer the same way.
		return newModelUnavailableError(provider, model)
	case http.StatusUnauthorized, http.StatusForbidden:
		return &keyRejectedError{Provider: provider, Status: resp.StatusCode}
	}
	return newAIProviderHTTPError(provider, operation, resp.StatusCode)
}

// providerAttempt is one usable key handed to a rotation loop.
type providerAttempt struct {
	Key      string
	Index    int // 0-based position in the configured key list
	Position int // 1-based, for log lines
	Total    int
}

// Label names the key in a log line without printing any of it.
//
// The logs used to say only "key 3/3 failed", which means counting lines in .env
// to find the broken one — and points at the wrong one the moment anybody
// reorders the list.
//
// The obvious fix was to show the first and last few characters, the way a
// provider console does. TestProviderFailureErrorsAndLogsExcludeResponseBody-
// AndCredentialMaterial rejected it, and the test is right: it forbids the first
// or last eight characters of a key anywhere in a log line, because logs get
// pasted into issues and screenshots. Weakening that test to make debugging
// prettier would trade a real protection for a convenience.
//
// So the label is a hash instead. It carries none of the key, stays the same for
// the same key across restarts, and that is what makes a log readable: "fp
// 9f3ac1 failed again" is a key you can follow through a file. Which key that is
// comes from the position, which is the order in .env.
func (a providerAttempt) Label() string {
	key := strings.TrimSpace(a.Key)
	if key == "" {
		return fmt.Sprintf("%d/%d", a.Position, a.Total)
	}
	sum := sha256.Sum256([]byte(key))
	return fmt.Sprintf("%d/%d fp %s", a.Position, a.Total, hex.EncodeToString(sum[:3]))
}

// nextProviderAttempts returns the keys worth trying right now, in rotation
// order, skipping any that are parked. An empty result means every key is rate
// limited; `releaseAt` then says when the first one frees up.
func nextProviderAttempts(
	health *providerKeyHealth,
	provider string,
	keys []string,
	cursor *uint32,
) (attempts []providerAttempt, releaseAt time.Time) {
	total := len(keys)
	if total == 0 {
		return nil, time.Time{}
	}
	start := atomic.AddUint32(cursor, 1) - 1
	scan := func() []providerAttempt {
		found := make([]providerAttempt, 0, total)
		for offset := 0; offset < total; offset++ {
			index := int((start + uint32(offset)) % uint32(total))
			if ok, _ := health.available(provider, index); !ok {
				continue
			}
			found = append(found, providerAttempt{
				Key:      keys[index],
				Index:    index,
				Position: index + 1,
				Total:    total,
			})
		}
		return found
	}

	if attempts = scan(); len(attempts) > 0 {
		return attempts, time.Time{}
	}

	// Every key is parked. When the first one comes back within a moment, hold
	// for it rather than failing: a question that already takes several seconds
	// to answer can afford one more, and the owner reading "เชื่อมต่อผู้ช่วยไม่ได้"
	// over a key that was a second from free is a worse outcome than the wait.
	// The cap is what keeps this from turning a quota outage into a hang.
	releaseAt = health.earliestRelease(provider, total)
	if wait := time.Until(releaseAt); wait > 0 && wait <= maxRateLimitHold {
		aiStage("flow", "%s: every key is parked, holding %s for the first one", provider, wait.Round(time.Millisecond))
		time.Sleep(wait)
		if attempts = scan(); len(attempts) > 0 {
			return attempts, time.Time{}
		}
		releaseAt = health.earliestRelease(provider, total)
	}
	return nil, releaseAt
}

// maxRateLimitHold bounds that wait. Long enough to cover the sub-second gaps
// that come from several questions landing at once, short enough that a real
// daily quota still fails fast instead of holding the request open.
const maxRateLimitHold = 2 * time.Second

// allKeysRateLimitedError explains the wait instead of a bare quota error. It
// wraps BOTH sentinels on purpose: the provider layer contract is errRateLimit
// (callers rotate or fall back on it), while the API layer answers 429 on
// ErrAIQuotaExceeded. Matching both keeps either check working.
func allKeysRateLimitedError(provider string, keyCount int, releaseAt time.Time) error {
	if releaseAt.IsZero() {
		aiStage("warn", "%s: all %d keys are rate limited", provider, keyCount)
		return fmt.Errorf("%w: all %d %s keys are rate limited (%w)", errRateLimit, keyCount, provider, ErrAIQuotaExceeded)
	}
	wait := time.Until(releaseAt).Round(time.Second)
	if wait < 0 {
		wait = 0
	}
	aiStage("warn", "%s: all %d keys are rate limited — first one frees up in %s", provider, keyCount, wait)
	return fmt.Errorf("%w: all %d %s keys are rate limited, retry in %s (%w)", errRateLimit, keyCount, provider, wait, ErrAIQuotaExceeded)
}
