import { describe, expect, it } from "vitest";

import { buildAdjustStockPayload } from "./inventoryPageUtils";

describe("buildAdjustStockPayload", () => {
  const base = {
    type: "in" as const,
    quantity: 5,
    note: "morning market",
    canManageExpenses: true,
  };

  it("omits amount when the optional value is blank or zero", () => {
    expect(buildAdjustStockPayload({ ...base, paidAmount: "" })).toEqual({
      type: "in",
      quantity: 5,
      note: "morning market",
    });
    expect(buildAdjustStockPayload({ ...base, paidAmount: "0" })).not.toHaveProperty("amount");
  });

  it("includes a positive paid amount for authorized stock-in", () => {
    expect(buildAdjustStockPayload({ ...base, paidAmount: "450.50" })).toEqual({
      type: "in",
      quantity: 5,
      note: "morning market",
      amount: 450.5,
    });
  });

  it("omits amount for non-stock-in adjustments and unauthorized users", () => {
    expect(buildAdjustStockPayload({ ...base, type: "out", paidAmount: "450.50" })).not.toHaveProperty("amount");
    expect(
      buildAdjustStockPayload({ ...base, paidAmount: "450.50", canManageExpenses: false }),
    ).not.toHaveProperty("amount");
  });
});
