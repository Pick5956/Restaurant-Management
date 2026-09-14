package restaurantslug

import (
	"strings"
	"testing"
)

func TestValidAcceptsOnlyTheURLShape(t *testing.T) {
	valid := []string{"abc", "krua-pick", "shop-24", "a1b", strings.Repeat("a", MaxLength)}
	for _, slug := range valid {
		if !Valid(slug) {
			t.Errorf("Valid(%q) = false, want true", slug)
		}
	}

	invalid := []string{
		"",
		"ab",                             // too short
		strings.Repeat("a", MaxLength+1), // too long
		"Krua",                           // upper case is normalised before validation, never stored
		"krua pick",
		"krua_pick",
		"-krua",
		"krua-",
		"krua--pick",
		"ครัวปิ๊ก",
		"1234",  // all digits: /r/<numeric id> stays unambiguous
		"12-34", // still no letter
		"krua.pick",
	}
	for _, slug := range invalid {
		if Valid(slug) {
			t.Errorf("Valid(%q) = true, want false", slug)
		}
	}
}

func TestNormalizeOnlyTrimsAndLowercases(t *testing.T) {
	if got := Normalize("  Krua-Pick \n"); got != "krua-pick" {
		t.Fatalf("Normalize = %q, want krua-pick", got)
	}
	// Normalising must not quietly repair a slug the owner typed: "krua pick"
	// stays invalid so the form says so instead of saving something else.
	if got := Normalize("krua pick"); Valid(got) {
		t.Fatalf("Normalize(%q) = %q became valid", "krua pick", got)
	}
}

func TestFromNameKeepsLatinWordsAndDropsTheRest(t *testing.T) {
	cases := map[string]string{
		"Krua Pick":              "krua-pick",
		"  Noodle & Co. (Siam) ": "noodle-co-siam",
		"ครัวปิ๊ก Kitchen 2":     "kitchen-2",
		"Café Bangkok":           "caf-bangkok",
		"ครัวปิ๊ก":               "",
		"24":                     "", // no letter
		"ab":                     "", // too short
	}
	for name, want := range cases {
		if got := FromName(name); got != want {
			t.Errorf("FromName(%q) = %q, want %q", name, got, want)
		}
		if got := FromName(name); got != "" && !Valid(got) {
			t.Errorf("FromName(%q) = %q is not a valid slug", name, got)
		}
	}
}

func TestFromNameCutsLongNamesAtAWordBoundary(t *testing.T) {
	got := FromName("The Very Long Restaurant Name That Keeps Going And Going Forever")
	if len(got) > baseMaxLength {
		t.Fatalf("FromName length = %d, want <= %d (%q)", len(got), baseMaxLength, got)
	}
	if strings.HasSuffix(got, "-") || !Valid(got) {
		t.Fatalf("FromName = %q, want a valid slug without a trailing hyphen", got)
	}
}

func TestWithSuffixAlwaysFitsAndStaysValid(t *testing.T) {
	long := strings.Repeat("a", MaxLength)
	got := WithSuffix(long, "x7k2m9")
	if len(got) > MaxLength || !strings.HasSuffix(got, "-x7k2m9") || !Valid(got) {
		t.Fatalf("WithSuffix = %q (len %d), want <= %d ending -x7k2m9", got, len(got), MaxLength)
	}
	if got := WithSuffix("krua-pick", "2"); got != "krua-pick-2" {
		t.Fatalf("WithSuffix = %q, want krua-pick-2", got)
	}
	// A cut that lands on a hyphen must not leave a double hyphen behind.
	base := strings.Repeat("a", MaxLength-8) + "-bbbbbbb"
	if got := WithSuffix(base, "cccccc"); !Valid(got) {
		t.Fatalf("WithSuffix = %q is not valid", got)
	}
}

func TestRandomIsAValidSlugEveryTime(t *testing.T) {
	seen := map[string]bool{}
	for index := 0; index < 200; index++ {
		slug := Random()
		if !Valid(slug) || !strings.HasPrefix(slug, FallbackBase+"-") {
			t.Fatalf("Random() = %q, want a valid %s-<suffix> slug", slug, FallbackBase)
		}
		seen[slug] = true
	}
	if len(seen) < 190 {
		t.Fatalf("Random() repeated too often: %d distinct of 200", len(seen))
	}
}
