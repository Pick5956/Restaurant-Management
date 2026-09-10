package repository

import (
	"errors"
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TableRepository struct {
	db *gorm.DB
}

func NewTableRepository(db *gorm.DB) *TableRepository {
	return &TableRepository{db: db}
}

func (r *TableRepository) ListTables(restaurantID uint) ([]entity.RestaurantTable, error) {
	var tables []entity.RestaurantTable
	err := r.db.
		Preload("TableZone").
		Preload("Tags", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Joins("LEFT JOIN table_zones ON table_zones.id = restaurant_tables.zone_id").
		Where("restaurant_tables.restaurant_id = ?", restaurantID).
		Order("CASE WHEN restaurant_tables.zone_id IS NULL THEN 0 ELSE 1 END asc, table_zones.display_order asc, restaurant_tables.sequence_number asc, restaurant_tables.id asc").
		Find(&tables).Error
	return tables, err
}

// UpcomingReservationsByTable returns the next scheduled booking per table, for
// the window the floor can act on.
//
// One query for the whole restaurant rather than one per table: the table map is
// the busiest read in the app and an N+1 here would be paid on every refresh.
//
// The window starts an hour in the past because a guest booked for 16:00 who has
// not walked in yet is exactly who the reminder is for, and ends twelve hours
// ahead because a booking for next week on a card being read during service is
// noise, not a reminder.
func (r *TableRepository) UpcomingReservationsByTable(restaurantID uint, now time.Time) (map[uint]entity.Reservation, error) {
	var reservations []entity.Reservation
	err := r.db.
		Where("restaurant_id = ? AND status = ? AND reserved_for IS NOT NULL", restaurantID, entity.ReservationStatusActive).
		Where("reserved_for BETWEEN ? AND ?", now.Add(-time.Hour), now.Add(12*time.Hour)).
		Order("reserved_for asc").
		Find(&reservations).Error
	if err != nil {
		return nil, err
	}
	// Ordered ascending, so the first row seen for a table is its next booking.
	nextByTable := make(map[uint]entity.Reservation, len(reservations))
	for _, reservation := range reservations {
		if _, seen := nextByTable[reservation.TableID]; seen {
			continue
		}
		nextByTable[reservation.TableID] = reservation
	}
	return nextByTable, nil
}

func (r *TableRepository) Transaction(fn func(tx *TableRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewTableRepository(tx))
	})
}

func (r *TableRepository) CreateTable(table *entity.RestaurantTable) error {
	return r.db.Create(table).Error
}

func (r *TableRepository) FindTable(restaurantID, tableID uint) (*entity.RestaurantTable, error) {
	var table entity.RestaurantTable
	err := r.db.
		Preload("TableZone").
		Preload("Tags", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Where("restaurant_id = ? AND id = ?", restaurantID, tableID).
		First(&table).Error
	if err != nil {
		return nil, err
	}
	return &table, nil
}

func (r *TableRepository) FindTableForUpdate(restaurantID, tableID uint) (*entity.RestaurantTable, error) {
	var table entity.RestaurantTable
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("TableZone").
		Preload("Tags", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Where("restaurant_id = ? AND id = ?", restaurantID, tableID).
		First(&table).Error
	if err != nil {
		return nil, err
	}
	return &table, nil
}

func (r *TableRepository) HasOpenOrderForTable(restaurantID, tableID uint) (bool, error) {
	var orderID uint
	result := r.db.Model(&entity.Order{}).
		Select("id").
		Where("restaurant_id = ? AND table_id = ? AND status NOT IN ?", restaurantID, tableID, []string{entity.OrderStatusCompleted, entity.OrderStatusCancelled}).
		Limit(1).
		Scan(&orderID)
	return result.RowsAffected > 0, result.Error
}

func (r *TableRepository) HasAnyOrderForTable(restaurantID, tableID uint) (bool, error) {
	var orderID uint
	result := r.db.Unscoped().
		Model(&entity.Order{}).
		Select("id").
		Where("restaurant_id = ? AND table_id = ?", restaurantID, tableID).
		Limit(1).
		Scan(&orderID)
	return result.RowsAffected > 0, result.Error
}

func (r *TableRepository) UpdateTable(table *entity.RestaurantTable) error {
	return r.db.Omit(clause.Associations).Save(table).Error
}

func (r *TableRepository) DeleteTable(table *entity.RestaurantTable) error {
	return r.db.Delete(table).Error
}

// CreateReservation records a new reservation within the current transaction.
func (r *TableRepository) CreateReservation(reservation *entity.Reservation) error {
	return r.db.Create(reservation).Error
}

// ReconcileActiveReservationsForUpdate runs after the table row is locked and
// returns the deterministic canonical active lifecycle row.
func (r *TableRepository) ReconcileActiveReservationsForUpdate(restaurantID, tableID uint) (*entity.Reservation, error) {
	return reconcileActiveReservationsForUpdate(r.db, restaurantID, tableID)
}

// FindReservation reads one booking by its own id WITHOUT locking it.
//
// It exists so a caller can learn which table a booking belongs to before it
// takes any lock at all. Every path in this codebase that holds both rows locks
// restaurant_tables first, so a caller that needs the table id out of the
// reservation cannot get it by locking the reservation — that is the inverted
// order, and it deadlocks against every other path. Read here, lock the table,
// then lock the reservation.
func (r *TableRepository) FindReservation(restaurantID, reservationID uint) (*entity.Reservation, error) {
	var reservation entity.Reservation
	err := r.db.
		Where("restaurant_id = ? AND id = ?", restaurantID, reservationID).
		First(&reservation).Error
	if err != nil {
		return nil, err
	}
	return &reservation, nil
}

// FindReservationForUpdate locks one booking by its own id. Every other
// reservation lookup here is keyed by table, which only works while a table can
// hold at most one booking — a scheduled booking breaks that, so resolving one
// has to address the row itself.
//
// Callers that also touch the booking's table MUST lock the table first. See
// FindReservation.
func (r *TableRepository) FindReservationForUpdate(restaurantID, reservationID uint) (*entity.Reservation, error) {
	var reservation entity.Reservation
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND id = ?", restaurantID, reservationID).
		First(&reservation).Error
	if err != nil {
		return nil, err
	}
	return &reservation, nil
}

// FindScheduledReservationForUpdate returns the active booking already held for
// this table at this exact instant, or nil when the slot is free.
//
// The caller must hold the table row lock (FindTableForUpdate) first. That lock
// is what makes the check-then-insert around this safe: two staff booking the
// same table at once both queue on the table row, so the second one sees the
// first one's row instead of racing past it.
func (r *TableRepository) FindScheduledReservationForUpdate(restaurantID, tableID uint, reservedFor time.Time) (*entity.Reservation, error) {
	var reservation entity.Reservation
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"restaurant_id = ? AND table_id = ? AND status = ? AND reserved_for = ?",
			restaurantID,
			tableID,
			entity.ReservationStatusActive,
			reservedFor,
		).
		Order("id asc").
		First(&reservation).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &reservation, nil
}

func (r *TableRepository) UpdateReservation(reservation *entity.Reservation) error {
	return r.db.Omit(clause.Associations).Save(reservation).Error
}

func (r *TableRepository) HasActiveReservation(restaurantID, tableID uint) (bool, error) {
	var count int64
	err := r.db.Model(&entity.Reservation{}).
		Where("restaurant_id = ? AND table_id = ? AND status = ?", restaurantID, tableID, entity.ReservationStatusActive).
		Limit(1).
		Count(&count).Error
	return count > 0, err
}

// ResolveActiveReservation marks the table's active reservation with a terminal
// status (seated / cancelled). Requiring exactly one row keeps table and
// lifecycle state atomic: a caller cannot release a reserved table while the
// corresponding lifecycle write silently does nothing.
func (r *TableRepository) ResolveActiveReservation(restaurantID, tableID uint, status string) error {
	return resolveCanonicalActiveReservation(r.db, restaurantID, tableID, status)
}

func (r *TableRepository) ReplaceTableTags(table *entity.RestaurantTable, tags []entity.TableTag) error {
	return r.db.Model(table).Association("Tags").Replace(tags)
}

func (r *TableRepository) ListZones(restaurantID uint) ([]entity.TableZone, error) {
	var zones []entity.TableZone
	err := r.db.Where("restaurant_id = ?", restaurantID).Order("display_order asc, id asc").Find(&zones).Error
	return zones, err
}

func (r *TableRepository) FindZone(restaurantID, zoneID uint) (*entity.TableZone, error) {
	var zone entity.TableZone
	err := r.db.Where("restaurant_id = ? AND id = ?", restaurantID, zoneID).First(&zone).Error
	if err != nil {
		return nil, err
	}
	return &zone, nil
}

func (r *TableRepository) CreateZone(zone *entity.TableZone) error {
	return r.db.Create(zone).Error
}

func (r *TableRepository) UpdateZone(zone *entity.TableZone) error {
	return r.db.Omit(clause.Associations).Save(zone).Error
}

func (r *TableRepository) ListTablesInZone(restaurantID, zoneID uint) ([]entity.RestaurantTable, error) {
	var tables []entity.RestaurantTable
	err := r.db.
		Where("restaurant_id = ? AND zone_id = ?", restaurantID, zoneID).
		Order("sequence_number asc, id asc").
		Find(&tables).Error
	return tables, err
}

func (r *TableRepository) DeleteZone(zone *entity.TableZone) error {
	return r.db.Delete(zone).Error
}

func (r *TableRepository) CountTablesInZone(restaurantID, zoneID uint) (int64, error) {
	var count int64
	err := r.db.Model(&entity.RestaurantTable{}).Where("restaurant_id = ? AND zone_id = ?", restaurantID, zoneID).Count(&count).Error
	return count, err
}

func (r *TableRepository) PrefixExists(restaurantID uint, prefix string, exceptID uint) (bool, error) {
	var count int64
	query := r.db.Model(&entity.TableZone{}).Where("restaurant_id = ? AND prefix = ?", restaurantID, prefix)
	if exceptID != 0 {
		query = query.Where("id <> ?", exceptID)
	}
	err := query.Count(&count).Error
	return count > 0, err
}

func (r *TableRepository) ListTags(restaurantID uint) ([]entity.TableTag, error) {
	var tags []entity.TableTag
	err := r.db.Where("restaurant_id = ?", restaurantID).Order("display_order asc, id asc").Find(&tags).Error
	return tags, err
}

func (r *TableRepository) FindTag(restaurantID, tagID uint) (*entity.TableTag, error) {
	var tag entity.TableTag
	err := r.db.Where("restaurant_id = ? AND id = ?", restaurantID, tagID).First(&tag).Error
	if err != nil {
		return nil, err
	}
	return &tag, nil
}

func (r *TableRepository) FindTags(restaurantID uint, tagIDs []uint) ([]entity.TableTag, error) {
	if len(tagIDs) == 0 {
		return []entity.TableTag{}, nil
	}
	var tags []entity.TableTag
	err := r.db.Where("restaurant_id = ? AND id IN ?", restaurantID, tagIDs).Find(&tags).Error
	return tags, err
}

func (r *TableRepository) CreateTag(tag *entity.TableTag) error {
	return r.db.Create(tag).Error
}

func (r *TableRepository) UpdateTag(tag *entity.TableTag) error {
	return r.db.Omit(clause.Associations).Save(tag).Error
}

func (r *TableRepository) DeleteTag(tag *entity.TableTag) error {
	return r.db.Delete(tag).Error
}

// TableNumberTaken reports whether a label is already used in this restaurant.
//
// Sequences run per zone, but `table_number` is unique across the whole
// restaurant, so two zones can independently arrive at the same label — the
// zone-less numbering is `T<n>` and a zone whose prefix is "T" numbers `T%02d`,
// which collide from 10 onwards. Without this check the insert fails on the
// unique index and the owner is told the table already exists while looking at a
// screen that does not show one.
//
// Soft-deleted rows are excluded, matching the partial unique index they are
// also excluded from, so a deleted table's label can be used again.
func (r *TableRepository) TableNumberTaken(restaurantID uint, tableNumber string) (bool, error) {
	var id uint
	result := r.db.
		Model(&entity.RestaurantTable{}).
		Select("id").
		Where("restaurant_id = ? AND table_number = ?", restaurantID, tableNumber).
		Limit(1).
		Scan(&id)
	return result.RowsAffected > 0, result.Error
}

func (r *TableRepository) NextSequence(restaurantID uint, zoneID *uint) (int, error) {
	var max int
	query := r.db.Model(&entity.RestaurantTable{}).Where("restaurant_id = ?", restaurantID)
	if zoneID == nil {
		query = query.Where("zone_id IS NULL")
	} else {
		query = query.Where("zone_id = ?", *zoneID)
	}
	err := query.Select("COALESCE(MAX(sequence_number), 0)").Scan(&max).Error
	return max + 1, err
}
