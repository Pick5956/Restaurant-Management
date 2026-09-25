package repository

import (
	"errors"
	"strings"

	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ErrAIActionPlanItemNotEditable is returned when the item asked for is not one
// the card may fill in: another action type, or one that already ran.
var ErrAIActionPlanItemNotEditable = errors.New("รายการนี้แก้จากการ์ดไม่ได้")

// AIActionPlanItemRevision rebuilds one item from what it holds now. It
// returns the new payload and preview; an error leaves the item untouched.
type AIActionPlanItemRevision func(item entity.AIActionPlanItem) (payloadJSON, previewJSON string, err error)

// ReviseAIActionPlanItem lets the card answer the questions a new ingredient
// was created with — its unit, how it is bought, what it cost (25 ก.ย. 2569).
//
// The same checks as a confirmation guard it: the plan must belong to this
// owner, carry the card's token, still be pending and not expired. Only a
// create_ingredient item can be revised, because it is the one action whose
// preview asks questions instead of stating a change.
//
// Every answer counts as the owner still being at the card, so the plan's
// one-minute window restarts. A card with four questions could not be
// finished inside one minute otherwise, and a card left alone still expires.
func (r *AIActionPlanRepository) ReviseAIActionPlanItem(restaurantID, ownerUserID uint, planID, confirmationToken string, seq int, revise AIActionPlanItemRevision) (*entity.AIActionPlan, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("AI action plan repository is not connected")
	}
	presentedHash, err := hashPresentedAIActionToken(confirmationToken)
	if err != nil {
		return nil, ErrAIActionPlanInvalidToken
	}
	id := strings.TrimSpace(planID)
	if id == "" {
		return nil, ErrAIActionPlanNotFound
	}

	var plan *entity.AIActionPlan
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
		case entity.AIActionPlanStatusPending:
			if !now.Before(locked.ExpiresAt) {
				return ErrAIActionPlanExpired
			}
		case entity.AIActionPlanStatusCancelled:
			return ErrAIActionPlanCancelled
		case entity.AIActionPlanStatusExpired:
			return ErrAIActionPlanExpired
		case entity.AIActionPlanStatusExecuting:
			return ErrAIActionPlanInProgress
		default:
			return ErrAIActionPlanAlreadyExecuted
		}

		var item entity.AIActionPlanItem
		found := tx.Where("plan_id = ? AND seq = ?", locked.ID, seq).First(&item)
		if errors.Is(found.Error, gorm.ErrRecordNotFound) {
			return ErrAIActionPlanItemNotEditable
		}
		if found.Error != nil {
			return found.Error
		}
		if item.ActionType != entity.AIActionTypeCreateIngredient || item.Status != entity.AIActionItemStatusPending {
			return ErrAIActionPlanItemNotEditable
		}
		payloadJSON, previewJSON, err := revise(item)
		if err != nil {
			return err
		}
		if err := tx.Model(&entity.AIActionPlanItem{}).Where("id = ?", item.ID).
			Updates(map[string]any{
				"payload_json": aiActionDefaultJSONObject(payloadJSON),
				"preview_json": aiActionDefaultJSONObject(previewJSON),
				"updated_at":   now,
			}).Error; err != nil {
			return err
		}
		expires := now.Add(AIActionPlanTTL)
		if err := tx.Model(&entity.AIActionPlan{}).Where("id = ?", locked.ID).
			Updates(map[string]any{"expires_at": expires, "updated_at": now}).Error; err != nil {
			return err
		}
		locked.ExpiresAt = expires

		var items []entity.AIActionPlanItem
		if err := tx.Where("plan_id = ?", locked.ID).Order("seq asc").Find(&items).Error; err != nil {
			return err
		}
		locked.Items = items
		plan = &locked
		return nil
	})
	if err != nil {
		return nil, err
	}
	return plan, nil
}
