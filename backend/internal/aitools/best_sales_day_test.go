package aitools

import (
	"testing"
	"time"

	"Project-M/internal/repository"
)

func TestComputeBestSalesDayNamesTheDateNotTheWeekday(t *testing.T) {
	// The window from the conversation that exposed the gap: the assistant said
	// "วันพุธที่ 9 กันยายน 9,495 บาท" when 18 สิงหาคม took 17,806.
	result := ComputeBestSalesDay([]repository.AISalesSummary{
		{OrderDate: "2026-08-17", Orders: 40, Revenue: 10644},
		{OrderDate: "2026-08-18", Orders: 61, Revenue: 17806},
		{OrderDate: "2026-09-09", Orders: 26, Revenue: 9495},
		{OrderDate: "2026-09-11", Orders: 25, Revenue: 5768},
	})

	if !result.HasData {
		t.Fatal("a window with sales must report a best day")
	}
	if result.BestDate != "2026-08-18" || result.BestRevenue != 17806 {
		t.Fatalf("best day = %s / %.0f, want 2026-08-18 / 17806", result.BestDate, result.BestRevenue)
	}
	if result.BestWeekday != time.Tuesday {
		t.Fatalf("18 Aug 2026 is a Tuesday, got %s", result.BestWeekday)
	}
	if result.BestOrders != 61 {
		t.Fatalf("best day orders = %d, want 61", result.BestOrders)
	}
	if result.WorstDate != "2026-09-11" || result.WorstRevenue != 5768 {
		t.Fatalf("worst day = %s / %.0f, want 2026-09-11 / 5768", result.WorstDate, result.WorstRevenue)
	}
}

func TestComputeBestSalesDayIgnoresDaysThatTookNothing(t *testing.T) {
	// 8 Sep has no rows at all. Reporting it as the worst day would tell the
	// owner their worst trading day was one they did not trade on.
	result := ComputeBestSalesDay([]repository.AISalesSummary{
		{OrderDate: "2026-09-08", Orders: 0, Revenue: 0},
		{OrderDate: "2026-09-09", Orders: 26, Revenue: 9495},
		{OrderDate: "2026-09-10", Orders: 30, Revenue: 9322},
	})

	if result.WorstDate != "2026-09-10" {
		t.Fatalf("worst day = %q, want 2026-09-10 — a closed day is not a bad day", result.WorstDate)
	}
	if result.DaysWithSales != 2 {
		t.Fatalf("days with sales = %d, want 2", result.DaysWithSales)
	}
	if result.Days != 3 {
		t.Fatalf("days in window = %d, want 3 — the window keeps its full length", result.Days)
	}
}

func TestComputeBestSalesDayHasNoAnswerForAWindowThatSoldNothing(t *testing.T) {
	result := ComputeBestSalesDay([]repository.AISalesSummary{
		{OrderDate: "2026-09-08", Orders: 0, Revenue: 0},
	})
	if result.HasData {
		t.Fatal("a window with no sales has no best day")
	}

	if ComputeBestSalesDay(nil).HasData {
		t.Fatal("an empty window has no best day")
	}
}

func TestComputeBestSalesDayBreaksTiesOnTheEarlierDate(t *testing.T) {
	// Same figure twice: the answer must not depend on the order rows arrive in.
	result := ComputeBestSalesDay([]repository.AISalesSummary{
		{OrderDate: "2026-09-02", Orders: 10, Revenue: 5000},
		{OrderDate: "2026-09-03", Orders: 10, Revenue: 5000},
	})
	if result.BestDate != "2026-09-02" {
		t.Fatalf("best day = %q, want the earlier 2026-09-02", result.BestDate)
	}
	if result.WorstDate != "2026-09-02" {
		t.Fatalf("worst day = %q, want the earlier 2026-09-02", result.WorstDate)
	}
}
