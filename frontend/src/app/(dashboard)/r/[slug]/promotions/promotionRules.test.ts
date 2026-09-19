import { describe, expect, it } from "vitest";
import type { Promotion } from "@/src/lib/promotion";
import {
  EVERY_DAY,
  emptyPromotionForm,
  formToPromotionInput,
  promotionFormProblems,
  promotionRuleSummary,
  promotionRunsAt,
  promotionScheduleSummary,
  promotionStateAt,
  promotionTargetsSummary,
  promotionToForm,
  type PromotionForm,
} from "./promotionRules";

function promotion(overrides: Partial<Promotion> = {}): Promotion {
  return {
    ID: 1,
    name: "โปร",
    type: "buy_x_get_y",
    is_active: true,
    start_date: "",
    end_date: "",
    days_mask: EVERY_DAY,
    start_time: "",
    end_time: "",
    buy_quantity: 1,
    get_quantity: 1,
    discount_kind: "",
    discount_value: 0,
    bundle_price: 0,
    min_subtotal: 0,
    max_discount: 0,
    targets: [],
    ...overrides,
  };
}

const menuNames = new Map([[1, "ข้าวผัด"], [2, "กะเพรา"], [3, "ชาเย็น"]]);
const categoryNames = new Map([[20, "เครื่องดื่ม"]]);
const names = { menu: (id: number) => menuNames.get(id), category: (id: number) => categoryNames.get(id) };

// 2026-09-18 is a Friday. Bangkok is UTC+7 all year.
const bangkok = (date: string, clock: string) => new Date(`${date}T${clock}:00+07:00`);

function form(overrides: Partial<PromotionForm>): PromotionForm {
  return { ...emptyPromotionForm(), name: "โปร", ...overrides };
}

describe("formToPromotionInput", () => {
  it("sends a buy-X-get-Y as one group of single dishes and nothing another type uses", () => {
    const input = formToPromotionInput(form({
      type: "buy_x_get_y",
      buyQuantity: 2,
      getQuantity: 1,
      discountValue: 50,
      bundlePrice: 99,
      minSubtotal: 300,
      targets: [{ kind: "menu", id: 3 }, { kind: "category", id: 20 }],
    }));
    expect(input).toMatchObject({ type: "buy_x_get_y", buy_quantity: 2, get_quantity: 1, discount_kind: "", discount_value: 0, bundle_price: 0, min_subtotal: 0 });
    expect(input.targets).toEqual([
      { group_index: 0, quantity: 1, menu_item_id: 3, category_id: null },
      { group_index: 0, quantity: 1, menu_item_id: null, category_id: 20 },
    ]);
  });

  it("numbers bundle slots in order and carries each slot's quantity", () => {
    const input = formToPromotionInput(form({
      type: "bundle_price",
      bundlePrice: 79,
      slots: [
        { quantity: 1, targets: [{ kind: "menu", id: 1 }, { kind: "menu", id: 2 }] },
        { quantity: 2, targets: [{ kind: "category", id: 20 }] },
      ],
    }));
    expect(input.bundle_price).toBe(79);
    expect(input.targets).toEqual([
      { group_index: 0, quantity: 1, menu_item_id: 1, category_id: null },
      { group_index: 0, quantity: 1, menu_item_id: 2, category_id: null },
      { group_index: 1, quantity: 2, menu_item_id: null, category_id: 20 },
    ]);
  });

  it("sends a bill discount without dishes, and a cap only for a percent", () => {
    const percent = formToPromotionInput(form({ type: "bill_discount", discountKind: "percent", discountValue: 10, minSubtotal: 500, maxDiscount: 100, targets: [{ kind: "menu", id: 1 }] }));
    expect(percent).toMatchObject({ discount_kind: "percent", discount_value: 10, min_subtotal: 500, max_discount: 100, targets: [] });

    const amount = formToPromotionInput(form({ type: "bill_discount", discountKind: "amount", discountValue: 30, minSubtotal: 300, maxDiscount: 100 }));
    expect(amount.max_discount).toBe(0);
  });

  it("drops the hours when the promotion runs all day, and the dates when it never ends", () => {
    const input = formToPromotionInput(form({
      timed: false,
      startTime: "14:00",
      endTime: "17:00",
      dated: false,
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      targets: [{ kind: "menu", id: 1 }],
    }));
    expect(input).toMatchObject({ start_time: "", end_time: "", start_date: "", end_date: "" });
  });

  it("round-trips a saved promotion through the form unchanged", () => {
    const saved = promotion({
      type: "bundle_price",
      buy_quantity: 0,
      get_quantity: 0,
      bundle_price: 79,
      days_mask: 0b0111110,
      start_time: "11:00",
      end_time: "14:00",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      targets: [
        { group_index: 0, quantity: 1, menu_item_id: 1, category_id: null },
        { group_index: 1, quantity: 1, menu_item_id: null, category_id: 20 },
      ],
    });
    const fields = Object.fromEntries(Object.entries(saved).filter(([key]) => key !== "ID" && key !== "is_active"));
    expect(formToPromotionInput(promotionToForm(saved))).toEqual(fields);
  });
});

describe("promotionFormProblems", () => {
  it("passes a complete promotion", () => {
    expect(promotionFormProblems(form({ targets: [{ kind: "menu", id: 1 }] }))).toEqual([]);
  });

  it("names every field that is missing or impossible", () => {
    expect(promotionFormProblems(form({ name: " ", targets: [] }))).toEqual(["name", "targets"]);
    expect(promotionFormProblems(form({ getQuantity: 0, targets: [{ kind: "menu", id: 1 }] }))).toEqual(["quantities"]);
    expect(promotionFormProblems(form({ type: "item_discount", discountKind: "percent", discountValue: 120, targets: [{ kind: "menu", id: 1 }] }))).toEqual(["percent"]);
    expect(promotionFormProblems(form({ type: "item_discount", discountValue: 0, targets: [{ kind: "menu", id: 1 }] }))).toEqual(["discount"]);
    expect(promotionFormProblems(form({ type: "bill_discount", discountValue: 0 }))).toEqual(["discount"]);
  });

  it("wants a price and a dish in every slot of a set of at least two", () => {
    expect(promotionFormProblems(form({ type: "bundle_price", bundlePrice: 0, slots: [{ quantity: 1, targets: [{ kind: "menu", id: 1 }] }, { quantity: 1, targets: [] }] })))
      .toEqual(["bundle_price", "bundle_slots"]);
    expect(promotionFormProblems(form({ type: "bundle_price", bundlePrice: 50, slots: [{ quantity: 1, targets: [{ kind: "menu", id: 1 }] }] })))
      .toEqual(["bundle_size"]);
    expect(promotionFormProblems(form({ type: "bundle_price", bundlePrice: 100, slots: [{ quantity: 3, targets: [{ kind: "category", id: 20 }] }] })))
      .toEqual([]);
  });

  it("checks the schedule", () => {
    const dish = { targets: [{ kind: "menu" as const, id: 1 }] };
    expect(promotionFormProblems(form({ ...dish, daysMask: 0 }))).toEqual(["days"]);
    expect(promotionFormProblems(form({ ...dish, timed: true, startTime: "14:00", endTime: "14:00" }))).toEqual(["hours"]);
    expect(promotionFormProblems(form({ ...dish, timed: true, startTime: "14:00", endTime: "" }))).toEqual(["hours"]);
    expect(promotionFormProblems(form({ ...dish, timed: true, startTime: "22:00", endTime: "02:00" }))).toEqual([]);
    expect(promotionFormProblems(form({ ...dish, dated: true, startDate: "2026-09-30", endDate: "2026-09-01" }))).toEqual(["dates"]);
    expect(promotionFormProblems(form({ ...dish, dated: true, startDate: "2026-09-01", endDate: "" }))).toEqual(["dates"]);
    expect(promotionFormProblems(form({ ...dish, dated: false, startDate: "2026-09-30", endDate: "2026-09-01" }))).toEqual([]);
  });
});

describe("summaries", () => {
  it("says the rule in the owner's words", () => {
    expect(promotionRuleSummary(promotion({ buy_quantity: 2, get_quantity: 1 }), "th")).toBe("ซื้อ 2 แถม 1");
    expect(promotionRuleSummary(promotion({ type: "item_discount", discount_kind: "percent", discount_value: 10 }), "th")).toBe("ลด 10%");
    expect(promotionRuleSummary(promotion({ type: "item_discount", discount_kind: "amount", discount_value: 20 }), "en")).toContain("20");
    expect(promotionRuleSummary(promotion({ type: "bundle_price", bundle_price: 79.5 }), "th")).toContain("79.50");
    const bill = promotionRuleSummary(promotion({ type: "bill_discount", discount_kind: "percent", discount_value: 10, min_subtotal: 500, max_discount: 100 }), "th");
    expect(bill).toMatch(/^ครบ .*500 ลด 10%, ลดสูงสุด .*100$/);
    expect(promotionRuleSummary(promotion({ type: "bill_discount", discount_kind: "percent", discount_value: 5 }), "th")).toBe("ลดทั้งบิล 5%");
  });

  it("lists dishes with commas and bundle slots with a plus", () => {
    expect(promotionTargetsSummary(promotion({
      targets: [
        { group_index: 0, quantity: 1, menu_item_id: 3, category_id: null },
        { group_index: 0, quantity: 1, menu_item_id: null, category_id: 20 },
      ],
    }), names, "th")).toBe("ชาเย็น, หมวดเครื่องดื่ม");
    expect(promotionTargetsSummary(promotion({
      type: "bundle_price",
      targets: [
        { group_index: 0, quantity: 1, menu_item_id: 1, category_id: null },
        { group_index: 0, quantity: 1, menu_item_id: 2, category_id: null },
        { group_index: 1, quantity: 2, menu_item_id: null, category_id: 20 },
      ],
    }), names, "th")).toBe("ข้าวผัด/กะเพรา + หมวดเครื่องดื่ม ×2");
    expect(promotionTargetsSummary(promotion({ type: "bill_discount" }), names, "th")).toBe("");
  });

  it("says a dish or category that is gone instead of leaving a gap", () => {
    expect(promotionTargetsSummary(promotion({ targets: [{ group_index: 0, quantity: 1, menu_item_id: 99, category_id: null }] }), names, "th"))
      .toBe("เมนูที่ถูกลบ");
  });

  it("describes the schedule", () => {
    const today = bangkok("2026-09-18", "12:00");
    expect(promotionScheduleSummary(promotion(), "th", today)).toBe("ทุกวัน");
    expect(promotionScheduleSummary(promotion({ days_mask: 0b0111110, start_time: "14:00", end_time: "17:00" }), "th", today)).toBe("จ.–ศ., 14:00–17:00");
    expect(promotionScheduleSummary(promotion({ days_mask: 0b1000001 }), "en", today)).toBe("Sat Sun");
    expect(promotionScheduleSummary(promotion({ start_date: "2026-09-01", end_date: "2026-09-30" }), "th", today)).toMatch(/^ทุกวัน, 1 .+–30 .+$/);
    expect(promotionScheduleSummary(promotion({ end_date: "2026-09-30" }), "th", today)).toMatch(/^ทุกวัน, ถึง 30 /);
  });
});

describe("promotionRunsAt / promotionStateAt", () => {
  const happyHour = promotion({ start_time: "14:00", end_time: "17:00" });

  it("keeps the hours start-inclusive and end-exclusive", () => {
    expect(promotionRunsAt(happyHour, bangkok("2026-09-18", "13:59"))).toBe(false);
    expect(promotionRunsAt(happyHour, bangkok("2026-09-18", "14:00"))).toBe(true);
    expect(promotionRunsAt(happyHour, bangkok("2026-09-18", "17:00"))).toBe(false);
  });

  it("counts the hours after midnight as the night that started the day before", () => {
    const fridayNight = promotion({ days_mask: 1 << 5, start_time: "22:00", end_time: "02:00" });
    expect(promotionRunsAt(fridayNight, bangkok("2026-09-19", "01:00"))).toBe(true); // Saturday 01:00
    expect(promotionRunsAt(fridayNight, bangkok("2026-09-19", "23:00"))).toBe(false); // Saturday night
    expect(promotionRunsAt(fridayNight, bangkok("2026-09-18", "12:00"))).toBe(false); // Friday noon
  });

  it("reads the calendar in Bangkok, whatever the browser's zone", () => {
    const lastDay = promotion({ end_date: "2026-09-18" });
    // 17:30 UTC on the 18th is already 00:30 on the 19th in Bangkok.
    expect(promotionRunsAt(lastDay, new Date("2026-09-18T17:30:00Z"))).toBe(false);
    expect(promotionRunsAt(lastDay, new Date("2026-09-18T16:30:00Z"))).toBe(true);
  });

  it("tells running, off hours, upcoming, ended and switched off apart", () => {
    const now = bangkok("2026-09-18", "12:00");
    expect(promotionStateAt(promotion(), now)).toBe("running");
    expect(promotionStateAt(happyHour, now)).toBe("waiting");
    expect(promotionStateAt(promotion({ start_date: "2026-10-01" }), now)).toBe("upcoming");
    expect(promotionStateAt(promotion({ end_date: "2026-09-17" }), now)).toBe("ended");
    expect(promotionStateAt(promotion({ is_active: false }), now)).toBe("off");
  });
});
