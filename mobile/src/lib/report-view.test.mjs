import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averagePerFinishedDay,
  bestReportDay,
  fillReportDays,
  readableAmount,
  reportDayLabel,
  reportPeriodLabel,
  sortStockRisks,
} from './report-view.ts';

const sales = [
  { order_date: '2026-09-05', orders: 32, revenue: 9942, cost: 0, profit: 0 },
  { order_date: '2026-09-09', orders: 26, revenue: 9495, cost: 0, profit: 0 },
  { order_date: '2026-09-15', orders: 40, revenue: 12000, cost: 0, profit: 0 },
];

test('every day of the window is listed, a quiet day as zero', () => {
  const days = fillReportDays(sales, 14, '2026-09-15');
  assert.equal(days.length, 14);
  assert.equal(days[0].date, '2026-09-02');
  assert.equal(days.at(-1).date, '2026-09-15');
  assert.equal(days.find((day) => day.date === '2026-09-08').revenue, 0);
  assert.equal(days.filter((day) => day.today).length, 1);
});

test('the window crosses a month boundary', () => {
  const days = fillReportDays([], 7, '2026-10-03');
  assert.deepEqual(days.map((day) => day.date), ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
});

test('the best day leaves out today, which is still selling', () => {
  const days = fillReportDays(sales, 14, '2026-09-15');
  assert.equal(bestReportDay(days).date, '2026-09-05');
  assert.equal(bestReportDay(fillReportDays([], 3, '2026-09-15')), null);
});

test('labels for a day and a period', () => {
  assert.equal(reportDayLabel('2026-09-05', 'th'), '5 ก.ย.');
  assert.equal(reportDayLabel('2026-09-05', 'en'), 'Sep 5');
  assert.equal(reportPeriodLabel('2026-09-02', '2026-09-15', 'th'), '2–15 ก.ย. 2569');
  assert.equal(reportPeriodLabel('2026-08-28', '2026-09-03', 'th'), '28 ส.ค. – 3 ก.ย. 2569');
  assert.equal(reportPeriodLabel('2025-12-25', '2026-01-07', 'en'), 'Dec 25, 2025 – Jan 7, 2026');
});

test('amounts to buy move up a unit from a thousand', () => {
  assert.equal(readableAmount(14080.58, 'กรัม', 'th'), '14.1 กก.');
  assert.equal(readableAmount(5693.06, 'มล.', 'th'), '5.7 ลิตร');
  assert.equal(readableAmount(450.4, 'กรัม', 'th'), '450 กรัม');
  assert.equal(readableAmount(2.5, 'ฟอง', 'th'), '2.5 ฟอง');
  assert.equal(readableAmount(1293.6, 'g', 'en'), '1.3 kg');
});

test('out of stock is listed before running low', () => {
  const { out, low } = sortStockRisks([{ id: 1, status: 'low' }, { id: 2, status: 'out' }, { id: 3, status: 'out' }]);
  assert.deepEqual(out.map((risk) => risk.id), [2, 3]);
  assert.deepEqual(low.map((risk) => risk.id), [1]);
});

test('the daily average leaves out today and counts a quiet day as zero', () => {
  const days = fillReportDays(sales, 5, '2026-09-15');
  // 11 to 14 Sep finished with no sales, 15 Sep is today.
  assert.equal(averagePerFinishedDay(days), 0);
  const week = fillReportDays(sales, 11, '2026-09-15');
  // 5 to 14 Sep: 9,942 + 9,495 over ten finished days.
  assert.equal(averagePerFinishedDay(week), (9942 + 9495) / 10);
});
