package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"Project-M/internal/entity"
	"Project-M/internal/repository"

	"gorm.io/gorm"
)

const (
	customerOrderMaxItems          = 50
	customerOrderMaxItemQuantity   = 20
	customerOrderMaxTotalQuantity  = 100
	customerOrderMaxItemNoteRunes  = 250
	customerOrderMaxOrderNoteRunes = 500
	customerOrderMaxOptionsPerItem = 20
	customerOrderMinRequestKeyLen  = 16
	customerOrderMaxRequestKeyLen  = 128
)

var ErrCustomerOrderIdempotencyConflict = errors.New("idempotency key was already used with a different request")

type CustomerOrderService struct {
	repo *repository.OrderRepository
}

func ProvideCustomerOrderService(repo *repository.OrderRepository) *CustomerOrderService {
	return &CustomerOrderService{repo: repo}
}

type CustomerRestaurantResponse struct {
	Name       string `json:"name"`
	BranchName string `json:"branch_name"`
	Logo       string `json:"logo"`
	OpenTime   string `json:"open_time"`
	CloseTime  string `json:"close_time"`
	// Tells the customer page whether it should ask for device location.
	GeofenceRequired bool `json:"geofence_required"`
}

type CustomerTableDTO struct {
	TableNumber  string `json:"table_number"`
	DisplayLabel string `json:"display_label"`
	Capacity     int    `json:"capacity"`
	Zone         string `json:"zone,omitempty"`
}

type CustomerCategoryDTO struct {
	ID           uint   `json:"ID"`
	Name         string `json:"name"`
	DisplayOrder int    `json:"display_order"`
	IsActive     bool   `json:"is_active"`
}

type CustomerMenuCategoryDTO struct {
	CategoryID uint `json:"category_id"`
}

type CustomerMenuOptionDTO struct {
	ID           uint    `json:"ID"`
	Name         string  `json:"name"`
	PriceDelta   float64 `json:"price_delta"`
	IsDefault    bool    `json:"is_default"`
	DisplayOrder int     `json:"display_order"`
	IsActive     bool    `json:"is_active"`
}

type CustomerMenuOptionGroupDTO struct {
	ID           uint                    `json:"ID"`
	Name         string                  `json:"name"`
	Required     bool                    `json:"required"`
	MinSelect    int                     `json:"min_select"`
	MaxSelect    int                     `json:"max_select"`
	DisplayOrder int                     `json:"display_order"`
	IsActive     bool                    `json:"is_active"`
	Options      []CustomerMenuOptionDTO `json:"options"`
}

type CustomerMenuItemDTO struct {
	ID           uint                         `json:"ID"`
	CategoryID   uint                         `json:"category_id"`
	Category     *CustomerCategoryDTO         `json:"category,omitempty"`
	Name         string                       `json:"name"`
	Price        float64                      `json:"price"`
	ImageURL     string                       `json:"image_url"`
	Description  string                       `json:"description"`
	IsAvailable  bool                         `json:"is_available"`
	DisplayOrder int                          `json:"display_order"`
	Categories   []CustomerMenuCategoryDTO    `json:"categories"`
	OptionGroups []CustomerMenuOptionGroupDTO `json:"option_groups"`
	// RemainingServings is how many portions can still be made from current stock
	// after subtracting what queued orders have already claimed. nil = no recipe
	// (not stock-limited); 0 = sold out.
	RemainingServings *int `json:"remaining_servings,omitempty"`
}

type CustomerOrderItemOptionDTO struct {
	ID         uint    `json:"ID"`
	GroupName  string  `json:"group_name"`
	OptionName string  `json:"option_name"`
	PriceDelta float64 `json:"price_delta"`
}

type CustomerOrderItemDTO struct {
	ID              uint                         `json:"ID"`
	MenuName        string                       `json:"menu_name"`
	ImageURL        string                       `json:"image_url"`
	UnitPrice       float64                      `json:"unit_price"`
	OptionsTotal    float64                      `json:"options_total"`
	Quantity        int                          `json:"quantity"`
	Subtotal        float64                      `json:"subtotal"`
	FulfillmentType string                       `json:"fulfillment_type"`
	Note            string                       `json:"note"`
	Status          string                       `json:"status"`
	SelectedOptions []CustomerOrderItemOptionDTO `json:"selected_options"`
}

type CustomerOrderDTO struct {
	OrderNumber string                 `json:"order_number"`
	Status      string                 `json:"status"`
	Items       []CustomerOrderItemDTO `json:"items"`
}

type CustomerTableResponse struct {
	Restaurant CustomerRestaurantResponse `json:"restaurant"`
	Table      CustomerTableDTO           `json:"table"`
	Categories []CustomerCategoryDTO      `json:"categories"`
	MenuItems  []CustomerMenuItemDTO      `json:"menu_items"`
	Order      *CustomerOrderDTO          `json:"order,omitempty"`
	// True when the just-submitted items were held for staff confirmation
	// because the device location could not be verified.
	AwaitingStaffConfirm bool `json:"awaiting_staff_confirm,omitempty"`
}

type CustomerOrderSubmitResult struct {
	Payload      *CustomerTableResponse
	RestaurantID uint
	OrderID      uint
	Replayed     bool
}

type CustomerCartItemRequest struct {
	MenuID            uint   `json:"menu_id" binding:"required"`
	Quantity          int    `json:"quantity" binding:"required"`
	Note              string `json:"note"`
	SelectedOptionIDs []uint `json:"selected_option_ids"`
}

type SubmitCustomerOrderRequest struct {
	Note  string                    `json:"note"`
	Items []CustomerCartItemRequest `json:"items" binding:"required"`
	// Device location captured at submit time. Nil when the customer declined
	// or the browser could not provide it.
	Latitude  *float64 `json:"latitude"`
	Longitude *float64 `json:"longitude"`
	Accuracy  *float64 `json:"accuracy"`
}

// ErrOutsideRestaurant is returned when the device is clearly away from the
// restaurant, which is the QR-photo-and-order-from-elsewhere case.
var ErrOutsideRestaurant = errors.New("you must be at the restaurant to order")

// Location readings looser than this are treated as unverifiable rather than
// rejected, so a customer with weak indoor GPS is never wrongly blocked.
const maxTrustedAccuracyMeters = 1000

type geofenceOutcome int

const (
	geofenceDisabled   geofenceOutcome = iota // restaurant has not configured a location
	geofenceInside                            // verified at the restaurant
	geofenceUnverified                        // no/low-quality location -> needs staff confirmation
	geofenceOutside                           // verified away from the restaurant
)

func (s *CustomerOrderService) GetTable(token string) (*CustomerTableResponse, error) {
	table, err := s.tableByToken(token)
	if err != nil {
		return nil, err
	}
	return customerTableResponse(s.repo, table)
}

func (s *CustomerOrderService) SubmitOrder(
	token string,
	requestKey string,
	req *SubmitCustomerOrderRequest,
) (*CustomerOrderSubmitResult, error) {
	normalizedToken := strings.TrimSpace(token)
	normalizedKey := strings.TrimSpace(requestKey)
	if err := validateCustomerSubmitRequest(normalizedKey, req); err != nil {
		return nil, err
	}
	table, err := s.tableByToken(normalizedToken)
	if err != nil {
		return nil, err
	}
	requestHash := customerSubmissionHash(req)

	var fence geofenceOutcome
	var result *CustomerOrderSubmitResult
	err = s.repo.Transaction(func(tx *repository.OrderRepository) error {
		order, findErr := tx.FindOpenOrderByTableForUpdate(table.RestaurantID, table.ID)
		if findErr != nil {
			if errors.Is(findErr, gorm.ErrRecordNotFound) {
				return errors.New("table is not open for customer ordering")
			}
			return findErr
		}
		lockedTable, findErr := tx.FindTableByCustomerTokenForUpdate(normalizedToken)
		if findErr != nil || lockedTable.ID != table.ID || lockedTable.RestaurantID != table.RestaurantID {
			return errors.New("table QR code is no longer valid")
		}
		// Serialize order writes per restaurant so the per-item capacity checks in
		// addCustomerItem can't race another table into overselling the same
		// ingredient. Taken after the order/table row locks for a consistent lock
		// order with the staff order flow (rows then advisory).
		if err := tx.LockRestaurantOrderCounter(lockedTable.RestaurantID); err != nil {
			return err
		}
		if order.PaymentStatus == entity.PaymentStatusPaid || isTerminalOrder(order.Status) {
			return errors.New("order is already closed")
		}
		if order.OrderType != entity.OrderTypeDineIn || order.TableID == nil || *order.TableID != lockedTable.ID {
			return errors.New("table is not open for customer ordering")
		}
		if existing, findErr := tx.FindCustomerSubmission(order.ID, normalizedKey); findErr == nil {
			if existing.RequestHash != requestHash {
				return ErrCustomerOrderIdempotencyConflict
			}
			payload, responseErr := customerTableResponse(tx, lockedTable)
			if responseErr != nil {
				return responseErr
			}
			result = &CustomerOrderSubmitResult{
				Payload:      payload,
				RestaurantID: existing.RestaurantID,
				OrderID:      existing.OrderID,
				Replayed:     true,
			}
			return nil
		} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
			return findErr
		}

		restaurant, findErr := tx.FindRestaurant(lockedTable.RestaurantID)
		if findErr != nil {
			return findErr
		}
		actorID := restaurant.OwnerID
		if actorID == 0 {
			return errors.New("restaurant owner is not configured")
		}

		// Block orders sent from clearly outside the restaurant (photographed QR).
		fence = evaluateGeofence(restaurant, req)
		if fence == geofenceOutside {
			return ErrOutsideRestaurant
		}

		if strings.TrimSpace(req.Note) != "" && strings.TrimSpace(order.Note) == "" {
			order.Note = customerNote(req.Note)
			if saveErr := tx.SaveOrder(order); saveErr != nil {
				return saveErr
			}
		}

		addedItemIDs := make([]uint, 0, len(req.Items))
		for _, itemReq := range req.Items {
			itemID, addErr := addCustomerItem(tx, lockedTable.RestaurantID, order, itemReq)
			if addErr != nil {
				return addErr
			}
			addedItemIDs = append(addedItemIDs, itemID)
		}
		if recalcErr := recalcOrderTotals(tx, order); recalcErr != nil {
			return recalcErr
		}
		// When the location could not be verified the items stay pending so staff
		// can confirm the guests are really seated before the kitchen starts. A
		// finished order reopens for them, as it does for a line staff key in.
		if fence != geofenceUnverified {
			if sendErr := sendPendingItemsToKitchenByIDs(tx, order, actorID, addedItemIDs); sendErr != nil {
				return sendErr
			}
		} else if reopenErr := reopenForPendingItems(tx, order, actorID); reopenErr != nil {
			return reopenErr
		}
		submission := &entity.CustomerOrderSubmission{
			RestaurantID: lockedTable.RestaurantID,
			TableID:      lockedTable.ID,
			OrderID:      order.ID,
			RequestKey:   normalizedKey,
			RequestHash:  requestHash,
		}
		if createErr := tx.CreateCustomerSubmission(submission); createErr != nil {
			return createErr
		}
		payload, responseErr := customerTableResponse(tx, lockedTable)
		if responseErr != nil {
			return responseErr
		}
		result = &CustomerOrderSubmitResult{
			Payload:      payload,
			RestaurantID: lockedTable.RestaurantID,
			OrderID:      order.ID,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// A replay returns the stored payload as-is; only a fresh submission reports
	// that its items are waiting for staff confirmation.
	if result != nil && !result.Replayed {
		result.Payload.AwaitingStaffConfirm = fence == geofenceUnverified
	}
	return result, nil
}

func (s *CustomerOrderService) tableByToken(token string) (*entity.RestaurantTable, error) {
	normalized, err := normalizeCustomerTableToken(token)
	if err != nil {
		return nil, err
	}
	table, err := s.repo.FindTableByCustomerToken(normalized)
	if err != nil {
		return nil, errors.New("table QR code is not valid")
	}
	return table, nil
}

func customerTableResponse(
	repo *repository.OrderRepository,
	table *entity.RestaurantTable,
) (*CustomerTableResponse, error) {
	restaurant, err := repo.FindRestaurant(table.RestaurantID)
	if err != nil {
		return nil, err
	}
	categories, err := repo.ListPublicCategories(table.RestaurantID)
	if err != nil {
		return nil, err
	}
	menuItems, err := repo.ListPublicMenuItems(table.RestaurantID)
	if err != nil {
		return nil, err
	}
	remaining, err := repo.MenuRemainingServings(table.RestaurantID)
	if err != nil {
		return nil, err
	}
	var order *CustomerOrderDTO
	if current, findErr := repo.FindCustomerOpenOrderByTable(table.RestaurantID, table.ID); findErr == nil {
		order = customerOrderDTO(current)
	} else if !errors.Is(findErr, gorm.ErrRecordNotFound) {
		return nil, findErr
	}
	return &CustomerTableResponse{
		Restaurant: customerRestaurantDTO(restaurant),
		Table:      customerTableDTO(table),
		Categories: customerCategoryDTOs(categories),
		MenuItems:  customerMenuItemDTOs(menuItems, remaining),
		Order:      order,
	}, nil
}

func addCustomerItem(
	tx *repository.OrderRepository,
	restaurantID uint,
	order *entity.Order,
	req CustomerCartItemRequest,
) (uint, error) {
	menu, err := tx.FindMenuItem(restaurantID, req.MenuID)
	if err != nil {
		return 0, errors.New("menu item not found")
	}
	if !menu.IsAvailable {
		return 0, errors.New("menu item is unavailable")
	}
	// Block the order the moment the queue has claimed the last portion, instead of
	// letting the customer wait until the kitchen discovers the shortage. remaining
	// already subtracts every queued item, including ones added earlier in this cart.
	// The submit transaction holds the per-restaurant order lock, so this check is
	// safe against a concurrent order claiming the same stock.
	if err := ensureMenuCapacity(tx, restaurantID, menu.ID, menu.Name, req.Quantity); err != nil {
		return 0, err
	}
	selectedOptions, optionsTotal, err := validateSelectedMenuOptions(menu, req.SelectedOptionIDs)
	if err != nil {
		return 0, err
	}
	item := &entity.OrderItem{
		OrderID:         order.ID,
		RestaurantID:    restaurantID,
		MenuID:          menu.ID,
		MenuName:        menu.Name,
		UnitPrice:       menu.Price,
		OptionsTotal:    optionsTotal,
		Quantity:        req.Quantity,
		Subtotal:        (menu.Price + optionsTotal) * float64(req.Quantity),
		FulfillmentType: entity.OrderItemFulfillmentDineIn,
		Note:            strings.TrimSpace(req.Note),
		Status:          entity.OrderItemStatusPending,
	}
	if err := tx.CreateItem(item); err != nil {
		return 0, err
	}
	if err := snapshotRecipeForOrderItem(tx, order, item, selectedOptions); err != nil {
		return 0, err
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
			return 0, err
		}
	}
	return item.ID, nil
}

// evaluateGeofence decides whether an order may go straight to the kitchen.
func evaluateGeofence(restaurant *entity.Restaurant, req *SubmitCustomerOrderRequest) geofenceOutcome {
	if restaurant.OrderRadiusMeters <= 0 || restaurant.Latitude == nil || restaurant.Longitude == nil {
		return geofenceDisabled
	}
	if req.Latitude == nil || req.Longitude == nil {
		return geofenceUnverified
	}
	accuracy := 0.0
	if req.Accuracy != nil && *req.Accuracy > 0 {
		accuracy = *req.Accuracy
	}
	if accuracy > maxTrustedAccuracyMeters {
		return geofenceUnverified
	}

	distance := haversineMeters(*restaurant.Latitude, *restaurant.Longitude, *req.Latitude, *req.Longitude)
	// Allow the reading's own margin of error so real customers are not blocked.
	if distance <= float64(restaurant.OrderRadiusMeters)+accuracy {
		return geofenceInside
	}
	return geofenceOutside
}

// haversineMeters returns the great-circle distance between two coordinates.
func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusMeters = 6371000
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }
	dLat := toRad(lat2 - lat1)
	dLon := toRad(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadiusMeters * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func validateCustomerSubmitRequest(requestKey string, req *SubmitCustomerOrderRequest) error {
	if len(requestKey) < customerOrderMinRequestKeyLen || len(requestKey) > customerOrderMaxRequestKeyLen {
		return errors.New("Idempotency-Key must be between 16 and 128 characters")
	}
	for _, char := range requestKey {
		if unicode.IsSpace(char) || unicode.IsControl(char) {
			return errors.New("Idempotency-Key contains invalid characters")
		}
	}
	if req == nil || len(req.Items) == 0 {
		return errors.New("order must include at least one item")
	}
	if len(req.Items) > customerOrderMaxItems {
		return errors.New("order can include up to 50 items")
	}
	if utf8.RuneCountInString(strings.TrimSpace(req.Note)) > customerOrderMaxOrderNoteRunes {
		return errors.New("order note is too long")
	}
	totalQuantity := 0
	for _, item := range req.Items {
		if item.MenuID == 0 {
			return errors.New("menu_id is required")
		}
		if item.Quantity < 1 || item.Quantity > customerOrderMaxItemQuantity {
			return errors.New("item quantity must be between 1 and 20")
		}
		totalQuantity += item.Quantity
		if totalQuantity > customerOrderMaxTotalQuantity {
			return errors.New("order quantity is too large")
		}
		if utf8.RuneCountInString(strings.TrimSpace(item.Note)) > customerOrderMaxItemNoteRunes {
			return errors.New("item note is too long")
		}
		if len(item.SelectedOptionIDs) > customerOrderMaxOptionsPerItem {
			return errors.New("too many selected options")
		}
		seen := make(map[uint]struct{}, len(item.SelectedOptionIDs))
		for _, optionID := range item.SelectedOptionIDs {
			if optionID == 0 {
				return errors.New("selected option id is invalid")
			}
			if _, exists := seen[optionID]; exists {
				return errors.New("selected option ids must be unique")
			}
			seen[optionID] = struct{}{}
		}
	}
	return nil
}

func customerSubmissionHash(req *SubmitCustomerOrderRequest) string {
	type canonicalItem struct {
		MenuID            uint   `json:"menu_id"`
		Quantity          int    `json:"quantity"`
		Note              string `json:"note"`
		SelectedOptionIDs []uint `json:"selected_option_ids"`
	}
	type canonicalRequest struct {
		Note  string          `json:"note"`
		Items []canonicalItem `json:"items"`
	}
	canonical := canonicalRequest{
		Note:  strings.TrimSpace(req.Note),
		Items: make([]canonicalItem, 0, len(req.Items)),
	}
	for _, item := range req.Items {
		optionIDs := append([]uint(nil), item.SelectedOptionIDs...)
		sort.Slice(optionIDs, func(i, j int) bool { return optionIDs[i] < optionIDs[j] })
		canonical.Items = append(canonical.Items, canonicalItem{
			MenuID:            item.MenuID,
			Quantity:          item.Quantity,
			Note:              strings.TrimSpace(item.Note),
			SelectedOptionIDs: optionIDs,
		})
	}
	encoded, _ := json.Marshal(canonical)
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func customerNote(note string) string {
	trimmed := strings.TrimSpace(note)
	if trimmed == "" {
		return "customer QR order"
	}
	return "customer QR: " + trimmed
}

func customerRestaurantDTO(restaurant *entity.Restaurant) CustomerRestaurantResponse {
	return CustomerRestaurantResponse{
		Name:       restaurant.Name,
		BranchName: restaurant.BranchName,
		Logo:       restaurant.Logo,
		OpenTime:   restaurant.OpenTime,
		CloseTime:  restaurant.CloseTime,
		// Tells the customer page to ask for device location before ordering.
		GeofenceRequired: restaurant.OrderRadiusMeters > 0 && restaurant.Latitude != nil && restaurant.Longitude != nil,
	}
}

func customerTableDTO(table *entity.RestaurantTable) CustomerTableDTO {
	return CustomerTableDTO{
		TableNumber:  table.TableNumber,
		DisplayLabel: table.DisplayLabel,
		Capacity:     table.Capacity,
		Zone:         table.Zone,
	}
}

func customerCategoryDTOs(categories []entity.Category) []CustomerCategoryDTO {
	result := make([]CustomerCategoryDTO, 0, len(categories))
	for _, category := range categories {
		result = append(result, CustomerCategoryDTO{
			ID:           category.ID,
			Name:         category.Name,
			DisplayOrder: category.DisplayOrder,
			IsActive:     category.IsActive,
		})
	}
	return result
}

func customerMenuItemDTOs(items []entity.MenuItem, remaining map[uint]int) []CustomerMenuItemDTO {
	result := make([]CustomerMenuItemDTO, 0, len(items))
	for _, item := range items {
		var category *CustomerCategoryDTO
		if item.Category != nil {
			safeCategory := CustomerCategoryDTO{
				ID:           item.Category.ID,
				Name:         item.Category.Name,
				DisplayOrder: item.Category.DisplayOrder,
				IsActive:     item.Category.IsActive,
			}
			category = &safeCategory
		}
		categoryLinks := make([]CustomerMenuCategoryDTO, 0, len(item.Categories))
		for _, link := range item.Categories {
			categoryLinks = append(categoryLinks, CustomerMenuCategoryDTO{CategoryID: link.CategoryID})
		}
		optionGroups := make([]CustomerMenuOptionGroupDTO, 0, len(item.OptionGroups))
		for _, group := range item.OptionGroups {
			options := make([]CustomerMenuOptionDTO, 0, len(group.Options))
			for _, option := range group.Options {
				options = append(options, CustomerMenuOptionDTO{
					ID:           option.ID,
					Name:         option.Name,
					PriceDelta:   option.PriceDelta,
					IsDefault:    option.IsDefault,
					DisplayOrder: option.DisplayOrder,
					IsActive:     option.IsActive,
				})
			}
			optionGroups = append(optionGroups, CustomerMenuOptionGroupDTO{
				ID:           group.ID,
				Name:         group.Name,
				Required:     group.Required,
				MinSelect:    group.MinSelect,
				MaxSelect:    group.MaxSelect,
				DisplayOrder: group.DisplayOrder,
				IsActive:     group.IsActive,
				Options:      options,
			})
		}
		dto := CustomerMenuItemDTO{
			ID:           item.ID,
			CategoryID:   item.CategoryID,
			Category:     category,
			Name:         item.Name,
			Price:        item.Price,
			ImageURL:     item.ImageURL,
			Description:  item.Description,
			IsAvailable:  item.IsAvailable,
			DisplayOrder: item.DisplayOrder,
			Categories:   categoryLinks,
			OptionGroups: optionGroups,
		}
		if count, ok := remaining[item.ID]; ok {
			value := count
			dto.RemainingServings = &value
		}
		result = append(result, dto)
	}
	return result
}

func customerOrderDTO(order *entity.Order) *CustomerOrderDTO {
	if order == nil {
		return nil
	}
	items := make([]CustomerOrderItemDTO, 0, len(order.Items))
	for _, item := range order.Items {
		options := make([]CustomerOrderItemOptionDTO, 0, len(item.SelectedOptions))
		imageURL := ""
		if item.Menu != nil {
			imageURL = item.Menu.ImageURL
		}
		for _, option := range item.SelectedOptions {
			options = append(options, CustomerOrderItemOptionDTO{
				ID:         option.ID,
				GroupName:  option.GroupName,
				OptionName: option.OptionName,
				PriceDelta: option.PriceDelta,
			})
		}
		items = append(items, CustomerOrderItemDTO{
			ID:              item.ID,
			MenuName:        item.MenuName,
			ImageURL:        imageURL,
			UnitPrice:       item.UnitPrice,
			OptionsTotal:    item.OptionsTotal,
			Quantity:        item.Quantity,
			Subtotal:        item.Subtotal,
			FulfillmentType: item.FulfillmentType,
			Note:            item.Note,
			Status:          item.Status,
			SelectedOptions: options,
		})
	}
	return &CustomerOrderDTO{
		OrderNumber: order.OrderNumber,
		Status:      order.Status,
		Items:       items,
	}
}
