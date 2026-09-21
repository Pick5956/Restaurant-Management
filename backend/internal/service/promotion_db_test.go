package service

import (
	"strings"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

func assertOrderPrice(t *testing.T, label string, order *entity.Order, subtotal, discount, total float64) {
	t.Helper()
	if !moneyEqual(order.Subtotal, subtotal) || !moneyEqual(order.DiscountAmount, discount) || !moneyEqual(order.TotalAmount, total) {
		t.Fatalf("%s: subtotal/discount/total = %.2f/%.2f/%.2f, want %.2f/%.2f/%.2f",
			label, order.Subtotal, order.DiscountAmount, order.TotalAmount, subtotal, discount, total)
	}
}

// TestPromotionsPriceOpenOrdersAndLeavePaidBillsAlone walks one promotion
// through a whole service: it prices the order the moment a dish lands, the
// owner switching it off and on reprices the open order, payment keeps it, and
// deleting it afterwards does not touch the paid bill.
func TestPromotionsPriceOpenOrdersAndLeavePaidBillsAlone(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	restaurantID := scenario.restaurant.ID
	orders := repository.NewOrderRepository(db)
	promotions := ProvidePromotionService(repository.NewPromotionRepository(db), orders)

	created, err := promotions.Create(restaurantID, &PromotionRequest{
		Name:        "1 แถม 1",
		Type:        entity.PromotionTypeBuyXGetY,
		BuyQuantity: 1,
		GetQuantity: 1,
		Targets:     []PromotionTargetRequest{{MenuItemID: &scenario.menu.ID}},
	})
	if err != nil {
		t.Fatalf("create promotion: %v", err)
	}
	if len(created.RepricedOrders) != 0 {
		t.Fatalf("no order was open, yet %v were repriced", created.RepricedOrders)
	}
	if len(created.Promotion.Targets) != 1 {
		t.Fatalf("saved targets = %d, want 1", len(created.Promotion.Targets))
	}
	promotionID := created.Promotion.ID

	order, err := scenario.service.OpenOrder(restaurantID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	order, err = scenario.service.AddItem(restaurantID, scenario.user.ID, order.ID, &AddOrderItemRequest{
		MenuID: scenario.menu.ID, Quantity: 2, ServeImmediately: true,
	})
	if err != nil {
		t.Fatalf("add two dishes: %v", err)
	}
	assertOrderPrice(t, "after adding two", order, 200, 100, 100)
	if len(order.Promotions) != 1 || order.Promotions[0].Times != 1 || !moneyEqual(order.Promotions[0].Amount, 100) {
		t.Fatalf("order promotions = %+v, want one 1+1 worth 100", order.Promotions)
	}
	if len(order.Items) != 1 || !moneyEqual(order.Items[0].DiscountAmount, 100) {
		t.Fatalf("line discount = %+v, want 100 on the only line", order.Items)
	}

	bill, err := scenario.service.Bill(restaurantID, order.ID)
	if err != nil {
		t.Fatalf("bill: %v", err)
	}
	if !moneyEqual(bill.DiscountAmount, 100) || len(bill.Promotions) != 1 || bill.Promotions[0].Name != "1 แถม 1" {
		t.Fatalf("bill discount/promotions = %.2f/%+v", bill.DiscountAmount, bill.Promotions)
	}
	if !moneyEqual(bill.GrandTotal, bill.TotalAmount+bill.ServiceChargeAmount+bill.VATAmount) || !moneyEqual(bill.TotalAmount, 100) {
		t.Fatalf("bill total/grand = %.2f/%.2f", bill.TotalAmount, bill.GrandTotal)
	}

	off, err := promotions.SetActive(restaurantID, promotionID, false)
	if err != nil {
		t.Fatalf("switch off: %v", err)
	}
	if len(off.RepricedOrders) != 1 || off.RepricedOrders[0] != order.ID {
		t.Fatalf("switching off repriced %v, want [%d]", off.RepricedOrders, order.ID)
	}
	reloaded, err := orders.FindOrder(restaurantID, order.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	assertOrderPrice(t, "switched off", reloaded, 200, 0, 200)
	if len(reloaded.Promotions) != 0 || !moneyEqual(reloaded.Items[0].DiscountAmount, 0) {
		t.Fatalf("a switched-off promotion left %+v and line discount %.2f", reloaded.Promotions, reloaded.Items[0].DiscountAmount)
	}

	on, err := promotions.SetActive(restaurantID, promotionID, true)
	if err != nil {
		t.Fatalf("switch on: %v", err)
	}
	if len(on.RepricedOrders) != 1 {
		t.Fatalf("switching on repriced %v, want the open order", on.RepricedOrders)
	}
	unchanged, err := promotions.SetActive(restaurantID, promotionID, true)
	if err != nil {
		t.Fatalf("switch on again: %v", err)
	}
	if len(unchanged.RepricedOrders) != 0 {
		t.Fatalf("a change that moves no price still repriced %v", unchanged.RepricedOrders)
	}

	paid, err := scenario.service.PayOrder(restaurantID, scenario.user.ID, order.ID, &PayOrderRequest{Method: "cash"})
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	assertOrderPrice(t, "paid", paid, 200, 100, 100)
	if len(paid.Payments) != 1 || !moneyEqual(paid.Payments[0].Amount, paid.GrandTotal) {
		t.Fatalf("payment = %+v, want one for the grand total %.2f", paid.Payments, paid.GrandTotal)
	}

	repriced, err := promotions.Delete(restaurantID, promotionID)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(repriced) != 0 {
		t.Fatalf("deleting after payment repriced %v", repriced)
	}
	after, err := orders.FindOrder(restaurantID, order.ID)
	if err != nil {
		t.Fatalf("reload paid: %v", err)
	}
	assertOrderPrice(t, "paid, promotion deleted", after, 200, 100, 100)
	if len(after.Promotions) != 1 || after.Promotions[0].Name != "1 แถม 1" {
		t.Fatalf("paid bill lost its promotion line: %+v", after.Promotions)
	}
	list, err := promotions.List(restaurantID)
	if err != nil || len(list) != 0 {
		t.Fatalf("deleted promotion still listed: %d, %v", len(list), err)
	}
}

// TestPromotionRejectsAnotherRestaurantsDishes proves a promotion cannot point
// at a dish or category the restaurant does not own.
func TestPromotionRejectsAnotherRestaurantsDishes(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	mine := newOrderVoidDBScenario(t, db)
	theirs := newOrderVoidDBScenario(t, db)
	promotions := ProvidePromotionService(repository.NewPromotionRepository(db), repository.NewOrderRepository(db))

	_, err := promotions.Create(mine.restaurant.ID, &PromotionRequest{
		Name:          "ลดของร้านอื่น",
		Type:          entity.PromotionTypeItemDiscount,
		DiscountKind:  entity.PromotionDiscountAmount,
		DiscountValue: 10,
		Targets:       []PromotionTargetRequest{{MenuItemID: &theirs.menu.ID}},
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("another restaurant's dish was accepted: %v", err)
	}

	_, err = promotions.Create(mine.restaurant.ID, &PromotionRequest{
		Name:          "ลดหมวดร้านอื่น",
		Type:          entity.PromotionTypeItemDiscount,
		DiscountKind:  entity.PromotionDiscountAmount,
		DiscountValue: 10,
		Targets:       []PromotionTargetRequest{{CategoryID: &theirs.menu.CategoryID}},
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("another restaurant's category was accepted: %v", err)
	}
}

// TestBillDiscountUsesWhatIsLeftAfterDishPromotions checks the order of the
// two layers on a real order: the dish promotion first, then the bill
// threshold on what remains.
func TestBillDiscountUsesWhatIsLeftAfterDishPromotions(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	restaurantID := scenario.restaurant.ID
	promotions := ProvidePromotionService(repository.NewPromotionRepository(db), repository.NewOrderRepository(db))

	for _, req := range []PromotionRequest{
		{
			Name: "ลด 20 บาท", Type: entity.PromotionTypeItemDiscount,
			DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 20,
			Targets: []PromotionTargetRequest{{CategoryID: &scenario.menu.CategoryID}},
		},
		{
			Name: "ครบ 250 ลด 10%", Type: entity.PromotionTypeBillDiscount,
			DiscountKind: entity.PromotionDiscountPercent, DiscountValue: 10, MinSubtotal: 250,
		},
	} {
		if _, err := promotions.Create(restaurantID, &req); err != nil {
			t.Fatalf("create %q: %v", req.Name, err)
		}
	}

	order, err := scenario.service.OpenOrder(restaurantID, scenario.user.ID, &OpenOrderRequest{OrderType: "takeaway"})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	// Three dishes at 100: 60 off by the dish promotion leaves 240, under 250.
	order, err = scenario.service.AddItem(restaurantID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 3})
	if err != nil {
		t.Fatalf("add three: %v", err)
	}
	assertOrderPrice(t, "three dishes", order, 300, 60, 240)

	// A fourth: 400 - 80 = 320 clears 250, and 10% of 320 is 32 more.
	order, err = scenario.service.AddItem(restaurantID, scenario.user.ID, order.ID, &AddOrderItemRequest{MenuID: scenario.menu.ID, Quantity: 1})
	if err != nil {
		t.Fatalf("add a fourth: %v", err)
	}
	assertOrderPrice(t, "four dishes", order, 400, 112, 288)
	if len(order.Promotions) != 2 || order.Promotions[1].Type != entity.PromotionTypeBillDiscount {
		t.Fatalf("promotions = %+v, want the dish promotion then the bill discount", order.Promotions)
	}
}
