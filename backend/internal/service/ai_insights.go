package service

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"
)

// Proactive Insights — the "things you should know today" an owner sees without
// asking. Every card is computed deterministically in Go from the snapshot (never
// from an LLM), so the figures are exact and never hallucinated. This is the step
// from a reactive Q&A box to an assistant that watches the shop for you.

// AIInsight is one proactive card. Metric is a short, punchy value ("พออีก 1 วัน",
// "-50%") shown prominently so the card is scannable at a glance; Detail is the
// fuller one-line explanation shown smaller beneath it.
type AIInsight struct {
	Kind     string `json:"kind"`     // ingredient_low | sales_drop | sales_up | plowhorse | dead_stock
	Severity string `json:"severity"` // critical | warning | info
	Title    string `json:"title"`
	Metric   string `json:"metric"`
	Detail   string `json:"detail"`

	// Items is set when several facts of one kind are folded into a single card.
	// Seven ingredients at zero used to be three identical-looking cards — the cap
	// hid the other four, and the three that showed pushed the sales and margin
	// cards off a five-card panel. One card says how many there really are and
	// carries the rest inside, so the panel keeps room for the other kinds.
	// Empty for an ordinary one-fact card, which is most of them.
	Items []AIInsightItem `json:"items,omitempty"`
	// More counts the rows past what Items carries, so a shop with a very long
	// list is never told it has fewer problems than it does.
	More int `json:"more,omitempty"`
}

// AIInsightItem is one row inside a folded card: the thing, and its figures.
// Name is the bare thing ("ไก่สับ"); Title is that plus its situation
// ("ไก่สับ หมดสต๊อกแล้ว"). The collapsed card previews names, the opened one
// shows titles — splitting them here keeps the client from parsing a sentence.
type AIInsightItem struct {
	Name   string `json:"name"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// A card is read in about three seconds, so its figures are rounded to what the
// owner would say out loud. "1,059 กรัม" is a shelf quantity; "1059.23 กรัม" is a
// database row, and "0.00" reads as a formatting bug rather than as empty.
// Anything under ten keeps one decimal, where the fraction is still the point.
func insightQty(value float64, unit string) string {
	number := formatInt(int64(math.Round(value)))
	if value > 0 && value < 10 {
		number = strconv.FormatFloat(math.Round(value*10)/10, 'f', -1, 64)
	}
	if unit == "" {
		return number
	}
	return number + " " + unit
}

// insightBaht states whole baht. formatMoney keeps two decimals, which is right
// in an answer that has to reconcile to the ledger and wrong on a glanceable
// card, where ".00" is four characters of noise on every row.
func insightBaht(value float64) string {
	return "฿" + formatInt(int64(math.Round(value)))
}

const (
	insightSalesChangePct       = 10.0 // flag a weekly move of at least this %
	insightReorderDaysThreshold = 3.0  // flag ingredients with this many days left or fewer
	insightMaxPerKind           = 3    // cap one kind so it cannot bury the others
	insightMaxCards             = 5
	// Rows carried inside a folded card. Past this the card says "and N more"
	// rather than growing without end.
	insightMaxFoldedRows = 8
)

// computeProactiveInsights surfaces the few most actionable facts, most urgent
// first, capped at insightMaxCards.
func computeProactiveInsights(snapshot AISnapshot) []AIInsight {
	insights := make([]AIInsight, 0, insightMaxCards)

	// 1) Ingredients about to run out — the most operationally urgent. Capped so a
	// shop that is low on many items does not bury every other kind of insight.
	// Collect every ingredient that is urgent, then decide how to present them.
	// The old code stopped after three, which made the count on screen a property
	// of the cap rather than of the shop.
	type urgentStock struct {
		name       string
		title      string
		detail     string
		outOfStock bool
		critical   bool
	}
	// ComputeReorderForecast keeps only the eight soonest to run out, which is the
	// right size for a tool answer and the wrong number to count from: a shop with
	// twelve empty shelves would be told it had eight. The headline counts the
	// whole shelf list; the rows below it come from the ranked, capped forecast.
	urgentTotal := 0
	for _, u := range snapshot.IngredientUsage {
		if u.Used <= 0 {
			continue
		}
		dailyUse := u.Used / analysisWindowDays
		if dailyUse <= 0 {
			continue
		}
		if u.Stock/dailyUse <= insightReorderDaysThreshold {
			urgentTotal++
		}
	}

	urgent := make([]urgentStock, 0, 8)
	for _, it := range computeReorderForecast(snapshot.IngredientUsage) {
		if it.DaysLeft > insightReorderDaysThreshold {
			continue
		}
		// The headline has to say which of three different situations this is.
		// "ใกล้หมด" over a shelf that is already empty is wrong, and it was the
		// wording every out-of-stock ingredient got.
		title := fmt.Sprintf("%s พอใช้อีก %.0f วัน", it.Name, it.DaysLeft)
		switch {
		case it.Stock <= 0:
			title = fmt.Sprintf("%s หมดสต๊อกแล้ว", it.Name)
		case it.DaysLeft < 1:
			title = fmt.Sprintf("%s จะหมดภายในวันนี้", it.Name)
		}
		urgent = append(urgent, urgentStock{
			name:  it.Name,
			title: title,
			// The headline already carries the time left, so the figures line
			// carries what is on the shelf and how fast it goes — the two numbers
			// an owner needs to decide how much to order.
			detail:     "เหลือ " + insightQty(it.Stock, it.Unit) + " · ใช้เฉลี่ย " + insightQty(it.DailyUse, it.Unit) + "/วัน",
			outOfStock: it.Stock <= 0,
			critical:   it.DaysLeft <= 1,
		})
	}

	switch {
	case urgentTotal == 1 && len(urgent) == 1:
		// One ingredient reads better as itself than as a group of one.
		only := urgent[0]
		severity := "warning"
		if only.critical {
			severity = "critical"
		}
		insights = append(insights, AIInsight{
			Kind:     "ingredient_low",
			Severity: severity,
			Title:    only.title,
			Detail:   only.detail,
		})
	case urgentTotal > 1:
		outCount, anyCritical := 0, false
		for _, u := range urgent {
			if u.outOfStock {
				outCount++
			}
			if u.critical {
				anyCritical = true
			}
		}
		// Name the situation the owner is actually in. "ใกล้หมด" over seven empty
		// shelves understates it; "หมดสต๊อก" over a mixed list overstates it.
		title := fmt.Sprintf("วัตถุดิบ %d อย่างใกล้หมด", urgentTotal)
		detail := ""
		switch {
		// The out/low split can only be read from the rows we actually have, so it
		// is stated only when those rows are the whole list.
		case outCount == urgentTotal:
			title = fmt.Sprintf("วัตถุดิบ %d อย่างหมดสต๊อก", urgentTotal)
		case outCount > 0 && len(urgent) == urgentTotal:
			title = fmt.Sprintf("วัตถุดิบ %d อย่างต้องเติม", urgentTotal)
			detail = fmt.Sprintf("หมดแล้ว %d · ใกล้หมด %d", outCount, urgentTotal-outCount)
		case outCount > 0:
			title = fmt.Sprintf("วัตถุดิบ %d อย่างต้องเติม", urgentTotal)
		}
		severity := "warning"
		if anyCritical {
			severity = "critical"
		}
		rows := urgent
		if len(rows) > insightMaxFoldedRows {
			rows = rows[:insightMaxFoldedRows]
		}
		// Everything the card could not list, whether the forecast dropped it or
		// the fold cap did. Silence here would read as "that is all of them".
		more := urgentTotal - len(rows)
		items := make([]AIInsightItem, 0, len(rows))
		for _, r := range rows {
			items = append(items, AIInsightItem{Name: r.name, Title: r.title, Detail: r.detail})
		}
		insights = append(insights, AIInsight{
			Kind:     "ingredient_low",
			Severity: severity,
			Title:    title,
			Detail:   detail,
			Items:    items,
			More:     more,
		})
	}

	// 2) Weekly sales anomaly (7 days vs the prior 7 days).
	if snapshot.AnalysisReadiness.CanAnalyzeRevenue {
		trend := computeSalesTrendAsOf(snapshot.SalesDays, snapshotDateKey(snapshot.GeneratedAt))
		// The card names its days. It leaves today out (a day still open), so
		// its "7 วันล่าสุด" was 19–25 ก.ย. while the chat's, which counts today,
		// was 20–26 - two different totals under one name on the same screen
		// (26 ก.ย. 2569). Dates make both true and visibly so.
		recentDays := insightDayRange(trend.RecentEnd.AddDate(0, 0, -6), trend.RecentEnd)
		priorDays := insightDayRange(trend.RecentEnd.AddDate(0, 0, -13), trend.RecentEnd.AddDate(0, 0, -7))
		if trend.HasPrior {
			switch {
			case trend.RevenueChangePct <= -insightSalesChangePct:
				insights = append(insights, AIInsight{
					Kind:     "sales_drop",
					Severity: "warning",
					Title:    fmt.Sprintf("ยอดขาย 7 วัน (%s) ตกลง %.0f%%", recentDays, -trend.RevenueChangePct),
					Metric:   insightBaht(trend.RecentRevenue),
					Detail:   fmt.Sprintf("เทียบ %s %s", priorDays, insightBaht(trend.PriorRevenue)),
				})
			case trend.RevenueChangePct >= insightSalesChangePct:
				insights = append(insights, AIInsight{
					Kind:     "sales_up",
					Severity: "info",
					Title:    fmt.Sprintf("ยอดขาย 7 วัน (%s) โตขึ้น %.0f%%", recentDays, trend.RevenueChangePct),
					Metric:   insightBaht(trend.RecentRevenue),
					Detail:   fmt.Sprintf("เทียบ %s %s", priorDays, insightBaht(trend.PriorRevenue)),
				})
			}
		}
	}

	// 3) Plowhorse — a popular menu with a thin margin (fix cost or price).
	if snapshot.AnalysisReadiness.CanAnalyzeMargin {
		if eng := computeMenuEngineering(snapshot.AllMenuMargins); len(eng.Plowhorses) > 0 {
			insights = append(insights, AIInsight{
				Kind:     "plowhorse",
				Severity: "info",
				Title:    fmt.Sprintf("%s ขายดีแต่ได้กำไรน้อย", eng.Plowhorses[0]),
				Metric:   "",
				Detail:   "ทบทวนต้นทุนหรือปรับราคาเพื่อเพิ่มกำไรรวม",
			})
		}
	}

	// 4) Dead stock — cash tied up in ingredients that are not moving.
	if dead := computeDeadStock(snapshot.IngredientUsage); len(dead) > 0 {
		top := dead[0]
		insights = append(insights, AIInsight{
			Kind:     "dead_stock",
			Severity: "info",
			Title:    fmt.Sprintf("%s ไม่ถูกใช้เลยใน %s", top.Name, analysisWindowLabel()),
			Metric:   insightBaht(top.Value) + " จม",
			Detail:   fmt.Sprintf("คงเหลือ %s", insightQty(top.Stock, top.Unit)),
		})
	}

	sort.SliceStable(insights, func(i, j int) bool {
		return severityRank(insights[i].Severity) < severityRank(insights[j].Severity)
	})
	if len(insights) > insightMaxCards {
		insights = insights[:insightMaxCards]
	}
	return insights
}

func severityRank(severity string) int {
	switch severity {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

// ProactiveInsightsForOwner builds the snapshot and returns the deterministic
// insight cards for the owner's restaurant.
func (s *AIService) ProactiveInsightsForOwner(actor AIActorContext) ([]AIInsight, error) {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return nil, errors.New("authenticated restaurant owner context is required")
	}
	snapshot, err := s.buildSnapshot(actor.RestaurantID)
	if err != nil {
		return nil, err
	}
	// The owner can switch each kind off in settings. Filtered here, after the
	// cards are computed, so the severity ordering and the caps inside
	// computeProactiveInsights stay exactly what they are.
	prefs := s.preferencesFor(actor.RestaurantID)
	insights := computeProactiveInsights(snapshot)
	kept := insights[:0]
	for _, insight := range insights {
		if prefs.InsightKindShown(insight.Kind) {
			kept = append(kept, insight)
		}
	}
	return kept, nil
}

// insightDayRange writes a span of days short, the way a card has room for:
// "19–25 ก.ย.", or "30 ส.ค.–5 ก.ย." when it crosses a month.
func insightDayRange(from, to time.Time) string {
	months := [...]string{"ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."}
	if from.Month() == to.Month() {
		return fmt.Sprintf("%d–%d %s", from.Day(), to.Day(), months[to.Month()-1])
	}
	return fmt.Sprintf("%d %s–%d %s", from.Day(), months[from.Month()-1], to.Day(), months[to.Month()-1])
}
