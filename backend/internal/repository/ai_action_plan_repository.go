package repository

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The multi-item action boundary.
//
// It keeps every property that made the single-menu preview safe — token stored
// only as a SHA-256 digest, a short expiry, owner + restaurant scoping, one-shot
// confirmation — and adds the two things a batched command needs: N items of
// possibly different types, and a per-item outcome.
//
// Confirmation is deliberately split into claim → execute → finish. Items are
// executed by the caller through the existing services (the same code a button
// press runs), so their transactions must not nest inside a long-held plan lock.
// Claiming flips the row to "executing" under a lock, which is what makes a
// double confirmation safe without holding that lock while stock is written.

var (
	ErrAIActionPlanNotFound        = errors.New("AI action plan was not found")
	ErrAIActionPlanInvalidToken    = errors.New("AI action plan confirmation token is invalid")
	ErrAIActionPlanExpired         = errors.New("AI action plan has expired")
	ErrAIActionPlanCancelled       = errors.New("AI action plan was cancelled")
	ErrAIActionPlanAlreadyExecuted = errors.New("AI action plan was already executed")
	ErrAIActionPlanInProgress      = errors.New("AI action plan is already being executed")
	ErrAIActionPlanEmpty           = errors.New("AI action plan has no items")
	ErrAIActionPlanTooManyItems    = errors.New("AI action plan has too many items")
)

const (
	// One minute, matching the single-action preview: long enough to read the
	// confirm bar, short enough that a forgotten command stops being a live write.
	AIActionPlanTTL = AIActionPreviewTTL
	// A plan is what one sentence asked for. Twenty is far above any real command
	// and low enough that a confirmation stays reviewable at a glance.
	AIActionPlanMaxItems = 20
	// A claim older than this is treated as abandoned (the process died mid-run)
	// and may be re-claimed rather than blocking the owner forever.
	aiActionPlanClaimTimeout = 2 * time.Minute
)

type AIActionPlanRepository struct {
	db     *gorm.DB
	now    func() time.Time
	random io.Reader
}

func NewAIActionPlanRepository(db *gorm.DB) *AIActionPlanRepository {
	return &AIActionPlanRepository{db: db, now: time.Now, random: rand.Reader}
}

func (r *AIActionPlanRepository) currentTime() time.Time {
	if r != nil && r.now != nil {
		return r.now()
	}
	return time.Now().UTC()
}

func (r *AIActionPlanRepository) randomSource() io.Reader {
	if r != nil && r.random != nil {
		return r.random
	}
	return rand.Reader
}

// CreateAIActionPlanItemParams is one validated change. The service builds the
// payload; the repository never parses model output.
type CreateAIActionPlanItemParams struct {
	ActionType  string
	PayloadJSON string
	PreviewJSON string
}

type CreateAIActionPlanParams struct {
	RestaurantID   uint
	OwnerUserID    uint
	ConversationID string
	TurnID         string
	Summary        string
	Items          []CreateAIActionPlanItemParams
}

// CreateAIActionPlan stores a pending plan and returns its one-time plaintext
// confirmation token. Only the token digest is persisted; callers hand the token
// to the authenticated owner and never log it.
func (r *AIActionPlanRepository) CreateAIActionPlan(params CreateAIActionPlanParams) (*entity.AIActionPlan, string, error) {
	if r == nil || r.db == nil {
		return nil, "", errors.New("AI action plan repository is not connected")
	}
	if params.RestaurantID == 0 || params.OwnerUserID == 0 {
		return nil, "", errors.New("AI action plan requires an owner and a restaurant")
	}
	if len(params.Items) == 0 {
		return nil, "", ErrAIActionPlanEmpty
	}
	if len(params.Items) > AIActionPlanMaxItems {
		return nil, "", ErrAIActionPlanTooManyItems
	}
	for _, item := range params.Items {
		if !entity.IsAllowedAIActionType(item.ActionType) {
			return nil, "", fmt.Errorf("AI action type %q is outside the reviewed allowlist", item.ActionType)
		}
	}

	id, err := generateAIActionPlanID(r.randomSource())
	if err != nil {
		return nil, "", err
	}
	token, tokenHash, err := generateAIActionConfirmationToken(r.randomSource())
	if err != nil {
		return nil, "", err
	}

	now := r.currentTime()
	plan := entity.AIActionPlan{
		ID:                    id,
		RestaurantID:          params.RestaurantID,
		OwnerUserID:           params.OwnerUserID,
		Summary:               aiActionTrimTo(params.Summary, 400),
		ConfirmationTokenHash: tokenHash,
		Status:                entity.AIActionPlanStatusPending,
		ExpiresAt:             now.Add(AIActionPlanTTL),
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if conversationID := strings.TrimSpace(params.ConversationID); conversationID != "" {
		plan.ConversationID = &conversationID
	}
	if turnID := strings.TrimSpace(params.TurnID); turnID != "" {
		plan.TurnID = &turnID
	}

	items := make([]entity.AIActionPlanItem, 0, len(params.Items))
	for index, item := range params.Items {
		items = append(items, entity.AIActionPlanItem{
			PlanID:      id,
			Seq:         index,
			ActionType:  item.ActionType,
			PayloadJSON: aiActionDefaultJSONObject(item.PayloadJSON),
			PreviewJSON: aiActionDefaultJSONObject(item.PreviewJSON),
			Status:      entity.AIActionItemStatusPending,
			CreatedAt:   now,
			UpdatedAt:   now,
		})
	}

	err = r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&plan).Error; err != nil {
			return fmt.Errorf("create AI action plan: %w", err)
		}
		if err := tx.Create(&items).Error; err != nil {
			return fmt.Errorf("create AI action plan items: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, "", err
	}
	plan.Items = items
	return &plan, token, nil
}

// FindAIActionPlan loads a plan and its items for the owner who created it.
func (r *AIActionPlanRepository) FindAIActionPlan(restaurantID, ownerUserID uint, planID string) (*entity.AIActionPlan, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("AI action plan repository is not connected")
	}
	var plan entity.AIActionPlan
	err := r.db.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("seq asc") }).
		Where("id = ? AND restaurant_id = ? AND owner_user_id = ?", strings.TrimSpace(planID), restaurantID, ownerUserID).
		First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrAIActionPlanNotFound
	}
	if err != nil {
		return nil, err
	}
	return &plan, nil
}

// PendingAIActionPlan returns the owner's newest plan that is still waiting for
// a button press, or nil when there is none.
//
// It exists because the assistant could not tell that it had already asked. The
// owner typed "เพิ่มหมูสับ 2 กิโล", got a confirm card, answered "โอเค" — and got
// a second identical card, because the model reads the conversation as text and
// a card waiting on screen is not text. Nothing was written twice (the button is
// still the only way through), but the owner was asked the same question twice.
//
// Expired rows are excluded here rather than filtered by the caller: a plan past
// its minute cannot be confirmed, so pointing the owner at its button would be
// worse than saying nothing.
func (r *AIActionPlanRepository) PendingAIActionPlan(restaurantID, ownerUserID uint) (*entity.AIActionPlan, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("AI action plan repository is not connected")
	}
	var plan entity.AIActionPlan
	err := r.db.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("seq asc") }).
		Where("restaurant_id = ? AND owner_user_id = ? AND status = ? AND expires_at > ?",
			restaurantID, ownerUserID, entity.AIActionPlanStatusPending, r.currentTime()).
		Order("created_at desc").
		First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &plan, nil
}

// ClaimAIActionPlan verifies the confirmation token under a row lock and flips
// the plan to "executing", which is what makes a second confirmation a no-op.
// It returns replayed=true when the plan already finished, so a retried request
// reports the original outcome instead of running anything twice.
func (r *AIActionPlanRepository) ClaimAIActionPlan(restaurantID, ownerUserID uint, planID, confirmationToken string) (plan *entity.AIActionPlan, replayed bool, err error) {
	if r == nil || r.db == nil {
		return nil, false, errors.New("AI action plan repository is not connected")
	}
	presentedHash, err := hashPresentedAIActionToken(confirmationToken)
	if err != nil {
		return nil, false, err
	}
	id := strings.TrimSpace(planID)
	if id == "" {
		return nil, false, ErrAIActionPlanNotFound
	}

	err = r.db.Transaction(func(tx *gorm.DB) error {
		var locked entity.AIActionPlan
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND restaurant_id = ? AND owner_user_id = ?", id, restaurantID, ownerUserID).
			First(&locked)
		if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return ErrAIActionPlanNotFound
		}
		if lookup.Error != nil {
			return lookup.Error
		}
		if !aiActionConfirmationTokenMatches(locked.ConfirmationTokenHash, presentedHash) {
			return ErrAIActionPlanInvalidToken
		}

		now := r.currentTime()
		switch locked.Status {
		case entity.AIActionPlanStatusExecuted, entity.AIActionPlanStatusPartial, entity.AIActionPlanStatusFailed:
			// Already finished: report the stored outcome, run nothing.
			replayed = true
		case entity.AIActionPlanStatusCancelled:
			return ErrAIActionPlanCancelled
		case entity.AIActionPlanStatusExpired:
			return ErrAIActionPlanExpired
		case entity.AIActionPlanStatusExecuting:
			if locked.ClaimedAt != nil && now.Sub(*locked.ClaimedAt) < aiActionPlanClaimTimeout {
				return ErrAIActionPlanInProgress
			}
			if err := aiActionPlanClaim(tx, &locked, now); err != nil {
				return err
			}
		case entity.AIActionPlanStatusPending:
			if !now.Before(locked.ExpiresAt) {
				if err := tx.Model(&entity.AIActionPlan{}).
					Where("id = ?", locked.ID).
					Updates(map[string]any{"status": entity.AIActionPlanStatusExpired, "completed_at": now, "updated_at": now}).Error; err != nil {
					return err
				}
				return ErrAIActionPlanExpired
			}
			if err := aiActionPlanClaim(tx, &locked, now); err != nil {
				return err
			}
		default:
			return fmt.Errorf("AI action plan has an unexpected status %q", locked.Status)
		}

		var items []entity.AIActionPlanItem
		if err := tx.Where("plan_id = ?", locked.ID).Order("seq asc").Find(&items).Error; err != nil {
			return err
		}
		locked.Items = items
		plan = &locked
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return plan, replayed, nil
}

func aiActionPlanClaim(tx *gorm.DB, plan *entity.AIActionPlan, now time.Time) error {
	if err := tx.Model(&entity.AIActionPlan{}).
		Where("id = ?", plan.ID).
		Updates(map[string]any{"status": entity.AIActionPlanStatusExecuting, "claimed_at": now, "updated_at": now}).Error; err != nil {
		return err
	}
	plan.Status = entity.AIActionPlanStatusExecuting
	claimed := now
	plan.ClaimedAt = &claimed
	return nil
}

// AIActionPlanItemOutcome is one executed item's result, written back by
// FinishAIActionPlan after the caller ran it through the normal services.
type AIActionPlanItemOutcome struct {
	ItemID    uint
	Succeeded bool
	ErrorText string
}

// RecordAIActionPlanItem writes one item's outcome as soon as it is known,
// before the next item runs. FinishAIActionPlan used to be the only writer, at
// the end of the whole plan — so a process that died between item 1 and item 2
// left every item "pending", the plan stuck in "executing", and the re-claim
// two minutes later ran item 1 again: a delivery booked twice, with the
// automatic expense row that cannot be deleted. With the outcome on disk per
// item, a re-claim can skip what already happened.
func (r *AIActionPlanRepository) RecordAIActionPlanItem(outcome AIActionPlanItemOutcome) error {
	if r == nil || r.db == nil {
		return errors.New("AI action plan repository is not connected")
	}
	itemStatus := entity.AIActionItemStatusExecuted
	if !outcome.Succeeded {
		itemStatus = entity.AIActionItemStatusFailed
	}
	now := r.currentTime()
	return r.db.Transaction(func(tx *gorm.DB) error {
		// "Not already executed" makes the audit row below happen once per
		// write, even when a re-claimed plan records the same item again.
		result := tx.Model(&entity.AIActionPlanItem{}).
			Where("id = ? AND status <> ?", outcome.ItemID, entity.AIActionItemStatusExecuted).
			Updates(map[string]any{
				"status":     itemStatus,
				"error_text": aiActionTrimTo(outcome.ErrorText, 400),
				"updated_at": now,
			})
		if result.Error != nil || result.RowsAffected == 0 || !outcome.Succeeded {
			return result.Error
		}
		return createAIPlanItemAuditLog(tx, outcome.ItemID, now)
	})
}

// createAIPlanItemAuditLog records who changed what when a confirmed plan item
// has just been written. Only the single-menu preview used to leave an audit
// row; a stock, cost, minimum, new ingredient, menu or expense changed through
// the assistant left none, so the activity tab could not say who did it
// (found 23 ก.ย. 2569).
func createAIPlanItemAuditLog(tx *gorm.DB, itemID uint, now time.Time) error {
	var item entity.AIActionPlanItem
	if err := tx.Preload("Plan").Where("id = ?", itemID).First(&item).Error; err != nil {
		return err
	}
	if item.Plan == nil {
		return nil
	}
	var preview struct {
		Title  string `json:"title"`
		Change string `json:"change"`
	}
	_ = json.Unmarshal([]byte(item.PreviewJSON), &preview)
	details, err := marshalAIActionResultJSON(map[string]interface{}{
		"action_plan_id": item.PlanID,
		"item_id":        item.ID,
		"action_type":    item.ActionType,
		"title":          preview.Title,
		"change":         preview.Change,
	})
	if err != nil {
		return err
	}
	actorID := item.Plan.OwnerUserID
	auditLog := &entity.RestaurantAuditLog{
		RestaurantID: item.Plan.RestaurantID,
		ActorUserID:  &actorID,
		Action:       entity.AuditActionAIPlanItem,
		Details:      details,
	}
	auditLog.CreatedAt = now
	auditLog.UpdatedAt = now
	return tx.Omit("ActorUser", "TargetUser", "Invitation").Create(auditLog).Error
}

// FinishAIActionPlan records per-item outcomes and the plan's final status:
// executed when every item succeeded, failed when none did, partial in between.
func (r *AIActionPlanRepository) FinishAIActionPlan(planID string, outcomes []AIActionPlanItemOutcome) (*entity.AIActionPlan, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("AI action plan repository is not connected")
	}
	id := strings.TrimSpace(planID)
	now := r.currentTime()

	succeeded, failed := 0, 0
	for _, outcome := range outcomes {
		if outcome.Succeeded {
			succeeded++
		} else {
			failed++
		}
	}
	status := entity.AIActionPlanStatusExecuted
	switch {
	case succeeded == 0:
		status = entity.AIActionPlanStatusFailed
	case failed > 0:
		status = entity.AIActionPlanStatusPartial
	}

	var plan entity.AIActionPlan
	err := r.db.Transaction(func(tx *gorm.DB) error {
		for _, outcome := range outcomes {
			itemStatus := entity.AIActionItemStatusExecuted
			if !outcome.Succeeded {
				itemStatus = entity.AIActionItemStatusFailed
			}
			if err := tx.Model(&entity.AIActionPlanItem{}).
				Where("id = ?", outcome.ItemID).
				Updates(map[string]any{
					"status":     itemStatus,
					"error_text": aiActionTrimTo(outcome.ErrorText, 400),
					"updated_at": now,
				}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&entity.AIActionPlan{}).
			Where("id = ?", id).
			Updates(map[string]any{"status": status, "completed_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		return tx.Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("seq asc") }).
			Where("id = ?", id).First(&plan).Error
	})
	if err != nil {
		return nil, err
	}
	return &plan, nil
}

// CancelAIActionPlan marks a pending plan cancelled. Cancelling twice is not an
// error; cancelling something already executed is.
func (r *AIActionPlanRepository) CancelAIActionPlan(restaurantID, ownerUserID uint, planID string) (*entity.AIActionPlan, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("AI action plan repository is not connected")
	}
	var plan entity.AIActionPlan
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var locked entity.AIActionPlan
		lookup := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND restaurant_id = ? AND owner_user_id = ?", strings.TrimSpace(planID), restaurantID, ownerUserID).
			First(&locked)
		if errors.Is(lookup.Error, gorm.ErrRecordNotFound) {
			return ErrAIActionPlanNotFound
		}
		if lookup.Error != nil {
			return lookup.Error
		}
		switch locked.Status {
		case entity.AIActionPlanStatusCancelled:
			plan = locked
			return nil
		case entity.AIActionPlanStatusExecuted, entity.AIActionPlanStatusPartial:
			return ErrAIActionPlanAlreadyExecuted
		case entity.AIActionPlanStatusExecuting:
			return ErrAIActionPlanInProgress
		}
		now := r.currentTime()
		if err := tx.Model(&entity.AIActionPlan{}).
			Where("id = ?", locked.ID).
			Updates(map[string]any{"status": entity.AIActionPlanStatusCancelled, "completed_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		locked.Status = entity.AIActionPlanStatusCancelled
		locked.CompletedAt = &now
		plan = locked
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &plan, nil
}

func generateAIActionPlanID(source io.Reader) (string, error) {
	value := make([]byte, aiActionPreviewIDBytes)
	if _, err := io.ReadFull(source, value); err != nil {
		return "", fmt.Errorf("generate AI action plan id: %w", err)
	}
	return hex.EncodeToString(value), nil
}

func aiActionDefaultJSONObject(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return "{}"
	}
	return raw
}

func aiActionTrimTo(value string, max int) string {
	trimmed := strings.TrimSpace(value)
	runes := []rune(trimmed)
	if len(runes) <= max {
		return trimmed
	}
	return string(runes[:max])
}
