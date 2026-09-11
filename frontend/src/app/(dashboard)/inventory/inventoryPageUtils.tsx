import type { AdjustStockInput, Ingredient, IngredientInput } from "@/src/types/ingredient";
import { localeForLanguage } from "@/src/lib/format";

export const UNITS = ["กรัม", "กิโลกรัม", "มิลลิลิตร", "ลิตร", "ชิ้น", "ลูก", "ฟอง", "ใบ", "แผ่น", "ขวด", "แพ็ก", "ถุง", "กล่อง"];
export const STORAGE_TYPES = ["room_temp", "chilled", "frozen", "dry"];

export const emptyForm: IngredientInput = {
  name: "",
  category_id: 0,
  unit: "กิโลกรัม",
  stock: 0,
  min_stock: 0,
  min_percent: 0,
  cost_per_unit: 0,
  storage_type: "room_temp",
};

/** The quantity a percentage of the shelf's maximum works out to. */
export function reorderQuantityFor(maxStock: number, percent: number): number {
  if (!(maxStock > 0) || !(percent > 0)) return 0;
  return Math.round(((maxStock * percent) / 100) * 10000) / 10000;
}

export type StockStatus = "all" | "ok" | "low" | "out";
export type ItemStatus = Exclude<StockStatus, "all">;

export function getStatus(item: Ingredient): ItemStatus {
  if (item.stock === 0) return "out";
  if (item.min_stock > 0 && item.stock <= item.min_stock) return "low";
  return "ok";
}

/**
 * How many days of cover the bar treats as a full tank. A restaurant that buys
 * once a week only needs the bar to answer "do I get to the next delivery?", so
 * anything past a week is equally fine and reads as full.
 */
export const FULL_COVER_DAYS = 7;

/**
 * How full the shelf is, as a share of the most it has been proved to hold.
 *
 * There was no ceiling to divide by until max_stock existed, so this used to
 * answer a different question — how many days of cover, against a week — and
 * the phone answered a third one. Three screens, three meanings of the same
 * bar. Now both divide by the same observed number, and the bar means the same
 * thing wherever it is drawn.
 *
 * Returns null when nothing has been observed yet (a brand new ingredient that
 * has never been stocked). Callers must render that as "no data" rather than as
 * an empty bar, which would read as "we are out".
 */
export function getStockPercent(item: Ingredient): number | null {
  const ceiling = item.max_stock ?? 0;
  if (ceiling <= 0) return null;
  if (item.stock <= 0) return 0;
  return Math.min(100, Math.round((item.stock / ceiling) * 100));
}

/**
 * Where the reorder mark sits along that bar, 0-100, or null when the mark
 * would land off the end — which is what a reorder level above the observed
 * maximum means, and drawing it at 100% would claim the shelf is always short.
 */
export function getReorderPercent(item: Ingredient): number | null {
  const ceiling = item.max_stock ?? 0;
  if (ceiling <= 0 || item.min_stock <= 0) return null;
  if (item.min_stock >= ceiling) return null;
  return Math.round((item.min_stock / ceiling) * 100);
}

/** Rounds the cover figure the way it is spoken: "2 วัน", "7 วัน+". */
export function formatDaysLeft(item: Ingredient, lang: "th" | "en"): string | null {
  if (item.days_left === undefined || item.days_left === null) return null;
  if (item.days_left >= FULL_COVER_DAYS) {
    return lang === "th" ? `พอใช้ ${FULL_COVER_DAYS} วัน+` : `${FULL_COVER_DAYS}+ days left`;
  }
  const days = Math.max(0, Math.round(item.days_left * 10) / 10);
  return lang === "th" ? `พอใช้ ${days} วัน` : `${days} days left`;
}

/**
 * What a restock is aimed at: filling the shelf back to the most it has held.
 * The old answer was twice the reorder level, which nobody chose — it was a
 * stand-in from before there was an observed maximum to aim at.
 */
export function getTargetStock(item: Ingredient) {
  const ceiling = item.max_stock ?? 0;
  if (ceiling > 0) return ceiling;
  return item.min_stock > 0 ? item.min_stock * 2 : Math.max(item.stock, 1);
}

export function getInventoryValue(item: Ingredient) {
  return item.stock * item.cost_per_unit;
}

export function buildAdjustStockPayload({
  type,
  quantity,
  unit,
  note,
  paidAmount,
  canManageExpenses,
}: {
  type: AdjustStockInput["type"];
  quantity: number;
  unit?: string;
  note: string;
  paidAmount: string;
  canManageExpenses: boolean;
}): AdjustStockInput {
  const payload: AdjustStockInput = { type, quantity, note };
  // Only send a unit when it differs from what the ingredient stores; an empty
  // unit already means "the ingredient's own", and sending it adds nothing.
  if (unit && unit.trim()) payload.unit = unit.trim();
  const amount = Number(paidAmount);
  if (type === "in" && canManageExpenses && paidAmount.trim() !== "" && Number.isFinite(amount) && amount > 0) {
    payload.amount = amount;
  }
  return payload;
}

export function formatDateTime(value: string | undefined, language: "th" | "en") {
  if (!value) return language === "th" ? "ยังไม่มีข้อมูล" : "No update yet";
  return new Date(value).toLocaleString(localeForLanguage(language), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const inputCls =
  "h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder-gray-400 outline-none transition focus:border-orange-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500";
