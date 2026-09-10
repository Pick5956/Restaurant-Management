package service

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"Project-M/internal/entity"
	"Project-M/internal/repository"

	"gorm.io/gorm"
)

type OrderService struct {
	repo *repository.OrderRepository
}

func ProvideOrderService(repo *repository.OrderRepository) *OrderService {
	return &OrderService{repo: repo}
}

type OpenOrderRequest struct {
	TableID         *uint  `json:"table_id"`
	OrderType       string `json:"order_type" binding:"omitempty,oneof=dine_in takeaway"`
	CustomerCount   int    `json:"customer_count" binding:"gte=0,lte=1000"`
	CustomerName    string `json:"customer_name" binding:"max=80"`
	CustomerPhone   string `json:"customer_phone" binding:"max=32"`
	Note            string `json:"note" binding:"max=1000"`
	SeatReservation bool   `json:"seat_reservation"`
}

type UpdateOrderRequest struct {
	CustomerCount int    `json:"customer_count" binding:"gte=0,lte=1000"`
	Note          string `json:"note" binding:"max=1000"`
}

type AddOrderItemRequest struct {
	MenuID            uint   `json:"menu_id" binding:"required"`
	Quantity          int    `json:"quantity" binding:"gte=0,lte=100"`
	Note              string `json:"note" binding:"max=500"`
	FulfillmentType   string `json:"fulfillment_type" binding:"omitempty,oneof=dine_in takeaway"`
	SelectedOptionIDs []uint `json:"selected_option_ids" binding:"max=50"`
	// ServeImmediately records an item that already reached the guest (e.g. a
	// drink poured and served before it was keyed in). It skips the kitchen:
	// the item is created as "served" and its ingredients are deducted at once.
	ServeImmediately bool `json:"serve_immediately"`
}

type UpdateOrderItemRequest struct {
	Quantity int    `json:"quantity" binding:"required,gte=1,lte=100"`
	Note     string `json:"note" binding:"max=500"`
}

// VoidItemUnitsRequest voids a chosen number of units from a single order item
// line. It is the checkout-time counterpart to editing a pending item: a
// pending line is edited freely, but a line already sent to the kitchen can
// only be voided (with a reason) for audit — this lets the cashier void part of
// a multi-unit line instead of the whole thing.
type VoidItemUnitsRequest struct {
	Quantity int    `json:"quantity" binding:"required,gte=1,lte=100"`
	Reason   string `json:"reason" binding:"required,max=500"`
}

type StatusRequest struct {
	Status string `json:"status" binding:"required,oneof=pending cooking ready served cancelled"`
	Reason string `json:"reason" binding:"max=500"`
	Note   string `json:"note" binding:"max=500"`
}

type OrderItemStatusActor string

const (
	OrderItemStatusActorKitchenManager OrderItemStatusActor = "kitchen_manager"
	OrderItemStatusActorFrontOfHouse   OrderItemStatusActor = "front_of_house"
)

var ErrOrderItemStatusForbidden = errors.New("order item status transition is forbidden")

func validateOrderItemStatusActor(actor OrderItemStatusActor, status string) error {
	switch actor {
	case OrderItemStatusActorKitchenManager:
		return nil
	case OrderItemStatusActorFrontOfHouse:
		if status == entity.OrderItemStatusServed || status == entity.OrderItemStatusCancelled {
			return nil
		}
	}
	return ErrOrderItemStatusForbidden
}

func normalizeItemCancellationReason(status, reason string) (string, error) {
	if status != entity.OrderItemStatusCancelled {
		return "", nil
	}
	normalized := strings.TrimSpace(reason)
	if normalized == "" {
		return "", errors.New("cancellation reason is required")
	}
	if utf8.RuneCountInString(normalized) > 500 {
		return "", errors.New("cancellation reason must not exceed 500 characters")
	}
	return normalized, nil
}

type CancelRequest struct {
	Reason string `json:"reason" binding:"required,max=500"`
}

type PayOrderRequest struct {
	Method         string  `json:"method" binding:"required,oneof=cash promptpay_qr"`
	ReceivedAmount float64 `json:"received_amount" binding:"gte=0"`
	Note           string  `json:"note" binding:"max=500"`
}

type BillResponse struct {
	Order                *entity.Order         `json:"order"`
	Items                []entity.OrderItem    `json:"items"`
	Subtotal             float64               `json:"subtotal"`
	DiscountAmount       float64               `json:"discount_amount"`
	ServiceChargeEnabled bool                  `json:"service_charge_enabled"`
	ServiceChargeRate    float64               `json:"service_charge_rate"`
	ServiceChargeAmount  float64               `json:"service_charge_amount"`
	VATEnabled           bool                  `json:"vat_enabled"`
	VATRate              float64               `json:"vat_rate"`
	VATAmount            float64               `json:"vat_amount"`
	TotalAmount          float64               `json:"total_amount"`
	GrandTotal           float64               `json:"grand_total"`
	PaymentStatus        string                `json:"payment_status"`
	PromptPayName        string                `json:"promptpay_name"`
	PromptPayQRImage     string                `json:"promptpay_qr_image"`
	Payments             []entity.OrderPayment `json:"payments"`
}

type selectedMenuOption struct {
	ID            uint
	OptionGroupID uint
	GroupName     string
	OptionName    string
	PriceDelta    float64
	// Ingredients is what this option does to the dish ingredient use. It rides
	// along with the selection because the recipe snapshot is written in the same
	// breath as the option snapshot, and an option that changes the price without
	// changing the stock is exactly the bug this field exists to prevent.
	Ingredients []entity.MenuOptionIngredient
}

func shouldSeatReservationOnOpen(tableStatus string, requested bool) (bool, error) {
	if tableStatus == entity.TableStatusReserved {
		if !requested {
			return false, errors.New("table is reserved")
		}
		return true, nil
	}
	if requested {
		return false, errors.New("table has no active reservation")
	}
	return false, nil
}

func (s *OrderService) OpenOrder(restaurantID, userID uint, req *OpenOrderRequest) (*entity.Order, error) {
	var created *entity.Order
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		orderType, err := normalizeOrderType(req.OrderType)
		if err != nil {
			return err
		}
		var table *entity.RestaurantTable
		var tableID *uint
		seatReservation := false
		if orderType == entity.OrderTypeDineIn {
			if req.TableID == nil || *req.TableID == 0 {
				return errors.New("table_id is required for dine-in orders")
			}
			tableID = req.TableID
			table, err = tx.FindTableForUpdate(restaurantID, *req.TableID)
			if err != nil {
				return errors.New("table not found")
			}
			if _, err := tx.FindOpenOrderByTable(restaurantID, *req.TableID); err == nil {
				return errors.New("table already has an open order")
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if table.Status == entity.TableStatusInactive {
				return errors.New("table is inactive")
			}
			seatReservation, err = shouldSeatReservationOnOpen(table.Status, req.SeatReservation)
			if err != nil {
				return err
			}
		} else if req.SeatReservation {
			return errors.New("reservation seating requires a dine-in table")
		}
		if err := tx.LockRestaurantOrderCounter(restaurantID); err != nil {
			return err
		}
		now := repository.BangkokNow()
		orderDate := now.Format("2006-01-02")
		// The highest number used today, not a count of the live ones. See
		// MaxOrderSequenceForDate: a count regresses when an empty table is
		// closed, and hands the next order a number that is already taken.
		// The advisory lock above is still required — it serialises the
		// read-then-insert; this only makes the value it reads the truth.
		sequence, err := tx.MaxOrderSequenceForDate(restaurantID, orderDate)
		if err != nil {
			return err
		}
		customerCount := req.CustomerCount
		if customerCount <= 0 {
			customerCount = 1
		}
		order := &entity.Order{
			RestaurantID:  restaurantID,
			TableID:       tableID,
			OrderType:     orderType,
			OrderNumber:   orderNumberForDate(now.Format("20060102"), int(sequence)+1),
			OrderDate:     orderDate,
			StaffID:       userID,
			CustomerCount: customerCount,
			CustomerName:  strings.TrimSpace(req.CustomerName),
			CustomerPhone: strings.TrimSpace(req.CustomerPhone),
			Status:        entity.OrderStatusOpen,
			PaymentStatus: entity.PaymentStatusUnpaid,
			Note:          strings.TrimSpace(req.Note),
			OpenedAt:      now,
			Version:       1,
		}
		if err := tx.CreateOrder(order); err != nil {
			return err
		}
		logNote := "order opened"
		if orderType == entity.OrderTypeTakeaway {
			logNote = "takeaway order opened"
		}
		if err := tx.CreateStatusLog(statusLog(order.ID, "", entity.OrderStatusOpen, userID, logNote)); err != nil {
			return err
		}
		if table != nil {
			if seatReservation {
				if err := tx.ResolveActiveReservation(restaurantID, table.ID, entity.ReservationStatusSeated); err != nil {
					return err
				}
			}
			table.Status = entity.TableStatusOccupied
			table.ReservationName = ""
			table.ReservationPhone = ""
			if err := tx.SaveTable(table); err != nil {
				return err
			}
		}
		created = order
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, created.ID)
}

func (s *OrderService) ListOrders(restaurantID uint, status string, tableID uint, orderDate, paymentStatus, search string, includeSummary bool, page, limit int) (*repository.OrderListResult, error) {
	if page < 1 {
		page = 1
	}
	if page > 1000 {
		page = 1000
	}
	if limit < 1 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	status = strings.TrimSpace(status)
	orderDate = strings.TrimSpace(orderDate)
	paymentStatus = strings.TrimSpace(paymentStatus)
	search = strings.TrimSpace(search)
	if err := ValidateOrderListFilters(status, orderDate, paymentStatus, search); err != nil {
		return nil, err
	}
	return s.repo.ListOrders(
		restaurantID,
		status,
		tableID,
		orderDate,
		paymentStatus,
		search,
		includeSummary,
		page,
		limit,
	)
}

func (s *OrderService) GetOrder(restaurantID, orderID uint) (*entity.Order, error) {
	order, err := s.repo.FindOrder(restaurantID, orderID)
	if err != nil {
		return nil, err
	}
	applyEffectiveOrderStatus(order)
	return order, nil
}

// GetOrderByNumber looks up an order by its human-readable order_number (e.g. "20260724-015").
func (s *OrderService) GetOrderByNumber(restaurantID uint, orderNumber string) (*entity.Order, error) {
	if !validOrderNumber(orderNumber) {
		return nil, errors.New("invalid order number")
	}
	order, err := s.repo.FindOrderByNumber(restaurantID, orderNumber)
	if err != nil {
		return nil, err
	}
	applyEffectiveOrderStatus(order)
	return order, nil
}

func ValidateOrderListFilters(status, orderDate, paymentStatus, search string) error {
	validStatuses := map[string]bool{
		"": true, "active": true, "closed": true,
		entity.OrderStatusOpen: true, entity.OrderStatusSentToKitchen: true,
		entity.OrderStatusCooking: true, entity.OrderStatusReady: true,
		entity.OrderStatusServed: true, entity.OrderStatusCompleted: true,
		entity.OrderStatusCancelled: true,
	}
	if !validStatuses[status] {
		return errors.New("invalid order status")
	}
	if paymentStatus != "" && paymentStatus != entity.PaymentStatusPaid && paymentStatus != entity.PaymentStatusUnpaid {
		return errors.New("invalid payment status")
	}
	if orderDate != "" {
		parsed, err := time.Parse("2006-01-02", orderDate)
		if err != nil || parsed.Format("2006-01-02") != orderDate {
			return errors.New("invalid order date")
		}
	}
	if utf8.RuneCountInString(search) > 100 {
		return errors.New("search is too long")
	}
	return nil
}

// validOrderNumber accepts the current YYYYMMDD-NNN format (e.g. "20260724-015")
// as well as the legacy letter-prefixed format (e.g. "A001") so that orders
// created before the format change can still be looked up by number.
func validOrderNumber(value string) bool {
	if len(value) < 4 || len(value) > 32 {
		return false
	}
	// Current format: eight leading digits, a dash, then >=3 digits.
	if strings.IndexByte(value, '-') >= 0 {
		if len(value) < 12 || value[8] != '-' {
			return false
		}
		for i := 0; i < len(value); i++ {
			if i == 8 {
				continue
			}
			if value[i] < '0' || value[i] > '9' {
				return false
			}
		}
		return true
	}
	// Legacy format: one or more uppercase letters followed by >=3 digits.
	split := len(value) - 3
	for _, char := range value[:split] {
		if char < 'A' || char > 'Z' {
			return false
		}
	}
	for _, char := range value[split:] {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func (s *OrderService) UpdateOrder(restaurantID, userID, orderID uint, req *UpdateOrderRequest) (*entity.Order, error) {
	var updated *entity.Order
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if isTerminalOrder(order.Status) {
			return errors.New("cannot update a closed order")
		}
		if req.CustomerCount > 0 {
			order.CustomerCount = req.CustomerCount
		}
		order.Note = strings.TrimSpace(req.Note)
		if err := tx.SaveOrder(order); err != nil {
			return err
		}
		updated = order
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, updated.ID)
}

func (s *OrderService) AddItem(restaurantID, userID, orderID uint, req *AddOrderItemRequest) (*entity.Order, error) {
	var changed uint
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if isTerminalOrder(order.Status) {
			return errors.New("cannot add item to a closed order")
		}
		// Serialize order writes per restaurant so the capacity check below can't race
		// another order into overselling the same ingredient. Taken after the order
		// row lock to keep a consistent lock order with OpenOrder (row then advisory).
		if err := tx.LockRestaurantOrderCounter(restaurantID); err != nil {
			return err
		}
		menu, err := tx.FindMenuItem(restaurantID, req.MenuID)
		if err != nil {
			return errors.New("menu item not found")
		}
		if !menu.IsAvailable {
			return errors.New("menu item is unavailable")
		}
		fulfillmentType, err := normalizeOrderItemFulfillment(req.FulfillmentType, order.OrderType)
		if err != nil {
			return err
		}
		qty := req.Quantity
		if qty <= 0 {
			qty = 1
		}
		if err := ensureMenuCapacity(tx, restaurantID, menu.ID, menu.Name, qty); err != nil {
			return err
		}
		selectedOptions, optionsTotal, err := validateSelectedMenuOptions(menu, req.SelectedOptionIDs)
		if err != nil {
			return err
		}
		itemStatus := entity.OrderItemStatusPending
		if req.ServeImmediately {
			itemStatus = entity.OrderItemStatusServed
		}
		item := &entity.OrderItem{
			OrderID:         order.ID,
			RestaurantID:    restaurantID,
			MenuID:          menu.ID,
			MenuName:        menu.Name,
			UnitPrice:       menu.Price,
			OptionsTotal:    optionsTotal,
			Quantity:        qty,
			Subtotal:        (menu.Price + optionsTotal) * float64(qty),
			FulfillmentType: fulfillmentType,
			Note:            strings.TrimSpace(req.Note),
			Status:          itemStatus,
		}
		if req.ServeImmediately {
			now := repository.BangkokNow()
			item.ServedAt = &now
		}
		if err := tx.CreateItem(item); err != nil {
			return err
		}
		if err := snapshotRecipeForOrderItem(tx, order, item, selectedOptions); err != nil {
			return err
		}
		for _, option := range selectedOptions {
			snapshot := &entity.OrderItemOption{
				OrderItemID:   item.ID,
				OrderID:       order.ID,
				RestaurantID:  restaurantID,
				MenuOptionID:  option.ID,
				OptionGroupID: option.OptionGroupID,
				GroupName:     option.GroupName,
				OptionName:    option.OptionName,
				PriceDelta:    option.PriceDelta,
			}
			if err := tx.CreateItemOption(snapshot); err != nil {
				return err
			}
		}
		if req.ServeImmediately {
			// Already handed to the guest, so bypass the kitchen and deduct its
			// ingredients now — the same accounting a completed item receives.
			if err := deductInventoryForCompletedKitchenItem(tx, restaurantID, userID, order, item); err != nil {
				return err
			}
		}
		if err := recalcOrderTotals(tx, order); err != nil {
			return err
		}
		if req.ServeImmediately {
			// The item is already served, so recompute from the item set rather
			// than reopening the order the way a pending item would.
			if err := refreshOrderStatusFromItems(tx, order, userID); err != nil {
				return err
			}
		} else {
			nextStatus := orderStatusAfterPendingItemAdded(order.Status)
			if nextStatus != order.Status {
				if err := setOrderStatus(tx, order, nextStatus, userID, "pending item added"); err != nil {
					return err
				}
			}
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

func (s *OrderService) UpdateItem(restaurantID, orderID, itemID uint, req *UpdateOrderItemRequest) (*entity.Order, error) {
	var changed uint
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, item, err := editablePendingItem(tx, restaurantID, orderID, itemID)
		if err != nil {
			return err
		}
		qty := req.Quantity
		if qty <= 0 {
			return errors.New("quantity must be greater than zero")
		}
		// Raising the quantity claims more stock, so gate the increase the same way a
		// new item is gated. The item's current quantity is already counted in the
		// committed usage, so only the delta needs fresh capacity.
		if delta := qty - item.Quantity; delta > 0 {
			if err := tx.LockRestaurantOrderCounter(restaurantID); err != nil {
				return err
			}
			if err := ensureMenuCapacity(tx, restaurantID, item.MenuID, item.MenuName, delta); err != nil {
				return err
			}
		}
		item.Quantity = qty
		item.Note = strings.TrimSpace(req.Note)
		item.Subtotal = (item.UnitPrice + item.OptionsTotal) * float64(qty)
		if err := tx.SaveItem(item); err != nil {
			return err
		}
		if err := recalcOrderTotals(tx, order); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

func (s *OrderService) DeleteItem(restaurantID, orderID, itemID uint) (*entity.Order, error) {
	var changed uint
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, item, err := editablePendingItem(tx, restaurantID, orderID, itemID)
		if err != nil {
			return err
		}
		if err := tx.DeleteItem(item); err != nil {
			return err
		}
		if err := recalcOrderTotals(tx, order); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

func (s *OrderService) SendToKitchen(restaurantID, userID, orderID uint) (*entity.Order, error) {
	var changed uint
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if isTerminalOrder(order.Status) {
			return errors.New("cannot send a closed order to kitchen")
		}
		if err := sendPendingItemsToKitchen(tx, order, userID); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

func (s *OrderService) UpdateItemStatus(
	restaurantID, userID, orderID, itemID uint,
	status, reason string,
	actor OrderItemStatusActor,
) (*entity.Order, error) {
	next := strings.TrimSpace(status)
	if err := validateOrderItemStatusActor(actor, next); err != nil {
		return nil, err
	}
	var changed uint
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if isTerminalOrder(order.Status) {
			return errors.New("cannot update item status on closed order")
		}
		if actor == OrderItemStatusActorFrontOfHouse && next == entity.OrderItemStatusCancelled {
			// AddItem and customer submissions lock the same parent order before
			// inserting, so this authorization check cannot race an unsent item.
			hasPending, err := tx.HasPendingItems(restaurantID, order.ID)
			if err != nil {
				return err
			}
			if hasPending {
				return fmt.Errorf("front-of-house void requires every item to be sent: %w", ErrOrderItemStatusForbidden)
			}
		}
		item, err := tx.FindItemForUpdate(restaurantID, order.ID, itemID)
		if err != nil {
			return err
		}
		if !canTransitionItem(item.Status, next) {
			return fmt.Errorf("invalid item status transition from %s to %s", item.Status, next)
		}
		cancelReason, err := normalizeItemCancellationReason(next, reason)
		if err != nil {
			return err
		}
		now := repository.BangkokNow()
		item.Status = next
		if next == entity.OrderItemStatusCooking {
			item.ReadyAt = nil
			item.ServedAt = nil
			item.CancelledReason = ""
		}
		if next == entity.OrderItemStatusReady {
			if err := deductInventoryForCompletedKitchenItem(tx, restaurantID, userID, order, item); err != nil {
				return err
			}
			item.ReadyAt = &now
			item.CancelledReason = ""
		}
		if next == entity.OrderItemStatusServed {
			if err := deductInventoryForCompletedKitchenItem(tx, restaurantID, userID, order, item); err != nil {
				return err
			}
			item.ServedAt = &now
			item.CancelledReason = ""
		}
		if next == entity.OrderItemStatusCancelled {
			item.CancelledReason = cancelReason
		}
		if err := tx.SaveItem(item); err != nil {
			return err
		}
		if next == entity.OrderItemStatusCancelled {
			if err := recalcOrderTotals(tx, order); err != nil {
				return err
			}
		}
		if err := refreshOrderStatusFromItems(tx, order, userID); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

// VoidItemUnits voids `count` units from a single order item line, capturing a
// reason for audit. When count covers the whole line it behaves exactly like a
// full void; otherwise the line is split — the remaining units stay live and
// the voided units are moved to a cancelled clone so totals and void reporting
// stay correct. Inventory is never restocked (the food may already be made),
// matching the existing full-line void.
func (s *OrderService) VoidItemUnits(
	restaurantID, userID, orderID, itemID uint,
	count int,
	reason string,
	actor OrderItemStatusActor,
) (*entity.Order, error) {
	if err := validateOrderItemStatusActor(actor, entity.OrderItemStatusCancelled); err != nil {
		return nil, err
	}
	if count <= 0 {
		return nil, errors.New("quantity must be greater than zero")
	}
	cancelReason, err := normalizeItemCancellationReason(entity.OrderItemStatusCancelled, reason)
	if err != nil {
		return nil, err
	}
	var changed uint
	err = s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if isTerminalOrder(order.Status) {
			return errors.New("cannot update item status on closed order")
		}
		if actor == OrderItemStatusActorFrontOfHouse {
			// Mirror the whole-line void rule: a cashier may only void once every
			// item is sent, so an unsent line is never voided behind the kitchen.
			hasPending, err := tx.HasPendingItems(restaurantID, order.ID)
			if err != nil {
				return err
			}
			if hasPending {
				return fmt.Errorf("front-of-house void requires every item to be sent: %w", ErrOrderItemStatusForbidden)
			}
		}
		item, err := tx.FindItemForUpdate(restaurantID, order.ID, itemID)
		if err != nil {
			return err
		}
		if !canTransitionItem(item.Status, entity.OrderItemStatusCancelled) {
			return fmt.Errorf("invalid item status transition from %s to %s", item.Status, entity.OrderItemStatusCancelled)
		}
		if count >= item.Quantity {
			// Voiding the whole line — identical outcome to a full cancel.
			item.Status = entity.OrderItemStatusCancelled
			item.CancelledReason = cancelReason
			if err := tx.SaveItem(item); err != nil {
				return err
			}
		} else {
			// Keep the remaining units on the live line and split the voided
			// units onto a cancelled clone that records the reason.
			voided := cloneOrderItemForVoid(item, count, cancelReason)
			item.Quantity -= count
			item.Subtotal = (item.UnitPrice + item.OptionsTotal) * float64(item.Quantity)
			if err := tx.SaveItem(item); err != nil {
				return err
			}
			if err := tx.CreateItem(voided); err != nil {
				return err
			}
		}
		if err := recalcOrderTotals(tx, order); err != nil {
			return err
		}
		if err := refreshOrderStatusFromItems(tx, order, userID); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

// cloneOrderItemForVoid builds a cancelled copy of src holding `count` units. It
// carries the descriptive and kitchen fields so the void reads coherently in
// history; per-unit option rows are not duplicated (the price is preserved via
// OptionsTotal). It intentionally creates no inventory deductions.
func cloneOrderItemForVoid(src *entity.OrderItem, count int, reason string) *entity.OrderItem {
	return &entity.OrderItem{
		OrderID:         src.OrderID,
		RestaurantID:    src.RestaurantID,
		MenuID:          src.MenuID,
		MenuName:        src.MenuName,
		UnitPrice:       src.UnitPrice,
		OptionsTotal:    src.OptionsTotal,
		Quantity:        count,
		Subtotal:        (src.UnitPrice + src.OptionsTotal) * float64(count),
		FulfillmentType: src.FulfillmentType,
		Note:            src.Note,
		Status:          entity.OrderItemStatusCancelled,
		SentAt:          src.SentAt,
		KitchenBatch:    src.KitchenBatch,
		ReadyAt:         src.ReadyAt,
		ServedAt:        src.ServedAt,
		CancelledReason: reason,
	}
}

func (s *OrderService) CancelOrder(restaurantID, userID, orderID uint, reason string) (*entity.Order, error) {
	var changed uint
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if isTerminalOrder(order.Status) {
			return errors.New("order is already closed")
		}
		order.CancelledReason = strings.TrimSpace(reason)
		now := repository.BangkokNow()
		order.ClosedAt = &now
		if err := setOrderStatus(tx, order, entity.OrderStatusCancelled, userID, order.CancelledReason); err != nil {
			return err
		}
		if err := releaseTableIfNoOpenOrder(tx, restaurantID, order.TableID); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindOrder(restaurantID, changed)
}

func validateEmptyTableClose(order *entity.Order) error {
	if order == nil || order.OrderType != entity.OrderTypeDineIn || order.TableID == nil || *order.TableID == 0 {
		return errors.New("only an empty dine-in table can be closed")
	}
	if order.Status != entity.OrderStatusOpen {
		return errors.New("only an open table can be closed without an order")
	}
	// Cancelled items (e.g. the kitchen ran out of stock) leave the table empty,
	// so only outstanding non-cancelled items should block closing it.
	for _, item := range order.Items {
		if item.Status != entity.OrderItemStatusCancelled {
			return errors.New("table order already has items")
		}
	}
	return nil
}

func (s *OrderService) CloseEmptyTable(restaurantID, userID, orderID uint) (*entity.Order, error) {
	var closedEmpty *entity.Order
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if err := validateEmptyTableClose(order); err != nil {
			return err
		}
		now := repository.BangkokNow()

		if len(order.Items) == 0 {
			// The table was opened but nothing was ever ordered. Delete the empty
			// order outright so it is not archived — there is nothing to record.
			if err := tx.DeleteOrder(order); err != nil {
				return err
			}
			if err := releaseTableIfNoOpenOrder(tx, restaurantID, order.TableID); err != nil {
				return err
			}
			// The row is gone; reflect the close in the in-memory copy we return.
			order.Status = entity.OrderStatusCancelled
			order.ClosedAt = &now
			closedEmpty = order
			return nil
		}

		// Items were placed then all cancelled — keep a cancelled record.
		const reason = "empty table closed"
		order.CancelledReason = reason
		order.ClosedAt = &now
		if err := setOrderStatus(tx, order, entity.OrderStatusCancelled, userID, reason); err != nil {
			return err
		}
		return releaseTableIfNoOpenOrder(tx, restaurantID, order.TableID)
	})
	if err != nil {
		return nil, err
	}
	if closedEmpty != nil {
		return closedEmpty, nil
	}
	return s.repo.FindOrder(restaurantID, orderID)
}

func (s *OrderService) KitchenQueue(restaurantID uint) ([]entity.Order, error) {
	return s.repo.KitchenQueue(restaurantID)
}

func (s *OrderService) Bill(restaurantID, orderID uint) (*BillResponse, error) {
	order, err := s.repo.FindOrder(restaurantID, orderID)
	if err != nil {
		return nil, err
	}
	applyEffectiveOrderStatus(order)
	restaurant, err := s.repo.FindRestaurant(restaurantID)
	if err != nil {
		return nil, err
	}
	return billFromOrder(order, restaurant), nil
}

func (s *OrderService) PayOrder(restaurantID, userID, orderID uint, req *PayOrderRequest) (*entity.Order, error) {
	var changed uint
	var reconciledFrom, reconciledTo string
	err := s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, err := tx.FindOrderForUpdate(restaurantID, orderID)
		if err != nil {
			return err
		}
		if order.PaymentStatus == entity.PaymentStatusPaid {
			changed = order.ID
			return nil
		}
		statusBeforeReconcile := order.Status
		if err := refreshOrderStatusFromItems(tx, order, userID); err != nil {
			return err
		}
		if order.Status != statusBeforeReconcile {
			reconciledFrom = statusBeforeReconcile
			reconciledTo = order.Status
		}
		if err := validateOrderReadyForPayment(order); err != nil {
			return err
		}
		if err := finalizeReadyItemsForPayment(tx, restaurantID, userID, order); err != nil {
			return err
		}
		method := strings.TrimSpace(req.Method)
		if method != "cash" && method != "promptpay_qr" {
			return errors.New("invalid payment method")
		}
		restaurant, err := tx.FindRestaurant(restaurantID)
		if err != nil {
			return err
		}
		bill := billFromOrder(order, restaurant)
		received := req.ReceivedAmount
		received, err = normalizeReceivedAmount(method, received, bill.GrandTotal)
		if err != nil {
			return err
		}
		now := repository.BangkokNow()
		order.ServiceChargeAmount = bill.ServiceChargeAmount
		order.VATAmount = bill.VATAmount
		order.TotalAmount = bill.TotalAmount
		order.GrandTotal = bill.GrandTotal
		order.PaymentStatus = entity.PaymentStatusPaid
		order.ClosedAt = &now
		order.CompletedAt = &now
		order.ServiceChargeEnabledSnapshot = restaurant.ServiceChargeEnabled
		order.ServiceChargeRateSnapshot = restaurant.ServiceChargeRate
		order.VATEnabledSnapshot = restaurant.VATEnabled
		order.VATRateSnapshot = restaurant.VATRate
		if err := setOrderStatus(tx, order, entity.OrderStatusCompleted, userID, "payment received"); err != nil {
			return err
		}
		payment := &entity.OrderPayment{
			OrderID:        order.ID,
			RestaurantID:   restaurantID,
			Method:         method,
			Amount:         bill.GrandTotal,
			ReceivedAmount: roundMoney(received),
			ChangeAmount:   roundMoney(received - bill.GrandTotal),
			Note:           strings.TrimSpace(req.Note),
			PaidBy:         userID,
			PaidAt:         now,
		}
		if err := tx.CreatePayment(payment); err != nil {
			return err
		}
		if err := releaseTableIfNoOpenOrder(tx, restaurantID, order.TableID); err != nil {
			return err
		}
		changed = order.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	if reconciledFrom != "" {
		log.Printf(
			"order_status_aggregate_reconciled restaurant_id=%d order_id=%d from=%s to=%s",
			restaurantID,
			orderID,
			reconciledFrom,
			reconciledTo,
		)
	}
	return s.repo.FindOrder(restaurantID, changed)
}

// orderNumberForDate builds a human-readable, internationally recognizable order
// number in the form YYYYMMDD-NNN (e.g. "20260724-015"). The sequence resets
// daily (index is the count of that day's orders + 1) and is zero-padded to at
// least three digits, growing wider past 999.
func orderNumberForDate(dateCompact string, index int) string {
	if index < 1 {
		index = 1
	}
	return fmt.Sprintf("%s-%03d", dateCompact, index)
}

func normalizeReceivedAmount(method string, received, grandTotal float64) (float64, error) {
	if received < 0 {
		return 0, errors.New("received amount cannot be negative")
	}
	if method == "promptpay_qr" || received == 0 {
		received = grandTotal
	}
	if received < grandTotal {
		return 0, errors.New("received amount is less than grand total")
	}
	return received, nil
}

func validateOrderReadyForPayment(order *entity.Order) error {
	status := effectiveOrderStatus(order)
	if status != entity.OrderStatusReady && status != entity.OrderStatusServed {
		return errors.New("order must be completed by the kitchen before payment")
	}
	activeItems := 0
	for _, item := range order.Items {
		if item.Status == entity.OrderItemStatusCancelled {
			continue
		}
		activeItems++
		if item.Status != entity.OrderItemStatusReady && item.Status != entity.OrderItemStatusServed {
			return errors.New("all active order items must be completed by the kitchen before payment")
		}
	}
	if activeItems == 0 {
		return errors.New("order must include a completed kitchen item before payment")
	}
	return nil
}

func orderStatusAfterPendingItemAdded(status string) string {
	if status == entity.OrderStatusReady || status == entity.OrderStatusServed {
		return entity.OrderStatusOpen
	}
	return status
}

// recipeQuantityEpsilon is the width of "this is zero". Quantities are stored as
// numeric(18,6) and reach here after unit conversion, so a line the owner meant
// to cancel exactly can land a hair off and would otherwise survive as a
// deduction of almost nothing.
const recipeQuantityEpsilon = 1e-9

// mergedRecipeLine is one ingredient total draw for an order item, after the
// selected options have been folded into the base recipe.
type mergedRecipeLine struct {
	ingredientID uint
	ingredient   *entity.Ingredient
	unit         string
	quantity     float64
}

// mergeRecipeWithOptions folds every selected option ingredient row into the dish
// recipe and returns one line per ingredient, in a stable order.
//
// Merging - rather than appending - is not a preference. OrderItemRecipeSnapshot
// is uniquely indexed on (order_item_id, ingredient_id), so an "add 2 shrimp"
// option on a dish whose recipe already uses shrimp has nowhere to put a second
// row. It also happens to be the correct arithmetic: the kitchen draws one amount
// of shrimp, not two.
//
// A line the options cancel to zero or below is dropped rather than clamped to a
// tiny positive value: the snapshot table CHECKs quantity_per_item > 0, and "no
// vegetables" on a dish with 30g of greens should deduct no greens at all. Going
// below zero never credits stock back - an option cannot un-cook the rest of the
// dish - so the floor is simply nothing.
func mergeRecipeWithOptions(
	components []entity.MenuItemIngredient,
	options []selectedMenuOption,
) ([]mergedRecipeLine, error) {
	lines := make([]mergedRecipeLine, 0, len(components))
	index := make(map[uint]int, len(components))
	for _, component := range components {
		if component.Ingredient == nil {
			return nil, errors.New("menu recipe contains an unavailable ingredient")
		}
		if component.Quantity <= 0 {
			continue
		}
		unit := strings.TrimSpace(component.Unit)
		if unit == "" {
			unit = strings.TrimSpace(component.Ingredient.Unit)
		}
		index[component.IngredientID] = len(lines)
		lines = append(lines, mergedRecipeLine{
			ingredientID: component.IngredientID,
			ingredient:   component.Ingredient,
			unit:         unit,
			quantity:     component.Quantity,
		})
	}

	for _, option := range options {
		for _, row := range option.Ingredients {
			if row.Quantity <= 0 {
				continue
			}
			delta := row.Quantity
			if row.Direction == entity.MenuOptionIngredientRemove {
				delta = -delta
			}
			if position, ok := index[row.IngredientID]; ok {
				lines[position].quantity += delta
				continue
			}
			if delta <= 0 {
				// Taking an ingredient off a dish that never had it. Nothing to
				// subtract, and inventing a negative line would deduct backwards.
				continue
			}
			if row.Ingredient == nil {
				return nil, errors.New("option ingredient is unavailable")
			}
			unit := strings.TrimSpace(row.Unit)
			if unit == "" {
				unit = strings.TrimSpace(row.Ingredient.Unit)
			}
			index[row.IngredientID] = len(lines)
			lines = append(lines, mergedRecipeLine{
				ingredientID: row.IngredientID,
				ingredient:   row.Ingredient,
				unit:         unit,
				quantity:     delta,
			})
		}
	}

	merged := make([]mergedRecipeLine, 0, len(lines))
	for _, line := range lines {
		if line.quantity <= recipeQuantityEpsilon {
			continue
		}
		merged = append(merged, line)
	}
	return merged, nil
}

func buildOrderItemRecipeSnapshots(
	order *entity.Order,
	item *entity.OrderItem,
	lines []mergedRecipeLine,
) []entity.OrderItemRecipeSnapshot {
	snapshots := make([]entity.OrderItemRecipeSnapshot, 0, len(lines))
	for _, line := range lines {
		costPerUnit := line.ingredient.CostPerUnit
		if costPerUnit < 0 {
			costPerUnit = 0
		}
		yieldPercent := line.ingredient.YieldPercent
		if yieldPercent <= 0 || yieldPercent > 100 {
			yieldPercent = 100
		}
		snapshots = append(snapshots, entity.OrderItemRecipeSnapshot{
			RestaurantID:    order.RestaurantID,
			OrderID:         order.ID,
			OrderItemID:     item.ID,
			MenuItemID:      item.MenuID,
			IngredientID:    line.ingredientID,
			IngredientName:  strings.TrimSpace(line.ingredient.Name),
			Unit:            line.unit,
			QuantityPerItem: line.quantity,
			CostPerUnit:     costPerUnit,
			YieldPercent:    yieldPercent,
		})
	}
	return snapshots
}

func snapshotRecipeForOrderItem(
	tx *repository.OrderRepository,
	order *entity.Order,
	item *entity.OrderItem,
	options []selectedMenuOption,
) error {
	components, err := tx.ListRecipeComponents(order.RestaurantID, item.MenuID)
	if err != nil {
		return err
	}
	lines, err := mergeRecipeWithOptions(components, options)
	if err != nil {
		return err
	}
	return tx.CreateItemRecipeSnapshots(buildOrderItemRecipeSnapshots(order, item, lines))
}

func editablePendingItem(tx *repository.OrderRepository, restaurantID, orderID, itemID uint) (*entity.Order, *entity.OrderItem, error) {
	order, err := tx.FindOrderForUpdate(restaurantID, orderID)
	if err != nil {
		return nil, nil, err
	}
	if isTerminalOrder(order.Status) {
		return nil, nil, errors.New("cannot edit item on a closed order")
	}
	item, err := tx.FindItemForUpdate(restaurantID, order.ID, itemID)
	if err != nil {
		return nil, nil, err
	}
	if item.Status != entity.OrderItemStatusPending {
		return nil, nil, errors.New("only pending items can be edited")
	}
	return order, item, nil
}

func validateSelectedMenuOptions(menu *entity.MenuItem, selectedIDs []uint) ([]selectedMenuOption, float64, error) {
	selectedByID := map[uint]bool{}
	for _, id := range selectedIDs {
		if id != 0 {
			selectedByID[id] = true
		}
	}
	selected := []selectedMenuOption{}
	total := 0.0
	for _, group := range menu.OptionGroups {
		if !group.IsActive {
			continue
		}
		groupSelected := 0
		for _, option := range group.Options {
			if !option.IsActive || !selectedByID[option.ID] {
				continue
			}
			groupSelected += 1
			total += option.PriceDelta
			selected = append(selected, selectedMenuOption{
				ID:            option.ID,
				OptionGroupID: group.ID,
				GroupName:     group.Name,
				OptionName:    option.Name,
				PriceDelta:    option.PriceDelta,
				Ingredients:   option.Ingredients,
			})
			delete(selectedByID, option.ID)
		}
		minSelect := group.MinSelect
		if group.Required && minSelect < 1 {
			minSelect = 1
		}
		maxSelect := group.MaxSelect
		if maxSelect < 1 {
			maxSelect = 1
		}
		if groupSelected < minSelect {
			return nil, 0, fmt.Errorf("กรุณาเลือก %s อย่างน้อย %d ตัวเลือก", group.Name, minSelect)
		}
		if groupSelected > maxSelect {
			return nil, 0, fmt.Errorf("%s เลือกได้สูงสุด %d ตัวเลือก", group.Name, maxSelect)
		}
	}
	if len(selectedByID) > 0 {
		return nil, 0, errors.New("ตัวเลือกนี้ไม่พร้อมใช้งานสำหรับเมนูนี้")
	}
	return selected, total, nil
}

func recalcOrderTotals(tx *repository.OrderRepository, order *entity.Order) error {
	items, err := tx.ListItems(order.ID)
	if err != nil {
		return err
	}
	subtotal := orderSubtotalFromItems(items)
	order.Subtotal = subtotal
	if order.DiscountAmount < 0 {
		order.DiscountAmount = 0
	}
	if order.DiscountAmount > subtotal {
		order.DiscountAmount = subtotal
	}
	order.TotalAmount = subtotal - order.DiscountAmount
	if order.TotalAmount < 0 {
		order.TotalAmount = 0
	}
	order.GrandTotal = order.TotalAmount + order.ServiceChargeAmount + order.VATAmount
	return tx.SaveOrder(order)
}

func orderSubtotalFromItems(items []entity.OrderItem) float64 {
	subtotal := 0.0
	for _, item := range items {
		if item.Status != entity.OrderItemStatusCancelled {
			subtotal += item.Subtotal
		}
	}
	return subtotal
}

func billFromOrder(order *entity.Order, restaurant *entity.Restaurant) *BillResponse {
	subtotal := roundMoney(order.Subtotal)
	discount := roundMoney(order.DiscountAmount)
	if discount < 0 {
		discount = 0
	}
	if discount > subtotal {
		discount = subtotal
	}
	total := roundMoney(subtotal - discount)
	if total < 0 {
		total = 0
	}
	serviceEnabled := restaurant.ServiceChargeEnabled
	serviceRate := restaurant.ServiceChargeRate
	vatEnabled := restaurant.VATEnabled
	vatRate := restaurant.VATRate
	serviceAmount := order.ServiceChargeAmount
	vatAmount := order.VATAmount
	grandTotal := order.GrandTotal
	if order.PaymentStatus == entity.PaymentStatusPaid {
		serviceEnabled = order.ServiceChargeEnabledSnapshot
		serviceRate = order.ServiceChargeRateSnapshot
		vatEnabled = order.VATEnabledSnapshot
		vatRate = order.VATRateSnapshot
	}
	if order.PaymentStatus != entity.PaymentStatusPaid {
		if serviceEnabled {
			serviceAmount = roundMoney(total * serviceRate / 100)
		} else {
			serviceAmount = 0
		}
		if vatEnabled {
			vatAmount = roundMoney((total + serviceAmount) * vatRate / 100)
		} else {
			vatAmount = 0
		}
		grandTotal = roundMoney(total + serviceAmount + vatAmount)
	}
	if grandTotal <= 0 {
		grandTotal = roundMoney(total + serviceAmount + vatAmount)
	}
	return &BillResponse{
		Order:                order,
		Items:                order.Items,
		Subtotal:             subtotal,
		DiscountAmount:       discount,
		ServiceChargeEnabled: serviceEnabled,
		ServiceChargeRate:    serviceRate,
		ServiceChargeAmount:  roundMoney(serviceAmount),
		VATEnabled:           vatEnabled,
		VATRate:              vatRate,
		VATAmount:            roundMoney(vatAmount),
		TotalAmount:          total,
		GrandTotal:           grandTotal,
		PaymentStatus:        order.PaymentStatus,
		PromptPayName:        restaurant.PromptPayName,
		PromptPayQRImage:     restaurant.PromptPayQRImage,
		Payments:             order.Payments,
	}
}
