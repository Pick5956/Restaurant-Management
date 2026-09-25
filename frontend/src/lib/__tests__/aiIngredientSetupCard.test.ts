import { describe, expect, it } from "vitest";
import { answersFrom, firstOpenStep, nextStep, planNeedsSetup, stepsFor } from "@/src/components/shared/AIIngredientSetupCard";
import type { AIActionPlan, AIIngredientSetup } from "@/src/types/ai";

// "เพิ่มน้ำปลา 2 ขวด" as the server first sends it: no unit yet.
const fresh: AIIngredientSetup = {
  name: "น้ำปลา",
  said_quantity: 2,
  said_unit: "ขวด",
  unit: "",
  units: ["กรัม", "มิลลิลิตร", "ขวด"],
  needs_pack: false,
  pack_units: ["ขวด", "แกลลอน"],
  stock: 0,
  can_price: false,
  price_mode: "total",
  storage_type: "room_temp",
  storage_types: ["room_temp", "chilled", "frozen", "dry"],
  min_percent: 0,
};

describe("new-ingredient card steps", () => {
  it("asks the unit first", () => {
    expect(firstOpenStep(fresh)).toBe("unit");
    expect(stepsFor(fresh)).toEqual(["unit", "extras"]);
  });

  it("asks the bottle size after มิลลิลิตร, then the price once there is stock", () => {
    const counted = { ...fresh, unit: "มิลลิลิตร", pack_unit: "ขวด", needs_pack: true };
    expect(nextStep("unit", counted)).toBe("pack");
    expect(firstOpenStep(counted)).toBe("pack");
    const sized = { ...counted, pack_size: 700, stock: 1400, can_price: true };
    expect(nextStep("pack", sized)).toBe("price");
    expect(stepsFor(sized)).toEqual(["unit", "pack", "price", "extras"]);
  });

  it("skips the pack when the amount was said in the unit itself", () => {
    const bottles = { ...fresh, unit: "ขวด", stock: 2, can_price: true };
    expect(nextStep("unit", bottles)).toBe("price");
  });

  it("skips the price when the size was skipped (nothing to divide by)", () => {
    const skipped = { ...fresh, unit: "มิลลิลิตร", pack_unit: "ขวด", needs_pack: true, no_pack: true };
    expect(nextStep("pack", skipped)).toBe("extras");
    expect(nextStep("extras", skipped)).toBeNull();
  });

  it("sends back what the server holds", () => {
    const answers = answersFrom({ ...fresh, unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 700, price: 35, price_mode: "per_pack" });
    expect(answers).toMatchObject({ unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 700, price: 35, price_mode: "per_pack", no_pack: false });
  });

  it("only takes plans that carry a setup item", () => {
    const plan = { id: "p", status: "pending", expires_at: "", confirmation_token: "t", summary: "", items: [{ title: "หมูสับ", change: "+2000" }] } as AIActionPlan;
    expect(planNeedsSetup(plan)).toBe(false);
    expect(planNeedsSetup({ ...plan, items: [{ title: "น้ำปลา", change: "", setup: fresh }] })).toBe(true);
  });
});
