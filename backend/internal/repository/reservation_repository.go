package repository

import (
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type ReservationRepository struct {
	db *gorm.DB
}

func NewReservationRepository(db *gorm.DB) *ReservationRepository {
	return &ReservationRepository{db: db}
}

// List returns reservations for the archive, newest first, filtered by status
// ("" = all). Returns limit+1 rows so the caller can detect more pages.
func (r *ReservationRepository) List(restaurantID uint, status string, limit, offset int) ([]entity.Reservation, error) {
	var reservations []entity.Reservation
	query := r.db.
		Preload("Table").
		Where("restaurant_id = ?", restaurantID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	err := query.Order("id desc").Limit(limit).Offset(offset).Find(&reservations).Error
	return reservations, err
}

// ExpireStaleScheduled closes bookings whose time came and went with nobody
// resolving them.
//
// Only scheduled bookings (`reserved_for` set) are swept. A hold is left alone
// on purpose: it has taken a table out of service, and releasing that is a
// change to the floor that belongs to a person, not a timer. Clearing one is a
// two-tap job from the reservation list.
func (r *ReservationRepository) ExpireStaleScheduled(restaurantID uint, cutoff time.Time, now time.Time) (int64, error) {
	result := r.db.Model(&entity.Reservation{}).
		Where("restaurant_id = ? AND status = ? AND reserved_for IS NOT NULL AND reserved_for < ?",
			restaurantID, entity.ReservationStatusActive, cutoff).
		Updates(map[string]any{
			"status":      entity.ReservationStatusCancelled,
			"resolved_at": now,
		})
	return result.RowsAffected, result.Error
}

func (r *ReservationRepository) CountByStatus(restaurantID uint) (map[string]int64, error) {
	type row struct {
		Status string
		Count  int64
	}
	var rows []row
	err := r.db.Model(&entity.Reservation{}).
		Select("status, count(*) as count").
		Where("restaurant_id = ?", restaurantID).
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	for _, item := range rows {
		counts[item.Status] = item.Count
	}
	return counts, nil
}
