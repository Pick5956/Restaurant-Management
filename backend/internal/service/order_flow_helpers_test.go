package service

import (
	"testing"

	"Project-M/internal/entity"
)

// TestStockDeductionTakesWhatTheShelfHas: a cooked dish is never refused for a
// count that came in low. The shelf gives what it has and the rest is a
// shortfall to write down, not an error.
func TestStockDeductionTakesWhatTheShelfHas(t *testing.T) {
	cases := []struct {
		name            string
		stock, required float64
		removed, short  float64
	}{
		{name: "enough on the shelf", stock: 10, required: 8, removed: 8, short: 0},
		{name: "exactly enough", stock: 8, required: 8, removed: 8, short: 0},
		{name: "count below the recipe", stock: 5, required: 8, removed: 5, short: 3},
		{name: "empty shelf", stock: 0, required: 8, removed: 0, short: 8},
		{name: "negative shelf is treated as empty", stock: -2, required: 8, removed: 0, short: 8},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			removed, short := stockDeduction(tc.stock, tc.required)
			if removed != tc.removed || short != tc.short {
				t.Fatalf("stockDeduction(%v, %v) = %v removed, %v short; want %v, %v", tc.stock, tc.required, removed, short, tc.removed, tc.short)
			}
		})
	}
}

// A recipe quantity times a count is float arithmetic: 0.1 x 3 is
// 0.30000000000000004. A shelf holding exactly that much is not short, and a
// real shortfall is written to the 4 places stock is stored in. Runtime values,
// not constants: Go folds a constant 0.1*3 exactly and would hide the noise.
func TestStockDeductionIgnoresFloatNoise(t *testing.T) {
	perDish, dishes := 0.1, 3.0
	required := perDish * dishes
	if removed, short := stockDeduction(0.3, required); short != 0 || removed != 0.3 {
		t.Fatalf("exact shelf: %v removed, %v short; want 0.3 removed, nothing short", removed, short)
	}
	if removed, short := stockDeduction(0.1, required); short != 0.2 || removed != 0.1 {
		t.Fatalf("short shelf: %v removed, %v short; want 0.1 removed, 0.2 short", removed, short)
	}
	if got := autoDeductionNote("20260924-003", "ต้มยำ", 0.2, "กิโลกรัม"); got != "ตัดอัตโนมัติ, 20260924-003, ต้มยำ, ขาด 0.2 กิโลกรัม" {
		t.Fatalf("note = %q", got)
	}
}

func TestAutoDeductionNoteSaysTheShortfall(t *testing.T) {
	if got := autoDeductionNote("20260924-003", "ผัดกะเพราหมู", 0, "กรัม"); got != "ตัดอัตโนมัติ, 20260924-003, ผัดกะเพราหมู" {
		t.Fatalf("note without shortfall = %q", got)
	}
	if got := autoDeductionNote("20260924-003", "ผัดกะเพราหมู", 20.5, "กรัม"); got != "ตัดอัตโนมัติ, 20260924-003, ผัดกะเพราหมู, ขาด 20.5 กรัม" {
		t.Fatalf("note with shortfall = %q", got)
	}
}

// TestUnpaidChargesMatchTheBill pins the one arithmetic both the stored order
// and the bill view use: service charge on the discounted total, VAT on top of
// both, each rounded to satang.
func TestUnpaidChargesMatchTheBill(t *testing.T) {
	restaurant := &entity.Restaurant{ServiceChargeEnabled: true, ServiceChargeRate: 10, VATEnabled: true, VATRate: 7}
	service, vat := unpaidCharges(100, restaurant)
	if !moneyEqual(service, 10) || !moneyEqual(vat, 7.7) {
		t.Fatalf("charges on 100 = %.2f service, %.2f VAT; want 10, 7.70", service, vat)
	}

	order := &entity.Order{Subtotal: 100, TotalAmount: 100, PaymentStatus: entity.PaymentStatusUnpaid}
	bill := billFromOrder(order, restaurant)
	if !moneyEqual(bill.ServiceChargeAmount, service) || !moneyEqual(bill.VATAmount, vat) || !moneyEqual(bill.GrandTotal, 117.7) {
		t.Fatalf("bill = %.2f service, %.2f VAT, %.2f grand; want the helper's 10, 7.70 and 117.70", bill.ServiceChargeAmount, bill.VATAmount, bill.GrandTotal)
	}

	// A 12% promotion on 1,203 leaves 1058.6399999999999 in float. Priced from
	// that, the stored VAT was 81.51 and grand_total 1,246.01 while the bill
	// said 81.52 and 1,246.02. Both now price from the bill's rounded total.
	subtotal, discount := 1203.0, 1203.0*0.12
	_, _, total := billAmounts(subtotal, discount)
	if !moneyEqual(total, 1058.64) {
		t.Fatalf("bill total = %v; want 1058.64", total)
	}
	storedService, storedVAT := unpaidCharges(total, restaurant)
	promoted := billFromOrder(&entity.Order{Subtotal: subtotal, DiscountAmount: discount, TotalAmount: subtotal - discount, PaymentStatus: entity.PaymentStatusUnpaid}, restaurant)
	if !moneyEqual(storedVAT, promoted.VATAmount) || !moneyEqual(roundMoney(total+storedService+storedVAT), promoted.GrandTotal) || !moneyEqual(promoted.GrandTotal, 1246.02) {
		t.Fatalf("stored %.2f VAT / %.2f grand vs bill %.2f / %.2f; want both 1246.02", storedVAT, roundMoney(total+storedService+storedVAT), promoted.VATAmount, promoted.GrandTotal)
	}

	off := &entity.Restaurant{ServiceChargeEnabled: false, ServiceChargeRate: 10, VATEnabled: false, VATRate: 7}
	if service, vat := unpaidCharges(100, off); service != 0 || vat != 0 {
		t.Fatalf("charges with both switched off = %.2f, %.2f; want none", service, vat)
	}
}
