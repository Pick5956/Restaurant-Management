package service

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"

	"Project-M/internal/entity"
)

func TestOrderNumberForDate(t *testing.T) {
	cases := []struct {
		index int
		want  string
	}{
		{index: 1, want: "20260724-001"},
		{index: 15, want: "20260724-015"},
		{index: 999, want: "20260724-999"},
		{index: 1000, want: "20260724-1000"},
		{index: 0, want: "20260724-001"},
	}
	for _, tc := range cases {
		if got := orderNumberForDate("20260724", tc.index); got != tc.want {
			t.Fatalf("orderNumberForDate(20260724, %d) = %s, want %s", tc.index, got, tc.want)
		}
	}
}

func TestShouldSeatReservationOnOpen(t *testing.T) {
	tests := []struct {
		name      string
		status    string
		requested bool
		want      bool
		wantErr   string
	}{
		{
			name:      "reserved table is seated when explicitly requested",
			status:    entity.TableStatusReserved,
			requested: true,
			want:      true,
		},
		{
			name:      "reserved table remains protected without the explicit flag",
			status:    entity.TableStatusReserved,
			requested: false,
			wantErr:   "table is reserved",
		},
		{
			name:      "free table opens normally without reservation mode",
			status:    entity.TableStatusFree,
			requested: false,
			want:      false,
		},
		{
			name:      "reservation mode cannot be used for a free table",
			status:    entity.TableStatusFree,
			requested: true,
			wantErr:   "table has no active reservation",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := shouldSeatReservationOnOpen(test.status, test.requested)
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("shouldSeatReservationOnOpen() error = %v, want nil", err)
				}
				if got != test.want {
					t.Fatalf("shouldSeatReservationOnOpen() = %v, want %v", got, test.want)
				}
				return
			}
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("shouldSeatReservationOnOpen() error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestOrderListFiltersAndOrderNumberAreBounded(t *testing.T) {
	if err := ValidateOrderListFilters("active", "2026-07-24", "paid", "20260724-015"); err != nil {
		t.Fatalf("valid filters rejected: %v", err)
	}
	for _, filters := range [][4]string{
		{"unknown", "", "", ""},
		{"", "2026-02-30", "", ""},
		{"", "", "refunded", ""},
		{"", "", "", strings.Repeat("ก", 101)},
	} {
		if err := ValidateOrderListFilters(filters[0], filters[1], filters[2], filters[3]); err == nil {
			t.Fatalf("invalid filters accepted: %#v", filters)
		}
	}
	// New format plus legacy letter-prefixed numbers (kept valid for old orders).
	for _, valid := range []string{"20260724-015", "20260724-001", "20260724-1000", "A001", "Z999", "AA001", "20260919-001 (Test)", "20260919-1000 (Test)"} {
		if !validOrderNumber(valid) {
			t.Fatalf("validOrderNumber(%q) = false", valid)
		}
	}
	for _, invalid := range []string{"", "A01", "a001", "001", "2026072-015", "20260724015", "20260724-01", "2026072a-015", "20260724-" + strings.Repeat("0", 30), "20260919-001 (test)x", "DA-2026-09-06-101294-022", " (Test)"} {
		if validOrderNumber(invalid) {
			t.Fatalf("validOrderNumber(%q) = true", invalid)
		}
	}
	// The route upper-cases the number it is given; the seeded suffix comes back.
	for in, want := range map[string]string{
		"20260919-001 (TEST)": "20260919-001 (Test)",
		"20260919-001 (Test)": "20260919-001 (Test)",
		"20260919-001":        "20260919-001",
		"A001":                "A001",
	} {
		if got := canonicalOrderNumber(in); got != want {
			t.Fatalf("canonicalOrderNumber(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOrderStatusFromItemsTreatsAlreadyServedItemsAsComplete(t *testing.T) {
	items := []entity.OrderItem{
		{Status: entity.OrderItemStatusServed},
		{Status: entity.OrderItemStatusReady},
	}
	if got := orderStatusFromItems(entity.OrderStatusCooking, items); got != entity.OrderStatusReady {
		t.Fatalf("mixed served/ready status = %q, want %q", got, entity.OrderStatusReady)
	}

	items[1].Status = entity.OrderItemStatusServed
	if got := orderStatusFromItems(entity.OrderStatusReady, items); got != entity.OrderStatusServed {
		t.Fatalf("all served status = %q, want %q", got, entity.OrderStatusServed)
	}
}

func TestEffectiveOrderStatusRepairsStaleKitchenAggregate(t *testing.T) {
	order := &entity.Order{
		Status: entity.OrderStatusCooking,
		Items: []entity.OrderItem{
			{Status: entity.OrderItemStatusReady},
			{Status: entity.OrderItemStatusReady},
			{Status: entity.OrderItemStatusCancelled},
		},
	}

	if got := effectiveOrderStatus(order); got != entity.OrderStatusReady {
		t.Fatalf("effective status = %q, want %q", got, entity.OrderStatusReady)
	}
	if err := validateOrderReadyForPayment(order); err != nil {
		t.Fatalf("stale parent status should not block payment when all active items are ready: %v", err)
	}
}

func TestEffectiveOrderStatusReopensWhenAllItemsCancelled(t *testing.T) {
	order := &entity.Order{
		Status: entity.OrderStatusCooking,
		Items: []entity.OrderItem{
			{Status: entity.OrderItemStatusCancelled},
			{Status: entity.OrderItemStatusCancelled},
		},
	}
	if got := effectiveOrderStatus(order); got != entity.OrderStatusOpen {
		t.Fatalf("effective status = %q, want %q", got, entity.OrderStatusOpen)
	}
}

func TestEffectiveOrderStatusDoesNotMaskIncompleteOrTerminalOrders(t *testing.T) {
	incomplete := &entity.Order{
		Status: entity.OrderStatusCooking,
		Items: []entity.OrderItem{
			{Status: entity.OrderItemStatusReady},
			{Status: entity.OrderItemStatusCooking},
		},
	}
	if got := effectiveOrderStatus(incomplete); got != entity.OrderStatusCooking {
		t.Fatalf("incomplete effective status = %q, want %q", got, entity.OrderStatusCooking)
	}
	if err := validateOrderReadyForPayment(incomplete); err == nil {
		t.Fatal("incomplete kitchen order should remain blocked from payment")
	}

	completed := &entity.Order{
		Status: entity.OrderStatusCompleted,
		Items:  []entity.OrderItem{{Status: entity.OrderItemStatusServed}},
	}
	if got := effectiveOrderStatus(completed); got != entity.OrderStatusCompleted {
		t.Fatalf("terminal effective status = %q, want %q", got, entity.OrderStatusCompleted)
	}
}

func TestNormalizeReceivedAmountRejectsNegativeCash(t *testing.T) {
	if _, err := normalizeReceivedAmount("cash", -1, 100); err == nil {
		t.Fatal("negative cash amount should be rejected")
	}
	if got, err := normalizeReceivedAmount("cash", 0, 100); err != nil || got != 100 {
		t.Fatalf("zero cash amount = %v, %v; want exact total", got, err)
	}
	if got, err := normalizeReceivedAmount("promptpay_qr", 1, 100); err != nil || got != 100 {
		t.Fatalf("PromptPay amount = %v, %v; want exact total", got, err)
	}
}

func TestCanTransitionItem(t *testing.T) {
	if !canTransitionItem(entity.OrderItemStatusPending, entity.OrderItemStatusCooking) {
		t.Fatal("pending should transition to cooking")
	}
	if !canTransitionItem(entity.OrderItemStatusReady, entity.OrderItemStatusCooking) {
		t.Fatal("ready should transition back to cooking")
	}
	if canTransitionItem(entity.OrderItemStatusReady, entity.OrderItemStatusPending) {
		t.Fatal("ready should not transition back to pending")
	}
	if !canTransitionItem(entity.OrderItemStatusServed, entity.OrderItemStatusCancelled) {
		t.Fatal("served should be voidable via cancellation during checkout")
	}
	if canTransitionItem(entity.OrderItemStatusServed, entity.OrderItemStatusCooking) {
		t.Fatal("served should not reopen to cooking")
	}
	if canTransitionItem(entity.OrderItemStatusCancelled, entity.OrderItemStatusCancelled) {
		t.Fatal("cancelled should be terminal for item status")
	}
}

func TestValidateOrderItemStatusActor(t *testing.T) {
	tests := []struct {
		name   string
		actor  OrderItemStatusActor
		status string
		want   bool
	}{
		{name: "kitchen manager may update cooking", actor: OrderItemStatusActorKitchenManager, status: entity.OrderItemStatusCooking, want: true},
		{name: "kitchen manager may void", actor: OrderItemStatusActorKitchenManager, status: entity.OrderItemStatusCancelled, want: true},
		{name: "front of house may serve", actor: OrderItemStatusActorFrontOfHouse, status: entity.OrderItemStatusServed, want: true},
		{name: "front of house may request a checkout void", actor: OrderItemStatusActorFrontOfHouse, status: entity.OrderItemStatusCancelled, want: true},
		{name: "front of house may not mark cooking", actor: OrderItemStatusActorFrontOfHouse, status: entity.OrderItemStatusCooking, want: false},
		{name: "unknown actor is rejected", actor: OrderItemStatusActor("unknown"), status: entity.OrderItemStatusCancelled, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateOrderItemStatusActor(test.actor, test.status)
			if test.want && err != nil {
				t.Fatalf("validateOrderItemStatusActor() error = %v, want nil", err)
			}
			if !test.want && !errors.Is(err, ErrOrderItemStatusForbidden) {
				t.Fatalf("validateOrderItemStatusActor() error = %v, want forbidden", err)
			}
		})
	}
}

func TestShouldAutoCancelTakeawayOrder(t *testing.T) {
	takeaway := &entity.Order{OrderType: entity.OrderTypeTakeaway}
	dineIn := &entity.Order{OrderType: entity.OrderTypeDineIn}
	allCancelled := []entity.OrderItem{
		{Status: entity.OrderItemStatusCancelled},
		{Status: entity.OrderItemStatusCancelled},
	}

	if !shouldAutoCancelTakeawayOrder(takeaway, allCancelled) {
		t.Fatal("takeaway should close when every item is cancelled")
	}
	if shouldAutoCancelTakeawayOrder(dineIn, allCancelled) {
		t.Fatal("dine-in order should stay open so its table can use the empty-table close flow")
	}
	if shouldAutoCancelTakeawayOrder(takeaway, nil) {
		t.Fatal("a newly opened takeaway without items should not auto-close")
	}
	if shouldAutoCancelTakeawayOrder(takeaway, []entity.OrderItem{{Status: entity.OrderItemStatusReady}, {Status: entity.OrderItemStatusCancelled}}) {
		t.Fatal("takeaway should stay active while any non-cancelled item remains")
	}
}

func TestNormalizeItemCancellationReason(t *testing.T) {
	got, err := normalizeItemCancellationReason(entity.OrderItemStatusCancelled, "  ของหมด  ")
	if err != nil {
		t.Fatalf("valid cancellation reason rejected: %v", err)
	}
	if got != "ของหมด" {
		t.Fatalf("normalized cancellation reason = %q, want %q", got, "ของหมด")
	}

	for _, reason := range []string{"", "   "} {
		if _, err := normalizeItemCancellationReason(entity.OrderItemStatusCancelled, reason); err == nil {
			t.Fatalf("blank cancellation reason %q should be rejected", reason)
		}
	}

	if _, err := normalizeItemCancellationReason(
		entity.OrderItemStatusCancelled,
		strings.Repeat("ก", 501),
	); err == nil {
		t.Fatal("cancellation reason longer than 500 characters should be rejected")
	}

	if got, err := normalizeItemCancellationReason(entity.OrderItemStatusCooking, "ignored"); err != nil || got != "" {
		t.Fatalf("non-cancellation transition reason = %q, %v; want empty reason", got, err)
	}
}

func TestOrderSubtotalFromItemsExcludesCancelledItems(t *testing.T) {
	items := []entity.OrderItem{
		{Subtotal: 120, Status: entity.OrderItemStatusReady},
		{Subtotal: 80, Status: entity.OrderItemStatusCancelled},
		{Subtotal: 50, Status: entity.OrderItemStatusCooking},
	}
	if got := orderSubtotalFromItems(items); got != 170 {
		t.Fatalf("order subtotal = %v, want 170", got)
	}
}

func TestValidateEmptyTableClose(t *testing.T) {
	tableID := uint(7)
	tests := []struct {
		name    string
		order   *entity.Order
		wantErr string
	}{
		{
			name: "allows an open dine-in table without items",
			order: &entity.Order{
				OrderType: entity.OrderTypeDineIn,
				TableID:   &tableID,
				Status:    entity.OrderStatusOpen,
			},
		},
		{
			name: "rejects takeaway orders",
			order: &entity.Order{
				OrderType: entity.OrderTypeTakeaway,
				Status:    entity.OrderStatusOpen,
			},
			wantErr: "only an empty dine-in table can be closed",
		},
		{
			name: "rejects orders after kitchen send",
			order: &entity.Order{
				OrderType: entity.OrderTypeDineIn,
				TableID:   &tableID,
				Status:    entity.OrderStatusCooking,
			},
			wantErr: "only an open table can be closed without an order",
		},
		{
			name: "rejects orders with items",
			order: &entity.Order{
				OrderType: entity.OrderTypeDineIn,
				TableID:   &tableID,
				Status:    entity.OrderStatusOpen,
				Items:     []entity.OrderItem{{}},
			},
			wantErr: "table order already has items",
		},
		{
			name: "allows a table whose items were all cancelled",
			order: &entity.Order{
				OrderType: entity.OrderTypeDineIn,
				TableID:   &tableID,
				Status:    entity.OrderStatusOpen,
				Items: []entity.OrderItem{
					{Status: entity.OrderItemStatusCancelled},
					{Status: entity.OrderItemStatusCancelled},
				},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateEmptyTableClose(test.order)
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("validateEmptyTableClose() error = %v, want nil", err)
				}
				return
			}
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("validateEmptyTableClose() error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestRecipeComponentCostUsesYield(t *testing.T) {
	if got := recipeComponentCost(2, 10, 100); got != 20 {
		t.Fatalf("recipeComponentCost with full yield = %v, want 20", got)
	}
	if got := recipeComponentCost(2, 10, 80); got != 25 {
		t.Fatalf("recipeComponentCost with 80 percent yield = %v, want 25", got)
	}
	if got := recipeComponentCost(2, 10, 0); got != 20 {
		t.Fatalf("recipeComponentCost with empty yield = %v, want 20", got)
	}
}

func TestValidateOrderReadyForPaymentAcceptsKitchenCompletedItems(t *testing.T) {
	order := &entity.Order{
		Status: entity.OrderStatusReady,
		Items: []entity.OrderItem{
			{Status: entity.OrderItemStatusReady},
			{Status: entity.OrderItemStatusPending},
		},
	}

	if err := validateOrderReadyForPayment(order); err == nil {
		t.Fatal("expected payment validation to reject an order with a pending item")
	}

	order.Items[1].Status = entity.OrderItemStatusCancelled
	if err := validateOrderReadyForPayment(order); err != nil {
		t.Fatalf("expected cancelled items to be ignored, got %v", err)
	}

	order.Status = entity.OrderStatusServed
	order.Items[0].Status = entity.OrderItemStatusServed
	if err := validateOrderReadyForPayment(order); err != nil {
		t.Fatalf("expected legacy served items to remain payable, got %v", err)
	}
}

func TestPendingItemReopensKitchenCompletedOrder(t *testing.T) {
	for _, status := range []string{entity.OrderStatusReady, entity.OrderStatusServed} {
		if got := orderStatusAfterPendingItemAdded(status); got != entity.OrderStatusOpen {
			t.Fatalf("%s order status after adding pending item = %q, want %q", status, got, entity.OrderStatusOpen)
		}
	}
	if got := orderStatusAfterPendingItemAdded(entity.OrderStatusCooking); got != entity.OrderStatusCooking {
		t.Fatalf("cooking order status after adding pending item = %q, want unchanged", got)
	}
}

func TestPaidBillUsesTaxAndServiceSnapshots(t *testing.T) {
	order := &entity.Order{
		Subtotal:                     100,
		TotalAmount:                  100,
		GrandTotal:                   117.7,
		ServiceChargeAmount:          10,
		VATAmount:                    7.7,
		PaymentStatus:                entity.PaymentStatusPaid,
		ServiceChargeEnabledSnapshot: true,
		ServiceChargeRateSnapshot:    10,
		VATEnabledSnapshot:           true,
		VATRateSnapshot:              7,
	}
	restaurant := &entity.Restaurant{
		ServiceChargeEnabled: false,
		ServiceChargeRate:    0,
		VATEnabled:           false,
		VATRate:              0,
	}

	bill := billFromOrder(order, restaurant)
	if !bill.ServiceChargeEnabled || bill.ServiceChargeRate != 10 {
		t.Fatalf("paid service snapshot = enabled %v rate %v", bill.ServiceChargeEnabled, bill.ServiceChargeRate)
	}
	if !bill.VATEnabled || bill.VATRate != 7 {
		t.Fatalf("paid VAT snapshot = enabled %v rate %v", bill.VATEnabled, bill.VATRate)
	}
}

func TestBuildOrderItemRecipeSnapshotsCopiesRecipeAndCostInputs(t *testing.T) {
	order := &entity.Order{RestaurantID: 7}
	order.ID = 11
	item := &entity.OrderItem{OrderID: order.ID, RestaurantID: order.RestaurantID, MenuID: 13}
	item.ID = 17
	ingredient := &entity.Ingredient{
		Name:         "Rice",
		Unit:         "g",
		CostPerUnit:  0.12,
		YieldPercent: 92,
	}
	ingredient.ID = 19
	components := []entity.MenuItemIngredient{{
		IngredientID: ingredient.ID,
		Quantity:     180,
		Unit:         "",
		Ingredient:   ingredient,
	}}

	lines, err := mergeRecipeWithOptions(components, nil)
	if err != nil {
		t.Fatalf("mergeRecipeWithOptions() error = %v", err)
	}
	snapshots := buildOrderItemRecipeSnapshots(order, item, lines)
	if len(snapshots) != 1 {
		t.Fatalf("snapshot count = %d, want 1", len(snapshots))
	}
	got := snapshots[0]
	if got.OrderID != order.ID || got.OrderItemID != item.ID || got.MenuItemID != item.MenuID {
		t.Fatalf("snapshot references = %+v", got)
	}
	if got.IngredientID != ingredient.ID || got.IngredientName != ingredient.Name || got.Unit != ingredient.Unit {
		t.Fatalf("snapshot ingredient identity = %+v", got)
	}
	if got.QuantityPerItem != 180 || got.CostPerUnit != ingredient.CostPerUnit || got.YieldPercent != ingredient.YieldPercent {
		t.Fatalf("snapshot recipe inputs = %+v", got)
	}
}

// The option-to-recipe merge is where a wrong number becomes a wrong shelf, so
// each case below is one way an owner can arrange options against a recipe.
func TestMergeRecipeWithOptions(t *testing.T) {
	shrimp := &entity.Ingredient{Name: "Shrimp", Unit: "g", CostPerUnit: 0.5, YieldPercent: 100}
	shrimp.ID = 1
	greens := &entity.Ingredient{Name: "Greens", Unit: "g", CostPerUnit: 0.1, YieldPercent: 100}
	greens.ID = 2
	garlic := &entity.Ingredient{Name: "Garlic", Unit: "g", CostPerUnit: 0.2, YieldPercent: 100}
	garlic.ID = 3

	recipe := func() []entity.MenuItemIngredient {
		return []entity.MenuItemIngredient{
			{IngredientID: shrimp.ID, Quantity: 50, Unit: "g", Ingredient: shrimp},
			{IngredientID: greens.ID, Quantity: 30, Unit: "g", Ingredient: greens},
		}
	}
	option := func(rows ...entity.MenuOptionIngredient) selectedMenuOption {
		return selectedMenuOption{ID: 99, Ingredients: rows}
	}
	add := func(ing *entity.Ingredient, qty float64) entity.MenuOptionIngredient {
		return entity.MenuOptionIngredient{
			IngredientID: ing.ID, Direction: entity.MenuOptionIngredientAdd,
			Quantity: qty, Unit: ing.Unit, Ingredient: ing,
		}
	}
	remove := func(ing *entity.Ingredient, qty float64) entity.MenuOptionIngredient {
		return entity.MenuOptionIngredient{
			IngredientID: ing.ID, Direction: entity.MenuOptionIngredientRemove,
			Quantity: qty, Unit: ing.Unit, Ingredient: ing,
		}
	}

	tests := []struct {
		name    string
		options []selectedMenuOption
		want    map[uint]float64
	}{
		{
			name: "no options leaves the recipe alone",
			want: map[uint]float64{shrimp.ID: 50, greens.ID: 30},
		},
		{
			name:    "adding an ingredient the recipe already uses merges into one line",
			options: []selectedMenuOption{option(add(shrimp, 20))},
			want:    map[uint]float64{shrimp.ID: 70, greens.ID: 30},
		},
		{
			name:    "adding an ingredient the recipe lacks appends a line",
			options: []selectedMenuOption{option(add(garlic, 5))},
			want:    map[uint]float64{shrimp.ID: 50, greens.ID: 30, garlic.ID: 5},
		},
		{
			name:    "removing part of a line subtracts",
			options: []selectedMenuOption{option(remove(greens, 10))},
			want:    map[uint]float64{shrimp.ID: 50, greens.ID: 20},
		},
		{
			name:    "removing the whole line drops it instead of writing a zero",
			options: []selectedMenuOption{option(remove(greens, 30))},
			want:    map[uint]float64{shrimp.ID: 50},
		},
		{
			name:    "removing more than the recipe holds never goes negative",
			options: []selectedMenuOption{option(remove(greens, 500))},
			want:    map[uint]float64{shrimp.ID: 50},
		},
		{
			name:    "removing an ingredient the recipe never had is a no-op",
			options: []selectedMenuOption{option(remove(garlic, 5))},
			want:    map[uint]float64{shrimp.ID: 50, greens.ID: 30},
		},
		{
			name:    "two options touching the same ingredient both count",
			options: []selectedMenuOption{option(add(shrimp, 20)), option(add(shrimp, 10))},
			want:    map[uint]float64{shrimp.ID: 80, greens.ID: 30},
		},
		{
			name:    "an add and a remove on the same ingredient cancel",
			options: []selectedMenuOption{option(add(garlic, 5)), option(remove(garlic, 5))},
			want:    map[uint]float64{shrimp.ID: 50, greens.ID: 30},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			lines, err := mergeRecipeWithOptions(recipe(), test.options)
			if err != nil {
				t.Fatalf("mergeRecipeWithOptions() error = %v", err)
			}
			if len(lines) != len(test.want) {
				t.Fatalf("line count = %d, want %d (%+v)", len(lines), len(test.want), lines)
			}
			seen := map[uint]bool{}
			for _, line := range lines {
				want, ok := test.want[line.ingredientID]
				if !ok {
					t.Fatalf("unexpected ingredient %d in merged lines", line.ingredientID)
				}
				if seen[line.ingredientID] {
					t.Fatalf("ingredient %d appears twice; the snapshot unique index would reject it", line.ingredientID)
				}
				seen[line.ingredientID] = true
				if math.Abs(line.quantity-want) > 1e-9 {
					t.Fatalf("ingredient %d quantity = %v, want %v", line.ingredientID, line.quantity, want)
				}
				if line.quantity <= 0 {
					t.Fatalf("ingredient %d quantity %v would violate quantity_per_item > 0", line.ingredientID, line.quantity)
				}
			}
		})
	}
}

func TestMergeRecipeWithOptionsRejectsUnavailableIngredients(t *testing.T) {
	// A missing Ingredient pointer means the join found nothing. Deducting a
	// nameless ingredient at zero cost would be worse than refusing the order.
	if _, err := mergeRecipeWithOptions([]entity.MenuItemIngredient{{IngredientID: 1, Quantity: 5}}, nil); err == nil {
		t.Fatal("recipe with an unavailable ingredient was accepted")
	}
	options := []selectedMenuOption{{ID: 1, Ingredients: []entity.MenuOptionIngredient{{
		IngredientID: 9, Direction: entity.MenuOptionIngredientAdd, Quantity: 2,
	}}}}
	if _, err := mergeRecipeWithOptions(nil, options); err == nil {
		t.Fatal("option with an unavailable ingredient was accepted")
	}
}

func TestValidateCustomerSubmitRequestBounds(t *testing.T) {
	valid := &SubmitCustomerOrderRequest{
		Items: []CustomerCartItemRequest{{
			MenuID:            1,
			Quantity:          2,
			Note:              "less spicy",
			SelectedOptionIDs: []uint{3},
		}},
	}
	key := "550e8400-e29b-41d4-a716-446655440000"
	if err := validateCustomerSubmitRequest(key, valid); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}

	tests := []struct {
		name string
		key  string
		req  *SubmitCustomerOrderRequest
	}{
		{name: "short key", key: "short", req: valid},
		{name: "empty cart", key: key, req: &SubmitCustomerOrderRequest{}},
		{name: "zero quantity", key: key, req: &SubmitCustomerOrderRequest{Items: []CustomerCartItemRequest{{MenuID: 1}}}},
		{name: "quantity too large", key: key, req: &SubmitCustomerOrderRequest{Items: []CustomerCartItemRequest{{MenuID: 1, Quantity: customerOrderMaxItemQuantity + 1}}}},
		{name: "note too long", key: key, req: &SubmitCustomerOrderRequest{Items: []CustomerCartItemRequest{{MenuID: 1, Quantity: 1, Note: strings.Repeat("ก", customerOrderMaxItemNoteRunes+1)}}}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateCustomerSubmitRequest(test.key, test.req); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestCustomerSubmissionHashCanonicalizesSelectedOptionOrder(t *testing.T) {
	left := &SubmitCustomerOrderRequest{Items: []CustomerCartItemRequest{{
		MenuID:            4,
		Quantity:          2,
		Note:              "  no onion ",
		SelectedOptionIDs: []uint{9, 2},
	}}}
	right := &SubmitCustomerOrderRequest{Items: []CustomerCartItemRequest{{
		MenuID:            4,
		Quantity:          2,
		Note:              "no onion",
		SelectedOptionIDs: []uint{2, 9},
	}}}

	if customerSubmissionHash(left) != customerSubmissionHash(right) {
		t.Fatal("semantically identical requests should have the same hash")
	}
	right.Items[0].Quantity = 3
	if customerSubmissionHash(left) == customerSubmissionHash(right) {
		t.Fatal("different requests should not have the same hash")
	}
}

func TestPublicCustomerDTOsOmitSensitiveFields(t *testing.T) {
	table := &entity.RestaurantTable{
		RestaurantID:     9,
		TableNumber:      "T01",
		DisplayLabel:     "1",
		Capacity:         4,
		CustomerToken:    "must-not-leak",
		ReservationName:  "private",
		ReservationPhone: "private",
	}
	table.ID = 5
	order := &entity.Order{
		RestaurantID:  9,
		TableID:       &table.ID,
		OrderNumber:   "A001",
		StaffID:       22,
		CustomerName:  "private",
		CustomerPhone: "private",
		Status:        entity.OrderStatusCooking,
		Items: []entity.OrderItem{{
			MenuName: "Rice",
			Quantity: 1,
			Subtotal: 50,
			Status:   entity.OrderItemStatusCooking,
		}},
	}
	order.ID = 8
	order.Items[0].ID = 13
	order.Items[0].Menu = &entity.MenuItem{ImageURL: "/uploads/menu/rice.webp"}
	category := &entity.Category{
		RestaurantID: 9,
		Name:         "Rice dishes",
		DisplayOrder: 1,
		IsActive:     true,
	}
	category.ID = 21
	menu := entity.MenuItem{
		RestaurantID: 9,
		CategoryID:   category.ID,
		Category:     category,
		Name:         "Rice",
		Price:        50,
		IsAvailable:  true,
	}
	menu.ID = 34

	payload := struct {
		Table     CustomerTableDTO      `json:"table"`
		MenuItems []CustomerMenuItemDTO `json:"menu_items"`
		Order     *CustomerOrderDTO     `json:"order"`
	}{
		Table:     customerTableDTO(table),
		MenuItems: customerMenuItemDTOs([]entity.MenuItem{menu}, nil),
		Order:     customerOrderDTO(order),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal public DTO: %v", err)
	}
	serialized := string(data)
	for _, forbidden := range []string{
		"must-not-leak",
		"reservation_name",
		"reservation_phone",
		"customer_name",
		"customer_phone",
		"customer_token",
		"restaurant_id",
		"staff_id",
		"table_id",
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("public DTO leaked %q: %s", forbidden, serialized)
		}
	}
	if !strings.Contains(serialized, `"category":{"ID":21,"name":"Rice dishes"`) {
		t.Fatalf("public menu DTO omitted its safe primary category: %s", serialized)
	}
	if !strings.Contains(serialized, `"image_url":"/uploads/menu/rice.webp"`) {
		t.Fatalf("public order item DTO omitted its menu image: %s", serialized)
	}
}
