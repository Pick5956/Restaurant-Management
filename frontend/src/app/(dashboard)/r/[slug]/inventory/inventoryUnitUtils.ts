import type { Ingredient, IngredientUnitOption } from "@/src/types/ingredient";
import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";

/**
 * Containers a raw ingredient is bought in. Offered as purchase units only —
 * each one's size is typed per ingredient, because a ขวด of fish sauce and a
 * ขวด of soda are not the same amount. The server refuses any of these that
 * already converts to the stock unit.
 */
export const PACK_UNITS = [
  "ขวด",
  "กระป๋อง",
  "แกลลอน",
  "ถัง",
  "ปี๊บ",
  "แพ็ก",
  "ห่อ",
  "ซอง",
  "ถุง",
  "กระสอบ",
  "กล่อง",
  "ลัง",
  "แผง",
  "กำ",
  "มัด",
];

/**
 * Which containers usually hold which kind of stock. Nothing is refused by
 * this — a crate of frozen chicken really is a ลัง holding grams directly —
 * it only decides what a picker lists first. The stock unit the recipe
 * consumes says what kind of thing the ingredient is.
 */
const LIKELY_CONTAINERS: Record<"volume" | "mass" | "egg" | "container" | "other", { pack: string[]; case: string[] }> = {
  volume: { pack: ["ขวด", "กระป๋อง", "ถุง", "แกลลอน", "ถัง", "ปี๊บ", "กล่อง"], case: ["ลัง", "แพ็ก"] },
  mass: { pack: ["ถุง", "ห่อ", "ซอง", "กระสอบ", "กล่อง", "ถัง", "ลัง"], case: ["ลัง", "กระสอบ"] },
  egg: { pack: ["แผง"], case: ["ลัง"] },
  container: { pack: ["แพ็ก", "ลัง"], case: ["ลัง"] },
  other: { pack: [], case: [] },
};

function stockKind(unit: string): keyof typeof LIKELY_CONTAINERS {
  if (unit === "มิลลิลิตร" || unit === "ลิตร") return "volume";
  if (unit === "กรัม" || unit === "กิโลกรัม") return "mass";
  if (unit === "ฟอง") return "egg";
  if (unit === "ขวด" || unit === "กระป๋อง") return "container";
  return "other";
}

/**
 * The containers a picker offers for one level, split into the ones that
 * usually hold this kind of stock and the rest. `exclude` drops units already
 * taken by another level (the stock unit, the pack when picking a case).
 */
export function packUnitChoices(
  stockUnit: string,
  level: "pack" | "case",
  exclude: string[] = [],
): { likely: string[]; other: string[] } {
  const taken = new Set([stockUnit, ...exclude].filter(Boolean));
  const likely = LIKELY_CONTAINERS[stockKind(stockUnit)][level].filter((unit) => !taken.has(unit));
  const other = PACK_UNITS.filter((unit) => !taken.has(unit) && !likely.includes(unit));
  return { likely, other };
}

/**
 * The whole chain in one line, biggest unit first, so a wrong number is seen
 * where it was typed: "1 ลัง = 12 ขวด = 9,000 มิลลิลิตร".
 */
export function packChain(item: PackShape, lang: "th" | "en"): string | null {
  if (!hasPack(item)) return null;
  const pack = `1 ${item.pack_unit} = ${formatNumber(item.pack_size as number, lang)} ${item.unit}`;
  if (!hasCase(item)) return pack;
  const total = (item.case_size as number) * (item.pack_size as number);
  return `1 ${item.case_unit} = ${formatNumber(item.case_size as number, lang)} ${item.pack_unit} = ${formatNumber(total, lang)} ${item.unit}`;
}

/**
 * What an amount typed in a purchase unit comes to, every level down:
 * "= 24 ขวด = 18,000 มิลลิลิตร" for 2 ลัง. Null when the amount is already in
 * the stock unit, or the unit is not one of this ingredient's containers.
 */
export function entryChain(item: PackShape, amount: number, unit: string, lang: "th" | "en"): string | null {
  if (!Number.isFinite(amount) || !unit || unit === item.unit) return null;
  if (hasCase(item) && unit === item.case_unit) {
    const packs = amount * (item.case_size as number);
    return `= ${formatNumber(packs, lang)} ${item.pack_unit} = ${formatNumber(packs * (item.pack_size as number), lang)} ${item.unit}`;
  }
  if (hasPack(item) && unit === item.pack_unit) {
    return `= ${formatNumber(amount * (item.pack_size as number), lang)} ${item.unit}`;
  }
  return null;
}

/** The measuring units worth offering as chips beside a shelf's own unit. */
const EVERYDAY_UNITS = new Set(["กรัม", "กิโลกรัม", "มิลลิลิตร", "ลิตร"]);

type PackShape = Pick<Ingredient, "unit" | "pack_unit" | "pack_size" | "case_unit" | "case_size">;

export function hasPack(item: PackShape): boolean {
  return Boolean(item.pack_unit) && (item.pack_size ?? 0) > 0;
}

export function hasCase(item: PackShape): boolean {
  return hasPack(item) && Boolean(item.case_unit) && (item.case_size ?? 0) > 0;
}

/**
 * How many stock units one `unit` holds, read from the server's unit_family so
 * the client never keeps a conversion table of its own. null when the unit is
 * not one this ingredient accepts.
 */
export function stockPerEntryUnit(item: Ingredient, unit: string): number | null {
  if (!unit || unit === item.unit) return 1;
  return item.unit_family?.find((option) => option.unit === unit)?.stock_per_unit ?? null;
}

/**
 * Units offered as chips when receiving or counting: the shelf's own unit, the
 * everyday kilogram/litre siblings, and the purchase units. Ounces and tonnes
 * stay reachable on the web picker but would only crowd a phone.
 */
export function entryUnitOptions(item: Ingredient): IngredientUnitOption[] {
  const family = item.unit_family ?? [];
  const purchase = new Set([item.pack_unit, item.case_unit].filter(Boolean));
  const picked = family.filter(
    (option) => option.unit === item.unit || EVERYDAY_UNITS.has(option.unit) || purchase.has(option.unit),
  );
  return picked.length > 0 ? picked : [{ unit: item.unit, stock_per_unit: 1 }];
}

/**
 * The biggest container this ingredient is packaged in — the case when one is
 * set, else the pack, else the stock unit. It is how a delivery arrives: if a
 * ลัง is defined at all, the ingredient is bought by the ลัง.
 */
export function largestPurchaseUnit(item: PackShape): string {
  if (hasCase(item)) return item.case_unit as string;
  if (hasPack(item)) return item.pack_unit as string;
  return item.unit;
}

/**
 * A restock opens on the biggest container, because that is what was just
 * carried in. A count opens on the pack, because a shelf is counted a bottle
 * at a time even when it was delivered by the case.
 */
export function defaultEntryUnit(item: Ingredient, purpose: "restock" | "count" = "restock"): string {
  const offered = (unit: string) => item.unit_family?.some((option) => option.unit === unit) ?? false;
  const wanted = purpose === "restock" ? largestPurchaseUnit(item) : hasPack(item) ? (item.pack_unit as string) : item.unit;
  return wanted !== item.unit && offered(wanted) ? wanted : item.unit;
}

/** Restates an amount when the unit chip changes, so the quantity on screen stays the same stuff. */
export function convertEntryAmount(amount: number, fromFactor: number, toFactor: number): number {
  if (!(toFactor > 0) || !Number.isFinite(amount)) return amount;
  return Math.round(((amount * fromFactor) / toFactor) * 10000) / 10000;
}

/** "≈ 5.5 ขวด" — the stock read in the unit people count shelves in. */
export function formatPackCount(item: Ingredient, lang: "th" | "en"): string | null {
  if (!hasPack(item) || item.stock <= 0) return null;
  const packs = Math.round((item.stock / (item.pack_size as number)) * 10) / 10;
  return `≈ ${formatNumber(packs, lang)} ${item.pack_unit}`;
}

/** "ขวดละ 700 มิลลิลิตร · ลังละ 12 ขวด" */
export function packSummary(item: PackShape, lang: "th" | "en"): string | null {
  if (!hasPack(item)) return null;
  const pack =
    lang === "th"
      ? `${item.pack_unit}ละ ${formatNumber(item.pack_size as number, lang)} ${item.unit}`
      : `${formatNumber(item.pack_size as number, lang)} ${item.unit} per ${item.pack_unit}`;
  if (!hasCase(item)) return pack;
  const kase =
    lang === "th"
      ? `${item.case_unit}ละ ${formatNumber(item.case_size as number, lang)} ${item.pack_unit}`
      : `${formatNumber(item.case_size as number, lang)} ${item.pack_unit} per ${item.case_unit}`;
  return `${pack} · ${kase}`;
}

/**
 * What the form's numbers mean in practice, shown under the purchase-unit
 * fields: "รับของ 1 ลัง = 8,400 มิลลิลิตร · ขวดละ ฿35".
 */
export function packExample(item: PackShape & { cost_per_unit?: number }, lang: "th" | "en"): string | null {
  if (!hasPack(item)) return null;
  const big = hasCase(item);
  const label = big ? (item.case_unit as string) : (item.pack_unit as string);
  const holds = big ? (item.case_size as number) * (item.pack_size as number) : (item.pack_size as number);
  void big;
  void label;
  void holds;
  const parts = [packChain(item, lang) as string];
  const rate = item.cost_per_unit ?? 0;
  if (rate > 0) {
    const perPack = formatCurrency(rate * (item.pack_size as number), lang, 2);
    parts.push(lang === "th" ? `${item.pack_unit}ละ ${perPack}` : `${perPack} per ${item.pack_unit}`);
  }
  return parts.join(" · ");
}

/**
 * How many stock units one `unit` holds, from the form's own pack fields — the
 * form is editing them, so the server's unit_family is not current yet. "" and
 * the stock unit are 1; a unit the shape does not have is null.
 */
export function purchaseFactor(shape: PackShape, unit: string): number | null {
  if (!unit || unit === shape.unit) return 1;
  if (hasPack(shape) && unit === shape.pack_unit) return shape.pack_size as number;
  if (hasCase(shape) && unit === shape.case_unit) {
    return (shape.case_size as number) * (shape.pack_size as number);
  }
  return null;
}

/** The units a number on the form may be typed in: the stock unit, then pack, then case. */
export function purchaseUnitChoices(shape: PackShape): string[] {
  const units = [shape.unit];
  if (hasPack(shape)) units.push(shape.pack_unit as string);
  if (hasCase(shape)) units.push(shape.case_unit as string);
  return units;
}

/**
 * The three numbers the ingredient form collects, exactly as typed, with the
 * unit each was typed in ("" = the stock unit). They stay as typed so that
 * picking another unit or changing a pack size re-reads them instead of
 * silently rescaling what the person entered.
 */
export type TypedAmounts = {
  stock: string;
  min: string;
  cost: string;
  stockIn: string;
  minIn: string;
  costIn: string;
};

/**
 * A price "unit" meaning "what I paid for the whole opening stock". The price
 * per stock unit is then that total over the opening quantity — the number on
 * the receipt, with no division left to the person.
 */
export const TOTAL_PRICE = "__total__";

export const emptyTypedAmounts: TypedAmounts = { stock: "", min: "", cost: "", stockIn: "", minIn: "", costIn: "" };

function typedNumber(raw: string): number {
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * What the typed numbers mean in the stock unit — the only unit the server
 * stores. Quantities multiply by the unit's size; a price divides by it, since
 * "แผงละ 100" is 5 a ฟอง when a แผง holds 20.
 */
export function resolveTypedAmounts(
  shape: PackShape,
  typed: TypedAmounts,
): { stock: number; min_stock: number; cost_per_unit: number } {
  const factor = (unit: string) => purchaseFactor(shape, unit) ?? 1;
  const stock = typedNumber(typed.stock) * factor(typed.stockIn);
  const cost =
    typed.costIn === TOTAL_PRICE
      ? stock > 0
        ? typedNumber(typed.cost) / stock
        : 0
      : typedNumber(typed.cost) / factor(typed.costIn);
  return {
    stock,
    min_stock: typedNumber(typed.min) * factor(typed.minIn),
    cost_per_unit: cost,
  };
}

/**
 * Keeps each field's unit valid after the pack fields change: a unit that no
 * longer exists falls back to the pack (or the stock unit), and whenever a
 * pack is set or swapped for another, every still-empty field switches to it —
 * people count shelves and remember prices by the แผง, not the ฟอง. A field
 * that already holds a number keeps its unit, so setting a pack never changes
 * what a typed number means.
 *
 * "Swapped" matters: set ขวด as the pack of a ml shelf, then make ขวด the stock
 * unit and แพ็ก the pack. The fields were on ขวด, which still exists — as the
 * stock unit now — so a first-pack-only rule left the price on ขวด.
 */
export function retargetTypedUnits(before: PackShape, after: PackShape, typed: TypedAmounts): TypedAmounts {
  const valid = new Set(purchaseUnitChoices(after));
  const fallback = hasPack(after) ? (after.pack_unit as string) : "";
  const next = { ...typed };
  const pairs = [
    ["stockIn", "stock"],
    ["minIn", "min"],
    ["costIn", "cost"],
  ] as const;
  const newPack = hasPack(after) && (!hasPack(before) || before.pack_unit !== after.pack_unit);
  const newCase = hasCase(after) && (!hasCase(before) || before.case_unit !== after.case_unit);
  for (const [unitKey, textKey] of pairs) {
    if (next[unitKey] === TOTAL_PRICE) continue;
    if (next[unitKey] === after.unit) next[unitKey] = "";
    if (next[unitKey] && !valid.has(next[unitKey])) next[unitKey] = fallback;
    if (newPack && typedNumber(next[textKey]) === 0) next[unitKey] = after.pack_unit as string;
  }
  // Opening stock is a delivery, so an untouched box follows the biggest
  // container the moment one exists. The reorder level and price stay on the
  // pack — a shelf is counted, and a price remembered, per bottle.
  if ((newPack || newCase) && typedNumber(next.stock) === 0) next.stockIn = largestPurchaseUnit(after);
  return next;
}

/**
 * "ลังละ ฿100.00 · ขวดละ ฿2.00" — the price per stock unit restated in every
 * unit the ingredient has, biggest first, so it can be checked against a shelf
 * tag. `except` drops the unit the price was typed in, which needs no echo.
 */
export function priceBreakdown(
  shape: PackShape,
  costPerUnit: number,
  except: string,
  lang: "th" | "en",
): string {
  const copy = unitCopy(lang);
  return purchaseUnitChoices(shape)
    .slice()
    .reverse()
    .filter((unit) => unit !== except)
    .map((unit) => copy.pricePerUnit(unit, formatCurrency(costPerUnit * (purchaseFactor(shape, unit) ?? 1), lang, 2)))
    .join(" · ");
}

/**
 * The line under the stock-unit picker. The unit is what a recipe deducts, and
 * the one mistake worth catching early is a container picked for something
 * poured a little at a time — fish sauce by the ขวด cannot take "15 มล." in a
 * recipe. The form does not refuse it (nothing on it says whether a thing is
 * poured or used whole); it says so while it is still cheap to change.
 */
export function stockUnitHint(unit: string, lang: "th" | "en"): string | null {
  const th = lang === "th";
  switch (unit) {
    case "กรัม":
    case "กิโลกรัม":
      return th
        ? "ชั่งใช้ เช่น หมูสับ ผัก · สูตรใส่เป็นกรัมหรือกิโลกรัมก็ได้"
        : "Weighed out, e.g. minced pork · recipes may use grams or kilograms";
    case "มิลลิลิตร":
    case "ลิตร":
      return th
        ? "ตวงใช้ เช่น น้ำปลา กะทิ · ถ้าซื้อมาเป็นขวด ตั้งหน่วยซื้อด้านล่าง"
        : "Poured, e.g. fish sauce · bought in bottles? set a purchase unit below";
    case "ฟอง":
      return th ? "นับเป็นฟอง เช่น ไข่" : "Counted one by one, e.g. eggs";
    case "ขวด":
    case "กระป๋อง":
      return th
        ? `ใช้ทั้ง${unit} เช่น น้ำดื่ม โค้ก · ถ้าเทแบ่งใช้ ให้เลือกมิลลิลิตรแล้วตั้งหน่วยซื้อเป็น${unit}`
        : `Used a whole ${unit} at a time, e.g. water · poured a little at a time? pick ml and buy by the ${unit}`;
    default:
      return null;
  }
}

/** A number for a text box: no trailing zeros, at most four decimals. */
export function typedText(value: number, decimals = 4): string {
  if (!(value > 0)) return "";
  return String(Math.round(value * 10 ** decimals) / 10 ** decimals);
}

export function unitCopy(lang: "th" | "en") {
  return lang === "th"
    ? {
        groupBuy: "บรรจุภัณฑ์",
        buyAs: "บรรจุใน",
        caseAs: "รวมเป็น",
        likelyFor: (unit: string) => `ที่ใช้บ่อยกับ${unit}`,
        otherUnits: "อื่น ๆ",
        none: "ไม่มี",
        per: "ละ",
        perPack: (pack: string) => `1 ${pack} =`,
        perCase: (kase: string) => `1 ${kase} =`,
        buyNote: "ภาชนะที่ใส่ของนี้โดยตรง เช่น ขวด ถุง · ถ้ามาเป็นลังอีกชั้น ใส่ที่ \"รวมเป็น\" · ตอนรับของและนับของจะกรอกเป็นภาชนะได้เลย",
        pickPack: "บรรจุใน",
        pickCase: "รวมเป็น",
        price: "ราคา (THB)",
        perWord: "ต่อ",
        inStockUnit: (amount: string, unit: string) => `= ${amount} ${unit}`,
        pricePerStockUnit: (unit: string, price: string) => `= ${unit}ละ ${price}`,
        pricePerUnit: (unit: string, price: string) => `${unit}ละ ${price}`,
        totalPaidFor: (amount: string, unit: string) => `จ่ายไปทั้งหมดสำหรับ ${amount} ${unit} (THB)`,
        totalPaid: "จ่ายไปทั้งหมด",
        totalFor: (amount: string, unit: string) => `สำหรับ ${amount} ${unit}`,
        baht: "บาท",
        stockUnitLabel: "เมนูตัดสต็อกเป็น",
        warnLine: (amount: string, unit: string, inStock: string | null, max: string) =>
          `จะเตือนเมื่อเหลือ ${amount} ${unit}${inStock ? ` (${inStock})` : ""} · เต็ม ${max} ${unit}`,
        minNeedsStock: (editing: boolean) =>
          editing
            ? "ยังไม่เคยมีของเข้า ตั้งจุดแจ้งเตือนได้หลังเติมสต็อกครั้งแรก"
            : "ใส่จำนวนเริ่มต้นก่อน ถึงจะตั้งจุดแจ้งเตือนได้",
        pickEntryUnit: "เลือกหน่วย",
        packSizeRequired: (pack: string) => `ใส่ว่า 1 ${pack} มีเท่าไหร่`,
        caseSizeRequired: (kase: string) => `ใส่ว่า 1 ${kase} มีกี่ชิ้นย่อย`,
      }
    : {
        groupBuy: "Packaging",
        buyAs: "Packed in",
        caseAs: "Grouped as",
        likelyFor: (unit: string) => `Usual for ${unit}`,
        otherUnits: "Other",
        none: "None",
        per: "of",
        perPack: (pack: string) => `1 ${pack} =`,
        perCase: (kase: string) => `1 ${kase} =`,
        buyNote: "The container this is packed in directly (bottle, bag). If those come in a case, set it under \"Grouped as\". Deliveries and counts can then be entered per container.",
        pickPack: "Packed in",
        pickCase: "Grouped as",
        price: "Price (THB)",
        perWord: "per",
        inStockUnit: (amount: string, unit: string) => `= ${amount} ${unit}`,
        pricePerStockUnit: (unit: string, price: string) => `= ${price} per ${unit}`,
        pricePerUnit: (unit: string, price: string) => `${price} per ${unit}`,
        totalPaidFor: (amount: string, unit: string) => `Total paid for ${amount} ${unit} (THB)`,
        totalPaid: "Total paid",
        totalFor: (amount: string, unit: string) => `for ${amount} ${unit}`,
        baht: "THB",
        stockUnitLabel: "Menus deduct in",
        warnLine: (amount: string, unit: string, inStock: string | null, max: string) =>
          `warns at ${amount} ${unit}${inStock ? ` (${inStock})` : ""} · full at ${max} ${unit}`,
        minNeedsStock: (editing: boolean) =>
          editing
            ? "Nothing received yet — set this after the first restock"
            : "Enter the opening stock first to set the reorder level",
        pickEntryUnit: "Pick a unit",
        packSizeRequired: (pack: string) => `Enter how much 1 ${pack} holds`,
        caseSizeRequired: (kase: string) => `Enter how many packs 1 ${kase} holds`,
      };
}
