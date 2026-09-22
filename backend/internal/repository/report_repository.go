package repository

import (
	"strconv"
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type ReportRepository struct {
	db *gorm.DB
}

func NewReportRepository(db *gorm.DB) *ReportRepository {
	return &ReportRepository{db: db}
}

type ReportSalesDay struct {
	OrderDate string  `json:"order_date"`
	Orders    int64   `json:"orders"`
	Revenue   float64 `json:"revenue"`
	// Discount is what the bills of that day took off before they were paid, so
	// revenue + discount is what the same food would have fetched at list price.
	Discount float64 `json:"discount"`
	Cost     float64 `json:"cost"`
	Profit   float64 `json:"profit"`
}

type ReportSalesHour struct {
	Hour    int     `json:"hour"`
	Orders  int64   `json:"orders"`
	Revenue float64 `json:"revenue"`
	Cost    float64 `json:"cost"`
	Profit  float64 `json:"profit"`
}

// ReportSalesDetailOrder is one bill behind a chart bar. It carries revenue,
// cost and profit together so a single drill-down answers whichever metric the
// chart is showing — there is no per-metric variant of this query.
type ReportSalesDetailOrder struct {
	OrderID      uint      `json:"order_id"`
	OrderNumber  string    `json:"order_number"`
	OrderType    string    `json:"order_type"`
	TableLabel   string    `json:"table_label"`
	CustomerName string    `json:"customer_name"`
	CompletedAt  time.Time `json:"completed_at"`
	Revenue      float64   `json:"revenue"`
	Cost         float64   `json:"cost"`
	Profit       float64   `json:"profit"`
}

type ReportSalesDetailSummary struct {
	Orders  int64   `json:"orders"`
	Revenue float64 `json:"revenue"`
	Cost    float64 `json:"cost"`
	Profit  float64 `json:"profit"`
}

// salesBucketFormat is a TO_CHAR pattern that gets inlined into SQL. It is an
// unexported type with only the two constants below, so no request-supplied
// string can ever reach the query text.
type salesBucketFormat string

const (
	bucketByDate salesBucketFormat = "YYYY-MM-DD"
	bucketByHour salesBucketFormat = "HH24"
)

// bucketExpr builds the grouping expression. It has to appear in full in both
// SELECT and GROUP BY: gorm quotes whatever Group() is given, so `Group("1")`
// emits `GROUP BY "1"`, which Postgres reads as a column name rather than an
// output-column ordinal and rejects.
func bucketExpr(column string, format salesBucketFormat) string {
	return "TO_CHAR(" + column + " AT TIME ZONE 'Asia/Bangkok', '" + string(format) + "')"
}

// salesBucket is one time slice of paid revenue and its ingredient cost. The
// bucket label is whatever TO_CHAR pattern the caller grouped by.
type salesBucket struct {
	Bucket   string
	Orders   int64
	Revenue  float64
	Discount float64
	Cost     float64
	Profit   float64
}

type ReportMenuMargin struct {
	MenuID   uint    `json:"menu_id"`
	MenuName string  `json:"menu_name"`
	Quantity int64   `json:"quantity"`
	Revenue  float64 `json:"revenue"`
	Cost     float64 `json:"cost"`
	Profit   float64 `json:"profit"`
	Margin   float64 `json:"margin"`
}

// salesBuckets groups paid+completed orders by `bucketFormat` (a TO_CHAR
// pattern applied in Asia/Bangkok) and pairs each bucket with the ingredient
// cost of the served items on those orders. `until` is exclusive; pass the
// zero time for no upper bound. Both queries share one definition of "counts
// as a sale" so day and hour views can never drift apart.
func (r *ReportRepository) salesBuckets(restaurantID uint, bucketFormat salesBucketFormat, since, until time.Time) ([]salesBucket, error) {
	orderBucket := bucketExpr("completed_at", bucketFormat)
	costBucket := bucketExpr("orders.completed_at", bucketFormat)
	orderWhere := "restaurant_id = ? AND completed_at >= ? AND status = ? AND payment_status = ?"
	orderArgs := []any{restaurantID, since, entity.OrderStatusCompleted, entity.PaymentStatusPaid}
	costWhere := "order_inventory_deductions.restaurant_id = ? AND order_inventory_deductions.deleted_at IS NULL AND order_items.deleted_at IS NULL AND orders.deleted_at IS NULL AND orders.completed_at >= ? AND orders.status = ? AND orders.payment_status = ? AND order_items.status = ?"
	costArgs := []any{restaurantID, since, entity.OrderStatusCompleted, entity.PaymentStatusPaid, entity.OrderItemStatusServed}
	if !until.IsZero() {
		orderWhere += " AND completed_at < ?"
		orderArgs = append(orderArgs, until)
		costWhere += " AND orders.completed_at < ?"
		costArgs = append(costArgs, until)
	}

	var rows []salesBucket
	err := r.db.Model(&entity.Order{}).
		Select(orderBucket+" AS bucket, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue, COALESCE(SUM(discount_amount), 0) AS discount").
		Where(orderWhere, orderArgs...).
		Group(orderBucket).
		Order(orderBucket + " desc").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	var costs []struct {
		Bucket string
		Cost   float64
	}
	err = r.db.Table("order_inventory_deductions").
		Select(costBucket+" AS bucket, COALESCE(SUM(order_inventory_deductions.cost_snapshot), 0) AS cost").
		Joins("JOIN order_items ON order_items.id = order_inventory_deductions.order_item_id").
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where(costWhere, costArgs...).
		Group(costBucket).
		Scan(&costs).Error
	if err != nil {
		return nil, err
	}

	costByBucket := make(map[string]float64, len(costs))
	for _, c := range costs {
		costByBucket[c.Bucket] = c.Cost
	}
	for i := range rows {
		rows[i].Cost = costByBucket[rows[i].Bucket]
		rows[i].Profit = rows[i].Revenue - rows[i].Cost
	}
	return rows, nil
}

func (r *ReportRepository) SalesByDay(restaurantID uint, since time.Time) ([]ReportSalesDay, error) {
	return r.SalesByDayBetween(restaurantID, since, time.Time{})
}

// SalesByDayBetween is SalesByDay over [since, until); a zero until has no end.
func (r *ReportRepository) SalesByDayBetween(restaurantID uint, since, until time.Time) ([]ReportSalesDay, error) {
	buckets, err := r.salesBuckets(restaurantID, bucketByDate, since, until)
	if err != nil {
		return nil, err
	}
	rows := make([]ReportSalesDay, 0, len(buckets))
	for _, b := range buckets {
		rows = append(rows, ReportSalesDay{OrderDate: b.Bucket, Orders: b.Orders, Revenue: b.Revenue, Discount: b.Discount, Cost: b.Cost, Profit: b.Profit})
	}
	return rows, nil
}

// SalesByHour breaks a single Bangkok calendar day into hour buckets, using the
// same "paid and completed" rule as SalesByDay — so the hours of a day sum to
// that day's bar, which is not true of anything computed from open tickets.
// Hours with no sales are omitted; the caller fills the gaps.
func (r *ReportRepository) SalesByHour(restaurantID uint, day time.Time) ([]ReportSalesHour, error) {
	dayStart := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, day.Location())
	buckets, err := r.salesBuckets(restaurantID, bucketByHour, dayStart, dayStart.AddDate(0, 0, 1))
	if err != nil {
		return nil, err
	}
	rows := make([]ReportSalesHour, 0, len(buckets))
	for _, b := range buckets {
		hour, err := strconv.Atoi(b.Bucket)
		if err != nil {
			continue
		}
		rows = append(rows, ReportSalesHour{Hour: hour, Orders: b.Orders, Revenue: b.Revenue, Cost: b.Cost, Profit: b.Profit})
	}
	return rows, nil
}

func (r *ReportRepository) SalesWindowSummary(restaurantID uint, since, until time.Time) (ReportSalesDetailSummary, error) {
	buckets, err := r.salesBuckets(restaurantID, bucketByDate, since, until)
	if err != nil {
		return ReportSalesDetailSummary{}, err
	}
	summary := ReportSalesDetailSummary{}
	for _, bucket := range buckets {
		summary.Orders += bucket.Orders
		summary.Revenue += bucket.Revenue
		summary.Cost += bucket.Cost
	}
	summary.Profit = summary.Revenue - summary.Cost
	return summary, nil
}

// SalesDetail lists the individual bills inside one chart bar's window, using
// the same paid+completed cohort as salesBuckets so the rows always add up to
// the bar they were opened from. `until` is exclusive.
func (r *ReportRepository) SalesDetail(restaurantID uint, since, until time.Time, limit int) ([]ReportSalesDetailOrder, error) {
	var rows []ReportSalesDetailOrder
	err := r.db.Model(&entity.Order{}).
		Select(`orders.id AS order_id, orders.order_number, orders.order_type,
			COALESCE(NULLIF(restaurant_tables.display_label, ''), restaurant_tables.table_number, '') AS table_label,
			orders.customer_name, orders.completed_at, orders.grand_total AS revenue`).
		Joins("LEFT JOIN restaurant_tables ON restaurant_tables.id = orders.table_id").
		Where(
			"orders.restaurant_id = ? AND orders.completed_at >= ? AND orders.completed_at < ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID,
			since,
			until,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Order("orders.completed_at asc, orders.id asc").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return rows, nil
	}

	orderIDs := make([]uint, 0, len(rows))
	for _, row := range rows {
		orderIDs = append(orderIDs, row.OrderID)
	}
	var costs []struct {
		OrderID uint
		Cost    float64
	}
	err = r.db.Table("order_inventory_deductions").
		Select("order_items.order_id AS order_id, COALESCE(SUM(order_inventory_deductions.cost_snapshot), 0) AS cost").
		Joins("JOIN order_items ON order_items.id = order_inventory_deductions.order_item_id").
		Where(
			"order_inventory_deductions.deleted_at IS NULL AND order_items.deleted_at IS NULL AND order_items.order_id IN ? AND order_items.status = ?",
			orderIDs,
			entity.OrderItemStatusServed,
		).
		Group("order_items.order_id").
		Scan(&costs).Error
	if err != nil {
		return nil, err
	}

	costByOrder := make(map[uint]float64, len(costs))
	for _, c := range costs {
		costByOrder[c.OrderID] = c.Cost
	}
	for i := range rows {
		rows[i].Cost = costByOrder[rows[i].OrderID]
		rows[i].Profit = rows[i].Revenue - rows[i].Cost
	}
	return rows, nil
}

// ExpenseTotal adds up the expense ledger over [since, until): every row a
// person typed or a stock-in wrote, whatever its category. It is money that
// left the shop, not the recipe cost of food sold — see entity.Expense.
//
// Operating is the part that is not an ingredient purchase — wages, rent,
// utilities, equipment, other. Net profit takes that part off gross profit; the
// ingredient purchases are already in gross profit as the recipe cost of what
// sold, and taking them off again would count the same food twice.
func (r *ReportRepository) ExpenseTotal(restaurantID uint, since, until time.Time) (total float64, operating float64, count int64, err error) {
	var row struct {
		Total     float64
		Operating float64
		Count     int64
	}
	err = r.db.Model(&entity.Expense{}).
		Select("COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(CASE WHEN category <> ? THEN amount ELSE 0 END), 0) AS operating, COUNT(*) AS count", "ingredient").
		Where("restaurant_id = ? AND spent_at >= ? AND spent_at < ?", restaurantID, since, until).
		Scan(&row).Error
	return row.Total, row.Operating, row.Count, err
}

func (r *ReportRepository) MenuMargins(restaurantID uint, since time.Time) ([]ReportMenuMargin, error) {
	return r.MenuMarginsBetween(restaurantID, since, time.Time{})
}

// MenuMarginsBetween is MenuMargins over [since, until); a zero until has no end.
func (r *ReportRepository) MenuMarginsBetween(restaurantID uint, since, until time.Time) ([]ReportMenuMargin, error) {
	var rows []ReportMenuMargin
	query := r.db.Table("order_items").
		Select(`
			order_items.menu_id,
			order_items.menu_name,
			COALESCE(SUM(order_items.quantity), 0) AS quantity,
			COALESCE(SUM(`+orderItemNetRevenue+`), 0) AS revenue,
			COALESCE(SUM(deductions.cost), 0) AS cost,
			COALESCE(SUM(`+orderItemNetRevenue+`), 0) - COALESCE(SUM(deductions.cost), 0) AS profit,
			CASE WHEN COALESCE(SUM(`+orderItemNetRevenue+`), 0) > 0
				THEN ((COALESCE(SUM(`+orderItemNetRevenue+`), 0) - COALESCE(SUM(deductions.cost), 0)) / COALESCE(SUM(`+orderItemNetRevenue+`), 0)) * 100
				ELSE 0
			END AS margin`).
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Joins(
			"LEFT JOIN (SELECT order_item_id, SUM(cost_snapshot) AS cost FROM order_inventory_deductions WHERE restaurant_id = ? AND deleted_at IS NULL GROUP BY order_item_id) deductions ON deductions.order_item_id = order_items.id",
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
		)
	if !until.IsZero() {
		query = query.Where("orders.completed_at < ?", until)
	}
	err := query.
		Group("order_items.menu_id, order_items.menu_name").
		Order("profit desc, revenue desc").
		Limit(12).
		Scan(&rows).Error
	return rows, err
}

type ReportTopMenuItem struct {
	MenuID   uint   `json:"menu_id"`
	MenuName string `json:"menu_name"`
	Quantity int64  `json:"quantity"`
}

// TopMenuItemsByMonth returns quantity sold per menu item within [monthStart, monthEnd)
// where monthEnd is exclusive (i.e. the first day of the following month).
func (r *ReportRepository) TopMenuItemsByMonth(restaurantID uint, monthStart, monthEnd time.Time) ([]ReportTopMenuItem, error) {
	var rows []ReportTopMenuItem
	err := r.db.Table("order_items").
		Select("order_items.menu_id, order_items.menu_name, COALESCE(SUM(order_items.quantity), 0) AS quantity").
		Joins("JOIN orders ON orders.id = order_items.order_id").
		Where(
			"order_items.restaurant_id = ? AND orders.restaurant_id = ? AND orders.completed_at >= ? AND orders.completed_at < ? AND orders.status = ? AND orders.payment_status = ? AND orders.deleted_at IS NULL AND order_items.status = ? AND order_items.deleted_at IS NULL",
			restaurantID,
			restaurantID,
			monthStart,
			monthEnd,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
			entity.OrderItemStatusServed,
		).
		Group("order_items.menu_id, order_items.menu_name").
		Order("quantity desc").
		Limit(100).
		Scan(&rows).Error
	return rows, err
}

func (r *ReportRepository) StockRisks(restaurantID uint) ([]entity.Ingredient, error) {
	var ingredients []entity.Ingredient
	err := r.db.
		Preload("Category").
		Where("restaurant_id = ? AND (stock <= 0 OR (min_stock > 0 AND stock <= min_stock))", restaurantID).
		Order("stock asc, name asc").
		// Was 12: a shop with 22 items out or low saw "สต๊อก 12" and never
		// learned about the other ten (15 ก.ย. 2569).
		Limit(500).
		Find(&ingredients).Error
	return ingredients, err
}
