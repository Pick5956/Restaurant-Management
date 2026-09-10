package entity

import (
	"time"

	"gorm.io/gorm"
)

const (
	TableStatusFree     = "free"
	TableStatusOccupied = "occupied"
	TableStatusReserved = "reserved"
	TableStatusInactive = "inactive"
)

type RestaurantTable struct {
	gorm.Model
	RestaurantID     uint   `json:"restaurant_id" gorm:"not null;index;index:idx_restaurant_tables_layout,priority:1;uniqueIndex:idx_restaurant_table_number_active,priority:1,where:deleted_at IS NULL"`
	ZoneID           *uint  `json:"zone_id" gorm:"index;index:idx_restaurant_tables_layout,priority:2"`
	TableNumber      string `json:"table_number" gorm:"not null;size:32;uniqueIndex:idx_restaurant_table_number_active,priority:2,where:deleted_at IS NULL"`
	DisplayLabel     string `json:"display_label"`
	SequenceNumber   int    `json:"sequence_number" gorm:"not null;default:0;index;index:idx_restaurant_tables_layout,priority:3"`
	Capacity         int    `json:"capacity" gorm:"not null;default:2;check:restaurant_table_capacity_range,capacity >= 1 AND capacity <= 50"`
	Zone             string `json:"zone"`
	Status           string `json:"status" gorm:"not null;default:'free';check:restaurant_table_status_valid,status IN ('free','occupied','reserved','inactive')"`
	CustomerToken    string `json:"customer_token" gorm:"size:64;uniqueIndex"`
	ReservationName  string `json:"reservation_name" gorm:"size:80"`
	ReservationPhone string `json:"reservation_phone" gorm:"size:32"`

	// The next booking this table has coming, attached on list reads and never
	// stored (`gorm:"-"`). It exists so the floor sees "จอง 16:00" on the table
	// card itself: a scheduled booking does not take the table out of service,
	// so without this reminder the only clue it exists is on another screen.
	UpcomingReservationAt   *time.Time `json:"upcoming_reservation_at,omitempty" gorm:"-"`
	UpcomingReservationName string     `json:"upcoming_reservation_name,omitempty" gorm:"-"`

	Restaurant *Restaurant `json:"restaurant,omitempty" gorm:"foreignKey:RestaurantID"`
	TableZone  *TableZone  `json:"table_zone,omitempty" gorm:"foreignKey:ZoneID"`
	Tags       []TableTag  `json:"tags,omitempty" gorm:"many2many:restaurant_table_tags;"`
}
