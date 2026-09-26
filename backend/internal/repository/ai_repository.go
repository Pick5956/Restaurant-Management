package repository

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type AIRepository struct {
	db *gorm.DB
}

func NewAIRepository(db *gorm.DB) *AIRepository {
	return &AIRepository{db: db}
}

type AISalesSummary struct {
	OrderDate string  `json:"order_date"`
	Orders    int64   `json:"orders"`
	Revenue   float64 `json:"revenue"`
}

// AISalesRange is a paid-sales aggregate for an arbitrary [start, end) window,
// used by the dated-sales flow (named month / month-to-month comparison) that
// looks beyond the fixed 14-day snapshot.
type AISalesRange struct {
	Orders  int64   `json:"orders"`
	Revenue float64 `json:"revenue"`
	Days    int64   `json:"days"`
}

type AIMenuSummary struct {
	MenuName string  `json:"menu_name"`
	Quantity int64   `json:"quantity"`
	Revenue  float64 `json:"revenue"`
}

type AIOrderTypeSummary struct {
	OrderType string  `json:"order_type"`
	Orders    int64   `json:"orders"`
	Revenue   float64 `json:"revenue"`
}

// AITableUsage is one table's traffic over a window: how many bills were served
// at it, what they were worth, and how many guests sat there. Capacity comes
// along because a six-seat room with two bills and a two-seat table with two
// bills are not the same story.
type AITableUsage struct {
	TableNumber string  `json:"table_number"`
	Zone        string  `json:"zone"`
	Capacity    int     `json:"capacity"`
	Bills       int64   `json:"bills"`
	Revenue     float64 `json:"revenue"`
	Guests      int64   `json:"guests"`
}

// AIPaymentMethodSummary is how many bills were settled by one method over a
// window, and how much money came in that way.
type AIPaymentMethodSummary struct {
	Method string  `json:"method"`
	Bills  int64   `json:"bills"`
	Amount float64 `json:"amount"`
}

// AIPaymentCoverage says which paid bills in a window have a payment row at all.
// The payment table started being written on 2026-08-30; every paid bill before
// that has no method on record, so a window reaching further back must say so
// rather than report a cash/PromptPay split over a fraction of its bills.
type AIPaymentCoverage struct {
	PaidBills     int64  `json:"paid_bills"`
	WithMethod    int64  `json:"with_method"`
	FirstRecorded string `json:"first_recorded"`
}

type AIPeriodSummary struct {
	Period  int     `json:"period"` // weekday 0..6 (Sun..Sat) or hour 0..23 depending on the query
	Orders  int64   `json:"orders"`
	Revenue float64 `json:"revenue"`
}

type AIMenuPrice struct {
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

// AIMenuCatalogueItem is one row of the shop's own menu — what is on it, not what
// sold. Every other menu list here is ranked by sales, so a menu that has never
// been ordered appears in none of them.
type AIMenuCatalogueItem struct {
	Name        string  `json:"name"`
	Price       float64 `json:"price"`
	IsAvailable bool    `json:"is_available"`
	Category    string  `json:"category"`
}

// AIIngredientUsage combines each ingredient's current stock with how much of it
// was consumed (and its cost) over the analysis window. One query serves the
// reorder-forecast, dead-stock, and top-cost-ingredient tools.
type AIIngredientUsage struct {
	Name        string  `json:"name"`
	Unit        string  `json:"unit"`
	Stock       float64 `json:"stock"`
	CostPerUnit float64 `json:"cost_per_unit"`
	Used        float64 `json:"used"`
	Cost        float64 `json:"cost"`
}

type AIMenuMarginSummary struct {
	MenuName string  `json:"menu_name"`
	Quantity int64   `json:"quantity"`
	Revenue  float64 `json:"revenue"`
	Cost     float64 `json:"cost"`
	Profit   float64 `json:"profit"`
	Margin   float64 `json:"margin"`
}

// AICategoryMenuMargin is one sold menu with the section of the menu board it
// belongs to. The margin queries group by order_items.menu_name — the name
// copied onto the order line at the moment of sale — which carries no category
// at all, so the category has to be read back through order_items.menu_id.
type AICategoryMenuMargin struct {
	Category string  `json:"category"`
	MenuName string  `json:"menu_name"`
	Quantity int64   `json:"quantity"`
	Revenue  float64 `json:"revenue"`
	Cost     float64 `json:"cost"`
	Profit   float64 `json:"profit"`
	Margin   float64 `json:"margin"`
}

type AIAnalysisCoverage struct {
	SalesItems           int64 `json:"sales_items"`
	MarginItems          int64 `json:"margin_items"`
	CostedMarginItems    int64 `json:"costed_margin_items"`
	SoldMenus            int64 `json:"sold_menus"`
	SoldMenusWithRecipes int64 `json:"sold_menus_with_recipes"`
}

func (r *AIRepository) ListIngredients(restaurantID uint) ([]entity.Ingredient, error) {
	var ingredients []entity.Ingredient
	err := r.db.
		Preload("Category").
		Where("restaurant_id = ?", restaurantID).
		Order("name asc").
		Find(&ingredients).Error
	return ingredients, err
}

func (r *AIRepository) RecentSalesSummary(restaurantID uint, since time.Time) ([]AISalesSummary, error) {
	var rows []AISalesSummary
	err := r.db.Model(&entity.Order{}).
		Select("TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS order_date, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where(
			"restaurant_id = ? AND completed_at >= ? AND status = ? AND payment_status = ?",
			restaurantID,
			since,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')").
		Order("order_date desc").
		// Generous cap: one row per day, so it must not truncate the analysis
		// window (the caller decides the window via `since`).
		Limit(120).
		Scan(&rows).Error
	return rows, err
}

// AIMonthlyProfit is one calendar month of the shop's money: paid sales, the
// recipe cost of what was sold, and the expenses the owner recorded other than
// ingredient purchases (those are the recipe cost already). Net is revenue −
// cost − expenses; a month with ExpenseEntries == 0 has no such expense on
// record, which is not the same as having spent nothing.
type AIMonthlyProfit struct {
	Month          string  `json:"month"` // "2026-08", Bangkok calendar
	Revenue        float64 `json:"revenue"`
	Bills          int64   `json:"bills"`
	Cost           float64 `json:"cost"`
	Expenses       float64 `json:"expenses"`
	ExpenseEntries int64   `json:"expense_entries"`
}

// ProfitByMonth returns the last `months` calendar months that had paid sales,
// oldest first, each with its revenue, recipe cost and recorded expenses. Cost
// is the same cost_snapshot sum the margin tools use, so a month here agrees
// with the profit tool's answer for that month.
func (r *AIRepository) ProfitByMonth(restaurantID uint, months int, now time.Time) ([]AIMonthlyProfit, error) {
	if months <= 0 {
		months = 6
	}
	first := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).AddDate(0, -(months - 1), 0)
	type salesRow struct {
		Month   string
		Revenue float64
		Bills   int64
		Cost    float64
	}
	var sales []salesRow
	err := r.db.Table("orders").
		Select(`TO_CHAR(orders.completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month,
			COALESCE(SUM(orders.grand_total), 0) AS revenue,
			COUNT(*) AS bills,
			COALESCE(SUM(deductions.cost), 0) AS cost`).
		Joins("LEFT JOIN (SELECT order_id, SUM(cost_snapshot) AS cost FROM order_inventory_deductions WHERE restaurant_id = ? AND deleted_at IS NULL GROUP BY order_id) deductions ON deductions.order_id = orders.id", restaurantID).
		Where("orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.status = ? AND orders.payment_status = ? AND orders.completed_at >= ? AND orders.completed_at <= ?",
			restaurantID, entity.OrderStatusCompleted, entity.PaymentStatusPaid, first, now).
		Group("month").Order("month").Scan(&sales).Error
	if err != nil {
		return nil, err
	}
	type expenseRow struct {
		Month   string
		Amount  float64
		Entries int64
	}
	var spent []expenseRow
	if err := r.db.Table("expenses").
		Select("TO_CHAR(spent_at, 'YYYY-MM') AS month, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS entries").
		// Ingredient purchases are left out: the recipe cost above already
		// counts the ingredients that sold (see ReportRepository.ExpenseTotal).
		Where("restaurant_id = ? AND deleted_at IS NULL AND spent_at >= ? AND category <> ?", restaurantID, first, "ingredient").
		Group("month").Scan(&spent).Error; err != nil {
		return nil, err
	}
	ledger := make(map[string]expenseRow, len(spent))
	for _, e := range spent {
		ledger[e.Month] = e
	}
	rows := make([]AIMonthlyProfit, 0, len(sales))
	for _, s := range sales {
		e := ledger[s.Month]
		rows = append(rows, AIMonthlyProfit{Month: s.Month, Revenue: s.Revenue, Bills: s.Bills, Cost: s.Cost, Expenses: e.Amount, ExpenseEntries: e.Entries})
	}
	return rows, nil
}

// SalesForRange aggregates paid, completed sales in the half-open window
// [start, end). Unlike RecentSalesSummary it is not capped to 14 rows, so it can
// answer named-month and month-to-month questions.
// SalesForHourRange aggregates paid sales inside [start, end) that were closed
// during the hours [startHour, endHour) in Bangkok time — "how did lunch go?".
// The hour is taken from completed_at so the figure stays consistent with every
// other revenue number, which is also attributed to when the bill was closed.
// OperatingCalendarRules returns the AI-owned open/closed rules for a restaurant,
// used by the sales forecast to know which days the shop is closed.
func (r *AIRepository) OperatingCalendarRules(restaurantID uint) ([]entity.AIOperatingCalendarRule, error) {
	var rules []entity.AIOperatingCalendarRule
	err := r.db.Where("restaurant_id = ?", restaurantID).Find(&rules).Error
	return rules, err
}

// AIActiveOrder is one order still on the floor: not completed, not cancelled.
//
// The customer's name and phone are deliberately absent. They are on the row and
// the owner may see them, but this reaches a model provider outside the system
// and neither is needed to answer "which bills are still unpaid" — the table and
// order number identify the bill on their own. Same rule the table sheet follows.
type AIActiveOrder struct {
	OrderNumber   string    `json:"order_number"`
	TableNumber   string    `json:"table_number"`
	OrderType     string    `json:"order_type"`
	Status        string    `json:"status"`
	PaymentStatus string    `json:"payment_status"`
	GrandTotal    float64   `json:"grand_total"`
	CustomerCount int       `json:"customer_count"`
	OpenedAt      time.Time `json:"opened_at"`
}

// ActiveOrders reads the floor as it stands right now — the tickets the kitchen
// is working on and the bills nobody has closed yet.
//
// Nothing else exposed this: every other tool here reports history. Asked "ตอนนี้
// บิลไหนยังไม่จ่าย" the assistant had no source at all, which is the shape of
// question it used to answer by guessing.
// AICancelledReason is how many bills were cancelled for one stated reason,
// and what they had run up before being dropped.
type AICancelledReason struct {
	Reason string  `json:"reason"`
	Bills  int64   `json:"bills"`
	Total  float64 `json:"total"`
}

// CancelledOrders lists the bills cancelled outright in [start, end), grouped
// by the reason the staff gave. Orders carry no cancellation timestamp of their
// own, so the moment of cancellation is taken as the row's last update — a
// cancelled bill is not edited again. Items struck from a bill that then closed
// normally are not counted here; those are a line on someone's bill, not a
// lost bill.
func (r *AIRepository) CancelledOrders(restaurantID uint, start, end time.Time) ([]AICancelledReason, error) {
	var rows []AICancelledReason
	err := r.db.Table("orders").
		Select("COALESCE(NULLIF(TRIM(orders.cancelled_reason), ''), '') AS reason, COUNT(*) AS bills, COALESCE(SUM(orders.grand_total), 0) AS total").
		Where(
			"orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.status = ? AND orders.updated_at >= ? AND orders.updated_at < ?",
			restaurantID, entity.OrderStatusCancelled, start, end,
		).
		Group("reason").
		Order("bills desc, reason asc").
		Scan(&rows).Error
	return rows, err
}

// AIPartySize is how many closed bills were opened for a party of one size.
type AIPartySize struct {
	PartySize int   `json:"party_size"`
	Bills     int64 `json:"bills"`
}

// GuestsByPartySize counts the paid bills in [start, end) by the number of
// people the staff recorded on each. The total headcount is the sum of
// size × bills, and the shape of the list says whether the shop is fed by
// couples or by tables of six — which a single average would hide.
func (r *AIRepository) GuestsByPartySize(restaurantID uint, start, end time.Time) ([]AIPartySize, error) {
	var rows []AIPartySize
	err := r.db.Table("orders").
		Select("orders.customer_count AS party_size, COUNT(*) AS bills").
		Where(
			"orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.status = ? AND orders.payment_status = ? AND orders.completed_at >= ? AND orders.completed_at < ?",
			restaurantID, entity.OrderStatusCompleted, entity.PaymentStatusPaid, start, end,
		).
		Group("orders.customer_count").
		Order("orders.customer_count asc").
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) ActiveOrders(restaurantID uint) ([]AIActiveOrder, error) {
	var rows []AIActiveOrder
	err := r.db.Table("orders").
		Select(`orders.order_number, COALESCE(restaurant_tables.table_number, '') AS table_number,
			orders.order_type, orders.status, orders.payment_status,
			orders.grand_total, orders.customer_count, orders.opened_at`).
		Joins("LEFT JOIN restaurant_tables ON restaurant_tables.id = orders.table_id").
		Where("orders.restaurant_id = ? AND orders.deleted_at IS NULL", restaurantID).
		Where("orders.status NOT IN (?)", []string{entity.OrderStatusCompleted, entity.OrderStatusCancelled}).
		Order("orders.opened_at asc").
		Scan(&rows).Error
	return rows, err
}

// FindRestaurant returns the shop's own profile row — its name, branch, type and
// opening hours. The assistant had no way to read this, so "ร้านเราชื่ออะไร"
// was a dead end that it filled by dumping a sales total.
func (r *AIRepository) FindRestaurant(restaurantID uint) (*entity.Restaurant, error) {
	var restaurant entity.Restaurant
	if err := r.db.First(&restaurant, restaurantID).Error; err != nil {
		return nil, err
	}
	return &restaurant, nil
}

// RestaurantAIActionsEnabled reports whether the owner has turned on the
// assistant's ability to make changes for this restaurant.
func (r *AIRepository) RestaurantAIActionsEnabled(restaurantID uint) (bool, error) {
	var enabled bool
	err := r.db.Model(&entity.Restaurant{}).
		Where("id = ? AND deleted_at IS NULL", restaurantID).
		Select("ai_actions_enabled").
		Scan(&enabled).Error
	return enabled, err
}

// SetRestaurantAIActionsEnabled stores the owner's on/off choice for the
// assistant's write actions.
func (r *AIRepository) SetRestaurantAIActionsEnabled(restaurantID uint, enabled bool) error {
	return r.db.Model(&entity.Restaurant{}).
		Where("id = ? AND deleted_at IS NULL", restaurantID).
		Update("ai_actions_enabled", enabled).Error
}

func (r *AIRepository) SalesForHourRange(restaurantID uint, start, end time.Time, startHour, endHour int) (AISalesRange, error) {
	var res AISalesRange
	err := r.db.Model(&entity.Order{}).
		Select(`
			COUNT(*) AS orders,
			COALESCE(SUM(grand_total), 0) AS revenue,
			COUNT(DISTINCT TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')) AS days`).
		Where(
			`restaurant_id = ? AND completed_at >= ? AND completed_at < ?
			 AND EXTRACT(HOUR FROM completed_at AT TIME ZONE 'Asia/Bangkok') >= ?
			 AND EXTRACT(HOUR FROM completed_at AT TIME ZONE 'Asia/Bangkok') < ?
			 AND status = ? AND payment_status = ?`,
			restaurantID,
			start,
			end,
			startHour,
			endHour,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Scan(&res).Error
	return res, err
}

// AISalesCoverage describes how far the recorded sales history actually reaches.
type AISalesCoverage struct {
	FirstDate string  `json:"first_date"`
	LastDate  string  `json:"last_date"`
	Days      int64   `json:"days"`
	Orders    int64   `json:"orders"`
	Revenue   float64 `json:"revenue"`
}

// SalesCoverage reports the first and last day that has paid sales. "Today has no
// orders" is useless on its own; knowing the history stops on a given date is what
// actually answers the user.
func (r *AIRepository) SalesCoverage(restaurantID uint) (AISalesCoverage, error) {
	var res AISalesCoverage
	err := r.db.Model(&entity.Order{}).
		Select(`
			TO_CHAR(MIN(completed_at) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS first_date,
			TO_CHAR(MAX(completed_at) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS last_date,
			COUNT(DISTINCT TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')) AS days,
			COUNT(*) AS orders,
			COALESCE(SUM(grand_total), 0) AS revenue`).
		// Capped at this minute like every other sales read: the demo seeder
		// writes the whole day up front, and "ยอดขายรวมตั้งแต่เปิดร้าน" carried
		// this evening's bills before they had happened.
		Where(
			"restaurant_id = ? AND status = ? AND payment_status = ? AND completed_at IS NOT NULL AND completed_at <= ?",
			restaurantID,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
			BangkokNow(),
		).
		Scan(&res).Error
	return res, err
}

func (r *AIRepository) SalesForRange(restaurantID uint, start, end time.Time) (AISalesRange, error) {
	var res AISalesRange
	err := r.db.Model(&entity.Order{}).
		Select("COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue, COUNT(DISTINCT TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')) AS days").
		Where(
			"restaurant_id = ? AND completed_at >= ? AND completed_at < ? AND status = ? AND payment_status = ?",
			restaurantID,
			start,
			end,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Scan(&res).Error
	return res, err
}

func (r *AIRepository) TopMenuItems(restaurantID uint, since time.Time) ([]AIMenuSummary, error) {
	var rows []AIMenuSummary
	err := r.db.Table("order_items").
		Select("order_items.menu_name, COALESCE(SUM(order_items.quantity), 0) AS quantity, COALESCE(SUM("+orderItemNetRevenue+"), 0) AS revenue").
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where(
			"order_items.restaurant_id = ? AND order_items.deleted_at IS NULL AND order_items.status = ? AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			entity.OrderItemStatusServed,
			restaurantID,
			since,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("order_items.menu_name").
		Order("quantity desc, revenue desc").
		Limit(10).
		Scan(&rows).Error
	return rows, err
}

// MostExpensiveMenus lists menus by their listed price (highest first). Menu
// price is not time-windowed, so this reflects the current menu. The limit is
// deep (not 5) so rank-N questions ("แพงอันดับที่ 8") can be answered for the
// whole menu; answer formatters still cap how many rows they display.
func (r *AIRepository) MostExpensiveMenus(restaurantID uint) ([]AIMenuPrice, error) {
	var rows []AIMenuPrice
	err := r.db.Table("menu_items").
		Select("name, price").
		Where("restaurant_id = ? AND deleted_at IS NULL", restaurantID).
		Order("price desc, name asc").
		Limit(100).
		Scan(&rows).Error
	return rows, err
}

// MenuCatalogue lists the shop's whole menu — every item, sold or not, with its
// price, whether it is currently on sale, and its category. It is not
// time-windowed and not ranked by sales, which is exactly what separates it from
// every other menu list in this file: those answer "what sells", this answers
// "what do we serve". Ordered by category then name so the fact sheet reads like
// the menu board rather than a database dump.
func (r *AIRepository) MenuCatalogue(restaurantID uint) ([]AIMenuCatalogueItem, error) {
	var rows []AIMenuCatalogueItem
	err := r.db.Table("menu_items").
		Select("menu_items.name, menu_items.price, menu_items.is_available, COALESCE(categories.name, '') AS category").
		Joins("LEFT JOIN categories ON categories.id = menu_items.category_id AND categories.deleted_at IS NULL").
		Where("menu_items.restaurant_id = ? AND menu_items.deleted_at IS NULL", restaurantID).
		Order("category asc, menu_items.name asc").
		Scan(&rows).Error
	return rows, err
}

// MenusByRevenue ranks menus by what they took, counted the way every other
// revenue figure is: served items on completed, paid bills, by the day the bill
// closed. It used to count every non-cancelled item by the day it was ordered,
// open and unpaid bills included, so "เมนูขายดี" and "เมนูทำเงิน" asked a minute
// apart put แกงเขียวหวานไก่ at 37,797 and then 37,539 for the same thirty days
// — both faithfully read from their sheets, and the owner had no way to know
// which was the shop's real figure.
func (r *AIRepository) MenusByRevenue(restaurantID uint, since time.Time) ([]AIMenuSummary, error) {
	var rows []AIMenuSummary
	err := r.db.Table("order_items").
		Select("order_items.menu_name, COALESCE(SUM(order_items.quantity), 0) AS quantity, COALESCE(SUM("+orderItemNetRevenue+"), 0) AS revenue").
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where(
			"order_items.restaurant_id = ? AND order_items.deleted_at IS NULL AND order_items.status = ? AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			entity.OrderItemStatusServed,
			restaurantID,
			since,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("order_items.menu_name").
		Order("revenue desc, quantity desc").
		Limit(10).
		Scan(&rows).Error
	return rows, err
}

// OrderTypeBreakdown counts bills the same way every revenue figure does:
// completed and paid, attributed to the day the bill was closed. It used to
// count every non-cancelled bill by the day it was opened, so "สั่งกลับบ้านกี่
// ออเดอร์" (325) and "ขายได้กี่บิล" (1,052 of which 323 takeaway) disagreed about
// the same month, and a share worked out from the two was wrong. Traffic
// questions (peak hours) still count by opened_at — that is when the customer
// walked in.
func (r *AIRepository) OrderTypeBreakdown(restaurantID uint, since time.Time) ([]AIOrderTypeSummary, error) {
	var rows []AIOrderTypeSummary
	err := r.db.Model(&entity.Order{}).
		Select("order_type, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where("restaurant_id = ? AND deleted_at IS NULL AND completed_at >= ? AND status = ? AND payment_status = ?",
			restaurantID, since, entity.OrderStatusCompleted, entity.PaymentStatusPaid).
		Group("order_type").
		Order("revenue desc").
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) MenuMargins(restaurantID uint, since time.Time) ([]AIMenuMarginSummary, error) {
	return r.menuMargins(restaurantID, since, "profit desc, revenue desc", 8)
}

// MenuMetricsForRange returns per-menu quantity, revenue, cost, profit and margin
// for the half-open window [start, end). Unlike the snapshot lists it is scoped to
// an arbitrary calendar period, so questions like "เมนูไหนกำไรดีสุดเดือนที่ผ่านมา"
// are answered from that month rather than the rolling analysis window.
func (r *AIRepository) MenuMetricsForRange(restaurantID uint, start, end time.Time) ([]AIMenuMarginSummary, error) {
	var rows []AIMenuMarginSummary
	err := r.db.Table("order_items").
		Select(aiMenuMarginSelect).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Joins(
			aiMenuMarginCostJoin,
			restaurantID,
		).
		Where(
			"order_items.restaurant_id = ? AND order_items.status = ? AND order_items.deleted_at IS NULL AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.completed_at < ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			entity.OrderItemStatusServed,
			restaurantID,
			start,
			end,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("order_items.menu_name").
		Order("revenue desc").
		Limit(200).
		Scan(&rows).Error
	return rows, err
}

// AllMenuMargins returns up to 100 served menus with margin+quantity, used for
// menu-engineering quadrant classification.
func (r *AIRepository) AllMenuMargins(restaurantID uint, since time.Time) ([]AIMenuMarginSummary, error) {
	return r.menuMargins(restaurantID, since, "quantity desc, revenue desc", 100)
}

// MenuMarginsByCategory returns every menu sold in the window with its category
// attached, so profit can be totalled per section of the menu board. Nothing else
// here reads categories at all: every ranked list is one flat list of the whole
// shop, which is why "เครื่องดื่มตัวไหนกำไรดีสุด" could only be answered by hoping a
// drink had made the top eight.
//
// It is a query of its own rather than a category column on menuMargins because
// grouping by category as well as by name splits one menu into two rows if its
// name has lived under two categories — harmless when the rows are being summed
// per category, wrong for the ranked lists that share menuMargins and must show
// one row per menu.
//
// The menu and category joins are LEFT for the same reason MenuCatalogue's is: a
// menu deleted after it sold still earned its money, and an inner join would drop
// that money out of the totals without leaving a trace.
func (r *AIRepository) MenuMarginsByCategory(restaurantID uint, since time.Time) ([]AICategoryMenuMargin, error) {
	var rows []AICategoryMenuMargin
	err := r.db.Table("order_items").
		Select(aiMenuMarginSelect+`,
			COALESCE(categories.name, '') AS category`).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Joins(
			aiMenuMarginCostJoin,
			restaurantID,
		).
		Joins("LEFT JOIN menu_items ON menu_items.id = order_items.menu_id").
		Joins("LEFT JOIN categories ON categories.id = menu_items.category_id AND categories.deleted_at IS NULL").
		Where(
			"order_items.restaurant_id = ? AND order_items.status = ? AND order_items.deleted_at IS NULL AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			entity.OrderItemStatusServed,
			restaurantID,
			since,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("order_items.menu_name, categories.name").
		Order("profit desc, revenue desc").
		Limit(200).
		Scan(&rows).Error
	return rows, err
}

// PaymentMix totals the bills paid by each method inside [start, end), keyed on
// when the bill was closed so the figures line up with every other revenue
// number. Only completed, paid orders count — a payment row on a bill that was
// later voided would otherwise be reported as money taken.
func (r *AIRepository) PaymentMix(restaurantID uint, start, end time.Time) ([]AIPaymentMethodSummary, error) {
	var rows []AIPaymentMethodSummary
	err := r.db.Table("order_payments").
		Select("order_payments.method, COUNT(*) AS bills, COALESCE(SUM(order_payments.amount), 0) AS amount").
		Joins("JOIN orders ON orders.id = order_payments.order_id").
		Where("order_payments.restaurant_id = ? AND order_payments.deleted_at IS NULL AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.status = ? AND orders.payment_status = ? AND orders.completed_at >= ? AND orders.completed_at < ?",
			restaurantID, restaurantID, entity.OrderStatusCompleted, entity.PaymentStatusPaid, start, end).
		Group("order_payments.method").
		Order("bills desc").
		Scan(&rows).Error
	return rows, err
}

// PaymentCoverage counts the paid bills in the window and how many of them carry
// a payment row, plus the day the first payment row was ever written.
func (r *AIRepository) PaymentCoverage(restaurantID uint, start, end time.Time) (AIPaymentCoverage, error) {
	var cov AIPaymentCoverage
	err := r.db.Table("orders").
		Select("COUNT(*) AS paid_bills, COUNT(order_payments.id) AS with_method").
		Joins("LEFT JOIN order_payments ON order_payments.order_id = orders.id AND order_payments.deleted_at IS NULL").
		Where("orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.status = ? AND orders.payment_status = ? AND orders.completed_at >= ? AND orders.completed_at < ?",
			restaurantID, entity.OrderStatusCompleted, entity.PaymentStatusPaid, start, end).
		Scan(&cov).Error
	if err != nil {
		return cov, err
	}
	var first struct{ FirstRecorded string }
	err = r.db.Table("order_payments").
		Select("TO_CHAR(MIN(paid_at) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS first_recorded").
		Where("restaurant_id = ? AND deleted_at IS NULL", restaurantID).
		Scan(&first).Error
	cov.FirstRecorded = first.FirstRecorded
	return cov, err
}

// TableUsage reports every table with the paid bills served at it inside
// [start, end), counted the way sales are: completed and paid, by the day the
// bill closed.
//
// The join is LEFT from the table so a table nobody sat at still comes back,
// with zeros. Dropping it would be the same mistake the category sheet made
// about drinks: a quiet table that never appears is indistinguishable from a
// table the shop does not have, and "which table is quiet" is exactly the
// question being asked.
//
// Takeaway and delivery bills carry no table and are simply absent here; the
// fact sheet says so, because table bills will not add up to the shop's total.
func (r *AIRepository) TableUsage(restaurantID uint, start, end time.Time) ([]AITableUsage, error) {
	var rows []AITableUsage
	err := r.db.Table("restaurant_tables").
		Select(`restaurant_tables.table_number,
			COALESCE(NULLIF(table_zones.name, ''), NULLIF(restaurant_tables.zone, ''), '') AS zone,
			restaurant_tables.capacity,
			COUNT(orders.id) AS bills,
			COALESCE(SUM(orders.grand_total), 0) AS revenue,
			COALESCE(SUM(orders.customer_count), 0) AS guests`).
		Joins("LEFT JOIN table_zones ON table_zones.id = restaurant_tables.zone_id AND table_zones.deleted_at IS NULL").
		Joins(`LEFT JOIN orders ON orders.table_id = restaurant_tables.id AND orders.deleted_at IS NULL
			AND orders.status = ? AND orders.payment_status = ?
			AND orders.completed_at >= ? AND orders.completed_at < ?`,
			entity.OrderStatusCompleted, entity.PaymentStatusPaid, start, end).
		Where("restaurant_tables.restaurant_id = ? AND restaurant_tables.deleted_at IS NULL", restaurantID).
		Group("restaurant_tables.id, table_zones.name, restaurant_tables.zone, restaurant_tables.table_number, restaurant_tables.capacity").
		Order("bills asc, revenue asc").
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) PeakSalesByWeekday(restaurantID uint, since time.Time) ([]AIPeriodSummary, error) {
	var rows []AIPeriodSummary
	err := r.db.Model(&entity.Order{}).
		Select("EXTRACT(DOW FROM opened_at)::int AS period, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where("restaurant_id = ? AND opened_at >= ? AND status <> ?", restaurantID, since, entity.OrderStatusCancelled).
		Group("period").
		Order("orders desc").
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) PeakSalesByHour(restaurantID uint, since time.Time) ([]AIPeriodSummary, error) {
	var rows []AIPeriodSummary
	err := r.db.Model(&entity.Order{}).
		Select("EXTRACT(HOUR FROM opened_at)::int AS period, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where("restaurant_id = ? AND opened_at >= ? AND status <> ?", restaurantID, since, entity.OrderStatusCancelled).
		Group("period").
		Order("orders desc").
		Scan(&rows).Error
	return rows, err
}

// PeakSalesByWeekdayForRange and PeakSalesByHourForRange are the window-bounded
// twins of the two above. The snapshot versions only ever look back a fixed 30
// days, so "อาทิตย์ก่อนช่วงไหนคนเยอะสุด" was answered about the wrong days — the
// same defect the profit and expense tools had before they learned to read the
// period out of the sentence.
func (r *AIRepository) PeakSalesByWeekdayForRange(restaurantID uint, start, end time.Time) ([]AIPeriodSummary, error) {
	var rows []AIPeriodSummary
	err := r.db.Model(&entity.Order{}).
		Select("EXTRACT(DOW FROM opened_at)::int AS period, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where("restaurant_id = ? AND opened_at >= ? AND opened_at < ? AND status <> ?",
			restaurantID, start, end, entity.OrderStatusCancelled).
		Group("period").
		Order("orders desc").
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) PeakSalesByHourForRange(restaurantID uint, start, end time.Time) ([]AIPeriodSummary, error) {
	var rows []AIPeriodSummary
	err := r.db.Model(&entity.Order{}).
		Select("EXTRACT(HOUR FROM opened_at)::int AS period, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where("restaurant_id = ? AND opened_at >= ? AND opened_at < ? AND status <> ?",
			restaurantID, start, end, entity.OrderStatusCancelled).
		Group("period").
		Order("orders desc").
		Scan(&rows).Error
	return rows, err
}

// OrderTypeBreakdownForRange totals paid orders by service type over a named
// window, for the same reason: the snapshot version is fixed at 30 days.
func (r *AIRepository) OrderTypeBreakdownForRange(restaurantID uint, start, end time.Time) ([]AIOrderTypeSummary, error) {
	var rows []AIOrderTypeSummary
	err := r.db.Model(&entity.Order{}).
		Select("order_type, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where("restaurant_id = ? AND deleted_at IS NULL AND completed_at >= ? AND completed_at < ? AND status = ? AND payment_status = ?",
			restaurantID, start, end, entity.OrderStatusCompleted, entity.PaymentStatusPaid).
		Group("order_type").
		Order("orders desc").
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) IngredientUsage(restaurantID uint, since time.Time) ([]AIIngredientUsage, error) {
	var rows []AIIngredientUsage
	err := r.db.Table("ingredients").
		Select(`ingredients.name, ingredients.unit, ingredients.stock, ingredients.cost_per_unit,
			COALESCE(SUM(d.quantity), 0) AS used,
			COALESCE(SUM(d.cost_snapshot), 0) AS cost`).
		Joins("LEFT JOIN order_inventory_deductions d ON d.ingredient_id = ingredients.id AND d.created_at >= ? AND d.deleted_at IS NULL", since).
		Where("ingredients.restaurant_id = ? AND ingredients.deleted_at IS NULL", restaurantID).
		Group("ingredients.id, ingredients.name, ingredients.unit, ingredients.stock, ingredients.cost_per_unit").
		Scan(&rows).Error
	return rows, err
}

// SlowMovingMenus lists available menus with the fewest sales (including zero)
// in the analysis window, to flag candidates for review or removal. Sales are
// counted as MenusByRevenue and TopMenuItems count them — served items on
// closed, paid bills — so the bottom of this list and the top of those agree
// about the same menu.
func (r *AIRepository) SlowMovingMenus(restaurantID uint, since time.Time) ([]AIMenuSummary, error) {
	var rows []AIMenuSummary
	err := r.db.Table("menu_items").
		Select("menu_items.name AS menu_name, COALESCE(sales.qty, 0) AS quantity, COALESCE(sales.revenue, 0) AS revenue").
		Joins(`LEFT JOIN (
			SELECT order_items.menu_id, SUM(order_items.quantity) AS qty, SUM(`+orderItemNetRevenue+`) AS revenue
			FROM order_items
			JOIN orders ON orders.id = order_items.order_id
			WHERE order_items.restaurant_id = ? AND order_items.deleted_at IS NULL AND order_items.status = ?
			  AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ?
			GROUP BY order_items.menu_id
		) sales ON sales.menu_id = menu_items.id`,
			restaurantID, entity.OrderItemStatusServed, since, entity.OrderStatusCompleted, entity.PaymentStatusPaid).
		Where("menu_items.restaurant_id = ? AND menu_items.deleted_at IS NULL", restaurantID).
		Order("quantity asc, menu_items.name asc").
		Limit(8).
		Scan(&rows).Error
	return rows, err
}

func (r *AIRepository) LowMarginMenus(restaurantID uint, since time.Time) ([]AIMenuMarginSummary, error) {
	return r.menuMargins(restaurantID, since, "margin asc, revenue desc", 8)
}

func (r *AIRepository) HighMarginMenus(restaurantID uint, since time.Time) ([]AIMenuMarginSummary, error) {
	return r.menuMargins(restaurantID, since, "margin desc, revenue desc", 8)
}

func (r *AIRepository) LowestCostMenus(restaurantID uint, since time.Time) ([]AIMenuMarginSummary, error) {
	return r.menuMargins(restaurantID, since, "(COALESCE(SUM(deductions.cost), 0) / NULLIF(SUM(order_items.quantity), 0)) asc, quantity desc", 8)
}

func (r *AIRepository) AnalysisCoverage(restaurantID uint, since time.Time) (AIAnalysisCoverage, error) {
	var coverage AIAnalysisCoverage
	err := r.db.Table("order_items").
		Select(`
			COUNT(order_items.id) AS sales_items,
			COUNT(CASE WHEN order_items.status = ? THEN 1 END) AS margin_items,
			COUNT(CASE WHEN order_items.status = ? AND deductions.order_item_id IS NOT NULL THEN 1 END) AS costed_margin_items,
			COUNT(DISTINCT CASE WHEN order_items.status = ? THEN order_items.menu_id END) AS sold_menus,
			COUNT(DISTINCT CASE WHEN order_items.status = ? AND recipes.order_item_id IS NOT NULL THEN order_items.menu_id END) AS sold_menus_with_recipes`,
			entity.OrderItemStatusServed, entity.OrderItemStatusServed, entity.OrderItemStatusServed, entity.OrderItemStatusServed).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Joins(
			"LEFT JOIN (SELECT DISTINCT order_item_id FROM order_inventory_deductions WHERE restaurant_id = ? AND deleted_at IS NULL) deductions ON deductions.order_item_id = order_items.id",
			restaurantID,
		).
		Joins(
			"LEFT JOIN (SELECT DISTINCT order_item_id FROM order_item_recipe_snapshots WHERE restaurant_id = ? AND deleted_at IS NULL) recipes ON recipes.order_item_id = order_items.id",
			restaurantID,
		).
		Where(
			"order_items.restaurant_id = ? AND order_items.status = ? AND order_items.deleted_at IS NULL AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			entity.OrderItemStatusServed,
			restaurantID,
			since,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Scan(&coverage).Error
	return coverage, err
}

// aiMenuMarginSelect and aiMenuMarginCostJoin are the per-menu money maths
// every margin query shares: quantity and revenue off the order lines, cost
// from the stock actually deducted at the moment of sale, and profit and margin
// derived from those two. They sit in one place because three queries select
// them, and an edit made to one copy alone would leave two tools quoting
// different profit for the same menu.
const (
	aiMenuMarginSelect = `
			order_items.menu_name,
			COALESCE(SUM(order_items.quantity), 0) AS quantity,
			COALESCE(SUM(` + orderItemNetRevenue + `), 0) AS revenue,
			COALESCE(SUM(deductions.cost), 0) AS cost,
			COALESCE(SUM(` + orderItemNetRevenue + `), 0) - COALESCE(SUM(deductions.cost), 0) AS profit,
			CASE WHEN COALESCE(SUM(` + orderItemNetRevenue + `), 0) > 0
				THEN ((COALESCE(SUM(` + orderItemNetRevenue + `), 0) - COALESCE(SUM(deductions.cost), 0)) / COALESCE(SUM(` + orderItemNetRevenue + `), 0)) * 100
				ELSE 0
			END AS margin`

	aiMenuMarginCostJoin = "LEFT JOIN (SELECT order_item_id, SUM(cost_snapshot) AS cost FROM order_inventory_deductions WHERE restaurant_id = ? AND deleted_at IS NULL GROUP BY order_item_id) deductions ON deductions.order_item_id = order_items.id"
)

func (r *AIRepository) menuMargins(restaurantID uint, since time.Time, orderBy string, limit int) ([]AIMenuMarginSummary, error) {
	var rows []AIMenuMarginSummary
	err := r.db.Table("order_items").
		Select(aiMenuMarginSelect).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Joins(
			aiMenuMarginCostJoin,
			restaurantID,
		).
		Where(
			"order_items.restaurant_id = ? AND order_items.status = ? AND order_items.deleted_at IS NULL AND orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			entity.OrderItemStatusServed,
			restaurantID,
			since,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("order_items.menu_name").
		Order(orderBy).
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

// One bill, read whole.
//
// Every other tool here totals or ranks: what the shop sold this month, which
// menu earns most. None of them could answer "ขอดูบิล 20260906-015" or "โต๊ะ 5
// เมื่อกี้สั่งอะไรไปบ้าง" — a bill was reachable only as a number inside a sum.
// The rows below are what a person means by a bill: the lines on it, what was
// taken off or added, and how it was paid.
//
// The customer's name and phone stay out, the same rule AIActiveOrder follows:
// this leaves the system for a model provider, and neither is needed to say what
// was ordered and what it cost.

// AIBillLine is one line on a bill: the dish, how many, and what it came to.
type AIBillLine struct {
	MenuName  string  `json:"menu_name"`
	Quantity  int     `json:"quantity"`
	UnitPrice float64 `json:"unit_price"`
	Subtotal  float64 `json:"subtotal"`
	Status    string  `json:"status"`
	Note      string  `json:"note"`
}

// AIBill is one bill's own row. Lines are filled in only by BillsByNumbers —
// the recent list carries totals alone, so a question that names no bill does
// not drag every dish of the last twenty bills to the model.
type AIBill struct {
	OrderNumber         string     `json:"order_number"`
	OrderType           string     `json:"order_type"`
	Status              string     `json:"status"`
	PaymentStatus       string     `json:"payment_status"`
	TableNumber         string     `json:"table_number"`
	StaffName           string     `json:"staff_name"`
	CustomerCount       int        `json:"customer_count"`
	Subtotal            float64    `json:"subtotal"`
	DiscountAmount      float64    `json:"discount_amount"`
	ServiceChargeAmount float64    `json:"service_charge_amount"`
	VATAmount           float64    `json:"vat_amount"`
	GrandTotal          float64    `json:"grand_total"`
	OpenedAt            time.Time  `json:"opened_at"`
	CompletedAt         *time.Time `json:"completed_at"`
	PaymentMethod       string     `json:"payment_method"`
	CancelledReason     string     `json:"cancelled_reason"`
	// gorm:"-" because the scan target embeds this struct: without it GORM reads
	// the slice as a relation and refuses the query outright ("define a valid
	// foreign key"). Lines are filled in by a second query, not by a join.
	Lines []AIBillLine `json:"lines" gorm:"-"`
}

// aiBillSelect is the one column list both queries read, so a field can never be
// present on a looked-up bill and missing from the same bill in the recent list.
const aiBillSelect = `orders.id, orders.order_number, orders.order_type, orders.status,
	orders.payment_status, COALESCE(restaurant_tables.table_number, '') AS table_number,
	COALESCE(users.first_name, '') AS staff_name, orders.customer_count,
	orders.subtotal, orders.discount_amount, orders.service_charge_amount, orders.vat_amount,
	orders.grand_total, orders.opened_at, orders.completed_at,
	COALESCE(orders.cancelled_reason, '') AS cancelled_reason,
	COALESCE((SELECT op.method FROM order_payments op
		WHERE op.order_id = orders.id AND op.deleted_at IS NULL
		ORDER BY op.paid_at DESC LIMIT 1), '') AS payment_method`

// aiBillRow carries the row's own id alongside the bill so the line query knows
// which order to attach to without a second lookup by number.
type aiBillRow struct {
	AIBill
	ID uint `json:"id"`
}

// RecentBills lists the shop's latest bills, newest first, without their lines.
// It is the shortlist a question that names no bill is answered from: the model
// reads it and says which bill it means, rather than Go deciding that "the last
// one" is what was wanted.
func (r *AIRepository) RecentBills(restaurantID uint, limit int) ([]AIBill, error) {
	if limit <= 0 {
		limit = 20
	}
	var rows []aiBillRow
	err := r.db.Table("orders").
		Select(aiBillSelect).
		Joins("LEFT JOIN restaurant_tables ON restaurant_tables.id = orders.table_id").
		Joins("LEFT JOIN users ON users.id = orders.staff_id").
		// A bill cannot be opened in the future, and the demo data is seeded a
		// whole day at a time — so without this bound "บิลล่าสุด" is a bill that
		// has not happened yet, listed at 20:15 on an afternoon.
		Where("orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.opened_at <= ?", restaurantID, BangkokNow()).
		Order("orders.opened_at desc").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	bills := make([]AIBill, 0, len(rows))
	for _, row := range rows {
		bills = append(bills, row.AIBill)
	}
	return bills, nil
}

// BillsByNumbers reads the named bills in full, lines included. Numbers are
// matched exactly: the shortlisting from a half-written number happens above
// this, against numbers this repository already returned.
func (r *AIRepository) BillsByNumbers(restaurantID uint, numbers []string) ([]AIBill, error) {
	if len(numbers) == 0 {
		return nil, nil
	}
	var rows []aiBillRow
	err := r.db.Table("orders").
		Select(aiBillSelect).
		Joins("LEFT JOIN restaurant_tables ON restaurant_tables.id = orders.table_id").
		Joins("LEFT JOIN users ON users.id = orders.staff_id").
		Where("orders.restaurant_id = ? AND orders.deleted_at IS NULL AND orders.order_number IN (?)", restaurantID, numbers).
		Order("orders.opened_at desc").
		Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}

	ids := make([]uint, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	type lineRow struct {
		AIBillLine
		OrderID uint `json:"order_id"`
	}
	var lines []lineRow
	// Cancelled lines stay in. A dish struck off the bill is part of what
	// happened at that table, and hiding it is how "ทำไมยอดไม่ตรง" becomes
	// unanswerable.
	if err := r.db.Table("order_items").
		Select(`order_items.order_id, order_items.menu_name, order_items.quantity,
			order_items.unit_price, order_items.subtotal, order_items.status,
			COALESCE(order_items.note, '') AS note`).
		Where("order_items.order_id IN (?) AND order_items.deleted_at IS NULL", ids).
		Order("order_items.id asc").
		Scan(&lines).Error; err != nil {
		return nil, err
	}
	byOrder := make(map[uint][]AIBillLine, len(ids))
	for _, line := range lines {
		byOrder[line.OrderID] = append(byOrder[line.OrderID], line.AIBillLine)
	}

	bills := make([]AIBill, 0, len(rows))
	for _, row := range rows {
		bill := row.AIBill
		bill.Lines = byOrder[row.ID]
		bills = append(bills, bill)
	}
	return bills, nil
}

// The owner's AI preferences, stored on the restaurant row.
//
// Two JSONB columns and a short text column, read and written together because
// the settings screen reads them together. A NULL column decodes to a nil map,
// which the service treats as "nothing chosen yet" — every action allowed,
// every insight shown.

// AIPreferences mirrors service.AIPreferences. It lives here because the service
// package imports this one, so the row cannot be typed with the service's
// struct; the service converts on the way through.
//
// RestaurantName rides along because it comes off the same row in the same
// query and the assistant needs it on every ask. It is read-only: the setter
// below writes named columns and never touches the shop's name.
type AIPreferences struct {
	ActionTypes    map[string]bool
	InsightKinds   map[string]bool
	OwnerTitle     string
	RestaurantName string
}

// aiPreferenceRow is the slice of the restaurant row these methods touch.
type aiPreferenceRow struct {
	AIActionTypes  *string
	AIInsightKinds *string
	AIOwnerTitle   string
	Name           string
}

// RestaurantAIPreferences reads the owner's choices for one restaurant.
func (r *AIRepository) RestaurantAIPreferences(restaurantID uint) (AIPreferences, error) {
	var row aiPreferenceRow
	err := r.db.Model(&entity.Restaurant{}).
		Select("ai_action_types, ai_insight_kinds, ai_owner_title, name").
		Where("id = ? AND deleted_at IS NULL", restaurantID).
		Scan(&row).Error
	if err != nil {
		return AIPreferences{}, err
	}
	prefs := AIPreferences{OwnerTitle: row.AIOwnerTitle, RestaurantName: row.Name}
	if row.AIActionTypes != nil && strings.TrimSpace(*row.AIActionTypes) != "" {
		if err := json.Unmarshal([]byte(*row.AIActionTypes), &prefs.ActionTypes); err != nil {
			return AIPreferences{}, fmt.Errorf("decode ai_action_types: %w", err)
		}
	}
	if row.AIInsightKinds != nil && strings.TrimSpace(*row.AIInsightKinds) != "" {
		if err := json.Unmarshal([]byte(*row.AIInsightKinds), &prefs.InsightKinds); err != nil {
			return AIPreferences{}, fmt.Errorf("decode ai_insight_kinds: %w", err)
		}
	}
	return prefs, nil
}

// SetRestaurantAIPreferences replaces the owner's choices for one restaurant.
// A nil map is stored as NULL, so "never chosen" and "chosen everything" stay
// distinguishable in the row.
func (r *AIRepository) SetRestaurantAIPreferences(restaurantID uint, prefs AIPreferences) error {
	encode := func(m map[string]bool) (*string, error) {
		if m == nil {
			return nil, nil
		}
		raw, err := json.Marshal(m)
		if err != nil {
			return nil, err
		}
		text := string(raw)
		return &text, nil
	}
	actionTypes, err := encode(prefs.ActionTypes)
	if err != nil {
		return fmt.Errorf("encode ai_action_types: %w", err)
	}
	insightKinds, err := encode(prefs.InsightKinds)
	if err != nil {
		return fmt.Errorf("encode ai_insight_kinds: %w", err)
	}
	return r.db.Model(&entity.Restaurant{}).
		Where("id = ? AND deleted_at IS NULL", restaurantID).
		Updates(map[string]interface{}{
			"ai_action_types":  actionTypes,
			"ai_insight_kinds": insightKinds,
			"ai_owner_title":   strings.TrimSpace(prefs.OwnerTitle),
		}).Error
}
