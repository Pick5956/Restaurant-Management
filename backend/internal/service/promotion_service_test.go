package service

import (
	"math"
	"strings"
	"testing"

	"Project-M/internal/entity"
)

func uintRef(v uint) *uint { return &v }

func menuInput(group, quantity int, id uint) PromotionTargetRequest {
	return PromotionTargetRequest{GroupIndex: group, Quantity: quantity, MenuItemID: uintRef(id)}
}

func categoryInput(group, quantity int, id uint) PromotionTargetRequest {
	return PromotionTargetRequest{GroupIndex: group, Quantity: quantity, CategoryID: uintRef(id)}
}

func mustNormalize(t *testing.T, req PromotionRequest) *entity.Promotion {
	t.Helper()
	promotion, err := normalizePromotion(&req)
	if err != nil {
		t.Fatalf("normalizePromotion: %v", err)
	}
	return promotion
}

func mustReject(t *testing.T, req PromotionRequest, why string) {
	t.Helper()
	if _, err := normalizePromotion(&req); err == nil {
		t.Fatalf("expected an error: %s", why)
	}
}

func TestPromotionBuyXGetYIsCleanedUp(t *testing.T) {
	p := mustNormalize(t, PromotionRequest{
		Name:          "  ชาเย็น 1 แถม 1  ",
		Type:          entity.PromotionTypeBuyXGetY,
		BuyQuantity:   1,
		GetQuantity:   1,
		DiscountKind:  entity.PromotionDiscountPercent,
		DiscountValue: 50,
		BundlePrice:   99,
		MinSubtotal:   300,
		Targets:       []PromotionTargetRequest{menuInput(4, 9, 3), categoryInput(2, 1, 20)},
	})
	if p.Name != "ชาเย็น 1 แถม 1" {
		t.Fatalf("name = %q", p.Name)
	}
	if !p.IsActive {
		t.Fatal("a new promotion without is_active should start switched on")
	}
	if p.DaysMask != entity.PromotionEveryDay {
		t.Fatalf("days mask = %d, want every day", p.DaysMask)
	}
	if p.DiscountKind != "" || p.DiscountValue != 0 || p.BundlePrice != 0 || p.MinSubtotal != 0 {
		t.Fatalf("fields another type uses should be cleared: %+v", p)
	}
	if len(p.Targets) != 2 {
		t.Fatalf("targets = %d, want 2", len(p.Targets))
	}
	for _, target := range p.Targets {
		if target.GroupIndex != 0 || target.Quantity != 1 {
			t.Fatalf("buy X get Y targets are one group of single dishes, got %+v", target)
		}
	}
}

func TestPromotionSwitchedOffStaysOff(t *testing.T) {
	off := false
	p := mustNormalize(t, PromotionRequest{
		Name: "ปิดไว้", Type: entity.PromotionTypeItemDiscount, IsActive: &off,
		DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 10,
		Targets: []PromotionTargetRequest{menuInput(0, 1, 1)},
	})
	if p.IsActive {
		t.Fatal("is_active false must be kept")
	}
}

func TestPromotionRejectsBadBasics(t *testing.T) {
	valid := func() PromotionRequest {
		return PromotionRequest{
			Name: "ลด 10%", Type: entity.PromotionTypeItemDiscount,
			DiscountKind: entity.PromotionDiscountPercent, DiscountValue: 10,
			Targets: []PromotionTargetRequest{menuInput(0, 1, 1)},
		}
	}
	mustNormalize(t, valid())

	req := valid()
	req.Name = "   "
	mustReject(t, req, "blank name")

	req = valid()
	req.Name = strings.Repeat("ก", 121)
	mustReject(t, req, "name over 120 characters")

	req = valid()
	req.Type = "free_lunch"
	mustReject(t, req, "unknown type")

	req = valid()
	req.DiscountValue = 101
	mustReject(t, req, "percent over 100")

	req = valid()
	req.DiscountValue = 0
	mustReject(t, req, "zero discount")

	req = valid()
	req.DiscountValue = math.NaN()
	mustReject(t, req, "NaN discount")

	req = valid()
	req.DiscountKind = "half"
	mustReject(t, req, "unknown discount kind")

	req = valid()
	req.Targets = nil
	mustReject(t, req, "a dish promotion with no dishes")
}

func TestPromotionTargetsNeedExactlyOneSubject(t *testing.T) {
	base := PromotionRequest{
		Name: "ลด", Type: entity.PromotionTypeItemDiscount,
		DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 5,
	}
	both := base
	both.Targets = []PromotionTargetRequest{{MenuItemID: uintRef(1), CategoryID: uintRef(2)}}
	mustReject(t, both, "menu item and category on one target")

	neither := base
	neither.Targets = []PromotionTargetRequest{{}}
	mustReject(t, neither, "target with no subject")

	zero := base
	zero.Targets = []PromotionTargetRequest{{MenuItemID: uintRef(0)}}
	mustReject(t, zero, "menu item id 0")
}

func TestPromotionDuplicateTargetsCollapse(t *testing.T) {
	p := mustNormalize(t, PromotionRequest{
		Name: "ลด", Type: entity.PromotionTypeItemDiscount,
		DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 5,
		Targets: []PromotionTargetRequest{menuInput(0, 1, 1), menuInput(0, 1, 1), categoryInput(0, 1, 1)},
	})
	if len(p.Targets) != 2 {
		t.Fatalf("targets = %d, want 2 (menu 1 once, category 1 once)", len(p.Targets))
	}
}

func TestPromotionBundleGroupsAreRenumberedInOrder(t *testing.T) {
	p := mustNormalize(t, PromotionRequest{
		Name: "ข้าว + น้ำ", Type: entity.PromotionTypeBundlePrice, BundlePrice: 79,
		Targets: []PromotionTargetRequest{
			categoryInput(7, 1, 10),
			menuInput(3, 1, 3),
			menuInput(3, 1, 5),
		},
	})
	want := []struct {
		group int
		menu  bool
	}{{0, false}, {1, true}, {1, true}}
	if len(p.Targets) != len(want) {
		t.Fatalf("targets = %d, want %d", len(p.Targets), len(want))
	}
	for i, w := range want {
		if p.Targets[i].GroupIndex != w.group || (p.Targets[i].MenuItemID != nil) != w.menu {
			t.Fatalf("target %d = %+v, want group %d", i, p.Targets[i], w.group)
		}
	}
}

func TestPromotionBundleNeedsTwoDishesAndOneQuantityPerSlot(t *testing.T) {
	single := PromotionRequest{
		Name: "ชุดเดียว", Type: entity.PromotionTypeBundlePrice, BundlePrice: 50,
		Targets: []PromotionTargetRequest{menuInput(0, 1, 1)},
	}
	mustReject(t, single, "a bundle of one dish is a price change, not a set")

	three := PromotionRequest{
		Name: "น้ำ 3 แก้ว 100", Type: entity.PromotionTypeBundlePrice, BundlePrice: 100,
		Targets: []PromotionTargetRequest{categoryInput(0, 3, 20)},
	}
	if p := mustNormalize(t, three); p.Targets[0].Quantity != 3 {
		t.Fatalf("slot quantity = %d, want 3", p.Targets[0].Quantity)
	}

	mixed := PromotionRequest{
		Name: "ปนกัน", Type: entity.PromotionTypeBundlePrice, BundlePrice: 100,
		Targets: []PromotionTargetRequest{menuInput(0, 2, 1), menuInput(0, 1, 2)},
	}
	mustReject(t, mixed, "one slot cannot ask for two different quantities")

	free := three
	free.BundlePrice = 0
	mustReject(t, free, "a bundle needs a price")
}

func TestPromotionBillDiscountDropsTargets(t *testing.T) {
	p := mustNormalize(t, PromotionRequest{
		Name: "ครบ 500 ลด 10%", Type: entity.PromotionTypeBillDiscount,
		DiscountKind: entity.PromotionDiscountPercent, DiscountValue: 10, MaxDiscount: 100, MinSubtotal: 500,
		Targets: []PromotionTargetRequest{menuInput(0, 1, 1)},
	})
	if len(p.Targets) != 0 {
		t.Fatal("a bill discount covers the whole bill and keeps no dishes")
	}
	if p.MaxDiscount != 100 || p.MinSubtotal != 500 {
		t.Fatalf("max/min = %v/%v", p.MaxDiscount, p.MinSubtotal)
	}

	amount := mustNormalize(t, PromotionRequest{
		Name: "ครบ 300 ลด 30", Type: entity.PromotionTypeBillDiscount,
		DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 30, MaxDiscount: 100, MinSubtotal: 300,
	})
	if amount.MaxDiscount != 0 {
		t.Fatal("a cap only means something on a percent discount")
	}

	mustReject(t, PromotionRequest{
		Name: "ติดลบ", Type: entity.PromotionTypeBillDiscount,
		DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 30, MinSubtotal: -1,
	}, "negative minimum bill")
}

func TestPromotionScheduleValidation(t *testing.T) {
	valid := func() PromotionRequest {
		return PromotionRequest{
			Name: "happy hour", Type: entity.PromotionTypeItemDiscount,
			DiscountKind: entity.PromotionDiscountAmount, DiscountValue: 10,
			Targets:   []PromotionTargetRequest{categoryInput(0, 1, 20)},
			StartDate: "2026-09-01", EndDate: "2026-09-30",
			DaysMask:  0b0111110,
			StartTime: "14:00", EndTime: "17:00",
		}
	}
	p := mustNormalize(t, valid())
	if p.DaysMask != 0b0111110 || p.StartTime != "14:00" || p.EndDate != "2026-09-30" {
		t.Fatalf("schedule not kept: %+v", p)
	}

	overnight := valid()
	overnight.StartTime, overnight.EndTime = "22:00", "02:00"
	mustNormalize(t, overnight)

	for why, change := range map[string]func(*PromotionRequest){
		"end date before start date": func(r *PromotionRequest) { r.StartDate, r.EndDate = "2026-09-30", "2026-09-01" },
		"not a date":                 func(r *PromotionRequest) { r.StartDate = "2026-02-30" },
		"days above the week":        func(r *PromotionRequest) { r.DaysMask = 128 },
		"negative days":              func(r *PromotionRequest) { r.DaysMask = -1 },
		"start time only":            func(r *PromotionRequest) { r.EndTime = "" },
		"same start and end":         func(r *PromotionRequest) { r.EndTime = "14:00" },
		"not a time":                 func(r *PromotionRequest) { r.StartTime = "25:00" },
		"time without leading zero":  func(r *PromotionRequest) { r.StartTime = "9:00" },
	} {
		req := valid()
		change(&req)
		mustReject(t, req, why)
	}
}

func TestPromotionBuyXGetYNeedsBothQuantities(t *testing.T) {
	base := PromotionRequest{
		Name: "1 แถม 1", Type: entity.PromotionTypeBuyXGetY,
		BuyQuantity: 1, GetQuantity: 1,
		Targets: []PromotionTargetRequest{menuInput(0, 1, 1)},
	}
	noFree := base
	noFree.GetQuantity = 0
	mustReject(t, noFree, "nothing free")

	noBuy := base
	noBuy.BuyQuantity = 0
	mustReject(t, noBuy, "nothing bought")

	huge := base
	huge.BuyQuantity = 100
	mustReject(t, huge, "buy quantity out of range")
}
