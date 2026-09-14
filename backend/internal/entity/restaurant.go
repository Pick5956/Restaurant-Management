package entity

import (
	"Project-M/internal/restaurantslug"

	"gorm.io/gorm"
)

type Restaurant struct {
	gorm.Model
	Name string `json:"name" gorm:"not null" binding:"required"`
	// Slug is the restaurant's URL name: dishy.pro/r/<slug>/home. Unique among
	// live restaurants (a partial index, so a deleted shop frees its name) and
	// shaped by restaurantslug.Valid, which a CHECK constraint enforces too.
	Slug                 string  `json:"slug" gorm:"size:40;not null;default:''"`
	BranchName           string  `json:"branch_name" gorm:"size:120;default:'สาขาหลัก'"`
	RestaurantType       string  `json:"restaurant_type" gorm:"size:80;default:'ร้านอาหาร'"`
	Address              string  `json:"address"`
	Phone                string  `json:"phone"`
	Logo                 string  `json:"logo"`
	OpenTime             string  `json:"open_time" gorm:"size:5;default:'17:00'"`
	CloseTime            string  `json:"close_time" gorm:"size:5;default:'00:00'"`
	TableCount           int     `json:"table_count" gorm:"not null;default:12;check:restaurant_table_count_nonnegative,table_count >= 0"`
	ServiceChargeEnabled bool    `json:"service_charge_enabled" gorm:"not null;default:false"`
	ServiceChargeRate    float64 `json:"service_charge_rate" gorm:"type:numeric(7,4);not null;default:10;check:restaurant_service_charge_rate_range,service_charge_rate >= 0 AND service_charge_rate <= 100"`
	VATEnabled           bool    `json:"vat_enabled" gorm:"not null;default:false"`
	VATRate              float64 `json:"vat_rate" gorm:"type:numeric(7,4);not null;default:7;check:restaurant_vat_rate_range,vat_rate >= 0 AND vat_rate <= 100"`
	PromptPayName        string  `json:"promptpay_name"`
	PromptPayQRImage     string  `json:"promptpay_qr_image"`
	CoverImage           string  `json:"cover_image"`

	// AIActionsEnabled lets the owner turn the assistant's ability to make
	// changes (a previewed, confirmed write like opening or closing a menu) on or
	// off from the AI settings. Default off: the assistant reads and answers until
	// the owner opts in, and every action still needs an explicit confirmation.
	AIActionsEnabled bool `json:"ai_actions_enabled" gorm:"not null;default:false"`

	// The owner's finer AI preferences, added when the single on/off switch
	// above grew into a settings screen with sections.
	//
	// AIActionTypes is a JSON object of action type → allowed ("set_menu_price":
	// false). A missing key means allowed, and NULL means every action is
	// allowed — so a shop that switched actions on before this column existed
	// keeps exactly the behaviour it had. AIInsightKinds is the same shape for
	// the proactive bell (insight kind → shown). AIOwnerTitle is what the
	// assistant calls the owner; empty falls back to "คุณผู้จัดการ".
	AIActionTypes  *string `json:"ai_action_types,omitempty" gorm:"type:jsonb"`
	AIInsightKinds *string `json:"ai_insight_kinds,omitempty" gorm:"type:jsonb"`
	AIOwnerTitle   string  `json:"ai_owner_title" gorm:"size:40;not null;default:''"`

	// Geofence for QR table ordering. A customer must be physically near the
	// restaurant to send an order straight to the kitchen. OrderRadiusMeters = 0
	// (or missing coordinates) disables the check entirely.
	Latitude          *float64 `json:"latitude" gorm:"type:double precision"`
	Longitude         *float64 `json:"longitude" gorm:"type:double precision"`
	OrderRadiusMeters int      `json:"order_radius_meters" gorm:"not null;default:0"`

	OwnerID uint  `json:"owner_id" gorm:"not null"`
	Owner   *User `json:"owner,omitempty" gorm:"foreignKey:OwnerID"`
}

// BeforeCreate gives a restaurant a slug when whoever is inserting it did not
// choose one. The service always chooses; this covers every other writer -
// seeds, fixtures, tests - so no row can ever reach the unique index or the
// CHECK constraint with an empty slug.
func (restaurant *Restaurant) BeforeCreate(*gorm.DB) error {
	if restaurant.Slug == "" {
		restaurant.Slug = restaurantslug.Random()
	}
	return nil
}
