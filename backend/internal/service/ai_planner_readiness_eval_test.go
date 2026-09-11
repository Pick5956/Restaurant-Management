//go:build ai_eval

package service

// Phase 1: is the structured planner ready to answer real questions?
//
// The probe proved the planner can produce a plan. This asks the question that
// decides the migration: on the labelled golden set, does Go's deterministic
// routing from domain+metrics choose the same tool the legacy router chooses,
// and how often does the planner fail outright? Both routers run on the same
// question so the comparison is like for like, and the run is paced because a
// burst exhausts the per-minute token window and turns a routing measurement
// into a rate-limit measurement.
//
// Run:
//   AI_EVAL_ENABLED=1 AI_READINESS_CASES=20 \
//     go test -tags ai_eval -count=1 ./internal/service/ -run TestPlannerReadiness -v -timeout 3600s
//
// -count=1 is required. Without it Go serves the cached result of the previous
// run: the numbers come back byte for byte identical, down to the millisecond
// timings, without a single provider call. An evaluation that silently replays
// stale results is worse than none, because it still looks valid.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

type readinessOutcome struct {
	Question      string
	Expected      AIToolName
	ExpectClarify bool

	PlannerTool     AIToolName
	PlannerProvider StructuredPlannerProviderName
	PlannerClarify  bool
	PlannerFailed   bool
	PlannerNote     string
	PlannerMillis   int64
	PlannerInput    int
	PlannerOutput   int

	LegacyTool    AIToolName
	LegacyConf    float64
	LegacyFailed  bool
	LegacyMillis  int64
}

// A golden case with no expected tool is a question that must NOT reach one:
// greetings, out-of-scope asks, and write commands that the safety guard blocks.
// Answering those with no tool is the correct outcome, not a miss.
func (o readinessOutcome) plannerMatchesExpected() bool {
	switch {
	case o.ExpectClarify:
		return o.PlannerClarify
	case o.Expected == "":
		return !o.PlannerFailed && o.PlannerTool == ""
	default:
		return o.PlannerTool == o.Expected
	}
}

func (o readinessOutcome) legacyMatchesExpected() bool {
	switch {
	case o.ExpectClarify:
		return o.LegacyTool == "" || o.LegacyConf < 0.6
	case o.Expected == "":
		return !o.LegacyFailed && o.LegacyTool == ""
	default:
		return o.LegacyTool == o.Expected
	}
}

func readinessCaseLimit() int {
	raw := strings.TrimSpace(os.Getenv("AI_READINESS_CASES"))
	if raw == "" {
		return 20
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit <= 0 {
		return 20
	}
	return limit
}

// skipLegacyRouter leaves the legacy comparison out of a run. The legacy score
// does not move when only planner code changed, and asking for it again costs
// another 3.3k tokens per question against the same 8k-per-minute key windows,
// which halves how many questions fit in one run.
func skipLegacyRouter() bool {
	return strings.TrimSpace(os.Getenv("AI_READINESS_SKIP_LEGACY")) == "1"
}

func readinessPause() time.Duration {
	raw := strings.TrimSpace(os.Getenv("AI_READINESS_PAUSE_SECONDS"))
	if raw == "" {
		return 16 * time.Second
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 0 {
		return 16 * time.Second
	}
	return time.Duration(seconds) * time.Second
}

// selectReadinessCases spreads the sample across the golden set instead of
// taking the first N, so one tool family cannot dominate the score.
func selectReadinessCases(cases []goldenCase, limit int) []goldenCase {
	if limit >= len(cases) {
		return cases
	}
	step := float64(len(cases)) / float64(limit)
	selected := make([]goldenCase, 0, limit)
	for i := 0; i < limit; i++ {
		selected = append(selected, cases[int(float64(i)*step)])
	}
	return selected
}

func TestPlannerReadiness(t *testing.T) {
	svc := liveAIServiceOrSkip(t)
	// This run is the only place the raw provider answers exist. Recording them
	// lets TestPlannerReplayCorpus re-check the contract against them for free,
	// instead of a second paid run every time a validation rule moves.
	installPlannerCorpusRecorder(t)
	planner, err := svc.runtimeStructuredPlanner()
	if err != nil {
		t.Skipf("structured planner unavailable: %v", err)
	}

	cases := selectReadinessCases(loadGoldenCases(t), readinessCaseLimit())
	actor := AIActorContext{RestaurantID: 1, OwnerUserID: 1, Role: "owner"}
	pause := readinessPause()
	outcomes := make([]readinessOutcome, 0, len(cases))

	t.Logf("ทดสอบ %d เคส (เว้นจังหวะ %s ต่อเคส) — ประมาณ %s",
		len(cases), pause, (time.Duration(len(cases)) * (pause + 6*time.Second)).Round(time.Second))

	for index, testCase := range cases {
		if index > 0 && pause > 0 {
			time.Sleep(pause)
		}
		outcome := readinessOutcome{
			Question:      testCase.Question,
			Expected:      testCase.ExpectedTool,
			ExpectClarify: testCase.ExpectClarify,
		}

		ctx, cancel := context.WithTimeout(context.Background(), structuredPlannerTotalTimeout)
		start := time.Now()
		result, planErr := planner.Plan(ctx, StructuredPlannerRequest{
			Question:      testCase.Question,
			ReferenceTime: time.Now(),
		})
		outcome.PlannerMillis = time.Since(start).Milliseconds()
		cancel()

		// Usage is read for every result, success or not: reading it only on the
		// success path made every failure look like it never reached a model,
		// which sent an earlier investigation chasing quota instead of the real
		// validation errors.
		for _, attempt := range result.Attempts {
			outcome.PlannerInput += attempt.InputTokens
			outcome.PlannerOutput += attempt.OutputTokens
			if !attempt.Succeeded && attempt.FailureStage != "" {
				outcome.PlannerNote = strings.TrimSpace(outcome.PlannerNote + " " +
					string(attempt.Provider) + ":" + string(attempt.FailureStage))
			}
		}

		switch {
		case planErr != nil:
			outcome.PlannerFailed = true
			outcome.PlannerNote = "plan error"
		case result.UsedLocalFallback:
			outcome.PlannerFailed = true
		default:
			outcome.PlannerProvider = result.Provider
			prepared, prepErr := prepareAuthorizedPlannerResult(result, actor)
			switch {
			case prepErr != nil:
				outcome.PlannerFailed = true
				outcome.PlannerNote = prepErr.Error()
			case prepared.clarification != "" || prepared.router.Task == AITaskUnclear:
				outcome.PlannerClarify = true
			default:
				outcome.PlannerTool = prepared.router.SuggestedTool
			}
		}

		if skipLegacyRouter() {
			outcome.LegacyFailed = true
			outcomes = append(outcomes, outcome)
			t.Logf("[%2d/%d] %-46s planner=%-32s legacy=(ข้าม)",
				index+1, len(cases), truncateForLog(testCase.Question, 44), describeReadinessPlanner(outcome))
			continue
		}

		legacyStart := time.Now()
		legacy, legacyErr := svc.classifyIntent(testCase.Question, nil)
		outcome.LegacyMillis = time.Since(legacyStart).Milliseconds()
		if legacyErr != nil {
			outcome.LegacyFailed = true
		} else {
			outcome.LegacyTool = legacy.SuggestedTool
			outcome.LegacyConf = legacy.Confidence
		}

		outcomes = append(outcomes, outcome)
		t.Logf("[%2d/%d] %-46s planner=%-32s legacy=%-32s %s",
			index+1, len(cases), truncateForLog(testCase.Question, 44),
			describeReadinessPlanner(outcome), describeReadinessLegacy(outcome),
			readinessVerdict(outcome))
	}

	writeReadinessRawOutcomes(t, outcomes)
	report := buildReadinessReport(outcomes)
	t.Log("\n" + report)
	writeReadinessReport(t, report)
}

func describeReadinessPlanner(o readinessOutcome) string {
	switch {
	case o.PlannerFailed:
		return "ล้มเหลว"
	case o.PlannerClarify:
		return "ถามกลับ"
	case o.PlannerTool == "":
		return "(ไม่มี tool)"
	default:
		return string(o.PlannerTool)
	}
}

func describeReadinessLegacy(o readinessOutcome) string {
	switch {
	case o.LegacyFailed:
		return "ล้มเหลว"
	case o.LegacyTool == "":
		return fmt.Sprintf("(ไม่มี tool conf=%.2f)", o.LegacyConf)
	default:
		return string(o.LegacyTool)
	}
}

func readinessVerdict(o readinessOutcome) string {
	plannerOK := o.plannerMatchesExpected()
	legacyOK := o.legacyMatchesExpected()
	switch {
	case plannerOK && legacyOK:
		return "✓ ทั้งคู่ถูก"
	case plannerOK:
		return "★ planner ถูก legacy ผิด"
	case legacyOK:
		return "✗ planner ผิด legacy ถูก"
	default:
		return "– ผิดทั้งคู่"
	}
}

// buildReadinessReport turns the run into the numbers the migration decision
// actually rests on: does the planner route as well as the router it replaces,
// how often does it fail outright, and what does it cost in time and tokens.
func buildReadinessReport(outcomes []readinessOutcome) string {
	var b strings.Builder
	total := len(outcomes)
	if total == 0 {
		return "ไม่มีผลการทดสอบ"
	}

	var (
		plannerCorrect, legacyCorrect         int
		plannerFailed, legacyFailed           int
		plannerClarify                        int
		agree, plannerOnly, legacyOnly, both  int
		plannerMillis, legacyMillis           int64
		inputTokens, outputTokens             int
		providerCounts                        = map[StructuredPlannerProviderName]int{}
	)

	for _, o := range outcomes {
		if o.plannerMatchesExpected() {
			plannerCorrect++
		}
		if o.legacyMatchesExpected() {
			legacyCorrect++
		}
		if o.PlannerFailed {
			plannerFailed++
		}
		if o.LegacyFailed {
			legacyFailed++
		}
		if o.PlannerClarify {
			plannerClarify++
		}
		if o.PlannerTool != "" && o.PlannerTool == o.LegacyTool {
			agree++
		}
		switch {
		case o.plannerMatchesExpected() && o.legacyMatchesExpected():
			both++
		case o.plannerMatchesExpected():
			plannerOnly++
		case o.legacyMatchesExpected():
			legacyOnly++
		}
		plannerMillis += o.PlannerMillis
		legacyMillis += o.LegacyMillis
		inputTokens += o.PlannerInput
		outputTokens += o.PlannerOutput
		if o.PlannerProvider != "" {
			providerCounts[o.PlannerProvider]++
		}
	}

	percent := func(n int) float64 { return float64(n) / float64(total) * 100 }

	b.WriteString("═══════════ สรุปผลทดสอบความพร้อมของ planner ═══════════\n")
	fmt.Fprintf(&b, "เวลาทดสอบ      : %s\n", time.Now().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&b, "จำนวนเคส       : %d (จาก golden set)\n\n", total)

	fmt.Fprintf(&b, "ความถูกต้อง (เทียบกับเฉลยใน golden set)\n")
	fmt.Fprintf(&b, "  planner      : %d/%d (%.1f%%)\n", plannerCorrect, total, percent(plannerCorrect))
	if skipLegacyRouter() {
		fmt.Fprintf(&b, "  legacy       : (ไม่ได้วัดรอบนี้ — ใช้ baseline เดิม 17/20)\n\n")
	} else {
		fmt.Fprintf(&b, "  legacy       : %d/%d (%.1f%%)\n\n", legacyCorrect, total, percent(legacyCorrect))
	}

	fmt.Fprintf(&b, "เทียบรายเคส\n")
	fmt.Fprintf(&b, "  ถูกทั้งคู่        : %d\n", both)
	fmt.Fprintf(&b, "  planner ถูกคนเดียว : %d\n", plannerOnly)
	fmt.Fprintf(&b, "  legacy ถูกคนเดียว  : %d\n", legacyOnly)
	fmt.Fprintf(&b, "  ผิดทั้งคู่        : %d\n", total-both-plannerOnly-legacyOnly)
	fmt.Fprintf(&b, "  เลือก tool ตรงกัน  : %d/%d (%.1f%%)\n\n", agree, total, percent(agree))

	fmt.Fprintf(&b, "ความเสถียร\n")
	fmt.Fprintf(&b, "  planner ล้มเหลว   : %d/%d (%.1f%%)\n", plannerFailed, total, percent(plannerFailed))
	fmt.Fprintf(&b, "  planner ถามกลับ   : %d/%d (%.1f%%)\n", plannerClarify, total, percent(plannerClarify))
	fmt.Fprintf(&b, "  legacy ล้มเหลว    : %d/%d (%.1f%%)\n\n", legacyFailed, total, percent(legacyFailed))

	fmt.Fprintf(&b, "ต้นทุน\n")
	fmt.Fprintf(&b, "  planner เฉลี่ย    : %d ms/คำถาม\n", plannerMillis/int64(total))
	fmt.Fprintf(&b, "  legacy เฉลี่ย     : %d ms/คำถาม\n", legacyMillis/int64(total))
	fmt.Fprintf(&b, "  planner token     : เข้า %d / ออก %d (เฉลี่ย %d/คำถาม)\n\n",
		inputTokens, outputTokens, (inputTokens+outputTokens)/total)

	if len(providerCounts) > 0 {
		providers := make([]string, 0, len(providerCounts))
		for name := range providerCounts {
			providers = append(providers, string(name))
		}
		sort.Strings(providers)
		b.WriteString("provider ที่ตอบสำเร็จ\n")
		for _, name := range providers {
			fmt.Fprintf(&b, "  %-12s: %d\n", name, providerCounts[StructuredPlannerProviderName(name)])
		}
		b.WriteString("\n")
	}

	b.WriteString("เคสที่ planner ยังไม่ผ่าน\n")
	problems := 0
	for _, o := range outcomes {
		if o.plannerMatchesExpected() {
			continue
		}
		problems++
		expected := string(o.Expected)
		if o.ExpectClarify {
			expected = "(ควรถามกลับ)"
		}
		fmt.Fprintf(&b, "  • %s\n      ควรได้ : %s\n      ได้    : %s%s\n      legacy : %s\n",
			o.Question, expected, describeReadinessPlanner(o),
			readinessNoteSuffix(o), describeReadinessLegacy(o))
	}
	if problems == 0 {
		b.WriteString("  (ไม่มี — ผ่านทุกเคส)\n")
	}
	return b.String()
}

func readinessNoteSuffix(o readinessOutcome) string {
	if strings.TrimSpace(o.PlannerNote) == "" {
		return ""
	}
	return " — " + o.PlannerNote
}

// writeReadinessReport keeps the run next to the other local test notes, outside
// the repository, so results survive the session without entering git.
func writeReadinessReport(t *testing.T, report string) {
	t.Helper()
	directory := filepath.Join("..", "..", "..", "Agent_testing")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Logf("ไม่สามารถสร้างโฟลเดอร์เก็บผล: %v", err)
		return
	}
	path := filepath.Join(directory, "planner-readiness-"+time.Now().Format("20060102-1504")+".md")
	content := "# ผลทดสอบความพร้อมของ structured planner\n\n```\n" + report + "```\n"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Logf("บันทึกผลไม่สำเร็จ: %v", err)
		return
	}
	absolute, _ := filepath.Abs(path)
	t.Logf("บันทึกผลไว้ที่: %s", absolute)
}

// writeReadinessRawOutcomes stores what each router actually answered, so the
// scoring can be revisited without spending provider quota on a second run.
func writeReadinessRawOutcomes(t *testing.T, outcomes []readinessOutcome) {
	t.Helper()
	directory := filepath.Join("..", "..", "..", "Agent_testing")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return
	}
	encoded, err := json.MarshalIndent(outcomes, "", "  ")
	if err != nil {
		return
	}
	path := filepath.Join(directory, "planner-readiness-"+time.Now().Format("20060102-1504")+"-raw.json")
	if err := os.WriteFile(path, encoded, 0o644); err != nil {
		t.Logf("บันทึกข้อมูลดิบไม่สำเร็จ: %v", err)
	}
}
