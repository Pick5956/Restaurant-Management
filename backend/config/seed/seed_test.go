package seed

import (
	"encoding/json"
	"testing"

	"Project-M/internal/entity"

	"gorm.io/gorm/clause"
)

func TestSystemRoleConflictClauseTargetsPartialSystemRoleIndex(t *testing.T) {
	conflict := systemRoleConflictClause()
	if len(conflict.Columns) != 1 || conflict.Columns[0].Name != "name" {
		t.Fatalf("conflict columns = %#v, want name", conflict.Columns)
	}
	if len(conflict.TargetWhere.Exprs) != 1 {
		t.Fatalf("target predicates = %#v, want one", conflict.TargetWhere.Exprs)
	}
	expr, ok := conflict.TargetWhere.Exprs[0].(clause.Expr)
	if !ok {
		t.Fatalf("target predicate type = %T, want clause.Expr", conflict.TargetWhere.Exprs[0])
	}
	if expr.SQL != "restaurant_id IS NULL AND deleted_at IS NULL" {
		t.Fatalf("target predicate = %q", expr.SQL)
	}
}

func TestSystemRoleDefaultsUseGranularAdministrationPermissions(t *testing.T) {
	roles := systemRoles()
	var manager *entity.Role
	for index := range roles {
		if roles[index].Name == "manager" {
			manager = &roles[index]
			break
		}
	}
	if manager == nil {
		t.Fatal("manager role default is missing")
	}
	var permissions []string
	if err := json.Unmarshal([]byte(manager.Permissions), &permissions); err != nil {
		t.Fatalf("manager permissions are invalid JSON: %v", err)
	}
	has := map[string]bool{}
	for _, permission := range permissions {
		has[permission] = true
	}
	for _, required := range []string{
		"manage_invites", "manage_members", "manage_roles", "view_audit_log",
		"manage_restaurant_settings", "take_order", "view_tables", "view_inventory",
		"manage_promotions",
	} {
		if !has[required] {
			t.Fatalf("manager default is missing %s", required)
		}
	}
	if has["manage_staff"] {
		t.Fatal("manager default still writes deprecated manage_staff")
	}
}
