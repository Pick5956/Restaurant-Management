package repository

import (
	"errors"
	"strings"
	"testing"

	"Project-M/internal/entity"

	"gorm.io/gorm"
)

// Draining must lock the lots it reads and take them earliest-expiry first with
// undated lots last. Any other order eats fresh stock while dated stock goes off
// on the shelf.
func TestDrainLotsLocksAndOrdersFEFO(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewIngredientRepository(db)

	if _, err := repo.DrainLots(7, 4, 250); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("DrainLots() error = %v", err)
	}

	joined := strings.ToLower(strings.Join(capture.statements, "\\n"))
	for _, fragment := range []string{
		"for update",
		"remaining > 0",
		"expires_at asc nulls last",
		"received_at asc",
	} {
		if !strings.Contains(joined, fragment) {
			t.Fatalf("drain query missing %q:\\n%s", fragment, joined)
		}
	}
}

// A physical count that comes up short takes the loss from the OLDEST delivery,
// not the soonest-expiring one — those are different orders once an undated lot
// sits between dated ones.
func TestShrinkLotsUsesReceivedOrderNotExpiry(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewIngredientRepository(db)

	if _, err := repo.ShrinkLotsOldestFirst(7, 4, 100); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("ShrinkLotsOldestFirst() error = %v", err)
	}

	joined := strings.ToLower(strings.Join(capture.statements, "\\n"))
	if !strings.Contains(joined, "order by received_at asc") {
		t.Fatalf("shrink must order by received_at:\\n%s", joined)
	}
	if strings.Contains(joined, "expires_at asc nulls last") {
		t.Fatalf("shrink must not use the FEFO order:\\n%s", joined)
	}
}

// The card's "หมดอายุ" line reads one lot per ingredient, chosen by soonest
// expiry, for the whole page in a single statement.
func TestAttachExpiringLotsIsOneQueryPickingSoonestDatedLot(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewIngredientRepository(db)

	items := []entity.Ingredient{{}, {}, {}}
	for i := range items {
		items[i].ID = uint(i + 1)
	}
	if err := repo.AttachExpiringLots(7, items); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("AttachExpiringLots() error = %v", err)
	}

	if len(capture.statements) != 1 {
		t.Fatalf("want 1 query for 3 ingredients, got %d", len(capture.statements))
	}
	joined := strings.ToLower(capture.statements[0])
	for _, fragment := range []string{"distinct on (ingredient_id)", "expires_at is not null", "remaining > 0", "expires_at asc"} {
		if !strings.Contains(joined, fragment) {
			t.Fatalf("expiring query missing %q:\\n%s", fragment, joined)
		}
	}
}

func TestAttachExpiringLotsSkipsTheQueryForAnEmptyList(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewIngredientRepository(db)
	if err := repo.AttachExpiringLots(7, nil); err != nil {
		t.Fatalf("AttachExpiringLots() error = %v", err)
	}
	if len(capture.statements) != 0 {
		t.Fatalf("empty page must not query, got:\\n%s", strings.Join(capture.statements, "\\n"))
	}
}
