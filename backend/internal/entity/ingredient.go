package entity

import "gorm.io/gorm"

type IngredientCategory struct {
	gorm.Model
	RestaurantID uint   `json:"restaurant_id" gorm:"not null;index;uniqueIndex:idx_ingredient_category_restaurant_name,priority:1"`
	Name         string `json:"name" gorm:"not null;size:120;uniqueIndex:idx_ingredient_category_restaurant_name,priority:2"`
	DisplayOrder int    `json:"display_order" gorm:"default:0"`
	IsActive     bool   `json:"is_active" gorm:"default:true"`

	Restaurant *Restaurant `json:"restaurant,omitempty" gorm:"foreignKey:RestaurantID"`
}

// IngredientUnitOption is one entry in a unit picker: a unit this ingredient
// accepts, and how many of its own stock units one of them makes.
type IngredientUnitOption struct {
	Unit         string  `json:"unit"`
	StockPerUnit float64 `json:"stock_per_unit"`
}

type Ingredient struct {
	gorm.Model
	RestaurantID uint    `json:"restaurant_id" gorm:"not null;index"`
	Name         string  `json:"name" gorm:"not null;size:160"`
	SKU          string  `json:"sku" gorm:"size:80;index"`
	CategoryID   *uint   `json:"category_id" gorm:"index"`
	ImageURL     string  `json:"image_url" gorm:"size:2048"`
	Unit         string  `json:"unit" gorm:"not null;size:40"`
	Stock        float64 `json:"stock" gorm:"type:numeric(18,4);not null;default:0;check:ingredient_stock_nonnegative,stock >= 0"`
	MinStock     float64 `json:"min_stock" gorm:"type:numeric(18,4);not null;default:0;check:ingredient_min_stock_nonnegative,min_stock >= 0"`
	// MaxStock is the most this shelf has been proved to hold: it rises to meet
	// any stock level above it and never falls. It is the denominator the apps
	// draw the level bar against — without it the bar's right-hand end means
	// nothing, which is what it meant before this column existed.
	MaxStock float64 `json:"max_stock" gorm:"type:numeric(18,4);not null;default:0;check:ingredient_max_stock_nonnegative,max_stock >= 0"`
	// MinPercent is the reorder level expressed as a share of MaxStock, and is
	// the source of truth when it is set: MinStock is then recomputed from it
	// every time MaxStock moves, so a shop that starts buying in larger loads
	// gets warned proportionally rather than at a quantity that is now too low.
	// Zero means nobody chose a percentage and MinStock stands on its own.
	MinPercent float64 `json:"min_percent" gorm:"type:numeric(7,4);not null;default:0;check:ingredient_min_percent_range,min_percent >= 0 AND min_percent <= 100"`
	CostPerUnit  float64 `json:"cost_per_unit" gorm:"type:numeric(14,4);not null;default:0;check:ingredient_cost_nonnegative,cost_per_unit >= 0"`
	YieldPercent float64 `json:"yield_percent" gorm:"type:numeric(7,4);not null;default:100;check:ingredient_yield_range,yield_percent > 0 AND yield_percent <= 100"`
	StorageType  string  `json:"storage_type" gorm:"size:40;default:room_temp"`

	Restaurant *Restaurant         `json:"restaurant,omitempty" gorm:"foreignKey:RestaurantID"`
	Category   *IngredientCategory `json:"category,omitempty" gorm:"foreignKey:CategoryID"`

	// DaysLeft and DailyUse are computed at read time, not stored: how long the
	// current stock lasts at the rate this ingredient was actually consumed over
	// the usage window. They are nil when nothing was consumed in the window —
	// there is no rate to divide by, and a 0 would read as "runs out today" when
	// the truth is "we have no idea yet". A client must render the nil case as
	// "no usage data", never as an empty bar.
	DaysLeft *float64 `json:"days_left,omitempty" gorm:"-"`
	DailyUse *float64 `json:"daily_use,omitempty" gorm:"-"`

	// UnitFamily is every unit a quantity may be entered in for this ingredient,
	// computed at read time from Unit. The client uses it to build the unit
	// picker, so the list of what converts to what lives in one place on the
	// server instead of being mirrored - and drifting - in each app.
	UnitFamily []IngredientUnitOption `json:"unit_family,omitempty" gorm:"-"`
}

type IngredientTransaction struct {
	gorm.Model
	RestaurantID uint    `json:"restaurant_id" gorm:"not null;index"`
	IngredientID uint    `json:"ingredient_id" gorm:"not null;index"`
	Type         string  `json:"type" gorm:"not null;size:16;check:ingredient_transaction_type,type IN ('in','out','adjust')"` // "in", "out", "adjust"
	Quantity     float64 `json:"quantity" gorm:"type:numeric(18,4);not null;check:ingredient_transaction_quantity_positive,quantity > 0"`
	// Amount is the money actually paid for a restock. Only "in" movements carry
	// it, and a positive value makes the stock-in write a matching Expense row —
	// that is the only way cash-out reaches the ledger without manual entry.
	Amount      float64 `json:"amount" gorm:"type:numeric(14,2);not null;default:0;check:ingredient_transaction_amount_nonnegative,amount >= 0"`
	Note        string  `json:"note" gorm:"size:500"`
	CreatedByID uint    `json:"created_by_id" gorm:"not null;index"`

	Ingredient *Ingredient `json:"ingredient,omitempty" gorm:"foreignKey:IngredientID"`
	CreatedBy  *User       `json:"-" gorm:"foreignKey:CreatedByID"`
}
