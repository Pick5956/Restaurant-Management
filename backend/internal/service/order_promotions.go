package service

import (
	"math"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// priceOrder sets an order's subtotal, promotion discount and totals from its
// current lines, and reports whether any money on it changed. It does not save
// the order; recalcOrderTotals does.
//
// A paid order keeps the promotions it was paid under: editing or deleting a
// promotion later never rewrites a receipt.
func priceOrder(tx *repository.OrderRepository, order *entity.Order) (bool, error) {
	items, err := tx.ListItems(order.ID)
	if err != nil {
		return false, err
	}
	before := orderMoney(order)
	subtotal := orderSubtotalFromItems(items)
	order.Subtotal = subtotal
	promotionsChanged := false
	if order.PaymentStatus != entity.PaymentStatusPaid {
		discount, changed, err := applyOrderPromotions(tx, order, items, subtotal)
		if err != nil {
			return false, err
		}
		order.DiscountAmount = discount
		promotionsChanged = changed
	}
	if order.DiscountAmount < 0 {
		order.DiscountAmount = 0
	}
	if order.DiscountAmount > subtotal {
		order.DiscountAmount = subtotal
	}
	order.TotalAmount = subtotal - order.DiscountAmount
	if order.TotalAmount < 0 {
		order.TotalAmount = 0
	}
	if order.PaymentStatus != entity.PaymentStatusPaid {
		// The stored charges follow the restaurant's current settings while the
		// bill is open, so grand_total is what the bill shows, not the total
		// before service charge and VAT. Priced from the bill's own rounded
		// total, so the two never differ by a satang.
		restaurant, err := tx.FindRestaurant(order.RestaurantID)
		if err != nil {
			return false, err
		}
		_, _, billTotal := billAmounts(order.Subtotal, order.DiscountAmount)
		order.ServiceChargeAmount, order.VATAmount = unpaidCharges(billTotal, restaurant)
		order.GrandTotal = roundMoney(billTotal + order.ServiceChargeAmount + order.VATAmount)
	} else {
		order.GrandTotal = roundMoney(order.TotalAmount + order.ServiceChargeAmount + order.VATAmount)
	}
	return promotionsChanged || !sameMoney(before, orderMoney(order)), nil
}

// orderMoney is every amount priceOrder may move, for the changed report.
func orderMoney(order *entity.Order) []float64 {
	return []float64{
		order.Subtotal, order.DiscountAmount, order.TotalAmount,
		order.ServiceChargeAmount, order.VATAmount, order.GrandTotal,
	}
}

// applyOrderPromotions works out what the order earns from the restaurant's
// promotions right now, stores it (the applied promotions and each line's
// share), and returns the total discount and whether anything stored changed.
func applyOrderPromotions(
	tx *repository.OrderRepository,
	order *entity.Order,
	items []entity.OrderItem,
	subtotal float64,
) (float64, bool, error) {
	promotions, err := tx.ListActivePromotions(order.RestaurantID)
	if err != nil {
		return 0, false, err
	}
	lines := promotionLinesFromItems(items)
	var applied []appliedPromotion
	if len(promotions) > 0 && len(lines) > 0 {
		var categories map[uint][]uint
		if promotionsTargetCategories(promotions) {
			categories, err = tx.MenuCategoryIDs(order.RestaurantID, menuIDsOf(lines))
			if err != nil {
				return 0, false, err
			}
		}
		applied = evaluatePromotions(lines, promotions, categories, subtotal, order.OpenedAt)
	}

	lineDiscounts := map[uint]float64{}
	rows := make([]entity.OrderPromotion, 0, len(applied))
	total := 0.0
	for _, promotion := range applied {
		for itemID, amount := range promotion.ItemDiscounts {
			lineDiscounts[itemID] = roundMoney(lineDiscounts[itemID] + amount)
		}
		rows = append(rows, entity.OrderPromotion{
			RestaurantID: order.RestaurantID,
			OrderID:      order.ID,
			PromotionID:  promotion.PromotionID,
			Name:         promotion.Name,
			Type:         promotion.Type,
			Times:        promotion.Times,
			Amount:       promotion.Amount,
		})
		total += promotion.Amount
	}

	changed := false
	for i := range items {
		want := lineDiscounts[items[i].ID]
		if items[i].Status == entity.OrderItemStatusCancelled {
			want = 0
		}
		if moneyEqual(items[i].DiscountAmount, want) {
			continue
		}
		if err := tx.SetItemDiscount(items[i].ID, want); err != nil {
			return 0, false, err
		}
		items[i].DiscountAmount = want
		changed = true
	}

	stored, err := tx.ListOrderPromotions(order.ID)
	if err != nil {
		return 0, false, err
	}
	if !sameOrderPromotions(stored, rows) {
		if err := tx.ReplaceOrderPromotions(order.ID, rows); err != nil {
			return 0, false, err
		}
		changed = true
	}
	return roundMoney(total), changed, nil
}

func promotionsTargetCategories(promotions []entity.Promotion) bool {
	for _, promotion := range promotions {
		for _, target := range promotion.Targets {
			if target.CategoryID != nil {
				return true
			}
		}
	}
	return false
}

func menuIDsOf(lines []promotionLine) []uint {
	seen := map[uint]bool{}
	ids := make([]uint, 0, len(lines))
	for _, line := range lines {
		if !seen[line.MenuID] {
			seen[line.MenuID] = true
			ids = append(ids, line.MenuID)
		}
	}
	return ids
}

// sameOrderPromotions compares what is stored with what was just worked out,
// in order, on the fields a bill shows.
func sameOrderPromotions(stored, next []entity.OrderPromotion) bool {
	if len(stored) != len(next) {
		return false
	}
	for i := range stored {
		if stored[i].PromotionID != next[i].PromotionID ||
			stored[i].Name != next[i].Name ||
			stored[i].Type != next[i].Type ||
			stored[i].Times != next[i].Times ||
			!moneyEqual(stored[i].Amount, next[i].Amount) {
			return false
		}
	}
	return true
}

func moneyEqual(a, b float64) bool {
	return math.Abs(a-b) < 0.005
}

func sameMoney(a, b []float64) bool {
	for i := range a {
		if !moneyEqual(a[i], b[i]) {
			return false
		}
	}
	return true
}
