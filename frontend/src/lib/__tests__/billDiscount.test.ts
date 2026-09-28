import { describe, expect, it } from "vitest";
import { billDiscountLines } from "../billDiscount";

describe("billDiscountLines", () => {
  it("has no line when nothing was taken off", () => {
    expect(billDiscountLines({ discount_amount: 0 }, "ส่วนลด")).toEqual([]);
  });

  it("shows one discount line for a bill that carries a discount", () => {
    expect(billDiscountLines({ discount_amount: 25 }, "ส่วนลด")).toEqual([{ key: "discount", label: "ส่วนลด", amount: 25 }]);
  });
});
