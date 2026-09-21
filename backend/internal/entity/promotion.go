package entity

import "gorm.io/gorm"

const (
	// PromotionTypeBuyXGetY: buy BuyQuantity, get GetQuantity of the cheapest free
	// ("1 แถม 1", "2 แถม 1"), within the dishes its targets name.
	PromotionTypeBuyXGetY = "buy_x_get_y"
	// PromotionTypeItemDiscount: every targeted dish is DiscountValue percent or
	// baht cheaper.
	PromotionTypeItemDiscount = "item_discount"
	// PromotionTypeBundlePrice: one dish from each target group together cost
	// BundlePrice ("ข้าว + น้ำ = 79").
	PromotionTypeBundlePrice = "bundle_price"
	// PromotionTypeBillDiscount: a bill of at least MinSubtotal takes DiscountValue
	// percent or baht off, after the dish-level promotions.
	PromotionTypeBillDiscount = "bill_discount"

	PromotionDiscountPercent = "percent"
	PromotionDiscountAmount  = "amount"

	// PromotionEveryDay is DaysMask with every day's bit set; bit 0 is Sunday.
	PromotionEveryDay = 127
)

// Promotion is a pricing rule the owner sets up once. The order service applies
// it by itself whenever an order's dishes change - the way a convenience-store
// till does - so staff never type a discount at the counter.
//
// Schedule fields are Bangkok calendar values. An empty date or time means no
// limit on that side; an EndTime earlier than StartTime runs past midnight, and
// the hours after midnight belong to the night that started the day before.
type Promotion struct {
	gorm.Model
	RestaurantID uint   `json:"restaurant_id" gorm:"not null;index:idx_promotions_restaurant_active,priority:1"`
	Name         string `json:"name" gorm:"size:120;not null"`
	Type         string `json:"type" gorm:"size:24;not null;check:chk_promotions_type,type IN ('buy_x_get_y','item_discount','bundle_price','bill_discount')"`
	IsActive     bool   `json:"is_active" gorm:"not null;default:true;index:idx_promotions_restaurant_active,priority:2"`

	StartDate string `json:"start_date" gorm:"size:10;not null;default:''"`
	EndDate   string `json:"end_date" gorm:"size:10;not null;default:''"`
	DaysMask  int    `json:"days_mask" gorm:"not null;default:127;check:chk_promotions_days_mask,days_mask BETWEEN 1 AND 127"`
	StartTime string `json:"start_time" gorm:"size:5;not null;default:''"`
	EndTime   string `json:"end_time" gorm:"size:5;not null;default:''"`

	BuyQuantity   int     `json:"buy_quantity" gorm:"not null;default:0;check:chk_promotions_buy_quantity,buy_quantity >= 0"`
	GetQuantity   int     `json:"get_quantity" gorm:"not null;default:0;check:chk_promotions_get_quantity,get_quantity >= 0"`
	DiscountKind  string  `json:"discount_kind" gorm:"size:8;not null;default:''"`
	DiscountValue float64 `json:"discount_value" gorm:"type:numeric(14,2);not null;default:0;check:chk_promotions_discount_value,discount_value >= 0"`
	BundlePrice   float64 `json:"bundle_price" gorm:"type:numeric(14,2);not null;default:0;check:chk_promotions_bundle_price,bundle_price >= 0"`
	MinSubtotal   float64 `json:"min_subtotal" gorm:"type:numeric(14,2);not null;default:0;check:chk_promotions_min_subtotal,min_subtotal >= 0"`
	// MaxDiscount caps a percent bill discount; 0 means no cap.
	MaxDiscount float64 `json:"max_discount" gorm:"type:numeric(14,2);not null;default:0;check:chk_promotions_max_discount,max_discount >= 0"`

	Targets []PromotionTarget `json:"targets" gorm:"foreignKey:PromotionID"`

	Restaurant *Restaurant `json:"-" gorm:"foreignKey:RestaurantID"`
}

// PromotionTarget names the dishes a promotion counts: one menu item, or every
// dish in one category. A bundle has one group per slot ("any rice dish" x1,
// "any drink" x1) and Quantity is how many dishes that slot takes; every other
// type uses group 0.
type PromotionTarget struct {
	gorm.Model
	RestaurantID uint  `json:"restaurant_id" gorm:"not null;index"`
	PromotionID  uint  `json:"promotion_id" gorm:"not null;index"`
	GroupIndex   int   `json:"group_index" gorm:"not null;default:0;check:chk_promotion_targets_group,group_index >= 0"`
	Quantity     int   `json:"quantity" gorm:"not null;default:1;check:chk_promotion_targets_quantity,quantity >= 1"`
	MenuItemID   *uint `json:"menu_item_id" gorm:"index;check:chk_promotion_targets_one_subject,(menu_item_id IS NULL) <> (category_id IS NULL)"`
	CategoryID   *uint `json:"category_id" gorm:"index"`

	MenuItem *MenuItem `json:"-" gorm:"foreignKey:MenuItemID"`
	Category *Category `json:"-" gorm:"foreignKey:CategoryID"`
}

// OrderPromotion is one promotion as it applied to one order. The name and the
// amount are copied here so a paid bill keeps showing what it was sold under
// after the owner edits or deletes the promotion.
type OrderPromotion struct {
	gorm.Model
	RestaurantID uint   `json:"restaurant_id" gorm:"not null;index"`
	OrderID      uint   `json:"order_id" gorm:"not null;index"`
	PromotionID  uint   `json:"promotion_id" gorm:"not null;index"`
	Name         string `json:"name" gorm:"size:120;not null"`
	Type         string `json:"type" gorm:"size:24;not null"`
	// Times is how often it applied: two pairs of "1 แถม 1" is 2.
	Times  int     `json:"times" gorm:"not null;default:1;check:chk_order_promotions_times,times >= 1"`
	Amount float64 `json:"amount" gorm:"type:numeric(14,2);not null;check:chk_order_promotions_amount,amount > 0"`

	Order     *Order     `json:"-" gorm:"foreignKey:OrderID"`
	Promotion *Promotion `json:"-" gorm:"foreignKey:PromotionID"`
}
