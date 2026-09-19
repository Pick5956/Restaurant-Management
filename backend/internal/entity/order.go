package entity

import (
	"time"

	"gorm.io/gorm"
)

const (
	OrderStatusOpen          = "open"
	OrderStatusSentToKitchen = "sent_to_kitchen"
	OrderStatusCooking       = "cooking"
	OrderStatusReady         = "ready"
	OrderStatusServed        = "served"
	OrderStatusCompleted     = "completed"
	OrderStatusCancelled     = "cancelled"

	OrderTypeDineIn   = "dine_in"
	OrderTypeTakeaway = "takeaway"

	OrderItemFulfillmentDineIn   = "dine_in"
	OrderItemFulfillmentTakeaway = "takeaway"

	OrderItemStatusPending   = "pending"
	OrderItemStatusCooking   = "cooking"
	OrderItemStatusReady     = "ready"
	OrderItemStatusServed    = "served"
	OrderItemStatusCancelled = "cancelled"

	PaymentStatusUnpaid = "unpaid"
	PaymentStatusPaid   = "paid"
)

// TestOrderSuffix marks an order number written by the demo seeders:
// "20260919-001 (Test)". The number itself follows the real YYYYMMDD-NNN
// format and the same per-day count, so a bill someone opens by hand on a
// seeded day carries on after the seeded ones; the suffix is what tells a
// made-up bill from a real one at a glance (owner's call, 19 ก.ย. 2569).
// Before this the seeders wrote "DA-2026-09-06-101294-022" and "SD-avnc-14362".
const TestOrderSuffix = " (Test)"

type Order struct {
	gorm.Model
	RestaurantID                 uint       `json:"restaurant_id" gorm:"not null;index:idx_orders_restaurant_status_opened,priority:1;index:idx_orders_restaurant_table,priority:1;index:idx_orders_restaurant_table_opened,priority:1;index:idx_orders_restaurant_number_date,priority:1;index:idx_orders_reporting,priority:1;uniqueIndex:idx_orders_restaurant_day_number_v2,priority:1,where:deleted_at IS NULL;uniqueIndex:idx_orders_one_active_table,priority:1,where:table_id IS NOT NULL AND deleted_at IS NULL AND status <> 'completed' AND status <> 'cancelled'"`
	TableID                      *uint      `json:"table_id" gorm:"index:idx_orders_restaurant_table,priority:2;index:idx_orders_restaurant_table_opened,priority:2;uniqueIndex:idx_orders_one_active_table,priority:2"`
	OrderType                    string     `json:"order_type" gorm:"size:32;not null;default:'dine_in';index;check:chk_orders_type,order_type IN ('dine_in','takeaway')"`
	OrderNumber                  string     `json:"order_number" gorm:"size:32;not null;index:idx_orders_restaurant_number_date,priority:2;uniqueIndex:idx_orders_restaurant_day_number_v2,priority:3"`
	OrderDate                    string     `json:"order_date" gorm:"size:10;not null;index:idx_orders_restaurant_number_date,priority:3;uniqueIndex:idx_orders_restaurant_day_number_v2,priority:2"`
	StaffID                      uint       `json:"staff_id" gorm:"not null;index"`
	CustomerCount                int        `json:"customer_count" gorm:"not null;default:1;check:chk_orders_customer_count_positive,customer_count > 0"`
	CustomerName                 string     `json:"customer_name" gorm:"size:80"`
	CustomerPhone                string     `json:"customer_phone" gorm:"size:32"`
	Status                       string     `json:"status" gorm:"size:32;not null;default:'open';index:idx_orders_restaurant_status_opened,priority:2;index:idx_orders_reporting,priority:2;check:chk_orders_status,status IN ('open','sent_to_kitchen','cooking','ready','served','completed','cancelled')"`
	Subtotal                     float64    `json:"subtotal" gorm:"type:numeric(14,2);not null;default:0;check:chk_orders_subtotal_nonnegative,subtotal >= 0"`
	DiscountAmount               float64    `json:"discount_amount" gorm:"type:numeric(14,2);not null;default:0;check:chk_orders_discount_nonnegative,discount_amount >= 0"`
	ServiceChargeAmount          float64    `json:"service_charge_amount" gorm:"type:numeric(14,2);not null;default:0;check:chk_orders_service_charge_nonnegative,service_charge_amount >= 0"`
	VATAmount                    float64    `json:"vat_amount" gorm:"type:numeric(14,2);not null;default:0;check:chk_orders_vat_nonnegative,vat_amount >= 0"`
	TotalAmount                  float64    `json:"total_amount" gorm:"type:numeric(14,2);not null;default:0;check:chk_orders_total_nonnegative,total_amount >= 0"`
	GrandTotal                   float64    `json:"grand_total" gorm:"type:numeric(14,2);not null;default:0;check:chk_orders_grand_total_nonnegative,grand_total >= 0"`
	PaymentStatus                string     `json:"payment_status" gorm:"size:32;not null;default:'unpaid';index;index:idx_orders_reporting,priority:3;check:chk_orders_payment_status,payment_status IN ('unpaid','paid')"`
	Note                         string     `json:"note" gorm:"size:1000"`
	OpenedAt                     time.Time  `json:"opened_at" gorm:"not null;index:idx_orders_restaurant_status_opened,priority:3;index:idx_orders_restaurant_table_opened,priority:3"`
	ClosedAt                     *time.Time `json:"closed_at"`
	CompletedAt                  *time.Time `json:"completed_at" gorm:"index:idx_orders_reporting,priority:4"`
	CancelledReason              string     `json:"cancelled_reason"`
	Version                      int        `json:"version" gorm:"not null;default:1"`
	ServiceChargeEnabledSnapshot bool       `json:"-" gorm:"not null;default:false"`
	ServiceChargeRateSnapshot    float64    `json:"-" gorm:"type:numeric(7,4);not null;default:0;check:chk_orders_service_rate_snapshot,service_charge_rate_snapshot >= 0 AND service_charge_rate_snapshot <= 100"`
	VATEnabledSnapshot           bool       `json:"-" gorm:"not null;default:false"`
	VATRateSnapshot              float64    `json:"-" gorm:"type:numeric(7,4);not null;default:0;check:chk_orders_vat_rate_snapshot,vat_rate_snapshot >= 0 AND vat_rate_snapshot <= 100"`
	KitchenTicketID              string     `json:"kitchen_ticket_id,omitempty" gorm:"-"`
	KitchenBatch                 uint       `json:"kitchen_batch,omitempty" gorm:"-"`
	KitchenSentAt                *time.Time `json:"kitchen_sent_at,omitempty" gorm:"-"`

	Restaurant *Restaurant               `json:"restaurant,omitempty" gorm:"foreignKey:RestaurantID"`
	Table      *RestaurantTable          `json:"table,omitempty" gorm:"foreignKey:TableID"`
	Staff      *User                     `json:"staff,omitempty" gorm:"foreignKey:StaffID"`
	Items      []OrderItem               `json:"items,omitempty" gorm:"foreignKey:OrderID"`
	Payments   []OrderPayment            `json:"payments,omitempty" gorm:"foreignKey:OrderID"`
	StatusLogs []OrderStatusLog          `json:"status_logs,omitempty" gorm:"foreignKey:OrderID"`
	Deductions []OrderInventoryDeduction `json:"deductions,omitempty" gorm:"foreignKey:OrderID"`
}

type OrderItem struct {
	gorm.Model
	OrderID         uint       `json:"order_id" gorm:"not null;index;index:idx_order_items_order_status_batch,priority:1"`
	RestaurantID    uint       `json:"restaurant_id" gorm:"not null;index;index:idx_order_items_restaurant_status,priority:1"`
	MenuID          uint       `json:"menu_id" gorm:"not null;index"`
	MenuName        string     `json:"menu_name" gorm:"not null"`
	UnitPrice       float64    `json:"unit_price" gorm:"type:numeric(14,2);not null;check:chk_order_items_unit_price_nonnegative,unit_price >= 0"`
	OptionsTotal    float64    `json:"options_total" gorm:"type:numeric(14,2);not null;default:0;check:chk_order_items_options_total_nonnegative,options_total >= 0"`
	Quantity        int        `json:"quantity" gorm:"not null;check:chk_order_items_quantity_positive,quantity > 0"`
	Subtotal        float64    `json:"subtotal" gorm:"type:numeric(14,2);not null;check:chk_order_items_subtotal_nonnegative,subtotal >= 0"`
	FulfillmentType string     `json:"fulfillment_type" gorm:"size:32;not null;default:'dine_in';index;check:chk_order_items_fulfillment,fulfillment_type IN ('dine_in','takeaway')"`
	Note            string     `json:"note" gorm:"size:500"`
	Status          string     `json:"status" gorm:"size:32;not null;default:'pending';index:idx_order_items_status_sent,priority:1;index:idx_order_items_order_status_batch,priority:2;index:idx_order_items_restaurant_status,priority:2;check:chk_order_items_status,status IN ('pending','cooking','ready','served','cancelled')"`
	SentAt          *time.Time `json:"sent_at" gorm:"index:idx_order_items_status_sent,priority:2"`
	KitchenBatch    uint       `json:"kitchen_batch" gorm:"not null;default:0;index;index:idx_order_items_order_status_batch,priority:3"`
	ReadyAt         *time.Time `json:"ready_at"`
	ServedAt        *time.Time `json:"served_at"`
	CancelledReason string     `json:"cancelled_reason"`

	Order           *Order                    `json:"order,omitempty" gorm:"foreignKey:OrderID"`
	Menu            *MenuItem                 `json:"menu,omitempty" gorm:"foreignKey:MenuID"`
	SelectedOptions []OrderItemOption         `json:"selected_options,omitempty" gorm:"foreignKey:OrderItemID"`
	RecipeSnapshots []OrderItemRecipeSnapshot `json:"-" gorm:"foreignKey:OrderItemID"`
	Deductions      []OrderInventoryDeduction `json:"deductions,omitempty" gorm:"foreignKey:OrderItemID"`
}

type OrderStatusLog struct {
	gorm.Model
	OrderID    uint      `json:"order_id" gorm:"not null;index"`
	FromStatus string    `json:"from_status"`
	ToStatus   string    `json:"to_status" gorm:"not null"`
	ChangedBy  uint      `json:"changed_by" gorm:"not null;index"`
	ChangedAt  time.Time `json:"changed_at" gorm:"not null"`
	Note       string    `json:"note"`

	Order *Order `json:"order,omitempty" gorm:"foreignKey:OrderID"`
	User  *User  `json:"user,omitempty" gorm:"foreignKey:ChangedBy"`
}

type OrderPayment struct {
	gorm.Model
	OrderID        uint      `json:"order_id" gorm:"not null;uniqueIndex:idx_order_payments_one_per_order"`
	RestaurantID   uint      `json:"restaurant_id" gorm:"not null;index"`
	Method         string    `json:"method" gorm:"size:32;not null;check:chk_order_payments_method,method IN ('cash','promptpay_qr')"`
	Amount         float64   `json:"amount" gorm:"type:numeric(14,2);not null;check:chk_order_payments_amount_nonnegative,amount >= 0"`
	ReceivedAmount float64   `json:"received_amount" gorm:"type:numeric(14,2);not null;default:0;check:chk_order_payments_received_nonnegative,received_amount >= 0"`
	ChangeAmount   float64   `json:"change_amount" gorm:"type:numeric(14,2);not null;default:0;check:chk_order_payments_change_nonnegative,change_amount >= 0"`
	Note           string    `json:"note"`
	PaidBy         uint      `json:"paid_by" gorm:"not null;index"`
	PaidAt         time.Time `json:"paid_at" gorm:"not null"`

	Order *Order `json:"order,omitempty" gorm:"foreignKey:OrderID"`
	User  *User  `json:"user,omitempty" gorm:"foreignKey:PaidBy"`
}

type OrderInventoryDeduction struct {
	gorm.Model
	RestaurantID uint    `json:"restaurant_id" gorm:"not null;index"`
	OrderID      uint    `json:"order_id" gorm:"not null;uniqueIndex:idx_order_deduction_once,priority:1"`
	OrderItemID  uint    `json:"order_item_id" gorm:"not null;uniqueIndex:idx_order_deduction_once,priority:2"`
	MenuItemID   uint    `json:"menu_item_id" gorm:"not null;index"`
	IngredientID uint    `json:"ingredient_id" gorm:"not null;uniqueIndex:idx_order_deduction_once,priority:3"`
	Quantity     float64 `json:"quantity" gorm:"type:numeric(18,6);not null;check:chk_order_deductions_quantity_positive,quantity > 0"`
	CostSnapshot float64 `json:"cost_snapshot" gorm:"type:numeric(14,2);not null;default:0;check:chk_order_deductions_cost_nonnegative,cost_snapshot >= 0"`
	Note         string  `json:"note"`
	CreatedByID  uint    `json:"created_by_id"`

	Order      *Order      `json:"order,omitempty" gorm:"foreignKey:OrderID"`
	OrderItem  *OrderItem  `json:"order_item,omitempty" gorm:"foreignKey:OrderItemID"`
	Ingredient *Ingredient `json:"ingredient,omitempty" gorm:"foreignKey:IngredientID"`
	CreatedBy  *User       `json:"created_by,omitempty" gorm:"foreignKey:CreatedByID"`
}

// OrderItemRecipeSnapshot freezes the ingredient consumption and costing inputs
// that applied when an order item was added. Menu recipe edits made later must
// not change stock deductions for an existing order item.
type OrderItemRecipeSnapshot struct {
	gorm.Model
	RestaurantID    uint    `json:"restaurant_id" gorm:"not null;index"`
	OrderID         uint    `json:"order_id" gorm:"not null;index"`
	OrderItemID     uint    `json:"order_item_id" gorm:"not null;uniqueIndex:idx_order_item_recipe_snapshot,priority:1"`
	MenuItemID      uint    `json:"menu_item_id" gorm:"not null;index"`
	IngredientID    uint    `json:"ingredient_id" gorm:"not null;uniqueIndex:idx_order_item_recipe_snapshot,priority:2"`
	IngredientName  string  `json:"ingredient_name" gorm:"not null"`
	Unit            string  `json:"unit" gorm:"not null"`
	QuantityPerItem float64 `json:"quantity_per_item" gorm:"type:numeric(18,6);not null;check:chk_order_recipe_quantity_positive,quantity_per_item > 0"`
	CostPerUnit     float64 `json:"cost_per_unit" gorm:"type:numeric(18,6);not null;default:0;check:chk_order_recipe_cost_nonnegative,cost_per_unit >= 0"`
	YieldPercent    float64 `json:"yield_percent" gorm:"type:numeric(5,2);not null;default:100;check:chk_order_recipe_yield_valid,yield_percent > 0 AND yield_percent <= 100"`

	Order      *Order      `json:"-" gorm:"foreignKey:OrderID"`
	OrderItem  *OrderItem  `json:"-" gorm:"foreignKey:OrderItemID"`
	Ingredient *Ingredient `json:"-" gorm:"foreignKey:IngredientID"`
}

// CustomerOrderSubmission persists public QR request idempotency. A request key
// is unique within an order session, allowing the same physical table to reuse a
// key safely after a new order starts.
type CustomerOrderSubmission struct {
	gorm.Model
	RestaurantID uint   `json:"-" gorm:"not null;index"`
	TableID      uint   `json:"-" gorm:"not null;index"`
	OrderID      uint   `json:"-" gorm:"not null;uniqueIndex:idx_customer_order_request,priority:1"`
	RequestKey   string `json:"-" gorm:"size:128;not null;uniqueIndex:idx_customer_order_request,priority:2"`
	RequestHash  string `json:"-" gorm:"size:64;not null"`

	Order *Order `json:"-" gorm:"foreignKey:OrderID"`
}
