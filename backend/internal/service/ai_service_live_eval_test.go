//go:build ai_eval

package service

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/joho/godotenv"
)

// canonicalTask folds the behaviourally-equivalent analysis sub-tasks into one
// bucket. The router legitimately labels a data question as analyze_data,
// retrieve_fact, or recommend_action interchangeably — they all map to the
// analysis intent and drive the same tool flow — so scoring them as distinct
// would penalise correct routing. Distinct branches (risky_action, out_of_scope,
// unclear, greetings, help, content) are kept exact.
func canonicalTask(t AITask) AITask {
	switch t {
	case AITaskRetrieveFact, AITaskRecommendAction:
		return AITaskAnalyzeData
	default:
		return t
	}
}

func liveAIServiceOrSkip(t *testing.T) *AIService {
	t.Helper()
	if os.Getenv("AI_EVAL_ENABLED") != "1" {
		t.Skip("set AI_EVAL_ENABLED=1 to run live provider evaluation; this consumes provider quota")
	}

	_ = godotenv.Load(filepath.Join("..", "..", ".env"))
	svc := ProvideAIService(nil)
	if len(svc.getGroqKeys()) == 0 && len(svc.getGeminiKeys()) == 0 {
		t.Skip("live provider evaluation enabled, but no configured provider is available")
	}
	return svc
}

type routingStat struct {
	name                          string
	taskTotal, taskHit            int
	toolTotal, toolHit            int
	clarifyTotal, clarifyHit      int
}

func routingAccuracy(s routingStat) float64 {
	hit := s.taskHit + s.toolHit + s.clarifyHit
	total := s.taskTotal + s.toolTotal + s.clarifyTotal
	if total == 0 {
		return 100
	}
	return float64(hit) / float64(total) * 100
}

// TestLiveProviderRoutingAccuracy runs the golden set against the real provider
// N times per question (AI_EVAL_PASSES, default 3) and reports routing accuracy
// as percentages instead of failing on the first miss. Because the LLM is
// non-deterministic, a single pass is not proof; measuring a hit-rate over
// repeats is how we track "does it pick the right tool" and guard against
// regressions as the system grows. Runs only under the ai_eval build tag.
func TestLiveProviderRoutingAccuracy(t *testing.T) {
	svc := liveAIServiceOrSkip(t)
	cases := loadGoldenCases(t)

	passes := 3
	if v := strings.TrimSpace(os.Getenv("AI_EVAL_PASSES")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			passes = n
		}
	}

	// Optional pause between provider calls to stay under free-tier rate limits.
	var delay time.Duration
	if v := strings.TrimSpace(os.Getenv("AI_EVAL_DELAY_MS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			delay = time.Duration(n) * time.Millisecond
		}
	}

	var (
		perCase                        []routingStat
		taskTotal, taskHit             int
		toolTotal, toolHit             int
		clarifyTotal, clarifyHit       int
	)

	for _, tc := range cases {
		s := routingStat{name: tc.Name}
		for i := 0; i < passes; i++ {
			if delay > 0 {
				time.Sleep(delay)
			}
			res, err := svc.classifyIntent(tc.Question, nil)
			if err != nil {
				t.Logf("classifyIntent(%q): %v", tc.Question, err)
				continue
			}
			if tc.ExpectClarify {
				// Ambiguous question: the right behaviour is low confidence so
				// the confidence gate asks the user to clarify instead of guessing.
				s.clarifyTotal++
				clarifyTotal++
				if res.Confidence < 0.65 {
					s.clarifyHit++
					clarifyHit++
				}
				continue
			}
			s.taskTotal++
			taskTotal++
			if canonicalTask(res.Task) == canonicalTask(tc.ExpectedTask) {
				s.taskHit++
				taskHit++
			}
			if tc.ExpectedTool != "" {
				s.toolTotal++
				toolTotal++
				if res.SuggestedTool == tc.ExpectedTool {
					s.toolHit++
					toolHit++
				}
			}
		}
		perCase = append(perCase, s)
	}

	pct := func(hit, total int) float64 {
		if total == 0 {
			return 100
		}
		return float64(hit) / float64(total) * 100
	}

	sort.SliceStable(perCase, func(i, j int) bool {
		return routingAccuracy(perCase[i]) < routingAccuracy(perCase[j])
	})
	t.Log("=== per-case misses (worst first) ===")
	for _, s := range perCase {
		if routingAccuracy(s) >= 100 {
			continue
		}
		t.Logf("  %4.0f%%  %-34s task %d/%d  tool %d/%d  clarify %d/%d",
			routingAccuracy(s), s.name, s.taskHit, s.taskTotal, s.toolHit, s.toolTotal, s.clarifyHit, s.clarifyTotal)
	}

	t.Logf("=== SUMMARY (passes=%d, cases=%d) ===", passes, len(cases))
	report := func(label string, hit, total int) {
		if total == 0 {
			t.Logf("%-22s n/a (no successful samples — provider errors/rate limit)", label)
			return
		}
		t.Logf("%-22s %.1f%% (%d/%d)", label, pct(hit, total), hit, total)
	}
	report("task-level accuracy:", taskHit, taskTotal)
	report("tool-level accuracy:", toolHit, toolTotal)
	report("clarify accuracy:", clarifyHit, clarifyTotal)

	// Gate each metric only when it actually collected samples, so a run wiped
	// out by rate limits reports "n/a" instead of passing vacuously.
	const threshold = 90.0
	gate := func(label string, hit, total int) {
		if total == 0 {
			t.Errorf("%s has no successful samples; cannot verify provider configuration or quota", label)
			return
		}
		if acc := pct(hit, total); acc < threshold {
			t.Errorf("%s %.1f%% below threshold %.0f%%", label, acc, threshold)
		}
	}
	gate("task-level accuracy", taskHit, taskTotal)
	gate("tool-level accuracy", toolHit, toolTotal)
	gate("clarify accuracy", clarifyHit, clarifyTotal)
}

func TestLiveConversationResponseIsDirectAndNonEmpty(t *testing.T) {
	svc := liveAIServiceOrSkip(t)
	response, err := svc.AskOperations(0, &AIAskRequest{Question: "ขอบคุณครับ ช่วยได้มากเลย"})
	if err != nil {
		t.Fatalf("AskOperations conversation flow: %v", err)
	}
	if response.Intent != AIIntentChat {
		t.Fatalf("AskOperations conversation intent = %q, want %q", response.Intent, AIIntentChat)
	}
	if strings.TrimSpace(response.Answer) == "" {
		t.Fatal("AskOperations conversation flow returned an empty answer")
	}
	if response.Model == "" || response.Model == "local-router" {
		t.Fatalf("AskOperations conversation model = %q, want a live provider model", response.Model)
	}
}
