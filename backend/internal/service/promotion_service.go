package service

import (
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type PromotionService struct {
	repo   *repository.PromotionRepository
	orders *repository.OrderRepository
}

func ProvidePromotionService(repo *repository.PromotionRepository, orders *repository.OrderRepository) *PromotionService {
	return &PromotionService{repo: repo, orders: orders}
}

const (
	maxPromotionName      = 120
	maxPromotionTargets   = 200
	maxPromotionQuantity  = 99
	maxBundleSlotQuantity = 20
	maxPromotionMoney     = 1_000_000.0
)

var promotionClock = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

type PromotionTargetRequest struct {
	// GroupIndex and Quantity only mean something on a bundle: one slot per
	// group, Quantity dishes per slot. Groups are renumbered 0, 1, 2... in the
	// order they first appear.
	GroupIndex int   `json:"group_index"`
	Quantity   int   `json:"quantity"`
	MenuItemID *uint `json:"menu_item_id"`
	CategoryID *uint `json:"category_id"`
}

type PromotionRequest struct {
	Name string `json:"name"`
	Type string `json:"type"`
	// IsActive nil keeps the current state on edit and starts a new promotion on.
	IsActive *bool `json:"is_active"`

	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	DaysMask  int    `json:"days_mask"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`

	BuyQuantity   int     `json:"buy_quantity"`
	GetQuantity   int     `json:"get_quantity"`
	DiscountKind  string  `json:"discount_kind"`
	DiscountValue float64 `json:"discount_value"`
	BundlePrice   float64 `json:"bundle_price"`
	MinSubtotal   float64 `json:"min_subtotal"`
	MaxDiscount   float64 `json:"max_discount"`

	Targets []PromotionTargetRequest `json:"targets"`
}

// PromotionResult is a saved promotion and the open orders whose price moved
// because of it, so the caller can tell the tills.
type PromotionResult struct {
	Promotion      *entity.Promotion
	RepricedOrders []uint
}

func (s *PromotionService) List(restaurantID uint) ([]entity.Promotion, error) {
	promotions, err := s.repo.List(restaurantID)
	if err != nil {
		return nil, err
	}
	if promotions == nil {
		promotions = []entity.Promotion{}
	}
	return promotions, nil
}

func (s *PromotionService) Create(restaurantID uint, req *PromotionRequest) (*PromotionResult, error) {
	next, err := normalizePromotion(req)
	if err != nil {
		return nil, err
	}
	if err := s.ensureTargetsBelongTo(restaurantID, next.Targets); err != nil {
		return nil, err
	}
	next.RestaurantID = restaurantID
	targets := next.Targets
	err = s.repo.Transaction(func(tx *repository.PromotionRepository) error {
		if err := tx.Create(next); err != nil {
			return err
		}
		return tx.ReplaceTargets(restaurantID, next.ID, targets)
	})
	if err != nil {
		return nil, err
	}
	return s.finish(restaurantID, next.ID)
}

func (s *PromotionService) Update(restaurantID, promotionID uint, req *PromotionRequest) (*PromotionResult, error) {
	next, err := normalizePromotion(req)
	if err != nil {
		return nil, err
	}
	if err := s.ensureTargetsBelongTo(restaurantID, next.Targets); err != nil {
		return nil, err
	}
	err = s.repo.Transaction(func(tx *repository.PromotionRepository) error {
		current, err := tx.FindForUpdate(restaurantID, promotionID)
		if err != nil {
			return err
		}
		if req.IsActive == nil {
			next.IsActive = current.IsActive
		}
		next.Model = current.Model
		next.RestaurantID = restaurantID
		targets := next.Targets
		next.Targets = nil
		if err := tx.Save(next); err != nil {
			return err
		}
		return tx.ReplaceTargets(restaurantID, promotionID, targets)
	})
	if err != nil {
		return nil, err
	}
	return s.finish(restaurantID, promotionID)
}

func (s *PromotionService) SetActive(restaurantID, promotionID uint, active bool) (*PromotionResult, error) {
	err := s.repo.Transaction(func(tx *repository.PromotionRepository) error {
		current, err := tx.FindForUpdate(restaurantID, promotionID)
		if err != nil {
			return err
		}
		current.IsActive = active
		return tx.Save(current)
	})
	if err != nil {
		return nil, err
	}
	return s.finish(restaurantID, promotionID)
}

func (s *PromotionService) Delete(restaurantID, promotionID uint) ([]uint, error) {
	err := s.repo.Transaction(func(tx *repository.PromotionRepository) error {
		current, err := tx.FindForUpdate(restaurantID, promotionID)
		if err != nil {
			return err
		}
		return tx.Delete(current)
	})
	if err != nil {
		return nil, err
	}
	return s.repriceOpenOrders(restaurantID), nil
}

func (s *PromotionService) finish(restaurantID, promotionID uint) (*PromotionResult, error) {
	repriced := s.repriceOpenOrders(restaurantID)
	promotion, err := s.repo.Find(restaurantID, promotionID)
	if err != nil {
		return nil, err
	}
	return &PromotionResult{Promotion: promotion, RepricedOrders: repriced}, nil
}

// repriceOpenOrders applies the restaurant's current promotions to every order
// that is still being served, one transaction per order so a busy till is
// never held for long. An order that fails here is priced again by its next
// change and, at the latest, inside PayOrder, so the failure is logged rather
// than turned into a failed save of the promotion itself.
func (s *PromotionService) repriceOpenOrders(restaurantID uint) []uint {
	ids, err := s.orders.ListRepriceableOrderIDs(restaurantID)
	if err != nil {
		log.Printf("promotion_reprice_list_failed restaurant_id=%d error=%v", restaurantID, err)
		return nil
	}
	repriced := make([]uint, 0, len(ids))
	for _, orderID := range ids {
		changed := false
		err := s.orders.Transaction(func(tx *repository.OrderRepository) error {
			order, err := tx.LockOrderForPricing(restaurantID, orderID)
			if err != nil {
				return err
			}
			if order.PaymentStatus == entity.PaymentStatusPaid ||
				order.Status == entity.OrderStatusCompleted ||
				order.Status == entity.OrderStatusCancelled {
				return nil
			}
			changed, err = priceOrder(tx, order)
			if err != nil || !changed {
				return err
			}
			return tx.SaveOrder(order)
		})
		if err != nil {
			log.Printf("promotion_reprice_failed restaurant_id=%d order_id=%d error=%v", restaurantID, orderID, err)
			continue
		}
		if changed {
			repriced = append(repriced, orderID)
		}
	}
	return repriced
}

func (s *PromotionService) ensureTargetsBelongTo(restaurantID uint, targets []entity.PromotionTarget) error {
	menus := map[uint]bool{}
	categories := map[uint]bool{}
	for _, target := range targets {
		if target.MenuItemID != nil {
			menus[*target.MenuItemID] = true
		}
		if target.CategoryID != nil {
			categories[*target.CategoryID] = true
		}
	}
	if len(menus) > 0 {
		count, err := s.repo.CountMenuItems(restaurantID, keysOf(menus))
		if err != nil {
			return err
		}
		if count != int64(len(menus)) {
			return errors.New("promotion menu item not found")
		}
	}
	if len(categories) > 0 {
		count, err := s.repo.CountCategories(restaurantID, keysOf(categories))
		if err != nil {
			return err
		}
		if count != int64(len(categories)) {
			return errors.New("promotion category not found")
		}
	}
	return nil
}

func keysOf(set map[uint]bool) []uint {
	keys := make([]uint, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	return keys
}

// normalizePromotion validates a request and returns the promotion ready to
// store, targets included and without ids. Fields another type uses are
// cleared so a row only ever carries its own rule.
func normalizePromotion(req *PromotionRequest) (*entity.Promotion, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("promotion name is required")
	}
	if utf8.RuneCountInString(name) > maxPromotionName {
		return nil, errors.New("promotion name is too long")
	}
	promotion := &entity.Promotion{Name: name, Type: strings.TrimSpace(req.Type), IsActive: true}
	if req.IsActive != nil {
		promotion.IsActive = *req.IsActive
	}
	if err := normalizePromotionSchedule(req, promotion); err != nil {
		return nil, err
	}

	var err error
	switch promotion.Type {
	case entity.PromotionTypeBuyXGetY:
		if req.BuyQuantity < 1 || req.BuyQuantity > maxPromotionQuantity ||
			req.GetQuantity < 1 || req.GetQuantity > maxPromotionQuantity {
			return nil, errors.New("invalid promotion quantities")
		}
		promotion.BuyQuantity = req.BuyQuantity
		promotion.GetQuantity = req.GetQuantity
		promotion.Targets, err = normalizePromotionTargets(req.Targets, false)
	case entity.PromotionTypeItemDiscount:
		promotion.DiscountKind, promotion.DiscountValue, err = normalizePromotionDiscount(req.DiscountKind, req.DiscountValue)
		if err == nil {
			promotion.Targets, err = normalizePromotionTargets(req.Targets, false)
		}
	case entity.PromotionTypeBundlePrice:
		promotion.BundlePrice, err = promotionMoney(req.BundlePrice, false)
		if err == nil {
			promotion.Targets, err = normalizePromotionTargets(req.Targets, true)
		}
		if err == nil && bundleDishCount(promotion.Targets) < 2 {
			err = errors.New("a bundle needs at least two dishes")
		}
	case entity.PromotionTypeBillDiscount:
		promotion.DiscountKind, promotion.DiscountValue, err = normalizePromotionDiscount(req.DiscountKind, req.DiscountValue)
		if err == nil {
			promotion.MinSubtotal, err = promotionMoney(req.MinSubtotal, true)
		}
		if err == nil && promotion.DiscountKind == entity.PromotionDiscountPercent {
			promotion.MaxDiscount, err = promotionMoney(req.MaxDiscount, true)
		}
	default:
		return nil, errors.New("invalid promotion type")
	}
	if err != nil {
		return nil, err
	}
	return promotion, nil
}

func normalizePromotionSchedule(req *PromotionRequest, promotion *entity.Promotion) error {
	startDate := strings.TrimSpace(req.StartDate)
	endDate := strings.TrimSpace(req.EndDate)
	for _, date := range []string{startDate, endDate} {
		if date == "" {
			continue
		}
		if _, err := time.Parse("2006-01-02", date); err != nil {
			return errors.New("promotion dates must be YYYY-MM-DD")
		}
	}
	if startDate != "" && endDate != "" && endDate < startDate {
		return errors.New("promotion end date is before its start date")
	}

	days := req.DaysMask
	if days == 0 {
		days = entity.PromotionEveryDay
	}
	if days < 1 || days > entity.PromotionEveryDay {
		return errors.New("invalid promotion days")
	}

	startTime := strings.TrimSpace(req.StartTime)
	endTime := strings.TrimSpace(req.EndTime)
	if (startTime == "") != (endTime == "") {
		return errors.New("promotion hours need both a start and an end")
	}
	if startTime != "" {
		if !promotionClock.MatchString(startTime) || !promotionClock.MatchString(endTime) {
			return errors.New("promotion hours must be HH:MM")
		}
		if startTime == endTime {
			return errors.New("promotion hours cannot start and end at the same time")
		}
	}

	promotion.StartDate = startDate
	promotion.EndDate = endDate
	promotion.DaysMask = days
	promotion.StartTime = startTime
	promotion.EndTime = endTime
	return nil
}

func normalizePromotionDiscount(kind string, value float64) (string, float64, error) {
	switch kind {
	case entity.PromotionDiscountPercent:
		if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value > 100 {
			return "", 0, errors.New("invalid promotion percent")
		}
		return kind, roundMoney(value), nil
	case entity.PromotionDiscountAmount:
		amount, err := promotionMoney(value, false)
		return kind, amount, err
	default:
		return "", 0, errors.New("invalid promotion discount kind")
	}
}

func promotionMoney(value float64, allowZero bool) (float64, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, errors.New("invalid promotion amount")
	}
	amount := roundMoney(value)
	if amount < 0 || (!allowZero && amount <= 0) || amount > maxPromotionMoney {
		return 0, errors.New("invalid promotion amount")
	}
	return amount, nil
}

func normalizePromotionTargets(inputs []PromotionTargetRequest, grouped bool) ([]entity.PromotionTarget, error) {
	if len(inputs) == 0 {
		return nil, errors.New("a promotion needs at least one dish")
	}
	if len(inputs) > maxPromotionTargets {
		return nil, errors.New("a promotion has too many dishes")
	}
	groupOf := map[int]int{}
	quantityOf := map[int]int{}
	seen := map[string]bool{}
	targets := make([]entity.PromotionTarget, 0, len(inputs))
	for _, input := range inputs {
		if (input.MenuItemID != nil && *input.MenuItemID == 0) || (input.CategoryID != nil && *input.CategoryID == 0) {
			return nil, errors.New("invalid promotion target")
		}
		if (input.MenuItemID == nil) == (input.CategoryID == nil) {
			return nil, errors.New("each promotion target needs a menu item or a category")
		}
		group, quantity := 0, 1
		if grouped {
			if input.GroupIndex < 0 {
				return nil, errors.New("invalid promotion target")
			}
			index, ok := groupOf[input.GroupIndex]
			if !ok {
				index = len(groupOf)
				groupOf[input.GroupIndex] = index
			}
			group = index
			quantity = input.Quantity
			if quantity == 0 {
				quantity = 1
			}
			if quantity < 1 || quantity > maxBundleSlotQuantity {
				return nil, errors.New("invalid bundle quantity")
			}
			if existing, ok := quantityOf[group]; ok && existing != quantity {
				return nil, errors.New("every dish in one bundle slot needs the same quantity")
			}
			quantityOf[group] = quantity
		}
		target := entity.PromotionTarget{GroupIndex: group, Quantity: quantity}
		key := ""
		if input.MenuItemID != nil {
			id := *input.MenuItemID
			target.MenuItemID = &id
			key = fmt.Sprintf("%d/menu/%d", group, id)
		} else {
			id := *input.CategoryID
			target.CategoryID = &id
			key = fmt.Sprintf("%d/category/%d", group, id)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		targets = append(targets, target)
	}
	return targets, nil
}

func bundleDishCount(targets []entity.PromotionTarget) int {
	perGroup := map[int]int{}
	for _, target := range targets {
		perGroup[target.GroupIndex] = target.Quantity
	}
	total := 0
	for _, quantity := range perGroup {
		total += quantity
	}
	return total
}
