// What the reports screen shows, worked out apart from how it is drawn.
// Redrawn on 15 ก.ย. 2569 (the owner chose design B): five figures on top, then
// three tabs — sales, menu, stock.

import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { ManagerReport } from '@/src/types/report';

export type ReportTab = 'sales' | 'menu' | 'stock';

export type ReportDay = {
  date: string;
  orders: number;
  revenue: number;
  /** Today, which has not finished selling yet. */
  today: boolean;
};

function isoDay(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  return value.toISOString().slice(0, 10);
}

/**
 * Every calendar day of the window, oldest first, a day with no sales included
 * as a zero. The server only returns days that sold something, so a quiet day
 * used to vanish from the list without a word (8 ก.ย. in the owner's report).
 */
export function fillReportDays(salesDays: ManagerReport['sales_days'], days: number, today: string): ReportDay[] {
  const [year, month, day] = today.split('-').map(Number);
  if (!year || !month || !day || days < 1) return [];
  const byDate = new Map(salesDays.map((row) => [row.order_date, row]));
  const out: ReportDay[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = isoDay(year, month, day - offset);
    const row = byDate.get(date);
    out.push({ date, orders: row?.orders ?? 0, revenue: Number(row?.revenue ?? 0), today: date === today });
  }
  return out;
}

/** The day that sold most, leaving out today, which is still selling. */
export function bestReportDay(days: readonly ReportDay[]): ReportDay | null {
  let best: ReportDay | null = null;
  for (const entry of days) {
    if (entry.today || entry.revenue <= 0) continue;
    if (!best || entry.revenue > best.revenue) best = entry;
  }
  return best;
}

/**
 * Sales per finished day: today is left out because it is still selling, a day
 * with no sales counts as the zero it was.
 */
export function averagePerFinishedDay(days: readonly ReportDay[]): number {
  const finished = days.filter((day) => !day.today);
  if (!finished.length) return 0;
  return finished.reduce((sum, day) => sum + day.revenue, 0) / finished.length;
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5 ก.ย." for a row or a bar. */
export function reportDayLabel(date: string, language: DisplayLanguage): string {
  const [, month, day] = date.split('-').map(Number);
  if (!month || !day) return date;
  return language === 'th' ? `${day} ${MONTHS_TH[month - 1]}` : `${MONTHS_EN[month - 1]} ${day}`;
}

/** "2–15 ก.ย. 2569", or "28 ส.ค. – 3 ก.ย. 2569" across a month. */
export function reportPeriodLabel(first: string, last: string, language: DisplayLanguage): string {
  const [y1, m1, d1] = first.split('-').map(Number);
  const [y2, m2, d2] = last.split('-').map(Number);
  if (!y1 || !y2) return '';
  const year = (value: number) => (language === 'th' ? value + 543 : value);
  const months = language === 'th' ? MONTHS_TH : MONTHS_EN;
  if (y1 === y2 && m1 === m2) {
    return language === 'th' ? `${d1}–${d2} ${months[m2 - 1]} ${year(y2)}` : `${months[m2 - 1]} ${d1}–${d2}, ${year(y2)}`;
  }
  return language === 'th'
    ? `${d1} ${months[m1 - 1]}${y1 !== y2 ? ` ${year(y1)}` : ''} – ${d2} ${months[m2 - 1]} ${year(y2)}`
    : `${months[m1 - 1]} ${d1}${y1 !== y2 ? `, ${year(y1)}` : ''} – ${months[m2 - 1]} ${d2}, ${year(y2)}`;
}

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
