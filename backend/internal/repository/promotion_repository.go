package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type PromotionRepository struct {
	db *gorm.DB
}

func NewPromotionRepository(db *gorm.DB) *PromotionRepository {
	return &PromotionRepository{db: db}
}

func (r *PromotionRepository) Transaction(fn func(tx *PromotionRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewPromotionRepository(tx))
	})
}

func withPromotionTargets(db *gorm.DB) *gorm.DB {
	return db.Preload("Targets", func(db *gorm.DB) *gorm.DB { return db.Order("group_index asc, id asc") })
}

// List returns every promotion of a restaurant, the ones running first, then
// newest first.
func (r *PromotionRepository) List(restaurantID uint) ([]entity.Promotion, error) {
	var promotions []entity.Promotion
	err := withPromotionTargets(r.db).
		Where("restaurant_id = ?", restaurantID).
		Order("is_active desc, id desc").
		Find(&promotions).Error
	return promotions, err
}

func (r *PromotionRepository) FindForUpdate(restaurantID, promotionID uint) (*entity.Promotion, error) {
	var promotion entity.Promotion
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND id = ?", restaurantID, promotionID).
		First(&promotion).Error
	if err != nil {
		return nil, err
	}
	return &promotion, nil
}

func (r *PromotionRepository) Find(restaurantID, promotionID uint) (*entity.Promotion, error) {
	var promotion entity.Promotion
	err := withPromotionTargets(r.db).
		Where("restaurant_id = ? AND id = ?", restaurantID, promotionID).
		First(&promotion).Error
	if err != nil {
		return nil, err
	}
	return &promotion, nil
}

func (r *PromotionRepository) Create(promotion *entity.Promotion) error {
	return r.db.Omit(clause.Associations).Create(promotion).Error
}

func (r *PromotionRepository) Save(promotion *entity.Promotion) error {
	return r.db.Omit(clause.Associations).Save(promotion).Error
}

// ReplaceTargets writes a promotion's dishes afresh. The old rows are removed
// outright: a target has no history of its own worth keeping.
func (r *PromotionRepository) ReplaceTargets(restaurantID, promotionID uint, targets []entity.PromotionTarget) error {
	if err := r.db.Unscoped().
		Where("restaurant_id = ? AND promotion_id = ?", restaurantID, promotionID).
		Delete(&entity.PromotionTarget{}).Error; err != nil {
		return err
	}
	if len(targets) == 0 {
		return nil
	}
	rows := make([]entity.PromotionTarget, len(targets))
	for i, target := range targets {
		rows[i] = entity.PromotionTarget{
			RestaurantID: restaurantID,
			PromotionID:  promotionID,
			GroupIndex:   target.GroupIndex,
			Quantity:     target.Quantity,
			MenuItemID:   target.MenuItemID,
			CategoryID:   target.CategoryID,
		}
	}
	return r.db.Omit(clause.Associations).Create(&rows).Error
}

// Delete soft-deletes a promotion. Paid bills keep its name and amount in
// order_promotions, so nothing that was sold under it changes.
func (r *PromotionRepository) Delete(promotion *entity.Promotion) error {
	return r.db.Delete(promotion).Error
}

// CountMenuItems and CountCategories count how many of the given ids belong to
// the restaurant, so a promotion can never point at another shop's dishes.
func (r *PromotionRepository) CountMenuItems(restaurantID uint, ids []uint) (int64, error) {
	var count int64
	err := r.db.Model(&entity.MenuItem{}).Where("restaurant_id = ? AND id IN ?", restaurantID, ids).Count(&count).Error
	return count, err
}

func (r *PromotionRepository) CountCategories(restaurantID uint, ids []uint) (int64, error) {
	var count int64
	err := r.db.Model(&entity.Category{}).Where("restaurant_id = ? AND id IN ?", restaurantID, ids).Count(&count).Error
	return count, err
}
