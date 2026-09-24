package controller

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// The fixes below live in a handler's body, where a unit test of the helper
// cannot see them. Each guard reads the handler and asserts the call is still
// there; it fails when the line is reverted.
func TestHandlersKeepTheirGuardCalls(t *testing.T) {
	for _, guard := range []struct {
		file, handler, call string
	}{
		// A cashier or custom role reaches CancelOrder through take_order; the
		// gate on a sent order has to be a permission test, not a role name.
		{"order.go", "OrderController.CancelOrder", "requireOrderCancelAccess"},
		// A replaced or deleted picture otherwise stays on disk until the
		// 500-file quota stops uploads for the restaurant.
		{"menu.go", "MenuController.UpdateMenuItem", "releaseMenuImage"},
		{"menu.go", "MenuController.DeleteMenuItem", "releaseMenuImage"},
		// Without the flag the service values the stock-in itself and books it.
		{"ingredient.go", "IngredientController.Create", "skipStockExpense"},
		{"ingredient.go", "IngredientController.AdjustStock", "skipStockExpense"},
	} {
		if !handlerCalls(t, guard.file, guard.handler, guard.call) {
			t.Errorf("%s no longer calls %s", guard.handler, guard.call)
		}
	}
}

func handlerCalls(t *testing.T, filename, handler, call string) bool {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), filename, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", filename, err)
	}
	for _, decl := range file.Decls {
		function, ok := decl.(*ast.FuncDecl)
		if !ok || function.Body == nil || handlerName(function) != handler {
			continue
		}
		found := false
		ast.Inspect(function.Body, func(node ast.Node) bool {
			callExpr, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			switch fun := callExpr.Fun.(type) {
			case *ast.Ident:
				found = found || fun.Name == call
			case *ast.SelectorExpr:
				found = found || fun.Sel.Name == call
			}
			return true
		})
		return found
	}
	t.Fatalf("%s not found in %s", handler, filename)
	return false
}

func handlerName(function *ast.FuncDecl) string {
	if function.Recv == nil || len(function.Recv.List) == 0 {
		return function.Name.Name
	}
	receiver := function.Recv.List[0].Type
	if star, ok := receiver.(*ast.StarExpr); ok {
		receiver = star.X
	}
	if ident, ok := receiver.(*ast.Ident); ok {
		return ident.Name + "." + function.Name.Name
	}
	return function.Name.Name
}
