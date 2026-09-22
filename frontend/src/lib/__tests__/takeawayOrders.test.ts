import { describe, expect, it } from "vitest";
import { activeTakeaways } from "../takeawayOrders";
import type { Order } from "@/src/types/order";

const order = (overrides: Partial<Order>): Order => ({
  ID: 1,
  order_number: "20260922-001",
  order_type: "takeaway",
  status: "open",
  customer_count: 1,
  total_amount: 0,
  ...overrides,
}) as Order;

describe("activeTakeaways", () => {
  it("keeps only takeaway orders that are still in progress", () => {
    const list = activeTakeaways([
      order({ ID: 1 }),
      order({ ID: 2, order_type: "dine_in", table_id: 4 }),
      order({ ID: 3, status: "completed" }),
      order({ ID: 4, status: "cancelled" }),
      order({ ID: 5, status: "ready" }),
    ]);
    expect(list.map((item) => item.ID)).toEqual([1, 5]);
  });

  it("puts the one waiting longest first", () => {
    expect(activeTakeaways([order({ ID: 9 }), order({ ID: 3 })]).map((item) => item.ID)).toEqual([3, 9]);
  });

  it("matches the search on order number, name or phone", () => {
    const list = [
      order({ ID: 1, order_number: "20260922-001", customer_name: "สมชาย" }),
      order({ ID: 2, order_number: "20260922-002", customer_phone: "0800000000" }),
    ];
    expect(activeTakeaways(list, "สมชาย").map((item) => item.ID)).toEqual([1]);
    expect(activeTakeaways(list, "0800").map((item) => item.ID)).toEqual([2]);
    expect(activeTakeaways(list, "-002").map((item) => item.ID)).toEqual([2]);
    expect(activeTakeaways(list, "  ").map((item) => item.ID)).toEqual([1, 2]);
  });
});
