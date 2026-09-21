package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// orderItemNetRevenue is what one order line actually sold for: its price less
// the dish-level promotions on it. Every per-dish revenue figure (reports and
// the assistant alike) sums this, so a "1 แถม 1" dish is not counted at twice
// the money it took. Bill-level promotions are not spread over dishes; they
// show in the order totals.
const orderItemNetRevenue = "(order_items.subtotal - order_items.discount_amount)"

// ListActivePromotions returns the promotions an order is priced with, targets
// included. Switched-off and deleted promotions never reach the engine.
func (r *OrderRepository) ListActivePromotions(restaurantID uint) ([]entity.Promotion, error) {
	var promotions []entity.Promotion
	err := r.db.
		Preload("Targets", func(db *gorm.DB) *gorm.DB { return db.Order("group_index asc, id asc") }).
		Where("restaurant_id = ? AND is_active = ?", restaurantID, true).
		Order("id asc").
		Find(&promotions).Error
	return promotions, err
}

// MenuCategoryIDs maps each menu item to every category it is listed under: its
// main category and any extra ones. A menu item deleted since it was ordered
// keeps the categories it was sold under.
func (r *OrderRepository) MenuCategoryIDs(restaurantID uint, menuIDs []uint) (map[uint][]uint, error) {
	byMenu := map[uint][]uint{}
	if len(menuIDs) == 0 {
		return byMenu, nil
	}
	var rows []struct {
		MenuID     uint
		CategoryID uint
	}
	err := r.db.Raw(`
		SELECT id AS menu_id, category_id FROM menu_items
		 WHERE restaurant_id = ? AND id IN ?
		UNION
		SELECT menu_item_id AS menu_id, category_id FROM menu_item_categories
		 WHERE restaurant_id = ? AND menu_item_id IN ? AND deleted_at IS NULL`,
		restaurantID, menuIDs, restaurantID, menuIDs,
	).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		byMenu[row.MenuID] = append(byMenu[row.MenuID], row.CategoryID)
	}
	return byMenu, nil
}

func (r *OrderRepository) ListOrderPromotions(orderID uint) ([]entity.OrderPromotion, error) {
	var rows []entity.OrderPromotion
	err := r.db.Where("order_id = ?", orderID).Order("id asc").Find(&rows).Error
	return rows, err
}

// ReplaceOrderPromotions swaps an order's applied promotions for a new set.
// The rows are derived from the order's lines, so the old ones are removed
// outright rather than soft-deleted.
func (r *OrderRepository) ReplaceOrderPromotions(orderID uint, rows []entity.OrderPromotion) error {
	if err := r.db.Unscoped().Where("order_id = ?", orderID).Delete(&entity.OrderPromotion{}).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	return r.db.Omit(clause.Associations).Create(&rows).Error
}

func (r *OrderRepository) SetItemDiscount(itemID uint, amount float64) error {
	return r.db.Model(&entity.OrderItem{}).Where("id = ?", itemID).UpdateColumn("discount_amount", amount).Error
}

// ListRepriceableOrderIDs returns the orders a promotion change can still
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
