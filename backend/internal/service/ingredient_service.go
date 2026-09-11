package service

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type IngredientService struct {
	repo *repository.IngredientRepository
}

func ProvideIngredientService(repo *repository.IngredientRepository) *IngredientService {
	return &IngredientService{repo: repo}
}

type IngredientRequest struct {
	Name         string  `json:"name" binding:"required,max=160"`
	SKU          string  `json:"sku" binding:"max=80"`
	CategoryID   uint    `json:"category_id"`
	ImageURL     string  `json:"image_url" binding:"max=2048"`
	Unit         string  `json:"unit" binding:"required,max=40"`
	Stock        float64 `json:"stock"`
	MinStock     float64 `json:"min_stock"`
	// MinPercent sets the reorder level as a share of the maximum instead of as
	// a quantity. Above zero it wins and MinStock is computed from it; zero
	// clears the link, so an explicit quantity is never overwritten on the next
	// restock. It is a pointer because leaving the field out has to mean "leave
	// it as it is" — every client that predates this column omits it, and a
	// plain float would read those as a request to clear it.
	MinPercent   *float64 `json:"min_percent"`
	CostPerUnit  float64 `json:"cost_per_unit"`
	YieldPercent float64 `json:"yield_percent"`
	StorageType  string  `json:"storage_type" binding:"max=40"`
}

type IngredientCategoryRequest struct {
	Name         string `json:"name" binding:"required,max=120"`
	DisplayOrder int    `json:"display_order"`
	IsActive     *bool  `json:"is_active"`
}

type AdjustStockRequest struct {
	Type     string  `json:"type" binding:"required"` // "in", "out", "adjust"
	Quantity float64 `json:"quantity" binding:"required"`
	// Unit is what the quantity was typed in. Empty means the ingredient's own
	// stock unit. Any other unit of the same family is converted before the
	// stock moves, so 100 กิโลกรัม and 100 กรัม of the same ingredient add to one
	// shelf row instead of forcing two entries.
	Unit string `json:"unit" binding:"max=40"`
	Note string `json:"note" binding:"max=500"`
	// Amount is what the restock cost. Only meaningful for "in"; a positive
	// value also writes the expense-ledger row.
	Amount float64 `json:"amount"`
}

const (
	maxIngredientQuantity = 1_000_000_000_000
	maxIngredientCost     = 1_000_000_000
)

// ListIngredients and FindIngredient satisfy AIActionIngredientPort so the
// assistant validates against, and writes through, this same service.
func (s *IngredientService) ListIngredients(restaurantID uint) ([]entity.Ingredient, error) {
	items, err := s.repo.List(restaurantID)
	return attachUnitFamilyList(items), err
}

func (s *IngredientService) FindIngredient(restaurantID, ingredientID uint) (*entity.Ingredient, error) {
	return attachUnitFamily(s.repo.FindByID(restaurantID, ingredientID))
}

// attachUnitFamily fills the read-time UnitFamily so a client can offer the
// units this ingredient accepts without shipping its own copy of the table.
func attachUnitFamily(ingredient *entity.Ingredient, err error) (*entity.Ingredient, error) {
	if err != nil || ingredient == nil {
		return ingredient, err
	}
	ingredient.UnitFamily = IngredientUnitFamily(ingredient.Unit)
	return ingredient, nil
}

func attachUnitFamilyList(items []entity.Ingredient) []entity.Ingredient {
	for i := range items {
		items[i].UnitFamily = IngredientUnitFamily(items[i].Unit)
	}
	return items
}

// List returns the whole inventory with the read-time "lasts N days" figure
// attached, so the list, the detail view and the CSV all quote the same number.
func (s *IngredientService) List(restaurantID uint) ([]entity.Ingredient, error) {
	items, err := s.repo.List(restaurantID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.AttachDaysLeft(restaurantID, items); err != nil {
		return nil, err
	}
	return attachUnitFamilyList(items), nil
}

func (s *IngredientService) ListFiltered(restaurantID uint, q repository.IngredientListQuery) ([]entity.Ingredient, int64, error) {
	items, total, err := s.repo.ListFiltered(restaurantID, q)
	if err != nil {
		return nil, 0, err
	}
	if err := s.repo.AttachDaysLeft(restaurantID, items); err != nil {
		return nil, 0, err
	}
	return attachUnitFamilyList(items), total, nil
}

func (s *IngredientService) ListCategories(restaurantID uint, includeInactive bool) ([]entity.IngredientCategory, error) {
	return s.repo.ListCategories(restaurantID, includeInactive)
}

func (s *IngredientService) CreateCategory(restaurantID uint, req *IngredientCategoryRequest) (*entity.IngredientCategory, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("category name is required")
	}
	if len([]rune(name)) > 120 {
		return nil, errors.New("category name is too long")
	}
	category := &entity.IngredientCategory{
		RestaurantID: restaurantID,
		Name:         name,
		DisplayOrder: req.DisplayOrder,
		IsActive:     true,
	}
	if req.IsActive != nil {
		category.IsActive = *req.IsActive
	}
	if err := s.repo.CreateCategory(category); err != nil {
		return nil, err
	}
	return category, nil
}

func (s *IngredientService) UpdateCategory(restaurantID, categoryID uint, req *IngredientCategoryRequest) (*entity.IngredientCategory, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("category name is required")
	}
	if len([]rune(name)) > 120 {
		return nil, errors.New("category name is too long")
	}
	category, err := s.repo.FindCategory(restaurantID, categoryID)
	if err != nil {
		return nil, err
	}
	category.Name = name
	if req.IsActive != nil {
		category.IsActive = *req.IsActive
	}
	if err := s.repo.UpdateCategory(category); err != nil {
		return nil, err
	}
	return category, nil
}

// DeleteCategory removes a category only when no ingredient still uses it — the
// safe choice, so deleting never silently orphans an ingredient's category.
func (s *IngredientService) DeleteCategory(restaurantID, categoryID uint) error {
	if _, err := s.repo.FindCategory(restaurantID, categoryID); err != nil {
		return err
	}
	count, err := s.repo.CountIngredientsInCategory(restaurantID, categoryID)
	if err != nil {
		return err
	}
	if count > 0 {
		return errors.New("category is in use by ingredients")
	}
	return s.repo.DeleteCategory(restaurantID, categoryID)
}

func (s *IngredientService) Create(restaurantID, userID uint, req *IngredientRequest) (*entity.Ingredient, error) {
	name, unit, storageType, categoryID, err := s.normalizeIngredientFields(restaurantID, req)
	if err != nil {
		return nil, err
	}
	if name == "" {
		return nil, errors.New("ingredient name is required")
	}
	if unit == "" {
		return nil, errors.New("unit is required")
	}
	if err := validateIngredientNumbers(req); err != nil {
		return nil, err
	}
	ingredient := &entity.Ingredient{
		RestaurantID: restaurantID,
		Name:         name,
		SKU:          strings.TrimSpace(req.SKU),
		CategoryID:   categoryID,
		ImageURL:     strings.TrimSpace(req.ImageURL),
		Unit:         unit,
		Stock:        req.Stock,
		MinStock:     req.MinStock,
		CostPerUnit:  req.CostPerUnit,
		YieldPercent: sanitizeYieldPercent(req.YieldPercent),
		StorageType:  storageType,
	}
	ingredient.MaxStock = startingMaxStock(req.Stock, req.MinStock)
	ingredient.MinPercent = percentOr(req.MinPercent, 0)
	ingredient.MinStock = reorderLevelFrom(ingredient.MaxStock, ingredient.MinPercent, req.MinStock)
	if err := s.repo.Transaction(func(tx *repository.IngredientRepository) error {
		if err := tx.Create(ingredient); err != nil {
			return err
		}
		initialTx := buildInitialStockTransaction(ingredient, userID)
		if initialTx == nil {
			return nil
		}
		if err := tx.CreateTransaction(initialTx); err != nil {
			return err
		}
		if initialTx.Amount > 0 {
			return tx.CreateExpense(buildRestockExpense(ingredient, userID, initialTx.Note, initialTx.Amount, initialTx.ID))
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return attachUnitFamily(ingredient, nil)
}

func (s *IngredientService) Update(restaurantID, ingredientID uint, req *IngredientRequest) (*entity.Ingredient, error) {
	name, unit, storageType, categoryID, err := s.normalizeIngredientFields(restaurantID, req)
	if err != nil {
		return nil, err
	}
	if name == "" {
		return nil, errors.New("ingredient name is required")
	}
	if unit == "" {
		return nil, errors.New("unit is required")
	}
	if err := validateIngredientNumbers(req); err != nil {
		return nil, err
	}
	ingredient, err := s.repo.FindByID(restaurantID, ingredientID)
	if err != nil {
		return nil, errors.New("ingredient not found")
	}
	if ingredientRecipeUnitChangeBlocked(ingredient.Unit, unit, true) {
		referenced, err := s.repo.IsReferencedByRecipe(restaurantID, ingredientID)
		if err != nil {
			return nil, err
		}
		if referenced {
			return nil, errors.New("cannot change stock units while ingredient is used by a menu recipe")
		}
	}
	ingredient.Name = name
	ingredient.SKU = strings.TrimSpace(req.SKU)
	ingredient.CategoryID = categoryID
	ingredient.ImageURL = strings.TrimSpace(req.ImageURL)
	ingredient.Unit = unit
	ingredient.MinPercent = percentOr(req.MinPercent, ingredient.MinPercent)
	ingredient.MaxStock = startingMaxStock(math.Max(ingredient.MaxStock, ingredient.Stock), req.MinStock)
	ingredient.MinStock = reorderLevelFrom(ingredient.MaxStock, ingredient.MinPercent, req.MinStock)
	ingredient.CostPerUnit = req.CostPerUnit
	ingredient.YieldPercent = sanitizeYieldPercent(req.YieldPercent)
	ingredient.StorageType = storageType
	if err := s.repo.UpdateMetadata(ingredient); err != nil {
		return nil, err
	}
	return s.repo.FindByID(restaurantID, ingredientID)
}

func (s *IngredientService) Delete(restaurantID, ingredientID uint) error {
	return s.repo.Transaction(func(tx *repository.IngredientRepository) error {
		ingredient, err := tx.FindByIDForUpdate(restaurantID, ingredientID)
		if err != nil {
			return errors.New("ingredient not found")
		}
		referenced, err := tx.IsReferencedByRecipe(restaurantID, ingredientID)
		if err != nil {
			return err
		}
		if referenced {
			return errors.New("ingredient is used by a menu recipe")
		}
		return tx.Delete(ingredient)
	})
}

func (s *IngredientService) AdjustStock(restaurantID, ingredientID, userID uint, req *AdjustStockRequest) (*entity.Ingredient, error) {
	var updated *entity.Ingredient
	kind := strings.ToLower(strings.TrimSpace(req.Type))
	note := strings.TrimSpace(req.Note)
	if len([]rune(note)) > 500 {
		return nil, errors.New("stock note is too long")
	}
	amount, err := restockAmount(kind, req.Amount)
	if err != nil {
		return nil, err
	}
	err = s.repo.Transaction(func(tx *repository.IngredientRepository) error {
		ingredient, err := tx.FindByIDForUpdate(restaurantID, ingredientID)
		if err != nil {
			return errors.New("ingredient not found")
		}
		quantity, err := stockQuantityInStockUnit(req.Quantity, req.Unit, ingredient.Unit)
		if err != nil {
			return err
		}
		nextStock, err := applyStockAdjustment(ingredient.Stock, kind, quantity)
		if err != nil {
			return err
		}
		// Whatever the shelf is holding now is proof it can hold that much, so
		// the maximum rises to meet it and the reorder level follows if it is a
		// percentage. See stockLevels for why the maximum is not allowed to fall.
		levels := levelsAfterStockChange(nextStock, ingredient.MaxStock, ingredient.MinStock, ingredient.MinPercent)
		if err := tx.UpdateStockLevels(restaurantID, ingredientID, levels.Stock, levels.MaxStock, levels.MinStock); err != nil {
			return err
		}
		// Running the stock down to zero (or below) closes the sale of every menu
		// that needs this ingredient. Re-opening stays a manual decision.
		if nextStock <= 0 {
			if _, err := tx.DisableMenusForDepletedIngredients(restaurantID, []uint{ingredientID}); err != nil {
				return err
			}
		}
		// Nobody said what this restock cost, so value it at the ingredient's
		// cost per unit. Only inside the transaction is that rate known.
		if amount == 0 && kind == "in" {
			amount = referenceRestockAmount(ingredient.CostPerUnit, quantity)
		}
		stockTransaction := &entity.IngredientTransaction{
			RestaurantID: restaurantID,
			IngredientID: ingredientID,
			Type:         kind,
			Quantity:     quantity,
			Amount:       amount,
			Note:         noteWithEnteredUnit(note, req.Quantity, req.Unit, ingredient.Unit),
			CreatedByID:  userID,
		}
		if err := tx.CreateTransaction(stockTransaction); err != nil {
			return err
		}
		if amount > 0 {
			if err := tx.CreateExpense(buildRestockExpense(ingredient, userID, note, amount, stockTransaction.ID)); err != nil {
				return err
			}
		}
		ingredient.Stock = levels.Stock
		ingredient.MaxStock = levels.MaxStock
		ingredient.MinStock = levels.MinStock
		updated = ingredient
		return nil
	})
	if err != nil {
		return nil, err
	}
	return attachUnitFamily(updated, nil)
}

// ListTransactions reads the stock movement log. The query carries the filters
// the history view and the CSV export share, and the returned rows are joined to
// the ingredient/category/user names so a whole-inventory read is readable.
func (s *IngredientService) ListTransactions(
	restaurantID uint,
	q repository.IngredientTransactionQuery,
) ([]repository.IngredientTransactionRow, int64, error) {
	return s.repo.ListTransactionsFiltered(restaurantID, q)
}

func (s *IngredientService) normalizeIngredientFields(
	restaurantID uint,
	req *IngredientRequest,
) (string, string, string, *uint, error) {
	name := strings.TrimSpace(req.Name)
	unit := strings.TrimSpace(req.Unit)
	storageType := strings.TrimSpace(req.StorageType)
	if storageType == "" {
		storageType = "room_temp"
	}
	if len([]rune(name)) > 160 {
		return "", "", "", nil, errors.New("ingredient name is too long")
	}
	if len([]rune(strings.TrimSpace(req.SKU))) > 80 {
		return "", "", "", nil, errors.New("ingredient SKU is too long")
	}
	if len([]rune(strings.TrimSpace(req.ImageURL))) > 2048 {
		return "", "", "", nil, errors.New("ingredient image URL is too long")
	}
	if len([]rune(unit)) > 40 {
		return "", "", "", nil, errors.New("ingredient unit is too long")
	}
	if len([]rune(storageType)) > 40 {
		return "", "", "", nil, errors.New("ingredient storage type is too long")
	}

	var categoryID *uint
	if req.CategoryID != 0 {
		if _, err := s.repo.FindCategory(restaurantID, req.CategoryID); err != nil {
			return "", "", "", nil, errors.New("ingredient category not found")
		}
		categoryID = &req.CategoryID
	}

	return name, unit, storageType, categoryID, nil
}

func sanitizeYieldPercent(value float64) float64 {
	if value <= 0 {
		return 100
	}
	if value > 100 {
		return 100
	}
	return value
}

func validateIngredientNumbers(req *IngredientRequest) error {
	if !isFiniteIngredientNumber(req.Stock) || req.Stock < 0 {
		return errors.New("stock must be zero or greater")
	}
	if !isFiniteIngredientNumber(req.MinStock) || req.MinStock < 0 {
		return errors.New("minimum stock must be zero or greater")
	}
	if !isFiniteIngredientNumber(req.CostPerUnit) || req.CostPerUnit < 0 {
		return errors.New("cost per unit must be zero or greater")
	}
	if !isFiniteIngredientNumber(req.YieldPercent) || req.YieldPercent < 0 || req.YieldPercent > 100 {
		return errors.New("yield percent must be between 0 and 100")
	}
	if req.MinPercent != nil {
		percent := *req.MinPercent
		if !isFiniteIngredientNumber(percent) || percent < 0 || percent > 100 {
			return errors.New("minimum stock percent must be between 0 and 100")
		}
	}
	if req.Stock > maxIngredientQuantity || req.MinStock > maxIngredientQuantity {
		return errors.New("stock value is too large")
	}
	if req.CostPerUnit > maxIngredientCost {
		return errors.New("cost per unit is too large")
	}
	return nil
}

func applyStockAdjustment(current float64, kind string, quantity float64) (float64, error) {
	kind = strings.ToLower(strings.TrimSpace(kind))
	if !isFiniteIngredientNumber(quantity) || quantity <= 0 {
		return 0, errors.New("quantity must be greater than zero")
	}
	if quantity > maxIngredientQuantity {
		return 0, errors.New("quantity is too large")
	}
	switch kind {
	case "in":
		if current > maxIngredientQuantity-quantity {
			return 0, errors.New("resulting stock is too large")
		}
		return current + quantity, nil
	case "out":
		if current < quantity {
			return 0, errors.New("not enough stock")
		}
		return current - quantity, nil
	case "adjust":
		return quantity, nil
	default:
		return 0, errors.New("type must be 'in', 'out', or 'adjust'")
	}
}

// restockAmount validates the money side of a stock movement. Only "in" can
// carry a cost — an "out" or "adjust" with an amount would silently record
// spending for stock leaving the shelf, so it is rejected rather than ignored.
func restockAmount(kind string, amount float64) (float64, error) {
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, errors.New("amount is not a valid number")
	}
	if amount < 0 {
		return 0, errors.New("amount cannot be negative")
	}
	rounded := roundMoney(amount)
	if rounded == 0 {
		return 0, nil
	}
	if kind != "in" {
		return 0, errors.New("only stock-in can record an amount")
	}
	if rounded > maxIngredientCost {
		return 0, errors.New("amount is too large")
	}
	return rounded, nil
}

// referenceRestockAmount values a restock at the ingredient's own cost per unit.
// It stands in when nobody typed what was actually paid, so a purchase still
// reaches the expense ledger instead of silently costing nothing.
func referenceRestockAmount(costPerUnit, quantity float64) float64 {
	if !isFiniteIngredientNumber(costPerUnit) || !isFiniteIngredientNumber(quantity) {
		return 0
	}
	if costPerUnit <= 0 || quantity <= 0 {
		return 0
	}
	rounded := roundMoney(costPerUnit * quantity)
	if rounded > maxIngredientCost {
		return maxIngredientCost
	}
	return rounded
}

// buildRestockExpense mirrors a stock-in into the expense ledger. Callers must
// write it in the same transaction as the stock movement so the two can never
// disagree about what came into the store room.
func buildRestockExpense(ingredient *entity.Ingredient, userID uint, note string, amount float64, transactionID uint) *entity.Expense {
	expenseNote := ingredient.Name
	if note != "" {
		expenseNote = ingredient.Name + " · " + note
	}
	now := repository.BangkokNow()
	return &entity.Expense{
		RestaurantID:            ingredient.RestaurantID,
		Category:                "ingredient",
		Amount:                  amount,
		SpentAt:                 time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()),
		Note:                    expenseNote,
		CreatedByID:             userID,
		IngredientTransactionID: &transactionID,
	}
}

func buildInitialStockTransaction(ingredient *entity.Ingredient, userID uint) *entity.IngredientTransaction {
	if ingredient == nil || ingredient.Stock <= 0 {
		return nil
	}
	return &entity.IngredientTransaction{
		RestaurantID: ingredient.RestaurantID,
		IngredientID: ingredient.ID,
		Type:         "adjust",
		Quantity:     ingredient.Stock,
		// Opening stock is bought stock: value it the same way a restock with no
		// typed amount is valued.
		Amount: referenceRestockAmount(ingredient.CostPerUnit, ingredient.Stock),
		// Thai, because this string is shown verbatim: on the movement history,
		// in the exported CSV, and — joined to the ingredient name — as the note
		// on the expense row this create writes. The field already carries Thai
		// that cannot be translated anyway (menu names, ingredient names, notes
		// people type), so an English marker here is a false consistency.
		Note:        "ยอดเริ่มต้น",
		CreatedByID: userID,
	}
}

func ingredientRecipeUnitChangeBlocked(currentUnit, nextUnit string, referenced bool) bool {
	if !referenced {
		return false
	}
	return !strings.EqualFold(strings.TrimSpace(currentUnit), strings.TrimSpace(nextUnit))
}

func isFiniteIngredientNumber(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

// stockQuantityInStockUnit restates a typed amount in the ingredient's own unit.
// A unit from the same family is converted; anything else is refused, because a
// wrong factor here moves real stock and nothing later can tell it was wrong.
func stockQuantityInStockUnit(quantity float64, enteredUnit, stockUnit string) (float64, error) {
	unit := strings.TrimSpace(enteredUnit)
	if unit == "" || strings.EqualFold(unit, strings.TrimSpace(stockUnit)) {
		return quantity, nil
	}
	converted, ok := ConvertToStockUnit(quantity, unit, stockUnit)
	if !ok {
		return 0, errors.New("stock unit cannot be converted to the ingredient unit")
	}
	if math.IsNaN(converted) || math.IsInf(converted, 0) {
		return 0, errors.New("stock quantity is not a valid number")
	}
	return converted, nil
}

// noteWithEnteredUnit keeps what the user actually typed on the ledger row. The
// stored quantity is in the ingredient's unit, so without this a 10 กิโลกรัม
// delivery reads as 10,000 กรัม in history with no sign of how it was entered.
// It is written into the existing note rather than a new column so no migration
// is needed for an audit detail.
func noteWithEnteredUnit(note string, quantity float64, enteredUnit, stockUnit string) string {
	unit := strings.TrimSpace(enteredUnit)
	if unit == "" || strings.EqualFold(unit, strings.TrimSpace(stockUnit)) {
		return note
	}
	entered := fmt.Sprintf("กรอก %s %s", strconv.FormatFloat(quantity, 'f', -1, 64), unit)
	if note == "" {
		return entered
	}
	return entered + " · " + note
}
