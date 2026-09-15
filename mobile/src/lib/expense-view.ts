// What the expenses screen shows, worked out apart from how it is drawn.
// Redrawn on 15 ก.ย. 2569 from the three-screens design: the period button the
// reports screen uses, one orange block with the total and each category's
// share of it, category chips that say how many entries each holds, and the
// entries grouped by day under a heading that stays put while the list scrolls.

import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { Expense, ExpenseCategory, ExpenseCategoryTotal, ExpenseDailyTotal } from '@/src/types/expense';
import type { ReportRange } from '@/src/lib/report-view';

const CATEGORY_LABELS: Record<ExpenseCategory, { th: string; en: string }> = {
  ingredient: { th: 'วัตถุดิบ', en: 'Ingredients' },
  labor: { th: 'ค่าแรง', en: 'Labor' },
  rent: { th: 'ค่าเช่า', en: 'Rent' },
  utilities: { th: 'สาธารณูปโภค', en: 'Utilities' },
  equipment: { th: 'อุปกรณ์', en: 'Equipment' },
  other: { th: 'อื่นๆ', en: 'Other' },
};

export function expenseCategoryLabel(category: string, language: DisplayLanguage): string {
  const labels = CATEGORY_LABELS[category as ExpenseCategory] ?? CATEGORY_LABELS.other;
  return labels[language];
}

/** The YYYY-MM-DD an expense was spent on, in Bangkok — the same day the server buckets it into. */
export function expenseDay(spentAt: string): string {
  const date = new Date(spentAt);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/**
 * The tag the daily demo seeder (backend/cmd/seed_daily_activity) writes at the
 * front of every note, "[daily_activity 2026-09-15] ซื้อพริกป่น", so it can find
 * and purge its own rows. It is bookkeeping for that tool, not something the
 * shop wrote, and it pushed what was bought off the end of every row.
 */
const SEED_MARKER = /^\[daily_activity \d{4}-\d{2}-\d{2}\]\s*/;

/** A row's first line: what was bought, or the category when nobody wrote a note. */
export function expenseTitle(expense: Pick<Expense, 'note' | 'category'>, language: DisplayLanguage): string {
  return (expense.note ?? '').replace(SEED_MARKER, '').trim() || expenseCategoryLabel(expense.category, language);
}

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "วันนี้ · 15 ก.ย.", "เมื่อวาน · 14 ก.ย.", "ส. 13 ก.ย." */
export function expenseDayLabel(date: string, today: string, language: DisplayLanguage): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  const yesterday = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - 1, 12)).toISOString().slice(0, 10);
  const dayMonth = language === 'th' ? `${day} ${MONTHS_TH[month - 1]}` : `${MONTHS_EN[month - 1]} ${day}`;
  if (date === today) return language === 'th' ? `วันนี้ · ${dayMonth}` : `Today · ${dayMonth}`;
  if (date === yesterday) return language === 'th' ? `เมื่อวาน · ${dayMonth}` : `Yesterday · ${dayMonth}`;
  return language === 'th' ? `${WEEKDAYS_TH[at.getUTCDay()]} ${dayMonth}` : `${WEEKDAYS_EN[at.getUTCDay()]}, ${dayMonth}`;
}

export type ExpenseDayGroup = {
  date: string;
  /** The day's whole total from the server, so a list cut at 500 rows still heads each day with the right sum. */
  amount: number;
  entries: number;
  items: Expense[];
};

/** Newest day first, each day's entries in the order the server sent them (newest first). */
export function groupExpensesByDay(expenses: readonly Expense[], daily: readonly ExpenseDailyTotal[] = []): ExpenseDayGroup[] {
  const totals = new Map(daily.map((day) => [day.date.slice(0, 10), day]));
  const groups: ExpenseDayGroup[] = [];
  const byDate = new Map<string, ExpenseDayGroup>();
  for (const expense of expenses) {
    const date = expenseDay(expense.spent_at);
    let group = byDate.get(date);
    if (!group) {
      group = { date, amount: 0, entries: 0, items: [] };
      byDate.set(date, group);
      groups.push(group);
    }
    group.items.push(expense);
  }
  for (const group of groups) {
    const total = totals.get(group.date);
    group.amount = total ? total.amount : group.items.reduce((sum, item) => sum + Number(item.amount), 0);
    group.entries = total ? total.entries : group.items.length;
  }
  return groups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export type ExpenseShare = { category: ExpenseCategory; amount: number; entries: number; percent: number };

/**
 * Each category's part of the period, biggest first, with whole percents. The
 * server's category totals ignore the category chip, so the orange block keeps
 * the whole period's picture while the list is narrowed.
 */
export function expenseShares(categories: readonly ExpenseCategoryTotal[]): { total: number; entries: number; shares: ExpenseShare[] } {
  const total = categories.reduce((sum, item) => sum + Number(item.amount), 0);
  const entries = categories.reduce((sum, item) => sum + Number(item.entries), 0);
  const shares = categories
    .filter((item) => Number(item.amount) > 0 || Number(item.entries) > 0)
    .map((item) => ({ category: item.category, amount: Number(item.amount), entries: Number(item.entries), percent: total > 0 ? Math.round((Number(item.amount) / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { total, entries, shares };
}

/** Days the period has run so far: a month still going counts up to today, not to its last day. */
export function elapsedDays(range: ReportRange, today: string): number {
  const end = range.to > today ? today : range.to;
  if (end < range.from) return 0;
  const toUtc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((toUtc(end) - toUtc(range.from)) / 86400000) + 1;
}

/** The chips: "ทั้งหมด", then only categories that have entries — and the chosen one even when it has none. */
export function expenseChipCategories(shares: readonly ExpenseShare[], selected: ExpenseCategory | 'all'): ExpenseCategory[] {
  const present = shares.filter((share) => share.entries > 0).map((share) => share.category);
  if (selected !== 'all' && !present.includes(selected)) present.push(selected);
  return present;
}
