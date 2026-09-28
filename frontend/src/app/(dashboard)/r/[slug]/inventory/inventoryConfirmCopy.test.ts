import { describe, expect, it } from "vitest";
import type { Ingredient, IngredientInput } from "@/src/types/ingredient";
import { ingredientChanges, newIngredientSummary } from "./inventoryConfirmCopy";

const pork = {
  ID: 1,
  name: "หมูสับ",
  category_id: 2,
  unit: "กรัม",
  stock: 5000,
  min_stock: 1000,
  min_percent: 20,
  cost_per_unit: 0.15,
  storage_type: "chilled",
  pack_unit: "แพ็ก",
  pack_size: 1000,
  case_unit: "",
  case_size: 0,
} as Ingredient;

const asInput = (item: Ingredient): IngredientInput => ({
  name: item.name,
  category_id: item.category_id ?? 0,
  unit: item.unit,
  stock: item.stock,
  min_stock: item.min_stock,
  min_percent: item.min_percent,
  cost_per_unit: item.cost_per_unit,
  storage_type: item.storage_type ?? "room_temp",
  pack_unit: item.pack_unit ?? "",
  pack_size: item.pack_size ?? 0,
  case_unit: item.case_unit ?? "",
  case_size: item.case_size ?? 0,
});

const categoryName = (id: number) => ({ 0: "ไม่มีหมวด", 2: "เนื้อสัตว์และไข่", 3: "ของแช่แข็ง" })[id] ?? "?";

describe("ingredientChanges", () => {
  it("is empty when the form was opened and saved as it was", () => {
    expect(ingredientChanges(pork, asInput(pork), categoryName, "th")).toEqual([]);
  });

  it("says each changed field with its old and new value", () => {
    const after = { ...asInput(pork), cost_per_unit: 0.18, min_stock: 1500, min_percent: 30, category_id: 3 };
    expect(ingredientChanges(pork, after, categoryName, "th")).toEqual([
      "หมวด เนื้อสัตว์และไข่ → ของแช่แข็ง",
      "ราคา ฿0.15/กรัม → ฿0.18/กรัม",
      "แจ้งเตือนเมื่อต่ำกว่า 1,000 → 1,500 กรัม (20% → 30%)",
    ]);
  });

  it("names the pack and the storage in words", () => {
    const after = { ...asInput(pork), pack_size: 500, storage_type: "frozen" };
    const lines = ingredientChanges(pork, after, categoryName, "th");
    expect(lines).toContain("บรรจุภัณฑ์ แพ็กละ 1,000 กรัม → แพ็กละ 500 กรัม");
    expect(lines.some((line) => line.startsWith("การเก็บ "))).toBe(true);
  });

  it("ignores spaces typed around the name", () => {
    expect(ingredientChanges(pork, { ...asInput(pork), name: " หมูสับ " }, categoryName, "th")).toEqual([]);
  });
});

describe("newIngredientSummary", () => {
  it("says the opening stock in the unit it was typed in, the price, storage and expiry", () => {
    const input: IngredientInput = {
      ...asInput(pork),
      stock: 5,
      stock_unit: "แพ็ก",
      expires_at: "2026-10-01",
    };
    const text = newIngredientSummary(input, "th");
    expect(text.startsWith("ยอดเริ่มต้น 5 แพ็ก · ราคา ฿0.15/กรัม · ")).toBe(true);
    expect(text).toContain("หมดอายุ");
  });

  it("says there is no stock yet rather than 0", () => {
    expect(newIngredientSummary({ ...asInput(pork), stock: 0, cost_per_unit: 0 }, "th").startsWith("ยังไม่มีสต๊อก")).toBe(true);
  });
});
