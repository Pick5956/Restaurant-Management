package service

import (
	"errors"
	"strings"
	"testing"

	"Project-M/internal/restaurantslug"
)

// takenSet fakes the repository lookup: a slug is taken when it is in the set
// and does not belong to the restaurant being excluded.
func takenSet(owners map[string]uint) restaurantSlugLookup {
	return func(slug string, excludeID uint) (bool, error) {
		owner, ok := owners[slug]
		return ok && owner != excludeID, nil
	}
}

func TestResolveRequestedSlugNormalisesAndChecks(t *testing.T) {
	lookup := takenSet(map[string]uint{"krua-pick": 7})

	slug, err := resolveRequestedSlug("  Noodle-Bar ", 0, lookup)
	if err != nil || slug != "noodle-bar" {
		t.Fatalf("resolveRequestedSlug = %q, %v; want noodle-bar, nil", slug, err)
	}

	if _, err := resolveRequestedSlug("krua-pick", 0, lookup); !errors.Is(err, ErrRestaurantSlugTaken) {
		t.Fatalf("taken slug error = %v, want ErrRestaurantSlugTaken", err)
	}
	// A restaurant keeping its own slug is not a conflict.
	if slug, err := resolveRequestedSlug("krua-pick", 7, lookup); err != nil || slug != "krua-pick" {
		t.Fatalf("own slug = %q, %v; want krua-pick, nil", slug, err)
	}

	for _, raw := range []string{"", "ab", "krua pick", "ครัวปิ๊ก", "1234", "-krua"} {
		if _, err := resolveRequestedSlug(raw, 0, lookup); !errors.Is(err, ErrRestaurantSlugInvalid) {
			t.Errorf("resolveRequestedSlug(%q) error = %v, want ErrRestaurantSlugInvalid", raw, err)
		}
	}
}

func TestResolveRequestedSlugSurfacesLookupFailure(t *testing.T) {
	failing := func(string, uint) (bool, error) { return false, errors.New("db down") }
	if _, err := resolveRequestedSlug("noodle-bar", 0, failing); err == nil || errors.Is(err, ErrRestaurantSlugTaken) {
		t.Fatalf("lookup failure error = %v, want the lookup error", err)
	}
}

func TestGenerateRestaurantSlugPrefersTheName(t *testing.T) {
	slug, err := generateRestaurantSlug("Krua Pick", takenSet(nil))
	if err != nil || slug != "krua-pick" {
		t.Fatalf("generateRestaurantSlug = %q, %v; want krua-pick", slug, err)
	}
}

func TestGenerateRestaurantSlugSuffixesATakenName(t *testing.T) {
	slug, err := generateRestaurantSlug("Krua Pick", takenSet(map[string]uint{"krua-pick": 1}))
	if err != nil {
		t.Fatalf("generateRestaurantSlug error = %v", err)
	}
	if !strings.HasPrefix(slug, "krua-pick-") || !restaurantslug.Valid(slug) {
		t.Fatalf("generateRestaurantSlug = %q, want a valid krua-pick-<suffix>", slug)
	}
}

func TestGenerateRestaurantSlugFallsBackForANameWithoutLatinLetters(t *testing.T) {
	slug, err := generateRestaurantSlug("ครัวปิ๊ก", takenSet(nil))
	if err != nil || !strings.HasPrefix(slug, restaurantslug.FallbackBase+"-") || !restaurantslug.Valid(slug) {
		t.Fatalf("generateRestaurantSlug = %q, %v; want a valid %s-<suffix>", slug, err, restaurantslug.FallbackBase)
	}
}

func TestGenerateRestaurantSlugGivesUpWhenEverythingIsTaken(t *testing.T) {
	alwaysTaken := func(string, uint) (bool, error) { return true, nil }
	if _, err := generateRestaurantSlug("Krua Pick", alwaysTaken); err == nil {
		t.Fatal("generateRestaurantSlug error = nil, want an error once every attempt is taken")
	}
}

func TestSlugAvailabilityReportsTheReason(t *testing.T) {
	lookup := takenSet(map[string]uint{"krua-pick": 7})
	cases := []struct {
		raw       string
		excludeID uint
		want      RestaurantSlugAvailability
	}{
		{"Noodle-Bar", 0, RestaurantSlugAvailability{Slug: "noodle-bar", Available: true}},
		{"krua-pick", 0, RestaurantSlugAvailability{Slug: "krua-pick", Reason: "taken"}},
		{"krua-pick", 7, RestaurantSlugAvailability{Slug: "krua-pick", Available: true}},
		{"krua pick", 0, RestaurantSlugAvailability{Slug: "krua pick", Reason: "invalid"}},
	}
	for _, tc := range cases {
		got, err := checkRestaurantSlugAvailability(tc.raw, tc.excludeID, lookup)
		if err != nil || got != tc.want {
			t.Errorf("checkRestaurantSlugAvailability(%q, %d) = %+v, %v; want %+v", tc.raw, tc.excludeID, got, err, tc.want)
		}
	}
}
