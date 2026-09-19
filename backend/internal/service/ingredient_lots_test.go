package service

import (
	"testing"
	"time"

	"Project-M/internal/entity"
)

// A label that says "15 ก.ย." means the food is fine all of the 15th. Pinning
// the parsed date to 00:00 would call it expired at breakfast that day.
func TestParseLotExpiryPinsToEndOfDay(t *testing.T) {
	got, err := parseLotExpiry("2026-09-15")
	if err != nil || got == nil {
		t.Fatalf("parseLotExpiry() = %v, %v", got, err)
	}
	if got.Hour() != 23 || got.Minute() != 59 || got.Day() != 15 {
		t.Fatalf("want 2026-09-15 23:59, got %s", got.Format("2006-01-02 15:04"))
	}
}

func TestParseLotExpiryAllowsBlankAndRejectsGarbage(t *testing.T) {
	if got, err := parseLotExpiry("  "); err != nil || got != nil {
		t.Fatalf("blank must mean no date, got %v %v", got, err)
	}
	if _, err := parseLotExpiry("15/09/2026"); err == nil {
		t.Fatal("d/m/Y must be rejected, not silently mis-parsed")
	}
}

func TestClassifyExpiryBuckets(t *testing.T) {
	now := time.Date(2026, 9, 12, 12, 0, 0, 0, time.UTC)
	at := func(d int) *time.Time { v := now.AddDate(0, 0, d); return &v }
	cases := []struct {
		name string
		when *time.Time
		want lotExpiryState
	}{
		{"undated is never flagged", nil, lotFresh},
		{"already past", at(-1), lotExpired},
		{"exactly now counts as gone", &now, lotExpired},
		{"inside the 3-day window", at(2), lotExpiring},
		{"beyond the window", at(5), lotFresh},
	}
	for _, c := range cases {
		if got := classifyExpiry(c.when, now); got != c.want {
			t.Fatalf("%s: got %s want %s", c.name, got, c.want)
		}
	}
}

func TestNewLotForStockInCarriesCostAndLink(t *testing.T) {
	ingredient := &entity.Ingredient{RestaurantID: 1, Unit: "กรัม", CostPerUnit: 0.15}
	ingredient.ID = 9
	now := time.Now()
	lot := newLotForStockIn(ingredient, 3000, 41, nil, now)
	if lot.Quantity != 3000 || lot.Remaining != 3000 {
		t.Fatalf("a fresh lot is fully remaining: %+v", lot)
	}
	if lot.CostPerUnit != 0.15 || lot.TransactionID == nil || *lot.TransactionID != 41 {
		t.Fatalf("lot must carry the unit cost and the stock-in it came from: %+v", lot)
	}
	if lot.ExpiresAt != nil {
		t.Fatal("no date given must stay nil, not zero time")
	}
	if opening := newLotForStockIn(ingredient, 500, 0, nil, now); opening.TransactionID != nil {
		t.Fatal("transaction 0 means an opening lot with no link")
	}
}

func TestDiscardNoteNamesTheExpiryDate(t *testing.T) {
	when := time.Date(2026, 9, 15, 23, 59, 59, 0, time.FixedZone("Asia/Bangkok", 7*3600))
	lot := &entity.IngredientLot{ExpiresAt: &when}
	if got := discardNote(lot, ""); got != "ทิ้ง · หมดอายุ 2026-09-15" {
		t.Fatalf("got %q", got)
	}
	if got := discardNote(lot, "ขึ้นรา"); got != "ทิ้ง · หมดอายุ 2026-09-15 · ขึ้นรา" {
		t.Fatalf("got %q", got)
	}
	if got := discardNote(&entity.IngredientLot{}, ""); got != "ทิ้ง" {
		t.Fatalf("undated lot: got %q", got)
	}
}
