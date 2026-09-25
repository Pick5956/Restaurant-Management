package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
)

// DeleteWithMemberships soft-deletes a restaurant and every membership in it
// in one transaction. As two separate writes, a failure between them left a
// live restaurant with no members at all - the owner included - so nobody
// could open it again, or delete it.
func (r *RestaurantRepository) DeleteWithMemberships(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("restaurant_id = ?", id).Delete(&entity.RestaurantMember{}).Error; err != nil {
			return err
		}
		return tx.Delete(&entity.Restaurant{}, id).Error
	})
}
