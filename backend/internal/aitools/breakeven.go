package aitools

// AIBreakeven is what the shop has to sell in a day for the gross profit on
// those sales to cover the day's recorded expenses.
//
// The arithmetic is the one the assistant got wrong. Asked "วันนึงต้องขายให้ได้
// เท่าไหร่ถึงจะคุ้มค่าใช้จ่าย" it divided the expenses by the days and answered
// 1,393 — which is the expense per day, not the revenue that covers it: every
// baht sold first loses its ingredient cost, so the revenue needed is the
// expense divided by what is left of each baht after that cost.
type AIBreakeven struct {
	Days           int
	Revenue        float64
	Cost           float64
	CostRatio      float64 // ingredient cost as a fraction of revenue
	MarginRatio    float64 // 1 - CostRatio: what each baht of sales keeps
	Expenses       float64
	ExpenseEntries int64
	ExpensePerDay  float64
	RevenuePerDay  float64 // what the shop actually sold per day
	// BreakevenPerDay is ExpensePerDay / MarginRatio. BreakevenTotal is the
	// same for the whole window.
	BreakevenPerDay float64
	BreakevenTotal  float64
	// NetPerDay is RevenuePerDay*MarginRatio - ExpensePerDay: what a day left
	// over after ingredients and bills, on average.
	NetPerDay float64
	HasSales  bool
	// Computable is false when the margin is zero or negative: no amount of
	// selling covers anything, and dividing by it would say so as infinity.
	Computable bool
}

// ComputeBreakeven takes the window's paid revenue, its ingredient cost, the
// expenses recorded for it, and the number of days it spans.
func ComputeBreakeven(revenue, cost, expenses float64, entries int64, days int) AIBreakeven {
	if days < 1 {
		days = 1
	}
	out := AIBreakeven{
		Days:           days,
		Revenue:        revenue,
		Cost:           cost,
		Expenses:       expenses,
		ExpenseEntries: entries,
		ExpensePerDay:  expenses / float64(days),
		RevenuePerDay:  revenue / float64(days),
	}
	if revenue <= 0 {
		return out
	}
	out.HasSales = true
	out.CostRatio = cost / revenue
	out.MarginRatio = 1 - out.CostRatio
	if out.MarginRatio <= 0 {
		return out
	}
	out.Computable = true
	out.BreakevenPerDay = out.ExpensePerDay / out.MarginRatio
	out.BreakevenTotal = expenses / out.MarginRatio
	out.NetPerDay = out.RevenuePerDay*out.MarginRatio - out.ExpensePerDay
	return out
}

// RevenueForTargetProfit is the sales needed in a period so that, after
// ingredient cost and the period's expenses, the wanted profit is left:
// (profit + expenses) / margin. Zero when the margin cannot carry it.
func RevenueForTargetProfit(profit, expenses, marginRatio float64) float64 {
	if marginRatio <= 0 {
		return 0
	}
	return (profit + expenses) / marginRatio
}
