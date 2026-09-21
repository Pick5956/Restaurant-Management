package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type RoleService struct {
	roleRepo  *repository.RoleRepository
	auditRepo *repository.RestaurantAuditLogRepository
}

func ProvideRoleService(roleRepo *repository.RoleRepository, auditRepos ...*repository.RestaurantAuditLogRepository) *RoleService {
	service := &RoleService{roleRepo: roleRepo}
	if len(auditRepos) > 0 {
		service.auditRepo = auditRepos[0]
	}
	return service
}

func (s *RoleService) GetAssignableRoles(restaurantID uint) ([]entity.Role, error) {
	return s.roleRepo.FindAssignableByRestaurant(restaurantID)
}

type RoleRequest struct {
	DisplayName string   `json:"display_name"`
	Permissions []string `json:"permissions"`
}

type rolePermissionMutationKind int

const (
	rolePermissionDirect rolePermissionMutationKind = iota
	rolePermissionRestaurantOverride
)

type roleDisplayNameMutationKind int

const (
	roleDisplayNameDirect roleDisplayNameMutationKind = iota
	roleDisplayNameRestaurantOverride
)

var editablePermissionKeys = map[string]bool{
	"view_dashboard":                   true,
	"manage_menu":                      true,
	"manage_promotions":                true,
	"view_tables":                      true,
	"manage_table":                     true,
	"take_order":                       true,
	"view_orders":                      true,
	"take_payment":                     true,
	"view_kitchen":                     true,
	"update_order_status":              true,
	"view_inventory":                   true,
	"manage_inventory":                 true,
	"manage_expenses":                  true,
	"view_reports":                     true,
	PermissionManageInvites:            true,
	PermissionManageMembers:            true,
	PermissionManageRoles:              true,
	PermissionViewAuditLog:             true,
	PermissionManageRestaurantSettings: true,
}

var deprecatedPermissionKeys = map[string]bool{
	"view_menu":    true,
	"manage_staff": true,
}

func (s *RoleService) UpdateRolePermissions(roleID uint, restaurantID uint, actor *entity.RestaurantMember, permissions []string) (*entity.Role, error) {
	role, err := s.roleRepo.FindByIDForRestaurant(roleID, restaurantID)
	if err != nil {
		return nil, errors.New("role not found")
	}
	target, err := rolePermissionMutationTargetForRole(role, restaurantID)
	if err != nil {
		return nil, err
	}
	if target == rolePermissionRestaurantOverride {
		hidden, err := s.roleRepo.IsRoleHiddenForRestaurant(restaurantID, role.ID)
		if err != nil {
			return nil, err
		}
		if hidden {
			return nil, errors.New("role is not available for this restaurant")
		}
	}
	if !canManageRole(actor, role) {
		return nil, errors.New("you do not have permission to edit this role")
	}
	normalized, err := normalizePermissions(permissions)
	if err != nil {
		return nil, err
	}
	if !permissionsWithinGrantCeiling(actor, normalized) {
		return nil, errors.New("cannot grant permissions you do not possess")
	}
	previousPermissions := role.Permissions
	var previousPermissionList []string
	if err := json.Unmarshal([]byte(previousPermissions), &previousPermissionList); err != nil {
		previousPermissionList = []string{}
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	role.Permissions = string(raw)
	if target == rolePermissionRestaurantOverride {
		if err := s.roleRepo.UpsertRestaurantPermissionOverride(restaurantID, role.ID, role.Permissions); err != nil {
			return nil, err
		}
	} else {
		if err := s.roleRepo.Update(role); err != nil {
			return nil, err
		}
	}
	actorID := actor.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionRolePermissionsChanged,
		&actorID,
		nil,
		nil,
		map[string]any{
			"role_id":          role.ID,
			"role_name":        roleName(role),
			"from_permissions": previousPermissionList,
			"to_permissions":   normalized,
		},
	)
	return role, nil
}

func rolePermissionMutationTargetForRole(role *entity.Role, restaurantID uint) (rolePermissionMutationKind, error) {
	if role == nil {
		return rolePermissionDirect, errors.New("role not found")
	}
	if role.RestaurantID == nil {
		return rolePermissionRestaurantOverride, nil
	}
	if *role.RestaurantID != restaurantID {
		return rolePermissionDirect, errors.New("role does not belong to this restaurant")
	}
	return rolePermissionDirect, nil
}

func roleDisplayNameMutationTargetForRole(role *entity.Role, restaurantID uint) (roleDisplayNameMutationKind, error) {
	if role == nil {
		return roleDisplayNameDirect, errors.New("role not found")
	}
	if role.RestaurantID == nil {
		return roleDisplayNameRestaurantOverride, nil
	}
	if *role.RestaurantID != restaurantID {
		return roleDisplayNameDirect, errors.New("role does not belong to this restaurant")
	}
	return roleDisplayNameDirect, nil
}

func roleDisplayNameUpdateIsNoOp(role *entity.Role, target roleDisplayNameMutationKind, displayName string) bool {
	if role == nil {
		return false
	}
	if target == roleDisplayNameRestaurantOverride {
		return role.DisplayNameOverride != nil &&
			normalizeRoleDisplayName(*role.DisplayNameOverride) == displayName
	}
	return normalizeRoleDisplayName(roleName(role)) == displayName
}

func (s *RoleService) CreateCustomRole(restaurantID uint, actor *entity.RestaurantMember, req *RoleRequest) (*entity.Role, error) {
	if !memberHasPermission(actor, PermissionManageRoles) {
		return nil, errors.New("you do not have permission to create roles")
	}
	displayName := normalizeRoleDisplayName(req.DisplayName)
	if displayName == "" {
		return nil, errors.New("role name is required")
	}
	normalized, err := normalizePermissions(req.Permissions)
	if err != nil {
		return nil, err
	}
	if !permissionsWithinGrantCeiling(actor, normalized) {
		return nil, errors.New("cannot grant permissions you do not possess")
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	name, err := customRoleName(restaurantID)
	if err != nil {
		return nil, err
	}
	role := &entity.Role{
		RestaurantID: &restaurantID,
		Name:         name,
		DisplayName:  displayName,
		Permissions:  string(raw),
		IsSystem:     false,
	}
	if err := s.roleRepo.Create(role); err != nil {
		return nil, err
	}
	actorID := actor.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionRoleCreated,
		&actorID,
		nil,
		nil,
		map[string]any{
			"role_id":     role.ID,
			"role_name":   roleName(role),
			"permissions": normalized,
		},
	)
	return role, nil
}

func (s *RoleService) UpdateRoleDisplayName(roleID uint, restaurantID uint, actor *entity.RestaurantMember, req *RoleRequest) (*entity.Role, error) {
	role, err := s.roleRepo.FindByIDForRestaurant(roleID, restaurantID)
	if err != nil {
		return nil, errors.New("role not found")
	}
	target, err := roleDisplayNameMutationTargetForRole(role, restaurantID)
	if err != nil {
		return nil, err
	}
	if target == roleDisplayNameRestaurantOverride {
		hidden, err := s.roleRepo.IsRoleHiddenForRestaurant(restaurantID, role.ID)
		if err != nil {
			return nil, err
		}
		if hidden {
			return nil, errors.New("role is not available for this restaurant")
		}
	}
	if !canManageRole(actor, role) {
		return nil, errors.New("you do not have permission to edit this role")
	}
	displayName := normalizeRoleDisplayName(req.DisplayName)
	if displayName == "" {
		return nil, errors.New("role name is required")
	}
	previousDisplayName := roleName(role)
	if roleDisplayNameUpdateIsNoOp(role, target, displayName) {
		return role, nil
	}
	if target == roleDisplayNameRestaurantOverride {
		if err := s.roleRepo.UpsertRestaurantDisplayNameOverride(restaurantID, role.ID, displayName); err != nil {
			return nil, err
		}
		override := displayName
		role.DisplayName = displayName
		role.DisplayNameOverride = &override
	} else {
		role.DisplayName = displayName
		role.DisplayNameOverride = nil
		if err := s.roleRepo.Update(role); err != nil {
			return nil, err
		}
	}
	actorID := actor.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionRoleRenamed,
		&actorID,
		nil,
		nil,
		map[string]any{
			"role_id":   role.ID,
			"role_key":  role.Name,
			"is_system": role.IsSystem,
			"from_name": previousDisplayName,
			"to_name":   roleName(role),
		},
	)
	return role, nil
}

func (s *RoleService) DeleteCustomRole(roleID uint, restaurantID uint, actor *entity.RestaurantMember) error {
	role, err := s.roleRepo.FindByIDForRestaurant(roleID, restaurantID)
	if err != nil {
		return errors.New("role not found")
	}
	if !roleAssignableToRestaurant(role, restaurantID) {
		return errors.New("role does not belong to this restaurant")
	}
	if !canManageRole(actor, role) {
		return errors.New("you do not have permission to delete this role")
	}
	memberCount, err := s.roleRepo.CountMembersForRestaurant(role.ID, restaurantID)
	if err != nil {
		return err
	}
	if memberCount > 0 {
		return errors.New("role is still assigned to staff")
	}
	inviteCount, err := s.roleRepo.CountPendingInvitationsForRestaurant(role.ID, restaurantID)
	if err != nil {
		return err
	}
	if inviteCount > 0 {
		return errors.New("role is used by pending invitations")
	}
	if role.RestaurantID == nil {
		if err := s.roleRepo.HideSystemRoleForRestaurant(restaurantID, role.ID); err != nil {
			return err
		}
	} else if err := s.roleRepo.Delete(role); err != nil {
		return err
	}
	actorID := actor.UserID
	writeAuditEvent(
		s.auditRepo,
		restaurantID,
		entity.AuditActionRoleDeleted,
		&actorID,
		nil,
		nil,
		map[string]any{
			"role_id":   role.ID,
			"role_name": roleName(role),
			"is_system": role.IsSystem,
		},
	)
	return nil
}

func normalizeRoleDisplayName(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func customRoleName(restaurantID uint) (string, error) {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return fmt.Sprintf("custom_%d_%s", restaurantID, hex.EncodeToString(bytes)), nil
}

func normalizePermissions(permissions []string) ([]string, error) {
	seen := map[string]bool{}
	result := make([]string, 0, len(permissions))
	for _, permission := range permissions {
		if permission == "" || deprecatedPermissionKeys[permission] || seen[permission] {
			continue
		}
		if permission == "*" {
			return nil, errors.New("wildcard permissions cannot be assigned")
		}
		if !editablePermissionKeys[permission] {
			return nil, errors.New("invalid permission")
		}
		seen[permission] = true
		result = append(result, permission)
	}
	for _, permission := range append([]string(nil), result...) {
		for _, dependency := range permissionDependencies[permission] {
			if seen[dependency] {
				continue
			}
			seen[dependency] = true
			result = append(result, dependency)
		}
	}
	return result, nil
}
