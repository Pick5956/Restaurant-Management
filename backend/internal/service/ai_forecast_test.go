package service

import (
	"math"
	"testing"
	"time"
)

func buildSyntheticSeries(weeks int, base map[time.Weekday]float64, end time.Time) []forecastDailyPoint {
	loc := bangkokLocation()
	end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, loc)
	pts := make([]forecastDailyPoint, 0, weeks*7)
	for i := weeks * 7; i >= 1; i-- { // oldest → newest
		d := end.AddDate(0, 0, -i)
		pts = append(pts, forecastDailyPoint{date: d, rev: base[d.Weekday()]})
	}
	return pts
}

func weekdayBase() map[time.Weekday]float64 {
	return map[time.Weekday]float64{
		time.Sunday: 18000, time.Monday: 10000, time.Tuesday: 10500, time.Wednesday: 11000,
		time.Thursday: 12000, time.Friday: 16000, time.Saturday: 20000,
	}
}

// Perfectly seasonal data (fixed weekday pattern, no trend) must backtest to
// near-zero error and reproduce each weekday's level — proof the model captures
// day-of-week, which is the dominant signal for a restaurant.
func TestForecastRecoversWeeklyPattern(t *testing.T) {
	base := weekdayBase()
	pts := buildSyntheticSeries(12, base, time.Date(2026, time.August, 1, 0, 0, 0, 0, bangkokLocation()))

	r := buildForecast(pts, operatingCalendar{}, pts[len(pts)-1].date, 7, 28)
	if r.BacktestN < 20 {
		t.Fatalf("expected a full backtest window, got N=%d", r.BacktestN)
	}
	if r.MAPE > 1.0 {
		t.Fatalf("perfectly seasonal data should backtest near-zero error, got MAPE=%.2f%%", r.MAPE)
	}

	sawSaturday := false
	for _, f := range r.Forecast {
		d, _ := time.ParseInLocation("2006-01-02", f.Date, bangkokLocation())
		if d.Weekday() != time.Saturday {
			continue
		}
		sawSaturday = true
		if math.Abs(f.Predicted-base[time.Saturday])/base[time.Saturday] > 0.02 {
			t.Fatalf("Saturday forecast should ≈ %.0f, got %.0f", base[time.Saturday], f.Predicted)
		}
		if f.Lower >= f.Predicted || f.Upper <= f.Predicted {
			t.Fatalf("band must bracket the prediction: %.0f in [%.0f, %.0f]", f.Predicted, f.Lower, f.Upper)
		}
	}
	if !sawSaturday {
		t.Fatal("expected a Saturday inside the 7-day forecast")
	}
}

// A sustained recent uptrend should nudge the forecast above the plain seasonal
// baseline (but the clamp keeps it from running away).
func TestForecastPicksUpRecentTrend(t *testing.T) {
	base := weekdayBase()
	end := time.Date(2026, time.August, 1, 0, 0, 0, 0, bangkokLocation())
	pts := buildSyntheticSeries(12, base, end)
	// Lift the most recent 14 days by 10%.
	cut := end.AddDate(0, 0, -14)
	for i := range pts {
		if !pts[i].date.Before(cut) {
			pts[i].rev *= 1.10
		}
	}

	target := end.AddDate(0, 0, 6) // a Friday after the series
	pred, ok := forecastDay(pts, target)
	if !ok {
		t.Fatal("expected a forecast")
	}
	// Friday base is 16000; recent Fridays are lifted, and trend > 1, so > base.
	if pred <= base[time.Friday] {
		t.Fatalf("uptrend forecast should exceed the flat baseline %.0f, got %.0f", base[time.Friday], pred)
	}
}

func TestIsForecastQuestion(t *testing.T) {
	yes := []string{
		"ทำนายยอดขายสัปดาห์หน้า",
		"คาดว่าอาทิตย์หน้าจะขายได้เท่าไหร่",
		"พยากรณ์ยอดขาย",
		"forecast next week",
	}
	for _, q := range yes {
		if !isForecastQuestion(q) {
			t.Errorf("%q should be a forecast question", q)
		}
	}
	no := []string{
		"ยอดขายวันนี้เท่าไหร่",
		"แนวโน้มยอดขายเป็นไง", // historical trend tool owns this
		"เมนูไหนขายดีสุด",
	}
	for _, q := range no {
		if isForecastQuestion(q) {
			t.Errorf("%q must not be a forecast question", q)
		}
	}
}

// Today's row is half a day when asked before closing. It must not reach the
// model: it would be the newest same-weekday point and drag next week down.
func TestForecastIgnoresTodaysUnfinishedDay(t *testing.T) {
	loc := bangkokLocation()
	today := time.Date(2026, 9, 22, 0, 0, 0, 0, loc) // a Tuesday
	pts := buildSyntheticSeries(8, weekdayBase(), today)
	pts = append(pts, forecastDailyPoint{date: today, rev: 1200}) // noon: a fraction of a normal Tuesday
	kept := finishedDaysOnly(pts, today)
	if len(kept) != len(pts)-1 || !kept[len(kept)-1].date.Before(today) {
		t.Fatalf("today should be dropped, got last = %v", kept[len(kept)-1].date)
	}
	nextTuesday := today.AddDate(0, 0, 7)
	withPartial, _ := forecastDay(pts, nextTuesday)
	clean, _ := forecastDay(kept, nextTuesday)
	if math.Abs(clean-weekdayBase()[time.Tuesday]) > 1 {
		t.Fatalf("clean forecast = %.0f, want the Tuesday level %.0f", clean, weekdayBase()[time.Tuesday])
	}
	if withPartial >= clean {
		t.Fatalf("the partial day should have pulled the forecast down (%.0f vs %.0f) — the bug this guards", withPartial, clean)
	}
}
