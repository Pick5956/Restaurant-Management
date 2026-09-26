package service

import (
	"errors"
	"strings"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// A store that remembers what was written, so a patch can be checked for
// leaving untouched switches alone.
type fakeAIPreferenceStore struct {
	prefs   repository.AIPreferences
	readErr error
	writes  int
}

func (f *fakeAIPreferenceStore) RestaurantAIPreferences(uint) (repository.AIPreferences, error) {
	if f.readErr != nil {
		return repository.AIPreferences{}, f.readErr
	}
	return f.prefs, nil
}

func (f *fakeAIPreferenceStore) SetRestaurantAIPreferences(_ uint, prefs repository.AIPreferences) error {
	f.prefs = prefs
	f.writes++
	return nil
}

// A shop that has never opened the settings screen has NULL in both columns,
// and NULL has to mean "everything on" — not "nothing allowed" — or the day the
// column ships every owner's assistant goes quiet.
func TestAIPreferencesDefaultToEverythingOn(t *testing.T) {
	var prefs AIPreferences
	for _, actionType := range aiSettableActionTypes {
		if !prefs.ActionTypeAllowed(actionType) {
			t.Errorf("%s is off for a shop that never chose anything", actionType)
		}
	}
	for _, kind := range aiInsightKinds {
		if !prefs.InsightKindShown(kind) {
			t.Errorf("insight %s is hidden for a shop that never chose anything", kind)
		}
	}
	if prefs.Title() != aiDefaultOwnerTitle {
		t.Errorf("default title = %q, want %q", prefs.Title(), aiDefaultOwnerTitle)
	}
}

// One switch off leaves the other six on: the map carries only what the owner
// set, and a missing key is still "allowed".
func TestAIPreferencesOneSwitchOff(t *testing.T) {
	prefs := AIPreferences{ActionTypes: map[string]bool{entity.AIActionTypeSetMenuPrice: false}}
	if prefs.ActionTypeAllowed(entity.AIActionTypeSetMenuPrice) {
		t.Error("a switch the owner turned off reads as on")
	}
	if !prefs.ActionTypeAllowed(entity.AIActionTypeAdjustIngredientStock) {
		t.Error("a switch the owner never touched reads as off")
	}
	full := prefs.fullActionTypes()
	if len(full) != len(aiSettableActionTypes) {
		t.Errorf("the screen payload has %d rows, want %d", len(full), len(aiSettableActionTypes))
	}
	if full[entity.AIActionTypeSetMenuPrice] || !full[entity.AIActionTypeCreateExpense] {
		t.Errorf("full map does not reflect the choice: %v", full)
	}
}

// The screen saves each switch as it is flipped. A save carrying one key must
// not reset the others, and the title is trimmed and bounded.
func TestApplyAISettingsPatchKeepsWhatItDidNotTouch(t *testing.T) {
	store := &fakeAIPreferenceStore{prefs: repository.AIPreferences{
		ActionTypes:  map[string]bool{entity.AIActionTypeSetMenuPrice: false},
		InsightKinds: map[string]bool{"plowhorse": false},
	}}
	s := &AIService{preferences: store}

	on := true
	if err := s.ApplyAISettingsPatchForOwner(1, AISettingsPatch{
		ActionTypes: map[string]bool{entity.AIActionTypeCreateExpense: false},
		InsightKinds: map[string]bool{"sales_drop": false, "sales_up": false},
		OwnerTitle:   ptrString("  พี่เก่ง   "),
	}); err != nil {
		t.Fatalf("patch: %v", err)
	}
	_ = on
	got := AIPreferences(store.prefs)
	if got.ActionTypeAllowed(entity.AIActionTypeSetMenuPrice) {
		t.Error("an earlier choice (menu price off) was lost by a patch that did not mention it")
	}
	if got.ActionTypeAllowed(entity.AIActionTypeCreateExpense) {
		t.Error("the patched switch (expense off) did not stick")
	}
	if got.InsightKindShown("plowhorse") || got.InsightKindShown("sales_drop") || got.InsightKindShown("sales_up") {
		t.Errorf("insight choices wrong after patch: %v", got.InsightKinds)
	}
	if got.OwnerTitle != "พี่เก่ง" {
		t.Errorf("title not trimmed: %q", got.OwnerTitle)
	}

	// An unknown key from a stale frontend is dropped, not refused.
	if err := s.ApplyAISettingsPatchForOwner(1, AISettingsPatch{ActionTypes: map[string]bool{"teleport_food": false}}); err != nil {
		t.Errorf("an unknown action type should be ignored, got %v", err)
	}
	if _, stored := AIPreferences(store.prefs).ActionTypes["teleport_food"]; stored {
		t.Error("an unknown action type was written to the row")
	}

	// A title longer than a form of address is refused.
	if err := s.ApplyAISettingsPatchForOwner(1, AISettingsPatch{OwnerTitle: ptrString(strings.Repeat("ก", aiOwnerTitleMaxRunes+1))}); err == nil {
		t.Error("an over-long title was accepted")
	}
}

// A read that fails must not switch anything off. The gate falls back to the
// defaults and says so in the log; a database hiccup is not the owner's choice.
func TestPreferencesForFallsBackToDefaultsOnError(t *testing.T) {
	s := &AIService{preferences: &fakeAIPreferenceStore{readErr: errors.New("connection reset")}}
	prefs := s.preferencesFor(1)
	if !prefs.ActionTypeAllowed(entity.AIActionTypeSetMenuAvailability) {
		t.Error("a failed read switched an action off")
	}
}

// The plan builder returns parallel Items and Previews. Dropping a switched-off
// kind must keep them aligned, or the card shows the wrong preview under the
// wrong item.
func TestDropSwitchedOffActionTypesKeepsItemsAndPreviewsAligned(t *testing.T) {
	s := &AIService{preferences: &fakeAIPreferenceStore{prefs: repository.AIPreferences{
		ActionTypes: map[string]bool{entity.AIActionTypeSetMenuPrice: false},
	}}}
	draft := AIActionPlanDraft{
		Items: []repository.CreateAIActionPlanItemParams{
			{ActionType: entity.AIActionTypeAdjustIngredientStock},
			{ActionType: entity.AIActionTypeSetMenuPrice},
			{ActionType: entity.AIActionTypeCreateExpense},
		},
		Previews: []AIActionItemPreview{{Title: "หมูสับ"}, {Title: "ผัดไทย"}, {Title: "ค่าแก๊ส"}},
	}
	kept, off := s.dropSwitchedOffActionTypes(1, draft)
	if len(kept.Items) != 2 || len(kept.Previews) != 2 {
		t.Fatalf("kept %d items and %d previews, want 2 and 2", len(kept.Items), len(kept.Previews))
	}
	if kept.Previews[1].Title != "ค่าแก๊ส" {
		t.Errorf("previews fell out of step with items: %+v", kept.Previews)
	}
	if _, dropped := off[entity.AIActionTypeSetMenuPrice]; !dropped || len(off) != 1 {
		t.Errorf("wrong set of switched-off kinds: %v", off)
	}
	sentence := aiActionTypesOffSentence(off)
	if !strings.Contains(sentence, "เปลี่ยนราคาเมนู") || !strings.Contains(sentence, "สิทธิ์ของผู้ช่วย") {
		t.Errorf("the refusal does not name the kind and where to switch it on:\n%s", sentence)
	}
}

func ptrString(s string) *string { return &s }
