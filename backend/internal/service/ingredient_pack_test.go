package service

import (
	"math"
	"testing"

	"Project-M/internal/entity"
)

func fishSauce() *entity.Ingredient {
	return &entity.Ingredient{
		Unit:     "มิลลิลิตร",
		PackUnit: "ขวด",
		PackSize: 700,
		CaseUnit: "ลัง",
		CaseSize: 12,
	}
}

func TestIngredientQuantityInStockUnitReadsPackAndCase(t *testing.T) {
	tests := []struct {
		quantity float64
		unit     string
		want     float64
	}{
		{15, "", 15},
		{15, "มิลลิลิตร", 15},
		{2, "ลิตร", 2000},     // the measuring family still works
		{3, "ขวด", 2100},      // pack
		{2, "ลัง", 16800},     // case = 12 × 700
		{0.5, "ขวด", 350},     // half a bottle on a count
	}
	for _, tc := range tests {
		got, ok := IngredientQuantityInStockUnit(tc.quantity, tc.unit, fishSauce())
		if !ok || math.Abs(got-tc.want) > 1e-9 {
			t.Errorf("%v %s = %v (ok=%v), want %v", tc.quantity, tc.unit, got, ok, tc.want)
		}
	}
	if _, ok := IngredientQuantityInStockUnit(1, "กระป๋อง", fishSauce()); ok {
		t.Error("an unknown container must be refused, not guessed")
	}
	if _, ok := IngredientQuantityInStockUnit(1, "กิโลกรัม", fishSauce()); ok {
		t.Error("crossing from mass to volume must be refused")
	}
}

func TestIngredientQuantityWithoutPackIsTheOldConversion(t *testing.T) {
	plain := &entity.Ingredient{Unit: "กรัม"}
	if got, ok := IngredientQuantityInStockUnit(2, "กิโลกรัม", plain); !ok || got != 2000 {
		t.Fatalf("2 กิโลกรัม = %v (ok=%v)", got, ok)
	}
	if _, ok := IngredientQuantityInStockUnit(1, "ขวด", plain); ok {
		t.Fatal("no pack set, so ขวด means nothing")
	}
	// A case with no pack underneath cannot be converted.
	orphan := &entity.Ingredient{Unit: "มิลลิลิตร", CaseUnit: "ลัง", CaseSize: 12}
	if _, ok := IngredientQuantityInStockUnit(1, "ลัง", orphan); ok {
		t.Fatal("a case without a pack has no size")
	}
}

func TestIngredientUnitFamilyForAppendsPurchaseUnits(t *testing.T) {
	family := IngredientUnitFamilyFor(fishSauce())
	last := family[len(family)-2:]
	if last[0] != (entity.IngredientUnitOption{Unit: "ขวด", StockPerUnit: 700}) ||
		last[1] != (entity.IngredientUnitOption{Unit: "ลัง", StockPerUnit: 8400}) {
		t.Fatalf("family tail = %+v", last)
	}
	egg := IngredientUnitFamilyFor(&entity.Ingredient{Unit: "ฟอง", PackUnit: "แผง", PackSize: 30})
	if len(egg) != 2 || egg[1].StockPerUnit != 30 {
		t.Fatalf("egg family = %+v", egg)
	}
}

func TestIngredientPricePerStockUnit(t *testing.T) {
	got, ok := IngredientPricePerStockUnit(35, "ขวด", fishSauce())
	if !ok || math.Abs(got-0.05) > 1e-9 {
		t.Fatalf("ขวดละ 35 = %v per มล. (ok=%v)", got, ok)
	}
	got, ok = IngredientPricePerStockUnit(840, "ลัง", fishSauce())
	if !ok || math.Abs(got-0.1) > 1e-9 {
		t.Fatalf("ลังละ 840 = %v per มล. (ok=%v)", got, ok)
	}
}

func strPtr(value string) *string    { return &value }
func numPtr(value float64) *float64 { return &value }

func TestResolvePackFields(t *testing.T) {
	current := packFieldsOf(fishSauce())

	t.Run("silence keeps what is stored", func(t *testing.T) {
		got, err := resolvePackFields(&IngredientRequest{}, "มิลลิลิตร", current)
		if err != nil || got != current {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	t.Run("an empty pack clears the case too", func(t *testing.T) {
		got, err := resolvePackFields(&IngredientRequest{PackUnit: strPtr("")}, "มิลลิลิตร", current)
		if err != nil || got != (packFields{}) {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	t.Run("sets a pack and a case", func(t *testing.T) {
		req := &IngredientRequest{PackUnit: strPtr(" แผง "), PackSize: numPtr(30), CaseUnit: strPtr("ลัง"), CaseSize: numPtr(12)}
		got, err := resolvePackFields(req, "ฟอง", packFields{})
		want := packFields{PackUnit: "แผง", PackSize: 30, CaseUnit: "ลัง", CaseSize: 12}
		if err != nil || got != want {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	t.Run("an empty case keeps the pack", func(t *testing.T) {
		got, err := resolvePackFields(&IngredientRequest{CaseUnit: strPtr("")}, "มิลลิลิตร", current)
		want := packFields{PackUnit: "ขวด", PackSize: 700}
		if err != nil || got != want {
			t.Fatalf("got %+v, %v", got, err)
		}
	})

	refused := map[string]*IngredientRequest{
		"no size":                  {PackUnit: strPtr("ขวด")},
		"zero size":                {PackUnit: strPtr("ขวด"), PackSize: numPtr(0)},
		"negative size":            {PackUnit: strPtr("ขวด"), PackSize: numPtr(-1)},
		"pack is the stock unit":   {PackUnit: strPtr("มล."), PackSize: numPtr(700)},
		"pack already converts":    {PackUnit: strPtr("ลิตร"), PackSize: numPtr(2)},
		"case without a size":      {PackUnit: strPtr("ขวด"), PackSize: numPtr(700), CaseUnit: strPtr("ลัง")},
		"case is the pack":         {PackUnit: strPtr("ขวด"), PackSize: numPtr(700), CaseUnit: strPtr("ขวด"), CaseSize: numPtr(12)},
		"case already converts":    {PackUnit: strPtr("ขวด"), PackSize: numPtr(700), CaseUnit: strPtr("ลิตร"), CaseSize: numPtr(12)},
	}
	for name, req := range refused {
		t.Run("refuses "+name, func(t *testing.T) {
			if _, err := resolvePackFields(req, "มิลลิลิตร", packFields{}); err == nil {
				t.Fatal("expected an error")
			}
		})
	}

	t.Run("a stock unit change re-checks the kept pack", func(t *testing.T) {
		// The shelf becomes ขวด while the stored pack is also ขวด.
		if _, err := resolvePackFields(&IngredientRequest{}, "ขวด", current); err == nil {
			t.Fatal("a pack equal to the new stock unit must be refused")
		}
	})
}
