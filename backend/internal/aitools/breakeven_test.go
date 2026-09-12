package aitools

import "testing"

func TestComputeBreakevenDividesByTheMarginNotTheDays(t *testing.T) {
	// 30 days, revenue 100,000 with ingredient cost 30,800 (30.8%), expenses
	// 41,798.39 — the live figures the wrong answer was given from.
	got := ComputeBreakeven(100000, 30800, 41798.39, 40, 30)
	if !got.HasSales || !got.Computable {
		t.Fatalf("flags = %+v", got)
	}
	if !near(got.CostRatio, 0.308) || !near(got.MarginRatio, 0.692) {
		t.Fatalf("ratios = cost %.4f margin %.4f", got.CostRatio, got.MarginRatio)
	}
	if !near(got.ExpensePerDay, 1393.28) {
		t.Fatalf("ExpensePerDay = %.2f", got.ExpensePerDay)
	}
	// The assistant answered 1,393. The revenue that covers 1,393 of expenses
	// at a 69.2% margin is 2,013.
	if got.BreakevenPerDay < 2013 || got.BreakevenPerDay > 2014 {
		t.Fatalf("BreakevenPerDay = %.2f, want ≈ 2013.4", got.BreakevenPerDay)
	}
	if !near(got.BreakevenTotal, 41798.39/0.692) {
		t.Fatalf("BreakevenTotal = %.2f", got.BreakevenTotal)
	}
	// 3,333.33 sold per day keeps 2,306.67, minus 1,393.28 of bills = 913.39.
	if !near(got.NetPerDay, 100000.0/30*0.692-1393.28) {
		t.Fatalf("NetPerDay = %.2f", got.NetPerDay)
	}
}

func TestComputeBreakevenGuards(t *testing.T) {
	if got := ComputeBreakeven(0, 0, 5000, 3, 10); got.HasSales || got.Computable || !near(got.ExpensePerDay, 500) {
		t.Fatalf("no sales: %+v", got)
	}
	// Cost above revenue: nothing covers anything.
	if got := ComputeBreakeven(1000, 1200, 500, 1, 5); !got.HasSales || got.Computable || got.BreakevenPerDay != 0 {
		t.Fatalf("negative margin: %+v", got)
	}
	if got := ComputeBreakeven(1000, 300, 0, 0, 0); got.Days != 1 {
		t.Fatalf("days floor: %+v", got)
	}
}

func TestRevenueForTargetProfit(t *testing.T) {
	// Wanting 60,000 profit in a month with 41,798.39 of bills at 69.2% margin.
	got := RevenueForTargetProfit(60000, 41798.39, 0.692)
	if !near(got, (60000+41798.39)/0.692) {
		t.Fatalf("got %.2f", got)
	}
	if RevenueForTargetProfit(1000, 1000, 0) != 0 {
		t.Fatal("zero margin must not divide")
	}
}
