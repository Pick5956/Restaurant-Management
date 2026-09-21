package service

import (
	"math"
	"testing"
	"time"

	"Project-M/internal/entity"
)

// Menu ids and categories used across these cases.
const (
	menuFriedRice uint = 1 // 50, category rice
	menuBasil     uint = 2 // 60, category rice
	menuCola      uint = 3 // 30, category drink
	menuLatte     uint = 4 // 60, category drink
	menuTea       uint = 5 // 40, category drink
	menuJuice     uint = 6 // 80, category drink
	catRice       uint = 10
	catDrink      uint = 20
)

var testCategories = map[uint][]uint{
	menuFriedRice: {catRice},
	menuBasil:     {catRice},
	menuCola:      {catDrink},
	menuLatte:     {catDrink},
	menuTea:       {catDrink},
	menuJuice:     {catDrink},
}

// Friday 18 Sep 2026, 12:00 Bangkok.
var lunch = time.Date(2026, 9, 18, 12, 0, 0, 0, bangkokLocation())

func uptr(v uint) *uint { return &v }

func menuTarget(group, quantity int, menuID uint) entity.PromotionTarget {
	return entity.PromotionTarget{GroupIndex: group, Quantity: quantity, MenuItemID: uptr(menuID)}
}

func categoryTarget(group, quantity int, categoryID uint) entity.PromotionTarget {
	return entity.PromotionTarget{GroupIndex: group, Quantity: quantity, CategoryID: uptr(categoryID)}
}

func promo(id uint, typ string, targets ...entity.PromotionTarget) entity.Promotion {
	p := entity.Promotion{Name: "promo", Type: typ, IsActive: true, DaysMask: entity.PromotionEveryDay, Targets: targets}
	p.ID = id
	return p
}

func line(itemID, menuID uint, price float64, quantity int) promotionLine {
	return promotionLine{OrderItemID: itemID, MenuID: menuID, UnitPrice: price, Quantity: quantity, OrderedAt: lunch}
}

func subtotalOf(lines []promotionLine) float64 {
	total := 0.0
	for _, l := range lines {
		total += l.UnitPrice * float64(l.Quantity)
	}
	return total
}

func evaluate(lines []promotionLine, promotions ...entity.Promotion) []appliedPromotion {
	return evaluatePromotions(lines, promotions, testCategories, subtotalOf(lines), lunch)
}

func totalDiscount(applied []appliedPromotion) float64 {
	total := 0.0
	for _, a := range applied {
		total += a.Amount
	}
	return math.Round(total*100) / 100
}

func assertDiscount(t *testing.T, applied []appliedPromotion, want float64) {
	t.Helper()
	if got := totalDiscount(applied); math.Abs(got-want) > 0.001 {
		t.Fatalf("discount = %.2f, want %.2f (applied: %+v)", got, want, applied)
	}
}

func TestBuyOneGetOneFreesTheSecondDish(t *testing.T) {
	p := promo(1, entity.PromotionTypeBuyXGetY, menuTarget(0, 1, menuFriedRice))
	p.BuyQuantity, p.GetQuantity = 1, 1

	applied := evaluate([]promotionLine{line(100, menuFriedRice, 50, 2)}, p)

	assertDiscount(t, applied, 50)
	if applied[0].Times != 1 {
		t.Fatalf("times = %d, want 1", applied[0].Times)
	}
}

func TestBuyOneGetOneLeavesAnOddDishAtFullPrice(t *testing.T) {
	p := promo(1, entity.PromotionTypeBuyXGetY, menuTarget(0, 1, menuFriedRice))
	p.BuyQuantity, p.GetQuantity = 1, 1

	assertDiscount(t, evaluate([]promotionLine{line(100, menuFriedRice, 50, 3)}, p), 50)
}

func TestBuyXGetYOnACategoryFreesTheCheapest(t *testing.T) {
	p := promo(1, entity.PromotionTypeBuyXGetY, categoryTarget(0, 1, catDrink))
	p.BuyQuantity, p.GetQuantity = 1, 1

	applied := evaluate([]promotionLine{line(100, menuCola, 30, 1), line(101, menuLatte, 60, 1)}, p)

	assertDiscount(t, applied, 30)
	if got := applied[0].ItemDiscounts[100]; got != 30 {
		t.Fatalf("the cola line should carry the free dish, got %.2f", got)
	}
	if got := applied[0].ItemDiscounts[101]; got != 0 {
		t.Fatalf("the latte line is paid in full, got discount %.2f", got)
	}
}

func TestBuyXGetYPairsDishesByPrice(t *testing.T) {
	// 80+60 give the 60 free, 40+30 give the 30 free: the dearest dish never
	// subsidises the cheapest one.
	p := promo(1, entity.PromotionTypeBuyXGetY, categoryTarget(0, 1, catDrink))
	p.BuyQuantity, p.GetQuantity = 1, 1
	lines := []promotionLine{
		line(100, menuJuice, 80, 1),
		line(101, menuLatte, 60, 1),
		line(102, menuTea, 40, 1),
		line(103, menuCola, 30, 1),
	}

	applied := evaluate(lines, p)

	assertDiscount(t, applied, 90)
	if applied[0].Times != 2 {
		t.Fatalf("times = %d, want 2", applied[0].Times)
	}
}

func TestBuyTwoGetOne(t *testing.T) {
	p := promo(1, entity.PromotionTypeBuyXGetY, menuTarget(0, 1, menuCola))
	p.BuyQuantity, p.GetQuantity = 2, 1

	assertDiscount(t, evaluate([]promotionLine{line(100, menuCola, 30, 3)}, p), 30)
	assertDiscount(t, evaluate([]promotionLine{line(100, menuCola, 30, 2)}, p), 0)
}

func TestPercentOffEveryTargetedDish(t *testing.T) {
	p := promo(1, entity.PromotionTypeItemDiscount, categoryTarget(0, 1, catDrink))
	p.DiscountKind, p.DiscountValue = entity.PromotionDiscountPercent, 20

	applied := evaluate([]promotionLine{line(100, menuLatte, 60, 2), line(101, menuFriedRice, 50, 1)}, p)

	assertDiscount(t, applied, 24)
	if applied[0].Times != 2 {
		t.Fatalf("times = %d, want 2", applied[0].Times)
	}
	if got := applied[0].ItemDiscounts[101]; got != 0 {
		t.Fatalf("fried rice is not a drink, got discount %.2f", got)
	}
}

func TestAmountOffNeverMakesADishNegative(t *testing.T) {
	p := promo(1, entity.PromotionTypeItemDiscount, menuTarget(0, 1, menuCola))
	p.DiscountKind, p.DiscountValue = entity.PromotionDiscountAmount, 50

	assertDiscount(t, evaluate([]promotionLine{line(100, menuCola, 30, 1)}, p), 30)
}

func TestBundleChargesTheSetPrice(t *testing.T) {
	p := promo(1, entity.PromotionTypeBundlePrice, categoryTarget(0, 1, catRice), categoryTarget(1, 1, catDrink))
	p.BundlePrice = 79

	applied := evaluate([]promotionLine{line(100, menuBasil, 60, 1), line(101, menuCola, 30, 1)}, p)

	assertDiscount(t, applied, 11)
	if got := applied[0].ItemDiscounts[100] + applied[0].ItemDiscounts[101]; math.Abs(got-11) > 0.001 {
		t.Fatalf("the set's discount must be spread over its dishes, got %.2f", got)
	}
}

func TestBundleNeedsEverySlot(t *testing.T) {
	p := promo(1, entity.PromotionTypeBundlePrice, categoryTarget(0, 1, catRice), categoryTarget(1, 1, catDrink))
	p.BundlePrice = 79

	assertDiscount(t, evaluate([]promotionLine{line(100, menuBasil, 60, 2)}, p), 0)
}

func TestBundleDearerThanItsDishesIsSkipped(t *testing.T) {
	p := promo(1, entity.PromotionTypeBundlePrice, categoryTarget(0, 1, catRice), categoryTarget(1, 1, catDrink))
	p.BundlePrice = 120

	assertDiscount(t, evaluate([]promotionLine{line(100, menuFriedRice, 50, 1), line(101, menuCola, 30, 1)}, p), 0)
}

func TestBundleSlotWithAQuantity(t *testing.T) {
	// "any three drinks for 100"
	p := promo(1, entity.PromotionTypeBundlePrice, categoryTarget(0, 3, catDrink))
	p.BundlePrice = 100

	assertDiscount(t, evaluate([]promotionLine{line(100, menuLatte, 60, 2), line(101, menuTea, 40, 1)}, p), 60)
}

// A large set with a small discount: each dish's proportional share rounds up,
// so the old "remainder on the last dish" went negative and was dropped, and
// the lines said 0.19 off while the bill said 0.10. The shares must add up to
// the set's discount exactly, never below zero and never above a dish's price.
func TestBundleSharesAlwaysAddUpToTheSetDiscount(t *testing.T) {
	p := promo(1, entity.PromotionTypeBundlePrice, categoryTarget(0, 20, catDrink))
	p.BundlePrice = 299.90

	applied := evaluate([]promotionLine{line(100, menuTea, 15, 20)}, p)

	assertDiscount(t, applied, 0.10)
	if got := applied[0].ItemDiscounts[100]; math.Abs(got-0.10) > 0.001 {
		t.Fatalf("line discount = %.2f, want the set's 0.10", got)
	}

	uneven := promo(2, entity.PromotionTypeBundlePrice, categoryTarget(0, 1, catRice), categoryTarget(1, 1, catDrink), categoryTarget(2, 1, catDrink))
	uneven.BundlePrice = 100
	applied = evaluate([]promotionLine{line(200, menuBasil, 60, 1), line(201, menuTea, 40, 1), line(202, menuCola, 30, 1)}, uneven)
	assertDiscount(t, applied, 30)
	sum := 0.0
	for itemID, share := range applied[0].ItemDiscounts {
		if share <= 0 {
			t.Fatalf("line %d got a share of %.2f", itemID, share)
		}
		sum += share
	}
	if math.Abs(sum-30) > 0.001 {
		t.Fatalf("shares add up to %.2f, want 30", sum)
	}
}

func TestADishTakesOnlyTheBestPromotionForTheCustomer(t *testing.T) {
	pair := promo(1, entity.PromotionTypeBuyXGetY, categoryTarget(0, 1, catDrink))
	pair.BuyQuantity, pair.GetQuantity = 1, 1
	percent := promo(2, entity.PromotionTypeItemDiscount, categoryTarget(0, 1, catDrink))
	percent.DiscountKind, percent.DiscountValue = entity.PromotionDiscountPercent, 20

	applied := evaluate([]promotionLine{line(100, menuLatte, 50, 2)}, pair, percent)

	// 1+1 saves 50; 20% would save 20. Not both.
	assertDiscount(t, applied, 50)
	if len(applied) != 1 || applied[0].PromotionID != 1 {
		t.Fatalf("expected only the 1+1 to apply, got %+v", applied)
	}
}

func TestLeftoverDishesStillTakeTheOtherPromotion(t *testing.T) {
	pair := promo(1, entity.PromotionTypeBuyXGetY, categoryTarget(0, 1, catDrink))
	pair.BuyQuantity, pair.GetQuantity = 1, 1
	percent := promo(2, entity.PromotionTypeItemDiscount, categoryTarget(0, 1, catDrink))
	percent.DiscountKind, percent.DiscountValue = entity.PromotionDiscountPercent, 10

	// Three lattes: one pair goes 1+1 (50 off), the third takes 10% (5 off).
	assertDiscount(t, evaluate([]promotionLine{line(100, menuLatte, 50, 3)}, pair, percent), 55)
}

func TestBillDiscountCountsTheBillAfterDishPromotions(t *testing.T) {
	pair := promo(1, entity.PromotionTypeBuyXGetY, menuTarget(0, 1, menuFriedRice))
	pair.BuyQuantity, pair.GetQuantity = 1, 1
	bill := promo(2, entity.PromotionTypeBillDiscount)
	bill.MinSubtotal, bill.DiscountKind, bill.DiscountValue = 500, entity.PromotionDiscountAmount, 50

	// 2 x 50 + 6 x 80 = 580; the pair takes 50 off, 530 is over 500.
	lines := []promotionLine{line(100, menuFriedRice, 50, 2), line(101, menuJuice, 80, 6)}
	assertDiscount(t, evaluate(lines, pair, bill), 100)

	// 2 x 50 + 5 x 80 = 500 before the pair, 450 after: under 500.
	short := []promotionLine{line(100, menuFriedRice, 50, 2), line(101, menuJuice, 80, 5)}
	assertDiscount(t, evaluate(short, pair, bill), 50)
}

func TestPercentBillDiscountHonoursItsCap(t *testing.T) {
	bill := promo(1, entity.PromotionTypeBillDiscount)
	bill.MinSubtotal, bill.DiscountKind, bill.DiscountValue, bill.MaxDiscount = 0, entity.PromotionDiscountPercent, 10, 30

	assertDiscount(t, evaluate([]promotionLine{line(100, menuJuice, 80, 5)}, bill), 30)
}

func TestOnlyTheBestBillDiscountApplies(t *testing.T) {
	small := promo(1, entity.PromotionTypeBillDiscount)
	small.MinSubtotal, small.DiscountKind, small.DiscountValue = 100, entity.PromotionDiscountAmount, 20
	big := promo(2, entity.PromotionTypeBillDiscount)
	big.MinSubtotal, big.DiscountKind, big.DiscountValue = 300, entity.PromotionDiscountAmount, 50

	assertDiscount(t, evaluate([]promotionLine{line(100, menuJuice, 80, 5)}, small, big), 50)
}

func TestInactivePromotionIsIgnored(t *testing.T) {
	p := promo(1, entity.PromotionTypeItemDiscount, menuTarget(0, 1, menuCola))
	p.DiscountKind, p.DiscountValue, p.IsActive = entity.PromotionDiscountAmount, 5, false

	assertDiscount(t, evaluate([]promotionLine{line(100, menuCola, 30, 1)}, p), 0)
}

func TestHappyHourCountsTheTimeEachDishWasOrdered(t *testing.T) {
	p := promo(1, entity.PromotionTypeItemDiscount, categoryTarget(0, 1, catDrink))
	p.DiscountKind, p.DiscountValue = entity.PromotionDiscountPercent, 50
	p.StartTime, p.EndTime = "14:00", "17:00"
	at := func(hour, minute int) time.Time { return time.Date(2026, 9, 18, hour, minute, 0, 0, bangkokLocation()) }

	lines := []promotionLine{
		{OrderItemID: 1, MenuID: menuCola, UnitPrice: 30, Quantity: 1, OrderedAt: at(13, 59)},
		{OrderItemID: 2, MenuID: menuCola, UnitPrice: 30, Quantity: 1, OrderedAt: at(14, 0)},
		{OrderItemID: 3, MenuID: menuCola, UnitPrice: 30, Quantity: 1, OrderedAt: at(16, 59)},
		{OrderItemID: 4, MenuID: menuCola, UnitPrice: 30, Quantity: 1, OrderedAt: at(17, 0)},
	}

	assertDiscount(t, evaluatePromotions(lines, []entity.Promotion{p}, testCategories, 120, at(17, 30)), 30)
}

func TestScheduleDatesAndDays(t *testing.T) {
	friday := time.Date(2026, 9, 18, 12, 0, 0, 0, bangkokLocation())
	cases := []struct {
		name  string
		setup func(*entity.Promotion)
		want  bool
	}{
		{"no limits", func(*entity.Promotion) {}, true},
		{"before the start date", func(p *entity.Promotion) { p.StartDate = "2026-09-19" }, false},
		{"on the start date", func(p *entity.Promotion) { p.StartDate = "2026-09-18" }, true},
		{"on the end date", func(p *entity.Promotion) { p.EndDate = "2026-09-18" }, true},
		{"after the end date", func(p *entity.Promotion) { p.EndDate = "2026-09-17" }, false},
		{"fridays only", func(p *entity.Promotion) { p.DaysMask = 1 << time.Friday }, true},
		{"weekends only", func(p *entity.Promotion) { p.DaysMask = 1<<time.Saturday | 1<<time.Sunday }, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := promo(1, entity.PromotionTypeItemDiscount)
			tc.setup(&p)
			if got := promotionRunsAt(&p, friday); got != tc.want {
				t.Fatalf("runs = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestLateNightWindowBelongsToTheNightItStarted(t *testing.T) {
	// Friday nights 22:00-02:00: 01:00 on Saturday is still Friday's night.
	p := promo(1, entity.PromotionTypeItemDiscount)
	p.DaysMask = 1 << time.Friday
	p.StartTime, p.EndTime = "22:00", "02:00"
	at := func(day, hour int) time.Time { return time.Date(2026, 9, day, hour, 0, 0, 0, bangkokLocation()) }

	if !promotionRunsAt(&p, at(18, 23)) {
		t.Fatal("Friday 23:00 is inside the window")
	}
	if !promotionRunsAt(&p, at(19, 1)) {
		t.Fatal("Saturday 01:00 belongs to Friday night")
	}
	if promotionRunsAt(&p, at(19, 23)) {
		t.Fatal("Saturday 23:00 is Saturday night, not a Friday")
	}
	if promotionRunsAt(&p, at(18, 12)) {
		t.Fatal("Friday noon is outside the window")
	}
}

func TestPromotionLinesSkipCancelledDishesAndIgnoreOptions(t *testing.T) {
	items := []entity.OrderItem{
		{MenuID: menuCola, UnitPrice: 30, OptionsTotal: 10, Quantity: 2, Status: entity.OrderItemStatusPending},
		{MenuID: menuLatte, UnitPrice: 60, Quantity: 1, Status: entity.OrderItemStatusCancelled},
	}
	items[0].ID, items[1].ID = 1, 2
	items[0].CreatedAt = lunch

	lines := promotionLinesFromItems(items)

	if len(lines) != 1 || lines[0].OrderItemID != 1 {
		t.Fatalf("a cancelled dish must not count toward a promotion, got %+v", lines)
	}
	if lines[0].UnitPrice != 30 {
		t.Fatalf("promotions discount the dish, not its paid options: unit price %.2f", lines[0].UnitPrice)
	}
}

func TestNoPromotionsNoDiscount(t *testing.T) {
	assertDiscount(t, evaluate([]promotionLine{line(100, menuCola, 30, 3)}), 0)
}
