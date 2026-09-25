package service

import (
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"
)

func aiCommandTestShelf() []entity.Ingredient {
	basil := entity.Ingredient{Name: "กะเพรา", Unit: "กรัม", Stock: 500}
	basil.ID = 1
	pork := entity.Ingredient{Name: "หมูสับ", Unit: "กรัม", Stock: 2000}
	pork.ID = 2
	egg := entity.Ingredient{Name: "ไข่ไก่", Unit: "ฟอง", Stock: 30}
	egg.ID = 3
	corianderLeaf := entity.Ingredient{Name: "ผักชีฝรั่ง", Unit: "กรัม", Stock: 100}
	corianderLeaf.ID = 4
	corianderLao := entity.Ingredient{Name: "ผักชีลาว", Unit: "กรัม", Stock: 80}
	corianderLao.ID = 5
	return []entity.Ingredient{basil, pork, egg, corianderLeaf, corianderLao}
}

// The system never converts units by itself, so this layer must: 2 กก. against a
// shelf kept in grams is 2,000 — reading it as 2 would be a silent thousand-fold
// error. Units with no known relation ask instead of guessing.
func TestConvertToStockUnit(t *testing.T) {
	cases := []struct {
		quantity   float64
		spoken     string
		stock      string
		want       float64
		wantOK     bool
		reasonName string
	}{
		{2, "กก.", "กรัม", 2000, true, "kilograms to grams"},
		{2, "กิโล", "กรัม", 2000, true, "spoken alias"},
		{1.5, "ขีด", "กรัม", 150, true, "hectogram"},
		{500, "กรัม", "กรัม", 500, true, "same unit"},
		{500, "", "กรัม", 500, true, "no unit spoken means the stock unit"},
		{2, "ลิตร", "มล.", 2000, true, "litres to millilitres"},
		{3, "กำ", "กรัม", 0, false, "a bunch has no fixed weight"},
		{2, "กก.", "ฟอง", 0, false, "mass cannot become a count"},
	}
	for _, test := range cases {
		got, ok := ConvertToStockUnit(test.quantity, test.spoken, test.stock)
		if ok != test.wantOK {
			t.Errorf("%s: ok = %v, want %v", test.reasonName, ok, test.wantOK)
			continue
		}
		if ok && got != test.want {
			t.Errorf("%s: got %v, want %v", test.reasonName, got, test.want)
		}
	}
}

// A name must land on exactly one shelf item or become a question. "ผักชี"
// matching two similarly named things is the case that must never be guessed.
func TestResolveIngredientName(t *testing.T) {
	shelf := aiCommandTestShelf()

	if match := ResolveIngredientName(shelf, "กะเพรา"); match.Exact == nil || match.Exact.ID != 1 {
		t.Errorf("exact name should resolve, got %+v", match)
	}
	if match := ResolveIngredientName(shelf, " หมูสับ "); match.Exact == nil || match.Exact.ID != 2 {
		t.Errorf("padding should not matter, got %+v", match)
	}

	match := ResolveIngredientName(shelf, "ผักชี")
	if match.Exact != nil {
		t.Errorf("an ambiguous name must not resolve to one item, got %q", match.Exact.Name)
	}
	if len(match.Candidates) != 2 {
		t.Errorf("both similar names should be offered, got %+v", match.Candidates)
	}

	if match := ResolveIngredientName(shelf, "ปลาหมึก"); match.Exact != nil || len(match.Candidates) != 0 {
		t.Errorf("an unknown name should have no match, got %+v", match)
	}
}

// Every drafted change ends in one of three honest outcomes.
func TestResolveStockCommandOutcomes(t *testing.T) {
	shelf := aiCommandTestShelf()

	ready := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "กะเพรา", Kind: "in", Quantity: 2, Unit: "กก."})
	if ready.Kind != AICommandOutcomeReady {
		t.Fatalf("a complete command should be ready, got %+v", ready)
	}
	if ready.Command.IngredientID != 1 || ready.Command.Quantity != 2000 || ready.Command.Kind != "in" {
		t.Errorf("converted command = %+v", ready.Command)
	}

	missingQuantity := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "หมูสับ", Kind: "out"})
	if missingQuantity.Kind != AICommandOutcomeAsk || !strings.Contains(missingQuantity.Question, "เท่าไหร่") {
		t.Errorf("a missing quantity should ask, got %+v", missingQuantity)
	}

	missingKind := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "กะเพรา", Quantity: 100, Unit: "กรัม"})
	if missingKind.Kind != AICommandOutcomeAsk || !strings.Contains(missingKind.Question, "รับเข้า") {
		t.Errorf("an unclear kind should ask, got %+v", missingKind)
	}

	ambiguous := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "ผักชี", Kind: "in", Quantity: 1, Unit: "กรัม"})
	if ambiguous.Kind != AICommandOutcomeAsk || !strings.Contains(ambiguous.Question, "ผักชีฝรั่ง") {
		t.Errorf("an ambiguous name should offer the candidates, got %+v", ambiguous)
	}

	unknown := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "ผักชี", Kind: "in", Quantity: 1, Unit: "กรัม"})
	_ = unknown
	// An unknown name with a unit goes straight to the confirmation card rather
	// than to a sentence asking permission to create it. This used to expect the
	// sentence, and the sentence asked for the unit the owner had already given
	// — "เพิ่ม หมูสามชั้น 3000 กก" was answered with "บอกหน่วยด้วย". The card is
	// still a question; it just asks the one that is left.
	missing := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "ปลาหมึก", Kind: "in", Quantity: 1, Unit: "กก."})
	if missing.Kind != AICommandOutcomeReady || missing.Command.Kind != "create" {
		t.Errorf("an unknown ingredient with a unit should be ready to create, got %+v", missing)
	}

	// Without a unit there is nothing to build a create from, so it still asks.
	missingUnit := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "ปลาหมึก", Kind: "in", Quantity: 1})
	if missingUnit.Kind != AICommandOutcomeOfferCreate || !strings.Contains(missingUnit.Question, "เพิ่มเข้าคลัง") {
		t.Errorf("an unknown ingredient with no unit should offer to create it, got %+v", missingUnit)
	}

	badUnit := ResolveStockCommand(shelf, AIStockCommandDraft{Name: "กะเพรา", Kind: "in", Quantity: 3, Unit: "กำ"})
	if badUnit.Kind != AICommandOutcomeAsk || !strings.Contains(badUnit.Question, "กี่กรัม") {
		t.Errorf("an unconvertible unit should ask, got %+v", badUnit)
	}
}

// The model's reply is a proposal: well-formed JSON is read, anything else
// yields nothing so the assistant answers normally instead of acting on noise.
func TestParseStockCommandDrafts(t *testing.T) {
	drafts, err := ParseStockCommandDrafts("[{\"name\":\"กะเพรา\",\"kind\":\"in\",\"quantity\":2,\"unit\":\"กก.\"}]")
	if err != nil || len(drafts) != 1 || drafts[0].Name != "กะเพรา" || drafts[0].Quantity != 2 {
		t.Fatalf("plain array = %+v err=%v", drafts, err)
	}

	fenced, err := ParseStockCommandDrafts("```json\n[{\"name\":\"หมูสับ\",\"kind\":\"out\",\"quantity\":500,\"unit\":\"กรัม\"}]\n```")
	if err != nil || len(fenced) != 1 || fenced[0].Kind != "out" {
		t.Fatalf("fenced array = %+v err=%v", fenced, err)
	}

	empty, err := ParseStockCommandDrafts("[]")
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty array = %+v err=%v", empty, err)
	}

	prose, err := ParseStockCommandDrafts("ยอดขายวันนี้ 12,500 บาทครับ")
	if err != nil || len(prose) != 0 {
		t.Fatalf("prose must yield no commands, got %+v err=%v", prose, err)
	}

	// A truncated reply has no array to read: no commands, and the assistant
	// answers normally rather than acting on a fragment.
	if drafts, err := ParseStockCommandDrafts("[{broken"); err != nil || len(drafts) != 0 {
		t.Errorf("a truncated reply should yield nothing, got %+v err=%v", drafts, err)
	}
	// A complete array whose contents are not valid JSON is reported, not guessed.
	if _, err := ParseStockCommandDrafts("[{name: กะเพรา}]"); err == nil {
		t.Error("malformed JSON inside an array should be reported")
	}

	nameless, err := ParseStockCommandDrafts("[{\"name\":\"  \",\"kind\":\"in\",\"quantity\":2}]")
	if err != nil || len(nameless) != 0 {
		t.Errorf("a nameless draft should be dropped, got %+v", nameless)
	}
}

// The owner said the unit in the first sentence. Asking for it again is the
// single most irritating thing this pipeline can do, and it did it: "เพิ่ม
// หมูสามชั้น 3000 กก เข้าคลังวัตถุดิบให้หน่อย" produced a complete draft and the
// reply was still "ให้ผมเพิ่มเข้าคลังให้ไหม (บอกหน่วยด้วย)".
func TestNewIngredientWithAUnitDoesNotAskForTheUnitAgain(t *testing.T) {
	shelf := []entity.Ingredient{{Name: "หมูสับ", Unit: "กรัม"}}

	resolution := ResolveStockCommand(shelf, AIStockCommandDraft{
		Name: "หมูสามชั้น", Kind: "in", Quantity: 3000, Unit: "กก.",
	})
	if resolution.Kind != AICommandOutcomeReady {
		t.Fatalf("expected the command to be ready to confirm, got %q — %s", resolution.Kind, resolution.Question)
	}
	if resolution.Command.Kind != "create" {
		t.Errorf("a name the shelf does not have has to become a create, got %q", resolution.Command.Kind)
	}
	// Spelled the way the inventory form writes it, so the new shelf row
	// reads like every other one ("กก." → "กิโลกรัม").
	if resolution.Command.Unit != "กิโลกรัม" || resolution.Command.Quantity != 3000 {
		t.Errorf("the unit and quantity the owner gave were dropped: %+v", resolution.Command)
	}

	// Without a unit there is genuinely nothing to go on, so asking is right.
	missing := ResolveStockCommand(shelf, AIStockCommandDraft{
		Name: "หมูสามชั้น", Kind: "in", Quantity: 3000,
	})
	if missing.Kind != AICommandOutcomeOfferCreate {
		t.Fatalf("with no unit the pipeline still has to ask, got %q", missing.Kind)
	}
}

// The confirmation card read 'บันทึกรายจ่าย "บันทึกค่าน้ำ 500 บาท"'. The
// extractor had already done its job — name="ค่าน้ำ" — and the card was reading
// the note instead, which is free text and carries whatever the owner said.
func TestExpenseCardShowsTheNameNotTheNote(t *testing.T) {
	resolution := ResolveExpenseCommand(AIStockCommandDraft{
		Name: "ค่าน้ำ", Kind: "expense", Quantity: 500,
		Category: "utilities", Note: "บันทึกค่าน้ำ 500 บาท",
	}, time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))

	if resolution.Kind != AICommandOutcomeReady {
		t.Fatalf("a complete expense should be ready, got %q — %s", resolution.Kind, resolution.Question)
	}
	if resolution.Title != "ค่าน้ำ" {
		t.Errorf("the card should be titled with the name, got %q", resolution.Title)
	}

	// With no name to use, the note is still better than nothing.
	fallback := ResolveExpenseCommand(AIStockCommandDraft{
		Kind: "expense", Quantity: 500, Category: "utilities", Note: "ค่าน้ำประปา",
	}, time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC))
	if fallback.Title != "ค่าน้ำประปา" {
		t.Errorf("with no name the note should title the card, got %q", fallback.Title)
	}
}

// "ตั้งราคาข้าวกะเพราเป็น -50 บาท" was answered "ผู้ช่วยทำให้ไม่ได้ครับ คุณต้อง
// ไปจัดการเรื่องราคาในระบบเองครับ" — right outcome, wrong reason. Changing a menu
// price is something the assistant does; only that one number was impossible.
// The owner walks away believing prices cannot be changed through the assistant
// at all, which is false.
//
// Nothing said and something impossible are different problems, so they get
// different sentences.
func TestNegativeNumbersSayWhyRatherThanJustAsking(t *testing.T) {
	menus := []entity.MenuItem{{Name: "ข้าวกะเพราไก่ไข่ดาว", Price: 60, IsAvailable: true}}
	shelf := aiCommandTestShelf()
	now := time.Date(2026, 9, 2, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		what       string
		resolution AICommandResolution
		mustSay    string
	}{
		{"ราคาเมนูติดลบ",
			ResolveMenuCommand(menus, AIStockCommandDraft{Name: "ข้าวกะเพราไก่ไข่ดาว", Kind: "menu_price", Quantity: -50}),
			"ติดลบไม่ได้"},
		{"จำนวนสต๊อกติดลบ",
			ResolveStockCommand(shelf, AIStockCommandDraft{Name: "กะเพรา", Kind: "in", Quantity: -5, Unit: "กรัม"}),
			"ติดลบไม่ได้"},
		{"ราคาทุนติดลบ",
			ResolveStockCommand(shelf, AIStockCommandDraft{Name: "กะเพรา", Kind: "cost", Quantity: -20}),
			"ติดลบไม่ได้"},
		{"รายจ่ายติดลบ",
			ResolveExpenseCommand(AIStockCommandDraft{Name: "ค่าไฟ", Kind: "expense", Quantity: -100, Category: "utilities"}, now),
			"ติดลบไม่ได้"},
	}
	for _, c := range cases {
		if c.resolution.Kind != AICommandOutcomeAsk {
			t.Errorf("%s: should ask, got %q", c.what, c.resolution.Kind)
			continue
		}
		if !strings.Contains(c.resolution.Question, c.mustSay) {
			t.Errorf("%s: the owner is not told what was wrong: %q", c.what, c.resolution.Question)
		}
	}

	// A number that was simply never said still asks the plain question — saying
	// "cannot be negative" about a number nobody gave would be nonsense.
	quiet := ResolveMenuCommand(menus, AIStockCommandDraft{Name: "ข้าวกะเพราไก่ไข่ดาว", Kind: "menu_price"})
	if quiet.Kind != AICommandOutcomeAsk || strings.Contains(quiet.Question, "ติดลบ") {
		t.Errorf("a missing price should just ask, got %q", quiet.Question)
	}
}
