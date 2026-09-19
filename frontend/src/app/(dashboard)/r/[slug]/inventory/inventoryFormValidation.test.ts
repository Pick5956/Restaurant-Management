import { describe, expect, it } from "vitest";
import {
  hasFieldErrors,
  inventoryErrorMessage,
  isBadAmount,
  validateBulkRows,
  validateIngredientForm,
} from "./inventoryFormValidation";

const base = {
  name: "น้ำปลา",
  existingNames: ["หมูสับ", "น้ำปลา ", "ไข่ไก่"],
  packUnit: "",
  packSize: "",
  caseUnit: "",
  caseSize: "",
  stockText: "",
  costText: "",
  creating: true,
};

describe("isBadAmount", () => {
  it("lets an empty box through and stops negatives and junk", () => {
    expect(isBadAmount("")).toBe(false);
    expect(isBadAmount("0")).toBe(false);
    expect(isBadAmount("12.5")).toBe(false);
    expect(isBadAmount("-1")).toBe(true);
    expect(isBadAmount("abc")).toBe(true);
  });
});

describe("validateIngredientForm", () => {
  it("needs a name", () => {
    expect(validateIngredientForm({ ...base, name: "   " }, "th").name).toBe("กรอกชื่อวัตถุดิบ");
  });
  it("refuses a name already in the inventory, ignoring case and spaces", () => {
    expect(validateIngredientForm(base, "th").name).toContain("มี \"น้ำปลา\" ในคลังแล้ว");
    expect(validateIngredientForm({ ...base, name: "  หมูสับ" }, "th").name).toBeTruthy();
  });
  it("lets an edit keep its own name", () => {
    expect(validateIngredientForm({ ...base, ownName: "น้ำปลา", creating: false }, "th").name).toBeUndefined();
  });
  it("needs a size for a pack and for a case", () => {
    const errors = validateIngredientForm(
      { ...base, name: "กะทิ", packUnit: "ขวด", packSize: "", caseUnit: "ลัง", caseSize: "0" },
      "th",
    );
    expect(errors.packSize).toContain("1 ขวด");
    expect(errors.caseSize).toContain("1 ลัง");
  });
  it("stops negative stock and price", () => {
    const errors = validateIngredientForm({ ...base, name: "กะทิ", stockText: "-3", costText: "-1" }, "th");
    expect(errors.stock).toBeTruthy();
    expect(errors.cost).toBeTruthy();
  });
  it("ignores the opening stock on an edit", () => {
    expect(validateIngredientForm({ ...base, name: "กะทิ", stockText: "-3", creating: false }, "th").stock).toBeUndefined();
  });
  it("passes a clean form", () => {
    expect(hasFieldErrors(validateIngredientForm({ ...base, name: "กะทิ", stockText: "10", costText: "5" }, "th"))).toBe(false);
  });
});

describe("validateBulkRows", () => {
  it("flags existing names, repeats and bad numbers per row", () => {
    const result = validateBulkRows(
      [
        { name: "หมูสับ", quantity: "1", price: "1" },
        { name: "กะทิ", quantity: "1", price: "1" },
        { name: " กะทิ", quantity: "1", price: "1" },
        { name: "ข้าว", quantity: "-2", price: "1" },
        { name: "", quantity: "-9", price: "" },
        { name: "น้ำตาล", quantity: "3", price: "20" },
      ],
      ["หมูสับ"],
      "th",
    );
    expect(result[0]).toContain("ในคลังแล้ว");
    expect(result[1]).toBe("ชื่อซ้ำกับแถวอื่นในชุดนี้");
    expect(result[2]).toBe("ชื่อซ้ำกับแถวอื่นในชุดนี้");
    expect(result[3]).toContain("จำนวน");
    expect(result[4]).toBeNull();
    expect(result[5]).toBeNull();
  });
});

describe("inventoryErrorMessage", () => {
  it("says the known server refusals in Thai", () => {
    expect(inventoryErrorMessage("ingredient is used by a menu recipe", "th")).toContain("สูตรเมนู");
    expect(inventoryErrorMessage("not enough stock", "th")).toBe("จ่ายออกเกินที่มีอยู่");
  });
  it("passes anything else through, and falls back when empty", () => {
    expect(inventoryErrorMessage("database is down", "th")).toBe("database is down");
    expect(inventoryErrorMessage(undefined, "th")).toBe("ทำรายการไม่สำเร็จ");
  });
});
