package routes

import (
	"net"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type requestRateBucket struct {
	count      int
	resetAfter time.Time
	// limit is the route's own limit, kept so a full map can tell a client it
	// is throttling from one it is only counting.
	limit int
}

// throttled: the client has gone past its route's limit in this window.
func (bucket requestRateBucket) throttled() bool {
	return bucket.count > bucket.limit
}

var requestRateState = struct {
	sync.Mutex
	buckets   map[string]requestRateBucket
	lastSweep time.Time
}{
	buckets: map[string]requestRateBucket{},
}

const maxRequestRateBuckets = 10000

// rateBucketEvictBatch is how many buckets a full map gives up at once when
// nothing in it has expired: 1% of the map, so the scan that finds them is
// paid once per that many new clients.
const rateBucketEvictBatch = maxRequestRateBuckets / 100

// rateLimitRequests limits one HTTP method and route template per trusted
// client IP. main.trustedCloudflareClientIP normalizes c.ClientIP() only when
// the immediate peer is the local reverse proxy, so callers cannot spoof the
// bucket key with forwarding headers sent directly to the backend.
func rateLimitRequests(limit int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		if limit <= 0 || window <= 0 {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "rate limit unavailable"})
			return
		}

		now := time.Now()
		route := c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		key := rateLimitClientKey(c.ClientIP()) + "|" + c.Request.Method + "|" + route

		requestRateState.Lock()
		if requestRateState.lastSweep.IsZero() || now.Sub(requestRateState.lastSweep) >= window {
			sweepExpiredRateBuckets(now)
		}

		bucket, exists := requestRateState.buckets[key]
		if !exists && len(requestRateState.buckets) >= maxRequestRateBuckets {
			// A full map must not turn every new client away for a whole
			// window. Drop what has expired now, throttle or not, and failing
			// that a batch of clients that are only being counted - a batch, so
			// a flood that keeps the map full pays for these scans once per
			// rateBucketEvictBatch new keys, not on every request. A throttled
			// client is never evicted: churning new keys must not forgive it.
			sweepExpiredRateBuckets(now)
			if len(requestRateState.buckets) >= maxRequestRateBuckets &&
				evictUnthrottledRateBuckets(rateBucketEvictBatch) == 0 {
				// Every bucket is a client over its limit: an attack in
				// progress. Fail closed for the newcomer rather than let
				// anyone off.
				requestRateState.Unlock()
				c.Header("Retry-After", strconv.FormatInt(max(1, int64(window/time.Second)), 10))
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
				return
			}
		}
		if !exists || !now.Before(bucket.resetAfter) {
			bucket = requestRateBucket{resetAfter: now.Add(window)}
		}
		bucket.count++
		bucket.limit = limit
		requestRateState.buckets[key] = bucket
		requestRateState.Unlock()

		if bucket.count > limit {
			retryAfter := time.Until(bucket.resetAfter)
			c.Header("Retry-After", strconv.FormatInt(max(1, int64(retryAfter/time.Second)), 10))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "too many requests"})
			return
		}

		c.Next()
	}
}

// rateLimitClientKey is the client part of a bucket key. An IPv6 client is
// keyed by its /64, the block one host or one customer line is handed:
// otherwise a single machine could mint unlimited fresh keys, each with its
// own untouched limit.
func rateLimitClientKey(clientIP string) string {
	ip := net.ParseIP(clientIP)
	if ip == nil || ip.To4() != nil {
		return clientIP
	}
	return ip.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// sweepExpiredRateBuckets drops every bucket whose window has passed. The
// caller holds requestRateState.
func sweepExpiredRateBuckets(now time.Time) {
	for bucketKey, bucket := range requestRateState.buckets {
		if !now.Before(bucket.resetAfter) {
			delete(requestRateState.buckets, bucketKey)
		}
	}
	requestRateState.lastSweep = now
}

// evictUnthrottledRateBuckets makes room by dropping up to count buckets of
// clients still under their limit, fewest requests first and then the
// soonest to reset: those clients lose nothing but a count they were nowhere
// near spending. It returns how many went. The caller holds requestRateState.
func evictUnthrottledRateBuckets(count int) int {
	if count <= 0 {
		return 0
	}
	type entry struct {
		key        string
		count      int
		resetAfter time.Time
	}
	candidates := make([]entry, 0, len(requestRateState.buckets))
	for bucketKey, bucket := range requestRateState.buckets {
		if !bucket.throttled() {
			candidates = append(candidates, entry{key: bucketKey, count: bucket.count, resetAfter: bucket.resetAfter})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].count != candidates[j].count {
			return candidates[i].count < candidates[j].count
		}
		return candidates[i].resetAfter.Before(candidates[j].resetAfter)
	})
	evicted := min(count, len(candidates))
	for _, victim := range candidates[:evicted] {
		delete(requestRateState.buckets, victim.key)
	}
	return evicted
}
