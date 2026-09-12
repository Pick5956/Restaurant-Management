package aitools

import (
	"time"

	"Project-M/internal/repository"
)

// The day that took the most money, and the day that took the least.
//
// This exists because the owner asked "ยอดขายวันไหนสูงสุดในรอบนี้" and the
// assistant answered with a weekday and a bill count — get_peak_periods, which
// ranks weekdays by how many bills they carry, was the closest thing available.
// Nothing could answer the question as asked: which calendar date, and how many
// baht. Left with no tool the model produced a date anyway (9 กันยายน, 9,495
// บาท) when the real answer for that window was 18 สิงหาคม, 17,806 บาท.
//
// A window with no sales at all has no best day. That is reported as "no data",
// never as a day that took zero: a shop that was closed did not have its worst
// day on a date nobody chose.

// AIBestSalesDay names the highest and lowest days in the window, by revenue.
type AIBestSalesDay struct {
	Days int // days in the window that carry a sales record

	BestDate    string
	BestWeekday time.Weekday
	BestRevenue float64
	BestOrders  int64

	WorstDate    string
	WorstWeekday time.Weekday
	WorstRevenue float64
	WorstOrders  int64

	// DaysWithSales counts the days that actually took money, so the answer can
	// say "best of 25 trading days" rather than implying the shop traded every
	// day in the window.
	DaysWithSales int

	HasData bool
}

// ComputeBestSalesDay ranks the days in the snapshot window by revenue.
//
// Ties go to the earlier date, so the same window always names the same day.
// Days with no revenue are not candidates for either end: a closed day is not a
// bad trading day, and including it would make the worst day meaningless in
// every window that contains a holiday.
func ComputeBestSalesDay(days []repository.AISalesSummary) AIBestSalesDay {
	result := AIBestSalesDay{Days: len(days)}
	for _, day := range days {
		if day.Revenue <= 0 {
			continue
		}
		result.DaysWithSales++
		if !result.HasData || day.Revenue > result.BestRevenue {
			result.BestDate = day.OrderDate
			result.BestRevenue = day.Revenue
			result.BestOrders = day.Orders
			result.BestWeekday = weekdayOf(day.OrderDate)
		}
		if !result.HasData || day.Revenue < result.WorstRevenue {
			result.WorstDate = day.OrderDate
			result.WorstRevenue = day.Revenue
			result.WorstOrders = day.Orders
			result.WorstWeekday = weekdayOf(day.OrderDate)
		}
		result.HasData = true
	}
	return result
}

// weekdayOf reads the weekday off a YYYY-MM-DD key. The dates come out of the
// database already in the shop's own day boundaries, so they are read as plain
// calendar dates rather than instants.
func weekdayOf(dateKey string) time.Weekday {
	parsed, err := time.Parse("2006-01-02", dateKey)
	if err != nil {
		return time.Sunday
	}
	return parsed.Weekday()
}
