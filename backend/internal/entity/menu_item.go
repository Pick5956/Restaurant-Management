package entity

import "gorm.io/gorm"

type MenuItem struct {
	gorm.Model
	RestaurantID uint    `json:"restaurant_id" gorm:"not null;index;index:idx_menu_items_catalog,priority:1"`
	CategoryID   uint    `json:"category_id" gorm:"not null;index"`
	Name         string  `json:"name" gorm:"not null;size:160"`
	Price        float64 `json:"price" gorm:"type:numeric(14,2);not null;check:menu_item_price_nonnegative,price >= 0"`
	ImageURL     string  `json:"image_url" gorm:"size:2048"`
	// The photo ImageURL was cut from, and where it sat in the square frame
	// (zoom -100..100, position 0..1 on each axis). The web editor reopens the
	// original with this framing, so a second adjust starts from the whole photo
	// instead of the square it produced (owner, 28 ก.ย. 2569). Empty original:
	// the dish has only the square, as every item saved before this did.
	ImageOriginalURL string  `json:"image_original_url" gorm:"size:2048"`
	ImageCropZoom    float64 `json:"image_crop_zoom" gorm:"not null;default:0"`
	ImageCropX       float64 `json:"image_crop_x" gorm:"not null;default:0.5"`
	ImageCropY       float64 `json:"image_crop_y" gorm:"not null;default:0.5"`
	Description      string  `json:"description" gorm:"size:2000"`
	IsAvailable      bool    `json:"is_available" gorm:"default:true;index;index:idx_menu_items_catalog,priority:2"`
	DisplayOrder     int     `json:"display_order" gorm:"default:0;index:idx_menu_items_catalog,priority:3"`

	// RemainingServings is computed at read time (not stored): how many more
	// portions can still be made given current stock minus what queued orders have
	// already claimed. nil means the item has no recipe, so it is not stock-limited.
	RemainingServings *int `json:"remaining_servings,omitempty" gorm:"-"`

	Restaurant   *Restaurant          `json:"restaurant,omitempty" gorm:"foreignKey:RestaurantID"`
	Category     *Category            `json:"category,omitempty" gorm:"foreignKey:CategoryID"`
	Categories   []MenuItemCategory   `json:"categories,omitempty" gorm:"foreignKey:MenuItemID"`
	OptionGroups []MenuOptionGroup    `json:"option_groups,omitempty" gorm:"foreignKey:MenuItemID"`
	Ingredients  []MenuItemIngredient `json:"ingredients,omitempty" gorm:"foreignKey:MenuItemID"`
}

type MenuItemCategory struct {
	gorm.Model
	RestaurantID uint `json:"restaurant_id" gorm:"not null;index;uniqueIndex:idx_menu_item_category_unique,priority:1"`
	MenuItemID   uint `json:"menu_item_id" gorm:"not null;uniqueIndex:idx_menu_item_category_unique,priority:2"`
	CategoryID   uint `json:"category_id" gorm:"not null;uniqueIndex:idx_menu_item_category_unique,priority:3"`

	MenuItem *MenuItem `json:"menu_item,omitempty" gorm:"foreignKey:MenuItemID"`
	Category *Category `json:"category,omitempty" gorm:"foreignKey:CategoryID"`
}

type MenuItemIngredient struct {
	gorm.Model
	RestaurantID uint    `json:"restaurant_id" gorm:"not null;index;uniqueIndex:idx_menu_recipe_component,priority:1"`
	MenuItemID   uint    `json:"menu_item_id" gorm:"not null;index;uniqueIndex:idx_menu_recipe_component,priority:2"`
	IngredientID uint    `json:"ingredient_id" gorm:"not null;index;uniqueIndex:idx_menu_recipe_component,priority:3"`
	Quantity     float64 `json:"quantity" gorm:"type:numeric(18,4);not null;check:menu_recipe_quantity_positive,quantity > 0"`
	Unit         string  `json:"unit" gorm:"not null;size:40"`
	Note         string  `json:"note" gorm:"size:500"`

	MenuItem   *MenuItem   `json:"menu_item,omitempty" gorm:"foreignKey:MenuItemID"`
	Ingredient *Ingredient `json:"ingredient,omitempty" gorm:"foreignKey:IngredientID"`
}
