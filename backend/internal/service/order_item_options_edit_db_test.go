package service

import (
	"testing"

	"Project-M/internal/entity"
)

// TestUpdateItemReplacesSelectedOptions proves that editing a pending line can
// change WHICH options it carries, not just how many of it there are. Before
// this the update endpoint took quantity and note only, so the mobile summary
// had to tell staff to delete a line and re-add it to fix a wrong option.
//
// The three things that must move together are the option snapshot rows, the
// options total the guest is charged, and the recipe snapshot the kitchen
// deducts stock from. A test that checked only the price would pass while the
// old dish's ingredients were still being taken out of stock.
func TestUpdateItemReplacesSelectedOptions(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)

	group := entity.MenuOptionGroup{
		RestaurantID: scenario.restaurant.ID,
		MenuItemID:   scenario.menu.ID,
		Name:         "Spice",
		MinSelect:    0,
		MaxSelect:    1,
		IsActive:     true,
	}
	mustCreateOrderVoidRow(t, db, &group)
	mild := entity.MenuOption{
		RestaurantID:  scenario.restaurant.ID,
		MenuItemID:    scenario.menu.ID,
		OptionGroupID: group.ID,
		Name:          "Mild",
		PriceDelta:    5,
		IsActive:      true,
	}
	mustCreateOrderVoidRow(t, db, &mild)
	hot := entity.MenuOption{
		RestaurantID:  scenario.restaurant.ID,
		MenuItemID:    scenario.menu.ID,
		OptionGroupID: group.ID,
		Name:          "Hot",
		PriceDelta:    20,
		IsActive:      true,
	}
	mustCreateOrderVoidRow(t, db, &hot)

	order, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	added, err := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{
		MenuID:            scenario.menu.ID,
		Quantity:          1,
		SelectedOptionIDs: []uint{mild.ID},
	})
	if err != nil {
		t.Fatalf("add item: %v", err)
	}
	if len(added.Items) != 1 {
		t.Fatalf("expected one item, got %d", len(added.Items))
	}
	itemID := added.Items[0].ID

	swapped := []uint{hot.ID}
	updated, err := scenario.service.UpdateItem(scenario.restaurant.ID, order.ID, itemID, &UpdateOrderItemRequest{
		Quantity:          2,
		SelectedOptionIDs: &swapped,
	})
	if err != nil {
		t.Fatalf("update item options: %v", err)
	}
	item := updated.Items[0]
	if item.OptionsTotal != 20 {
		t.Fatalf("expected the hot option total of 20, got %v", item.OptionsTotal)
	}
	if want := (scenario.menu.Price + 20) * 2; item.Subtotal != want {
		t.Fatalf("expected subtotal %v, got %v", want, item.Subtotal)
	}
	if len(item.SelectedOptions) != 1 || item.SelectedOptions[0].MenuOptionID != hot.ID {
		t.Fatalf("expected only the hot option to remain, got %+v", item.SelectedOptions)
	}

	// A quantity-only edit leaves the options exactly where they are: the field
	// is a pointer so that "not sent" and "cleared" are different requests.
	quantityOnly, err := scenario.service.UpdateItem(scenario.restaurant.ID, order.ID, itemID, &UpdateOrderItemRequest{Quantity: 3})
	if err != nil {
		t.Fatalf("quantity-only update: %v", err)
	}
	kept := quantityOnly.Items[0]
	if len(kept.SelectedOptions) != 1 || kept.SelectedOptions[0].MenuOptionID != hot.ID {
		t.Fatalf("a quantity-only edit must not touch the options, got %+v", kept.SelectedOptions)
	}
	if kept.OptionsTotal != 20 {
		t.Fatalf("a quantity-only edit must not touch the options total, got %v", kept.OptionsTotal)
	}

	// And an empty slice clears them.
	none := []uint{}
	cleared, err := scenario.service.UpdateItem(scenario.restaurant.ID, order.ID, itemID, &UpdateOrderItemRequest{
		Quantity:          1,
		SelectedOptionIDs: &none,
	})
	if err != nil {
		t.Fatalf("clearing options: %v", err)
	}
	if len(cleared.Items[0].SelectedOptions) != 0 || cleared.Items[0].OptionsTotal != 0 {
		t.Fatalf("expected the options to be cleared, got %+v", cleared.Items[0])
	}
}

// TestAddItemMergesIdenticalPendingLines proves the summary shows one line per
// distinct dish-and-choices rather than a column of identical rows. The three
// negative cases matter as much as the positive one: a different note, a
// different option set, and a line already sent to the kitchen must each stay
// on their own row.
func TestAddItemMergesIdenticalPendingLines(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)

	group := entity.MenuOptionGroup{
		RestaurantID: scenario.restaurant.ID,
		MenuItemID:   scenario.menu.ID,
		Name:         "Extras",
		MinSelect:    0,
		MaxSelect:    2,
		IsActive:     true,
	}
	mustCreateOrderVoidRow(t, db, &group)
	egg := entity.MenuOption{
		RestaurantID:  scenario.restaurant.ID,
		MenuItemID:    scenario.menu.ID,
		OptionGroupID: group.ID,
		Name:          "Fried egg",
		PriceDelta:    10,
		IsActive:      true,
	}
	mustCreateOrderVoidRow(t, db, &egg)

	order, err := scenario.service.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	add := func(note string, optionIDs []uint) *entity.Order {
		t.Helper()
		next, addErr := scenario.service.AddItem(scenario.restaurant.ID, scenario.user.ID, order.ID, &AddOrderItemRequest{
			MenuID:            scenario.menu.ID,
			Quantity:          1,
			Note:              note,
			SelectedOptionIDs: optionIDs,
		})
		if addErr != nil {
			t.Fatalf("add item: %v", addErr)
		}
		return next
	}

	add("", nil)
	twice := add("", nil)
	if len(twice.Items) != 1 {
		t.Fatalf("the same dish twice must be one line, got %d", len(twice.Items))
	}
	if twice.Items[0].Quantity != 2 {
		t.Fatalf("expected the merged line to hold 2, got %d", twice.Items[0].Quantity)
	}
	if want := scenario.menu.Price * 2; twice.Items[0].Subtotal != want {
		t.Fatalf("expected subtotal %v, got %v", want, twice.Items[0].Subtotal)
	}

	// A different note is a different instruction to the kitchen.
	noted := add("no chilli", nil)
	if len(noted.Items) != 2 {
		t.Fatalf("a different note must open its own line, got %d", len(noted.Items))
	}

	// So is a different set of options.
	withEgg := add("", []uint{egg.ID})
	if len(withEgg.Items) != 3 {
		t.Fatalf("a different option set must open its own line, got %d", len(withEgg.Items))
	}

	// Once the round is with the kitchen its quantity is a record of what was
	// sent, so the next add starts a fresh line instead of rewriting history.
	if _, err := scenario.service.SendToKitchen(scenario.restaurant.ID, scenario.user.ID, order.ID); err != nil {
		t.Fatalf("send to kitchen: %v", err)
	}
	afterSend := add("", nil)
	if len(afterSend.Items) != 4 {
		t.Fatalf("a sent line must not absorb a new add, got %d items", len(afterSend.Items))
	}
}
