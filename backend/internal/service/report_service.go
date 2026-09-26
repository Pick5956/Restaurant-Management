package service

import (
	"errors"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type ReportService struct {
	repo *repository.ReportRepository
}

func ProvideReportService(repo *repository.ReportRepository) *ReportService {
	return &ReportService{repo: repo}
}

type ManagerReportResponse struct {
	GeneratedAt string `json:"generated_at"`
	Days        int    `json:"days"`
	// From and To are the first and last calendar day covered, YYYY-MM-DD.
	From        string                        `json:"from"`
	To          string                        `json:"to"`
	SalesDays   []repository.ReportSalesDay   `json:"sales_days"`
	MenuMargins []repository.ReportMenuMargin `json:"menu_margins"`
	// TopMenuItems is quantity sold per menu over the same days, most first.
	TopMenuItems []repository.ReportTopMenuItem `json:"top_menu_items"`
	StockRisks   []ManagerReportStockRisk       `json:"stock_risks"`
	Summary      ManagerReportSummary           `json:"summary"`
}

// ManagerReportMaxDays caps a chosen range: a daily chart of more than about a
// quarter stops being readable, and the queries scan every order in it.
const ManagerReportMaxDays = 93

// ErrReportRange is a from/to pair the report cannot cover.
var ErrReportRange = errors.New("ช่วงวันที่ไม่ถูกต้อง")

// ParseManagerReportRange reads a from/to pair of YYYY-MM-DD days in Bangkok
// time. A range that ends after today is cut at today; one that starts after
// it ends, starts in the future, or spans more than ManagerReportMaxDays is
// refused.
func ParseManagerReportRange(from, to string, now time.Time) (time.Time, time.Time, error) {
	loc := now.Location()
	start, err := time.ParseInLocation("2006-01-02", from, loc)
	if err != nil {
		return time.Time{}, time.Time{}, ErrReportRange
	}
	end, err := time.ParseInLocation("2006-01-02", to, loc)
	if err != nil {
		return time.Time{}, time.Time{}, ErrReportRange
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if end.After(today) {
		end = today
	}
	if start.After(end) {
		return time.Time{}, time.Time{}, ErrReportRange
	}
	if int(end.Sub(start).Hours()/24)+1 > ManagerReportMaxDays {
		return time.Time{}, time.Time{}, ErrReportRange
	}
	return start, end, nil
}

type ManagerReportSummary struct {
	Orders int64 `json:"orders"`
	// GrossRevenue is "รายได้รวม": the bills before their discounts, service
	// charge and VAT still in, so GrossRevenue − Discount = Revenue.
	GrossRevenue float64 `json:"gross_revenue"`
	Discount     float64 `json:"discount"`
	// Expenses is "รายจ่ายรวม": the expense ledger over the same days, every
	// category, ingredient purchases included. It is kept apart from Cost (the
	// recipe cost of what sold); subtracting both would count the same pork twice.
	Expenses     float64 `json:"expenses"`
	ExpenseCount int64   `json:"expense_count"`
	// OperatingExpenses is the expenses that are not ingredient purchases, and
	// NetProfit ("กำไรสุทธิ") is Profit minus them.
	OperatingExpenses float64 `json:"operating_expenses"`
	NetProfit         float64 `json:"net_profit"`
	Revenue           float64 `json:"revenue"`
	Cost              float64 `json:"cost"`
	Profit            float64 `json:"profit"`
	Margin            float64 `json:"margin"`
}

type ManagerReportStockRisk struct {
	ID              uint    `json:"id"`
	Name            string  `json:"name"`
	Category        string  `json:"category"`
	Stock           float64 `json:"stock"`
	MinStock        float64 `json:"min_stock"`
	Unit            string  `json:"unit"`
	RestockEstimate float64 `json:"restock_estimate"`
	Status          string  `json:"status"`
}

// managerReportSince is midnight at the start of the first of `days` calendar
// days ending today. It used to be now minus days×24h, so a 14-day report
// opened at 15:11 on 15 Sep started at 15:11 on 1 Sep: fifteen dates, the first
// holding only an afternoon, and every total carried that part-day with it.
func managerReportSince(now time.Time, days int) time.Time {
	start := now.AddDate(0, 0, -(days - 1))
	return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, now.Location())
}

func (s *ReportService) ManagerReport(restaurantID uint, days int) (*ManagerReportResponse, error) {
	if days < 1 {
		days = 7
	}
	if days > 90 {
		days = 90
	}
	now := repository.BangkokNow()
	since := managerReportSince(now, days)
	return s.ManagerReportRange(restaurantID, since, time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()))
}

// ManagerReportRange covers the calendar days from `from` to `to`, both whole
// days. Nothing completed after this moment counts, so today stops at now.
func (s *ReportService) ManagerReportRange(restaurantID uint, from, to time.Time) (*ManagerReportResponse, error) {
	now := repository.BangkokNow()
	since := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, now.Location())
	until := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, 1)
	if until.After(now) {
		until = now
	}
	days := int(time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, now.Location()).Sub(since).Hours()/24) + 1
	sales, err := s.repo.SalesByDayBetween(restaurantID, since, until)
	if err != nil {
		return nil, err
	}
	margins, err := s.repo.MenuMarginsBetween(restaurantID, since, until)
	if err != nil {
		return nil, err
	}
	topItems, err := s.repo.TopMenuItemsByMonth(restaurantID, since, until)
	if err != nil {
		return nil, err
	}
	if topItems == nil {
		topItems = []repository.ReportTopMenuItem{}
	}
	if len(topItems) > 10 {
		topItems = topItems[:10]
	}
	expenseTotal, operatingExpenses, expenseCount, err := s.repo.ExpenseTotal(restaurantID, since, until)
	if err != nil {
		return nil, err
	}
	ingredients, err := s.repo.StockRisks(restaurantID)
	if err != nil {
		return nil, err
	}
	if sales == nil {
		sales = []repository.ReportSalesDay{}
	}
	if margins == nil {
		margins = []repository.ReportMenuMargin{}
	}

	for i := range sales {
		sales[i].Cost = roundMoney(sales[i].Cost)
		sales[i].Profit = roundMoney(sales[i].Profit)
	}

	summary := ManagerReportSummary{}
	for _, day := range sales {
		summary.Orders += day.Orders
		summary.Revenue += day.Revenue
		summary.Discount += day.Discount
		summary.Cost += day.Cost
	}
	summary.Discount = roundMoney(summary.Discount)
	summary.Expenses = roundMoney(expenseTotal)
	summary.ExpenseCount = expenseCount
	summary.GrossRevenue = roundMoney(summary.Revenue + summary.Discount)
	summary.Cost = roundMoney(summary.Cost)
	summary.Profit = roundMoney(summary.Revenue - summary.Cost)
	if summary.Revenue > 0 {
		summary.Margin = roundMoney(summary.Profit / summary.Revenue * 100)
	}
	summary.OperatingExpenses = roundMoney(operatingExpenses)
	// Net profit is gross profit less the expenses that are not ingredient
	// purchases (the owner's call, 26 ก.ย. 2569, replacing 15 ก.ย.'s revenue −
	// every expense). Ingredients are counted once, as the recipe cost of what
	// sold: taking their purchases off as well counted the same food twice, and
	// revenue − every expense read a month with no purchases written down as
	// 100% profit. Expenses (money out, purchases included) is still its own
	// card. Margin is the share of revenue this net keeps.
	summary.NetProfit = roundMoney(summary.Profit - summary.OperatingExpenses)
	if summary.Revenue > 0 {
		summary.Margin = roundMoney(summary.NetProfit / summary.Revenue * 100)
	} else {
		summary.Margin = 0
	}

	risks := make([]ManagerReportStockRisk, 0, len(ingredients))
	for _, ingredient := range ingredients {
		risks = append(risks, stockRiskFromIngredient(ingredient))
	}

	return &ManagerReportResponse{
		GeneratedAt:  now.Format(time.RFC3339),
		Days:         days,
		From:         since.Format("2006-01-02"),
		To:           to.Format("2006-01-02"),
		SalesDays:    sales,
		MenuMargins:  margins,
		TopMenuItems: topItems,
		StockRisks:   risks,
		Summary:      summary,
	}, nil
}

type SalesByHourResponse struct {
	Date  string                       `json:"date"`
	Hours []repository.ReportSalesHour `json:"hours"`
}

func (s *ReportService) SalesByHour(restaurantID uint, date string) (*SalesByHourResponse, error) {
	loc := repository.BangkokNow().Location()
	day, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return nil, err
	}
	hours, err := s.repo.SalesByHour(restaurantID, day)
	if err != nil {
		return nil, err
	}
	if hours == nil {
		hours = []repository.ReportSalesHour{}
	}
	for i := range hours {
		hours[i].Cost = roundMoney(hours[i].Cost)
		hours[i].Profit = roundMoney(hours[i].Profit)
	}
	return &SalesByHourResponse{Date: date, Hours: hours}, nil
}

type SalesDetailResponse struct {
	Date    string                              `json:"date"`
	Hour    *int                                `json:"hour"`
	Orders  []repository.ReportSalesDetailOrder `json:"orders"`
	Summary repository.ReportSalesDetailSummary `json:"summary"`
	HasMore bool                                `json:"has_more"`
}

const salesDetailLimit = 300

// barWindow turns a clicked bar into its time range. `hour` < 0 means a
// whole-day bar (the day and month views both plot days). Both drill-downs go
// through here so they can never disagree about which window a bar covers.
func barWindow(date string, hour int) (since, until time.Time, hourFilter *int, err error) {
	loc := repository.BangkokNow().Location()
	day, parseErr := time.ParseInLocation("2006-01-02", date, loc)
	if parseErr != nil {
		return time.Time{}, time.Time{}, nil, errors.New("date must be YYYY-MM-DD")
	}
	if hour > 23 {
		return time.Time{}, time.Time{}, nil, errors.New("hour must be between 0 and 23")
	}

	since = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, loc)
	until = since.AddDate(0, 0, 1)
	if hour >= 0 {
		since = since.Add(time.Duration(hour) * time.Hour)
		until = since.Add(time.Hour)
		hourValue := hour
		hourFilter = &hourValue
	}
	return since, until, hourFilter, nil
}

// SalesDetail resolves one chart bar back to its bills.
func (s *ReportService) SalesDetail(restaurantID uint, date string, hour int) (*SalesDetailResponse, error) {
	since, until, hourFilter, err := barWindow(date, hour)
	if err != nil {
		return nil, err
	}

	orders, err := s.repo.SalesDetail(restaurantID, since, until, salesDetailLimit+1)
	if err != nil {
		return nil, err
	}
	if orders == nil {
		orders = []repository.ReportSalesDetailOrder{}
	}
	orders, hasMore := truncateReportRows(orders, salesDetailLimit)

	for i := range orders {
		orders[i].Cost = roundMoney(orders[i].Cost)
		orders[i].Profit = roundMoney(orders[i].Profit)
	}
	summary, err := s.repo.SalesWindowSummary(restaurantID, since, until)
	if err != nil {
		return nil, err
	}
	summary.Revenue = roundMoney(summary.Revenue)
	summary.Cost = roundMoney(summary.Cost)
	summary.Profit = roundMoney(summary.Revenue - summary.Cost)

	return &SalesDetailResponse{Date: date, Hour: hourFilter, Orders: orders, Summary: summary, HasMore: hasMore}, nil
}

func truncateReportRows[T any](rows []T, limit int) ([]T, bool) {
	if limit < 0 || len(rows) <= limit {
		return rows, false
	}
	return rows[:limit], true
}

type TopMenuItemsResponse struct {
	Year  int                            `json:"year"`
	Month int                            `json:"month"`
	Items []repository.ReportTopMenuItem `json:"items"`
}

func (s *ReportService) TopMenuItemsByMonth(restaurantID uint, year, month int) (*TopMenuItemsResponse, error) {
	loc := repository.BangkokNow().Location()
	monthStart := time.Date(year, time.Month(month), 1, 0, 0, 0, 0, loc)
	monthEnd := monthStart.AddDate(0, 1, 0)

	items, err := s.repo.TopMenuItemsByMonth(restaurantID, monthStart, monthEnd)
	if err != nil {
		return nil, err
	}
	if items == nil {
		items = []repository.ReportTopMenuItem{}
	}

	return &TopMenuItemsResponse{
		Year:  year,
		Month: month,
		Items: items,
	}, nil
}

func stockRiskFromIngredient(ingredient entity.Ingredient) ManagerReportStockRisk {
	status := "low"
	if ingredient.Stock <= 0 {
		status = "out"
	}
	category := ""
	if ingredient.Category != nil {
		category = ingredient.Category.Name
	}
	target := ingredient.MinStock * 2
	if target <= 0 {
		target = 1
	}
	return ManagerReportStockRisk{
		ID:              ingredient.ID,
		Name:            ingredient.Name,
		Category:        category,
		Stock:           ingredient.Stock,
		MinStock:        ingredient.MinStock,
		Unit:            ingredient.Unit,
		RestockEstimate: maxFloat(0, target-ingredient.Stock),
		Status:          status,
	}
}
