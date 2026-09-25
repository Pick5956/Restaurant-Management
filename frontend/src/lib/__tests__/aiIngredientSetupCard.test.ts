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
  needs_stock: false,
  stock_set: false,
  needs_pack: false,
  pack_units: ["ขวด", "แกลลอน"],
  stock: 0,
  price_modes: [],
  price_mode: "",
  storage_type: "room_temp",
  storage_types: ["room_temp", "chilled", "frozen", "dry"],
  min_percent: 0,
};

describe("new-ingredient card steps", () => {
  it("asks the unit first", () => {
    expect(firstOpenStep(fresh)).toBe("unit");
    expect(stepsFor(fresh)).toEqual(["unit", "extras"]);
  });

  it("asks the bottle size after มิลลิลิตร, then the price", () => {
    const counted = { ...fresh, unit: "มิลลิลิตร", pack_unit: "ขวด", needs_pack: true, price_modes: ["per_unit" as const] };
    expect(nextStep("unit", counted)).toBe("pack");
    expect(firstOpenStep(counted)).toBe("pack");
    const sized = { ...counted, pack_size: 700, stock: 1400 };
    expect(nextStep("pack", sized)).toBe("price");
    expect(stepsFor(sized)).toEqual(["unit", "pack", "price", "extras"]);
  });

  it("skips the pack when the amount was said in the unit itself", () => {
    const bottles = { ...fresh, unit: "ขวด", stock: 2 };
    expect(nextStep("unit", bottles)).toBe("price");
  });

  // "เพิ่มวัตถุดิบใหม่หน่อย ขิง" — no amount said: the card asks what is on hand.
  it("asks the amount on hand when none was said", () => {
    const ginger = { ...fresh, name: "ขิง", said_quantity: 0, said_unit: undefined, unit: "กิโลกรัม", needs_stock: true };
    expect(stepsFor(ginger)).toEqual(["unit", "stock", "price", "extras"]);
    expect(firstOpenStep(ginger)).toBe("stock");
    expect(firstOpenStep({ ...ginger, stock_set: true, stock: 0 })).toBe("price");
    expect(firstOpenStep({ ...ginger, stock_set: true, stock: 3, cost_per_unit: 60 })).toBe("extras");
  });

  it("sends back what the server holds, the stock only once answered", () => {
    const answers = answersFrom({ ...fresh, unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 700, price: 35, price_mode: "per_pack" });
    expect(answers).toMatchObject({ unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 700, price: 35, price_mode: "per_pack" });
    expect("stock" in answers).toBe(false);
    expect(answersFrom({ ...fresh, unit: "กิโลกรัม", needs_stock: true, stock_set: true, stock: 0 }).stock).toBe(0);
  });

  it("only takes plans that carry a setup item", () => {
    const plan = { id: "p", status: "pending", expires_at: "", confirmation_token: "t", summary: "", items: [{ title: "หมูสับ", change: "+2000" }] } as AIActionPlan;
    expect(planNeedsSetup(plan)).toBe(false);
    expect(planNeedsSetup({ ...plan, items: [{ title: "น้ำปลา", change: "", setup: fresh }] })).toBe(true);
  });
});
