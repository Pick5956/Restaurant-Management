package service

import (
	"go/ast"
	"go/token"
	"math"
	"strings"
	"testing"

	"Project-M/internal/entity"
)

func TestValidateIngredientNumbers(t *testing.T) {
	tests := []struct {
		name    string
		req     IngredientRequest
		wantErr string
	}{
		{
			name: "accepts valid inventory values",
			req: IngredientRequest{
				Stock:        0,
				MinStock:     1.25,
				CostPerUnit:  12.50,
				YieldPercent: 85,
			},
		},
		{
			name:    "rejects negative stock",
			req:     IngredientRequest{Stock: -0.01},
			wantErr: "stock must be zero or greater",
		},
		{
			name:    "rejects negative minimum stock",
			req:     IngredientRequest{MinStock: -0.01},
			wantErr: "minimum stock must be zero or greater",
		},
		{
			name:    "rejects negative cost",
			req:     IngredientRequest{CostPerUnit: -0.01},
			wantErr: "cost per unit must be zero or greater",
		},
		{
			name:    "rejects yield over one hundred",
			req:     IngredientRequest{YieldPercent: 100.01},
			wantErr: "yield percent must be between 0 and 100",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateIngredientNumbers(&test.req)
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("validateIngredientNumbers() error = %v, want nil", err)
				}
				return
			}
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("validateIngredientNumbers() error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestApplyStockAdjustment(t *testing.T) {
	tests := []struct {
		name      string
		current   float64
		kind      string
		quantity  float64
		wantStock float64
		wantErr   string
	}{
		{name: "receives stock", current: 5, kind: "in", quantity: 2.5, wantStock: 7.5},
		{name: "uses stock", current: 5, kind: "out", quantity: 2.5, wantStock: 2.5},
		{name: "sets an audited count", current: 5, kind: "adjust", quantity: 3.25, wantStock: 3.25},
		{name: "rejects insufficient stock", current: 1, kind: "out", quantity: 2, wantErr: "not enough stock"},
		{name: "rejects unknown transaction type", current: 1, kind: "erase", quantity: 1, wantErr: "type must be 'in', 'out', or 'adjust'"},
		{name: "rejects non-positive quantity", current: 1, kind: "in", quantity: 0, wantErr: "quantity must be greater than zero"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := applyStockAdjustment(test.current, test.kind, test.quantity)
			if test.wantErr == "" {
				if err != nil {
					t.Fatalf("applyStockAdjustment() error = %v, want nil", err)
				}
				if got != test.wantStock {
					t.Fatalf("applyStockAdjustment() = %v, want %v", got, test.wantStock)
				}
				return
			}
			if err == nil || err.Error() != test.wantErr {
				t.Fatalf("applyStockAdjustment() error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestBuildInitialStockTransaction(t *testing.T) {
	ingredient := &entity.Ingredient{
		RestaurantID: 9,
		Stock:        12.5,
	}
	ingredient.ID = 27

	tx := buildInitialStockTransaction(ingredient, 41)
	if tx == nil {
		t.Fatal("buildInitialStockTransaction() = nil, want transaction")
	}
	if tx.RestaurantID != 9 || tx.IngredientID != 27 || tx.CreatedByID != 41 {
		t.Fatalf("buildInitialStockTransaction() identity = %#v", tx)
	}
	if tx.Type != "adjust" || tx.Quantity != 12.5 || tx.Note != "ยอดเริ่มต้น" {
		t.Fatalf("buildInitialStockTransaction() values = %#v", tx)
	}

	if tx.Amount != 0 {
		t.Fatalf("buildInitialStockTransaction() amount = %v, want 0 without a cost per unit", tx.Amount)
	}

	// Opening stock priced at the ingredient's own rate: 12.5 * 8.4 = 105.
	ingredient.CostPerUnit = 8.4
	priced := buildInitialStockTransaction(ingredient, 41)
	if priced == nil || priced.Amount != 105 {
		t.Fatalf("buildInitialStockTransaction() amount = %#v, want 105", priced)
	}

	ingredient.Stock = 0
	if got := buildInitialStockTransaction(ingredient, 41); got != nil {
		t.Fatalf("buildInitialStockTransaction() = %#v, want nil for zero stock", got)
	}
}

func TestReferenceRestockAmount(t *testing.T) {
	if got := referenceRestockAmount(12.345, 3); got != 37.04 {
		t.Fatalf("referenceRestockAmount(12.345, 3) = %v, want 37.04", got)
	}
	// No rate, no quantity, or nonsense numbers must not invent an expense.
	for _, testCase := range []struct{ cost, quantity float64 }{
		{0, 5},
		{-2, 5},
		{10, 0},
		{10, -5},
		{math.NaN(), 5},
		{math.Inf(1), 5},
		{10, math.NaN()},
	} {
		if got := referenceRestockAmount(testCase.cost, testCase.quantity); got != 0 {
			t.Fatalf("referenceRestockAmount(%v, %v) = %v, want 0", testCase.cost, testCase.quantity, got)
		}
	}
	if got := referenceRestockAmount(maxIngredientCost, 10); got != maxIngredientCost {
		t.Fatalf("referenceRestockAmount() = %v, want clamp to %v", got, float64(maxIngredientCost))
	}
}

func TestIngredientRecipeUnitChangeBlocked(t *testing.T) {
	if !ingredientRecipeUnitChangeBlocked("kg", "g", true) {
		t.Fatal("ingredientRecipeUnitChangeBlocked() = false, want true when a referenced stock unit changes")
	}
	if ingredientRecipeUnitChangeBlocked("kg", "KG", true) {
		t.Fatal("ingredientRecipeUnitChangeBlocked() = true for case-only change")
	}
	if ingredientRecipeUnitChangeBlocked("kg", "g", false) {
		t.Fatal("ingredientRecipeUnitChangeBlocked() = true for unreferenced ingredient")
	}
}

// TestUnitChangeRefusalCarriesItsSentinel: the API gives this refusal its own
// code only when it is ErrIngredientUnitLocked. IngredientService.Update has
// to return the sentinel, and no call site may spell the text out again - an
// errors.New with the same words reaches the client as a plain
// invalid_request.
func TestUnitChangeRefusalCarriesItsSentinel(t *testing.T) {
	update := packageFunction(t, "IngredientService.Update")
	returned := 0
	ast.Inspect(update.Body, func(node ast.Node) bool {
		ret, ok := node.(*ast.ReturnStmt)
		if !ok {
			return true
		}
		for _, result := range ret.Results {
			if ident, ok := result.(*ast.Ident); ok && ident.Name == "ErrIngredientUnitLocked" {
				returned++
			}
		}
		return true
	})
	if returned != 1 {
		t.Fatalf("IngredientService.Update returns ErrIngredientUnitLocked %d times, want once", returned)
	}
	spelled := 0
	for _, file := range packageSources(t) {
		ast.Inspect(file, func(node ast.Node) bool {
			lit, ok := node.(*ast.BasicLit)
			if ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "cannot change stock units") {
				spelled++
			}
			return true
		})
	}
	if spelled != 1 {
		t.Fatalf("the unit-change refusal is spelled out %d times in the package, want once (the sentinel)", spelled)
	}
}

// A restock's amount becomes a real ledger row, so anything that survives this
// check gets summed into the restaurant's expenses forever.
func TestRestockAmountOnlyAcceptsMoneyOnStockIn(t *testing.T) {
	rejected := []struct {
		name   string
		kind   string
		amount float64
	}{
		// Paying for stock leaving the shelf is nonsense; recording it would
		// inflate expenses every time someone writes off spoilage.
		{"out with money", "out", 500},
		{"adjust with money", "adjust", 500},
		{"nan", "in", math.NaN()},
		{"positive infinity", "in", math.Inf(1)},
		{"negative", "in", -1},
		{"above cap", "in", maxIngredientCost + 1},
	}
	for _, test := range rejected {
		t.Run(test.name, func(t *testing.T) {
			if _, err := restockAmount(test.kind, test.amount); err == nil {
				t.Fatalf("restockAmount(%q, %v) unexpectedly succeeded", test.kind, test.amount)
			}
		})
	}

	// No amount is the normal case for every movement type and must stay silent.
	for _, kind := range []string{"in", "out", "adjust"} {
		if got, err := restockAmount(kind, 0); err != nil || got != 0 {
			t.Fatalf("restockAmount(%q, 0) = %v, %v; want 0, nil", kind, got, err)
		}
	}

	got, err := restockAmount("in", 1234.567)
	if err != nil {
		t.Fatalf("restockAmount() error = %v", err)
	}
	if got != 1234.57 {
		t.Fatalf("restockAmount() = %v, want 1234.57", got)
	}
}

// A member who may not write the ledger still moves stock; what the movement
// is worth must then be nothing, or the Expense write downstream fires.
func TestBookedRestockAmountBooksNothingWhenExpensesAreSkipped(t *testing.T) {
	if got := bookedRestockAmount(true, 0, 8.4, 12.5); got != 0 {
		t.Fatalf("skipped auto-valued stock-in booked %v, want 0", got)
	}
	if got := bookedRestockAmount(true, 1250, 8.4, 12.5); got != 0 {
		t.Fatalf("skipped typed stock-in booked %v, want 0", got)
	}
	if got := bookedRestockAmount(false, 1250, 8.4, 12.5); got != 1250 {
		t.Fatalf("typed amount = %v, want 1250", got)
	}
	if got := bookedRestockAmount(false, 0, 8.4, 12.5); got != 105 {
		t.Fatalf("auto-valued amount = %v, want 105", got)
	}
}
