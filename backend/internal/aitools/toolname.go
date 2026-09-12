// Package aitools holds the neutral layer the AI assistants are built on: the
// read-only tool vocabulary, the data snapshot, the tool calculations, and the
// provider calls. It deliberately imports nothing from the orchestration modes
// (legacy, planner, joyboy) — the dependency only runs the other way — so those
// modes can be added or deleted without this package noticing.
//
// AIToolName is the first thing to move here. Every mode names its capabilities
// with these identifiers, and nothing else depends on, so it is the safe leaf to
// extract first; the service package keeps an alias so its existing references
// compile unchanged while the rest migrates.
package aitools

// AIToolName identifies one read-only capability the assistant can run.
type AIToolName string

const (
	AIToolGetLowestMarginMenu    AIToolName = "get_lowest_margin_menu"
	AIToolGetHighestMarginMenu   AIToolName = "get_highest_margin_menu"
	AIToolGetLowStockIngredients AIToolName = "get_low_stock_ingredients"
	AIToolGetTopSellingMenus     AIToolName = "get_top_selling_menus"
	AIToolGetInventoryValuation  AIToolName = "get_inventory_valuation"
	AIToolGetSalesSummary        AIToolName = "get_sales_summary"
	AIToolGetLowestCostMenu      AIToolName = "get_lowest_cost_menu"
	AIToolGetSalesTrend          AIToolName = "get_sales_trend"
	AIToolGetAverageOrderValue   AIToolName = "get_average_order_value"
	AIToolGetOrderTypeBreakdown  AIToolName = "get_order_type_breakdown"
	AIToolGetMenuRevenueRanking  AIToolName = "get_menu_revenue_ranking"
	AIToolGetPeakPeriods         AIToolName = "get_peak_periods"
	AIToolGetSlowMovingMenus     AIToolName = "get_slow_moving_menus"
	AIToolGetMenuEngineering     AIToolName = "get_menu_engineering"

	AIToolGetIngredientReorderForecast AIToolName = "get_ingredient_reorder_forecast"
	AIToolGetDeadStock                 AIToolName = "get_dead_stock"
	AIToolGetTopCostIngredients        AIToolName = "get_top_cost_ingredients"

	AIToolGetStoreSummary      AIToolName = "get_store_summary"
	AIToolGetSalesForPeriod    AIToolName = "get_sales_for_period"
	AIToolGetBestSalesDay      AIToolName = "get_best_sales_day"
	AIToolGetMostExpensiveMenu AIToolName = "get_most_expensive_menu"
	AIToolGetProfitSummary     AIToolName = "get_profit_summary"

	AIToolSearchSystemDocs AIToolName = "search_system_docs"
	AIToolReadSystemDoc    AIToolName = "read_system_doc"
)
