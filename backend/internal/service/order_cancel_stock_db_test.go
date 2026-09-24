package service

import (
	"errors"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// TestCancelledOrderStopsClaimingStock: a cancelled order's unsent lines will
// never be cooked, so they must stop counting as committed the moment the order
// is cancelled - both because the query ignores a cancelled order and because
// the lines themselves are closed with the order's reason.
func TestCancelledOrderStopsClaimingStock(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)

	// One ingredient with two units, one per serving: capacity is 2.
	ingredient := entity.Ingredient{RestaurantID: scenario.restaurant.ID, Name: "Lime", Unit: "pcs", Stock: 2}
	mustCreateOrderVoidRow(t, db, &ingredient)
	recipe := entity.MenuItemIngredient{
		RestaurantID: scenario.restaurant.ID,
		MenuItemID:   scenario.menu.ID,
		IngredientID: ingredient.ID,
		Quantity:     1,
		Unit:         "pcs",
	}
	mustCreateOrderVoidRow(t, db, &recipe)

	order, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	if _, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 2}); err != nil {
		t.Fatalf("add two servings: %v", err)
	}
	remaining, err := repository.MenuRemainingServings(db, scenario.restaurant.ID)
	if err != nil {
		t.Fatalf("remaining before cancel: %v", err)
	}
	if got := remaining[scenario.menu.ID]; got != 0 {
		t.Fatalf("remaining before cancel = %d, want 0 (the queue claimed both)", got)
	}

	cancelled, err := scenario.service.CancelOrder(scenario.restaurant.ID, scenario.user.ID, order.ID, "ลูกค้ายกเลิก", true)
	if err != nil {
		t.Fatalf("cancel order: %v", err)
	}
	if len(cancelled.Items) != 1 || cancelled.Items[0].Status != entity.OrderItemStatusCancelled || cancelled.Items[0].CancelledReason != "ลูกค้ายกเลิก" {
		t.Fatalf("items after cancel = %+v, want the one line cancelled with the order's reason", cancelled.Items)
	}

	remaining, err = repository.MenuRemainingServings(db, scenario.restaurant.ID)
	if err != nil {
		t.Fatalf("remaining after cancel: %v", err)
	}
	if got := remaining[scenario.menu.ID]; got != 2 {
		t.Fatalf("remaining after cancel = %d, want 2 (a cancelled order commits nothing)", got)
	}

	// The next table can order what the cancelled one had claimed.
	next, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open next order: %v", err)
	}
	if _, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, next.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 2}); err != nil {
		t.Fatalf("the stock a cancelled order claimed must be free again: %v", err)
	}
}

// TestCancelOrderLeavesServedLinesAlone: what the guest already had stays
// served (its stock is gone either way); only the lines the kitchen never
// handed over are closed with the order.
func TestCancelOrderLeavesServedLinesAlone(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	order, _ := scenario.orderWithItems(t, entity.OrderTypeDineIn,
		entity.OrderItemStatusServed, entity.OrderItemStatusPending, entity.OrderItemStatusCooking, entity.OrderItemStatusReady)

	// Someone who may not change order status is refused under the lock: the
	// guest has eaten, and cancelling would write the food off unpaid.
	if _, err := scenario.service.CancelOrder(scenario.restaurant.ID, scenario.user.ID, order.ID, "แขกกลับก่อน", false); !errors.Is(err, ErrOrderCancelNeedsSupervisor) {
		t.Fatalf("cancel without update_order_status = %v, want ErrOrderCancelNeedsSupervisor", err)
	}

	cancelled, err := scenario.service.CancelOrder(scenario.restaurant.ID, scenario.user.ID, order.ID, "แขกกลับก่อน", true)
	if err != nil {
		t.Fatalf("cancel order: %v", err)
	}
	if cancelled.Status != entity.OrderStatusCancelled {
		t.Fatalf("order status = %q, want cancelled", cancelled.Status)
	}
	statuses := map[string]int{}
	for _, item := range cancelled.Items {
		statuses[item.Status]++
		if item.Status == entity.OrderItemStatusCancelled && item.CancelledReason != "แขกกลับก่อน" {
			t.Fatalf("cancelled line reason = %q, want the order's reason", item.CancelledReason)
		}
	}
	if statuses[entity.OrderItemStatusServed] != 1 || statuses[entity.OrderItemStatusCancelled] != 3 || len(cancelled.Items) != 4 {
		t.Fatalf("line statuses after cancel = %v, want 1 served and 3 cancelled", statuses)
	}
}
