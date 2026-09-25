//go:build ai_eval

package repository

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"
)

// An executed plan item leaves exactly one audit row naming the owner and the
// card's own words; a failed item and a second record of the same item leave
// none. Rollback-only, same gate as the preview scenario.
func TestPostgresAIActionPlanItemWritesOneAuditRow(t *testing.T) {
	database := actionPreviewScenarioDBOrSkip(t)
	tx := database.Begin()
	if tx.Error != nil {
		t.Fatalf("begin: %v", tx.Error)
	}
	t.Cleanup(func() {
		if err := tx.Rollback().Error; err != nil && !strings.Contains(err.Error(), "already been committed or rolled back") {
			t.Errorf("rollback: %v", err)
		}
	})

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	owner := entity.User{
		Email: "ai-plan-audit-" + suffix + "@example.invalid", AuthProvider: "local",
		FirstName: "AI", LastName: "Owner", Status: "active",
	}
	if err := tx.Create(&owner).Error; err != nil {
		t.Fatalf("create owner: %v", err)
	}
	restaurant := entity.Restaurant{Name: "[AI PLAN AUDIT TEST] " + suffix, OwnerID: owner.ID}
	if err := tx.Omit("Owner").Create(&restaurant).Error; err != nil {
		t.Fatalf("create restaurant: %v", err)
	}

	repo := NewAIActionPlanRepository(tx)
	plan, _, err := repo.CreateAIActionPlan(CreateAIActionPlanParams{
		RestaurantID: restaurant.ID, OwnerUserID: owner.ID, Summary: "test",
		Items: []CreateAIActionPlanItemParams{
			{ActionType: entity.AIActionTypeAdjustIngredientStock, PayloadJSON: `{}`, PreviewJSON: `{"title":"หมูสับ","change":"2000 → 4000"}`},
			{ActionType: entity.AIActionTypeSetIngredientCost, PayloadJSON: `{}`, PreviewJSON: `{"title":"กุ้ง","change":"0.3 → 0.35"}`},
		},
	})
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	var items []entity.AIActionPlanItem
	if err := tx.Where("plan_id = ?", plan.ID).Order("seq asc").Find(&items).Error; err != nil || len(items) != 2 {
		t.Fatalf("plan items = %d err=%v", len(items), err)
	}

	for _, outcome := range []AIActionPlanItemOutcome{
		{ItemID: items[0].ID, Succeeded: true},
		{ItemID: items[0].ID, Succeeded: true}, // a re-claim records it again
		{ItemID: items[1].ID, Succeeded: false, ErrorText: "stale"},
	} {
		if err := repo.RecordAIActionPlanItem(outcome); err != nil {
			t.Fatalf("record %+v: %v", outcome, err)
		}
	}

	var logs []entity.RestaurantAuditLog
	if err := tx.Where("restaurant_id = ? AND action = ?", restaurant.ID, entity.AuditActionAIPlanItem).Find(&logs).Error; err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if len(logs) != 1 {
		t.Fatalf("audit rows = %d, want 1 (executed once, failed none)", len(logs))
	}
	if logs[0].ActorUserID == nil || *logs[0].ActorUserID != owner.ID {
		t.Fatalf("audit actor = %v, want owner %d", logs[0].ActorUserID, owner.ID)
	}
	details := string(logs[0].Details)
	for _, want := range []string{"หมูสับ", "2000 → 4000", plan.ID} {
		if !strings.Contains(details, want) {
			t.Fatalf("audit details %s missing %q", details, want)
		}
	}
}
