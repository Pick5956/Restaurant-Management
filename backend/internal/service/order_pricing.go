package service

import (
	"math"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// priceOrder sets an order's subtotal and totals from its current lines, and
// reports whether any money on it changed. It does not save the order;
// recalcOrderTotals does.
//
// A paid order keeps the discount it was paid under: bills paid while the
// retired automatic promotions ran still show what they took off. An open
// order carries none.
func priceOrder(tx *repository.OrderRepository, order *entity.Order) (bool, error) {
	items, err := tx.ListItems(order.ID)
	if err != nil {
		return false, err
	}
	before := orderMoney(order)
	subtotal := orderSubtotalFromItems(items)
	order.Subtotal = subtotal
	if order.PaymentStatus != entity.PaymentStatusPaid {
		order.DiscountAmount = 0
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
	return !sameMoney(before, orderMoney(order)), nil
}

// orderMoney is every amount priceOrder may move, for the changed report.
func orderMoney(order *entity.Order) []float64 {
	return []float64{
		order.Subtotal, order.DiscountAmount, order.TotalAmount,
		order.ServiceChargeAmount, order.VATAmount, order.GrandTotal,
	}
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
