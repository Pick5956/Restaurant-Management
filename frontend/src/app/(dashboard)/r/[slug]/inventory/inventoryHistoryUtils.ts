import type { IngredientTransaction, TransactionType } from "@/src/types/ingredient";

export const HISTORY_PAGE_SIZE = 50;
export const HISTORY_DEFAULT_DAYS = 30;

/**
 * YYYY-MM-DD in the viewer's own timezone. toISOString() would convert to UTC
 * first, which lands on the previous day for any Bangkok evening.
 */
export function toDateInput(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The history opens on the last 30 days rather than everything ever recorded. */
export function defaultHistoryRange(today: Date = new Date()) {
  const from = new Date(today);
  from.setDate(from.getDate() - (HISTORY_DEFAULT_DAYS - 1));
  return { from: toDateInput(from), to: toDateInput(today) };
}

export type HistoryMovement = {
  /** Signed change in stock, or null for an absolute set. */
  change: number | null;
  /** The level stock was set to, or null for an ordinary movement. */
  setTo: number | null;
};

/**
 * "adjust" sets an absolute level rather than moving stock by an amount, so it
 * never lands in the change column — a running total that mixed a target level
 * in with the ins and outs would be silently wrong.
 */
export function historyMovement(tx: Pick<IngredientTransaction, "type" | "quantity">): HistoryMovement {
  if (tx.type === "adjust") {
    return { change: null, setTo: tx.quantity };
  }
  return { change: tx.type === "out" ? -tx.quantity : tx.quantity, setTo: null };
}

export function historyPageCount(total: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.max(1, Math.ceil(total / limit));
}

/**
 * The ranges an owner actually asks for.
 *
 * Two date fields make every question a subtraction: to see the last week you
 * work out what day it was seven days ago and type it. People think in "the
 * last 7 days" and "this month", so those are the buttons; the fields stay
 * underneath for the rare odd window.
 *
 * "all" is an empty range on purpose — transactionParams() omits an empty from
 * or to, which is exactly "no bound" to the API.
 */
export type HistoryRangeKey = "7d" | "30d" | "month" | "all" | "custom";

/** Every preset except "custom", in the order they are offered. */
export const HISTORY_RANGE_PRESETS: Exclude<HistoryRangeKey, "custom">[] = ["7d", "30d", "month", "all"];

export function historyRangeFor(key: Exclude<HistoryRangeKey, "custom">, today: Date = new Date()) {
  if (key === "all") return { from: "", to: "" };
  if (key === "month") {
    return { from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateInput(today) };
  }
  const days = key === "7d" ? 7 : HISTORY_DEFAULT_DAYS;
  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));
  return { from: toDateInput(from), to: toDateInput(today) };
}

/** Which preset a range corresponds to, or "custom" when it matches none. */
export function historyRangeKeyOf(from: string, to: string, today: Date = new Date()): HistoryRangeKey {
  for (const key of HISTORY_RANGE_PRESETS) {
    const preset = historyRangeFor(key, today);
    if (preset.from === from && preset.to === to) return key;
  }
  return "custom";
}

export function historyRangeLabel(key: Exclude<HistoryRangeKey, "custom">, lang: "th" | "en"): string {
  const labels: Record<string, [string, string]> = {
    "7d": ["7 วัน", "7 days"],
    "30d": ["30 วัน", "30 days"],
    month: ["เดือนนี้", "This month"],
    all: ["ทั้งหมด", "All time"],
  };
  const pair = labels[key];
  return lang === "th" ? pair[0] : pair[1];
}

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "13 ส.ค. – 11 ก.ย." — short enough to sit on a toolbar button, and the year
 * appears only when the range crosses one, where leaving it out would be a lie.
 * Thai years are Buddhist, matching the date shown in every row of the table.
 */
export function formatHistoryRange(from: string, to: string, lang: "th" | "en"): string {
  if (!from && !to) return lang === "th" ? "ทุกช่วงเวลา" : "All time";
  const months = lang === "th" ? THAI_MONTHS : EN_MONTHS;
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return null;
    return { year, month, day };
  };
  const start = parse(from);
  const end = parse(to);
  const crossesYear = start && end ? start.year !== end.year : false;
  const show = (parts: { year: number; month: number; day: number } | null) => {
    if (!parts) return "";
    const head = `${parts.day} ${months[parts.month - 1]}`;
    if (!crossesYear) return head;
    return `${head} ${lang === "th" ? parts.year + 543 : parts.year}`;
  };
  if (start && !end) return `${lang === "th" ? "ตั้งแต่" : "From"} ${show(start)}`;
  if (!start && end) return `${lang === "th" ? "ถึง" : "Until"} ${show(end)}`;
  return `${show(start)} – ${show(end)}`;
}

export const HISTORY_TYPES: (TransactionType | "")[] = ["", "in", "out", "adjust"];

export function historyTypeLabel(type: TransactionType | "", lang: "th" | "en"): string {
  const labels: Record<string, [string, string]> = {
    "": ["ทุกประเภท", "All types"],
    in: ["เข้า", "In"],
    out: ["ออก", "Out"],
    adjust: ["ตั้งค่า", "Set"],
  };
  const pair = labels[type];
  if (!pair) return type;
  return lang === "th" ? pair[0] : pair[1];
}
