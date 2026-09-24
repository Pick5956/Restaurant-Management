package service

import (
	"go/ast"
	"go/token"
	"go/types"
	"testing"
	"time"

	"Project-M/internal/entity"
)

const (
	mergeTestBeer     uint = 7
	mergeTestCocktail uint = 8
	mergeTestDrinks   uint = 3
	mergeTestFood     uint = 4
)

func mergeTestAt(day, hour, minute int) time.Time {
	return time.Date(2026, 9, day, hour, minute, 0, 0, bangkokLocation())
}

func mergeTestMenuTarget(menuID uint) entity.PromotionTarget {
	id := menuID
	return entity.PromotionTarget{MenuItemID: &id, Quantity: 1}
}

func mergeTestCategoryTarget(categoryID uint) entity.PromotionTarget {
	id := categoryID
	return entity.PromotionTarget{CategoryID: &id, Quantity: 1}
}

// mergeTestHappyHour is a 17:00-18:00 dish discount on beer.
func mergeTestHappyHour() entity.Promotion {
	return entity.Promotion{
		Type:          entity.PromotionTypeItemDiscount,
		IsActive:      true,
		DiscountKind:  entity.PromotionDiscountAmount,
		DiscountValue: 20,
		DaysMask:      entity.PromotionEveryDay,
		StartTime:     "17:00",
		EndTime:       "18:00",
		Targets:       []entity.PromotionTarget{mergeTestMenuTarget(mergeTestBeer)},
	}
}

// A dish added to an order folds into a matching pending line. The merged units
// take that line's stored price and its ordered time, and the promotion engine
// prices every unit of a line at that time, so a merge is only allowed when the
// new units would have cost exactly the same on a line of their own.
func TestMergeKeepsLinePricingOnlyWhenTheNewUnitsCostTheSame(t *testing.T) {
	at := mergeTestAt
	line := func(orderedAt time.Time) *entity.OrderItem {
		item := &entity.OrderItem{MenuID: mergeTestBeer, UnitPrice: 120, OptionsTotal: 15, Quantity: 1}
		item.CreatedAt = orderedAt
		return item
	}
	// Every promotion targets the beer unless the case says otherwise.
	promotion := func(kind string, edit func(*entity.Promotion)) entity.Promotion {
		p := entity.Promotion{
			Type:          kind,
			IsActive:      true,
			DiscountValue: 20,
			DaysMask:      entity.PromotionEveryDay,
			Targets:       []entity.PromotionTarget{mergeTestMenuTarget(mergeTestBeer)},
		}
		if edit != nil {
			edit(&p)
		}
		return p
	}
	happyHour := func(p *entity.Promotion) { p.StartTime, p.EndTime = "17:00", "19:00" }
	targeting := func(targets ...entity.PromotionTarget) func(*entity.Promotion) {
		return func(p *entity.Promotion) {
			happyHour(p)
			p.Targets = targets
		}
	}
	beerIsADrink := map[uint][]uint{mergeTestBeer: {mergeTestDrinks}}

	for _, tc := range []struct {
		name         string
		existing     *entity.OrderItem
		unitPrice    float64
		optionsTotal float64
		promotions   []entity.Promotion
		categories   map[uint][]uint
		now          time.Time
		want         bool
	}{
		{
			name:     "same prices and no promotions",
			existing: line(at(18, 12, 0)), unitPrice: 120, optionsTotal: 15,
			now: at(18, 12, 30), want: true,
		},
		{
			name:     "a float that differs by less than a satang is the same price",
			existing: line(at(18, 12, 0)), unitPrice: 120.001, optionsTotal: 15,
			now: at(18, 12, 30), want: true,
		},
		{
			name:     "menu price changed since the line was taken",
			existing: line(at(18, 12, 0)), unitPrice: 135, optionsTotal: 15,
			now: at(18, 12, 30), want: false,
		},
		{
			name:     "option price changed since the line was taken",
			existing: line(at(18, 12, 0)), unitPrice: 120, optionsTotal: 20,
			now: at(18, 12, 30), want: false,
		},
		{
			name:     "line taken in happy hour, more added after it ended",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeItemDiscount, happyHour)},
			now:        at(18, 19, 5), want: false,
		},
		{
			name:     "line taken before happy hour, more added once it began",
			existing: line(at(18, 16, 50)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeBuyXGetY, happyHour)},
			now:        at(18, 17, 10), want: false,
		},
		{
			name:     "both moments inside the same happy hour",
			existing: line(at(18, 17, 15)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeItemDiscount, happyHour)},
			now:        at(18, 18, 45), want: true,
		},
		{
			name:     "promotion's last date passed between the two adds",
			existing: line(at(18, 23, 50)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeBundlePrice, func(p *entity.Promotion) { p.EndDate = "2026-09-18" })},
			now:        at(19, 0, 10), want: false,
		},
		{
			name:     "a bill-level promotion is judged on the order, not the line",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeBillDiscount, happyHour)},
			now:        at(18, 19, 5), want: true,
		},
		{
			name:     "a switched-off promotion prices nothing",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeItemDiscount, func(p *entity.Promotion) {
				happyHour(p)
				p.IsActive = false
			})},
			now: at(18, 19, 5), want: true,
		},
		{
			name:     "a happy hour on another dish has no say over this one",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeItemDiscount, targeting(mergeTestMenuTarget(mergeTestCocktail)))},
			now:        at(18, 19, 5), want: true,
		},
		{
			name:     "a happy hour on the dish's category splits it",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeItemDiscount, targeting(mergeTestCategoryTarget(mergeTestDrinks)))},
			categories: beerIsADrink,
			now:        at(18, 19, 5), want: false,
		},
		{
			name:     "a happy hour on another category has no say over this one",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeItemDiscount, targeting(mergeTestCategoryTarget(mergeTestFood)))},
			categories: beerIsADrink,
			now:        at(18, 19, 5), want: true,
		},
		{
			name:     "a set with the dish in its second group splits it",
			existing: line(at(18, 18, 30)), unitPrice: 120, optionsTotal: 15,
			promotions: []entity.Promotion{promotion(entity.PromotionTypeBundlePrice, func(p *entity.Promotion) {
				happyHour(p)
				cocktail, beer := mergeTestMenuTarget(mergeTestCocktail), mergeTestMenuTarget(mergeTestBeer)
				beer.GroupIndex = 1
				p.Targets = []entity.PromotionTarget{cocktail, beer}
			})},
			now: at(18, 19, 5), want: false,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := mergeKeepsLinePricing(tc.existing, tc.unitPrice, tc.optionsTotal, tc.promotions, tc.categories, tc.now)
			if got != tc.want {
				t.Fatalf("mergeKeepsLinePricing = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestAnAddJoinsTheNewestLineThatSharesItsPrice replays the happy-hour evening
// that asking only the oldest matching line got wrong: a beer at 17:55 inside
// happy hour, one at 18:05 after it, then 18:10 and 18:12. The last two belong
// on the 18:05 line; they used to open a third and a fourth line because the
// 17:55 line was the only one asked.
func TestAnAddJoinsTheNewestLineThatSharesItsPrice(t *testing.T) {
	promotions := []entity.Promotion{mergeTestHappyHour()}
	order := &entity.Order{}
	nextID := uint(1)
	for _, addedAt := range []time.Time{
		mergeTestAt(18, 17, 55),
		mergeTestAt(18, 18, 5),
		mergeTestAt(18, 18, 10),
		mergeTestAt(18, 18, 12),
	} {
		lines := findMergeableOrderItems(order, mergeTestBeer, entity.OrderItemFulfillmentDineIn, "", nil)
		if joined := firstLineKeepingPricing(lines, 100, 0, promotions, nil, addedAt); joined != nil {
			joined.Quantity++
			continue
		}
		line := entity.OrderItem{
			MenuID:          mergeTestBeer,
			UnitPrice:       100,
			Quantity:        1,
			FulfillmentType: entity.OrderItemFulfillmentDineIn,
			Status:          entity.OrderItemStatusPending,
		}
		line.ID = nextID
		line.CreatedAt = addedAt
		nextID++
		order.Items = append(order.Items, line)
	}

	if len(order.Items) != 2 {
		t.Fatalf("expected the 17:55 line and the 18:05 line only, got %d lines", len(order.Items))
	}
	if got := order.Items[0].Quantity; got != 1 {
		t.Fatalf("the happy-hour line took %d beers, want 1", got)
	}
	if got := order.Items[1].Quantity; got != 3 {
		t.Fatalf("the 18:05 line took %d beers, want 3", got)
	}
}

// TestMergeableLinesComeNewestFirst: the newest matching line is asked first,
// and an older one still answers when the newer one does not share the price.
// A line with another note, or one the kitchen already has, is never a
// candidate.
func TestMergeableLinesComeNewestFirst(t *testing.T) {
	line := func(id uint, orderedAt time.Time, note, status string) entity.OrderItem {
		item := entity.OrderItem{
			MenuID:          mergeTestBeer,
			UnitPrice:       100,
			Quantity:        1,
			FulfillmentType: entity.OrderItemFulfillmentDineIn,
			Note:            note,
			Status:          status,
		}
		item.ID = id
		item.CreatedAt = orderedAt
		return item
	}
	order := &entity.Order{Items: []entity.OrderItem{
		line(1, mergeTestAt(18, 17, 55), "", entity.OrderItemStatusPending),
		line(2, mergeTestAt(18, 18, 5), "", entity.OrderItemStatusPending),
		line(3, mergeTestAt(18, 18, 6), "no ice", entity.OrderItemStatusPending),
		line(4, mergeTestAt(18, 18, 7), "", entity.OrderItemStatusCooking),
	}}

	lines := findMergeableOrderItems(order, mergeTestBeer, entity.OrderItemFulfillmentDineIn, "", nil)
	if len(lines) != 2 || lines[0].ID != 2 || lines[1].ID != 1 {
		ids := make([]uint, 0, len(lines))
		for _, candidate := range lines {
			ids = append(ids, candidate.ID)
		}
		t.Fatalf("candidates = %v, want [2 1]", ids)
	}

	promotions := []entity.Promotion{mergeTestHappyHour()}
	if joined := firstLineKeepingPricing(lines, 100, 0, promotions, nil, mergeTestAt(18, 18, 30)); joined == nil || joined.ID != 2 {
		t.Fatalf("after happy hour the add should join line 2, got %+v", joined)
	}
	// Inside happy hour only the 17:55 line shares the price, and it is still
	// found behind the newer line that does not.
	if joined := firstLineKeepingPricing(lines, 100, 0, promotions, nil, mergeTestAt(18, 17, 58)); joined == nil || joined.ID != 1 {
		t.Fatalf("inside happy hour the add should join line 1, got %+v", joined)
	}
	if joined := firstLineKeepingPricing(lines, 120, 0, promotions, nil, mergeTestAt(18, 18, 30)); joined != nil {
		t.Fatalf("at a new menu price no line shares the price, got line %d", joined.ID)
	}
}

// TestOptionsPriceOnMenu is what decides whether units raised onto a line with
// options still cost what the line costs.
func TestOptionsPriceOnMenu(t *testing.T) {
	option := func(id uint, price float64, active bool) entity.MenuOption {
		o := entity.MenuOption{PriceDelta: price, IsActive: active}
		o.ID = id
		return o
	}
	menu := &entity.MenuItem{OptionGroups: []entity.MenuOptionGroup{
		{IsActive: true, Options: []entity.MenuOption{option(1, 10, true), option(2, 15, true), option(3, 5, false)}},
		{IsActive: false, Options: []entity.MenuOption{option(4, 7, true)}},
	}}

	for _, tc := range []struct {
		name      string
		ids       []uint
		wantTotal float64
		wantOK    bool
	}{
		{"no options", nil, 0, true},
		{"offered options add up", []uint{1, 2}, 25, true},
		{"a repeated id counts once, as an add counts it", []uint{1, 1, 0}, 10, true},
		{"an option switched off is no longer offered", []uint{1, 3}, 0, false},
		{"an option in a switched-off group is no longer offered", []uint{4}, 0, false},
		{"an option gone from the menu is no longer offered", []uint{99}, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			total, ok := optionsPriceOnMenu(menu, tc.ids)
			if ok != tc.wantOK || !moneyEqual(total, tc.wantTotal) {
				t.Fatalf("optionsPriceOnMenu = (%v, %v), want (%v, %v)", total, ok, tc.wantTotal, tc.wantOK)
			}
		})
	}
}

func TestLineOptionIDsReadsTheLoadedLine(t *testing.T) {
	selected := func(id uint) entity.OrderItemOption { return entity.OrderItemOption{MenuOptionID: id} }
	first := entity.OrderItem{SelectedOptions: []entity.OrderItemOption{selected(5)}}
	first.ID = 1
	second := entity.OrderItem{SelectedOptions: []entity.OrderItemOption{selected(6), selected(9)}}
	second.ID = 2
	order := &entity.Order{Items: []entity.OrderItem{first, second}}

	got := lineOptionIDs(order, 2)
	if len(got) != 2 || got[0] != 6 || got[1] != 9 {
		t.Fatalf("lineOptionIDs = %v, want [6 9]", got)
	}
	if got := lineOptionIDs(order, 3); len(got) != 0 {
		t.Fatalf("a line not on the order carries no options, got %v", got)
	}
}

// TestAddItemMergesOnlyThroughThePricingCheck reads the call sites: the pricing
// check is only worth anything if AddItem cannot reach a mergeable line without
// it. Calling findMergeableOrderItems straight from AddItem, or asking only the
// oldest candidate again, fails here.
func TestAddItemMergesOnlyThroughThePricingCheck(t *testing.T) {
	assertCallers(t, "mergeablePendingLine", map[string]int{"OrderService.AddItem": 1, "placeRaisedUnits": 1})
	assertCallers(t, "findMergeableOrderItems", map[string]int{"mergeablePendingLine": 1})
	assertCallers(t, "firstLineKeepingPricing", map[string]int{"mergeablePendingLine": 1})
	assertCallers(t, "mergeKeepsLinePricing", map[string]int{"firstLineKeepingPricing": 1, "raiseStaysOnLine": 1})
	// Only a promotion that can price the dish may split its line.
	assertCallers(t, "promotionTargetsDish", map[string]int{"mergeKeepsLinePricing": 1})
}

// TestAnAddAfterHappyHourJoinsTheLineTakenBeforeIt: happy hour 18:00-19:00, a
// beer at 17:50 (line 1) and one at 18:10 (line 2). One more at 19:10 costs
// what line 1 costs and not what line 2 costs, so it joins line 1 - found only
// because line 1 is still asked after line 2 turns the add down. Handed the
// newest line alone, the add opens a third line.
func TestAnAddAfterHappyHourJoinsTheLineTakenBeforeIt(t *testing.T) {
	happyHour := mergeTestHappyHour()
	happyHour.StartTime, happyHour.EndTime = "18:00", "19:00"
	promotions := []entity.Promotion{happyHour}
	line := func(id uint, orderedAt time.Time) entity.OrderItem {
		item := entity.OrderItem{
			MenuID:          mergeTestBeer,
			UnitPrice:       100,
			Quantity:        1,
			FulfillmentType: entity.OrderItemFulfillmentDineIn,
			Status:          entity.OrderItemStatusPending,
		}
		item.ID = id
		item.CreatedAt = orderedAt
		return item
	}
	order := &entity.Order{Items: []entity.OrderItem{
		line(1, mergeTestAt(18, 17, 50)),
		line(2, mergeTestAt(18, 18, 10)),
	}}
	lines := findMergeableOrderItems(order, mergeTestBeer, entity.OrderItemFulfillmentDineIn, "", nil)
	addedAt := mergeTestAt(18, 19, 10)

	if joined := firstLineKeepingPricing(lines, 100, 0, promotions, nil, addedAt); joined == nil || joined.ID != 1 {
		t.Fatalf("the 19:10 add should join the 17:50 line, got %+v", joined)
	}
	if joined := firstLineKeepingPricing(lines[:1], 100, 0, promotions, nil, addedAt); joined != nil {
		t.Fatalf("the 18:10 line alone should turn the 19:10 add down, got line %d", joined.ID)
	}
}

// TestMergeablePendingLineAsksEveryCandidate reads the call behind the test
// above: firstLineKeepingPricing only reaches an older line if it is handed all
// of them, and mergeablePendingLine handing it lines[:1] passed every
// pure-logic test here. Its first argument has to be the variable
// findMergeableOrderItems filled, unsliced, and never written again.
func TestMergeablePendingLineAsksEveryCandidate(t *testing.T) {
	merge := packageFunction(t, "mergeablePendingLine")
	var filled *ast.AssignStmt
	var calls []*ast.CallExpr
	ast.Inspect(merge.Body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			if len(n.Rhs) == 1 && isCallTo(n.Rhs[0], "findMergeableOrderItems") {
				filled = n
			}
		case *ast.CallExpr:
			if isCallTo(n, "firstLineKeepingPricing") {
				calls = append(calls, n)
			}
		}
		return true
	})
	if filled == nil {
		t.Fatal("mergeablePendingLine does not keep what findMergeableOrderItems returns")
	}
	candidates, ok := filled.Lhs[0].(*ast.Ident)
	if !ok || candidates.Name == "_" {
		t.Fatal("mergeablePendingLine drops the lines findMergeableOrderItems returns")
	}
	if len(calls) != 1 || len(calls[0].Args) == 0 {
		t.Fatalf("mergeablePendingLine calls firstLineKeepingPricing %d times, want once", len(calls))
	}
	if passed, ok := calls[0].Args[0].(*ast.Ident); !ok || passed.Name != candidates.Name {
		t.Fatalf("firstLineKeepingPricing is handed something other than every candidate in %s", candidates.Name)
	}
	if writes := assignmentsTo(merge.Body, candidates.Name); len(writes) != 1 {
		t.Fatalf("%s is written %d times in mergeablePendingLine, want once", candidates.Name, len(writes))
	}
}

// TestRaisingALineGoesThroughThePricingCheck: raising a pending line's
// quantity used to give every new unit the line's stored price and ordered
// time. UpdateItem has to hand the raise to placeRaisedUnits, and the units it
// moves off the line go the way an add goes. Raising item.Quantity in
// UpdateItem without the call - the line this fix replaced - fails here.
func TestRaisingALineGoesThroughThePricingCheck(t *testing.T) {
	assertCallers(t, "placeRaisedUnits", map[string]int{"OrderService.UpdateItem": 1})
	assertCallers(t, "raiseStaysOnLine", map[string]int{"placeRaisedUnits": 1})
	assertCallers(t, "raisedLineQuantity", map[string]int{"placeRaisedUnits": 1})
	assertCallers(t, "raisePendingLine", map[string]int{"OrderService.AddItem": 1, "placeRaisedUnits": 1})
	assertCallers(t, "createOrderLine", map[string]int{"OrderService.AddItem": 1, "placeRaisedUnits": 1})
}

// TestPlaceRaisedUnitsReturnsWhatRaiseStaysOnLineDecided: UpdateItem saves the
// quantity placeRaisedUnits returns, so that quantity has to come from the
// answer raiseStaysOnLine gave. Returning raisedLineQuantity(item.Quantity,
// delta, true) after the units went to another line kept them on this one as
// well - 2 beers at 100, the price now 120, "+" billed 420 instead of 320 - and
// every other test stayed green. placeRaisedUnits ends in its one return of
// raisedLineQuantity(item.Quantity, delta, stays), stays is what
// raiseStaysOnLine returned and is never written again, every other return is
// an error's, and nothing in it writes item.Quantity or delta.
func TestPlaceRaisedUnitsReturnsWhatRaiseStaysOnLineDecided(t *testing.T) {
	place := packageFunction(t, "placeRaisedUnits")
	var decided *ast.AssignStmt
	var returns []*ast.ReturnStmt
	ast.Inspect(place.Body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			if len(n.Rhs) == 1 && isCallTo(n.Rhs[0], "raiseStaysOnLine") {
				decided = n
			}
		case *ast.ReturnStmt:
			returns = append(returns, n)
		}
		return true
	})
	if decided == nil {
		t.Fatal("placeRaisedUnits does not keep what raiseStaysOnLine returns")
	}
	stays, ok := decided.Lhs[0].(*ast.Ident)
	if !ok || stays.Name == "_" {
		t.Fatal("placeRaisedUnits drops the answer raiseStaysOnLine gives")
	}
	if writes := writesTo(place.Body, func(expr ast.Expr) bool { return isIdent(expr, stays.Name) }); writes != 1 {
		t.Fatalf("%s is written %d times in placeRaisedUnits, want once", stays.Name, writes)
	}
	if writes := writesTo(place.Body, func(expr ast.Expr) bool { return isIdent(expr, "delta") }); writes != 0 {
		t.Fatalf("delta is written %d times in placeRaisedUnits, want never", writes)
	}
	if writes := writesTo(place.Body, func(expr ast.Expr) bool { return isFieldOf(expr, "item", "Quantity") }); writes != 0 {
		t.Fatalf("item.Quantity is written %d times in placeRaisedUnits, want never", writes)
	}

	statements := place.Body.List
	last, ok := statements[len(statements)-1].(*ast.ReturnStmt)
	if !ok || len(last.Results) != 2 || !isCallTo(last.Results[0], "raisedLineQuantity") {
		t.Fatal("placeRaisedUnits does not end in a return of raisedLineQuantity")
	}
	quantity := last.Results[0].(*ast.CallExpr)
	args := quantity.Args
	if len(args) != 3 || !isFieldOf(args[0], "item", "Quantity") || !isIdent(args[1], "delta") || !isIdent(args[2], stays.Name) {
		t.Fatalf("placeRaisedUnits returns %s, want raisedLineQuantity(item.Quantity, delta, %s)", types.ExprString(quantity), stays.Name)
	}
	if last.Pos() < decided.End() {
		t.Fatal("placeRaisedUnits returns before raiseStaysOnLine answers")
	}
	for _, other := range returns {
		if other == last {
			continue
		}
		if len(other.Results) != 2 || !isIdent(other.Results[1], "err") {
			t.Fatal("placeRaisedUnits returns without an error before its last return; the quantity leaves by that one only")
		}
		if zero, ok := other.Results[0].(*ast.BasicLit); !ok || zero.Value != "0" {
			t.Fatalf("placeRaisedUnits returns %s beside an error, want 0", types.ExprString(other.Results[0]))
		}
	}

	// The units leave the line only when raiseStaysOnLine said they do not stay,
	// and the return above keeps them only when they do. Moved under `stays`, or
	// under `!stays || delta > 0`, a raise at the line's own price went to
	// another line and stayed on this one too: 2 beers at 100, "+" to 3 billed
	// 4 beers. Every call that moves the units sits under one outermost if, whose
	// whole condition is !stays.
	var moveGuard *ast.IfStmt
	for _, name := range []string{"validateSelectedMenuOptions", "mergeablePendingLine", "raisePendingLine", "createOrderLine"} {
		move := callIn(place.Body, name)
		if move == nil {
			t.Fatalf("placeRaisedUnits no longer calls %s to move the units", name)
		}
		guard := outermostIfAround(place.Body, move)
		if want := "!" + stays.Name; guard == nil || condText(guard) != want {
			t.Fatalf("placeRaisedUnits calls %s under %s, want only under %s", name, condText(guard), want)
		}
		if moveGuard != nil && guard != moveGuard {
			t.Fatalf("placeRaisedUnits calls %s under an if of its own, want every move under the one !%s", name, stays.Name)
		}
		moveGuard = guard
	}
}

// outermostIfAround is the furthest-out if statement in body whose block holds
// node, or nil.
func outermostIfAround(body ast.Node, node ast.Node) *ast.IfStmt {
	var found *ast.IfStmt
	ast.Inspect(body, func(child ast.Node) bool {
		if found != nil {
			return false
		}
		stmt, ok := child.(*ast.IfStmt)
		if ok && stmt.Body.Pos() <= node.Pos() && node.End() <= stmt.Body.End() {
			found = stmt
		}
		return found == nil
	})
	return found
}

// TestRaisedLineQuantity: a raised line keeps the new units only when they
// stay on it. Kept there after they went to another line, they were billed on
// both.
func TestRaisedLineQuantity(t *testing.T) {
	if got := raisedLineQuantity(2, 3, true); got != 5 {
		t.Fatalf("units that stay on the line: quantity %d, want 5", got)
	}
	if got := raisedLineQuantity(2, 3, false); got != 2 {
		t.Fatalf("units placed on another line: quantity %d, want 2", got)
	}
}

// TestUpdateItemSavesTheQuantityPlaceRaisedUnitsReturns: when a raise's units
// go to another line, the raised line keeps its quantity. UpdateItem used to
// learn that from a flag and correct qty in an `if` of its own; deleting that
// `if` saved the line at the requested quantity AND put the units elsewhere -
// the guest paid for them twice - and every test stayed green. placeRaisedUnits
// now returns the line's quantity, and this holds UpdateItem to it: the result
// is assigned (not redeclared inside the if) to the variable item.Quantity is
// saved from, nothing writes that variable in between, and item.Quantity is
// set nowhere else. The line's subtotal is counted from that same quantity
// (or item.Quantity after it): counted from req.Quantity, the units placed on
// another line were priced on this one too.
func TestUpdateItemSavesTheQuantityPlaceRaisedUnitsReturns(t *testing.T) {
	update := packageFunction(t, "OrderService.UpdateItem")
	var placed *ast.AssignStmt
	var saves, subtotals []*ast.AssignStmt
	ast.Inspect(update.Body, func(node ast.Node) bool {
		assign, ok := node.(*ast.AssignStmt)
		if !ok {
			return true
		}
		if len(assign.Rhs) == 1 && isCallTo(assign.Rhs[0], "placeRaisedUnits") {
			placed = assign
		}
		for _, lhs := range assign.Lhs {
			if isFieldOf(lhs, "item", "Quantity") {
				saves = append(saves, assign)
			}
			if isFieldOf(lhs, "item", "Subtotal") {
				subtotals = append(subtotals, assign)
			}
		}
		return true
	})
	if placed == nil {
		t.Fatal("UpdateItem does not assign what placeRaisedUnits returns")
	}
	kept, ok := placed.Lhs[0].(*ast.Ident)
	if !ok || kept.Name == "_" {
		t.Fatal("UpdateItem drops the quantity placeRaisedUnits returns")
	}
	if placed.Tok != token.ASSIGN {
		t.Fatalf("UpdateItem redeclares %s with the quantity placeRaisedUnits returns; the save after the if never sees it", kept.Name)
	}
	if len(saves) != 1 || len(saves[0].Lhs) != 1 {
		t.Fatalf("item.Quantity is assigned %d times in UpdateItem, want once", len(saves))
	}
	save := saves[0]
	if saved, ok := save.Rhs[0].(*ast.Ident); !ok || saved.Name != kept.Name || save.Pos() < placed.End() {
		t.Fatalf("item.Quantity is not saved from %s after placeRaisedUnits returns it", kept.Name)
	}

	if len(subtotals) != 1 || len(subtotals[0].Lhs) != 1 {
		t.Fatalf("item.Subtotal is assigned %d times in UpdateItem, want once", len(subtotals))
	}
	priced := subtotals[0]
	if priced.Pos() < save.End() {
		t.Fatal("item.Subtotal is counted before item.Quantity is saved")
	}
	var counted []ast.Expr
	ast.Inspect(priced.Rhs[0], func(node ast.Node) bool {
		if call, ok := node.(*ast.CallExpr); ok && isIdent(call.Fun, "float64") && len(call.Args) == 1 {
			counted = append(counted, call.Args[0])
		}
		return true
	})
	if len(counted) != 1 || !(isIdent(counted[0], kept.Name) || isFieldOf(counted[0], "item", "Quantity")) {
		t.Fatalf("item.Subtotal = %s, want it counted once, from %s or item.Quantity",
			types.ExprString(priced.Rhs[0]), kept.Name)
	}

	for _, write := range assignmentsTo(update.Body, kept.Name) {
		if write != placed && write.Pos() > placed.End() && write.Pos() < priced.Pos() {
			t.Fatalf("%s is written again between placeRaisedUnits and the line's save", kept.Name)
		}
	}
}

// TestSameOptionIDs: the mobile editor sends the line's options with every
// edit, so an edit's options are "changed" only as a different set. Order, a
// repeated id and a 0 do not make a set different - validateSelectedMenuOptions
// reads a request the same way.
func TestSameOptionIDs(t *testing.T) {
	for _, tc := range []struct {
		name      string
		requested []uint
		current   []uint
		want      bool
	}{
		{"none sent on a line without options", []uint{}, nil, true},
		{"the line's own options", []uint{5, 9}, []uint{5, 9}, true},
		{"the same options in another order", []uint{9, 5}, []uint{5, 9}, true},
		{"a repeated id and a 0 count for nothing", []uint{5, 0, 9, 5}, []uint{5, 9}, true},
		{"one option swapped for another", []uint{5, 7}, []uint{5, 9}, false},
		{"an option added", []uint{5, 9, 7}, []uint{5, 9}, false},
		{"an option taken off", []uint{5}, []uint{5, 9}, false},
		{"every option cleared", []uint{}, []uint{5}, false},
		{"options on a line without any", []uint{5}, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameOptionIDs(tc.requested, tc.current); got != tc.want {
				t.Fatalf("sameOptionIDs(%v, %v) = %v, want %v", tc.requested, tc.current, got, tc.want)
			}
		})
	}
}

// TestUpdateItemReadsTheMenuOnlyForARaiseOrNewOptions: a decrease sells none
// of the dish, so it never needs the menu. But the mobile editor sends the
// line's options with every edit, and UpdateItem loaded the menu whenever
// options were sent, so lowering a pending line of a dish deleted since
// failed with "menu item not found". The options count as changed only when
// sameOptionIDs finds them different from the line's own (lineOptionIDs); the
// menu is loaded for that or for a raise, and the options are rewritten for
// that alone. Keying either `if` back on req.SelectedOptionIDs being sent
// fails here.
func TestUpdateItemReadsTheMenuOnlyForARaiseOrNewOptions(t *testing.T) {
	assertCallers(t, "sameOptionIDs", map[string]int{"OrderService.UpdateItem": 1})
	update := packageFunction(t, "OrderService.UpdateItem")
	var current, compared *ast.AssignStmt
	var comparison *ast.CallExpr
	var menuLoads, optionChecks []*ast.CallExpr
	ast.Inspect(update.Body, func(node ast.Node) bool {
		switch n := node.(type) {
		case *ast.AssignStmt:
			if len(n.Rhs) == 1 && isCallTo(n.Rhs[0], "lineOptionIDs") {
				current = n
			}
			if len(n.Rhs) == 1 && callIn(n.Rhs[0], "sameOptionIDs") != nil {
				compared, comparison = n, callIn(n.Rhs[0], "sameOptionIDs")
			}
		case *ast.CallExpr:
			if selector, ok := n.Fun.(*ast.SelectorExpr); ok && selector.Sel.Name == "FindMenuItem" {
				menuLoads = append(menuLoads, n)
			}
			if isCallTo(n, "validateSelectedMenuOptions") {
				optionChecks = append(optionChecks, n)
			}
		}
		return true
	})
	if current == nil || compared == nil || len(menuLoads) != 1 || len(optionChecks) != 1 {
		t.Fatalf("UpdateItem should read the line's options, compare them, and load the menu and check new options once each; found %d loads and %d checks",
			len(menuLoads), len(optionChecks))
	}
	menuLoad, optionCheck := menuLoads[0], optionChecks[0]
	lineOptions, ok := current.Lhs[0].(*ast.Ident)
	if !ok || lineOptions.Name == "_" {
		t.Fatal("UpdateItem drops the line's own options")
	}
	changed, ok := compared.Lhs[0].(*ast.Ident)
	if !ok || changed.Name == "_" {
		t.Fatal("UpdateItem drops what sameOptionIDs answers")
	}
	if len(comparison.Args) != 2 || !isIdent(comparison.Args[1], lineOptions.Name) || compared.Pos() < current.End() {
		t.Fatalf("sameOptionIDs is not asked about the line's own options in %s", lineOptions.Name)
	}
	sent, ok := comparison.Args[0].(*ast.StarExpr)
	if !ok || !isFieldOf(sent.X, "req", "SelectedOptionIDs") {
		t.Fatalf("sameOptionIDs compares %s, want *req.SelectedOptionIDs", types.ExprString(comparison.Args[0]))
	}
	for _, write := range assignmentsTo(update.Body, lineOptions.Name) {
		if write != current && write.Pos() < compared.Pos() {
			t.Fatalf("%s is written before sameOptionIDs reads it", lineOptions.Name)
		}
	}
	if writes := writesTo(update.Body, func(expr ast.Expr) bool { return isIdent(expr, changed.Name) }); writes != 1 {
		t.Fatalf("%s is written %d times in UpdateItem, want once", changed.Name, writes)
	}
	// The whole flag, not just its parts. Without the `!` a swapped option
	// counted as unchanged and the line kept charging the old one; without the
	// nil check an edit that sends no options dereferenced nil.
	if got, want := types.ExprString(compared.Rhs[0]),
		"req.SelectedOptionIDs != nil && !sameOptionIDs(*req.SelectedOptionIDs, "+lineOptions.Name+")"; got != want {
		t.Fatalf("UpdateItem sets %s = %s, want %s", changed.Name, got, want)
	}

	// Loaded for anything more, a decrease of a dish deleted since failed again;
	// loaded for less, new options or a raise went unpriced.
	load := innermostIfAround(update.Body, menuLoad)
	if want := changed.Name + " || delta > 0"; load == nil || condText(load) != want {
		t.Fatalf("UpdateItem loads the menu under %s, want it under %s", condText(load), want)
	}
	rewrite := innermostIfAround(update.Body, optionCheck)
	if rewrite == nil || !isIdent(rewrite.Cond, changed.Name) {
		t.Fatalf("UpdateItem rewrites the options under %s, want only when %s", condText(rewrite), changed.Name)
	}

	// Once the snapshots carry the new options, lineOptions has to say so too:
	// it is what placeRaisedUnits prices a raise with. Left on the old options,
	// an edit that swapped an option and raised the line in one go sent the new
	// units to a line with the option the guest just took off, at its price.
	var adopted *ast.AssignStmt
	for _, stmt := range rewrite.Body.List {
		if assign, ok := stmt.(*ast.AssignStmt); ok && len(assign.Lhs) == 1 && isIdent(assign.Lhs[0], lineOptions.Name) {
			adopted = assign
		}
	}
	if adopted == nil || adopted.Tok != token.ASSIGN || len(adopted.Rhs) != 1 ||
		types.ExprString(adopted.Rhs[0]) != "*req.SelectedOptionIDs" {
		t.Fatalf("the if %s block does not set %s = *req.SelectedOptionIDs", changed.Name, lineOptions.Name)
	}
	for _, name := range []string{"createItemOptionSnapshots", "snapshotRecipeForOrderItem"} {
		snapshot := callIn(rewrite.Body, name)
		if snapshot == nil {
			t.Fatalf("the if %s block no longer calls %s", changed.Name, name)
		}
		if adopted.Pos() < snapshot.End() {
			t.Fatalf("%s takes the new options before %s rewrites the line's snapshot", lineOptions.Name, name)
		}
	}
	if writes := writesTo(update.Body, func(expr ast.Expr) bool { return isIdent(expr, lineOptions.Name) }); writes != 2 {
		t.Fatalf("%s is written %d times in UpdateItem, want twice: read off the line, then the new options", lineOptions.Name, writes)
	}
}

// TestRaiseStaysOnLine: an increase is more of the dish sold, whichever line
// the units land on. So a dish taken off sale refuses it at the line's own
// price as well as at a new one - it used to be raised in place while an add
// of the same dish was refused. (A dish deleted from the menu is refused
// before this, by UpdateItem's menu lookup.) An available dish stays on the
// line only at the line's own price with its options still offered.
func TestRaiseStaysOnLine(t *testing.T) {
	line := &entity.OrderItem{MenuID: mergeTestBeer, UnitPrice: 100, Quantity: 2}
	line.CreatedAt = mergeTestAt(18, 12, 0)
	menu := func(price float64, available bool) *entity.MenuItem {
		item := &entity.MenuItem{Price: price, IsAvailable: available}
		item.ID = mergeTestBeer
		return item
	}
	now := mergeTestAt(18, 12, 30)

	for _, tc := range []struct {
		name      string
		menu      *entity.MenuItem
		optionIDs []uint
		wantStays bool
		wantErr   bool
	}{
		{name: "the line's own price stays on the line", menu: menu(100, true), wantStays: true},
		{name: "a new price goes to another line", menu: menu(120, true), wantStays: false},
		{name: "an option no longer offered goes to another line", menu: menu(100, true), optionIDs: []uint{99}, wantStays: false},
		{name: "off sale at the line's own price is refused", menu: menu(100, false), wantErr: true},
		{name: "off sale at a new price is refused", menu: menu(120, false), wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			stays, err := raiseStaysOnLine(line, tc.menu, tc.optionIDs, nil, nil, now)
			if tc.wantErr {
				if err == nil || err.Error() != "menu item is unavailable" {
					t.Fatalf("raiseStaysOnLine = (%v, %v), want the unavailable refusal", stays, err)
				}
				return
			}
			if err != nil || stays != tc.wantStays {
				t.Fatalf("raiseStaysOnLine = (%v, %v), want (%v, nil)", stays, err, tc.wantStays)
			}
		})
	}
}
