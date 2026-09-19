package config

import "Project-M/internal/entity"

// SchemaModels is the frozen clean-reset baseline used by migration 1.
//
// This project has not shipped a versioned production schema yet, so the first
// migration intentionally represents the complete current model set. After
// that baseline ships, do not silently change this registry: preserve the
// migration-1 model list and add a new numbered migration for every schema
// change. The registry fingerprint test makes an unversioned edit fail loudly.
func SchemaModels() []any {
	return []any{
		&entity.User{},
		&entity.Role{},
		&entity.Restaurant{},
		&entity.RestaurantRoleHidden{},
		&entity.RestaurantRolePermissionOverride{},
		&entity.RestaurantMember{},
		&entity.Invitation{},
		&entity.RestaurantAuditLog{},
		&entity.IngredientCategory{},
		&entity.Ingredient{},
		&entity.Category{},
		&entity.MenuItem{},
		&entity.MenuItemCategory{},
		&entity.MenuItemIngredient{},
		&entity.MenuOptionGroup{},
		&entity.MenuOption{},
		&entity.MenuOptionIngredient{},
		&entity.TableZone{},
		&entity.TableTag{},
		&entity.RestaurantTable{},
		&entity.Order{},
		&entity.OrderItem{},
		&entity.OrderItemOption{},
		&entity.OrderPayment{},
		&entity.OrderStatusLog{},
		&entity.OrderItemRecipeSnapshot{},
		&entity.OrderInventoryDeduction{},
		&entity.CustomerOrderSubmission{},
		&entity.IngredientTransaction{},
		&entity.IngredientLot{},
		&entity.Reservation{},
		&entity.Expense{},
		&entity.Promotion{},
		&entity.PromotionTarget{},
		&entity.OrderPromotion{},
	}
}
