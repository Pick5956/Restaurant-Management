package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// The step-by-step card for a new ingredient (web, 25 ก.ย. 2569).
//
// "เพิ่มน้ำปลา 2 ขวด" used to come back as a chat question — which unit? — and
// then a card that could only say what it lacked: no pack size, so the stock
// started at 0; no price, so every menu using it cost 0. The owner chose to be
// asked one thing at a time instead, inside the card, before anything is
// written: the unit it is counted in, how much one bottle holds, what it cost.
//
// Every answer goes through the plan (ReviseAIActionPlanItem) and comes back
// through this file. The card only draws what Go computed — the opening stock,
// the price per unit, the expense it will book — so the numbers the owner
// confirms are the numbers the save uses. Nothing here reads the question:
// the amount and the word it was said in come from the extractor's draft.

// AIIngredientSetupAnswers is what the card has answered so far.
type AIIngredientSetupAnswers struct {
	Unit string `json:"unit"`
	// Stock is the opening stock typed on the card, in Unit — asked only when
	// the command said no amount ("เพิ่มขิง"). Nil means not answered.
	Stock       *float64 `json:"stock,omitempty"`
	PackUnit    string   `json:"pack_unit"`
	PackSize    float64  `json:"pack_size"`
	PriceMode   string   `json:"price_mode"`
	Price       float64  `json:"price"`
	StorageType string   `json:"storage_type"`
	MinPercent  float64  `json:"min_percent"`
	// What the inventory form also asks (28 ก.ย. 2569), so an ingredient added
	// by chat is no thinner than one added on the stock page: the section of the
	// stock list it goes in (0 = none), the opening lot's shelf life in days
	// (nil = the storage type's default, 0 = "ไม่ระบุ"), and the case a pack is
	// bought in ("ลัง" of 12 ขวด), which needs a pack.
	CategoryID uint    `json:"category_id"`
	ExpiryDays *int    `json:"expiry_days,omitempty"`
	CaseUnit   string  `json:"case_unit"`
	CaseSize   float64 `json:"case_size"`
	// Finish marks the card's last answer: the window drops to the usual
	// minute and the confirm bar counts it down.
	Finish bool `json:"finish"`
}

// AIIngredientSetupRequest is one answer from the card, sent with the whole
// set so far. The token proves the request comes from the card that holds it.
type AIIngredientSetupRequest struct {
	ConfirmationToken string `json:"confirmation_token" binding:"required,max=256"`
	AIIngredientSetupAnswers
}

// AIIngredientSetupView is the card's state, computed here. The lists are
// the choices Go will accept, so the card cannot offer one the save refuses.
type AIIngredientSetupView struct {
	Name         string   `json:"name"`
	SaidQuantity float64  `json:"said_quantity"`
	SaidUnit     string   `json:"said_unit,omitempty"`
	Unit         string   `json:"unit"`
	Units        []string `json:"units"`
	// NeedsStock: the command said no amount, so the card asks how much is
	// on hand. StockSet once it is answered (0 is an answer).
	NeedsStock bool `json:"needs_stock"`
	StockSet   bool `json:"stock_set"`
	// NeedsPack: the amount was said in a word that does not convert to the
	// chosen unit ("2 ขวด" counted by the มิลลิลิตร), so the card asks how
	// much one holds.
	NeedsPack    bool     `json:"needs_pack"`
	PackUnit     string   `json:"pack_unit,omitempty"`
	PackUnits    []string `json:"pack_units"`
	PackSize     float64  `json:"pack_size,omitempty"`
	Stock        float64  `json:"stock"`
	PriceModes   []string `json:"price_modes"`
	PriceMode    string   `json:"price_mode"`
	Price        float64  `json:"price,omitempty"`
	CostPerUnit  float64  `json:"cost_per_unit,omitempty"`
	Total        float64  `json:"total,omitempty"`
	StorageType  string   `json:"storage_type"`
	StorageTypes []string `json:"storage_types"`
	MinPercent   float64  `json:"min_percent"`
	// The stock list's sections, and the one chosen (0 = none).
	Categories []AISetupCategory `json:"categories"`
	CategoryID uint              `json:"category_id"`
	// The opening lot's shelf life: ExpiryDays in force (0 = no date),
	// ExpirySet once the owner chose it (until then it follows the storage
	// type), the choices offered, and the date it comes to.
	ExpiryDays    int    `json:"expiry_days"`
	ExpirySet     bool   `json:"expiry_set"`
	ExpiryOptions []int  `json:"expiry_options"`
	ExpiresAt     string `json:"expires_at,omitempty"`
	// CanCase: there is a pack, so a case of packs can be set.
	CanCase   bool     `json:"can_case"`
	CaseUnit  string   `json:"case_unit,omitempty"`
	CaseUnits []string `json:"case_units"`
	CaseSize  float64  `json:"case_size,omitempty"`
	// Missing names what the inventory needs and the card has not got yet.
	// Confirming is refused until it is empty.
	Missing []string `json:"missing,omitempty"`
}

const (
	aiSetupPriceTotal   = "total"
	aiSetupPricePerPack = "per_pack"
	aiSetupPricePerUnit = "per_unit"
	// aiSetupWindow is how long a card being filled in stays open. The owner
	// asked for no countdown while answering (25 ก.ย. 2569); the minute starts
	// on the last answer, at the confirm bar.
	aiSetupWindow = 10 * time.Minute
)

// AISetupCategory is one section of the stock list the card offers.
type AISetupCategory struct {
	ID   uint   `json:"id"`
	Name string `json:"name"`
}

// aiSetupShelfLifeDays is the inventory form's DEFAULT_SHELF_LIFE_DAYS
// (inventoryExpiryUtils.ts): the opening lot's expiry until the owner picks one.
var aiSetupShelfLifeDays = map[string]int{"room_temp": 2, "chilled": 3, "frozen": 30, "dry": 180}

// aiSetupShelfLifeOptions is the form's restockShelfLifePresets, default first.
func aiSetupShelfLifeOptions(storage string) []int {
	switch storage {
	case "dry":
		return []int{180, 365, 730}
	case "frozen":
		return []int{30, 60, 90}
	case "chilled":
		return []int{3, 5, 7}
	default:
		return []int{2, 3, 7}
	}
}

// aiSetupCaseUnits are the outer containers a pack comes in.
var aiSetupCaseUnits = []string{"ลัง", "แพ็ก", "กล่อง", "โหล"}

// aiSetupStorageTypes are the inventory form's (inventoryPageUtils STORAGE_TYPES).
var aiSetupStorageTypes = []string{"room_temp", "chilled", "frozen", "dry"}

// aiSetupPackUnits are the containers the card offers when the one said is
// not how it is bought. The said word is put first when it is not one of these.
var aiSetupPackUnits = []string{"ขวด", "แกลลอน", "ถุง", "แพ็ก", "กล่อง", "กระป๋อง", "ซอง", "ลัง"}

// aiSetupFirstUnit is the unit a card starts on: the one said, when it is a
// unit the shelf measures by. A sealed container word ("2 ขวด") starts blank —
// fish sauce is more often poured than used by the bottle, so it is asked.
func aiSetupFirstUnit(saidUnit string) string {
	unit, ok := ingredientStockUnit(saidUnit)
	if !ok || sealedStockUnits[unit] {
		return ""
	}
	return unit
}

// buildIngredientSetup validates a card-driven create and computes everything
// the card shows. Unanswered questions are allowed here — they are what the
// card asks next — and listed in Missing, which execution refuses.
//
// Everything the inventory needs is asked (เจ้าของสั่ง 25 ก.ย. 2569 ให้กรอกครบ):
// the unit, the opening stock, what one pack holds when it was said in packs,
// and a price. Storage and the reorder level have the form's own defaults and
// are shown to be accepted as they are.
func buildIngredientSetup(shelf []entity.Ingredient, categories []entity.IngredientCategory, name string, saidQuantity float64, saidUnit string, answers AIIngredientSetupAnswers) (AIActionItemPayload, AIActionItemPreview, error) {
	cleanName := strings.TrimSpace(name)
	if cleanName == "" {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ต้องมีชื่อวัตถุดิบ")
	}
	match := ResolveIngredientName(shelf, cleanName)
	if match.Exact != nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("มี “%s” ในคลังอยู่แล้ว", match.Exact.Name)
	}
	if saidQuantity < 0 || saidQuantity > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	said := standardUnitSpelling(saidUnit)

	unit := ""
	if chosen := strings.TrimSpace(answers.Unit); chosen != "" {
		allowed, ok := ingredientStockUnit(chosen)
		if !ok {
			return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("“%s” ใช้เป็นหน่วยนับในคลังไม่ได้ เลือกจาก %s", chosen, strings.Join(IngredientStockUnits, " / "))
		}
		unit = allowed
	}

	view := AIIngredientSetupView{
		Name:         cleanName,
		SaidQuantity: saidQuantity,
		SaidUnit:     said,
		Unit:         unit,
		Units:        append([]string(nil), IngredientStockUnits...),
		NeedsStock:   saidQuantity <= 0,
		PackUnits:    aiSetupPackUnitsFor(said),
		StorageType:  "room_temp",
		// Left out at first, and the card's last step crashed the chat page
		// drawing a list that was null (25 ก.ย. 2569).
		StorageTypes: append([]string(nil), aiSetupStorageTypes...),
	}

	// The opening stock, in the chosen unit.
	stock := 0.0
	packSize := 0.0
	if unit != "" {
		switch {
		case view.NeedsStock:
			if answers.Stock != nil {
				// Above zero, the same rule as the price: the card asked for
				// both and took 0 for one of them, which read as a rule with
				// an exception (เจ้าของ 25 ก.ย. 2569). Nothing on hand yet is
				// nothing to add yet; it is added when it is bought.
				if *answers.Stock <= 0 {
					return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("จำนวนเริ่มต้นต้องมากกว่า 0")
				}
				if *answers.Stock > aiActionMaxQuantity {
					return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
				}
				stock = *answers.Stock
				view.StockSet = true
			}
		case said == "" || sameUnit(said, unit):
			stock = saidQuantity
		default:
			if converted, ok := ConvertToStockUnit(saidQuantity, said, unit); ok {
				stock = converted
				break
			}
			// Said in a container ("2 ขวด") the chosen unit cannot be reached
			// from: the pack size is what connects them.
			view.NeedsPack = true
			packUnit := said
			if word := standardUnitSpelling(answers.PackUnit); word != "" {
				packUnit = word
			}
			if err := purchaseUnitClashes(packUnit, unit); err != nil {
				return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("“%s” ใช้เป็นหน่วยที่ซื้อของ%sไม่ได้ เพราะแปลงเป็น%sได้อยู่แล้ว", packUnit, cleanName, unit)
			}
			view.PackUnit = packUnit
			if answers.PackSize > 0 {
				if answers.PackSize > aiActionMaxQuantity {
					return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
				}
				packSize = answers.PackSize
				view.PackSize = packSize
				stock = saidQuantity * packSize
			}
		}
	}
	if stock < 0 || stock > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	view.Stock = stock

	// The price, however it was paid, restated per stock unit. "Per unit"
	// always works; "all of it" needs a stock to divide by, "per bottle" a
	// bottle size.
	if unit != "" {
		if stock > 0 {
			view.PriceModes = append(view.PriceModes, aiSetupPriceTotal)
		}
		if packSize > 0 {
			view.PriceModes = append(view.PriceModes, aiSetupPricePerPack)
		}
		view.PriceModes = append(view.PriceModes, aiSetupPricePerUnit)
	}
	priceMode := answers.PriceMode
	if !aiSetupHas(view.PriceModes, priceMode) {
		priceMode = ""
		if len(view.PriceModes) > 0 {
			priceMode = view.PriceModes[0]
		}
	}
	view.PriceMode = priceMode
	cost, total := 0.0, 0.0
	switch {
	case answers.Price < 0 || answers.Price > aiActionMaxQuantity:
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ราคาต้องไม่ติดลบ")
	case answers.Price > 0 && unit != "":
		switch priceMode {
		case aiSetupPriceTotal:
			total = roundBaht(answers.Price)
			cost = total / stock
		case aiSetupPricePerPack:
			total = roundBaht(answers.Price * saidQuantity)
			cost = answers.Price / packSize
		default:
			cost = answers.Price
			total = roundBaht(cost * stock)
		}
		view.Price = answers.Price
		view.Total = total
		view.CostPerUnit = cost
	}

	storage := strings.TrimSpace(answers.StorageType)
	if storage == "" {
		storage = "room_temp"
	}
	if !aiSetupStorageAllowed(storage) {
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("ไม่รู้จักวิธีเก็บ “%s”", storage)
	}
	view.StorageType = storage
	if answers.MinPercent < 0 || answers.MinPercent > 100 {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("เปอร์เซ็นต์เตือนต้องอยู่ระหว่าง 0 ถึง 100")
	}
	view.MinPercent = answers.MinPercent

	// Section of the stock list.
	view.Categories = []AISetupCategory{}
	for _, category := range categories {
		if category.IsActive {
			view.Categories = append(view.Categories, AISetupCategory{ID: category.ID, Name: category.Name})
		}
	}
	if answers.CategoryID != 0 {
		found := false
		for _, category := range view.Categories {
			found = found || category.ID == answers.CategoryID
		}
		if !found {
			return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ไม่มีหมวดวัตถุดิบนี้ในร้าน")
		}
		view.CategoryID = answers.CategoryID
	}

	// The opening lot's expiry, from the storage type until the owner picks.
	view.ExpiryOptions = aiSetupShelfLifeOptions(storage)
	view.ExpiryDays = aiSetupShelfLifeDays[storage]
	if answers.ExpiryDays != nil {
		if *answers.ExpiryDays < 0 || *answers.ExpiryDays > 3650 {
			return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("อายุของต้องอยู่ระหว่าง 0 ถึง 3650 วัน")
		}
		view.ExpiryDays = *answers.ExpiryDays
		view.ExpirySet = true
	}
	if view.ExpiryDays > 0 && stock > 0 {
		view.ExpiresAt = repository.BangkokNow().AddDate(0, 0, view.ExpiryDays).Format("2006-01-02")
	}

	// A case of packs, once there is a pack to count it in.
	view.CanCase = view.PackUnit != "" && packSize > 0
	view.CaseUnits = []string{}
	caseSize := 0.0
	if view.CanCase {
		for _, word := range aiSetupCaseUnits {
			if word != view.PackUnit {
				view.CaseUnits = append(view.CaseUnits, word)
			}
		}
		if word := standardUnitSpelling(answers.CaseUnit); word != "" {
			if sameUnit(word, view.PackUnit) {
				return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("หน่วยลังต้องต่างจากหน่วยบรรจุภัณฑ์")
			}
			if err := purchaseUnitClashes(word, unit); err != nil {
				return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("“%s” ใช้เป็นหน่วยลังไม่ได้", word)
			}
			view.CaseUnit = word
			if answers.CaseSize < 0 || answers.CaseSize > aiActionMaxQuantity {
				return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
			}
			caseSize = answers.CaseSize
			view.CaseSize = caseSize
		}
	}

	switch {
	case unit == "":
		view.Missing = append(view.Missing, "หน่วยนับ")
	case view.NeedsStock && !view.StockSet:
		view.Missing = append(view.Missing, "จำนวนที่มีตอนนี้")
	case view.NeedsPack && packSize <= 0:
		view.Missing = append(view.Missing, fmt.Sprintf("1 %sกี่%s", view.PackUnit, unit))
	}
	if cost <= 0 {
		view.Missing = append(view.Missing, "ราคา")
	}
	if view.CaseUnit != "" && caseSize <= 0 {
		view.Missing = append(view.Missing, fmt.Sprintf("1 %sกี่%s", view.CaseUnit, view.PackUnit))
	}

	payload := AIActionItemPayload{
		Name:         cleanName,
		Unit:         unit,
		Quantity:     stock,
		CostPerUnit:  cost,
		Setup:        true,
		SaidQuantity: saidQuantity,
		SaidUnit:     said,
		StockAnswer:  answers.Stock,
		PackUnit:     view.PackUnit,
		PackSize:     packSize,
		PriceMode:    priceMode,
		Price:        view.Price,
		StorageType:  storage,
		MinPercent:   view.MinPercent,
		Missing:      view.Missing,
		CategoryID:   view.CategoryID,
		ExpiresAt:    view.ExpiresAt,
		CaseUnit:     view.CaseUnit,
		CaseSize:     caseSize,
	}
	preview := aiIngredientSetupPreview(view)
	if note := aiSimilarShelfNote(match); note != "" {
		preview.SideEffects = append(preview.SideEffects, note)
	}
	return payload, preview, nil
}

func aiSetupHas(list []string, value string) bool {
	for _, entry := range list {
		if entry == value {
			return true
		}
	}
	return false
}

// aiSimilarShelfNote names what is already on the shelf under a longer name
// — "ซอสหอยนางรม" said over a shelf holding "ซอสหอยนางรมแม่ครัว". It is not
// refused: "ผักชี" beside "ผักชีฝรั่ง" is a different ingredient and a real
// one to add. But the owner decides that knowing the other row is there,
// instead of finding two rows later.
func aiSimilarShelfNote(match AIIngredientMatch) string {
	if len(match.Candidates) == 0 {
		return ""
	}
	names := make([]string, 0, len(match.Candidates))
	for _, candidate := range match.Candidates {
		names = append(names, "“"+candidate.Name+"”")
	}
	return fmt.Sprintf("ในคลังมีชื่อคล้ายกันอยู่แล้ว: %s · ถ้าเป็นของตัวเดียวกัน ให้ยกเลิกแล้วสั่งรับเข้าแทน", strings.Join(names, ", "))
}

// aiIngredientSetupPreview writes the card's review lines and warnings from
// the computed state.
func aiIngredientSetupPreview(view AIIngredientSetupView) AIActionItemPreview {
	preview := AIActionItemPreview{
		Title: view.Name,
		Kind:  entity.AIActionTypeCreateIngredient,
		Unit:  view.Unit,
		Setup: &view,
	}
	if view.Unit == "" {
		preview.Change = "เพิ่มเข้าคลัง · ยังไม่ได้เลือกหน่วยนับ"
		return preview
	}
	unit := view.Unit
	preview.Change = fmt.Sprintf("เพิ่มเข้าคลัง · หน่วย%s · เริ่มที่ %s", unit, formatStockNumber(view.Stock))

	stockLine := formatStockNumber(view.Stock) + " " + unit
	if view.PackSize > 0 {
		stockLine += fmt.Sprintf(" (%s %s)", formatStockNumber(view.SaidQuantity), view.PackUnit)
	}
	preview.Facts = []AIActionPreviewFact{
		{Label: "หน่วย", Value: unit},
		{Label: "สต๊อกเริ่มต้น", Value: stockLine},
	}
	if view.PackSize > 0 {
		preview.Facts = append(preview.Facts, AIActionPreviewFact{
			Label: "ซื้อเป็น", Value: fmt.Sprintf("%sละ %s %s", view.PackUnit, formatStockNumber(view.PackSize), unit)})
	}
	if view.CostPerUnit > 0 {
		preview.Facts = append(preview.Facts, AIActionPreviewFact{Label: "ราคาต่อ" + unit, Value: aiSetupCostText(view.CostPerUnit) + " บาท"})
	}
	if view.CaseUnit != "" && view.CaseSize > 0 {
		preview.Facts = append(preview.Facts, AIActionPreviewFact{
			Label: "ยกลัง", Value: fmt.Sprintf("%sละ %s %s", view.CaseUnit, formatStockNumber(view.CaseSize), view.PackUnit)})
	}
	for _, category := range view.Categories {
		if category.ID == view.CategoryID {
			preview.Facts = append(preview.Facts, AIActionPreviewFact{Label: "หมวด", Value: category.Name})
		}
	}
	preview.Facts = append(preview.Facts, AIActionPreviewFact{Label: "การเก็บ", Value: aiSetupStorageLabel(view.StorageType)})
	if view.ExpiresAt != "" {
		preview.Facts = append(preview.Facts, AIActionPreviewFact{
			Label: "หมดอายุ", Value: fmt.Sprintf("%s (%d วัน)", aiThaiDate(view.ExpiresAt), view.ExpiryDays)})
	}
	if view.MinPercent > 0 {
		preview.Facts = append(preview.Facts, AIActionPreviewFact{
			Label: "เตือนเมื่อเหลือ",
			Value: fmt.Sprintf("ต่ำกว่า %s%% (%s %s)", formatStockNumber(view.MinPercent), formatStockNumber(view.Stock*view.MinPercent/100), unit)})
	}

	if view.Total > 0 {
		preview.SideEffects = append(preview.SideEffects,
			aiExpenseSideEffect(view.Total))
	}
	if sealedStockUnits[unit] {
		preview.SideEffects = append(preview.SideEffects,
			fmt.Sprintf("นับเป็น%sทั้ง%s · ถ้าเทแบ่งใช้ ให้เลือกหน่วยมิลลิลิตรหรือกรัมแทน", unit, unit))
	}
	if len(view.Missing) > 0 {
		preview.SideEffects = append(preview.SideEffects, "ยังกรอกไม่ครบ: "+strings.Join(view.Missing, " · "))
	}
	return preview
}

// aiSetupCostText keeps the digits a per-gram price needs: 0.18 บาท/กรัม
// printed as 0 is how a menu's cost reads as free.
func aiSetupCostText(cost float64) string {
	if cost < 1 {
		return fmt.Sprintf("%.3f", math.Round(cost*1000)/1000)
	}
	return formatStockNumber(math.Round(cost*100) / 100)
}

func aiSetupStorageAllowed(storage string) bool {
	for _, allowed := range aiSetupStorageTypes {
		if storage == allowed {
			return true
		}
	}
	return false
}

func aiSetupStorageLabel(storage string) string {
	switch storage {
	case "chilled":
		return "แช่เย็น"
	case "frozen":
		return "แช่แข็ง"
	case "dry":
		return "ของแห้ง"
	default:
		return "อุณหภูมิห้อง"
	}
}

func aiSetupPackUnitsFor(said string) []string {
	units := append([]string(nil), aiSetupPackUnits...)
	if said == "" {
		return units
	}
	if _, ok := ingredientStockUnit(said); ok && !sealedStockUnits[said] {
		return units
	}
	for _, unit := range units {
		if unit == said {
			return units
		}
	}
	return append([]string{said}, units...)
}

// aiCardCreateResolution turns a draft into a card-driven create when the
// client draws the card and the draft names something new. Anything it does
// not take goes through ResolveStockCommand as before — including an
// ingredient that already exists and a restock with no unit, which is still
// asked about ("ให้ผมเพิ่มเข้าคลังให้ไหม").
func aiCardCreateResolution(shelf []entity.Ingredient, draft AIStockCommandDraft) (AICommandResolution, bool) {
	title := strings.TrimSpace(draft.Name)
	if title == "" || draft.Quantity < 0 {
		return AICommandResolution{}, false
	}
	match := ResolveIngredientName(shelf, title)
	switch strings.ToLower(strings.TrimSpace(draft.Kind)) {
	case "create":
		if match.Exact != nil {
			return AICommandResolution{}, false
		}
	case "in", "adjust":
		if strings.TrimSpace(draft.Unit) == "" || match.Exact != nil || len(match.Candidates) > 0 {
			return AICommandResolution{}, false
		}
	default:
		return AICommandResolution{}, false
	}
	return AICommandResolution{
		Kind:  AICommandOutcomeReady,
		Title: title,
		Command: AIAdjustStockCommand{
			Kind:     "create",
			Setup:    true,
			Quantity: draft.Quantity,
			Name:     title,
			Unit:     strings.TrimSpace(draft.Unit),
			Note:     strings.TrimSpace(draft.Note),
		},
	}, true
}

// AIActionPlanReviser is the store method the card's answers go through. It
// is separate from AIActionPlanStore so the test fakes that never revise keep
// compiling.
type AIActionPlanReviser interface {
	ReviseAIActionPlanItem(restaurantID, ownerUserID uint, planID, confirmationToken string, seq int, ttl time.Duration, revise repository.AIActionPlanItemRevision) (*entity.AIActionPlan, error)
}

// SetupAIPlanIngredientForOwner applies one answer from the card to a pending
// plan's new ingredient and returns the plan as the card now draws it.
func (s *AIService) SetupAIPlanIngredientForOwner(actor AIActorContext, planID string, seq int, request AIIngredientSetupRequest) (*AIActionPlanResponse, error) {
	if actor.RestaurantID == 0 || actor.OwnerUserID == 0 || actor.Role != "owner" {
		return nil, ErrAIActionsDisabled
	}
	if !s.ownerActionsEnabled(actor.RestaurantID) {
		return nil, ErrAIActionsDisabled
	}
	reviser, ok := s.actionPlanStore.(AIActionPlanReviser)
	if !ok || s.actionIngredients == nil {
		return nil, ErrAIActionUnavailable
	}
	shelf, err := s.actionIngredients.ListIngredients(actor.RestaurantID)
	if err != nil {
		return nil, err
	}
	categories := aiSetupCategoriesOf(s.actionIngredients, actor.RestaurantID)
	// Open for the whole card while it is asking; the usual minute from the
	// last answer, which the confirm bar counts down.
	window := aiSetupWindow
	if request.Finish {
		window = 0
	}
	plan, err := reviser.ReviseAIActionPlanItem(actor.RestaurantID, actor.OwnerUserID, planID, request.ConfirmationToken, seq, window,
		func(item entity.AIActionPlanItem) (string, string, error) {
			var current AIActionItemPayload
			if err := json.Unmarshal([]byte(item.PayloadJSON), &current); err != nil || !current.Setup {
				return "", "", repository.ErrAIActionPlanItemNotEditable
			}
			payload, preview, err := buildIngredientSetup(shelf, categories, current.Name, current.SaidQuantity, current.SaidUnit, request.AIIngredientSetupAnswers)
			if err != nil {
				return "", "", err
			}
			payloadJSON, err := json.Marshal(payload)
			if err != nil {
				return "", "", err
			}
			previewJSON, err := json.Marshal(preview)
			if err != nil {
				return "", "", err
			}
			return string(payloadJSON), string(previewJSON), nil
		})
	if err != nil {
		return nil, err
	}
	return aiPlanResponseFromStored(plan), nil
}

// aiPlanResponseFromStored rebuilds the confirm card from a stored plan. The
// token is left out: only its digest is stored, and the card already has it.
func aiPlanResponseFromStored(plan *entity.AIActionPlan) *AIActionPlanResponse {
	items := make([]AIActionPlanItemResponse, 0, len(plan.Items))
	for _, item := range plan.Items {
		var preview AIActionItemPreview
		if err := json.Unmarshal([]byte(item.PreviewJSON), &preview); err != nil {
			preview = AIActionItemPreview{Title: "รายการ", Change: "อ่านรายละเอียดไม่ได้"}
		}
		items = append(items, aiPlanItemResponse(preview))
	}
	return &AIActionPlanResponse{
		ID:        plan.ID,
		Status:    plan.Status,
		ExpiresAt: plan.ExpiresAt.Format(aiActionPlanTimeLayout),
		Summary:   plan.Summary,
		Items:     items,
	}
}

// aiPlanItemResponse is one item of the confirm card.
func aiPlanItemResponse(preview AIActionItemPreview) AIActionPlanItemResponse {
	return AIActionPlanItemResponse{
		Title:       preview.Title,
		Change:      preview.Change,
		Unit:        preview.Unit,
		SideEffects: preview.SideEffects,
		Kind:        preview.Kind,
		Field:       preview.Field,
		From:        preview.From,
		To:          preview.To,
		ValueUnit:   preview.ValueUnit,
		Delta:       preview.Delta,
		Facts:       preview.Facts,
		Setup:       preview.Setup,
	}
}

// aiPlanWindow is the plan's opening window: the setup window when an item is
// a card still to be filled in, zero (the usual minute) otherwise.
func aiPlanWindow(items []repository.CreateAIActionPlanItemParams) time.Duration {
	for _, item := range items {
		var payload AIActionItemPayload
		if item.ActionType == entity.AIActionTypeCreateIngredient &&
			json.Unmarshal([]byte(item.PayloadJSON), &payload) == nil && payload.Setup {
			return aiSetupWindow
		}
	}
	return 0
}

// aiExpenseSideEffect is the confirm bar's money line: "รายจ่าย ฿2,500 · ลบไม่ได้".
// It was "บันทึกรายจ่าย 2500 บาท (แก้หรือลบไม่ได้)"; the owner found the bar too
// wordy on a phone and chose a two-line layout (แบบ B, 25 ก.ย. 2569).
func aiExpenseSideEffect(amount float64) string {
	return fmt.Sprintf("รายจ่าย ฿%s · ลบไม่ได้", aiBahtText(amount))
}

// aiBahtText writes baht with thousands separators, and satang only when
// there are some: 2500 → "2,500", 70.5 → "70.50".
func aiBahtText(amount float64) string {
	satang := int64(math.Round(amount * 100))
	whole := formatInt(satang / 100)
	if rest := satang % 100; rest != 0 {
		if rest < 0 {
			rest = -rest
		}
		return fmt.Sprintf("%s.%02d", whole, rest)
	}
	return whole
}

// aiSetupCategoriesOf reads the stock list's sections when the port can - the
// inventory service can; a test fake without them offers none.
func aiSetupCategoriesOf(port AIActionIngredientPort, restaurantID uint) []entity.IngredientCategory {
	// A plan is validated against a shelf wrapper; its sections are the real port's.
	if shelf, ok := port.(*aiPlanShelf); ok {
		port = shelf.AIActionIngredientPort
	}
	lister, ok := port.(interface {
		ListCategories(restaurantID uint, includeInactive bool) ([]entity.IngredientCategory, error)
	})
	if !ok {
		return nil
	}
	categories, err := lister.ListCategories(restaurantID, false)
	if err != nil {
		return nil
	}
	return categories
}
