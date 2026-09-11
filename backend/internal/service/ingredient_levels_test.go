package service

import "testing"

// The owner's own worked example, day by day: 10 kg of rice, used down, topped
// up by one. The maximum must not follow the stock downward, because the
// reorder level hangs off it.
func TestTheMaximumClimbsWithTheShelfAndNeverFalls(t *testing.T) {
	const warnAt = 20.0 // percent

	days := []struct {
		what      string
		nextStock float64
		wantMax   float64
		wantMin   float64
	}{
		{"bought 10 in", 10, 10, 2},
		{"used 4", 6, 10, 2},
		{"topped up by 1", 7, 10, 2},
		{"used 2", 5, 10, 2},
		{"topped up by 1", 6, 10, 2},
		{"a full delivery", 20, 20, 4},
	}

	levels := stockLevels{Stock: 0, MaxStock: 0, MinStock: 0}
	for _, day := range days {
		levels = levelsAfterStockChange(day.nextStock, levels.MaxStock, levels.MinStock, warnAt)
		if levels.MaxStock != day.wantMax {
			t.Errorf("%s: max = %v, want %v", day.what, levels.MaxStock, day.wantMax)
		}
		if levels.MinStock != day.wantMin {
			t.Errorf("%s: reorder level = %v, want %v", day.what, levels.MinStock, day.wantMin)
		}
	}
}

func TestTakingStockOutLeavesTheMaximumAlone(t *testing.T) {
	levels := levelsAfterStockChange(2, 10, 2, 20)
	if levels.MaxStock != 10 {
		t.Errorf("max = %v, want it left at 10 — an empty shelf is not a smaller shelf", levels.MaxStock)
	}
	if levels.Stock != 2 {
		t.Errorf("stock = %v, want 2", levels.Stock)
	}
}

// Without a percentage the ingredient keeps the quantity someone typed. This is
// the path every ingredient is on until the slider is touched, so a restock
// must not quietly rewrite the number they set.
func TestAnIngredientWithNoPercentageKeepsItsTypedReorderLevel(t *testing.T) {
	levels := levelsAfterStockChange(50, 10, 1463.46, 0)
	if levels.MinStock != 1463.46 {
		t.Errorf("reorder level = %v, want the typed 1463.46 kept", levels.MinStock)
	}
	if levels.MaxStock != 50 {
		t.Errorf("max = %v, want 50 — the maximum still climbs", levels.MaxStock)
	}
}

func TestTheReorderLevelIsHeldToFourDecimals(t *testing.T) {
	// A third of an awkward maximum: 1000.0001 x 33.3333% is 333.33303...,
	// which the column stores as 333.3330. Anything longer would be a number
	// that reads back differently from the one that was written.
	got := reorderLevelFrom(1000.0001, 33.3333, 0)
	if got != 333.333 {
		t.Errorf("reorder level = %v, want 333.333", got)
	}
}

func TestAPercentageOverAHundredIsCappedRatherThanTrusted(t *testing.T) {
	if got := reorderLevelFrom(10, 250, 0); got != 10 {
		t.Errorf("reorder level = %v, want the whole shelf at most", got)
	}
}

func TestANewIngredientStartsWithAMaximumThatCoversItsReorderLevel(t *testing.T) {
	if got := startingMaxStock(0, 500); got != 500 {
		t.Errorf("starting max = %v, want 500 — a maximum under the minimum puts the mark off the bar", got)
	}
	if got := startingMaxStock(2000, 500); got != 2000 {
		t.Errorf("starting max = %v, want 2000", got)
	}
}
