package service

// The catalogue joyboy shows the model when it picks tools.
//
// The descriptions on the provider tool definitions were written for legacy,
// where a classifier narrows the field first and the description only has to
// say what a tool returns. Joyboy has no classifier: the model reads this list
// and decides alone, so a description has to say which question the tool
// answers, in the language the owner asks it.
//
// The cost of getting this wrong is not an error — it is a plausible answer
// built from the wrong tool. Asked "เมนูไหนขายดีแต่กำไรน้อย", the model read
// "Classify menus into Star / Plowhorse / Puzzle / Dog quadrants", failed to
// connect the Thai question to the English jargon, and picked top sellers plus
// the single lowest-margin menu instead — two sets that do not overlap. It then
// correctly reported it could not answer. Asked again, it picked the right tool
// and answered fine. Same question, same session, different answer.
//
// So the descriptions here name the question, not the mechanism.

// joyboyToolGuide describes each tool by the question it answers. Every tool
// offered to the model must appear here; a test holds that.
var joyboyToolGuide = map[AIToolName]string{
	AIToolGetTopSellingMenus: "เมนูขายดี เรียงตามจำนวนจานที่ขายได้ " +
		"ใช้ตอบ: เมนูไหนขายดี เมนูไหนคนสั่งเยอะ เมนูยอดนิยม",
	AIToolGetMenuRevenueRanking: "เมนูเรียงตามรายได้รวมที่ทำได้ ไม่ใช่จำนวนจาน " +
		"ใช้ตอบเฉพาะเมื่อคำถามเอ่ยถึงเงินหรือรายได้ชัดเจน เช่น เมนูไหนทำเงินให้ร้านมากที่สุด " +
		"ถ้าถามแค่ \"เมนูขายดี\" เฉย ๆ ไม่ได้พูดถึงเงิน ให้ใช้ get_top_selling_menus แทน",
	AIToolGetSlowMovingMenus: "เมนูที่ขายได้น้อยที่สุด รวมถึงที่ขายไม่ได้เลย " +
		"ใช้ตอบ: เมนูไหนขายไม่ออก ควรตัดเมนูไหนทิ้ง",
	AIToolGetHighestMarginMenu: "เมนูที่กำไรต่อจานดีที่สุด พร้อมต้นทุนและกำไรต่อจาน " +
		"ใช้ตอบ: เมนูไหนกำไรดีสุด เมนูไหนคุ้มที่สุด",
	AIToolGetLowestMarginMenu: "เมนูที่กำไรต่อจานแย่ที่สุด พร้อมต้นทุนและกำไรต่อจาน " +
		"ใช้ตอบ: เมนูไหนกำไรน้อยสุด เมนูไหนขายแล้วแทบไม่เหลือ",
	AIToolGetLowestCostMenu: "เมนูที่ต้นทุนวัตถุดิบต่อจานถูกที่สุด " +
		"ใช้ตอบ: เมนูไหนต้นทุนถูกสุด",
	AIToolGetMostExpensiveMenu: "เมนูที่ตั้งราคาขายแพงที่สุด เป็นราคาป้าย ไม่ใช่รายได้ " +
		"ใช้ตอบ: เมนูไหนราคาแพงสุด",
	AIToolGetMenuEngineering: "จัดกลุ่มเมนูตามความนิยมคู่กับกำไร เป็น 4 กลุ่ม " +
		"ใช้ตอบคำถามที่พูดถึงสองอย่างพร้อมกัน เช่น เมนูไหนขายดีแต่กำไรน้อย " +
		"เมนูไหนกำไรดีแต่คนไม่ค่อยสั่ง เมนูไหนควรดันควรตัด",

	AIToolGetSalesSummary: "ยอดขายรวมกับจำนวนออเดอร์ของ \"30 วันล่าสุด\" เท่านั้น ช่วงนี้ตายตัว เปลี่ยนไม่ได้ " +
		"ใช้ตอบเฉพาะเมื่อผู้ใช้ไม่ได้ระบุช่วงเวลาเลย เช่น ยอดขายรวมเท่าไหร่ ขายได้กี่ออเดอร์ " +
		"ถ้าผู้ใช้เอ่ยช่วงเวลาใด ๆ ก็ตาม (วันนี้ เมื่อวาน 3 วันที่ผ่านมา สัปดาห์ที่แล้ว เดือนนี้ กรกฎาคม ปีนี้) " +
		"ให้ใช้ get_sales_for_period แทนเสมอ",
	AIToolGetSalesForPeriod: "ยอดขายรวมทั้งร้าน (ไม่แยกเมนู) ของช่วงเวลาที่ผู้ใช้ระบุมา ไม่ว่าจะระบุแบบไหน " +
		"วันเดียว (วันนี้ เมื่อวาน วันที่ 20 สิงหา) · นับถอยหลัง (3 วันที่ผ่านมา 5 วันก่อน 7 วันล่าสุด) · " +
		"สัปดาห์ (สัปดาห์นี้ สัปดาห์ที่แล้ว) · ช่วงคร่อมวัน (ตั้งแต่ต้นเดือนถึงวันนี้ ช่วง 20 ถึง 24 สิงหา) · " +
		"เดือน (เดือนนี้ เดือนที่แล้ว เดือนกรกฎาคม กรกฎาคม 2568) · ปี (ปีนี้ ปีที่แล้ว ปี 2568) · " +
		"และการเทียบสองช่วงเวลา เช่น เทียบเดือนต่อเดือน เทียบปีต่อปี " +
		"ใช้ตอบเมื่อถามยอดขาย/รายได้รวมของช่วงที่ระบุ " +
		"ถ้าถามถึงเมนูในช่วงนั้น (เมนูขายดี/กำไรของเมนู) ให้ใช้ get_menu_metrics_for_period แทน",
	AIToolGetSalesTrend: "เทียบยอดขาย 7 วันล่าสุดกับ 7 วันก่อนหน้า พร้อมเปอร์เซ็นต์ที่เปลี่ยน " +
		"ช่วงเวลาตายตัว ปรับไม่ได้ " +
		"ใช้ตอบเฉพาะเมื่อผู้ใช้ไม่ได้ระบุช่วงเวลาเลย เช่น ยอดขายดีขึ้นหรือแย่ลง ช่วงนี้เป็นไง " +
		"ถ้าผู้ใช้เอ่ยช่วงเวลาใด ๆ ก็ตาม (เทียบเมื่อวาน เทียบเดือนที่แล้ว เทียบปีที่แล้ว) " +
		"ให้ใช้ get_sales_for_period แทนเสมอ เพราะตัวนั้นเทียบช่วงที่ผู้ใช้ระบุได้จริง",
	AIToolGetBestSalesDay: "วันที่ (วัน เดือน ปี) ที่ขายได้มากที่สุดและน้อยที่สุดใน 30 วันล่าสุด " +
		"พร้อมยอดเงินและจำนวนบิลของวันนั้น ใช้ตอบคำถามที่ถามหา \"วันที่\" เช่น วันไหนขายดีที่สุด " +
		"วันที่เท่าไหร่ขายดีสุด วันไหนขายแย่สุด ยอดสูงสุดที่เคยทำได้ในรอบนี้คือวันไหน " +
		"ต่างจาก get_peak_periods ที่บอกแค่ \"วันในสัปดาห์\" (จันทร์/อังคาร) และนับเป็นจำนวนบิล ไม่ใช่เงิน " +
		"ถ้าคำถามถามถึงวันที่เจาะจงหรือถามเป็นยอดเงิน ให้ใช้ตัวนี้",
	AIToolGetAverageOrderValue: "ยอดขายเฉลี่ยต่อหนึ่งออเดอร์ ของ \"30 วันล่าสุด\" เท่านั้น ช่วงนี้ตายตัว " +
		"ใช้ตอบเฉพาะเมื่อผู้ใช้ไม่ได้ระบุช่วงเวลาเลย เช่น ลูกค้าจ่ายเฉลี่ยคนละเท่าไหร่ ยอดต่อบิลเท่าไหร่ " +
		"ถ้าผู้ใช้เอ่ยช่วงเวลาใด ๆ (เมื่อวาน สัปดาห์ที่แล้ว เดือนที่แล้ว กรกฎาคม) " +
		"ให้ใช้ get_sales_for_period แทน เพราะตัวนั้นคิดบิลเฉลี่ยของช่วงที่ถามมาให้ด้วย",
	AIToolGetOrderTypeBreakdown: "แยกยอดขายและจำนวนออเดอร์ตามประเภท กินที่ร้าน สั่งกลับ เดลิเวอรี " +
		"ใช้ตอบ: ขายหน้าร้านหรือสั่งกลับมากกว่ากัน " +
		"รับช่วงเวลาที่ผู้ใช้ระบุได้ด้วย เช่น เดือนที่แล้วสั่งกลับกี่ออเดอร์",
	AIToolGetPeakPeriods: "วันในสัปดาห์และชั่วโมงที่มีออเดอร์มากที่สุด " +
		"ใช้ตอบ: ช่วงไหนคนเยอะ วันไหนขายดี ควรจัดคนช่วงไหน " +
		"รับช่วงเวลาที่ผู้ใช้ระบุได้ด้วย เช่น อาทิตย์ก่อนช่วงไหนคนเยอะสุด " +
		"วันที่คับคั่งที่สุดกับชั่วโมงที่คับคั่งที่สุดเป็นคนละแกนกัน ไม่ใช่ชั่วโมงที่คับคั่งของวันนั้น",

	AIToolGetLowStockIngredients: "รายชื่อวัตถุดิบที่ใกล้หมดหรือหมดแล้ว พร้อมจำนวนที่ควรเติม " +
		"ใช้ตอบ: วัตถุดิบอะไรใกล้หมด ต้องสั่งของอะไรบ้าง",
	AIToolGetIngredientReorderForecast: "ประมาณว่าวัตถุดิบแต่ละตัวจะหมดในกี่วัน จากอัตราการใช้ที่ผ่านมา " +
		"ใช้ตอบ: ของจะหมดเมื่อไหร่ ควรสั่งของเมื่อไหร่",
	AIToolGetDeadStock: "วัตถุดิบที่มีของอยู่ในสต็อกแต่ไม่ถูกใช้เลยในช่วงที่วิเคราะห์ " +
		"ใช้ตอบ: มีของค้างสต็อกไหม เงินจมอยู่ที่ไหน ของอะไรเสี่ยงเสีย",
	AIToolGetTopCostIngredients: "วัตถุดิบเรียงตามเงินที่จ่ายไปจริงในช่วงที่วิเคราะห์ " +
		"ใช้ตอบ: วัตถุดิบตัวไหนแพงสุด เงินหมดไปกับอะไรมากที่สุด",
	AIToolGetInventoryValuation: "มูลค่ารวมของวัตถุดิบที่มีอยู่ในสต็อกตอนนี้ พร้อมจำนวนรายการที่ใกล้หมด " +
		"ใช้ตอบ: สต็อกทั้งหมดมีมูลค่าเท่าไหร่",
}

// joyboyToolsNotOffered lists tools the model is not shown.
//
// get_store_summary bundles five other tools into one block, and bundles them
// lossily: three top menus instead of the ranking, one margin menu instead of
// the list, and a count of at-risk ingredients with no names. It costs the same
// as asking for the five separately, because every tool reads the one snapshot
// already built. Offering it means the model sometimes takes the shallow path
// for no saving. Withholding it makes broad questions cost more tokens and
// risks the model forgetting one of the five areas — which is the thing to
// watch for in testing.
var joyboyToolsNotOffered = map[AIToolName]struct{}{
	AIToolGetStoreSummary: {},
}

// joyboyToolDataCoverage is a joyboy-only tool: legacy answers "how far back
// does the data reach?" through its own keyword path (answerDataCoverage), but
// joyboy exposes it as a tool the model can pick. It is not in getGroqTools(),
// so Catalogue() appends it and Run() handles it directly rather than through
// executeReadOnlyTool — it needs the full history, not the 30-day snapshot.
const joyboyToolDataCoverage AIToolName = "get_data_coverage"

// joyboyToolMenuForPeriod answers menu questions scoped to a named calendar
// period ("เมนูขายดีเดือนที่แล้ว") instead of the rolling 30-day snapshot. It
// reuses legacy's period parser (extractPeriods) and MenuMetricsForRange to
// gather the numbers, but renders them as a raw fact sheet for the model to rank
// and phrase — legacy's own path writes the finished Thai answer, which is the
// one thing joyboy does not want from it.
const joyboyToolMenuForPeriod AIToolName = "get_menu_metrics_for_period"

// joyboyToolSalesForecast predicts the next 7 days of sales and returns a
// chart-ready series (history + bounded future). Legacy answers this through its
// own keyword short-circuit (answerSalesForecast), which joyboy's mode branch
// bypasses, so joyboy exposes it as a tool the model can pick. The numbers and
// the accuracy band are computed in Go (weekday average × recent trend, measured
// by a 28-day backtest) — the model never invents a forecast figure; it only
// phrases the result, and the chart is drawn deterministically on the frontend.
const joyboyToolSalesForecast AIToolName = "get_sales_forecast"

// joyboyToolTableStatus reports the floor as it is right now: how many tables are
// free, taken, or held for a booking. It is the one tool here that reads live
// state rather than a window of history, because "โต๊ะว่างไหม" is only ever a
// question about this minute.
//
// It is read-only, and that is a decision rather than an omission. Every write in
// this assistant is proposed, shown, and executed only when the owner confirms —
// which fits data that is still true a minute later. A table is the fastest
// changing thing in the shop: by the time a "reserve table 5" bar is confirmed,
// the floor staff may have seated someone there. The write would be refused
// safely, but the owner would have been told a change was ready that then was
// not. Booking stays on the table screen, where it is one tap and immediate.
const joyboyToolTableStatus AIToolName = "get_table_status"

// joyboyToolExpenseSummary reads the money that actually left the shop, which no
// other tool covers: every existing figure here is revenue or the recipe cost of
// food already sold, and neither of those is rent, wages or the electricity bill.
const joyboyToolExpenseSummary AIToolName = "get_expense_summary"

// joyboyToolProfitByMonth is profit month by month — the one shape the profit
// tool cannot give, since it answers one window at a time. It exists so
// "กำไรรายเดือนย้อนหลัง" has a tool, and so the bar chart under it draws the
// same figures the sheet states.
const joyboyToolProfitByMonth AIToolName = "get_profit_by_month"

// joyboyToolCustomerCount counts the people who came, from the headcount the
// staff record on every bill. Asked "วันนี้มีลูกค้ากี่คน" with nothing to read,
// the model answered three different ways in three runs — the bill count, the
// tables in use, and "ระบบไม่ได้เก็บจำนวนคน" — and the last is untrue:
// orders.customer_count is required on every order. People come in whole
// numbers, so the sheet carries the party sizes and the most common one, never
// a fractional average.
const joyboyToolCustomerCount AIToolName = "get_customer_count"

// joyboyToolCancelledOrders counts the bills that were dropped rather than
// paid. Asked "วันนี้มีบิลยกเลิกกี่ใบ" with no tool to reach for, the model
// promised to go and look — three runs, three promises, nothing ever fetched.
const joyboyToolCancelledOrders AIToolName = "get_cancelled_orders"

// The three lookup tools. Everything else here ranks or totals; these answer
// about one named thing, which is the question an owner asks most and the one
// the assistant used to answer worst — see ai_joyboy_detail.go for what went
// wrong. get_order_detail is the same idea applied to a bill: the shop could be
// asked what it sold this month but not what was on one table's bill, so
// "ขอดูบิล 20260906-015" had no source at all.
const (
	joyboyToolIngredientDetail AIToolName = "get_ingredient_detail"
	joyboyToolMenuDetail       AIToolName = "get_menu_detail"
	joyboyToolOrderDetail      AIToolName = "get_order_detail"
)

// joyboyToolActiveOrders reads the floor right now: the tickets the kitchen is
// working on and the bills nobody has closed. Every other tool reports history,
// so this shape of question had no source at all.
const joyboyToolActiveOrders AIToolName = "get_active_orders"

// joyboyToolMenuList reads the menu itself. Every other menu tool here ranks by
// sales or margin, so a plain "มีเมนูอะไรบ้าง / มีกี่เมนู" had nowhere to land: the
// model fell through to chat and asked the owner to supply the menu, which is the
// one source it could never come from. The same shape of gap get_shop_profile
// closed for "ร้านเราชื่ออะไร".
const joyboyToolMenuList AIToolName = "get_menu_list"

// joyboyToolMenuProfitByCategory reads profit split by the sections of the menu
// board. Every other menu tool ranks the shop as one flat list, so a question
// about one section of it — "เครื่องดื่มตัวไหนกำไรดีสุด" — could only be answered if a
// drink happened to be in the top eight of a list that ranks food and drink
// together. Three rounds of testing it never was, and the model, reading a sheet
// with no drink on it, reported that the system holds no drinks data at all: a
// shop with three drinks on the menu told it had none.
//
// One sheet carries every category rather than the one the question names,
// because which section the owner means is the model's read of the sentence, not
// Go's — the same division of labour every other tool here keeps. It also answers
// the comparison ("หมวดไหนกำไรดีสุด") from the same figures, with no second tool
// whose description would differ from this one only by the word "ทุก".
const joyboyToolMenuProfitByCategory AIToolName = "get_menu_profit_by_category"

// joyboyToolPaymentMix reads how bills were paid — cash against PromptPay. The
// payment table existed from the start, but nothing wrote to it until the day
// seeder learned to (2026-09-03), so the tool arrives with the data. It takes a
// named period the way the sales tools do, and reports how many paid bills in
// the window have no method recorded, because everything before 2026-08-30
// does not.
const joyboyToolPaymentMix AIToolName = "get_payment_mix"

// joyboyToolTableUsage reads how much each table was actually used. Everything
// else about tables is live status — free or occupied right now — so "โต๊ะไหน
// คนไม่ค่อยนั่ง แล้วควรย้ายไปโซนไหน" could only be answered from whoever happened
// to be sitting down at that second, and the owner got "ทุกโต๊ะว่างอยู่ครับ".
// The bills remember which table served them; this is that memory.
const joyboyToolTableUsage AIToolName = "get_table_usage"

// joyboyToolShopProfile reads the shop's own identity — its name, branch, type
// and opening hours. Nothing else exposed this, so "ร้านเราชื่ออะไร" was a dead
// end the model filled by dumping a sales total.
const joyboyToolShopProfile AIToolName = "get_shop_profile"

// joyboyExtraTools are the capabilities joyboy offers beyond legacy's tool list.
// Their names are not in getGroqTools(), so Catalogue() adds them. How they run
// then splits: get_data_coverage and search_system_docs are intercepted in
// runJoyboyExtraTool because they cannot be answered from the 30-day snapshot;
// get_profit_summary is a normal snapshot tool that simply isn't in legacy's
// provider list, so runJoyboyExtraTool leaves it alone and it falls through to
// executeReadOnlyTool like every other read-only tool.
var joyboyExtraTools = []AIToolName{
	joyboyToolDataCoverage,
	AIToolSearchSystemDocs,
	AIToolGetProfitSummary,
	joyboyToolMenuForPeriod,
	joyboyToolSalesForecast,
	joyboyToolTableStatus,
	joyboyToolExpenseSummary,
	joyboyToolProfitByMonth,
	joyboyToolCustomerCount,
	joyboyToolCancelledOrders,
	joyboyToolIngredientDetail,
	joyboyToolMenuDetail,
	joyboyToolOrderDetail,
	joyboyToolShopProfile,
	joyboyToolActiveOrders,
	joyboyToolMenuList,
	joyboyToolPaymentMix,
	joyboyToolTableUsage,
	joyboyToolMenuProfitByCategory,
}

// joyboyExtraToolGuide describes the extra tools, same shape as joyboyToolGuide.
var joyboyExtraToolGuide = map[AIToolName]string{
	joyboyToolDataCoverage: "ช่วงข้อมูลที่ระบบมีจริง วันเก่าสุดถึงวันใหม่สุดที่มีการขาย จำนวนวันที่มีข้อมูล " +
		"และยอดขายรวมกับจำนวนออเดอร์รวมของทั้งประวัติตั้งแต่เปิดร้าน (ไม่ใช่แค่ 30 วันล่าสุด) " +
		"ใช้ตอบ: ระบบมีข้อมูลตั้งแต่เมื่อไหร่ ข้อมูลถึงช่วงไหน มีข้อมูลย้อนหลังกี่วัน " +
		"ยอดขายรวมทั้งหมดตั้งแต่เปิดร้าน ออเดอร์รวมทั้งหมด",
	AIToolSearchSystemDocs: "ค้นคู่มือการใช้งานเว็บ Dishy เพื่อตอบวิธีใช้ระบบ " +
		"ใช้ตอบ: ใช้ระบบยังไง เมนูตรงไหน ตั้งค่าอะไรที่ไหน ทำอะไรได้บ้าง ระบบมีข้อจำกัดอะไร แก้ปัญหายังไง " +
		"ครอบคลุมทุกส่วนของระบบ ไม่ใช่แค่เรื่องขาย: พนักงาน สิทธิ์ การเชิญเข้าร้าน โต๊ะ การจอง QR " +
		"ครัว บิล รายจ่าย ตั้งค่าร้าน ถ้าผู้ใช้ถามว่า ทำตรงไหน กดตรงไหน เพิ่มยังไง หน้าไหน ให้เลือกตัวนี้เสมอ " +
		"เพราะคำตอบมีที่มาจากคู่มือและจะมีปุ่มพาไปหน้านั้นให้ด้วย",
	AIToolGetProfitSummary: "กำไรรวมทั้งร้าน คือรายได้รวม ลบ ต้นทุนวัตถุดิบรวม " +
		"เหลือกำไรรวม พร้อม margin เฉลี่ยทั้งร้าน เป็นภาพรวมทั้งร้าน ไม่ใช่รายเมนู " +
		"ใบเดียวมีทั้งกำไรขั้นต้น (ก่อนหักรายจ่าย) และกำไรหลังหักรายจ่ายที่บันทึกไว้ในช่วงเดียวกัน " +
		"ใช้ตอบ: กำไรเท่าไหร่ · เหลือเท่าไหร่ · หักค่าใช้จ่ายแล้วเหลือเท่าไหร่ · กำไรสุทธิ " +
		// Same fix as the expense tool: the wiring has read named periods for weeks,
		// but the description never said so, so period questions looked out of scope.
		"**เครื่องมือนี้เลือกช่วงเวลาได้** ถ้าคำถามเอ่ยช่วงเวลา (สัปดาห์ก่อน เดือนที่แล้ว เดือนกรกฎาคม) " +
		"ระบบจะคิดกำไรของช่วงนั้นให้เอง ถ้าไม่เอ่ยช่วงเวลาจะใช้ 30 วันล่าสุด " +
		"ใช้ตอบ: ร้านกำไรเท่าไหร่ กำไรเดือนที่แล้วเท่าไหร่ ต้นทุนรวมเท่าไหร่ กำไรสุทธิเท่าไหร่ margin ทั้งร้านกี่เปอร์เซ็นต์ " +
		"ถ้าถามแค่ยอดขายรวมไม่พูดถึงกำไรหรือต้นทุน ให้ใช้ get_sales_summary แทน " +
		"ถ้าถามกำไรของเมนูตัวใดตัวหนึ่ง ให้ใช้ get_highest_margin_menu หรือ get_lowest_margin_menu แทน",
	joyboyToolIngredientDetail: "ข้อมูลของ \"วัตถุดิบตัวที่ผู้ใช้เอ่ยชื่อ\" โดยเฉพาะ " +
		"บอกสต๊อกคงเหลือ หน่วย ขั้นต่ำ ราคาต่อหน่วย มูลค่าคงเหลือ และ **เมนูไหนบ้างที่ใช้วัตถุดิบตัวนี้** " +
		"ใช้ตอบเมื่อคำถามเอ่ยชื่อวัตถุดิบตัวใดตัวหนึ่ง เช่น หมูสับเหลือเท่าไหร่ · กะเพราขั้นต่ำเท่าไหร่ · " +
		"ไข่ไก่ราคาเท่าไหร่ · เมนูไหนใช้กุ้งสดบ้าง · ถ้ากะเพราหมดจะกระทบเมนูไหน " +
		"ต่างจาก get_low_stock_ingredients ที่บอกเฉพาะตัวที่ใกล้หมดทั้งหมด ไม่เจาะจงตัวใดตัวหนึ่ง",
	joyboyToolMenuDetail: "ข้อมูลของ \"เมนูตัวที่ผู้ใช้เอ่ยชื่อ\" โดยเฉพาะ " +
		"บอกราคา สถานะเปิด/ปิดขาย จำนวนที่ขายได้ ยอดขาย ต้นทุน กำไร margin และสูตรว่าใช้วัตถุดิบอะไรบ้าง " +
		"ใช้ตอบเมื่อคำถามเอ่ยชื่อเมนูตัวใดตัวหนึ่ง เช่น ผัดไทยขายได้กี่รายการ · ต้มยำกุ้งกำไรเท่าไหร่ · " +
		"ข้าวผัดปูใช้วัตถุดิบอะไร · ถ้าปิดขายเมนูนี้จะกระทบยอดขายแค่ไหน " +
		"**สำคัญ: ถ้าคำถามเอ่ยชื่อเมนูเจาะจง ให้ใช้เครื่องมือนี้ ห้ามใช้ลิสต์อันดับ** " +
		"เพราะลิสต์อันดับมีแค่ไม่กี่ตัว เมนูที่ไม่อยู่ในลิสต์ไม่ได้แปลว่าไม่มียอดขาย",
	joyboyToolOrderDetail: "รายละเอียดของ \"บิลใบใดใบหนึ่ง\" ทั้งใบ " +
		"บอกว่าบิลนั้นสั่งอะไรไปบ้าง อย่างละกี่จาน ราคาต่อหน่วยเท่าไหร่ ยอดก่อนหักลด ส่วนลด เซอร์วิสชาร์จ VAT ยอดสุทธิ " +
		"เปิดบิลกี่โมง ปิดกี่โมง โต๊ะไหน กี่คน พนักงานคนไหน จ่ายเงินยังไง " +
		"ใช้ตอบ: ขอดูบิล 20260906-015 · บิลนี้สั่งอะไรบ้าง · บิลล่าสุดเป็นยังไง · บิลใบนั้นทำไมแพง · บิลนี้ลดไปเท่าไหร่ " +
		"**และใช้ตอบคำถามที่ถามถึงโต๊ะแต่ต้องการรายการอาหาร** เช่น โต๊ะ 5 สั่งอะไรไปบ้าง · " +
		"โต๊ะ A03 กินอะไรไป · โต๊ะนี้ยอดเท่าไหร่ (get_table_status บอกได้แค่ว่าโต๊ะว่างหรือไม่ว่าง ไม่รู้ว่าสั่งอะไร) " +
		"ถ้าคำถามเอ่ยเลขบิล ให้ใช้เครื่องมือนี้ · ถ้าผู้ใช้พูดลอย ๆ ว่าบิลล่าสุดหรือบิลเมื่อกี้ ก็ใช้เครื่องมือนี้ ระบบจะส่งบิลล่าสุดมาให้เลือกเอง " +
		"ต่างจาก get_active_orders ที่บอกภาพรวมบิลที่ยังไม่ปิดทั้งหมด แต่ไม่บอกว่าในบิลมีอาหารอะไร " +
		"ต่างจาก get_sales_for_period ที่ให้ยอดรวมของช่วงเวลา ไม่ใช่รายละเอียดของบิลใบเดียว",
	joyboyToolCustomerCount: "จำนวนลูกค้า (คน) ที่มาร้านในช่วงเวลา นับจากจำนวนคนที่พนักงานลงไว้ตอนเปิดบิล " +
		"พร้อมว่าส่วนใหญ่มากันกี่คนต่อบิล และตอนนี้มีคนนั่งค้างอยู่กี่คน " +
		"รับช่วงเวลาได้ทุกแบบ (วันนี้ เมื่อวาน สัปดาห์ที่แล้ว เดือนนี้) ไม่ระบุ = 30 วันล่าสุด " +
		"ใช้ตอบ: วันนี้มีลูกค้ากี่คน เดือนนี้ลูกค้ากี่คน ลูกค้ามากันกี่คนต่อโต๊ะ ลูกค้าเยอะขึ้นไหม " +
		"ถ้าถามจำนวนบิลหรือออเดอร์ ไม่ใช่จำนวนคน ให้ใช้ get_sales_for_period แทน " +
		"ถ้าถามว่าตอนนี้โต๊ะไหนมีคนนั่ง ให้ใช้ get_table_status",
	joyboyToolCancelledOrders: "บิลที่ถูกยกเลิกทั้งใบในช่วงเวลา กี่ใบ รวมเป็นเงินเท่าไหร่ และเหตุผลที่พนักงานลงไว้ " +
		"รับช่วงเวลาได้ทุกแบบ (วันนี้ เมื่อวาน สัปดาห์ที่แล้ว เดือนนี้) ไม่ระบุ = 30 วันล่าสุด " +
		"ใช้ตอบ: วันนี้มีบิลยกเลิกกี่ใบ เดือนนี้ยกเลิกไปเท่าไหร่ ทำไมถึงยกเลิก ยกเลิกเยอะไหม " +
		"ไม่รวมรายการอาหารที่ถูกลบออกจากบิลที่ยังจ่ายตามปกติ",
	joyboyToolProfitByMonth: "กำไรทีละเดือน ย้อนหลัง 6 เดือน: ยอดขาย ต้นทุนวัตถุดิบ รายจ่ายที่บันทึก และกำไรสุทธิ ของแต่ละเดือน " +
		"ใช้ตอบ: กำไรรายเดือน · กำไรย้อนหลังหลายเดือน · เดือนไหนกำไรดีสุด · แนวโน้มกำไร · เงินจากยอดขายไปไหนแต่ละเดือน " +
		"ถ้าถามกำไรของเดือนเดียวหรือช่วงเดียว ให้ใช้ get_profit_summary แทน ตัวนี้สำหรับหลายเดือนต่อกันเท่านั้น " +
		"ระบบวาดกราฟแท่งรายเดือนให้เองจากตัวเลขชุดนี้",
	joyboyToolExpenseSummary: "รายจ่ายที่ร้านจ่ายเงินออกไปจริง แยกตามหมวด " +
		"(วัตถุดิบ ค่าแรง ค่าเช่า ค่าน้ำค่าไฟ อุปกรณ์ อื่น ๆ) พร้อมรายการล่าสุด " +
		// The window used to be described as a hard "30 วันล่าสุด". Asked
		// "สัปดาห์ก่อนจ่ายอะไรไปบ้าง" the model read that as "this tool cannot do
		// last week", picked nothing, and replied by asking the owner which kind of
		// spending they meant — over a tool that had already supported named
		// periods for weeks. The scope has to be described as it actually behaves.
		"**เครื่องมือนี้เลือกช่วงเวลาได้** ถ้าคำถามเอ่ยช่วงเวลา (สัปดาห์ก่อน เมื่อวาน เดือนที่แล้ว เดือนกรกฎาคม) " +
		"ระบบจะดึงรายจ่ายของช่วงนั้นให้เอง ถ้าไม่เอ่ยช่วงเวลาจะใช้ 30 วันล่าสุด " +
		"ใช้ตอบ: จ่ายอะไรไปบ้าง สัปดาห์ก่อนจ่ายอะไรไปบ้าง รายจ่ายเท่าไหร่ ค่าไฟเดือนนี้เท่าไหร่ หมวดไหนจ่ายเยอะสุด ต้นทุนคงที่เท่าไหร่ " +
		"นี่คือเงินสดที่จ่ายออกไป คนละอย่างกับต้นทุนวัตถุดิบของอาหารที่ขายไปแล้ว " +
		"ถ้าถามกำไรจากการขาย ให้ใช้ get_profit_summary แทน",
	joyboyToolTableStatus: "สถานะโต๊ะในร้าน \"ตอนนี้เดี๋ยวนี้\" ไม่ใช่ข้อมูลย้อนหลัง " +
		"บอกจำนวนโต๊ะทั้งหมด ว่างกี่โต๊ะ มีคนนั่งกี่โต๊ะ จองไว้กี่โต๊ะ ที่นั่งว่างรวมกี่ที่ " +
		"พร้อมรายชื่อโต๊ะว่าง เลขโต๊ะ จำนวนที่นั่ง และโซน " +
		"ใช้ตอบ: โต๊ะว่างกี่โต๊ะ ร้านเต็มยัง มีโต๊ะรับกี่คนได้บ้าง โต๊ะไหนว่าง โต๊ะนี้ว่างไหม " +
		"ตอนนี้มีคนกี่โต๊ะ โซนไหนคนแน่น มีใครจองไว้บ้าง " +
		"บอกได้แค่ว่าโต๊ะว่างหรือไม่ว่าง **ไม่รู้ว่าโต๊ะนั้นสั่งอาหารอะไรไป** " +
		"ถ้าถามว่าโต๊ะนั้นสั่งอะไร กินอะไรไปบ้าง หรือยอดเท่าไหร่ ให้ใช้ get_order_detail แทน " +
		"ระบบนี้ดูสถานะได้อย่างเดียว จองหรือยกเลิกจองไม่ได้ " +
		"แต่ถ้าผู้ใช้ขอให้จองโต๊ะหรือยกเลิกจอง **ก็ให้เลือกเครื่องมือนี้อยู่ดี** " +
		"จะได้ตอบจากสถานะจริงว่าทำให้ไม่ได้ และบอกว่าต้องไปกดเองที่หน้าจัดการโต๊ะ",
	joyboyToolMenuForPeriod: "เมนูพร้อมยอดขาย จำนวนจาน กำไร และ margin ของ \"ช่วงเวลาที่ระบุ\" ไม่ใช่ 30 วันล่าสุด " +
		"รับได้ทั้ง นับถอยหลัง (7 วันล่าสุด ในช่วง 3 วันที่ผ่านมา) · สัปดาห์ (สัปดาห์นี้ สัปดาห์ที่แล้ว) · " +
		"เดือน (เดือนนี้ เดือนที่แล้ว เดือนกรกฎาคม) · ปี (ปีนี้ ปี 2568) " +
		"ใช้ตอบเมื่อคำถามเอ่ยช่วงเวลาใด ๆ ก็ตาม เช่น ในช่วง 7 วันเมนูไหนขายดี " +
		"เมนูขายดีสัปดาห์ที่แล้ว เมนูกำไรดีสุดเดือนกรกฎาคม " +
		"ถ้าคำถามไม่เอ่ยช่วงเวลาเลย ให้ใช้ get_top_selling_menus หรือ get_highest_margin_menu (30 วัน) แทน",
	joyboyToolSalesForecast: "คาดการณ์ยอดขาย 7 วันข้างหน้า พร้อมช่วงความคลาดเคลื่อนและกราฟ " +
		"คำนวณด้วยสถิติ (ค่าเฉลี่ยยอดขายตามวันในสัปดาห์ × แนวโน้มล่าสุด) เป็นการ \"ทำนายอนาคต\" ไม่ใช่ยอดที่เกิดขึ้นจริง " +
		"ใช้ตอบเมื่อคำถามถามถึงอนาคต เช่น อาทิตย์หน้าจะขายได้เท่าไหร่ พรุ่งนี้น่าจะขายดีไหม คาดการณ์ยอดขายสัปดาห์หน้า ทำนายยอดขาย " +
		"ถ้าถามยอดขายที่เกิดขึ้นไปแล้ว (วันนี้ เดือนนี้ ที่ผ่านมา) ให้ใช้ get_sales_for_period หรือ get_sales_summary แทน " +
		"ต้องบอกผู้ใช้เสมอว่านี่คือการคาดการณ์ ไม่ใช่ตัวเลขจริง",
	joyboyToolActiveOrders: "ออเดอร์ที่ยังไม่ปิดบิล \"ตอนนี้เดี๋ยวนี้\" ไม่ใช่ข้อมูลย้อนหลัง " +
		"บอกว่ามีกี่ออเดอร์ค้าง ครัวกำลังทำกี่ออเดอร์ บิลไหนยังไม่จ่าย ยอดค้างชำระรวมเท่าไหร่ " +
		"พร้อมเลขออเดอร์ โต๊ะ สถานะ ยอด และเปิดบิลมานานกี่นาที " +
		"ใช้ตอบ: ตอนนี้มีออเดอร์อะไรบ้าง ครัวกำลังทำอะไร บิลไหนยังไม่จ่าย โต๊ะไหนรอเก็บเงิน " +
		"มีบิลค้างนานสุดกี่นาที ยอดค้างชำระรวมเท่าไหร่ ร้านยุ่งอยู่ไหม " +
		"ดูได้อย่างเดียว รับออเดอร์หรือปิดบิลให้ไม่ได้ " +
		"ถ้าถามยอดขายที่ปิดบิลไปแล้ว ให้ใช้ get_sales_summary หรือ get_sales_for_period แทน",
	joyboyToolMenuList: "รายการเมนูทั้งหมดที่ร้านมี พร้อมจำนวนเมนูทั้งหมด ราคา หมวด และเปิดขายหรือปิดขายอยู่ " +
		"เป็น \"เมนูที่ร้านมี\" ไม่ใช่ \"เมนูที่ขายดี\" จึงรวมเมนูที่ยังไม่เคยขายได้เลยด้วย " +
		"ใช้ตอบ: ร้านมีกี่เมนู มีเมนูอะไรบ้าง ขอดูรายการเมนู เมนูไหนปิดขายอยู่บ้าง เมนูทั้งหมดมีอะไร ราคาเมนูแต่ละตัวเท่าไหร่ " +
		"ถ้าถามว่าเมนูไหนขายดีหรือทำเงินได้เท่าไหร่ ให้ใช้ get_top_selling_menus หรือ get_menu_revenue_ranking แทน " +
		"ถ้าถามถึงเมนูตัวใดตัวหนึ่งที่เอ่ยชื่อ ให้ใช้ get_menu_detail แทน",
	joyboyToolMenuProfitByCategory: "กำไรและยอดขายแยกตาม **หมวดเมนู** (กับข้าว อาหารจานเดียว เครื่องดื่ม ของหวาน ฯลฯ) " +
		"ใบเดียวมีครบทุกหมวดที่ร้านมี แต่ละหมวดบอกจำนวนจาน ยอดขาย ต้นทุน กำไรรวม margin และสัดส่วนกำไรของหมวดนั้น " +
		"พร้อมรายชื่อเมนูในหมวดนั้นเรียงจากกำไรมากไปน้อย " +
		"ใช้ตอบ: เครื่องดื่มตัวไหนกำไรดีสุด · ของหวานเมนูไหนทำเงินได้มากสุด · หมวดไหนทำกำไรให้ร้านมากสุด · " +
		"กำไรจากอาหารกับเครื่องดื่มอย่างไหนมากกว่ากัน · เครื่องดื่มขายได้เท่าไหร่ · เทียบกำไรหรือยอดขายระหว่างหมวด " +
		"**ถ้าคำถามเอ่ยชื่อหมวด ให้ใช้เครื่องมือนี้ ห้ามใช้ลิสต์อันดับรวมทั้งร้าน** " +
		"เพราะลิสต์พวกนั้นไม่แยกหมวดและตัดมาแค่ไม่กี่อันดับ เมนูของหมวดที่ถามอาจไม่ติดอยู่ในลิสต์เลยสักตัว " +
		"ถ้าถามเมนูกำไรดีสุดของทั้งร้านโดยไม่เอ่ยหมวด ให้ใช้ get_highest_margin_menu แทน " +
		"ถ้าถามว่าร้านมีเมนูอะไรบ้างในแต่ละหมวด ไม่ได้ถามเรื่องเงิน ให้ใช้ get_menu_list แทน " +
		"ถ้าถามกำไรรวมของทั้งร้านโดยไม่แยกหมวด ให้ใช้ get_profit_summary แทน",
	joyboyToolPaymentMix: "ลูกค้าจ่ายเงินแบบไหน — จำนวนบิลและยอดเงินแยกตามวิธีจ่าย (เงินสด / พร้อมเพย์) พร้อมสัดส่วน " +
		"ค่าเริ่มต้นคือ 30 วันล่าสุด **เลือกช่วงเวลาได้** ถ้าคำถามเอ่ยช่วง (วันนี้ เมื่อวาน สัปดาห์ก่อน เดือนที่แล้ว) " +
		"ใช้ตอบ: จ่ายพร้อมเพย์กับเงินสดอย่างไหนเยอะกว่า · วันนี้รับเงินสดเท่าไหร่ · โอนมากี่บิล · " +
		"สัดส่วนพร้อมเพย์กี่เปอร์เซ็นต์ · เงินสดในลิ้นชักควรมีเท่าไหร่ " +
		"ถ้าถามยอดขายรวมโดยไม่สนวิธีจ่าย ให้ใช้ get_sales_summary หรือ get_sales_for_period แทน",
	joyboyToolTableUsage: "สถิติการใช้งานของแต่ละโต๊ะย้อนหลัง — โต๊ะไหนมีคนนั่งกี่บิล ทำเงินเท่าไหร่ ลูกค้ากี่คน " +
		"พร้อมจำนวนที่นั่งของโต๊ะนั้น และสรุปรวมแยกตามโซน ค่าเริ่มต้น 30 วันล่าสุด **ระบุช่วงเวลาได้** " +
		"ใช้ตอบ: โต๊ะไหนคนไม่ค่อยนั่ง · โต๊ะไหนคนนั่งบ่อยสุด · ควรย้ายโต๊ะไปโซนไหน · โซนไหนคนนิยม · " +
		"โต๊ะไหนทำเงินได้มากสุด · ควรเพิ่มหรือลดโต๊ะตรงไหน " +
		"**เป็นสถิติย้อนหลัง ไม่ใช่สถานะตอนนี้** ถ้าถามว่าตอนนี้โต๊ะไหนว่างหรือเต็ม ให้ใช้ get_table_status แทน",
	joyboyToolShopProfile: "ข้อมูลตัวร้านเอง ชื่อร้าน ชื่อสาขา ประเภทร้าน เวลาเปิด-ปิด จำนวนโต๊ะทั้งหมด " +
		"ใช้ตอบ: ร้านเราชื่ออะไร ร้านเปิดกี่โมง ปิดกี่โมง สาขาอะไร ร้านเราเป็นร้านประเภทไหน มีกี่โต๊ะ " +
		"เป็นข้อมูลตัวตนของร้าน ไม่ใช่ยอดขายหรือสถานะโต๊ะตอนนี้",
}

// isJoyboyExtraTool reports whether a tool is joyboy-only (handled in Run() by
// runJoyboyExtraTool, not through the snapshot / executeReadOnlyTool path).
func isJoyboyExtraTool(name AIToolName) bool {
	_, ok := joyboyExtraToolGuide[name]
	return ok
}

// joyboyToolGroups is the order the catalogue's section headings appear in and
// the tools filed under each. Grouping is presentation only: the model still
// picks freely across sections (chosen the way we settled — organise the flat
// list for readability, never gate the choice behind a section). A tool absent
// from every group still shows, unheaded, after the grouped ones, so a newly
// added tool is never hidden — a test holds that each offered tool has a home.
var joyboyToolGroups = []struct {
	Heading string
	Tools   []AIToolName
}{
	{"เมนู", []AIToolName{
		joyboyToolMenuList,
		AIToolGetTopSellingMenus, AIToolGetMenuRevenueRanking, AIToolGetSlowMovingMenus,
		AIToolGetHighestMarginMenu, AIToolGetLowestMarginMenu, AIToolGetLowestCostMenu,
		AIToolGetMostExpensiveMenu, AIToolGetMenuEngineering, joyboyToolMenuForPeriod,
		joyboyToolMenuProfitByCategory,
	}},
	{"โต๊ะและหน้าร้าน", []AIToolName{joyboyToolTableStatus, joyboyToolTableUsage, joyboyToolActiveOrders, joyboyToolCustomerCount}},
	{"ยอดขายและกำไร", []AIToolName{
		AIToolGetSalesSummary, AIToolGetSalesForPeriod, AIToolGetSalesTrend,
		AIToolGetAverageOrderValue, AIToolGetOrderTypeBreakdown, AIToolGetPeakPeriods,
		AIToolGetBestSalesDay,
		AIToolGetProfitSummary, joyboyToolProfitByMonth, joyboyToolSalesForecast, joyboyToolPaymentMix,
		joyboyToolCancelledOrders,
	}},
	{"วัตถุดิบและสต๊อก", []AIToolName{
		AIToolGetLowStockIngredients, AIToolGetIngredientReorderForecast, AIToolGetDeadStock,
		AIToolGetTopCostIngredients, AIToolGetInventoryValuation,
	}},
	{"ดูรายตัวที่ระบุชื่อ", []AIToolName{joyboyToolIngredientDetail, joyboyToolMenuDetail, joyboyToolOrderDetail}},
	{"หน้าร้าน", []AIToolName{joyboyToolTableStatus, joyboyToolActiveOrders}},
	{"ข้อมูลร้าน", []AIToolName{joyboyToolShopProfile}},
	{"รายจ่าย", []AIToolName{joyboyToolExpenseSummary}},
	{"ข้อมูลระบบ", []AIToolName{joyboyToolDataCoverage}},
	{"คู่มือการใช้งาน", []AIToolName{AIToolSearchSystemDocs}},
}

// joyboyToolGroupHeading returns the section a tool sits under, "" if unfiled.
func joyboyToolGroupHeading(name AIToolName) string {
	for _, group := range joyboyToolGroups {
		for _, tool := range group.Tools {
			if tool == name {
				return group.Heading
			}
		}
	}
	return ""
}

// joyboyToolGroupOrder ranks a tool by its group for a stable catalogue sort.
// Unfiled tools sort last so they still render, just without a heading.
func joyboyToolGroupOrder(name AIToolName) int {
	for i, group := range joyboyToolGroups {
		for _, tool := range group.Tools {
			if tool == name {
				return i
			}
		}
	}
	return len(joyboyToolGroups)
}
