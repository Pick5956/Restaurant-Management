package repository

import (
	"errors"
	"strings"
	"testing"

	"Project-M/internal/entity"

	"gorm.io/gorm"
)

func TestCloneRoleWithDisplayNameOverrideDoesNotMutateGlobalDefault(t *testing.T) {
	canonical := &entity.Role{Name: "waiter", DisplayName: "Waiter", IsSystem: true}
	override := "พนักงานหน้าร้าน"

	effective := cloneRoleWithDisplayNameOverride(canonical, &override)

	if effective == canonical {
		t.Fatal("effective role reused the global role pointer")
	}
	if canonical.DisplayName != "Waiter" || canonical.DisplayNameOverride != nil {
		t.Fatalf("global role was mutated: %#v", canonical)
	}
	if effective.DisplayName != override || effective.DisplayNameOverride == nil || *effective.DisplayNameOverride != override {
		t.Fatalf("effective role did not carry override: %#v", effective)
	}
}

func TestCloneRoleWithoutOverrideKeepsDefaultAndNoMarker(t *testing.T) {
	canonical := &entity.Role{Name: "waiter", DisplayName: "Waiter", IsSystem: true}

	effective := cloneRoleWithDisplayNameOverride(canonical, nil)

	if effective == canonical {
		t.Fatal("effective role reused the global role pointer")
	}
	if effective.DisplayName != "Waiter" || effective.DisplayNameOverride != nil {
		t.Fatalf("default role changed without an override: %#v", effective)
	}
}

// A role could not be deleted while anyone who had ever held it was still on
// the team list, removed staff included, although nobody works under it any
// more. Only active and suspended members hold a role.
func TestRoleDeleteIsBlockedOnlyByMembersStillHoldingTheRole(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewRoleRepository(db)

	if _, err := repo.CountMembersForRestaurant(12, 7); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("CountMembersForRestaurant() error = %v", err)
	}

	joined := strings.Join(capture.statements, "\n")
	for _, fragment := range []string{
		"from \"restaurant_members\"",
		"role_id = 12",
		"restaurant_id = 7",
		"status in ('active','suspended')",
		"\"restaurant_members\".\"deleted_at\" is null",
	} {
		if !strings.Contains(joined, fragment) {
			t.Fatalf("member count for a role delete is missing %q:\n%s", fragment, joined)
		}
	}
	if strings.Contains(joined, "removed") {
		t.Fatalf("a removed member must not block a role delete:\n%s", joined)
	}
}
