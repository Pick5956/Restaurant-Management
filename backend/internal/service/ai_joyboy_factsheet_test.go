package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Every tool offered to the model must render. A tool without a case here would
// be selected, run, and then silently dropped from the fact sheet, which reads
// to the model as a tool that returns nothing — the hardest failure to notice,
// because the answer still arrives, just without the data that was asked for.
func TestEveryOfferedToolRendersAFactSheetBlock(t *testing.T) {
	for _, spec := range (&joyboyTools{service: &AIService{}, restaurantID: 1}).Catalogue() {
		if isJoyboyExtraTool(AIToolName(spec.Name)) {
			continue // joyboy-only tools render through their own path, tested separately
		}
		body, ok := joyboyFactBody(AIToolResult{Tool: AIToolName(spec.Name)})
		if !ok {
			t.Errorf("%s has no fact sheet rendering", spec.Name)
			continue
		}
		if strings.TrimSpace(body) == "" {
			t.Errorf("%s rendered an empty block", spec.Name)
		}
	}
}

// An empty result is a tool that ran and found nothing, which is not the same as
// a tool that failed. The reason travels with it so the model can say which.
func TestEmptyResultsCarryAReason(t *testing.T) {
	for _, spec := range (&joyboyTools{service: &AIService{}, restaurantID: 1}).Catalogue() {
		body, _ := joyboyFactBody(AIToolResult{Tool: AIToolName(spec.Name)})
		if !strings.Contains(body, "status=no_data") {
			continue
		}
		if !strings.Contains(body, "reason=") {
			t.Errorf("%s reports no data without saying why: %q", spec.Name, body)
		}
	}
}

// The whole point of this file is that the model receives figures rather than
// legacy's finished sentences. Thai politeness particles and emoji are the
// signature of a written answer, so their absence is the property to hold.
func TestFactSheetCarriesNoWrittenAnswer(t *testing.T) {
	results := []AIToolResult{
		{
			Tool: AIToolGetTopSellingMenus,
			TopSellingMenus: []repository.AIMenuSummary{
				{MenuName: "ต้มยำกุ้งน้ำข้น", Quantity: 109, Revenue: 15151},
			},
		},
		{
			Tool:              AIToolGetHighestMarginMenu,
			HighestMarginMenu: &repository.AIMenuMarginSummary{MenuName: "ข้าวกะเพราไก่ไข่ดาว", Quantity: 79, Revenue: 6241, Cost: 1881, Profit: 4360, Margin: 69.85},
		},
		{
			Tool:                AIToolGetLowStockIngredients,
			LowStockIngredients: []AIStockRisk{{Name: "ข้าวคั่ว", Status: "low", Stock: 40, MinStock: 100, Unit: "กรัม", RestockEstimate: 160}},
		},
		{
			Tool:               AIToolGetInventoryValuation,
			InventoryValuation: &AIInventorySummary{TotalItems: 30, LowItems: 4, Value: 12000},
		},
	}
	// "ครับ"/"ค่ะ" and the trend arrows are what legacy writes; a thumbs-up is
	// praise, which is an opinion the fact sheet has no business holding.
	forbidden := []string{"ครับ", "ค่ะ", "📈", "📉", "👍", "⚠️", "❌", "**"}

	for _, result := range results {
		body, ok := joyboyFactBody(result)
		if !ok {
			t.Fatalf("%s did not render", result.Tool)
		}
		for _, token := range forbidden {
			if strings.Contains(body, token) {
				t.Errorf("%s: fact sheet contains written-answer token %q\n%s", result.Tool, token, body)
			}
		}
	}
}

// Figures reach the model unformatted so that formatting stays the model's
// decision. A separator here would be copied through into the answer.
func TestFiguresCarryNoThousandsSeparator(t *testing.T) {
	body, _ := joyboyFactBody(AIToolResult{
		Tool:         AIToolGetSalesSummary,
		SalesSummary: &AISalesSummary{Days: 30, Orders: 308, Revenue: 82291},
	})
	if !strings.Contains(body, "revenue=82291.00") {
		t.Fatalf("revenue was reshaped before the model saw it: %q", body)
	}
}

// get_store_summary keeps only the count of at-risk ingredients, not their
// names. Saying so stops the model from reporting a bare number as though the
// names were left out for brevity.
func TestStoreSummaryAdmitsWhatItDoesNotCarry(t *testing.T) {
	body, _ := joyboyFactBody(AIToolResult{
		Tool:         AIToolGetStoreSummary,
		StoreSummary: &AIStoreSummary{Days: 30, Orders: 308, Revenue: 82291, LowStockCount: 4},
	})
	if !strings.Contains(body, "ingredients_below_minimum=4") {
		t.Fatalf("low stock count missing: %q", body)
	}
	if !strings.Contains(body, "get_low_stock_ingredients") {
		t.Fatalf("the summary does not point at the tool holding the names: %q", body)
	}
}

// The failure this replaces: asked "กำไรเดือนที่แล้วเท่าไหร่", the assistant read
// the fixed 30-day snapshot and reported that figure as last month's profit.
func TestProfitForPeriodTotalsTheNamedWindow(t *testing.T) {
	metrics := []repository.AIMenuMarginSummary{
		{MenuName: "ผัดไทยกุ้งสด", Quantity: 100, Revenue: 8900, Cost: 2700, Profit: 6200},
		{MenuName: "ลาบหมู", Quantity: 50, Revenue: 3950, Cost: 1200, Profit: 2750},
	}
	body := joyboyProfitForPeriodBody("เดือนกรกฎาคม 2569", metrics, nil)

	for _, want := range []string{"period=เดือนกรกฎาคม 2569", "revenue=12850", "profit=8950", "gross_profit_means=กำไรขั้นต้น"} {
		if !strings.Contains(body, want) {
			t.Errorf("sheet is missing %q:\n%s", want, body)
		}
	}
}

// An uncosted menu understates the cost, so the profit is a floor and the sheet
// has to say so — the same rule the 30-day snapshot follows.
func TestProfitForPeriodFlagsPartialCostCoverage(t *testing.T) {
	metrics := []repository.AIMenuMarginSummary{
		{MenuName: "มีต้นทุน", Quantity: 10, Revenue: 1000, Cost: 400, Profit: 600},
		{MenuName: "ยังไม่ผูกต้นทุน", Quantity: 10, Revenue: 1000, Cost: 0, Profit: 1000},
	}
	if body := joyboyProfitForPeriodBody("เดือนนี้", metrics, nil); !strings.Contains(body, "profit_is_a_floor") {
		t.Errorf("half the revenue is uncosted, the sheet must flag it:\n%s", body)
	}
}

// A named period with no sales is a stated empty period, not a zero-baht profit.
func TestProfitForPeriodReportsAnEmptyWindow(t *testing.T) {
	if body := joyboyProfitForPeriodBody("เมื่อวาน", nil, nil); !strings.Contains(body, "no_paid_sales_in_period") {
		t.Errorf("an empty window must be reported as empty:\n%s", body)
	}
}

// An empty expense window is where the worst answer came from: with nothing
// recorded for July the model took the spend as zero and reported a month of
// revenue as "กำไรสุทธิ". The warning has to be on the empty sheet too.
func TestExpenseSummarySaysItIsNotTheCostBaseEvenWhenEmpty(t *testing.T) {
	empty := joyboyExpenseSummaryBody("เดือนกรกฎาคม 2569", "2026-07-01", "2026-07-31", &ExpenseListResponse{})
	if !strings.Contains(empty, "ห้ามถือว่าต้นทุนเป็นศูนย์") {
		t.Errorf("an empty window must still say the recipes hold the real cost:\n%s", empty)
	}

	populated := joyboyExpenseSummaryBody("เดือนนี้", "2026-08-01", "2026-08-28", &ExpenseListResponse{
		Entries: 1, Total: 300,
	})
	if !strings.Contains(populated, "ห้ามเอาไปลบกับยอดขาย") {
		t.Errorf("the populated sheet lost its warning:\n%s", populated)
	}
}

// "ร้านเราชื่ออะไร" had no tool and came back as a sales total. The profile sheet
// answers it from the shop's own row, and deliberately omits address/phone/tax.
func TestShopProfileBodyStatesIdentityNotSalesOrContact(t *testing.T) {
	r := &entity.Restaurant{
		Name: "ครัวคุณย่า", BranchName: "สาขาหลัก", RestaurantType: "ตามสั่ง",
		OpenTime: "10:00", CloseTime: "22:00", TableCount: 12,
		Phone: "0812345678", Address: "123 ถนนสุขุมวิท",
	}
	body := joyboyShopProfileBody(r)
	for _, want := range []string{"shop_name=ครัวคุณย่า", "branch=สาขาหลัก", "type=ตามสั่ง", "hours=10:00-22:00", "table_count=12"} {
		if !strings.Contains(body, want) {
			t.Errorf("profile sheet missing %q:\n%s", want, body)
		}
	}
	// Contact details are the shop's, but this sheet leaves the system, so they
	// stay out of it.
	if strings.Contains(body, "0812345678") || strings.Contains(body, "สุขุมวิท") {
		t.Errorf("phone/address must not be on the sheet:\n%s", body)
	}
	if nd := joyboyShopProfileBody(nil); !strings.Contains(nd, "no_restaurant_profile") {
		t.Errorf("a missing profile should report no-data, got %q", nd)
	}
}

// "อาทิตย์ก่อนช่วงไหนคนเยอะสุด" used to be answered from the fixed 30-day
// snapshot, and the two lines are separate rankings the model once glued into
// one ("11:00 was the busiest hour of Monday").
func TestPeakForPeriodStatesTheWindowAndKeepsTheAxesApart(t *testing.T) {
	body := joyboyPeakForPeriodBody("สัปดาห์ที่แล้ว",
		[]repository.AIPeriodSummary{{Period: 1, Orders: 188}},
		[]repository.AIPeriodSummary{{Period: 11, Orders: 161}})

	for _, want := range []string{"period=สัปดาห์ที่แล้ว", "scope=named_period_not_30day_window",
		"weekday_orders=188", "busiest_hour_across_all_days=11:00"} {
		if !strings.Contains(body, want) {
			t.Errorf("peak sheet missing %q:\n%s", want, body)
		}
	}
	if !strings.Contains(body, "นับคนละแกน") {
		t.Errorf("the sheet must say the two lines are separate rankings:\n%s", body)
	}
	if empty := joyboyPeakForPeriodBody("เมื่อวาน", nil, nil); !strings.Contains(empty, "no_orders_recorded_in_period") {
		t.Errorf("an empty window must be reported as empty:\n%s", empty)
	}
}

// The order-type split had the same fixed window, so "เดือนที่แล้วสั่งกลับกี่ที่"
// was answered about the last 30 days instead.
func TestOrderTypeForPeriodStatesTheWindow(t *testing.T) {
	body := joyboyOrderTypeForPeriodBody("เดือนกรกฎาคม 2569", []repository.AIOrderTypeSummary{
		{OrderType: "dine_in", Orders: 900, Revenue: 250000},
		{OrderType: "takeaway", Orders: 385, Revenue: 97453},
	})
	for _, want := range []string{"period=เดือนกรกฎาคม 2569", "order_type=กินที่ร้าน orders=900", "order_type=สั่งกลับบ้าน orders=385"} {
		if !strings.Contains(body, want) {
			t.Errorf("order-type sheet missing %q:\n%s", want, body)
		}
	}
}

// "ตอนนี้บิลไหนยังไม่จ่าย" had no source at all — every other tool reports
// history. The sheet also computes the waiting time, because the model may not
// do arithmetic and a timestamp is not an answer to "who has waited longest".
func TestActiveOrdersBodyReportsTheFloorRightNow(t *testing.T) {
	now := time.Date(2026, 8, 29, 19, 30, 0, 0, time.UTC)
	orders := []repository.AIActiveOrder{
		{OrderNumber: "A012", TableNumber: "A2", OrderType: "dine_in", Status: entity.OrderStatusCooking,
			PaymentStatus: "unpaid", GrandTotal: 480, CustomerCount: 3,
			OpenedAt: now.Add(-25 * time.Minute)},
		{OrderNumber: "A013", TableNumber: "B2", OrderType: "dine_in", Status: entity.OrderStatusServed,
			PaymentStatus: "unpaid", GrandTotal: 320, CustomerCount: 2,
			OpenedAt: now.Add(-70 * time.Minute)},
		{OrderNumber: "T004", OrderType: "takeaway", Status: entity.OrderStatusReady,
			PaymentStatus: "paid", GrandTotal: 150, CustomerCount: 1,
			OpenedAt: now.Add(-5 * time.Minute)},
	}
	body := joyboyActiveOrdersBody(orders, now)

	for _, want := range []string{
		"active_orders=3", "in_kitchen_now=1", "unpaid_bills=2 unpaid_total=800",
		"order=A012 โต๊ะ A2", "สถานะ=ครัวกำลังทำ", "เปิดมาแล้ว=70 นาที",
		"order=T004 สั่งกลับบ้าน", "capability=read_only",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("active-orders sheet missing %q:\n%s", want, body)
		}
	}
	// Status codes must be translated once, here, not by the model each time.
	if strings.Contains(body, "sent_to_kitchen") || strings.Contains(body, "cooking") {
		t.Errorf("raw status codes leaked to the model:\n%s", body)
	}
}

// An empty floor is a real state worth stating plainly, not a missing tool.
func TestActiveOrdersBodyReportsAnEmptyFloor(t *testing.T) {
	body := joyboyActiveOrdersBody(nil, time.Now())
	if !strings.Contains(body, "no_active_orders_right_now") {
		t.Errorf("an empty floor should say so:\n%s", body)
	}
	if !strings.Contains(body, "capability=read_only") {
		t.Errorf("the read-only warning must travel with the empty sheet too:\n%s", body)
	}
}

// Totals the model cannot compute itself. "ต้องใช้เงินเท่าไหร่ถ้าเติมของที่
// ใกล้หมดทั้งหมด" is a multiply-then-sum, and "เงินจมรวมเท่าไหร่" is a sum —
// both were unanswerable over sheets that listed the parts and no total.
func TestStockSheetsCarryTheTotalsTheModelCannotCompute(t *testing.T) {
	low, _ := joyboyFactBody(AIToolResult{
		Tool: AIToolGetLowStockIngredients,
		LowStockIngredients: []AIStockRisk{
			{Name: "ข้าวคั่ว", Status: "low", Stock: 40, MinStock: 100, Unit: "กรัม", RestockEstimate: 160, CostPerUnit: 0.5},
			{Name: "ใบกะเพรา", Status: "out", Stock: 0, MinStock: 300, Unit: "กรัม", RestockEstimate: 600, CostPerUnit: 0.15},
		},
	})
	// 160×0.5 + 600×0.15 = 170
	if !strings.Contains(low, "restock_all_cost=170") {
		t.Errorf("low-stock sheet should total the restock cost:\n%s", low)
	}

	dead, _ := joyboyFactBody(AIToolResult{
		Tool: AIToolGetDeadStock,
		DeadStock: []AIDeadStockItem{
			{Name: "มะละกอดิบ", Stock: 5, Unit: "กก.", Value: 250},
			{Name: "หมึกกล้วย", Stock: 2, Unit: "กก.", Value: 400},
		},
	})
	if !strings.Contains(dead, "dead_value_total=650") {
		t.Errorf("dead-stock sheet should total the money sitting idle:\n%s", dead)
	}
}

// "ร้านมีกี่เมนู / มีเมนูอะไรบ้าง" had no source: every other menu tool ranks by
// sales, so a menu nobody ordered appears in none of them and the model fell
// through to chat and asked the owner for the menu. The sheet has to carry the
// exact count (Go's, not the model's), the on/off-sale split, and the names.
func TestMenuListSheetCountsTheWholeMenu(t *testing.T) {
	body := joyboyMenuListBody([]repository.AIMenuCatalogueItem{
		{Name: "ต้มยำกุ้งน้ำข้น", Price: 139, IsAvailable: true, Category: "อาหารจานเดียว"},
		{Name: "ชาไทยเย็น", Price: 49, IsAvailable: true, Category: "เครื่องดื่ม"},
		{Name: "ยำวุ้นเส้น", Price: 89, IsAvailable: false, Category: "ยำ"},
	})
	for _, want := range []string{
		"total_menu_items=3",
		"on_sale=2",
		"off_sale=1",
		"ต้มยำกุ้งน้ำข้น",
		"ปิดขายอยู่", // the closed item must be marked, not silently listed
		"เครื่องดื่ม",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the menu list sheet lost %q:\n%s", want, body)
		}
	}
}

// A shop with a long menu gets a cut list, and an uncut count. Unsaid, the model
// reads the last row as the last menu — the misreading the ranked lists already
// made once.
func TestMenuListSheetSaysWhenTheListIsCut(t *testing.T) {
	items := make([]repository.AIMenuCatalogueItem, 0, joyboyMenuListMaxRows+5)
	for i := 0; i < joyboyMenuListMaxRows+5; i++ {
		items = append(items, repository.AIMenuCatalogueItem{
			Name: fmt.Sprintf("เมนู %d", i+1), Price: 60, IsAvailable: true, Category: "ทั่วไป",
		})
	}
	body := joyboyMenuListBody(items)
	if !strings.Contains(body, fmt.Sprintf("total_menu_items=%d", len(items))) {
		t.Errorf("the count must stay exact even when the list is cut:\n%s", body)
	}
	if !strings.Contains(body, "แสดงรายชื่อแค่") {
		t.Errorf("a cut list must say so:\n%s", body)
	}
	if strings.Contains(body, fmt.Sprintf("menu=เมนู %d ", len(items))) {
		t.Errorf("rows past the cap should not be rendered:\n%s", body)
	}
}

// An empty menu is a setup gap, not a shop with zero dishes.
func TestMenuListSheetTreatsAnEmptyMenuAsNotSetUp(t *testing.T) {
	body := joyboyMenuListBody(nil)
	if !strings.Contains(body, "no_menu_items_recorded") {
		t.Errorf("an empty menu should report the setup gap:\n%s", body)
	}
}

// factSheetLineWith returns the first line of a sheet containing needle, so a
// test can assert what a single record does not say.
func factSheetLineWith(body, needle string) string {
	for _, line := range strings.Split(body, "\n") {
		if strings.Contains(line, needle) {
			return line
		}
	}
	return ""
}

// "เครื่องดื่มตัวไหนกำไรดีสุด" went unanswered for three rounds of testing: every
// ranked list mixes food and drink into one list of eight, no drink ever reached
// it, and the model — reading a sheet with no drink on it — reported that the
// system holds no drinks data at all. The sheet has to rank the categories and
// the menus inside them, with Go doing every sum and division.
func TestMenuProfitByCategoryRanksCategoriesAndTheirMenus(t *testing.T) {
	body := joyboyMenuProfitByCategoryBody(
		[]repository.AICategoryMenuMargin{
			{Category: "กับข้าว", MenuName: "ต้มยำกุ้งน้ำข้น", Quantity: 109, Revenue: 15151, Cost: 6060, Profit: 9091, Margin: 60},
			{Category: "เครื่องดื่ม", MenuName: "กาแฟเย็น", Quantity: 100, Revenue: 4500, Cost: 1800, Profit: 2700, Margin: 60},
			{Category: "เครื่องดื่ม", MenuName: "ชาไทยเย็น", Quantity: 200, Revenue: 9800, Cost: 2940, Profit: 6860, Margin: 70},
		},
		[]repository.AIMenuCatalogueItem{
			{Name: "ต้มยำกุ้งน้ำข้น", Price: 139, IsAvailable: true, Category: "กับข้าว"},
			{Name: "ชาไทยเย็น", Price: 49, IsAvailable: true, Category: "เครื่องดื่ม"},
			{Name: "กาแฟเย็น", Price: 45, IsAvailable: true, Category: "เครื่องดื่ม"},
			{Name: "น้ำเปล่า", Price: 15, IsAvailable: true, Category: "เครื่องดื่ม"},
		})

	for _, want := range []string{
		// Drinks keep more baht than the food category here, so drinks rank first:
		// the figures decide the order, not the order the rows arrived in. Both
		// the totals and the 66.85% are Go's arithmetic, not the model's.
		"category_rank=1 category=เครื่องดื่ม menus_on_menu=3 menus_sold=2 menus_listed=2 qty=300 revenue=14300.00 cost=4740.00 profit=9560.00 margin_pct=66.85",
		"category_rank=2 category=กับข้าว menus_on_menu=1 menus_sold=1 menus_listed=1",
		// The ranking inside the category is the answer to the question that
		// started this: which drink keeps the most.
		"category=เครื่องดื่ม menu_rank=1 menu=ชาไทยเย็น",
		"category=เครื่องดื่ม menu_rank=2 menu=กาแฟเย็น",
		// 2940 / 200 and 6860 / 200, divided in Go.
		"cost_per_dish=14.70 profit_per_dish=34.30",
		// 9091 + 2700 + 6860, added in Go.
		"profit_all_categories=18651.00 revenue_all_categories=29451.00",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the category profit sheet lost %q:\n%s", want, body)
		}
	}
}

// A category that sold nothing in the window must still hold a line. Left off the
// sheet it is indistinguishable from a category the shop does not have, which is
// the misreading this whole tool exists to stop.
func TestMenuProfitByCategoryKeepsCategoriesThatSoldNothing(t *testing.T) {
	body := joyboyMenuProfitByCategoryBody(
		[]repository.AICategoryMenuMargin{
			{Category: "กับข้าว", MenuName: "ต้มยำกุ้งน้ำข้น", Quantity: 10, Revenue: 1390, Cost: 500, Profit: 890, Margin: 64.03},
			// A menu deleted after it sold has no category row left to join to, and
			// its sales still count.
			{Category: "", MenuName: "เมนูเก่าที่ถูกลบไปแล้ว", Quantity: 2, Revenue: 200, Cost: 80, Profit: 120, Margin: 60},
		},
		[]repository.AIMenuCatalogueItem{
			{Name: "ต้มยำกุ้งน้ำข้น", Price: 139, IsAvailable: true, Category: "กับข้าว"},
			{Name: "ไอศกรีมกะทิ", Price: 59, IsAvailable: true, Category: "ของหวาน"},
			{Name: "บัวลอย", Price: 55, IsAvailable: false, Category: "ของหวาน"},
		})

	dessert := factSheetLineWith(body, "category=ของหวาน")
	if !strings.Contains(dessert, "menus_on_menu=2 menus_sold=0 menus_listed=0 qty=0 revenue=0.00 cost=0.00 profit=0.00 status=no_sales_in_period") {
		t.Errorf("a category with no sales must stay on the sheet as a category with no sales:\n%s", body)
	}
	// A margin over no sales is a rate nobody measured; printed as 0.00 it reads
	// as a category that sells at no margin at all.
	if strings.Contains(dessert, "margin_pct") {
		t.Errorf("a category with no sales must not be given a margin:\n%s", dessert)
	}
	if !strings.Contains(body, "categories=3 categories_with_sales=2") {
		t.Errorf("the counts must cover every category, sold or not:\n%s", body)
	}
	if !strings.Contains(body, "category=ไม่ระบุหมวด") {
		t.Errorf("sales from a menu with no category must be filed, not dropped:\n%s", body)
	}
	if !strings.Contains(body, "status=no_sales_in_period ไม่ได้แปลว่าร้านไม่มีหมวดนั้น") {
		t.Errorf("the sheet must tell the model what an empty category means:\n%s", body)
	}
}

// A long category is cut, and says so — but its totals are over everything it
// sold, not over the rows that fit.
func TestMenuProfitByCategorySaysWhenACategoryListIsCut(t *testing.T) {
	var sold []repository.AICategoryMenuMargin
	var menu []repository.AIMenuCatalogueItem
	for i := 0; i < joyboyCategoryMenuMaxRows+4; i++ {
		name := fmt.Sprintf("เมนู %d", i+1)
		sold = append(sold, repository.AICategoryMenuMargin{
			Category: "กับข้าว", MenuName: name, Quantity: 10,
			Revenue: float64(1000 - i*10), Cost: 400, Profit: float64(600 - i*10), Margin: 60,
		})
		menu = append(menu, repository.AIMenuCatalogueItem{Name: name, Price: 100, IsAvailable: true, Category: "กับข้าว"})
	}
	body := joyboyMenuProfitByCategoryBody(sold, menu)

	if !strings.Contains(body, fmt.Sprintf("menus_sold=%d menus_listed=%d", len(sold), joyboyCategoryMenuMaxRows)) {
		t.Errorf("a cut category must say how many of its menus are listed:\n%s", body)
	}
	if strings.Contains(body, fmt.Sprintf("menu=เมนู %d ", len(sold))) {
		t.Errorf("rows past the cap should not be rendered:\n%s", body)
	}
	// 600 + 590 + ... + 490 over all twelve menus, including the four not listed.
	if !strings.Contains(body, "profit_all_categories=6540.00") {
		t.Errorf("the total must cover the whole category, not only the listed rows:\n%s", body)
	}
}

// No menu at all is a setup gap, not a shop whose every category earns zero.
func TestMenuProfitByCategoryTreatsAnEmptyMenuAsNotSetUp(t *testing.T) {
	body := joyboyMenuProfitByCategoryBody(nil, nil)
	if !strings.Contains(body, "no_menu_items_recorded") {
		t.Errorf("an empty menu should report the setup gap:\n%s", body)
	}
}

// A raw stock flag ("out"/"low") left in the sheet gets pasted straight into the
// answer — the owner read "ไก่สับ (out) 0.00 กรัม", an English code in a Thai
// reply. The sheet must carry the Thai wording so even a verbatim paste reads as
// a word, not a code.
func TestLowStockSheetStatesTheStatusInThai(t *testing.T) {
	body, _ := joyboyFactBody(AIToolResult{
		Tool: AIToolGetLowStockIngredients,
		LowStockIngredients: []AIStockRisk{
			{Name: "ไก่สับ", Status: "out", Stock: 0, MinStock: 500, Unit: "กรัม", RestockEstimate: 1000, CostPerUnit: 0.12},
			{Name: "ข้าวคั่ว", Status: "low", Stock: 40, MinStock: 100, Unit: "กรัม", RestockEstimate: 160, CostPerUnit: 0.5},
		},
	})
	for _, want := range []string{"หมดสต๊อกแล้ว", "ใกล้หมด"} {
		if !strings.Contains(body, want) {
			t.Errorf("the low-stock sheet should state the status in Thai (%q):\n%s", want, body)
		}
	}
	for _, leak := range []string{"status=out", "status=low"} {
		if strings.Contains(body, leak) {
			t.Errorf("the raw status code %q leaked into the sheet:\n%s", leak, body)
		}
	}
}

// The top-cost list is cut to eight upstream. Unsaid, the model reads it as the
// whole set — the mistake the menu rankings already made — and then the total
// below it reads as the shop's entire ingredient spend.
func TestTopCostSheetAdmitsItIsAPartialListBeforeTotalling(t *testing.T) {
	body, _ := joyboyFactBody(AIToolResult{
		Tool: AIToolGetTopCostIngredients,
		TopCostIngredients: []AICostIngredient{
			{Name: "เนื้อหมู", Unit: "กก.", Cost: 5000, Used: 25},
			{Name: "กุ้งสด", Unit: "กก.", Cost: 3000, Used: 10},
		},
	})
	if !strings.Contains(body, "อันดับต้นเพียง 2 ตัว") {
		t.Errorf("the sheet must say the list is partial:\n%s", body)
	}
	if !strings.Contains(body, "listed_items_cost_total=8000") {
		t.Errorf("the total of the listed rows should be stated:\n%s", body)
	}
	if !strings.Contains(body, "ไม่ใช่ต้นทุนวัตถุดิบทั้งร้าน") {
		t.Errorf("the total must be scoped to the listed rows only:\n%s", body)
	}
}

// A gap that means "not entered yet" must never read as "the real value is
// zero". That confusion is exactly how a month of revenue got reported as
// "กำไรสุทธิ" when no expenses had been recorded.
func TestNotSetUpGapsDoNotReadAsZero(t *testing.T) {
	cases := []struct {
		tool   AIToolName
		result AIToolResult
		forbid string
	}{
		{AIToolGetInventoryValuation, AIToolResult{Tool: AIToolGetInventoryValuation}, "มูลค่าสต๊อกเป็น 0"},
		{AIToolGetProfitSummary, AIToolResult{Tool: AIToolGetProfitSummary}, "กำไรเป็น 0"},
		{AIToolGetMostExpensiveMenu, AIToolResult{Tool: AIToolGetMostExpensiveMenu}, "ไม่มีเมนูขาย"},
	}
	for _, c := range cases {
		body, ok := joyboyFactBody(c.result)
		if !ok {
			t.Fatalf("%s did not render", c.tool)
		}
		if !strings.Contains(body, "ไม่ได้แปลว่าค่าจริงเป็นศูนย์") {
			t.Errorf("%s: an unfilled gap must say it is not a zero:\n%s", c.tool, body)
		}
		if !strings.Contains(body, "ห้าม") {
			t.Errorf("%s: the sheet should say what not to answer:\n%s", c.tool, body)
		}
	}

	// A shop with no tables set up is not a shop with no free tables.
	tables := joyboyTableStatusBody(nil)
	if !strings.Contains(tables, "ห้ามตอบว่าร้านไม่มีโต๊ะว่าง") {
		t.Errorf("an unconfigured floor must not read as a full one:\n%s", tables)
	}
}

// The two-period comparison already states direction in Thai with an unsigned
// percentage, because a bare "-0.32" let the model narrate the wrong subject and
// keep the minus. The weekly trend sheet had the same bare figure.
func TestSalesTrendStatesDirectionInsteadOfASignedPercent(t *testing.T) {
	down, _ := joyboyFactBody(AIToolResult{
		Tool:       AIToolGetSalesTrend,
		SalesTrend: &AISalesTrend{HasPrior: true, RecentDays: 7, RecentOrders: 80, RecentRevenue: 80, PriorOrders: 90, PriorRevenue: 100, RevenueChangePct: -20},
	})
	if !strings.Contains(down, "direction=ลดลง") {
		t.Errorf("a fall should be a Thai word:\n%s", down)
	}
	if strings.Contains(down, "-20") {
		t.Errorf("the percentage must not carry a sign as well as a direction:\n%s", down)
	}
	up, _ := joyboyFactBody(AIToolResult{
		Tool:       AIToolGetSalesTrend,
		SalesTrend: &AISalesTrend{HasPrior: true, RecentDays: 7, RecentOrders: 100, RecentRevenue: 120, PriorOrders: 90, PriorRevenue: 100, RevenueChangePct: 20},
	})
	if !strings.Contains(up, "direction=เพิ่มขึ้น") {
		t.Errorf("a rise should be a Thai word:\n%s", up)
	}
}

// Raw service-type codes get translated by the model, differently each time.
func TestOrderTypeIsTranslatedBeforeTheModelSeesIt(t *testing.T) {
	body, _ := joyboyFactBody(AIToolResult{
		Tool: AIToolGetOrderTypeBreakdown,
		OrderTypeBreakdown: []repository.AIOrderTypeSummary{
			{OrderType: "dine_in", Orders: 900, Revenue: 250000},
			{OrderType: "takeaway", Orders: 385, Revenue: 97453},
		},
	})
	for _, want := range []string{"order_type=กินที่ร้าน", "order_type=สั่งกลับบ้าน"} {
		if !strings.Contains(body, want) {
			t.Errorf("order type should reach the model in Thai, missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "dine_in") || strings.Contains(body, "takeaway") {
		t.Errorf("raw codes leaked to the model:\n%s", body)
	}
}

// "ครัวกำลังทำอะไรอยู่บ้าง" over a flat list of 22 rows came back 4, 3, 4 and 6 on
// four asks, over a floor with 5 cooking and 5 queued. The sheet must hand the
// model each status as a group with its count, so the answer is read, not
// tallied.
func TestActiveOrdersSheetGroupsRowsByStatusWithCounts(t *testing.T) {
	now := time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC)
	mk := func(number, status string) repository.AIActiveOrder {
		return repository.AIActiveOrder{OrderNumber: number, OrderType: "takeaway", Status: status,
			PaymentStatus: "unpaid", GrandTotal: 100, CustomerCount: 1, OpenedAt: now.Add(-10 * time.Minute)}
	}
	body := joyboyActiveOrdersBody([]repository.AIActiveOrder{
		mk("T1", entity.OrderStatusServed),
		mk("T2", entity.OrderStatusCooking),
		mk("T3", entity.OrderStatusSentToKitchen),
		mk("T4", entity.OrderStatusCooking),
		mk("T5", entity.OrderStatusReady),
		mk("T6", entity.OrderStatusCooking),
	}, now)

	for _, want := range []string{
		"group=ครัวกำลังทำ count=3",
		"group=ส่งครัวแล้ว รอครัวเริ่มทำ count=1",
		"group=ครัวทำเสร็จ รอเสิร์ฟ count=1",
		"group=เสิร์ฟแล้ว รอเก็บเงิน count=1",
		"in_kitchen_now=4",
		"ห้ามนับแถวเอง",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the grouped sheet lost %q:\n%s", want, body)
		}
	}
	// The cooking rows sit under their own header, and before the queue.
	cooking := strings.Index(body, "group=ครัวกำลังทำ count=3")
	queued := strings.Index(body, "group=ส่งครัวแล้ว")
	t2 := strings.Index(body, "order=T2 ")
	if !(cooking < t2 && t2 < queued) {
		t.Errorf("cooking rows must sit under the cooking header and before the queue:\n%s", body)
	}
}

// "เดือนที่แล้วขายได้เท่าไหร่ จ่ายไปเท่าไหร่ เหลือเท่าไหร่" was answered 284,900 /
// 5,130.74 / "กำไรของเมนู 197,122.38" — every figure right, the subtraction
// never done, and "กำไร" never said to be gross. The sheet now names what the
// profit is and carries the net after the recorded ledger as its own figure.
func TestProfitSheetCarriesGrossMeaningAndNetAfterRecordedExpenses(t *testing.T) {
	metrics := []repository.AIMenuMarginSummary{
		{MenuName: "ต้มยำกุ้งน้ำข้น", Quantity: 100, Revenue: 13900, Cost: 4400, Profit: 9500, Margin: 68.35},
		{MenuName: "ชาไทยเย็น", Quantity: 200, Revenue: 9800, Cost: 3000, Profit: 6800, Margin: 69.39},
	}
	body := joyboyProfitForPeriodBody("เดือนสิงหาคม 2569", metrics, &ExpenseListResponse{Total: 5130.74, Entries: 5})
	for _, want := range []string{
		"gross_profit=16300.00",
		"gross_profit_means=กำไรขั้นต้น",
		"ก่อนหักรายจ่าย",
		// 16300 − 5130.74, subtracted here, not by the model.
		"expenses_recorded=5130.74 expense_items=5 net_after_expenses=11169.26",
		"หักเฉพาะรายจ่ายที่บันทึกไว้",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the profit sheet lost %q:\n%s", want, body)
		}
	}

	// An empty ledger: the net equals gross, and the sheet says why.
	body = joyboyProfitForPeriodBody("เมื่อวาน", metrics, &ExpenseListResponse{})
	if !strings.Contains(body, "expense_items=0 net_after_expenses=16300.00") || !strings.Contains(body, "ยังไม่มีรายจ่ายอื่นนอกจากวัตถุดิบ") {
		t.Errorf("an empty ledger should give net = gross with the caveat:\n%s", body)
	}

	// Ingredient purchases are not taken off again: gross profit already took
	// off the recipe cost of what sold (26 ก.ย. 2569). 5,130.74 of which
	// 3,734.45 is ingredients → only 1,396.29 comes off.
	body = joyboyProfitForPeriodBody("เดือนสิงหาคม 2569", metrics, &ExpenseListResponse{
		Total: 5130.74, Entries: 5,
		Categories: []repository.ExpenseCategoryTotal{
			{Category: "ingredient", Amount: 3734.45, Entries: 4},
			{Category: "utilities", Amount: 1396.29, Entries: 1},
		},
	})
	for _, want := range []string{
		"expenses_recorded=1396.29 expense_items=1 net_after_expenses=14903.71",
		"ingredient_purchases=3734.45 ingredient_purchase_items=4",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("ingredient purchases must be named but not netted, missing %q:\n%s", want, body)
		}
	}

	// Ledger not fetched: no net line at all, rather than one that implies zero.
	if body := joyboyProfitForPeriodBody("เมื่อวาน", metrics, nil); strings.Contains(body, "net_after_expenses") {
		t.Errorf("without the ledger there must be no net figure:\n%s", body)
	}
}

// "จ่ายพร้อมเพย์กับเงินสดอย่างไหนเยอะกว่า" had no tool at all. The sheet divides
// the shares itself and says how many paid bills carry no method, because
// everything before the day payments started being recorded does not.
func TestPaymentMixSheetSharesAndCoverage(t *testing.T) {
	body := joyboyPaymentMixBody("30 วันล่าสุด",
		[]repository.AIPaymentMethodSummary{
			{Method: "cash", Bills: 78, Amount: 23384},
			{Method: "promptpay_qr", Bills: 58, Amount: 14550},
		},
		repository.AIPaymentCoverage{PaidBills: 969, WithMethod: 136, FirstRecorded: "2026-08-30"})
	for _, want := range []string{
		"bills_with_method=136 amount=37934.00",
		"method=เงินสด bills=78 amount=23384.00 bill_share_pct=57.35 amount_share_pct=61.64",
		"method=พร้อมเพย์ bills=58",
		"bills_without_method=833",
		"payment_method_recorded_from=2026-08-30",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the payment sheet lost %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "promptpay_qr") {
		t.Errorf("the raw method code must not reach the model:\n%s", body)
	}
	empty := joyboyPaymentMixBody("ปี 2567", nil, repository.AIPaymentCoverage{PaidBills: 0, FirstRecorded: "2026-08-30"})
	if !strings.Contains(empty, "no_payment_method_recorded_in_period") || !strings.Contains(empty, "ห้ามประมาณสัดส่วนเอง") {
		t.Errorf("an empty window must say so in Thai:\n%s", empty)
	}
}

// "โต๊ะไหนคนไม่ค่อยนั่ง แล้วควรย้ายไปโซนไหนดี" was answered from live status
// alone — "ทุกโต๊ะว่างอยู่ครับ" — because nothing read the bills' memory of which
// table served them. One sheet has to answer both halves: which table is quiet,
// and which zone is busy enough to move it to.
func TestTableUsageSheetRanksTablesAndZones(t *testing.T) {
	body := joyboyTableUsageBody("30 วันล่าสุด", []repository.AITableUsage{
		{TableNumber: "P03", Zone: "ห้องส่วนตัว", Capacity: 6, Bills: 1, Revenue: 531, Guests: 1},
		{TableNumber: "P01", Zone: "ห้องส่วนตัว", Capacity: 6, Bills: 2, Revenue: 318, Guests: 2},
		{TableNumber: "F01", Zone: "โซนหน้าร้าน", Capacity: 2, Bills: 7, Revenue: 2302, Guests: 18},
		{TableNumber: "F02", Zone: "โซนหน้าร้าน", Capacity: 2, Bills: 4, Revenue: 599, Guests: 10},
	})

	for _, want := range []string{
		// The quiet table sits first, and carries the fair comparison Go divided.
		"table=P03 zone=ห้องส่วนตัว seats=6 bills=1 revenue=531.00 guests=1 bills_per_seat=0.17",
		"table=F01 zone=โซนหน้าร้าน seats=2 bills=7 revenue=2302.00 guests=18 bills_per_seat=3.50",
		"revenue_per_bill=328.86",
		// Zones are totalled from the same rows, busiest first.
		"zone_rank=1 zone=โซนหน้าร้าน tables=2 seats=4 bills=11",
		"zone_rank=2 zone=ห้องส่วนตัว tables=2 seats=12 bills=3",
		"bill_share_pct=78.57",
		"ranked_by=bills asc",
		"bills_per_seat เพราะโต๊ะใหญ่กับโต๊ะเล็กเทียบจำนวนบิลตรง ๆ ไม่ได้",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the table-usage sheet lost %q:\n%s", want, body)
		}
	}
	// A table nobody sat at must stay on the sheet as a table with no bills.
	quiet := joyboyTableUsageBody("30 วันล่าสุด", []repository.AITableUsage{
		{TableNumber: "B09", Zone: "", Capacity: 4, Bills: 0},
	})
	if !strings.Contains(quiet, "table=B09 zone=ไม่ระบุโซน seats=4 bills=0") {
		t.Errorf("an unused table must still be listed:\n%s", quiet)
	}
	if strings.Contains(quiet, "revenue_per_bill") {
		t.Errorf("no bills means no per-bill average:\n%s", quiet)
	}
	if !strings.Contains(joyboyTableUsageBody("30 วันล่าสุด", nil), "no_tables_recorded") {
		t.Error("a shop with no tables should say so")
	}
}

// The minimum is arithmetic, so the sheet states it — asked over thirteen
// unlabelled rows the model once named the wrong table. Which zone to move to is
// a judgement, so the sheet carries the figures and no recommendation.
func TestTableUsageSheetNamesTheQuietTableButNotWhereToMoveIt(t *testing.T) {
	body := joyboyTableUsageBody("30 วันล่าสุด", []repository.AITableUsage{
		{TableNumber: "A02", Zone: "โซนครอบครัว", Capacity: 4, Bills: 1, Revenue: 279, Guests: 3},
		{TableNumber: "P03", Zone: "ห้องส่วนตัว", Capacity: 6, Bills: 2, Revenue: 531, Guests: 4},
		{TableNumber: "F01", Zone: "โซนหน้าร้าน", Capacity: 2, Bills: 7, Revenue: 2302, Guests: 18},
	})
	if !strings.Contains(body, "quietest_table=A02 zone=โซนครอบครัว bills=1 revenue=279.00") {
		t.Errorf("the quiet table is a computed minimum and must be stated:\n%s", body)
	}
	if !strings.Contains(body, "zone_bills_per_seat_means=") {
		t.Errorf("the sheet must say what the per-seat rate means:\n%s", body)
	}
	// Go must not pick the zone, nor tell the model what to say about it.
	for _, forbidden := range []string{"suggested_zone_to_move_to", "suggestion_means", "ไม่ต้องบอกว่าไม่มีข้อมูล"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("Go decided something it should not have (%s):\n%s", forbidden, body)
		}
	}
}

// The rows of a period menu sheet arrive ordered by revenue, but the questions
// asked of them are "เมนูไหนขายดี" (dishes sold) and "เมนูไหนกำไรดี" (profit).
// Left to re-sort the list itself the model put ข้าวกะเพรา — 52 dishes, the
// most of any row — eleventh, below rows with 43. Ordering numbers is
// arithmetic, so the sheet carries the ranks and says which order it is in.
func TestMenuForPeriodBodyRanksByQuantityAndProfit(t *testing.T) {
	body := joyboyMenuForPeriodBody("7 วันล่าสุด", []repository.AIMenuMarginSummary{
		{MenuName: "ผัดไทยกุ้งสด", Quantity: 67, Revenue: 6030, Profit: 2010, Margin: 33.3},
		{MenuName: "ข้าวกะเพราไก่ไข่ดาว", Quantity: 52, Revenue: 4100, Profit: 2400, Margin: 58.5},
		{MenuName: "น้ำมะนาวโซดา", Quantity: 71, Revenue: 3195, Profit: 900, Margin: 28.2},
	})

	for _, want := range []string{
		"row_order=revenue desc",
		"menu=น้ำมะนาวโซดา qty=71 qty_rank=1",
		"menu=ผัดไทยกุ้งสด qty=67 qty_rank=2",
		"menu=ข้าวกะเพราไก่ไข่ดาว qty=52 qty_rank=3",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("sheet missing %q:\n%s", want, body)
		}
	}
	// Profit ranks the same rows differently — that is the whole point of
	// carrying both, so a profit question is not answered from the sales order.
	if !strings.Contains(body, "profit_rank=1 margin_pct=58.50") {
		t.Errorf("ข้าวกะเพรา should lead on profit:\n%s", body)
	}
}

// A sheet cut to its first rows says so. Silently showing fifteen of forty reads
// as "these are all the menus", and an answer built on that is wrong about the
// menus it never saw.
func TestMenuForPeriodBodyDeclaresTruncation(t *testing.T) {
	metrics := make([]repository.AIMenuMarginSummary, 0, 20)
	for i := 0; i < 20; i++ {
		metrics = append(metrics, repository.AIMenuMarginSummary{
			MenuName: fmt.Sprintf("เมนู %d", i), Quantity: int64(20 - i), Revenue: float64(200 - i*10),
		})
	}
	body := joyboyMenuForPeriodBody("สัปดาห์ที่แล้ว", metrics)
	if !strings.Contains(body, "rows_shown=15 of 20") {
		t.Errorf("a cut sheet must declare the cut:\n%s", body)
	}
}

// "วันนี้มีบิลยกเลิกกี่ใบ" had no sheet to read, and the model promised to go
// and look, three times out of three. The sheet carries the count, the money,
// and the staff's reasons — and zero cancelled bills is an answer, said so.
func TestCancelledOrdersBodyListsReasonsAndCallsZeroAnAnswer(t *testing.T) {
	body := joyboyCancelledOrdersBody("วันนี้", []repository.AICancelledReason{
		{Reason: "ลูกค้าเปลี่ยนใจ", Bills: 2, Total: 540},
		{Reason: "", Bills: 1, Total: 120},
	})
	for _, want := range []string{
		"cancelled_bills=3 cancelled_total=660.00",
		"reason=ลูกค้าเปลี่ยนใจ bills=2 total=540.00",
		"reason=ไม่ได้ระบุเหตุผล bills=1",
		"ไม่รวมในยอดขาย",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("sheet missing %q:\n%s", want, body)
		}
	}
	none := joyboyCancelledOrdersBody("วันนี้", nil)
	if !strings.Contains(none, "cancelled_bills=0 cancelled_total=0.00") || !strings.Contains(none, "เป็นคำตอบ ไม่ใช่ข้อมูลขาด") {
		t.Errorf("zero cancellations must read as an answer:\n%s", none)
	}
}

// "วันนี้มีลูกค้ากี่คน" had no sheet to read, and the model answered three
// different ways in three runs — the bill count, the tables in use, and "ระบบ
// ไม่ได้เก็บจำนวนคน", which is untrue. The sheet carries the headcount as whole
// people: a total, the party sizes, and the most common one. No average, because
// 2.8 people is arithmetic nobody can seat.
func TestCustomerCountBodyCountsWholePeople(t *testing.T) {
	body := joyboyCustomerCountBody("วันนี้", []repository.AIPartySize{
		{PartySize: 1, Bills: 3},
		{PartySize: 2, Bills: 8},
		{PartySize: 3, Bills: 5},
		{PartySize: 4, Bills: 2},
	}, []repository.AIActiveOrder{
		{CustomerCount: 2}, {CustomerCount: 4}, {CustomerCount: 3}, {CustomerCount: 2},
	}, true)

	for _, want := range []string{
		"guests=42 bills=18", // 3 + 16 + 15 + 8
		"party_size=2 bills=8",
		"most_common_party_size=2",
		"open_bills_now=4 open_guests_now=11",
		"ห้ามหารเฉลี่ยจำนวนคน",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("sheet missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "guests_per_bill") || strings.Contains(body, "2.3") {
		t.Errorf("a fractional headcount slipped in:\n%s", body)
	}
}

// A window that ended before now has no open bills in it. The open_ lines are
// left out rather than shown as zero, because "open_guests_now=0" under last
// month reads as a fact about last month.
func TestCustomerCountBodyOmitsOpenBillsForPastWindows(t *testing.T) {
	body := joyboyCustomerCountBody("เดือนสิงหาคม 2569", []repository.AIPartySize{{PartySize: 2, Bills: 10}}, nil, false)
	if strings.Contains(body, "open_") {
		t.Errorf("a past window must not carry open-bill lines:\n%s", body)
	}
	if !strings.Contains(body, "guests=20 bills=10") {
		t.Errorf("headcount missing:\n%s", body)
	}
}

// No closed bills is "0 people so far", said in a way that cannot be misread as
// "the system does not record people" — which is the sentence this tool exists
// to stop.
func TestCustomerCountBodyNoBillsIsNotNoFeature(t *testing.T) {
	body := joyboyCustomerCountBody("วันนี้", nil, nil, true)
	for _, want := range []string{"guests=0 bills=0", "status=no_data", "ไม่ใช่ว่าระบบไม่เก็บจำนวนคน"} {
		if !strings.Contains(body, want) {
			t.Errorf("sheet missing %q:\n%s", want, body)
		}
	}
}
