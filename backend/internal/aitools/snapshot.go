package aitools

import (
	"time"

	"Project-M/internal/repository"
)

// AnalysisWindowDays is the rolling window the read-only tools summarise over.
const AnalysisWindowDays = 30.0

// RollingWindowStart is where "30 วันล่าสุด" begins: midnight of the day 29 days
// before now, so the window is thirty whole calendar days ending today. Every
// tool reads it from here. Until 28 ก.ย. 2569 the snapshot and most tools
// opened at this minute minus 30×24h while the profit, expense and breakeven
// sheets opened at midnight - one answer read 357,943 baht of sales for the
// "30 วันล่าสุด" and the next, on payment methods, 367,098.
func RollingWindowStart(now time.Time) time.Time {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return today.AddDate(0, 0, -(int(AnalysisWindowDays) - 1))
}

// AISnapshot is one read of a restaurant's analysis window: every figure the
// read-only tools work from, computed once so asking for many tools costs one
// database read. It carries repository rows for the raw aggregates and a few
// derived summaries the tools share.
type AISnapshot struct {
	GeneratedAt        string                           `json:"generated_at"`
	SalesDays          []repository.AISalesSummary      `json:"sales_days"`
	TopMenuItems       []repository.AIMenuSummary       `json:"top_menu_items"`
	TopMenusByRevenue  []repository.AIMenuSummary       `json:"top_menus_by_revenue"`
	MostExpensiveMenus []repository.AIMenuPrice         `json:"most_expensive_menus"`
	OrderTypeBreakdown []repository.AIOrderTypeSummary  `json:"order_type_breakdown"`
	MenuMargins        []repository.AIMenuMarginSummary `json:"menu_margins"`
	LowMarginMenus     []repository.AIMenuMarginSummary `json:"low_margin_menus"`
	HighMarginMenus    []repository.AIMenuMarginSummary `json:"high_margin_menus"`
	LowestCostMenus    []repository.AIMenuMarginSummary `json:"lowest_cost_menus"`
	AllMenuMargins     []repository.AIMenuMarginSummary `json:"all_menu_margins"`
	// BillDiscounts is what whole-bill promotions took off in the window; the
	// menu rows above are before it (see AIRepository.BillDiscounts).
	BillDiscounts float64 `json:"bill_discounts"`
	SlowMovingMenus    []repository.AIMenuSummary       `json:"slow_moving_menus"`
	PeakWeekdays       []repository.AIPeriodSummary     `json:"peak_weekdays"`
	PeakHours          []repository.AIPeriodSummary     `json:"peak_hours"`
	IngredientUsage    []repository.AIIngredientUsage   `json:"ingredient_usage"`
	AnalysisReadiness  AIAnalysisReadiness              `json:"analysis_readiness"`
	InventorySummary   AIInventorySummary               `json:"inventory_summary"`
	StockRisks         []AIStockRisk                    `json:"stock_risks"`
}

type AIAnalysisReadiness struct {
	HasSales                  bool     `json:"has_sales"`
	SalesItems                int64    `json:"sales_items"`
	MarginItems               int64    `json:"margin_items"`
	CostedMarginItems         int64    `json:"costed_margin_items"`
	SoldMenus                 int64    `json:"sold_menus"`
	SoldMenusWithRecipes      int64    `json:"sold_menus_with_recipes"`
	MarginCostCoveragePercent float64  `json:"margin_cost_coverage_percent"`
	MenuRecipeCoveragePercent float64  `json:"menu_recipe_coverage_percent"`
	CanAnalyzeRevenue         bool     `json:"can_analyze_revenue"`
	CanAnalyzeMargin          bool     `json:"can_analyze_margin"`
	CanRecommendActions       bool     `json:"can_recommend_business_actions"`
	Warnings                  []string `json:"warnings"`
}

type AIInventorySummary struct {
	TotalItems int     `json:"total_items"`
	LowItems   int     `json:"low_items"`
	OutItems   int     `json:"out_items"`
	Value      float64 `json:"value"`
}

type AIStockRisk struct {
	Name            string  `json:"name"`
	Category        string  `json:"category"`
	Stock           float64 `json:"stock"`
	MinStock        float64 `json:"min_stock"`
	Unit            string  `json:"unit"`
	StorageType     string  `json:"storage_type"`
	CostPerUnit     float64 `json:"cost_per_unit"`
	RestockEstimate float64 `json:"restock_estimate"`
	Status          string  `json:"status"`
}
