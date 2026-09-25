package service

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"sort"
	"strings"
	"testing"

	"Project-M/internal/entity"
)

// The bugs these guards pin were each one missing line at a call site, and the
// pure-logic tests stayed green through every one of them. Each guard reads the
// package source and asserts on the call, the way the table-lock guard does.

// TestCancelOrderClosesItsUnservedLines: cancelling an order used to flip only
// the order row, so its pending and cooking lines kept claiming stock and a dish
// stayed sold out for as long as the row existed.
func TestCancelOrderClosesItsUnservedLines(t *testing.T) {
	assertCallers(t, "cancelUnservedItems", map[string]int{"OrderService.CancelOrder": 1})
	// The handler's permission test is repeated under the row lock, so a send
	// to the kitchen between the handler's read and the cancel is seen.
	assertCallers(t, "OrderNeverReachedKitchen", map[string]int{"OrderService.CancelOrder": 1})
}

// TestOnlyAnOrderTheKitchenNeverSawIsFreeToCancel: an open order whose lines
// are all pending (or already cancelled) is the only kind anyone taking orders
// may cancel. A served order reopened by a new pending line is not.
func TestOnlyAnOrderTheKitchenNeverSawIsFreeToCancel(t *testing.T) {
	line := func(status string) entity.OrderItem { return entity.OrderItem{Status: status} }
	for _, tc := range []struct {
		name   string
		order  *entity.Order
		freely bool
	}{
		{"empty open order", &entity.Order{Status: entity.OrderStatusOpen}, true},
		{"open with pending lines", &entity.Order{Status: entity.OrderStatusOpen, Items: []entity.OrderItem{line(entity.OrderItemStatusPending), line(entity.OrderItemStatusCancelled)}}, true},
		{"served then reopened by a pending line", &entity.Order{Status: entity.OrderStatusOpen, Items: []entity.OrderItem{line(entity.OrderItemStatusServed), line(entity.OrderItemStatusPending)}}, false},
		{"ready then reopened by a pending line", &entity.Order{Status: entity.OrderStatusOpen, Items: []entity.OrderItem{line(entity.OrderItemStatusReady), line(entity.OrderItemStatusPending)}}, false},
		{"cooking line on an open order", &entity.Order{Status: entity.OrderStatusOpen, Items: []entity.OrderItem{line(entity.OrderItemStatusCooking)}}, false},
		{"sent to kitchen", &entity.Order{Status: entity.OrderStatusSentToKitchen, Items: []entity.OrderItem{line(entity.OrderItemStatusPending)}}, false},
		{"no order", nil, false},
	} {
		if got := OrderNeverReachedKitchen(tc.order); got != tc.freely {
			t.Errorf("%s: OrderNeverReachedKitchen = %v, want %v", tc.name, got, tc.freely)
		}
	}
}

// TestPendingLinesReopenAFinishedOrderOnEveryPath: a pending line on a ready or
// served order reopens it. AddItem did that for a new line only, not for a
// merge into an existing pending line, and the customer QR path holding lines
// for staff confirmation never did it at all.
func TestPendingLinesReopenAFinishedOrderOnEveryPath(t *testing.T) {
	assertCallers(t, "reopenForPendingItems", map[string]int{
		"CustomerOrderService.SubmitOrder": 1,
		"OrderService.AddItem":             2,
	})
}

// TestOpenBillChargesComeFromOneHelper: the stored order and the bill view
// price service charge and VAT through the same helper, so grand_total on an
// open order is what the bill shows.
func TestOpenBillChargesComeFromOneHelper(t *testing.T) {
	assertCallers(t, "unpaidCharges", map[string]int{"billFromOrder": 1, "priceOrder": 1})
	// ...from the same rounded total: the unrounded float left the stored
	// grand_total a satang off the bill on half-satang discounts.
	assertCallers(t, "billAmounts", map[string]int{"billFromOrder": 1, "priceOrder": 1})
}

// TestCookedDishDeductsThroughTheClamp: the kitchen deduction takes what the
// shelf has instead of refusing the cooked dish, so nothing in the package may
// still answer a low count with "stock is not enough".
func TestCookedDishDeductsThroughTheClamp(t *testing.T) {
	assertCallers(t, "stockDeduction", map[string]int{"deductInventoryForCompletedKitchenItem": 1})
	for name, file := range packageSources(t) {
		ast.Inspect(file, func(node ast.Node) bool {
			lit, ok := node.(*ast.BasicLit)
			if ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "stock is not enough") {
				t.Fatalf("%s still refuses a cooked dish with %s", name, lit.Value)
			}
			return true
		})
	}
}

// assertCallers lists every function in the package that calls name, with how
// many times, and compares it with want.
func assertCallers(t *testing.T, name string, want map[string]int) {
	t.Helper()
	got := map[string]int{}
	for _, file := range packageSources(t) {
		for _, decl := range file.Decls {
			function, ok := decl.(*ast.FuncDecl)
			if !ok || function.Body == nil {
				continue
			}
			ast.Inspect(function.Body, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				if ident, ok := call.Fun.(*ast.Ident); ok && ident.Name == name {
					got[tableGuardCallerName(function)]++
				}
				return true
			})
		}
	}
	if gotText, wantText := callerList(got), callerList(want); gotText != wantText {
		t.Fatalf("calls to %s = %s, want exactly %s", name, gotText, wantText)
	}
}

// packageFunction is the function or method the package declares under name,
// spelled the way assertCallers spells callers ("OrderService.UpdateItem").
func packageFunction(t *testing.T, name string) *ast.FuncDecl {
	t.Helper()
	for _, file := range packageSources(t) {
		for _, decl := range file.Decls {
			function, ok := decl.(*ast.FuncDecl)
			if ok && function.Body != nil && tableGuardCallerName(function) == name {
				return function
			}
		}
	}
	t.Fatalf("the package declares no %s", name)
	return nil
}

// isCallTo reports whether expr is a call of the package function name.
func isCallTo(expr ast.Expr, name string) bool {
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return false
	}
	ident, ok := call.Fun.(*ast.Ident)
	return ok && ident.Name == name
}

// isFieldOf reports whether expr is variable.field.
func isFieldOf(expr ast.Expr, variable, field string) bool {
	selector, ok := expr.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != field {
		return false
	}
	ident, ok := selector.X.(*ast.Ident)
	return ok && ident.Name == variable
}

// assignmentsTo lists the assignments in body that write the variable name.
func assignmentsTo(body ast.Node, name string) []*ast.AssignStmt {
	var found []*ast.AssignStmt
	ast.Inspect(body, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok {
			return true
		}
		for _, lhs := range assign.Lhs {
			if ident, ok := lhs.(*ast.Ident); ok && ident.Name == name {
				found = append(found, assign)
				break
			}
		}
		return true
	})
	return found
}

// isIdent reports whether expr is the bare identifier name.
func isIdent(expr ast.Expr, name string) bool {
	ident, ok := expr.(*ast.Ident)
	return ok && ident.Name == name
}

// writesTo counts the places in body that can change what matches: an
// assignment or declaration of it, ++/--, a range variable, or its address
// being taken.
func writesTo(body ast.Node, matches func(ast.Expr) bool) int {
	count := 0
	ast.Inspect(body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			for _, lhs := range n.Lhs {
				if matches(lhs) {
					count++
				}
			}
		case *ast.ValueSpec:
			for _, name := range n.Names {
				if matches(name) {
					count++
				}
			}
		case *ast.IncDecStmt:
			if matches(n.X) {
				count++
			}
		case *ast.RangeStmt:
			if (n.Key != nil && matches(n.Key)) || (n.Value != nil && matches(n.Value)) {
				count++
			}
		case *ast.UnaryExpr:
			if n.Op == token.AND && matches(n.X) {
				count++
			}
		}
		return true
	})
	return count
}

// callIn is the first call of the package function name inside node, or nil.
func callIn(node ast.Node, name string) *ast.CallExpr {
	var found *ast.CallExpr
	ast.Inspect(node, func(child ast.Node) bool {
		if found != nil {
			return false
		}
		if call, ok := child.(*ast.CallExpr); ok && isCallTo(call, name) {
			found = call
			return false
		}
		return true
	})
	return found
}

// innermostIfAround is the closest if statement in body whose block holds
// node, or nil.
func innermostIfAround(body ast.Node, node ast.Node) *ast.IfStmt {
	var found *ast.IfStmt
	ast.Inspect(body, func(child ast.Node) bool {
		stmt, ok := child.(*ast.IfStmt)
		if ok && stmt.Body.Pos() <= node.Pos() && node.End() <= stmt.Body.End() {
			found = stmt
		}
		return true
	})
	return found
}

// condText is an if statement's condition as source, for a failure message.
func condText(stmt *ast.IfStmt) string {
	if stmt == nil {
		return "no if at all"
	}
	return types.ExprString(stmt.Cond)
}

func callerList(counts map[string]int) string {
	names := make([]string, 0, len(counts))
	for name := range counts {
		names = append(names, name)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, name := range names {
		parts = append(parts, fmt.Sprintf("%s x%d", name, counts[name]))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func packageSources(t *testing.T) map[string]*ast.File {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package directory: %v", err)
	}
	fileSet := token.NewFileSet()
	files := map[string]*ast.File{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fileSet, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		files[name] = file
	}
	return files
}
