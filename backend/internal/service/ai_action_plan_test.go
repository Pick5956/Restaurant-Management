package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"Project-M/internal/entity"
)

// fakeAIActionIngredientPort stands in for the ingredient service: it answers
// lookups from a small table and records what would have been written.
type fakeAIActionIngredientPort struct {
	items     map[uint]*entity.Ingredient
	adjusted  []AdjustStockRequest
	created   []IngredientRequest
	updated   []IngredientRequest
	adjustErr error
}

func (f *fakeAIActionIngredientPort) ListIngredients(uint) ([]entity.Ingredient, error) {
	shelf := make([]entity.Ingredient, 0, len(f.items))
	for _, item := range f.items {
		shelf = append(shelf, *item)
	}
	return shelf, nil
}

func (f *fakeAIActionIngredientPort) FindIngredient(_ uint, ingredientID uint) (*entity.Ingredient, error) {
	item, ok := f.items[ingredientID]
	if !ok {
		return nil, errors.New("not found")
	}
	copied := *item
	return &copied, nil
}

func (f *fakeAIActionIngredientPort) AdjustStock(_ uint, ingredientID, _ uint, req *AdjustStockRequest) (*entity.Ingredient, error) {
	if f.adjustErr != nil {
		return nil, f.adjustErr
	}
	f.adjusted = append(f.adjusted, *req)
	return f.items[ingredientID], nil
}

func (f *fakeAIActionIngredientPort) Create(_ uint, _ uint, req *IngredientRequest) (*entity.Ingredient, error) {
	f.created = append(f.created, *req)
	return &entity.Ingredient{Name: req.Name, Unit: req.Unit}, nil
}

func (f *fakeAIActionIngredientPort) Update(_ uint, ingredientID uint, req *IngredientRequest) (*entity.Ingredient, error) {
	f.updated = append(f.updated, *req)
	return f.items[ingredientID], nil
}

func newAIActionPortFixture() *fakeAIActionIngredientPort {
	basil := &entity.Ingredient{Name: "กะเพรา", Unit: "กรัม", Stock: 500, CostPerUnit: 0.06}
	basil.ID = 1
	pork := &entity.Ingredient{Name: "หมูสับ", Unit: "กรัม", Stock: 2000, CostPerUnit: 0.18}
	pork.ID = 2
	return &fakeAIActionIngredientPort{items: map[uint]*entity.Ingredient{1: basil, 2: pork}}
}

// Stock maths must match the inventory screen exactly: "in" adds, "out" refuses
// to go negative, "adjust" replaces the level outright — the difference an owner
// would never see from the words alone, which is why the preview spells it out.
func TestValidateAdjustStockAppliesInventoryRules(t *testing.T) {
	port := newAIActionPortFixture()

	_, preview, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "in", Quantity: 2000})
	if err != nil {
		t.Fatalf("stock-in should validate: %v", err)
	}
	if preview.Change != "500 → 2500" || preview.Unit != "กรัม" || preview.Title != "กะเพรา" {
		t.Errorf("stock-in preview = %+v", preview)
	}

	_, preview, err = validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "adjust", Quantity: 300})
	if err != nil || preview.Change != "500 → 300" {
		t.Errorf("adjust should set the level outright, got %+v err=%v", preview, err)
	}

	if _, _, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "out", Quantity: 900}); !errors.Is(err, ErrAIActionNotEnoughStock) {
		t.Errorf("taking more than the shelf holds must fail, got %v", err)
	}
	if _, _, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 99, Kind: "in", Quantity: 1}); !errors.Is(err, ErrAIActionUnknownIngredient) {
		t.Errorf("unknown ingredient must fail, got %v", err)
	}
	if _, _, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "in", Quantity: 0}); !errors.Is(err, ErrAIActionBadQuantity) {
		t.Errorf("zero quantity must fail, got %v", err)
	}
	if _, _, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "out", Quantity: 10, Amount: 50}); !errors.Is(err, ErrAIActionAmountOnlyForIn) {
		t.Errorf("only a stock-in may carry money, got %v", err)
	}
}

// The two side effects the system causes on its own must appear in the preview:
// a linked expense that can never be edited, and menus closing at zero stock.
func TestValidateAdjustStockShowsSideEffects(t *testing.T) {
	port := newAIActionPortFixture()

	_, preview, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 2, Kind: "in", Quantity: 1000})
	if err != nil {
		t.Fatalf("stock-in should validate: %v", err)
	}
	joined := strings.Join(preview.SideEffects, " | ")
	if !strings.Contains(joined, "บันทึกรายจ่าย") || !strings.Contains(joined, "แก้หรือลบไม่ได้") {
		t.Errorf("a valued stock-in must warn about the linked expense: %q", joined)
	}

	_, preview, err = validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "out", Quantity: 500})
	if err != nil {
		t.Fatalf("emptying the shelf should validate: %v", err)
	}
	if !strings.Contains(strings.Join(preview.SideEffects, " | "), "ปิดขายอัตโนมัติ") {
		t.Errorf("hitting zero stock must warn that menus close: %+v", preview.SideEffects)
	}
}

// A batch keeps the good items and reports the bad ones — never silently drops
// part of what the owner asked for.
func TestBuildAdjustStockPlanReportsRejectedItems(t *testing.T) {
	port := newAIActionPortFixture()
	draft := BuildAdjustStockPlan(AIActionPorts{Ingredients: port}, 1, []AIAdjustStockCommand{
		{IngredientID: 1, Kind: "in", Quantity: 100},
		{IngredientID: 99, Kind: "in", Quantity: 100},
		{IngredientID: 2, Kind: "out", Quantity: 500},
	}, []string{"กะเพรา", "ผักชี", "หมูสับ"})

	if len(draft.Items) != 2 || len(draft.Previews) != 2 {
		t.Fatalf("two items should validate, got %d", len(draft.Items))
	}
	if len(draft.Rejected) != 1 || draft.Rejected[0].Title != "ผักชี" {
		t.Fatalf("the unknown ingredient should be reported, got %+v", draft.Rejected)
	}
	for _, item := range draft.Items {
		if item.ActionType != entity.AIActionTypeAdjustIngredientStock {
			t.Errorf("unexpected action type %q", item.ActionType)
		}
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			t.Errorf("payload must be valid JSON: %v", err)
		}
		if payload.IngredientID == 0 || payload.Quantity <= 0 {
			t.Errorf("payload lost its values: %+v", payload)
		}
	}
}

// Executing an item goes through the normal ingredient service, so stock maths,
// the linked expense and menu auto-closing keep one implementation.
func TestExecuteAIActionItemCallsIngredientService(t *testing.T) {
	port := newAIActionPortFixture()
	payload, _ := json.Marshal(AIActionItemPayload{IngredientID: 1, Kind: "in", Quantity: 250, Amount: 15, Note: "ตลาดเช้า"})
	item := entity.AIActionPlanItem{ActionType: entity.AIActionTypeAdjustIngredientStock, PayloadJSON: string(payload)}

	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 7, item); err != nil {
		t.Fatalf("execute error = %v", err)
	}
	if len(port.adjusted) != 1 {
		t.Fatalf("expected one adjust call, got %d", len(port.adjusted))
	}
	got := port.adjusted[0]
	if got.Type != "in" || got.Quantity != 250 || got.Amount != 15 || got.Note != "ตลาดเช้า" {
		t.Errorf("service received %+v", got)
	}

	unknown := entity.AIActionPlanItem{ActionType: "delete_everything", PayloadJSON: "{}"}
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 7, unknown); err == nil {
		t.Error("an unreviewed action type must not execute")
	}
}

// Changing one field must read the row first and put everything else back
// unchanged, and must say what it is changing "from → to".
func TestSetIngredientFieldPreviewsAndPreservesOtherFields(t *testing.T) {
	port := newAIActionPortFixture()

	_, preview, err := validateSetIngredientField(port, 1, 1, entity.AIActionTypeSetIngredientMinStock, 800)
	if err != nil || !strings.Contains(preview.Change, "ขั้นต่ำ 0 → 800") {
		t.Fatalf("min-stock preview = %+v err=%v", preview, err)
	}
	if !strings.Contains(strings.Join(preview.SideEffects, " "), "ต่ำกว่าขั้นต่ำใหม่") {
		t.Errorf("a threshold above current stock should warn: %+v", preview.SideEffects)
	}

	_, costPreview, err := validateSetIngredientField(port, 1, 2, entity.AIActionTypeSetIngredientCost, 0.2)
	if err != nil || !strings.Contains(costPreview.Change, "0.18 → 0.2") {
		t.Fatalf("cost preview = %+v err=%v", costPreview, err)
	}
	if !strings.Contains(strings.Join(costPreview.SideEffects, " "), "กำไรของเมนู") {
		t.Errorf("a price change should warn about menu margins: %+v", costPreview.SideEffects)
	}

	payload, _ := json.Marshal(AIActionItemPayload{IngredientID: 1, MinStock: 800})
	item := entity.AIActionPlanItem{ActionType: entity.AIActionTypeSetIngredientMinStock, PayloadJSON: string(payload)}
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 7, item); err != nil {
		t.Fatalf("execute error = %v", err)
	}
	if len(port.updated) != 1 {
		t.Fatalf("expected one update, got %d", len(port.updated))
	}
	got := port.updated[0]
	if got.MinStock != 800 || got.Name != "กะเพรา" || got.Unit != "กรัม" || got.Stock != 500 {
		t.Errorf("update should change only the threshold: %+v", got)
	}
}

// Adding an ingredient refuses a missing unit and a duplicate name, because the
// unit is what recipes measure against and the system never converts.
func TestValidateCreateIngredient(t *testing.T) {
	port := newAIActionPortFixture()
	shelf, _ := port.ListIngredients(1)

	payload, preview, err := validateCreateIngredient(shelf, "ผักชี", "กรัม", 0, 0, 0)
	if err != nil || payload.Name != "ผักชี" || payload.Unit != "กรัม" {
		t.Fatalf("create payload = %+v err=%v", payload, err)
	}
	if !strings.Contains(preview.Change, "หน่วยกรัม") {
		t.Errorf("preview should state the unit: %q", preview.Change)
	}

	if _, _, err := validateCreateIngredient(shelf, "ผักชี", "", 0, 0, 0); err == nil {
		t.Error("a missing unit must be refused, not guessed")
	}
	if _, _, err := validateCreateIngredient(shelf, "กะเพรา", "กรัม", 0, 0, 0); err == nil {
		t.Error("an existing name must be refused")
	}

	itemPayload, _ := json.Marshal(AIActionItemPayload{Name: "ผักชี", Unit: "กรัม", Quantity: 500})
	item := entity.AIActionPlanItem{ActionType: entity.AIActionTypeCreateIngredient, PayloadJSON: string(itemPayload)}
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 7, item); err != nil {
		t.Fatalf("execute error = %v", err)
	}
	if len(port.created) != 1 || port.created[0].Unit != "กรัม" || port.created[0].Stock != 500 {
		t.Errorf("create call = %+v", port.created)
	}
}

// The allowlist is the Go half of the item table's check constraint.
func TestAllowedAIActionTypes(t *testing.T) {
	if !entity.IsAllowedAIActionType(entity.AIActionTypeAdjustIngredientStock) {
		t.Error("the reviewed stock action should be allowed")
	}
	for _, good := range []string{
		entity.AIActionTypeSetIngredientMinStock,
		entity.AIActionTypeSetIngredientCost,
		entity.AIActionTypeCreateIngredient,
		// Opening and closing a menu joined the plan boundary in migration 18,
		// replacing the keyword-matched single-action path it used to have.
		entity.AIActionTypeSetMenuAvailability,
		// Recording an expense and repricing a menu joined in migration 19.
		entity.AIActionTypeCreateExpense,
		entity.AIActionTypeSetMenuPrice,
		// Creating a menu item joined in migration 24.
		entity.AIActionTypeCreateMenuItem,
	} {
		if !entity.IsAllowedAIActionType(good) {
			t.Errorf("%q should be allowed", good)
		}
	}
	for _, bad := range []string{"", "drop_table", "delete_menu", "delete_expense", "create_order"} {
		if entity.IsAllowedAIActionType(bad) {
			t.Errorf("%q must not be allowed in a plan", bad)
		}
	}
}

// The app's confirm card draws the change from these parts, not from the
// sentence in Change, so every kind must fill the parts its layout reads: a
// value that moves carries from/to/unit/delta, a new row carries facts.
func TestActionPreviewCarriesTheChangeInParts(t *testing.T) {
	port := newAIActionPortFixture()

	_, stock, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 1, Kind: "in", Quantity: 2.2})
	if err != nil {
		t.Fatal(err)
	}
	if stock.Field != "สต๊อก" || stock.From != "500" || stock.To != "502.2" || stock.ValueUnit != "กรัม" || stock.Delta != "+2.2" {
		t.Errorf("stock parts = %+v", stock)
	}

	_, out, err := validateAdjustStock(port, 1, AIAdjustStockCommand{IngredientID: 2, Kind: "out", Quantity: 150})
	if err != nil || out.Delta != "-150" {
		t.Errorf("stock-out delta = %q err=%v", out.Delta, err)
	}

	_, cost, err := validateSetIngredientField(port, 1, 2, entity.AIActionTypeSetIngredientCost, 0.2)
	if err != nil || cost.Field != "ราคาต่อกรัม" || cost.From != "0.18" || cost.To != "0.2" || cost.ValueUnit != "บาท" || cost.Delta != "+0.02" {
		t.Errorf("cost parts = %+v err=%v", cost, err)
	}

	shelf, _ := port.ListIngredients(1)
	payload, created, err := validateCreateIngredient(shelf, "หมูสามชั้นต้ม", "กิโล", 3, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Unit != "กิโลกรัม" || created.Unit != "กิโลกรัม" {
		t.Errorf("unit should be written the standard way: payload %q preview %q", payload.Unit, created.Unit)
	}
	want := []AIActionPreviewFact{{Label: "หน่วย", Value: "กิโลกรัม"}, {Label: "สต๊อกเริ่มต้น", Value: "3 กิโลกรัม"}}
	if len(created.Facts) != len(want) || created.Facts[0] != want[0] || created.Facts[1] != want[1] {
		t.Errorf("create facts = %+v", created.Facts)
	}
	if created.From != "" || created.To != "" {
		t.Errorf("a new row has nothing to change from: %+v", created)
	}

	_, expense, err := validateCreateExpense(AIAdjustStockCommand{Category: "utilities", Quantity: 850, Date: "2026-09-14"})
	if err != nil {
		t.Fatal(err)
	}
	if len(expense.Facts) != 3 || expense.Facts[0].Value != "850 บาท" || expense.Facts[2].Value != "14 กันยายน 2569" {
		t.Errorf("expense facts = %+v", expense.Facts)
	}
}

func TestStandardUnitSpellingKeepsCountingWords(t *testing.T) {
	cases := map[string]string{"กิโล": "กิโลกรัม", "กก.": "กิโลกรัม", "kg": "กิโลกรัม", " กรัม ": "กรัม", "ลิตร": "ลิตร", "ฟอง": "ฟอง", "ถุง": "ถุง", "แพ็ค": "แพ็ค"}
	for in, want := range cases {
		if got := standardUnitSpelling(in); got != want {
			t.Errorf("standardUnitSpelling(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildPlanStampsTheActionKind(t *testing.T) {
	port := newAIActionPortFixture()
	draft := BuildAdjustStockPlan(AIActionPorts{Ingredients: port}, 1, []AIAdjustStockCommand{{IngredientID: 1, Kind: "in", Quantity: 5}}, nil)
	if len(draft.Previews) != 1 || draft.Previews[0].Kind != entity.AIActionTypeAdjustIngredientStock {
		t.Fatalf("previews = %+v", draft.Previews)
	}
	var stored AIActionItemPreview
	if err := json.Unmarshal([]byte(draft.Items[0].PreviewJSON), &stored); err != nil || stored.Kind != entity.AIActionTypeAdjustIngredientStock || stored.Delta != "+5" {
		t.Errorf("stored preview = %+v err=%v", stored, err)
	}
}
