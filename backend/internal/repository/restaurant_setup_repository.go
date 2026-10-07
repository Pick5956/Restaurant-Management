package repository

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type RestaurantSetupRepository struct {
	db *gorm.DB
}

type RestaurantSetupWriter interface {
	CreateRestaurant(*entity.Restaurant) error
	CreateMember(*entity.RestaurantMember) error
	CreateCategory(*entity.Category) error
	CreateMenuItem(*entity.MenuItem) error
	CreateMenuItemCategory(*entity.MenuItemCategory) error
	CreateMenuOptionGroup(*entity.MenuOptionGroup) error
	CreateMenuOption(*entity.MenuOption) error
	CreateMenuOptionIngredient(*entity.MenuOptionIngredient) error
	CreateTableZone(*entity.TableZone) error
	CreateTable(*entity.RestaurantTable) error
	CreateIngredientCategory(*entity.IngredientCategory) error
	CreateIngredient(*entity.Ingredient) error
	CreateMenuItemIngredient(*entity.MenuItemIngredient) error
}

type RestaurantSetupTransactor interface {
	Transaction(func(RestaurantSetupWriter) error) error
}

func NewRestaurantSetupRepository(db *gorm.DB) *RestaurantSetupRepository {
	return &RestaurantSetupRepository{db: db}
}

func (r *RestaurantSetupRepository) Transaction(fn func(tx RestaurantSetupWriter) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(NewRestaurantSetupRepository(tx))
	})
}

func (r *RestaurantSetupRepository) CreateRestaurant(restaurant *entity.Restaurant) error {
	return r.db.Create(restaurant).Error
}

func (r *RestaurantSetupRepository) CreateMember(member *entity.RestaurantMember) error {
	return r.db.Create(member).Error
}

func (r *RestaurantSetupRepository) CreateCategory(category *entity.Category) error {
	return r.db.Create(category).Error
}

func (r *RestaurantSetupRepository) CreateMenuItem(item *entity.MenuItem) error {
	return r.db.Create(item).Error
}

func (r *RestaurantSetupRepository) CreateMenuItemCategory(link *entity.MenuItemCategory) error {
	return r.db.Create(link).Error
}

func (r *RestaurantSetupRepository) CreateMenuOptionGroup(group *entity.MenuOptionGroup) error {
	return r.db.Create(group).Error
}

func (r *RestaurantSetupRepository) CreateMenuOption(option *entity.MenuOption) error {
	return r.db.Create(option).Error
}

func (r *RestaurantSetupRepository) CreateMenuOptionIngredient(link *entity.MenuOptionIngredient) error {
	return r.db.Create(link).Error
}

func (r *RestaurantSetupRepository) CreateTableZone(zone *entity.TableZone) error {
	return r.db.Create(zone).Error
}

func (r *RestaurantSetupRepository) CreateTable(table *entity.RestaurantTable) error {
	return r.db.Create(table).Error
}

func (r *RestaurantSetupRepository) CreateIngredientCategory(category *entity.IngredientCategory) error {
	return r.db.Create(category).Error
}

func (r *RestaurantSetupRepository) CreateIngredient(ingredient *entity.Ingredient) error {
	return r.db.Create(ingredient).Error
}

func (r *RestaurantSetupRepository) CreateMenuItemIngredient(link *entity.MenuItemIngredient) error {
	return r.db.Create(link).Error
}
