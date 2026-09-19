package repository

import (
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Lot access is written once against *gorm.DB and exposed from both the
// ingredient repository (restock, count, discard) and the order repository (the
// kitchen deduction), so the two paths that move stock cannot drift apart on
// how a lot is drained.

// lotDrainOrder is FEFO: the lot that goes off soonest is used first. A lot
// with no date sorts last — nothing says it has gone off — and ties break on
// the older delivery.
const lotDrainOrder = "expires_at ASC NULLS LAST, received_at ASC, id ASC"

func listOpenLotsForUpdate(db *gorm.DB, restaurantID, ingredientID uint) ([]entity.IngredientLot, error) {
	var lots []entity.IngredientLot
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND ingredient_id = ? AND remaining > 0", restaurantID, ingredientID).
		Order(lotDrainOrder).
		Find(&lots).Error
	return lots, err
}

func listOpenLots(db *gorm.DB, restaurantID, ingredientID uint) ([]entity.IngredientLot, error) {
	var lots []entity.IngredientLot
	err := db.Where("restaurant_id = ? AND ingredient_id = ? AND remaining > 0", restaurantID, ingredientID).
		Order(lotDrainOrder).
		Find(&lots).Error
	return lots, err
}

func createLot(db *gorm.DB, lot *entity.IngredientLot) error {
	return db.Create(lot).Error
}

func saveLotRemaining(db *gorm.DB, lotID uint, remaining float64) error {
	return db.Model(&entity.IngredientLot{}).Where("id = ?", lotID).Update("remaining", remaining).Error
}

func saveLotExpiry(db *gorm.DB, restaurantID, ingredientID, lotID uint, expiresAt *time.Time) (int64, error) {
	result := db.Model(&entity.IngredientLot{}).
		Where("id = ? AND restaurant_id = ? AND ingredient_id = ?", lotID, restaurantID, ingredientID).
		Update("expires_at", expiresAt)
	return result.RowsAffected, result.Error
}

func findOpenLotForUpdate(db *gorm.DB, restaurantID, ingredientID, lotID uint) (*entity.IngredientLot, error) {
	var lot entity.IngredientLot
	err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND restaurant_id = ? AND ingredient_id = ? AND remaining > 0", lotID, restaurantID, ingredientID).
		First(&lot).Error
	if err != nil {
		return nil, err
	}
	return &lot, nil
}

func sumLotRemaining(db *gorm.DB, restaurantID, ingredientID uint) (float64, error) {
	var total float64
	err := db.Model(&entity.IngredientLot{}).
		Where("restaurant_id = ? AND ingredient_id = ?", restaurantID, ingredientID).
		Select("COALESCE(SUM(remaining), 0)").
		Scan(&total).Error
	return total, err
}

// drainLots applies a consumption of `quantity` across the open lots in FEFO
// order and persists every touched lot. It returns what could not be covered,
// which is > 0 only when the lots hold less than ingredients.stock — a broken
// invariant the caller decides how to report.
func drainLots(db *gorm.DB, restaurantID, ingredientID uint, quantity float64) (float64, error) {
	if quantity <= 0 {
		return 0, nil
	}
	lots, err := listOpenLotsForUpdate(db, restaurantID, ingredientID)
	if err != nil {
		return quantity, err
	}
	left := quantity
	for _, lot := range lots {
		if left <= 0 {
			break
		}
		take := lot.Remaining
		if take > left {
			take = left
		}
		if err := saveLotRemaining(db, lot.ID, lot.Remaining-take); err != nil {
			return left, err
		}
		left -= take
	}
	return left, nil
}

// shrinkLotsOldestFirst is the physical-count case: the shelf holds less than
// the lots say. Nobody knows which delivery the missing amount came from, so it
// is taken from the OLDEST delivery first — the assumption that what is gone
// was the old stock, which is the safe direction for food.
func shrinkLotsOldestFirst(db *gorm.DB, restaurantID, ingredientID uint, quantity float64) (float64, error) {
	if quantity <= 0 {
		return 0, nil
	}
	var lots []entity.IngredientLot
	if err := db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND ingredient_id = ? AND remaining > 0", restaurantID, ingredientID).
		Order("received_at ASC, id ASC").
		Find(&lots).Error; err != nil {
		return quantity, err
	}
	left := quantity
	for _, lot := range lots {
		if left <= 0 {
			break
		}
		take := lot.Remaining
		if take > left {
			take = left
		}
		if err := saveLotRemaining(db, lot.ID, lot.Remaining-take); err != nil {
			return left, err
		}
		left -= take
	}
	return left, nil
}

// ReconcileLotsToStock makes the lots agree with ingredients.stock after a write
// that touched stock directly (the daily seeder does; so did every path before
// lots existed). A surplus becomes one undated lot; a shortfall is drained
// FEFO. It is the safety net that keeps SUM(remaining) == stock true even for
// code that does not know lots exist.
func ReconcileLotsToStock(db *gorm.DB, restaurantID, ingredientID uint, now time.Time) error {
	var ingredient entity.Ingredient
	if err := db.Select("id, restaurant_id, stock, cost_per_unit").
		Where("id = ? AND restaurant_id = ?", ingredientID, restaurantID).
		First(&ingredient).Error; err != nil {
		return err
	}
	total, err := sumLotRemaining(db, restaurantID, ingredientID)
	if err != nil {
		return err
	}
	diff := ingredient.Stock - total
	const epsilon = 0.00005 // numeric(18,4) resolution
	switch {
	case diff > epsilon:
		return createLot(db, &entity.IngredientLot{
			RestaurantID: restaurantID,
			IngredientID: ingredientID,
			Quantity:     diff,
			Remaining:    diff,
			ReceivedAt:   now,
			CostPerUnit:  ingredient.CostPerUnit,
		})
	case diff < -epsilon:
		_, err := drainLots(db, restaurantID, ingredientID, -diff)
		return err
	}
	return nil
}

// AttachExpiringLots fills Ingredient.ExpiringLot for a page of ingredients in
// one query: the open, dated lot that goes off soonest per ingredient.
func attachExpiringLots(db *gorm.DB, restaurantID uint, items []entity.Ingredient) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	type row struct {
		IngredientID uint
		LotID        uint
		ExpiresAt    time.Time
		Remaining    float64
	}
	var rows []row
	// DISTINCT ON keeps the first row per ingredient under the ORDER BY, which
	// is the earliest expiry — no window function, one index scan.
	if err := db.Raw(`
		SELECT DISTINCT ON (ingredient_id)
		       ingredient_id, id AS lot_id, expires_at, remaining
		  FROM ingredient_lots
		 WHERE restaurant_id = ? AND ingredient_id IN ? AND deleted_at IS NULL
		   AND remaining > 0 AND expires_at IS NOT NULL
		 ORDER BY ingredient_id, expires_at ASC, id ASC`, restaurantID, ids).
		Scan(&rows).Error; err != nil {
		return err
	}
	byID := make(map[uint]row, len(rows))
	for _, r := range rows {
		byID[r.IngredientID] = r
	}
	for index := range items {
		if r, ok := byID[items[index].ID]; ok {
			items[index].ExpiringLot = &entity.IngredientLotSummary{
				LotID:     r.LotID,
				ExpiresAt: r.ExpiresAt,
				Remaining: r.Remaining,
			}
		}
	}
	return nil
}

// ---- IngredientRepository surface -------------------------------------------

func (r *IngredientRepository) ListOpenLots(restaurantID, ingredientID uint) ([]entity.IngredientLot, error) {
	return listOpenLots(r.db, restaurantID, ingredientID)
}

func (r *IngredientRepository) CreateLot(lot *entity.IngredientLot) error {
	return createLot(r.db, lot)
}

func (r *IngredientRepository) DrainLots(restaurantID, ingredientID uint, quantity float64) (float64, error) {
	return drainLots(r.db, restaurantID, ingredientID, quantity)
}

func (r *IngredientRepository) ShrinkLotsOldestFirst(restaurantID, ingredientID uint, quantity float64) (float64, error) {
	return shrinkLotsOldestFirst(r.db, restaurantID, ingredientID, quantity)
}

func (r *IngredientRepository) FindOpenLotForUpdate(restaurantID, ingredientID, lotID uint) (*entity.IngredientLot, error) {
	return findOpenLotForUpdate(r.db, restaurantID, ingredientID, lotID)
}

func (r *IngredientRepository) SaveLotRemaining(lotID uint, remaining float64) error {
	return saveLotRemaining(r.db, lotID, remaining)
}

func (r *IngredientRepository) SaveLotExpiry(restaurantID, ingredientID, lotID uint, expiresAt *time.Time) (int64, error) {
	return saveLotExpiry(r.db, restaurantID, ingredientID, lotID, expiresAt)
}

func (r *IngredientRepository) SumLotRemaining(restaurantID, ingredientID uint) (float64, error) {
	return sumLotRemaining(r.db, restaurantID, ingredientID)
}

func (r *IngredientRepository) AttachExpiringLots(restaurantID uint, items []entity.Ingredient) error {
	return attachExpiringLots(r.db, restaurantID, items)
}

// ---- OrderRepository surface (kitchen deduction) ------------------------------

func (r *OrderRepository) DrainLots(restaurantID, ingredientID uint, quantity float64) (float64, error) {
	return drainLots(r.db, restaurantID, ingredientID, quantity)
}
