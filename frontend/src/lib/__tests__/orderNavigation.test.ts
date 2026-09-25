import { describe, expect, it } from "vitest";
import { canCloseEmptyTableOrder, orderPosHref } from "../orderNavigation";

describe("orderPosHref", () => {
  it("uses the database ID so daily order numbers cannot open an older order", () => {
    expect(orderPosHref({ ID: 42, order_number: "A001" })).toBe("/pos/orders/42?ref=A001");
  });
});

describe("canCloseEmptyTableOrder", () => {
  it("allows an open dine-in table without items", () => {
    expect(canCloseEmptyTableOrder({ order_type: "dine_in", table_id: 7, status: "open", items: [] })).toBe(true);
  });

  it("allows an open takeaway without items (opened by mistake, no table to free)", () => {
    expect(canCloseEmptyTableOrder({ order_type: "takeaway", table_id: null, status: "open", items: [] })).toBe(true);
  });

  it("rejects non-open and non-empty orders", () => {
    expect(canCloseEmptyTableOrder({ order_type: "dine_in", table_id: 7, status: "cooking", items: [] })).toBe(false);
    expect(canCloseEmptyTableOrder({ order_type: "dine_in", table_id: 7, status: "open", items: [{ status: "cooking" }] })).toBe(false);
    expect(canCloseEmptyTableOrder({ order_type: "takeaway", table_id: null, status: "open", items: [{ status: "cooking" }] })).toBe(false);
    expect(canCloseEmptyTableOrder({ order_type: "takeaway", table_id: null, status: "cooking", items: [] })).toBe(false);
  });

  it("allows an open dine-in table whose items were all cancelled", () => {
    expect(canCloseEmptyTableOrder({
      order_type: "dine_in",
      table_id: 7,
      status: "open",
      items: [{ status: "cancelled" }, { status: "cancelled" }],
    })).toBe(true);
  });
});
