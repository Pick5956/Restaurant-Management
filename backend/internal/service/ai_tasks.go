package service

import (
	"errors"
	"fmt"
	"strings"

	"Project-M/internal/aitools"
)

// AITask describes what kind of work the assistant should perform before it
// decides how to answer. This is intentionally narrower than the chat intent.
type AITask string

const (
	AITaskExplainConcept  AITask = "explain_concept"
	AITaskScopeQuestion   AITask = "scope_question"
	AITaskRetrieveFact    AITask = "retrieve_fact"
	AITaskAnalyzeData     AITask = "analyze_data"
	AITaskRecommendAction AITask = "recommend_action"

	// New structured task types
	AITaskGeneralChat       AITask = "general_chat"
	AITaskRestaurantAdvice  AITask = "restaurant_advice"
	AITaskRestaurantContent AITask = "restaurant_content"
	AITaskProductHelp       AITask = "product_help"
	AITaskRiskyAction       AITask = "risky_action"
	AITaskUnclear           AITask = "unclear"
	AITaskOutOfScope        AITask = "out_of_scope"
)

// AIToolName and its identifiers now live in the neutral aitools package. The
// alias and re-exports here keep every existing reference in this package
// (service.AIToolName, service.AIToolGetX) compiling unchanged; new code should
// reach for aitools directly.
type AIToolName = aitools.AIToolName

const (
	AIToolGetLowestMarginMenu    = aitools.AIToolGetLowestMarginMenu
	AIToolGetHighestMarginMenu   = aitools.AIToolGetHighestMarginMenu
	AIToolGetLowStockIngredients = aitools.AIToolGetLowStockIngredients
	AIToolGetTopSellingMenus     = aitools.AIToolGetTopSellingMenus
	AIToolGetInventoryValuation  = aitools.AIToolGetInventoryValuation
	AIToolGetSalesSummary        = aitools.AIToolGetSalesSummary
	AIToolGetLowestCostMenu      = aitools.AIToolGetLowestCostMenu
	AIToolGetSalesTrend          = aitools.AIToolGetSalesTrend
	AIToolGetBestSalesDay        = aitools.AIToolGetBestSalesDay
	AIToolGetAverageOrderValue   = aitools.AIToolGetAverageOrderValue
	AIToolGetOrderTypeBreakdown  = aitools.AIToolGetOrderTypeBreakdown
	AIToolGetMenuRevenueRanking  = aitools.AIToolGetMenuRevenueRanking
	AIToolGetPeakPeriods         = aitools.AIToolGetPeakPeriods
	AIToolGetSlowMovingMenus     = aitools.AIToolGetSlowMovingMenus
	AIToolGetMenuEngineering     = aitools.AIToolGetMenuEngineering

	AIToolGetIngredientReorderForecast = aitools.AIToolGetIngredientReorderForecast
	AIToolGetDeadStock                 = aitools.AIToolGetDeadStock
	AIToolGetTopCostIngredients        = aitools.AIToolGetTopCostIngredients

	AIToolGetStoreSummary      = aitools.AIToolGetStoreSummary
	AIToolGetSalesForPeriod    = aitools.AIToolGetSalesForPeriod
	AIToolGetMostExpensiveMenu = aitools.AIToolGetMostExpensiveMenu
	AIToolGetProfitSummary     = aitools.AIToolGetProfitSummary

	AIToolSearchSystemDocs = aitools.AIToolSearchSystemDocs
	AIToolReadSystemDoc    = aitools.AIToolReadSystemDoc
)

type AITaskRoute struct {
	Task AITask
	Tool AIToolName
}

type AIRouterResult struct {
	Task                AITask     `json:"task"`
	Confidence          float64    `json:"confidence"`
	NeedsRestaurantData bool       `json:"needs_restaurant_data"`
	NeedsTool           bool       `json:"needs_tool"`
	Risk                string     `json:"risk"`
	SuggestedTool       AIToolName `json:"suggested_tool,omitempty"`
}

// The tool-result structs now live in the neutral aitools package. These
// aliases keep every existing reference in this package compiling unchanged.
type AIToolResult = aitools.AIToolResult
type AIStoreSummary = aitools.AIStoreSummary
type AISalesPeriod = aitools.AISalesPeriod
type AIReorderItem = aitools.AIReorderItem
type AIDeadStockItem = aitools.AIDeadStockItem
type AICostIngredient = aitools.AICostIngredient
type AIPeakPeriods = aitools.AIPeakPeriods
type AIMenuEngineering = aitools.AIMenuEngineering
type AIAverageOrderValue = aitools.AIAverageOrderValue
type AISalesSummary = aitools.AISalesSummary
type AISalesTrend = aitools.AISalesTrend

func supportedReadOnlyToolNames() [24]AIToolName {
	return [24]AIToolName{
		AIToolGetLowestMarginMenu,
		AIToolGetHighestMarginMenu,
		AIToolGetLowStockIngredients,
		AIToolGetTopSellingMenus,
		AIToolGetInventoryValuation,
		AIToolGetSalesSummary,
		AIToolGetLowestCostMenu,
		AIToolGetSalesTrend,
		AIToolGetBestSalesDay,
		AIToolGetAverageOrderValue,
		AIToolGetOrderTypeBreakdown,
		AIToolGetMenuRevenueRanking,
		AIToolGetPeakPeriods,
		AIToolGetSlowMovingMenus,
		AIToolGetMenuEngineering,
		AIToolGetIngredientReorderForecast,
		AIToolGetDeadStock,
		AIToolGetTopCostIngredients,
		AIToolGetStoreSummary,
		AIToolGetSalesForPeriod,
		AIToolGetMostExpensiveMenu,
		AIToolSearchSystemDocs,
		AIToolReadSystemDoc,
		AIToolGetProfitSummary,
	}
}

func isSystemDocsTool(tool AIToolName) bool {
	return tool == AIToolSearchSystemDocs || tool == AIToolReadSystemDoc
}

func isProviderSnapshotTool(tool AIToolName) bool {
	return isSupportedReadOnlyTool(tool) && !isSystemDocsTool(tool)
}

func isSupportedReadOnlyTool(tool AIToolName) bool {
	for _, supported := range supportedReadOnlyToolNames() {
		if tool == supported {
			return true
		}
	}
	return false
}

// enforceRouterPolicy treats model routing as a proposal. The backend decides
// which data and tools may actually be used.
func enforceRouterPolicy(result AIRouterResult) (AIRouterResult, error) {
	if result.Confidence < 0 || result.Confidence > 1 {
		return AIRouterResult{}, errors.New("AI router returned confidence outside 0..1")
	}
	result.Risk = strings.ToLower(strings.TrimSpace(result.Risk))
	switch result.Risk {
	case "", "low":
		result.Risk = "low"
	case "medium", "high":
	default:
		return AIRouterResult{}, errors.New("AI router returned unsupported risk level")
	}

	switch result.Task {
	case AITask("restaurant_data"), AITaskRetrieveFact, AITaskAnalyzeData, AITaskRecommendAction:
		// These flows are read-only; readiness and tool policy guard any
		// recommendation before a user performs a change.
		result.Risk = "low"
		result.NeedsRestaurantData = true
		if result.SuggestedTool != "" {
			if !isSupportedReadOnlyTool(result.SuggestedTool) {
				return AIRouterResult{}, errors.New("AI router returned unsupported read-only tool")
			}
			if isSystemDocsTool(result.SuggestedTool) {
				return AIRouterResult{}, errors.New("AI router returned a system docs tool for restaurant data")
			}
			result.NeedsTool = true
			if result.Task == AITask("restaurant_data") || result.Task == AITaskAnalyzeData {
				result.Task = AITaskRetrieveFact
			}
			return result, nil
		}
		if result.NeedsTool || result.Task == AITaskRetrieveFact {
			return AIRouterResult{}, errors.New("AI router requested a fact tool without a supported tool name")
		}
		if result.Task == AITask("restaurant_data") {
			result.Task = AITaskAnalyzeData
		}
		result.NeedsTool = false
		return result, nil
	case AITaskProductHelp:
		result.Risk = "low"
		result.NeedsRestaurantData = false
		if result.SuggestedTool == "" {
			result.SuggestedTool = AIToolSearchSystemDocs
		}
		if !isSystemDocsTool(result.SuggestedTool) {
			return AIRouterResult{}, errors.New("AI router returned a non-documentation tool for product help")
		}
		result.NeedsTool = true
		return result, nil
	case AITaskRiskyAction:
		result.NeedsRestaurantData = false
		result.NeedsTool = false
		result.SuggestedTool = ""
		return result, nil
	case AITaskExplainConcept, AITaskScopeQuestion, AITaskGeneralChat, AITaskRestaurantAdvice,
		AITaskRestaurantContent, AITaskUnclear, AITaskOutOfScope:
		result.NeedsRestaurantData = false
		result.NeedsTool = false
		result.SuggestedTool = ""
		return result, nil
	default:
		return AIRouterResult{}, errors.New("AI router returned unsupported task")
	}
}

func requestsMarginConceptExplanation(question string) bool {
	normalized := strings.ToLower(strings.TrimSpace(question))
	hasMargin := strings.Contains(normalized, "margin") ||
		strings.Contains(normalized, "มาร์จิ้น") ||
		strings.Contains(normalized, "มาร์จิน")
	if !hasMargin {
		return false
	}
	for _, phrase := range []string{
		"คืออะไร", "หมายถึงอะไร", "แปลว่าอะไร", "คำนวณยังไง", "คำนวณอย่างไร",
		"what is", "what does", "define", "how is", "how do you calculate",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func localConceptAnswer(route AITaskRoute) (string, bool) {
	if route.Task != AITaskExplainConcept {
		return "", false
	}
	return "มาร์จิ้น (Margin) คือเปอร์เซ็นต์กำไรเทียบกับรายได้ครับ\n\n" +
		"- สูตร: `(รายได้ - ต้นทุน) / รายได้ x 100`\n" +
		"- ตัวอย่าง: ขาย 100 บาท ต้นทุน 60 บาท Margin เท่ากับ 40%\n\n" +
		"ในระบบนี้จะยืนยัน Margin เมื่อรายการขายมีต้นทุนวัตถุดิบครบครับ", true
}

// The read-only tool execution and its calculation helpers now live in the
// neutral aitools package. executeReadOnlyTool stays as a thin wrapper because
// its ten callers (joyboy wiring, legacy) reach it by this name; the compute
// helpers with callers elsewhere in this package keep a function value pointing
// at their exported form. The four helpers nothing outside called are gone.
func executeReadOnlyTool(tool AIToolName, snapshot AISnapshot, question ...string) (AIToolResult, error) {
	return aitools.ExecuteReadOnlyTool(tool, snapshot, question...)
}

var (
	computeSalesTrend      = aitools.ComputeSalesTrend
	computeMenuEngineering = aitools.ComputeMenuEngineering
	computeReorderForecast = aitools.ComputeReorderForecast
	computeDeadStock       = aitools.ComputeDeadStock
	thaiWeekdayName        = aitools.ThaiWeekdayName
)

func localToolAnswer(result AIToolResult) (string, bool) {
	switch result.Tool {
	case AIToolGetLowestMarginMenu:
		menu := result.LowestMarginMenu
		if menu == nil || menu.Quantity <= 0 {
			return "ตอนนี้ยังไม่มีข้อมูล Margin ของเมนูที่ยืนยันได้จากรายการขายและต้นทุนที่บันทึกครบครับ", true
		}
		quantity := float64(menu.Quantity)
		return fmt.Sprintf(
			"เมนูที่มี Margin ต่ำที่สุดคือ %s ครับ\n\n- ขายได้ %d จาน\n- รายได้รวม %s บาท\n- ต้นทุนรวม %s บาท\n- กำไรรวม %s บาท\n- Margin %.2f%%\n- ต้นทุนเฉลี่ยต่อจาน %s บาท\n- กำไรเฉลี่ยต่อจาน %s บาท",
			menu.MenuName,
			menu.Quantity,
			formatMoney(menu.Revenue),
			formatMoney(menu.Cost),
			formatMoney(menu.Profit),
			menu.Margin,
			formatMoney(menu.Cost/quantity),
			formatMoney(menu.Profit/quantity),
		), true

	case AIToolGetHighestMarginMenu:
		menu := result.HighestMarginMenu
		if menu == nil || menu.Quantity <= 0 {
			return "ตอนนี้ยังไม่มีข้อมูล Margin ของเมนูที่ยืนยันได้จากรายการขายและต้นทุนที่บันทึกครบครับ", true
		}
		quantity := float64(menu.Quantity)
		return fmt.Sprintf(
			"เมนูที่ทำกำไรได้ดีที่สุด (Margin สูงสุด) คือ %s ครับ\n\n- ขายได้ %d จาน\n- รายได้รวม %s บาท\n- ต้นทุนรวม %s บาท\n- กำไรรวม %s บาท\n- Margin %.2f%%\n- ต้นทุนเฉลี่ยต่อจาน %s บาท\n- กำไรเฉลี่ยต่อจาน %s บาท",
			menu.MenuName,
			menu.Quantity,
			formatMoney(menu.Revenue),
			formatMoney(menu.Cost),
			formatMoney(menu.Profit),
			menu.Margin,
			formatMoney(menu.Cost/quantity),
			formatMoney(menu.Profit/quantity),
		), true

	case AIToolGetLowStockIngredients:
		ingredients := result.LowStockIngredients
		if len(ingredients) == 0 {
			return "ปัจจุบันระบบตรวจไม่พบสินค้าคลังที่เสี่ยงหมดหรือหมดสต็อกครับ การจัดการคลังวัตถุดิบทำได้ดีเยี่ยมมากครับ! 👍", true
		}
		var sb strings.Builder
		sb.WriteString("รายการวัตถุดิบที่ใกล้หมดหรือหมดสต็อกมีดังนี้ครับ:\n\n")
		for _, item := range ingredients {
			statusStr := "ใกล้หมด ⚠️"
			if item.Status == "out" {
				statusStr = "หมดสต็อก ❌"
			}
			sb.WriteString(fmt.Sprintf("- **%s** (%s)\n  • สต็อกปัจจุบัน: %.2f %s (เกณฑ์ขั้นต่ำ: %.2f %s)\n  • แนะนำเติมเพิ่ม: **%.2f** %s\n",
				item.Name, statusStr, item.Stock, item.Unit, item.MinStock, item.Unit, item.RestockEstimate, item.Unit))
		}
			return sb.String(), true

	case AIToolGetTopSellingMenus:
		menus := result.TopSellingMenus
		if len(menus) == 0 {
			return fmt.Sprintf("ในช่วง %s ร้านยังไม่มีข้อมูลบันทึกยอดขายเข้ามาครับ", analysisWindowLabel()), true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("เมนูที่ขายดีที่สุดในช่วง %s มีดังนี้ครับ:\n\n", analysisWindowLabel()))
		limit := len(menus)
		if limit > 5 {
			limit = 5
		}
		for i := 0; i < limit; i++ {
			menu := menus[i]
			avgPrice := 0.0
			if menu.Quantity > 0 {
				avgPrice = menu.Revenue / float64(menu.Quantity)
			}
			sb.WriteString(fmt.Sprintf("%d. **%s**\n  • จำนวนที่ขายได้: %d จาน\n  • รายได้รวม: %s บาท (ราคาเฉลี่ย %s บาท/จาน)\n",
				i+1, menu.MenuName, menu.Quantity, formatMoney(menu.Revenue), formatMoney(avgPrice)))
		}
		return sb.String(), true

	case AIToolGetInventoryValuation:
		val := result.InventoryValuation
		if val == nil {
			return "ไม่พบข้อมูลสรุปมูลค่าคลังสินค้าคงเหลือในระบบครับ", true
		}
		return fmt.Sprintf(
			"สรุปมูลค่าคลังสินค้าคงเหลือในปัจจุบันครับ:\n\n"+
				"- **จำนวนรายการวัตถุดิบทั้งหมด:** %d รายการ\n"+
				"- **วัตถุดิบที่หมดสต็อก:** %d รายการ\n"+
				"- **วัตถุดิบที่เหลือน้อย:** %d รายการ\n"+
				"- **มูลค่าคลังสินค้ารวม:** **%s** บาท\n\n"+
				"หากต้องการเช็กรายชื่อวัตถุดิบที่เหลือน้อย สามารถถามว่า \"มีวัตถุดิบอะไรใกล้หมดบ้าง\" ได้เลยครับ",
			val.TotalItems,
			val.OutItems,
			val.LowItems,
			formatMoney(val.Value),
		), true
	case AIToolGetSalesSummary:
		summary := result.SalesSummary
		if summary == nil {
			return fmt.Sprintf("ยังไม่มีข้อมูลยอดขายที่ยืนยันได้ในช่วง %sครับ", analysisWindowLabel()), true
		}
		return fmt.Sprintf(
			"ยอดขายรวมช่วง %sคือ %s บาทครับ\n\n- จำนวนออเดอร์รวม %d ออเดอร์\n- วันที่มีรายการขาย %d วัน",
			analysisWindowLabel(),
			formatMoney(summary.Revenue),
			summary.Orders,
			summary.Days,
		), true
	case AIToolGetLowestCostMenu:
		menu := result.LowestCostMenu
		if menu == nil || menu.Quantity <= 0 {
			return "ตอนนี้ยังไม่มีข้อมูลต้นทุนของเมนูที่ยืนยันได้จากรายการขายและต้นทุนที่บันทึกครบครับ", true
		}
		quantity := float64(menu.Quantity)
		return fmt.Sprintf(
			"เมนูที่มีต้นทุนต่อจานต่ำที่สุดคือ %s ครับ\n\n- ต้นทุนเฉลี่ยต่อจาน %s บาท\n- ขายได้ %d จาน\n- ต้นทุนรวม %s บาท\n- ราคาขายเฉลี่ยต่อจาน %s บาท",
			menu.MenuName,
			formatMoney(menu.Cost/quantity),
			menu.Quantity,
			formatMoney(menu.Cost),
			formatMoney(menu.Revenue/quantity),
		), true
	case AIToolGetSalesTrend:
		trend := result.SalesTrend
		if trend == nil || (trend.RecentRevenue == 0 && trend.PriorRevenue == 0) {
			return "ยังไม่มีข้อมูลยอดขายเพียงพอสำหรับเทียบแนวโน้มครับ", true
		}
		if !trend.HasPrior {
			return fmt.Sprintf(
				"ยอดขาย 7 วันล่าสุดคือ %s บาท (%d ออเดอร์) ครับ\n\nยังไม่มีข้อมูลสัปดาห์ก่อนหน้าให้เทียบแนวโน้ม จึงยังบอกว่าโตหรือหดไม่ได้ครับ",
				formatMoney(trend.RecentRevenue), trend.RecentOrders,
			), true
		}
		direction := "เพิ่มขึ้น 📈"
		if trend.RevenueChangePct < 0 {
			direction = "ลดลง 📉"
		}
		return fmt.Sprintf(
			"แนวโน้มยอดขายเทียบสัปดาห์ก่อน %s ครับ\n\n- 7 วันล่าสุด: %s บาท (%d ออเดอร์)\n- 7 วันก่อนหน้า: %s บาท (%d ออเดอร์)\n- เปลี่ยนแปลง: %+.1f%%",
			direction,
			formatMoney(trend.RecentRevenue), trend.RecentOrders,
			formatMoney(trend.PriorRevenue), trend.PriorOrders,
			trend.RevenueChangePct,
		), true
	case AIToolGetBestSalesDay:
		best := result.BestSalesDay
		if best == nil || !best.HasData {
			return "ช่วงนี้ยังไม่มีวันไหนที่มียอดขายเลยครับ จึงยังบอกวันที่ขายดีที่สุดไม่ได้", true
		}
		highest := fmt.Sprintf(
			"วันที่ขายดีที่สุดในรอบนี้คือ %s (%s) ยอด %s บาท จาก %d บิลครับ",
			formatThaiDate(best.BestDate), thaiWeekdayName(int(best.BestWeekday)),
			formatMoney(best.BestRevenue), best.BestOrders,
		)
		if best.BestDate == best.WorstDate {
			return highest + " รอบนี้มีวันที่ขายได้เพียงวันเดียว", true
		}
		lowest := fmt.Sprintf(
			"ส่วนวันที่ขายได้น้อยที่สุดคือ %s (%s) ยอด %s บาท จาก %d บิล นับเฉพาะวันที่มีการขาย รวม %d วันจากช่วง %d วัน",
			formatThaiDate(best.WorstDate), thaiWeekdayName(int(best.WorstWeekday)),
			formatMoney(best.WorstRevenue), best.WorstOrders,
			best.DaysWithSales, best.Days,
		)
		return highest + "\n\n" + lowest, true
	case AIToolGetAverageOrderValue:
		aov := result.AverageOrderValue
		if aov == nil || aov.Orders <= 0 {
			return "ยังไม่มีข้อมูลออเดอร์เพียงพอสำหรับคำนวณยอดเฉลี่ยต่อบิลครับ", true
		}
		return fmt.Sprintf(
			"ยอดขายเฉลี่ยต่อบิลช่วง %sคือ %s บาทครับ\n\n- รายได้รวม %s บาท\n- จำนวนออเดอร์รวม %d ออเดอร์\n- วันที่มีรายการขาย %d วัน",
			analysisWindowLabel(), formatMoney(aov.AOV), formatMoney(aov.Revenue), aov.Orders, aov.Days,
		), true
	case AIToolGetOrderTypeBreakdown:
		types := result.OrderTypeBreakdown
		if len(types) == 0 {
			return fmt.Sprintf("ยังไม่มีข้อมูลออเดอร์ในช่วง %s สำหรับแยกตามประเภทการสั่งครับ", analysisWindowLabel()), true
		}
		var total float64
		for _, t := range types {
			total += t.Revenue
		}
		labels := map[string]string{"dine_in": "ทานที่ร้าน", "takeaway": "ซื้อกลับ", "take_away": "ซื้อกลับ", "delivery": "เดลิเวอรี"}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("สัดส่วนยอดขายตามประเภทการสั่งช่วง %sครับ:\n\n", analysisWindowLabel()))
		for _, t := range types {
			name := labels[t.OrderType]
			if name == "" {
				name = t.OrderType
			}
			pct := 0.0
			if total > 0 {
				pct = t.Revenue / total * 100
			}
			sb.WriteString(fmt.Sprintf("- **%s**: %s บาท (%d ออเดอร์, %.1f%%)\n", name, formatMoney(t.Revenue), t.Orders, pct))
		}
		return sb.String(), true
	case AIToolGetMenuRevenueRanking:
		menus := result.MenuRevenueRanking
		if len(menus) == 0 {
			return fmt.Sprintf("ในช่วง %s ร้านยังไม่มีข้อมูลบันทึกยอดขายเข้ามาครับ", analysisWindowLabel()), true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("เมนูที่ทำรายได้สูงที่สุดในช่วง %s มีดังนี้ครับ:\n\n", analysisWindowLabel()))
		limit := len(menus)
		if limit > 5 {
			limit = 5
		}
		for i := 0; i < limit; i++ {
			menu := menus[i]
			avgPrice := 0.0
			if menu.Quantity > 0 {
				avgPrice = menu.Revenue / float64(menu.Quantity)
			}
			sb.WriteString(fmt.Sprintf("%d. **%s**\n  • รายได้รวม: %s บาท\n  • ขายได้ %d จาน (ราคาเฉลี่ย %s บาท/จาน)\n",
				i+1, menu.MenuName, formatMoney(menu.Revenue), menu.Quantity, formatMoney(avgPrice)))
		}
		return sb.String(), true
	case AIToolGetPeakPeriods:
		peak := result.PeakPeriods
		if peak == nil || !peak.HasData {
			return "ยังไม่มีข้อมูลออเดอร์เพียงพอสำหรับดูช่วงเวลาขายดีครับ", true
		}
		return fmt.Sprintf(
			"ช่วงที่ร้านขายดีที่สุดในช่วง %sครับ:\n\n- วันขายดีที่สุด: **%s** (%d ออเดอร์)\n- ช่วงเวลาขายดีที่สุด: **%02d:00-%02d:59 น.** (%d ออเดอร์)",
			analysisWindowLabel(),
			thaiWeekdayName(peak.TopWeekday), peak.TopWeekdayOrders,
			peak.TopHour, peak.TopHour, peak.TopHourOrders,
		), true
	case AIToolGetSlowMovingMenus:
		menus := result.SlowMovingMenus
		if len(menus) == 0 {
			return "ยังไม่มีข้อมูลเมนูสำหรับประเมินเมนูขายช้าครับ", true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("เมนูที่ขายได้น้อยที่สุดในช่วง %s (ควรพิจารณาปรับปรุงหรือถอด) ครับ:\n\n", analysisWindowLabel()))
		limit := len(menus)
		if limit > 5 {
			limit = 5
		}
		for i := 0; i < limit; i++ {
			menu := menus[i]
			if menu.Quantity == 0 {
				sb.WriteString(fmt.Sprintf("- **%s**: ไม่มีคนสั่งเลย\n", menu.MenuName))
			} else {
				sb.WriteString(fmt.Sprintf("- **%s**: ขายได้ %d จาน (รายได้ %s บาท)\n", menu.MenuName, menu.Quantity, formatMoney(menu.Revenue)))
			}
		}
		return sb.String(), true
	case AIToolGetMenuEngineering:
		eng := result.MenuEngineering
		if eng == nil || (len(eng.Stars)+len(eng.Plowhorses)+len(eng.Puzzles)+len(eng.Dogs)) == 0 {
			return "ยังไม่มีข้อมูล Margin ของเมนูที่ยืนยันได้เพียงพอสำหรับวิเคราะห์เมนูครับ", true
		}
		join := func(items []string) string {
			if len(items) == 0 {
				return "-"
			}
			if len(items) > 5 {
				items = items[:5]
			}
			return strings.Join(items, ", ")
		}
		return fmt.Sprintf(
			"วิเคราะห์เมนู (ความนิยม × กำไร) ครับ:\n\n"+
				"- ⭐ **ดาวเด่น** (ขายดี + กำไรดี ควรดันต่อ): %s\n"+
				"- 🐴 **ตัวชูโรง** (ขายดี + กำไรน้อย ควรหาทางลดต้นทุน): %s\n"+
				"- ❓ **ซ่อนเร้น** (กำไรดี + ขายน้อย ควรโปรโมท): %s\n"+
				"- 🐶 **ตัวถ่วง** (ขายน้อย + กำไรน้อย ควรพิจารณาถอด): %s",
			join(eng.Stars), join(eng.Plowhorses), join(eng.Puzzles), join(eng.Dogs),
		), true
	case AIToolGetIngredientReorderForecast:
		items := result.ReorderForecast
		if len(items) == 0 {
			return "ยังไม่มีข้อมูลการใช้วัตถุดิบเพียงพอสำหรับคาดการณ์การสั่งซื้อครับ", true
		}
		var sb strings.Builder
		sb.WriteString("วัตถุดิบที่ควรจับตาสั่งเพิ่ม (เรียงจากใกล้หมดก่อน) ครับ:\n\n")
		for _, it := range items {
			sb.WriteString(fmt.Sprintf("- **%s**: เหลือ %.2f %s ใช้เฉลี่ย %.2f %s/วัน → พออีกประมาณ **%.0f วัน**\n",
				it.Name, it.Stock, it.Unit, it.DailyUse, it.Unit, it.DaysLeft))
		}
		sb.WriteString("\nแนะนำให้เตรียมสั่งวัตถุดิบที่ตัวเลขวันเหลือน้อยก่อนครับ")
		return sb.String(), true
	case AIToolGetDeadStock:
		items := result.DeadStock
		if len(items) == 0 {
			return fmt.Sprintf("ไม่พบวัตถุดิบที่มีสต๊อกค้างแต่ไม่ถูกใช้เลยในช่วง %sครับ การหมุนเวียนวัตถุดิบทำได้ดีครับ 👍", analysisWindowLabel()), true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("วัตถุดิบที่มีสต๊อกค้างแต่ไม่ได้ถูกใช้เลยในช่วง %s (เงินจม/เสี่ยงหมดอายุ) ครับ:\n\n", analysisWindowLabel()))
		for _, it := range items {
			sb.WriteString(fmt.Sprintf("- **%s**: คงเหลือ %.2f %s (มูลค่าประมาณ %s บาท)\n", it.Name, it.Stock, it.Unit, formatMoney(it.Value)))
		}
		return sb.String(), true
	case AIToolGetTopCostIngredients:
		items := result.TopCostIngredients
		if len(items) == 0 {
			return fmt.Sprintf("ยังไม่มีข้อมูลต้นทุนการใช้วัตถุดิบในช่วง %sครับ", analysisWindowLabel()), true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("วัตถุดิบที่ใช้ต้นทุนสูงที่สุดในช่วง %s (ควรจับตา/ต่อรองซัพพลายเออร์) ครับ:\n\n", analysisWindowLabel()))
		for i, it := range items {
			sb.WriteString(fmt.Sprintf("%d. **%s**: ต้นทุนรวม %s บาท (ใช้ไป %.2f %s)\n", i+1, it.Name, formatMoney(it.Cost), it.Used, it.Unit))
		}
		return sb.String(), true
	case AIToolGetStoreSummary:
		s := result.StoreSummary
		if s == nil || s.Orders == 0 {
			return fmt.Sprintf("ยังไม่มีข้อมูลยอดขายในช่วง %s สำหรับสรุปภาพรวมครับ", analysisWindowLabel()), true
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("สรุปภาพรวมร้าน (ช่วง %s) ครับ:\n\n", analysisWindowLabel()))
		sb.WriteString(fmt.Sprintf("- **ยอดขายรวม**: %s บาท จาก %d ออเดอร์\n", formatMoney(s.Revenue), s.Orders))
		if s.Trend != nil && s.Trend.HasPrior {
			dir := "เพิ่มขึ้น 📈"
			if s.Trend.RevenueChangePct < 0 {
				dir = "ลดลง 📉"
			}
			sb.WriteString(fmt.Sprintf("- **แนวโน้ม**: 7 วันล่าสุด%s (%+.1f%% เทียบสัปดาห์ก่อน)\n", dir, s.Trend.RevenueChangePct))
		}
		if len(s.TopMenus) > 0 {
			names := make([]string, 0, len(s.TopMenus))
			for _, m := range s.TopMenus {
				names = append(names, m.MenuName)
			}
			sb.WriteString(fmt.Sprintf("- **เมนูขายดี**: %s\n", strings.Join(names, ", ")))
		}
		if s.MarginReady && s.BestMargin != nil {
			sb.WriteString(fmt.Sprintf("- **เมนูกำไรดีสุด**: %s (Margin %.2f%%)\n", s.BestMargin.MenuName, s.BestMargin.Margin))
		}
		if s.LowStockCount > 0 {
			sb.WriteString(fmt.Sprintf("- **วัตถุดิบใกล้หมด**: %d รายการ (ถาม\"วัตถุดิบอะไรใกล้หมด\" เพื่อดูรายชื่อ)\n", s.LowStockCount))
		} else {
			sb.WriteString("- **วัตถุดิบ**: ไม่มีรายการเสี่ยงหมด 👍\n")
		}
		if !s.MarginReady {
			sb.WriteString("\n(หมายเหตุ: ข้อมูลต้นทุนยังไม่ครบ จึงยังไม่สรุปกำไร/Margin ครับ)")
		}
		return sb.String(), true
	case AIToolGetSalesForPeriod:
		p := result.SalesForPeriod
		if p == nil {
			return "ยังไม่มีข้อมูลยอดขายสำหรับช่วงที่ถามครับ", true
		}
		if p.Orders == 0 {
			if p.LatestDate != "" {
				return fmt.Sprintf("ยอดขาย%sยังไม่มีออเดอร์ครับ — ข้อมูลล่าสุดที่บันทึกไว้คือวันที่ %s",
					p.Label, formatThaiDate(p.LatestDate)), true
			}
			return fmt.Sprintf("ยอดขาย%sยังไม่มีออเดอร์ครับ", p.Label), true
		}
		return fmt.Sprintf("ยอดขาย%sคือ %s บาท จาก %d ออเดอร์ครับ", p.Label, formatMoney(p.Revenue), p.Orders), true
	case AIToolGetMostExpensiveMenu:
		menus := result.MostExpensiveMenus
		if len(menus) == 0 {
			return "ยังไม่มีข้อมูลเมนูสำหรับดูราคาครับ", true
		}
		top := menus[0]
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("เมนูที่ตั้งราคาสูงที่สุดคือ **%s** ราคา %s บาทต่อจานครับ", top.Name, formatMoney(top.Price)))
		if len(menus) > 1 {
			sb.WriteString("\n\nอันดับถัดไป:")
			limit := len(menus)
			if limit > 5 {
				limit = 5
			}
			for i := 1; i < limit; i++ {
				sb.WriteString(fmt.Sprintf("\n- %s: %s บาท", menus[i].Name, formatMoney(menus[i].Price)))
			}
		}
		return sb.String(), true
	}
	return "", false
}
