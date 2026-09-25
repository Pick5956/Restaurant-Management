package service

import (
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// TestOpenOrderStoresServiceChargeAndVAT: an open order's stored charges and
// grand_total are what its bill shows, not the total before service charge and
// VAT that only payment used to fill in.
func TestOpenOrderStoresServiceChargeAndVAT(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	orders := repository.NewOrderRepository(db)
	if err := db.Model(&entity.Restaurant{}).Where("id = ?", scenario.restaurant.ID).Updates(map[string]any{
		"service_charge_enabled": true, "service_charge_rate": 10,
		"vat_enabled": true, "vat_rate": 7,
	}).Error; err != nil {
		t.Fatalf("switch on service charge and VAT: %v", err)
	}

	order, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	// Served straight away: PayOrder refuses a bill the kitchen has not
	// finished, and a pending line would stop the payment step below.
	if _, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1, ServeImmediately: true}); err != nil {
		t.Fatalf("add a dish at 100: %v", err)
	}

	stored, err := orders.FindOrder(scenario.restaurant.ID, order.ID)
	if err != nil {
		t.Fatalf("reload order: %v", err)
	}
	if !moneyEqual(stored.ServiceChargeAmount, 10) || !moneyEqual(stored.VATAmount, 7.7) || !moneyEqual(stored.GrandTotal, 117.7) {
		t.Fatalf("stored open order = %.2f service, %.2f VAT, %.2f grand; want 10, 7.70, 117.70",
			stored.ServiceChargeAmount, stored.VATAmount, stored.GrandTotal)
	}
	bill, err := scenario.service.Bill(scenario.restaurant.ID, order.ID)
	if err != nil {
		t.Fatalf("bill: %v", err)
	}
	if !moneyEqual(bill.ServiceChargeAmount, stored.ServiceChargeAmount) || !moneyEqual(bill.VATAmount, stored.VATAmount) || !moneyEqual(bill.GrandTotal, stored.GrandTotal) {
		t.Fatalf("bill = %.2f service, %.2f VAT, %.2f grand, but the order stores %.2f, %.2f, %.2f",
			bill.ServiceChargeAmount, bill.VATAmount, bill.GrandTotal,
			stored.ServiceChargeAmount, stored.VATAmount, stored.GrandTotal)
	}

	paid, err := scenario.service.PayOrder(scenario.restaurant.ID, scenario.user.ID, order.ID, &PayOrderRequest{Method: "cash"})
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	if !moneyEqual(paid.GrandTotal, 117.7) || len(paid.Payments) != 1 || !moneyEqual(paid.Payments[0].Amount, 117.7) {
		t.Fatalf("paid grand total = %.2f with payments %+v, want 117.70", paid.GrandTotal, paid.Payments)
	}
}
