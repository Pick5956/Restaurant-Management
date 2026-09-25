package service

import (
	"strings"
	"testing"

	"Project-M/internal/entity"
)


// The owner asked the same thing twice and heard it twice: "กะเพราเหลือเท่าไหร่
// แล้วสั่งเพิ่มให้หน่อย" produced two drafts about กะเพรา, both missing a
// quantity, and both questions were printed on consecutive lines.
func TestRepeatedQuestionsAreAskedOnce(t *testing.T) {
	got := aiDropRepeats([]string{
		`“กะเพรา” เท่าไหร่ครับ (หน่วยกรัม)`,
		`“กะเพรา” เท่าไหร่ครับ (หน่วยกรัม)`,
		`“หมูสับ” เท่าไหร่ครับ (หน่วยกรัม)`,
	})
	if len(got) != 2 {
		t.Fatalf("identical questions should collapse to one, got %d: %v", len(got), got)
	}
	// Order matters: the first thing the owner said should be asked about first.
	if !strings.Contains(got[0], "กะเพรา") || !strings.Contains(got[1], "หมูสับ") {
		t.Errorf("order was not preserved: %v", got)
	}
}

// The chat prints the confirmation's Message as it is. Each failed item's
// reason used to be the stored error verbatim, so the owner read "AI action
// target menu was not found" or "amount must be greater than zero" in a Thai
// conversation. A known refusal is now said in Thai, one this package already
// wrote for the owner is kept, and anything else reads a plain Thai line.
func TestConfirmationWordsEachFailureForTheOwner(t *testing.T) {
	changed := "ข้อมูลเปลี่ยนไประหว่างรอยืนยัน: สต๊อก หมูสับ 5000 กรัม → 9000 กรัม ยังไม่ได้แก้ ขอให้สั่งใหม่อีกครั้ง"
	failed := func(id uint, title, stored string) entity.AIActionPlanItem {
		return entity.AIActionPlanItem{
			ID:          id,
			Status:      entity.AIActionItemStatusFailed,
			PreviewJSON: `{"title":"` + title + `"}`,
			ErrorText:   stored,
		}
	}
	plan := &entity.AIActionPlan{ID: "plan-words", Status: entity.AIActionPlanStatusFailed, Items: []entity.AIActionPlanItem{
		failed(1, "ข้าวผัด", errAIActionTargetNotFound.Error()),
		failed(2, "ค่าน้ำแข็ง", "amount must be greater than zero"),
		failed(3, "หมูสับ", changed),
		failed(4, "ต้มยำ", "มีเมนู “ต้มยำ” อยู่แล้ว"),
		failed(5, "กุ้ง", ErrIngredientUnitLocked.Error()),
		failed(6, "ไข่ไก่", "dial tcp: connection reset by peer"),
		failed(7, "น้ำปลา", "ERROR: duplicate key value violates unique constraint (SQLSTATE 23505)"),
	}}

	confirmation := newAIActionPlanConfirmation(plan, false)

	want := map[string]string{
		"ข้าวผัด":    "ไม่พบเมนูนี้ในร้านแล้ว",
		"ค่าน้ำแข็ง": "ยอดเงินต้องมากกว่า 0",
		"หมูสับ":     changed,
		"ต้มยำ":      "มีเมนู “ต้มยำ” อยู่แล้ว",
		"กุ้ง":       "เปลี่ยนหน่วยไม่ได้ เพราะวัตถุดิบนี้อยู่ในสูตรเมนู",
		"ไข่ไก่":     aiActionFailureFallback,
		"น้ำปลา":     "มีรายการนี้อยู่แล้ว",
	}
	for _, item := range confirmation.Items {
		if item.Error != want[item.Title] {
			t.Errorf("%s: reason %q, want %q", item.Title, item.Error, want[item.Title])
		}
		if line := "\n- " + item.Title + ": " + want[item.Title]; !strings.Contains(confirmation.Message, line) {
			t.Errorf("the message should carry %q:\n%s", line, confirmation.Message)
		}
	}
	// No stored English survives into what the owner reads.
	for _, r := range confirmation.Message {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			t.Fatalf("the message carries Latin text:\n%s", confirmation.Message)
		}
	}
}

// A failed item with no stored reason is counted and not listed, as before:
// an empty reason gains no fallback line.
func TestConfirmationListsNoReasonForAnItemWithoutOne(t *testing.T) {
	plan := &entity.AIActionPlan{ID: "plan-empty", Status: entity.AIActionPlanStatusFailed, Items: []entity.AIActionPlanItem{
		{ID: 1, Status: entity.AIActionItemStatusFailed, PreviewJSON: `{"title":"กะเพรา"}`},
	}}
	confirmation := newAIActionPlanConfirmation(plan, false)
	if confirmation.Failed != 1 || confirmation.Items[0].Error != "" || strings.Contains(confirmation.Message, "กะเพรา") {
		t.Fatalf("an item without a reason should be counted and not listed: %+v", confirmation)
	}
}
