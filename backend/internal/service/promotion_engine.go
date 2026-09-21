package service

import (
	"math"
	"sort"
	"time"

	"Project-M/internal/entity"
)

// The promotion engine is pure: order lines and promotion rules in, the
// discounts they earn out. recalcOrderTotals runs it every time an order's
// dishes change, so web POS, the mobile app and the customer QR page always
// agree on a price - there is one place a promotion is worked out.
//
// Rules, in plain terms:
//   - A dish counts toward one dish-level promotion at most. When two could
//     take the same dish, the one saving the customer more goes first.
//   - "Buy X get Y" frees the cheapest dishes of each group, after sorting the
//     eligible dishes from dearest to cheapest, so the dearest dish never
//     subsidises the cheapest one.
//   - Discounts come off the dish's own price. Paid options stay charged.
//   - A promotion with hours counts the time each dish was ordered, so a dish
//     ordered in happy hour keeps its price after happy hour ends.
//   - The bill-level promotion, one at most, works on what is left after the
//     dish-level ones.

// promotionLine is one order line as the promotion engine sees it.
type promotionLine struct {
	OrderItemID uint
	MenuID      uint
	UnitPrice   float64
	Quantity    int
	OrderedAt   time.Time
}

// appliedPromotion is one promotion's effect on one order.
type appliedPromotion struct {
	PromotionID uint
	Name        string
	Type        string
	Times       int
	Amount      float64
	// ItemDiscounts is what this promotion took off each order line, keyed by
	// order item id. Bill-level promotions leave it empty.
	ItemDiscounts map[uint]float64
}

// promotionLinesFromItems turns order items into engine lines. Cancelled dishes
// never earn a promotion.
func promotionLinesFromItems(items []entity.OrderItem) []promotionLine {
	lines := make([]promotionLine, 0, len(items))
	for _, item := range items {
		if item.Status == entity.OrderItemStatusCancelled || item.Quantity <= 0 {
			continue
		}
		orderedAt := item.CreatedAt
		if orderedAt.IsZero() {
			orderedAt = time.Now()
		}
		lines = append(lines, promotionLine{
			OrderItemID: item.ID,
			MenuID:      item.MenuID,
			UnitPrice:   item.UnitPrice,
			Quantity:    item.Quantity,
			OrderedAt:   orderedAt,
		})
	}
	return lines
}

// promotionRunsAt reports whether the promotion's schedule covers the moment.
func promotionRunsAt(p *entity.Promotion, at time.Time) bool {
	at = at.In(bangkokLocation())
	day := at
	if p.StartTime != "" && p.EndTime != "" {
		clock := at.Format("15:04")
		if p.StartTime < p.EndTime {
			if clock < p.StartTime || clock >= p.EndTime {
				return false
			}
		} else {
			switch {
			case clock >= p.StartTime:
				// The evening part belongs to today.
			case clock < p.EndTime:
				// After midnight: still the night that began yesterday.
				day = at.AddDate(0, 0, -1)
			default:
				return false
			}
		}
	}
	date := day.Format("2006-01-02")
	if p.StartDate != "" && date < p.StartDate {
		return false
	}
	if p.EndDate != "" && date > p.EndDate {
		return false
	}
	mask := p.DaysMask
	if mask <= 0 {
		mask = entity.PromotionEveryDay
	}
	return mask&(1<<uint(day.Weekday())) != 0
}

type promotionUnit struct {
	line  int
	price float64
	at    time.Time
	menu  uint
	used  bool
}

type promotionGroup struct {
	quantity int
	targets  []*entity.PromotionTarget
}

type promotionCandidate struct {
	promo    int
	units    []int
	perUnit  []float64
	discount float64
}

type promotionRun struct {
	lines      []promotionLine
	units      []promotionUnit
	promos     []*entity.Promotion
	groups     [][]promotionGroup
	eligible   [][][]int // promo -> group -> unit indexes that match and ran when ordered
	categories map[uint][]uint
}

func evaluatePromotions(
	lines []promotionLine,
	promotions []entity.Promotion,
	categoriesByMenu map[uint][]uint,
	orderSubtotal float64,
	openedAt time.Time,
) []appliedPromotion {
	var itemPromos, billPromos []*entity.Promotion
	for i := range promotions {
		p := &promotions[i]
		if !p.IsActive {
			continue
		}
		switch p.Type {
		case entity.PromotionTypeBuyXGetY:
			if p.BuyQuantity >= 1 && p.GetQuantity >= 1 && len(p.Targets) > 0 {
				itemPromos = append(itemPromos, p)
			}
		case entity.PromotionTypeItemDiscount:
			if p.DiscountValue > 0 && len(p.Targets) > 0 {
				itemPromos = append(itemPromos, p)
			}
		case entity.PromotionTypeBundlePrice:
			if len(p.Targets) > 0 {
				itemPromos = append(itemPromos, p)
			}
		case entity.PromotionTypeBillDiscount:
			if p.DiscountValue > 0 {
				billPromos = append(billPromos, p)
			}
		}
	}
	sort.SliceStable(itemPromos, func(i, j int) bool { return itemPromos[i].ID < itemPromos[j].ID })
	sort.SliceStable(billPromos, func(i, j int) bool { return billPromos[i].ID < billPromos[j].ID })

	run := newPromotionRun(lines, itemPromos, categoriesByMenu)
	byPromotion := map[uint]*appliedPromotion{}
	var order []uint
	for {
		best := run.bestCandidate()
		if best == nil {
			break
		}
		p := run.promos[best.promo]
		applied, ok := byPromotion[p.ID]
		if !ok {
			applied = &appliedPromotion{
				PromotionID:   p.ID,
				Name:          p.Name,
				Type:          p.Type,
				ItemDiscounts: map[uint]float64{},
			}
			byPromotion[p.ID] = applied
			order = append(order, p.ID)
		}
		applied.Times++
		applied.Amount = roundMoney(applied.Amount + best.discount)
		for k, unit := range best.units {
			run.units[unit].used = true
			if best.perUnit[k] > 0 {
				itemID := run.lines[run.units[unit].line].OrderItemID
				applied.ItemDiscounts[itemID] = roundMoney(applied.ItemDiscounts[itemID] + best.perUnit[k])
			}
		}
	}

	results := make([]appliedPromotion, 0, len(order)+1)
	itemTotal := 0.0
	for _, id := range order {
		results = append(results, *byPromotion[id])
		itemTotal += byPromotion[id].Amount
	}
	if bill := bestBillPromotion(billPromos, roundMoney(orderSubtotal-itemTotal), openedAt); bill != nil {
		results = append(results, *bill)
	}
	return results
}

func newPromotionRun(lines []promotionLine, promos []*entity.Promotion, categories map[uint][]uint) *promotionRun {
	run := &promotionRun{lines: lines, promos: promos, categories: categories}
	for lineIndex, l := range lines {
		for q := 0; q < l.Quantity; q++ {
			run.units = append(run.units, promotionUnit{line: lineIndex, price: l.UnitPrice, at: l.OrderedAt, menu: l.MenuID})
		}
	}
	run.groups = make([][]promotionGroup, len(promos))
	run.eligible = make([][][]int, len(promos))
	for pi, p := range promos {
		groups := groupsOf(p)
		run.groups[pi] = groups
		run.eligible[pi] = make([][]int, len(groups))
		for gi, group := range groups {
			for ui, unit := range run.units {
				if unit.price <= 0 || !run.matches(group, unit) || !promotionRunsAt(p, unit.at) {
					continue
				}
				run.eligible[pi][gi] = append(run.eligible[pi][gi], ui)
			}
		}
	}
	return run
}

// groupsOf returns a promotion's target groups in order. Only a bundle has more
// than one; the other dish-level types read every target as one group.
func groupsOf(p *entity.Promotion) []promotionGroup {
	if p.Type != entity.PromotionTypeBundlePrice {
		group := promotionGroup{quantity: 1}
		for i := range p.Targets {
			group.targets = append(group.targets, &p.Targets[i])
		}
		return []promotionGroup{group}
	}
	byIndex := map[int]*promotionGroup{}
	var indexes []int
	for i := range p.Targets {
		t := &p.Targets[i]
		group, ok := byIndex[t.GroupIndex]
		if !ok {
			quantity := t.Quantity
			if quantity < 1 {
				quantity = 1
			}
			group = &promotionGroup{quantity: quantity}
			byIndex[t.GroupIndex] = group
			indexes = append(indexes, t.GroupIndex)
		}
		group.targets = append(group.targets, t)
	}
	sort.Ints(indexes)
	groups := make([]promotionGroup, 0, len(indexes))
	for _, index := range indexes {
		groups = append(groups, *byIndex[index])
	}
	return groups
}

func (run *promotionRun) matches(group promotionGroup, unit promotionUnit) bool {
	for _, t := range group.targets {
		if t.MenuItemID != nil && *t.MenuItemID == unit.menu {
			return true
		}
		if t.CategoryID != nil {
			for _, category := range run.categories[unit.menu] {
				if category == *t.CategoryID {
					return true
				}
			}
		}
	}
	return false
}

// available returns the unused eligible units of one group, dearest first.
func (run *promotionRun) available(pi, gi int, taken map[int]bool) []int {
	var out []int
	for _, ui := range run.eligible[pi][gi] {
		if !run.units[ui].used && !taken[ui] {
			out = append(out, ui)
		}
	}
	sort.SliceStable(out, func(a, b int) bool { return run.units[out[a]].price > run.units[out[b]].price })
	return out
}

func (run *promotionRun) bestCandidate() *promotionCandidate {
	var best *promotionCandidate
	for pi, p := range run.promos {
		var candidate *promotionCandidate
		switch p.Type {
		case entity.PromotionTypeItemDiscount:
			candidate = run.itemDiscountCandidate(pi)
		case entity.PromotionTypeBuyXGetY:
			candidate = run.buyXGetYCandidate(pi)
		case entity.PromotionTypeBundlePrice:
			candidate = run.bundleCandidate(pi)
		}
		if candidate == nil || candidate.discount < 0.01 {
			continue
		}
		if best == nil || candidate.discount > best.discount+0.0001 {
			best = candidate
		}
	}
	return best
}

func (run *promotionRun) itemDiscountCandidate(pi int) *promotionCandidate {
	p := run.promos[pi]
	var best *promotionCandidate
	for _, ui := range run.available(pi, 0, nil) {
		price := run.units[ui].price
		discount := p.DiscountValue
		if p.DiscountKind == entity.PromotionDiscountPercent {
			discount = price * p.DiscountValue / 100
		} else if p.DiscountKind != entity.PromotionDiscountAmount {
			return nil
		}
		if discount > price {
			discount = price
		}
		discount = roundMoney(discount)
		if best == nil || discount > best.discount+0.0001 {
			best = &promotionCandidate{promo: pi, units: []int{ui}, perUnit: []float64{discount}, discount: discount}
		}
	}
	return best
}

func (run *promotionRun) buyXGetYCandidate(pi int) *promotionCandidate {
	p := run.promos[pi]
	size := p.BuyQuantity + p.GetQuantity
	available := run.available(pi, 0, nil)
	if len(available) < size {
		return nil
	}
	chunk := available[:size]
	candidate := &promotionCandidate{promo: pi, units: chunk, perUnit: make([]float64, size)}
	for k := p.BuyQuantity; k < size; k++ {
		price := run.units[chunk[k]].price
		candidate.perUnit[k] = price
		candidate.discount += price
	}
	candidate.discount = roundMoney(candidate.discount)
	return candidate
}

func (run *promotionRun) bundleCandidate(pi int) *promotionCandidate {
	p := run.promos[pi]
	taken := map[int]bool{}
	var units []int
	sum := 0.0
	for gi, group := range run.groups[pi] {
		available := run.available(pi, gi, taken)
		if len(available) < group.quantity {
			return nil
		}
		for _, ui := range available[:group.quantity] {
			taken[ui] = true
			units = append(units, ui)
			sum += run.units[ui].price
		}
	}
	discount := roundMoney(sum - p.BundlePrice)
	if discount <= 0 || sum <= 0 {
		return nil
	}
	return &promotionCandidate{promo: pi, units: units, perUnit: run.spreadBySatang(units, discount, sum), discount: discount}
}

// spreadBySatang splits a set's discount over its dishes in proportion to their
// prices, in whole satang, so the parts add up to the discount exactly. Each
// dish takes its share rounded down, and the satang left over go one each to
// the dishes whose share lost the most to rounding (largest remainder). No
// share can go below zero or above its dish's price, because the discount is
// always less than the sum of the prices.
func (run *promotionRun) spreadBySatang(units []int, discount, sum float64) []float64 {
	total := int64(math.Round(discount * 100))
	shares := make([]int64, len(units))
	order := make([]int, len(units))
	fractions := make([]float64, len(units))
	given := int64(0)
	for k, ui := range units {
		exact := float64(total) * run.units[ui].price / sum
		shares[k] = int64(math.Floor(exact))
		fractions[k] = exact - float64(shares[k])
		given += shares[k]
		order[k] = k
	}
	sort.SliceStable(order, func(a, b int) bool { return fractions[order[a]] > fractions[order[b]] })
	for i := int64(0); i < total-given && i < int64(len(order)); i++ {
		shares[order[i]]++
	}
	perUnit := make([]float64, len(units))
	for k, share := range shares {
		perUnit[k] = float64(share) / 100
	}
	return perUnit
}

// bestBillPromotion picks the one bill-level promotion that saves the most on
// what is left after the dish-level promotions.
func bestBillPromotion(promos []*entity.Promotion, net float64, openedAt time.Time) *appliedPromotion {
	if net <= 0 {
		return nil
	}
	var best *appliedPromotion
	for _, p := range promos {
		if !promotionRunsAt(p, openedAt) || net+0.0001 < p.MinSubtotal {
			continue
		}
		var discount float64
		switch p.DiscountKind {
		case entity.PromotionDiscountPercent:
			discount = net * p.DiscountValue / 100
			if p.MaxDiscount > 0 && discount > p.MaxDiscount {
				discount = p.MaxDiscount
			}
		case entity.PromotionDiscountAmount:
			discount = p.DiscountValue
		default:
			continue
		}
		if discount > net {
			discount = net
		}
		discount = roundMoney(discount)
		if discount < 0.01 {
			continue
		}
		if best == nil || discount > best.Amount+0.0001 {
			best = &appliedPromotion{PromotionID: p.ID, Name: p.Name, Type: p.Type, Times: 1, Amount: discount}
		}
	}
	return best
}
