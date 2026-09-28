package service

import (
	"fmt"
	"strings"
	"time"

	"Project-M/internal/repository"
)

// Store-wide profit for a period.
//
// "กำไรรวมเดือนนี้เท่าไหร่" asks for one aggregate number, but the assistant only
// had per-menu margin rankings, so the router mislabelled it as a menu ranking
// and answered the wrong thing. This computes the store total straight from the
// same costed order data the margin tools use.
//
// Cost comes from a LEFT JOIN, so a menu with no recipe reports zero cost and a
// misleading 100% margin. Summing blindly would overstate profit, so the answer
// reports how much of the revenue is actually cost-tracked and warns when that
// coverage is partial — an honest number beats a flattering one.

// isTotalProfitQuestion matches a store-wide profit total, deliberately leaving
// per-menu profit ("เมนูไหนกำไรน้อยสุด") and margin rankings to their own tools.
func isTotalProfitQuestion(question string) bool {
	n := strings.ToLower(strings.TrimSpace(question))
	if !containsAny(n, "กำไร", "profit", "net income") {
		return false
	}
	// A named item makes this a per-menu ranking, not a store total.
	if containsAny(n, "เมนู", "จาน", "menu", "dish", "อันไหน", "ตัวไหน", "รายการไหน") {
		return false
	}
	// Superlatives and the margin-ranking phrasings belong to the margin tools
	// (see ai_backstop.go), so this flow must not steal them.
	if containsAny(n,
		"น้อยสุด", "ต่ำสุด", "มากสุด", "สูงสุด", "ดีสุด", "แย่สุด",
		"น้อยที่สุด", "ต่ำที่สุด", "มากที่สุด", "สูงที่สุด", "ดีที่สุด",
		"กำไรน้อย", "กำไรต่ำ", "กำไรดี", "กำไรสูง", "กำไรมาก",
		"worst", "best", "highest", "lowest", "margin", "มาร์จิ้น") {
		return false
	}
	// A store total is signalled by an aggregate word, an amount question, or a
	// named period ("กำไรเดือนกรกฎาคม").
	if containsAny(n, "รวม", "ทั้งหมด", "สุทธิ", "เท่าไหร่", "เท่าไร", "กี่บาท",
		"total", "net", "สรุป") {
		return true
	}
	return len(extractPeriods(question, repository.BangkokNow())) > 0
}

// answerTotalProfitQuery returns revenue − cost for the requested period. It
// returns handled=false for anything that is not a store-wide profit total, so
// the caller falls through to the normal flow.
func (s *AIService) answerTotalProfitQuery(restaurantID uint, question string) (*AIAskResponse, bool, error) {
	if s.repo == nil || !isTotalProfitQuestion(question) {
		return nil, false, nil
	}

	now := repository.BangkokNow()
	start, end, label, explicit := profitPeriod(question, now)

	rows, err := s.repo.MenuMetricsForRange(restaurantID, start, end)
	if err != nil {
		return nil, false, err
	}

	var revenue, cost, profit, costedRevenue float64
	for _, m := range rows {
		revenue += m.Revenue
		cost += m.Cost
		profit += m.Profit
		if m.Cost > 0 {
			costedRevenue += m.Revenue
		}
	}

	var answer string
	switch {
	case revenue == 0:
		answer = fmt.Sprintf("%s ยังไม่มีรายการขายที่ปิดบิลครับ", label)
		// A specific empty period (e.g. "เดือนนี้" before the month has any sales)
		// is a dead end, so offer the rolling-window figure instead of stopping.
		if explicit {
			if fb, ok := s.rollingProfit(restaurantID, now); ok {
				answer += "\n\n" + fb
			}
		}
	default:
		answer = fmt.Sprintf("กำไร%s ประมาณ %s บาทครับ\n- รายได้จากเมนู %s บาท\n- ต้นทุนวัตถุดิบ %s บาท",
			label, formatMoney(profit), formatMoney(revenue), formatMoney(cost))
		if coverage := costedRevenue / revenue; coverage < 0.99 {
			answer += fmt.Sprintf(
				"\n\n(ตัวเลขนี้อิงจากเมนูที่มีข้อมูลต้นทุนราว %.0f%% ของยอดขาย ส่วนที่เหลือยังไม่ได้ผูกต้นทุน กำไรจริงอาจต่ำกว่านี้ครับ)",
				coverage*100)
		}
	}

	hinted, assumed := appendScopeHint(question, answer, false)
	return &AIAskResponse{
		Answer:       hinted,
		ScopeAssumed: assumed,
		Intent:       AIIntentAnalysis,
		Task:         AITaskRetrieveFact,
		Model:        "local-total-profit",
		Snapshot:     AISnapshot{},
	}, true, nil
}

// profitPeriod resolves the window a profit/quantity question is about, from the
// most specific scope to the least: a specific date, then "วันนี้"/"เมื่อวาน", then
// a named or relative month, and finally the rolling 30-day default. explicit
// reports whether the text named the period, so an empty explicit period can be
// softened with a rolling-window fallback.
func profitPeriod(question string, now time.Time) (start, end time.Time, label string, explicit bool) {
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	n := strings.ToLower(question)

	if day, ok := extractSpecificDate(question, now); ok {
		return day.Start, day.End, day.Label, true
	}
	switch {
	case containsAny(n, "วันนี้", "today"):
		return today, today.AddDate(0, 0, 1), "วันนี้", true
	case containsAny(n, "เมื่อวาน", "วานนี้", "yesterday"):
		return today.AddDate(0, 0, -1), today, "เมื่อวาน", true
	}
	if periods := extractPeriods(question, now); len(periods) > 0 {
		return periods[0].Start, periods[0].End, periods[0].Label, true
	}
	end = today.AddDate(0, 0, 1)
	start = end.AddDate(0, 0, -30)
	return start, end, "ช่วง 30 วันล่าสุด", false
}

// rollingProfit is the last-30-days profit line offered when the asked-for period
// has no sales yet.
func (s *AIService) rollingProfit(restaurantID uint, now time.Time) (string, bool) {
	loc := now.Location()
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	start := end.AddDate(0, 0, -30)
	rows, err := s.repo.MenuMetricsForRange(restaurantID, start, end)
	if err != nil {
		return "", false
	}
	var revenue, cost, profit float64
	for _, m := range rows {
		revenue += m.Revenue
		cost += m.Cost
		profit += m.Profit
	}
	if revenue == 0 {
		return "", false
	}
	return fmt.Sprintf("ถ้าดูช่วง 30 วันล่าสุด กำไรประมาณ %s บาทครับ (รายได้จากเมนู %s, ต้นทุนวัตถุดิบ %s)",
		formatMoney(profit), formatMoney(revenue), formatMoney(cost)), true
}
