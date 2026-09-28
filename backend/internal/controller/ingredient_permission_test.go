package controller

import (
	"net/http"
	"testing"
)

func TestStockExpenseRequiresExpenseManagementPermission(t *testing.T) {
	context, recorder := orderPermissionContext("manage_inventory")

	if requireStockExpensePermission(context, 1250) {
		t.Fatal("stock-in amount must not create an expense without manage_expenses")
	}
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}

func TestStockExpensePermissionAllowsExplicitAmountOrNoExpense(t *testing.T) {
	withExpensePermission, _ := orderPermissionContext("manage_inventory", "manage_expenses")
	if !requireStockExpensePermission(withExpensePermission, 1250) {
		t.Fatal("manage_expenses should allow an explicit stock-in expense")
	}

	withoutExpensePermission, _ := orderPermissionContext("manage_inventory")
	if !requireStockExpensePermission(withoutExpensePermission, 0) {
		t.Fatal("a stock adjustment without an expense must only need inventory permission")
	}
}

func TestManagerFallbackIncludesExpenseManagement(t *testing.T) {
	context, _ := orderPermissionContext()
	member, _ := contextMember(context)
	member.Role.Name = "manager"
	member.Role.Permissions = ""

	if !memberCan(context, "manage_expenses") {
		t.Fatal("manager fallback permissions must match the seeded manage_expenses permission")
	}
}

func TestManagerFallbackNoLongerGrantsPromotionManagement(t *testing.T) {
	context, _ := orderPermissionContext()
	member, _ := contextMember(context)
	member.Role.Name = "manager"
	member.Role.Permissions = ""

	if memberCan(context, "manage_promotions") {
		t.Fatal("promotions were retired; the manager fallback must not grant manage_promotions")
	}
}

// Refusing a typed amount is only half the gate: with no amount the service
// values the stock-in itself and books it. The flag it reads has to say so.
func TestStockMovesWithoutBookingForMemberWithoutExpensePermission(t *testing.T) {
	withoutExpensePermission, _ := orderPermissionContext("manage_inventory")
	if !skipStockExpense(withoutExpensePermission) {
		t.Fatal("manage_inventory alone must move stock without an expense row")
	}

	withExpensePermission, _ := orderPermissionContext("manage_inventory", "manage_expenses")
	if skipStockExpense(withExpensePermission) {
		t.Fatal("manage_expenses must keep booking the stock-in")
	}

	manager, _ := orderPermissionContext()
	member, _ := contextMember(manager)
	member.Role.Name = "manager"
	member.Role.Permissions = ""
	if skipStockExpense(manager) {
		t.Fatal("legacy manager fallback must keep booking the stock-in")
	}
}
