package entity

import (
	"time"

	"gorm.io/gorm"
)

const (
	// ReservationStatusActive is a reservation still holding the table.
	ReservationStatusActive = "active"
	// ReservationStatusSeated means the guests arrived and the table was opened.
	ReservationStatusSeated = "seated"
	// ReservationStatusCancelled means the reservation was cancelled / a no-show.
	ReservationStatusCancelled = "cancelled"
)

// Reservation records the lifecycle of a table booking so cancellations and
// no-shows can be reviewed later, independent of the order archive (a cancelled
// reservation never becomes an order).
type Reservation struct {
	gorm.Model
	RestaurantID     uint       `json:"restaurant_id" gorm:"not null;index:idx_reservations_restaurant_status,priority:1;uniqueIndex:idx_reservations_one_active_slot,priority:1,where:reserved_for IS NOT NULL AND status = 'active' AND deleted_at IS NULL"`
	TableID          uint       `json:"table_id" gorm:"not null;index;uniqueIndex:idx_reservations_one_active_slot,priority:2"`
	TableLabel       string     `json:"table_label" gorm:"size:64"`
	Name             string     `json:"name" gorm:"size:80"`
	Phone            string     `json:"phone" gorm:"size:32"`
	Status           string     `json:"status" gorm:"size:16;not null;default:'active';index:idx_reservations_restaurant_status,priority:2;check:chk_reservations_status,status IN ('active','seated','cancelled')"`
	ReservedByUserID uint       `json:"reserved_by_user_id"`
	ResolvedAt       *time.Time `json:"resolved_at"`
	// ReservedFor is when the guests say they will arrive, and it is what
	// separates the two kinds of booking this table supports.
	//
	// Null means "hold this table now": the table is switched to `reserved` and
	// stops taking orders until someone seats or cancels it. That is the walk-up
	// case, and it is what the web POS still does.
	//
	// Set means a booking for later. The table is deliberately NOT held — it
	// stays sellable right up to the moment the guests arrive, because holding a
	// table from the afternoon for an evening booking loses the restaurant the
	// whole evening on that table.
	//
	// One active booking per (table, instant) is enforced by
	// idx_reservations_one_active_slot. The partial index is what makes that
	// compatible with the paragraph above: it only covers rows that carry a time,
	// so a table still takes as many bookings across an evening as the floor can
	// sell, while the same slot cannot be handed to two parties.
	ReservedFor *time.Time `json:"reserved_for" gorm:"index;uniqueIndex:idx_reservations_one_active_slot,priority:3"`
	// How many guests the booking is for. Kept on the reservation rather than
	// derived from the table's capacity at seating time, because which table a
	// party of six ends up on is a decision the floor makes later — the party
	// size is what the guest actually told you on the phone.
	GuestCount int `json:"guest_count" gorm:"not null;default:1;check:chk_reservations_guest_count_positive,guest_count > 0"`

	Table *RestaurantTable `json:"table,omitempty" gorm:"foreignKey:TableID"`
	Staff *User            `json:"staff,omitempty" gorm:"foreignKey:ReservedByUserID"`
}
