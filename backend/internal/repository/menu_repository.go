package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MenuRepository struct {
	db *gorm.DB
}

func NewMenuRepository(db *gorm.DB) *MenuRepository {
	return &MenuRepository{db: db}
}

func (r *MenuRepository) Transaction(fn func(tx *MenuRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewMenuRepository(tx))
	})
}

func (r *MenuRepository) ListCategories(restaurantID uint, includeInactive bool) ([]entity.Category, error) {
	var categories []entity.Category
	query := r.db.Where("restaurant_id = ?", restaurantID)
	if !includeInactive {
		query = query.Where("is_active = ?", true)
	}
	err := query.Order("display_order asc, id asc").Find(&categories).Error
	return categories, err
}

func (r *MenuRepository) CreateCategory(category *entity.Category) error {
	return r.db.Create(category).Error
}

func (r *MenuRepository) FindCategory(restaurantID, categoryID uint) (*entity.Category, error) {
	var category entity.Category
	err := r.db.Where("restaurant_id = ? AND id = ?", restaurantID, categoryID).First(&category).Error
	if err != nil {
		return nil, err
	}
	return &category, nil
}

func (r *MenuRepository) FindCategoryForUpdate(restaurantID, categoryID uint) (*entity.Category, error) {
	var category entity.Category
	err := r.db.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("restaurant_id = ? AND id = ?", restaurantID, categoryID).
		First(&category).Error
	if err != nil {
		return nil, err
	}
	return &category, nil
}

// CategoryNameExists reports whether an active category with the same name
// (case-insensitive) already exists for the restaurant. Pass excludeID to skip
// the category being updated so renaming it to its own name is allowed.
func (r *MenuRepository) CategoryNameExists(restaurantID uint, name string, excludeID uint) (bool, error) {
	query := r.db.Model(&entity.Category{}).
		Where("restaurant_id = ? AND LOWER(name) = LOWER(?)", restaurantID, name)
	if excludeID != 0 {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *MenuRepository) UpdateCategory(category *entity.Category) error {
	return r.db.Save(category).Error
}

// DeleteCategory hard-deletes the row (Unscoped) so its (restaurant, name)
// unique slot is freed and the same name can be created again later.
//
// `idx_category_restaurant_name` is a plain unique index, not a partial one, so
// it goes on holding the name of a soft-deleted row — a category deleted by
// mistake could never be recreated, and the owner would get "category already
// exists" for a name nothing on screen uses. The caller has already refused to
// delete a category any menu item still references, so there is nothing left
// pointing at this row. Same fix, same reason, as
// IngredientRepository.DeleteCategory.
func (r *MenuRepository) DeleteCategory(category *entity.Category) error {
	return r.db.Unscoped().
		Where("restaurant_id = ? AND id = ?", category.RestaurantID, category.ID).
		Delete(&entity.Category{}).Error
}

func (r *MenuRepository) CategoryInUse(restaurantID, categoryID uint) (bool, error) {
	var count int64
	err := r.db.Table("menu_items").
		Where(
			"menu_items.restaurant_id = ? AND menu_items.deleted_at IS NULL AND (menu_items.category_id = ? OR EXISTS ("+
				"SELECT 1 FROM menu_item_categories mic WHERE mic.restaurant_id = ? AND mic.menu_item_id = menu_items.id AND mic.category_id = ? AND mic.deleted_at IS NULL))",
			restaurantID,
			categoryID,
			restaurantID,
			categoryID,
		).
		Count(&count).Error
	return count > 0, err
}

func (r *MenuRepository) ListMenuItems(restaurantID uint, includeInactive bool, categoryID uint) ([]entity.MenuItem, error) {
	var items []entity.MenuItem
	query := r.db.
		Preload("Category").
		Preload("Categories", func(db *gorm.DB) *gorm.DB { return db.Order("id asc") }).
		Preload("Categories.Category").
		Preload("Ingredients", func(db *gorm.DB) *gorm.DB { return db.Order("id asc") }).
		Preload("Ingredients.Ingredient").
		Preload("OptionGroups", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Preload("OptionGroups.Options", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Preload("OptionGroups.Options.Ingredients", func(db *gorm.DB) *gorm.DB { return db.Order("id asc") }).
		Preload("OptionGroups.Options.Ingredients.Ingredient").
		Where("restaurant_id = ?", restaurantID)
	if !includeInactive {
		activeCategoryIDs := r.db.Model(&entity.Category{}).Select("id").Where("restaurant_id = ? AND is_active = ?", restaurantID, true)
		activeLinkedMenuIDs := r.db.Table("menu_item_categories").
			Select("menu_item_categories.menu_item_id").
			Joins("JOIN categories ON categories.id = menu_item_categories.category_id").
			Where("menu_item_categories.restaurant_id = ? AND categories.is_active = ?", restaurantID, true)
		// Storefront view: hide items that live only in inactive categories, but
		// keep sold-out (is_available = false) items so the ordering UIs can show a
		// "sold out" label and block ordering instead of hiding them.
		query = query.Where("(category_id IN (?) OR id IN (?))", activeCategoryIDs, activeLinkedMenuIDs)
	}
	if categoryID != 0 {
		linkedMenuIDs := r.db.Model(&entity.MenuItemCategory{}).Select("menu_item_id").Where("restaurant_id = ? AND category_id = ?", restaurantID, categoryID)
		query = query.Where("(category_id = ? OR id IN (?))", categoryID, linkedMenuIDs)
	}
	err := query.Order("display_order asc, id asc").Find(&items).Error
	return items, err
}

// AttachRemainingServings fills in RemainingServings on each stock-limited menu item
// so the ordering UIs can show a live "sold out / N left" signal. Items without a
// recipe are left as nil (unlimited).
func (r *MenuRepository) AttachRemainingServings(restaurantID uint, items []entity.MenuItem) error {
	remaining, err := MenuRemainingServings(r.db, restaurantID)
	if err != nil {
		return err
	}
	for index := range items {
		if value, ok := remaining[items[index].ID]; ok {
			count := value
			items[index].RemainingServings = &count
		}
	}
	return nil
}

func (r *MenuRepository) CreateMenuItem(item *entity.MenuItem) error {
	return r.db.Create(item).Error
}

func (r *MenuRepository) CreateMenuAggregate(
	item *entity.MenuItem,
	groups []entity.MenuOptionGroup,
	components []entity.MenuItemIngredient,
	categories []entity.MenuItemCategory,
) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(item).Error; err != nil {
			return err
		}
		if err := replaceMenuOptions(tx, item, groups); err != nil {
			return err
		}
		if err := replaceMenuIngredients(tx, item, components); err != nil {
			return err
		}
		return replaceMenuCategories(tx, item, categories)
	})
}

func (r *MenuRepository) FindMenuItem(restaurantID, menuItemID uint) (*entity.MenuItem, error) {
	var item entity.MenuItem
	err := r.db.
		Preload("Category").
		Preload("Categories", func(db *gorm.DB) *gorm.DB { return db.Order("id asc") }).
		Preload("Categories.Category").
		Preload("Ingredients", func(db *gorm.DB) *gorm.DB { return db.Order("id asc") }).
		Preload("Ingredients.Ingredient").
		Preload("OptionGroups", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Preload("OptionGroups.Options", func(db *gorm.DB) *gorm.DB { return db.Order("display_order asc, id asc") }).
		Preload("OptionGroups.Options.Ingredients", func(db *gorm.DB) *gorm.DB { return db.Order("id asc") }).
		Preload("OptionGroups.Options.Ingredients.Ingredient").
		Where("restaurant_id = ? AND id = ?", restaurantID, menuItemID).
		First(&item).Error
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// FindMenuItemsByExactName returns at most limit non-deleted menu items whose
// trimmed name matches case-insensitively inside one restaurant. Returning more
// than one row lets the AI action boundary ask the owner to clarify instead of
// guessing which duplicate menu should be changed.
func (r *MenuRepository) FindMenuItemsByExactName(restaurantID uint, name string, limit int) ([]entity.MenuItem, error) {
	if limit <= 0 || limit > 10 {
		limit = 2
	}
	var items []entity.MenuItem
	err := r.db.
		Where("restaurant_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))", restaurantID, name).
		Order("id asc").
		Limit(limit).
		Find(&items).Error
	return items, err
}

func (r *MenuRepository) UpdateMenuItem(item *entity.MenuItem) error {
	return updateMenuItem(r.db, item)
}

func updateMenuItem(db *gorm.DB, item *entity.MenuItem) error {
	return db.Model(&entity.MenuItem{}).
		Where("restaurant_id = ? AND id = ?", item.RestaurantID, item.ID).
		Updates(map[string]any{
			"category_id":   item.CategoryID,
			"name":          item.Name,
			"price":         item.Price,
			"image_url":     item.ImageURL,
			"description":   item.Description,
			"is_available":  item.IsAvailable,
			"display_order": item.DisplayOrder,
		}).Error
}

func (r *MenuRepository) UpdateMenuAggregate(
	item *entity.MenuItem,
	groups []entity.MenuOptionGroup,
	components []entity.MenuItemIngredient,
	categories []entity.MenuItemCategory,
) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var locked entity.MenuItem
		if err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("restaurant_id = ? AND id = ?", item.RestaurantID, item.ID).
			First(&locked).Error; err != nil {
			return err
		}
		if err := updateMenuItem(tx, item); err != nil {
			return err
		}
		if err := replaceMenuOptions(tx, item, groups); err != nil {
			return err
		}
		if err := replaceMenuIngredients(tx, item, components); err != nil {
			return err
		}
		return replaceMenuCategories(tx, item, categories)
	})
}

func replaceMenuOptions(tx *gorm.DB, item *entity.MenuItem, groups []entity.MenuOptionGroup) error {
	var existing []entity.MenuOptionGroup
	if err := tx.Where("restaurant_id = ? AND menu_item_id = ?", item.RestaurantID, item.ID).Find(&existing).Error; err != nil {
		return err
	}
	// Options carry ingredient rows now, so they go first: a leftover row would
	// point at an option id this replace is about to delete and reuse.
	if err := tx.Unscoped().Where("restaurant_id = ? AND menu_item_id = ?", item.RestaurantID, item.ID).Delete(&entity.MenuOptionIngredient{}).Error; err != nil {
		return err
	}
	for _, group := range existing {
		if err := tx.Unscoped().Where("restaurant_id = ? AND option_group_id = ?", item.RestaurantID, group.ID).Delete(&entity.MenuOption{}).Error; err != nil {
			return err
		}
	}
	if err := tx.Unscoped().Where("restaurant_id = ? AND menu_item_id = ?", item.RestaurantID, item.ID).Delete(&entity.MenuOptionGroup{}).Error; err != nil {
		return err
	}
	for i := range groups {
		groups[i].RestaurantID = item.RestaurantID
		groups[i].MenuItemID = item.ID
		options := groups[i].Options
		groups[i].Options = nil
		if err := tx.Create(&groups[i]).Error; err != nil {
			return err
		}
		optionIngredients := make([][]entity.MenuOptionIngredient, len(options))
		for j := range options {
			options[j].RestaurantID = item.RestaurantID
			options[j].MenuItemID = item.ID
			options[j].OptionGroupID = groups[i].ID
			// Held back so GORM's association autosave cannot insert them before
			// the option has an id to hang them on.
			optionIngredients[j] = options[j].Ingredients
			options[j].Ingredients = nil
		}
		if len(options) > 0 {
			if err := tx.Create(&options).Error; err != nil {
				return err
			}
		}
		for j := range options {
			rows := optionIngredients[j]
			if len(rows) == 0 {
				continue
			}
			for k := range rows {
				rows[k].RestaurantID = item.RestaurantID
				rows[k].MenuItemID = item.ID
				rows[k].OptionGroupID = groups[i].ID
				rows[k].MenuOptionID = options[j].ID
			}
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
			options[j].Ingredients = rows
		}
	}
	return nil
}

func replaceMenuIngredients(tx *gorm.DB, item *entity.MenuItem, components []entity.MenuItemIngredient) error {
	if err := tx.Unscoped().Where("restaurant_id = ? AND menu_item_id = ?", item.RestaurantID, item.ID).Delete(&entity.MenuItemIngredient{}).Error; err != nil {
		return err
	}
	for i := range components {
		components[i].RestaurantID = item.RestaurantID
		components[i].MenuItemID = item.ID
	}
	if len(components) > 0 {
		if err := tx.Create(&components).Error; err != nil {
			return err
		}
	}
	return nil
}

func replaceMenuCategories(tx *gorm.DB, item *entity.MenuItem, categories []entity.MenuItemCategory) error {
	if err := tx.Unscoped().Where("restaurant_id = ? AND menu_item_id = ?", item.RestaurantID, item.ID).Delete(&entity.MenuItemCategory{}).Error; err != nil {
		return err
	}
	for i := range categories {
		categories[i].RestaurantID = item.RestaurantID
		categories[i].MenuItemID = item.ID
	}
	if len(categories) > 0 {
		if err := tx.Create(&categories).Error; err != nil {
			return err
		}
	}
	return nil
}
func (r *MenuRepository) FindIngredient(restaurantID, ingredientID uint) (*entity.Ingredient, error) {
	var ingredient entity.Ingredient
	err := r.db.Where("restaurant_id = ? AND id = ?", restaurantID, ingredientID).First(&ingredient).Error
	if err != nil {
		return nil, err
	}
	return &ingredient, nil
}

func (r *MenuRepository) DeleteMenuItem(item *entity.MenuItem) error {
	return r.db.Delete(item).Error
}
