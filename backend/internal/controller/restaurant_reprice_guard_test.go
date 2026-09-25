package controller

import "testing"

// An open order stores its service charge and VAT. A settings save that
// changes them has to reprice the open orders and announce it, or every table
// card keeps the old total until someone touches the order.
func TestSettingsSaveRepricesOpenOrdersWhenBillChargesMove(t *testing.T) {
	for _, call := range []string{"BillChargesChanged", "RepriceOpenOrders", "publishOrdersRepriced"} {
		if !handlerCalls(t, "restaurant.go", "RestaurantController.Update", call) {
			t.Errorf("RestaurantController.Update no longer calls %s", call)
		}
	}
	// The promotion path announces through the same helper.
	if !handlerCalls(t, "promotion.go", "PromotionController.publishRepriced", "publishOrdersRepriced") {
		t.Error("PromotionController.publishRepriced no longer goes through publishOrdersRepriced")
	}
}

// A stale form's image URL, whose file was removed when the photo changed,
// must not be saved and then release the photo the dish has now.
func TestMenuUpdateKeepsThePhotoAgainstAStaleForm(t *testing.T) {
	if !handlerCalls(t, "menu.go", "MenuController.UpdateMenuItem", "staleMenuImage") {
		t.Error("MenuController.UpdateMenuItem no longer checks for a stale image URL")
	}
}
