package service

// Wiring for the joyboy package.
//
// joyboy knows nothing about this backend: it asks for a model call and a way to
// run read-only tools, and everything else it does itself. This file supplies
// those two things out of parts that already exist and are already trusted — the
// provider rotation, the snapshot builder, and the 22 read-only tools with their
// calculations. Nothing here recomputes anything.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"Project-M/internal/aitools"
	"Project-M/internal/entity"
	"Project-M/internal/joyboy"
	"Project-M/internal/repository"
)

// joyboyChat calls a model through the existing rotation, which already handles
// provider fallback, key rotation and parked keys. It stays on that path rather
// than calling Groq directly so that AI_PROVIDER keeps meaning the same thing
// for joyboy as it does for everything else.
type joyboyChat struct {
	service *AIService
}

func (c joyboyChat) Complete(ctx context.Context, prompt string, kind joyboy.CallKind) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	text, _, err := c.service.askSecondRoundWithOptions(prompt, joyboyCompleteOptions(kind))
	return text, err
}

// CompleteStream is Complete with the reply handed over as it is written —
// what lets the owner read the answer while the model is still on it.
func (c joyboyChat) CompleteStream(ctx context.Context, prompt string, kind joyboy.CallKind, onDelta func(string)) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	text, _, err := c.service.askSecondRoundStream(prompt, joyboyCompleteOptions(kind), onDelta)
	return text, err
}

// joyboyWriteCeiling is the output ceiling for the answer-writing round. Groq's
// unset default is 2,048, and at medium effort the round's worst measured cost
// was 1,917 tokens thinking plus 326 writing — 2,243, which overruns the default
// mid-word. 3,072 clears that with roughly 800 to spare, matching what the
// planner path settled on for the same reason. Groq reserves it against the
// daily budget at request time, so it is spent only on the round that needs it.
const joyboyWriteCeiling = 3072

// joyboyCompleteOptions turns "which call is this" into what to ask the provider
// for. Every value here is measured, not guessed.
//
// Both rounds run at medium. Choosing tools needs it because low made the choice
// worse: asked "เมนูไหนขายดีแต่กำไรน้อย" twice, low reached for get_menu_engineering
// once and get_lowest_margin_menu the other time, and then answered that a menu
// sells well from a tool that only reports margins; at medium the same question
// picked correctly twice out of two. Writing needs it too, for a reason low only
// exposed once tested: at low the round transcribed 96 dishes as 95 and 9,504
// baht as 9,405 on a repeat of the identical question — cheaper thinking started
// getting the figures wrong. Medium buys that back.
//
// Only the write round carries a ceiling, because only it thinks long enough to
// approach one; selection's output is a short JSON array and never came close to
// 2,048.
func joyboyCompleteOptions(kind joyboy.CallKind) aiProviderCompleteOptions {
	if kind == joyboy.CallWriteAnswer {
		return aiProviderCompleteOptions{ReasoningEffort: "medium", MaxCompletionTokens: joyboyWriteCeiling}
	}
	// Choosing tools is judgement, but judgement from a fixed list against a
	// question — not writing. It goes to the support model so the writing model's
	// daily budget is spent only on what the owner reads. Empty when no support
	// model is configured, which leaves every call exactly where it was.
	return aiProviderCompleteOptions{ReasoningEffort: "medium", Model: aiSupportModel()}
}

// aiSupportModel names the model for the calls nobody reads: choosing a tool,
// and reading a sentence into JSON. Empty means "same as everything else".
//
// It is deliberately a separate setting rather than a hardcoded name. Which
// model is the cheap one changes every few months, and the free tier's limits
// change with it; a name in the environment can follow that without a release.
func aiSupportModel() string {
	return strings.TrimSpace(os.Getenv("AI_SUPPORT_MODEL"))
}

// joyboyTools runs read-only tools for one restaurant. The restaurant is fixed
// when this is built, from the authenticated caller — there is no path by which
// a model could change it, because no tool takes it as an argument.
type joyboyTools struct {
	service      *AIService
	restaurantID uint

	// periodReader, when set, is a period read that was started before the
	// tool choice (AI_JOYBOY_PARALLEL); nil means read it now, as before.
	periodReader salesWindowReader

	// forecast carries chart-ready data back out of the tool run: joyboy's answer
	// channel is text-only (joyboy.Answer), so when the forecast tool runs it
	// stashes its structured result here on the struct that askJoyboy owns, and
	// askJoyboy attaches it to the response for the frontend chart to draw. The
	// LLM still writes the words from the fact sheet; this is only the series.
	forecast *AIForecastResult

	// chart rides back the same way for the general chart payloads (a two-period
	// comparison bar, a daily trend line): the tool computes it, askJoyboy hands
	// it to the frontend to draw.
	chart *AIChartData

	// history lets a tool read the range from the thread when the sentence alone
	// is not enough ("แล้วเดือนก่อนล่ะ").
	history []AIConversationMessage
}

// joyboyWithCoverage appends what range the shop actually has data for, so an
// empty window is reported as "outside the records" rather than as zero sales.
func joyboyWithCoverage(body, coverage string) string {
	if strings.TrimSpace(coverage) == "" {
		return body
	}
	return body + "\n" + coverage
}

// withPeriodCoverage adds what range the shop actually has records for to a
// sheet about a named window, and names an empty window that ends before the
// first bill as "before the records" rather than as nothing sold.
//
// The sales tool has carried this since it learned named periods; the menu,
// profit, expense and table tools did not, so "เมนูขายดีเดือนเมษายน 2568" —
// four months before the shop's first bill — came back as "ยังไม่มีการบันทึก
// ยอดขายเมนูไหนเลย", and "เมนูขายดีเดือนสิงหาคม 2568", which has eight days of
// records, was headed as the whole month. The owner reads the first as a month
// with no sales and the second as a bad month; both are the same gap.
//
// empty is whether the tool found nothing in the window. The "before the
// records" reason replaces the sheet only then: an expense logged before the
// first bill is still an expense.
func (t *joyboyTools) withPeriodCoverage(body, label string, start, end time.Time, empty bool) string {
	if t.service == nil || t.service.repo == nil {
		return body
	}
	coverage, err := t.service.repo.SalesCoverage(t.restaurantID)
	if err != nil || strings.TrimSpace(coverage.FirstDate) == "" {
		return body
	}
	if empty {
		if firstDay, parseErr := time.Parse("2006-01-02", strings.TrimSpace(coverage.FirstDate)); parseErr == nil {
			firstDay = time.Date(firstDay.Year(), firstDay.Month(), firstDay.Day(), 0, 0, 0, 0, start.Location())
			if !end.After(firstDay) {
				body = joyboyJoin([]string{"period=" + label, joyboyNoData("period_before_first_record")})
			}
		}
	}
	return joyboyWithCoverage(body, aiCoverageLines(coverage.FirstDate, coverage.LastDate, start))
}

func (t *joyboyTools) Catalogue() []joyboy.ToolSpec {
	// The tool names still come from the provider definitions, so adding a tool
	// there is enough to make it runnable. The descriptions come from
	// joyboyToolGuide instead: legacy's were written for a model that had
	// already been narrowed down by a classifier, and joyboy has none.
	definitions := t.service.getGroqTools()
	catalogue := make([]joyboy.ToolSpec, 0, len(definitions))
	for _, definition := range definitions {
		name := AIToolName(definition.Function.Name)
		if _, withheld := joyboyToolsNotOffered[name]; withheld {
			continue
		}
		description, described := joyboyToolGuide[name]
		if !described {
			// Falling back keeps a newly added tool usable rather than
			// invisible; the test insists it be described properly.
			description = definition.Function.Description
		}
		catalogue = append(catalogue, joyboy.ToolSpec{Name: string(name), Description: description})
	}
	// joyboy-only tools are appended after legacy's list, described by their own
	// guide. Run() handles these directly rather than through executeReadOnlyTool.
	for _, name := range joyboyExtraTools {
		catalogue = append(catalogue, joyboy.ToolSpec{Name: string(name), Description: joyboyExtraToolGuide[name]})
	}
	// Order and label by section so the flat list reads as grouped headings. The
	// set is untouched — only the order and the Group tag are set here — so no
	// tool is dropped or added by grouping. A stable sort keeps the within-group
	// order above.
	for i := range catalogue {
		catalogue[i].Group = joyboyToolGroupHeading(AIToolName(catalogue[i].Name))
	}
	sort.SliceStable(catalogue, func(a, b int) bool {
		return joyboyToolGroupOrder(AIToolName(catalogue[a].Name)) <
			joyboyToolGroupOrder(AIToolName(catalogue[b].Name))
	})
	return catalogue
}

// periodNamedIn resolves the window a question is about, and it exists because
// the word list alone is not enough.
//
// profitPeriod knows the periods somebody thought to type into it: today,
// yesterday, a named or relative month. Wiring only that into the profit and
// expense tools made them right about "เดือนที่แล้ว" and quietly wrong about
// everything else — asked "สัปดาห์ก่อนจ่ายอะไรไปบ้าง" the assistant read a
// 30-day sheet and answered "จ่าย 300 บาทในสัปดาห์ก่อน", relabelling the window
// it was handed. A word list that misses does not fail loudly; it answers about
// the wrong days.
//
// Running the list first and the model second was the obvious order and it was
// wrong: "ตั้งแต่ต้นเดือนถึงวันนี้กำไรเท่าไหร่" contains the word "วันนี้", so the
// list matched that fragment, claimed the question, and answered about today
// alone — which has no sales — while the model never got to see the sentence.
// A word list does not know it only matched part of a phrase.
//
// So the model reads the range and the list is the fallback for when it cannot
// be reached. Go still validates the dates and writes the label the owner reads:
// the model says WHICH range, never what the figures in it are. The extra call
// is small and runs at low effort.
// readPeriod is every tool's way to the model's period read: the one started
// early when the parallel preflight is on, a fresh call otherwise.
// offerChart attaches a picture to the answer if none is attached yet: the
// first tool with a shape worth seeing owns the chart.
func (t *joyboyTools) offerChart(chart *AIChartData) {
	if chart != nil && t.chart == nil {
		t.chart = chart
	}
}

// joyboyRollingStart is where the default "30 วันล่าสุด" window begins: the
// start of the calendar day 29 days ago, so the window is thirty whole days
// ending today. It used to be this minute minus 30×24h, which read bills from
// 14:00 on the first day while the expense ledger on the same sheet started at
// 00:00 — 31 calendar days of expenses against 30 days of bills, and a
// breakeven that divided by 30 (found 23 ก.ย. 2569). The expense summary tool
// already counted from day −29; now all three agree.
func joyboyRollingStart(now time.Time) time.Time {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return today.AddDate(0, 0, -(int(analysisWindowDays) - 1))
}

func (t *joyboyTools) readPeriod(question string, history []AIConversationMessage, now time.Time) (datedSalesRequest, bool) {
	if t.periodReader != nil {
		return t.periodReader(question, history, now)
	}
	return t.service.resolveDatedSalesWithModel(question, history, now)
}

func (t *joyboyTools) periodNamedIn(question string) (start, end time.Time, label string, named bool) {
	now := repository.BangkokNow()
	if request, ok := t.readPeriod(question, t.history, now); ok &&
		len(request.periods) > 0 && strings.TrimSpace(request.clarify) == "" {
		period := request.periods[0]
		aiStage("flow", "joyboy: period read by the model → %s", period.Label)
		return period.Start, period.End, period.Label, true
	}
	// Reached when the model read no period ("กำไรเท่าไหร่" names none, which is a
	// correct answer) or could not be reached at all. The list then still covers
	// the common months and days rather than losing the window entirely.
	if start, end, label, explicit := profitPeriod(question, now); explicit {
		aiStage("flow", "joyboy: period read by the word list → %s", label)
		return start, end, label, true
	}
	return time.Time{}, time.Time{}, "", false
}

// comparisonWindows reads the two windows a comparison question is about.
//
// The model's period reader already returns two periods for "เดือนนี้กับเดือน
// ที่แล้ว"; those are used as they came, later one first. A question that names
// one period is compared against the window just before it — the previous
// calendar month when the period is a calendar month, otherwise the same number
// of days ending where this one starts. Naming none means the rolling window
// against the thirty days before it. One model call either way, the same one
// periodNamedIn would have made.
func (t *joyboyTools) comparisonWindows(question string) (current, previous AIPeriod) {
	now := repository.BangkokNow()
	if request, ok := t.readPeriod(question, t.history, now); ok && strings.TrimSpace(request.clarify) == "" {
		if len(request.periods) >= 2 {
			current, previous = request.periods[0], request.periods[1]
			if previous.Start.After(current.Start) {
				current, previous = previous, current
			}
			aiStage("flow", "joyboy: comparison periods read by the model → %s vs %s", current.Label, previous.Label)
			return current, previous
		}
		if len(request.periods) == 1 {
			current = request.periods[0]
			aiStage("flow", "joyboy: period read by the model → %s", current.Label)
			return current, joyboyPeriodBefore(current)
		}
	}
	if start, end, label, explicit := profitPeriod(question, now); explicit {
		aiStage("flow", "joyboy: period read by the word list → %s", label)
		current = AIPeriod{Label: label, Start: start, End: end}
		return current, joyboyPeriodBefore(current)
	}
	current = AIPeriod{Label: analysisWindowLabel(), Start: now.AddDate(0, 0, -int(analysisWindowDays)), End: now}
	return current, joyboyPeriodBefore(current)
}

// joyboyTodayKeyIfReached is today's date key when the window runs past this
// minute, "" otherwise — the form ComputeBestSalesDayAsOf and FinishedDays take.
// A default window ends at this very minute, so "reaches now" is end >= now,
// not end > now; the strict form left today in the weekend average.
func joyboyTodayKeyIfReached(end, now time.Time) string {
	if !end.Before(now) {
		return now.Format("2006-01-02")
	}
	return ""
}

// joyboyPartialFirstKey is the window's first date when the window opens part
// way through it (a rolling "30 วันล่าสุด" starts at this minute thirty days
// ago), "" when it opens at midnight.
func joyboyPartialFirstKey(start time.Time) string {
	if start.Hour() == 0 && start.Minute() == 0 && start.Second() == 0 {
		return ""
	}
	return start.Format("2006-01-02")
}

// joyboyPeriodBefore is the window just before this one: the previous calendar
// month for a calendar month, otherwise an equal number of days ending where
// this one begins.
func joyboyPeriodBefore(period AIPeriod) AIPeriod {
	if period.Start.Day() == 1 && period.End.Equal(period.Start.AddDate(0, 1, 0)) {
		start := period.Start.AddDate(0, -1, 0)
		return AIPeriod{Label: "เดือนก่อนหน้า (" + start.Format("2006-01") + ")", Start: start, End: period.Start}
	}
	length := period.End.Sub(period.Start)
	start := period.Start.Add(-length)
	return AIPeriod{
		Label: fmt.Sprintf("ช่วงก่อนหน้า (%s ถึง %s)", start.Format("2006-01-02"), period.Start.AddDate(0, 0, -1).Format("2006-01-02")),
		Start: start,
		End:   period.Start,
	}
}

// runJoyboyExtraTool handles the joyboy-only tools that do not go through the
// snapshot. handled is false for any other tool, so the caller falls through to
// the normal read-only path.
func (t *joyboyTools) runJoyboyExtraTool(tool AIToolName, question string) (body string, ok bool, handled bool) {
	switch tool {
	case joyboyToolDataCoverage:
		coverage, err := t.service.repo.SalesCoverage(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyDataCoverageBody(coverage), true, true
	case joyboyToolIngredientDetail:
		if t.service.actionIngredients == nil {
			return "", false, true
		}
		shelf, err := t.service.actionIngredients.ListIngredients(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		// The menu list carries the recipes, which is how "which menus use this"
		// is answered from stored data instead of from the ingredient's name.
		var menus []entity.MenuItem
		if t.service.actionMenus != nil {
			menus, _ = t.service.actionMenus.ListMenuItems(t.restaurantID, true, 0)
		}
		// The 30-day usage is what turns a stock figure into "days left" — the
		// number "อีกกี่วันต้องสั่ง...เพิ่ม" is asking for. Left out, the sheet has
		// stock and no rate, and the model estimates the days itself.
		var usage []repository.AIIngredientUsage
		if t.service.repo != nil {
			since := repository.BangkokNow().AddDate(0, 0, -int(analysisWindowDays))
			if rows, err := t.service.repo.IngredientUsage(t.restaurantID, since); err == nil {
				usage = rows
			} else {
				aiStage("warn", "joyboy: %s usage failed (%v) → sheet without days_left", tool, err)
			}
		}
		return joyboyIngredientDetailBody(shelf, menus, usage, question, t.history), true, true

	case joyboyToolMenuDetail:
		if t.service.actionMenus == nil || t.service.repo == nil {
			return "", false, true
		}
		menus, err := t.service.actionMenus.ListMenuItems(t.restaurantID, true, 0)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		since := repository.BangkokNow().AddDate(0, 0, -int(analysisWindowDays))
		margins, err := t.service.repo.AllMenuMargins(t.restaurantID, since)
		if err != nil {
			// Sales are one part of the answer; price, availability and the recipe
			// are still worth reporting without them.
			aiStage("warn", "joyboy: %s margins failed (%v) → reporting without sales", tool, err)
			margins = nil
		}
		return joyboyMenuDetailBody(menus, margins, "period="+analysisWindowLabel(), question, t.history), true, true

	case joyboyToolCancelledOrders:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		reasons, err := t.service.repo.CancelledOrders(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyCancelledOrdersBody(label, reasons), true, true
	case joyboyToolCustomerCount:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		parties, err := t.service.repo.GuestsByPartySize(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		// People still seated are read live, and only when the window reaches
		// now — a question about last month has no open bills in it, and an
		// "open_guests_now" line under it would read as though it did.
		var open []repository.AIActiveOrder
		live := !end.Before(now)
		if live {
			open, err = t.service.repo.ActiveOrders(t.restaurantID)
			if err != nil {
				aiStage("warn", "joyboy: %s could not read open bills (%v) → counting closed bills only", tool, err)
				live, open = false, nil
			}
		}
		return joyboyCustomerCountBody(label, parties, open, live), true, true
	case joyboyToolProfitByMonth:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		rows, err := t.service.repo.ProfitByMonth(t.restaurantID, 6, now)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		current := now.Format("2006-01")
		t.offerChart(buildProfitByMonthChart(rows, current))
		return joyboyProfitByMonthBody(rows, current), true, true

	case joyboyToolExpenseSummary:
		if t.service.actionExpenses == nil {
			return "", false, true
		}
		// The window was fixed at the last 30 days, so "เดือนที่แล้วจ่ายค่าอะไรไปบ้าง"
		// was answered with this month's spending. profitPeriod is the same reader
		// the profit and menu period flows use, and it falls back to the rolling
		// 30 days when the sentence names no window.
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			// The label too: without it the sheet printed "period=" with nothing
			// after it and the model read the ISO dates aloud.
			start, end, label = joyboyRollingStart(now), now, analysisWindowLabel()
		}
		from := start.Format("2006-01-02")
		// The range is half-open (end is the day after), and the expense list takes
		// an inclusive last day.
		until := end.AddDate(0, 0, -1).Format("2006-01-02")
		if !explicit {
			until = end.Format("2006-01-02")
		}
		list, err := t.service.actionExpenses.List(t.restaurantID, from, until, "")
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		if list != nil {
			t.offerChart(buildExpenseCategoryChart(list.Categories))
		}
		return t.withPeriodCoverage(joyboyExpenseSummaryBody(label, from, until, list),
			label, start, end, list == nil || list.Entries == 0), true, true
	case AIToolGetPeakPeriods:
		// Same shape as the profit case: a named window is answered from that
		// window, anything else falls through to the 30-day snapshot.
		if t.service.repo == nil {
			return "", false, false
		}
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			return "", false, false
		}
		weekdays, err := t.service.repo.PeakSalesByWeekdayForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s for %s failed (%v) → falling back to the snapshot", tool, label, err)
			return "", false, false
		}
		hours, err := t.service.repo.PeakSalesByHourForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s for %s failed (%v) → falling back to the snapshot", tool, label, err)
			return "", false, false
		}
		t.offerChart(buildPeakHoursChart(hours))
		return joyboyPeakForPeriodBody(label, weekdays, hours), true, true

	case AIToolGetOrderTypeBreakdown:
		if t.service.repo == nil {
			return "", false, false
		}
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			return "", false, false
		}
		rows, err := t.service.repo.OrderTypeBreakdownForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s for %s failed (%v) → falling back to the snapshot", tool, label, err)
			return "", false, false
		}
		t.offerChart(buildOrderTypePieChart(rows))
		return joyboyOrderTypeForPeriodBody(label, rows), true, true

	case joyboyToolOrderDetail:
		// One bill, read whole. The shortlist is fetched first because it is also
		// what the question is matched against: an order number the shop never
		// issued cannot be looked up, and matching against the shop's own rows is
		// the same rule the menu and ingredient lookups follow.
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		recent, err := t.service.repo.RecentBills(t.restaurantID, joyboyRecentBillRows)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		if len(recent) == 0 {
			return joyboyBillDetailBody(nil, nil, false, now), true, true
		}
		numbers := joyboyBillNumbers(recent)
		matched, partial := aiFindNamedRowsInThread(numbers, question, t.history)
		wanted := make([]string, 0, len(matched))
		for _, index := range matched {
			wanted = append(wanted, numbers[index])
		}
		if len(wanted) == 0 {
			// Nothing named, so the shortlist itself is the answer. Only the
			// newest few carry their dishes: enough for "บิลล่าสุดสั่งอะไร" without
			// sending twenty bills of line items to the model.
			head := recent
			if len(head) > joyboyBillLinesFor {
				head = head[:joyboyBillLinesFor]
			}
			full, err := t.service.repo.BillsByNumbers(t.restaurantID, joyboyBillNumbers(head))
			if err != nil {
				aiStage("warn", "joyboy: %s could not read the latest bills (%v) → listing them without items", tool, err)
			} else {
				withLines := make(map[string][]repository.AIBillLine, len(full))
				for _, bill := range full {
					withLines[bill.OrderNumber] = bill.Lines
				}
				for index := range recent {
					recent[index].Lines = withLines[recent[index].OrderNumber]
				}
			}
			return joyboyBillDetailBody(nil, recent, false, now), true, true
		}
		if len(wanted) > joyboyBillLinesFor {
			wanted = wanted[:joyboyBillLinesFor]
		}
		named, err := t.service.repo.BillsByNumbers(t.restaurantID, wanted)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyBillDetailBody(named, recent, partial, now), true, true

	case joyboyToolActiveOrders:
		// Live state, like the table tool: only true for this minute, so it is read
		// straight from the orders table rather than the 30-day snapshot.
		if t.service.repo == nil {
			return "", false, true
		}
		orders, err := t.service.repo.ActiveOrders(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyActiveOrdersBody(orders, repository.BangkokNow()), true, true

	case joyboyToolMenuList:
		// The menu itself, read live: it is the shop's own catalogue rather than a
		// window of sales, so the 30-day snapshot has no version of it.
		if t.service.repo == nil {
			return "", false, true
		}
		items, err := t.service.repo.MenuCatalogue(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyMenuListBody(items), true, true

	case joyboyToolMenuProfitByCategory:
		// Two reads rather than one. The sold rows carry the money; the catalogue
		// carries the categories that sold nothing, and without those a quiet
		// category is simply absent from the sheet — which the model reads as a
		// category the shop does not have. That is the answer drinks kept getting.
		if t.service.repo == nil {
			return "", false, true
		}
		since := repository.BangkokNow().AddDate(0, 0, -int(analysisWindowDays))
		sold, err := t.service.repo.MenuMarginsByCategory(t.restaurantID, since)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		items, err := t.service.repo.MenuCatalogue(t.restaurantID)
		if err != nil {
			// The sold rows alone still answer "which drink earns the most"; only
			// the categories with no sales are lost, so report what there is.
			aiStage("warn", "joyboy: %s catalogue failed (%v) → reporting only the categories that sold", tool, err)
			items = nil
		}
		return joyboyMenuProfitByCategoryBody(sold, items), true, true

	case joyboyToolBestDayForPeriod:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		days, err := t.service.repo.SalesByDayForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		best := aitools.ComputeBestSalesDayAsOf(days, joyboyTodayKeyIfReached(end, now), joyboyPartialFirstKey(start))
		return t.withPeriodCoverage(joyboyBestDayForPeriodBody(label, best),
			label, start, end, !best.HasData && !best.TodayExcluded), true, true

	case joyboyToolSalesByStaff:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		staff, err := t.service.repo.SalesByStaffForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return t.withPeriodCoverage(joyboySalesByStaffBody(label, staff),
			label, start, end, len(staff) == 0), true, true

	case joyboyToolSalesByTime:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		hours, err := t.service.repo.RevenueByHourForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s hours failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		days, err := t.service.repo.SalesByDayForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s days failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		// Weekday averages rank finished days only: today at three in the
		// afternoon is not a Saturday's takings, and a rolling window's first
		// date is an evening's.
		finished, edges := aitools.FinishedDays(days, joyboyPartialFirstKey(start), joyboyTodayKeyIfReached(end, now))
		weekdays := aitools.ComputeSalesByWeekday(finished)
		return t.withPeriodCoverage(joyboySalesByTimeBody(label, hours, weekdays, edges),
			label, start, end, !weekdays.HasData && !edges.TodayDropped), true, true

	case joyboyToolBreakeven:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = joyboyRollingStart(now), now, analysisWindowLabel()
		}
		queryEnd := joyboyQueryEnd(end)
		metrics, err := t.service.repo.MenuMetricsForRange(t.restaurantID, start, queryEnd)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		var revenue, cost float64
		for _, row := range metrics {
			revenue += row.Revenue
			cost += row.Cost
		}
		var expenses float64
		var entries int64
		if t.service.actionExpenses != nil {
			from := start.Format("2006-01-02")
			until := end.AddDate(0, 0, -1).Format("2006-01-02")
			if !explicit {
				until = end.Format("2006-01-02")
			}
			if list, err := t.service.actionExpenses.List(t.restaurantID, from, until, ""); err == nil && list != nil {
				expenses, entries = list.Total, list.Entries
			} else if err != nil {
				aiStage("warn", "joyboy: %s expenses failed (%v) → sheet without expenses", tool, err)
			}
		}
		// The days the window actually covers so far: a month asked about on its
		// twelfth day is twelve days of bills, not thirty-one.
		daysInWindow := joyboyDaysCovered(AIPeriod{Start: start, End: end})
		breakeven := aitools.ComputeBreakeven(revenue, cost, expenses, entries, daysInWindow)
		return t.withPeriodCoverage(joyboyBreakevenBody(label, breakeven),
			label, start, end, !breakeven.HasSales), true, true

	case joyboyToolMenuPeriodComparison:
		if t.service.actionMenus == nil || t.service.repo == nil {
			return "", false, true
		}
		menus, err := t.service.actionMenus.ListMenuItems(t.restaurantID, true, 0)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		current, previous := t.comparisonWindows(question)
		currentRows, err := t.service.repo.MenuMetricsForRange(t.restaurantID, current.Start, joyboyQueryEnd(current.End))
		if err != nil {
			aiStage("warn", "joyboy: %s current window failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		previousRows, err := t.service.repo.MenuMetricsForRange(t.restaurantID, previous.Start, joyboyQueryEnd(previous.End))
		if err != nil {
			aiStage("warn", "joyboy: %s previous window failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		body := joyboyMenuPeriodComparisonBody(menus, current, currentRows, previous, previousRows, question, t.history)
		return body, true, true

	case joyboyToolPaymentMix:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		mix, err := t.service.repo.PaymentMix(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		coverage, err := t.service.repo.PaymentCoverage(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s coverage failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		t.offerChart(buildPaymentMixPieChart(mix))
		return joyboyPaymentMixBody(label, mix, coverage), true, true

	case joyboyToolTableUsage:
		if t.service.repo == nil {
			return "", false, true
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			start, end, label = now.AddDate(0, 0, -int(analysisWindowDays)), now, analysisWindowLabel()
		}
		usage, err := t.service.repo.TableUsage(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return t.withPeriodCoverage(joyboyTableUsageBody(label, usage),
			label, start, end, joyboyNoTableBills(usage)), true, true

	case joyboyToolShopProfile:
		if t.service.repo == nil {
			return "", false, true
		}
		restaurant, err := t.service.repo.FindRestaurant(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyShopProfileBody(restaurant), true, true
	case joyboyToolTableStatus:
		// Live state, read straight from the table service — not the 30-day
		// snapshot every other tool reads, because the answer is only true for
		// this minute.
		if t.service.tables == nil {
			return "", false, true
		}
		tables, err := t.service.tables.ListTables(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboyTableStatusBody(tables), true, true
	case AIToolSearchSystemDocs:
		// The whole manual, not a search result. Scoring the question against
		// each section was Go deciding which part of the manual someone meant,
		// and it decided wrong on a typo: "จะกดให้สิทพนักงานกดตรงไหน" missed the
		// permissions article by four hundredths of a point and came back as
		// "ไม่พบหัวข้อนี้ในคู่มือ". Reading a sentence is the model's job, and the
		// manual is small enough to hand over whole.
		handbook, err := systemDocsHandbook(detectSystemDocsLanguage(question))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return joyboySystemDocsHandbookBody(handbook), true, true
	case AIToolGetProfitSummary:
		// The snapshot behind this tool is fixed at 30 days, so "กำไรเดือนที่แล้ว"
		// came back as the rolling window's profit stated as last month's. When the
		// sentence names a period, answer that period; when it names none, report
		// unhandled so the 30-day snapshot answers as before.
		if t.service.repo == nil {
			return "", false, false
		}
		now := repository.BangkokNow()
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			// No period named: the rolling window, read here rather than from
			// the snapshot so the expense ledger for the window can ride on the
			// sheet. The snapshot path stays as the fallback when this read fails.
			start, end, label = joyboyRollingStart(now), now, analysisWindowLabel()
		}
		metrics, err := t.service.repo.MenuMetricsForRange(t.restaurantID, start, joyboyQueryEnd(end))
		if err != nil {
			aiStage("warn", "joyboy: %s for %s failed (%v) → falling back to the 30-day snapshot", tool, label, err)
			return "", false, false
		}
		// The ledger for the same window. "กำไร" without it is gross profit, and
		// the owner who asks "เหลือเท่าไหร่" is asking for what is left after the
		// bills — which only this join can answer.
		var expenses *ExpenseListResponse
		if t.service.actionExpenses != nil {
			from := start.Format("2006-01-02")
			until := end.AddDate(0, 0, -1).Format("2006-01-02")
			if !explicit {
				until = end.Format("2006-01-02")
			}
			if list, err := t.service.actionExpenses.List(t.restaurantID, from, until, ""); err == nil {
				expenses = list
			} else {
				aiStage("warn", "joyboy: %s expenses for %s failed (%v) → sheet without net", tool, label, err)
			}
		}
		return t.withPeriodCoverage(joyboyProfitForPeriodBody(label, metrics, expenses),
			label, start, end, len(metrics) == 0), true, true

	case joyboyToolMenuForPeriod:
		// The window is read the way the profit and expense tools read theirs:
		// the model says which range was meant, Go checks the dates. This tool
		// used to run the month-only word list alone, so "ในช่วง 7 วัน เมนูไหน
		// ขายดี" found no window, dropped out, and the 30-day snapshot answered.
		// A question that names no period is still not this tool's job — leave
		// it out so the model's 30-day menu tools answer instead.
		start, end, label, explicit := t.periodNamedIn(question)
		if !explicit {
			return "", false, true
		}
		period := AIPeriod{Label: label, Start: start, End: end}
		metrics, err := t.service.repo.MenuMetricsForRange(t.restaurantID, period.Start, joyboyQueryEnd(period.End))
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		return t.withPeriodCoverage(joyboyMenuForPeriodBody(period.Label, metrics),
			period.Label, period.Start, period.End, len(metrics) == 0), true, true
	case AIToolGetSalesForPeriod:
		// A whole-store sales total for a named day / month / relative month, or
		// a month-to-month / year-over-year comparison, all go through legacy's
		// dated-sales resolver (already tested) for the window, then render a
		// joyboy fact sheet rather than legacy's finished Thai answer. A named
		// year on its own ("ยอดขายปีนี้") is not covered by that resolver, so it
		// is handled here without widening extractPeriods (shared with the menu
		// and profit period flows). A question that names no period at all is
		// reported unhandled and falls through to the snapshot tool, which
		// answers about today — the right default for "ยอดขายเท่าไหร่" with no
		// window in it. (That tool can also report the last seven days, but only
		// when it is given the question, which the snapshot path does not do.)
		now := repository.BangkokNow()
		// The model reads the range, Go checks it, the month word list is the
		// fallback — see resolveSalesWindow for why the order matters.
		req, isDated := resolveSalesWindow(question, t.history, now, t.readPeriod)
		if isDated {
			if strings.TrimSpace(req.clarify) != "" {
				return req.clarify, true, true
			}
			if req.comparison && len(req.periods) >= 2 {
				// The change is "newer against older", so the fact sheet takes the
				// newer window as period_a (the subject) and the older as period_b
				// (the baseline): change_pct = (newer − older) / older, read the way
				// the owner asked it ("เดือนนี้เทียบเดือนก่อนเพิ่มขึ้นกี่%").
				newer, older := req.periods[0], req.periods[1]
				if newer.Start.Before(older.Start) {
					newer, older = older, newer
				}
				dNewer, err := t.service.repo.SalesForRange(t.restaurantID, newer.Start, joyboyQueryEnd(newer.End))
				if err != nil {
					aiStage("warn", "joyboy: %s comparison failed (%v) → leaving it out", tool, err)
					return "", false, true
				}
				dOlder, err := t.service.repo.SalesForRange(t.restaurantID, older.Start, joyboyQueryEnd(older.End))
				if err != nil {
					aiStage("warn", "joyboy: %s comparison failed (%v) → leaving it out", tool, err)
					return "", false, true
				}
				// The chart, though, reads left → right as a timeline: older bar on
				// the left, newer on the right. Drawing it in period_a-first order put
				// this month on the left and last month on the right — time running
				// backwards. The figures are the same either way; only the order the
				// eye reads them in differs from the sheet's.
				t.chart = buildSalesComparisonChart(older.Label, dOlder.Revenue, newer.Label, dNewer.Revenue)
				return joyboyWithCoverage(joyboySalesComparisonBody(newer, dNewer, older, dOlder, now), t.service.aiSalesCoverageNoteFor(t.restaurantID, older.Start)), true, true
			}
			if len(req.periods) > 0 {
				p := req.periods[0]
				d, err := t.service.repo.SalesForRange(t.restaurantID, p.Start, joyboyQueryEnd(p.End))
				if err != nil {
					aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
					return "", false, true
				}
				body := joyboySalesForPeriodBody(p, d, now)
				// A window of a few days to two months gets one row per day.
				// Without them "ขอดูยอดขายรายวันทีละวัน" read the per-day average
				// off the sheet and listed it eleven times as eleven days.
				if calendar, _, _ := joyboyPeriodDays(p, now); calendar >= 2 && calendar <= 62 {
					if perDay, dayErr := t.service.repo.SalesByDayForRange(t.restaurantID, p.Start, joyboyQueryEnd(p.End)); dayErr == nil {
						body = joyboyJoin([]string{body, joyboyDailyRows(p, perDay, now)})
					} else {
						aiStage("warn", "joyboy: %s could not read per-day rows (%v) → totals only", tool, dayErr)
					}
				}
				// A window that reaches now has bills still open in it. "วันนี้ขาย
				// ได้เท่าไหร่" at five in the afternoon answered 4,895 baht while
				// 1,122 more sat unpaid on four tables — true of the paid total, and
				// not what the owner meant. The open bills are read live and put
				// on the sheet as their own figure, never added into the total.
				if p.End.After(now) {
					if open, openErr := t.service.repo.ActiveOrders(t.restaurantID); openErr == nil {
						body = joyboyJoin([]string{body, joyboyOpenBillsNow(open)})
					} else {
						aiStage("warn", "joyboy: %s could not read open bills (%v) → paid total only", tool, openErr)
					}
				}
				return joyboyWithCoverage(body, t.service.aiSalesCoverageNoteFor(t.restaurantID, p.Start)), true, true
			}
		}
		if year, ok := joyboyYearSalesTotal(question, now); ok {
			d, err := t.service.repo.SalesForRange(t.restaurantID, year.Start, joyboyQueryEnd(year.End))
			if err != nil {
				aiStage("warn", "joyboy: %s (year) failed (%v) → leaving it out", tool, err)
				return "", false, true
			}
			return joyboyWithCoverage(joyboySalesForPeriodBody(year, d, now), t.service.aiSalesCoverageNoteFor(t.restaurantID, year.Start)), true, true
		}
		return "", false, false
	case joyboyToolSalesForecast:
		// Reuse legacy's forecast compute wholesale (weekday average × trend +
		// backtest bounds) — it already builds the chart-ready result. The chart
		// data is stashed on the tools struct for askJoyboy; the fact sheet is
		// what the model phrases from.
		// No word-list check here: the model already read the sentence and asked
		// for a forecast, and a list of sixteen phrases can only overrule it.
		resp, handled, err := t.service.buildSalesForecastAnswer(t.restaurantID)
		if err != nil {
			aiStage("warn", "joyboy: %s failed (%v) → leaving it out", tool, err)
			return "", false, true
		}
		if !handled {
			return "", false, true
		}
		if resp.Forecast == nil {
			// Not enough daily history to forecast: relay the deterministic
			// explanation, no chart.
			return resp.Answer, true, true
		}
		t.forecast = resp.Forecast
		return joyboyForecastBody(resp.Forecast), true, true
	}
	return "", false, false
}

// joyboyYearSalesTotal recognises a whole-year sales total ("ยอดขายปีนี้",
// "ยอดขายปีที่แล้ว", "ยอดขายปี 2568") — a case the month/day resolver does not
// cover. It is kept here, joyboy-local, rather than added to extractPeriods so
// the shared menu and profit period parsers keep their current tested behaviour.
// It claims a question only when it is clearly about a sales total and not about
// a menu, ingredient, or per-order average (those own their tools).
func joyboyYearSalesTotal(question string, ref time.Time) (AIPeriod, bool) {
	n := strings.ToLower(strings.TrimSpace(question))
	if datedSalesExcluded(n) || !mentionsSalesTotal(n) {
		return AIPeriod{}, false
	}
	year, ok := extractBareYear(question, ref)
	if !ok {
		return AIPeriod{}, false
	}
	loc := bangkokLocation()
	start := time.Date(year, 1, 1, 0, 0, 0, 0, loc)
	return AIPeriod{
		Label: fmt.Sprintf("ปี %d", year+543),
		Start: start,
		End:   start.AddDate(1, 0, 0),
	}, true
}

func (t *joyboyTools) Run(ctx context.Context, names []string, question string) ([]joyboy.ToolResult, error) {
	if len(names) == 0 {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	// One database read serves every tool: they all compute from the same
	// snapshot, so asking for five tools costs the same query as asking for one.
	snapshot, err := t.service.buildSnapshot(t.restaurantID)
	if err != nil {
		return nil, err
	}

	results := t.appendReadOnlyResults(make([]joyboy.ToolResult, 0, len(names)), names, snapshot, question)
	// The picture is already on its way to the screen; the model has to be told,
	// or it apologises over the top of it. Asked "ขอกราฟเทียบรายได้ 7 วันก่อนกับ
	// สัปดาห์นี้" it answered "ผมไม่สามารถสร้างกราฟให้ดูได้" with the finished bar
	// chart rendered directly underneath — the figures were right and the chart was
	// right, and the sentence above them was a lie about the system's own
	// capabilities. Nothing in the fact sheet had ever mentioned a chart.
	if note := joyboyChartNote(t.chart, t.forecast); note != "" {
		results = append(results, joyboy.ToolResult{Tool: "chart_on_screen", Label: "chart_on_screen", Body: note})
	}
	return results, nil
}

// joyboyChartNote states what the owner is already looking at. It names the
// chart's own title rather than describing the drawing: the model's job is to
// talk about the figures, not to narrate a picture the owner can see.
func joyboyChartNote(chart *AIChartData, forecast *AIForecastResult) string {
	switch {
	case chart != nil:
		title := strings.TrimSpace(chart.Title)
		if title == "" {
			title = "กราฟ"
		}
		return joyboyJoin([]string{
			"chart_on_screen=true chart_title=" + title,
			"note=ระบบวาดกราฟ \"" + title + "\" ขึ้นแสดงใต้คำตอบนี้ให้เจ้าของเห็นแล้ว " +
				"**ห้ามบอกว่าทำกราฟให้ไม่ได้ หรือให้ไปดูเอาเองในระบบ** เพราะกราฟอยู่ตรงหน้าเขาแล้ว " +
				"ให้เล่าตัวเลขที่กราฟแสดงเป็นคำพูด ไม่ต้องบรรยายว่ากราฟหน้าตายังไง และไม่ต้องบอกว่าคุณเป็นคนวาด",
		})
	case forecast != nil:
		return joyboyJoin([]string{
			"chart_on_screen=true chart_title=พยากรณ์ยอดขาย",
			"note=ระบบวาดกราฟพยากรณ์ขึ้นแสดงใต้คำตอบนี้แล้ว **ห้ามบอกว่าทำกราฟให้ไม่ได้** " +
				"ให้เล่าตัวเลขพยากรณ์เป็นคำพูด และย้ำว่าเป็นการคาดการณ์ ไม่ใช่ยอดจริง",
		})
	}
	return ""
}

// appendReadOnlyResults runs each requested tool and appends its fact sheet.
func (t *joyboyTools) appendReadOnlyResults(results []joyboy.ToolResult, names []string, snapshot AISnapshot, question string) []joyboy.ToolResult {
	for _, name := range names {
		tool := AIToolName(strings.TrimSpace(name))
		// joyboy-only tools are handled before the snapshot path.
		if body, ok, handled := t.runJoyboyExtraTool(tool, question); handled {
			if ok && strings.TrimSpace(body) != "" {
				results = append(results, joyboy.ToolResult{Tool: string(tool), Label: string(tool), Body: body})
			}
			continue
		}
		if !isSupportedReadOnlyTool(tool) {
			aiStage("warn", "joyboy: ignoring unsupported tool %q", name)
			continue
		}
		// The question goes in as well. It used to be left out, which quietly cost
		// two things: a "how many did I sell yesterday" fell back to today's figure
		// because the period tool never saw the word, and "ขอ 10 อันดับ" always
		// returned five. The tools that ignore the question are unaffected.
		result, runErr := executeReadOnlyTool(tool, snapshot, question)
		if runErr != nil {
			aiStage("warn", "joyboy: tool %s failed (%v) → leaving it out", tool, runErr)
			continue
		}
		// joyboyFactBody, not localToolAnswer: the model is given figures to
		// interpret, not legacy's finished Thai answer to reword.
		body, ok := joyboyFactBody(result)
		if !ok || strings.TrimSpace(body) == "" {
			aiStage("warn", "joyboy: %s has no fact sheet rendering → leaving it out", tool)
			continue
		}
		results = append(results, joyboy.ToolResult{
			Tool: string(tool),
			// The body is figures only, so the label carries the one piece of
			// context the figures cannot: which tool produced them.
			Label: string(tool),
			Body:  body,
		})
	}
	// Some questions are worth a picture, drawn from the same snapshot the fact
	// sheet used: a trend as a daily line, best-sellers as bars, order types as a
	// pie. The first chart-worthy tool wins, and only when no chart was already
	// set (a dated comparison owns the chart when it runs).
	// Whether a tool gets a picture is decided by the shape of its figures —
	// three or more entries to rank, a series over days, parts of a whole — and
	// never by a word in the question. Each builder returns nil below its own
	// floor, so a single figure stays a sentence.
	if t.chart == nil {
		for _, name := range names {
			var chart *AIChartData
			switch AIToolName(strings.TrimSpace(name)) {
			case AIToolGetSalesTrend, AIToolGetSalesSummary:
				chart = buildDailySalesLineChart(snapshot.SalesDays)
			case AIToolGetAverageOrderValue:
				chart = buildAOVLineChart(snapshot.SalesDays)
			case AIToolGetTopSellingMenus:
				chart = buildTopMenusBarChart(snapshot.TopMenuItems)
			case AIToolGetMenuRevenueRanking:
				chart = buildMenuRankingChart("เมนูทำเงินสูงสุด", "บาท", snapshot.TopMenusByRevenue, true)
			case AIToolGetSlowMovingMenus:
				chart = buildMenuRankingChart("เมนูขายได้น้อยที่สุด", "รายการ", snapshot.SlowMovingMenus, false)
			case AIToolGetHighestMarginMenu, AIToolGetLowestMarginMenu, AIToolGetMenuEngineering:
				chart = buildMarginPerPlateChart(snapshot.HighMarginMenus, snapshot.LowMarginMenus)
			case AIToolGetOrderTypeBreakdown:
				chart = buildOrderTypePieChart(snapshot.OrderTypeBreakdown)
			case AIToolGetPeakPeriods:
				chart = buildPeakHoursChart(snapshot.PeakHours)
			case AIToolGetLowStockIngredients:
				chart = buildStockVsMinChart(snapshot.StockRisks)
			}
			if chart != nil {
				t.chart = chart
				break
			}
		}
	}
	return results
}

// askJoyboy answers one question through joyboy and shapes the reply the way the
// frontend already expects. A failure is reported as an outage rather than
// answered around: the only text available to fall back on is the fact sheet,
// which is Go's writing, and showing it would be the template again.
func (s *AIService) askJoyboy(ctx context.Context, actor AIActorContext, request *AIAskRequest) (*AIAskResponse, error) {
	// An owner's plain-language command to change something — stock, an
	// ingredient's price, a menu going off sale — short-circuits the read/answer
	// flow into the reviewed plan boundary: the model proposes structure, Go
	// checks it against the live database, and nothing is written until the owner
	// confirms. When actions are off or the sentence is not a command, this leaves
	// the question to be answered normally below.
	//
	// Menu commands used to have their own keyword-matched entry point here. They
	// do not any more: one road, one boundary, and "ต้มยำกุ้งหมดแล้ว เอาลงก่อน"
	// works for the same reason "เอาหมูสับเข้าคลัง 2 กิโล" does.
	actionResponse := &AIAskResponse{Intent: AIIntentChat, Task: AITaskGeneralChat, Model: "joyboy"}
	tools := &joyboyTools{service: s, restaurantID: actor.RestaurantID, history: request.History}

	// Serial (default): read the command first, and only go on to answer when
	// the sentence was not one. Parallel (AI_JOYBOY_PARALLEL): start the command
	// read and the period read now, let joyboy choose its tools meanwhile, and
	// look at the drafts once the answer is back — see ai_joyboy_parallel.go.
	var draftsCh chan joyboyDraftsResult
	var pendingClarification string
	var pendingOptions []string
	if aiJoyboyParallelEnabled() {
		aiStage("flow", "joyboy: parallel preflight — command drafts and period read alongside the tool choice")
		if s.canHandleJoyboyStockCommands() {
			draftsCh = make(chan joyboyDraftsResult, 1)
			go func() {
				drafts, err := s.ExtractStockCommands(request.Question, request.History)
				draftsCh <- joyboyDraftsResult{drafts: drafts, err: err}
			}()
		}
		tools.periodReader = newJoyboyPeriodFuture(request.Question, request.History, repository.BangkokNow(), s.resolveDatedSalesWithModel).read
	} else {
		handled, clarify, options := s.maybeHandleJoyboyStockCommand(actor, request, actionResponse)
		if handled {
			return actionResponse, nil
		}
		pendingClarification, pendingOptions = clarify, options
	}

	assistant, err := joyboy.New(joyboyChat{service: s}, tools, func(format string, args ...any) {
		aiStage("flow", format, args...)
	}, joyboy.WithScope(joyboyScope{service: s}))
	if err != nil {
		return nil, err
	}

	// One read for both: the title and the shop's name sit on the same row.
	prefs := s.preferencesFor(actor.RestaurantID)
	joyboyRequest := joyboy.Request{
		Question:       request.Question,
		History:        joyboyHistory(request.History),
		Digest:         request.Digest,
		OwnerTitle:     prefs.OwnerTitle,
		RestaurantName: prefs.RestaurantName,
		Today:          joyboyTodayContext(repository.BangkokNow()),
		OnDraft:        request.OnDraft,
	}
	var answer joyboy.Answer
	if draftsCh == nil {
		answer, err = assistant.Ask(ctx, joyboyRequest)
	} else {
		// Parallel mode: joyboy works in the background while the drafts come
		// in. A sentence that turns out to be a command takes the command path
		// the moment the drafts say so, and the answer joyboy was writing is
		// cancelled — a command used to cost one call, and still does.
		type askResult struct {
			answer joyboy.Answer
			err    error
		}
		askCtx, cancelAsk := context.WithCancel(ctx)
		defer cancelAsk()
		askCh := make(chan askResult, 1)
		go func() {
			a, e := assistant.Ask(askCtx, joyboyRequest)
			askCh <- askResult{answer: a, err: e}
		}()
		result := <-draftsCh
		handled, clarify, options := s.handleJoyboyStockDrafts(actor, request, actionResponse, result.drafts, result.err)
		if handled {
			cancelAsk()
			return actionResponse, nil
		}
		pendingClarification, pendingOptions = clarify, options
		asked := <-askCh
		answer, err = asked.answer, asked.err
	}
	if err != nil {
		if errors.Is(err, joyboy.ErrUnavailable) {
			aiStage("warn", "joyboy: %v", err)
			return nil, aiProviderOutageError(errors.Unwrap(err))
		}
		return nil, err
	}

	intent := AIIntentChat
	task := AITaskGeneralChat
	if len(answer.Tools) > 0 {
		intent = AIIntentAnalysis
		task = AITaskRetrieveFact
	}
	aiStage("done", "joyboy answered with %d tool(s)", len(answer.Tools))
	// The answer itself only under AI_DEBUG: it is the owner's data, and
	// without it the log shows every decision except the one being judged.
	aiDebug("joyboy question: %s", request.Question)
	aiDebug("joyboy answer: %s", answer.Text)
	// Nothing is replaced here any more — see ai_joyboy_scope.go. A claim that a
	// change was applied is logged, because the rule against it is now one the
	// model can follow, and the log is how we find out whether it does.
	finalAnswer := joyboyScopedAnswer(answer.Text, len(answer.Tools))

	// The order half of "กะเพราเหลือเท่าไหร่ แล้วสั่งเพิ่มให้หน่อย", asked after the
	// question half has been answered properly. It goes last because it is the
	// part still waiting on the owner.
	//
	// Whether the model's own sentence survives depends on whether it had anything
	// to say. Tools ran means there was a question in the turn and its answer is
	// the reason this path was taken at all. No tools means the turn was only the
	// command, and then the model is writing about a change with no data — which
	// after it was taught to refuse impossible commands produced answers that
	// argued with themselves:
	//
	//	"ผู้ช่วยทำให้ไม่ได้ครับ ต้องไปจัดการเรื่องราคาในระบบเองครับ"
	//	"ข้าวกะเพราไก่ไข่ดาว ตั้งราคาติดลบไม่ได้ครับ อยากตั้งเป็นเท่าไหร่ครับ"
	//
	// The first sentence is wrong — setting a menu price is one of the nine things
	// the assistant does — and it is the one the owner reads first. Go knows which
	// of the two is true here, so the guess goes and the fact stays.
	if clarification := strings.TrimSpace(pendingClarification); clarification != "" {
		if len(answer.Tools) == 0 {
			finalAnswer = clarification
			aiStage("flow", "joyboy: the turn was only a command — sending the question Go could answer precisely")
		} else {
			finalAnswer = strings.TrimSpace(finalAnswer) + "\n\n" + clarification
			aiStage("flow", "joyboy: answered the question and asked about the command in the same sentence")
		}
	}
	response := &AIAskResponse{
		Answer: finalAnswer,
		Intent: intent,
		Task:   task,
		Model:  fmt.Sprintf("joyboy(%s)", strings.Join(answer.Tools, "+")),
	}
	// The model's follow-ups go out as written. The one case they are dropped
	// is when its whole answer was replaced by Go's clarifying question above:
	// they followed an answer the owner will not read.
	// A clarifying question that is a choice from a list Go knows carries the
	// choices as its chips — tapping one answers it.
	if strings.TrimSpace(pendingClarification) != "" && len(pendingOptions) > 0 {
		response.FollowUps = pendingOptions
	}
	if len(answer.Tools) > 0 || strings.TrimSpace(pendingClarification) == "" {
		response.FollowUps = answer.FollowUps
		// The page the answer explained, only if the handbook really has it:
		// a path the model made up is dropped here, not shown as a dead button.
		if path := strings.TrimSpace(answer.NavigateTo); path != "" {
			if route, ok := systemDocsRoute(path, detectSystemDocsLanguage(request.Question)); ok {
				response.Navigate = route
			} else {
				aiStage("warn", "joyboy: the writer named a page the handbook does not have (%q) → no button", path)
			}
		}
	}
	// The tools that actually produced data, named for the client.
	//
	// This used to be left empty on this path, and the chat screen derives its
	// follow-up chips from it: with no tool name it fell back to reading the
	// answer PROSE for keywords, so a peak-hours answer that happened to contain
	// "ขายดี" was offered "เมนูกำไรดีสุด / เมนูขายไม่ออก", and a chat reply with
	// the word "ยอด" in it got sales chips. The chips looked random because they
	// were derived from wording rather than from what was actually read.
	for _, name := range answer.Tools {
		if trimmed := strings.TrimSpace(name); trimmed != "" {
			response.ToolsUsed = append(response.ToolsUsed, AIToolName(trimmed))
		}
	}
	if len(response.ToolsUsed) > 0 {
		response.Tool = response.ToolsUsed[0]
	}
	// A forecast question leaves its chart-ready series on the tools struct; hand
	// it to the frontend so the ForecastChart draws under the answer.
	if tools.forecast != nil {
		response.Forecast = tools.forecast
	}
	if tools.chart != nil {
		response.Chart = tools.chart
	}
	return response, nil
}

func joyboyHistory(history []AIConversationMessage) []joyboy.Turn {
	turns := make([]joyboy.Turn, 0, len(history))
	for _, message := range history {
		turns = append(turns, joyboy.Turn{Role: message.Role, Content: message.Content, Topic: message.Topic, At: message.At})
	}
	return turns
}

// joyboyQueryEnd is the end a period query actually runs with: the period's
// own end, or this minute if the period reaches past it.
//
// "สัปดาห์นี้" ends at midnight tonight, and the demo data is written a whole
// day at a time — so at 20:21 the week's total carried three bills that close
// at 20:24, 20:41 and 21:12, and the sheet said "ยอดจนถึงตอนนี้" over a figure
// that was not. A real shop cannot close a bill in the future, so on live data
// this changes nothing; on seeded data it makes "as of now" true. The period's
// own end stays as it is — the label and the days-elapsed arithmetic read that,
// not this.
func joyboyQueryEnd(end time.Time) time.Time {
	if now := repository.BangkokNow(); end.After(now) {
		return now
	}
	return end
}

// joyboyTodayContext is the calendar the answer is written against: the date,
// and this week and last week spelled out as Monday–Sunday ranges.
//
// Given only the date, the writer worked the weeks out itself and started
// them on Sunday — "สัปดาห์ก่อน = อาทิตย์ 30 ส.ค. ถึง เสาร์ 5 ก.ย." — and the
// next question read "สัปดาห์นี้" through that wrong answer in the history and
// came back with today's takings. The shop counts weeks Monday to Sunday, the
// same rule the period reader follows; Go writes both ranges so the writer
// has nothing to compute.
func joyboyTodayContext(now time.Time) string {
	thisMonday, lastMonday := joyboyWeekStarts(now)
	day := func(t time.Time) string { return formatThaiDate(t.Format("2006-01-02")) }
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	// The rolling windows too: "7 วันก่อน คือวันไหน" once came back as the
	// last seven days, while the trend tool's "7 วันก่อนหน้า" meant the seven
	// before those — the same words naming two ranges in one chat.
	return fmt.Sprintf("%s · สัปดาห์นี้ (จันทร์–อาทิตย์) = %s ถึง %s · สัปดาห์ก่อน = %s ถึง %s · 7 วันล่าสุด (รวมวันนี้) = %s ถึง %s · 7 วันก่อนหน้านั้น = %s ถึง %s",
		thaiDateWithWeekday(now),
		day(thisMonday), day(thisMonday.AddDate(0, 0, 6)),
		day(lastMonday), day(lastMonday.AddDate(0, 0, 6)),
		day(today.AddDate(0, 0, -6)), day(today),
		day(today.AddDate(0, 0, -13)), day(today.AddDate(0, 0, -7)))
}

// joyboyWeekStarts returns the Monday of the week holding now and the Monday
// before it, at midnight in now's location.
func joyboyWeekStarts(now time.Time) (thisMonday, lastMonday time.Time) {
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	back := (int(day.Weekday()) + 6) % 7 // Monday → 0, Sunday → 6
	thisMonday = day.AddDate(0, 0, -back)
	return thisMonday, thisMonday.AddDate(0, 0, -7)
}

// thaiDateWithWeekday is "วันอาทิตย์ที่ 6 กันยายน 2569" — the form a person
// says a date in, weekday first, because "สัปดาห์ก่อน" is counted from the
// weekday.
func thaiDateWithWeekday(t time.Time) string {
	weekdays := [...]string{"อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"}
	return fmt.Sprintf("วัน%sที่ %s", weekdays[t.Weekday()], formatThaiDate(t.Format("2006-01-02")))
}
