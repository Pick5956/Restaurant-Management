package service

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

// TestEveryStockWritePathConsultsSkipExpense reads the source: the controller
// refuses a typed amount without manage_expenses, but both stock-write paths
// value the movement themselves and write an Expense row from that value, so
// each has to read the flag. A test of bookedRestockAmount alone cannot see a
// path that stopped calling it.
func TestEveryStockWritePathConsultsSkipExpense(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "ingredient_service.go", nil, 0)
	if err != nil {
		t.Fatalf("parse ingredient_service.go: %v", err)
	}
	reads := map[string]bool{}
	for _, decl := range file.Decls {
		function, ok := decl.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		name := tableGuardCallerName(function)
		ast.Inspect(function.Body, func(node ast.Node) bool {
			selector, ok := node.(*ast.SelectorExpr)
			if !ok || selector.Sel.Name != "SkipExpense" {
				return true
			}
			if ident, ok := selector.X.(*ast.Ident); ok && ident.Name == "req" {
				reads[name] = true
			}
			return true
		})
	}
	for _, name := range []string{"IngredientService.Create", "IngredientService.AdjustStock"} {
		if !reads[name] {
			t.Fatalf("%s writes stock without reading req.SkipExpense: a member without manage_expenses would book a ledger row", name)
		}
	}
}
