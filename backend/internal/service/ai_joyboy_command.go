package service

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Joyboy's inventory command path.
//
// A sentence becomes a proposal (model), the proposal becomes checked commands
// (Go, against the live shelf), and checked commands become a plan the owner
// confirms. Every branch that cannot proceed says why — a question, an offer to
// add the missing ingredient, or a plain "actions are off" — because the one
// unacceptable outcome is the assistant claiming it did something it did not.

// AIActionPlanResponse is the confirm-bar payload for a multi-item plan.
type AIActionPlanResponse struct {
	ID                string                    `json:"id"`
	Status            string                    `json:"status"`
	ExpiresAt         string                    `json:"expires_at"`
	ConfirmationToken string                    `json:"confirmation_token"`
	Summary           string                    `json:"summary"`
	Items             []AIActionPlanItemResponse `json:"items"`
	Warnings          []string                  `json:"warnings,omitempty"`
}

type AIActionPlanItemResponse struct {
	Title       string   `json:"title"`
	Change      string   `json:"change"`
	Unit        string   `json:"unit,omitempty"`
	SideEffects []string `json:"side_effects,omitempty"`
	// The change in parts; see AIActionItemPreview.
	Kind      string                `json:"kind,omitempty"`
	Field     string                `json:"field,omitempty"`
	From      string                `json:"from,omitempty"`
	To        string                `json:"to,omitempty"`
	ValueUnit string                `json:"value_unit,omitempty"`
	Delta     string                `json:"delta,omitempty"`
	Facts     []AIActionPreviewFact `json:"facts,omitempty"`
	// Setup is the new-ingredient card's state; see ai_ingredient_setup.go.
	Setup *AIIngredientSetupView `json:"setup,omitempty"`
}

// maybeHandleJoyboyStockCommand answers an inventory command. It reports handled
// = true whenever it has taken over the reply, so the caller skips the normal
// read/answer flow and the model never free-writes about a write.
//
// clarify comes back when the sentence held a command this path could not
// resolve AND nothing else about it was understood. The turn is then NOT taken
// over — the caller answers the question normally and appends this line.
//
// That case is not rare, because people put both halves in one breath:
// "กะเพราเหลือเท่าไหร่ แล้วสั่งเพิ่มให้หน่อย" is a question and an order. Taking
// the whole turn for the order dropped the question with no trace, and the owner
// got a request for a quantity instead of the number they asked for.
func (s *AIService) maybeHandleJoyboyStockCommand(actor AIActorContext, request *AIAskRequest, response *AIAskResponse) (handled bool, clarify string, options []string) {
	if !s.canHandleJoyboyStockCommands() {
		return false, "", nil
	}
	// No keyword gate. Deciding whether a sentence is a command is exactly the
	// judgement the model is good at, and a keyword list can only ever cover the
	// phrasings someone thought of. The extractor returns an empty list for
	// anything that is not a command, which costs one small call and keeps every
	// way of saying it working.
	drafts, err := s.ExtractStockCommands(request.Question, request.History)
	return s.handleJoyboyStockDrafts(actor, request, response, drafts, err)
}

// canHandleJoyboyStockCommands says whether the command path is wired at all.
func (s *AIService) canHandleJoyboyStockCommands() bool {
	return s.actionPlanStore != nil && s.actionIngredients != nil && s.repo != nil
}

// handleJoyboyStockDrafts is the command path from the extractor's drafts on:
// the same code whether the drafts were read just now or, in parallel mode,
// while joyboy was choosing its tools.
// options are the tappable answers when the one thing asked is a choice from
// a list Go knows; empty otherwise. They ride out as the reply's follow-ups.
func (s *AIService) handleJoyboyStockDrafts(actor AIActorContext, request *AIAskRequest, response *AIAskResponse, drafts []AIStockCommandDraft, err error) (handled bool, clarify string, options []string) {
	if err != nil || len(drafts) == 0 {
		return false, "", nil
	}

	// Actions off (or not the owner): say so rather than letting the answer round
	// describe a change that will not happen.
	if actor.Role != "owner" || actor.OwnerUserID == 0 || !s.ownerActionsEnabled(actor.RestaurantID) {
			what := "แก้ข้อมูลคลัง"
		if aiDraftsIncludeMenu(drafts) {
			what = "แก้ข้อมูลร้าน"
		}
		response.Answer = fmt.Sprintf("ผมยัง%sให้ไม่ได้ครับ ต้องเปิด “ให้ผู้ช่วยแก้ข้อมูลร้านได้” ในตั้งค่าผู้ช่วยก่อน แล้วผมจะเตรียมรายการให้คุณกดยืนยัน", what)
		response.Intent = AIIntentChat
		response.Task = AITaskGeneralChat
		response.Model = "joyboy-action-disabled"
		return true, "", nil
	}

	shelf, err := s.actionIngredients.ListIngredients(actor.RestaurantID)
	if err != nil {
		aiStage("warn", "joyboy command: listing ingredients failed (%v) → answering normally", err)
		return false, "", nil
	}
	// The menu catalogue is only fetched when something in the sentence is about a
	// menu, so an inventory-only command costs exactly what it did before.
	var menus []entity.MenuItem
	if aiDraftsIncludeMenu(drafts) {
		if s.actionMenus == nil {
			response.Answer = "ผมยังเปิด-ปิดขายเมนูให้ไม่ได้ครับ"
			response.Intent = AIIntentChat
			response.Task = AITaskGeneralChat
			response.Model = "joyboy-command-unavailable"
			return true, "", nil
		}
		menus, err = s.actionMenus.ListMenuItems(actor.RestaurantID, true, 0)
		if err != nil {
			aiStage("warn", "joyboy command: listing menus failed (%v) → answering normally", err)
			return false, "", nil
		}
	}
	// The categories, only when a new menu is being added — the one command
	// that has to file the row somewhere.
	var categories []entity.Category
	if aiDraftsIncludeMenuCreate(drafts) {
		creator, ok := s.actionMenus.(AIActionMenuCreator)
		if !ok {
			response.Answer = "ผมยังเพิ่มเมนูใหม่ให้ไม่ได้ครับ"
			response.Intent = AIIntentChat
			response.Task = AITaskGeneralChat
			response.Model = "joyboy-command-unavailable"
			return true, "", nil
		}
		categories, err = creator.ListCategories(actor.RestaurantID, false)
		if err != nil {
			aiStage("warn", "joyboy command: listing categories failed (%v) → answering normally", err)
			return false, "", nil
		}
	}

	commands := make([]AIAdjustStockCommand, 0, len(drafts))
	titles := make([]string, 0, len(drafts))
	acknowledged := make([]string, 0, len(drafts))
	questions := make([]string, 0, 2)
	notices := make([]string, 0, 2)
	var choices []string
	for _, draft := range drafts {
		// Money in another currency is a question, whatever else the command
		// says: the ledger keeps baht, and converting quietly wrote "5000 ดอล"
		// down as 5,000 baht.
		if question := AIForeignCurrencyQuestion(draft); question != "" {
			questions = append(questions, question)
			continue
		}
		resolution := ResolveStockCommand(shelf, draft)
		// The web draws a step-by-step card for a new ingredient, so what used
		// to be a chat question about its unit becomes the card's first step.
		// Clients without the card still get the question.
		if request.IngredientCard {
			if card, ok := aiCardCreateResolution(shelf, draft); ok {
				resolution = card
			}
		}
		switch {
		case AIMenuCreateKind(draft.Kind):
			resolution = ResolveMenuCreateCommand(menus, categories, draft)
		case AIMenuCommandKind(draft.Kind):
			resolution = ResolveMenuCommand(menus, draft)
		case strings.EqualFold(strings.TrimSpace(draft.Kind), "expense"):
			resolution = ResolveExpenseCommand(draft, repository.BangkokNow())
		}
		switch resolution.Kind {
		case AICommandOutcomeReady:
			commands = append(commands, resolution.Command)
			titles = append(titles, resolution.Title)
			acknowledged = append(acknowledged, aiCommandAsSaid(resolution.Title, draft))
		case AICommandOutcomeNothingToDo:
			// Already true. Not a question and not a change — just say so, and let
			// the rest of the sentence proceed.
			notices = append(notices, resolution.Question)
		default:
			// A question and an offer to add a missing ingredient are both simply
			// asked; the owner's next message flows back through this path with the
			// history attached.
			questions = append(questions, resolution.Question)
			if len(resolution.Options) > 0 && choices == nil {
				choices = resolution.Options
			}
		}
	}

	// Two drafts about the same thing ask the same question, and it was printed
	// twice: "กะเพราเหลือเท่าไหร่ แล้วสั่งเพิ่มให้หน่อย" came back as
	// `"กะเพรา" เท่าไหร่ครับ (หน่วยกรัม)` on two consecutive lines. Nothing
	// downstream compares them, so identical text is dropped here.
	questions = aiDropRepeats(questions)
	notices = aiDropRepeats(notices)
	// Chips only when there is exactly one question and it is that choice:
	// two questions with one set of answers under them would mislead.
	if len(questions) != 1 {
		choices = nil
	}

	// Anything unclear is asked before a plan is built, so the owner never
	// confirms half of what they said without knowing.
	if len(questions) > 0 {
		// Nothing was understood and nothing is ready: the sentence may well have
		// been a question with an order tacked on. Hand the question back so it gets
		// a real answer, and carry the clarification along to be appended to it.
		//
		// Only in that exact case. Once anything has been acknowledged or a command
		// is ready, this path has to own the reply — the "รับทราบแล้วครับ" line is
		// what the next turn reads to rebuild the rest of the command, and burying
		// it under an unrelated answer is how half an order goes missing.
		if len(acknowledged) == 0 && len(commands) == 0 && len(notices) == 0 {
			return false, strings.Join(questions, "\n"), choices
		}
		lines := notices
		// Say what was understood before asking about what was not. Without this the
		// owner sees only the question and cannot tell whether the part that was
		// clear survived — and neither can the model on the next turn, which reads
		// this answer as its own history when it rebuilds the command.
		if len(acknowledged) > 0 {
			lines = append(lines, fmt.Sprintf("%s — รับทราบแล้วครับ", strings.Join(acknowledged, " · ")))
		}
		response.Answer = strings.Join(append(lines, questions...), "\n")
		response.Intent = AIIntentUnclear
		response.Task = AITaskUnclear
		response.Model = "joyboy-command-clarify"
		response.FollowUps = choices
		return true, "", nil
	}
	if len(commands) == 0 {
		if len(notices) > 0 {
			response.Answer = strings.Join(notices, "\n")
			response.Intent = AIIntentChat
			response.Task = AITaskGeneralChat
			response.Model = "joyboy-command-noop"
			return true, "", nil
		}
		return false, "", nil
	}

	draft := BuildAdjustStockPlan(s.actionPorts(), actor.RestaurantID, commands, titles)

	// The owner can leave the master switch on and still keep single kinds of
	// change off ("เปลี่ยนราคาเมนู" off, everything else on). Those items are
	// dropped here, after validation named them, so the reply can say which
	// kind was refused and why — and the rest of the sentence still goes ahead.
	draft, switchedOff := s.dropSwitchedOffActionTypes(actor.RestaurantID, draft)
	if len(draft.Items) == 0 && len(switchedOff) > 0 {
		response.Answer = aiActionTypesOffSentence(switchedOff)
		response.Intent = AIIntentChat
		response.Task = AITaskGeneralChat
		response.Model = "joyboy-action-type-off"
		return true, "", nil
	}
	if len(draft.Items) == 0 {
		response.Answer = aiRejectedItemsMessage(draft.Rejected)
		response.Intent = AIIntentChat
		response.Task = AITaskGeneralChat
		response.Model = "joyboy-command-rejected"
		return true, "", nil
	}

	summary := aiStockPlanSummary(draft.Items, draft.Previews)

	// One live proposal at a time.
	//
	// A card was on screen for "เพิ่มหมูสับ 2 กิโล" and the owner typed "โอเค".
	// That went back through the extractor, which re-derived the command from the
	// thread — and got a different one: a card proposing หมูสับ 5000 → 2000, a cut
	// of three kilos where the owner had agreed to adding two. The summary the
	// assistant writes ("ผมเตรียมปรับสต๊อก 'หมูสับ' แล้ว") carries no numbers, so
	// re-reading it is guesswork, and agreeing to a proposal is not a new command.
	//
	// Comparing the two plans is not enough to catch that, because the whole
	// failure is that they differ. So while a plan is pending, no second plan is
	// built at all: press it or cancel it first. The window is one minute, and a
	// confirm card the owner has not answered is the one thing the next message is
	// most likely about.
	if pending, err := s.actionPlanStore.PendingAIActionPlan(actor.RestaurantID, actor.OwnerUserID); err != nil {
		aiStage("warn", "joyboy command: checking for a pending plan failed (%v) → carrying on", err)
	} else if pending != nil {
		// The box can be gone from the screen — the page crashed, or another
		// device holds it — so the way out that needs no box is said too
		// (25 ก.ย. 2569: the new-ingredient card crashed and the owner's retyped
		// command was sent to "the box above", which was not there).
		wait := int(math.Ceil(time.Until(pending.ExpiresAt).Seconds()))
		if wait < 1 {
			wait = 1
		}
		noBox := fmt.Sprintf(" (ถ้าไม่เห็นกล่อง รอ %d วินาทีให้หมดอายุ แล้วสั่งใหม่ได้เลย)", wait)
		if aiPlanAsksForTheSameThing(pending, draft.Items) {
			response.Answer = fmt.Sprintf("%sรออยู่แล้วครับ กดปุ่มยืนยันในกล่องข้างบนได้เลย", pending.Summary) + noBox
		} else {
			response.Answer = fmt.Sprintf(
				"ยังมีรายการรอยืนยันค้างอยู่ครับ — %s\nกดยืนยันหรือยกเลิกในกล่องข้างบนก่อน แล้วค่อยสั่งอันใหม่นะครับ",
				pending.Summary) + noBox
		}
		aiStage("flow", "joyboy command: a plan is already pending → not building a second one")
		response.Intent = AIIntentChat
		response.Task = AITaskGeneralChat
		response.Model = "joyboy-command-already-pending"
		return true, "", nil
	}

	plan, token, err := s.actionPlanStore.CreateAIActionPlan(repository.CreateAIActionPlanParams{
		RestaurantID: actor.RestaurantID,
		OwnerUserID:  actor.OwnerUserID,
		Summary:      summary,
		Items:        draft.Items,
		TTL:          aiPlanWindow(draft.Items),
	})
	if err != nil {
		aiStage("warn", "joyboy command: creating the plan failed (%v)", err)
		response.Answer = "ผมเตรียมคำสั่งไม่สำเร็จครับ ลองพิมพ์ใหม่อีกครั้ง"
		response.Intent = AIIntentChat
		response.Task = AITaskGeneralChat
		response.Model = "joyboy-command-failed"
		return true, "", nil
	}

	items := make([]AIActionPlanItemResponse, 0, len(draft.Previews))
	for _, preview := range draft.Previews {
		items = append(items, aiPlanItemResponse(preview))
	}

	answer := fmt.Sprintf("ผมเตรียม%sแล้ว ยังไม่ได้แก้ข้อมูล กดยืนยันภายใน 1 นาทีครับ", summary)
	if aiPlanWindow(draft.Items) > 0 {
		answer = fmt.Sprintf("ผมเตรียม%sแล้ว ยังไม่ได้แก้ข้อมูล ตอบคำถามในการ์ดให้ครบ แล้วกดยืนยันครับ", summary)
	}
	if len(switchedOff) > 0 {
		notices = append(notices, aiActionTypesOffSentence(switchedOff))
	}
	if len(notices) > 0 {
		answer = strings.Join(notices, "\n") + "\n" + answer
	}
	warnings := make([]string, 0, len(draft.Rejected))
	if len(draft.Rejected) > 0 {
		answer += "\n" + aiRejectedItemsMessage(draft.Rejected)
		for _, rejected := range draft.Rejected {
			warnings = append(warnings, fmt.Sprintf("%s — %s", rejected.Title, rejected.Reason))
		}
	}

	response.Answer = answer
	response.Intent = AIIntentAnalysis
	response.Task = AITaskRecommendAction
	response.Model = "joyboy-command-plan"
	response.ActionPlan = &AIActionPlanResponse{
		ID:                plan.ID,
		Status:            plan.Status,
		ExpiresAt:         plan.ExpiresAt.Format(aiActionPlanTimeLayout),
		ConfirmationToken: token,
		Summary:           summary,
		Items:             items,
		Warnings:          warnings,
	}
	return true, "", nil
}

// aiCommandAsSaid renders one understood command the way the owner said it, for
// the line that goes out while the rest of the sentence is being asked about.
//
// The amount and unit are there for the next turn as much as for the owner: the
// model rebuilds the whole command from this thread, and "ไข่ไก่ — รับทราบแล้ว"
// gave it nothing to rebuild from, so answering the question produced a plan for
// the newly named ingredient alone and the first one was lost.
func aiCommandAsSaid(title string, draft AIStockCommandDraft) string {
	name := strings.TrimSpace(title)
	if name == "" {
		name = strings.TrimSpace(draft.Name)
	}
	if draft.Quantity <= 0 {
		return name
	}
	// Trimmed, not joyboyNum: this is the owner's own phrasing being read back, and
	// "ไข่ไก่ 30.00 ฟอง" is not how they said it.
	said := name + " " + strconv.FormatFloat(draft.Quantity, 'f', -1, 64)
	if unit := strings.TrimSpace(draft.Unit); unit != "" {
		said += " " + unit
	}
	return said
}

// aiPlanAsksForTheSameThing reports whether a plan already waiting for the owner
// covers exactly the items just built.
//
// The comparison is on the action type and the payload — what would actually be
// written — not on the summary text, because the same write can be described two
// ways ("เพิ่มหมูสับ 2 กิโล" and "โอเค" produce identical payloads from different
// sentences, which is precisely the case worth catching). Order matters: the
// items are built from one sentence in the order it was said, so two plans that
// differ only in order came from different sentences.
func aiPlanAsksForTheSameThing(pending *entity.AIActionPlan, items []repository.CreateAIActionPlanItemParams) bool {
	if pending == nil || len(pending.Items) != len(items) || len(items) == 0 {
		return false
	}
	for index, item := range items {
		existing := pending.Items[index]
		if existing.ActionType != item.ActionType || existing.PayloadJSON != item.PayloadJSON {
			return false
		}
	}
	return true
}

const aiActionPlanTimeLayout = "2006-01-02T15:04:05Z07:00"

// actionPorts bundles the services the action registry writes through, so a new
// action type is one field here rather than one more argument at every call.
func (s *AIService) actionPorts() AIActionPorts {
	return AIActionPorts{
		Ingredients: s.actionIngredients,
		Menus:       s.actionMenus,
		Expenses:    s.actionExpenses,
	}
}

// aiDraftsIncludeMenu reports whether anything in the sentence was about a menu,
// which is what decides whether the menu catalogue is worth fetching.
func aiDraftsIncludeMenu(drafts []AIStockCommandDraft) bool {
	for _, draft := range drafts {
		if AIMenuCommandKind(draft.Kind) || AIMenuCreateKind(draft.Kind) {
			return true
		}
	}
	return false
}

func aiDraftsIncludeMenuCreate(drafts []AIStockCommandDraft) bool {
	for _, draft := range drafts {
		if AIMenuCreateKind(draft.Kind) {
			return true
		}
	}
	return false
}

// aiStockPlanSummary names the plan for what it actually does. Calling a price
// change "ปรับสต๊อก" made the headline disagree with the line under it, which is
// the kind of small wrongness that makes an owner distrust the whole bar.
func aiStockPlanSummary(items []repository.CreateAIActionPlanItemParams, previews []AIActionItemPreview) string {
	kinds := map[string]struct{}{}
	for _, item := range items {
		kinds[item.ActionType] = struct{}{}
	}
	verb := "แก้ข้อมูลร้าน"
	if len(kinds) == 1 {
		for actionType := range kinds {
			switch actionType {
			case entity.AIActionTypeAdjustIngredientStock:
				verb = "ปรับสต๊อก"
			case entity.AIActionTypeSetIngredientMinStock:
				verb = "ตั้งขั้นต่ำ"
			case entity.AIActionTypeSetIngredientCost:
				verb = "ตั้งราคา"
			case entity.AIActionTypeCreateIngredient:
				verb = "เพิ่มวัตถุดิบ"
			case entity.AIActionTypeSetMenuAvailability:
				verb = aiMenuPlanVerb(items)
			case entity.AIActionTypeCreateExpense:
				verb = "บันทึกรายจ่าย"
			case entity.AIActionTypeSetMenuPrice:
				verb = "ตั้งราคาเมนู"
			case entity.AIActionTypeCreateMenuItem:
				verb = "เพิ่มเมนู"
			}
		}
	}
	if len(previews) == 1 {
		return fmt.Sprintf("%s “%s”", verb, previews[0].Title)
	}
	return fmt.Sprintf("%s %d รายการ", verb, len(previews))
}

// aiMenuPlanVerb names a menu plan by the direction its items actually carry,
// read back from the stored payloads rather than from the sentence — "ปิดขายเมนู"
// over a plan that opens one would be the headline disagreeing with the rows.
func aiMenuPlanVerb(items []repository.CreateAIActionPlanItemParams) string {
	opens, closes := 0, 0
	for _, item := range items {
		var payload AIActionItemPayload
		if err := jsonUnmarshalString(item.PayloadJSON, &payload); err != nil {
			return "เปลี่ยนสถานะขายเมนู"
		}
		if payload.Available {
			opens++
		} else {
			closes++
		}
	}
	switch {
	case opens > 0 && closes == 0:
		return "เปิดขายเมนู"
	case closes > 0 && opens == 0:
		return "ปิดขายเมนู"
	default:
		return "เปลี่ยนสถานะขายเมนู"
	}
}

func aiRejectedItemsMessage(rejected []AIActionRejectedItem) string {
	if len(rejected) == 0 {
		return ""
	}
	lines := make([]string, 0, len(rejected)+1)
	lines = append(lines, "รายการที่ผมทำให้ไม่ได้:")
	for _, item := range rejected {
		lines = append(lines, fmt.Sprintf("- %s — %s", item.Title, item.Reason))
	}
	return strings.Join(lines, "\n")
}

// ConfirmAIActionPlanForOwner runs a confirmed plan: claim it (which makes a
// second confirmation a no-op), execute each item through the normal services,
// then record what happened.
func (s *AIService) ConfirmAIActionPlanForOwner(actor AIActorContext, planID, confirmationToken string) (*AIActionPlanConfirmation, error) {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return nil, ErrAIActionsDisabled
	}
	if !s.ownerActionsEnabled(actor.RestaurantID) {
		return nil, ErrAIActionsDisabled
	}
	if s.actionPlanStore == nil || s.actionIngredients == nil {
		return nil, ErrAIActionUnavailable
	}
	// A kind switched off between the card appearing and the button being
	// pressed must not run. Checked before the claim so a refused plan is left
	// pending — and cancellable — rather than parked as "executing" until the
	// claim times out.
	if pending, err := s.actionPlanStore.FindAIActionPlan(actor.RestaurantID, actor.OwnerUserID, planID); err == nil && pending != nil {
		prefs := s.preferencesFor(actor.RestaurantID)
		for _, item := range pending.Items {
			if !prefs.ActionTypeAllowed(item.ActionType) {
				return nil, ErrAIActionsDisabled
			}
		}
	}

	plan, replayed, err := s.actionPlanStore.ClaimAIActionPlan(actor.RestaurantID, actor.OwnerUserID, planID, confirmationToken)
	if err != nil {
		return nil, err
	}
	if replayed {
		return newAIActionPlanConfirmation(plan, true), nil
	}

	outcomes := runAIActionPlanItems(s.actionPlanStore, s.actionPorts(), actor, plan)

	finished, err := s.actionPlanStore.FinishAIActionPlan(plan.ID, outcomes)
	if err != nil {
		return nil, err
	}
	return newAIActionPlanConfirmation(finished, false), nil
}

// runAIActionPlanItems executes a claimed plan item by item and returns every
// item's outcome, the ones it ran and the ones it found already done.
//
// An item that already reads "executed" is not run again. That is the case a
// re-claim exists for: the first attempt died after writing item 1, the plan sat
// in "executing" past the claim timeout, and the owner (or a retry) confirmed
// again. Running item 1 a second time would book the same delivery twice. Its
// stored outcome is carried into the totals instead, so the final message still
// counts it.
//
// Each outcome is written the moment it is known — before the next item runs —
// which is what makes the skip possible on the next attempt. If that write
// itself fails the run continues; the outcome still reaches FinishAIActionPlan
// with the rest, and the worst case is the one this code already had.
func runAIActionPlanItems(store AIActionPlanStore, ports AIActionPorts, actor AIActorContext, plan *entity.AIActionPlan) []repository.AIActionPlanItemOutcome {
	outcomes := make([]repository.AIActionPlanItemOutcome, 0, len(plan.Items))
	for _, item := range plan.Items {
		if item.Status == entity.AIActionItemStatusExecuted {
			aiStage("flow", "joyboy plan %s item %d already executed on an earlier attempt → not run again", plan.ID, item.ID)
			outcomes = append(outcomes, repository.AIActionPlanItemOutcome{ItemID: item.ID, Succeeded: true})
			continue
		}
		execErr := executeAIActionItem(ports, actor.RestaurantID, actor.OwnerUserID, item)
		outcome := repository.AIActionPlanItemOutcome{ItemID: item.ID, Succeeded: execErr == nil}
		if execErr != nil {
			outcome.ErrorText = execErr.Error()
			aiStage("warn", "joyboy plan %s item %d failed: %v", plan.ID, item.ID, execErr)
		}
		if err := store.RecordAIActionPlanItem(outcome); err != nil {
			aiStage("warn", "joyboy plan %s item %d: could not record the outcome yet (%v) → continuing", plan.ID, item.ID, err)
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes
}

// CancelAIActionPlanForOwner drops a pending plan without writing anything.
func (s *AIService) CancelAIActionPlanForOwner(actor AIActorContext, planID string) error {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return ErrAIActionsDisabled
	}
	if s.actionPlanStore == nil {
		return ErrAIActionUnavailable
	}
	_, err := s.actionPlanStore.CancelAIActionPlan(actor.RestaurantID, actor.OwnerUserID, planID)
	return err
}

// AIActionPlanConfirmation reports the outcome per item, so a batch that partly
// failed is visible rather than rounded to "done".
type AIActionPlanConfirmation struct {
	PlanID    string                        `json:"plan_id"`
	Status    string                        `json:"status"`
	Replayed  bool                          `json:"replayed"`
	Message   string                        `json:"message"`
	Succeeded int                           `json:"succeeded"`
	Failed    int                           `json:"failed"`
	Items     []AIActionPlanItemOutcomeView `json:"items"`
}

type AIActionPlanItemOutcomeView struct {
	Title     string `json:"title"`
	Succeeded bool   `json:"succeeded"`
	Error     string `json:"error,omitempty"`
}

func newAIActionPlanConfirmation(plan *entity.AIActionPlan, replayed bool) *AIActionPlanConfirmation {
	confirmation := &AIActionPlanConfirmation{
		PlanID:   plan.ID,
		Status:   plan.Status,
		Replayed: replayed,
	}
	for _, item := range plan.Items {
		title := aiActionItemTitle(item)
		succeeded := item.Status == entity.AIActionItemStatusExecuted
		if succeeded {
			confirmation.Succeeded++
		} else {
			confirmation.Failed++
		}
		confirmation.Items = append(confirmation.Items, AIActionPlanItemOutcomeView{
			Title:     title,
			Succeeded: succeeded,
			Error:     item.ErrorText,
		})
	}
	switch {
	case confirmation.Failed == 0:
		confirmation.Message = "บันทึกลงระบบแล้ว มีผลทันทีครับ"
	case confirmation.Succeeded == 0:
		confirmation.Message = "ทำไม่สำเร็จครับ ข้อมูลไม่ถูกเปลี่ยน"
	default:
		confirmation.Message = fmt.Sprintf("สำเร็จ %d รายการ ไม่สำเร็จ %d รายการครับ", confirmation.Succeeded, confirmation.Failed)
	}
	// The reason each item failed goes into the message itself. The chat shows
	// only Message, so without this the owner read "ไม่สำเร็จ 1 รายการ" and had
	// no way to learn that it was refused because a colleague had changed the
	// stock while the card was on screen — which is the one thing they need to
	// know to decide what to do next.
	for _, item := range confirmation.Items {
		if item.Succeeded || strings.TrimSpace(item.Error) == "" {
			continue
		}
		confirmation.Message += fmt.Sprintf("\n- %s: %s", item.Title, item.Error)
	}
	return confirmation
}

func aiActionItemTitle(item entity.AIActionPlanItem) string {
	var preview AIActionItemPreview
	if err := jsonUnmarshalString(item.PreviewJSON, &preview); err == nil && strings.TrimSpace(preview.Title) != "" {
		return preview.Title
	}
	return item.ActionType
}

// aiDropRepeats keeps the first of each identical line, order preserved. The
// owner reading the same question twice reads it as a bug, because it is one.
func aiDropRepeats(lines []string) []string {
	if len(lines) < 2 {
		return lines
	}
	seen := make(map[string]bool, len(lines))
	kept := lines[:0:0]
	for _, line := range lines {
		key := strings.TrimSpace(line)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		kept = append(kept, line)
	}
	return kept
}

// dropSwitchedOffActionTypes removes the items whose kind the owner has turned
// off in settings and reports which kinds those were. Items and Previews are
// parallel slices, so both are rebuilt together.
func (s *AIService) dropSwitchedOffActionTypes(restaurantID uint, draft AIActionPlanDraft) (AIActionPlanDraft, map[string]struct{}) {
	prefs := s.preferencesFor(restaurantID)
	off := map[string]struct{}{}
	kept := AIActionPlanDraft{Rejected: draft.Rejected}
	for index, item := range draft.Items {
		if !prefs.ActionTypeAllowed(item.ActionType) {
			off[item.ActionType] = struct{}{}
			continue
		}
		kept.Items = append(kept.Items, item)
		if index < len(draft.Previews) {
			kept.Previews = append(kept.Previews, draft.Previews[index])
		}
	}
	return kept, off
}
