package service

import (
	"errors"
	"go/ast"
	"sort"
	"strings"
	"testing"

	"Project-M/internal/entity"
)

// TestDeleteRestaurantDeletesThroughOneTransaction reads the call site: the
// service used to delete the memberships and then the restaurant as two
// separate writes, so a failure between them left a live restaurant nobody
// belonged to. The repository method is the transaction; calling anything else
// from here brings the gap back.
func TestDeleteRestaurantDeletesThroughOneTransaction(t *testing.T) {
	calls := selectorCallsIn(t, "RestaurantService.DeleteRestaurant")
	if got, want := strings.Join(calls, ", "), "DeleteWithMemberships"; got != want {
		t.Fatalf("RestaurantService.DeleteRestaurant calls [%s], want exactly [%s]", got, want)
	}
}

// TestRestoringARemovedMemberChecksTheirRoleStillExists: a removed member no
// longer stops their role being deleted, so bringing one back has to check the
// role is still there.
func TestRestoringARemovedMemberChecksTheirRoleStillExists(t *testing.T) {
	assertCallers(t, "ensureRestorableMemberRole", map[string]int{"RestaurantService.UpdateMemberStatus": 1})
}

type fakeHiddenRoles struct {
	hidden map[uint]bool
	err    error
	asked  int
}

func (f *fakeHiddenRoles) IsRoleHiddenForRestaurant(_ uint, roleID uint) (bool, error) {
	f.asked++
	return f.hidden[roleID], f.err
}

func TestEnsureRestorableMemberRole(t *testing.T) {
	const restaurantID uint = 7
	own := restaurantID
	other := uint(8)
	customRole := &entity.Role{Name: "custom_7_a1", RestaurantID: &own}
	customRole.ID = 30
	otherShopRole := &entity.Role{Name: "custom_8_b2", RestaurantID: &other}
	otherShopRole.ID = 31
	waiter := &entity.Role{Name: "waiter", IsSystem: true}
	waiter.ID = 3
	lookupFailed := errors.New("lookup failed")

	for _, tc := range []struct {
		name      string
		role      *entity.Role
		roles     *fakeHiddenRoles
		want      error
		wantAsked int
	}{
		{"custom role since deleted (no longer loaded)", nil, &fakeHiddenRoles{}, ErrMemberRoleUnavailable, 0},
		{"custom role of this restaurant", customRole, &fakeHiddenRoles{}, nil, 0},
		{"custom role of another restaurant", otherShopRole, &fakeHiddenRoles{}, ErrMemberRoleUnavailable, 0},
		{"default role still offered", waiter, &fakeHiddenRoles{}, nil, 1},
		{"default role since removed from this restaurant", waiter, &fakeHiddenRoles{hidden: map[uint]bool{3: true}}, ErrMemberRoleUnavailable, 1},
		{"hidden lookup fails", waiter, &fakeHiddenRoles{err: lookupFailed}, lookupFailed, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ensureRestorableMemberRole(tc.roles, restaurantID, tc.role)
			if !errors.Is(err, tc.want) || (tc.want == nil && err != nil) {
				t.Fatalf("ensureRestorableMemberRole() error = %v, want %v", err, tc.want)
			}
			if tc.roles.asked != tc.wantAsked {
				t.Fatalf("hidden-role lookups = %d, want %d", tc.roles.asked, tc.wantAsked)
			}
		})
	}
}

// selectorCallsIn lists the method and package-qualified calls (x.Name(...))
// made inside one function of the package, sorted.
func selectorCallsIn(t *testing.T, caller string) []string {
	t.Helper()
	var calls []string
	found := false
	for _, file := range packageSources(t) {
		for _, decl := range file.Decls {
			function, ok := decl.(*ast.FuncDecl)
			if !ok || function.Body == nil || tableGuardCallerName(function) != caller {
				continue
			}
			found = true
			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				if selector, ok := call.Fun.(*ast.SelectorExpr); ok {
					calls = append(calls, selector.Sel.Name)
				}
				return true
			})
		}
	}
	if !found {
		t.Fatalf("%s not found in the package", caller)
	}
	sort.Strings(calls)
	return calls
}
