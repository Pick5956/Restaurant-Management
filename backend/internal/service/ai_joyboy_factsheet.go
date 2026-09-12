package service

// Fact sheet rendering for joyboy.
//
// This exists because localToolAnswer, which legacy uses, does not return data —
// it returns a finished Thai answer, complete with "ครับ", bullet lists and
// emoji. Handing that to a model and asking for an answer asks it to reword
// someone else's writing, and it obliges: a store summary came back as legacy's
// own bullets in legacy's own order, emoji included.
//
// So joyboy renders the same AIToolResult as figures instead. There is no
// sentence to copy, so the model has to write one. The calculations are
// untouched — the values here are the values legacy would have printed, only
// without the prose around them. localToolAnswer is left exactly as it is,
// because legacy still answers users through it.
//
// The shape is one record per line, `key=value` separated by spaces. Numbers
// carry no thousands separators and no currency word: how a figure should look
// to an owner is the model's decision, and giving it a formatted string invites
// it to paste that string through.

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// joyboyNoData marks a tool that ran correctly but had nothing to report, with
// the reason attached — "no sales recorded" and "costs not filled in yet" call
// for different answers, and only the tool knows which one happened.
// joyboyNoData renders a gap in the data, and it never renders one bare.
//
// A bare "status=no_data reason=every_stocked_ingredient_was_used_in_period" is
// what the model read when the owner asked "เงินจมอยู่กับของอะไรบ้าง", and it
// answered "มูลค่าคงคลังรวม 35,770 บาท" — a figure larger than the whole shelf is
// worth. The question asked for money; the sheet gave a code in English; the
// model filled the gap. Every gap therefore carries, in Thai, what it means and
// what the true answer is (usually zero, or "not recorded", which are different
// things). The map is the contract: TestEveryNoDataReasonHasAMeaning fails the
// build for any reason used in this package that is missing from it.
func joyboyNoData(reason string) string {
	note, known := joyboyNoDataMeaning[reason]
	if !known {
		note = "ไม่มีข้อมูลส่วนนี้ ให้บอกตรง ๆ ว่าไม่มี ห้ามประมาณตัวเลขเอง"
	}
	return "status=no_data reason=" + reason + "\nnote=" + note
}

// joyboyNoDataMeaning is what each gap means, written for the model to read and
// the owner to hear. Two rules for every entry: say what the correct answer IS
// (zero / not recorded / not in the shop), and say that no other figure exists
// on this sheet — the model fills a silence with a number; it does not fill a
// sentence that already answered.
var joyboyNoDataMeaning = map[string]string{
	"every_stocked_ingredient_was_used_in_period": "วัตถุดิบทุกตัวที่มีในสต็อกถูกใช้ในช่วงนี้ เงินจม = 0 บาท ไม่มีของค้าง " +
		"ใบนี้ไม่มีตัวเลขอื่น ถ้าถามมูลค่าคลังรวม ให้บอกว่าต้องถามแยกต่างหาก ห้ามประมาณ",
	"no_ingredient_usage_recorded_in_period":      "ยังไม่มีการตัดสต็อกจากการขายในช่วงนี้ จึงยังไม่มีต้นทุนวัตถุดิบที่ใช้ไป = 0 บาท ไม่ใช่ว่าร้านไม่มีต้นทุน",
	"no_ingredient_usage_recorded_to_project_from": "ยังไม่มีการใช้วัตถุดิบในช่วงนี้ จึงคำนวณไม่ได้ว่าของจะหมดในกี่วัน ห้ามประมาณจำนวนวันเอง",
	"no_orders_recorded_in_period":                "ยังไม่มีบิลในช่วงนี้ ยอดขาย = 0 บาท ออเดอร์ = 0 ไม่มีตัวเลขอื่นให้อ้าง",
	"no_paid_sales_in_the_last_months":            "ไม่มีบิลที่จ่ายแล้วเลยในช่วงหลายเดือนที่ผ่านมา จึงไม่มีกำไรรายเดือนให้แสดง",
	"no_orders_recorded_in_that_period":           "ช่วงที่ถามไม่มีบิลที่ชำระเงินเลย ยอดขาย = 0 บาท ออเดอร์ = 0 ห้ามยกตัวเลขช่วงอื่นมาแทน",
	"no_paid_orders_in_period":                    "ช่วงที่ถามไม่มีบิลที่ชำระเงินเลย ยอดขาย = 0 บาท ออเดอร์ = 0 ห้ามยกตัวเลขช่วงอื่นมาแทน",
	"no_paid_sales_in_period":                     "ช่วงที่ถามไม่มียอดขายที่ชำระเงิน รายได้ ต้นทุน กำไร = 0 ทั้งหมด ห้ามยกตัวเลขช่วงอื่นมาแทน",
	"no_paid_sales_recorded_at_all":               "ระบบยังไม่มีบิลที่ชำระเงินเลยแม้แต่ใบเดียว จึงยังบอกช่วงข้อมูลไม่ได้",
	"no_menu_sales_recorded_in_period":            "ช่วงนี้ไม่มีเมนูไหนขายได้เลย จึงไม่มีอันดับให้จัด ห้ามแต่งอันดับหรือจำนวน",
	"no_prior_week_to_compare_against":            "ยังไม่มีข้อมูลสัปดาห์ก่อนหน้าให้เทียบ บอกได้แค่ตัวเลขช่วงล่าสุด ห้ามคิดเปอร์เซ็นต์เปลี่ยนแปลงเอง",
	"margin_needs_recorded_sales_and_ingredient_costs": "ยังคำนวณกำไรต่อเมนูไม่ได้ เพราะยังไม่มียอดขายหรือยังไม่ได้ผูกต้นทุนวัตถุดิบกับเมนู ไม่ใช่ว่ากำไรเป็นศูนย์",
	"menu_classification_needs_sales_and_costs":   "ยังจัดกลุ่มเมนู (ดาว/ม้างาน/ปริศนา/หมา) ไม่ได้ เพราะยังไม่มีทั้งยอดขายและต้นทุนครบ",
	"period_not_recognised":                       "อ่านช่วงเวลาที่ถามไม่ออก ให้ถามกลับว่าหมายถึงวันไหนหรือเดือนไหน ห้ามเดาช่วง",
	"no_expenses_recorded_in_window":              "ช่วงนี้ยังไม่มีรายจ่ายบันทึกไว้ในระบบ รายจ่ายที่บันทึก = 0 บาท 0 รายการ ไม่ได้แปลว่าร้านไม่มีค่าใช้จ่าย",
	"no_active_orders_right_now":                  "ไม่มีออเดอร์ค้างอยู่เลย ทุกบิลปิดหมดแล้ว บิลค้าง = 0",
	"no_bills_recorded":                           "ร้านยังไม่มีบิลสักใบในระบบ จึงไม่มีบิลให้เปิดดู ไม่ใช่ว่าหาไม่เจอ ให้บอกว่ายังไม่เคยมีการเปิดบิลเลย",
	"no_restaurant_profile":                       "ยังไม่มีข้อมูลตัวร้าน (ชื่อ สาขา เวลาเปิด) ในระบบ ให้บอกว่ายังไม่ได้ตั้งค่า",
	"not_enough_daily_history_to_forecast":        "ข้อมูลรายวันยังน้อยเกินกว่าจะพยากรณ์ ห้ามประมาณยอดขายล่วงหน้าเอง",
	"no_matching_documentation":                   "ไม่พบหัวข้อนี้ในคู่มือระบบ ให้บอกว่าไม่พบ ห้ามเดาวิธีใช้",
	"no_ingredients_recorded":                     "ยังไม่มีวัตถุดิบในคลังเลย ต้องไปเพิ่มที่หน้าคลังก่อน",
	"no_ingredient_named_in_question":             "ยังไม่รู้ว่าถามถึงวัตถุดิบตัวไหน ให้ถามกลับ ห้ามเดาตัวเลขของตัวไหน",
	"no_menu_items_recorded":                      "ยังไม่มีเมนูในระบบเลย ต้องไปเพิ่มที่หน้าจัดการเมนูก่อน",
	"no_menu_named_in_question":                   "ยังไม่รู้ว่าถามถึงเมนูไหน ให้ถามกลับ ห้ามเดาตัวเลขของเมนูไหน",
	"no_payment_method_recorded_in_period":        "ช่วงนี้ไม่มีบิลที่บันทึกวิธีจ่ายเงินไว้ จึงบอกไม่ได้ว่าเงินสดหรือพร้อมเพย์เท่าไหร่ ห้ามประมาณสัดส่วนเอง",
	"no_tables_recorded":                          "ร้านนี้ยังไม่มีโต๊ะในระบบเลย ต้องไปเพิ่มโต๊ะที่หน้าผังโต๊ะก่อน",
	"no_closed_bills_to_count_guests_from":        "ช่วงนี้ยังไม่มีบิลที่ปิดแล้ว จึงยังไม่มีจำนวนลูกค้าให้นับ = 0 คน ไม่ใช่ว่าระบบไม่เก็บจำนวนคน",
	"no_cancelled_bills_in_period":                "ช่วงนี้ไม่มีบิลที่ถูกยกเลิกเลย บิลยกเลิก = 0 ใบ 0 บาท เป็นคำตอบ ไม่ใช่ข้อมูลขาด",
	"period_before_first_record":                  "ช่วงที่ถามจบก่อนบิลแรกในระบบ ไม่ใช่ว่าร้านขายไม่ได้ แค่ตอนนั้นยังไม่ได้ใช้ระบบ วันที่บิลแรกอยู่ในบรรทัด data_coverage ต้องบอกเจ้าของว่าข้อมูลเริ่มวันไหน",
}

func joyboyNum(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64)
}

func joyboyJoin(lines []string) string {
	return strings.Join(lines, "\n")
}

// joyboyNotSetUpYet marks a gap that means "the owner has not entered this yet",
// which is not the same as "the real value is zero".
//
// The two read alike on an empty sheet and the model picks whichever answers the
// question: with no expenses recorded for July it took the spend as zero and
// called a month of revenue "กำไรสุทธิ". Every gap of this kind now says which
// kind it is, and what to tell the owner instead.
func joyboyNotSetUpYet(reason, sayInstead string) string {
	return joyboyJoin([]string{
		joyboyNoData(reason),
		"gap_means=ยังไม่ได้บันทึกข้อมูลส่วนนี้ในระบบ ไม่ได้แปลว่าค่าจริงเป็นศูนย์",
		"note=" + sayInstead,
	})
}

// joyboyMenuMarginLine renders the one menu shape that carries cost and profit.
func joyboyMenuMarginLine(menu *repository.AIMenuMarginSummary) string {
	quantity := float64(menu.Quantity)
	line := fmt.Sprintf("menu=%s qty=%d revenue=%s cost=%s profit=%s margin_pct=%s",
		menu.MenuName, menu.Quantity,
		joyboyNum(menu.Revenue), joyboyNum(menu.Cost), joyboyNum(menu.Profit), joyboyNum(menu.Margin))
	if quantity > 0 {
		line += fmt.Sprintf(" cost_per_dish=%s profit_per_dish=%s",
			joyboyNum(menu.Cost/quantity), joyboyNum(menu.Profit/quantity))
	}
	return line
}

// joyboyFactBody renders one tool result as figures. The second value reports
// whether this tool is rendered at all; an unrendered tool is left out of the
// fact sheet rather than shown as an empty block.
func joyboyFactBody(result AIToolResult) (string, bool) {
	window := "period=" + analysisWindowLabel()

	switch result.Tool {
	case AIToolGetLowestMarginMenu, AIToolGetHighestMarginMenu, AIToolGetLowestCostMenu:
		menu := result.LowestMarginMenu
		switch result.Tool {
		case AIToolGetHighestMarginMenu:
			menu = result.HighestMarginMenu
		case AIToolGetLowestCostMenu:
			menu = result.LowestCostMenu
		}
		if menu == nil || menu.Quantity <= 0 {
			return joyboyNoData("margin_needs_recorded_sales_and_ingredient_costs"), true
		}
		return joyboyJoin([]string{window, joyboyMenuMarginLine(menu)}), true

	case AIToolGetLowStockIngredients:
		if len(result.LowStockIngredients) == 0 {
			// "Nothing is low" is a finding, not missing data, and the difference
			// reaches the owner. Handed the bare no_data code the model wrote
			// "ผมไม่มีข้อมูลวัตถุดิบใกล้หมด" — which reads as a broken assistant over
			// a shop whose shelves are simply fine. The sheet states the fact.
			return joyboyJoin([]string{
				"scope=current_stock_level",
				"items_below_minimum=0",
				"note=ตรวจแล้วไม่มีวัตถุดิบตัวไหนต่ำกว่าขั้นต่ำเลย ให้ตอบว่าสต๊อกยังปกติ ยังไม่ต้องสั่งเพิ่ม " +
					"ห้ามตอบว่าไม่มีข้อมูลหรือดูไม่ได้ เพราะระบบตรวจให้แล้วและผลคือไม่มีตัวไหนใกล้หมด",
			}), true
		}
		lines := []string{"scope=current_stock_level"}
		// The cost of restocking everything on this list is a multiply-then-sum,
		// which the model may not do — so "ต้องใช้เงินเท่าไหร่ถ้าเติมของที่ใกล้หมด
		// ทั้งหมด" had no figure to read. Go totals it.
		var restockCost float64
		for _, item := range result.LowStockIngredients {
			restockCost += item.RestockEstimate * item.CostPerUnit
			lines = append(lines, fmt.Sprintf(
				"ingredient=%s status=%s stock=%s unit=%s min_stock=%s restock_suggested=%s cost_per_unit=%s",
				item.Name, aiStockStatusThai(item.Status), joyboyNum(item.Stock), item.Unit,
				joyboyNum(item.MinStock), joyboyNum(item.RestockEstimate), joyboyNum(item.CostPerUnit)))
		}
		// The list is the twelve most urgent, not the whole shelf: the snapshot
		// caps it so a shop that is low on forty things does not send forty rows
		// on every question. The count, though, has to be the shelf's — printed
		// as len(list) it said "12 รายการ" over fifteen below minimum, and the
		// restock total was the cost of twelve.
		total := len(result.LowStockIngredients)
		if result.InventoryValuation != nil {
			if counted := result.InventoryValuation.LowItems + result.InventoryValuation.OutItems; counted > total {
				total = counted
			}
		}
		// restock_all_cost keeps its name when the list is the whole shelf; a
		// capped list says restock_listed_cost so the total is not read as "all".
		costKey := "restock_all_cost"
		if total > len(result.LowStockIngredients) {
			costKey = "restock_listed_cost"
		}
		lines = append(lines, fmt.Sprintf("items_below_minimum=%d listed=%d %s=%s",
			total, len(result.LowStockIngredients), costKey, joyboyNum(roundBaht(restockCost))))
		if total > len(result.LowStockIngredients) {
			lines = append(lines, fmt.Sprintf("note=ต่ำกว่าขั้นต่ำทั้งหมด %d ตัว ใบนี้แสดง %d ตัวที่เร่งด่วนสุด "+
				"restock_listed_cost คือค่าเติมเฉพาะที่แสดง ไม่ใช่ทั้งหมด ถ้าถามจำนวนให้ตอบ %d",
				total, len(result.LowStockIngredients), total))
		}
		return joyboyJoin(lines), true

	case AIToolGetTopSellingMenus, AIToolGetMenuRevenueRanking, AIToolGetSlowMovingMenus:
		menus := result.TopSellingMenus
		order := "ranked_by=quantity_sold desc"
		switch result.Tool {
		case AIToolGetMenuRevenueRanking:
			menus, order = result.MenuRevenueRanking, "ranked_by=revenue desc"
		case AIToolGetSlowMovingMenus:
			menus, order = result.SlowMovingMenus, "ranked_by=quantity_sold asc"
		}
		if len(menus) == 0 {
			return joyboyNoData("no_menu_sales_recorded_in_period"), true
		}
		// Say plainly that this is a ranking cut to a few rows, not the whole menu.
		// Without it the model read the list as the complete set: asked about a menu
		// that sells well but is not in the top five, it answered "ไม่มียอดขายของ
		// เมนูนี้ในข้อมูล" over a menu with hundreds of sales. A list that does not
		// say it is partial gets treated as exhaustive.
		// The note carries no boolean: cleanAnswer strips a "key=" prefix and keeps
		// the value, so "list_is_partial=true" reached the owner as a bare "(true)"
		// sitting in the middle of a Thai sentence. A plain sentence cannot leak
		// that way.
		lines := []string{
			window,
			order,
			// The second sentence is the other half of the same misreading: told the
		// list was partial, the model still called its last row "เมนูที่ขายแย่ที่สุด"
		// — the bottom of a top-five is not the worst menu in the shop.
		fmt.Sprintf("note=รายการนี้เป็นอันดับต้นเพียง %d เมนู ไม่ใช่เมนูทั้งหมดของร้าน เมนูที่ไม่อยู่ในรายการไม่ได้แปลว่าไม่มียอดขาย "+
			"และห้ามเรียกรายการสุดท้ายในลิสต์ว่าเมนูที่ขายแย่ที่สุดหรือกำไรน้อยที่สุด เพราะเป็นแค่อันดับท้ายของอันดับต้นเท่านั้น", len(menus)),
		}
		for index, menu := range menus {
			lines = append(lines, fmt.Sprintf("rank=%d menu=%s qty=%d revenue=%s",
				index+1, menu.MenuName, menu.Quantity, joyboyNum(menu.Revenue)))
		}
		return joyboyJoin(lines), true

	case AIToolGetInventoryValuation:
		valuation := result.InventoryValuation
		if valuation == nil {
			return joyboyNotSetUpYet("no_ingredients_recorded",
				"ยังไม่มีวัตถุดิบในระบบเลย ห้ามตอบว่ามูลค่าสต๊อกเป็น 0 บาท ให้บอกว่าต้องเพิ่มวัตถุดิบเข้าคลังก่อน"), true
		}
		return joyboyJoin([]string{
			"scope=current_stock_level",
			fmt.Sprintf("total_items=%d low_items=%d out_items=%d total_value=%s",
				valuation.TotalItems, valuation.LowItems, valuation.OutItems, joyboyNum(valuation.Value)),
		}), true

	case AIToolGetSalesSummary:
		summary := result.SalesSummary
		if summary == nil || summary.Orders == 0 {
			return joyboyJoin([]string{window, "orders=0 revenue=0.00", joyboyNoData("no_orders_recorded_in_period")}), true
		}
		return joyboyJoin([]string{
			window,
			fmt.Sprintf("days_with_data=%d orders=%d revenue=%s",
				summary.Days, summary.Orders, joyboyNum(summary.Revenue)),
		}), true

	case AIToolGetProfitSummary:
		profit := result.ProfitSummary
		if profit == nil || profit.Revenue == 0 {
			return joyboyNotSetUpYet("no_margin_data_to_compute_profit",
				"คิดกำไรไม่ได้เพราะยังไม่มียอดขายหรือยังไม่ได้ผูกต้นทุนวัตถุดิบกับเมนู ห้ามตอบว่ากำไรเป็น 0"), true
		}
		lines := []string{
			window,
			fmt.Sprintf("revenue=%s cost=%s profit=%s margin_pct=%s",
				joyboyNum(profit.Revenue), joyboyNum(profit.Cost),
				joyboyNum(profit.Profit), joyboyNum(profit.Margin)),
		}
		// Below full coverage the cost is understated (uncosted menus add revenue
		// with no cost), so profit is a floor. Flag it so the answer can say so
		// rather than presenting a partial figure as the whole store's profit.
		if profit.CoveragePercent < 99.5 {
			lines = append(lines, fmt.Sprintf(
				"note=cost_covers_only_%s_pct_of_revenue_so_profit_is_a_floor",
				joyboyNum(profit.CoveragePercent)))
		}
		return joyboyJoin(lines), true

	case AIToolGetSalesTrend:
		trend := result.SalesTrend
		if trend == nil {
			return joyboyNoData("no_orders_recorded_in_period"), true
		}
		if !trend.HasPrior {
			return joyboyJoin([]string{
				fmt.Sprintf("recent_days=%d recent_orders=%d recent_revenue=%s",
					trend.RecentDays, trend.RecentOrders, joyboyNum(trend.RecentRevenue)),
				joyboyNoData("no_prior_week_to_compare_against"),
			}), true
		}
		// No prior_days line: AISalesTrend counts days for the recent window only,
		// and this used to print RecentDays under the prior label — telling the
		// model the earlier window covered seven days when it may have covered two.
		// The model is instructed never to compute a figure itself, so it repeated
		// the wrong one faithfully. A missing line is a fact the model can work
		// around; a fabricated one it cannot.
		// The direction is a Thai word and the percentage carries no sign, the same
		// way the two-period comparison states it. A bare "-0.32" here invited the
		// same misreading that fix was for: the model narrating the wrong subject
		// and keeping the minus ("ยอดขายลดลง -0.32%" or "เพิ่มขึ้น -0.32%").
		direction, changePct := "เพิ่มขึ้น", trend.RevenueChangePct
		if changePct < 0 {
			direction, changePct = "ลดลง", -changePct
		}
		return joyboyJoin([]string{
			"scope=7วันล่าสุด_เทียบกับ_7วันก่อนหน้า",
			fmt.Sprintf("recent_days=%d recent_orders=%d recent_revenue=%s",
				trend.RecentDays, trend.RecentOrders, joyboyNum(trend.RecentRevenue)),
			fmt.Sprintf("prior_orders=%d prior_revenue=%s",
				trend.PriorOrders, joyboyNum(trend.PriorRevenue)),
			fmt.Sprintf("revenue_change_pct=%s direction=%s note=%s_เทียบกับ_7วันก่อนหน้า",
				joyboyNum(changePct), direction, "7วันล่าสุด"),
		}), true

	case AIToolGetBestSalesDay:
		best := result.BestSalesDay
		if best == nil || !best.HasData {
			return joyboyNoData("no_paid_sales_in_period"), true
		}
		// Both ends, always. Asked for the best day the model would otherwise
		// reach for the worst one from somewhere, and the two figures are one
		// query apart.
		return joyboyJoin([]string{
			window,
			fmt.Sprintf("days_in_window=%d days_with_sales=%d", best.Days, best.DaysWithSales),
			fmt.Sprintf("best_day=%s weekday=%s revenue=%s orders=%d",
				best.BestDate, thaiWeekdayName(int(best.BestWeekday)), joyboyNum(best.BestRevenue), best.BestOrders),
			fmt.Sprintf("worst_day=%s weekday=%s revenue=%s orders=%d",
				best.WorstDate, thaiWeekdayName(int(best.WorstWeekday)), joyboyNum(best.WorstRevenue), best.WorstOrders),
			"note=นี่คือวันที่จริงในปฏิทิน ไม่ใช่วันในสัปดาห์ ห้ามตอบเป็น \"วันพุธ\" เฉย ๆ ให้บอกวันที่ด้วย " +
				"วันที่ไม่มียอดขายเลยไม่ถูกนับเป็นวันที่แย่ที่สุด",
		}), true

	case AIToolGetAverageOrderValue:
		average := result.AverageOrderValue
		if average == nil || average.Orders == 0 {
			return joyboyNoData("no_orders_recorded_in_period"), true
		}
		return joyboyJoin([]string{
			window,
			fmt.Sprintf("days=%d orders=%d revenue=%s average_order_value=%s",
				average.Days, average.Orders, joyboyNum(average.Revenue), joyboyNum(average.AOV)),
		}), true

	case AIToolGetOrderTypeBreakdown:
		if len(result.OrderTypeBreakdown) == 0 {
			return joyboyNoData("no_orders_recorded_in_period"), true
		}
		lines := []string{window, "counted=บิลที่ปิดและจ่ายแล้ว ตามวันปิดบิล นิยามเดียวกับยอดขาย"}
		for _, entry := range result.OrderTypeBreakdown {
			lines = append(lines, fmt.Sprintf("order_type=%s orders=%d revenue=%s",
				aiOrderTypeThai(entry.OrderType), entry.Orders, joyboyNum(entry.Revenue)))
		}
		return joyboyJoin(lines), true

	case AIToolGetPeakPeriods:
		peak := result.PeakPeriods
		if peak == nil || !peak.HasData {
			return joyboyNoData("no_orders_recorded_in_period"), true
		}
		// The two lines are separate rankings over the same window, and saying only
		// "busiest weekday" and "busiest hour" let the model read the second as the
		// busiest hour *of that weekday*: it reported 161 of Monday's 188 orders
		// falling at 11:00, a nested fact neither line states. The counts are what
		// make it obviously wrong, and the note is what stops it being written.
		return joyboyJoin([]string{
			window,
			fmt.Sprintf("busiest_weekday=%s weekday_orders=%d",
				thaiWeekdayName(peak.TopWeekday), peak.TopWeekdayOrders),
			fmt.Sprintf("busiest_hour_across_all_days=%02d:00 hour_orders=%d", peak.TopHour, peak.TopHourOrders),
			"note=สองบรรทัดนี้นับคนละแกน วันที่คับคั่งที่สุดกับชั่วโมงที่คับคั่งที่สุดนับรวมทุกวันในช่วงนี้ " +
				"ห้ามบอกว่าชั่วโมงนั้นเป็นชั่วโมงที่คับคั่งที่สุดของวันนั้น",
		}), true

	case AIToolGetMenuEngineering:
		engineering := result.MenuEngineering
		if engineering == nil {
			return joyboyNoData("menu_classification_needs_sales_and_costs"), true
		}
		// The quadrant name is the classification itself, so it stays in English
		// with its meaning spelled out beside it. Without that the model has to
		// guess what "plowhorse" means, and it guesses differently each time.
		quadrants := []struct {
			name    string
			meaning string
			menus   []string
		}{
			{"star", "popular_and_high_margin", engineering.Stars},
			{"plowhorse", "popular_but_low_margin", engineering.Plowhorses},
			{"puzzle", "unpopular_but_high_margin", engineering.Puzzles},
			{"dog", "unpopular_and_low_margin", engineering.Dogs},
		}
		lines := []string{window, "classification=popularity_vs_margin"}
		for _, quadrant := range quadrants {
			// An empty value reads as missing data rather than as an empty
			// quadrant, and the difference changes the answer.
			menus := "(none)"
			if len(quadrant.menus) > 0 {
				menus = strings.Join(quadrant.menus, ", ")
			}
			lines = append(lines, fmt.Sprintf("quadrant=%s meaning=%s menus=%s",
				quadrant.name, quadrant.meaning, menus))
		}
		return joyboyJoin(lines), true

	case AIToolGetIngredientReorderForecast:
		if len(result.ReorderForecast) == 0 {
			return joyboyNoData("no_ingredient_usage_recorded_to_project_from"), true
		}
		lines := []string{window, "projection=stock_divided_by_average_daily_use",
			// The decimal is the arithmetic; the label is the answer. Left with
			// only days_left=0.11 the model told the owner condensed milk would
			// last "0.11 วัน", which nobody says. Go writes the words.
			"note=ตอบเวลาที่จะหมดด้วยคำใน days_left_label ห้ามพูดเป็นทศนิยมของวัน เช่น 0.11 วัน"}
		for _, item := range result.ReorderForecast {
			lines = append(lines, fmt.Sprintf(
				"ingredient=%s stock=%s unit=%s daily_use=%s days_left=%s days_left_label=%s",
				item.Name, joyboyNum(item.Stock), item.Unit,
				joyboyNum(item.DailyUse), joyboyNum(item.DaysLeft), joyboyDaysLeftLabel(item.DaysLeft)))
		}
		return joyboyJoin(lines), true

	case AIToolGetDeadStock:
		if len(result.DeadStock) == 0 {
			// The zero is printed as a figure, not only described: the question
			// "เงินจมเท่าไหร่" wants a number, and a sheet that has one to give
			// is a sheet the model does not have to invent one for.
			return joyboyJoin([]string{window, "dead_items=0 dead_value_total=0.00",
				joyboyNoData("every_stocked_ingredient_was_used_in_period")}), true
		}
		lines := []string{window, "meaning=held_in_stock_but_never_used_in_period"}
		var deadValue float64
		for _, item := range result.DeadStock {
			deadValue += item.Value
			lines = append(lines, fmt.Sprintf("ingredient=%s stock=%s unit=%s value=%s",
				item.Name, joyboyNum(item.Stock), item.Unit, joyboyNum(item.Value)))
		}
		// "เงินจมรวมเท่าไหร่" is the question this tool exists for, and it is a sum.
		lines = append(lines, fmt.Sprintf("dead_items=%d dead_value_total=%s",
			len(result.DeadStock), joyboyNum(roundBaht(deadValue))))
		return joyboyJoin(lines), true

	case AIToolGetTopCostIngredients:
		if len(result.TopCostIngredients) == 0 {
			return joyboyNoData("no_ingredient_usage_recorded_in_period"), true
		}
		lines := []string{window, "ranked_by=total_cost_consumed desc"}
		// The list is cut to the top eight upstream. Saying so is the same fix the
		// menu rankings needed: a list that does not admit it is partial gets read
		// as the whole set, and the total below would then look like the shop's
		// entire ingredient spend rather than these eight.
		lines = append(lines, fmt.Sprintf(
			"note=รายการนี้เป็นอันดับต้นเพียง %d ตัว ไม่ใช่วัตถุดิบทั้งหมดของร้าน "+
				"ยอดรวมด้านล่างคือรวมเฉพาะ %d ตัวนี้ ไม่ใช่ต้นทุนวัตถุดิบทั้งร้าน",
			len(result.TopCostIngredients), len(result.TopCostIngredients)))
		var listedCost float64
		for index, item := range result.TopCostIngredients {
			listedCost += item.Cost
			lines = append(lines, fmt.Sprintf("rank=%d ingredient=%s cost=%s used=%s unit=%s",
				index+1, item.Name, joyboyNum(item.Cost), joyboyNum(item.Used), item.Unit))
		}
		lines = append(lines, fmt.Sprintf("listed_items_cost_total=%s", joyboyNum(roundBaht(listedCost))))
		return joyboyJoin(lines), true

	case AIToolGetStoreSummary:
		summary := result.StoreSummary
		if summary == nil || summary.Orders == 0 {
			return joyboyNoData("no_orders_recorded_in_period"), true
		}
		lines := []string{
			window,
			fmt.Sprintf("days_with_data=%d orders=%d revenue=%s",
				summary.Days, summary.Orders, joyboyNum(summary.Revenue)),
		}
		if summary.Trend != nil && summary.Trend.HasPrior {
			// The prior window carries no day count of its own, so it is labelled
			// plainly rather than borrowing the recent window's — the same
			// fabrication the standalone trend sheet used to print.
			lines = append(lines, fmt.Sprintf(
				"recent_%dd_revenue=%s prior_period_revenue=%s revenue_change_pct=%s",
				summary.Trend.RecentDays, joyboyNum(summary.Trend.RecentRevenue),
				joyboyNum(summary.Trend.PriorRevenue),
				joyboyNum(summary.Trend.RevenueChangePct)))
		}
		for index, menu := range summary.TopMenus {
			lines = append(lines, fmt.Sprintf("top_menu_rank=%d menu=%s qty=%d revenue=%s",
				index+1, menu.MenuName, menu.Quantity, joyboyNum(menu.Revenue)))
		}
		if summary.MarginReady && summary.BestMargin != nil {
			lines = append(lines, "best_margin_"+joyboyMenuMarginLine(summary.BestMargin))
		} else if !summary.MarginReady {
			lines = append(lines, "margin=unavailable reason=ingredient_costs_not_complete")
		}
		// This tool carries only the count, so it says so rather than letting the
		// model assume the names were withheld for brevity.
		lines = append(lines, fmt.Sprintf(
			"ingredients_below_minimum=%d names_not_included_use_get_low_stock_ingredients",
			summary.LowStockCount))
		return joyboyJoin(lines), true

	case AIToolGetSalesForPeriod:
		period := result.SalesForPeriod
		if period == nil {
			return joyboyNoData("period_not_recognised"), true
		}
		if period.Orders == 0 {
			return joyboyJoin([]string{
				"period=" + period.Label,
				"orders=0 revenue=0.00",
				joyboyNoData("no_orders_recorded_in_that_period"),
			}), true
		}
		line := fmt.Sprintf("period=%s days=%d orders=%d revenue=%s",
			period.Label, period.Days, period.Orders, joyboyNum(period.Revenue))
		if strings.TrimSpace(period.LatestDate) != "" {
			line += " latest_order_date=" + period.LatestDate
		}
		return line, true

	case AIToolGetMostExpensiveMenu:
		if len(result.MostExpensiveMenus) == 0 {
			return joyboyNotSetUpYet("no_menu_items_recorded",
				"ยังไม่มีเมนูในระบบเลย ห้ามตอบว่าร้านไม่มีเมนูขาย ให้บอกว่าต้องเพิ่มเมนูก่อน"), true
		}
		lines := []string{"ranked_by=listed_menu_price desc", "note=price_charged_per_dish_not_revenue"}
		for index, menu := range result.MostExpensiveMenus {
			lines = append(lines, fmt.Sprintf("rank=%d menu=%s price=%s",
				index+1, menu.Name, joyboyNum(menu.Price)))
		}
		return joyboyJoin(lines), true
	}

	return "", false
}

// joyboyDataCoverageBody renders the full span of real data — first and last day
// with paid sales — for "how far back does the data reach?" questions. Unlike the
// snapshot tools it is not scoped to the 30-day window; it reports the whole
// history, which is the point of the question.
func joyboyDataCoverageBody(cov repository.AISalesCoverage) string {
	if cov.FirstDate == "" || cov.Orders == 0 {
		return joyboyNoData("no_paid_sales_recorded_at_all")
	}
	return joyboyJoin([]string{
		"first_date=" + cov.FirstDate,
		"last_date=" + cov.LastDate,
		"days_with_data=" + strconv.FormatInt(cov.Days, 10),
		"total_orders=" + strconv.FormatInt(cov.Orders, 10),
		"total_revenue=" + joyboyNum(cov.Revenue),
	})
}

// joyboyExpenseSummaryBody renders what the shop actually paid out over a window.
// The category totals come first because "which category costs me most" is the
// question this data is for; the recent rows follow so a specific bill can be
// found ("ค่าไฟจ่ายไปเท่าไหร่").
// expenseIsNotTheCostBase rides on this sheet whether or not there are entries.
// It was first added only to the populated branch, and the empty one then
// produced the worse answer of the two: with no July expenses recorded the model
// treated the spend as zero and called a month of revenue "กำไรสุทธิ 347,453".
const expenseIsNotTheCostBase = "note=ตัวเลขนี้เป็นรายจ่ายที่เจ้าของบันทึกเองเท่านั้น " +
	"ไม่ได้รวมต้นทุนวัตถุดิบของเมนู ห้ามเอาไปลบกับยอดขายแล้วเรียกว่ากำไรหรือเงินที่เหลือ " +
	"ถ้าไม่มีรายจ่ายบันทึกไว้ ก็ไม่ได้แปลว่าร้านไม่มีต้นทุน ห้ามถือว่าต้นทุนเป็นศูนย์ " +
	"ถ้าถูกถามถึงกำไร ให้บอกว่าต้องดูจากกำไรของเมนูแทน"

func joyboyExpenseSummaryBody(label, from, until string, list *ExpenseListResponse) string {
	if list == nil || list.Entries == 0 {
		return joyboyJoin([]string{
			"period=" + label,
			"expense_items=0 expenses_total=0.00",
			joyboyNoData("no_expenses_recorded_in_window"),
			expenseIsNotTheCostBase,
		})
	}

	lines := []string{
		// The label is what the answer should say; the ISO dates stay behind it so
		// the exact window is still on the sheet. Given only "2026-07-30..2026-08-28"
		// the model read the dates out loud as Thai words in the Christian era —
		// "วันที่สามสิบกรกฎาคม ถึงวันที่ยี่สิบแปด สิงหาคม ค.ศ. 2026" — in a product
		// whose every other date is Buddhist-era.
		"period=" + label,
		"period_exact=" + from + ".." + until,
		"total_spent=" + joyboyNum(list.Total),
		"entries=" + strconv.FormatInt(list.Entries, 10),
	}
	for _, category := range list.Categories {
		lines = append(lines, fmt.Sprintf("category_%s_%s=%s",
			category.Category, aiExpenseCategoryLabel(category.Category), joyboyNum(category.Amount)))
	}

	const recent = 8
	rows := list.Expenses
	if len(rows) > recent {
		rows = rows[:recent]
	}
	for _, row := range rows {
		note := strings.TrimSpace(row.Note)
		if note == "" {
			note = aiExpenseCategoryLabel(row.Category)
		}
		lines = append(lines, fmt.Sprintf("entry=%s|%s|%s|%s",
			row.SpentAt.Format("2006-01-02"), aiExpenseCategoryLabel(row.Category), joyboyNum(row.Amount), note))
	}
	if int64(len(list.Expenses)) < list.Entries || list.HasMore {
		lines = append(lines, "note=แสดงเฉพาะรายการล่าสุด ไม่ใช่ทั้งหมด")
	}
	// This table holds only what the owner typed in by hand — it is not the shop's
	// cost base, which lives in the recipes. Asked "ขายได้เท่าไหร่ จ่ายไปเท่าไหร่
	// เหลือเท่าไหร่" the model subtracted one 300-baht entry from a month of
	// revenue and called the remainder what was left, which reads as profit and is
	// off by the entire ingredient cost.
	lines = append(lines, expenseIsNotTheCostBase)
	return joyboyJoin(lines)
}

// joyboyPeakForPeriodBody renders the busiest weekday and hour over a named
// window, rather than the fixed 30-day snapshot the peak tool otherwise reads.
//
// The two lines are separate rankings over the same window — the note is the
// same one the snapshot sheet carries, and for the same reason: given only
// "busiest weekday" and "busiest hour" the model reported the hour as the
// busiest hour *of that weekday*, a nested fact neither line states.
func joyboyPeakForPeriodBody(label string, weekdays, hours []repository.AIPeriodSummary) string {
	if len(weekdays) == 0 && len(hours) == 0 {
		return joyboyJoin([]string{"period=" + label, joyboyNoData("no_orders_recorded_in_period")})
	}
	lines := []string{"period=" + label, "scope=named_period_not_30day_window"}
	if len(weekdays) > 0 {
		lines = append(lines, fmt.Sprintf("busiest_weekday=%s weekday_orders=%d",
			thaiWeekdayName(weekdays[0].Period), weekdays[0].Orders))
	}
	if len(hours) > 0 {
		lines = append(lines, fmt.Sprintf("busiest_hour_across_all_days=%02d:00 hour_orders=%d",
			hours[0].Period, hours[0].Orders))
	}
	lines = append(lines, "note=สองบรรทัดนี้นับคนละแกน วันที่คับคั่งที่สุดกับชั่วโมงที่คับคั่งที่สุดนับรวมทุกวันในช่วงนี้ "+
		"ห้ามบอกว่าชั่วโมงนั้นเป็นชั่วโมงที่คับคั่งที่สุดของวันนั้น")
	return joyboyJoin(lines)
}

// joyboyOrderTypeForPeriodBody splits paid orders by service type over a named
// window. The snapshot version is fixed at 30 days, so "เดือนที่แล้วสั่งกลับกี่ที่"
// was answered about a window the owner did not ask for.
func joyboyOrderTypeForPeriodBody(label string, rows []repository.AIOrderTypeSummary) string {
	if len(rows) == 0 {
		return joyboyJoin([]string{"period=" + label, joyboyNoData("no_orders_recorded_in_period")})
	}
	lines := []string{"period=" + label, "scope=named_period_not_30day_window",
		"counted=บิลที่ปิดและจ่ายแล้ว ตามวันปิดบิล นิยามเดียวกับยอดขาย"}
	for _, row := range rows {
		lines = append(lines, fmt.Sprintf("order_type=%s orders=%d revenue=%s",
			aiOrderTypeThai(row.OrderType), row.Orders, joyboyNum(row.Revenue)))
	}
	return joyboyJoin(lines)
}

// aiOrderTypeThai turns the stored service type into the owner's words. Left as
// "dine_in" the model translates it itself, differently each time — the same
// reason the order statuses are translated here rather than in the answer.
func aiOrderTypeThai(orderType string) string {
	switch orderType {
	case "dine_in":
		return "กินที่ร้าน"
	case "takeaway":
		return "สั่งกลับบ้าน"
	case "delivery":
		return "เดลิเวอรี"
	}
	return orderType
}

// aiStockStatusThai turns the raw stock flag into the owner's words. Left as
// "out"/"low", the model pastes it straight through — the owner read "ไก่สับ
// (out) 0.00 กรัม", an English code sitting in a Thai answer, the same leak
// dine_in and the order statuses had. Only "out" and "low" ever reach a fact
// sheet; "ok" items are filtered out before this is called.
func aiStockStatusThai(status string) string {
	switch status {
	case "out":
		return "หมดสต๊อกแล้ว"
	case "low":
		return "ใกล้หมด"
	}
	return status
}

// aiOrderStatusThai turns a stored status into the words the owner uses. The
// model would otherwise translate "sent_to_kitchen" itself, differently each
// time, and one of those readings ("ส่งครัวแล้ว" vs "กำลังทำ") changes what the
// owner thinks the kitchen is doing.
var aiOrderStatusThai = map[string]string{
	entity.OrderStatusOpen:          "เปิดบิลแล้ว ยังไม่ส่งครัว",
	entity.OrderStatusSentToKitchen: "ส่งครัวแล้ว รอครัวเริ่มทำ",
	entity.OrderStatusCooking:       "ครัวกำลังทำ",
	entity.OrderStatusReady:         "ครัวทำเสร็จ รอเสิร์ฟ",
	entity.OrderStatusServed:        "เสิร์ฟแล้ว รอเก็บเงิน",
}

// joyboyActiveOrdersBody renders the floor right now: what the kitchen is
// working on and which bills are still open.
//
// Every other tool reports history, so "ตอนนี้บิลไหนยังไม่จ่าย" had no source at
// all. The waiting time is computed here rather than left as a timestamp,
// because the model may not do arithmetic and "opened 14:05" is not an answer to
// "which table has been waiting longest".
func joyboyActiveOrdersBody(orders []repository.AIActiveOrder, now time.Time) string {
	if len(orders) == 0 {
		return joyboyJoin([]string{
			"as_of=ตอนนี้",
			"capability=read_only",
			"active_orders=0 unpaid_total=0.00",
			joyboyNoData("no_active_orders_right_now"),
		})
	}

	var unpaidTotal float64
	var unpaidCount, kitchenCount int
	lines := []string{
		"as_of=ตอนนี้",
		"capability=read_only",
		"note=ดูได้อย่างเดียว รับออเดอร์ ปิดบิล หรือเปลี่ยนสถานะครัวให้ไม่ได้ " +
			"ถ้าผู้ใช้ขอให้ทำ ห้ามบอกว่าทำให้แล้ว ให้บอกว่าต้องไปกดเองที่หน้าขายหรือหน้าครัว",
		fmt.Sprintf("active_orders=%d", len(orders)),
	}
	// Rows are grouped by status, each group headed by its own count, rather
	// than listed flat. Asked "ครัวกำลังทำอะไรอยู่บ้าง" over a flat list of 22
	// rows, the model counted the cooking rows itself and got 4, 3, 4 and 6 on
	// four asks — over a floor with 5 cooking and 5 queued — and once wrote "4
	// รายการ" above a list of five. The sheet already carried in_kitchen_now=10;
	// the model did not use it, because the figure it wanted was "how many are
	// cooking", and that number was nowhere. Now every status has its count and
	// its rows together, so the answer is a read, not a tally.
	grouped := make(map[string][]string, 5)
	for _, order := range orders {
		if order.PaymentStatus == "unpaid" {
			unpaidCount++
			unpaidTotal += order.GrandTotal
		}
		if order.Status == entity.OrderStatusSentToKitchen || order.Status == entity.OrderStatusCooking {
			kitchenCount++
		}
		where := strings.TrimSpace(order.TableNumber)
		if where == "" {
			where = "สั่งกลับบ้าน"
		} else {
			where = "โต๊ะ " + where
		}
		status := aiOrderStatusThai[order.Status]
		if status == "" {
			status = order.Status
		}
		waited := int(now.Sub(order.OpenedAt).Minutes())
		if waited < 0 {
			waited = 0
		}
		grouped[order.Status] = append(grouped[order.Status], fmt.Sprintf("order=%s %s สถานะ=%s ยอด=%s การชำระ=%s เปิดมาแล้ว=%d นาที คน=%d",
			order.OrderNumber, where, status, joyboyNum(order.GrandTotal),
			map[string]string{"unpaid": "ยังไม่จ่าย", "paid": "จ่ายแล้ว"}[order.PaymentStatus],
			waited, order.CustomerCount))
	}
	lines = append(lines,
		fmt.Sprintf("in_kitchen_now=%d", kitchenCount),
		fmt.Sprintf("unpaid_bills=%d unpaid_total=%s", unpaidCount, joyboyNum(roundBaht(unpaidTotal))),
		"note=รายการข้างล่างจัดกลุ่มตามสถานะแล้ว แต่ละกลุ่มมีจำนวนบอกไว้ ให้ใช้จำนวนนั้น ห้ามนับแถวเอง "+
			"\"ครัวกำลังทำ\" คือกลุ่มที่ครัวลงมือแล้ว ส่วน \"ส่งครัวแล้ว รอครัวเริ่มทำ\" คือคิวที่ยังไม่ได้เริ่ม ถ้าถามว่าครัวทำอะไรอยู่ให้บอกทั้งสองกลุ่ม")
	for _, status := range aiActiveOrderStatusOrder {
		rows := grouped[status]
		if len(rows) == 0 {
			continue
		}
		label := aiOrderStatusThai[status]
		if label == "" {
			label = status
		}
		lines = append(lines, fmt.Sprintf("group=%s count=%d", label, len(rows)))
		lines = append(lines, rows...)
		delete(grouped, status)
	}
	// A status this file does not know still gets listed, under its raw name,
	// rather than dropped: a hidden row is a bill the owner is told does not exist.
	for status, rows := range grouped {
		lines = append(lines, fmt.Sprintf("group=%s count=%d", status, len(rows)))
		lines = append(lines, rows...)
	}
	return joyboyJoin(lines)
}

// aiActiveOrderStatusOrder is the order the floor is read in: what the kitchen
// is doing first, then what is waiting on the floor, then what only waits on
// the bill.
var aiActiveOrderStatusOrder = []string{
	entity.OrderStatusCooking,
	entity.OrderStatusSentToKitchen,
	entity.OrderStatusOpen,
	entity.OrderStatusReady,
	entity.OrderStatusServed,
}

// joyboyMenuListMaxRows caps how many menu names travel to the model. A shop
// with a hundred items would otherwise send a wall of text the model has to
// re-read on every turn; the counts above the list stay exact either way.
const joyboyMenuListMaxRows = 40

// joyboyMenuListBody renders the menu itself: how many items the shop serves,
// how many are on sale right now, and their names and prices by category.
//
// Every other menu tool ranks by sales, so "เมนูในร้านมีกี่เมนู" and "มีเมนูอะไรบ้าง"
// had no source at all — the model answered by asking the owner for the menu,
// which is the one place the answer could not come from. Go does the counting;
// the model is only allowed to phrase it.
func joyboyMenuListBody(items []repository.AIMenuCatalogueItem) string {
	if len(items) == 0 {
		return joyboyNotSetUpYet("no_menu_items_recorded",
			"ยังไม่มีเมนูในระบบเลย ห้ามตอบว่ามี 0 เมนูเฉย ๆ ให้บอกว่าต้องไปเพิ่มเมนูที่หน้าจัดการเมนูก่อน")
	}

	available := 0
	for _, item := range items {
		if item.IsAvailable {
			available++
		}
	}
	lines := []string{
		"scope=current_menu",
		fmt.Sprintf("total_menu_items=%d on_sale=%d off_sale=%d", len(items), available, len(items)-available),
	}

	shown := items
	if len(shown) > joyboyMenuListMaxRows {
		shown = shown[:joyboyMenuListMaxRows]
		// Saying the list is cut is what stops the model from reading the last
		// row as the last menu, the same misreading the ranked lists had.
		lines = append(lines, fmt.Sprintf(
			"note=แสดงรายชื่อแค่ %d เมนูแรกจากทั้งหมด %d เมนู ตัวเลขจำนวนเมนูด้านบนคือของจริงทั้งร้าน "+
				"ถ้าผู้ใช้อยากเห็นครบให้บอกว่าดูได้ที่หน้าจัดการเมนู", len(shown), len(items)))
	}
	for _, item := range shown {
		status := "เปิดขาย"
		if !item.IsAvailable {
			status = "ปิดขายอยู่"
		}
		category := joyboyCategoryName(item.Category)
		lines = append(lines, fmt.Sprintf("menu=%s หมวด=%s ราคา=%s บาท สถานะ=%s",
			item.Name, category, joyboyNum(item.Price), status))
	}
	return joyboyJoin(lines)
}

// joyboyShopProfileBody renders the shop's own identity — the answer to
// "ร้านเราชื่ออะไร", which had no tool and so came back as a sales total.
//
// Only identity and hours go on the sheet. The address, phone, PromptPay name
// and tax rates are the shop's, and the owner may see them, but this sheet is
// sent to a model provider outside the system and none of them is needed to say
// what the shop is called or when it opens.
func joyboyShopProfileBody(r *entity.Restaurant) string {
	if r == nil {
		return joyboyNoData("no_restaurant_profile")
	}
	lines := []string{"shop_name=" + strings.TrimSpace(r.Name)}
	if branch := strings.TrimSpace(r.BranchName); branch != "" {
		lines = append(lines, "branch="+branch)
	}
	if kind := strings.TrimSpace(r.RestaurantType); kind != "" {
		lines = append(lines, "type="+kind)
	}
	open, close := strings.TrimSpace(r.OpenTime), strings.TrimSpace(r.CloseTime)
	if open != "" || close != "" {
		lines = append(lines, fmt.Sprintf("hours=%s-%s", open, close))
	}
	lines = append(lines, fmt.Sprintf("table_count=%d", r.TableCount))
	return joyboyJoin(lines)
}

// joyboyTableStatusBody renders the floor as it stands right now.
//
// The reservation holder's phone number is deliberately left out. The owner is
// entitled to see it, but this sheet is sent to a model provider outside the
// system, and a customer's phone number has no bearing on any question the
// assistant is being asked ("is table 5 free?"). The name is enough to say who a
// table is being held for; the number stays in the database.
func joyboyTableStatusBody(tables []entity.RestaurantTable) string {
	if len(tables) == 0 {
		return joyboyNotSetUpYet("no_tables_configured",
			"ยังไม่ได้ตั้งค่าโต๊ะในระบบ ห้ามตอบว่าร้านไม่มีโต๊ะว่างหรือโต๊ะเต็ม ให้บอกว่าต้องไปตั้งค่าโต๊ะก่อน")
	}

	var free, occupied, reserved, inactive int
	freeSeats := 0
	freeList := make([]string, 0, len(tables))
	reservedList := make([]string, 0, 4)
	occupiedList := make([]string, 0, 8)
	// Closed tables are named too. Counting them and not listing them is what made
	// "โต๊ะ F04 ว่างไหม" come back as "there is no such table" — the model could
	// only see the tables in the three lists, so a table in none of them read as
	// one that does not exist.
	inactiveList := make([]string, 0, 4)

	for _, table := range tables {
		label := strings.TrimSpace(table.TableNumber)
		if label == "" {
			label = strings.TrimSpace(table.DisplayLabel)
		}
		// The zone name usually already begins with "โซน" ("โซนครอบครัว"), and
		// prefixing it again produced "โซนโซนครอบครัว" in the owner's answer.
		zone := strings.TrimSpace(table.Zone)
		descriptor := fmt.Sprintf("%s(%d ที่นั่ง", label, table.Capacity)
		if zone != "" {
			if !strings.HasPrefix(zone, "โซน") && !strings.HasPrefix(zone, "ห้อง") {
				zone = "โซน" + zone
			}
			descriptor += " · " + zone
		}
		descriptor += ")"

		switch table.Status {
		case entity.TableStatusFree:
			free++
			freeSeats += table.Capacity
			freeList = append(freeList, descriptor)
		case entity.TableStatusOccupied:
			occupied++
			occupiedList = append(occupiedList, label)
		case entity.TableStatusReserved:
			reserved++
			if name := strings.TrimSpace(table.ReservationName); name != "" {
				descriptor += " จองชื่อ " + name
			}
			reservedList = append(reservedList, descriptor)
		default:
			inactive++
			inactiveList = append(inactiveList, descriptor)
		}
	}

	lines := []string{
		"as_of=ตอนนี้",
		// The writing round never sees the tool catalogue — that is read by the
		// round that picks tools. Asked "book table P01 for คุณสมศรี", the model
		// picked this tool, read the floor, and wrote "ได้จองโต๊ะ P01 ให้แล้วครับ"
		// over a booking that never happened. The rule has to travel with the data
		// the answer is written from, so it lives here.
		"capability=read_only",
		"note=ดูสถานะได้อย่างเดียว จองโต๊ะหรือยกเลิกจองไม่ได้ ถ้าผู้ใช้ขอให้จอง ห้ามบอกว่าจองให้แล้ว ให้บอกว่าต้องไปกดที่หน้าจัดการโต๊ะเอง",
		"total_tables=" + strconv.Itoa(len(tables)),
		"free=" + strconv.Itoa(free),
		"occupied=" + strconv.Itoa(occupied),
		"reserved=" + strconv.Itoa(reserved),
		"inactive=" + strconv.Itoa(inactive),
		"free_seats_total=" + strconv.Itoa(freeSeats),
	}
	if len(freeList) > 0 {
		lines = append(lines, "free_tables="+strings.Join(freeList, " "))
	}
	if len(reservedList) > 0 {
		lines = append(lines, "reserved_tables="+strings.Join(reservedList, " "))
	}
	if len(occupiedList) > 0 {
		lines = append(lines, "occupied_tables="+strings.Join(occupiedList, " "))
	}
	if len(inactiveList) > 0 {
		lines = append(lines, "inactive_tables_ปิดใช้งานอยู่="+strings.Join(inactiveList, " "))
	}
	return joyboyJoin(lines)
}

// joyboyMenuForPeriodBody renders every menu's figures for a named calendar
// period as a flat sheet, ordered as the query returned them (revenue desc). It
// gives the model all the metrics at once — qty, revenue, profit, margin — and
// lets it rank by whichever the question asked, rather than picking a ranking in
// Go the way legacy's finished answer does. The period label is stated so the
// answer never reads as the 30-day window.
// joyboyOpenBillsNow is the money still on the tables at this moment: bills
// opened and not yet closed, with what they have run up so far. It sits under a
// sales window that reaches now, as a separate figure the model can name next
// to the paid total — "ปิดบิลแล้ว 4,895 ยังค้างอีก 1,122" — and never folded in.
func joyboyOpenBillsNow(open []repository.AIActiveOrder) string {
	var total float64
	tables := 0
	for _, order := range open {
		total += order.GrandTotal
		// A bill without a table is takeaway or delivery: real money still
		// owed, but nobody sitting down. Counted separately because the answer
		// said "5 โต๊ะ" from a count of bills — true only while every open bill
		// happened to be a dine-in one.
		if strings.TrimSpace(order.TableNumber) != "" {
			tables++
		}
	}
	return joyboyJoin([]string{
		fmt.Sprintf("open_bills_now=%d open_at_tables_now=%d open_total_now=%s",
			len(open), tables, joyboyNum(roundBaht(total))),
		"open_means=บิลที่ยังไม่ปิด ณ ตอนนี้ จึงยังไม่รวมใน revenue ข้างบน ตัวเลขนี้เปลี่ยนตลอดเวลา",
		"open_at_tables_means=จำนวนบิลที่นั่งอยู่บนโต๊ะ ที่เหลือเป็นกลับบ้าน/เดลิเวอรีซึ่งไม่มีโต๊ะ ห้ามเรียกจำนวนบิลว่าจำนวนโต๊ะ",
	})
}

// joyboyCancelledOrdersBody renders the bills that were dropped: how many, how
// much they had run up, and why — the reason as the staff typed it, one line
// per reason, so "ทำไมถึงยกเลิก" reads from the shop's own words. A blank reason
// is shown as such rather than dropped: a bill cancelled with no reason given
// is still a cancelled bill.
func joyboyCancelledOrdersBody(label string, reasons []repository.AICancelledReason) string {
	var bills int64
	var total float64
	for _, reason := range reasons {
		bills += reason.Bills
		total += reason.Total
	}
	lines := []string{"period=" + label, "scope=bills_cancelled_whole_not_items"}
	if bills == 0 {
		return joyboyJoin(append(lines, "cancelled_bills=0 cancelled_total=0.00", joyboyNoData("no_cancelled_bills_in_period")))
	}
	lines = append(lines, fmt.Sprintf("cancelled_bills=%d cancelled_total=%s", bills, joyboyNum(roundBaht(total))))
	for _, reason := range reasons {
		name := strings.TrimSpace(reason.Reason)
		if name == "" {
			name = "ไม่ได้ระบุเหตุผล"
		}
		lines = append(lines, fmt.Sprintf("reason=%s bills=%d total=%s", name, reason.Bills, joyboyNum(roundBaht(reason.Total))))
	}
	lines = append(lines,
		"cancelled_means=บิลที่ถูกยกเลิกทั้งใบ ไม่รวมในยอดขาย · ไม่นับรายการที่ถูกลบออกจากบิลที่จ่ายตามปกติ",
		"reason_means=เหตุผลตามที่พนักงานพิมพ์ไว้ตอนยกเลิก")
	return joyboyJoin(lines)
}

// joyboyNoTableBills reports whether not one table seated a paid bill in the
// window — the shape "before the records" takes on the table sheet, where the
// tables themselves still exist and each row simply reads zero.
func joyboyNoTableBills(usage []repository.AITableUsage) bool {
	for _, table := range usage {
		if table.Bills > 0 {
			return false
		}
	}
	return true
}

// joyboyCustomerCountBody renders who came as whole people.
//
// The headcount is the sum over party sizes, and the sheet lists those sizes
// rather than an average: "2.8 คนต่อบิล" is arithmetic nobody can seat. What an
// owner actually asks is "มากันกี่คนส่วนใหญ่", and that is the most common party
// size — a whole number the sheet names outright so the model never divides.
func joyboyCustomerCountBody(label string, parties []repository.AIPartySize, open []repository.AIActiveOrder, live bool) string {
	var guests, bills int64
	mostCommon, mostCommonBills := 0, int64(0)
	for _, party := range parties {
		guests += int64(party.PartySize) * party.Bills
		bills += party.Bills
		if party.Bills > mostCommonBills {
			mostCommon, mostCommonBills = party.PartySize, party.Bills
		}
	}

	lines := []string{"period=" + label, "scope=closed_paid_bills_only"}
	if bills == 0 {
		lines = append(lines, "guests=0 bills=0", joyboyNoData("no_closed_bills_to_count_guests_from"))
	} else {
		lines = append(lines, fmt.Sprintf("guests=%d bills=%d", guests, bills))
		for _, party := range parties {
			lines = append(lines, fmt.Sprintf("party_size=%d bills=%d", party.PartySize, party.Bills))
		}
		lines = append(lines, fmt.Sprintf("most_common_party_size=%d", mostCommon))
	}
	if live {
		var openGuests int64
		for _, order := range open {
			openGuests += int64(order.CustomerCount)
		}
		lines = append(lines, fmt.Sprintf("open_bills_now=%d open_guests_now=%d", len(open), openGuests))
	}
	lines = append(lines,
		"guests_means=จำนวนคนที่พนักงานลงไว้ตอนเปิดบิล รวมเฉพาะบิลที่ปิดแล้วในช่วงนี้",
		"party_size_means=บิลที่มากันกี่คน มีกี่บิล · most_common_party_size คือขนาดกลุ่มที่พบบ่อยที่สุด",
	)
	if live {
		lines = append(lines, "open_means=คนที่ยังนั่งอยู่ ณ ตอนนี้ บิลยังไม่ปิด จึงยังไม่รวมใน guests")
	}
	lines = append(lines, "note=คนเป็นจำนวนเต็มเสมอ ห้ามหารเฉลี่ยจำนวนคนออกมาเป็นทศนิยม ถ้าจะบอกว่ามากันกี่คน ให้ใช้ most_common_party_size")
	return joyboyJoin(lines)
}

// joyboyRankBy numbers rows 1..n by one of their figures, largest first, and
// returns the rank for each row in the order the rows were given. Rows that tie
// are numbered in the order they arrived, so the ranking is stable rather than
// arbitrary from one call to the next.
func joyboyRankBy(metrics []repository.AIMenuMarginSummary, value func(repository.AIMenuMarginSummary) float64) []int {
	order := make([]int, len(metrics))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		return value(metrics[order[a]]) > value(metrics[order[b]])
	})
	ranks := make([]int, len(metrics))
	for rank, index := range order {
		ranks[index] = rank + 1
	}
	return ranks
}

func joyboyMenuForPeriodBody(label string, metrics []repository.AIMenuMarginSummary) string {
	if len(metrics) == 0 {
		return joyboyJoin([]string{"period=" + label, joyboyNoData("no_menu_sales_recorded_in_period")})
	}
	// The rows arrive ordered by revenue, but "เมนูไหนขายดี" asks for dishes
	// sold and "เมนูไหนกำไรดี" for profit. Left to re-sort the list itself the
	// model got it wrong — it answered the seven-day question with ข้าวกะเพรา
	// (52 จาน) in eleventh place, below rows with 43. Ordering numbers is
	// arithmetic, so it is counted here and the sheet says which order it is in.
	qtyRank := joyboyRankBy(metrics, func(m repository.AIMenuMarginSummary) float64 { return float64(m.Quantity) })
	profitRank := joyboyRankBy(metrics, func(m repository.AIMenuMarginSummary) float64 { return m.Profit })

	lines := []string{
		"period=" + label,
		"scope=named_period_not_30day_window",
		"row_order=revenue desc",
		"qty_rank_means=อันดับตามจำนวนที่ขายได้ 1 คือขายได้มากที่สุด",
		"profit_rank_means=อันดับตามกำไรรวมของเมนูนั้นในช่วงนี้ 1 คือกำไรมากที่สุด",
	}
	const limit = 15
	for i, m := range metrics {
		if i >= limit {
			break
		}
		lines = append(lines, fmt.Sprintf("menu=%s qty=%d qty_rank=%d revenue=%s profit=%s profit_rank=%d margin_pct=%s",
			m.MenuName, m.Quantity, qtyRank[i], joyboyNum(m.Revenue),
			joyboyNum(m.Profit), profitRank[i], joyboyNum(m.Margin)))
	}
	if len(metrics) > limit {
		lines = append(lines, fmt.Sprintf("rows_shown=%d of %d ตัดจากรายได้มากไปน้อย", limit, len(metrics)))
	}
	return joyboyJoin(lines)
}

// joyboyCategoryName is how a menu's section of the board is named on a fact
// sheet. A menu filed under nothing gets a name of its own rather than an empty
// value, because the model reads a blank as missing data and says so.
func joyboyCategoryName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "ไม่ระบุหมวด"
	}
	return name
}

// The two caps on the category sheet. Per category, the tail of a ranking nobody
// asked about; overall, the point where the sheet stops being a table and starts
// being a wall the model re-reads every turn. Category totals are unaffected by
// either — they are summed before anything is cut, and every category keeps its
// own line however many menus are listed under it.
const (
	joyboyCategoryMenuMaxRows = 8
	joyboyCategoryMenuRowsCap = 45
)

// joyboyCategoryProfit is one section of the menu board with its sales totalled.
type joyboyCategoryProfit struct {
	Name        string
	MenusOnMenu int
	MenusSold   int
	Quantity    int64
	Revenue     float64
	Cost        float64
	Profit      float64
	Menus       []repository.AICategoryMenuMargin
}

// joyboyMenuProfitByCategoryBody ranks the menu board's sections by the baht they
// keep, and lists the menus inside each one ranked the same way.
//
// Go does every sum, ranking and per-dish division here. The model is handed a
// finished table and picks which part of it the question was about — reading one
// category out for "เครื่องดื่มตัวไหนกำไรดีสุด", comparing the category lines for
// "หมวดไหนกำไรดีสุด".
//
// The catalogue is merged in rather than only the sold rows, because a category
// that sold nothing has to appear as a category with no sales. Left out, it is
// indistinguishable from a category the shop does not have — which is the answer
// the assistant kept giving about drinks: "ยังไม่มีข้อมูลของเครื่องดื่ม", said about
// three drinks that were on the menu the whole time.
func joyboyMenuProfitByCategoryBody(sold []repository.AICategoryMenuMargin, menu []repository.AIMenuCatalogueItem) string {
	if len(sold) == 0 && len(menu) == 0 {
		return joyboyNotSetUpYet("no_menu_items_recorded",
			"ยังไม่มีเมนูในระบบเลย จึงยังแยกกำไรตามหมวดไม่ได้ ให้บอกว่าต้องไปเพิ่มเมนูและหมวดที่หน้าจัดการเมนูก่อน")
	}

	index := map[string]*joyboyCategoryProfit{}
	var categories []*joyboyCategoryProfit
	find := func(name string) *joyboyCategoryProfit {
		category, known := index[name]
		if !known {
			category = &joyboyCategoryProfit{Name: name}
			index[name] = category
			categories = append(categories, category)
		}
		return category
	}
	for _, item := range menu {
		find(joyboyCategoryName(item.Category)).MenusOnMenu++
	}
	for _, row := range sold {
		category := find(joyboyCategoryName(row.Category))
		category.MenusSold++
		category.Quantity += row.Quantity
		category.Revenue += row.Revenue
		category.Cost += row.Cost
		category.Profit += row.Profit
		category.Menus = append(category.Menus, row)
	}

	var shopProfit, shopRevenue float64
	categoriesWithSales := 0
	for _, category := range categories {
		shopProfit += category.Profit
		shopRevenue += category.Revenue
		if category.MenusSold > 0 {
			categoriesWithSales++
		}
		sort.SliceStable(category.Menus, func(i, j int) bool {
			return joyboyMenuOutranks(category.Menus[i], category.Menus[j])
		})
	}
	sort.SliceStable(categories, func(i, j int) bool {
		left, right := categories[i], categories[j]
		if left.Profit != right.Profit {
			return left.Profit > right.Profit
		}
		if left.Revenue != right.Revenue {
			return left.Revenue > right.Revenue
		}
		return left.Name < right.Name
	})

	lines := []string{
		"period=" + analysisWindowLabel(),
		"scope=every_category_on_the_menu",
		"ranked_by=category_profit desc",
		fmt.Sprintf("categories=%d categories_with_sales=%d", len(categories), categoriesWithSales),
		"note=ใบนี้มีครบทุกหมวดที่ร้านมี หมวดที่ยังไม่มีการขายในช่วงนี้เขียนว่า status=no_sales_in_period " +
			"ไม่ได้แปลว่าร้านไม่มีหมวดนั้นหรือไม่มีข้อมูล ให้ตอบเฉพาะหมวดที่ผู้ใช้ถาม " +
			"ถ้า menus_listed น้อยกว่า menus_sold แปลว่าหมวดนั้นแสดงแค่เมนูอันดับต้น ไม่ใช่ทั้งหมด",
	}

	rowsLeft := joyboyCategoryMenuRowsCap
	for rank, category := range categories {
		listed := len(category.Menus)
		if listed > joyboyCategoryMenuMaxRows {
			listed = joyboyCategoryMenuMaxRows
		}
		if listed > rowsLeft {
			listed = rowsLeft
		}
		rowsLeft -= listed

		if category.MenusSold == 0 {
			// No margin_pct and no share: a category that sold nothing has no margin,
			// and printing 0.00 would state a rate that was never measured.
			lines = append(lines, fmt.Sprintf(
				"category_rank=%d category=%s menus_on_menu=%d menus_sold=0 menus_listed=0 qty=0 revenue=0.00 cost=0.00 profit=0.00 status=no_sales_in_period",
				rank+1, category.Name, category.MenusOnMenu))
			continue
		}
		line := fmt.Sprintf(
			"category_rank=%d category=%s menus_on_menu=%d menus_sold=%d menus_listed=%d qty=%d revenue=%s cost=%s profit=%s margin_pct=%s",
			rank+1, category.Name, category.MenusOnMenu, category.MenusSold, listed, category.Quantity,
			joyboyNum(roundBaht(category.Revenue)), joyboyNum(roundBaht(category.Cost)),
			joyboyNum(roundBaht(category.Profit)), joyboyNum(roundBaht(joyboyPercent(category.Profit, category.Revenue))))
		if shopProfit > 0 {
			line += " profit_share_pct=" + joyboyNum(roundBaht(joyboyPercent(category.Profit, shopProfit)))
		}
		lines = append(lines, line)

		for i, m := range category.Menus[:listed] {
			row := fmt.Sprintf("category=%s menu_rank=%d menu=%s qty=%d revenue=%s cost=%s profit=%s margin_pct=%s",
				category.Name, i+1, m.MenuName, m.Quantity,
				joyboyNum(roundBaht(m.Revenue)), joyboyNum(roundBaht(m.Cost)),
				joyboyNum(roundBaht(m.Profit)), joyboyNum(roundBaht(m.Margin)))
			if m.Quantity > 0 {
				dishes := float64(m.Quantity)
				row += fmt.Sprintf(" cost_per_dish=%s profit_per_dish=%s",
					joyboyNum(roundBaht(m.Cost/dishes)), joyboyNum(roundBaht(m.Profit/dishes)))
			}
			lines = append(lines, row)
		}
	}
	lines = append(lines, fmt.Sprintf("profit_all_categories=%s revenue_all_categories=%s",
		joyboyNum(roundBaht(shopProfit)), joyboyNum(roundBaht(shopRevenue))))
	return joyboyJoin(lines)
}

// joyboyMenuOutranks orders two menus by the money they keep, with revenue and
// then the name breaking ties so the same figures always render the same list.
func joyboyMenuOutranks(left, right repository.AICategoryMenuMargin) bool {
	if left.Profit != right.Profit {
		return left.Profit > right.Profit
	}
	if left.Revenue != right.Revenue {
		return left.Revenue > right.Revenue
	}
	return left.MenuName < right.MenuName
}

// joyboyPercent is part/whole as a percentage, and 0 when the whole is 0 rather
// than NaN — a NaN reaches the model as the word "NaN" and comes back out in the
// answer.
func joyboyPercent(part, whole float64) float64 {
	if whole == 0 {
		return 0
	}
	return part / whole * 100
}

// joyboyProfitForPeriodBody totals revenue, cost and profit over a named calendar
// period.
//
// get_profit_summary only ever reads the rolling 30-day snapshot, and asked
// "กำไรเดือนที่แล้วเท่าไหร่" the model reported that window's figure as last
// month's profit — a wrong number stated with full confidence, which is worse
// than no answer. The sheet did carry "period=30 วันล่าสุด", but a label the
// model may or may not repeat is not a fix for reading the wrong window.
//
// Coverage is reported for the same reason the snapshot reports it: below full
// coverage the cost is understated, so the profit is a floor rather than a
// figure.
//
// expenses is the ledger for the same window, and it turns this sheet from one
// figure into two. "กำไร" here is revenue minus recipe cost — gross profit — and
// the owner who asked "ขายได้เท่าไหร่ จ่ายไปเท่าไหร่ เหลือเท่าไหร่" was given
// 284,900 / 5,130.74 / 197,122.38 and no subtraction: the sheet had nothing
// below gross profit and the expense sheet forbids subtracting from revenue. Now
// the sheet says what "profit" means, and carries the net after the recorded
// expenses as a figure of its own, computed here. The caveat that the ledger
// holds only what was written down travels with it, because a net over an empty
// ledger reads as "nothing else was spent".
func joyboyProfitForPeriodBody(label string, metrics []repository.AIMenuMarginSummary, expenses *ExpenseListResponse) string {
	var revenue, cost, profit, costedRevenue float64
	for _, m := range metrics {
		revenue += m.Revenue
		cost += m.Cost
		profit += m.Profit
		if m.Cost > 0 {
			costedRevenue += m.Revenue
		}
	}
	if revenue == 0 {
		return joyboyJoin([]string{"period=" + label, "revenue=0.00 cost=0.00 profit=0.00", joyboyNoData("no_paid_sales_in_period")})
	}
	lines := []string{
		"period=" + label,
		fmt.Sprintf("revenue=%s cost=%s gross_profit=%s margin_pct=%s",
			joyboyNum(roundBaht(revenue)), joyboyNum(roundBaht(cost)), joyboyNum(roundBaht(profit)),
			joyboyNum(roundBaht(profit/revenue*100))),
		"gross_profit_means=กำไรขั้นต้น = ยอดขาย − ต้นทุนวัตถุดิบตามสูตร ยังไม่หักรายจ่ายอื่น (ค่าแรง ค่าเช่า ค่าน้ำไฟ ฯลฯ) " +
			"เวลาพูดถึงเลขนี้ต้องบอกว่าเป็นกำไรก่อนหักรายจ่าย",
	}
	if coverage := costedRevenue / revenue * 100; coverage < 99.5 {
		lines = append(lines, fmt.Sprintf(
			"note=cost_covers_only_%s_pct_of_revenue_so_profit_is_a_floor", joyboyNum(roundBaht(coverage))))
	}
	lines = append(lines, joyboyNetAfterExpensesLines(profit, expenses)...)
	return joyboyJoin(lines)
}

// joyboyNetAfterExpensesLines is gross profit less the recorded expenses of the
// same window, as a figure. Nothing is printed when the ledger was not fetched
// at all (a sheet that says nothing about expenses is better than one that
// implies there were none); an empty ledger prints the net equal to gross with
// the caveat that nothing was recorded.
func joyboyNetAfterExpensesLines(grossProfit float64, expenses *ExpenseListResponse) []string {
	if expenses == nil {
		return nil
	}
	net := grossProfit - expenses.Total
	lines := []string{
		fmt.Sprintf("expenses_recorded=%s expense_items=%d net_after_expenses=%s",
			joyboyNum(roundBaht(expenses.Total)), expenses.Entries, joyboyNum(roundBaht(net))),
	}
	if expenses.Entries == 0 {
		lines = append(lines, "net_means=ช่วงนี้ยังไม่มีรายจ่ายบันทึกไว้เลย net_after_expenses จึงเท่ากับกำไรขั้นต้น "+
			"ถ้าถามว่าเหลือเท่าไหร่ ให้บอกเลขนี้พร้อมบอกว่ายังไม่มีรายจ่ายในระบบ เงินที่เหลือจริงอาจน้อยกว่านี้")
		return lines
	}
	lines = append(lines, fmt.Sprintf("net_means=กำไรขั้นต้นหักรายจ่ายที่บันทึกในระบบช่วงเดียวกัน (%d รายการ) "+
		"ถ้าถามว่าเหลือเท่าไหร่ หรือกำไรหลังหักค่าใช้จ่าย ให้ตอบ net_after_expenses "+
		"และบอกด้วยว่าหักเฉพาะรายจ่ายที่บันทึกไว้ รายจ่ายที่ไม่ได้บันทึกยังไม่รวม "+
		"ถ้าถามว่ากำไรเท่าไหร่เฉย ๆ ให้บอกทั้งสองเลข: กำไรขั้นต้น (ก่อนหัก) และ net_after_expenses (หลังหัก) เสมอ", expenses.Entries))
	return lines
}

// joyboySalesForPeriodBody renders the whole-store paid-sales total for one
// named window (a day, month, or year). Revenue is grand_total straight from
// the orders table — the authoritative figure — so the model states it rather
// than re-deriving it by summing menu lines (which drops rounding and misses
// anything that is not a menu subtotal).
// joyboyPeriodDays measures a window against the clock: how many calendar days
// it spans, how many of those have happened, and whether it is still running.
//
// A window that reaches past now is not over — "เดือนนี้" asked on the 4th is
// four days of thirty — and every figure in it is a running total, not a result.
// A zero-valued period (a label with no dates, as some tests build) measures as
// nothing, and the day lines are simply left off.
func joyboyPeriodDays(p AIPeriod, now time.Time) (calendar, elapsed int, incomplete bool) {
	if p.Start.IsZero() || p.End.IsZero() || !p.End.After(p.Start) {
		return 0, 0, false
	}
	calendar = int(p.End.Sub(p.Start).Hours() / 24)
	if !p.End.After(now) {
		return calendar, calendar, false
	}
	loc := p.Start.Location()
	today := time.Date(now.In(loc).Year(), now.In(loc).Month(), now.In(loc).Day(), 0, 0, 0, 0, loc)
	elapsed = int(today.Sub(p.Start).Hours()/24) + 1
	if elapsed < 1 {
		elapsed = 1
	}
	if elapsed > calendar {
		elapsed = calendar
	}
	return calendar, elapsed, true
}

// joyboyPeriodDayLines is the day arithmetic for one window, keyed with a suffix
// so two windows can sit on the same sheet ("_a", "_b") or one alone ("").
//
// Comparing "เดือนนี้" with "เดือนที่แล้ว" on the 4th produced "ลดลง 90.61%" — four
// days against thirty-one, arithmetically true and practically an alarm over
// nothing. The sheet carried no day counts, so the model had no way to see the
// two windows were not the same length. Now it carries the calendar length, the
// days that have actually passed, the days that had sales, and the revenue per
// selling day: the figures needed to compare unequal windows, computed here.
func joyboyPeriodDayLines(suffix string, p AIPeriod, d repository.AISalesRange, now time.Time) []string {
	calendar, elapsed, incomplete := joyboyPeriodDays(p, now)
	if calendar == 0 {
		return nil
	}
	lines := []string{fmt.Sprintf("calendar_days%s=%d", suffix, calendar)}
	if incomplete {
		// "X of Y" only when the two differ. A window the model read as running
		// up to today — "สัปดาห์นี้" comes back as 31 Aug–5 Sep, not the whole
		// week — has elapsed equal to its length, and "ผ่านไป 6 วันจากทั้งหมด
		// 6 วัน" next to "ยังไม่จบ" reads as a contradiction. What is true of
		// such a window is simply that it stops at today, and today is not over.
		if elapsed < calendar {
			lines = append(lines, fmt.Sprintf("period%s_incomplete=true days_elapsed%s=%d of %d", suffix, suffix, elapsed, calendar))
		} else {
			lines = append(lines, fmt.Sprintf("period%s_incomplete=true note=ช่วงนี้นับถึงวันนี้ ซึ่งวันนี้ยังไม่จบ ตัวเลขเป็นยอดถึงตอนนี้ ห้ามบอกว่าผ่านไปกี่วันจากกี่วัน", suffix))
		}
	}
	if d.Days > 0 {
		lines = append(lines, fmt.Sprintf("per_selling_day%s=%s", suffix, joyboyNum(roundBaht(d.Revenue/float64(d.Days)))))
	}
	return lines
}

// joyboyPerDayChange is the change between two windows measured per selling
// day, the comparison that survives unequal lengths. Returned empty when either
// side has no selling day to divide by.
func joyboyPerDayChange(da, db repository.AISalesRange) string {
	if da.Days == 0 || db.Days == 0 {
		return ""
	}
	perDayA := da.Revenue / float64(da.Days)
	perDayB := db.Revenue / float64(db.Days)
	if perDayB == 0 {
		return ""
	}
	pct := (perDayA - perDayB) / perDayB * 100
	dir := "เพิ่มขึ้น"
	if pct < 0 {
		dir = "ลดลง"
		pct = -pct
	}
	return fmt.Sprintf("per_day_change_pct=%s per_day_direction=%s", joyboyNum(pct), dir)
}

func joyboySalesForPeriodBody(p AIPeriod, d repository.AISalesRange, now time.Time) string {
	label := p.Label
	if d.Orders == 0 {
		lines := []string{"period=" + label, "scope=named_period_paid_sales_whole_store", "orders=0 revenue=0.00"}
		if _, elapsed, incomplete := joyboyPeriodDays(p, now); incomplete {
			if calendar, _, _ := joyboyPeriodDays(p, now); calendar > elapsed {
				lines = append(lines, fmt.Sprintf("period_incomplete=true days_elapsed=%d of %d note=ช่วงนี้ยังไม่จบ ยังไม่มีบิลจนถึงตอนนี้", elapsed, calendar))
			} else {
				lines = append(lines, "period_incomplete=true note=ช่วงนี้นับถึงวันนี้ ซึ่งวันนี้ยังไม่จบ ยังไม่มีบิลจนถึงตอนนี้")
			}
		}
		return joyboyJoin(append(lines, joyboyNoData("no_paid_orders_in_period")))
	}
	lines := []string{
		"period=" + label,
		"scope=named_period_paid_sales_whole_store",
		"revenue=" + joyboyNum(d.Revenue),
		fmt.Sprintf("orders=%d", d.Orders),
		fmt.Sprintf("selling_days=%d", d.Days),
	}
	if dayLines := joyboyPeriodDayLines("", p, d, now); len(dayLines) > 0 {
		lines = append(lines, dayLines...)
		if _, _, incomplete := joyboyPeriodDays(p, now); incomplete {
			lines = append(lines, "incomplete_means=ช่วงนี้ยังไม่จบ ตัวเลขข้างบนคือยอดจนถึงตอนนี้ ไม่ใช่ยอดทั้งช่วง ต้องบอกเจ้าของว่าผ่านไปกี่วันจากทั้งหมด")
		}
	}
	// The average bill is revenue ÷ orders, a division the model is forbidden to
	// do — so "เดือนที่แล้วบิลเฉลี่ยเท่าไหร่" had nothing to read and either made
	// the figure up (caught by the reconcile guard, then answered "ไม่ทราบ") or
	// leaned on the 30-day AOV tool for a period it did not ask about. Go divides.
	if d.Orders > 0 {
		lines = append(lines, "avg_per_order="+joyboyNum(roundBaht(d.Revenue/float64(d.Orders))))
	}
	return joyboyJoin(lines)
}

// joyboySalesComparisonBody renders two windows plus the percent change between
// them. The percentage is computed in Go, not left to the model — a model
// dividing two totals by hand is exactly the mistake this avoids — so the figure
// lands in the fact sheet where reconcileFigures can check it.
func joyboySalesComparisonBody(a AIPeriod, da repository.AISalesRange, b AIPeriod, db repository.AISalesRange, now time.Time) string {
	lines := []string{
		"scope=named_period_comparison_whole_store",
		fmt.Sprintf("period_a=%s revenue_a=%s orders_a=%d selling_days_a=%d", a.Label, joyboyNum(da.Revenue), da.Orders, da.Days),
		fmt.Sprintf("period_b=%s revenue_b=%s orders_b=%d selling_days_b=%d", b.Label, joyboyNum(db.Revenue), db.Orders, db.Days),
	}
	lines = append(lines, joyboyPeriodDayLines("_a", a, da, now)...)
	lines = append(lines, joyboyPeriodDayLines("_b", b, db, now)...)
	calA, _, incA := joyboyPeriodDays(a, now)
	calB, _, incB := joyboyPeriodDays(b, now)
	if perDay := joyboyPerDayChange(da, db); perDay != "" {
		lines = append(lines, perDay)
	}
	// Say when the two windows are not the same length, and why that matters —
	// the total-to-total percentage below is still true, it just answers a
	// question nobody asked when one side has had four days and the other thirty.
	if incA || incB || (calA > 0 && calB > 0 && calA != calB) {
		lines = append(lines,
			"uneven_windows=true note=สองช่วงนี้ยาวไม่เท่ากันหรือช่วงหนึ่งยังไม่จบ change_pct เทียบยอดรวมจึงเบี้ยว ให้ดู per_day_change_pct (ยอดต่อวันที่มีการขาย) ประกอบ และบอกเจ้าของว่าเทียบกี่วันกับกี่วัน")
	}
	// The average bill per period, for "บิลเฉลี่ยเดือนนี้เทียบเดือนก่อนต่างกันไหม" —
	// the model cannot divide, so both averages are computed here.
	if da.Orders > 0 {
		lines = append(lines, "avg_per_order_a="+joyboyNum(roundBaht(da.Revenue/float64(da.Orders))))
	}
	if db.Orders > 0 {
		lines = append(lines, "avg_per_order_b="+joyboyNum(roundBaht(db.Revenue/float64(db.Orders))))
	}
	switch {
	case db.Revenue > 0:
		// The direction is a Thai word and the percentage carries no sign: a bare
		// "-0.32" invites the model to narrate the wrong subject and keep the minus
		// ("เมษายนเพิ่มขึ้น -0.32%"). One reading, no arithmetic left to interpret.
		pct := (da.Revenue - db.Revenue) / db.Revenue * 100
		dir := "เพิ่มขึ้น"
		if pct < 0 {
			dir = "ลดลง"
			pct = -pct
		}
		lines = append(lines, fmt.Sprintf("change_pct=%s direction=%s note=%s_เทียบกับ_%s", joyboyNum(pct), dir, a.Label, b.Label))
	case da.Revenue > 0:
		lines = append(lines, "change_pct=na reason=period_b_has_no_sales")
	default:
		lines = append(lines, "change_pct=na reason=both_periods_have_no_sales")
	}
	return joyboyJoin(lines)
}

// joyboyForecastBody renders the next-7-days sales prediction as figures for the
// model to phrase. The numbers are computed in Go (weekday average × trend,
// bounds from a 28-day backtest); the model states them but must not invent any,
// and the same result is drawn as a chart on the frontend. The note line is
// deliberate: a forecast presented as fact is a lie, so the caveat travels with
// the data, not only in the guide.
func joyboyForecastBody(r *AIForecastResult) string {
	if r == nil || len(r.Forecast) == 0 {
		return joyboyNoData("not_enough_daily_history_to_forecast")
	}
	lines := []string{
		"scope=sales_forecast_next_7_days",
		"method=weekday_average_x_recent_trend",
		"note=this_is_a_prediction_not_actual_sales_state_the_caveat",
	}
	if r.BacktestN >= 5 {
		lines = append(lines, fmt.Sprintf("accuracy=backtest_%dd mape_pct=%s mae_baht=%s",
			r.BacktestN, joyboyNum(r.MAPE), joyboyNum(r.MAE)))
	} else {
		lines = append(lines, "accuracy=too_little_data_to_measure_use_wide_band")
	}
	if r.StaleDays > 0 {
		lines = append(lines, fmt.Sprintf("data_stale_days=%d", r.StaleDays))
	}
	// Whole baht: a forecast carries no sub-baht precision, so ".00" would be a
	// lie about how exact it is (and the model pastes whatever it is given).
	baht := func(v float64) string { return fmt.Sprintf("%.0f", v) }
	// The week total is summed here, in Go, so a question like "how much will I
	// sell next week" has an authoritative figure to state — the model must not
	// add up the seven days itself (that is the drift reconcileFigures cannot
	// catch, since a self-summed total is not in this sheet).
	var weekPredicted, weekLower, weekUpper float64
	for _, f := range r.Forecast {
		if f.Closed {
			lines = append(lines, fmt.Sprintf("day=%s weekday=%s status=closed", f.Date, f.Weekday))
			continue
		}
		weekPredicted += f.Predicted
		weekLower += f.Lower
		weekUpper += f.Upper
		lines = append(lines, fmt.Sprintf("day=%s weekday=%s predicted=%s range=%s-%s",
			f.Date, f.Weekday, baht(f.Predicted), baht(f.Lower), baht(f.Upper)))
	}
	lines = append(lines, fmt.Sprintf("week_total_predicted=%s week_total_range=%s-%s",
		baht(weekPredicted), baht(weekLower), baht(weekUpper)))
	return joyboyJoin(lines)
}

// joyboySystemDocsHandbookBody hands over the manual as the facts for this
// answer, with the one rule that matters: what is not written here is not
// something to fill in from general knowledge about restaurant software.
func joyboySystemDocsHandbookBody(handbook string) string {
	if strings.TrimSpace(handbook) == "" {
		return joyboyNoData("no_matching_documentation")
	}
	return joyboyJoin([]string{
		"source=คู่มือระบบทั้งฉบับ",
		"scope=ตอบได้เฉพาะสิ่งที่เขียนอยู่ในคู่มือนี้ · เรื่องที่คู่มือไม่ได้เขียนไว้ ให้บอกตรง ๆ ว่าคู่มือไม่ได้ระบุ ห้ามเดาจากความรู้ทั่วไปเรื่องระบบร้านอาหาร",
		"",
		handbook,
	})
}

// aiPaymentMethodThai turns the stored method code into the owner's words, so
// "promptpay_qr" is never pasted into an answer.
func aiPaymentMethodThai(method string) string {
	switch method {
	case "cash":
		return "เงินสด"
	case "promptpay_qr":
		return "พร้อมเพย์"
	}
	return method
}

// joyboyPaymentMixBody renders how the window's bills were paid. Shares are
// divided here; the coverage line says how many paid bills have no method on
// record, and from which day methods exist at all — a window starting before
// that day would otherwise report a split over a fraction of its bills as if it
// were the whole.
func joyboyPaymentMixBody(label string, mix []repository.AIPaymentMethodSummary, coverage repository.AIPaymentCoverage) string {
	lines := []string{"period=" + label, "scope=bills_paid_in_period_by_payment_method"}
	if len(mix) == 0 {
		lines = append(lines, "bills_with_method=0 amount=0.00",
			joyboyNoData("no_payment_method_recorded_in_period"))
		if coverage.PaidBills > 0 {
			lines = append(lines, fmt.Sprintf("paid_bills_in_period=%d note=บิลจ่ายแล้วมี แต่ไม่มีบิลไหนบันทึกวิธีจ่าย", coverage.PaidBills))
		}
		if coverage.FirstRecorded != "" {
			lines = append(lines, "payment_method_recorded_from="+coverage.FirstRecorded)
		}
		return joyboyJoin(lines)
	}
	var bills int64
	var amount float64
	for _, row := range mix {
		bills += row.Bills
		amount += row.Amount
	}
	lines = append(lines, fmt.Sprintf("bills_with_method=%d amount=%s", bills, joyboyNum(roundBaht(amount))))
	for _, row := range mix {
		lines = append(lines, fmt.Sprintf("method=%s bills=%d amount=%s bill_share_pct=%s amount_share_pct=%s",
			aiPaymentMethodThai(row.Method), row.Bills, joyboyNum(roundBaht(row.Amount)),
			joyboyNum(roundBaht(joyboyPercent(float64(row.Bills), float64(bills)))),
			joyboyNum(roundBaht(joyboyPercent(row.Amount, amount)))))
	}
	if missing := coverage.PaidBills - coverage.WithMethod; missing > 0 {
		lines = append(lines, fmt.Sprintf("bills_without_method=%d note=บิลจ่ายแล้วในช่วงนี้อีก %d บิลไม่มีวิธีจ่ายบันทึกไว้ "+
			"สัดส่วนข้างบนคิดจากเฉพาะบิลที่บันทึกวิธีจ่าย ต้องบอกเจ้าของ", missing, missing))
	}
	if coverage.FirstRecorded != "" {
		lines = append(lines, "payment_method_recorded_from="+coverage.FirstRecorded+
			" note=ระบบเริ่มบันทึกวิธีจ่ายตั้งแต่วันนี้ บิลก่อนหน้านั้นไม่มีข้อมูลวิธีจ่าย")
	}
	return joyboyJoin(lines)
}

// joyboyTableUsageBody ranks tables by how much they were actually used, and
// totals the zones from the same rows.
//
// One sheet answers both halves of "โต๊ะไหนคนไม่ค่อยนั่ง แล้วควรย้ายไปโซนไหน":
// the table lines say which table is quiet, the zone lines say which zone is
// busy enough to move it to. Splitting them into two tools would have meant two
// descriptions differing by one word, which is how the model picked the wrong
// one before.
//
// Go does every count and division. bills_per_seat is here because it is the
// only fair comparison for a move decision: a six-seat room with two bills is
// not quieter than a two-seat table with two bills, it is emptier per seat.
func joyboyTableUsageBody(label string, usage []repository.AITableUsage) string {
	if len(usage) == 0 {
		return joyboyJoin([]string{"period=" + label, joyboyNoData("no_tables_recorded")})
	}

	type zoneTotal struct {
		name    string
		tables  int
		seats   int
		bills   int64
		revenue float64
		guests  int64
	}
	zoneIndex := map[string]*zoneTotal{}
	var zones []*zoneTotal
	var totalBills int64
	var totalRevenue float64

	lines := []string{
		"period=" + label,
		"scope=สถิติย้อนหลังของแต่ละโต๊ะ ไม่ใช่สถานะตอนนี้",
		"counted=บิลที่ปิดและจ่ายแล้ว ตามวันปิดบิล นิยามเดียวกับยอดขาย",
		"note=บิลสั่งกลับบ้านและเดลิเวอรีไม่มีโต๊ะ จึงไม่อยู่ในใบนี้ ยอดรวมของโต๊ะจึงน้อยกว่ายอดขายทั้งร้าน " +
			"โต๊ะที่ไม่มีใครนั่งเลยจะขึ้น bills=0 ไม่ได้แปลว่าไม่มีโต๊ะนั้น " +
			"ถ้าจะเทียบว่าโต๊ะไหนคุ้มกว่ากัน ให้ดู bills_per_seat เพราะโต๊ะใหญ่กับโต๊ะเล็กเทียบจำนวนบิลตรง ๆ ไม่ได้",
	}

	rows := make([]string, 0, len(usage))
	for _, table := range usage {
		zoneName := strings.TrimSpace(table.Zone)
		if zoneName == "" {
			zoneName = "ไม่ระบุโซน"
		}
		zone, known := zoneIndex[zoneName]
		if !known {
			zone = &zoneTotal{name: zoneName}
			zoneIndex[zoneName] = zone
			zones = append(zones, zone)
		}
		zone.tables++
		zone.seats += table.Capacity
		zone.bills += table.Bills
		zone.revenue += table.Revenue
		zone.guests += table.Guests
		totalBills += table.Bills
		totalRevenue += table.Revenue

		row := fmt.Sprintf("table=%s zone=%s seats=%d bills=%d revenue=%s guests=%d",
			table.TableNumber, zoneName, table.Capacity, table.Bills,
			joyboyNum(roundBaht(table.Revenue)), table.Guests)
		if table.Capacity > 0 {
			row += " bills_per_seat=" + joyboyNum(roundBaht(float64(table.Bills)/float64(table.Capacity)))
		}
		if table.Bills > 0 {
			row += " revenue_per_bill=" + joyboyNum(roundBaht(table.Revenue/float64(table.Bills)))
		}
		rows = append(rows, row)
	}

	lines = append(lines, fmt.Sprintf("tables=%d table_bills_total=%d table_revenue_total=%s ranked_by=bills asc (โต๊ะที่คนนั่งน้อยที่สุดอยู่บนสุด)",
		len(usage), totalBills, joyboyNum(roundBaht(totalRevenue))))
	lines = append(lines, rows...)

	sort.SliceStable(zones, func(i, j int) bool {
		if zones[i].bills != zones[j].bills {
			return zones[i].bills > zones[j].bills
		}
		return zones[i].revenue > zones[j].revenue
	})
	// The minimum of a column is arithmetic, so Go states it: asked over
	// thirteen unlabelled rows the model once named the wrong table. Which zone
	// the owner should move it to is NOT arithmetic — it is a judgement about
	// the shop — so the sheet carries the figures a judgement needs and stops
	// there. Go computing the answer, or telling the model what to say about it,
	// is the line this project does not cross.
	if len(usage) > 0 {
		quiet := usage[0]
		quietZone := strings.TrimSpace(quiet.Zone)
		if quietZone == "" {
			quietZone = "ไม่ระบุโซน"
		}
		lines = append(lines, fmt.Sprintf("quietest_table=%s zone=%s bills=%d revenue=%s",
			quiet.TableNumber, quietZone, quiet.Bills, joyboyNum(roundBaht(quiet.Revenue))))
	}
	lines = append(lines, "zone_ranking=เรียงจากโซนที่คนนั่งมากไปน้อย",
		"zone_bills_per_seat_means=ความถี่การใช้งานต่อหนึ่งที่นั่งของโซนนั้น เป็นตัวเทียบว่าโซนไหนคนนิยมกว่ากัน "+
			"โดยไม่ติดว่าโซนไหนมีโต๊ะใหญ่หรือเล็ก")
	for rank, zone := range zones {
		line := fmt.Sprintf("zone_rank=%d zone=%s tables=%d seats=%d bills=%d revenue=%s guests=%d",
			rank+1, zone.name, zone.tables, zone.seats, zone.bills,
			joyboyNum(roundBaht(zone.revenue)), zone.guests)
		if zone.seats > 0 {
			line += " bills_per_seat=" + joyboyNum(roundBaht(float64(zone.bills)/float64(zone.seats)))
		}
		if totalBills > 0 {
			line += " bill_share_pct=" + joyboyNum(roundBaht(joyboyPercent(float64(zone.bills), float64(totalBills))))
		}
		lines = append(lines, line)
	}
	return joyboyJoin(lines)
}

// joyboyDaysLeftLabel says when stock runs out the way a person would: "หมด
// แล้ว", "หมดภายในวันนี้", "พอถึงพรุ่งนี้", then whole days. A fraction of a day
// is arithmetic, not an answer.
func joyboyDaysLeftLabel(daysLeft float64) string {
	switch {
	case daysLeft <= 0:
		return "หมดแล้ว"
	case daysLeft < 1:
		return "หมดภายในวันนี้"
	case daysLeft < 2:
		return "พอถึงพรุ่งนี้"
	case daysLeft < 7:
		return fmt.Sprintf("พออีกประมาณ %d วัน", int(daysLeft))
	}
	return fmt.Sprintf("พออีกประมาณ %d วัน (%.0f สัปดาห์)", int(daysLeft), daysLeft/7)
}

// joyboyProfitByMonthBody is the sheet for profit month by month: one line
// each, oldest first, and the two facts that change how the figures read —
// which months have no expense ledger (their "net" is gross), and that the
// current month is still running.
func joyboyProfitByMonthBody(rows []repository.AIMonthlyProfit, currentYearMonth string) string {
	if len(rows) == 0 {
		return joyboyNoData("no_paid_sales_in_the_last_months")
	}
	lines := []string{"scope=calendar_months_bangkok oldest_first=true", "net=revenue-cost-recorded_expenses"}
	var unrecorded []string
	for _, r := range rows {
		net := r.Revenue - r.Cost - r.Expenses
		line := fmt.Sprintf("month=%s revenue=%s bills=%d cost=%s expenses=%s expense_items=%d net=%s",
			r.Month, joyboyNum(r.Revenue), r.Bills, joyboyNum(r.Cost), joyboyNum(r.Expenses), r.ExpenseEntries, joyboyNum(net))
		if r.Month == currentYearMonth {
			line += " partial=month_still_running"
		}
		lines = append(lines, line)
		if r.ExpenseEntries == 0 {
			unrecorded = append(unrecorded, r.Month)
		}
	}
	if len(unrecorded) > 0 {
		lines = append(lines, "months_without_recorded_expenses="+strings.Join(unrecorded, ","),
			"gap_means=เดือนพวกนี้ไม่มีรายจ่ายบันทึกไว้ในระบบ net ของเดือนนั้นจึงเป็นกำไรก่อนหักรายจ่าย ไม่ใช่ว่าไม่มีค่าใช้จ่าย "+
				"ห้ามเทียบว่าเดือนพวกนี้กำไรดีกว่าเดือนที่มีรายจ่ายบันทึก ให้บอกเจ้าของตรง ๆ ว่าตัวเลขคนละแบบ")
	}
	return joyboyJoin(lines)
}
