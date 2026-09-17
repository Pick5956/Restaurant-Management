package service

import (
	"errors"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// expiryWarningDays is how far ahead "ใกล้หมดอายุ" looks. Three days covers the
// next delivery cycle for the fresh items that actually go off.
const expiryWarningDays = 3

// parseLotExpiry reads the YYYY-MM-DD a client sends and pins it to the end of
// that day in the shop's timezone, so a lot marked "15 ก.ย." is still good on
// the 15th and off on the 16th — the way a printed label is read.
func parseLotExpiry(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	day, err := time.ParseInLocation("2006-01-02", raw, repository.BangkokNow().Location())
	if err != nil {
		return nil, errors.New("expires_at must be a YYYY-MM-DD date")
	}
	end := day.Add(24*time.Hour - time.Second)
	return &end, nil
}

// newLotForStockIn is the lot a restock or an opening stock writes: the full
// quantity still on the shelf, valued at the ingredient's unit cost, dated only
// if the person receiving it said so.
func newLotForStockIn(ingredient *entity.Ingredient, quantity float64, transactionID uint, expiresAt *time.Time, now time.Time) *entity.IngredientLot {
	lot := &entity.IngredientLot{
		RestaurantID: ingredient.RestaurantID,
		IngredientID: ingredient.ID,
		Quantity:     quantity,
		Remaining:    quantity,
		ExpiresAt:    expiresAt,
		ReceivedAt:   now,
		CostPerUnit:  ingredient.CostPerUnit,
	}
	if transactionID != 0 {
		id := transactionID
		lot.TransactionID = &id
	}
	return lot
}

// lotExpiryState classifies a lot against `now` for the list badges.
type lotExpiryState string

const (
	lotFresh    lotExpiryState = "fresh"
	lotExpiring lotExpiryState = "expiring"
	lotExpired  lotExpiryState = "expired"
)

func classifyExpiry(expiresAt *time.Time, now time.Time) lotExpiryState {
	if expiresAt == nil {
		return lotFresh
	}
	if !expiresAt.After(now) {
		return lotExpired
	}
	if expiresAt.Before(now.Add(expiryWarningDays * 24 * time.Hour)) {
		return lotExpiring
	}
	return lotFresh
}

// discardNote is the movement-log line a discard writes. Thai, like every other
// system note, because it is shown verbatim on the history and in the CSV.
func discardNote(lot *entity.IngredientLot, reason string) string {
	reason = strings.TrimSpace(reason)
	if lot.ExpiresAt != nil {
		stamp := lot.ExpiresAt.In(repository.BangkokNow().Location()).Format("2006-01-02")
		if reason == "" {
			return "ทิ้ง · หมดอายุ " + stamp
		}
		return "ทิ้ง · หมดอายุ " + stamp + " · " + reason
	}
	if reason == "" {
		return "ทิ้ง"
	}
	return "ทิ้ง · " + reason
}
