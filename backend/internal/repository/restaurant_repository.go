package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type RestaurantRepository struct {
	db *gorm.DB
}

func NewRestaurantRepository(db *gorm.DB) *RestaurantRepository {
	return &RestaurantRepository{db: db}
}

func (r *RestaurantRepository) FindByID(id uint) (*entity.Restaurant, error) {
	var restaurant entity.Restaurant
	if err := r.db.First(&restaurant, id).Error; err != nil {
		return nil, err
	}
	return &restaurant, nil
}

// SlugTaken reports whether a live restaurant other than excludeID holds slug.
// Soft-deleted rows are ignored, matching the partial unique index.
func (r *RestaurantRepository) SlugTaken(slug string, excludeID uint) (bool, error) {
	query := r.db.Model(&entity.Restaurant{}).Where("slug = ?", slug)
	if excludeID != 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *RestaurantRepository) Update(restaurant *entity.Restaurant) error {
	return r.db.Save(restaurant).Error
}

func (r *RestaurantRepository) Delete(id uint) error {
	return r.db.Delete(&entity.Restaurant{}, id).Error
}
