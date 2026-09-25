import { describe, expect, it } from "vitest";
import { questionBehindPlan } from "@/src/lib/aiPendingPlan";
import { planItemHeadline } from "@/src/lib/aiPlanHeadline";

// "ขอคำสั่งใหม่" after a reload: the sentence comes from the thread, which
// survives the reload, not from memory, which does not (25 ก.ย. 2569).
describe("questionBehindPlan", () => {
  const thread = [
    { role: "assistant", content: "สวัสดีพู่กัน" },
    { role: "user", content: "เพิ่มวัตถุดิบใหม่หน่อย ขิง" },
    { role: "assistant", content: "ผมเตรียมเพิ่มวัตถุดิบ “ขิง”แล้ว", planId: "p1" },
    { role: "user", content: "ยอดขายวันนี้" },
    { role: "assistant", content: "วันนี้ขายได้ 6,301 บาท" },
  ];

  it("finds the owner's sentence before the answer that carries the plan", () => {
    expect(questionBehindPlan(thread, "p1")).toBe("เพิ่มวัตถุดิบใหม่หน่อย ขิง");
  });

  it("gives nothing when the plan is not in the thread", () => {
    expect(questionBehindPlan(thread, "other")).toBe("");
    expect(questionBehindPlan(thread, null)).toBe("");
  });
});

describe("planItemHeadline", () => {
  it("leads a new ingredient with what goes in", () => {
    expect(planItemHeadline({
      title: "ขิง",
      change: "เพิ่มเข้าคลัง · หน่วยกิโลกรัม · เริ่มที่ 50",
      setup: {
        name: "ขิง", said_quantity: 0, unit: "กิโลกรัม", units: [], needs_stock: true, stock_set: true,
        needs_pack: false, pack_units: [], stock: 50, price_modes: [], price_mode: "per_unit",
        storage_type: "room_temp", storage_types: [], min_percent: 0,
      },
    })).toBe("เพิ่มขิง 50 กิโลกรัม");
  });

  it("shows a moving value as from → to", () => {
    expect(planItemHeadline({ title: "หมูสับ", change: "5000 → 7000 กรัม", from: "5,000", to: "7,000", value_unit: "กรัม" }))
      .toBe("หมูสับ 5,000 → 7,000 กรัม");
  });
});
