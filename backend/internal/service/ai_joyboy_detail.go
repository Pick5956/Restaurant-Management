package service

import (
	"fmt"
	"sort"
	"strings"

	"Project-M/internal/aitools"
	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Looking one named thing up.
//
// Every other tool here ranks or totals: best sellers, low stock, revenue by
// period. None of them answers "how much หมูสับ is left" or "how many ผัดไทย did
// we sell", which is what an owner asks most often — and the shape of question
// the assistant handled worst. Asked for a menu outside the top five it reported
// the menu had no sales at all; asked which menus use a given ingredient it
// invented "กะเพราไก่" for a shop whose menu is called "ข้าวกะเพราไก่ไข่ดาว".
// Both failures come from the same place: no tool could look a name up, so the
// model filled the gap from a ranked list or from the name itself.
//
// Tools take no arguments in this design — the model picks a name, not a call
// signature — so the subject is resolved here, from the question text against
// the shop's own rows. That keeps the split intact: the model decided this
// question is about one item; Go decides which item and what is true of it.

// aiFindNamedRows returns the indexes of rows whose name appears in the question,
// longest name first so "ต้มยำกุ้งน้ำข้น" wins over a shorter "ต้มยำกุ้ง" that is
// contained in it. Matching is on the shop's real names, never on a word list.
// aiFindNamedRowsInThread resolves what the question points at when it does not
// spell the name out: "เมนูแรกที่บอกไปตอนต้น กำไรดีไหม".
//
// The question always wins — a name written in this turn is what the owner is
// asking about. Only when the sentence names nothing is the thread read, and
// then it returns EVERY name the conversation has touched, oldest first, not
// just one.
//
// Returning one was the first attempt and it was wrong in a way worth recording.
// It resolved to the most recently mentioned name, which reads sensible for
// "อันนั้น" and is exactly backwards for "เมนูแรกที่บอกไปตอนต้น": asked that
// after a thread about ชาไทยเย็น then แกงเขียวหวานไก่, it fetched the second one
// and the assistant answered "ชาไทยเย็นไม่ได้อยู่ในรายการที่ดึงมา" — data about
// the wrong dish, which reads as the assistant not following its own
// conversation.
//
// Go cannot tell "แรก" from "ล่าสุด" from "อันนั้น" without understanding the
// sentence, and guessing at it is how a word list quietly answers the wrong
// question. So Go stops guessing: it hands over every candidate in the order they
// were discussed, and the model — which does read the sentence — picks. Same
// division as everywhere else here: the model decides what was meant, Go supplies
// the figures.
// partial reports that the rows came from a shortened name rather than a whole
// one, which the sheet has to say out loud — the model is choosing between
// near misses, not reading an answer.
func aiFindNamedRowsInThread(names []string, question string, history []AIConversationMessage) (rows []int, partial bool) {
	if found := aiFindNamedRows(names, question); len(found) > 0 {
		return found, false
	}
	// Before the thread. A name half-written in THIS sentence is what the owner
	// is asking about; a name fully written two turns ago is not.
	//
	// Getting this order wrong is not theoretical: with the partial match placed
	// after the thread instead, "ต้มยำกุ้งต้นทุนเท่าไหร่" returned ผัดไทยกุ้งสด
	// and กะเพรา — the subjects of the previous three turns — and the assistant
	// answered "มองย้อนไปไม่ถึงต้มยำกุ้งครับ" about a dish sitting on its own menu.
	if found := aiPartlyNamedRows(names, question); len(found) > 0 {
		return found, true
	}
	seen := make(map[int]bool, 4)
	ordered := make([]int, 0, 4)
	for _, message := range history {
		for _, index := range aiFindNamedRows(names, message.Content) {
			if seen[index] {
				continue
			}
			seen[index] = true
			ordered = append(ordered, index)
			if len(ordered) >= aiThreadNameCandidates {
				return ordered, false
			}
		}
	}
	return ordered, false
}

// aiThreadNameCandidates caps how many things the thread can offer at once. Four
// covers "the first one / the second one / that one" without turning the sheet
// into a catalogue the model has to wade through.
const aiThreadNameCandidates = 4

// aiQuestionNamesARow reports whether the sentence itself named one of the rows,
// which decides whether the sheet is an answer or a set of candidates.
func aiQuestionNamesARow(names []string, question string) bool {
	return len(aiFindNamedRows(names, question)) > 0
}

func aiFindNamedRows(names []string, question string) []int {
	haystack := aiNormalizeName(question)
	if haystack == "" {
		return nil
	}
	type hit struct {
		index  int
		length int
	}
	hits := make([]hit, 0, 4)
	for index, name := range names {
		needle := aiNormalizeName(name)
		if needle == "" {
			continue
		}
		if strings.Contains(haystack, needle) {
			hits = append(hits, hit{index: index, length: len([]rune(needle))})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].length > hits[j].length })

	// Drop a shorter name that is contained in an already-accepted longer one:
	// "ต้มยำกุ้งน้ำข้น" in the question also contains "ต้มยำกุ้ง", and reporting
	// both would read as two separate menus.
	kept := make([]int, 0, len(hits))
	taken := make([]string, 0, len(hits))
	for _, h := range hits {
		candidate := aiNormalizeName(names[h.index])
		swallowed := false
		for _, longer := range taken {
			if strings.Contains(longer, candidate) {
				swallowed = true
				break
			}
		}
		if swallowed {
			continue
		}
		taken = append(taken, candidate)
		kept = append(kept, h.index)
		if len(kept) == 3 {
			break
		}
	}
	return kept
}

// aiPartlyNamedRows finds rows the owner named by part of their name.
//
// aiFindNamedRows above needs the whole stored name inside the question, which
// is how "ผัดไทย" came back as "ผัดไทยไม่ได้อยู่ในเมนูของร้านครับ" while the shop
// was selling ผัดไทยกุ้งสด three hundred times a month. Nobody says the whole
// name. They say the head of it, or the part that distinguishes the dish —
// "กะเพรา" for ข้าวกะเพราไก่ไข่ดาว, "ต้มยำ" for ต้มยำกุ้งน้ำข้น.
//
// The command path already reads names this way: aiMatchNames accepts
// containment in either direction. It could not simply be reused here because it
// compares a name to a name, and this side has a whole sentence — so the same
// idea is expressed the other way round, by looking for any long enough run of
// the stored name inside the question.
//
// This does not decide what the owner meant. Every hit goes back as a candidate,
// longest match first, and the model picks — the same division as everywhere
// else in this file. Go widening the shortlist is the opposite of Go guessing:
// today it hands over nothing and the model is left to conclude the dish does
// not exist.
func aiPartlyNamedRows(names []string, question string) []int {
	haystack := aiNormalizeName(question)
	if haystack == "" {
		return nil
	}
	type hit struct {
		index   int
		matched int
	}
	hits := make([]hit, 0, 4)
	for index, name := range names {
		runes := []rune(aiNormalizeName(name))
		if len(runes) < aiPartialNameMinRunes {
			continue
		}
		// Longest run first, so a hit is the most of the name the owner actually
		// said rather than the first four characters that happen to line up.
		best := 0
		for length := len(runes); length >= aiPartialNameMinRunes && best == 0; length-- {
			for start := 0; start+length <= len(runes); start++ {
				if strings.Contains(haystack, string(runes[start:start+length])) {
					best = length
					break
				}
			}
		}
		if best > 0 {
			hits = append(hits, hit{index: index, matched: best})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].matched > hits[j].matched })
	kept := make([]int, 0, aiThreadNameCandidates)
	for _, h := range hits {
		kept = append(kept, h.index)
		if len(kept) == aiThreadNameCandidates {
			break
		}
	}
	return kept
}

// aiPartialNameMinRunes is how much of a name has to appear before it counts as
// having been named. Four is short enough for "กะเพรา" to reach
// ข้าวกะเพราไก่ไข่ดาว and long enough that "ข้าว" alone does not drag in every
// rice dish on the menu ahead of the one that was asked about — and if it does,
// the longer match still sorts above it.
const aiPartialNameMinRunes = 4

// joyboyIngredientDetailBody reports everything known about the ingredients named
// in the question, including which menus consume them — the recipe link no other
// tool exposes.
//
// usage is the 30-day consumption per ingredient, the same rows the reorder
// forecast reads. It is here because "อีกกี่วันต้องสั่งกุ้งสดเพิ่ม" names an
// ingredient, so the selector reaches for this sheet rather than the forecast —
// and this sheet used to carry stock with no rate of use, so the model answered
// "ประมาณ 10 วัน" over a figure the data put at 7.5. A sheet that names the
// ingredient has to carry the one number that question is about.
func joyboyIngredientDetailBody(shelf []entity.Ingredient, menus []entity.MenuItem, usage []repository.AIIngredientUsage, question string, history []AIConversationMessage) string {
	if len(shelf) == 0 {
		return joyboyNoData("no_ingredients_recorded")
	}
	names := make([]string, len(shelf))
	for index, item := range shelf {
		names[index] = item.Name
	}
	found, partial := aiFindNamedRowsInThread(names, question, history)
	if len(found) == 0 {
		// Naming what the shop actually stocks turns a dead end into a question the
		// owner can answer in one word.
		sample := make([]string, 0, 8)
		for _, item := range shelf {
			sample = append(sample, item.Name)
			if len(sample) == 8 {
				break
			}
		}
		return joyboyJoin([]string{
			joyboyNoData("no_ingredient_named_in_question"),
			// Saying the list is partial matters: with eight of twenty-seven names
			// and no such warning, "ผัดไทยไม่ได้อยู่ในเมนูของร้านครับ" is a
			// reasonable thing for a model to conclude, and it was wrong.
			"note=ยังไม่รู้ว่าถามถึงวัตถุดิบตัวไหน ให้ถามกลับว่าหมายถึงตัวไหน "+
				"รายการข้างล่างเป็นแค่ตัวอย่างบางส่วน ไม่ใช่ทั้งหมด "+
				"ห้ามสรุปว่าของที่เขาถามไม่มีอยู่ในร้าน",
			"ingredients_in_stock_sample=" + strings.Join(sample, ", "),
			fmt.Sprintf("total_ingredients=%d", len(shelf)),
		})
	}

	lines := make([]string, 0, len(found)*6+1)
	if partial {
		lines = append(lines, "note=รายการด้านล่างคือตัวที่ชื่อใกล้เคียงกับที่ถาม เรียงจากใกล้ที่สุด "+
			"ให้เลือกตัวที่ตรงกับคำถามแล้วตอบเฉพาะตัวนั้น ถ้าไม่แน่ใจให้ถามกลับว่าหมายถึงตัวไหน")
	} else if !aiQuestionNamesARow(names, question) {
		// The rows came from earlier in the thread, not from this sentence. Unsaid,
		// the model read them as the answer: "ไข่นกนางแอ่น" — not on the shelf —
		// was answered with หมาล่า's stock, the one thing the thread had named
		// (25 ก.ย. 2569).
		lines = append(lines, "note=ข้อความล่าสุดไม่ได้พิมพ์ชื่อวัตถุดิบที่มีในคลัง "+
			"รายการด้านล่างคือตัวที่คุยกันก่อนหน้าในบทสนทนานี้ ไม่ใช่ตัวที่ถามแน่นอน "+
			"ถ้าข้อความล่าสุดเอ่ยชื่อของอย่างอื่นที่ไม่อยู่ในรายการนี้ แปลว่าของนั้นยังไม่มีในคลัง "+
			"ให้บอกตรง ๆ ว่ายังไม่มี ห้ามตอบข้อมูลของตัวด้านล่างแทน "+
			"ถ้าข้อความล่าสุดหมายถึงของที่คุยกันอยู่ (เช่น \"อันนั้น\" \"ตัวเมื่อกี้\") ให้ตอบตัวนั้น")
	}
	for _, index := range found {
		item := shelf[index]
		lines = append(lines,
			"ingredient="+item.Name,
			fmt.Sprintf("stock=%s unit=%s", joyboyNum(item.Stock), item.Unit),
			fmt.Sprintf("min_stock=%s cost_per_unit=%s stock_value=%s",
				joyboyNum(item.MinStock), joyboyNum(item.CostPerUnit),
				joyboyNum(roundBaht(item.Stock*item.CostPerUnit))),
		)
		switch {
		case item.Stock <= 0:
			lines = append(lines, "status=หมดแล้ว")
		case item.MinStock > 0 && item.Stock < item.MinStock:
			lines = append(lines, "status=ต่ำกว่าขั้นต่ำ")
		default:
			lines = append(lines, "status=ปกติ")
		}
		if used := aiMenusUsingIngredient(menus, item.ID); len(used) > 0 {
			lines = append(lines, "used_by_menus="+strings.Join(used, ", "))
		} else {
			lines = append(lines, "used_by_menus=ไม่มีเมนูไหนใช้วัตถุดิบนี้ตามสูตรที่บันทึกไว้")
		}
		lines = append(lines, joyboyIngredientDaysLeftLines(item, usage)...)
	}
	return joyboyJoin(lines)
}

// joyboyIngredientDaysLeftLines is the forecast for one ingredient, computed the
// way get_ingredient_reorder_forecast computes it (30-day use ÷ 30 = daily use,
// stock ÷ daily use = days left) so the two tools never quote different days for
// the same shelf. Nothing is printed when usage was not fetched; a line saying
// the rate cannot be computed is printed when the ingredient was not used at
// all, because a missing figure reads as "no data" and a zero reads as "runs
// out today".
func joyboyIngredientDaysLeftLines(item entity.Ingredient, usage []repository.AIIngredientUsage) []string {
	if usage == nil {
		return nil
	}
	for _, row := range usage {
		if aiNormalizeName(row.Name) != aiNormalizeName(item.Name) {
			continue
		}
		if row.Used <= 0 {
			return []string{"days_left=คำนวณไม่ได้ ยังไม่มีการใช้วัตถุดิบนี้ใน 30 วันล่าสุด"}
		}
		dailyUse := row.Used / aitools.AnalysisWindowDays
		daysLeft := item.Stock / dailyUse
		return []string{
			fmt.Sprintf("used_30d=%s %s daily_use=%s %s days_left=%s days_left_label=%s",
				joyboyNum(row.Used), item.Unit, joyboyNum(dailyUse), item.Unit, joyboyNum(daysLeft), joyboyDaysLeftLabel(daysLeft)),
			"days_left_means=จำนวนวันที่ของจะพอใช้ คิดจากอัตราใช้เฉลี่ย 30 วันล่าสุด " +
				"ถ้าถามว่าจะหมดเมื่อไหร่ หรืออีกกี่วันต้องสั่งเพิ่ม ให้ตอบด้วยคำใน days_left_label ห้ามพูดเป็นทศนิยมของวัน ห้ามประมาณเอง",
		}
	}
	return nil
}

// aiMenusUsingIngredient reads the stored recipes rather than guessing from the
// name. The invented "กะเพราไก่" came from having no such list to read.
//
// Each menu carries how much of the ingredient one serving uses. Names alone
// answered "ไข่ไก่ขึ้นฟองละ 2 บาท เมนูไหนโดนหนักสุด" with "ทุกเมนูใช้ไข่ไก่เหมือนกันหมด" —
// the model had a list of four menus and nothing to rank them by. The quantity
// is what a price rise multiplies, so it is the one figure that question needs.
func aiMenusUsingIngredient(menus []entity.MenuItem, ingredientID uint) []string {
	used := make([]string, 0, 4)
	for _, menu := range menus {
		for _, component := range menu.Ingredients {
			if component.IngredientID == ingredientID {
				entry := menu.Name
				if component.Quantity > 0 {
					entry += " (ใช้ " + strings.TrimSpace(joyboyNum(component.Quantity)+" "+component.Unit) + " ต่อรายการ)"
				}
				used = append(used, entry)
				break
			}
		}
	}
	return used
}

// joyboyMenuDetailBody reports one named menu: its price, whether it is being
// sold, what it did over the analysis window, and what it is made of.
func joyboyMenuDetailBody(menus []entity.MenuItem, margins []repository.AIMenuMarginSummary, window, question string, history []AIConversationMessage) string {
	if len(menus) == 0 {
		return joyboyNoData("no_menu_items_recorded")
	}
	names := make([]string, len(menus))
	for index, item := range menus {
		names[index] = item.Name
	}
	found, partial := aiFindNamedRowsInThread(names, question, history)
	if len(found) == 0 {
		sample := make([]string, 0, 8)
		for _, item := range menus {
			sample = append(sample, item.Name)
			if len(sample) == 8 {
				break
			}
		}
		return joyboyJoin([]string{
			joyboyNoData("no_menu_named_in_question"),
			"note=ยังไม่รู้ว่าถามถึงเมนูไหน ให้ถามกลับว่าหมายถึงเมนูไหน "+
				"รายการข้างล่างเป็นแค่ตัวอย่างบางส่วน ไม่ใช่ทั้งหมด "+
				"ห้ามสรุปว่าเมนูที่เขาถามไม่มีอยู่ในร้าน",
			"menus_sample=" + strings.Join(sample, ", "),
			fmt.Sprintf("total_menus=%d", len(menus)),
		})
	}

	byName := make(map[string]repository.AIMenuMarginSummary, len(margins))
	for _, row := range margins {
		byName[aiNormalizeName(row.MenuName)] = row
	}

	// The window label rides on the sales figures below, not on the sheet as a
	// whole: with "period=30 วันล่าสุด" as the first line the model told the
	// owner the recipe was "ในช่วง 30 วันล่าสุด ใช้กุ้งสด 150 กรัม" — a recipe has
	// no window, and a price does not either.
	lines := make([]string, 0, len(found)*7)
	// When the sentence named nothing, these rows are the things the conversation
	// has touched, oldest first — candidates, not an answer. Saying so is what lets
	// the model resolve "เมนูแรกที่บอกไปตอนต้น" (take the first) apart from
	// "อันนั้น" (take the last); left unsaid it reads the first row as the answer.
	if partial {
		lines = append(lines, "note=รายการด้านล่างคือตัวที่ชื่อใกล้เคียงกับที่ถาม เรียงจากใกล้ที่สุด ให้เลือกตัวที่ตรงกับคำถามแล้วตอบเฉพาะตัวนั้น ถ้าไม่แน่ใจให้ถามกลับว่าหมายถึงตัวไหน")
	} else if len(found) > 1 && !aiQuestionNamesARow(names, question) {
		lines = append(lines, "note=คำถามไม่ได้พิมพ์ชื่อมา รายการด้านล่างคือสิ่งที่คุยกันในบทสนทนานี้ "+
			"เรียงจากที่พูดถึงก่อนไปหลัง ให้เลือกตัวที่ตรงกับคำถาม "+
			"(\"อันแรก/ตอนต้น\" = ตัวบนสุด · \"อันล่าสุด/อันนั้น\" = ตัวล่างสุด) "+
			"แล้วตอบเฉพาะตัวนั้น ถ้ายังไม่แน่ใจให้ถามกลับว่าหมายถึงตัวไหน")
	}
	for _, index := range found {
		menu := menus[index]
		lines = append(lines, "menu="+menu.Name, fmt.Sprintf("price=%s", joyboyNum(menu.Price)))
		if menu.IsAvailable {
			lines = append(lines, "selling_status=เปิดขายอยู่")
		} else {
			lines = append(lines, "selling_status=ปิดขายอยู่")
		}
		if row, ok := byName[aiNormalizeName(menu.Name)]; ok {
			lines = append(lines, fmt.Sprintf("%s qty_sold=%d revenue=%s cost=%s profit=%s margin_pct=%s",
				window, row.Quantity, joyboyNum(row.Revenue), joyboyNum(row.Cost),
				joyboyNum(row.Profit), joyboyNum(row.Margin)))
			// Per-plate figures are computed here because the model is forbidden to
			// do arithmetic: given only a total profit and a quantity it answered
			// "ผมไม่ทราบกำไรต่อจาน" — the division it must not perform was the whole
			// question. Go divides, the model reads.
			if row.Quantity > 0 {
				lines = append(lines, fmt.Sprintf("profit_per_unit=%s cost_per_unit=%s revenue_per_unit=%s",
					joyboyNum(roundBaht(row.Profit/float64(row.Quantity))),
					joyboyNum(roundBaht(row.Cost/float64(row.Quantity))),
					joyboyNum(roundBaht(row.Revenue/float64(row.Quantity)))))
			}
		} else {
			// Not in the margin set means no paid sales in the window — a real zero,
			// which is different from "this menu is unknown".
			lines = append(lines, window+" qty_sold=0 note=ไม่มียอดขายในช่วงที่วิเคราะห์")
		}
		if recipe := aiMenuRecipeLines(menu); recipe != "" {
			lines = append(lines, "recipe="+recipe,
				"recipe_means=สูตรปัจจุบันต่อ 1 รายการ เป็นค่าที่ตั้งไว้ ไม่ขึ้นกับช่วงเวลา เวลาเล่าสูตรห้ามใส่คำว่า 'ในช่วง 30 วันล่าสุด'")
		} else {
			lines = append(lines, "recipe=ยังไม่ได้บันทึกสูตรของเมนูนี้")
		}
	}
	return joyboyJoin(lines)
}

// aiMenuRecipeLines renders a menu's stored recipe as "name qty unit" pairs.
func aiMenuRecipeLines(menu entity.MenuItem) string {
	parts := make([]string, 0, len(menu.Ingredients))
	for _, component := range menu.Ingredients {
		name := ""
		if component.Ingredient != nil {
			name = component.Ingredient.Name
		}
		if strings.TrimSpace(name) == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s %s %s", name, joyboyNum(component.Quantity), component.Unit))
	}
	return strings.Join(parts, " · ")
}
