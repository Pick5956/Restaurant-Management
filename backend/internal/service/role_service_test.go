package service

import (
	"reflect"
	"testing"

	"Project-M/internal/entity"
)

func TestNormalizePermissionsAcceptsExpenseManagement(t *testing.T) {
	permissions, err := normalizePermissions([]string{"manage_expenses"})
	if err != nil {
		t.Fatalf("normalizePermissions() error = %v", err)
	}

	want := []string{"manage_expenses"}
	if !reflect.DeepEqual(permissions, want) {
		t.Fatalf("normalizePermissions() = %#v, want %#v", permissions, want)
	}
}

func TestNormalizePermissionsAcceptsPromotionManagement(t *testing.T) {
	permissions, err := normalizePermissions([]string{"manage_promotions"})
	if err != nil {
		t.Fatalf("normalizePermissions() error = %v", err)
	}
	if want := []string{"manage_promotions"}; !reflect.DeepEqual(permissions, want) {
		t.Fatalf("normalizePermissions() = %#v, want %#v", permissions, want)
	}
}

func TestNormalizePermissionsAcceptsGranularAdministrationAndAddsDependencies(t *testing.T) {
	permissions, err := normalizePermissions([]string{
		PermissionManageInvites,
		PermissionManageMembers,
		PermissionManageRoles,
		PermissionViewAuditLog,
		PermissionManageRestaurantSettings,
		"update_order_status",
		"take_payment",
		"manage_table",
		"manage_inventory",
		"manage_staff",
	})
	if err != nil {
		t.Fatalf("normalizePermissions() error = %v", err)
	}

	want := []string{
		PermissionManageInvites,
		PermissionManageMembers,
		PermissionManageRoles,
		PermissionViewAuditLog,
		PermissionManageRestaurantSettings,
		"update_order_status",
		"take_payment",
		"manage_table",
		"manage_inventory",
		"view_kitchen",
		"view_orders",
		"view_tables",
		"view_inventory",
	}
	if !reflect.DeepEqual(permissions, want) {
		t.Fatalf("normalizePermissions() = %#v, want %#v", permissions, want)
	}
}

func TestLegacyManageStaffCompatibilityOnlyAppliesToSystemOwnerAndManager(t *testing.T) {
	for _, roleName := range []string{"owner", "manager"} {
		member := &entity.RestaurantMember{Role: &entity.Role{
			Name:        roleName,
			Permissions: `["manage_staff"]`,
		}}
		for _, permission := range granularAdministrationPermissions {
			if !memberHasPermission(member, permission) {
				t.Fatalf("legacy %s lost compatibility for %s", roleName, permission)
			}
		}
	}

	custom := &entity.RestaurantMember{Role: &entity.Role{
		Name:        "custom_1_supervisor",
		Permissions: `["manage_staff"]`,
	}}
	for _, permission := range granularAdministrationPermissions {
		if memberHasPermission(custom, permission) {
			t.Fatalf("custom manage_staff unexpectedly implied %s", permission)
		}
	}
}

func TestCustomRoleCanUseExplicitAdministrationPermission(t *testing.T) {
	member := &entity.RestaurantMember{Role: &entity.Role{
		Name:        "custom_1_supervisor",
		Permissions: `["manage_members"]`,
	}}
	if !memberHasPermission(member, PermissionManageMembers) {
		t.Fatal("explicit custom-role administration permission was rejected")
	}
}

func TestGrantCeilingRejectsPermissionsTheActorDoesNotPossess(t *testing.T) {
	manager := &entity.RestaurantMember{Role: &entity.Role{
		Name:        "manager",
		Permissions: `["manage_roles","take_order"]`,
	}}
	if !permissionsWithinGrantCeiling(manager, []string{"take_order"}) {
		t.Fatal("actor could not grant a permission they possess")
	}
	if permissionsWithinGrantCeiling(manager, []string{"take_payment"}) {
		t.Fatal("actor granted a permission they do not possess")
	}

	owner := &entity.RestaurantMember{Role: &entity.Role{Name: "owner", Permissions: `["*"]`}}
	if !permissionsWithinGrantCeiling(owner, []string{"take_payment", PermissionManageRoles}) {
		t.Fatal("owner wildcard did not bypass grant ceiling")
	}
}

func TestCustomMemberManagerCannotTargetProtectedRolesOrSelf(t *testing.T) {
	actor := &entity.RestaurantMember{
		UserID: 11,
		Role: &entity.Role{
			Name:        "custom_1_shift_lead",
			Permissions: `["manage_members"]`,
		},
	}
	ordinary := &entity.RestaurantMember{UserID: 12, Role: &entity.Role{Name: "waiter"}}
	manager := &entity.RestaurantMember{UserID: 13, Role: &entity.Role{Name: "manager"}}
	self := &entity.RestaurantMember{UserID: 11, Role: &entity.Role{Name: "waiter"}}

	if !canManageMemberWithPermission(actor, ordinary, PermissionManageMembers) {
		t.Fatal("explicitly granted custom member manager could not manage ordinary staff")
	}
	if canManageMemberWithPermission(actor, manager, PermissionManageMembers) {
		t.Fatal("custom member manager could manage protected manager role")
	}
	if canManageMemberWithPermission(actor, self, PermissionManageMembers) {
		t.Fatal("member manager could manage self")
	}
}

func TestRoleChangeClearsMemberPermissionOverride(t *testing.T) {
	override := `["take_payment"]`
	target := &entity.RestaurantMember{RoleID: 4, PermissionsOverride: &override}
	role := &entity.Role{}
	role.ID = 3

	assignMemberRole(target, role)

	if target.RoleID != 3 {
		t.Fatalf("role id = %d, want 3", target.RoleID)
	}
	if target.PermissionsOverride != nil {
		t.Fatalf("permissions override = %q, want nil", *target.PermissionsOverride)
	}
}

func TestTeamListRequiresAtLeastOneTeamCapability(t *testing.T) {
	ordinary := &entity.RestaurantMember{Role: &entity.Role{Name: "waiter", Permissions: `["take_order"]`}}
	if canViewTeam(ordinary) {
		t.Fatal("ordinary active member could list the team")
	}
	for _, permission := range []string{
		PermissionManageInvites,
		PermissionManageMembers,
		PermissionManageRoles,
		PermissionViewAuditLog,
	} {
		member := &entity.RestaurantMember{Role: &entity.Role{Name: "custom_1_admin", Permissions: `["` + permission + `"]`}}
		if !canViewTeam(member) {
			t.Fatalf("%s did not allow team list", permission)
		}
	}
}

func TestRoleGrantCeilingAlsoProtectsOwnerAndManagerHierarchy(t *testing.T) {
	actor := &entity.RestaurantMember{Role: &entity.Role{
		Name:        "custom_1_role_admin",
		Permissions: `["manage_roles","take_order"]`,
	}}
	ordinary := &entity.Role{Name: "waiter", Permissions: `["take_order"]`}
	manager := &entity.Role{Name: "manager", Permissions: `["take_order"]`}
	tooPowerful := &entity.Role{Name: "cashier", Permissions: `["take_payment","view_orders"]`}

	if !canAssignMemberRole(actor, ordinary) {
		t.Fatal("custom role admin could not assign an ordinary role within its grant ceiling")
	}
	if canAssignMemberRole(actor, manager) {
		t.Fatal("custom role admin could assign the protected manager role")
	}
	if canAssignMemberRole(actor, tooPowerful) {
		t.Fatal("custom role admin assigned a role above its grant ceiling")
	}
}
