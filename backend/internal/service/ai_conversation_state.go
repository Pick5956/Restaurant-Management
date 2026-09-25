package service

import (
	"Project-M/internal/repository"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
	"sync/atomic"

	"Project-M/internal/entity"
)

const (
	// aiConversationContextTurnLimit is how many past exchanges (each a
	// question+answer) the assistant loads as context. 20 turns = 40 messages, which
	// must stay in step with structuredPlannerMaxContextItems (the message-count cap
	// every history path is trimmed to) or the extra turns are silently dropped.
	aiConversationContextTurnLimit = 20
	// aiConversationTrashRetention is how long a deleted chat can still be
	// brought back before the purge removes it.
	aiConversationTrashRetention = 7 * 24 * time.Hour
	aiConversationCleanupEvery     = 100
	aiConversationStateVersion     = "1.0"
)

var ErrAIConversationPersistence = errors.New("AI conversation could not be saved")

// ErrAIConversationGone is a conversation id the owner sent that no longer
// answers: trashed, purged, never theirs. The screen starts a fresh chat on it
// rather than showing an error — the controller maps it to its own code.
var ErrAIConversationGone = errors.New("AI conversation is gone")

// AIConversationStore keeps the orchestration layer independent from GORM and
// makes memory behavior testable without a database.
type AIConversationStore interface {
	CreateConversation(*entity.AIConversation) error
	FindActiveConversation(restaurantID, ownerUserID uint, conversationID string) (*entity.AIConversation, error)
	ListRecentTurns(restaurantID, ownerUserID uint, conversationID string, limit int) ([]entity.AIConversationTurn, error)
	AppendTurn(restaurantID, ownerUserID uint, conversationID string, expectedVersion uint64, turn *entity.AIConversationTurn, nextStateJSON string) error
	// DeleteConversation removes a chat for good; the screens reach it only
	// from the trash. Deleting from the list is TrashConversation.
	DeleteConversation(restaurantID, ownerUserID uint, conversationID string) error
	// The chat list: many conversations per owner, a title each, a trash that
	// holds a deleted chat for seven days.
	ListConversations(restaurantID, ownerUserID uint, trashed bool, limit int) ([]repository.AIConversationSummary, error)
	ListTurnsPage(restaurantID, ownerUserID uint, conversationID string, beforeSequence uint64, limit int) ([]entity.AIConversationTurn, error)
	RenameConversation(restaurantID, ownerUserID uint, conversationID, title string) error
	AutoTitleConversation(restaurantID, ownerUserID uint, conversationID, title string) error
	TrashConversation(restaurantID, ownerUserID uint, conversationID string) error
	RestoreConversation(restaurantID, ownerUserID uint, conversationID string) error
	TrashAllConversations(restaurantID, ownerUserID uint) (int64, error)
	PurgeAllTrashed(restaurantID, ownerUserID uint) (int64, error)
	PurgeTrashed(olderThan time.Time, limit int) (int64, error)
	// UpdateState replaces the stored state without appending a turn. The
	// repository has always had it; the digest is the first caller.
	UpdateState(restaurantID, ownerUserID uint, conversationID string, expectedVersion uint64, nextStateJSON string) error
}

type aiConversationSession struct {
	conversation *entity.AIConversation
	// digest is what the model wrote about the earlier part of this conversation,
	// read back from the stored state. It rides on the session because
	// persistConversationTurn rebuilds the whole state object on every turn and
	// would otherwise overwrite it with an empty one — the feature would look
	// implemented and quietly never accumulate anything.
	digest string
	// digestThrough is the last turn the digest already covers, so the next
	// summary only reads what came after it.
	digestThrough uint64
}

type aiConversationCompactState struct {
	SchemaVersion    string          `json:"schema_version"`
	LastTask         AITask          `json:"last_task,omitempty"`
	LastTool         AIToolName      `json:"last_tool,omitempty"`
	LastResolvedPlan json.RawMessage `json:"last_resolved_plan,omitempty"`
	// Digest is the model-written memory of the older part of this conversation.
	// The key deliberately avoids the word "snapshot": the repository rejects any
	// state object containing one, to keep tool output from being stored here.
	Digest string `json:"digest,omitempty"`
	// DigestThrough records how far the digest reaches, so summarising resumes
	// rather than restarting.
	DigestThrough uint64 `json:"digest_through,omitempty"`
}

type aiConversationContextDelta struct {
	Task       AITask     `json:"task,omitempty"`
	Tool       AIToolName `json:"tool,omitempty"`
	DocSources []string   `json:"doc_sources,omitempty"`
}

func conversationMemoryEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("AI_CONVERSATION_MEMORY_ENABLED"))) {
	case "1", "true", "on", "enabled":
		return true
	default:
		return false
	}
}

func (s *AIService) prepareConversationSession(actor AIActorContext, req *AIAskRequest) (*aiConversationSession, []AIConversationMessage, error) {
	clientHistory := sanitizeConversationHistory(req.History)
	if !conversationMemoryEnabled() || s.conversationStore == nil {
		return nil, clientHistory, nil
	}
	s.maybeCleanupExpiredConversations()

	conversationID := strings.TrimSpace(req.ConversationID)
	var conversation *entity.AIConversation
	var err error
	if conversationID == "" {
		conversation = &entity.AIConversation{
			RestaurantID: actor.RestaurantID,
			OwnerUserID:  actor.OwnerUserID,
			StateJSON:    `{"schema_version":"` + aiConversationStateVersion + `"}`,
		}
		if err = s.conversationStore.CreateConversation(conversation); err != nil {
			return nil, nil, fmt.Errorf("%w: create conversation: %w", ErrAIConversationPersistence, err)
		}
	} else {
		conversation, err = s.conversationStore.FindActiveConversation(actor.RestaurantID, actor.OwnerUserID, conversationID)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: %v", ErrAIConversationGone, err)
		}
	}

	turns, err := s.conversationStore.ListRecentTurns(
		actor.RestaurantID,
		actor.OwnerUserID,
		conversation.ID,
		aiConversationContextTurnLimit,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: load conversation turns: %w", ErrAIConversationPersistence, err)
	}
	// The stored state has been written on every turn and never read until now.
	// The digest lives in it, and without this read the assistant would rewrite
	// its memory from nothing each time.
	var stored aiConversationCompactState
	_ = json.Unmarshal([]byte(strings.TrimSpace(conversation.StateJSON)), &stored)

	history := conversationTurnsToMessages(turns)
	// Transition compatibility: a new backend conversation may be created while
	// the browser still holds the previous local-only history. Once a server turn
	// exists, server-owned history becomes the sole source of conversational data.
	if len(history) == 0 {
		history = clientHistory
	}
	return &aiConversationSession{
		conversation:  conversation,
		digest:        stored.Digest,
		digestThrough: stored.DigestThrough,
	}, history, nil
}

func conversationTurnsToMessages(turns []entity.AIConversationTurn) []AIConversationMessage {
	messages := make([]AIConversationMessage, 0, len(turns)*2)
	for _, turn := range turns {
		turnID := strings.TrimSpace(turn.ID)
		messages = append(messages,
			AIConversationMessage{
				ID: turnID + "-user", Role: "user", Content: turn.Question,
				Topic: conversationTurnTopic(turn), At: turn.CreatedAt,
			},
			AIConversationMessage{ID: turnID + "-assistant", Role: "assistant", Content: providerSafeConversationAnswer(turn), At: turn.CreatedAt},
		)
	}
	return sanitizeConversationHistoryInternal(messages, true)
}

// conversationTurnTopic labels a stored turn for the thread index.
//
// It uses the tool's own section heading ("วัตถุดิบและสต๊อก", "เมนู") rather than
// the tool name. Two reasons: the headings are already written for people and
// kept up to date, and a raw name like get_top_selling_menus in the prompt is one
// the model has copied into an answer before — the cleaner only strips the
// bracketed form, so the bare one would reach the owner.
func conversationTurnTopic(turn entity.AIConversationTurn) string {
	for _, name := range strings.Split(turn.Tool, ",") {
		if heading := joyboyToolGroupHeading(AIToolName(strings.TrimSpace(name))); heading != "" {
			return heading
		}
	}
	return ""
}

func providerSafeConversationAnswer(turn entity.AIConversationTurn) string {
	var delta aiConversationContextDelta
	_ = json.Unmarshal([]byte(strings.TrimSpace(turn.ContextDeltaJSON)), &delta)
	docURLs := deduplicateSafeSystemDocURLs(delta.DocSources)
	hasSystemDocs := AITask(turn.Task) == AITaskProductHelp ||
		isSystemDocsTool(AIToolName(turn.Tool)) || len(docURLs) > 0
	if !hasSystemDocs {
		docURLs = safeSystemDocURLsFromText(turn.Answer)
		hasSystemDocs = len(docURLs) > 0
	}
	if !hasSystemDocs {
		return turn.Answer
	}
	return reduceSystemDocsAnswerForProvider(turn.Answer, docURLs)
}

func reduceSystemDocsAnswerForProvider(answer string, docURLs []string) string {
	liveAnswer := ""
	for _, heading := range []string{
		"\n\nข้อมูลวิธีใช้จากเอกสาร Dishy:",
		"\n\nDishy system documentation:",
	} {
		if index := strings.Index(answer, heading); index >= 0 {
			liveAnswer = strings.TrimSpace(answer[:index])
			break
		}
	}

	notice := "Public Dishy documentation was referenced; its untrusted body is omitted from model context."
	if docURLs = deduplicateSafeSystemDocURLs(docURLs); len(docURLs) > 0 {
		notice += " Sources: " + strings.Join(docURLs, ", ")
	}
	if liveAnswer == "" {
		return notice
	}
	return liveAnswer + "\n\n" + notice
}

func (s *AIService) persistConversationTurn(actor AIActorContext, session *aiConversationSession, question string, response *AIAskResponse, elapsed time.Duration) error {
	if session == nil || session.conversation == nil || response == nil {
		return errors.New("AI conversation turn is incomplete")
	}

	planJSON := []byte(`{}`)
	entityRefsJSON := []byte(`[]`)
	if response.ResolvedPlan != nil {
		var err error
		planJSON, err = json.Marshal(response.ResolvedPlan)
		if err != nil {
			return fmt.Errorf("encode resolved plan: %w", err)
		}
		entityRefsJSON, err = json.Marshal(response.ResolvedPlan.Parameters.Entities)
		if err != nil {
			return fmt.Errorf("encode resolved entities: %w", err)
		}
	}

	state := aiConversationCompactState{
		SchemaVersion:    aiConversationStateVersion,
		LastTask:         response.Task,
		LastTool:         response.Tool,
		LastResolvedPlan: planJSON,
		// Carried forward, not rebuilt. This object replaces the stored state
		// wholesale on every turn, so anything not copied here is deleted.
		Digest:        session.digest,
		DigestThrough: session.digestThrough,
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode conversation state: %w", err)
	}
	docURLs := make([]string, 0, len(response.DocSources))
	for _, source := range response.DocSources {
		docURLs = append(docURLs, source.URL)
	}
	contextDeltaJSON, err := json.Marshal(aiConversationContextDelta{
		Task:       response.Task,
		Tool:       response.Tool,
		DocSources: deduplicateSafeSystemDocURLs(docURLs),
	})
	if err != nil {
		return fmt.Errorf("encode conversation context delta: %w", err)
	}

	displayJSON, err := json.Marshal(aiTurnDisplayFor(response))
	if err != nil {
		return fmt.Errorf("encode conversation display: %w", err)
	}

	turn := &entity.AIConversationTurn{
		Question:             question,
		Answer:               response.Answer,
		Task:                 string(response.Task),
		Tool:                 string(response.Tool),
		ResolvedPlanJSON:     string(planJSON),
		ContextDeltaJSON:     string(contextDeltaJSON),
		ResultEntityRefsJSON: string(entityRefsJSON),
		DisplayJSON:          string(displayJSON),
		LatencyMS:            elapsed.Milliseconds(),
	}
	err = s.conversationStore.AppendTurn(
		actor.RestaurantID,
		actor.OwnerUserID,
		session.conversation.ID,
		session.conversation.Version,
		turn,
		string(stateJSON),
	)
	if errors.Is(err, repository.ErrAIConversationConflict) {
		// The digest goroutine from the previous turn landed while this answer
		// was being written: it moved the version on, and this append was
		// refused for it. The answer is already computed and paid for, so it
		// is not thrown away over a memory note — reload the row, carry the
		// digest it now holds, and append once more. A second refusal is a
		// real concurrent turn and is reported as before (found 23 ก.ย. 2569:
		// a follow-up chip tapped within a second or two of a long chat's
		// sixth answer came back 409 and the reply vanished).
		fresh, loadErr := s.conversationStore.FindActiveConversation(actor.RestaurantID, actor.OwnerUserID, session.conversation.ID)
		if loadErr != nil || fresh == nil {
			return err
		}
		var stored aiConversationCompactState
		_ = json.Unmarshal([]byte(strings.TrimSpace(fresh.StateJSON)), &stored)
		state.Digest, state.DigestThrough = stored.Digest, stored.DigestThrough
		session.digest, session.digestThrough = stored.Digest, stored.DigestThrough
		if stateJSON, err = json.Marshal(state); err != nil {
			return fmt.Errorf("encode conversation state: %w", err)
		}
		session.conversation = fresh
		aiStage("flow", "conversation: บันทึกเทิร์นชนกับ digest ที่เพิ่งเขียน → โหลดใหม่แล้วบันทึกอีกครั้ง")
		err = s.conversationStore.AppendTurn(
			actor.RestaurantID,
			actor.OwnerUserID,
			session.conversation.ID,
			session.conversation.Version,
			turn,
			string(stateJSON),
		)
	}
	if err != nil {
		return err
	}
	response.TurnID = turn.ID
	// AppendTurn moved the row on in the database but not in this copy. Anything
	// that writes after it — the digest does — must use the new version or its
	// write is rejected as a conflict every single time, which is exactly how the
	// digest came to be composed correctly and thrown away on every turn.
	session.conversation.Version++
	session.conversation.NextTurnSequence = turn.Sequence + 1
	// The first turn names the chat. Go cuts the question short; the owner can
	// rename it, after which this never writes again.
	if turn.Sequence == 1 {
		if err := s.conversationStore.AutoTitleConversation(actor.RestaurantID, actor.OwnerUserID, session.conversation.ID, aiConversationTitleFromQuestion(question)); err != nil {
			aiStage("warn", "conversation title could not be stored: %v", err)
		}
	}
	s.maybeSummarizeConversation(actor, session, turn.Sequence)
	return nil
}

// aiConversationTitleMaxRunes is how much of the opening question becomes the
// chat's name: enough to tell "ยอดขายสัปดาห์นี้" from "ยอดขายเดือนนี้", short
// enough for one line of the list.
const aiConversationTitleMaxRunes = 40

// aiConversationTitleFromQuestion is the automatic title: the question on one
// line, cut at aiConversationTitleMaxRunes with an ellipsis. Plain Go — a
// model call to invent a title would cost a request per chat for a name the
// owner can already read off the question.
func aiConversationTitleFromQuestion(question string) string {
	title := strings.Join(strings.Fields(question), " ")
	runes := []rune(title)
	if len(runes) <= aiConversationTitleMaxRunes {
		return title
	}
	return string(runes[:aiConversationTitleMaxRunes]) + "…"
}

// aiTurnDisplay is what a turn keeps so the screen can show the answer again
// exactly as it first appeared: the chart or forecast beside it, the tools
// that produced it, the manual pages it cited. Never the snapshot — the
// repository refuses a key that even contains the word.
type aiTurnDisplay struct {
	Chart        *AIChartData        `json:"chart,omitempty"`
	Forecast     *AIForecastResult   `json:"forecast,omitempty"`
	ToolsUsed    []AIToolName        `json:"tools_used,omitempty"`
	ScopeAssumed bool                `json:"scope_assumed,omitempty"`
	DocSources   []AISystemDocSource `json:"doc_sources,omitempty"`
	ActionPlanID string              `json:"action_plan_id,omitempty"`
	Model        string              `json:"model,omitempty"`
	FollowUps    []string            `json:"follow_ups,omitempty"`
	Navigate     *AINavigation       `json:"navigate,omitempty"`
}

func aiTurnDisplayFor(response *AIAskResponse) aiTurnDisplay {
	display := aiTurnDisplay{
		Chart:        response.Chart,
		Forecast:     response.Forecast,
		ToolsUsed:    response.ToolsUsed,
		ScopeAssumed: response.ScopeAssumed,
		DocSources:   response.DocSources,
		Model:        response.Model,
		FollowUps:    response.FollowUps,
		Navigate:     response.Navigate,
	}
	if response.ActionPlan != nil {
		display.ActionPlanID = response.ActionPlan.ID
	}
	return display
}

// AIConversationTurnView is one turn as the screen reads it back: the
// exchange, and the display data to redraw it.
type AIConversationTurnView struct {
	ID        string          `json:"id"`
	Sequence  uint64          `json:"sequence"`
	Question  string          `json:"question"`
	Answer    string          `json:"answer"`
	Tool      string          `json:"tool,omitempty"`
	LatencyMS int64           `json:"latency_ms"`
	CreatedAt time.Time       `json:"created_at"`
	Display   json.RawMessage `json:"display"`
}

func (s *AIService) requireConversationOwner(actor AIActorContext) error {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return errors.New("authenticated restaurant owner context is required")
	}
	if s.conversationStore == nil {
		return errors.New("AI conversation memory is not configured")
	}
	return nil
}

// ListConversationsForOwner is the chat list — or the trash, when asked.
func (s *AIService) ListConversationsForOwner(actor AIActorContext, trashed bool, limit int) ([]repository.AIConversationSummary, error) {
	if err := s.requireConversationOwner(actor); err != nil {
		return nil, err
	}
	rows, err := s.conversationStore.ListConversations(actor.RestaurantID, actor.OwnerUserID, trashed, limit)
	if err != nil {
		return nil, err
	}
	if rows == nil {
		rows = []repository.AIConversationSummary{}
	}
	return rows, nil
}

// ConversationTurnsForOwner reads one page of a chat, oldest first, ending
// just before beforeSequence (0 = the newest page).
func (s *AIService) ConversationTurnsForOwner(actor AIActorContext, conversationID string, beforeSequence uint64, limit int) ([]AIConversationTurnView, error) {
	if err := s.requireConversationOwner(actor); err != nil {
		return nil, err
	}
	turns, err := s.conversationStore.ListTurnsPage(actor.RestaurantID, actor.OwnerUserID, conversationID, beforeSequence, limit)
	if err != nil {
		return nil, err
	}
	views := make([]AIConversationTurnView, 0, len(turns))
	for _, turn := range turns {
		display := json.RawMessage(strings.TrimSpace(turn.DisplayJSON))
		if len(display) == 0 || !json.Valid(display) {
			display = json.RawMessage(`{}`)
		}
		views = append(views, AIConversationTurnView{
			ID:        turn.ID,
			Sequence:  turn.Sequence,
			Question:  turn.Question,
			Answer:    turn.Answer,
			Tool:      turn.Tool,
			LatencyMS: turn.LatencyMS,
			CreatedAt: turn.CreatedAt,
			Display:   display,
		})
	}
	return views, nil
}

func (s *AIService) RenameConversationForOwner(actor AIActorContext, conversationID, title string) error {
	if err := s.requireConversationOwner(actor); err != nil {
		return err
	}
	return s.conversationStore.RenameConversation(actor.RestaurantID, actor.OwnerUserID, conversationID, title)
}

func (s *AIService) RestoreConversationForOwner(actor AIActorContext, conversationID string) error {
	if err := s.requireConversationOwner(actor); err != nil {
		return err
	}
	return s.conversationStore.RestoreConversation(actor.RestaurantID, actor.OwnerUserID, conversationID)
}

// PurgeConversationForOwner deletes a chat for good — the trash's own button.
func (s *AIService) PurgeConversationForOwner(actor AIActorContext, conversationID string) error {
	if err := s.requireConversationOwner(actor); err != nil {
		return err
	}
	return s.conversationStore.DeleteConversation(actor.RestaurantID, actor.OwnerUserID, conversationID)
}

func (s *AIService) PurgeAllTrashedForOwner(actor AIActorContext) (int64, error) {
	if err := s.requireConversationOwner(actor); err != nil {
		return 0, err
	}
	return s.conversationStore.PurgeAllTrashed(actor.RestaurantID, actor.OwnerUserID)
}

// maybeSummarizeConversation writes the model's memory of the older part of this
// conversation, once enough turns have piled up beyond what it already covers.
//
// It runs in the background because the owner is waiting for an answer, not for a
// memory to be filed, and a slow provider must never make the chat feel slow. If
// it fails there is nothing to recover: the previous digest stays, and the two
// deterministic layers of memory keep working regardless — this is the layer that
// can be absent without the assistant losing the thread.
func (s *AIService) maybeSummarizeConversation(actor AIActorContext, session *aiConversationSession, latestSequence uint64) {
	if !aiConversationDigestEnabled() || s.conversationStore == nil || session == nil || session.conversation == nil {
		return
	}
	// The newest turns are already shown to the model word for word; summarising
	// them would put the same sentences in the prompt twice.
	uncovered := int64(latestSequence) - int64(session.digestThrough) - aiDigestSkipRecentTurns
	if uncovered < aiDigestTurnThreshold {
		return
	}
	conversationID := session.conversation.ID
	version := session.conversation.Version
	previous := session.digest
	through := latestSequence - aiDigestSkipRecentTurns

	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				aiStage("warn", "digest: สรุปบทสนทนาแล้วพัง (%v)", recovered)
			}
		}()
		turns, err := s.conversationStore.ListRecentTurns(
			actor.RestaurantID, actor.OwnerUserID, conversationID, aiConversationContextTurnLimit)
		if err != nil {
			aiStage("warn", "digest: อ่านบทสนทนาไม่ได้ (%v)", err)
			return
		}
		pending := make([]entity.AIConversationTurn, 0, len(turns))
		for _, candidate := range turns {
			if candidate.Sequence > session.digestThrough && candidate.Sequence <= through {
				pending = append(pending, candidate)
			}
		}
		digest, reached := s.summarizeConversation(pending, previous)
		if !reached {
			return
		}
		// "ไม่มี" — nothing in these turns worth keeping. The old digest stays
		// and the marker still moves on: leaving it put made the same turns
		// count as uncovered on every later question, one extra model call
		// each (found 23 ก.ย. 2569).
		if strings.TrimSpace(digest) == "" {
			digest = previous
		}
		state := aiConversationCompactState{
			SchemaVersion: aiConversationStateVersion,
			Digest:        digest,
			DigestThrough: through,
		}
		stateJSON, err := json.Marshal(state)
		if err != nil {
			return
		}
		// A turn may have landed while the summary was being written, which moves
		// the version on. Dropping the write is correct: the next turn past the
		// threshold summarises again, over a conversation that now includes it.
		if err := s.conversationStore.UpdateState(
			actor.RestaurantID, actor.OwnerUserID, conversationID, version, string(stateJSON)); err != nil {
			aiStage("flow", "digest: บันทึกไม่ทัน มีเทิร์นใหม่แทรกเข้ามา (%v) — รอบหน้าค่อยสรุปใหม่", err)
		}
	}()
}

func (s *AIService) DeleteConversationForOwner(actor AIActorContext, conversationID string) error {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return errors.New("authenticated restaurant owner context is required")
	}
	if s.conversationStore == nil {
		return errors.New("AI conversation memory is not configured")
	}
	return s.conversationStore.TrashConversation(actor.RestaurantID, actor.OwnerUserID, conversationID)
}

// DeleteAllConversationsForOwner forgets every conversation the owner has with
// this restaurant — the thread on screen and every older one — and reports how
// many went. The next question starts a fresh thread with no digest.
func (s *AIService) DeleteAllConversationsForOwner(actor AIActorContext) (int64, error) {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return 0, errors.New("authenticated restaurant owner context is required")
	}
	if s.conversationStore == nil {
		return 0, errors.New("AI conversation memory is not configured")
	}
	return s.conversationStore.TrashAllConversations(actor.RestaurantID, actor.OwnerUserID)
}

func (s *AIService) maybeCleanupExpiredConversations() {
	if s.conversationStore == nil {
		return
	}
	count := atomic.AddUint64(&s.conversationCleanupCounter, 1)
	if count != 1 && count%aiConversationCleanupEvery != 0 {
		return
	}
	// Chats are kept until the owner deletes them; what expires is the trash.
	if _, err := s.conversationStore.PurgeTrashed(repository.BangkokNow().Add(-aiConversationTrashRetention), 500); err != nil {
		aiStage("warn", "trashed conversation purge failed: %v", err)
	}
}
