package service

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"Project-M/internal/repository"
)

// General chart payloads for the assistant.
//
// This is the "bounded-flexible" charting the owner asked for: the user says
// what to compare ("เทียบยอดเดือนนี้กับเดือนที่แล้ว") and the model's freedom is
// only to pick the tool and pull out the operands — it never lays out a chart or
// invents a number. The figures here are the same ones the answer text states
// (computed in Go), and the frontend draws them. A wrong chart reads as more
// authoritative than wrong text, so the numbers stay deterministic on purpose.
//
// AIChartData is deliberately small and generic (a kind, a title, labelled
// categories, one or more series) so a new chart type is a new builder, not a
// new response field.

// AIChartKind is the shape the frontend should draw.
type AIChartKind string

const (
	AIChartBar  AIChartKind = "bar"
	AIChartLine AIChartKind = "line"
	AIChartPie  AIChartKind = "pie"
	// AIChartStockList is not a chart: a list of ingredients with what is left
	// against the minimum. Of things that ran out every bar is 0, so the bar
	// chart it replaced drew nothing but labels (เจ้าของทัก 20 ก.ย. 2569).
	AIChartStockList AIChartKind = "stocklist"
)

// AIChartData is a chart-ready payload. Categories are the x-axis labels; each
// series carries one value per category, in the same order.
//
// Everything after Series is a hint the drawing may use and may ignore: which
// bars to emphasise, which to fade and why, a reference line, a per-category
// status or note. None of it carries a number the answer text does not.
type AIChartData struct {
	Kind       AIChartKind     `json:"kind"`
	Title      string          `json:"title"`
	Unit       string          `json:"unit,omitempty"` // e.g. "บาท" — for axis / tooltip
	Categories []string        `json:"categories"`
	// Units is one unit per category, for a list whose rows do not share one
	// (มล. next to กรัม). Charts leave it empty and use Unit.
	Units []string `json:"units,omitempty"`
	Series     []AIChartSeries `json:"series"`

	// Layout "horizontal" lays bars left→right with the category on the left —
	// for rankings, where Thai names are too long to stand under a bar.
	Layout string `json:"layout,omitempty"`
	// Compare marks a two-category bar chart as "this against that": the
	// drawing gives the two bars two colours instead of one.
	Compare bool `json:"compare,omitempty"`
	// Stacked stacks the series inside each category (parts of one whole).
	Stacked bool `json:"stacked,omitempty"`
	// Share adds each value's share of the total to its label.
	Share bool `json:"share,omitempty"`
	// Highlight is the categories drawn at full strength; the rest fade. Empty
	// means all at full strength.
	Highlight []int `json:"highlight,omitempty"`
	// Muted is the categories drawn faded because their figure is not the same
	// kind as the others (a month with no expenses recorded), with the reason.
	Muted      []int  `json:"muted,omitempty"`
	MutedLabel string `json:"muted_label,omitempty"`
	// Status colours a category by state instead of by series: "critical",
	// "warning", "good". Aligned with Categories; "" for none.
	Status []string `json:"status,omitempty"`
	// Notes is a short remark under a category ("ถึงวันนี้"). Aligned; "" for none.
	Notes []string `json:"notes,omitempty"`
	// Reference is a dashed line at a value the reader compares against — the
	// minimum on a stock chart, the period mean on an average.
	Reference *AIChartReference `json:"reference,omitempty"`
}

// AIChartReference is a labelled line at one value on the value axis.
type AIChartReference struct {
	Value float64 `json:"value"`
	Label string  `json:"label"`
}

// AIChartSeries is one line/set of bars. Values line up with Categories by index.
// A series with Role "tooltip" is not drawn; it rides along so the hover can
// show a breakdown (revenue, cost, expenses under a net-profit bar).
type AIChartSeries struct {
	Name   string    `json:"name,omitempty"`
	Values []float64 `json:"values"`
	Role   string    `json:"role,omitempty"`
	// Tone is a 1-based slot in the drawing's categorical palette, set when
	// the series' colour carries meaning; 0 lets the drawing pick by order.
	Tone int `json:"tone,omitempty"`
}

// chartHasAtLeast reports whether a chart has enough categories to be worth
// drawing: a single figure is a sentence, not a picture.
func chartHasAtLeast(n int, categories []string) bool { return len(categories) >= n }

// buildSalesComparisonChart renders a two-period sales comparison as a bar chart:
// one bar per period, revenue on the value axis. The labels and numbers match
// joyboySalesComparisonBody's fact sheet, so the picture and the words agree.
func buildSalesComparisonChart(labelA string, revenueA float64, labelB string, revenueB float64) *AIChartData {
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      "เทียบยอดขาย",
		Unit:       "บาท",
		Categories: []string{labelA, labelB},
		Series:     []AIChartSeries{{Name: "ยอดขาย", Values: []float64{revenueA, revenueB}}},
		Compare:    true,
	}
}

// shortDayMonth turns an ISO date ("2026-08-27") into a compact "27/8" axis label.
func shortDayMonth(iso string) string {
	parts := strings.Split(strings.TrimSpace(iso), "-")
	if len(parts) != 3 {
		return iso
	}
	day := strings.TrimLeft(parts[2], "0")
	month := strings.TrimLeft(parts[1], "0")
	if day == "" {
		day = "0"
	}
	if month == "" {
		month = "0"
	}
	return day + "/" + month
}

// buildDailySalesLineChart renders revenue per day over the recent window as a
// line — the shape a "how are sales trending" question wants to see. It draws
// from the same daily figures the trend tool reports, so the picture and the
// answer agree. nil when there are too few days to make a line.
func buildDailySalesLineChart(days []repository.AISalesSummary) *AIChartData {
	type point struct {
		date    string
		revenue float64
	}
	points := make([]point, 0, len(days))
	for _, d := range days {
		iso := strings.TrimSpace(d.OrderDate)
		if iso == "" {
			continue
		}
		points = append(points, point{iso, d.Revenue})
	}
	if len(points) < 2 {
		return nil
	}
	// ISO dates sort correctly as plain strings.
	sort.SliceStable(points, func(i, j int) bool { return points[i].date < points[j].date })
	const maxDays = 30
	if len(points) > maxDays {
		points = points[len(points)-maxDays:]
	}
	categories := make([]string, len(points))
	values := make([]float64, len(points))
	for i, p := range points {
		categories[i] = shortDayMonth(p.date)
		values[i] = p.revenue
	}
	return &AIChartData{
		Kind:       AIChartLine,
		Title:      "ยอดขายรายวัน",
		Unit:       "บาท",
		Categories: categories,
		Series:     []AIChartSeries{{Name: "ยอดขาย", Values: values}},
		Highlight:  []int{len(categories) - 1},
	}
}

// buildMenuRankingChart draws a ranking of menus as horizontal bars — Thai
// names are too long to stand under a vertical bar on a phone — with the top
// entry at full strength. Whether to draw it is a question of shape, not of
// wording: three or more entries with a figure make a ranking worth seeing.
// Capped so the labels stay readable. nil when there is too little to rank.
func buildMenuRankingChart(title, unit string, menus []repository.AIMenuSummary, byRevenue bool) *AIChartData {
	const limit = 6
	categories := make([]string, 0, limit)
	values := make([]float64, 0, limit)
	for _, m := range menus {
		v := float64(m.Quantity)
		if byRevenue {
			v = m.Revenue
		}
		if v <= 0 {
			continue
		}
		categories = append(categories, m.MenuName)
		values = append(values, v)
		if len(categories) == limit {
			break
		}
	}
	if !chartHasAtLeast(3, categories) {
		return nil
	}
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      title,
		Unit:       unit,
		Categories: categories,
		Series:     []AIChartSeries{{Name: title, Values: values}},
		Layout:     "horizontal",
		Highlight:  []int{0},
	}
}

// buildTopMenusBarChart keeps its old name for the best-sellers-by-quantity case.
func buildTopMenusBarChart(menus []repository.AIMenuSummary) *AIChartData {
	return buildMenuRankingChart("เมนูขายดี", "รายการ", menus, false)
}

// buildPeakHoursChart draws bills per hour of the day, in clock order, with the
// busiest hour at full strength — the two peaks and the quiet afternoon that a
// "busiest hour is 13:00" sentence cannot show. nil under three hours with bills.
func buildPeakHoursChart(rows []repository.AIPeriodSummary) *AIChartData {
	sorted := make([]repository.AIPeriodSummary, 0, len(rows))
	for _, r := range rows {
		if r.Orders > 0 {
			sorted = append(sorted, r)
		}
	}
	if len(sorted) < 3 {
		return nil
	}
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Period < sorted[j].Period })
	categories := make([]string, len(sorted))
	values := make([]float64, len(sorted))
	best := 0
	for i, r := range sorted {
		categories[i] = fmt.Sprintf("%02d", r.Period)
		values[i] = float64(r.Orders)
		if r.Orders > sorted[best].Orders {
			best = i
		}
	}
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      "บิลตามช่วงเวลา",
		Unit:       "บิล",
		Categories: categories,
		Series:     []AIChartSeries{{Name: "บิล", Values: values}},
		Highlight:  []int{best},
	}
}

// buildPeakWeekdayChart draws bills per weekday, Monday first, busiest day at
// full strength. nil unless every day of the week is represented.
func buildPeakWeekdayChart(rows []repository.AIPeriodSummary) *AIChartData {
	byDay := map[int]int64{}
	for _, r := range rows {
		byDay[r.Period] = r.Orders
	}
	order := []int{1, 2, 3, 4, 5, 6, 0} // Mon..Sun, the calendar the owner reads
	short := map[int]string{0: "อา", 1: "จ", 2: "อ", 3: "พ", 4: "พฤ", 5: "ศ", 6: "ส"}
	categories := make([]string, 0, 7)
	values := make([]float64, 0, 7)
	best, bestOrders := 0, int64(-1)
	for i, day := range order {
		orders, ok := byDay[day]
		if !ok {
			return nil
		}
		categories = append(categories, short[day])
		values = append(values, float64(orders))
		if orders > bestOrders {
			best, bestOrders = i, orders
		}
	}
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      "บิลตามวันในสัปดาห์",
		Unit:       "บิล",
		Categories: categories,
		Series:     []AIChartSeries{{Name: "บิล", Values: values}},
		Highlight:  []int{best},
	}
}

// buildStockVsMinChart lists what is running low: what is left, the minimum it
// is measured against, and how much to buy — one row per ingredient, out first
// and the emptiest next. It used to be a horizontal bar chart of stock as a
// percent of the minimum; of things that ran out every bar is 0%, so the owner
// saw an empty frame with seven labels (20 ก.ย. 2569). A list also reads at one
// row, where a chart needed three.
func buildStockVsMinChart(risks []AIStockRisk) *AIChartData {
	const limit = 12
	rows := make([]AIStockRisk, 0, len(risks))
	for _, r := range risks {
		if r.MinStock <= 0 {
			continue
		}
		rows = append(rows, r)
	}
	// Out of stock first, then whoever has the least of their own minimum.
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].Stock/rows[i].MinStock < rows[j].Stock/rows[j].MinStock
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	if len(rows) == 0 {
		return nil
	}
	categories := make([]string, 0, len(rows))
	units := make([]string, 0, len(rows))
	stock := make([]float64, 0, len(rows))
	minimum := make([]float64, 0, len(rows))
	restock := make([]float64, 0, len(rows))
	status := make([]string, 0, len(rows))
	for _, r := range rows {
		categories = append(categories, r.Name)
		units = append(units, r.Unit)
		stock = append(stock, roundTo(math.Max(0, r.Stock), 2))
		minimum = append(minimum, roundTo(r.MinStock, 2))
		restock = append(restock, roundTo(math.Max(0, r.RestockEstimate), 2))
		switch {
		case r.Stock <= 0:
			status = append(status, "critical")
		case r.Stock < r.MinStock:
			status = append(status, "warning")
		default:
			status = append(status, "good")
		}
	}
	return &AIChartData{
		Kind:       AIChartStockList,
		Title:      "ของที่ต้องสั่ง",
		Categories: categories,
		Units:      units,
		Series: []AIChartSeries{
			{Name: "คงเหลือ", Values: stock},
			{Name: "ขั้นต่ำ", Values: minimum},
			{Name: "ควรสั่งเพิ่ม", Values: restock},
		},
		Status: status,
	}
}

// buildExpenseCategoryChart draws spending by category as horizontal bars with
// each one's share. Bars, not a pie: one category usually takes most of it and
// a pie leaves the rest as unreadable slivers. nil under two categories.
func buildExpenseCategoryChart(categories []repository.ExpenseCategoryTotal) *AIChartData {
	names := make([]string, 0, len(categories))
	values := make([]float64, 0, len(categories))
	for _, c := range categories {
		if c.Amount <= 0 {
			continue
		}
		label := aiExpenseCategoryLabels[strings.ToLower(strings.TrimSpace(c.Category))]
		if label == "" {
			label = c.Category
		}
		names = append(names, label)
		values = append(values, c.Amount)
	}
	if !chartHasAtLeast(2, names) {
		return nil
	}
	sort.SliceStable(names, func(i, j int) bool { return values[i] > values[j] })
	sort.SliceStable(values, func(i, j int) bool { return values[i] > values[j] })
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      "รายจ่ายแยกหมวด",
		Unit:       "บาท",
		Categories: names,
		Series:     []AIChartSeries{{Name: "รายจ่าย", Values: values}},
		Layout:     "horizontal",
		Share:      true,
		Highlight:  []int{0},
	}
}

// buildPaymentMixPieChart shows how bills were paid, the same split the payment
// tool reports. nil under two methods with money.
func buildPaymentMixPieChart(mix []repository.AIPaymentMethodSummary) *AIChartData {
	categories := make([]string, 0, len(mix))
	values := make([]float64, 0, len(mix))
	for _, m := range mix {
		if m.Amount <= 0 {
			continue
		}
		categories = append(categories, aiPaymentMethodThai(m.Method))
		values = append(values, m.Amount)
	}
	if !chartHasAtLeast(2, categories) {
		return nil
	}
	return &AIChartData{
		Kind:       AIChartPie,
		Title:      "วิธีชำระเงิน",
		Unit:       "บาท",
		Categories: categories,
		Series:     []AIChartSeries{{Name: "ยอด", Values: values}},
	}
}

// buildMarginPerPlateChart draws margin per plate for the best and the worst
// menus together — the owner uses both ends, one to push and one to reprice.
// It is fed the same two lists the margin tools answer from (highest first,
// lowest first), in their order, so the menu the answer names as best is the
// top bar: ranking the chart itself, by a different key or from a wider list,
// put a different menu on top and had the picture disagree with the words.
// The baht per plate rides along for the hover. Only menus with a recipe
// cost count. nil under three menus.
func buildMarginPerPlateChart(highest, lowest []repository.AIMenuMarginSummary) *AIChartData {
	type plate struct {
		name    string
		pct     float64
		perDish float64
	}
	keep := func(m repository.AIMenuMarginSummary) (plate, bool) {
		if m.Quantity <= 0 || m.Cost <= 0 {
			return plate{}, false
		}
		return plate{m.MenuName, roundTo(m.Margin, 1), roundTo(m.Profit/float64(m.Quantity), 0)}, true
	}
	const top, bottom = 4, 3
	picked := make([]plate, 0, top+bottom)
	seen := map[string]bool{}
	for _, m := range highest {
		if p, ok := keep(m); ok && !seen[p.name] && len(picked) < top {
			picked = append(picked, p)
			seen[p.name] = true
		}
	}
	// The lowest list runs worst-first; the chart reads best→worst, so it is
	// appended in reverse and never repeats a menu already at the top.
	tail := make([]plate, 0, bottom)
	for _, m := range lowest {
		if p, ok := keep(m); ok && !seen[p.name] && len(tail) < bottom {
			tail = append(tail, p)
			seen[p.name] = true
		}
	}
	for i := len(tail) - 1; i >= 0; i-- {
		picked = append(picked, tail[i])
	}
	if len(picked) < 3 {
		return nil
	}
	categories := make([]string, len(picked))
	values := make([]float64, len(picked))
	perDish := make([]float64, len(picked))
	for i, p := range picked {
		categories[i] = p.name
		values[i] = p.pct
		perDish[i] = p.perDish
	}
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      "กำไรต่อจาน (% ของราคาขาย)",
		Unit:       "%",
		Categories: categories,
		Series: []AIChartSeries{
			{Name: "กำไร %", Values: values},
			{Name: "กำไรต่อจาน (บาท)", Values: perDish, Role: "tooltip"},
		},
		Layout:    "horizontal",
		Highlight: []int{0, len(picked) - 1},
	}
}

// buildAOVLineChart draws the average bill per day with the period mean as a
// reference — it tells apart "fewer people came" from "people bought less",
// which the daily total cannot. nil under three days.
func buildAOVLineChart(days []repository.AISalesSummary) *AIChartData {
	type point struct {
		date string
		aov  float64
	}
	points := make([]point, 0, len(days))
	var sumRevenue float64
	var sumOrders int64
	for _, d := range days {
		if d.Orders <= 0 || strings.TrimSpace(d.OrderDate) == "" {
			continue
		}
		points = append(points, point{strings.TrimSpace(d.OrderDate), roundTo(d.Revenue/float64(d.Orders), 0)})
		sumRevenue += d.Revenue
		sumOrders += d.Orders
	}
	if len(points) < 3 || sumOrders == 0 {
		return nil
	}
	sort.SliceStable(points, func(i, j int) bool { return points[i].date < points[j].date })
	const maxDays = 30
	if len(points) > maxDays {
		points = points[len(points)-maxDays:]
	}
	categories := make([]string, len(points))
	values := make([]float64, len(points))
	for i, p := range points {
		categories[i] = shortDayMonth(p.date)
		values[i] = p.aov
	}
	mean := roundTo(sumRevenue/float64(sumOrders), 0)
	return &AIChartData{
		Kind:       AIChartLine,
		Title:      "ยอดเฉลี่ยต่อบิลรายวัน",
		Unit:       "บาท/บิล",
		Categories: categories,
		Series:     []AIChartSeries{{Name: "ต่อบิล", Values: values}},
		Highlight:  []int{len(categories) - 1},
		Reference:  &AIChartReference{Value: mean, Label: "เฉลี่ย " + strconv.FormatFloat(mean, 'f', 0, 64)},
	}
}

// thaiShortMonthLabel is "ส.ค." for "2026-08".
func thaiShortMonthLabel(yearMonth string) string {
	months := [...]string{"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."}
	parts := strings.Split(strings.TrimSpace(yearMonth), "-")
	if len(parts) != 2 {
		return yearMonth
	}
	var m int
	if _, err := fmt.Sscanf(parts[1], "%d", &m); err != nil || m < 1 || m > 12 {
		return yearMonth
	}
	return months[m-1]
}

// buildProfitByMonthChart draws net profit per month as one bar each. A month
// with no expenses recorded is not the same figure as one with — it is gross
// profit — so it is drawn faded and said so; the current month is marked as
// running. The revenue, cost and expenses ride along for the hover. nil under
// two months with sales.
func buildProfitByMonthChart(rows []repository.AIMonthlyProfit, currentYearMonth string) *AIChartData {
	categories := make([]string, 0, len(rows))
	net := make([]float64, 0, len(rows))
	revenue := make([]float64, 0, len(rows))
	cost := make([]float64, 0, len(rows))
	expenses := make([]float64, 0, len(rows))
	notes := make([]string, 0, len(rows))
	muted := make([]int, 0, len(rows))
	for _, r := range rows {
		if r.Revenue <= 0 {
			continue
		}
		i := len(categories)
		categories = append(categories, thaiShortMonthLabel(r.Month))
		net = append(net, roundTo(r.Revenue-r.Cost-r.Expenses, 0))
		revenue = append(revenue, r.Revenue)
		cost = append(cost, r.Cost)
		expenses = append(expenses, r.Expenses)
		if r.ExpenseEntries == 0 {
			muted = append(muted, i)
		}
		if r.Month == currentYearMonth {
			notes = append(notes, "ถึงวันนี้")
		} else {
			notes = append(notes, "")
		}
	}
	if !chartHasAtLeast(2, categories) {
		return nil
	}
	chart := &AIChartData{
		Kind:       AIChartBar,
		Title:      "กำไรสุทธิรายเดือน",
		Unit:       "บาท",
		Categories: categories,
		Series: []AIChartSeries{
			{Name: "สุทธิ", Values: net},
			{Name: "ยอดขาย", Values: revenue, Role: "tooltip"},
			{Name: "ต้นทุน", Values: cost, Role: "tooltip"},
			{Name: "รายจ่าย", Values: expenses, Role: "tooltip"},
		},
		Notes: notes,
	}
	if len(muted) > 0 && len(muted) < len(categories) {
		chart.Muted = muted
		chart.MutedLabel = "ก่อนหัก ยังไม่มีรายจ่ายบันทึก"
	}
	return chart
}

// buildMoneyFlowChart is the same months as stacked parts of the sale: cost,
// expenses, and what was left — "ขายได้เยอะแต่ทำไมเหลือน้อย" in one picture.
func buildMoneyFlowChart(rows []repository.AIMonthlyProfit) *AIChartData {
	categories := make([]string, 0, len(rows))
	cost := make([]float64, 0, len(rows))
	expenses := make([]float64, 0, len(rows))
	left := make([]float64, 0, len(rows))
	for _, r := range rows {
		if r.Revenue <= 0 {
			continue
		}
		categories = append(categories, thaiShortMonthLabel(r.Month))
		cost = append(cost, r.Cost)
		expenses = append(expenses, r.Expenses)
		left = append(left, roundTo(r.Revenue-r.Cost-r.Expenses, 0))
	}
	if !chartHasAtLeast(2, categories) {
		return nil
	}
	return &AIChartData{
		Kind:       AIChartBar,
		Title:      "เงินจากยอดขายไปไหน",
		Unit:       "บาท",
		Categories: categories,
		Series: []AIChartSeries{
			{Name: "ต้นทุนวัตถุดิบ", Values: cost, Tone: 2},
			{Name: "รายจ่าย", Values: expenses, Tone: 3},
			{Name: "เหลือ", Values: left, Tone: 1},
		},
		Stacked: true,
	}
}

// roundTo rounds to the given decimals.
func roundTo(v float64, decimals int) float64 {
	pow := math.Pow(10, float64(decimals))
	return math.Round(v*pow) / pow
}

// orderTypeLabel turns the stored order type into the Thai the owner reads.
func orderTypeLabel(orderType string) string {
	switch strings.TrimSpace(orderType) {
	case "dine_in":
		return "กินที่ร้าน"
	case "takeaway":
		return "กลับบ้าน"
	default:
		return orderType
	}
}

// buildOrderTypePieChart shows the share of revenue by order type (dine-in vs
// takeaway) as a pie — the same split the breakdown tool reports. nil when there
// is no revenue to divide.
func buildOrderTypePieChart(rows []repository.AIOrderTypeSummary) *AIChartData {
	categories := make([]string, 0, len(rows))
	values := make([]float64, 0, len(rows))
	var total float64
	for _, r := range rows {
		if r.Revenue <= 0 {
			continue
		}
		categories = append(categories, orderTypeLabel(r.OrderType))
		values = append(values, r.Revenue)
		total += r.Revenue
	}
	if total <= 0 || len(categories) == 0 {
		return nil
	}
	return &AIChartData{
		Kind:       AIChartPie,
		Title:      "สัดส่วนยอดขายตามประเภท",
		Unit:       "บาท",
		Categories: categories,
		Series:     []AIChartSeries{{Name: "ยอดขาย", Values: values}},
	}
}
