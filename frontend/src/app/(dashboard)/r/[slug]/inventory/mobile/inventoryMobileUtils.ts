import type { Ingredient } from "@/src/types/ingredient";
import { getStatus, type ItemStatus } from "../inventoryPageUtils";

const THAI_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

/**
 * Formatted by hand rather than through toLocaleDateString("th-TH"): the locale
 * API prints the Buddhist year as "BE 2569" on iOS Safari, which is not how
 * anyone writes a date in Thai. Shop dates read "2 ก.ย. 69".
 */
export function thaiShortDate(date: Date, lang: "th" | "en"): string {
  if (lang === "en") {
    return date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "2-digit" });
  }
  const year = (date.getFullYear() + 543) % 100;
  return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${String(year).padStart(2, "0")}`;
}

/** Same calendar day in the viewer's own timezone. */
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function dayHeading(date: Date, lang: "th" | "en", today = new Date()): string {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const stamp = thaiShortDate(date, lang);
  if (sameDay(date, today)) return lang === "th" ? `วันนี้ · ${stamp}` : `Today · ${stamp}`;
  if (sameDay(date, yesterday)) return lang === "th" ? `เมื่อวาน · ${stamp}` : `Yesterday · ${stamp}`;
  return stamp;
}

export type StatusTone = {
  /** Text and number colour. */
  text: string;
  /** Level-bar fill. */
  bar: string;
  /** Badge background. */
  badge: string;
  label: string;
};

export function statusTone(status: ItemStatus, lang: "th" | "en"): StatusTone {
  switch (status) {
    case "out":
      return {
        text: "text-(--inv-out)",
        bar: "bg-(--inv-out)",
        badge: "bg-(--inv-out-soft) text-(--inv-out)",
        label: lang === "th" ? "หมด" : "Out",
      };
    case "low":
      return {
        text: "text-(--inv-low)",
        bar: "bg-(--inv-low)",
        badge: "bg-(--inv-low-soft) text-(--inv-low)",
        label: lang === "th" ? "ใกล้หมด" : "Low",
      };
    default:
      return {
        text: "text-(--inv-heading)",
        bar: "bg-(--inv-ok)",
        badge: "bg-(--inv-ok-soft) text-(--inv-ok)",
        label: lang === "th" ? "พอใช้" : "OK",
      };
  }
}

export type SortKey = "recent" | "urgent" | "name" | "value";

/**
 * "ด่วนก่อน" ranks by how soon the shelf empties, not by raw quantity: out
 * first, then low, and inside each bucket the one with the least cover leads.
 * An ingredient with no usage history sorts last in its bucket — nothing is
 * known about when it runs out.
 */
export function sortIngredients(items: Ingredient[], key: SortKey): Ingredient[] {
  const copy = [...items];
  // "ล่าสุด" is the default: the row that just moved — a restock, or the kitchen
  // using it up — is the one the owner is most likely looking for. UpdatedAt is
  // bumped by every stock write (kitchen deduction, restock, the daily seeder),
  // so it is a truthful "last moved" without a second query. It also moves on a
  // name/price edit, which is close enough to "recently changed" to keep.
  if (key === "recent") {
    return copy.sort((a, b) => {
      const left = a.UpdatedAt ? Date.parse(a.UpdatedAt) : 0;
      const right = b.UpdatedAt ? Date.parse(b.UpdatedAt) : 0;
      if (left !== right) return right - left;
      return a.name.localeCompare(b.name, "th");
    });
  }
  if (key === "name") return copy.sort((a, b) => a.name.localeCompare(b.name, "th"));
  if (key === "value") {
    return copy.sort((a, b) => b.stock * b.cost_per_unit - a.stock * a.cost_per_unit);
  }
  const rank = (item: Ingredient) => {
    const status = getStatus(item);
    return status === "out" ? 0 : status === "low" ? 1 : 2;
  };
  return copy.sort((a, b) => {
    const byStatus = rank(a) - rank(b);
    if (byStatus !== 0) return byStatus;
    const left = a.days_left ?? Number.POSITIVE_INFINITY;
    const right = b.days_left ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name, "th");
  });
}

export function inventoryTotals(items: Ingredient[]) {
  let value = 0;
  let low = 0;
  let out = 0;
  for (const item of items) {
    value += item.stock * item.cost_per_unit;
    const status = getStatus(item);
    if (status === "low") low += 1;
    if (status === "out") out += 1;
  }
  return { value, low, out, all: items.length, needsOrder: low + out };
}

/** Step size for the restock stepper: a tenth of the reorder level, rounded. */
export function restockStep(item: Ingredient): number {
  const base = item.min_stock > 0 ? item.min_stock / 10 : Math.max(1, item.stock / 10);
  if (base >= 100) return Math.round(base / 50) * 50 || 50;
  if (base >= 10) return Math.round(base / 5) * 5 || 5;
  return Math.max(1, Math.round(base));
}
