package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"Project-M/internal/repository"
)

// refJuly is a fixed reference "now" (mid-July 2026, Bangkok) so month
// resolution is deterministic regardless of when the tests run.
func refJuly(t *testing.T) time.Time {
	t.Helper()
	return time.Date(2026, time.July, 15, 12, 0, 0, 0, bangkokLocation())
}

func TestExtractPeriodsNamedThaiMonth(t *testing.T) {
	periods := extractPeriods("ยอดขายเดือนมีนาคมเท่าไหร่", refJuly(t))
	if len(periods) != 1 {
		t.Fatalf("want 1 period, got %d: %+v", len(periods), periods)
	}
	p := periods[0]
	if p.Label != "เดือนมีนาคม 2569" {
		t.Fatalf("label = %q", p.Label)
	}
	if !p.Start.Equal(time.Date(2026, time.March, 1, 0, 0, 0, 0, bangkokLocation())) {
		t.Fatalf("start = %v", p.Start)
	}
	if !p.End.Equal(time.Date(2026, time.April, 1, 0, 0, 0, 0, bangkokLocation())) {
		t.Fatalf("end = %v", p.End)
	}
}

func TestExtractPeriodsRelativeMonths(t *testing.T) {
	this := extractPeriods("ยอดขายเดือนนี้เท่าไหร่", refJuly(t))
	if len(this) != 1 || this[0].Label != "เดือนกรกฎาคม 2569" {
		t.Fatalf("this month wrong: %+v", this)
	}
	prev := extractPeriods("เดือนก่อนขายได้เท่าไหร่", refJuly(t))
	if len(prev) != 1 || prev[0].Label != "เดือนมิถุนายน 2569" {
		t.Fatalf("last month wrong: %+v", prev)
	}
}

// A month later than the reference month means the most recent past occurrence,
// i.e. last year, because that window is the one that has data.
func TestExtractPeriodsFutureMonthRollsToLastYear(t *testing.T) {
	periods := extractPeriods("ยอดขายเดือนธันวาคม", refJuly(t))
	if len(periods) != 1 || periods[0].Label != "เดือนธันวาคม 2568" {
		t.Fatalf("december should resolve to last year: %+v", periods)
	}
}

func TestExtractPeriodsEnglishMonthWordBoundary(t *testing.T) {
	// "decrease" must NOT be read as December.
	if got := extractPeriods("should we decrease the price", refJuly(t)); len(got) != 0 {
		t.Fatalf("decrease should not match a month: %+v", got)
	}
	got := extractPeriods("how much did we sell in March", refJuly(t))
	if len(got) != 1 || got[0].Label != "เดือนมีนาคม 2569" {
		t.Fatalf("english march wrong: %+v", got)
	}
}

func TestExtractPeriodsComparisonKeepsTextOrder(t *testing.T) {
	periods := extractPeriods("เทียบยอดเดือนนี้กับเดือนก่อน", refJuly(t))
	if len(periods) != 2 {
		t.Fatalf("want 2 periods, got %d: %+v", len(periods), periods)
	}
	if periods[0].Label != "เดือนกรกฎาคม 2569" || periods[1].Label != "เดือนมิถุนายน 2569" {
		t.Fatalf("comparison order wrong: %+v", periods)
	}
}

func TestResolveDatedSalesRequestSingle(t *testing.T) {
	req, ok := resolveDatedSalesRequest("ยอดขายเดือนมีนาคมเท่าไหร่", refJuly(t))
	if !ok || req.comparison || len(req.periods) != 1 {
		t.Fatalf("single dated sales wrong: ok=%v %+v", ok, req)
	}
}

func TestResolveDatedSalesRequestComparison(t *testing.T) {
	req, ok := resolveDatedSalesRequest("เทียบยอดเดือนนี้กับเดือนก่อน", refJuly(t))
	if !ok || !req.comparison || len(req.periods) != 2 {
		t.Fatalf("comparison request wrong: ok=%v %+v", ok, req)
	}
}

// A comparison naming only one month is paired with the month before it.
func TestResolveDatedSalesRequestComparisonSinglePeriodPairsPrevious(t *testing.T) {
	req, ok := resolveDatedSalesRequest("เทียบยอดขายเดือนมีนาคมหน่อย", refJuly(t))
	if !ok || !req.comparison || len(req.periods) != 2 {
		t.Fatalf("single-period comparison wrong: ok=%v %+v", ok, req)
	}
	if req.periods[0].Label != "เดือนมีนาคม 2569" || req.periods[1].Label != "เดือนกุมภาพันธ์ 2569" {
		t.Fatalf("pairing wrong: %+v", req.periods)
	}
}

// A year written after a month name is honored rather than defaulted to the
// reference year: "กรกฎาคม 68" must resolve to 2568, not the current 2569.
func TestExtractPeriodsHonorsYearAfterMonth(t *testing.T) {
	cases := []struct {
		q    string
		want string
	}{
		{"ยอดขายเดือนกรกฎาคม 68", "เดือนกรกฎาคม 2568"},
		{"ยอดขายเดือนกรกฎาคม 2568", "เดือนกรกฎาคม 2568"},
		{"ยอดขายกรกฎาคม 69", "เดือนกรกฎาคม 2569"},
		{"sales in july 2025", "เดือนกรกฎาคม 2568"},
	}
	for _, c := range cases {
		periods := extractPeriods(c.q, refJuly(t))
		if len(periods) != 1 || periods[0].Label != c.want {
			t.Fatalf("%q => %+v, want single %q", c.q, periods, c.want)
		}
	}
}

// A bare day after a month ("2 กรกฎาคม" reversed as "กรกฎาคม 2") must not be
// swallowed as a year; the month keeps its resolved year.
func TestExtractPeriodsDoesNotReadDayAsYear(t *testing.T) {
	periods := extractPeriods("ยอดขายมีนาคม 12", refJuly(t))
	if len(periods) != 1 || periods[0].Label != "เดือนมีนาคม 2569" {
		t.Fatalf("day-after-month mistaken for year: %+v", periods)
	}
}

// The reported bug: "เทียบ...เดือนกรกฎาคม 69 กับ ปี 68" must compare the same
// month across the two years, not July 2569 against June 2569.
func TestResolveDatedSalesRequestYearOverYear(t *testing.T) {
	req, ok := resolveDatedSalesRequest("เทียบยอดขายเดือนกรกฎาคม 69 กับ ปี 68 ให้หน่อย", refJuly(t))
	if !ok || !req.comparison || len(req.periods) != 2 {
		t.Fatalf("year-over-year comparison wrong: ok=%v %+v", ok, req)
	}
	if req.periods[0].Label != "เดือนกรกฎาคม 2569" || req.periods[1].Label != "เดือนกรกฎาคม 2568" {
		t.Fatalf("year-over-year pairing wrong: %+v", req.periods)
	}
}

// "เทียบเดือนนี้กับปีที่แล้ว" compares this month against the same month a year ago.
func TestResolveDatedSalesRequestRelativeYearOverYear(t *testing.T) {
	req, ok := resolveDatedSalesRequest("เทียบยอดขายเดือนนี้กับปีที่แล้ว", refJuly(t))
	if !ok || !req.comparison || len(req.periods) != 2 {
		t.Fatalf("relative year-over-year wrong: ok=%v %+v", ok, req)
	}
	if req.periods[0].Label != "เดือนกรกฎาคม 2569" || req.periods[1].Label != "เดือนกรกฎาคม 2568" {
		t.Fatalf("relative year-over-year pairing wrong: %+v", req.periods)
	}
}

// A comparison whose second operand cannot be parsed asks for clarification
// instead of silently substituting the previous month.
func TestResolveDatedSalesRequestUnparseableSecondOperandAsksToClarify(t *testing.T) {
	req, ok := resolveDatedSalesRequest("เทียบยอดขายเดือนกรกฎาคม 69 กับ ตอนนั้น", refJuly(t))
	if !ok {
		t.Fatal("comparison with an unparseable operand should still be claimed (to clarify)")
	}
	if req.clarify == "" || len(req.periods) != 0 {
		t.Fatalf("expected a clarification, got %+v", req)
	}
}

// A store summary that names a day resolves that single day; an unscoped summary
// does not, so it keeps the rolling-window overview.
func TestSummaryDayScope(t *testing.T) {
	if _, ok := summaryDayScope("สรุปสถานการณ์ร้าน", refJuly(t)); ok {
		t.Fatal("an unscoped summary must not resolve a day")
	}
	today, ok := summaryDayScope("สรุปร้านวันนี้", refJuly(t))
	if !ok || today.Label != "วันนี้" {
		t.Fatalf("today scope wrong: ok=%v %+v", ok, today)
	}
	if today.End.Sub(today.Start) != 24*time.Hour {
		t.Fatalf("today window is not exactly one day: %v..%v", today.Start, today.End)
	}
	y, ok := summaryDayScope("สรุปเมื่อวานให้หน่อย", refJuly(t))
	if !ok || y.Label != "เมื่อวาน" {
		t.Fatalf("yesterday scope wrong: ok=%v %+v", ok, y)
	}
	named, ok := summaryDayScope("สรุปร้านวันที่ 2 กรกฎาคม", refJuly(t))
	if !ok || named.Label != "วันที่ 2 กรกฎาคม 2569" {
		t.Fatalf("named-date scope wrong: ok=%v %+v", ok, named)
	}
}

// A day that does not exist for its month must be flagged, not answered as the
// whole month ("31 กุมภาพันธ์" used to return all of February).
func TestResolveDatedSalesRequestRejectsImpossibleDate(t *testing.T) {
	for _, q := range []string{
		"ยอดขายวันที่ 31 กุมภาพันธ์",
		"ยอดขาย 31 กุมภาพันธ์",
		"ยอดขายวันที่ 31 เมษายน",
	} {
		req, ok := resolveDatedSalesRequest(q, refJuly(t))
		if !ok || req.clarify == "" || len(req.periods) != 0 {
			t.Fatalf("%q should ask to clarify an impossible date, got ok=%v %+v", q, ok, req)
		}
	}
	// A valid day must still resolve to that single day.
	req, ok := resolveDatedSalesRequest("ยอดขายวันที่ 28 กุมภาพันธ์", refJuly(t))
	if !ok || req.clarify != "" || len(req.periods) != 1 {
		t.Fatalf("valid date must resolve to one day, got ok=%v %+v", ok, req)
	}
}

func TestResolveDatedSalesRequestExcludesMenuAndAverage(t *testing.T) {
	for _, q := range []string{
		"เมนูไหนขายดีเดือนมีนาคม",
		"ลูกค้าจ่ายเฉลี่ยต่อบิลเดือนนี้",
		"วัตถุดิบอะไรใช้เยอะเดือนมีนาคม",
	} {
		if _, ok := resolveDatedSalesRequest(q, refJuly(t)); ok {
			t.Fatalf("%q should not be claimed by dated-sales flow", q)
		}
	}
}

// A named month without a sales/revenue word is left to the normal flow.
func TestResolveDatedSalesRequestRequiresSalesWordForSingle(t *testing.T) {
	if _, ok := resolveDatedSalesRequest("เดือนมีนาคมเป็นยังไงบ้าง", refJuly(t)); ok {
		t.Fatal("bare month without a sales word should not be claimed")
	}
}

func TestResolveDatedSalesRequestNoPeriod(t *testing.T) {
	if _, ok := resolveDatedSalesRequest("ยอดขายรวมเท่าไหร่", refJuly(t)); ok {
		t.Fatal("a sales question with no named period should fall through to the snapshot flow")
	}
}

func TestFormatDatedSalesAnswer(t *testing.T) {
	p := monthPeriod(2026, time.March, bangkokLocation())
	got := formatDatedSalesAnswer(p, repository.AISalesRange{Orders: 42, Revenue: 12345.5, Days: 20})
	for _, want := range []string{"เดือนมีนาคม 2569", "12,345.50 บาท", "42 ออเดอร์", "20 วัน"} {
		if !strings.Contains(got, want) {
			t.Fatalf("answer missing %q: %s", want, got)
		}
	}
	empty := formatDatedSalesAnswer(p, repository.AISalesRange{})
	if !strings.Contains(empty, "ยังไม่มีออเดอร์") {
		t.Fatalf("empty answer wrong: %s", empty)
	}
}

func TestFormatDatedSalesComparison(t *testing.T) {
	a := monthPeriod(2026, time.July, bangkokLocation())
	b := monthPeriod(2026, time.June, bangkokLocation())
	got := formatDatedSalesComparison(a,
		repository.AISalesRange{Orders: 50, Revenue: 12000},
		b,
		repository.AISalesRange{Orders: 40, Revenue: 10000},
	)
	for _, want := range []string{"เดือนกรกฎาคม 2569", "เดือนมิถุนายน 2569", "12,000.00 บาท", "10,000.00 บาท", "+20.0%", "เพิ่มขึ้น"} {
		if !strings.Contains(got, want) {
			t.Fatalf("comparison missing %q: %s", want, got)
		}
	}
	// No prior revenue -> percentage change is not claimed.
	noPrior := formatDatedSalesComparison(a,
		repository.AISalesRange{Orders: 5, Revenue: 500},
		b,
		repository.AISalesRange{},
	)
	if strings.Contains(noPrior, "%") {
		t.Fatalf("no-prior comparison must not show a percentage: %s", noPrior)
	}
}

// TestRouterTemplatesRenderCleanly guards against unescaped '%' in the classifier
// templates: they are consumed by fmt.Sprintf, so a literal '%' (e.g. "10%")
// must be written as "%%" or the rendered prompt gets fmt error markers.
func TestRouterTemplatesRenderCleanly(t *testing.T) {
	for name, tmpl := range map[string]string{
		"full": routerClassifierTemplate,
	} {
		// Two holes now: the recent conversation, then the question.
		rendered := fmt.Sprintf(tmpl, "user: ยอดขายวันไหนสูงสุด", "ปรับราคาทุกเมนูขึ้น 10%")
		if strings.Contains(rendered, "%!") {
			t.Fatalf("%s template rendered with a fmt error marker: %s", name, rendered)
		}
		if !strings.Contains(rendered, "ปรับราคาทุกเมนูขึ้น 10%") {
			t.Fatalf("%s template did not include the question", name)
		}
		// The escaped literal should survive as a single percent sign.
		if !strings.Contains(rendered, "raise all prices by 10%") {
			t.Fatalf("%s template lost its literal percent example", name)
		}
		// A follow-up can only be read against what came before, so the
		// conversation has to reach the prompt too.
		if !strings.Contains(rendered, "user: ยอดขายวันไหนสูงสุด") {
			t.Fatalf("%s template did not include the conversation", name)
		}
	}
}
