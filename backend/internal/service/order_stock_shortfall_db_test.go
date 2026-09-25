package service

import (
	"testing"

	"Project-M/internal/entity"
)

// shortfallScenario queues one serving of a dish whose recipe takes 2 pcs of an
// ingredient while the shelf holds 2, then lowers the shelf to stockAfterCount
// the way a physical count does, and sends the line to the kitchen. What comes
// back is the cooking line the kitchen is about to mark ready.
func shortfallScenario(t *testing.T, scenario *orderVoidDBScenario, stockAfterCount float64) (entity.Order, entity.OrderItem, entity.Ingredient) {
	t.Helper()
	ingredient := entity.Ingredient{RestaurantID: scenario.restaurant.ID, Name: "Lime", Unit: "pcs", Stock: 2}
	mustCreateOrderVoidRow(t, scenario.db, &ingredient)
	recipe := entity.MenuItemIngredient{
		RestaurantID: scenario.restaurant.ID,
		MenuItemID:   scenario.menu.ID,
		IngredientID: ingredient.ID,
		Quantity:     2,
		Unit:         "pcs",
	}
	mustCreateOrderVoidRow(t, scenario.db, &recipe)

	order, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	if _, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1}); err != nil {
		t.Fatalf("add a serving: %v", err)
	}
	if err := scenario.db.Model(&entity.Ingredient{}).Where("id = ?", ingredient.ID).Update("stock", stockAfterCount).Error; err != nil {
		t.Fatalf("count the shelf down: %v", err)
	}
	sent, err := scenario.service.SendToKitchen(scenario.restaurant.ID, scenario.user.ID, order.ID)
	if err != nil {
		t.Fatalf("send to kitchen: %v", err)
	}
	if len(sent.Items) != 1 || sent.Items[0].Status != entity.OrderItemStatusCooking {
		t.Fatalf("items after send = %+v, want one cooking line", sent.Items)
	}
	return *sent, sent.Items[0], ingredient
}

// TestReadyDishDeductsWhatTheShelfHasWhenStockFallsShort: the dish is cooked,
// so a count that came in below the recipe cannot refuse it. The shelf goes to
// zero, the movement records what actually left, and the note says the rest.
func TestReadyDishDeductsWhatTheShelfHasWhenStockFallsShort(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	order, item, ingredient := shortfallScenario(t, scenario, 1)

	ready, err := scenario.service.UpdateItemStatus(scenario.restaurant.ID, scenario.user.ID, order.ID, item.ID,
		entity.OrderItemStatusReady, "", OrderItemStatusActorKitchenManager)
	if err != nil {
		t.Fatalf("a cooked dish must be markable ready with a short shelf: %v", err)
	}
	if ready.Items[0].Status != entity.OrderItemStatusReady {
		t.Fatalf("item status = %q, want ready", ready.Items[0].Status)
	}

	var shelf entity.Ingredient
	if err := db.First(&shelf, ingredient.ID).Error; err != nil {
		t.Fatalf("reload ingredient: %v", err)
	}
	if shelf.Stock != 0 {
		t.Fatalf("stock after deduction = %.4f, want 0 (clamped, never negative)", shelf.Stock)
	}
	var deductions []entity.OrderInventoryDeduction
	if err := db.Where("order_item_id = ?", item.ID).Find(&deductions).Error; err != nil {
		t.Fatalf("list deductions: %v", err)
	}
	if len(deductions) != 1 || deductions[0].Quantity != 1 {
		t.Fatalf("deductions = %+v, want one for the 1 pc actually removed", deductions)
	}
	// The note is whatever the helper writes, so a separator change cannot
	// leave this test behind again.
	if want := autoDeductionNote(order.OrderNumber, item.MenuName, 1, "pcs"); deductions[0].Note != want {
		t.Fatalf("deduction note = %q, want %q", deductions[0].Note, want)
	}
	var movements []entity.IngredientTransaction
	if err := db.Where("ingredient_id = ?", ingredient.ID).Find(&movements).Error; err != nil {
		t.Fatalf("list movements: %v", err)
	}
	if len(movements) != 1 || movements[0].Quantity != 1 || movements[0].Note != deductions[0].Note {
		t.Fatalf("movements = %+v, want one out of 1 pc carrying the same note", movements)
	}

	// The bill runs the same deduction on ready lines and must go through too.
	paid, err := scenario.service.PayOrder(scenario.restaurant.ID, scenario.user.ID, order.ID, &PayOrderRequest{Method: "cash"})
	if err != nil {
		t.Fatalf("paying a bill whose dish was short on stock: %v", err)
	}
	if paid.PaymentStatus != entity.PaymentStatusPaid || paid.Items[0].Status != entity.OrderItemStatusServed {
		t.Fatalf("paid order = %s / item %s, want paid and served", paid.PaymentStatus, paid.Items[0].Status)
	}
}

// TestReadyDishWithEmptyShelfWritesNoMovement: nothing can leave an empty shelf,
// so no movement is recorded, but the dish is still ready and the menu that
// depends on the empty ingredient switches off.
func TestReadyDishWithEmptyShelfWritesNoMovement(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	order, item, ingredient := shortfallScenario(t, scenario, 0)

	if _, err := scenario.service.UpdateItemStatus(scenario.restaurant.ID, scenario.user.ID, order.ID, item.ID,
		entity.OrderItemStatusReady, "", OrderItemStatusActorKitchenManager); err != nil {
		t.Fatalf("a cooked dish must be markable ready with an empty shelf: %v", err)
	}
	var deductions int64
	if err := db.Model(&entity.OrderInventoryDeduction{}).Where("ingredient_id = ?", ingredient.ID).Count(&deductions).Error; err != nil {
		t.Fatalf("count deductions: %v", err)
	}
	if deductions != 0 {
		t.Fatalf("deductions on an empty shelf = %d, want none", deductions)
	}
	var menu entity.MenuItem
	if err := db.First(&menu, scenario.menu.ID).Error; err != nil {
		t.Fatalf("reload menu: %v", err)
	}
	if menu.IsAvailable {
		t.Fatal("a dish whose ingredient is at zero must be switched off")
	}
}
