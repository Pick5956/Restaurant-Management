package seed

import (
	"Project-M/internal/entity"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SeedRoles inserts the default restaurant roles + permissions if the table is empty.
// Permissions are stored as a JSON array of permission keys.
func SeedRoles(db *gorm.DB) error {
	roles := systemRoles()
	for i := range roles {
		if err := db.Clauses(systemRoleConflictClause()).Create(&roles[i]).Error; err != nil {
			return err
		}
	}
	return nil
}

func systemRoles() []entity.Role {
	return []entity.Role{
		{Name: "owner", DisplayName: "Owner", Permissions: `["*"]`, IsSystem: true},
		{Name: "manager", DisplayName: "Manager", Permissions: `["view_dashboard","manage_menu","view_tables","manage_table","take_order","view_orders","take_payment","view_kitchen","update_order_status","view_inventory","manage_inventory","manage_expenses","view_reports","manage_invites","manage_members","manage_roles","view_audit_log","manage_restaurant_settings"]`, IsSystem: true},
		{Name: "cashier", DisplayName: "Cashier", Permissions: `["take_order","take_payment","view_orders","view_dashboard","view_kitchen","view_inventory"]`, IsSystem: true},
		{Name: "waiter", DisplayName: "Waiter", Permissions: `["take_order","take_payment","view_orders","view_dashboard","view_kitchen","view_inventory"]`, IsSystem: true},
		{Name: "chef", DisplayName: "Chef", Permissions: `["view_kitchen","update_order_status","view_inventory"]`, IsSystem: true},
	}
}

func systemRoleConflictClause() clause.OnConflict {
	return clause.OnConflict{
		Columns: []clause.Column{{Name: "name"}},
		TargetWhere: clause.Where{Exprs: []clause.Expression{
			clause.Expr{SQL: "restaurant_id IS NULL AND deleted_at IS NULL"},
		}},
		DoUpdates: clause.AssignmentColumns([]string{"display_name", "permissions", "is_system", "updated_at"}),
	}
}
