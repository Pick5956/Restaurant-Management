import { describe, expect, it } from "vitest";
import { billDiscountLines } from "../billPromotions";

const promotion = (id: number, name: string, times: number, amount: number) => ({
  ID: id,
  order_id: 1,
  promotion_id: id,
  name,
  type: "buy_x_get_y",
  times,
  amount,
});

describe("billDiscountLines", () => {
  it("has no lines when nothing was taken off", () => {
    expect(billDiscountLines({ discount_amount: 0, promotions: [] }, "ส่วนลด")).toEqual([]);
    expect(billDiscountLines({ discount_amount: 0 }, "ส่วนลด")).toEqual([]);
  });

  it("names each promotion, with how often it applied when more than once", () => {
    expect(billDiscountLines({
      discount_amount: 130,
      promotions: [promotion(1, "ชาเย็น 1 แถม 1", 2, 80), promotion(2, "ครบ 500 ลด 10%", 1, 50)],
    }, "ส่วนลด")).toEqual([
      { key: "promotion-1", label: "ชาเย็น 1 แถม 1 ×2", amount: 80 },
      { key: "promotion-2", label: "ครบ 500 ลด 10%", amount: 50 },
    ]);
  });

  it("falls back to one discount line when the bill has no itemised promotions", () => {
    expect(billDiscountLines({ discount_amount: 25 }, "ส่วนลด")).toEqual([{ key: "discount", label: "ส่วนลด", amount: 25 }]);
  });
});
