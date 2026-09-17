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

/** Deliveries arrive in packs, so a sheet opens on the pack when there is one. */
export function defaultEntryUnit(item: Ingredient): string {
  if (hasPack(item) && item.unit_family?.some((option) => option.unit === item.pack_unit)) {
    return item.pack_unit as string;
  }
  return item.unit;
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
  const parts = [
    lang === "th"
      ? `รับของ 1 ${label} = ${formatNumber(holds, lang)} ${item.unit}`
      : `1 ${label} received = ${formatNumber(holds, lang)} ${item.unit}`,
  ];
  const rate = item.cost_per_unit ?? 0;
  if (rate > 0) {
    const perPack = formatCurrency(rate * (item.pack_size as number), lang, 2);
    parts.push(lang === "th" ? `${item.pack_unit}ละ ${perPack}` : `${perPack} per ${item.pack_unit}`);
  }
  return parts.join(" · ");
}

export function unitCopy(lang: "th" | "en") {
  return lang === "th"
    ? {
        groupBuy: "หน่วยซื้อ",
        buyAs: "ซื้อเป็น",
        caseAs: "หน่วยใหญ่",
        none: "ไม่มี",
        per: "ละ",
        perPack: (pack: string) => `1 ${pack} มี`,
        perCase: (kase: string) => `1 ${kase} มี`,
        buyNote: "ใส่เมื่อซื้อของเป็นภาชนะแต่สูตรใช้เป็น กรัม/มล. ตอนรับของและนับของจะกรอกเป็นภาชนะได้เลย",
        pickPack: "ซื้อเป็น",
        pickCase: "หน่วยใหญ่",
        packSizeRequired: (pack: string) => `ใส่ว่า 1 ${pack} มีเท่าไหร่`,
        caseSizeRequired: (kase: string) => `ใส่ว่า 1 ${kase} มีกี่ชิ้นย่อย`,
      }
    : {
        groupBuy: "Purchase units",
        buyAs: "Bought as",
        caseAs: "Larger unit",
        none: "None",
        per: "of",
        perPack: (pack: string) => `1 ${pack} holds`,
        perCase: (kase: string) => `1 ${kase} holds`,
        buyNote: "Set this when an ingredient is bought in containers but used by weight or volume — deliveries and counts can then be entered per container.",
        pickPack: "Bought as",
        pickCase: "Larger unit",
        packSizeRequired: (pack: string) => `Enter how much 1 ${pack} holds`,
        caseSizeRequired: (kase: string) => `Enter how many packs 1 ${kase} holds`,
      };
}
