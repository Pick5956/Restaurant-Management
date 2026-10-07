package service

import (
	"math"
	"testing"

	"Project-M/internal/entity"
)

func TestIngredientUnitFamily(t *testing.T) {
	tests := []struct {
		stockUnit string
		want      []entity.IngredientUnitOption
	}{
		// The shelf's own spelling stays in the list; it is not replaced by the
		// table's canonical one, so "กก." does not gain a duplicate "กิโลกรัม".
		{"กิโลกรัม", []entity.IngredientUnitOption{
			{Unit: "กรัม", StockPerUnit: 0.001},
			{Unit: "ขีด", StockPerUnit: 0.1},
			{Unit: "กิโลกรัม", StockPerUnit: 1},
		}},
		// The shelf's own spelling stays in the list; it is not replaced by the
		// table's canonical one, so "กก." does not gain a duplicate "กิโลกรัม".
		{"กก.", []entity.IngredientUnitOption{
			{Unit: "กรัม", StockPerUnit: 0.001},
			{Unit: "ขีด", StockPerUnit: 0.1},
			{Unit: "กก.", StockPerUnit: 1},
		}},
		{"กรัม", []entity.IngredientUnitOption{
			{Unit: "กรัม", StockPerUnit: 1},
			{Unit: "ขีด", StockPerUnit: 100},
			{Unit: "กิโลกรัม", StockPerUnit: 1000},
		}},
		// A shelf still kept in a unit the list dropped keeps its own unit first.
		{"ออนซ์", []entity.IngredientUnitOption{
			{Unit: "ออนซ์", StockPerUnit: 1},
			{Unit: "กรัม", StockPerUnit: 0.03527396194958041},
			{Unit: "ขีด", StockPerUnit: 3.527396194958041},
			{Unit: "กิโลกรัม", StockPerUnit: 35.27396194958041},
		}},
		{"ลิตร", []entity.IngredientUnitOption{
			{Unit: "มิลลิลิตร", StockPerUnit: 0.001},
			{Unit: "ช้อนชา", StockPerUnit: 0.005},
			{Unit: "ช้อนโต๊ะ", StockPerUnit: 0.015},
			{Unit: "ลิตร", StockPerUnit: 1},
		}},
		// ซีซี is the same size as มิลลิลิตร, so it takes that slot rather than
		// appearing twice.
		{"ซีซี", []entity.IngredientUnitOption{
			{Unit: "ซีซี", StockPerUnit: 1},
			{Unit: "ช้อนชา", StockPerUnit: 5},
			{Unit: "ช้อนโต๊ะ", StockPerUnit: 15},
			{Unit: "ลิตร", StockPerUnit: 1000},
		}},
		// A counting unit converts to nothing, so it is a family of one. So does
		// a container: nobody can say what one ถุง weighs.
		{"ฟอง", []entity.IngredientUnitOption{{Unit: "ฟอง", StockPerUnit: 1}}},
		{"ถุง", []entity.IngredientUnitOption{{Unit: "ถุง", StockPerUnit: 1}}},
		{"หน่วยที่ไม่รู้จัก", []entity.IngredientUnitOption{{Unit: "หน่วยที่ไม่รู้จัก", StockPerUnit: 1}}},
		{"", nil},
	}

	for _, test := range tests {
		got := IngredientUnitFamily(test.stockUnit)
		if len(got) != len(test.want) {
			t.Fatalf("IngredientUnitFamily(%q) = %+v, want %+v", test.stockUnit, got, test.want)
		}
		for i := range got {
			if got[i].Unit != test.want[i].Unit || math.Abs(got[i].StockPerUnit-test.want[i].StockPerUnit) > 1e-9 {
				t.Fatalf("IngredientUnitFamily(%q)[%d] = %+v, want %+v", test.stockUnit, i, got[i], test.want[i])
			}
		}
	}
}

func TestStockQuantityInStockUnit(t *testing.T) {
	// Buying by the kilo against a shelf kept in grams is the case that made
	// people create a second ingredient rather than do the arithmetic.
	got, err := stockQuantityInStockUnit(100, "กิโลกรัม", "กรัม")
	if err != nil || math.Abs(got-100000) > 1e-6 {
		t.Fatalf("stockQuantityInStockUnit(100kg -> g) = %v, %v; want 100000, nil", got, err)
	}
	got, err = stockQuantityInStockUnit(100, "กรัม", "กรัม")
	if err != nil || got != 100 {
		t.Fatalf("stockQuantityInStockUnit(same unit) = %v, %v; want 100, nil", got, err)
	}
	got, err = stockQuantityInStockUnit(100, "", "กรัม")
	if err != nil || got != 100 {
		t.Fatalf("stockQuantityInStockUnit(no unit) = %v, %v; want 100, nil", got, err)
	}
	if _, err := stockQuantityInStockUnit(3, "ฟอง", "กรัม"); err == nil {
		t.Fatal("stockQuantityInStockUnit(cross-family) error = nil, want refusal")
	}
}

func TestNoteWithEnteredUnitKeepsWhatWasTyped(t *testing.T) {
	// Stored quantity is in the shelf's unit, so history would otherwise lose
	// the fact that the delivery was counted in kilos.
	if got := noteWithEnteredUnit("", 10, "กิโลกรัม", "กรัม"); got != "กรอก 10 กิโลกรัม" {
		t.Fatalf("noteWithEnteredUnit(no note) = %q", got)
	}
	if got := noteWithEnteredUnit("ล็อตเช้า", 2.5, "กิโลกรัม", "กรัม"); got != "กรอก 2.5 กิโลกรัม · ล็อตเช้า" {
		t.Fatalf("noteWithEnteredUnit(with note) = %q", got)
	}
	// Nothing to record when the unit typed is the unit stored.
	if got := noteWithEnteredUnit("ล็อตเช้า", 2, "กรัม", "กรัม"); got != "ล็อตเช้า" {
		t.Fatalf("noteWithEnteredUnit(same unit) = %q", got)
	}
}

func TestConvertToStockUnitAcrossTheWholeTable(t *testing.T) {
	tests := []struct {
		quantity float64
		from     string
		to       string
		want     float64
	}{
		{1, "ปอนด์", "กรัม", 453.59237},
		{1, "ออนซ์", "กรัม", 28.349523125},
		{2, "ตัน", "กิโลกรัม", 2000},
		{1, "ช้อนโต๊ะ", "มิลลิลิตร", 15},
		{3, "ช้อนชา", "มิลลิลิตร", 15},
		{1, "ช้อนโต๊ะ", "ช้อนชา", 3},
		{500, "ซีซี", "ลิตร", 0.5},
		{16, "ออนซ์", "ปอนด์", 1},
	}
	for _, test := range tests {
		got, ok := ConvertToStockUnit(test.quantity, test.from, test.to)
		if !ok || math.Abs(got-test.want) > 1e-9 {
			t.Fatalf("ConvertToStockUnit(%v, %q, %q) = %v, %t; want %v", test.quantity, test.from, test.to, got, ok, test.want)
		}
	}

	// A container has no weight and a volume is not a mass: both must refuse.
	for _, pair := range [][2]string{{"ถุง", "กรัม"}, {"ลิตร", "กรัม"}, {"ช้อนโต๊ะ", "ขีด"}} {
		if _, ok := ConvertToStockUnit(1, pair[0], pair[1]); ok {
			t.Fatalf("ConvertToStockUnit(1, %q, %q) converted; want refusal", pair[0], pair[1])
		}
	}
}
