// What the order archive shows, worked out apart from how it is drawn: the
// day filter's label, each row's name and lines, and the orders cut into
// Bangkok days (the day totals are kept for when a chosen day's takings are
// wanted again; nothing draws them today).

import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { Order } from '@/src/types/order';

import { formatBangkokDate } from './order-query.ts';
import { reportRangeLabel } from './report-view.ts';

export type ArchiveDay = {
  /** YYYY-MM-DD in Bangkok time, or '' when the order carries no usable time. */
  date: string;
  orders: Order[];
  /** Bills that were actually taken: the cancelled ones stay listed but do not count. */
  paidCount: number;
  total: number;
};

/** The Bangkok day an order was opened on, '' when there is no usable time. */
export function archiveDayOf(order: Pick<Order, 'opened_at'>): string {
  if (!order.opened_at) return '';
  const opened = new Date(order.opened_at);
  if (Number.isNaN(opened.getTime())) return '';
  return formatBangkokDate(opened);
}

/** Days in the order the server sent the orders, so newest first stays newest first. */
export function groupArchiveByDay(orders: Order[]): ArchiveDay[] {
  const keyed = orders.map((order) => ({ order, date: archiveDayOf(order) }));
  const dates = [...new Set(keyed.map((entry) => entry.date))];
  return dates.map((date) => {
    const dayOrders = keyed.filter((entry) => entry.date === date).map((entry) => entry.order);
    const paid = dayOrders.filter((order) => order.status !== 'cancelled');
    return {
      date,
      orders: dayOrders,
      paidCount: paid.length,
      total: paid.reduce((sum, order) => sum + Number(order.grand_total || 0), 0),
    };
  });
}

/** The zone a table sits in: the zone record when the server sent it, else the legacy zone string. */
export function archiveTableZone(order: Pick<Order, 'table'>): string {
  return order.table?.table_zone?.name?.trim() || order.table?.zone?.trim() || '';
}

/** What the day control says: every day until one is chosen, then that day. */
export function archiveDateLabel(date: string | null, language: DisplayLanguage): string {
  if (!date) return language === 'th' ? 'ทุกวัน' : 'All days';
  return reportRangeLabel({ from: date, to: date }, language);
}

/** The table, or takeaway, or - with neither - the order number itself. */
export function archiveRowTitle(
  order: Pick<Order, 'table' | 'order_type' | 'order_number'>,
  copy: (th: string, en: string) => string,
): string {
  if (order.table?.display_label) return order.table.display_label;
  if (order.order_type === 'takeaway') return copy('ซื้อกลับบ้าน', 'Takeaway');
  return order.order_number;
}

/** "09 ก.ย. 2569, 02:03 น." - the full date the way a delivery app's order list writes it; '' when the value is not a time. */
export function archiveDateTimeLine(value: string | null | undefined, language: DisplayLanguage): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const th = language === 'th';
  const day = new Intl.DateTimeFormat(th ? 'th-TH' : 'en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(date);
  // 24-hour in both languages: English Intl would otherwise write "02:03 AM".
  const time = new Intl.DateTimeFormat(th ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }).format(date);
  return th ? `${day}, ${time} น.` : `${day}, ${time}`;
}
