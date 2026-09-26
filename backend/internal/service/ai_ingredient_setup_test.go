package service

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"Project-M/internal/entity"

	"gorm.io/gorm"
)

// "เพิ่มน้ำปลา 2 ขวด", answered on the card: มิลลิลิตร, 700 a bottle, 70 บาท
// for both. The stock, the price per ml and the expense are Go's numbers.
func TestIngredientSetupComputesStockAndPriceFromTheAnswers(t *testing.T) {
	shelf := []entity.Ingredient{{Name: "หมูสับ", Unit: "กรัม"}}

	payload, preview, err := buildIngredientSetup(shelf, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{Unit: aiSetupFirstUnit("ขวด")})
	if err != nil {
		t.Fatal(err)
	}
	if payload.Unit != "" || preview.Setup == nil || preview.Setup.Unit != "" {
		t.Fatalf("a sealed container word must leave the unit to the card's first question: %+v", payload)
	}
	// Every list the card draws chips from must be there.
	if len(preview.Setup.Units) == 0 || len(preview.Setup.PackUnits) == 0 || len(preview.Setup.StorageTypes) == 0 {
		t.Fatalf("a chip list is empty: %+v", preview.Setup)
	}

	answers := AIIngredientSetupAnswers{Unit: "มิลลิลิตร", PackSize: 700, Price: 70}
	payload, preview, err = buildIngredientSetup(shelf, "น้ำปลา", 2, "ขวด", answers)
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Setup.NeedsPack || payload.PackUnit != "ขวด" || payload.PackSize != 700 {
		t.Fatalf("ขวด does not convert to มิลลิลิตร, so it is the pack: %+v", payload)
	}
	if payload.Quantity != 1400 {
		t.Fatalf("2 ขวด × 700 = 1400 มิลลิลิตร, got %v", payload.Quantity)
	}
	if math.Abs(payload.CostPerUnit-0.05) > 1e-9 {
		t.Fatalf("70 บาท / 1400 = 0.05 บาท/มล., got %v", payload.CostPerUnit)
	}
	if effects := strings.Join(preview.SideEffects, " | "); !strings.Contains(effects, "รายจ่าย ฿70 · ลบไม่ได้") {
		t.Fatalf("the expense line is missing: %q", effects)
	}

	answers.PriceMode = aiSetupPricePerPack
	answers.Price = 35
	payload, _, err = buildIngredientSetup(shelf, "น้ำปลา", 2, "ขวด", answers)
	if err != nil || math.Abs(payload.CostPerUnit-0.05) > 1e-9 {
		t.Fatalf("35 บาท a bottle is the same 70 บาท: %v / %v", payload.CostPerUnit, err)
	}
}

func TestIngredientSetupRefusesWhatTheSaveWouldRefuse(t *testing.T) {
	shelf := []entity.Ingredient{{Name: "น้ำปลา", Unit: "มิลลิลิตร"}}
	if _, _, err := buildIngredientSetup(shelf, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{}); err == nil {
		t.Fatal("an ingredient already on the shelf must be refused")
	}
	if _, _, err := buildIngredientSetup(nil, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{Unit: "ลัง"}); err == nil {
		t.Fatal("ลัง is not a stock unit")
	}
	// No bottle size yet: the stock is 0, so only a price per ml can be taken.
	_, preview, err := buildIngredientSetup(nil, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{Unit: "มิลลิลิตร"})
	if err != nil || strings.Join(preview.Setup.PriceModes, ",") != "per_unit" {
		t.Fatalf("with no stock only per_unit is offered: %v / %v", preview.Setup.PriceModes, err)
	}
	if _, _, err := buildIngredientSetup(nil, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{Unit: "มิลลิลิตร", PackUnit: "ลิตร", PackSize: 1}); err == nil {
		t.Fatal("ลิตร already converts to มิลลิลิตร, it cannot be the pack")
	}
	if _, _, err := buildIngredientSetup(nil, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{Unit: "ขวด", StorageType: "oven"}); err == nil {
		t.Fatal("an unknown storage type must be refused")
	}
}

// A unit the shelf can measure by carries over: 3 กก. counted in กรัม is 3000,
// with no pack question.
func TestIngredientSetupConvertsAMeasuredAmount(t *testing.T) {
	if unit := aiSetupFirstUnit("กก."); unit != "กิโลกรัม" {
		t.Fatalf("กก. starts the card on กิโลกรัม, got %q", unit)
	}
	payload, preview, err := buildIngredientSetup(nil, "หมูสามชั้น", 3, "กก.", AIIngredientSetupAnswers{Unit: "กรัม"})
	if err != nil {
		t.Fatal(err)
	}
	if payload.Quantity != 3000 || preview.Setup.NeedsPack {
		t.Fatalf("3 กก. = 3000 กรัม without a pack, got %v needsPack=%v", payload.Quantity, preview.Setup.NeedsPack)
	}
}

// The card path is taken only for something new, and only when the client
// draws the card; an ingredient already on the shelf goes the old way.
func TestCardCreateResolutionTakesOnlyNewIngredients(t *testing.T) {
	shelf := []entity.Ingredient{{Name: "หมูสับ", Unit: "กรัม"}}
	card, ok := aiCardCreateResolution(shelf, AIStockCommandDraft{Name: "น้ำปลา", Kind: "create", Quantity: 2, Unit: "ลัง"})
	if !ok || !card.Command.Setup || card.Command.Unit != "ลัง" || card.Command.Quantity != 2 {
		t.Fatalf("a new ingredient in ลัง should become a card: %+v", card)
	}
	if _, ok := aiCardCreateResolution(shelf, AIStockCommandDraft{Name: "น้ำปลา", Kind: "in", Quantity: 2, Unit: "ขวด"}); !ok {
		t.Fatal("a restock of something not on the shelf, with a unit, is a new ingredient")
	}
	if _, ok := aiCardCreateResolution(shelf, AIStockCommandDraft{Name: "หมูสับ", Kind: "in", Quantity: 2, Unit: "กิโล"}); ok {
		t.Fatal("หมูสับ is on the shelf — that is a restock")
	}
	if _, ok := aiCardCreateResolution(shelf, AIStockCommandDraft{Name: "น้ำปลา", Kind: "in", Quantity: 2}); ok {
		t.Fatal("no unit on a restock of an unknown name is still asked in the chat")
	}
}

// Confirming runs the card's answers through the inventory form's Create:
// the pack, the storage and the reorder percentage all arrive.
func TestExecuteCardCreateCarriesTheAnswers(t *testing.T) {
	port := &fakeAIActionIngredientPort{items: map[uint]*entity.Ingredient{}}
	payload, _, err := buildIngredientSetup(nil, "น้ำปลา", 2, "ขวด",
		AIIngredientSetupAnswers{Unit: "มิลลิลิตร", PackSize: 700, Price: 70, StorageType: "dry", MinPercent: 20})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(payload)
	item := entity.AIActionPlanItem{ActionType: entity.AIActionTypeCreateIngredient, PayloadJSON: string(raw)}
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 1, item); err != nil {
		t.Fatal(err)
	}
	if len(port.created) != 1 {
		t.Fatalf("expected one create, got %d", len(port.created))
	}
	got := port.created[0]
	if got.Unit != "มิลลิลิตร" || got.Stock != 1400 || got.StorageType != "dry" ||
		got.PackUnit == nil || *got.PackUnit != "ขวด" || got.PackSize == nil || *got.PackSize != 700 ||
		got.MinPercent == nil || *got.MinPercent != 20 {
		t.Fatalf("the card's answers did not reach Create: %+v", got)
	}

	unanswered, _, _ := buildIngredientSetup(nil, "น้ำปลา", 2, "ขวด", AIIngredientSetupAnswers{})
	raw, _ = json.Marshal(unanswered)
	item.PayloadJSON = string(raw)
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 1, item); err == nil {
		t.Fatal("a card confirmed before its unit was chosen must not create anything")
	}
}

// The chat of 25 ก.ย. 2569 16:05–16:08, turn by turn.
func TestAddIngredientChatFromTheOwnersLog(t *testing.T) {
	shelf := []entity.Ingredient{{Model: gorm.Model{ID: 40}, Name: "หมาล่า", Unit: "กิโลกรัม", Stock: 45.49}}

	// "เพิ่มวัตถุดิบ" — no name: Go asks for the name, and only the name.
	asked := ResolveStockCommand(shelf, AIStockCommandDraft{Kind: "create"})
	if asked.Kind != AICommandOutcomeAsk || !strings.Contains(asked.Question, "ชื่ออะไร") || strings.Contains(asked.Question, "ราคา") {
		t.Fatalf("a nameless create should ask for the name: %+v", asked)
	}

	// "หมาล่า" — already on the shelf: said so, not asked for a unit.
	existing := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "หมาล่า", Kind: "create"})
	if !strings.Contains(existing.Question, "ในคลังอยู่แล้ว") || len(existing.Options) != 0 {
		t.Fatalf("an existing ingredient must not be asked its unit: %+v", existing)
	}

	// "ไข่นกนางแอ่น" — not on the shelf; the sheet offers หมาล่า from the
	// thread only as an earlier topic, never as the answer.
	history := []AIConversationMessage{{Role: "user", Content: "หมาล่า"}, {Role: "assistant", Content: "วัตถุดิบหมาล่าตอนนี้มีสต๊อกอยู่ 45.49 กิโลกรัม"}}
	body := joyboyIngredientDetailBody(shelf, nil, nil, "ไข่นกนางแอ่น", history)
	if !strings.Contains(body, "ingredient=หมาล่า") || !strings.Contains(body, "ยังไม่มีในคลัง") {
		t.Fatalf("the sheet must say หมาล่า comes from the thread: %s", body)
	}
	if named := joyboyIngredientDetailBody(shelf, nil, nil, "หมาล่าเหลือเท่าไหร่", history); strings.Contains(named, "ยังไม่มีในคลัง") {
		t.Fatalf("a sentence naming the row gets no thread note: %s", named)
	}
}

// Already on the shelf: refused on the card, and again at the button if it
// was added while the card waited. A longer name is flagged, not refused.
func TestNewIngredientIsCheckedAgainstTheShelf(t *testing.T) {
	shelf := []entity.Ingredient{{Name: "ซอสหอยนางรมแม่ครัว", Unit: "ขวด"}}
	_, preview, err := buildIngredientSetup(shelf, "ซอสหอยนางรม", 2, "ขวด", AIIngredientSetupAnswers{Unit: "ขวด"})
	if err != nil {
		t.Fatal(err)
	}
	if effects := strings.Join(preview.SideEffects, " | "); !strings.Contains(effects, "ซอสหอยนางรมแม่ครัว") {
		t.Fatalf("the similar row must be named on the card: %q", effects)
	}

	payload, _, _ := buildIngredientSetup(nil, "ซอสหอยนางรม", 2, "ขวด", AIIngredientSetupAnswers{Unit: "ขวด"})
	raw, _ := json.Marshal(payload)
	port := &fakeAIActionIngredientPort{items: map[uint]*entity.Ingredient{7: {Name: "ซอสหอยนางรม", Unit: "ขวด"}}}
	item := entity.AIActionPlanItem{ActionType: entity.AIActionTypeCreateIngredient, PayloadJSON: string(raw)}
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 1, item); err == nil || len(port.created) != 0 {
		t.Fatalf("added while the card waited — must not create a second row: err=%v created=%d", err, len(port.created))
	}
}

// "เพิ่มวัตถุดิบใหม่หน่อย ขิง" — no amount. The card asks what is on hand
// and a price, and cannot be confirmed without them (เจ้าของสั่ง 25 ก.ย. 2569).
func TestIngredientSetupAsksEverythingTheInventoryNeeds(t *testing.T) {
	payload, preview, err := buildIngredientSetup(nil, "ขิง", 0, "", AIIngredientSetupAnswers{Unit: "กิโลกรัม"})
	if err != nil {
		t.Fatal(err)
	}
	if !preview.Setup.NeedsStock || strings.Join(payload.Missing, ",") != "จำนวนที่มีตอนนี้,ราคา" {
		t.Fatalf("stock and price must be missing: %v", payload.Missing)
	}
	raw, _ := json.Marshal(payload)
	port := &fakeAIActionIngredientPort{items: map[uint]*entity.Ingredient{}}
	item := entity.AIActionPlanItem{ActionType: entity.AIActionTypeCreateIngredient, PayloadJSON: string(raw)}
	if err := executeAIActionItem(AIActionPorts{Ingredients: port}, 1, 1, item); err == nil || len(port.created) != 0 {
		t.Fatalf("an unfinished card must not create: %v", err)
	}

	onHand := 3.0
	payload, preview, err = buildIngredientSetup(nil, "ขิง", 0, "", AIIngredientSetupAnswers{Unit: "กิโลกรัม", Stock: &onHand, PriceMode: "per_unit", Price: 60})
	if err != nil || len(payload.Missing) != 0 {
		t.Fatalf("answered in full: %v / %v", payload.Missing, err)
	}
	if payload.Quantity != 3 || payload.CostPerUnit != 60 || preview.Setup.Total != 180 {
		t.Fatalf("3 กก. × 60 = 180 บาท, got stock %v cost %v total %v", payload.Quantity, payload.CostPerUnit, preview.Setup.Total)
	}
	// Zero on hand is refused, like a zero price: nothing to add yet.
	zero := 0.0
	if _, _, err := buildIngredientSetup(nil, "ขิง", 0, "", AIIngredientSetupAnswers{Unit: "กิโลกรัม", Stock: &zero}); err == nil {
		t.Fatal("an opening stock of 0 must be refused")
	}
}
