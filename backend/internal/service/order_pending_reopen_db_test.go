package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// TestMergedPendingLineReopensFinishedOrder: folding a dish into an existing
// pending line is still a pending line landing on the order, so a served order
// must reopen exactly as it does for a new line.
func TestMergedPendingLineReopensFinishedOrder(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	order, items := scenario.orderWithItems(t, entity.OrderTypeTakeaway, entity.OrderItemStatusServed, entity.OrderItemStatusPending)
	if err := db.Model(&entity.Order{}).Where("id = ?", order.ID).Update("status", entity.OrderStatusServed).Error; err != nil {
		t.Fatalf("mark order served: %v", err)
	}

	updated, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1})
	if err != nil {
		t.Fatalf("add a dish that merges into the pending line: %v", err)
	}
	if len(updated.Items) != 2 {
		t.Fatalf("items = %d, want the dish merged into the existing pending line", len(updated.Items))
	}
	for _, item := range updated.Items {
		if item.ID == items[1].ID && item.Quantity != 2 {
			t.Fatalf("pending line quantity = %d, want 2 after the merge", item.Quantity)
		}
	}
	if updated.Status != entity.OrderStatusOpen {
		t.Fatalf("order status = %q, want open: a pending line must not hide behind served", updated.Status)
	}
}

// TestCustomerLinesHeldForStaffReopenFinishedOrder: a QR order the restaurant
// could not place at the table waits as pending lines for staff to confirm.
// They must show as work to do, not sit inside an order that reads served.
func TestCustomerLinesHeldForStaffReopenFinishedOrder(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	orders := repository.NewOrderRepository(db)

	// A restaurant with a fence, so an order without coordinates is unverified.
	if err := db.Model(&entity.Restaurant{}).Where("id = ?", scenario.restaurant.ID).Updates(map[string]any{
		"latitude": shopLat, "longitude": shopLon, "order_radius_meters": 150,
	}).Error; err != nil {
		t.Fatalf("fence the restaurant: %v", err)
	}
	token := strings.Repeat("ab", customerTableTokenBytes)
	table := entity.RestaurantTable{
		RestaurantID:   scenario.restaurant.ID,
		TableNumber:    "T1",
		DisplayLabel:   "T1",
		SequenceNumber: 1,
		Capacity:       4,
		Status:         entity.TableStatusFree,
		CustomerToken:  token,
	}
	mustCreateOrderVoidRow(t, db, &table)

	order, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{TableID: &table.ID})
	if err != nil {
		t.Fatalf("open table: %v", err)
	}
	// A drink poured and served before it was keyed in: the order reads served.
	served, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1, ServeImmediately: true})
	if err != nil {
		t.Fatalf("serve a dish immediately: %v", err)
	}
	if served.Status != entity.OrderStatusServed {
		t.Fatalf("order status before the QR order = %q, want served", served.Status)
	}

	customers := ProvideCustomerOrderService(orders)
	result, err := customers.SubmitOrder(token, fmt.Sprintf("reopen-%d", time.Now().UnixNano()), &SubmitCustomerOrderRequest{
		Items: []CustomerCartItemRequest{{MenuID: scenario.menu.ID, Quantity: 1}},
	})
	if err != nil {
		t.Fatalf("submit a QR order without a location: %v", err)
	}
	if !result.Payload.AwaitingStaffConfirm {
		t.Fatal("an order without a location must wait for staff confirmation")
	}
	reloaded, err := orders.FindOrder(scenario.restaurant.ID, order.ID)
	if err != nil {
		t.Fatalf("reload order: %v", err)
	}
	pending := 0
	for _, item := range reloaded.Items {
		if item.Status == entity.OrderItemStatusPending {
			pending++
		}
	}
	if pending != 1 {
		t.Fatalf("pending lines = %d, want the held QR line", pending)
	}
	if reloaded.Status != entity.OrderStatusOpen {
		t.Fatalf("order status = %q, want open: held lines must not hide behind served", reloaded.Status)
	}
}
