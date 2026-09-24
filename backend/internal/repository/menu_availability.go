package repository

import (
	"math"

	"gorm.io/gorm"
)

// MenuRemainingServings reports, for every menu item that is limited by its recipe,
// how many more portions can still be made right now:
//
//	remaining(menu) = min over recipe ingredients of floor((stock - committed) / qtyPerPortion)
//
// "committed" is the recipe demand of every order item still queued and NOT yet
// deducted from stock — that is items in status pending or cooking. Stock is deducted
// the moment an item is marked ready (see deductInventoryForCompletedKitchenItem), so
// ready/served items must NOT be counted here: their consumption already shows up in
// ing.stock, and reserving them again would subtract the same portions twice and make
// a dish look sold out while raw stock is still on hand. This is the "available to
// promise" view: it lets the ordering UIs show a dish as sold out the moment the
// pending queue has claimed the last portion, without waiting for the kitchen to cook.
//
// Only orders still in service commit anything. A cancelled order's unsent lines
// will never be cooked, so counting them kept a dish sold out for as long as the
// row existed; a completed order has nothing left to cook either.
//
// Menu items without any recipe are NOT included in the map (they are not limited by
// stock). Returned counts are clamped to >= 0.
func MenuRemainingServings(db *gorm.DB, restaurantID uint) (map[uint]int, error) {
	type usageRow struct {
		IngredientID uint
		Committed    float64
	}
	var usage []usageRow
	if err := db.Raw(`
SELECT mii.ingredient_id AS ingredient_id, COALESCE(SUM(mii.quantity * oi.quantity), 0) AS committed
FROM order_items oi
JOIN orders o ON o.id = oi.order_id AND o.deleted_at IS NULL AND o.status NOT IN ('completed','cancelled')
JOIN menu_item_ingredients mii ON mii.menu_item_id = oi.menu_id AND mii.deleted_at IS NULL AND mii.restaurant_id = ?
WHERE oi.restaurant_id = ? AND oi.deleted_at IS NULL AND oi.status IN ('pending','cooking')
GROUP BY mii.ingredient_id`, restaurantID, restaurantID).Scan(&usage).Error; err != nil {
		return nil, err
	}
	committedByIngredient := make(map[uint]float64, len(usage))
	for _, row := range usage {
		committedByIngredient[row.IngredientID] = row.Committed
	}

	type recipeRow struct {
		MenuItemID   uint
		IngredientID uint
		Quantity     float64
		Stock        float64
	}
	var recipes []recipeRow
	if err := db.Raw(`
SELECT mii.menu_item_id AS menu_item_id, mii.ingredient_id AS ingredient_id, mii.quantity AS quantity, ing.stock AS stock
FROM menu_item_ingredients mii
JOIN ingredients ing ON ing.id = mii.ingredient_id AND ing.deleted_at IS NULL
WHERE mii.restaurant_id = ? AND mii.deleted_at IS NULL`, restaurantID).Scan(&recipes).Error; err != nil {
		return nil, err
	}

	remaining := make(map[uint]int, len(recipes))
	for _, row := range recipes {
		if row.Quantity <= 0 {
			continue
		}
		atp := row.Stock - committedByIngredient[row.IngredientID]
		portions := int(math.Floor(atp / row.Quantity))
		if portions < 0 {
			portions = 0
		}
		if existing, ok := remaining[row.MenuItemID]; !ok || portions < existing {
			remaining[row.MenuItemID] = portions
		}
	}
	return remaining, nil
}
