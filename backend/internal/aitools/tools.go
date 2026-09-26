package aitools

import (
	"errors"
	"fmt"
	"regexp"
	"Project-M/internal/repository"
	"sort"
	"strconv"
	"strings"
	"time"
)

func RequestedTopSellingLimit(question string) (int, bool) {
	normalized := strings.ToLower(strings.TrimSpace(question))
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(\d+)\s*(?:อันดับ|รายการ|เมนู)`),
		// A rank written after the word ("อันดับ 1", "อันดับที่ 1"). Ranks >= 2 are
		// already claimed by the structured rank query upstream, so in practice this
		// resolves the rank-1 case that otherwise fell through to the default of 5.
		regexp.MustCompile(`อันดับ(?:ที่)?\s*(\d+)`),
		regexp.MustCompile(`(?:top|first)\s*(\d+)`),
	}
	for _, pattern := range patterns {
		match := pattern.FindStringSubmatch(normalized)
		if len(match) < 2 {
			continue
		}
		limit, err := strconv.Atoi(match[1])
		if err == nil && limit > 0 {
			return limit, true
		}
	}
	return 0, false
}

func ExecuteReadOnlyTool(tool AIToolName, snapshot AISnapshot, question ...string) (AIToolResult, error) {
	switch tool {
	case AIToolGetLowestMarginMenu:
		if !snapshot.AnalysisReadiness.CanAnalyzeMargin {
			return AIToolResult{Tool: tool}, nil
		}
		if len(snapshot.LowMarginMenus) == 0 {
			return AIToolResult{Tool: tool}, nil
		}
		menu := snapshot.LowMarginMenus[0]
		return AIToolResult{Tool: tool, LowestMarginMenu: &menu}, nil
	case AIToolGetHighestMarginMenu:
		if !snapshot.AnalysisReadiness.CanAnalyzeMargin {
			return AIToolResult{Tool: tool}, nil
		}
		if len(snapshot.HighMarginMenus) == 0 {
			return AIToolResult{Tool: tool}, nil
		}
		menu := snapshot.HighMarginMenus[0]
		return AIToolResult{Tool: tool, HighestMarginMenu: &menu}, nil
	case AIToolGetLowStockIngredients:
		// The summary rides along because the risk list is capped at twelve and
		// the summary's counts are not — the sheet needs the true total.
		summary := snapshot.InventorySummary
		return AIToolResult{Tool: tool, LowStockIngredients: snapshot.StockRisks, InventoryValuation: &summary}, nil
	case AIToolGetTopSellingMenus:
		menus := snapshot.TopMenuItems
		limit := 5
		if len(question) > 0 {
			if requested, ok := RequestedTopSellingLimit(question[0]); ok {
				limit = requested
			}
		}
		if limit < len(menus) {
			menus = menus[:limit]
		}
		return AIToolResult{Tool: tool, TopSellingMenus: menus}, nil
	case AIToolGetInventoryValuation:
		return AIToolResult{Tool: tool, InventoryValuation: &snapshot.InventorySummary}, nil
	case AIToolGetSalesSummary:
		summary := AISalesSummary{Days: len(snapshot.SalesDays)}
		for _, day := range snapshot.SalesDays {
			summary.Orders += day.Orders
			summary.Revenue += day.Revenue
		}
		return AIToolResult{Tool: tool, SalesSummary: &summary}, nil
	case AIToolGetLowestCostMenu:
		if !snapshot.AnalysisReadiness.CanAnalyzeMargin {
			return AIToolResult{Tool: tool}, nil
		}
		if len(snapshot.LowestCostMenus) == 0 {
			return AIToolResult{Tool: tool}, nil
		}
		menu := snapshot.LowestCostMenus[0]
		return AIToolResult{Tool: tool, LowestCostMenu: &menu}, nil
	case AIToolGetSalesTrend:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		trend := ComputeSalesTrendAsOf(snapshot.SalesDays, DateKeyOf(snapshot.GeneratedAt))
		return AIToolResult{Tool: tool, SalesTrend: &trend}, nil
	case AIToolGetBestSalesDay:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		// The snapshot window opens at this minute thirty days ago (see
		// snapshot_build.go), so its first date and today are both partial.
		now := repository.BangkokNow()
		best := ComputeBestSalesDayAsOf(snapshot.SalesDays, now.Format("2006-01-02"),
			now.AddDate(0, 0, -int(AnalysisWindowDays)).Format("2006-01-02"))
		return AIToolResult{Tool: tool, BestSalesDay: &best}, nil
	case AIToolGetAverageOrderValue:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		aov := AIAverageOrderValue{Days: len(snapshot.SalesDays)}
		for _, day := range snapshot.SalesDays {
			aov.Orders += day.Orders
			aov.Revenue += day.Revenue
		}
		if aov.Orders > 0 {
			aov.AOV = aov.Revenue / float64(aov.Orders)
		}
		return AIToolResult{Tool: tool, AverageOrderValue: &aov}, nil
	case AIToolGetOrderTypeBreakdown:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		return AIToolResult{Tool: tool, OrderTypeBreakdown: snapshot.OrderTypeBreakdown}, nil
	case AIToolGetMenuRevenueRanking:
		menus := snapshot.TopMenusByRevenue
		limit := 5
		if len(question) > 0 {
			if requested, ok := RequestedTopSellingLimit(question[0]); ok {
				limit = requested
			}
		}
		if limit < len(menus) {
			menus = menus[:limit]
		}
		return AIToolResult{Tool: tool, MenuRevenueRanking: menus}, nil
	case AIToolGetPeakPeriods:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		peak := AIPeakPeriods{}
		if len(snapshot.PeakWeekdays) > 0 {
			peak.TopWeekday = snapshot.PeakWeekdays[0].Period
			peak.TopWeekdayOrders = snapshot.PeakWeekdays[0].Orders
			peak.HasData = true
		}
		if len(snapshot.PeakHours) > 0 {
			peak.TopHour = snapshot.PeakHours[0].Period
			peak.TopHourOrders = snapshot.PeakHours[0].Orders
			peak.HasData = true
		}
		return AIToolResult{Tool: tool, PeakPeriods: &peak}, nil
	case AIToolGetSlowMovingMenus:
		return AIToolResult{Tool: tool, SlowMovingMenus: snapshot.SlowMovingMenus}, nil
	case AIToolGetMenuEngineering:
		if !snapshot.AnalysisReadiness.CanAnalyzeMargin {
			return AIToolResult{Tool: tool}, nil
		}
		eng := ComputeMenuEngineering(snapshot.AllMenuMargins)
		return AIToolResult{Tool: tool, MenuEngineering: &eng}, nil
	case AIToolGetIngredientReorderForecast:
		return AIToolResult{Tool: tool, ReorderForecast: ComputeReorderForecast(snapshot.IngredientUsage)}, nil
	case AIToolGetDeadStock:
		return AIToolResult{Tool: tool, DeadStock: ComputeDeadStock(snapshot.IngredientUsage)}, nil
	case AIToolGetTopCostIngredients:
		return AIToolResult{Tool: tool, TopCostIngredients: ComputeTopCostIngredients(snapshot.IngredientUsage)}, nil
	case AIToolGetStoreSummary:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		// The summary counts, not the risk list: that list is cut to twelve
		// rows for the sheet, so a shop with twenty low items read "12". The
		// list still wins when it is longer — a snapshot built by hand with
		// risks and no summary.
		lowStock := snapshot.InventorySummary.LowItems + snapshot.InventorySummary.OutItems
		if lowStock < len(snapshot.StockRisks) {
			lowStock = len(snapshot.StockRisks)
		}
		sum := AIStoreSummary{
			Days:          len(snapshot.SalesDays),
			LowStockCount: lowStock,
			MarginReady:   snapshot.AnalysisReadiness.CanAnalyzeMargin,
		}
		for _, day := range snapshot.SalesDays {
			sum.Orders += day.Orders
			sum.Revenue += day.Revenue
		}
		trend := ComputeSalesTrendAsOf(snapshot.SalesDays, DateKeyOf(snapshot.GeneratedAt))
		sum.Trend = &trend
		top := snapshot.TopMenuItems
		if len(top) > 3 {
			top = top[:3]
		}
		sum.TopMenus = top
		if snapshot.AnalysisReadiness.CanAnalyzeMargin && len(snapshot.HighMarginMenus) > 0 {
			best := snapshot.HighMarginMenus[0]
			sum.BestMargin = &best
		}
		return AIToolResult{Tool: tool, StoreSummary: &sum}, nil
	case AIToolGetSalesForPeriod:
		if !snapshot.AnalysisReadiness.CanAnalyzeRevenue {
			return AIToolResult{Tool: tool}, nil
		}
		q := ""
		if len(question) > 0 {
			q = question[0]
		}
		period := ComputeSalesForPeriod(snapshot.SalesDays, snapshot.GeneratedAt, q)
		return AIToolResult{Tool: tool, SalesForPeriod: &period}, nil
	case AIToolGetMostExpensiveMenu:
		// Answer the question as asked: "เมนูไหนแพงสุด" (singular) returns just the
		// top item; a ranking is only listed when the user asks for a count
		// ("5 อันดับเมนูแพงสุด"), mirroring get_top_selling_menus.
		menus := snapshot.MostExpensiveMenus
		limit := 1
		if len(question) > 0 {
			if requested, ok := RequestedTopSellingLimit(question[0]); ok && requested > 0 {
				limit = requested
			}
		}
		if limit < len(menus) {
			menus = menus[:limit]
		}
		return AIToolResult{Tool: tool, MostExpensiveMenus: menus}, nil
	case AIToolGetProfitSummary:
		// Store profit is a margin question: without costed recipes there is no
		// cost to subtract, so it is gated on the same readiness flag as the
		// per-menu margin tools rather than answered as a bare revenue figure.
		if !snapshot.AnalysisReadiness.CanAnalyzeMargin {
			return AIToolResult{Tool: tool}, nil
		}
		profit := ComputeProfitSummary(snapshot)
		return AIToolResult{Tool: tool, ProfitSummary: &profit}, nil
	default:
		return AIToolResult{}, errors.New("unsupported AI tool")
	}
}

// ComputeProfitSummary sums the per-menu margins the snapshot already holds into
// one store-level revenue / cost / profit. Summing the same rows the margin
// tools report keeps the store total reconcilable with them; a separate
// aggregate query could drift from the per-menu numbers the owner also sees.
func ComputeProfitSummary(snapshot AISnapshot) AIProfitSummary {
	summary := AIProfitSummary{
		Days:            len(snapshot.SalesDays),
		CoveragePercent: snapshot.AnalysisReadiness.MarginCostCoveragePercent,
	}
	for _, menu := range snapshot.AllMenuMargins {
		summary.Revenue += menu.Revenue
		summary.Cost += menu.Cost
		summary.Profit += menu.Profit
	}
	if summary.Revenue > 0 {
		summary.Margin = summary.Profit / summary.Revenue * 100
	}
	return summary
}

// ComputeSalesTrend splits the recent sales days into the last 7 days and the
// prior 7 days (relative to the newest recorded day) and compares revenue.
// DateKeyOf is the YYYY-MM-DD part of a snapshot's generated_at (RFC 3339 in
// Bangkok), "" when it is not one — a key that matches no row.
func DateKeyOf(generatedAt string) string {
	if len(generatedAt) < 10 {
		return ""
	}
	return generatedAt[:10]
}

// ComputeSalesTrendAsOf is ComputeSalesTrend with today left out. The shop is
// still open, so today's row is a fraction of a day; counted as the newest of
// the "7 วันล่าสุด" it read as a drop of one seventh at every morning question
// (found 23 ก.ย. 2569, the same flaw the forecast had). Callers pass the
// Bangkok date key; a key that matches no row changes nothing.
func ComputeSalesTrendAsOf(days []repository.AISalesSummary, today string) AISalesTrend {
	finished, _ := FinishedDays(days, "", today)
	return ComputeSalesTrend(finished)
}

func ComputeSalesTrend(days []repository.AISalesSummary) AISalesTrend {
	var trend AISalesTrend
	if len(days) == 0 {
		return trend
	}
	// Find the newest order_date as the reference "today" (data-relative).
	var ref time.Time
	parsed := make([]struct {
		date    time.Time
		revenue float64
		orders  int64
	}, 0, len(days))
	for _, d := range days {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(d.OrderDate))
		if err != nil {
			continue
		}
		parsed = append(parsed, struct {
			date    time.Time
			revenue float64
			orders  int64
		}{t, d.Revenue, d.Orders})
		if t.After(ref) {
			ref = t
		}
	}
	trend.RecentEnd = ref
	recentStart := ref.AddDate(0, 0, -6) // last 7 days inclusive of ref
	priorStart := ref.AddDate(0, 0, -13) // the 7 days before that
	for _, p := range parsed {
		if !p.date.Before(recentStart) {
			trend.RecentRevenue += p.revenue
			trend.RecentOrders += p.orders
			trend.RecentDays++
		} else if !p.date.Before(priorStart) {
			trend.PriorRevenue += p.revenue
			trend.PriorOrders += p.orders
		}
	}
	if trend.PriorRevenue > 0 {
		trend.HasPrior = true
		trend.RevenueChangePct = (trend.RecentRevenue - trend.PriorRevenue) / trend.PriorRevenue * 100
	}
	return trend
}

// ComputeSalesForPeriod sums sales for the period named in the question
// (today / yesterday / last 7 days / previous week), relative to the snapshot's
// generation date. All dates are normalised to UTC midnight so the comparison is
// timezone-safe.
func ComputeSalesForPeriod(days []repository.AISalesSummary, generatedAt string, question string) AISalesPeriod {
	toDay := func(t time.Time) time.Time {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}

	type dayRow struct {
		date    time.Time
		revenue float64
		orders  int64
	}
	rows := make([]dayRow, 0, len(days))
	var newest time.Time
	for _, d := range days {
		t, err := time.Parse("2006-01-02", strings.TrimSpace(d.OrderDate))
		if err != nil {
			continue
		}
		day := toDay(t)
		rows = append(rows, dayRow{day, d.Revenue, d.Orders})
		if day.After(newest) {
			newest = day
		}
	}

	// Reference "today" = snapshot generation date, else newest recorded day.
	ref := newest
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(generatedAt)); err == nil {
		ref = toDay(t)
	}

	normalized := strings.ToLower(strings.TrimSpace(question))
	label := "วันนี้"
	start, end := ref, ref
	switch {
	case strings.Contains(normalized, "เมื่อวาน") || strings.Contains(normalized, "yesterday"):
		label, start, end = "เมื่อวาน", ref.AddDate(0, 0, -1), ref.AddDate(0, 0, -1)
	case strings.Contains(normalized, "สัปดาห์ก่อน") || strings.Contains(normalized, "อาทิตย์ก่อน") || strings.Contains(normalized, "last week"):
		label, start, end = "สัปดาห์ก่อน", ref.AddDate(0, 0, -13), ref.AddDate(0, 0, -7)
	case strings.Contains(normalized, "สัปดาห์") || strings.Contains(normalized, "อาทิตย์") ||
		strings.Contains(normalized, "7 วัน") || strings.Contains(normalized, "week"):
		label, start, end = "7 วันล่าสุด", ref.AddDate(0, 0, -6), ref
	}

	res := AISalesPeriod{Label: label}
	var latest time.Time
	for _, r := range rows {
		if r.orders > 0 && r.date.After(latest) {
			latest = r.date
		}
		if !r.date.Before(start) && !r.date.After(end) {
			res.Revenue += r.revenue
			res.Orders += r.orders
			res.Days++
		}
	}
	if !latest.IsZero() {
		res.LatestDate = latest.Format("2006-01-02")
	}
	return res
}

// ComputeMenuEngineering classifies each menu against the Median popularity
// (quantity) and Median margin into Star / Plowhorse / Puzzle / Dog quadrants.
func ComputeMenuEngineering(menus []repository.AIMenuMarginSummary) AIMenuEngineering {
	var eng AIMenuEngineering
	if len(menus) == 0 {
		return eng
	}
	quantities := make([]float64, len(menus))
	margins := make([]float64, len(menus))
	for i, m := range menus {
		quantities[i] = float64(m.Quantity)
		margins[i] = m.Margin
	}
	medQty := Median(quantities)
	medMargin := Median(margins)
	for _, m := range menus {
		highPop := float64(m.Quantity) >= medQty
		highMargin := m.Margin >= medMargin
		switch {
		case highPop && highMargin:
			eng.Stars = append(eng.Stars, m.MenuName)
		case highPop && !highMargin:
			eng.Plowhorses = append(eng.Plowhorses, m.MenuName)
		case !highPop && highMargin:
			eng.Puzzles = append(eng.Puzzles, m.MenuName)
		default:
			eng.Dogs = append(eng.Dogs, m.MenuName)
		}
	}
	return eng
}

func Median(values []float64) float64 {
	n := len(values)
	if n == 0 {
		return 0
	}
	sorted := make([]float64, n)
	copy(sorted, values)
	sort.Float64s(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

// ComputeReorderForecast estimates days-until-out from each ingredient's usage
// over the window; ingredients with no usage are excluded (cannot forecast).
func ComputeReorderForecast(usage []repository.AIIngredientUsage) []AIReorderItem {
	items := make([]AIReorderItem, 0)
	for _, u := range usage {
		if u.Used <= 0 {
			continue
		}
		dailyUse := u.Used / AnalysisWindowDays
		daysLeft := 0.0
		if dailyUse > 0 {
			daysLeft = u.Stock / dailyUse
		}
		items = append(items, AIReorderItem{Name: u.Name, Unit: u.Unit, Stock: u.Stock, DailyUse: dailyUse, DaysLeft: daysLeft})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].DaysLeft < items[j].DaysLeft })
	if len(items) > 8 {
		items = items[:8]
	}
	return items
}

// ComputeDeadStock finds ingredients that hold stock but were not used at all in
// the window (cash tied up / spoilage risk), ranked by tied-up value.
func ComputeDeadStock(usage []repository.AIIngredientUsage) []AIDeadStockItem {
	items := make([]AIDeadStockItem, 0)
	for _, u := range usage {
		if u.Stock > 0 && u.Used == 0 {
			items = append(items, AIDeadStockItem{Name: u.Name, Unit: u.Unit, Stock: u.Stock, Value: u.Stock * u.CostPerUnit})
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Value > items[j].Value })
	if len(items) > 8 {
		items = items[:8]
	}
	return items
}

// ComputeTopCostIngredients ranks ingredients by total cost consumed in the window.
func ComputeTopCostIngredients(usage []repository.AIIngredientUsage) []AICostIngredient {
	items := make([]AICostIngredient, 0)
	for _, u := range usage {
		if u.Cost > 0 {
			items = append(items, AICostIngredient{Name: u.Name, Unit: u.Unit, Cost: u.Cost, Used: u.Used})
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].Cost > items[j].Cost })
	if len(items) > 8 {
		items = items[:8]
	}
	return items
}

func ThaiWeekdayName(dow int) string {
	names := map[int]string{0: "อาทิตย์", 1: "จันทร์", 2: "อังคาร", 3: "พุธ", 4: "พฤหัสบดี", 5: "ศุกร์", 6: "เสาร์"}
	if n, ok := names[dow]; ok {
		return "วัน" + n
	}
	return fmt.Sprintf("วัน (%d)", dow)
}
