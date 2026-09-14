import { describe, expect, it } from "vitest";
import { canReprintReceipt } from "./ordersPageUtils";

describe("order archive receipt actions", () => {
  it("allows receipt reprint only for completed paid orders", () => {
    expect(canReprintReceipt({ status: "completed", payment_status: "paid" })).toBe(true);
    expect(canReprintReceipt({ status: "completed", payment_status: "unpaid" })).toBe(false);
    expect(canReprintReceipt({ status: "served", payment_status: "paid" })).toBe(false);
  });
});
