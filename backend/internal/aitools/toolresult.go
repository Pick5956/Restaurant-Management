package aitools

import (
	"time"

	"Project-M/internal/repository"
)

// AIToolResult is what one read-only tool produced. Only the field for the tool
// that ran is populated; the rest stay nil. The renderers downstream read the
// one field that matches Tool.
type AIToolResult struct {
	Tool                AIToolName
	LowestMarginMenu    *repository.AIMenuMarginSummary
	HighestMarginMenu   *repository.AIMenuMarginSummary
	LowStockIngredients []AIStockRisk
	TopSellingMenus     []repository.AIMenuSummary
	InventoryValuation  *AIInventorySummary
	SalesSummary        *AISalesSummary
	LowestCostMenu      *repository.AIMenuMarginSummary
	SalesTrend          *AISalesTrend
	AverageOrderValue   *AIAverageOrderValue
	OrderTypeBreakdown  []repository.AIOrderTypeSummary
	MenuRevenueRanking  []repository.AIMenuSummary
	PeakPeriods         *AIPeakPeriods
	BestSalesDay        *AIBestSalesDay
	SlowMovingMenus     []repository.AIMenuSummary
	MenuEngineering     *AIMenuEngineering
	ReorderForecast     []AIReorderItem
	DeadStock           []AIDeadStockItem
	TopCostIngredients  []AICostIngredient
	StoreSummary        *AIStoreSummary
	SalesForPeriod      *AISalesPeriod
	MostExpensiveMenus  []repository.AIMenuPrice
	ProfitSummary       *AIProfitSummary
}

// AIProfitSummary is the store-level revenue / cost / profit over the analysis
// window. It is summed from the per-menu margins the snapshot already holds, so
// it always agrees with the margin tools rather than answering from a second
// query that might drift. CoveragePercent carries how much of revenue has a
// costed recipe behind it: below 100 the cost — and therefore the profit — is a
// floor, because uncosted menus contribute revenue with zero cost.
type AIProfitSummary struct {
	Days            int
	Revenue         float64
	Cost            float64
	Profit          float64
	Margin          float64
	CoveragePercent float64
}

// AIStoreSummary is a backend-composed overview so open-ended "summarize the
// store" questions get a deterministic answer instead of a free-form one.
type AIStoreSummary struct {
	Days          int
	Revenue       float64
	Orders        int64
	Trend         *AISalesTrend
	TopMenus      []repository.AIMenuSummary
	BestMargin    *repository.AIMenuMarginSummary
	LowStockCount int
	MarginReady   bool
}

// AISalesPeriod holds sales scoped to a specific period the user named
// (today / yesterday / this week / last week).
type AISalesPeriod struct {
	Label   string
	Days    int
	Revenue float64
	Orders  int64
	// LatestDate is the newest day in the snapshot that actually has sales
	// ("2006-01-02"). Reporting it turns a bare "no orders today" into something
	// the user can act on, since it says where the data does reach.
	LatestDate string
}

type AIReorderItem struct {
	Name     string
	Unit     string
	Stock    float64
	DailyUse float64
	DaysLeft float64
}

type AIDeadStockItem struct {
	Name  string
	Unit  string
	Stock float64
	Value float64
}

type AICostIngredient struct {
	Name string
	Unit string
	Cost float64
	Used float64
}

type AIPeakPeriods struct {
	TopWeekday       int // 0..6 (Sun..Sat)
	TopWeekdayOrders int64
	TopHour          int // 0..23
	TopHourOrders    int64
	HasData          bool
}

// AIMenuEngineering classifies menus by popularity (quantity) and margin into
// the classic four quadrants.
type AIMenuEngineering struct {
	Stars      []string // high popularity, high margin
	Plowhorses []string // high popularity, low margin
	Puzzles    []string // low popularity, high margin
	Dogs       []string // low popularity, low margin
}

type AIAverageOrderValue struct {
	Orders  int64
	Revenue float64
	AOV     float64
	Days    int
}

type AISalesSummary struct {
	Days    int
	Orders  int64
	Revenue float64
}

type AISalesTrend struct {
	RecentDays       int
	RecentRevenue    float64
	RecentOrders     int64
	PriorRevenue     float64
	PriorOrders      int64
	RevenueChangePct float64 // percentage change vs the prior 7-day period
	HasPrior         bool    // false when there is no prior-period data to compare against
	// RecentEnd is the newest day counted (UTC midnight); the recent window is
	// the six days before it and it, the prior window the seven before those.
	RecentEnd time.Time
}
