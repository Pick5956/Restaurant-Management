import { describe, expect, it } from "vitest";
import type { Ingredient } from "@/src/types/ingredient";
import {
  convertEntryAmount,
  defaultEntryUnit,
  entryUnitOptions,
  formatPackCount,
  packExample,
  packSummary,
  purchaseFactor,
  resolveTypedAmounts,
  retargetTypedUnits,
  stockPerEntryUnit,
  emptyTypedAmounts,
  TOTAL_PRICE,
  priceBreakdown,
  stockUnitHint,
  packUnitChoices,
  packChain,
  entryChain,
} from "./inventoryUnitUtils";

// What the API returns for fish sauce after migration 31: a ml shelf bought by
// the 700 ml bottle, 12 bottles to a case.
const fishSauce: Ingredient = {
  ID: 35,
  restaurant_id: 1,
  name: "น้ำปลา",
  unit: "มิลลิลิตร",
  stock: 3850,
  min_stock: 0,
  cost_per_unit: 0.05,
  pack_unit: "ขวด",
  pack_size: 700,
  case_unit: "ลัง",
  case_size: 12,
  unit_family: [
    { unit: "มิลลิลิตร", stock_per_unit: 1 },
    { unit: "ช้อนชา", stock_per_unit: 5 },
    { unit: "ช้อนโต๊ะ", stock_per_unit: 15 },
    { unit: "ลิตร", stock_per_unit: 1000 },
    { unit: "ขวด", stock_per_unit: 700 },
    { unit: "ลัง", stock_per_unit: 8400 },
  ],
};

const plain: Ingredient = { ...fishSauce, pack_unit: "", pack_size: 0, case_unit: "", case_size: 0, unit_family: fishSauce.unit_family?.slice(0, 4) };

describe("stockPerEntryUnit", () => {
  it("reads the factor the server sent", () => {
    expect(stockPerEntryUnit(fishSauce, "ลัง")).toBe(8400);
    expect(stockPerEntryUnit(fishSauce, "มิลลิลิตร")).toBe(1);
    expect(stockPerEntryUnit(fishSauce, "")).toBe(1);
  });
  it("is null for a unit this ingredient does not accept", () => {
    expect(stockPerEntryUnit(plain, "ขวด")).toBeNull();
  });
});

describe("entryUnitOptions", () => {
  it("keeps the shelf unit, the everyday sibling and the purchase units", () => {
    expect(entryUnitOptions(fishSauce).map((o) => o.unit)).toEqual(["มิลลิลิตร", "ลิตร", "ขวด", "ลัง"]);
  });
  it("falls back to the shelf unit when the server sent no family", () => {
    expect(entryUnitOptions({ ...plain, unit: "ฟอง", unit_family: undefined })).toEqual([
      { unit: "ฟอง", stock_per_unit: 1 },
    ]);
  });
});

describe("defaultEntryUnit", () => {
  it("restocks by the biggest container and counts by the pack", () => {
    expect(defaultEntryUnit(fishSauce)).toBe("ลัง");
    expect(defaultEntryUnit(fishSauce, "count")).toBe("ขวด");
    expect(defaultEntryUnit({ ...fishSauce, case_unit: "", case_size: 0 })).toBe("ขวด");
    expect(defaultEntryUnit(plain)).toBe("มิลลิลิตร");
  });
});

describe("convertEntryAmount", () => {
  it("keeps the same amount of stuff across units", () => {
    expect(convertEntryAmount(5.5, 700, 1)).toBe(3850);
    expect(convertEntryAmount(3850, 1, 700)).toBe(5.5);
    expect(convertEntryAmount(50, 1, 1000)).toBe(0.05);
  });
});

describe("pack text", () => {
  it("counts the shelf in bottles", () => {
    expect(formatPackCount(fishSauce, "th")).toBe("≈ 5.5 ขวด");
    expect(formatPackCount(plain, "th")).toBeNull();
    expect(formatPackCount({ ...fishSauce, stock: 0 }, "th")).toBeNull();
  });
  it("summarises both levels", () => {
    expect(packSummary(fishSauce, "th")).toBe("ขวดละ 700 มิลลิลิตร · ลังละ 12 ขวด");
    expect(packSummary({ ...fishSauce, case_unit: "" }, "th")).toBe("ขวดละ 700 มิลลิลิตร");
  });
  it("explains a delivery with the biggest unit and the pack price", () => {
    const text = packExample(fishSauce, "th") ?? "";
    expect(text.startsWith("1 ลัง = 12 ขวด = 8,400 มิลลิลิตร · ขวดละ ")).toBe(true);
    expect(text).toContain("35");
  });
});

// The form the owner filled in on 18 Sep: eggs by the ฟอง, 20 to a แผง, 50 แผง to a ลัง.
const eggs = { unit: "ฟอง", pack_unit: "แผง", pack_size: 20, case_unit: "ลัง", case_size: 50 };
const noPack = { unit: "ฟอง", pack_unit: "", pack_size: 0, case_unit: "", case_size: 0 };

describe("purchaseFactor", () => {
  it("reads the form's own pack fields", () => {
    expect(purchaseFactor(eggs, "")).toBe(1);
    expect(purchaseFactor(eggs, "ฟอง")).toBe(1);
    expect(purchaseFactor(eggs, "แผง")).toBe(20);
    expect(purchaseFactor(eggs, "ลัง")).toBe(1000);
    expect(purchaseFactor(noPack, "แผง")).toBeNull();
  });
});

describe("resolveTypedAmounts", () => {
  it("turns 500 แผง into 10,000 ฟอง, not 500", () => {
    const got = resolveTypedAmounts(eggs, { ...emptyTypedAmounts, stock: "500", stockIn: "แผง" });
    expect(got.stock).toBe(10000);
  });
  it("scales quantities up and a price down", () => {
    const got = resolveTypedAmounts(eggs, {
      stock: "2",
      stockIn: "ลัง",
      min: "3",
      minIn: "แผง",
      cost: "100",
      costIn: "แผง",
    });
    expect(got).toEqual({ stock: 2000, min_stock: 60, cost_per_unit: 5 });
  });
  it("leaves everything alone in the stock unit", () => {
    expect(resolveTypedAmounts(noPack, { ...emptyTypedAmounts, stock: "500", min: "30", cost: "5" })).toEqual({
      stock: 500,
      min_stock: 30,
      cost_per_unit: 5,
    });
  });
});

describe("retargetTypedUnits", () => {
  it("switches empty fields to the pack the moment one is set", () => {
    const got = retargetTypedUnits(noPack, eggs, { ...emptyTypedAmounts, cost: "10" });
    // Opening stock follows the biggest container; the reorder level stays on the pack.
    expect(got.stockIn).toBe("ลัง");
    expect(got.minIn).toBe("แผง");
    // A price already typed keeps meaning "per ฟอง".
    expect(got.costIn).toBe("");
  });
  it("falls back when the unit a field used is removed", () => {
    const typed = { ...emptyTypedAmounts, stock: "2", stockIn: "ลัง", min: "3", minIn: "แผง" };
    const withoutCase = { ...eggs, case_unit: "", case_size: 0 };
    expect(retargetTypedUnits(eggs, withoutCase, typed).stockIn).toBe("แผง");
    const got = retargetTypedUnits(eggs, noPack, typed);
    expect(got.stockIn).toBe("");
    expect(got.minIn).toBe("");
  });
});

// The owner's form on 18 Sep: drinking water by the ขวด, 12 to a แพ็ก.
const water = { unit: "ขวด", pack_unit: "แพ็ก", pack_size: 12, case_unit: "", case_size: 0 };

describe("total price", () => {
  it("splits what was paid for the opening stock over it", () => {
    const got = resolveTypedAmounts(water, {
      ...emptyTypedAmounts,
      stock: "3",
      stockIn: "แพ็ก",
      cost: "180",
      costIn: TOTAL_PRICE,
    });
    expect(got.stock).toBe(36);
    expect(got.cost_per_unit).toBe(5);
  });
  it("is 0, not Infinity, before any stock is typed", () => {
    const got = resolveTypedAmounts(water, { ...emptyTypedAmounts, cost: "180", costIn: TOTAL_PRICE });
    expect(got.cost_per_unit).toBe(0);
  });
  it("survives a pack change", () => {
    const typed = { ...emptyTypedAmounts, cost: "180", costIn: TOTAL_PRICE };
    expect(retargetTypedUnits(noPack, water, typed).costIn).toBe(TOTAL_PRICE);
  });
});

describe("retargetTypedUnits when the pack is swapped", () => {
  it("moves empty fields from the old pack to the new one", () => {
    // ขวด was the pack of a ml shelf; now ขวด is the stock unit and แพ็ก the pack.
    const before = { unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 750, case_unit: "", case_size: 0 };
    const typed = { ...emptyTypedAmounts, stockIn: "ขวด", minIn: "ขวด", costIn: "ขวด" };
    const got = retargetTypedUnits(before, water, typed);
    expect(got.stockIn).toBe("แพ็ก");
    expect(got.minIn).toBe("แพ็ก");
    expect(got.costIn).toBe("แพ็ก");
  });
  it("keeps a typed number on the unit it was typed in", () => {
    const before = { unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 750, case_unit: "", case_size: 0 };
    const got = retargetTypedUnits(before, water, { ...emptyTypedAmounts, cost: "10", costIn: "ขวด" });
    // ขวด is the stock unit now, which the form writes as "".
    expect(got.costIn).toBe("");
  });
});

describe("priceBreakdown", () => {
  it("restates the price biggest unit first", () => {
    const coconut = { unit: "ขวด", pack_unit: "ลัง", pack_size: 50, case_unit: "", case_size: 0 };
    expect(priceBreakdown(coconut, 2, "", "th")).toBe("ลังละ ฿100.00 · ขวดละ ฿2.00");
    expect(priceBreakdown(coconut, 2, "ลัง", "th")).toBe("ขวดละ ฿2.00");
  });
});

describe("stockUnitHint", () => {
  it("warns a whole-container unit about pouring", () => {
    expect(stockUnitHint("ขวด", "th")).toContain("ถ้าเทแบ่งใช้");
    expect(stockUnitHint("มิลลิลิตร", "th")).toContain("ตวงใช้");
    expect(stockUnitHint("ลูก", "th")).toBeNull();
  });
});

describe("packUnitChoices", () => {
  it("lists the containers that hold liquid first, and cases second", () => {
    const pack = packUnitChoices("มิลลิลิตร", "pack");
    expect(pack.likely[0]).toBe("ขวด");
    expect(pack.likely).not.toContain("ลัง");
    expect(pack.other).toContain("ลัง");
    const kase = packUnitChoices("มิลลิลิตร", "case", ["ขวด"]);
    expect(kase.likely).toEqual(["ลัง", "แพ็ก"]);
    expect(kase.other).not.toContain("ขวด");
  });
  it("still offers everything, just later", () => {
    const { likely, other } = packUnitChoices("กรัม", "pack");
    expect(likely.length + other.length).toBe(15);
    // A unit outside the list (an old ingredient's "หัว") gets no suggestions, only the full list.
    expect(packUnitChoices("หัว", "pack").likely).toEqual([]);
  });
});

describe("chains", () => {
  const water = { unit: "มิลลิลิตร", pack_unit: "ขวด", pack_size: 750, case_unit: "ลัง", case_size: 12 };
  it("spells the whole packaging out biggest first", () => {
    expect(packChain(water, "th")).toBe("1 ลัง = 12 ขวด = 9,000 มิลลิลิตร");
    expect(packChain({ ...water, case_unit: "", case_size: 0 }, "th")).toBe("1 ขวด = 750 มิลลิลิตร");
    expect(packChain({ ...water, pack_unit: "", pack_size: 0 }, "th")).toBeNull();
  });
  it("follows a delivery down every level", () => {
    expect(entryChain(water, 2, "ลัง", "th")).toBe("= 24 ขวด = 18,000 มิลลิลิตร");
    expect(entryChain(water, 3, "ขวด", "th")).toBe("= 2,250 มิลลิลิตร");
    expect(entryChain(water, 3, "มิลลิลิตร", "th")).toBeNull();
    expect(entryChain(water, 3, "ลิตร", "th")).toBeNull();
  });
});

describe("containers for counted stock", () => {
  it("offers packs and bags for pieces", () => {
    expect(packUnitChoices("ชิ้น", "pack").likely.slice(0, 2)).toEqual(["แพ็ก", "ถุง"]);
    expect(packUnitChoices("กล่อง", "pack").likely).toEqual(["แพ็ก", "ลัง"]);
  });
});
