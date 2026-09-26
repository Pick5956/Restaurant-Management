package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"Project-M/internal/repository"
)

func readySnapshot() AISnapshot {
	return AISnapshot{AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
		SalesItems: 25, MarginItems: 25, CostedMarginItems: 25, SoldMenus: 8, SoldMenusWithRecipes: 8,
	})}
}

// An ingredient running out within the threshold produces an urgent card first.
func TestProactiveInsightsFlagsRunningOutIngredient(t *testing.T) {
	snap := readySnapshot()
	// Used 15000/30 days = 500/day; 500 in stock => ~1 day left => critical.
	snap.IngredientUsage = []repository.AIIngredientUsage{
		{Name: "กุ้งสด", Unit: "กรัม", Stock: 500, Used: 15000, CostPerUnit: 0.5},
	}
	insights := computeProactiveInsights(snap)
	if len(insights) == 0 || insights[0].Kind != "ingredient_low" {
		t.Fatalf("expected an ingredient_low insight first, got %+v", insights)
	}
	if insights[0].Severity != "critical" || !strings.Contains(insights[0].Title, "กุ้งสด") {
		t.Fatalf("running-out ingredient card wrong: %+v", insights[0])
	}
}

// A sharp weekly drop is surfaced as a warning.
func TestProactiveInsightsFlagsSalesDrop(t *testing.T) {
	snap := readySnapshot()
	base := time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC) // 7 prior days, then 7 recent
	days := make([]repository.AISalesSummary, 0, 14)
	for i := 0; i < 14; i++ {
		revenue := 4000.0
		if i >= 7 {
			revenue = 2000.0 // recent week halved
		}
		days = append(days, repository.AISalesSummary{
			OrderDate: base.AddDate(0, 0, i).Format("2006-01-02"), Orders: 30, Revenue: revenue,
		})
	}
	snap.SalesDays = days
	found := false
	for _, in := range computeProactiveInsights(snap) {
		if in.Kind == "sales_drop" {
			found = true
		}
	}
	if !found {
		t.Fatal("a 50% weekly drop should produce a sales_drop insight")
	}
}

// A healthy shop (no risks) produces no noisy cards.
func TestProactiveInsightsQuietWhenHealthy(t *testing.T) {
	if got := computeProactiveInsights(readySnapshot()); len(got) != 0 {
		t.Fatalf("healthy snapshot should have no insights, got %+v", got)
	}
}

// A card is a notice, not a chat reply: it states the fact in one line, rounds
// its figures to what an owner would say out loud, and carries no chat particle.
// The old copy said "ใกล้หมด" over an empty shelf, printed "0.00 กรัม" and
// "1059.23 กรัม/วัน", and ended in "ครับ".
func TestInsightCardsReadAsNoticesNotChat(t *testing.T) {
	snap := readySnapshot()
	snap.IngredientUsage = []repository.AIIngredientUsage{
		// Empty shelf, still being used: 31,776/30 days ≈ 1,059 per day.
		{Name: "ไก่สับ", Unit: "กรัม", Stock: 0, Used: 31776, CostPerUnit: 0.12},
	}
	insights := computeProactiveInsights(snap)
	if len(insights) == 0 {
		t.Fatal("an ingredient at zero stock should produce a card")
	}
	card := insights[0]

	// Already out is not "about to run out".
	if !strings.Contains(card.Title, "หมดสต๊อกแล้ว") {
		t.Errorf("an empty shelf should be stated as out of stock, got %q", card.Title)
	}
	joined := card.Title + " " + card.Metric + " " + card.Detail
	for _, noise := range []string{"ครับ", "ค่ะ", ".00", "0.00", "1059.23"} {
		if strings.Contains(joined, noise) {
			t.Errorf("card copy should not contain %q: %q", noise, joined)
		}
	}
	// The daily-use figure is rounded and separated: "1,059" not "1059.23".
	if !strings.Contains(card.Detail, "1,059") {
		t.Errorf("the daily-use figure should be rounded with separators, got %q", card.Detail)
	}
}

// Money on a card is whole baht with separators, and the headline carries the
// size of the move so the card can be understood without reading the figures.
func TestSalesDropCardStatesTheSizeInTheHeadline(t *testing.T) {
	snap := readySnapshot()
	base := time.Date(2026, 7, 25, 0, 0, 0, 0, time.UTC)
	days := make([]repository.AISalesSummary, 0, 14)
	for i := 0; i < 14; i++ {
		revenue := 4000.0
		if i >= 7 {
			revenue = 2000.0
		}
		days = append(days, repository.AISalesSummary{
			OrderDate: base.AddDate(0, 0, i).Format("2006-01-02"), Orders: 30, Revenue: revenue,
		})
	}
	snap.SalesDays = days
	for _, in := range computeProactiveInsights(snap) {
		if in.Kind != "sales_drop" {
			continue
		}
		if !strings.Contains(in.Title, "50%") {
			t.Errorf("the headline should carry the size of the drop, got %q", in.Title)
		}
		if strings.Contains(in.Metric+in.Detail, ".00") {
			t.Errorf("card money should be whole baht, got %q / %q", in.Metric, in.Detail)
		}
		if !strings.Contains(in.Metric, "฿") {
			t.Errorf("card money should be marked with ฿, got %q", in.Metric)
		}
		// The card names its days, so its "7 วัน" cannot be read as the chat's
		// (which counts today) and look like a contradiction.
		if !strings.Contains(in.Title, "1–7 ส.ค.") || !strings.Contains(in.Detail, "25–31 ก.ค.") {
			t.Errorf("the card should name both windows, got %q / %q", in.Title, in.Detail)
		}
		return
	}
	t.Fatal("a 50% weekly drop should produce a sales_drop insight")
}

func TestSeverityRankOrder(t *testing.T) {
	if !(severityRank("critical") < severityRank("warning") && severityRank("warning") < severityRank("info")) {
		t.Fatal("severity ranking must be critical < warning < info")
	}
}

// Seven ingredients at zero used to be three identical-looking cards: the cap
// hid the other four, and the three that showed pushed the sales and margin
// cards off a five-card panel. They fold into one card that states the real
// count and carries the rest inside.
func TestManyUrgentIngredientsFoldIntoOneCard(t *testing.T) {
	snap := readySnapshot()
	names := []string{"ไก่สับ", "คะน้า", "มะเขือ", "ข้าวคั่ว", "โซดา", "เห็ด", "ซีอิ๊วขาว"}
	for _, name := range names {
		// No stock at all, and it was being used — so every one is urgent.
		snap.IngredientUsage = append(snap.IngredientUsage, repository.AIIngredientUsage{
			Name: name, Unit: "กรัม", Stock: 0, Used: 3000, CostPerUnit: 0.2,
		})
	}
	insights := computeProactiveInsights(snap)

	stock := make([]AIInsight, 0, 1)
	for _, insight := range insights {
		if insight.Kind == "ingredient_low" {
			stock = append(stock, insight)
		}
	}
	if len(stock) != 1 {
		t.Fatalf("the urgent ingredients should occupy one card, got %d", len(stock))
	}
	card := stock[0]
	// The count is the shop's, not the cap's.
	if !strings.Contains(card.Title, "7") {
		t.Errorf("the folded card must state how many there really are: %q", card.Title)
	}
	if !strings.Contains(card.Title, "หมดสต๊อก") {
		t.Errorf("all seven are empty shelves, so the headline must say so: %q", card.Title)
	}
	if len(card.Items) != 7 || card.More != 0 {
		t.Fatalf("expected all 7 rows carried inside, got %d rows and more=%d", len(card.Items), card.More)
	}
	if card.Items[0].Title == "" || card.Items[0].Detail == "" {
		t.Errorf("each folded row needs its own name and figures: %+v", card.Items[0])
	}
	if card.Severity != "critical" {
		t.Errorf("an empty shelf is critical, got %q", card.Severity)
	}
}

// One urgent ingredient reads better as itself than as a group of one.
func TestASingleUrgentIngredientStaysItsOwnCard(t *testing.T) {
	snap := readySnapshot()
	snap.IngredientUsage = []repository.AIIngredientUsage{
		{Name: "กุ้งสด", Unit: "กรัม", Stock: 500, Used: 15000, CostPerUnit: 0.5},
	}
	insights := computeProactiveInsights(snap)
	if len(insights) == 0 || insights[0].Kind != "ingredient_low" {
		t.Fatalf("expected an ingredient_low card, got %+v", insights)
	}
	if len(insights[0].Items) != 0 {
		t.Errorf("a lone ingredient should not be folded: %+v", insights[0])
	}
	if !strings.Contains(insights[0].Title, "กุ้งสด") {
		t.Errorf("the single card should name the ingredient: %q", insights[0].Title)
	}
}

// A very long list is capped for display but never undercounted: the headline
// keeps the true total and the leftover rows are reported as "and N more".
func TestAVeryLongUrgentListReportsWhatItCouldNotList(t *testing.T) {
	snap := readySnapshot()
	for i := 0; i < insightMaxFoldedRows+4; i++ {
		snap.IngredientUsage = append(snap.IngredientUsage, repository.AIIngredientUsage{
			Name: fmt.Sprintf("วัตถุดิบ %d", i+1), Unit: "กรัม", Stock: 0, Used: 3000, CostPerUnit: 0.2,
		})
	}
	total := insightMaxFoldedRows + 4
	for _, insight := range computeProactiveInsights(snap) {
		if insight.Kind != "ingredient_low" {
			continue
		}
		if !strings.Contains(insight.Title, fmt.Sprintf("%d", total)) {
			t.Errorf("the headline must keep the true total %d: %q", total, insight.Title)
		}
		if len(insight.Items) != insightMaxFoldedRows || insight.More != 4 {
			t.Errorf("expected %d rows and more=4, got %d rows and more=%d",
				insightMaxFoldedRows, len(insight.Items), insight.More)
		}
		return
	}
	t.Fatal("no ingredient_low card was produced")
}
