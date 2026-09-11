package service

import "math"

// The three numbers that move together on one shelf: how much is there, the
// most that shelf has ever been proved to hold, and the level that triggers a
// reorder.
//
// The owner's rule, in their own words: every restock sets the maximum. What
// they asked for first also let it fall — 5 kg on the shelf plus 1 kg in makes
// a maximum of 6 — and that quietly moves the alarm. A shop that tops up in
// small amounts would be warned later and later at the same percentage: rice
// set to "warn at 20%" would call for 2.0 kg one week and 1.2 kg the next,
// without anyone asking for that. So the maximum only ever climbs. A shelf that
// once held 10 kg can hold 10 kg; a 1 kg top-up does not make it smaller.
//
// The reorder level is kept as a percentage of that maximum rather than as a
// fixed quantity, which is the point of the whole exercise: when the shop
// starts buying in larger loads the maximum follows, and the reorder level
// follows with it instead of being left behind at a number someone typed once.
type stockLevels struct {
	Stock    float64
	MaxStock float64
	MinStock float64
}

// levelsAfterStockChange settles all three after the stock has moved.
//
// A movement is evidence, not an instruction: whatever the shelf is holding now
// is proof it can hold that much, so any level above the current maximum raises
// it. Taking stock out proves nothing about capacity and leaves it alone. That
// one comparison covers a restock and a physical count alike — neither needs a
// special case, because both are just the shelf reaching a level.
func levelsAfterStockChange(nextStock, currentMax, currentMin, minPercent float64) stockLevels {
	maxStock := math.Max(currentMax, nextStock)
	if !isFiniteIngredientNumber(maxStock) || maxStock < 0 {
		maxStock = 0
	}
	return stockLevels{
		Stock:    roundStockValue(nextStock),
		MaxStock: roundStockValue(maxStock),
		MinStock: reorderLevelFrom(maxStock, minPercent, currentMin),
	}
}

// reorderLevelFrom turns a percentage of the maximum into the quantity the rest
// of the system reads.
//
// Everything downstream — the "low stock" badge, the CSV, the reports, the
// assistant's fact sheet — asks for min_stock as a quantity, and there are
// around twenty such readers. Rather than teach all of them about percentages,
// the percentage is the source of truth and the quantity is recomputed from it
// whenever the maximum moves. An ingredient with no percentage set keeps
// whatever quantity was typed for it, untouched.
func reorderLevelFrom(maxStock, minPercent, fallback float64) float64 {
	if !isFiniteIngredientNumber(minPercent) || minPercent <= 0 {
		return roundStockValue(fallback)
	}
	if minPercent > 100 {
		minPercent = 100
	}
	return roundStockValue(maxStock * minPercent / 100)
}

// roundStockValue holds a number to the four decimals the column stores, so a
// value read back is the same value that was written rather than one that has
// drifted a fraction through repeated multiplication.
func roundStockValue(value float64) float64 {
	if !isFiniteIngredientNumber(value) {
		return 0
	}
	if value < 0 {
		return 0
	}
	return math.Round(value*10000) / 10000
}

// percentOr reads an optional percentage: absent means the ingredient keeps
// the one it already has.
func percentOr(requested *float64, current float64) float64 {
	if requested == nil {
		return current
	}
	return *requested
}

// startingMaxStock is the maximum a brand new ingredient begins with: whatever
// it was created holding, and never below its own reorder level — a maximum
// under the minimum would put the reorder mark past the end of the bar.
func startingMaxStock(stock, minStock float64) float64 {
	return roundStockValue(math.Max(math.Max(stock, minStock), 0))
}
