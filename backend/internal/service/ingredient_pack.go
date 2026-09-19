package service

import (
	"errors"
	"math"
	"strings"

	"Project-M/internal/entity"
)

// Purchase units.
//
// Stock is counted in the unit a recipe consumes, because that is what the
// kitchen deducts. Deliveries do not arrive in that unit: fish sauce comes as
// 12 ขวด to a ลัง, and nobody receiving a delivery should have to work out that
// two cases are 16,800 มิลลิลิตร. So an ingredient may carry up to two purchase
// units of its own — a pack (ขวด = 700 มิลลิลิตร) and a case (ลัง = 12 ขวด) —
// and any quantity entered in one of them is converted here before it touches
// stock. Recipes, restocks, counts and the assistant all go through
// ingredientStockPerUnit, so the same "2 ลัง" means the same amount everywhere.

// ingredientStockPerUnit is how many stock units one `unit` of this ingredient
// holds. ok=false means the unit is neither the ingredient's own, a unit of the
// same measuring family, nor one of its purchase units.
func ingredientStockPerUnit(unit string, ingredient *entity.Ingredient) (float64, bool) {
	spoken := strings.TrimSpace(unit)
	if ingredient == nil {
		return 0, false
	}
	if spoken == "" || sameUnit(spoken, ingredient.Unit) {
		return 1, true
	}
	if ingredient.PackUnit != "" && ingredient.PackSize > 0 && sameUnit(spoken, ingredient.PackUnit) {
		return ingredient.PackSize, true
	}
	if ingredient.CaseUnit != "" && ingredient.CaseSize > 0 && ingredient.PackSize > 0 && sameUnit(spoken, ingredient.CaseUnit) {
		return ingredient.CaseSize * ingredient.PackSize, true
	}
	return ConvertToStockUnit(1, spoken, ingredient.Unit)
}

// IngredientQuantityInStockUnit is ConvertToStockUnit that also understands
// this ingredient's own pack and case.
func IngredientQuantityInStockUnit(quantity float64, unit string, ingredient *entity.Ingredient) (float64, bool) {
	perUnit, ok := ingredientStockPerUnit(unit, ingredient)
	if !ok {
		return 0, false
	}
	converted := quantity * perUnit
	if math.IsNaN(converted) || math.IsInf(converted, 0) {
		return 0, false
	}
	return converted, true
}

// IngredientPricePerStockUnit restates a price quoted per `unit` ("ขวดละ 35")
// as a price per stock unit. With no unit it defers to ConvertPricePerUnit,
// which refuses to guess for grams and millilitres.
func IngredientPricePerStockUnit(price float64, unit string, ingredient *entity.Ingredient) (float64, bool) {
	if ingredient == nil || price < 0 {
		return 0, false
	}
	if strings.TrimSpace(unit) == "" {
		return ConvertPricePerUnit(price, unit, ingredient.Unit)
	}
	perUnit, ok := ingredientStockPerUnit(unit, ingredient)
	if !ok || perUnit <= 0 {
		return 0, false
	}
	converted := price / perUnit
	if math.IsNaN(converted) || math.IsInf(converted, 0) {
		return 0, false
	}
	return converted, true
}

// IngredientUnitFamilyFor is the picker list for one ingredient: its measuring
// family, then its pack, then its case.
func IngredientUnitFamilyFor(ingredient *entity.Ingredient) []entity.IngredientUnitOption {
	if ingredient == nil {
		return nil
	}
	family := IngredientUnitFamily(ingredient.Unit)
	if ingredient.PackUnit != "" && ingredient.PackSize > 0 {
		family = append(family, entity.IngredientUnitOption{Unit: ingredient.PackUnit, StockPerUnit: ingredient.PackSize})
		if ingredient.CaseUnit != "" && ingredient.CaseSize > 0 {
			family = append(family, entity.IngredientUnitOption{
				Unit:         ingredient.CaseUnit,
				StockPerUnit: ingredient.CaseSize * ingredient.PackSize,
			})
		}
	}
	return family
}

func sameUnit(a, b string) bool {
	return canonicalUnit(a) == canonicalUnit(b)
}

type packFields struct {
	PackUnit string
	PackSize float64
	CaseUnit string
	CaseSize float64
}

func packFieldsOf(ingredient *entity.Ingredient) packFields {
	return packFields{
		PackUnit: ingredient.PackUnit,
		PackSize: ingredient.PackSize,
		CaseUnit: ingredient.CaseUnit,
		CaseSize: ingredient.CaseSize,
	}
}

func (p packFields) applyTo(ingredient *entity.Ingredient) {
	ingredient.PackUnit = p.PackUnit
	ingredient.PackSize = p.PackSize
	ingredient.CaseUnit = p.CaseUnit
	ingredient.CaseSize = p.CaseSize
}

// resolvePackFields settles the purchase units a request asks for against the
// stock unit it will be stored under.
//
// A field left out of the request (nil) keeps `current`, because every client
// that predates these columns — the Expo app, the assistant — sends none of
// them, and reading their silence as "clear it" would wipe a pack somebody set
// on the web. An explicit empty PackUnit clears the pack and the case with it.
func resolvePackFields(req *IngredientRequest, stockUnit string, current packFields) (packFields, error) {
	next := current
	if req.PackUnit != nil {
		next.PackUnit = strings.TrimSpace(*req.PackUnit)
		next.PackSize = 0
		if req.PackSize != nil {
			next.PackSize = *req.PackSize
		}
	} else if req.PackSize != nil {
		next.PackSize = *req.PackSize
	}
	if req.CaseUnit != nil {
		next.CaseUnit = strings.TrimSpace(*req.CaseUnit)
		next.CaseSize = 0
		if req.CaseSize != nil {
			next.CaseSize = *req.CaseSize
		}
	} else if req.CaseSize != nil {
		next.CaseSize = *req.CaseSize
	}

	if next.PackUnit == "" {
		return packFields{}, nil
	}
	if len([]rune(next.PackUnit)) > 40 {
		return packFields{}, errors.New("pack unit is too long")
	}
	if !isFiniteIngredientNumber(next.PackSize) || next.PackSize <= 0 {
		return packFields{}, errors.New("pack size must be greater than zero")
	}
	if next.PackSize > maxIngredientQuantity {
		return packFields{}, errors.New("pack size is too large")
	}
	if err := purchaseUnitClashes(next.PackUnit, stockUnit); err != nil {
		return packFields{}, err
	}

	if next.CaseUnit == "" {
		next.CaseSize = 0
		return next, nil
	}
	if len([]rune(next.CaseUnit)) > 40 {
		return packFields{}, errors.New("case unit is too long")
	}
	if !isFiniteIngredientNumber(next.CaseSize) || next.CaseSize <= 0 {
		return packFields{}, errors.New("case size must be greater than zero")
	}
	if next.CaseSize > maxIngredientQuantity || next.CaseSize*next.PackSize > maxIngredientQuantity {
		return packFields{}, errors.New("case size is too large")
	}
	if sameUnit(next.CaseUnit, next.PackUnit) {
		return packFields{}, errors.New("case unit must differ from the pack unit")
	}
	if err := purchaseUnitClashes(next.CaseUnit, stockUnit); err != nil {
		return packFields{}, err
	}
	return next, nil
}

// purchaseUnitClashes refuses a purchase unit that already means something for
// this stock unit. "กิโลกรัม" as the pack of a gram shelf would be 1,000 by the
// unit table and whatever was typed by the pack, and the two would disagree.
func purchaseUnitClashes(purchaseUnit, stockUnit string) error {
	if sameUnit(purchaseUnit, stockUnit) {
		return errors.New("purchase unit must differ from the stock unit")
	}
	if _, ok := ConvertToStockUnit(1, purchaseUnit, stockUnit); ok {
		return errors.New("purchase unit already converts to the stock unit")
	}
	return nil
}

// openingStockFromRequest restates a new ingredient's opening stock in its own
// unit when it was typed in a purchase unit ("2 ลัง" of eggs kept by the ฟอง),
// and returns the "กรอก 2 ลัง" note the history row carries — the same note a
// restock entered in a pack gets, so the ledger shows how it was counted.
func openingStockFromRequest(quantity float64, enteredUnit, stockUnit string, packs packFields) (float64, string, error) {
	entered := strings.TrimSpace(enteredUnit)
	if entered == "" || sameUnit(entered, stockUnit) || quantity <= 0 {
		return quantity, "", nil
	}
	shape := &entity.Ingredient{Unit: stockUnit}
	packs.applyTo(shape)
	converted, ok := IngredientQuantityInStockUnit(quantity, entered, shape)
	if !ok {
		return 0, "", errors.New("stock unit cannot be converted to the ingredient unit")
	}
	if converted > maxIngredientQuantity {
		return 0, "", errors.New("stock value is too large")
	}
	return converted, noteWithEnteredUnit("", quantity, entered, stockUnit), nil
}
