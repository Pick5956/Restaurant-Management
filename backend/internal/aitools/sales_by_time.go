package aitools

import (
	"time"

	"Project-M/internal/repository"
)

// AIWeekdaySales is one day of the week, summed over every date in the window
// that fell on it. AveragePerDay is the figure to compare weekdays by: a window
// of thirty days holds five of some weekdays and four of others, so the totals
// alone would rank a weekday by how often it occurred.
type AIWeekdaySales struct {
	Weekday       time.Weekday
	Days          int
	Orders        int64
	Revenue       float64
	AveragePerDay float64
}

// AISalesByWeekday is the money view of the week: which weekday earns most per
// day, and the weekend against the working week.
//
// It exists because "เสาร์อาทิตย์ขายดีกว่าวันธรรมดาไหม" had no source. The peak
// tool counts bills by the hour a bill opened, so it could say which weekday is
// busiest but not which earns more, and the assistant told the owner it could
// not compare them.
type AISalesByWeekday struct {
	// Weekdays always holds seven entries, Sunday first, so a weekday with no
	// selling day in the window is present with Days == 0 rather than absent.
	Weekdays       []AIWeekdaySales
	WeekendDays    int
	WeekdayDays    int
	WeekendRevenue float64
	WeekdayRevenue float64
	WeekendPerDay  float64
	WeekdayPerDay  float64
	BestWeekday    time.Weekday
	WorstWeekday   time.Weekday
	HasData        bool
}

// ComputeSalesByWeekday folds per-date paid sales into the seven weekdays.
// Dates with no revenue are left out, the same rule ComputeBestSalesDay keeps:
// a day the shop did not sell on says nothing about that weekday.
func ComputeSalesByWeekday(days []repository.AISalesSummary) AISalesByWeekday {
	out := AISalesByWeekday{Weekdays: make([]AIWeekdaySales, 7)}
	for i := range out.Weekdays {
		out.Weekdays[i].Weekday = time.Weekday(i)
	}
	for _, day := range days {
		if day.Revenue <= 0 {
			continue
		}
		weekday := weekdayOf(day.OrderDate)
		bucket := &out.Weekdays[weekday]
		bucket.Days++
		bucket.Orders += day.Orders
		bucket.Revenue += day.Revenue
		if weekday == time.Saturday || weekday == time.Sunday {
			out.WeekendDays++
			out.WeekendRevenue += day.Revenue
		} else {
			out.WeekdayDays++
			out.WeekdayRevenue += day.Revenue
		}
	}
	best, worst := -1, -1
	for i := range out.Weekdays {
		bucket := &out.Weekdays[i]
		if bucket.Days == 0 {
			continue
		}
		bucket.AveragePerDay = bucket.Revenue / float64(bucket.Days)
		out.HasData = true
		if best < 0 || bucket.AveragePerDay > out.Weekdays[best].AveragePerDay {
			best = i
		}
		if worst < 0 || bucket.AveragePerDay < out.Weekdays[worst].AveragePerDay {
			worst = i
		}
	}
	if out.WeekendDays > 0 {
		out.WeekendPerDay = out.WeekendRevenue / float64(out.WeekendDays)
	}
	if out.WeekdayDays > 0 {
		out.WeekdayPerDay = out.WeekdayRevenue / float64(out.WeekdayDays)
	}
	if best >= 0 {
		out.BestWeekday = time.Weekday(best)
		out.WorstWeekday = time.Weekday(worst)
	}
	return out
}

// AIPeakHour is the hour of the day that took the most money over the window.
type AIPeakHour struct {
	Hour     int
	Orders   int64
	Revenue  float64
	SharePct float64
	HasData  bool
}

// PeakHourByRevenue picks the hour with the most money, and its share of the
// window's total. Ties go to the earlier hour.
func PeakHourByRevenue(hours []repository.AIHourSales) AIPeakHour {
	var out AIPeakHour
	var total float64
	best := -1
	for i, hour := range hours {
		total += hour.Revenue
		if best < 0 || hour.Revenue > hours[best].Revenue {
			best = i
		}
	}
	if best < 0 || total <= 0 {
		return out
	}
	out.Hour = hours[best].Hour
	out.Orders = hours[best].Orders
	out.Revenue = hours[best].Revenue
	out.SharePct = hours[best].Revenue / total * 100
	out.HasData = true
	return out
}
