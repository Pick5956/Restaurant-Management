// Package restaurantslug owns the shape of a restaurant's URL name - the
// `kruapick` in dishy.pro/r/kruapick/home.
//
// It is a leaf package on purpose: the entity hook, the service and the
// migration backfill all need the same rules, and the migration lives in
// config, which cannot import service.
package restaurantslug

import (
	"crypto/rand"
	"math/big"
	"regexp"
	"strings"
)

const (
	MinLength = 3
	MaxLength = 40
	// FallbackBase is what a restaurant gets when its name has no Latin
	// letters to build from - a Thai name, typically - before the owner picks
	// a better one in settings.
	FallbackBase = "restaurant"

	// A name-derived base stops here so a uniqueness suffix still fits.
	baseMaxLength  = 32
	randomAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	randomLength   = 6
)

var (
	shapePattern     = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	letterPattern    = regexp.MustCompile(`[a-z]`)
	nonSlugRunes     = regexp.MustCompile(`[^a-z0-9]+`)
	randomUpperBound = big.NewInt(int64(len(randomAlphabet)))
)

// Normalize trims and lowercases, and nothing else. It never repairs a slug:
// "krua pick" stays invalid, so the owner is told instead of getting a URL
// they did not type.
func Normalize(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

// Valid reports whether slug can be stored: lowercase ASCII letters, digits
// and single inner hyphens, 3 to 40 long, with at least one letter. The letter
// rule keeps /r/<numeric id> unambiguous - no slug can ever look like an id.
func Valid(slug string) bool {
	if len(slug) < MinLength || len(slug) > MaxLength {
		return false
	}
	return shapePattern.MatchString(slug) && letterPattern.MatchString(slug)
}

// FromName builds a slug out of the Latin letters and digits in a restaurant
// name, or returns "" when there is not enough to build from.
func FromName(name string) string {
	slug := strings.Trim(nonSlugRunes.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(slug) > baseMaxLength {
		slug = slug[:baseMaxLength]
		if cut := strings.LastIndex(slug, "-"); cut >= MinLength {
			slug = slug[:cut]
		}
		slug = strings.Trim(slug, "-")
	}
	if !Valid(slug) {
		return ""
	}
	return slug
}

// WithSuffix appends "-suffix", shortening base first so the result still
// fits MaxLength.
func WithSuffix(base, suffix string) string {
	room := MaxLength - len(suffix) - 1
	if len(base) > room {
		base = strings.TrimRight(base[:room], "-")
	}
	return base + "-" + suffix
}

// Random is a valid, practically unique slug for a restaurant that has none
// yet: "restaurant-" plus six random characters. Random rather than the row
// id, so the URL does not advertise how many restaurants exist.
func Random() string {
	return WithSuffix(FallbackBase, RandomSuffix())
}

// RandomSuffix is six lowercase letters or digits from crypto/rand.
func RandomSuffix() string {
	var builder strings.Builder
	builder.Grow(randomLength)
	for index := 0; index < randomLength; index++ {
		n, err := rand.Int(rand.Reader, randomUpperBound)
		if err != nil {
			// crypto/rand does not fail on supported platforms; if it ever
			// does, a fixed character still yields a valid slug and the
			// unique index turns a collision into a clean conflict.
			builder.WriteByte(randomAlphabet[index])
			continue
		}
		builder.WriteByte(randomAlphabet[n.Int64()])
	}
	return builder.String()
}
