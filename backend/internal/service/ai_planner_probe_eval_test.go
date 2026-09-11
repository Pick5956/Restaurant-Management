//go:build ai_eval

package service

// Phase 0 of the hybrid-architecture migration: measure what the structured
// planner actually costs before planning anything around it.
//
// The legacy classifier was measured at 3,212 prompt tokens per question, and
// the free Groq tier allows 8,000 tokens per minute and 200,000 per day on each
// key. If the planner is heavier than the classifier it replaces, the migration
// hits a capacity ceiling long before it hits a correctness problem — so this
// runs the real production path and reports size, latency, and the routing
// decision side by side with the legacy router.
//
// Run:
//   AI_EVAL_ENABLED=1 go test -tags ai_eval -count=1 ./internal/service/ -run TestPlannerProbe -v
//
// -count=1 keeps Go from replaying a cached result instead of calling providers.

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

var plannerProbeQuestions = probeQuestionSet()

// probeQuestionSet keeps the diagnostic run small by default: re-running the
// full set on every investigation spends provider quota for no new information.
func probeQuestionSet() []string {
	if os.Getenv("AI_PROBE_FULL") == "1" {
		return []string{
			"พรุ่งนี้ควรเตรียมวัตถุดิบอะไรเพิ่ม?",
			"วันนี้ยอดขายเท่าไหร่",
			"เมนูไหนกำไรดีที่สุด",
			"ร้านช่วงนี้เป็นยังไงบ้าง",
			"วัตถุดิบไหนใกล้หมด",
		}
	}
	return []string{"เมนูไหนกำไรดีที่สุด"}
}

// TestPlannerProbePayloadSize reports the static payload the planner sends on
// every call: the system prompt plus the JSON schema carried in response_format.
func TestPlannerProbePayloadSize(t *testing.T) {
	schema := ResolvedPlanJSONSchema()
	encodedSchema, err := json.Marshal(schema)
	if err != nil {
		t.Fatalf("encode schema: %v", err)
	}
	prompt := structuredPlannerSystemPrompt

	t.Logf("system prompt : %d chars", len(prompt))
	t.Logf("json schema   : %d chars", len(encodedSchema))
	t.Logf("รวมคงที่ต่อคำขอ: %d chars (~%d tokens โดยประมาณ)",
		len(prompt)+len(encodedSchema), (len(prompt)+len(encodedSchema))/4)
	t.Logf("เทียบ legacy classifier: 11,818 chars / 3,212 tokens (วัดจริงแล้ว)")
}

// TestPlannerProbeLive runs the production planner path on real questions and
// prints what it decided, how long it took, and which tool Go would select.
func TestPlannerProbeLive(t *testing.T) {
	svc := liveAIServiceOrSkip(t)

	planner, err := svc.runtimeStructuredPlanner()
	if err != nil {
		t.Skipf("structured planner unavailable: %v", err)
	}

	actor := AIActorContext{RestaurantID: 1, OwnerUserID: 1, Role: "owner"}
	var totalLatency time.Duration
	succeeded := 0

	// Each question spends roughly 3,400 tokens on the planner plus 3,300 on the
	// legacy classifier it is compared against. Groq allows 8,000 tokens per
	// minute per key, so a back-to-back run of five questions exhausts the
	// per-minute window and every provider answers 429 — which looks exactly like
	// a broken planner in the results. Pacing keeps the measurement about routing.
	pause := probePauseBetweenQuestions()
	for index, question := range plannerProbeQuestions {
		if index > 0 && pause > 0 {
			t.Logf("(เว้นจังหวะ %s เพื่อไม่ให้ชนเพดาน token ต่อนาที)", pause)
			time.Sleep(pause)
		}
		ctx, cancel := context.WithTimeout(context.Background(), structuredPlannerTotalTimeout)
		start := time.Now()
		result, planErr := planner.Plan(ctx, StructuredPlannerRequest{
			Question:      question,
			ReferenceTime: time.Now(),
		})
		elapsed := time.Since(start)
		cancel()

		t.Logf("──────────────────────────────────────────────")
		t.Logf("คำถาม: %s", question)
		if planErr != nil {
			t.Logf("  ❌ ล้มเหลว (%d ms): %v", elapsed.Milliseconds(), planErr)
			continue
		}
		totalLatency += elapsed
		succeeded++

		plan := result.Plan
		t.Logf("  เวลา        : %d ms", elapsed.Milliseconds())
		t.Logf("  provider    : %s (fallback=%v, attempts=%d)",
			result.Provider, result.UsedLocalFallback, len(result.Attempts))
		for i, attempt := range result.Attempts {
			status := "ล้มเหลว stage=" + string(attempt.FailureStage)
			if attempt.Succeeded {
				status = "สำเร็จ"
			}
			t.Logf("    attempt %d: %-8s %-24s %5dms in=%d out=%d rate_limits=%d → %s",
				i+1, attempt.Provider, attempt.Model, attempt.Duration.Milliseconds(),
				attempt.InputTokens, attempt.OutputTokens, attempt.RateLimits, status)
		}
		if result.FallbackReason != "" {
			t.Logf("    fallback_reason: %s", result.FallbackReason)
		}
		t.Logf("  task/domain : %s / %s", plan.Task, plan.Domain)
		t.Logf("  operation   : %s", plan.Operation)
		t.Logf("  metrics     : %v", plan.Parameters.Metrics)
		t.Logf("  tool_hint   : %q  ← LLM เสนอ", plan.ToolHint)

		// What the deterministic side would do with that plan.
		candidates := CandidateToolsForResolvedPlan(plan)
		t.Logf("  candidates  : %v  ← Go คัดจาก domain+metric", candidates)
		decision, decErr := AuthorizeResolvedPlan(plan, actor)
		if decErr != nil {
			t.Logf("  Go ตัดสิน   : ปฏิเสธ (%v)", decErr)
		} else {
			t.Logf("  Go ตัดสิน   : %s", decision.SelectedTool)
		}
		if plan.Resolution.NeedsClarification {
			t.Logf("  → ถามกลับ   : %s", plan.Resolution.ClarificationQuestion)
		}

		// The legacy router's answer to the same question, for comparison.
		legacy, legacyErr := svc.classifyIntent(question, nil)
		if legacyErr != nil {
			t.Logf("  legacy      : ล้มเหลว (%v)", legacyErr)
		} else {
			t.Logf("  legacy      : tool=%s task=%s conf=%.2f", legacy.SuggestedTool, legacy.Task, legacy.Confidence)
			if decErr == nil && decision.SelectedTool != legacy.SuggestedTool {
				t.Logf("  ⚠️  ไม่ตรงกัน: planner=%s vs legacy=%s", decision.SelectedTool, legacy.SuggestedTool)
			}
		}
	}

	if succeeded > 0 {
		t.Logf("══════════════════════════════════════════════")
		t.Logf("planner สำเร็จ %d/%d · เฉลี่ย %d ms",
			succeeded, len(plannerProbeQuestions), totalLatency.Milliseconds()/int64(succeeded))
		t.Logf("baseline ทั้ง request ปัจจุบัน (legacy): 1,281–1,839 ms")
	}
}

// probePauseBetweenQuestions spaces live probe calls so the per-minute token
// window refills between questions. Set AI_PROBE_PAUSE_SECONDS=0 to disable.
func probePauseBetweenQuestions() time.Duration {
	raw := strings.TrimSpace(os.Getenv("AI_PROBE_PAUSE_SECONDS"))
	if raw == "" {
		return 20 * time.Second
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 0 {
		return 20 * time.Second
	}
	return time.Duration(seconds) * time.Second
}
