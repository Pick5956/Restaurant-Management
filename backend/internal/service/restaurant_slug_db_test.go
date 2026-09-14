package service

import (
	"errors"
	"strings"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
	"Project-M/internal/restaurantslug"
)

// TestRestaurantSlugsAgainstPostgres runs the slug rules through GORM and real
// SQL: the create hook, the name-derived slug, the collision suffix, the
// update and availability checks, and a soft-deleted restaurant giving its
// name back. The unit tests fake the lookup; this is the one place the query
// itself - soft-delete scope and self-exclusion included - is exercised.
//
// Run with ORDER_DB_INTEGRATION_ENABLED=1. It works in a throwaway schema, so
// nothing is left in the database. All names below are invented fixtures.
func TestRestaurantSlugsAgainstPostgres(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)

	owner := entity.User{
		Email:        "slug-owner@example.invalid",
		AuthProvider: "local",
		FirstName:    "Slug",
		LastName:     "Tester",
		Status:       "active",
	}
	mustCreateOrderVoidRow(t, db, &owner)
	mustCreateOrderVoidRow(t, db, &entity.Role{Name: DefaultOwnerRoleName, DisplayName: "Owner", IsSystem: true, Permissions: "[]"})

	svc := ProvideRestaurantService(
		repository.NewRestaurantRepository(db),
		repository.NewRestaurantMemberRepository(db),
		repository.NewRoleRepository(db),
		repository.NewRestaurantAuditLogRepository(db),
		repository.NewRestaurantSetupRepository(db),
	)
	create := func(name, slug string) (*entity.Restaurant, error) {
		restaurant, _, err := svc.CreateRestaurant(owner.ID, &CreateRestaurantRequest{
			Name:           name,
			Slug:           slug,
			BranchName:     "Main",
			RestaurantType: "restaurant",
			TableCount:     1,
		})
		return restaurant, err
	}

	// A writer that is not the service still gets a valid slug.
	raw := entity.Restaurant{Name: "ร้านทดสอบลิงก์", OwnerID: owner.ID}
	mustCreateOrderVoidRow(t, db, &raw)
	if !restaurantslug.Valid(raw.Slug) || !strings.HasPrefix(raw.Slug, restaurantslug.FallbackBase+"-") {
		t.Fatalf("hook slug = %q, want a valid %s-<suffix>", raw.Slug, restaurantslug.FallbackBase)
	}

	first, err := create("Slug Test Kitchen", "")
	if err != nil {
		t.Fatalf("create first: %v", err)
	}
	if first.Slug != "slug-test-kitchen" {
		t.Fatalf("first slug = %q, want slug-test-kitchen", first.Slug)
	}

	second, err := create("Slug Test Kitchen", "")
	if err != nil {
		t.Fatalf("create second: %v", err)
	}
	if !strings.HasPrefix(second.Slug, "slug-test-kitchen-") || !restaurantslug.Valid(second.Slug) {
		t.Fatalf("second slug = %q, want slug-test-kitchen-<suffix>", second.Slug)
	}

	if _, err := create("Another Kitchen", "slug-test-kitchen"); !errors.Is(err, ErrRestaurantSlugTaken) {
		t.Fatalf("create with a taken slug error = %v, want ErrRestaurantSlugTaken", err)
	}
	chosen, err := create("Another Kitchen", "  Chosen-Name ")
	if err != nil || chosen.Slug != "chosen-name" {
		t.Fatalf("create with a chosen slug = %v, %v; want chosen-name", chosen, err)
	}

	update := func(restaurant *entity.Restaurant, slug *string) (*entity.Restaurant, error) {
		return svc.UpdateRestaurant(restaurant.ID, &UpdateRestaurantRequest{
			Name:           restaurant.Name,
			Slug:           slug,
			BranchName:     restaurant.BranchName,
			RestaurantType: restaurant.RestaurantType,
			TableCount:     restaurant.TableCount,
		})
	}
	taken := first.Slug
	if _, err := update(second, &taken); !errors.Is(err, ErrRestaurantSlugTaken) {
		t.Fatalf("update to a taken slug error = %v, want ErrRestaurantSlugTaken", err)
	}
	if kept, err := update(first, nil); err != nil || kept.Slug != first.Slug {
		t.Fatalf("update without slug = %v, %v; want the slug kept", kept, err)
	}
	own := first.Slug
	if same, err := update(first, &own); err != nil || same.Slug != first.Slug {
		t.Fatalf("update to its own slug = %v, %v; want no conflict", same, err)
	}
	renamed := "renamed-kitchen"
	moved, err := update(second, &renamed)
	if err != nil || moved.Slug != renamed {
		t.Fatalf("rename = %v, %v; want renamed-kitchen", moved, err)
	}

	if got, err := svc.CheckSlugAvailability(first.Slug, first.ID); err != nil || !got.Available {
		t.Fatalf("own slug availability = %+v, %v; want available", got, err)
	}
	if got, err := svc.CheckSlugAvailability(first.Slug, 0); err != nil || got.Available || got.Reason != "taken" {
		t.Fatalf("someone else's slug availability = %+v, %v; want taken", got, err)
	}

	if err := repository.NewRestaurantRepository(db).Delete(first.ID); err != nil {
		t.Fatalf("soft delete first: %v", err)
	}
	if got, err := svc.CheckSlugAvailability(first.Slug, 0); err != nil || !got.Available {
		t.Fatalf("a deleted restaurant's slug = %+v, %v; want available again", got, err)
	}
}
