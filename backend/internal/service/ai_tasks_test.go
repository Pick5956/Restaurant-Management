package service

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"Project-M/internal/aitools"
	"Project-M/internal/repository"
)

// "อันดับ 1" (rank written after the word) must resolve to a single menu, not
// fall through to the default of five.
func TestRequestedTopSellingLimitReadsRankAfterWord(t *testing.T) {
	cases := []struct {
		q    string
		want int
		ok   bool
	}{
		{"เมนูขายดีอันดับ 1", 1, true},
		{"เมนูขายดีอันดับที่ 1", 1, true},
		{"เมนูขายดี 3 อันดับแรก", 3, true},
		{"top 5 menus", 5, true},
		{"เมนูไหนขายดี", 0, false},
	}
	for _, c := range cases {
		got, ok := aitools.RequestedTopSellingLimit(c.q)
		if got != c.want || ok != c.ok {
			t.Fatalf("%q => (%d,%v), want (%d,%v)", c.q, got, ok, c.want, c.ok)
		}
	}
}

func TestAIRouterScopeQuestionUsesConversationFlowWithoutSnapshot(t *testing.T) {
	svc, provider := newScriptedProviderTestService(t,
		`{"task":"scope_question","confidence":0.97,"needs_restaurant_data":false,"needs_tool":false,"risk":"low","suggested_tool":""}`,
		"ผมเป็นผู้ช่วย AI ของระบบจัดการร้านอาหารครับ ช่วยดูยอดขาย สต๊อก เมนู และการใช้งานระบบได้ครับ",
	)

	response, err := svc.AskOperations(1, &AIAskRequest{Question: "คุณคือใคร"})
	if err != nil {
		t.Fatalf("AskOperations identity question: %v", err)
	}
	if response.Intent != AIIntentCapability || response.Task != AITaskScopeQuestion || response.Model != "test-provider" {
		t.Fatalf("identity route = intent %q, task %q, model %q", response.Intent, response.Task, response.Model)
	}
	if response.Snapshot.GeneratedAt != "" || len(response.Snapshot.StockRisks) != 0 {
		t.Fatalf("identity question loaded operational data unexpectedly: %+v", response.Snapshot)
	}
	if provider.calls != 2 {
		t.Fatalf("identity question made %d provider calls, want router plus conversation response", provider.calls)
	}
}

func TestAIRouterOutOfScopeUsesConfiguredProviderRefusal(t *testing.T) {
	svc, provider := newScriptedProviderTestService(t,
		`{"task":"out_of_scope","confidence":0.99,"needs_restaurant_data":false,"needs_tool":false,"risk":"low","suggested_tool":""}`,
		"เรื่องนี้อยู่นอกขอบเขตผู้ช่วยร้านอาหารครับ ผมช่วยดูยอดขายหรือคลังวัตถุดิบให้ได้ครับ",
	)

	response, err := svc.AskOperations(1, &AIAskRequest{Question: "ช่วยแต่งกลอนความรักให้หน่อย"})
	if err != nil {
		t.Fatalf("AskOperations out-of-scope request: %v", err)
	}
	if response.Intent != AIIntentOutOfScope || response.Task != AITaskOutOfScope || response.Model != "test-provider" {
		t.Fatalf("out-of-scope route = intent %q, task %q, model %q", response.Intent, response.Task, response.Model)
	}
	if response.Snapshot.GeneratedAt != "" {
		t.Fatalf("out-of-scope request loaded operational data unexpectedly: %+v", response.Snapshot)
	}
	if provider.calls != 2 {
		t.Fatalf("out-of-scope request made %d provider calls, want router plus refusal response", provider.calls)
	}
}

func TestAIRouterMarginConceptUsesAuthoritativeDefinitionWithoutSnapshot(t *testing.T) {
	svc, provider := newScriptedProviderTestService(t,
		`{"task":"explain_concept","confidence":0.99,"needs_restaurant_data":false,"needs_tool":false,"risk":"low","suggested_tool":""}`,
	)

	response, err := svc.AskOperations(1, &AIAskRequest{Question: "มาร์จิ้นคืออะไร"})
	if err != nil {
		t.Fatalf("AskOperations margin concept: %v", err)
	}
	if response.Task != AITaskExplainConcept || response.Model != "local-concept-policy" {
		t.Fatalf("margin concept route = task %q model %q, want authoritative concept response", response.Task, response.Model)
	}
	if response.Snapshot.GeneratedAt != "" || !strings.Contains(response.Answer, "%") || !strings.Contains(response.Answer, "มาร์จิ้น") {
		t.Fatalf("margin concept answer/snapshot = %q / %+v", response.Answer, response.Snapshot)
	}
	if provider.calls != 1 {
		t.Fatalf("margin concept made %d provider calls, want router only", provider.calls)
	}
}

func TestSecondRoundUsesConfiguredProviderAdapter(t *testing.T) {
	svc, provider := newScriptedProviderTestService(t, `{"answer":"ผลจากข้อมูลจริงครับ","verify":{}}`)

	answer, model, err := svc.askSecondRoundWithRotation("second-round tool result prompt")
	if err != nil {
		t.Fatalf("askSecondRoundWithRotation with provider adapter: %v", err)
	}
	if model != "test-provider" || !strings.Contains(answer, "ผลจากข้อมูลจริง") {
		t.Fatalf("second round answer/model = %q/%q", answer, model)
	}
	if provider.calls != 1 {
		t.Fatalf("second round made %d calls, want one provider call", provider.calls)
	}
}

func TestGetGeminiToolsSchema(t *testing.T) {
	svc := &AIService{}
	tools := svc.getGeminiTools()
	if len(tools) == 0 || len(tools[0].FunctionDeclarations) != 20 {
		t.Fatalf("getGeminiTools returned invalid schema: %+v", tools)
	}
	expectedNames := map[string]bool{
		"get_lowest_margin_menu":          true,
		"get_highest_margin_menu":         true,
		"get_lowest_cost_menu":            true,
		"get_sales_trend":                 true,
		"get_average_order_value":         true,
		"get_order_type_breakdown":        true,
		"get_menu_revenue_ranking":        true,
		"get_peak_periods":                true,
		"get_slow_moving_menus":           true,
		"get_menu_engineering":            true,
		"get_ingredient_reorder_forecast": true,
		"get_dead_stock":                  true,
		"get_top_cost_ingredients":        true,
		"get_store_summary":               true,
		"get_sales_for_period":            true,
		"get_most_expensive_menu":         true,
		"get_low_stock_ingredients":       true,
		"get_top_selling_menus":     true,
		"get_inventory_valuation":   true,
		"get_sales_summary":         true,
	}
	for _, decl := range tools[0].FunctionDeclarations {
		if !expectedNames[decl.Name] {
			t.Errorf("Unexpected tool name in Gemini schema: %s", decl.Name)
		}
		if decl.Parameters.Type != "OBJECT" {
			t.Errorf("Expected OBJECT type parameters in Gemini schema, got %s", decl.Parameters.Type)
		}
	}
}

func TestGetGroqToolsSchema(t *testing.T) {
	svc := &AIService{}
	tools := svc.getGroqTools()
	if len(tools) != 20 {
		t.Fatalf("getGroqTools returned invalid schema: %+v", tools)
	}
	expectedNames := map[string]bool{
		"get_lowest_margin_menu":          true,
		"get_highest_margin_menu":         true,
		"get_lowest_cost_menu":            true,
		"get_sales_trend":                 true,
		"get_average_order_value":         true,
		"get_order_type_breakdown":        true,
		"get_menu_revenue_ranking":        true,
		"get_peak_periods":                true,
		"get_slow_moving_menus":           true,
		"get_menu_engineering":            true,
		"get_ingredient_reorder_forecast": true,
		"get_dead_stock":                  true,
		"get_top_cost_ingredients":        true,
		"get_store_summary":               true,
		"get_sales_for_period":            true,
		"get_most_expensive_menu":         true,
		"get_low_stock_ingredients":       true,
		"get_top_selling_menus":     true,
		"get_inventory_valuation":   true,
		"get_sales_summary":         true,
	}
	for _, tool := range tools {
		if tool.Type != "function" {
			t.Errorf("Expected tool type to be function, got %s", tool.Type)
		}
		if !expectedNames[tool.Function.Name] {
			t.Errorf("Unexpected tool name in Groq schema: %s", tool.Function.Name)
		}
		if tool.Function.Parameters.Type != "object" {
			t.Errorf("Expected object type parameters in Groq schema, got %s", tool.Function.Parameters.Type)
		}
	}
}

func TestLowestMarginToolFormatsValidatedAggregateAndAverageValues(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
			SalesItems:           20,
			MarginItems:          20,
			CostedMarginItems:    20,
			SoldMenus:            1,
			SoldMenusWithRecipes: 1,
		}),
		LowMarginMenus: []repository.AIMenuMarginSummary{{
			MenuName: "ข้าวผัดปู",
			Quantity: 20,
			Revenue:  1900,
			Cost:     1250,
			Profit:   650,
			Margin:   34.21,
		}},
	}

	result, err := executeReadOnlyTool(AIToolGetLowestMarginMenu, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("lowest-margin tool should produce an answer when validated data is available")
	}
	for _, expected := range []string{"ต้นทุนรวม 1,250.00 บาท", "ต้นทุนเฉลี่ยต่อจาน 62.50 บาท", "กำไรเฉลี่ยต่อจาน 32.50 บาท"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("lowest margin answer is missing %q: %s", expected, answer)
		}
	}
}

func TestHighestMarginToolFormatsValidatedAggregateAndAverageValues(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
			SalesItems:           20,
			MarginItems:          20,
			CostedMarginItems:    20,
			SoldMenus:            1,
			SoldMenusWithRecipes: 1,
		}),
		HighMarginMenus: []repository.AIMenuMarginSummary{{
			MenuName: "ต้มยำกุ้ง",
			Quantity: 20,
			Revenue:  3000,
			Cost:     900,
			Profit:   2100,
			Margin:   70.00,
		}},
	}

	result, err := executeReadOnlyTool(AIToolGetHighestMarginMenu, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("highest-margin tool should produce an answer when validated data is available")
	}
	for _, expected := range []string{"ต้มยำกุ้ง", "Margin 70.00%", "ต้นทุนรวม 900.00 บาท", "ต้นทุนเฉลี่ยต่อจาน 45.00 บาท", "กำไรเฉลี่ยต่อจาน 105.00 บาท"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("highest margin answer is missing %q: %s", expected, answer)
		}
	}
}

func TestHighestMarginToolBlockedWhenMarginNotReady(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
			SalesItems:        20,
			MarginItems:       20,
			CostedMarginItems: 10, // partial cost coverage -> CanAnalyzeMargin false
		}),
		HighMarginMenus: []repository.AIMenuMarginSummary{{MenuName: "ต้มยำกุ้ง", Quantity: 20, Revenue: 3000, Cost: 900, Profit: 2100, Margin: 70}},
	}
	result, err := executeReadOnlyTool(AIToolGetHighestMarginMenu, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	if result.HighestMarginMenu != nil {
		t.Fatal("highest-margin tool must not return a menu when margin analysis is not ready")
	}
}

func TestLowestCostToolFormatsPerDishCost(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
			SalesItems: 40, MarginItems: 40, CostedMarginItems: 40, SoldMenus: 1, SoldMenusWithRecipes: 1,
		}),
		LowestCostMenus: []repository.AIMenuMarginSummary{{
			MenuName: "ปอเปี๊ยะทอด",
			Quantity: 40,
			Revenue:  2000,
			Cost:     400,
			Profit:   1600,
			Margin:   80,
		}},
	}
	result, err := executeReadOnlyTool(AIToolGetLowestCostMenu, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("lowest-cost tool should produce an answer when validated data is available")
	}
	// cost per dish = 400/40 = 10.00 ; must report per-dish, not only the total
	for _, expected := range []string{"ปอเปี๊ยะทอด", "ต้นทุนเฉลี่ยต่อจาน 10.00 บาท"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("lowest cost answer is missing %q: %s", expected, answer)
		}
	}
}

func TestSalesTrendToolComparesLast7VsPrior7(t *testing.T) {
	// prior 7 days total 1000, recent 7 days total 1500 -> +50%
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{SalesItems: 10}),
		SalesDays: []repository.AISalesSummary{
			{OrderDate: "2026-07-23", Orders: 5, Revenue: 1500}, // recent (ref day)
			{OrderDate: "2026-07-14", Orders: 4, Revenue: 1000}, // prior (9 days before ref)
		},
	}
	result, err := executeReadOnlyTool(AIToolGetSalesTrend, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	if result.SalesTrend == nil {
		t.Fatal("sales trend tool should return a trend when revenue data is available")
	}
	tr := result.SalesTrend
	if !tr.HasPrior || tr.RecentRevenue != 1500 || tr.PriorRevenue != 1000 {
		t.Fatalf("unexpected trend split: %+v", tr)
	}
	if tr.RevenueChangePct < 49.9 || tr.RevenueChangePct > 50.1 {
		t.Fatalf("expected ~+50%% change, got %.2f", tr.RevenueChangePct)
	}
	answer, ok := localToolAnswer(result)
	if !ok || !strings.Contains(answer, "เพิ่มขึ้น") {
		t.Fatalf("sales trend answer should state an increase: %q", answer)
	}
}

func TestAverageOrderValueToolComputesAOV(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{SalesItems: 10}),
		SalesDays: []repository.AISalesSummary{
			{OrderDate: "2026-07-23", Orders: 4, Revenue: 800},
			{OrderDate: "2026-07-22", Orders: 6, Revenue: 1200},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetAverageOrderValue, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	// AOV = (800+1200) / (4+6) = 2000/10 = 200.00
	if result.AverageOrderValue == nil || result.AverageOrderValue.AOV != 200 {
		t.Fatalf("expected AOV 200, got %+v", result.AverageOrderValue)
	}
	answer, ok := localToolAnswer(result)
	if !ok || !strings.Contains(answer, "200.00 บาท") {
		t.Fatalf("AOV answer missing value: %q", answer)
	}
}

func TestOrderTypeBreakdownToolFormatsSharesAndLabels(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{SalesItems: 10}),
		OrderTypeBreakdown: []repository.AIOrderTypeSummary{
			{OrderType: "dine_in", Orders: 8, Revenue: 800},
			{OrderType: "takeaway", Orders: 2, Revenue: 200},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetOrderTypeBreakdown, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("order type breakdown should produce an answer")
	}
	for _, expected := range []string{"ทานที่ร้าน", "ซื้อกลับ", "80.0%", "20.0%"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("order type answer missing %q: %s", expected, answer)
		}
	}
}

func TestMenuRevenueRankingToolFormatsByRevenue(t *testing.T) {
	snapshot := AISnapshot{
		TopMenusByRevenue: []repository.AIMenuSummary{
			{MenuName: "ต้มยำกุ้ง", Quantity: 20, Revenue: 3000},
			{MenuName: "ผัดไทย", Quantity: 40, Revenue: 2000},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetMenuRevenueRanking, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("menu revenue ranking should produce an answer")
	}
	for _, expected := range []string{"ต้มยำกุ้ง", "รายได้รวม: 3,000.00 บาท", "ผัดไทย"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("menu revenue answer missing %q: %s", expected, answer)
		}
	}
}

func TestPeakPeriodsToolReportsTopWeekdayAndHour(t *testing.T) {
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{SalesItems: 10}),
		PeakWeekdays:      []repository.AIPeriodSummary{{Period: 6, Orders: 40, Revenue: 8000}, {Period: 5, Orders: 20}},
		PeakHours:         []repository.AIPeriodSummary{{Period: 18, Orders: 25, Revenue: 5000}, {Period: 12, Orders: 15}},
	}
	result, err := executeReadOnlyTool(AIToolGetPeakPeriods, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("peak periods should produce an answer")
	}
	for _, expected := range []string{"วันเสาร์", "18:00", "40 ออเดอร์", "25 ออเดอร์"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("peak periods answer missing %q: %s", expected, answer)
		}
	}
}

func TestSlowMovingMenusToolFlagsZeroSales(t *testing.T) {
	snapshot := AISnapshot{
		SlowMovingMenus: []repository.AIMenuSummary{
			{MenuName: "สลัดผัก", Quantity: 0, Revenue: 0},
			{MenuName: "น้ำเปล่า", Quantity: 2, Revenue: 20},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetSlowMovingMenus, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("slow moving menus should produce an answer")
	}
	for _, expected := range []string{"สลัดผัก", "ไม่มีคนสั่งเลย", "น้ำเปล่า"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("slow moving answer missing %q: %s", expected, answer)
		}
	}
}

func TestMenuEngineeringClassifiesQuadrants(t *testing.T) {
	// median quantity=30, median margin=50 across the 4 menus below
	snapshot := AISnapshot{
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
			SalesItems: 40, MarginItems: 40, CostedMarginItems: 40, SoldMenus: 4, SoldMenusWithRecipes: 4,
		}),
		AllMenuMargins: []repository.AIMenuMarginSummary{
			{MenuName: "ดาว", Quantity: 50, Margin: 70},      // high pop, high margin -> Star
			{MenuName: "ชูโรง", Quantity: 50, Margin: 30},    // high pop, low margin -> Plowhorse
			{MenuName: "ซ่อนเร้น", Quantity: 10, Margin: 70}, // low pop, high margin -> Puzzle
			{MenuName: "ถ่วง", Quantity: 10, Margin: 30},     // low pop, low margin -> Dog
		},
	}
	result, err := executeReadOnlyTool(AIToolGetMenuEngineering, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	eng := result.MenuEngineering
	if eng == nil {
		t.Fatal("menu engineering should return a classification")
	}
	if len(eng.Stars) != 1 || eng.Stars[0] != "ดาว" {
		t.Fatalf("expected ดาว as the only Star, got %v", eng.Stars)
	}
	if len(eng.Dogs) != 1 || eng.Dogs[0] != "ถ่วง" {
		t.Fatalf("expected ถ่วง as the only Dog, got %v", eng.Dogs)
	}
	answer, ok := localToolAnswer(result)
	if !ok || !strings.Contains(answer, "ดาวเด่น") {
		t.Fatalf("menu engineering answer should mention quadrants: %q", answer)
	}
}

func TestReorderForecastToolRanksBySoonestOut(t *testing.T) {
	// used over 14 days -> daily rate; days left = stock / daily
	snapshot := AISnapshot{
		IngredientUsage: []repository.AIIngredientUsage{
			{Name: "กุ้ง", Unit: "กก.", Stock: 7, CostPerUnit: 200, Used: 14}, // 1/day -> 7 days
			{Name: "ข้าว", Unit: "กก.", Stock: 28, CostPerUnit: 20, Used: 14}, // 1/day -> 28 days
			{Name: "เกลือ", Unit: "กก.", Stock: 5, CostPerUnit: 10, Used: 0},   // no usage -> excluded
		},
	}
	result, err := executeReadOnlyTool(AIToolGetIngredientReorderForecast, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	items := result.ReorderForecast
	if len(items) != 2 {
		t.Fatalf("expected 2 forecastable ingredients (unused excluded), got %d: %+v", len(items), items)
	}
	if items[0].Name != "กุ้ง" { // soonest to run out first
		t.Fatalf("expected กุ้ง first (7 days), got %s", items[0].Name)
	}
	answer, ok := localToolAnswer(result)
	if !ok || !strings.Contains(answer, "กุ้ง") {
		t.Fatalf("reorder answer missing กุ้ง: %q", answer)
	}
}

func TestDeadStockToolFlagsUnusedStock(t *testing.T) {
	snapshot := AISnapshot{
		IngredientUsage: []repository.AIIngredientUsage{
			{Name: "ผงกะหรี่", Unit: "กก.", Stock: 10, CostPerUnit: 50, Used: 0}, // dead: value 500
			{Name: "หมู", Unit: "กก.", Stock: 5, CostPerUnit: 100, Used: 20},      // used -> not dead
			{Name: "พริกแห้ง", Unit: "กก.", Stock: 0, CostPerUnit: 30, Used: 0},   // no stock -> not dead
		},
	}
	result, err := executeReadOnlyTool(AIToolGetDeadStock, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	if len(result.DeadStock) != 1 || result.DeadStock[0].Name != "ผงกะหรี่" {
		t.Fatalf("expected only ผงกะหรี่ as dead stock, got %+v", result.DeadStock)
	}
	answer, ok := localToolAnswer(result)
	if !ok || !strings.Contains(answer, "ผงกะหรี่") {
		t.Fatalf("dead stock answer missing ผงกะหรี่: %q", answer)
	}
}

func TestTopCostIngredientsToolRanksBySpend(t *testing.T) {
	snapshot := AISnapshot{
		IngredientUsage: []repository.AIIngredientUsage{
			{Name: "กุ้ง", Unit: "กก.", Used: 10, Cost: 2000},
			{Name: "ข้าว", Unit: "กก.", Used: 30, Cost: 600},
			{Name: "เกลือ", Unit: "กก.", Used: 0, Cost: 0}, // no cost -> excluded
		},
	}
	result, err := executeReadOnlyTool(AIToolGetTopCostIngredients, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	if len(result.TopCostIngredients) != 2 || result.TopCostIngredients[0].Name != "กุ้ง" {
		t.Fatalf("expected กุ้ง first by cost, got %+v", result.TopCostIngredients)
	}
	answer, ok := localToolAnswer(result)
	if !ok || !strings.Contains(answer, "2,000.00 บาท") {
		t.Fatalf("top cost answer missing value: %q", answer)
	}
}

func TestStoreSummaryToolComposesDeterministicOverview(t *testing.T) {
	snapshot := AISnapshot{
		GeneratedAt: "2026-07-23T20:00:00+07:00",
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{
			SalesItems: 40, MarginItems: 40, CostedMarginItems: 40, SoldMenus: 3, SoldMenusWithRecipes: 3,
		}),
		SalesDays: []repository.AISalesSummary{
			{OrderDate: "2026-07-23", Orders: 5, Revenue: 1500},
			{OrderDate: "2026-07-14", Orders: 4, Revenue: 1000},
		},
		TopMenuItems:    []repository.AIMenuSummary{{MenuName: "ผัดไทย", Quantity: 30, Revenue: 3000}, {MenuName: "ต้มยำ", Quantity: 20, Revenue: 4000}},
		HighMarginMenus: []repository.AIMenuMarginSummary{{MenuName: "ปอเปี๊ยะทอด", Quantity: 10, Margin: 89.75}},
		StockRisks:      []AIStockRisk{{Name: "กุ้ง", Status: "low"}},
	}
	result, err := executeReadOnlyTool(AIToolGetStoreSummary, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("store summary should produce an answer")
	}
	for _, expected := range []string{"ภาพรวมร้าน", "2,500.00 บาท", "9 ออเดอร์", "ผัดไทย", "ปอเปี๊ยะทอด", "วัตถุดิบใกล้หมด**: 1"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("store summary missing %q: %s", expected, answer)
		}
	}
	// Must not mislabel the 14-day window as "today"
	if strings.Contains(answer, "วันนี้") {
		t.Fatalf("store summary must not claim 'วันนี้': %s", answer)
	}
}

func TestSalesForPeriodResolvesTodayAndYesterday(t *testing.T) {
	snapshot := AISnapshot{
		GeneratedAt:       "2026-07-23T20:00:00+07:00", // reference "today" = 2026-07-23
		AnalysisReadiness: analysisReadinessFromCoverage(repository.AIAnalysisCoverage{SalesItems: 10}),
		SalesDays: []repository.AISalesSummary{
			{OrderDate: "2026-07-23", Orders: 5, Revenue: 1500}, // today
			{OrderDate: "2026-07-22", Orders: 3, Revenue: 900},  // yesterday
			{OrderDate: "2026-07-10", Orders: 2, Revenue: 400},  // outside week
		},
	}
	// today
	todayRes, _ := executeReadOnlyTool(AIToolGetSalesForPeriod, snapshot, "วันนี้ขายได้เท่าไหร่")
	if todayRes.SalesForPeriod == nil || todayRes.SalesForPeriod.Revenue != 1500 || todayRes.SalesForPeriod.Label != "วันนี้" {
		t.Fatalf("today period wrong: %+v", todayRes.SalesForPeriod)
	}
	// yesterday
	yRes, _ := executeReadOnlyTool(AIToolGetSalesForPeriod, snapshot, "เมื่อวานขายดีไหม")
	if yRes.SalesForPeriod == nil || yRes.SalesForPeriod.Revenue != 900 || yRes.SalesForPeriod.Label != "เมื่อวาน" {
		t.Fatalf("yesterday period wrong: %+v", yRes.SalesForPeriod)
	}
	// this week (last 7 days: 07-17..07-23) -> only 23 and 22
	wRes, _ := executeReadOnlyTool(AIToolGetSalesForPeriod, snapshot, "ยอดสัปดาห์นี้")
	if wRes.SalesForPeriod == nil || wRes.SalesForPeriod.Revenue != 2400 {
		t.Fatalf("this-week period wrong (want 2400): %+v", wRes.SalesForPeriod)
	}
	answer, ok := localToolAnswer(yRes)
	if !ok || !strings.Contains(answer, "เมื่อวาน") {
		t.Fatalf("period answer should mention เมื่อวาน: %q", answer)
	}
}

func TestMostExpensiveMenuReportsPriceNotRevenue(t *testing.T) {
	snapshot := AISnapshot{
		MostExpensiveMenus: []repository.AIMenuPrice{
			{Name: "ยำทะเลรวม", Price: 249},
			{Name: "ต้มยำกุ้ง", Price: 199},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetMostExpensiveMenu, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("most expensive menu should produce an answer")
	}
	// Must report the actual per-dish price, not a total revenue figure.
	for _, expected := range []string{"ยำทะเลรวม", "249.00 บาทต่อจาน"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("most expensive answer missing %q: %s", expected, answer)
		}
	}
}

func TestLowStockToolFormatsCorrectly(t *testing.T) {
	snapshot := AISnapshot{
		StockRisks: []AIStockRisk{
			{
				Name:            "ไข่ไก่",
				Status:          "low",
				Stock:           10.0,
				MinStock:        30.0,
				Unit:            "ฟอง",
				RestockEstimate: 50.0,
			},
			{
				Name:            "เนื้อหมู",
				Status:          "out",
				Stock:           0.0,
				MinStock:        5.0,
				Unit:            "กก.",
				RestockEstimate: 10.0,
			},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetLowStockIngredients, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("low stock tool should produce an answer")
	}
	for _, expected := range []string{"ไข่ไก่", "ใกล้หมด ⚠️", "เนื้อหมู", "หมดสต็อก ❌", "แนะนำเติมเพิ่ม: **10.00** กก."} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("low stock answer is missing %q: %s", expected, answer)
		}
	}
}

func TestTopSellingToolFormatsCorrectly(t *testing.T) {
	snapshot := AISnapshot{
		TopMenuItems: []repository.AIMenuSummary{
			{
				MenuName: "ข้าวผัดปู",
				Quantity: 50,
				Revenue:  4750.0,
			},
			{
				MenuName: "ต้มยำกุ้ง",
				Quantity: 20,
				Revenue:  3800.0,
			},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetTopSellingMenus, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("top selling tool should produce an answer")
	}
	for _, expected := range []string{"1. **ข้าวผัดปู**", "50 จาน", "ราคาเฉลี่ย 95.00 บาท", "2. **ต้มยำกุ้ง**", "20 จาน"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("top selling answer is missing %q: %s", expected, answer)
		}
	}
}

func TestTopSellingToolRespectsRequestedRankingLimit(t *testing.T) {
	snapshot := AISnapshot{
		TopMenuItems: []repository.AIMenuSummary{
			{MenuName: "สังขยาใบเตย", Quantity: 36, Revenue: 1980},
			{MenuName: "โรตีกล้วย", Quantity: 34, Revenue: 2346},
			{MenuName: "พะแนงหมู", Quantity: 32, Revenue: 4128},
		},
	}

	result, err := executeReadOnlyTool(AIToolGetTopSellingMenus, snapshot, "เมนูไหนขายดีที่สุด 2 อันดับแรก")
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("top selling tool should produce an answer")
	}
	if !strings.Contains(answer, "1. **สังขยาใบเตย**") || !strings.Contains(answer, "2. **โรตีกล้วย**") {
		t.Fatalf("top selling answer does not contain requested first two menus: %s", answer)
	}
	if strings.Contains(answer, "พะแนงหมู") {
		t.Fatalf("top selling answer contains a menu outside requested limit: %s", answer)
	}
}

func TestInventoryValuationToolFormatsCorrectly(t *testing.T) {
	snapshot := AISnapshot{
		InventorySummary: AIInventorySummary{
			TotalItems: 42,
			OutItems:   3,
			LowItems:   5,
			Value:      15450.50,
		},
	}
	result, err := executeReadOnlyTool(AIToolGetInventoryValuation, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("inventory valuation tool should produce an answer")
	}
	for _, expected := range []string{"จำนวนรายการวัตถุดิบทั้งหมด:** 42 รายการ", "วัตถุดิบที่หมดสต็อก:** 3 รายการ", "มูลค่าคลังสินค้ารวม:** **15,450.50** บาท"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("inventory valuation answer is missing %q: %s", expected, answer)
		}
	}
}

func TestSalesSummaryToolFormatsVerifiedTotal(t *testing.T) {
	snapshot := AISnapshot{
		SalesDays: []repository.AISalesSummary{
			{OrderDate: "2026-05-25", Orders: 3, Revenue: 1200},
			{OrderDate: "2026-05-26", Orders: 2, Revenue: 800.50},
		},
	}
	result, err := executeReadOnlyTool(AIToolGetSalesSummary, snapshot)
	if err != nil {
		t.Fatalf("executeReadOnlyTool: %v", err)
	}
	answer, ok := localToolAnswer(result)
	if !ok {
		t.Fatal("sales summary tool should produce an answer")
	}
	for _, expected := range []string{"2,000.50 บาท", "5 ออเดอร์", "2 วัน"} {
		if !strings.Contains(answer, expected) {
			t.Fatalf("sales summary answer is missing %q: %s", expected, answer)
		}
	}
}

func TestCleanAndParseJSONResponse(t *testing.T) {
	rawMarkdown := "```json\n{\n  \"answer\": \"ทดสอบ\",\n  \"verify\": {\n    \"lowest_margin_menu_name\": \"ข้าวผัดปู\"\n  }\n}\n```"
	res, err := cleanAndParseJSONResponse(rawMarkdown)
	if err != nil {
		t.Fatalf("Failed to parse markdown wrapped JSON: %v", err)
	}
	if res.Answer != "ทดสอบ" || res.Verify.LowestMarginMenuName != "ข้าวผัดปู" {
		t.Fatalf("Incorrect parsed values: %+v", res)
	}

	rawClean := "{\n  \"answer\": \"ทดสอบที่สอง\",\n  \"verify\": {\n    \"quantity\": 12\n  }\n}"
	res2, err := cleanAndParseJSONResponse(rawClean)
	if err != nil {
		t.Fatalf("Failed to parse clean JSON: %v", err)
	}
	if res2.Answer != "ทดสอบที่สอง" || res2.Verify.Quantity != 12 {
		t.Fatalf("Incorrect parsed values: %+v", res2)
	}
}

func TestValidationInterceptorCorrectsLowestMarginHallucinations(t *testing.T) {
	svc := &AIService{}
	snapshot := AISnapshot{
		LowMarginMenus: []repository.AIMenuMarginSummary{{
			MenuName: "ข้าวผัดปู",
			Quantity: 20,
			Revenue:  1900.0,
			Cost:     1250.0,
			Profit:   650.0,
			Margin:   34.21,
		}},
	}
	lowest := snapshot.LowMarginMenus[0]
	result := AIToolResult{
		Tool:             AIToolGetLowestMarginMenu,
		LowestMarginMenu: &lowest,
	}

	// Even a matching model explanation is replaced by the authoritative
	// backend rendering for a fact tool.
	responseExact := AIFinalJSONResponse{
		Answer: "เมนูข้าวผัดปูขายดีที่สุดและมีมาร์จิ้นต่ำที่สุดที่ 34.21% มีต้นทุน 1250.00 บาท",
		Verify: AIVerifyPayload{
			LowestMarginMenuName: "ข้าวผัดปู",
			Quantity:             20,
			Revenue:              1900.0,
			Cost:                 1250.0,
			Profit:               650.0,
			Margin:               34.21,
		},
	}
	finalAnswer := svc.validateAndIntercept(responseExact, result, snapshot)
	if !strings.Contains(finalAnswer, "ต้นทุนเฉลี่ยต่อจาน 62.50 บาท") {
		t.Fatalf("Expected deterministic backend rendering for exact result, got: %s", finalAnswer)
	}

	// Hallucinated numbers never reach the user; backend tool facts replace them.
	responseHallucinated := AIFinalJSONResponse{
		Answer: "เมนูข้าวผัดปูขายดีที่สุดและมีมาร์จิ้นต่ำที่สุดที่ 45% มีต้นทุน 1500 บาท",
		Verify: AIVerifyPayload{
			LowestMarginMenuName: "ข้าวผัดปู",
			Quantity:             20,
			Revenue:              1900.0,
			Cost:                 1500.0, // Hallucinated cost
			Profit:               650.0,
			Margin:               45.0, // Hallucinated margin
		},
	}
	finalAnswer2 := svc.validateAndIntercept(responseHallucinated, result, snapshot)
	if strings.Contains(finalAnswer2, "1500") || strings.Contains(finalAnswer2, "45%") {
		t.Fatalf("Hallucinated numbers leaked into final tool answer: %s", finalAnswer2)
	}
	for _, expected := range []string{"ข้าวผัดปู", "ต้นทุนรวม 1,250.00", "Margin 34.21%"} {
		if !strings.Contains(finalAnswer2, expected) {
			t.Errorf("Expected authoritative answer to mention %q: %s", expected, finalAnswer2)
		}
	}
}

func TestValidationInterceptorCorrectsLowStockHallucinations(t *testing.T) {
	svc := &AIService{}
	snapshot := AISnapshot{
		InventorySummary: AIInventorySummary{
			OutItems: 3,
			LowItems: 5,
		},
		StockRisks: []AIStockRisk{{
			Name: "ไข่ไก่", Status: "low", Stock: 2, MinStock: 10, Unit: "ฟอง", RestockEstimate: 8,
		}},
	}
	result := AIToolResult{
		Tool:                AIToolGetLowStockIngredients,
		LowStockIngredients: snapshot.StockRisks,
	}

	// Mismatched count -> deterministic tool rendering.
	response := AIFinalJSONResponse{
		Answer: "มีสินค้าใกล้หมด 2 รายการ และหมดสต็อก 1 รายการ",
		Verify: AIVerifyPayload{
			LowStockCount:   2,
			OutOfStockCount: 1,
		},
	}
	finalAnswer := svc.validateAndIntercept(response, result, snapshot)
	if strings.Contains(finalAnswer, "มีสินค้าใกล้หมด 2 รายการ") || !strings.Contains(finalAnswer, "ไข่ไก่") {
		t.Fatalf("Hallucinated low-stock answer was not replaced: %s", finalAnswer)
	}
}

func TestValidationInterceptorCorrectsTopSellingHallucinations(t *testing.T) {
	svc := &AIService{}
	snapshot := AISnapshot{
		TopMenuItems: []repository.AIMenuSummary{{
			MenuName: "ต้มยำกุ้ง",
			Quantity: 45,
		}},
	}
	result := AIToolResult{
		Tool:            AIToolGetTopSellingMenus,
		TopSellingMenus: snapshot.TopMenuItems,
	}

	response := AIFinalJSONResponse{
		Answer: "เมนูขายดีอันดับหนึ่งคือ ข้าวผัดปู ขายได้ 50 จาน",
		Verify: AIVerifyPayload{
			TopMenuName:     "ข้าวผัดปู",
			TopMenuQuantity: 50,
		},
	}
	finalAnswer := svc.validateAndIntercept(response, result, snapshot)
	if strings.Contains(finalAnswer, "ข้าวผัดปู") || !strings.Contains(finalAnswer, "ต้มยำกุ้ง") || !strings.Contains(finalAnswer, "45 จาน") {
		t.Fatalf("Hallucinated top seller was not replaced: %s", finalAnswer)
	}
}

func TestValidationInterceptorCorrectsInventoryValuationHallucinations(t *testing.T) {
	svc := &AIService{}
	snapshot := AISnapshot{
		InventorySummary: AIInventorySummary{
			TotalItems: 42,
			Value:      15450.50,
		},
	}
	result := AIToolResult{
		Tool:               AIToolGetInventoryValuation,
		InventoryValuation: &snapshot.InventorySummary,
	}

	response := AIFinalJSONResponse{
		Answer: "มูลค่าคลังสินค้ารวม 12000 บาท มีวัตถุดิบ 35 รายการ",
		Verify: AIVerifyPayload{
			TotalItems: 35,
			TotalValue: 12000.0,
		},
	}
	finalAnswer := svc.validateAndIntercept(response, result, snapshot)
	if strings.Contains(finalAnswer, "12000") || !strings.Contains(finalAnswer, "42 รายการ") || !strings.Contains(finalAnswer, "15,450.50") {
		t.Fatalf("Hallucinated valuation was not replaced: %s", finalAnswer)
	}
}

func TestParseRouterJSON(t *testing.T) {
	cases := []struct {
		name     string
		raw      string
		wantTask AITask
		wantErr  bool
	}{
		{
			name:     "Clean JSON",
			raw:      `{"task": "general_chat", "confidence": 0.95, "needs_restaurant_data": false}`,
			wantTask: AITaskGeneralChat,
			wantErr:  false,
		},
		{
			name:     "Markdown Wrapped JSON",
			raw:      "```json\n{\n  \"task\": \"restaurant_content\",\n  \"confidence\": 0.88,\n  \"needs_restaurant_data\": false\n}\n```",
			wantTask: AITaskRestaurantContent,
			wantErr:  false,
		},
		{
			name:     "Invalid JSON",
			raw:      `{invalid-json}`,
			wantTask: "",
			wantErr:  true,
		},
		{
			name:     "Out of Scope JSON",
			raw:      `{"task": "out_of_scope", "confidence": 0.99, "needs_restaurant_data": false}`,
			wantTask: AITaskOutOfScope,
			wantErr:  false,
		},
		{
			name:     "Data Tool Normalizes To Retrieve Fact",
			raw:      `{"task":"restaurant_data","confidence":0.99,"needs_restaurant_data":true,"needs_tool":true,"risk":"low","suggested_tool":"get_lowest_margin_menu"}`,
			wantTask: AITaskRetrieveFact,
			wantErr:  false,
		},
		{
			name:    "Reject Unknown Task",
			raw:     `{"task":"delete_everything","confidence":0.99,"risk":"low"}`,
			wantErr: true,
		},
		{
			name:    "Reject Requested Unsupported Tool",
			raw:     `{"task":"restaurant_data","confidence":0.99,"needs_restaurant_data":true,"needs_tool":true,"risk":"low","suggested_tool":"drop_database"}`,
			wantErr: true,
		},
		{
			name:    "Reject Tool Requirement Without Tool",
			raw:     `{"task":"restaurant_data","confidence":0.99,"needs_restaurant_data":true,"needs_tool":true,"risk":"low","suggested_tool":""}`,
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := parseRouterJSON(tc.raw)
			if (err != nil) != tc.wantErr {
				t.Fatalf("parseRouterJSON() error = %v, wantErr %v", err, tc.wantErr)
			}
			if !tc.wantErr && res.Task != tc.wantTask {
				t.Fatalf("parseRouterJSON() res.Task = %q, want %q", res.Task, tc.wantTask)
			}
		})
	}
}

func TestLiveAITaskRouterIntegration(t *testing.T) {
	groqKey := strings.TrimSpace(os.Getenv("GROQ_API_KEYS"))
	geminiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEYS"))
	if groqKey == "" && geminiKey == "" {
		t.Skip("Skipping Live Task Router integration test: no API keys configured in environment")
	}

	svc := &AIService{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	question := "เมนูไหนมีกำไรน้อยสุดในร้าน"

	res, err := svc.classifyIntent(question, nil)
	if err != nil {
		t.Fatalf("classifyIntent live API call failed: %v", err)
	}

	t.Logf("Live Router Result: %+v", res)

	if res.Task != AITaskRetrieveFact {
		t.Errorf("Expected live router to normalize %q to retrieve_fact, got %q", question, res.Task)
	}

	if !res.NeedsRestaurantData {
		t.Errorf("Expected NeedsRestaurantData to be true for analytical query, got false")
	}

	if !res.NeedsTool || res.SuggestedTool != AIToolGetLowestMarginMenu {
		t.Errorf("Expected lowest-margin fact to require get_lowest_margin_menu, got needsTool=%t tool=%q", res.NeedsTool, res.SuggestedTool)
	}
}

func TestLiveAITaskRouterOutOfScopeIntegration(t *testing.T) {
	groqKey := strings.TrimSpace(os.Getenv("GROQ_API_KEYS"))
	geminiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEYS"))
	if groqKey == "" && geminiKey == "" {
		t.Skip("Skipping Live Task Router Out of Scope integration test: no API keys configured")
	}

	svc := &AIService{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}

	question := "ช่วยแต่งกลอน 8 เกี่ยวกับความรักให้หน่อย"

	res, err := svc.classifyIntent(question, nil)
	if err != nil {
		t.Fatalf("classifyIntent live API call failed: %v", err)
	}

	t.Logf("Live Out-of-Scope Router Result: %+v", res)

	if res.Task != AITaskOutOfScope {
		t.Errorf("Expected live router to map %q to out_of_scope, got %q", question, res.Task)
	}
}
