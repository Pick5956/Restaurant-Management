package service

import (
	"testing"

	"Project-M/internal/entity"
)

// TestRaisingALineAtAStalePriceAddsTheNewUnitsAtTodaysPrice drives the web
// bill's "+" the way it runs: it raises the OLDEST pending line of a group
// whose lines differ only by when they were taken. Raised in place, every new
// unit took that line's stored price. The units now go the way an add goes -
// onto the newest line at today's price, or a new line - while a raise at the
// line's own price and a decrease stay on the line.
func TestRaisingALineAtAStalePriceAddsTheNewUnitsAtTodaysPrice(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	restaurantID := scenario.restaurant.ID

	type wantLine struct {
		unitPrice float64
		quantity  int
	}
	expect := func(t *testing.T, step string, order *entity.Order, want ...wantLine) {
		t.Helper()
		if len(order.Items) != len(want) {
			t.Fatalf("%s: expected %d lines, got %d", step, len(want), len(order.Items))
		}
		subtotal := 0.0
		for index, line := range order.Items {
			if line.Status != entity.OrderItemStatusPending {
				t.Fatalf("%s: line %d is %q, want pending", step, index+1, line.Status)
			}
			if !moneyEqual(line.UnitPrice, want[index].unitPrice) || line.Quantity != want[index].quantity {
				t.Fatalf("%s: line %d is %d at %v, want %d at %v",
					step, index+1, line.Quantity, line.UnitPrice, want[index].quantity, want[index].unitPrice)
			}
			if lineTotal := want[index].unitPrice * float64(want[index].quantity); !moneyEqual(line.Subtotal, lineTotal) {
				t.Fatalf("%s: line %d subtotal %v, want %v", step, index+1, line.Subtotal, lineTotal)
			}
			subtotal += want[index].unitPrice * float64(want[index].quantity)
		}
		if !moneyEqual(order.Subtotal, subtotal) {
			t.Fatalf("%s: order subtotal %v, want %v", step, order.Subtotal, subtotal)
		}
	}

	order, err := scenario.service.OpenOrder(restaurantID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	added, err := scenario.service.AddItem(restaurantID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1})
	if err != nil {
		t.Fatalf("add item: %v", err)
	}
	expect(t, "first add", added, wantLine{100, 1})
	oldest := added.Items[0].ID

	raised, err := scenario.service.UpdateItem(restaurantID, order.ID, oldest, &UpdateOrderItemRequest{Quantity: 2})
	if err != nil {
		t.Fatalf("raise at the same price: %v", err)
	}
	expect(t, "raise at the line's own price", raised, wantLine{100, 2})

	if err := db.Model(&entity.MenuItem{}).Where("id = ?", scenario.menu.ID).Update("price", 120).Error; err != nil {
		t.Fatalf("change the menu price: %v", err)
	}

	split, err := scenario.service.UpdateItem(restaurantID, order.ID, oldest, &UpdateOrderItemRequest{Quantity: 3})
	if err != nil {
		t.Fatalf("raise after the price change: %v", err)
	}
	expect(t, "raise after the price change", split, wantLine{100, 2}, wantLine{120, 1})

	again, err := scenario.service.UpdateItem(restaurantID, order.ID, oldest, &UpdateOrderItemRequest{Quantity: 3})
	if err != nil {
		t.Fatalf("raise the oldest line again: %v", err)
	}
	expect(t, "raise the oldest line again", again, wantLine{100, 2}, wantLine{120, 2})

	joined, err := scenario.service.AddItem(restaurantID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1})
	if err != nil {
		t.Fatalf("add after the price change: %v", err)
	}
	expect(t, "add after the price change", joined, wantLine{100, 2}, wantLine{120, 3})

	fewer, err := scenario.service.UpdateItem(restaurantID, order.ID, oldest, &UpdateOrderItemRequest{Quantity: 1})
	if err != nil {
		t.Fatalf("lower the oldest line: %v", err)
	}
	expect(t, "lower the oldest line", fewer, wantLine{100, 1}, wantLine{120, 3})
}

// TestRaisingALineOfADishNoLongerSoldIsRefused: an increase sells more of the
// dish, so a dish taken off sale or deleted from the menu refuses it even at
// the line's own price, where the units would have stayed on the line. A
// decrease still goes through - the web bill's, which sends no options, and
// the mobile editor's, which sends the line's own options with every edit.
// New options on a deleted dish are still refused: they are read off the menu.
func TestRaisingALineOfADishNoLongerSoldIsRefused(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	restaurantID := scenario.restaurant.ID

	group := entity.MenuOptionGroup{
		RestaurantID: restaurantID,
		MenuItemID:   scenario.menu.ID,
		Name:         "Spice",
		MinSelect:    0,
		MaxSelect:    1,
		IsActive:     true,
	}
	mustCreateOrderVoidRow(t, db, &group)
	mild := entity.MenuOption{
		RestaurantID:  restaurantID,
		MenuItemID:    scenario.menu.ID,
		OptionGroupID: group.ID,
		Name:          "Mild",
		PriceDelta:    5,
		IsActive:      true,
	}
	mustCreateOrderVoidRow(t, db, &mild)
	lineOptions := []uint{mild.ID}
	noOptions := []uint{}

	order, err := scenario.service.OpenOrder(restaurantID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	added, err := scenario.service.AddItem(restaurantID, scenario.user.ID, order.ID, &AddOrderItemRequest{
		MenuID:            scenario.menu.ID,
		Quantity:          4,
		SelectedOptionIDs: lineOptions,
	})
	if err != nil {
		t.Fatalf("add item: %v", err)
	}
	line := added.Items[0].ID
	holds := func(t *testing.T, step string, order *entity.Order, want int) {
		t.Helper()
		if len(order.Items) != 1 {
			t.Fatalf("%s: expected one line, got %d", step, len(order.Items))
		}
		item := order.Items[0]
		if item.Quantity != want {
			t.Fatalf("%s: line holds %d, want %d", step, item.Quantity, want)
		}
		if len(item.SelectedOptions) != 1 || item.SelectedOptions[0].MenuOptionID != mild.ID || !moneyEqual(item.OptionsTotal, 5) {
			t.Fatalf("%s: the line's options changed: %+v, total %v", step, item.SelectedOptions, item.OptionsTotal)
		}
		if subtotal := (scenario.menu.Price + 5) * float64(want); !moneyEqual(item.Subtotal, subtotal) {
			t.Fatalf("%s: line subtotal %v, want %v", step, item.Subtotal, subtotal)
		}
	}
	update := func(quantity int, options *[]uint) (*entity.Order, error) {
		return scenario.service.UpdateItem(restaurantID, order.ID, line, &UpdateOrderItemRequest{Quantity: quantity, SelectedOptionIDs: options})
	}

	if err := db.Model(&entity.MenuItem{}).Where("id = ?", scenario.menu.ID).Update("is_available", false).Error; err != nil {
		t.Fatalf("take the dish off sale: %v", err)
	}
	if _, err := update(5, nil); err == nil || err.Error() != "menu item is unavailable" {
		t.Fatalf("raising a dish taken off sale: err = %v, want the unavailable refusal", err)
	}
	if _, err := update(5, &lineOptions); err == nil || err.Error() != "menu item is unavailable" {
		t.Fatalf("raising a dish taken off sale with the line's options: err = %v, want the unavailable refusal", err)
	}
	lowered, err := update(3, nil)
	if err != nil {
		t.Fatalf("lowering a dish taken off sale: %v", err)
	}
	holds(t, "lowering a dish taken off sale", lowered, 3)

	if err := db.Model(&entity.MenuItem{}).Where("id = ?", scenario.menu.ID).Update("is_available", true).Error; err != nil {
		t.Fatalf("put the dish back on sale: %v", err)
	}
	if err := db.Delete(&entity.MenuItem{}, scenario.menu.ID).Error; err != nil {
		t.Fatalf("delete the dish: %v", err)
	}
	if _, err := update(4, nil); err == nil || err.Error() != "menu item not found" {
		t.Fatalf("raising a deleted dish: err = %v, want the not-found refusal", err)
	}
	if _, err := update(4, &lineOptions); err == nil || err.Error() != "menu item not found" {
		t.Fatalf("raising a deleted dish with the line's options: err = %v, want the not-found refusal", err)
	}
	lowered, err = update(2, &lineOptions)
	if err != nil {
		t.Fatalf("lowering a deleted dish with the line's options: %v", err)
	}
	holds(t, "lowering a deleted dish with the line's options", lowered, 2)
	if _, err := update(1, &noOptions); err == nil || err.Error() != "menu item not found" {
		t.Fatalf("clearing the options of a deleted dish: err = %v, want the not-found refusal", err)
	}
	lowered, err = update(1, nil)
	if err != nil {
		t.Fatalf("lowering a deleted dish: %v", err)
	}
	holds(t, "lowering a deleted dish", lowered, 1)
}
