package service

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"Project-M/internal/repository"
)

// Sales forecasting — prototype #1.
//
// This is a deliberate break from the "numbers only from the database" rule that
// governs the rest of the assistant: a forecast is a *guess about the future* and
// can be wrong. The bridge back to that rule is that the guess comes from a fixed,
// inspectable formula (not the LLM), it is bounded by an error measured on the
// shop's own history (backtesting), and it is always presented as a range with a
// visible accuracy figure and a warning — never as a fact.
//
// Method: seasonal moving average. Forecast for a day = the average of the recent
// same-weekdays (restaurants live and die by day-of-week), nudged by a clamped
// recent-vs-previous trend. Simple, interpretable, and hard to beat at short range
// — the right first tool before anything heavier (Holt-Winters, ARIMA, ML).

const (
	forecastSameWeekdayK = 6    // how many recent same-weekdays to average
	forecastTrendDays    = 14   // window for the recent-vs-previous trend
	forecastTrendClampLo = 0.85 // trend can only nudge, never run away
	forecastTrendClampHi = 1.15
	forecastHorizonDays  = 7
	forecastBacktestDays = 28
	forecastFallbackBand = 0.15 // ± band when the backtest is too thin to trust
	forecastMinPoints    = 14   // below this we refuse to forecast
)

type forecastDailyPoint struct {
	date time.Time
	rev  float64
}

// AIForecastResult is the chart-ready payload: past actuals + future predictions
// with bounds, plus the measured error that sets those bounds.
type AIForecastResult struct {
	History    []AIForecastHistoryPoint `json:"history"`
	Forecast   []AIForecastPoint        `json:"forecast"`
	MAPE       float64                  `json:"mape"`        // mean abs % error from backtest
	MAE        float64                  `json:"mae"`         // mean abs error, baht
	BacktestN  int                      `json:"backtest_n"`  // days evaluated
	SampleDays int                      `json:"sample_days"` // history days the model saw
	StaleDays  int                      `json:"stale_days"`  // how far behind today the latest data is
}

type AIForecastHistoryPoint struct {
	Date   string  `json:"date"`
	Actual float64 `json:"actual"`
}

type AIForecastPoint struct {
	Date      string  `json:"date"`
	Weekday   string  `json:"weekday"`
	Predicted float64 `json:"predicted"`
	Lower     float64 `json:"lower"`
	Upper     float64 `json:"upper"`
	Closed    bool    `json:"closed,omitempty"` // shop is closed that day → no sales predicted
}

// isForecastQuestion matches forward-looking asks only. Bare "แนวโน้ม" is left to
// the existing (historical) sales-trend tool; forecasting needs an explicit future.
func isForecastQuestion(question string) bool {
	n := strings.ToLower(strings.TrimSpace(question))
	return containsAny(n,
		"ทำนาย", "พยากรณ์", "คาดการณ์", "คาดว่า", "อนาคต", "จะขายได้", "น่าจะขาย",
		"สัปดาห์หน้า", "อาทิตย์หน้า", "เดือนหน้า", "วันหน้า", "ล่วงหน้า", "แนวโน้มข้างหน้า",
		"forecast", "predict", "projection")
}

// answerSalesForecast is the legacy entry: there the word list is what decides a
// question is about the future at all, so it has to run.
func (s *AIService) answerSalesForecast(restaurantID uint, question string) (*AIAskResponse, bool, error) {
	if s.repo == nil || !isForecastQuestion(question) {
		return nil, false, nil
	}
	return s.buildSalesForecastAnswer(restaurantID)
}

// buildSalesForecastAnswer is the same forecast without the word list in front
// of it, for callers where something else already decided.
//
// Joyboy is that caller: the model reads the sentence and picks the forecast
// tool, and re-testing its choice against sixteen Thai words could only overrule
// it — "อาทิตย์ถัดไปน่าจะขายได้เท่าไหร่" is plainly about the future and matches
// none of them, so the tool was dropped and the owner got a history answer to a
// question about next week. The model decides what was meant; this decides what
// the numbers are.
func (s *AIService) buildSalesForecastAnswer(restaurantID uint) (*AIAskResponse, bool, error) {
	if s.repo == nil {
		return nil, false, nil
	}

	now := repository.BangkokNow()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	since := now.AddDate(0, 0, -120)
	rows, err := s.repo.RecentSalesSummary(restaurantID, since)
	if err != nil {
		return nil, false, err
	}
	points := finishedDaysOnly(forecastPointsFromRows(rows), today)

	if len(points) < forecastMinPoints {
		return &AIAskResponse{
			Answer:   fmt.Sprintf("ข้อมูลยอดขายยังน้อยเกินไป (มี %d วัน ต้องการอย่างน้อย ~%d วัน) ผมเลยยังทำนายให้แม่นไม่ได้ครับ", len(points), forecastMinPoints),
			Intent:   AIIntentAnalysis,
			Task:     AITaskRecommendAction,
			Model:    "local-forecast",
			Snapshot: AISnapshot{},
		}, true, nil
	}

	// Forecast the days AFTER today, not after the last data point — "สัปดาห์หน้า"
	// means the coming week. When the data is stale (a demo DB that stopped days
	// ago) this reaches across the gap, so the staleness is stated plainly.
	lastData := points[len(points)-1].date
	anchor := today
	if lastData.After(anchor) {
		anchor = lastData
	}

	// Operating calendar: only the days explicitly marked closed. Nothing writes
	// these rules today, so in practice every day reads as open — see ai_calendar.go.
	// A read failure just means "no rules" → everything open, never a broken
	// forecast. Unmarked days are treated as open by design.
	rules, _ := s.repo.OperatingCalendarRules(restaurantID)
	cal := buildOperatingCalendar(rules)

	result := buildForecast(points, cal, anchor, forecastHorizonDays, forecastBacktestDays)
	if staleDays := int(today.Sub(lastData).Hours() / 24); staleDays > 0 {
		result.StaleDays = staleDays
	}

	answer := formatForecastAnswer(result)
	if result.StaleDays > 2 {
		answer = fmt.Sprintf(
			"หมายเหตุ: ข้อมูลล่าสุดคือ %s (เก่ากว่าวันนี้ %d วัน) การทำนายจึงอิงข้อมูลชุดนั้น ความแม่นอาจลดลงครับ\n\n%s",
			formatThaiDate(lastData.Format("2006-01-02")), result.StaleDays, answer)
	}

	return &AIAskResponse{
		Answer:   answer,
		Intent:   AIIntentAnalysis,
		Task:     AITaskRecommendAction,
		Model:    "local-forecast",
		Forecast: &result,
		Snapshot: AISnapshot{},
	}, true, nil
}

// forecastPointsFromRows parses the daily rows into an ascending time series.
func forecastPointsFromRows(rows []repository.AISalesSummary) []forecastDailyPoint {
	loc := bangkokLocation()
	pts := make([]forecastDailyPoint, 0, len(rows))
	for _, r := range rows {
		d, err := time.ParseInLocation("2006-01-02", r.OrderDate, loc)
		if err != nil {
			continue
		}
		pts = append(pts, forecastDailyPoint{date: d, rev: r.Revenue})
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].date.Before(pts[j].date) })
	return pts
}

// finishedDaysOnly drops today and anything after it. The sales query reads up
// to this second, so asked at noon today's row holds half a day — and it was the
// newest same-weekday point for next week's forecast and the newest day in the
// trend window, pulling both down as if the shop had a bad day (found
// 22 ก.ย. 2569). A day the shop is still open counts once it is over.
func finishedDaysOnly(points []forecastDailyPoint, today time.Time) []forecastDailyPoint {
	kept := points[:0:0]
	for _, p := range points {
		if p.date.Before(today) {
			kept = append(kept, p)
		}
	}
	return kept
}

// forecastDay predicts one day's revenue from history strictly before it.
func forecastDay(history []forecastDailyPoint, target time.Time) (float64, bool) {
	sameDow := make([]float64, 0, forecastSameWeekdayK)
	for i := len(history) - 1; i >= 0; i-- {
		p := history[i]
		if !p.date.Before(target) {
			continue
		}
		if p.date.Weekday() == target.Weekday() {
			sameDow = append(sameDow, p.rev)
			if len(sameDow) >= forecastSameWeekdayK {
				break
			}
		}
	}

	var base float64
	switch {
	case len(sameDow) >= 2:
		base = meanFloats(sameDow)
	default:
		base = meanInWindow(history, target.AddDate(0, 0, -forecastTrendDays), target)
	}
	if base <= 0 {
		return 0, false
	}
	return base * trendFactor(history, target), true
}

// trendFactor is recent vs previous two-week average, clamped so it can only
// nudge the seasonal baseline, never run away on thin data.
func trendFactor(history []forecastDailyPoint, target time.Time) float64 {
	recent := meanInWindow(history, target.AddDate(0, 0, -forecastTrendDays), target)
	prior := meanInWindow(history, target.AddDate(0, 0, -2*forecastTrendDays), target.AddDate(0, 0, -forecastTrendDays))
	if recent <= 0 || prior <= 0 {
		return 1
	}
	return math.Max(forecastTrendClampLo, math.Min(forecastTrendClampHi, recent/prior))
}

func meanInWindow(history []forecastDailyPoint, start, end time.Time) float64 {
	var sum float64
	var n int
	for _, p := range history {
		if !p.date.Before(start) && p.date.Before(end) {
			sum += p.rev
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

func meanFloats(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var s float64
	for _, x := range xs {
		s += x
	}
	return s / float64(len(xs))
}

// backtestForecast walks forward over the last holdoutDays, forecasting each day
// from only the days before it, and measures the error — the honest way to know
// whether the model is any good on THIS shop's data.
func backtestForecast(points []forecastDailyPoint, holdoutDays int) (mape, mae float64, n int) {
	start := len(points) - holdoutDays
	if start < 1 {
		start = 1
	}
	var sumAPE, sumAE float64
	for i := start; i < len(points); i++ {
		actual := points[i].rev
		pred, ok := forecastDay(points[:i], points[i].date)
		if !ok || actual <= 0 {
			continue
		}
		sumAPE += math.Abs(actual-pred) / actual
		sumAE += math.Abs(actual - pred)
		n++
	}
	if n == 0 {
		return 0, 0, 0
	}
	return sumAPE / float64(n) * 100, sumAE / float64(n), n
}

func buildForecast(points []forecastDailyPoint, cal operatingCalendar, anchor time.Time, horizon, holdout int) AIForecastResult {
	mape, mae, n := backtestForecast(points, holdout)

	band := mape / 100
	if band <= 0 || n < 5 {
		band = forecastFallbackBand
	}

	forecast := make([]AIForecastPoint, 0, horizon)
	for i := 1; i <= horizon; i++ {
		target := anchor.AddDate(0, 0, i)
		// A closed day sells nothing — say so instead of predicting a number.
		if !cal.isOpen(target) {
			forecast = append(forecast, AIForecastPoint{
				Date:    target.Format("2006-01-02"),
				Weekday: thaiWeekdayName(int(target.Weekday())),
				Closed:  true,
			})
			continue
		}
		pred, ok := forecastDay(points, target)
		if !ok {
			continue
		}
		forecast = append(forecast, AIForecastPoint{
			Date:      target.Format("2006-01-02"),
			Weekday:   thaiWeekdayName(int(target.Weekday())),
			Predicted: pred,
			Lower:     math.Max(0, pred*(1-band)),
			Upper:     pred * (1 + band),
		})
	}

	// A tail of history for the chart to draw the line the forecast continues.
	histStart := 0
	if len(points) > 28 {
		histStart = len(points) - 28
	}
	history := make([]AIForecastHistoryPoint, 0, len(points)-histStart)
	for _, p := range points[histStart:] {
		history = append(history, AIForecastHistoryPoint{Date: p.date.Format("2006-01-02"), Actual: p.rev})
	}

	return AIForecastResult{
		History:    history,
		Forecast:   forecast,
		MAPE:       mape,
		MAE:        mae,
		BacktestN:  n,
		SampleDays: len(points),
	}
}

func formatForecastAnswer(r AIForecastResult) string {
	if len(r.Forecast) == 0 {
		return "ยังทำนายไม่ได้ครับ — ข้อมูลไม่พอให้จับรูปแบบรายวัน"
	}
	var b strings.Builder
	// The frontend renderer (AIResponseContent) understands **bold**, "---" rules
	// and emoji, so the answer is laid out for scanning: title, one line per day,
	// a rule, then the accuracy and the warning — the two things that matter most.
	b.WriteString("📈 **คาดการณ์ยอดขาย 7 วันข้างหน้า**\n")
	b.WriteString("อิงค่าเฉลี่ยยอดขายรายวันในสัปดาห์ + แนวโน้มล่าสุด")
	for _, f := range r.Forecast {
		if f.Closed {
			b.WriteString(fmt.Sprintf("\n- **%s %s** — ร้านปิด 🔒", formatThaiDate(f.Date), f.Weekday))
			continue
		}
		// A forecast is an estimate — whole baht, no fake ".00" precision.
		b.WriteString(fmt.Sprintf("\n- **%s %s** — ประมาณ %s บาท (ช่วง %s–%s)",
			formatThaiDate(f.Date), f.Weekday, formatBaht(f.Predicted), formatBaht(f.Lower), formatBaht(f.Upper)))
	}
	b.WriteString("\n\n---\n")
	if r.BacktestN >= 5 {
		b.WriteString(fmt.Sprintf("\n🎯 **ความแม่น** — ทดสอบย้อนหลัง %d วัน พลาดเฉลี่ย ±%.0f%% (±%s บาท)", r.BacktestN, r.MAPE, formatBaht(r.MAE)))
	} else {
		b.WriteString("\n🎯 **ความแม่น** — ข้อมูลยังไม่พอทดสอบให้ชัด ใช้ช่วงกว้างไว้ก่อน")
	}
	b.WriteString("\n\n⚠️ นี่คือการ \"คาดการณ์\" ไม่ใช่ตัวเลขจริง — ใช้เป็นแนวทางวางแผน อย่ายึดเป็นคำมั่นครับ")
	return b.String()
}

// formatBaht renders an estimated amount as whole baht with thousand separators.
// Forecasts carry no real sub-baht precision, so the ".00" of formatMoney would
// be a lie about how exact the number is.
func formatBaht(value float64) string {
	return formatInt(int64(math.Round(value)))
}
