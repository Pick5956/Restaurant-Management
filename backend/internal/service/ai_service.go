package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"Project-M/internal/repository"
)

var errRateLimit = errors.New("rate limit exceeded")

type AIService struct {
	repo                       *repository.AIRepository
	httpClient                 *http.Client
	groqKeyIndex               uint32
	geminiKeyIndex             uint32
	conversationStore          AIConversationStore
	conversationCleanupCounter uint64
	actionStore                AIActionStore
	actionMenuResolver         AIActionMenuResolver
	actionsSetting             AIActionsSettingStore
	preferences                AIPreferenceStore
	actionPlanStore            AIActionPlanStore
	actionIngredients          AIActionIngredientPort
	actionMenus                AIActionMenuPort
	actionExpenses             AIActionExpensePort
	tables                     AITablePort
	actionCleanupCounter       uint64
	// providerAdapters is nil in production and resolves lazily to Groq then
	// Gemini. Tests may inject provider-neutral fakes without making live calls.
	providerAdapters []aiProviderAdapter
	// structuredPlannerProviders are long-lived so key rotation remains fair
	// across requests. Runtime mode and provider ordering are resolved per ask.
	structuredPlannerProviders []StructuredPlannerProvider
	observability              *aiObservability
	// keyHealth parks rate-limited API keys until their window resets so the next
	// request skips them instead of spending a round trip rediscovering the 429.
	keyHealth providerKeyHealth
}

func ProvideAIService(repo *repository.AIRepository) *AIService {
	service := &AIService{
		repo: repo,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
	service.structuredPlannerProviders = []StructuredPlannerProvider{
		// The same key-health tracker the chat flows use, so a key parked after a
		// 429 in one path is skipped in the other instead of being rediscovered.
		NewGroqStructuredPlannerProvider(service.httpClient, service.getGroqKeys(), &service.keyHealth),
		NewGeminiStructuredPlannerProvider(service.httpClient, service.getGeminiKeys(), &service.keyHealth),
	}
	service.observability = newAIObservability()
	return service
}

// getAIProvider returns the configured AI provider mode.
// Valid values: "auto" | "groq" | "gemini" (default: "auto")
// getAIProvider reads the configured provider policy: one provider name, a
// comma-separated chain to try in order, or "auto" for the built-in order.
func (s *AIService) getAIProvider() string {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("AI_PROVIDER")))
	if v == "" {
		return "auto"
	}
	for _, name := range aiProviderChain(v) {
		if name != "groq" && name != "gemini" {
			return "auto"
		}
	}
	if len(aiProviderChain(v)) == 0 {
		return "auto"
	}
	return v
}

// aiProviderChain splits a policy into the provider names it names, in order,
// with duplicates dropped. "gemini,groq" is one chain: the first that answers
// wins, and the rest are the fallback.
//
// A single name stays a single name — naming one provider still means only
// that provider, so a misconfigured key is a loud failure rather than a quiet
// switch to the other one's voice and pricing.
func aiProviderChain(policy string) []string {
	parts := strings.Split(strings.ToLower(strings.TrimSpace(policy)), ",")
	names := make([]string, 0, len(parts))
	seen := make(map[string]bool, len(parts))
	for _, part := range parts {
		name := strings.TrimSpace(part)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

func ProvideAIServiceWithConversationStore(repo *repository.AIRepository, store AIConversationStore) *AIService {
	service := ProvideAIService(repo)
	service.conversationStore = store
	return service
}

func ProvideAIServiceWithStores(
	repo *repository.AIRepository,
	conversationStore AIConversationStore,
	actionStore AIActionStore,
	actionMenuResolver AIActionMenuResolver,
	actionPlanStore AIActionPlanStore,
	actionIngredients AIActionIngredientPort,
	actionMenus AIActionMenuPort,
	actionExpenses AIActionExpensePort,
	tables AITablePort,
) *AIService {
	service := ProvideAIServiceWithConversationStore(repo, conversationStore)
	service.actionStore = actionStore
	service.actionMenuResolver = actionMenuResolver
	service.actionPlanStore = actionPlanStore
	service.actionIngredients = actionIngredients
	service.actionMenus = actionMenus
	service.actionExpenses = actionExpenses
	service.tables = tables
	// The repository carries the per-restaurant owner toggle, so once it is wired
	// the owner's AI-settings choice — not the env allowlist — gates actions.
	if repo != nil {
		service.actionsSetting = repo
		service.preferences = repo
	}
	return service
}

// clarifyConfidenceFloor is the line under which the assistant hands the
// question back instead of guessing. It gates the second-chance rewrite as well,
// so the two can never drift apart and leave a question rewritten but still
// turned away, or turned away without the rewrite being tried.
const clarifyConfidenceFloor = 0.65

// isAnalyticalTask lists the labels that mean "a question about this shop's
// own numbers". Deliberately excludes unclear, out_of_scope and risky_action:
// those have gates of their own further down and must keep reaching them.
func isAnalyticalTask(task AITask) bool {
	switch task {
	case AITaskRetrieveFact, AITaskAnalyzeData, AITaskRecommendAction, AITaskRestaurantAdvice:
		return true
	default:
		return false
	}
}

// routerHistoryTurns is how much of the conversation the router is shown. Two
// exchanges is what a follow-up ever refers back to; more only adds older
// subjects for it to confuse the question with.
const routerHistoryTurns = 4

// routerHistory trims the conversation to the tail the router needs.
func routerHistory(history []AIConversationMessage) []AIConversationMessage {
	if len(history) <= routerHistoryTurns {
		return history
	}
	return history[len(history)-routerHistoryTurns:]
}

func (s *AIService) classifyIntent(question string, history []AIConversationMessage) (AIRouterResult, error) {
	provider := s.getAIProvider()
	var lastErr error
	for _, adapter := range s.orderedProviderAdapters() {
		if !adapter.Configured() {
			if provider != "auto" {
				return AIRouterResult{}, missingProviderConfigurationError(adapter.ID())
			}
			continue
		}
		result, err := adapter.Classify(question, history)
		if err == nil {
			return result, nil
		}
		lastErr = err
		aiStage("warn", "%s classifier failed: %v", adapter.DisplayName(), err)
	}

	if lastErr == nil {
		lastErr = errors.New("no AI provider is configured")
	}
	// The reason travels with the error. It used to be replaced by a generic
	// sentence here, which erased the difference between an exhausted daily
	// budget, an unreachable provider and a missing key - and the caller needs
	// exactly that difference to tell the owner what happened and when to come
	// back.
	return AIRouterResult{
		Task:                AITaskAnalyzeData,
		Confidence:          0.5,
		NeedsRestaurantData: true,
		Risk:                "low",
	}, fmt.Errorf("failed to classify via any model: %w", lastErr)
}

func parseRouterJSON(raw string) (AIRouterResult, error) {
	cleaned := strings.TrimSpace(raw)
	if strings.HasPrefix(cleaned, "```json") {
		cleaned = strings.TrimPrefix(cleaned, "```json")
		cleaned = strings.TrimSuffix(cleaned, "```")
	} else if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```")
		cleaned = strings.TrimSuffix(cleaned, "```")
	}
	cleaned = strings.TrimSpace(cleaned)
	var res AIRouterResult
	err := json.Unmarshal([]byte(cleaned), &res)
	if err != nil {
		return AIRouterResult{}, err
	}
	return enforceRouterPolicy(res)
}

func mapTaskToIntent(task AITask) AIIntent {
	switch task {
	case AITaskGeneralChat:
		return AIIntentChat
	case AITaskExplainConcept, AITaskScopeQuestion, AITaskProductHelp:
		return AIIntentCapability
	case AITaskRestaurantAdvice, AITaskRestaurantContent:
		return AIIntentChat
	case AITaskAnalyzeData, AITaskRetrieveFact, AITaskRecommendAction, "restaurant_data":
		return AIIntentAnalysis
	case AITaskRiskyAction:
		return AIIntentAnalysis
	case AITaskUnclear:
		return AIIntentUnclear
	case AITaskOutOfScope:
		return AIIntentOutOfScope
	default:
		return AIIntentUnclear
	}
}

func (s *AIService) AskOperations(restaurantID uint, req *AIAskRequest) (*AIAskResponse, error) {
	return s.askOperationsCore(restaurantID, req, nil)
}

func (s *AIService) AskOperationsForOwner(ctx context.Context, actor AIActorContext, req *AIAskRequest) (*AIAskResponse, error) {
	// Measured here, at the edge, so the stored figure is the whole wait the
	// owner saw — every model call, every retry, the database write excluded.
	startedAt := time.Now()
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return nil, errors.New("authenticated restaurant owner context is required")
	}
	if req == nil {
		return nil, errors.New("AI request is required")
	}
	s.maybeCleanupAIActionPreviews()

	request := *req
	originalQuestion := request.Question
	session, history, err := s.prepareConversationSession(actor, &request)
	if err != nil {
		return nil, err
	}
	request.History = history
	if session != nil {
		request.Digest = session.digest
	}

	if aiOrchestrationMode() == aiOrchestratorJoyboy {
		aiStage("input", "joyboy | question_length=%d history_turns=%d",
			len([]rune(request.Question)), len(history))
		response, joyboyErr := s.askJoyboy(ctx, actor, &request)
		if joyboyErr != nil {
			return nil, joyboyErr
		}
		if session == nil {
			return response, nil
		}
		response.ConversationID = session.conversation.ID
		if err := s.persistConversationTurn(actor, session, originalQuestion, response, time.Since(startedAt)); err != nil {
			return nil, fmt.Errorf("%w: persist conversation turn: %w", ErrAIConversationPersistence, err)
		}
		return response, nil
	}

	questionParts := splitSystemDocsAndLiveQuestion(originalQuestion)
	var docsResponse *AIAskResponse
	if questionParts.DocsQuestion != "" {
		var handled bool
		docsResponse, handled, err = answerSystemDocsQuestion(questionParts.DocsQuestion)
		if err != nil {
			return nil, err
		}
		if handled && questionParts.LiveQuestion == "" {
			if session == nil {
				return docsResponse, nil
			}
			docsResponse.ConversationID = session.conversation.ID
			if err := s.persistConversationTurn(actor, session, originalQuestion, docsResponse, time.Since(startedAt)); err != nil {
				return nil, fmt.Errorf("%w: persist conversation turn: %w", ErrAIConversationPersistence, err)
			}
			return docsResponse, nil
		}
		if !handled {
			docsResponse = nil
		}
	}
	if questionParts.Mixed {
		request.Question = questionParts.LiveQuestion
	}

	prepared, err := s.prepareOwnerOrchestration(ctx, actor, &request)
	if err != nil {
		return nil, err
	}
	response, err := s.askOperationsCore(actor.RestaurantID, &request, prepared)
	if err != nil {
		return nil, err
	}
	conversationID := ""
	if session != nil && session.conversation != nil {
		conversationID = session.conversation.ID
	}
	if err := s.maybeCreateAIActionPreview(actor, conversationID, response); err != nil {
		return nil, err
	}
	response = combineLiveAndSystemDocsResponse(response, docsResponse)
	if session == nil {
		return response, nil
	}
	response.ConversationID = session.conversation.ID
	if err := s.persistConversationTurn(actor, session, originalQuestion, response, time.Since(startedAt)); err != nil {
		return nil, fmt.Errorf("%w: persist conversation turn: %w", ErrAIConversationPersistence, err)
	}
	return response, nil
}

func (s *AIService) askOperationsCore(restaurantID uint, req *AIAskRequest, prepared *aiPreparedOrchestration) (resp *AIAskResponse, err error) {
	question := strings.TrimSpace(req.Question)
	if question == "" {
		return nil, errors.New("question is required")
	}
	if len([]rune(question)) > 800 {
		return nil, errors.New("question is too long")
	}
	history := sanitizeConversationHistory(req.History)

	aiStage("input", "question_length=%d history_turns=%d", len([]rune(question)), len(history))
	aiDebug("Q: %q (history_turns=%d)", question, len(history))
	// Log how the request was ultimately answered, whichever branch returns.
	defer func() {
		if err == nil {
			if policyErr := validatePreparedResponseTool(resp, prepared); policyErr != nil {
				resp = nil
				err = policyErr
			}
		}
		attachPreparedOrchestration(resp, prepared)
		switch {
		case err != nil:
			aiStage("done", "error: %v", err)
		case resp != nil:
			aiStage("done", "model=%s task=%s tool=%s intent=%s", resp.Model, resp.Task, aiToolOrDash(resp.Tool), resp.Intent)
			aiDebug("A: %q", resp.Answer)
		}
	}()

	// Local intent guards remain disabled: the AI Router handles classification,
	// while backend policy validates its proposed task and tool.
	var intent AIIntent

	// Step 1.5: Context resolution. A follow-up fragment ("แล้วอันที่สองล่ะ",
	// "ทำไม") is rewritten into a self-contained question using history, so the
	// assistant continues the conversation. Only references are resolved — every
	// figure is still looked up fresh downstream, never taken from history.
	// askedQuestion keeps the user's own wording; a rewrite can drop details the
	// structured path still needs (an ordinal such as "รองลงมา").
	askedQuestion := question
	var routerResult AIRouterResult
	usedHistory := false
	rewroteFromHistory := false
	if prepared != nil {
		question = prepared.plan.ResolvedQuestion
		routerResult = prepared.router
		aiStage("route", "structured planner task=%s tool=%s conf=%.2f risk=%s candidates=%d",
			routerResult.Task, aiToolOrDash(routerResult.SuggestedTool), routerResult.Confidence,
			routerResult.Risk, len(prepared.candidateTools))
	} else {
		// A bare "กับ <period>" reply to a comparison clarification is rebuilt
		// deterministically from history before falling back to the LLM rewrite.
		if resolved, ok := resolveComparisonContinuation(question, history, repository.BangkokNow()); ok {
			aiStage("route", "comparison continuation resolved from history")
			aiDebug("continuation → %q", resolved)
			question = resolved
			usedHistory = true
		} else if resolved, rewritten := s.resolveContextualQuestion(question, history); rewritten {
			aiStage("route", "context_rewritten=true resolved_question_length=%d", len([]rune(resolved)))
			question = resolved
			usedHistory = true
		}

		// Legacy mode: context rewrite and JSON router remain available as an
		// immediate rollback path while the structured planner is evaluated.
		routerResult, err = s.classifyIntent(question, history)
		if err != nil {
			// The classifier is the one step nothing downstream can replace: without it
			// there is no reading of the question at all, only a keyword guess. Carrying
			// on used to hide an outage behind an answer that looked ordinary, so the
			// owner could not tell a full answer from a fallback one. Say what happened
			// instead.
			aiStage("warn", "classifier unavailable (%v) → telling the owner instead of guessing", err)
			return nil, aiProviderOutageError(err)
		} else {
			aiStage("route", "task=%s tool=%s conf=%.2f risk=%s needs_data=%v",
				routerResult.Task, aiToolOrDash(routerResult.SuggestedTool), routerResult.Confidence, routerResult.Risk, routerResult.NeedsRestaurantData)
		}
	}

	// Keyword backstop: if the classifier failed to hand back a usable, confident
	// tool, rescue an unambiguous question with a deterministic keyword route so it
	// never dead-ends at "please rephrase" and routes the same way on every
	// provider. Never overrides a confident classification or a risky/out-of-scope
	// decision (see backstopShouldApply).
	if rescued, ok := applyKeywordBackstop(routerResult, question); ok {
		aiStage("route", "keyword backstop → %s (classifier gave weak result)", aiToolOrDash(rescued.SuggestedTool))
		routerResult = rescued
	}

	// Product help is always grounded in the embedded public documentation.
	// The router/planner classification is enough to invoke retrieval here even
	// when the fast local docs detector did not recognize the wording.
	if routerResult.Task == AITaskProductHelp {
		docsResponse, _, docsErr := answerKnownSystemDocsQuestion(question)
		if docsErr != nil {
			return nil, docsErr
		}
		return docsResponse, nil
	}

	// A rank follow-up ("อันดับรองลงมา") reads as vague to the router, but the
	// previous turn pins down exactly what is being ranked, so it is answerable.
	structuredFollowUp := prepared == nil && hasStructuredRankFollowUp(question, askedQuestion, history)
	if structuredFollowUp {
		aiStage("route", "structured rank follow-up detected → skipping clarify/scope gates")
	}
	// "ข้อมูลมีถึงวันไหน" is answerable straight from the database, so it must not be
	// turned away by the clarify gate.
	if prepared == nil && looksLikeDataCoverageQuestion(question) {
		aiStage("route", "data-coverage question detected → skipping clarify/scope gates")
		structuredFollowUp = true
	}

	// Deterministic ambiguity gate — runs before the confidence gate because the
	// LLM is overconfident on vague questions and the keyword backstop may have
	// already bumped confidence above the threshold. A few clearly-ambiguous shapes
	// ask back with the likely meanings instead of guessing one (the confidence
	// gate alone almost never fires for these — measured clarify rate ~0%).
	if !structuredFollowUp {
		clarifyMsg, ok := detectAmbiguousQuestion(askedQuestion)
		if !ok {
			// A referential fragment ("อันดับล่ะ") with no history to resolve it.
			clarifyMsg, ok = detectDanglingFragment(askedQuestion, history)
		}
		if ok {
			aiStage("flow", "deterministic ambiguity → clarify")
			return &AIAskResponse{
				Answer:   clarifyMsg,
				Intent:   AIIntentUnclear,
				Task:     AITaskUnclear,
				Model:    "local-ambiguity-clarify",
				Snapshot: AISnapshot{},
			}, nil
		}
	}

	// Second chance before giving up. The classifier only ever sees the question,
	// so a follow-up whose wording the keyword detector did not recognise arrives
	// here looking vague rather than referential — which is how "ขอวิธีทำสามรายการ
	// นี้หน่อย" was answered with "please rephrase" while the three items sat in
	// the previous turn. That word list can never be finished, so the trigger is
	// the classifier's own uncertainty instead: rewrite against history and ask
	// once more. It costs one extra call, and only on questions that were about to
	// be turned away.
	if prepared == nil && !usedHistory && !structuredFollowUp && len(history) > 0 &&
		(routerResult.Confidence < clarifyConfidenceFloor || routerResult.Task == AITaskUnclear) {
		if resolved, rewritten := s.rewriteQuestionWithHistory(question, history); rewritten {
			aiStage("route", "classifier unsure (conf=%.2f) → rewrote from history, asking again", routerResult.Confidence)
			aiDebug("second chance → %q", resolved)
			question = resolved
			usedHistory = true
			rewroteFromHistory = true
			// Already rewritten to stand on its own, so the history that produced
			// it would only repeat itself to the router.
			if retried, retryErr := s.classifyIntent(question, nil); retryErr != nil {
				aiStage("warn", "second-chance classify failed (%v) → keeping the first result", retryErr)
			} else {
				routerResult = retried
				if rescued, ok := applyKeywordBackstop(routerResult, question); ok {
					routerResult = rescued
				}
				aiStage("route", "second chance task=%s tool=%s conf=%.2f",
					routerResult.Task, aiToolOrDash(routerResult.SuggestedTool), routerResult.Confidence)
			}
		}
	}

	// The classifier answers 0.40 for two situations that need opposite
	// treatment: it did not understand the question, and it understood the
	// question perfectly but no tool can serve it. "If I sell 20% more, what do I
	// earn" is the second - a clear question with no tool behind it, because
	// every tool reads what already happened. Handing it back with a menu of
	// unrelated suggestions reads as "I did not understand you", which is false
	// and is what the owner sees.
	//
	// Once the rewrite has resolved the question against history, the first
	// situation is ruled out: we know what is being asked. So an analytical
	// question goes on to the free-form path, where the model answers from the
	// snapshot instead of being turned away.
	answeredFromContext := rewroteFromHistory && isAnalyticalTask(routerResult.Task)
	if answeredFromContext {
		aiStage("route", "resolved from history but no tool fits → answering free-form instead of asking back")
	}

	// Step 3: Check Confidence Level and Unclear Input
	if (routerResult.Confidence < clarifyConfidenceFloor || routerResult.Task == AITaskUnclear) &&
		!structuredFollowUp && !answeredFromContext {
		aiStage("flow", "clarify — unclear/low confidence (conf=%.2f) → ask user to specify", routerResult.Confidence)
		clarification := "ผมอยากช่วยให้ตรงที่สุดครับ รบกวนระบุให้ชัดขึ้นอีกนิดได้ไหมครับ เช่น หมายถึงเมนูขายดี เมนูกำไรดี ยอดขายรวม หรือเช็กสต๊อกวัตถุดิบครับ"
		model := "local-router-fallback"
		if prepared != nil {
			model = "local-planner-clarification"
			if strings.TrimSpace(prepared.clarification) != "" {
				clarification = prepared.clarification
			} else if strings.TrimSpace(prepared.plan.Resolution.ClarificationQuestion) != "" {
				clarification = prepared.plan.Resolution.ClarificationQuestion
			}
		}
		return &AIAskResponse{
			Answer:   clarification,
			Intent:   AIIntentUnclear,
			Task:     AITaskUnclear,
			Model:    model,
			Snapshot: AISnapshot{},
		}, nil
	}

	// Step 4: Block Risky Operations (Readiness & Safety Policy Guard)
	if routerResult.Task == AITaskRiskyAction || routerResult.Risk == "high" || routerResult.Risk == "medium" {
		aiStage("flow", "blocked — safety guard (task=%s risk=%s)", routerResult.Task, routerResult.Risk)
		return &AIAskResponse{
			Answer:   "ระบบความปลอดภัยไม่อนุญาตให้แก้ไขข้อมูลร้าน ลบข้อมูล หรือสั่งซื้อสินค้าโดยตรงผ่านแชทเพื่อป้องกันความผิดพลาดครับ รบกวนดำเนินการด้วยตนเองในหน้าเมนูจัดการที่เกี่ยวข้องนะครับ",
			Intent:   AIIntentAnalysis,
			Task:     AITaskRiskyAction,
			Model:    "local-safety-guard",
			Snapshot: AISnapshot{},
		}, nil
	}

	// The Router selects this known concept flow; backend supplies an exact,
	// stable definition instead of allowing a provider to redefine Margin.
	if routerResult.Task == AITaskExplainConcept && requestsMarginConceptExplanation(question) {
		aiStage("flow", "concept — margin definition (local policy)")
		answer, _ := localConceptAnswer(AITaskRoute{Task: AITaskExplainConcept})
		return &AIAskResponse{
			Answer:   answer,
			Intent:   AIIntentCapability,
			Task:     AITaskExplainConcept,
			Model:    "local-concept-policy",
			Snapshot: AISnapshot{},
		}, nil
	}

	// Block Out-of-Scope Requests (Focus Guard Policy - Dynamic AI Refusal)
	if routerResult.Task == AITaskOutOfScope && !structuredFollowUp {
		aiStage("flow", "out-of-scope — dynamic refusal")
		answer, model, err := s.askOutOfScopeWithRotation(question, history)
		if err == nil {
			return &AIAskResponse{
				Answer:   answer,
				Intent:   AIIntentOutOfScope,
				Task:     AITaskOutOfScope,
				Model:    model,
				Snapshot: AISnapshot{},
			}, nil
		}
		aiStage("warn", "out-of-scope dynamic refusal failed (%v) → static message", err)
		return &AIAskResponse{
			Answer:   "เรื่องนี้อยู่นอกขอบเขตที่ผมดูแลในฐานะผู้ช่วยร้านอาหาร แต่ช่วยได้เรื่องยอดขาย คลังวัตถุดิบ กำไรเมนู หรือแคปชั่นโปรโมทร้านครับ",
			Intent:   AIIntentOutOfScope,
			Task:     AITaskOutOfScope,
			Model:    "local-focus-guard-fallback",
			Snapshot: AISnapshot{},
		}, nil
	}

	intent = mapTaskToIntent(routerResult.Task)
	needsData := routerResult.NeedsRestaurantData || intent == AIIntentAnalysis
	if structuredFollowUp || answeredFromContext {
		// A read-only question about this shop, whatever label the router put on it.
		intent = AIIntentAnalysis
		needsData = true
	}

	// Step 5: Conversational Flow (Needs Data = False, 0 DB load)
	if !needsData {
		// Open-ended strategy asks ("จะเพิ่มกำไรยังไง", "ควรทำโปรโมชั่นอะไร") are
		// classified as advice with needs_data=false, so they would get generic
		// textbook answers from the conversational LLM. Ground them in real data: build
		// the snapshot and answer from the deterministic insights + snapshot levers, so
		// the advice names this shop's actual menus and figures instead of a stock list.
		if isAdvisoryStrategyQuestion(question) {
			if adviceSnapshot, snapErr := s.buildSnapshot(restaurantID); snapErr != nil {
				aiStage("warn", "strategy advice snapshot failed (%v) → conversational LLM", snapErr)
			} else if adviceResp, handled := s.answerStrategyAdvice(question, adviceSnapshot); handled {
				aiStage("flow", "strategy advice (conversational branch) → grounded in deterministic insights")
				return adviceResp, nil
			}
		}

		aiStage("flow", "conversational — no snapshot (task=%s)", routerResult.Task)
		request := aiProviderAnswerRequest{
			Question: question,
			History:  history,
			Mode:     aiProviderAnswerConversation,
		}
		var lastProviderErr error
		for _, adapter := range s.orderedProviderAdapters() {
			if !adapter.Configured() {
				continue
			}
			answer, adapterErr := adapter.Answer(request)
			if adapterErr != nil {
				lastProviderErr = adapterErr
			}
			if adapterErr == nil {
				return &AIAskResponse{
					Answer:   answer.Text,
					Intent:   intent,
					Task:     routerResult.Task,
					Model:    answer.Model,
					Snapshot: AISnapshot{},
				}, nil
			}
			aiStage("warn", "conversational %s failed: %v", adapter.DisplayName(), adapterErr)
		}

		return nil, aiProviderOutageError(lastProviderErr)
	}

	// Step 6: Analytical Flow (Needs Data = True, DB snapshot load)
	//
	// These deterministic intercepts run from the most specific scope to the least,
	// because a broader one would otherwise swallow a narrower question: asking for
	// lunch on one day must not be answered with the whole month's total.

	// Sales forecast ("ทำนายยอดขายสัปดาห์หน้า") — the one place the assistant predicts
	// the future. The number comes from a fixed formula (not the LLM), is bounded by
	// an error measured on this shop's own history, and is always framed as a guess.
	if fcResp, handled, fErr := s.answerSalesForecast(restaurantID, question); handled {
		aiStage("flow", "sales forecast — seasonal moving average + backtest")
		return s.narrateLocalAnswer(question, fcResp), nil
	} else if fErr != nil {
		aiStage("warn", "sales forecast failed (%v) → snapshot flow", fErr)
	}

	// Two-entity comparisons ("เทียบวันจันทร์กับวันเสาร์", "ต้มยำกุ้งกับชาไทยอันไหน
	// ขายดีกว่า"). They name two things of the same kind and want a verdict, which no
	// single-metric tool can give, so they run before those tools.
	if cmpResp, handled, cErr := s.answerWeekdayComparison(restaurantID, question); handled {
		aiStage("flow", "weekday comparison — per-weekday range query")
		return s.narrateLocalAnswer(question, cmpResp), nil
	} else if cErr != nil {
		aiStage("warn", "weekday comparison failed (%v) → snapshot flow", cErr)
	}
	if cmpResp, handled, cErr := s.answerMenuComparison(restaurantID, question); handled {
		aiStage("flow", "menu comparison — per-menu range query")
		return s.narrateLocalAnswer(question, cmpResp), nil
	} else if cErr != nil {
		aiStage("warn", "menu comparison failed (%v) → snapshot flow", cErr)
	}

	// Sales for a service period ("ช่วงเที่ยงวันที่ 2 กรกฎาคม") — an hour window
	// within a day, finer than anything the day-level snapshot holds.
	if partResp, handled, pErr := s.answerDayPartSalesQuery(restaurantID, question); handled {
		aiStage("flow", "day-part sales query — hour-scoped range query")
		return s.narrateLocalAnswer(question, partResp), nil
	} else if pErr != nil {
		aiStage("warn", "day-part sales query failed (%v) → snapshot flow", pErr)
	}

	// Store-wide profit ("กำไรรวมเดือนนี้เท่าไหร่") is revenue − cost, a different
	// figure from the sales total below. It runs first so a "กำไร…เดือนนี้" question
	// is not siphoned off as a plain sales question.
	if profitResp, handled, prErr := s.answerTotalProfitQuery(restaurantID, question); handled {
		aiStage("flow", "total-profit query — range-scoped revenue minus cost")
		return s.narrateLocalAnswer(question, profitResp), nil
	} else if prErr != nil {
		aiStage("warn", "total-profit query failed (%v) → snapshot flow", prErr)
	}

	// Store-wide dish count ("ขายได้กี่จานทั้งหมด") is a units question, distinct
	// from the baht totals below.
	if qtyResp, handled, qErr := s.answerTotalQuantityQuery(restaurantID, question); handled {
		aiStage("flow", "total-quantity query — units sold across the period")
		return s.narrateLocalAnswer(question, qtyResp), nil
	} else if qErr != nil {
		aiStage("warn", "total-quantity query failed (%v) → snapshot flow", qErr)
	}

	// Tier 1-1: a dated total-sales question (a specific day, a named month, or a
	// month-to-month comparison) is answered directly from range queries, so it is
	// not limited to the rolling snapshot window.
	if datedResp, handled, derr := s.answerDatedSalesQuery(restaurantID, question); handled {
		aiStage("flow", "dated-sales — range query (bypassing rolling window)")
		return s.narrateLocalAnswer(question, datedResp), nil
	} else if derr != nil {
		aiStage("warn", "dated-sales failed (%v) → snapshot flow", derr)
	}

	// "How far does the data reach?" — answered from the full history, not the
	// rolling window, so it works even when today has no sales.
	if covResp, handled, cErr := s.answerDataCoverage(restaurantID, question); handled {
		aiStage("flow", "data-coverage query")
		return s.narrateLocalAnswer(question, covResp), nil
	} else if cErr != nil {
		aiStage("warn", "data-coverage query failed (%v) → snapshot flow", cErr)
	}

	// A menu question that names a calendar period is answered from that period's
	// own numbers, instead of the rolling analysis window.
	if menuResp, handled, mErr := s.answerPeriodMenuQuery(restaurantID, question, askedQuestion); handled {
		aiStage("flow", "menu-period query — range query (bypassing rolling window)")
		return s.narrateLocalAnswer(question, menuResp), nil
	} else if mErr != nil {
		aiStage("warn", "menu-period query failed (%v) → snapshot flow", mErr)
	}

	aiStage("flow", "analytical — building %s snapshot", analysisWindowLabel())
	snapshot, err := s.buildSnapshot(restaurantID)
	if err != nil {
		return nil, err
	}

	// A two-part question ("ยอดขายเท่าไหร่ แล้วเมนูไหนขายดีสุด") would otherwise be
	// answered for the first concern only. Split it and answer each half from the
	// deterministic paths — but only when BOTH halves resolve, so it never emits a
	// confident half-guess. Runs first so the single-tool path below does not claim
	// the question for its first concern.
	if compoundResp, handled := s.answerCompoundQuestion(restaurantID, question, snapshot); handled {
		aiStage("flow", "compound question → answered both parts deterministically")
		return compoundResp, nil
	}

	// A reorder-forecast question is answered from the deterministic tool no
	// matter how the router classified it: "ควร" makes it look like a
	// recommendation, so it otherwise falls to a free-form answer that can leak
	// raw snapshot field names.
	if isReorderForecastQuestion(question) {
		if result, rErr := executeReadOnlyTool(AIToolGetIngredientReorderForecast, snapshot, question); rErr == nil {
			if answer, ok := localToolAnswer(result); ok {
				aiStage("flow", "reorder-forecast question → deterministic tool")
				return &AIAskResponse{
					Answer:   answer,
					Intent:   intent,
					Task:     AITaskRetrieveFact,
					Tool:     AIToolGetIngredientReorderForecast,
					Model:    "local-tool-first",
					Snapshot: snapshot,
				}, nil
			}
		}
	}

	// A reprice question ("เมนูไหนน่าปรับราคา") reads as a revenue ranking to the
	// router, but the useful answer is the thin-margin menu whose price or cost most
	// needs attention — so it is answered from the lowest-margin tool regardless.
	if isRepriceQuestion(question) {
		if result, rErr := executeReadOnlyTool(AIToolGetLowestMarginMenu, snapshot, question); rErr == nil {
			if answer, ok := localToolAnswer(result); ok {
				aiStage("flow", "reprice question → lowest-margin menu (price/cost candidate)")
				return &AIAskResponse{
					Answer:   answer,
					Intent:   intent,
					Task:     AITaskRecommendAction,
					Tool:     AIToolGetLowestMarginMenu,
					Model:    "local-tool-first",
					Snapshot: snapshot,
				}, nil
			}
		}
	}

	// "ควรเพิ่มเมนูอะไร" has no data-backed answer (the shop has no info on menus it
	// does not sell), so give an honest, grounded suggestion instead of the current
	// best-sellers dressed up as the answer.
	if isAddMenuQuestion(question) {
		if answer, ok := s.answerAddMenuAdvice(snapshot); ok {
			aiStage("flow", "add-menu question → honest grounded suggestion")
			return &AIAskResponse{
				Answer:   answer,
				Intent:   AIIntentAnalysis,
				Task:     AITaskRecommendAction,
				Model:    "local-add-menu-advice",
				Snapshot: snapshot,
			}, nil
		}
	}

	if answer, guarded := localAnalyticalGuardrailAnswer(question, snapshot); guarded {
		aiStage("flow", "readiness guardrail (local) — data not ready for a business decision")
		return &AIAskResponse{
			Answer:   answer,
			Intent:   intent,
			Task:     routerResult.Task,
			Model:    "local-readiness-guardrail",
			Snapshot: snapshot,
		}, nil
	}

	toolToRun := routerResult.SuggestedTool

	// Structured query (intent-schema): handles ranks the one-tool-per-question
	// flow cannot express — "แพงรองลงมา", "กำไรดีอันดับสอง". Those used to fall back
	// to the #1 item, which reads as a wrong answer. It deliberately claims only
	// rank >= 2, so every existing rank-1 answer below is untouched.
	if answer, structuredTool, handled := structuredQueryAnswer(question, askedQuestion, history, snapshot); handled {
		aiStage("flow", "structured-query (rank>1) → %s", aiToolOrDash(structuredTool))
		return &AIAskResponse{
			Answer: answer,
			Intent: intent,
			// A ranking lookup is a fact retrieval, whatever the router called it.
			Task:     AITaskRetrieveFact,
			Tool:     structuredTool,
			Model:    "local-structured-query",
			Snapshot: snapshot,
		}, nil
	}

	// A store summary scoped to a specific day ("สรุปวันนี้") answers that day's
	// real sales first, then the rolling-window overview — so the day the user
	// named is not silently folded into the window figure.
	if toolToRun == AIToolGetStoreSummary {
		if resp, handled, err := s.answerDatedStoreSummary(restaurantID, question, snapshot, intent); err != nil {
			return nil, err
		} else if handled {
			aiStage("flow", "store-summary scoped to a specific day → leading with that day's sales")
			return resp, nil
		}
	}

	// A compound question spans a concern the chosen single-metric tool cannot
	// express ("ขายดีและกระทบสต็อก"). Skip the deterministic shortcut and let it
	// reach the snapshot-wide LLM path, which can weigh both dimensions.
	compoundQuestion := routerResult.Task == AITaskRetrieveFact &&
		isSupportedReadOnlyTool(toolToRun) &&
		questionSpansUncoveredConcern(question, toolToRun)
	if compoundQuestion {
		aiStage("flow", "compound question → %s covers one concern only, using LLM synthesis", toolToRun)
	}

	// Deterministic-first: a fact lookup — OR a recommendation that maps to a clear
	// tool (e.g. "ควรเอาเมนูไหนออก" → slow movers) — is answered straight from the
	// snapshot data, skipping the free-form LLM. The LLM already did its real job
	// (understanding the question) in the router; letting it also re-read the numbers
	// only risks hallucinated figures, an irrelevant caveat, or a different phrasing
	// each time. Recommendations without a clear tool still fall through to the LLM
	// below, so genuine advice questions keep their judgement.
	if (routerResult.Task == AITaskRetrieveFact || routerResult.Task == AITaskRecommendAction) &&
		isSupportedReadOnlyTool(toolToRun) && !compoundQuestion {
		result, toolErr := executeReadOnlyTool(toolToRun, snapshot, question)
		if toolErr != nil {
			aiStage("warn", "deterministic-first tool %s failed (%v) → LLM flow", toolToRun, toolErr)
		} else if answer, ok := localToolAnswer(result); ok {
			aiStage("flow", "deterministic-first: %s (numbers computed locally)", toolToRun)
			// The figures are already final; the LLM only writes a lead-in and is
			// dropped if it touches a number it was not given.
			answer = s.narrateDeterministicAnswer(question, answer, computeProactiveInsights(snapshot))
			hinted, assumed := appendScopeHint(question, answer, todayHasNoSales(snapshot))
			return &AIAskResponse{
				Answer:       hinted,
				ScopeAssumed: assumed,
				Intent:       intent,
				Task:         routerResult.Task,
				Tool:         toolToRun,
				Model:        "local-tool-first",
				Snapshot:     snapshot,
			}, nil
		}
	}

	// Open-ended strategy asks ("จะเพิ่มกำไรยังไง", "ควรโฟกัสอะไร") have no single
	// tool and would otherwise get generic textbook advice from the LLM. Ground them
	// in the deterministic insights + snapshot levers instead, so the advice names
	// this shop's real menus and numbers. Runs last, so any specific tool above still
	// wins; only the truly open-ended asks reach here.
	if adviceResp, handled := s.answerStrategyAdvice(question, snapshot); handled {
		aiStage("flow", "strategy advice → grounded in deterministic insights")
		return adviceResp, nil
	}

	// executeAnalytical runs one provider adapter and handles CALL_TOOL responses.
	executeAnalytical := func(adapter aiProviderAdapter) (*AIAskResponse, error) {
		providerName := adapter.DisplayName()
		providerAnswer, err := adapter.Answer(aiProviderAnswerRequest{
			Question:       question,
			History:        history,
			Snapshot:       &snapshot,
			Mode:           aiProviderAnswerAnalytical,
			CandidateTools: candidateToolsForProvider(prepared),
		})
		if err != nil {
			aiStage("warn", "analytical %s failed: %v", providerName, err)
			return nil, err
		}
		answer := providerAnswer.Text
		if strings.HasPrefix(answer, "CALL_TOOL:") {
			toolName := AIToolName(strings.TrimPrefix(answer, "CALL_TOOL:"))
			if prepared != nil && !containsAITool(prepared.candidateTools, toolName) {
				return nil, fmt.Errorf("AI provider requested tool %q outside the authorized candidate set", toolName)
			}
			aiStage("flow", "%s requested tool %s → local deterministic answer", providerName, toolName)
			result, err := executeReadOnlyTool(toolName, snapshot, question)
			if err != nil {
				return nil, err
			}
			if toolAnswer, ok := localToolAnswer(result); ok {
				return &AIAskResponse{
					Answer:   toolAnswer,
					Intent:   intent,
					Task:     routerResult.Task,
					Tool:     toolName,
					Model:    "local-tool-confirmed",
					Snapshot: snapshot,
				}, nil
			}
			return nil, errors.New("read-only AI tool returned no presentable result")
		}
		aiStage("flow", "%s answered free-form (no tool — non-deterministic path)", providerName)
		return &AIAskResponse{
			Answer:   answer,
			Intent:   intent,
			Task:     routerResult.Task,
			Model:    providerAnswer.Model,
			Snapshot: snapshot,
		}, nil
	}

	var analyticalErr error
	for _, adapter := range s.orderedProviderAdapters() {
		if !adapter.Configured() {
			continue
		}
		resp, adapterErr := executeAnalytical(adapter)
		if adapterErr == nil {
			return resp, nil
		}
		analyticalErr = adapterErr
	}

	// Fallback to local hardcoded tool template only if the LLM analytical loop fails
	if toolToRun != "" {
		aiStage("flow", "all providers failed → local tool fallback %s", toolToRun)
		result, err := executeReadOnlyTool(toolToRun, snapshot, question)
		if err == nil {
			if answer, answered := localToolAnswer(result); answered {
				return &AIAskResponse{
					Answer:   answer,
					Intent:   intent,
					Task:     routerResult.Task,
					Tool:     toolToRun,
					Model:    "local-tool-fallback",
					Snapshot: snapshot,
				}, nil
			}
		}
	}

	return nil, aiProviderOutageError(analyticalErr)
}

func (s *AIService) OperationsSnapshot(restaurantID uint) (*AISnapshot, error) {
	snapshot, err := s.buildSnapshot(restaurantID)
	if err != nil {
		return nil, err
	}
	return &snapshot, nil
}

// answerDatedSalesQuery handles Tier 1-1 dated total-sales questions with
// range-scoped repository queries that reach beyond the 14-day snapshot. It
// returns handled=false when the question is not a dated total-sales request, so
// the caller continues with the normal analytical flow.
// answerDatedStoreSummary enriches a store summary that names a single day with
// that day's verified sales, placed before the rolling-window overview. It
// returns handled=false when the summary is not day-scoped (keep the plain
// window summary) or when the day's data is not ready (let the normal flow
// explain the limitation).
func (s *AIService) answerDatedStoreSummary(restaurantID uint, question string, snapshot AISnapshot, intent AIIntent) (*AIAskResponse, bool, error) {
	if s.repo == nil {
		return nil, false, nil
	}
	day, ok := summaryDayScope(question, repository.BangkokNow())
	if !ok {
		return nil, false, nil
	}
	result, err := executeReadOnlyTool(AIToolGetStoreSummary, snapshot, question)
	if err != nil {
		return nil, false, err
	}
	summary, ok := localToolAnswer(result)
	if !ok {
		return nil, false, nil
	}
	d, err := s.repo.SalesForRange(restaurantID, day.Start, day.End)
	if err != nil {
		return nil, false, err
	}
	lead := fmt.Sprintf("ยอดขาย%sยังไม่มีออเดอร์ที่ปิดบิลครับ\n\n", day.Label)
	if d.Orders > 0 {
		lead = fmt.Sprintf("ยอดขาย%s คือ %s บาท จาก %d ออเดอร์ครับ\n\n", day.Label, formatMoney(d.Revenue), d.Orders)
	}
	return &AIAskResponse{
		Answer:   lead + summary,
		Intent:   intent,
		Task:     AITaskRetrieveFact,
		Tool:     AIToolGetStoreSummary,
		Model:    "local-store-summary-dated",
		Snapshot: snapshot,
	}, true, nil
}

func (s *AIService) answerDatedSalesQuery(restaurantID uint, question string) (*AIAskResponse, bool, error) {
	if s.repo == nil {
		return nil, false, nil
	}
	req, ok := resolveDatedSalesRequest(question, repository.BangkokNow())
	if !ok {
		return nil, false, nil
	}

	// A comparison whose second window could not be parsed asks for the missing
	// period instead of guessing one, so we never answer a different comparison
	// than the one that was asked.
	if req.clarify != "" {
		aiStage("flow", "dated-sales — comparison target unclear → asking to specify")
		return &AIAskResponse{
			Answer:   req.clarify,
			Intent:   AIIntentUnclear,
			Task:     AITaskUnclear,
			Model:    "local-period-clarify",
			Snapshot: AISnapshot{},
		}, true, nil
	}

	if req.comparison && len(req.periods) >= 2 {
		a, b := req.periods[0], req.periods[1]
		da, err := s.repo.SalesForRange(restaurantID, a.Start, a.End)
		if err != nil {
			return nil, false, err
		}
		db, err := s.repo.SalesForRange(restaurantID, b.Start, b.End)
		if err != nil {
			return nil, false, err
		}
		return &AIAskResponse{
			Answer:   formatDatedSalesComparison(a, da, b, db),
			Intent:   AIIntentAnalysis,
			Task:     AITaskRetrieveFact,
			Tool:     AIToolGetSalesForPeriod,
			Model:    "local-period-range",
			Snapshot: AISnapshot{},
		}, true, nil
	}

	p := req.periods[0]
	d, err := s.repo.SalesForRange(restaurantID, p.Start, p.End)
	if err != nil {
		return nil, false, err
	}
	return &AIAskResponse{
		Answer:   formatDatedSalesAnswer(p, d),
		Intent:   AIIntentAnalysis,
		Task:     AITaskRetrieveFact,
		Tool:     AIToolGetSalesForPeriod,
		Model:    "local-period-range",
		Snapshot: AISnapshot{},
	}, true, nil
}

func (s *AIService) validateAndIntercept(res AIFinalJSONResponse, result AIToolResult, snapshot AISnapshot) string {
	if toolAnswer, ok := localToolAnswer(result); ok {
		return toolAnswer
	}
	answer := res.Answer
	verify := res.Verify
	var corrections []string

	switch result.Tool {
	case AIToolGetLowestMarginMenu:
		if len(snapshot.LowMarginMenus) > 0 {
			actual := snapshot.LowMarginMenus[0]
			mismatch := false
			if verify.LowestMarginMenuName != "" && verify.LowestMarginMenuName != actual.MenuName {
				mismatch = true
			}
			if verify.Quantity != 0 && verify.Quantity != int(actual.Quantity) {
				mismatch = true
			}
			if verify.Revenue != 0 && !almostEqual(verify.Revenue, actual.Revenue) {
				mismatch = true
			}
			if verify.Cost != 0 && !almostEqual(verify.Cost, actual.Cost) {
				mismatch = true
			}
			if verify.Profit != 0 && !almostEqual(verify.Profit, actual.Profit) {
				mismatch = true
			}
			if verify.Margin != 0 && !almostEqual(verify.Margin, actual.Margin) {
				mismatch = true
			}
			if mismatch {
				quantity := float64(actual.Quantity)
				corrections = append(corrections, fmt.Sprintf(
					"เมนู %s, ขายได้ %d จาน, รายได้ %.2f บาท, ต้นทุน %.2f บาท, กำไร %.2f บาท, Margin %.2f%%, ต้นทุนเฉลี่ยต่อจาน %.2f บาท, กำไรเฉลี่ยต่อจาน %.2f บาท",
					actual.MenuName,
					actual.Quantity,
					actual.Revenue,
					actual.Cost,
					actual.Profit,
					actual.Margin,
					actual.Cost/quantity,
					actual.Profit/quantity,
				))
			}
		}
	case AIToolGetLowStockIngredients:
		actualOut := snapshot.InventorySummary.OutItems
		actualLow := snapshot.InventorySummary.LowItems
		mismatch := false
		if verify.LowStockCount != 0 && verify.LowStockCount != actualLow {
			mismatch = true
		}
		if verify.OutOfStockCount != 0 && verify.OutOfStockCount != actualOut {
			mismatch = true
		}
		if mismatch {
			corrections = append(corrections, fmt.Sprintf(
				"วัตถุดิบใกล้หมด %d รายการ, หมดสต็อก %d รายการ",
				actualLow,
				actualOut,
			))
		}
	case AIToolGetTopSellingMenus:
		if len(snapshot.TopMenuItems) > 0 {
			actual := snapshot.TopMenuItems[0]
			mismatch := false
			if verify.TopMenuName != "" && verify.TopMenuName != actual.MenuName {
				mismatch = true
			}
			if verify.TopMenuQuantity != 0 && verify.TopMenuQuantity != int(actual.Quantity) {
				mismatch = true
			}
			if mismatch {
				corrections = append(corrections, fmt.Sprintf(
					"%s ขายได้ %d จาน",
					actual.MenuName,
					actual.Quantity,
				))
			}
		}
	case AIToolGetInventoryValuation:
		actualTotal := snapshot.InventorySummary.TotalItems
		actualVal := snapshot.InventorySummary.Value
		mismatch := false
		if verify.TotalItems != 0 && verify.TotalItems != actualTotal {
			mismatch = true
		}
		if verify.TotalValue != 0 && !almostEqual(verify.TotalValue, actualVal) {
			mismatch = true
		}
		if mismatch {
			corrections = append(corrections, fmt.Sprintf(
				"ทั้งหมด %d รายการ, มูลค่ารวม %.2f บาท",
				actualTotal,
				actualVal,
			))
		}
	}

	if len(corrections) > 0 {
		return fmt.Sprintf("%s\n\n*(หมายเหตุความถูกต้อง: ค่าที่แสดงในบทวิเคราะห์คลาดเคลื่อนจากฐานข้อมูล จริงคือ: %s)*", answer, strings.Join(corrections, "\n"))
	}
	return answer
}

