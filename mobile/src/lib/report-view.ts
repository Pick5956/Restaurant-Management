// What the reports screen shows, worked out apart from how it is drawn.
// Redrawn on 15 ก.ย. 2569 (the owner chose design B): five figures on top, then
// three tabs — sales, menu, stock. The same day the owner asked for the period
// to be chosen: a preset, one day, or any range, and every figure follows it.

import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { ManagerReport, ReportSalesHour } from '@/src/types/report';

export type ReportTab = 'sales' | 'menu' | 'stock';

/** Both ends inclusive, YYYY-MM-DD in Bangkok time. */
export type ReportRange = { from: string; to: string };

/** The server refuses a longer range; the picker stops here too. */
export const REPORT_MAX_DAYS = 93;

/** One bar of the sales chart and one row of the table beside it. */
export type ReportBar = {
  key: string;
  /** Under the bar: "5" or "14". */
  axis: string;
  /** Above the chart and in the table: "5 ก.ย." or "14:00". */
  label: string;
  orders: number;
  revenue: number;
  /** Still selling: today, or the current hour. */
  open: boolean;
};

// ---------------------------------------------------------------- days

function parts(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day };
}

function isoDay(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
}

export function addDays(date: string, delta: number): string {
  const { year, month, day } = parts(date);
  return isoDay(year, month, day + delta);
}

/** Days from `from` to `to`, both counted. */
export function rangeDayCount(range: ReportRange): number {
  const a = parts(range.from);
  const b = parts(range.to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000) + 1;
}

export type ReportPreset = 'today' | 'yesterday' | 'last7' | 'last14' | 'last30' | 'thisMonth' | 'lastMonth';

export const REPORT_PRESETS: ReportPreset[] = ['today', 'yesterday', 'last7', 'last14', 'last30', 'thisMonth', 'lastMonth'];

export function presetRange(preset: ReportPreset, today: string): ReportRange {
  const { year, month } = parts(today);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const day = addDays(today, -1); return { from: day, to: day }; }
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'last14': return { from: addDays(today, -13), to: today };
    case 'last30': return { from: addDays(today, -29), to: today };
    case 'thisMonth': return { from: isoDay(year, month, 1), to: today };
    case 'lastMonth': return { from: isoDay(year, month - 1, 1), to: isoDay(year, month, 0) };
  }
}

export function presetLabel(preset: ReportPreset, language: DisplayLanguage): string {
  const th = language === 'th';
  switch (preset) {
    case 'today': return th ? 'วันนี้' : 'Today';
    case 'yesterday': return th ? 'เมื่อวาน' : 'Yesterday';
    case 'last7': return th ? '7 วันล่าสุด' : 'Last 7 days';
    case 'last14': return th ? '14 วันล่าสุด' : 'Last 14 days';
    case 'last30': return th ? '30 วันล่าสุด' : 'Last 30 days';
    case 'thisMonth': return th ? 'เดือนนี้' : 'This month';
    case 'lastMonth': return th ? 'เดือนก่อน' : 'Last month';
  }
}

/** The preset a range is, if it is one, so the chip can say "7 วันล่าสุด". */
export function matchPreset(range: ReportRange, today: string): ReportPreset | null {
  return REPORT_PRESETS.find((preset) => {
    const candidate = presetRange(preset, today);
    return candidate.from === range.from && candidate.to === range.to;
  }) ?? null;
}

/**
 * Every calendar day of the range as a bar, oldest first, a day with no sales
 * as a zero. The server only returns days that sold something, so a quiet day
 * used to vanish from the list without a word (8 ก.ย. in the owner's report).
 */
export function dayBars(salesDays: ManagerReport['sales_days'], range: ReportRange, today: string, language: DisplayLanguage): ReportBar[] {
  const count = rangeDayCount(range);
  if (!Number.isFinite(count) || count < 1) return [];
  const byDate = new Map(salesDays.map((row) => [row.order_date, row]));
  const out: ReportBar[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = addDays(range.from, offset);
    const row = byDate.get(date);
    out.push({
      key: date,
      axis: String(parts(date).day),
      label: reportDayLabel(date, language),
      orders: Number(row?.orders ?? 0),
      revenue: Number(row?.revenue ?? 0),
      open: date === today,
    });
  }
  return out;
}

/**
 * One day, hour by hour. Only the hours the shop was trading are drawn: from
 * the first sale to the last (to now, today), widened to at least 10:00–21:00
 * so a slow morning still reads as a day.
 */
export function hourBars(hours: readonly ReportSalesHour[], date: string, today: string, nowHour: number): ReportBar[] {
  const byHour = new Map(hours.map((row) => [row.hour, row]));
  const selling = hours.filter((row) => Number(row.revenue) > 0).map((row) => row.hour);
  let first = Math.min(10, ...selling);
  let last = Math.max(21, ...selling);
  if (date === today) last = Math.min(last, Math.max(nowHour, first));
  first = Math.max(0, first);
  last = Math.min(23, last);
  const out: ReportBar[] = [];
  for (let hour = first; hour <= last; hour += 1) {
    const row = byHour.get(hour);
    out.push({
      key: `${date}-${hour}`,
      axis: String(hour),
      label: `${String(hour).padStart(2, '0')}:00`,
      orders: Number(row?.orders ?? 0),
      revenue: Number(row?.revenue ?? 0),
      open: date === today && hour === nowHour,
    });
  }
  return out;
}

/** The bar that sold most, leaving out one still selling. */
export function bestBar(bars: readonly ReportBar[]): ReportBar | null {
  let best: ReportBar | null = null;
  for (const bar of bars) {
    if (bar.open || bar.revenue <= 0) continue;
    if (!best || bar.revenue > best.revenue) best = bar;
  }
  return best;
}

/** Sales per finished bar: the open one is left out, a bar with no sales is the zero it was. */
export function averagePerFinishedBar(bars: readonly ReportBar[]): number {
  const finished = bars.filter((bar) => !bar.open);
  if (!finished.length) return 0;
  return finished.reduce((sum, bar) => sum + bar.revenue, 0) / finished.length;
}

// ---------------------------------------------------------------- labels

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_TH_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const MONTHS_EN_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const year = (value: number, language: DisplayLanguage) => (language === 'th' ? value + 543 : value);

/** "5 ก.ย." */
export function reportDayLabel(date: string, language: DisplayLanguage): string {
  const { month, day } = parts(date);
  if (!month || !day) return date;
  return language === 'th' ? `${day} ${MONTHS_TH[month - 1]}` : `${MONTHS_EN[month - 1]} ${day}`;
}

/** "5 ก.ย. 2569", "2–15 ก.ย. 2569", or "28 ส.ค. – 3 ก.ย. 2569". */
export function reportRangeLabel(range: ReportRange, language: DisplayLanguage): string {
  const a = parts(range.from);
  const b = parts(range.to);
  if (!a.year || !b.year) return '';
  const months = language === 'th' ? MONTHS_TH : MONTHS_EN;
  if (range.from === range.to) {
    return language === 'th' ? `${b.day} ${months[b.month - 1]} ${year(b.year, language)}` : `${months[b.month - 1]} ${b.day}, ${year(b.year, language)}`;
  }
  if (a.year === b.year && a.month === b.month) {
    return language === 'th' ? `${a.day}–${b.day} ${months[b.month - 1]} ${year(b.year, language)}` : `${months[b.month - 1]} ${a.day}–${b.day}, ${year(b.year, language)}`;
  }
  return language === 'th'
    ? `${a.day} ${months[a.month - 1]}${a.year !== b.year ? ` ${year(a.year, language)}` : ''} – ${b.day} ${months[b.month - 1]} ${year(b.year, language)}`
    : `${months[a.month - 1]} ${a.day}${a.year !== b.year ? `, ${year(a.year, language)}` : ''} – ${months[b.month - 1]} ${b.day}, ${year(b.year, language)}`;
}

export function monthTitle(yearValue: number, month: number, language: DisplayLanguage): string {
  return language === 'th' ? `${MONTHS_TH_LONG[month - 1]} ${year(yearValue, language)}` : `${MONTHS_EN_LONG[month - 1]} ${yearValue}`;
}

// ---------------------------------------------------------------- calendar

/** A month as weeks of seven, Sunday first, days outside the month as null. */
export function calendarWeeks(yearValue: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(yearValue, month - 1, 1, 12));
  const days = new Date(Date.UTC(yearValue, month, 0, 12)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(isoDay(yearValue, month, day));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export type RangeDraft = { from: string | null; to: string | null };

/**
 * A tap on the calendar. The first tap picks a day; a second tap on a later day
 * closes the range, on an earlier day starts again there, on the same day keeps
 * it a single day. A tap after a closed range starts a new one.
 */
export function tapRangeDay(draft: RangeDraft, day: string): RangeDraft {
  if (!draft.from || draft.to) return { from: day, to: null };
  if (day < draft.from) return { from: day, to: null };
  return { from: draft.from, to: day };
}

/** What "ใช้ช่วงนี้" applies: a lone first tap is one day. */
export function draftToRange(draft: RangeDraft): ReportRange | null {
  if (!draft.from) return null;
  return { from: draft.from, to: draft.to ?? draft.from };
}

// ---------------------------------------------------------------- stock

const GRAM = new Set(['กรัม', 'ก.', 'g', 'gram', 'grams']);
const MILLILITRE = new Set(['มล.', 'มล', 'มิลลิลิตร', 'ml', 'cc', 'ซีซี']);

/**
 * An amount to buy, written the way it is bought: "14,080.58 กรัม" is
 * "14.1 กก." Grams and millilitres move up a unit from a thousand; anything
 * else keeps its unit, rounded to what a person would write down.
 */
export function readableAmount(value: number, unit: string, language: DisplayLanguage): string {
  const clean = unit.trim();
  const key = clean.toLowerCase();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const format = (amount: number, digits: number) => amount.toLocaleString(locale, { maximumFractionDigits: digits });
  if (GRAM.has(key) && value >= 1000) return `${format(value / 1000, 1)} ${language === 'th' ? 'กก.' : 'kg'}`;
  if (MILLILITRE.has(key) && value >= 1000) return `${format(value / 1000, 1)} ${language === 'th' ? 'ลิตร' : 'L'}`;
  return `${format(value, value < 10 ? 1 : 0)} ${clean}`.trim();
}

/** Out of stock first, then running low, each in the order the server sent. */
export function sortStockRisks<T extends { status: string }>(risks: readonly T[]): { out: T[]; low: T[] } {
  return {
    out: risks.filter((risk) => risk.status === 'out'),
    low: risks.filter((risk) => risk.status !== 'out'),
  };
}
