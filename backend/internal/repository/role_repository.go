package repository

import (
	"Project-M/internal/entity"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RoleRepository struct {
	db *gorm.DB
}

func NewRoleRepository(db *gorm.DB) *RoleRepository {
	return &RoleRepository{db: db}
}

func (r *RoleRepository) FindAssignableByRestaurant(restaurantID uint) ([]entity.Role, error) {
	var roles []entity.Role
	hiddenRoleIDs := r.db.
		Model(&entity.RestaurantRoleHidden{}).
		Select("role_id").
		Where("restaurant_id = ?", restaurantID)
	err := r.db.
		Where("restaurant_id = ? OR (restaurant_id IS NULL AND id NOT IN (?))", restaurantID, hiddenRoleIDs).
		Order("is_system desc, id asc").
		Find(&roles).Error
	if err != nil {
		return nil, err
	}
	for index := range roles {
		effective, err := resolveEffectiveRole(r.db, restaurantID, &roles[index])
		if err != nil {
			return nil, err
		}
		roles[index] = *effective
	}
	return roles, nil
}

func (r *RoleRepository) FindByID(id uint) (*entity.Role, error) {
	var role entity.Role
	if err := r.db.First(&role, id).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

func (r *RoleRepository) FindByIDForRestaurant(id uint, restaurantID uint) (*entity.Role, error) {
	role, err := r.FindByID(id)
	if err != nil {
		return nil, err
	}
	return resolveEffectiveRole(r.db, restaurantID, role)
}

func (r *RoleRepository) Update(role *entity.Role) error {
	return r.db.Save(role).Error
}

func (r *RoleRepository) UpsertRestaurantPermissionOverride(restaurantID, roleID uint, permissions string) error {
	override := &entity.RestaurantRolePermissionOverride{
		RestaurantID: restaurantID,
		RoleID:       roleID,
		Permissions:  permissions,
	}
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "restaurant_id"},
			{Name: "role_id"},
		},
		DoUpdates: clause.AssignmentColumns([]string{"permissions", "updated_at"}),
	}).Create(override).Error
}

func (r *RoleRepository) UpsertRestaurantDisplayNameOverride(restaurantID, roleID uint, displayName string) error {
	override := &entity.RestaurantRoleDisplayNameOverride{
		RestaurantID: restaurantID,
		RoleID:       roleID,
		DisplayName:  displayName,
	}
	return r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "restaurant_id"},
			{Name: "role_id"},
		},
		DoUpdates: clause.AssignmentColumns([]string{"display_name", "updated_at"}),
	}).Create(override).Error
}

func (r *RoleRepository) Create(role *entity.Role) error {
	return r.db.Create(role).Error
}

func (r *RoleRepository) Delete(role *entity.Role) error {
	return r.db.Delete(role).Error
}

// roleHoldingMemberStatuses are the memberships that still hold their role: an
// active member works under it and a suspended one returns to it. A removed
// member's role_id is only a record of what they held - they come back through
// an invitation, which sets a new role - so it never keeps a role alive. The
// row it points at survives the delete either way: a custom role is
// soft-deleted and a default role is only hidden, so the foreign key holds.
var roleHoldingMemberStatuses = []string{"active", "suspended"}

// CountMembersForRestaurant counts the members that stop a role being deleted.
func (r *RoleRepository) CountMembersForRestaurant(roleID uint, restaurantID uint) (int64, error) {
	var count int64
	err := r.db.Model(&entity.RestaurantMember{}).
		Where("role_id = ? AND restaurant_id = ? AND status IN ?", roleID, restaurantID, roleHoldingMemberStatuses).
		Count(&count).Error
	return count, err
}

func (r *RoleRepository) CountPendingInvitationsForRestaurant(roleID uint, restaurantID uint) (int64, error) {
	var count int64
	err := r.db.Model(&entity.Invitation{}).
		Where("role_id = ? AND restaurant_id = ? AND status = ?", roleID, restaurantID, entity.InvitationStatusPending).
		Count(&count).Error
	return count, err
}

func (r *RoleRepository) HideSystemRoleForRestaurant(restaurantID uint, roleID uint) error {
	hidden := &entity.RestaurantRoleHidden{RestaurantID: restaurantID, RoleID: roleID}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(hidden).Error
}

func (r *RoleRepository) IsRoleHiddenForRestaurant(restaurantID uint, roleID uint) (bool, error) {
	var count int64
	err := r.db.Model(&entity.RestaurantRoleHidden{}).
		Where("restaurant_id = ? AND role_id = ?", restaurantID, roleID).
		Count(&count).Error
	return count > 0, err
}

func (r *RoleRepository) FindByName(name string) (*entity.Role, error) {
	var role entity.Role
	if err := r.db.Where("name = ?", name).First(&role).Error; err != nil {
		return nil, err
	}
	return &role, nil
}

func resolveEffectiveRole(db *gorm.DB, restaurantID uint, role *entity.Role) (*entity.Role, error) {
	effective := cloneRoleWithDisplayNameOverride(role, nil)
	if effective == nil || effective.RestaurantID != nil {
		return effective, nil
	}

	var permissionOverride entity.RestaurantRolePermissionOverride
	err := db.
		Where("restaurant_id = ? AND role_id = ?", restaurantID, effective.ID).
		First(&permissionOverride).Error
	if err == nil {
		effective.Permissions = permissionOverride.Permissions
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	var displayNameOverride entity.RestaurantRoleDisplayNameOverride
	err = db.
		Where("restaurant_id = ? AND role_id = ?", restaurantID, effective.ID).
		First(&displayNameOverride).Error
	if err == nil {
		effective = cloneRoleWithDisplayNameOverride(effective, &displayNameOverride.DisplayName)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	return effective, nil
}

func cloneRoleWithDisplayNameOverride(role *entity.Role, displayNameOverride *string) *entity.Role {
	if role == nil {
		return nil
	}
	effective := *role
	effective.DisplayNameOverride = nil
	if displayNameOverride != nil {
		override := *displayNameOverride
		effective.DisplayName = override
		effective.DisplayNameOverride = &override
	}
	return &effective
}
