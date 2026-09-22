package service

import (
	"strings"
	"testing"

	"Project-M/internal/repository"
)

// Every chart is drawn from a tool's own figures and only when they have a
// shape worth seeing. These pin the floors and the hints the drawing relies on.

func TestPeakHoursChartIsInClockOrderWithTheBusiestHourMarked(t *testing.T) {
	rows := []repository.AIPeriodSummary{{Period: 13, Orders: 136}, {Period: 11, Orders: 138}, {Period: 19, Orders: 91}, {Period: 3, Orders: 0}}
	c := buildPeakHoursChart(rows)
	if c == nil {
		t.Fatal("three hours with bills should chart")
	}
	if got := c.Categories; got[0] != "11" || got[1] != "13" || got[2] != "19" || len(got) != 3 {
		t.Fatalf("hours not in clock order / empty hour kept: %v", got)
	}
	if len(c.Highlight) != 1 || c.Highlight[0] != 0 {
		t.Fatalf("busiest hour (11:00, 138) should be highlighted at index 0, got %v", c.Highlight)
	}
	if buildPeakHoursChart(rows[:2]) != nil {
		t.Fatal("two hours is below the floor")
	}
}

func TestPeakWeekdayChartStartsOnMondayAndNeedsAllSeven(t *testing.T) {
	rows := make([]repository.AIPeriodSummary, 0, 7)
	for day := 0; day < 7; day++ {
		rows = append(rows, repository.AIPeriodSummary{Period: day, Orders: int64(100 + day)})
	}
	c := buildPeakWeekdayChart(rows)
	if c == nil || c.Categories[0] != "จ" || c.Categories[6] != "อา" {
		t.Fatalf("weekday chart = %+v", c)
	}
	// Saturday (6) has the most, and sits at index 5 in Mon..Sun order.
	if len(c.Highlight) != 1 || c.Highlight[0] != 5 {
		t.Fatalf("highlight = %v", c.Highlight)
	}
	if buildPeakWeekdayChart(rows[:6]) != nil {
		t.Fatal("a missing weekday must not chart")
	}
}

func TestStockListShowsWhatIsLeftPerRowOutFirst(t *testing.T) {
	risks := []AIStockRisk{
		{Name: "กะเพรา", Stock: 1600, MinStock: 1463.5, Unit: "กรัม", RestockEstimate: 0},
		{Name: "มะเขือ", Stock: 271.4, MinStock: 2695.6, Unit: "กรัม", RestockEstimate: 2424.2},
		{Name: "นมข้นหวาน", Stock: 0, MinStock: 1500, Unit: "มล.", RestockEstimate: 1500},
		{Name: "ไม่มีขั้นต่ำ", Stock: 5, MinStock: 0},
	}
	c := buildStockVsMinChart(risks)
	if c == nil || c.Kind != AIChartStockList {
		t.Fatalf("list = %+v", c)
	}
	if len(c.Categories) != 3 {
		t.Fatalf("a row without a minimum has nothing to compare against: %v", c.Categories)
	}
	// Out of stock first, then the emptiest share of its own minimum.
	if c.Categories[0] != "นมข้นหวาน" || c.Categories[1] != "มะเขือ" || c.Categories[2] != "กะเพรา" {
		t.Fatalf("order = %v", c.Categories)
	}
	// Each row keeps its own unit; the rows do not share one.
	if c.Units[0] != "มล." || c.Units[2] != "กรัม" {
		t.Fatalf("units = %v", c.Units)
	}
	if v := c.Series[0].Values; v[0] != 0 || v[1] != 271.4 {
		t.Fatalf("stock = %v", v)
	}
	if v := c.Series[1].Values; v[0] != 1500 || v[2] != 1463.5 {
		t.Fatalf("minimum = %v", v)
	}
	if v := c.Series[2].Values; v[0] != 1500 || v[2] != 0 {
		t.Fatalf("restock = %v", v)
	}
	if s := c.Status; s[0] != "critical" || s[1] != "warning" || s[2] != "good" {
		t.Fatalf("status = %v", s)
	}
	// One row is a list, not a chart that needs three.
	if one := buildStockVsMinChart(risks[2:3]); one == nil || len(one.Categories) != 1 {
		t.Fatalf("single row = %+v", one)
	}
}

func TestExpenseCategoryChartIsSortedBarsWithShares(t *testing.T) {
	c := buildExpenseCategoryChart([]repository.ExpenseCategoryTotal{
		{Category: "labor", Amount: 3000}, {Category: "ingredient", Amount: 29806}, {Category: "utilities", Amount: 218}, {Category: "rent", Amount: 0},
	})
	if c == nil || !c.Share || c.Layout != "horizontal" {
		t.Fatalf("chart = %+v", c)
	}
	if c.Categories[0] != "วัตถุดิบ" || c.Series[0].Values[0] != 29806 || len(c.Categories) != 3 {
		t.Fatalf("categories = %v values = %v", c.Categories, c.Series[0].Values)
	}
	if buildExpenseCategoryChart([]repository.ExpenseCategoryTotal{{Category: "labor", Amount: 3000}}) != nil {
		t.Fatal("one category is a sentence, not a chart")
	}
}

func TestMarginPerPlateChartKeepsTheToolsOwnOrder(t *testing.T) {
	menu := func(name string, pct, profit float64) repository.AIMenuMarginSummary {
		return repository.AIMenuMarginSummary{MenuName: name, Quantity: 10, Cost: 100, Margin: pct, Profit: profit}
	}
	// Highest-first as the tool ranks them; a menu with the biggest baht per
	// plate (B) is NOT first, because the tool ranks by percent.
	highest := []repository.AIMenuMarginSummary{menu("A", 69.85, 500), menu("B", 69.1, 960), menu("C", 60, 300), menu("D", 55, 200), menu("E", 50, 100)}
	lowest := []repository.AIMenuMarginSummary{menu("Z", 10, 50), menu("Y", 20, 80), menu("X", 30, 90), menu("E", 50, 100)}
	c := buildMarginPerPlateChart(highest, lowest)
	if c == nil || c.Unit != "%" {
		t.Fatalf("chart = %+v", c)
	}
	want := []string{"A", "B", "C", "D", "X", "Y", "Z"}
	for i, name := range want {
		if c.Categories[i] != name {
			t.Fatalf("order = %v, want %v", c.Categories, want)
		}
	}
	if c.Series[0].Values[0] != 69.9 || c.Series[1].Role != "tooltip" || c.Series[1].Values[1] != 96 {
		t.Fatalf("series = %+v", c.Series)
	}
	if len(c.Highlight) != 2 || c.Highlight[1] != 6 {
		t.Fatalf("highlight = %v", c.Highlight)
	}
	// A menu with no recipe cost has no margin to rank.
	none := []repository.AIMenuMarginSummary{{MenuName: "x", Quantity: 1, Margin: 5}, {MenuName: "y", Quantity: 1, Margin: 5}, {MenuName: "z", Quantity: 1, Margin: 5}}
	if buildMarginPerPlateChart(none, nil) != nil {
		t.Fatal("menus without cost must not chart")
	}
}

func TestAOVLineChartCarriesThePeriodMean(t *testing.T) {
	c := buildAOVLineChart([]repository.AISalesSummary{
		{OrderDate: "2026-09-02", Orders: 20, Revenue: 4975}, {OrderDate: "2026-09-01", Orders: 28, Revenue: 8608}, {OrderDate: "2026-09-03", Orders: 31, Revenue: 8555},
	})
	if c == nil || c.Reference == nil || c.Unit != "บาท/บิล" {
		t.Fatalf("chart = %+v", c)
	}
	if c.Categories[0] != "1/9" || c.Series[0].Values[0] != 307 {
		t.Fatalf("oldest first with rounded aov: %v %v", c.Categories, c.Series[0].Values)
	}
	// (4975+8608+8555)/(20+28+31) = 280.2
	if c.Reference.Value != 280 || c.Reference.Label != "เฉลี่ย 280" {
		t.Fatalf("mean = %v label = %q", c.Reference.Value, c.Reference.Label)
	}
}

func TestProfitByMonthChartFadesMonthsWithoutALedger(t *testing.T) {
	rows := []repository.AIMonthlyProfit{
		{Month: "2026-07", Revenue: 347453, Cost: 107014, Bills: 1285},
		{Month: "2026-08", Revenue: 287839, Cost: 88684, Expenses: 5131, ExpenseEntries: 5, Bills: 1064},
		{Month: "2026-09", Revenue: 51206, Cost: 15771, Expenses: 27893, ExpenseEntries: 13, Bills: 175},
	}
	c := buildProfitByMonthChart(rows, "2026-09")
	if c == nil || c.Categories[0] != "ก.ค." || c.Categories[2] != "ก.ย." {
		t.Fatalf("chart = %+v", c)
	}
	if c.Series[0].Values[1] != 194024 || c.Series[0].Values[2] != 7542 {
		t.Fatalf("net = %v", c.Series[0].Values)
	}
	if len(c.Muted) != 1 || c.Muted[0] != 0 || c.MutedLabel == "" {
		t.Fatalf("July has no ledger and must be faded: %v %q", c.Muted, c.MutedLabel)
	}
	if c.Notes[2] != "ถึงวันนี้" || c.Notes[1] != "" {
		t.Fatalf("notes = %v", c.Notes)
	}
	tooltip := 0
	for _, s := range c.Series {
		if s.Role == "tooltip" {
			tooltip++
		}
	}
	if tooltip != 3 {
		t.Fatalf("revenue, cost and expenses should ride along for the hover, got %d", tooltip)
	}
	flow := buildMoneyFlowChart(rows)
	if flow == nil || !flow.Stacked || len(flow.Series) != 3 || flow.Series[2].Values[1] != 194024 {
		t.Fatalf("money flow = %+v", flow)
	}
}

// The sheet says which months have no ledger, in words the writer must repeat.
func TestProfitByMonthBodyNamesTheMonthsWithoutALedger(t *testing.T) {
	body := joyboyProfitByMonthBody([]repository.AIMonthlyProfit{
		{Month: "2026-07", Revenue: 100, Cost: 40},
		{Month: "2026-08", Revenue: 100, Cost: 40, Expenses: 10, ExpenseEntries: 1},
	}, "2026-08")
	for _, want := range []string{"month=2026-07", "net=60.00", "month=2026-08", "net=50.00", "partial=month_still_running", "months_without_recorded_expenses=2026-07", "gap_means="} {
		if !strings.Contains(body, want) {
			t.Errorf("sheet lost %q:\n%s", want, body)
		}
	}
}
