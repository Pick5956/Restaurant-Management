package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm/clause"
)

// orderItemNetRevenue is what one order line actually sold for: its price less
// any discount stored on it. Only bills from the retired promotions carry a
// line discount, and they keep it, so every per-dish revenue figure (reports
// and the assistant alike) still sums this rather than the gross subtotal.
const orderItemNetRevenue = "(order_items.subtotal - order_items.discount_amount)"

// ListRepriceableOrderIDs returns the orders a bill-settings change can still
// affect: not paid, not cancelled.
func (r *OrderRepository) ListRepriceableOrderIDs(restaurantID uint) ([]uint, error) {
	var ids []uint
	err := r.db.Model(&entity.Order{}).
		Where("restaurant_id = ? AND payment_status = ? AND status NOT IN ?",
			restaurantID, entity.PaymentStatusUnpaid, []string{entity.OrderStatusCompleted, entity.OrderStatusCancelled}).
		Order("id asc").
		Pluck("id", &ids).Error
	return ids, err
}

// LockOrderForPricing locks one order row without its details, for repricing.
func (r *OrderRepository) LockOrderForPricing(restaurantID, orderID uint) (*entity.Order, error) {
	var order entity.Order
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND id = ?", restaurantID, orderID).
		First(&order).Error
	if err != nil {
		return nil, err
	}
	return &order, nil
}
