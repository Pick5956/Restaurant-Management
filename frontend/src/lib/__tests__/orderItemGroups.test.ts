import { describe, expect, it } from "vitest";
import { groupOrderItems, newestPendingItem } from "../orderItemGroups";
import type { OrderItem } from "../../types/order";

const item = (id: number, name: string, updatedAt: string, menuId = id): OrderItem => ({
  ID: id,
  order_id: 1,
  restaurant_id: 1,
  menu_id: menuId,
  menu_name: name,
  unit_price: 50,
  options_total: 0,
  quantity: 1,
  subtotal: 50,
  note: "",
  status: "pending",
  CreatedAt: `2026-07-13T00:00:0${id}Z`,
  UpdatedAt: updatedAt,
});

describe("groupOrderItems", () => {
  it("preserves API order when a non-first item receives a newer UpdatedAt", () => {
    const groups = groupOrderItems([
      item(1, "First", "2026-07-13T00:00:01Z"),
      item(2, "Second", "2026-07-13T00:10:00Z"),
      item(3, "Third", "2026-07-13T00:00:03Z"),
    ]);

    expect(groups.map((group) => group.firstItem.menu_name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("combines the same menu configuration across separate order rounds", () => {
    const groups = groupOrderItems([
      item(1, "Pad Thai", "2026-07-13T00:00:01Z", 9),
      item(2, "Pad Thai", "2026-07-13T00:10:00Z", 9),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ quantity: 2, subtotal: 100 });
  });
});

describe("newestPendingItem", () => {
  const beer = (id: number, createdAt: string | undefined, extra: Partial<OrderItem> = {}): OrderItem => ({
    ...item(id, "Beer", "2026-09-24T12:00:00Z", 7),
    CreatedAt: createdAt,
    ...extra,
  });

  it("takes the unit off the line taken last, so a happy-hour line keeps its price", () => {
    // 17:55 in happy hour (20 off), then 18:05 at full price: one group, since
    // the key has no time in it.
    const happyHour = beer(1, "2026-09-24T10:55:00Z", { discount_amount: 20 });
    const fullPrice = beer(2, "2026-09-24T11:05:00Z");
    const [group] = groupOrderItems([happyHour, fullPrice]);

    expect(group.pendingItems).toHaveLength(2);
    expect(group.pendingItems[0]).toBe(happyHour);
    expect(newestPendingItem(group)).toBe(fullPrice);
  });

  it("reads the time it was taken, not the order the API listed it in", () => {
    const later = beer(3, "2026-09-24T11:30:00Z");
    const earlier = beer(9, "2026-09-24T10:00:00Z");

    expect(newestPendingItem({ pendingItems: [later, earlier] })).toBe(later);
  });

  it("falls back to the higher id when the times are equal or missing", () => {
    expect(newestPendingItem({ pendingItems: [beer(4, "2026-09-24T11:00:00Z"), beer(5, "2026-09-24T11:00:00Z")] })?.ID).toBe(5);
    expect(newestPendingItem({ pendingItems: [beer(8, undefined), beer(6, undefined)] })?.ID).toBe(8);
  });

  it("skips served lines and has nothing to offer a group with no pending line", () => {
    const pending = beer(1, "2026-09-24T10:00:00Z");
    const served = beer(2, "2026-09-24T11:00:00Z", { status: "served" });
    const [group] = groupOrderItems([pending, served]);

    expect(newestPendingItem(group)).toBe(pending);
    expect(newestPendingItem({ pendingItems: [] })).toBeUndefined();
  });
});
