import { useState } from "react";
import type { Ingredient } from "@/src/types/ingredient";
import { thaiShortDate } from "./mobile/inventoryMobileUtils";

/** Mirrors expiryWarningDays on the server: a lot going off within this many days is "soon". */
export const EXPIRY_WARNING_DAYS = 3;

/**
 * Default shelf life per storage type, in days from the day the delivery is
 * booked. Hardcoded for now — this is the one place to change it until the
 * restaurant settings screen grows a field for it.
 */
export const DEFAULT_SHELF_LIFE_DAYS: Record<string, number> = {
  room_temp: 2,
  chilled: 3,
  frozen: 30,
  dry: 180,
};

/** The preset chips, shortest first. */
export const SHELF_LIFE_PRESETS = Array.from(new Set(Object.values(DEFAULT_SHELF_LIFE_DAYS))).sort(
  (a, b) => a - b,
);

export function defaultShelfLifeDays(storageType?: string | null): number {
  return DEFAULT_SHELF_LIFE_DAYS[storageType ?? ""] ?? DEFAULT_SHELF_LIFE_DAYS.room_temp;
}

export function storageLabel(storageType: string | null | undefined, lang: "th" | "en"): string {
  const labels: Record<string, [string, string]> = {
    room_temp: ["อุณหภูมิห้อง", "Room temp"],
    chilled: ["แช่เย็น", "Chilled"],
    frozen: ["แช่แข็ง", "Frozen"],
    dry: ["แห้ง", "Dry"],
  };
  const entry = labels[storageType ?? ""] ?? labels.room_temp;
  return lang === "th" ? entry[0] : entry[1];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * YYYY-MM-DD `days` calendar days from `today` in the viewer's own calendar —
 * the shape the API's expires_at field takes. The server turns it into the end
 * of that day in the shop's timezone.
 */
export function expiryDateFromDays(days: number, today = new Date()): string {
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Math.max(0, Math.round(days)));
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

/**
 * Parses either shape the app handles: a bare YYYY-MM-DD (what the form sends)
 * as a local calendar day, or an RFC 3339 timestamp (what the API returns).
 * A bare date must not go through `new Date(string)`, which reads it as UTC
 * midnight and lands on the previous day west of Greenwich.
 */
export function parseExpiry(value: string): Date {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bare) return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]));
  return new Date(value);
}

export function formatExpiryDate(value: string, lang: "th" | "en"): string {
  const date = parseExpiry(value);
  if (Number.isNaN(date.getTime())) return "—";
  return thaiShortDate(date, lang);
}

/**
 * Whole calendar days from today to the date, negative once it is past. Calendar
 * days rather than 24-hour blocks: "expires tomorrow" is 1 even at 23:00.
 */
export function daysUntil(expiresAt: string | Date, today = new Date()): number {
  const target = typeof expiresAt === "string" ? parseExpiry(expiresAt) : expiresAt;
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const to = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export type ExpiryState = "none" | "ok" | "soon" | "expired";

/**
 * "expired" is decided by the timestamp, not the calendar day, so a lot dated
 * today is "soon" until the shop day actually ends — the same rule the server
 * applies when it classifies a lot.
 */
export function expiryState(expiresAt: string | null | undefined, today = new Date()): ExpiryState {
  if (!expiresAt) return "none";
  const target = parseExpiry(expiresAt);
  if (Number.isNaN(target.getTime())) return "none";
  if (target.getTime() < today.getTime()) return "expired";
  return daysUntil(target, today) <= EXPIRY_WARNING_DAYS ? "soon" : "ok";
}

export function ingredientExpiryState(item: Ingredient, today = new Date()): ExpiryState {
  return expiryState(item.expiring_lot?.expires_at, today);
}

export type ExpiryFilter = "all" | "soon" | "expired";

/**
 * "ใกล้หมดอายุ" is everything that needs attention — within the warning window
 * OR already past — because the person asking is about to walk the shelf.
 * "หมดอายุแล้ว" is the strict subset.
 */
export function matchesExpiryFilter(item: Ingredient, filter: ExpiryFilter, today = new Date()): boolean {
  if (filter === "all") return true;
  const state = ingredientExpiryState(item, today);
  if (filter === "expired") return state === "expired";
  return state === "soon" || state === "expired";
}

/**
 * Chip state shared by the web and phone pickers: `value` is days from today or
 * null for "ไม่ระบุ"; a number that is not a preset shows as "กำหนดเอง" with the
 * days typed in. Keeping this here means both pickers agree on what a tap does.
 */
export function useExpiryChoice(
  value: number | null,
  onChange: (days: number | null) => void,
  fallback: number,
) {
  const [custom, setCustom] = useState(value !== null && !SHELF_LIFE_PRESETS.includes(value));
  // "ระบุวันที่": the date printed on the package, picked from a calendar. It is
  // still stored as days from today, so everything downstream is unchanged.
  const [byDate, setByDate] = useState(false);
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const chip = value === null ? "none" : byDate ? "date" : custom ? "custom" : String(value);
  const date = value === null ? "" : expiryDateFromDays(value);
  const today = expiryDateFromDays(0);

  function pickDate(iso: string) {
    if (!iso) return;
    onChange(Math.max(0, daysUntil(iso)));
  }

  function pick(next: string) {
    if (next === "none") {
      setCustom(false);
      setByDate(false);
      onChange(null);
      return;
    }
    if (next === "date") {
      setByDate(true);
      setCustom(false);
      if (value === null) onChange(fallback);
      return;
    }
    setByDate(false);
    if (next === "custom") {
      setCustom(true);
      const typed = Number(draft);
      const days = draft !== "" && Number.isFinite(typed) ? Math.max(0, typed) : fallback;
      if (draft === "") setDraft(String(fallback));
      onChange(days);
      return;
    }
    setCustom(false);
    onChange(Number(next));
  }

  function typeDraft(raw: string) {
    setDraft(raw);
    const typed = Number(raw);
    if (raw !== "" && Number.isFinite(typed)) onChange(Math.max(0, Math.round(typed)));
  }

  return { chip, custom, byDate, date, today, draft, pick, typeDraft, pickDate };
}

export function expiryCopy(lang: "th" | "en") {
  return lang === "th"
    ? {
        label: "วันหมดอายุ",
        none: "ไม่ระบุ",
        custom: "กำหนดเอง",
        byDate: "ระบุวันที่",
        preset: (n: number) => `${n} วัน`,
        customDays: "อีก",
        dayUnit: "วัน",
        expiresOn: (date: string) => `หมดอายุ ${date}`,
        expiredOn: (date: string) => `หมดอายุแล้ว ${date}`,
        inDays: (n: number) => (n <= 0 ? "วันนี้" : n === 1 ? "พรุ่งนี้" : `อีก ${n} วัน`),
        noExpiry: "ไม่ระบุวันหมดอายุ",
        defaultHint: (n: number, storage: string) => `ค่าเริ่มต้นของ${storage} ${n} วัน`,
        filterLabel: "วันหมดอายุ",
        filterAll: "ทั้งหมด",
        filterSoon: "ใกล้หมดอายุ",
        filterExpired: "หมดอายุแล้ว",
        lots: "ล็อตที่เหลือ",
        lotReceived: (date: string) => `รับเข้า ${date}`,
        setExpiry: "ตั้งวันหมดอายุ",
        saveExpiry: "บันทึกวันหมดอายุ",
        expirySaved: "บันทึกวันหมดอายุแล้ว",
        discard: "ทิ้ง",
        discardLot: (qty: string, unit: string) => `ทิ้งล็อตนี้ (${qty} ${unit})`,
        discardTitle: "ทิ้งของในล็อตนี้?",
        discardBody: (name: string, qty: string, unit: string) =>
          `${name} ${qty} ${unit} จะถูกตัดออกจากสต็อกและบันทึกเป็นการจ่ายออก ย้อนกลับไม่ได้`,
        discarded: (qty: string, unit: string) => `ทิ้งแล้ว ${qty} ${unit}`,
        batchExpiryDefault: "ใส่วันหมดอายุตามค่าเริ่มต้นของแต่ละตัว",
        batchExpiryNone: "ไม่ระบุวันหมดอายุ",
        failed: "ทำรายการไม่สำเร็จ",
      }
    : {
        label: "Expiry date",
        none: "Not set",
        custom: "Custom",
        byDate: "Pick a date",
        preset: (n: number) => `${n} days`,
        customDays: "In",
        dayUnit: "days",
        expiresOn: (date: string) => `Expires ${date}`,
        expiredOn: (date: string) => `Expired ${date}`,
        inDays: (n: number) => (n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`),
        noExpiry: "No expiry date",
        defaultHint: (n: number, storage: string) => `${storage} default ${n} days`,
        filterLabel: "Expiry",
        filterAll: "All",
        filterSoon: "Expiring soon",
        filterExpired: "Expired",
        lots: "Open lots",
        lotReceived: (date: string) => `Received ${date}`,
        setExpiry: "Set expiry date",
        saveExpiry: "Save expiry date",
        expirySaved: "Expiry date saved",
        discard: "Discard",
        discardLot: (qty: string, unit: string) => `Discard this lot (${qty} ${unit})`,
        discardTitle: "Discard this lot?",
        discardBody: (name: string, qty: string, unit: string) =>
          `${qty} ${unit} of ${name} leaves stock as a stock-out. This cannot be undone.`,
        discarded: (qty: string, unit: string) => `Discarded ${qty} ${unit}`,
        batchExpiryDefault: "Use each item's default expiry",
        batchExpiryNone: "No expiry date",
        failed: "That did not go through",
      };
}
