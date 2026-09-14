package service

import (
	"errors"
	"fmt"

	"Project-M/internal/restaurantslug"
)

var (
	ErrRestaurantSlugInvalid = errors.New("restaurant slug must be 3-40 lowercase letters, numbers or hyphens and include a letter")
	ErrRestaurantSlugTaken   = errors.New("restaurant slug is already taken")
)

// How many random suffixes to try before giving up on a generated slug. Six
// base-36 characters make a collision on the first try vanishingly rare; the
// loop only exists so a collision is a retry rather than a failed signup.
const restaurantSlugGenerateAttempts = 5

// restaurantSlugLookup reports whether a live restaurant other than excludeID
// already holds slug. The repository's SlugTaken in production.
type restaurantSlugLookup func(slug string, excludeID uint) (bool, error)

// RestaurantSlugAvailability is the answer to "can this restaurant use this
// URL name". Reason is "invalid" or "taken" when it cannot.
type RestaurantSlugAvailability struct {
	Slug      string `json:"slug"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// resolveRequestedSlug normalises a slug the owner typed and checks it is both
// well-formed and free. excludeID is the restaurant being edited, so keeping
// its own slug is never a conflict.
func resolveRequestedSlug(raw string, excludeID uint, taken restaurantSlugLookup) (string, error) {
	slug := restaurantslug.Normalize(raw)
	if !restaurantslug.Valid(slug) {
		return "", ErrRestaurantSlugInvalid
	}
	inUse, err := taken(slug, excludeID)
	if err != nil {
		return "", fmt.Errorf("check restaurant slug: %w", err)
	}
	if inUse {
		return "", ErrRestaurantSlugTaken
	}
	return slug, nil
}

// generateRestaurantSlug picks a free slug for a new restaurant whose owner did
// not choose one: the Latin part of its name when that is free, otherwise the
// same base with a random suffix, falling back to restaurantslug.FallbackBase
// when the name has nothing Latin to build from.
func generateRestaurantSlug(name string, taken restaurantSlugLookup) (string, error) {
	base := restaurantslug.FromName(name)
	if base != "" {
		inUse, err := taken(base, 0)
		if err != nil {
			return "", fmt.Errorf("check restaurant slug: %w", err)
		}
		if !inUse {
			return base, nil
		}
	} else {
		base = restaurantslug.FallbackBase
	}
	for attempt := 0; attempt < restaurantSlugGenerateAttempts; attempt++ {
		candidate := restaurantslug.WithSuffix(base, restaurantslug.RandomSuffix())
		inUse, err := taken(candidate, 0)
		if err != nil {
			return "", fmt.Errorf("check restaurant slug: %w", err)
		}
		if !inUse {
			return candidate, nil
		}
	}
	return "", errors.New("could not find a free restaurant slug")
}

// restaurantslugChanged reports whether raw names a different slug than the
// stored one, so an unchanged slug on an update costs no lookup.
func restaurantslugChanged(stored, raw string) bool {
	return restaurantslug.Normalize(raw) != stored
}

func checkRestaurantSlugAvailability(raw string, excludeID uint, taken restaurantSlugLookup) (RestaurantSlugAvailability, error) {
	slug := restaurantslug.Normalize(raw)
	_, err := resolveRequestedSlug(raw, excludeID, taken)
	switch {
	case err == nil:
		return RestaurantSlugAvailability{Slug: slug, Available: true}, nil
	case errors.Is(err, ErrRestaurantSlugInvalid):
		return RestaurantSlugAvailability{Slug: slug, Reason: "invalid"}, nil
	case errors.Is(err, ErrRestaurantSlugTaken):
		return RestaurantSlugAvailability{Slug: slug, Reason: "taken"}, nil
	default:
		return RestaurantSlugAvailability{}, err
	}
}

// CheckSlugAvailability answers the settings and onboarding forms while the
// owner types. Advisory only: create and update check again, and the unique
// index is the final word.
func (s *RestaurantService) CheckSlugAvailability(raw string, excludeID uint) (RestaurantSlugAvailability, error) {
	return checkRestaurantSlugAvailability(raw, excludeID, s.restaurantRepo.SlugTaken)
}
