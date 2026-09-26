package service

import (
	"sort"
	"strings"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// The owner's AI preferences.
//
// The AI settings screen began as one switch: may the assistant change shop
// data at all. It grew into sections — which of the seven actions, which bell
// notifications, what the assistant calls the owner — and each of those is a
// small per-restaurant value read in one or two places. They are gathered here
// so that every reader asks the same question the same way, and so the default
// for a missing value is written down once.
//
// Every preference defaults to "on" / "all". A shop that never opened the
// settings screen behaves exactly as it did before the screen existed, and a
// stored NULL means "the owner has not chosen", never "nothing allowed".

// AIPreferences is the owner's stored choices, as the service reads them.
// Maps carry only the keys the owner has actually set; use the accessors below
// rather than reading the maps directly, so the default applies.
type AIPreferences struct {
	ActionTypes  map[string]bool
	InsightKinds map[string]bool
	OwnerTitle   string
	// RestaurantName is the shop's own name, read from the same row. Not a
	// preference — the assistant needs it so it stops calling the shop Dishy.
	RestaurantName string
}

// AIPreferenceStore reads and writes the owner's AI preferences for one
// restaurant. Separate from AIActionsSettingStore so the many test fakes of
// that interface do not have to grow methods they never use.
type AIPreferenceStore interface {
	RestaurantAIPreferences(restaurantID uint) (repository.AIPreferences, error)
	SetRestaurantAIPreferences(restaurantID uint, prefs repository.AIPreferences) error
}

// aiSettableActionTypes are the actions the owner can allow one by one — every
// type the plan pipeline knows how to execute. The order is the order the
// settings screen lists them in.
var aiSettableActionTypes = []string{
	entity.AIActionTypeSetMenuAvailability,
	entity.AIActionTypeSetMenuPrice,
	entity.AIActionTypeCreateMenuItem,
	entity.AIActionTypeAdjustIngredientStock,
	entity.AIActionTypeSetIngredientMinStock,
	entity.AIActionTypeSetIngredientCost,
	entity.AIActionTypeCreateIngredient,
	entity.AIActionTypeCreateExpense,
}

// aiInsightKinds are the proactive bell's kinds, matching the Kind values
// computeProactiveInsights writes. The two sales kinds are one choice on the
// settings screen ("ยอดขายเปลี่ยนผิดปกติ"); the frontend writes both.
var aiInsightKinds = []string{"ingredient_low", "dead_stock", "sales_drop", "sales_up", "plowhorse"}

// aiDefaultOwnerTitle is how the assistant addresses the owner when they have
// not said otherwise — the greeting the screen has always shown.
const aiDefaultOwnerTitle = "คุณผู้จัดการ"

// aiOwnerTitleMaxRunes bounds the title so it stays a form of address rather
// than a paragraph the persona has to carry on every call.
const aiOwnerTitleMaxRunes = 40

// ActionTypeAllowed reports whether the owner has left this action type on.
// Unknown types are allowed too — the CHECK constraint on the plan table, not
// this map, decides what can be stored at all.
func (p AIPreferences) ActionTypeAllowed(actionType string) bool {
	if p.ActionTypes == nil {
		return true
	}
	allowed, set := p.ActionTypes[actionType]
	return !set || allowed
}

// InsightKindShown reports whether the bell should carry insights of this kind.
func (p AIPreferences) InsightKindShown(kind string) bool {
	if p.InsightKinds == nil {
		return true
	}
	shown, set := p.InsightKinds[kind]
	return !set || shown
}

// Title is what the assistant calls the owner, with the default applied.
func (p AIPreferences) Title() string {
	if title := strings.TrimSpace(p.OwnerTitle); title != "" {
		return title
	}
	return aiDefaultOwnerTitle
}

// fullActionTypes returns every settable type with its current choice — what
// the settings screen renders, with no missing rows.
func (p AIPreferences) fullActionTypes() map[string]bool {
	out := make(map[string]bool, len(aiSettableActionTypes))
	for _, actionType := range aiSettableActionTypes {
		out[actionType] = p.ActionTypeAllowed(actionType)
	}
	return out
}

func (p AIPreferences) fullInsightKinds() map[string]bool {
	out := make(map[string]bool, len(aiInsightKinds))
	for _, kind := range aiInsightKinds {
		out[kind] = p.InsightKindShown(kind)
	}
	return out
}

// preferencesFor reads the owner's preferences, falling back to the defaults
// when no store is wired (unit tests) or the read fails — a failed read must
// not switch an action off that the owner has on.
func (s *AIService) preferencesFor(restaurantID uint) AIPreferences {
	if s.preferences == nil || restaurantID == 0 {
		return AIPreferences{}
	}
	stored, err := s.preferences.RestaurantAIPreferences(restaurantID)
	if err != nil {
		aiStage("warn", "AI preferences for restaurant %d could not be read (%v) → using defaults", restaurantID, err)
		return AIPreferences{}
	}
	return AIPreferences(stored)
}

// actionTypeAllowed is the per-type gate: the master switch first, then the
// owner's choice for this one action.
func (s *AIService) actionTypeAllowed(restaurantID uint, actionType string) bool {
	if !s.ownerActionsEnabled(restaurantID) {
		return false
	}
	return s.preferencesFor(restaurantID).ActionTypeAllowed(actionType)
}

// aiActionTypeThai names an action the way the settings screen does, for the
// sentence that says one was switched off.
func aiActionTypeThai(actionType string) string {
	switch actionType {
	case entity.AIActionTypeSetMenuAvailability:
		return "เปิด–ปิดขายเมนู"
	case entity.AIActionTypeSetMenuPrice:
		return "เปลี่ยนราคาเมนู"
	case entity.AIActionTypeCreateMenuItem:
		return "เพิ่มเมนูใหม่"
	case entity.AIActionTypeAdjustIngredientStock:
		return "ปรับจำนวนสต๊อก"
	case entity.AIActionTypeSetIngredientMinStock:
		return "ตั้งสต๊อกขั้นต่ำ"
	case entity.AIActionTypeSetIngredientCost:
		return "ตั้งต้นทุนต่อหน่วย"
	case entity.AIActionTypeCreateIngredient:
		return "เพิ่มวัตถุดิบใหม่"
	case entity.AIActionTypeCreateExpense:
		return "บันทึกรายจ่าย"
	}
	return actionType
}

// aiActionTypesOffSentence tells the owner which kinds of change were dropped
// because they are switched off, naming each once in settings order.
func aiActionTypesOffSentence(types map[string]struct{}) string {
	names := make([]string, 0, len(types))
	for actionType := range types {
		names = append(names, aiActionTypeThai(actionType))
	}
	sort.Slice(names, func(i, j int) bool {
		return aiActionTypeOrder(names[i]) < aiActionTypeOrder(names[j])
	})
	return "ผมยังทำ " + strings.Join(names, " และ ") + " ให้ไม่ได้ครับ เพราะปิดไว้ในตั้งค่า Dishy AI หัวข้อ “สิทธิ์ของผู้ช่วย” เปิดแล้วสั่งใหม่ได้เลย"
}

func aiActionTypeOrder(thaiName string) int {
	for index, actionType := range aiSettableActionTypes {
		if aiActionTypeThai(actionType) == thaiName {
			return index
		}
	}
	return len(aiSettableActionTypes)
}
