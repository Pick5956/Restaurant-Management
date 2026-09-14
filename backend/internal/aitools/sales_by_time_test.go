package aitools

import (
	"math"
	"testing"
	"time"

	"Project-M/internal/repository"
)

func near(a, b float64) bool { return math.Abs(a-b) < 0.005 }

func TestComputeSalesByWeekdayComparesByAveragePerDay(t *testing.T) {
	// 2026-09-05 is a Saturday, 2026-09-06 a Sunday, 2026-09-07 a Monday.
	days := []repository.AISalesSummary{
		{OrderDate: "2026-09-05", Orders: 10, Revenue: 3000}, // Sat
		{OrderDate: "2026-09-06", Orders: 12, Revenue: 4000}, // Sun
		{OrderDate: "2026-09-07", Orders: 20, Revenue: 2000}, // Mon
		{OrderDate: "2026-09-08", Orders: 18, Revenue: 2500}, // Tue
		{OrderDate: "2026-09-14", Orders: 21, Revenue: 2200}, // Mon again
		{OrderDate: "2026-09-09", Orders: 0, Revenue: 0},     // no revenue: ignored
	}
	got := ComputeSalesByWeekday(days)
	if !got.HasData {
		t.Fatal("HasData = false")
	}
	if len(got.Weekdays) != 7 {
		t.Fatalf("Weekdays has %d entries, want 7", len(got.Weekdays))
	}
	monday := got.Weekdays[time.Monday]
	if monday.Days != 2 || monday.Orders != 41 || !near(monday.AveragePerDay, 2100) {
		t.Fatalf("monday = %+v", monday)
	}
	if got.Weekdays[time.Wednesday].Days != 0 {
		t.Fatalf("wednesday should have no selling day, got %+v", got.Weekdays[time.Wednesday])
	}
	// Monday's total (4200) beats Sunday's (4000), but per day Sunday wins.
	if got.BestWeekday != time.Sunday {
		t.Fatalf("BestWeekday = %v, want Sunday", got.BestWeekday)
	}
	if got.WorstWeekday != time.Monday {
		t.Fatalf("WorstWeekday = %v, want Monday", got.WorstWeekday)
	}
	if got.WeekendDays != 2 || !near(got.WeekendPerDay, 3500) {
		t.Fatalf("weekend = days %d per-day %.2f", got.WeekendDays, got.WeekendPerDay)
	}
	if got.WeekdayDays != 3 || !near(got.WeekdayPerDay, 6700.0/3) {
		t.Fatalf("weekday = days %d per-day %.2f", got.WeekdayDays, got.WeekdayPerDay)
	}
}

func TestComputeSalesByWeekdayWithNothingSold(t *testing.T) {
	got := ComputeSalesByWeekday(nil)
	if got.HasData {
		t.Fatal("HasData should be false with no days")
	}
	if len(got.Weekdays) != 7 {
		t.Fatalf("still want the seven buckets, got %d", len(got.Weekdays))
	}
}

func TestPeakHourByRevenuePicksMoneyNotBills(t *testing.T) {
	hours := []repository.AIHourSales{
		{Hour: 12, Orders: 50, Revenue: 9000},
		{Hour: 18, Orders: 30, Revenue: 11000},
		{Hour: 20, Orders: 10, Revenue: 11000}, // tie: earlier hour wins
	}
	got := PeakHourByRevenue(hours)
	if !got.HasData || got.Hour != 18 || got.Orders != 30 {
		t.Fatalf("peak = %+v", got)
	}
	if !near(got.SharePct, 11000.0/31000*100) {
		t.Fatalf("share = %.2f", got.SharePct)
	}
	if PeakHourByRevenue(nil).HasData {
		t.Fatal("empty input must report no data")
	}
}
