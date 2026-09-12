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

	// Today, when the window reaches it, is not a candidate: at three in the
	// afternoon it is the worst day of every month by construction. It is set
	// aside here so the answer can still say how today is going.
	TodayExcluded bool
	TodayDate     string
	TodayRevenue  float64
	TodayOrders   int64

	// A rolling window ("30 วันล่าสุด") starts at this minute thirty days ago,
	// so its first date holds an evening's bills only. That date is set aside
	// the same way; it is never the worst day of anything.
	FirstPartialExcluded bool
	FirstPartialDate     string
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

// ComputeBestSalesDayAsOf is ComputeBestSalesDay over the finished days only:
// today's row and the window's partial first date, when present, are taken out
// of the ranking and reported separately. Both keys are YYYY-MM-DD in the
// shop's own day boundaries, the form the rows carry; pass "" for an edge that
// is not partial (a window that starts at midnight, or ended before today).
func ComputeBestSalesDayAsOf(days []repository.AISalesSummary, today, partialFirst string) AIBestSalesDay {
	finished, edges := FinishedDays(days, partialFirst, today)
	ranked := ComputeBestSalesDay(finished)
	ranked.TodayExcluded = edges.TodayDropped
	ranked.TodayDate = edges.Today.OrderDate
	ranked.TodayRevenue = edges.Today.Revenue
	ranked.TodayOrders = edges.Today.Orders
	ranked.FirstPartialExcluded = edges.FirstDropped
	ranked.FirstPartialDate = edges.First.OrderDate
	return ranked
}

// AIPartialEdges is what FinishedDays set aside.
type AIPartialEdges struct {
	TodayDropped bool
	Today        repository.AISalesSummary
	FirstDropped bool
	First        repository.AISalesSummary
}

// FinishedDays splits a window's per-date rows into the days that are over and
// the two edges that may not be: today, and the partial first date of a rolling
// window. Every per-day comparison — best/worst day, weekday averages — should
// rank only the finished days; a half day is not a bad day.
func FinishedDays(days []repository.AISalesSummary, partialFirst, today string) ([]repository.AISalesSummary, AIPartialEdges) {
	finished := make([]repository.AISalesSummary, 0, len(days))
	var edges AIPartialEdges
	for _, day := range days {
		switch {
		case today != "" && day.OrderDate == today:
			edges.TodayDropped, edges.Today = true, day
		case partialFirst != "" && day.OrderDate == partialFirst:
			edges.FirstDropped, edges.First = true, day
		default:
			finished = append(finished, day)
		}
	}
	return finished, edges
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
