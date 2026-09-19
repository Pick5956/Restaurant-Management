package service

import (
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// The one rule every stock write must keep. Runs only with
// ORDER_DB_INTEGRATION_ENABLED=1 against a throwaway schema, like the other
// order/inventory DB tests — a dry run cannot prove arithmetic across rows.
func TestLotsAlwaysSumToStock(t *testing.T) {
	db := orderVoidIntegrationDBOrSkip(t)
	scenario := newOrderVoidDBScenario(t, db)
	repo := repository.NewIngredientRepository(db)
	svc := ProvideIngredientService(repo)
	rid := scenario.restaurant.ID

	mustSum := func(step string, ingredientID uint) {
		t.Helper()
		var ing entity.Ingredient
		if err := db.First(&ing, ingredientID).Error; err != nil {
			t.Fatalf("%s: reload: %v", step, err)
		}
		total, err := repo.SumLotRemaining(rid, ingredientID)
		if err != nil {
			t.Fatalf("%s: sum: %v", step, err)
		}
		if diff := ing.Stock - total; diff > 0.0001 || diff < -0.0001 {
			t.Fatalf("%s: stock %.4f but lots sum %.4f", step, ing.Stock, total)
		}
	}

	// Opening stock with a date → one dated lot.
	created, err := svc.Create(rid, scenario.user.ID, &IngredientRequest{
		Name: "หมูสับ", Unit: "กรัม", Stock: 1000, MinStock: 200, CostPerUnit: 0.15, ExpiresAt: "2026-09-15",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	mustSum("opening", created.ID)

	// Second delivery, later date → second lot; the earlier date must still win.
	if _, err := svc.AdjustStock(rid, created.ID, scenario.user.ID, &AdjustStockRequest{Type: "in", Quantity: 3000, ExpiresAt: "2026-09-20"}); err != nil {
		t.Fatalf("restock: %v", err)
	}
	mustSum("restock", created.ID)
	page, _, err := svc.ListFiltered(rid, repository.IngredientListQuery{Search: "หมูสับ"})
	if err != nil || len(page) != 1 || page[0].ExpiringLot == nil {
		t.Fatalf("list must carry the soonest lot: %v %+v", err, page)
	}
	if page[0].ExpiringLot.ExpiresAt.Day() != 15 || page[0].ExpiringLot.Remaining != 1000 {
		t.Fatalf("soonest lot must be the 15th with 1000 left, got %+v", page[0].ExpiringLot)
	}

	// Using 1500 drains the 15th (1000) then 500 of the 20th.
	if _, err := svc.AdjustStock(rid, created.ID, scenario.user.ID, &AdjustStockRequest{Type: "out", Quantity: 1500}); err != nil {
		t.Fatalf("out: %v", err)
	}
	mustSum("out", created.ID)
	lots, _ := repo.ListOpenLots(rid, created.ID)
	if len(lots) != 1 || lots[0].Remaining != 2500 || lots[0].ExpiresAt.Day() != 20 {
		t.Fatalf("FEFO must empty the 15th first: %+v", lots)
	}

	// Count low → oldest delivery shrinks; count high → undated surplus lot.
	if _, err := svc.AdjustStock(rid, created.ID, scenario.user.ID, &AdjustStockRequest{Type: "adjust", Quantity: 2000}); err != nil {
		t.Fatalf("count down: %v", err)
	}
	mustSum("count down", created.ID)
	if _, err := svc.AdjustStock(rid, created.ID, scenario.user.ID, &AdjustStockRequest{Type: "adjust", Quantity: 2600}); err != nil {
		t.Fatalf("count up: %v", err)
	}
	mustSum("count up", created.ID)

	// Discarding the dated lot writes an out and leaves stock == remaining lots.
	lots, _ = repo.ListOpenLots(rid, created.ID)
	var dated *entity.IngredientLot
	for i := range lots {
		if lots[i].ExpiresAt != nil {
			dated = &lots[i]
		}
	}
	if dated == nil {
		t.Fatal("expected a dated lot to discard")
	}
	if _, err := svc.DiscardLot(rid, created.ID, dated.ID, scenario.user.ID, "ขึ้นรา"); err != nil {
		t.Fatalf("discard: %v", err)
	}
	mustSum("discard", created.ID)

	// A raw stock write (what the seeder does) is healed by reconcile.
	if err := db.Model(&entity.Ingredient{}).Where("id = ?", created.ID).Update("stock", 5000).Error; err != nil {
		t.Fatalf("raw write: %v", err)
	}
	if err := repository.ReconcileLotsToStock(db, rid, created.ID, time.Now()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	mustSum("reconcile up", created.ID)
	if err := db.Model(&entity.Ingredient{}).Where("id = ?", created.ID).Update("stock", 100).Error; err != nil {
		t.Fatalf("raw write: %v", err)
	}
	if err := repository.ReconcileLotsToStock(db, rid, created.ID, time.Now()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	mustSum("reconcile down", created.ID)
}
