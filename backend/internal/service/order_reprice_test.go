package service

import (
	"testing"

	"Project-M/internal/entity"
)

// An open order stores its service charge and VAT, so a settings save that
// moves either has to reprice the open orders; a save that moves neither
// (a name, a logo) must not.
func TestBillChargesChangedOnlyForWhatABillIsPricedFrom(t *testing.T) {
	base := entity.Restaurant{ServiceChargeEnabled: true, ServiceChargeRate: 10, VATEnabled: true, VATRate: 7, Name: "ร้านทดสอบ"}
	for _, tc := range []struct {
		name  string
		edit  func(r *entity.Restaurant)
		moved bool
	}{
		{"nothing", func(*entity.Restaurant) {}, false},
		{"name only", func(r *entity.Restaurant) { r.Name = "ร้านใหม่" }, false},
		{"service charge off", func(r *entity.Restaurant) { r.ServiceChargeEnabled = false }, true},
		{"service charge rate", func(r *entity.Restaurant) { r.ServiceChargeRate = 5 }, true},
		{"vat off", func(r *entity.Restaurant) { r.VATEnabled = false }, true},
		{"vat rate", func(r *entity.Restaurant) { r.VATRate = 10 }, true},
	} {
		after := base
		tc.edit(&after)
		if got := BillChargesChanged(&base, &after); got != tc.moved {
			t.Errorf("%s: BillChargesChanged = %v, want %v", tc.name, got, tc.moved)
		}
	}
	if !BillChargesChanged(nil, &base) || BillChargesChanged(nil, nil) {
		t.Error("an unknown side must count as changed, two unknowns as unchanged")
	}
}

// The promotion path and the settings path price open orders through one loop,
// so the two can never disagree about which orders are skipped.
func TestPromotionsRepriceThroughTheSharedLoop(t *testing.T) {
	assertCallers(t, "RepriceOpenOrders", map[string]int{"PromotionService.repriceOpenOrders": 1})
}
