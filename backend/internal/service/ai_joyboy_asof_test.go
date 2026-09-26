package service

import (
	"strings"
	"testing"
	"time"

	"Project-M/internal/aitools"
	"Project-M/internal/repository"
)

// A window that reaches past this minute is queried only up to this minute.
// The demo data is written a day at a time, so "สัปดาห์นี้" at 20:21 counted
// three bills that close at 20:24, 20:41 and 21:12 while the sheet said
// "ยอดจนถึงตอนนี้". A window already in the past is untouched.
func TestJoyboyQueryEndStopsAtNow(t *testing.T) {
	now := repository.BangkokNow()
	future := now.Add(3 * time.Hour)
	if got := joyboyQueryEnd(future); got.After(now.Add(time.Second)) {
		t.Errorf("a window ending in the future was queried to %s, not now", got)
	}
	past := now.Add(-48 * time.Hour)
	if got := joyboyQueryEnd(past); !got.Equal(past) {
		t.Errorf("a window already over was moved from %s to %s", past, got)
	}
}

// Fractions of a day are arithmetic, not an answer: the sheet labels them in
// words so the reply never says "0.11 วัน".
func TestJoyboyDaysLeftLabel(t *testing.T) {
	for _, tc := range []struct {
		days float64
		want string
	}{
		{0, "หมดแล้ว"},
		{0.11, "หมดภายในวันนี้"},
		{0.99, "หมดภายในวันนี้"},
		{1.4, "พอถึงพรุ่งนี้"},
		{3.7, "พออีกประมาณ 3 วัน"},
		{16, "พออีกประมาณ 16 วัน (2 สัปดาห์)"},
	} {
		if got := joyboyDaysLeftLabel(tc.days); got != tc.want {
			t.Errorf("days_left=%v → %q, want %q", tc.days, got, tc.want)
		}
	}
}

// The risk list is capped at twelve; the count on the sheet must be the
// shelf's. With fifteen below minimum and twelve listed, the sheet says both
// and tells the model which number answers "กี่ตัว".
func TestJoyboyLowStockSheetCountsTheWholeShelf(t *testing.T) {
	risks := make([]aitools.AIStockRisk, 0, 12)
	for i := 0; i < 12; i++ {
		risks = append(risks, aitools.AIStockRisk{Name: "ของ" + string(rune('A'+i)), Unit: "กรัม", Status: "low", MinStock: 100, RestockEstimate: 50, CostPerUnit: 2})
	}
	body, ok := joyboyFactBody(AIToolResult{
		Tool:                AIToolGetLowStockIngredients,
		LowStockIngredients: risks,
		InventoryValuation:  &aitools.AIInventorySummary{LowItems: 13, OutItems: 2},
	})
	if !ok {
		t.Fatal("low stock sheet not produced")
	}
	if !strings.Contains(body, "items_below_minimum=15 listed=12") {
		t.Errorf("sheet does not carry the true total beside the listed count:%s%s", "\n", body)
	}
	if !strings.Contains(body, "ถ้าถามจำนวนให้ตอบ 15") {
		t.Errorf("sheet does not say which count answers the question:%s%s", "\n", body)
	}

	// Gone and running low are said apart: given only the total, the model
	// called all twenty-six "หมดแล้ว" when one still had stock.
	if !strings.Contains(body, "out_of_stock=2 running_low=13") {
		t.Errorf("sheet does not split out-of-stock from running low: %s", body)
	}

	// Without the summary the list is all there is, and the sheet says so
	// plainly rather than inventing a bigger number.
	body, _ = joyboyFactBody(AIToolResult{Tool: AIToolGetLowStockIngredients, LowStockIngredients: risks[:3]})
	if !strings.Contains(body, "items_below_minimum=3 listed=3") || strings.Contains(body, "เร่งด่วนสุด") {
		t.Errorf("a full list must not claim a cap:%s%s", "\n", body)
	}
}

// The date the answer is written on reaches the writer in the owner's words,
// weekday first — "สัปดาห์ก่อน" is counted from the weekday.
func TestThaiDateWithWeekday(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Bangkok")
	if got := thaiDateWithWeekday(time.Date(2026, 9, 6, 20, 0, 0, 0, loc)); got != "วันอาทิตย์ที่ 6 กันยายน 2569" {
		t.Errorf("got %q", got)
	}
}

// The writer is told which days this week and last week are, Monday to Sunday,
// so it never works them out itself — on a Sunday it once started the week on
// that same Sunday.
func TestJoyboyTodayContextSpellsOutBothWeeks(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Bangkok")
	sunday := time.Date(2026, 9, 6, 20, 0, 0, 0, loc)
	got := joyboyTodayContext(sunday)
	for _, want := range []string{
		"วันอาทิตย์ที่ 6 กันยายน 2569",
		"สัปดาห์นี้ (จันทร์–อาทิตย์) = 31 สิงหาคม 2569 ถึง 6 กันยายน 2569",
		"สัปดาห์ก่อน = 24 สิงหาคม 2569 ถึง 30 สิงหาคม 2569",
		"7 วันล่าสุด (รวมวันนี้) = 31 สิงหาคม 2569 ถึง 6 กันยายน 2569",
		"7 วันก่อนหน้านั้น = 24 สิงหาคม 2569 ถึง 30 สิงหาคม 2569",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("context missing %q:%s%s", want, "\n", got)
		}
	}
	// A Monday is the first day of its own week, not the last of the previous.
	thisMonday, lastMonday := joyboyWeekStarts(time.Date(2026, 9, 7, 9, 0, 0, 0, loc))
	if thisMonday.Day() != 7 || lastMonday.Day() != 31 {
		t.Errorf("week starts on a Monday: this=%s last=%s", thisMonday.Format("2006-01-02"), lastMonday.Format("2006-01-02"))
	}
}
