package routes

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestRateLimitRequestsUsesClientMethodAndRouteTemplate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	_ = router.SetTrustedProxies(nil)
	router.GET(
		"/public/:token",
		rateLimitRequests(1, time.Minute),
		func(c *gin.Context) { c.Status(http.StatusNoContent) },
	)
	router.POST(
		"/public/:token",
		rateLimitRequests(1, time.Minute),
		func(c *gin.Context) { c.Status(http.StatusNoContent) },
	)

	send := func(method, path, remoteAddr string) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, path, nil)
		request.RemoteAddr = remoteAddr
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	if got := send(http.MethodGet, "/public/first-secret", "192.0.2.10:41000").Code; got != http.StatusNoContent {
		t.Fatalf("first GET status = %d, want 204", got)
	}
	limited := send(http.MethodGet, "/public/another-secret", "192.0.2.10:41001")
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("same IP and route-template GET status = %d, want 429", limited.Code)
	}
	if limited.Header().Get("Retry-After") == "" {
		t.Fatal("limited response has no Retry-After header")
	}
	if got := send(http.MethodPost, "/public/first-secret", "192.0.2.10:41002").Code; got != http.StatusNoContent {
		t.Fatalf("POST should have an independent method bucket, status = %d", got)
	}
	if got := send(http.MethodGet, "/public/first-secret", "192.0.2.11:41003").Code; got != http.StatusNoContent {
		t.Fatalf("different client IP should have an independent bucket, status = %d", got)
	}
}

func TestRateLimitRequestsMakesRoomForNewClientsWhenTheBucketMapIsFull(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	_ = router.SetTrustedProxies(nil)
	router.GET(
		"/public",
		rateLimitRequests(1, time.Minute),
		func(c *gin.Context) { c.Status(http.StatusNoContent) },
	)

	resetRateState := func() {
		requestRateState.Lock()
		requestRateState.buckets = map[string]requestRateBucket{}
		requestRateState.lastSweep = time.Time{}
		requestRateState.Unlock()
	}
	resetRateState()
	t.Cleanup(resetRateState)

	now := time.Now()
	// Fill the map with clients under their limit and mark the sweep as just
	// done, so the once-per-window sweep cannot be what makes room.
	fill := func(resetAfter time.Time) {
		requestRateState.Lock()
		requestRateState.buckets = make(map[string]requestRateBucket, maxRequestRateBuckets)
		for i := range maxRequestRateBuckets {
			requestRateState.buckets["filler-"+strconv.Itoa(i)] = requestRateBucket{count: 1, resetAfter: resetAfter, limit: 5}
		}
		requestRateState.lastSweep = now
		requestRateState.Unlock()
	}
	send := func(remoteAddr string) int {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/public", nil)
		request.RemoteAddr = remoteAddr
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response.Code
	}
	bucketCount := func() int {
		requestRateState.Lock()
		defer requestRateState.Unlock()
		return len(requestRateState.buckets)
	}
	hasBucket := func(key string) bool {
		requestRateState.Lock()
		defer requestRateState.Unlock()
		_, ok := requestRateState.buckets[key]
		return ok
	}

	// Every bucket has expired: a new client is admitted and the dead weight
	// goes, throttle or not.
	fill(now.Add(-time.Second))
	if got := send("192.0.2.20:41000"); got != http.StatusNoContent {
		t.Fatalf("new client against a full map of expired buckets: status = %d, want 204", got)
	}
	if got := bucketCount(); got != 1 {
		t.Fatalf("buckets after the forced sweep = %d, want 1", got)
	}

	// Nothing has expired: a batch of clients under their limit gives way, the
	// soonest to reset among them - and never a client that is over its limit,
	// however soon it resets, so churning new keys cannot forgive it.
	fill(now.Add(time.Hour))
	requestRateState.Lock()
	requestRateState.buckets["filler-42"] = requestRateBucket{count: 1, resetAfter: now.Add(time.Minute), limit: 5}
	delete(requestRateState.buckets, "filler-43") // keeps the map at exactly the cap
	requestRateState.buckets["throttled"] = requestRateBucket{count: 12, resetAfter: now.Add(time.Second), limit: 10}
	requestRateState.Unlock()
	if got := send("192.0.2.21:41000"); got != http.StatusNoContent {
		t.Fatalf("new client against a full map of live buckets: status = %d, want 204", got)
	}
	if hasBucket("filler-42") {
		t.Fatal("the counted bucket resetting soonest should have been evicted")
	}
	if !hasBucket("throttled") {
		t.Fatal("a throttled client was evicted, and with it its throttle")
	}
	if !hasBucket("192.0.2.21|GET|/public") {
		t.Fatal("the new client's bucket was not admitted")
	}
	if got, want := bucketCount(), maxRequestRateBuckets-rateBucketEvictBatch+1; got != want {
		t.Fatalf("buckets after eviction = %d, want %d", got, want)
	}

	// The batch leaves room: the next new clients are admitted without another
	// eviction, so a flood pays for the scan once per batch, not per request.
	for i := range rateBucketEvictBatch - 1 {
		if got := send("198.51.100." + strconv.Itoa(i%250+1) + ":" + strconv.Itoa(42000+i)); got != http.StatusNoContent {
			t.Fatalf("new client %d after one batch: status = %d, want 204", i, got)
		}
	}
	if got := bucketCount(); got != maxRequestRateBuckets {
		t.Fatalf("buckets after filling the batch's room = %d, want %d (no second eviction)", got, maxRequestRateBuckets)
	}

	// A map full of clients over their limit is an attack in progress: the
	// newcomer is turned away and nobody's throttle is lifted.
	requestRateState.Lock()
	requestRateState.buckets = make(map[string]requestRateBucket, maxRequestRateBuckets)
	for i := range maxRequestRateBuckets {
		requestRateState.buckets["attacker-"+strconv.Itoa(i)] = requestRateBucket{count: 11, resetAfter: now.Add(time.Hour), limit: 10}
	}
	requestRateState.lastSweep = now
	requestRateState.Unlock()
	if got := send("192.0.2.22:41000"); got != http.StatusTooManyRequests {
		t.Fatalf("new client against a map of throttled buckets: status = %d, want 429", got)
	}
	if got := bucketCount(); got != maxRequestRateBuckets || hasBucket("192.0.2.22|GET|/public") {
		t.Fatalf("buckets = %d with the newcomer admitted = %v; want the throttled map untouched", got, hasBucket("192.0.2.22|GET|/public"))
	}
}

// One host on IPv6 holds a whole /64. Keyed by the full address, it could mint
// a fresh key - and a fresh limit - for every request.
func TestRateLimitRequestsKeysIPv6ClientsByTheirSlash64(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	_ = router.SetTrustedProxies(nil)
	router.GET("/ipv6", rateLimitRequests(1, time.Minute), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	send := func(remoteAddr string) int {
		t.Helper()
		request := httptest.NewRequest(http.MethodGet, "/ipv6", nil)
		request.RemoteAddr = remoteAddr
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response.Code
	}

	if got := send("[2001:db8:1:2::1]:41000"); got != http.StatusNoContent {
		t.Fatalf("first address in the /64: status = %d, want 204", got)
	}
	if got := send("[2001:db8:1:2::ffff]:41001"); got != http.StatusTooManyRequests {
		t.Fatalf("another address in the same /64: status = %d, want 429", got)
	}
	if got := send("[2001:db8:1:3::1]:41002"); got != http.StatusNoContent {
		t.Fatalf("an address in the next /64: status = %d, want 204", got)
	}
	if got := rateLimitClientKey("192.0.2.30"); got != "192.0.2.30" {
		t.Fatalf("IPv4 key = %q, want the address as it is", got)
	}
	if got := rateLimitClientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"); got != "2001:db8:1:2::/64" {
		t.Fatalf("IPv6 key = %q, want the /64", got)
	}
}
