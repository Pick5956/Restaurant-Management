package repository

import (
	"strings"
	"time"

	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// IngredientListQuery describes an optional filtered/paged read of the inventory.
// A zero Limit means "return everything" — the historical behaviour — so small
// inventories stay one fast request and only large ones opt into paging.
type IngredientListQuery struct {
	Search     string // case-insensitive match on name
	Status     string // "", "ok", "low", "out" (computed from stock vs min_stock)
	CategoryID uint   // 0 = every category
	Sort       string // "", "name", "stock", "priority" (out→low→ok)
	Desc       bool
	Limit      int // 0 = no limit
	Offset     int
}

type IngredientRepository struct {
	db *gorm.DB
}

func NewIngredientRepository(db *gorm.DB) *IngredientRepository {
	return &IngredientRepository{db: db}
}

func (r *IngredientRepository) Transaction(fn func(tx *IngredientRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewIngredientRepository(tx))
	})
}

// disableMenusForDepletedIngredients turns off (is_available = false) every menu
// item whose recipe uses one of the given ingredients that has now run out of
// stock (stock <= 0). It never re-enables an item, so a manual re-open after a
// restock is preserved. Returns how many menus were switched off.
func disableMenusForDepletedIngredients(db *gorm.DB, restaurantID uint, ingredientIDs []uint) (int64, error) {
	if len(ingredientIDs) == 0 {
		return 0, nil
	}
	result := db.Exec(`
UPDATE menu_items SET is_available = false, updated_at = ?
WHERE restaurant_id = ? AND is_available = true AND deleted_at IS NULL AND id IN (
	SELECT mii.menu_item_id
	FROM menu_item_ingredients mii
	JOIN ingredients ing ON ing.id = mii.ingredient_id AND ing.deleted_at IS NULL
	WHERE mii.deleted_at IS NULL AND ing.stock <= 0 AND mii.ingredient_id IN ?
)`, BangkokNow(), restaurantID, ingredientIDs)
	return result.RowsAffected, result.Error
}

// DisableMenusForDepletedIngredients switches off menus whose recipe depends on
// any of the given ingredients once that ingredient has hit zero stock.
func (r *IngredientRepository) DisableMenusForDepletedIngredients(restaurantID uint, ingredientIDs []uint) (int64, error) {
	return disableMenusForDepletedIngredients(r.db, restaurantID, ingredientIDs)
}

func (r *IngredientRepository) List(restaurantID uint) ([]entity.Ingredient, error) {
	var ingredients []entity.Ingredient
	err := r.db.Preload("Category").Where("restaurant_id = ?", restaurantID).Order("name asc").Find(&ingredients).Error
	return ingredients, err
}

// ingredientListBaseQuery holds the restaurant + search + status conditions shared
// by the count and the page query, so both see the exact same filtered set.
func ingredientListBaseQuery(db *gorm.DB, restaurantID uint, q IngredientListQuery) *gorm.DB {
	base := db.Model(&entity.Ingredient{}).Where("restaurant_id = ?", restaurantID)
	if search := strings.TrimSpace(q.Search); search != "" {
		base = base.Where("name ILIKE ?", "%"+search+"%")
	}
	if q.CategoryID != 0 {
		base = base.Where("category_id = ?", q.CategoryID)
	}
	switch q.Status {
	case "out":
		base = base.Where("stock = 0")
	case "low":
		base = base.Where("stock > 0 AND min_stock > 0 AND stock <= min_stock")
	case "ok":
		base = base.Where("stock > 0 AND (min_stock = 0 OR stock > min_stock)")
	}
	return base
}

// ListFiltered returns a filtered, optionally paged slice plus the total matching
// count (for page controls). Ordering, search and status are resolved in SQL so a
// large inventory never has to be shipped whole and filtered in the browser.
func (r *IngredientRepository) ListFiltered(restaurantID uint, q IngredientListQuery) ([]entity.Ingredient, int64, error) {
	var total int64
	if err := ingredientListBaseQuery(r.db, restaurantID, q).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	query := ingredientListBaseQuery(r.db, restaurantID, q).Preload("Category")
	direction := "asc"
	if q.Desc {
		direction = "desc"
	}
	switch q.Sort {
	case "stock":
		query = query.Order("stock " + direction).Order("name asc")
	case "priority":
		// Out first, then low, then ok — the list's default attention order.
		query = query.Order("CASE WHEN stock = 0 THEN 0 WHEN min_stock > 0 AND stock <= min_stock THEN 1 ELSE 2 END").Order("name asc")
	default:
		query = query.Order("name " + direction)
	}
	if q.Limit > 0 {
		query = query.Limit(q.Limit).Offset(q.Offset)
	}

	var items []entity.Ingredient
	if err := query.Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *IngredientRepository) FindByID(restaurantID, ingredientID uint) (*entity.Ingredient, error) {
	var ingredient entity.Ingredient
	err := r.db.Preload("Category").Where("restaurant_id = ? AND id = ?", restaurantID, ingredientID).First(&ingredient).Error
	if err != nil {
		return nil, err
	}
	return &ingredient, nil
}

func (r *IngredientRepository) FindByIDForUpdate(restaurantID, ingredientID uint) (*entity.Ingredient, error) {
	var ingredient entity.Ingredient
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND id = ?", restaurantID, ingredientID).
		First(&ingredient).Error
	if err != nil {
		return nil, err
	}
	return &ingredient, nil
}

func (r *IngredientRepository) Create(ingredient *entity.Ingredient) error {
	return r.db.Create(ingredient).Error
}

func (r *IngredientRepository) UpdateMetadata(ingredient *entity.Ingredient) error {
	return r.db.Model(&entity.Ingredient{}).
		Where("restaurant_id = ? AND id = ?", ingredient.RestaurantID, ingredient.ID).
		Updates(map[string]any{
			"name":          ingredient.Name,
			"sku":           ingredient.SKU,
			"category_id":   ingredient.CategoryID,
			"image_url":     ingredient.ImageURL,
			"unit":          ingredient.Unit,
			"min_stock":     ingredient.MinStock,
			"max_stock":     ingredient.MaxStock,
			"min_percent":   ingredient.MinPercent,
			"cost_per_unit": ingredient.CostPerUnit,
			"yield_percent": ingredient.YieldPercent,
			"storage_type":  ingredient.StorageType,
		}).Error
}

func (r *IngredientRepository) UpdateStock(restaurantID, ingredientID uint, stock float64) error {
	return r.db.Model(&entity.Ingredient{}).
		Where("restaurant_id = ? AND id = ?", restaurantID, ingredientID).
		Update("stock", stock).Error
}

// UpdateStockLevels writes the three numbers that move together — see
// stockLevels in the service package. They go in one statement because a
// maximum that lands without the stock that raised it, or a reorder level that
// lands without the maximum it was computed from, is a row nobody can explain.
func (r *IngredientRepository) UpdateStockLevels(restaurantID, ingredientID uint, stock, maxStock, minStock float64) error {
	return r.db.Model(&entity.Ingredient{}).
		Where("restaurant_id = ? AND id = ?", restaurantID, ingredientID).
		Updates(map[string]any{
			"stock":     stock,
			"max_stock": maxStock,
			"min_stock": minStock,
		}).Error
}

func (r *IngredientRepository) Delete(ingredient *entity.Ingredient) error {
	return r.db.Delete(ingredient).Error
}

func (r *IngredientRepository) IsReferencedByRecipe(restaurantID, ingredientID uint) (bool, error) {
	var count int64
	err := r.db.Model(&entity.MenuItemIngredient{}).
		Where("restaurant_id = ? AND ingredient_id = ?", restaurantID, ingredientID).
		Count(&count).Error
	return count > 0, err
}

func (r *IngredientRepository) CreateTransaction(tx *entity.IngredientTransaction) error {
	return r.db.Create(tx).Error
}

// CreateExpense lives here so a restock and its ledger row commit together. Put
// through the ExpenseRepository it would land in a second transaction, and a
// crash between the two would raise stock without recording what it cost.
func (r *IngredientRepository) CreateExpense(expense *entity.Expense) error {
	return r.db.Create(expense).Error
}

func (r *IngredientRepository) ListCategories(restaurantID uint, includeInactive bool) ([]entity.IngredientCategory, error) {
	var categories []entity.IngredientCategory
	query := r.db.Where("restaurant_id = ?", restaurantID)
	if !includeInactive {
		query = query.Where("is_active = ?", true)
	}
	err := query.Order("display_order asc, name asc").Find(&categories).Error
	return categories, err
}

func (r *IngredientRepository) FindCategory(restaurantID, categoryID uint) (*entity.IngredientCategory, error) {
	var category entity.IngredientCategory
	err := r.db.Where("restaurant_id = ? AND id = ?", restaurantID, categoryID).First(&category).Error
	if err != nil {
		return nil, err
	}
	return &category, nil
}

func (r *IngredientRepository) CreateCategory(category *entity.IngredientCategory) error {
	return r.db.Create(category).Error
}

func (r *IngredientRepository) UpdateCategory(category *entity.IngredientCategory) error {
	return r.db.Save(category).Error
}

// CountIngredientsInCategory reports how many ingredients still point at a
// category, so deletion can be blocked while it is in use.
func (r *IngredientRepository) CountIngredientsInCategory(restaurantID, categoryID uint) (int64, error) {
	var count int64
	err := r.db.Model(&entity.Ingredient{}).
		Where("restaurant_id = ? AND category_id = ?", restaurantID, categoryID).
		Count(&count).Error
	return count, err
}

// DeleteCategory hard-deletes the row (Unscoped) so its (restaurant, name)
// unique slot is freed and the same name can be created again later.
func (r *IngredientRepository) DeleteCategory(restaurantID, categoryID uint) error {
	return r.db.Unscoped().
		Where("restaurant_id = ? AND id = ?", restaurantID, categoryID).
		Delete(&entity.IngredientCategory{}).Error
}

// IngredientTransactionQuery describes a filtered, paged read of the stock
// movement log. A zero IngredientID means "every ingredient in this restaurant"
// (the whole-inventory history), and a zero Limit means "no limit" — which the
// CSV export relies on to hand back a full period rather than one screen.
type IngredientTransactionQuery struct {
	IngredientID uint
	CategoryID   uint
	Type         string    // "", "in", "out", "adjust"
	Search       string    // case-insensitive match on the ingredient name
	From         time.Time // zero = open start; inclusive
	To           time.Time // zero = open end; exclusive
	Limit        int       // 0 = no limit
	Offset       int
}

// IngredientTransactionRow is one movement joined to the names a human needs to
// read it. The log stores only ingredient_id and created_by_id, so a per-item
// view can get away without this — the whole-inventory view and the CSV cannot,
// they would be a wall of numbers.
type IngredientTransactionRow struct {
	entity.IngredientTransaction
	IngredientName string `json:"ingredient_name"`
	IngredientUnit string `json:"ingredient_unit"`
	CategoryName   string `json:"category_name"`
	CreatedByName  string `json:"created_by_name"`
}

// ingredientTransactionBaseQuery holds the conditions shared by the count and the
// page query, so the total always describes the exact rows being paged through.
// Reads go through Table/Scan rather than the model, so the soft-delete condition
// is spelled out here — GORM only adds it automatically for model queries.
func ingredientTransactionBaseQuery(db *gorm.DB, restaurantID uint, q IngredientTransactionQuery) *gorm.DB {
	base := db.Table("ingredient_transactions").
		Joins("LEFT JOIN ingredients ON ingredients.id = ingredient_transactions.ingredient_id").
		Joins("LEFT JOIN ingredient_categories ON ingredient_categories.id = ingredients.category_id").
		Joins("LEFT JOIN users ON users.id = ingredient_transactions.created_by_id").
		Where("ingredient_transactions.restaurant_id = ? AND ingredient_transactions.deleted_at IS NULL", restaurantID)
	if q.IngredientID != 0 {
		base = base.Where("ingredient_transactions.ingredient_id = ?", q.IngredientID)
	}
	if q.CategoryID != 0 {
		base = base.Where("ingredients.category_id = ?", q.CategoryID)
	}
	switch q.Type {
	case "in", "out", "adjust":
		base = base.Where("ingredient_transactions.type = ?", q.Type)
	}
	if search := strings.TrimSpace(q.Search); search != "" {
		base = base.Where("ingredients.name ILIKE ?", "%"+search+"%")
	}
	if !q.From.IsZero() {
		base = base.Where("ingredient_transactions.created_at >= ?", q.From)
	}
	if !q.To.IsZero() {
		base = base.Where("ingredient_transactions.created_at < ?", q.To)
	}
	return base
}

// ListTransactionsFiltered returns a page of movements plus the total matching
// count. Ordering is newest first with the id as a tie-breaker, so two movements
// written in the same instant cannot swap places between pages.
func (r *IngredientRepository) ListTransactionsFiltered(
	restaurantID uint,
	q IngredientTransactionQuery,
) ([]IngredientTransactionRow, int64, error) {
	var total int64
	if err := ingredientTransactionBaseQuery(r.db, restaurantID, q).Count(&total).Error; err != nil {
		return nil, 0, err
	}

	query := ingredientTransactionBaseQuery(r.db, restaurantID, q).
		Select(`ingredient_transactions.*,
			COALESCE(ingredients.name, '') AS ingredient_name,
			COALESCE(ingredients.unit, '') AS ingredient_unit,
			COALESCE(ingredient_categories.name, '') AS category_name,
			TRIM(COALESCE(users.first_name, '') || ' ' || COALESCE(users.last_name, '')) AS created_by_name`).
		Order("ingredient_transactions.created_at desc").
		Order("ingredient_transactions.id desc")
	if q.Limit > 0 {
		query = query.Limit(q.Limit).Offset(q.Offset)
	}

	rows := make([]IngredientTransactionRow, 0)
	if err := query.Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// IngredientUsageWindowDays is the rolling window used to turn recent
// consumption into a daily rate. It deliberately matches aitools.AnalysisWindowDays
// so the inventory page and the assistant never quote different "lasts N days"
// figures for the same ingredient; a test in the aitools package pins them together.
const IngredientUsageWindowDays = 30

// AttachDaysLeft fills DaysLeft/DailyUse on the given ingredients from what was
// actually cooked, in ONE grouped query rather than one per row.
//
// Consumption is read from order_inventory_deductions, not from
// ingredient_transactions: the deductions are what the kitchen actually used,
// and they are the same rows the assistant's own usage figures come from.
// An ingredient with no consumption in the window is left nil — it cannot be
// forecast, and inventing a rate would be worse than saying nothing.
func (r *IngredientRepository) AttachDaysLeft(restaurantID uint, items []entity.Ingredient) error {
	if len(items) == 0 {
		return nil
	}
	since := BangkokNow().AddDate(0, 0, -IngredientUsageWindowDays)

	type usageRow struct {
		IngredientID uint
		Used         float64
	}
	var rows []usageRow
	if err := r.db.Table("order_inventory_deductions").
		Select("ingredient_id, COALESCE(SUM(quantity), 0) AS used").
		Where("restaurant_id = ? AND deleted_at IS NULL AND created_at >= ?", restaurantID, since).
		Group("ingredient_id").
		Scan(&rows).Error; err != nil {
		return err
	}

	usedByID := make(map[uint]float64, len(rows))
	for _, row := range rows {
		usedByID[row.IngredientID] = row.Used
	}

	for index := range items {
		used := usedByID[items[index].ID]
		if used <= 0 {
			continue
		}
		daily := used / float64(IngredientUsageWindowDays)
		if daily <= 0 {
			continue
		}
		days := items[index].Stock / daily
		items[index].DailyUse = &daily
		items[index].DaysLeft = &days
	}
	return nil
}
