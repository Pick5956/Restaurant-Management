package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// The action registry: what the assistant is allowed to do, and how.
//
// Each action type has three separate jobs, kept apart on purpose:
//
//	validate — Go checks the request against the live database (does the thing
//	           exist? is the number sane? is there enough stock?) and builds the
//	           payload. The model's text never becomes a payload directly.
//	preview  — what the owner is shown before confirming, including the side
//	           effects the system will cause on its own (a linked expense that
//	           can never be edited, menus closing when stock hits zero).
//	execute  — calls the same service a button press calls, so business rules
//	           have exactly one implementation and cannot drift.
//
// Nothing here writes. Writing happens only after the owner confirms the plan.

// AIActionPlanStore is the reviewed multi-item write boundary.
type AIActionPlanStore interface {
	CreateAIActionPlan(repository.CreateAIActionPlanParams) (*entity.AIActionPlan, string, error)
	FindAIActionPlan(restaurantID, ownerUserID uint, planID string) (*entity.AIActionPlan, error)
	PendingAIActionPlan(restaurantID, ownerUserID uint) (*entity.AIActionPlan, error)
	ClaimAIActionPlan(restaurantID, ownerUserID uint, planID, confirmationToken string) (*entity.AIActionPlan, bool, error)
	RecordAIActionPlanItem(outcome repository.AIActionPlanItemOutcome) error
	FinishAIActionPlan(planID string, outcomes []repository.AIActionPlanItemOutcome) (*entity.AIActionPlan, error)
	CancelAIActionPlan(restaurantID, ownerUserID uint, planID string) (*entity.AIActionPlan, error)
}

// AIActionIngredientPort is the slice of the ingredient service the action layer
// needs: read one ingredient to validate against, and apply a stock change the
// way the inventory screen does.
type AIActionIngredientPort interface {
	ListIngredients(restaurantID uint) ([]entity.Ingredient, error)
	FindIngredient(restaurantID, ingredientID uint) (*entity.Ingredient, error)
	AdjustStock(restaurantID, ingredientID, userID uint, req *AdjustStockRequest) (*entity.Ingredient, error)
	Create(restaurantID, userID uint, req *IngredientRequest) (*entity.Ingredient, error)
	Update(restaurantID, ingredientID uint, req *IngredientRequest) (*entity.Ingredient, error)
}

// AIActionMenuPort is the slice of the menu service the action layer needs: read
// the catalogue to resolve a spoken name, re-read one row to validate against,
// and flip its availability the way the menu screen's toggle does.
type AIActionMenuPort interface {
	ListMenuItems(restaurantID uint, includeInactive bool, categoryID uint) ([]entity.MenuItem, error)
	FindMenuItem(restaurantID, itemID uint) (*entity.MenuItem, error)
	UpdateMenuItemAvailability(restaurantID, itemID uint, req *MenuItemAvailabilityRequest) (*entity.MenuItem, error)
	// Deliberately the narrow price setter, not UpdateMenuItem: the full update
	// replaces the recipe with whatever the request carries, so using it here
	// would empty the recipe of every menu the assistant repriced.
	UpdateMenuItemPrice(restaurantID, itemID uint, price float64) (*entity.MenuItem, error)
}

// AIActionPorts groups the services the action layer reads and writes through.
// It is a struct rather than a growing parameter list because every new action
// type adds one, and a positional argument that is nil in most call sites is how
// the wrong port eventually gets passed.
type AIActionPorts struct {
	Ingredients AIActionIngredientPort
	Menus       AIActionMenuPort
	Expenses    AIActionExpensePort
}

// AIActionMenuCreator is what creating a menu item needs on top of
// AIActionMenuPort: the categories to file it under and the same Create the
// menu screen calls. It is a separate, optional interface so the existing
// fakes and any narrower port keep compiling; a Menus port that cannot
// create simply cannot, and the command is refused with a reason.
type AIActionMenuCreator interface {
	ListCategories(restaurantID uint, includeInactive bool) ([]entity.Category, error)
	CreateMenuItem(restaurantID uint, req *MenuItemRequest) (*entity.MenuItem, error)
}

// AIActionExpensePort is the slice of the expense ledger the action layer needs.
// Only Create is here: editing or deleting a past entry means finding which one,
// which is a conversation of its own and not part of this boundary yet.
type AIActionExpensePort interface {
	Create(restaurantID, userID uint, req *ExpenseRequest) (*entity.Expense, error)
	List(restaurantID uint, from, until, category string) (*ExpenseListResponse, error)
}

// AITablePort is the read-only slice of the table service the assistant needs.
// There is no write method here on purpose: booking a table is left to the table
// screen, where it takes effect the moment it is tapped (see joyboyToolTableStatus).
type AITablePort interface {
	ListTables(restaurantID uint) ([]entity.RestaurantTable, error)
}

// jsonUnmarshalString decodes a stored JSON column into a typed value.
func jsonUnmarshalString(raw string, target any) error {
	return json.Unmarshal([]byte(raw), target)
}

// --- Request shapes handed in by the command layer ---------------------------

// AIAdjustStockCommand is a validated-by-Go intent to change one thing:
// an ingredient's stock, one of its fields, or whether a menu is being sold.
// Quantity is already expressed in that ingredient's own stock unit.
type AIAdjustStockCommand struct {
	IngredientID uint
	Kind         string // in | out | adjust | min | cost | create | menu_on | menu_off
	Quantity     float64
	Amount       float64 // baht, only meaningful for kind=in
	Note         string
	// Set only when Kind is create.
	Name string
	Unit string
	// Set only for the menu kinds.
	MenuItemID uint
	Available  bool
	// Set only for kind=expense.
	Category string
	Date     string
	// Set only for kind=menu_create: the category the new menu goes in, already
	// resolved to a row of this restaurant, and its name for the preview.
	CategoryID   uint
	CategoryName string
}

// AIActionItemPayload is what gets persisted for an item. It is deliberately
// explicit rather than a free-form map so a new field is a reviewed change.
type AIActionItemPayload struct {
	IngredientID uint    `json:"ingredient_id,omitempty"`
	Kind         string  `json:"kind,omitempty"`
	Quantity     float64 `json:"quantity,omitempty"`
	Amount       float64 `json:"amount,omitempty"`
	Note         string  `json:"note,omitempty"`
	// Used by the ingredient-editing types.
	Name        string  `json:"name,omitempty"`
	Unit        string  `json:"unit,omitempty"`
	MinStock    float64 `json:"min_stock,omitempty"`
	CostPerUnit float64 `json:"cost_per_unit,omitempty"`
	// Used by set_menu_availability. Available carries no omitempty on purpose:
	// closing a menu IS the false value, and omitting it would store a payload
	// that reads as "no change requested".
	MenuItemID uint `json:"menu_item_id,omitempty"`
	Available  bool `json:"available"`
	// Used by create_expense.
	Category string `json:"category,omitempty"`
	Date     string `json:"date,omitempty"`
	// Used by create_menu_item.
	CategoryID uint `json:"category_id,omitempty"`

	// What the row held when the preview was written, for the action types that
	// overwrite a value outright. The owner confirms "5000 → 3000" having read
	// it; if the row is at 9000 by the time the button is pressed — a colleague
	// took a delivery in between — writing 3000 silently destroys that delivery
	// and reports success. Execution re-reads the row and refuses when it no
	// longer matches. Relative changes (stock in/out) carry no expectation: a
	// "+2000" is still right whatever happened meanwhile. The old single-item
	// preview had this check; the multi-item plan lost it.
	ExpectedStock       *float64 `json:"expected_stock,omitempty"`
	ExpectedMinStock    *float64 `json:"expected_min_stock,omitempty"`
	ExpectedCostPerUnit *float64 `json:"expected_cost_per_unit,omitempty"`
	ExpectedPrice       *float64 `json:"expected_price,omitempty"`
	ExpectedAvailable   *bool    `json:"expected_available,omitempty"`
}

// ErrAIActionChangedMeanwhile is returned by execution when the row no longer
// matches what the owner was shown. The item is left unwritten; the owner is
// told what moved and asked to prepare the change again.
var ErrAIActionChangedMeanwhile = errors.New("ข้อมูลเปลี่ยนไประหว่างรอยืนยัน")

// aiActionChangedMeanwhile names the field that moved and both values, so the
// owner reads "สต๊อก 5000 → 9000" rather than a bare refusal.
func aiActionChangedMeanwhile(what, was, now string) error {
	return fmt.Errorf("%w: %s %s → %s ยังไม่ได้แก้ ขอให้สั่งใหม่อีกครั้ง", ErrAIActionChangedMeanwhile, what, was, now)
}

func aiFloatsDiffer(expected *float64, actual float64) bool {
	if expected == nil {
		return false
	}
	diff := *expected - actual
	return diff > 1e-9 || diff < -1e-9
}

// AIActionItemPreview is what the owner reads before confirming.
type AIActionItemPreview struct {
	Title       string   `json:"title"`
	Change      string   `json:"change"`
	Unit        string   `json:"unit,omitempty"`
	SideEffects []string `json:"side_effects,omitempty"`
}

// --- Validation --------------------------------------------------------------

var (
	ErrAIActionUnknownIngredient = errors.New("ไม่พบวัตถุดิบที่ระบุ")
	ErrAIActionBadQuantity       = errors.New("จำนวนต้องมากกว่า 0")
	ErrAIActionBadKind           = errors.New("ชนิดการปรับสต๊อกต้องเป็น in, out หรือ adjust")
	ErrAIActionNotEnoughStock    = errors.New("สต๊อกไม่พอสำหรับตัดออก")
	ErrAIActionAmountOnlyForIn   = errors.New("ยอดเงินใช้ได้เฉพาะการรับเข้า")
)

const aiActionMaxQuantity = 1e12

// validateAdjustStock turns an intent into a payload plus the preview the owner
// will read, checking everything against the live row first.
func validateAdjustStock(port AIActionIngredientPort, restaurantID uint, command AIAdjustStockCommand) (AIActionItemPayload, AIActionItemPreview, error) {
	kind := strings.ToLower(strings.TrimSpace(command.Kind))
	if kind != "in" && kind != "out" && kind != "adjust" {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadKind
	}
	if command.Quantity <= 0 || command.Quantity > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	if command.Amount > 0 && kind != "in" {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionAmountOnlyForIn
	}

	ingredient, err := port.FindIngredient(restaurantID, command.IngredientID)
	if err != nil || ingredient == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionUnknownIngredient
	}

	next, err := aiActionNextStock(ingredient.Stock, kind, command.Quantity)
	if err != nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, err
	}

	// The system charges the restock to the expense ledger itself when a stock-in
	// carries a value — and that row can never be edited or deleted afterwards.
	// The owner must see that before confirming, not discover it later.
	amount := command.Amount
	if kind == "in" && amount == 0 {
		amount = roundBaht(ingredient.CostPerUnit * command.Quantity)
	}

	preview := AIActionItemPreview{
		Title:  ingredient.Name,
		Change: fmt.Sprintf("%s → %s", formatStockNumber(ingredient.Stock), formatStockNumber(next)),
		Unit:   ingredient.Unit,
	}
	if amount > 0 {
		preview.SideEffects = append(preview.SideEffects,
			fmt.Sprintf("บันทึกรายจ่าย %s บาท (แก้หรือลบไม่ได้)", formatStockNumber(amount)))
	}
	if next <= 0 && ingredient.Stock > 0 {
		preview.SideEffects = append(preview.SideEffects, "สต๊อกเหลือ 0 · เมนูที่ใช้วัตถุดิบนี้จะถูกปิดขายอัตโนมัติ")
	}

	payload := AIActionItemPayload{
		IngredientID: ingredient.ID,
		Kind:         kind,
		Quantity:     command.Quantity,
		Amount:       command.Amount,
		Note:         strings.TrimSpace(command.Note),
	}
	if kind == "adjust" {
		stock := ingredient.Stock
		payload.ExpectedStock = &stock
	}
	return payload, preview, nil
}

// aiActionNextStock mirrors the inventory rules: "in" adds, "out" subtracts and
// refuses to go negative, "adjust" sets the level outright.
func aiActionNextStock(current float64, kind string, quantity float64) (float64, error) {
	switch kind {
	case "in":
		return current + quantity, nil
	case "out":
		if current < quantity {
			return 0, ErrAIActionNotEnoughStock
		}
		return current - quantity, nil
	default:
		return quantity, nil
	}
}

func roundBaht(value float64) float64 {
	return float64(int64(value*100+0.5)) / 100
}

// formatStockNumber prints a stock figure without trailing zeros ("2500" not
// "2500.0000"), which is how the inventory screen reads.
func formatStockNumber(value float64) string {
	text := strconv.FormatFloat(value, 'f', -1, 64)
	return text
}

// validateSetIngredientField checks a min-stock or cost change against the live
// row and describes it as "from → to", the only rendering that makes the
// difference between setting and adding unmistakable.
func validateSetIngredientField(port AIActionIngredientPort, restaurantID uint, ingredientID uint, actionType string, value float64) (AIActionItemPayload, AIActionItemPreview, error) {
	if value < 0 || value > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	ingredient, err := port.FindIngredient(restaurantID, ingredientID)
	if err != nil || ingredient == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionUnknownIngredient
	}

	payload := AIActionItemPayload{IngredientID: ingredient.ID}
	preview := AIActionItemPreview{Title: ingredient.Name}
	switch actionType {
	case entity.AIActionTypeSetIngredientMinStock:
		payload.MinStock = value
		currentMin := ingredient.MinStock
		payload.ExpectedMinStock = &currentMin
		preview.Change = fmt.Sprintf("ขั้นต่ำ %s → %s", formatStockNumber(ingredient.MinStock), formatStockNumber(value))
		preview.Unit = ingredient.Unit
		if ingredient.Stock < value {
			preview.SideEffects = append(preview.SideEffects, "สต๊อกตอนนี้ต่ำกว่าขั้นต่ำใหม่ · จะขึ้นเตือนว่าใกล้หมด")
		}
	case entity.AIActionTypeSetIngredientCost:
		payload.CostPerUnit = value
		currentCost := ingredient.CostPerUnit
		payload.ExpectedCostPerUnit = &currentCost
		preview.Change = fmt.Sprintf("ราคาต่อ%s %s → %s บาท", ingredient.Unit, formatStockNumber(ingredient.CostPerUnit), formatStockNumber(value))
		preview.SideEffects = append(preview.SideEffects, "กระทบต้นทุนและกำไรของเมนูที่ใช้วัตถุดิบนี้")
	default:
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("ยังไม่รองรับคำสั่งชนิด %q", actionType)
	}
	return payload, preview, nil
}

// validateCreateIngredient refuses a nameless or unitless ingredient: the unit is
// what recipes are measured against, and the system never converts, so guessing
// it would misread every recipe that later uses this item.
func validateCreateIngredient(shelf []entity.Ingredient, name, unit string, stock, minStock, cost float64) (AIActionItemPayload, AIActionItemPreview, error) {
	cleanName := strings.TrimSpace(name)
	cleanUnit := strings.TrimSpace(unit)
	if cleanName == "" {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ต้องมีชื่อวัตถุดิบ")
	}
	if cleanUnit == "" {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ต้องระบุหน่วย เช่น กรัม หรือ ฟอง")
	}
	if match := ResolveIngredientName(shelf, cleanName); match.Exact != nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("มี “%s” ในคลังอยู่แล้ว", match.Exact.Name)
	}

	preview := AIActionItemPreview{
		Title:  cleanName,
		Change: fmt.Sprintf("เพิ่มเข้าคลัง · หน่วย%s · เริ่มที่ %s", cleanUnit, formatStockNumber(stock)),
		Unit:   cleanUnit,
	}
	if stock > 0 && cost > 0 {
		preview.SideEffects = append(preview.SideEffects,
			fmt.Sprintf("บันทึกรายจ่าย %s บาท (แก้หรือลบไม่ได้)", formatStockNumber(roundBaht(stock*cost))))
	}
	return AIActionItemPayload{
		Name:        cleanName,
		Unit:        cleanUnit,
		Quantity:    stock,
		MinStock:    minStock,
		CostPerUnit: cost,
	}, preview, nil
}

// validateSetMenuAvailability re-reads the menu row and describes the flip in
// the words the owner used to think about it. The row is read again here rather
// than trusted from the catalogue listing, so a toggle someone pressed on the
// menu screen a second ago is what the preview reflects.
func validateSetMenuAvailability(port AIActionMenuPort, restaurantID, menuItemID uint, available bool) (AIActionItemPayload, AIActionItemPreview, error) {
	if port == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionUnavailable
	}
	item, err := port.FindMenuItem(restaurantID, menuItemID)
	if err != nil || item == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, errAIActionTargetNotFound
	}
	if item.IsAvailable == available {
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("“%s” %sอยู่แล้ว", item.Name, aiAvailabilityStateWord(available))
	}

	preview := AIActionItemPreview{
		Title: item.Name,
		Change: fmt.Sprintf("%s → %s",
			aiAvailabilityStateWord(item.IsAvailable), aiAvailabilityStateWord(available)),
	}
	if available {
		preview.SideEffects = append(preview.SideEffects, "ลูกค้าจะสั่งเมนูนี้ได้ทันที")
	} else {
		preview.SideEffects = append(preview.SideEffects, "เมนูนี้จะหายจากหน้าสั่งอาหาร · ออเดอร์ที่สั่งไปแล้วไม่กระทบ")
	}
	currentState := item.IsAvailable
	return AIActionItemPayload{MenuItemID: item.ID, Available: available, ExpectedAvailable: &currentState}, preview, nil
}

// validateCreateExpense checks a drafted ledger entry the way the expense form
// would. Nothing is looked up — an expense has no existing row to check against
// — so this is where the closed category set and the amount bounds are enforced.
func validateCreateExpense(command AIAdjustStockCommand) (AIActionItemPayload, AIActionItemPreview, error) {
	category := strings.ToLower(strings.TrimSpace(command.Category))
	if !entity.IsValidExpenseCategory(category) {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("หมวดรายจ่ายไม่ถูกต้อง")
	}
	if command.Quantity <= 0 || command.Quantity > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	if _, err := time.Parse("2006-01-02", strings.TrimSpace(command.Date)); err != nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("วันที่ต้องเป็นรูปแบบ YYYY-MM-DD")
	}

	note := strings.TrimSpace(command.Note)
	title := note
	if title == "" {
		title = aiExpenseCategoryLabel(category)
	}
	preview := AIActionItemPreview{
		Title: title,
		Change: fmt.Sprintf("บันทึกรายจ่าย %s บาท · หมวด%s · วันที่ %s",
			formatStockNumber(roundBaht(command.Quantity)), aiExpenseCategoryLabel(category), command.Date),
		// Unlike the expense a restock writes for itself, a hand-entered row stays
		// editable — worth saying, because the owner has been told the opposite
		// about the automatic one.
		SideEffects: []string{"แก้หรือลบทีหลังได้ที่หน้ารายจ่าย"},
	}
	return AIActionItemPayload{
		Category: category,
		Amount:   roundBaht(command.Quantity),
		Date:     strings.TrimSpace(command.Date),
		Note:     note,
	}, preview, nil
}

// validateSetMenuPrice checks a price change and, where the recipe allows it,
// says what the change does to the money per plate. The owner is deciding
// whether to raise a price; "139 → 159" alone does not tell them whether that
// covers the cost, and the cost is already known.
// validateCreateMenuItem checks a new menu against the live catalogue: a name
// nobody has yet, a price in range, a category of this restaurant. The row is
// created open for sale with no recipe or picture — that is said on the card.
func validateCreateMenuItem(port AIActionMenuPort, restaurantID uint, command AIAdjustStockCommand) (AIActionItemPayload, AIActionItemPreview, error) {
	if port == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionUnavailable
	}
	if _, ok := port.(AIActionMenuCreator); !ok {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionUnavailable
	}
	name := strings.TrimSpace(command.Name)
	if name == "" {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ต้องมีชื่อเมนู")
	}
	if command.Quantity <= 0 || command.Quantity > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	if command.CategoryID == 0 {
		return AIActionItemPayload{}, AIActionItemPreview{}, errors.New("ต้องเลือกหมวดเมนู")
	}
	menus, err := port.ListMenuItems(restaurantID, true, 0)
	if err != nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, err
	}
	if match := ResolveMenuName(menus, name); match.Exact != nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("มีเมนู “%s” อยู่แล้ว", match.Exact.Name)
	}
	price := roundBaht(command.Quantity)
	category := strings.TrimSpace(command.CategoryName)
	if category == "" {
		category = fmt.Sprintf("หมวด #%d", command.CategoryID)
	}
	preview := AIActionItemPreview{
		Title:  name,
		Change: fmt.Sprintf("เพิ่มเมนูใหม่ ราคา %s บาท · หมวด%s", formatStockNumber(price), category),
		SideEffects: []string{
			"เปิดขายทันที ยังไม่มีสูตร รูป และตัวเลือก — เติมได้ที่หน้าจัดการเมนู",
		},
	}
	return AIActionItemPayload{Name: name, Amount: price, CategoryID: command.CategoryID}, preview, nil
}

func validateSetMenuPrice(port AIActionMenuPort, restaurantID, menuItemID uint, price float64) (AIActionItemPayload, AIActionItemPreview, error) {
	if port == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionUnavailable
	}
	if price < 0 || price > aiActionMaxQuantity {
		return AIActionItemPayload{}, AIActionItemPreview{}, ErrAIActionBadQuantity
	}
	item, err := port.FindMenuItem(restaurantID, menuItemID)
	if err != nil || item == nil {
		return AIActionItemPayload{}, AIActionItemPreview{}, errAIActionTargetNotFound
	}
	next := roundBaht(price)
	if item.Price == next {
		return AIActionItemPayload{}, AIActionItemPreview{}, fmt.Errorf("“%s” ราคา %s บาทอยู่แล้ว", item.Name, formatStockNumber(next))
	}

	preview := AIActionItemPreview{
		Title:  item.Name,
		Change: fmt.Sprintf("ราคา %s → %s บาท", formatStockNumber(item.Price), formatStockNumber(next)),
	}
	if cost := aiMenuRecipeCost(item); cost > 0 {
		preview.SideEffects = append(preview.SideEffects, fmt.Sprintf(
			"กำไรต่อจาน %s → %s บาท (ต้นทุน %s บาท)",
			formatStockNumber(roundBaht(item.Price-cost)), formatStockNumber(roundBaht(next-cost)), formatStockNumber(cost)))
	}
	preview.SideEffects = append(preview.SideEffects, "มีผลกับออเดอร์ใหม่เท่านั้น บิลที่เปิดค้างไว้ใช้ราคาเดิม")
	currentPrice := item.Price
	return AIActionItemPayload{MenuItemID: item.ID, Amount: next, ExpectedPrice: &currentPrice}, preview, nil
}

// aiMenuRecipeCost adds up what one plate costs from the stored recipe. It
// returns 0 when the recipe is missing or its ingredients carry no cost, which
// is the signal to say nothing about margin rather than to report zero cost.
func aiMenuRecipeCost(item *entity.MenuItem) float64 {
	total := 0.0
	for _, component := range item.Ingredients {
		if component.Ingredient == nil {
			return 0
		}
		total += component.Ingredient.CostPerUnit * component.Quantity
	}
	return roundBaht(total)
}

func aiAvailabilityStateWord(available bool) string {
	if available {
		return "เปิดขาย"
	}
	return "ปิดขาย"
}

// --- Building and executing a plan -------------------------------------------

// AIActionPlanDraft is a fully validated plan, ready to be stored for
// confirmation. Rejected holds the items that could not be validated, so the
// assistant can tell the owner which parts of a batch it could not take.
type AIActionPlanDraft struct {
	Items    []repository.CreateAIActionPlanItemParams
	Previews []AIActionItemPreview
	Rejected []AIActionRejectedItem
}

type AIActionRejectedItem struct {
	Title  string
	Reason string
}

// aiValidateCommand sends one command to the validator for its kind and reports
// which action type it becomes.
func aiValidateCommand(ports AIActionPorts, restaurantID uint, command AIAdjustStockCommand) (AIActionItemPayload, AIActionItemPreview, string, error) {
	switch command.Kind {
	case "menu_on", "menu_off":
		payload, preview, err := validateSetMenuAvailability(ports.Menus, restaurantID, command.MenuItemID, command.Available)
		return payload, preview, entity.AIActionTypeSetMenuAvailability, err
	case "expense":
		payload, preview, err := validateCreateExpense(command)
		return payload, preview, entity.AIActionTypeCreateExpense, err
	case "menu_price":
		payload, preview, err := validateSetMenuPrice(ports.Menus, restaurantID, command.MenuItemID, command.Quantity)
		return payload, preview, entity.AIActionTypeSetMenuPrice, err
	case "menu_create":
		payload, preview, err := validateCreateMenuItem(ports.Menus, restaurantID, command)
		return payload, preview, entity.AIActionTypeCreateMenuItem, err
	case "min":
		payload, preview, err := validateSetIngredientField(ports.Ingredients, restaurantID, command.IngredientID, entity.AIActionTypeSetIngredientMinStock, command.Quantity)
		return payload, preview, entity.AIActionTypeSetIngredientMinStock, err
	case "cost":
		payload, preview, err := validateSetIngredientField(ports.Ingredients, restaurantID, command.IngredientID, entity.AIActionTypeSetIngredientCost, command.Quantity)
		return payload, preview, entity.AIActionTypeSetIngredientCost, err
	case "create":
		shelf, err := ports.Ingredients.ListIngredients(restaurantID)
		if err != nil {
			return AIActionItemPayload{}, AIActionItemPreview{}, "", err
		}
		payload, preview, err := validateCreateIngredient(shelf, command.Name, command.Unit, command.Quantity, 0, 0)
		return payload, preview, entity.AIActionTypeCreateIngredient, err
	default:
		payload, preview, err := validateAdjustStock(ports.Ingredients, restaurantID, command)
		return payload, preview, entity.AIActionTypeAdjustIngredientStock, err
	}
}

// BuildAdjustStockPlan validates every requested change and returns the draft.
// Invalid items are reported, not silently dropped.
func BuildAdjustStockPlan(ports AIActionPorts, restaurantID uint, commands []AIAdjustStockCommand, titles []string) AIActionPlanDraft {
	draft := AIActionPlanDraft{}
	for index, command := range commands {
		title := ""
		if index < len(titles) {
			title = titles[index]
		}
		payload, preview, actionType, err := aiValidateCommand(ports, restaurantID, command)
		if err != nil {
			if title == "" {
				title = fmt.Sprintf("รายการที่ %d", index+1)
			}
			draft.Rejected = append(draft.Rejected, AIActionRejectedItem{Title: title, Reason: err.Error()})
			continue
		}
		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			draft.Rejected = append(draft.Rejected, AIActionRejectedItem{Title: preview.Title, Reason: "สร้างคำสั่งไม่สำเร็จ"})
			continue
		}
		previewJSON, err := json.Marshal(preview)
		if err != nil {
			draft.Rejected = append(draft.Rejected, AIActionRejectedItem{Title: preview.Title, Reason: "สร้างคำสั่งไม่สำเร็จ"})
			continue
		}
		draft.Items = append(draft.Items, repository.CreateAIActionPlanItemParams{
			ActionType:  actionType,
			PayloadJSON: string(payloadJSON),
			PreviewJSON: string(previewJSON),
		})
		draft.Previews = append(draft.Previews, preview)
	}
	return draft
}

// executeAIActionItem runs one stored item through the normal service path.
func executeAIActionItem(ports AIActionPorts, restaurantID, actorUserID uint, item entity.AIActionPlanItem) error {
	switch item.ActionType {
	case entity.AIActionTypeCreateExpense:
		// The same Create the expense form calls, so its validation and its
		// rounding are the ones that run.
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		if ports.Expenses == nil {
			return ErrAIActionUnavailable
		}
		_, err := ports.Expenses.Create(restaurantID, actorUserID, &ExpenseRequest{
			Category: payload.Category,
			Amount:   payload.Amount,
			SpentAt:  payload.Date,
			Note:     payload.Note,
		})
		return err

	case entity.AIActionTypeSetMenuPrice:
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		if ports.Menus == nil {
			return ErrAIActionUnavailable
		}
		if payload.ExpectedPrice != nil {
			current, err := ports.Menus.FindMenuItem(restaurantID, payload.MenuItemID)
			if err != nil || current == nil {
				return errAIActionTargetNotFound
			}
			if aiFloatsDiffer(payload.ExpectedPrice, current.Price) {
				return aiActionChangedMeanwhile("ราคา "+current.Name,
					formatStockNumber(*payload.ExpectedPrice)+" บาท", formatStockNumber(current.Price)+" บาท")
			}
		}
		_, err := ports.Menus.UpdateMenuItemPrice(restaurantID, payload.MenuItemID, payload.Amount)
		return err

	case entity.AIActionTypeCreateMenuItem:
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		creator, ok := ports.Menus.(AIActionMenuCreator)
		if ports.Menus == nil || !ok {
			return ErrAIActionUnavailable
		}
		// Re-checked at the button: a colleague may have added the same dish
		// while the card sat on screen.
		menus, err := ports.Menus.ListMenuItems(restaurantID, true, 0)
		if err != nil {
			return err
		}
		if match := ResolveMenuName(menus, payload.Name); match.Exact != nil {
			return fmt.Errorf("มีเมนู “%s” อยู่แล้ว", match.Exact.Name)
		}
		// The same Create the menu form calls, so its validation and its
		// category check happen here too.
		_, err = creator.CreateMenuItem(restaurantID, &MenuItemRequest{
			Name:       payload.Name,
			Price:      payload.Amount,
			CategoryID: payload.CategoryID,
		})
		return err

	case entity.AIActionTypeSetMenuAvailability:
		// The same call the availability toggle on the menu screen makes, so
		// whatever that does — and whatever it grows into — happens here too.
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		if ports.Menus == nil {
			return ErrAIActionUnavailable
		}
		if payload.ExpectedAvailable != nil {
			current, err := ports.Menus.FindMenuItem(restaurantID, payload.MenuItemID)
			if err != nil || current == nil {
				return errAIActionTargetNotFound
			}
			if current.IsAvailable != *payload.ExpectedAvailable {
				return aiActionChangedMeanwhile(current.Name,
					aiAvailabilityStateWord(*payload.ExpectedAvailable), aiAvailabilityStateWord(current.IsAvailable))
			}
		}
		_, err := ports.Menus.UpdateMenuItemAvailability(restaurantID, payload.MenuItemID, &MenuItemAvailabilityRequest{
			IsAvailable: payload.Available,
		})
		return err

	case entity.AIActionTypeAdjustIngredientStock:
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		if payload.ExpectedStock != nil {
			current, err := ports.Ingredients.FindIngredient(restaurantID, payload.IngredientID)
			if err != nil || current == nil {
				return ErrAIActionUnknownIngredient
			}
			if aiFloatsDiffer(payload.ExpectedStock, current.Stock) {
				return aiActionChangedMeanwhile("สต๊อก "+current.Name,
					formatStockNumber(*payload.ExpectedStock)+" "+current.Unit, formatStockNumber(current.Stock)+" "+current.Unit)
			}
		}
		_, err := ports.Ingredients.AdjustStock(restaurantID, payload.IngredientID, actorUserID, &AdjustStockRequest{
			Type:     payload.Kind,
			Quantity: payload.Quantity,
			Amount:   payload.Amount,
			Note:     payload.Note,
		})
		return err
	case entity.AIActionTypeSetIngredientMinStock, entity.AIActionTypeSetIngredientCost:
		// Editing one field goes through the same Update the inventory form uses,
		// so its validation and its "unit cannot change while recipes use it" rule
		// still apply. The current row is re-read here so a concurrent edit to any
		// other field is preserved rather than overwritten with a stale copy.
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		current, err := ports.Ingredients.FindIngredient(restaurantID, payload.IngredientID)
		if err != nil || current == nil {
			return ErrAIActionUnknownIngredient
		}
		if aiFloatsDiffer(payload.ExpectedMinStock, current.MinStock) {
			return aiActionChangedMeanwhile("ขั้นต่ำ "+current.Name,
				formatStockNumber(*payload.ExpectedMinStock)+" "+current.Unit, formatStockNumber(current.MinStock)+" "+current.Unit)
		}
		if aiFloatsDiffer(payload.ExpectedCostPerUnit, current.CostPerUnit) {
			return aiActionChangedMeanwhile("ราคาต่อ"+current.Unit+" "+current.Name,
				formatStockNumber(*payload.ExpectedCostPerUnit)+" บาท", formatStockNumber(current.CostPerUnit)+" บาท")
		}
		request := aiIngredientRequestFrom(current)
		if item.ActionType == entity.AIActionTypeSetIngredientMinStock {
			// A quantity was asked for, so the percentage link is broken on
			// purpose: leaving it would have the next restock overwrite the
			// number the owner just approved.
			request.MinStock = payload.MinStock
			cleared := 0.0
			request.MinPercent = &cleared
		} else {
			request.CostPerUnit = payload.CostPerUnit
		}
		_, err = ports.Ingredients.Update(restaurantID, payload.IngredientID, request)
		return err

	case entity.AIActionTypeCreateIngredient:
		var payload AIActionItemPayload
		if err := json.Unmarshal([]byte(item.PayloadJSON), &payload); err != nil {
			return errors.New("คำสั่งเสียหาย")
		}
		_, err := ports.Ingredients.Create(restaurantID, actorUserID, &IngredientRequest{
			Name:        payload.Name,
			Unit:        payload.Unit,
			Stock:       payload.Quantity,
			MinStock:    payload.MinStock,
			CostPerUnit: payload.CostPerUnit,
		})
		return err

	default:
		return fmt.Errorf("ยังไม่รองรับคำสั่งชนิด %q", item.ActionType)
	}
}

// aiIngredientRequestFrom copies a stored ingredient into the shape Update
// expects, so changing one field leaves the rest exactly as they were.
func aiIngredientRequestFrom(item *entity.Ingredient) *IngredientRequest {
	request := &IngredientRequest{
		Name:         item.Name,
		SKU:          item.SKU,
		ImageURL:     item.ImageURL,
		Unit:         item.Unit,
		Stock:        item.Stock,
		MinStock:     item.MinStock,
		MinPercent:   &item.MinPercent,
		CostPerUnit:  item.CostPerUnit,
		YieldPercent: item.YieldPercent,
		StorageType:  item.StorageType,
	}
	if item.CategoryID != nil {
		request.CategoryID = *item.CategoryID
	}
	return request
}
