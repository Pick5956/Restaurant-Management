package service

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strings"
	"testing"
)

// TestTableInServiceGuardRunsOnlyOnManagementEdits reads the package source and
// lists every function that calls the in-service guard.
//
// The guard is right for an edit and wrong for the service flow: the order,
// payment, booking and status paths are exactly how a table gets into and out
// of service, and a guard on any of them would stop the floor from seating or
// freeing a table. A test of the guard itself cannot see a call site added in
// the wrong place, so this one pins the call sites: the five management edits,
// the switch to inactive on the status endpoint, and nothing else in the
// package. TestUpdateTableStatusGuardsOnlyTheSwitchToInactive pins the second.
func TestTableInServiceGuardRunsOnlyOnManagementEdits(t *testing.T) {
	guards := map[string]bool{"ensureTableEditable": true, "ensureTablesEditable": true}
	want := []string{
		"TableService.DeleteTable",
		"TableService.MoveTableZone",
		"TableService.RegenerateCustomerToken",
		"TableService.UpdateTable",
		"TableService.UpdateTableStatus",
		"TableService.UpdateZone",
		// The single-table form is a wrapper over the set form.
		"ensureTableEditable",
	}

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package directory: %v", err)
	}
	fileSet := token.NewFileSet()
	callers := map[string]bool{}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fileSet, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
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
				if ident, ok := call.Fun.(*ast.Ident); ok && guards[ident.Name] {
					callers[tableGuardCallerName(function)] = true
				}
				return true
			})
		}
	}

	got := make([]string, 0, len(callers))
	for name := range callers {
		got = append(got, name)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("functions calling the in-service guard = %v, want exactly %v", got, want)
	}
}

// TestUpdateTableStatusGuardsOnlyTheSwitchToInactive: the status endpoint is
// mostly the service flow (hold, free, drift recovery), so the guard there has
// to sit inside `if status == entity.TableStatusInactive`. Unconditional, it
// would stop the POS from freeing the very table it held.
func TestUpdateTableStatusGuardsOnlyTheSwitchToInactive(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "table_service.go", nil, 0)
	if err != nil {
		t.Fatalf("parse table_service.go: %v", err)
	}
	var function *ast.FuncDecl
	for _, decl := range file.Decls {
		if candidate, ok := decl.(*ast.FuncDecl); ok && tableGuardCallerName(candidate) == "TableService.UpdateTableStatus" {
			function = candidate
		}
	}
	if function == nil {
		t.Fatal("TableService.UpdateTableStatus not found in table_service.go")
	}

	calls, guarded := 0, 0
	var stack []ast.Node
	ast.Inspect(function.Body, func(node ast.Node) bool {
		if node == nil {
			stack = stack[:len(stack)-1]
			return false
		}
		stack = append(stack, node)
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		ident, ok := call.Fun.(*ast.Ident)
		if !ok || (ident.Name != "ensureTableEditable" && ident.Name != "ensureTablesEditable") {
			return true
		}
		calls++
		for _, ancestor := range stack {
			if ifStmt, ok := ancestor.(*ast.IfStmt); ok && isStatusInactiveCondition(ifStmt.Cond) {
				guarded++
				break
			}
		}
		return true
	})
	if calls == 0 {
		t.Fatal("UpdateTableStatus does not call the in-service guard: a table in service could be switched off on the status endpoint")
	}
	if guarded != calls {
		t.Fatalf("%d of %d guard calls in UpdateTableStatus sit outside `if status == entity.TableStatusInactive`", calls-guarded, calls)
	}
}

func isStatusInactiveCondition(expr ast.Expr) bool {
	binary, ok := expr.(*ast.BinaryExpr)
	if !ok || binary.Op != token.EQL {
		return false
	}
	left, ok := binary.X.(*ast.Ident)
	if !ok || left.Name != "status" {
		return false
	}
	right, ok := binary.Y.(*ast.SelectorExpr)
	return ok && right.Sel.Name == "TableStatusInactive"
}

func tableGuardCallerName(function *ast.FuncDecl) string {
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
