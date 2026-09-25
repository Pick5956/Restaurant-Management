package service

import (
	"math"
	"strings"

	"Project-M/internal/entity"
)

// Unit families.
//
// An ingredient stores exactly one unit, and that unit is what its stock number
// means. But the unit that suits buying is rarely the unit that suits cooking:
// shrimp arrives by the kilogram and leaves the shelf by the gram. Forcing one
// spelling on both ends makes somebody type 0.005 every time they write a
// recipe, which is exactly the kind of number that gets a zero wrong.
//
// So a quantity may be entered in ANY unit that belongs to the same family as
// the ingredient's own unit, and is converted into that unit before it is
// stored. Nothing crosses a family: "3 ฟอง" has no gram value, and guessing one
// would corrupt stock silently. Unknown or cross-family units are refused, not
// approximated.
//
// This table is the single source of truth for both the AI command pipeline and
// the ordinary API. It used to live in ai_command_pipeline.go, where only the
// assistant could reach it.

var unitAliases = map[string]string{
	"กรัม": "g", "ก.": "g", "g": "g", "gram": "g", "grams": "g",
	"ขีด": "hg", "hg": "hg",
	"กิโลกรัม": "kg", "กิโล": "kg", "กก.": "kg", "กก": "kg", "โล": "kg", "kg": "kg", "kilo": "kg", "kilogram": "kg",
	"ออนซ์": "oz", "oz": "oz", "ounce": "oz",
	"ปอนด์": "lb", "lb": "lb", "lbs": "lb", "pound": "lb",
	"ตัน": "t", "t": "t", "ton": "t", "tonne": "t",
	"มิลลิลิตร": "ml", "มล.": "ml", "มล": "ml", "ml": "ml", "ซีซี": "ml", "cc": "ml",
	"ช้อนชา": "tsp", "ชช.": "tsp", "tsp": "tsp",
	"ช้อนโต๊ะ": "tbsp", "ชต.": "tbsp", "tbsp": "tbsp",
	"ลิตร": "l", "ล.": "l", "l": "l", "liter": "l", "litre": "l",
	"ฟอง": "unit", "ชิ้น": "unit", "อัน": "unit", "ลูก": "unit", "ใบ": "unit", "ห่อ": "pack", "แพ็ค": "pack", "แพ็ก": "pack",
	"ขวด": "bottle", "กระป๋อง": "can", "ถุง": "bag", "กล่อง": "box", "แผง": "tray", "หัว": "head", "กำ": "bunch", "มัด": "bunch",
}

// unitToBase converts a canonical unit to a base unit and a factor, when the
// unit belongs to a family this code can reason about (mass, volume). Counting
// units have no factor: "ฟอง" and "ชิ้น" only match themselves.
var unitToBase = map[string]struct {
	base   string
	factor float64
}{
	"g":    {"g", 1},
	"oz":   {"g", 28.349523125}, // international avoirdupois ounce, exact
	"hg":   {"g", 100},
	"lb":   {"g", 453.59237}, // international avoirdupois pound, exact
	"kg":   {"g", 1000},
	"t":    {"g", 1_000_000}, // metric tonne
	"ml":   {"ml", 1},
	"tsp":  {"ml", 5},  // metric teaspoon
	"tbsp": {"ml", 15}, // metric tablespoon
	"l":    {"ml", 1000},
}

// Deliberately absent, and they should stay absent: ถ้วยตวง (240 ml in US
// recipes, 250 ml in metric ones), แกลลอน (US 3,785 ml, imperial 4,546 ml), and
// every container word — ถุง, กระสอบ, ลัง, ขวด. The first two have no single
// correct factor and the rest have none at all: a sack of rice weighs whatever
// the supplier filled it with. Picking a number for any of them would put a
// silent, permanent error into stock, which is exactly what this table exists to
// prevent. They already work as their own single-unit family.

// unitFamilyLabels is what a picker offers, per base unit, smallest first. One
// spelling per unit on purpose: the aliases above exist to understand what
// somebody typed or said, not to offer six ways to write "kilogram".
var unitFamilyLabels = map[string][]string{
	"g":  {"กรัม", "ออนซ์", "ขีด", "ปอนด์", "กิโลกรัม", "ตัน"},
	"ml": {"มิลลิลิตร", "ช้อนชา", "ช้อนโต๊ะ", "ลิตร"},
}

// unitSpelling is the one way a new ingredient's unit is written when the owner
// named a measuring unit in any of its forms. "หมูสามชั้น 3 กิโล" created a row
// whose unit read "กิโล" beside rows reading "กิโลกรัม" — one unit under two
// names on the inventory screen.
var unitSpelling = map[string]string{
	"g": "กรัม", "hg": "ขีด", "kg": "กิโลกรัม", "oz": "ออนซ์", "lb": "ปอนด์", "t": "ตัน",
	"ml": "มิลลิลิตร", "tsp": "ช้อนชา", "tbsp": "ช้อนโต๊ะ", "l": "ลิตร",
}

// standardUnitSpelling writes a measuring unit the standard way and leaves
// every other word — ฟอง, ถุง, ขวด — exactly as it was typed.
// IngredientStockUnits are the units a new ingredient may be counted in — the
// same twelve the inventory form offers (inventoryPageUtils UNITS, 18 ก.ย.
// 2569): weighed, poured, counted, or a sealed container used whole. The
// assistant used to accept any word, so "เพิ่มน้ำปลา 2 ลัง" made an
// ingredient counted in ลัง that no recipe could ever be measured against.
var IngredientStockUnits = []string{
	"กรัม", "กิโลกรัม", "มิลลิลิตร", "ลิตร",
	"ฟอง", "ชิ้น", "ลูก", "ตัว",
	"ขวด", "กระป๋อง", "กล่อง", "ซอง",
}

// sealedStockUnits are the container words that are also stock units: the
// shop uses the whole bottle or packet at a time. Fish sauce poured by the
// spoon is not one of those, so the preview says how to change it.
var sealedStockUnits = map[string]bool{"ขวด": true, "กระป๋อง": true, "กล่อง": true, "ซอง": true}

// ingredientStockUnit returns the form's spelling of a unit when it is one a
// new ingredient may be counted in ("กก." → "กิโลกรัม"), and false otherwise.
func ingredientStockUnit(unit string) (string, bool) {
	spelled := standardUnitSpelling(unit)
	for _, allowed := range IngredientStockUnits {
		if spelled == allowed {
			return allowed, true
		}
	}
	return "", false
}

func standardUnitSpelling(unit string) string {
	clean := strings.TrimSpace(unit)
	if spelled, ok := unitSpelling[canonicalUnit(clean)]; ok {
		return spelled
	}
	return clean
}

func canonicalUnit(unit string) string {
	key := strings.ToLower(strings.TrimSpace(unit))
	key = strings.TrimSuffix(key, ".")
	if canonical, ok := unitAliases[key]; ok {
		return canonical
	}
	if canonical, ok := unitAliases[key+"."]; ok {
		return canonical
	}
	return key
}

// IngredientUnitFamily lists every unit a quantity may be entered in for an
// ingredient stored in the given unit, always including that unit itself.
//
// The ingredient's own spelling wins over the table's: a shelf that says "กก."
// keeps saying "กก." in the picker instead of gaining a second entry that means
// the same thing. A counting unit is its own family of one.
func IngredientUnitFamily(stockUnit string) []entity.IngredientUnitOption {
	own := strings.TrimSpace(stockUnit)
	if own == "" {
		return nil
	}
	canonicalOwn := canonicalUnit(own)
	base, known := unitToBase[canonicalOwn]
	if !known {
		return []entity.IngredientUnitOption{{Unit: own, StockPerUnit: 1}}
	}

	labels := unitFamilyLabels[base.base]
	family := make([]entity.IngredientUnitOption, 0, len(labels))
	for _, label := range labels {
		unit := label
		if canonicalUnit(label) == canonicalOwn {
			unit = own
		}
		perUnit, ok := ConvertToStockUnit(1, unit, own)
		if !ok {
			continue
		}
		family = append(family, entity.IngredientUnitOption{Unit: unit, StockPerUnit: perUnit})
	}
	return family
}

// ConvertToStockUnit expresses a quantity in the ingredient's own stock unit.
// ok=false means the two units are not the same and no known conversion links
// them — the caller must ask or refuse rather than assume.
func ConvertToStockUnit(quantity float64, spokenUnit, stockUnit string) (float64, bool) {
	spoken := canonicalUnit(spokenUnit)
	stock := canonicalUnit(stockUnit)
	if spoken == "" || spoken == stock {
		return quantity, true
	}
	from, okFrom := unitToBase[spoken]
	to, okTo := unitToBase[stock]
	if !okFrom || !okTo || from.base != to.base {
		return 0, false
	}
	converted := quantity * from.factor / to.factor
	if math.IsNaN(converted) || math.IsInf(converted, 0) {
		return 0, false
	}
	return converted, true
}

// unitIsFine reports whether a stock unit is small enough that a bare price
// ("ตั้งราคาหมูสับ 180") cannot plausibly mean per that unit — nobody prices pork
// at 180 baht a gram. For a counting unit ("ไข่ 5 บาท" against ฟอง) a bare price
// is unambiguous and needs no question.
func unitIsFine(stockUnit string) bool {
	switch canonicalUnit(stockUnit) {
	case "g", "ml":
		return true
	default:
		return false
	}
}

// ConvertPricePerUnit turns a price quoted per spokenUnit into a price per
// stockUnit. ok=false means the caller must ask: either no unit was given for a
// finely measured ingredient, or the two units have no known relation.
func ConvertPricePerUnit(price float64, spokenUnit, stockUnit string) (float64, bool) {
	if price < 0 {
		return 0, false
	}
	if strings.TrimSpace(spokenUnit) == "" {
		// No unit spoken: safe only when the stock unit is something a price is
		// naturally quoted in (a piece, an egg), never for grams or millilitres.
		if unitIsFine(stockUnit) {
			return 0, false
		}
		return price, true
	}
	// How many stock units make up one spoken unit — 1 กก. = 1,000 กรัม.
	perSpoken, ok := ConvertToStockUnit(1, spokenUnit, stockUnit)
	if !ok || perSpoken <= 0 {
		return 0, false
	}
	converted := price / perSpoken
	if math.IsNaN(converted) || math.IsInf(converted, 0) {
		return 0, false
	}
	return converted, true
}
