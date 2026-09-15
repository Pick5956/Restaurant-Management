import assert from 'node:assert/strict';
import test from 'node:test';

import {
  averagePerFinishedBar,
  bestBar,
  calendarWeeks,
  dayBars,
  draftToRange,
  hourBars,
  matchPreset,
  presetRange,
  rangeDayCount,
  readableAmount,
  reportDayLabel,
  reportRangeLabel,
  sortStockRisks,
  tapRangeDay,
} from './report-view.ts';

const TODAY = '2026-09-15';
const sales = [
  { order_date: '2026-09-05', orders: 32, revenue: 9942, cost: 0, profit: 0 },
  { order_date: '2026-09-09', orders: 26, revenue: 9495, cost: 0, profit: 0 },
  { order_date: '2026-09-15', orders: 40, revenue: 12000, cost: 0, profit: 0 },
];

test('presets end today and cover whole calendar days', () => {
  assert.deepEqual(presetRange('last14', TODAY), { from: '2026-09-02', to: TODAY });
  assert.deepEqual(presetRange('yesterday', TODAY), { from: '2026-09-14', to: '2026-09-14' });
  assert.deepEqual(presetRange('thisMonth', TODAY), { from: '2026-09-01', to: TODAY });
  assert.deepEqual(presetRange('lastMonth', TODAY), { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(presetRange('lastMonth', '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
  assert.equal(matchPreset({ from: '2026-09-09', to: TODAY }, TODAY), 'last7');
  assert.equal(matchPreset({ from: '2026-09-03', to: '2026-09-04' }, TODAY), null);
  assert.equal(rangeDayCount({ from: '2026-08-28', to: '2026-09-03' }), 7);
});

test('every day of the range is a bar, a quiet day as zero', () => {
  const bars = dayBars(sales, { from: '2026-09-02', to: TODAY }, TODAY, 'th');
  assert.equal(bars.length, 14);
  assert.equal(bars[0].key, '2026-09-02');
  assert.equal(bars.find((bar) => bar.key === '2026-09-08').revenue, 0);
  assert.equal(bars.filter((bar) => bar.open).length, 1);
  assert.equal(bars[3].axis, '5');
  assert.equal(bars[3].label, '5 ก.ย.');
});

test('the best bar and the average leave out the one still selling', () => {
  const bars = dayBars(sales, { from: '2026-09-05', to: TODAY }, TODAY, 'th');
  assert.equal(bestBar(bars).key, '2026-09-05');
  // 5 to 14 Sep finished: 9,942 + 9,495 over ten days.
  assert.equal(averagePerFinishedBar(bars), (9942 + 9495) / 10);
  assert.equal(bestBar(dayBars([], { from: TODAY, to: TODAY }, TODAY, 'th')), null);
});

test('one day is drawn hour by hour over the trading hours', () => {
  const hours = [{ hour: 9, orders: 1, revenue: 120, cost: 0, profit: 0 }, { hour: 12, orders: 5, revenue: 900, cost: 0, profit: 0 }];
  const past = hourBars(hours, '2026-09-14', TODAY, 15);
  assert.equal(past[0].axis, '9');
  assert.equal(past.at(-1).axis, '21');
  assert.equal(past.find((bar) => bar.axis === '12').revenue, 900);
  const today = hourBars(hours, TODAY, TODAY, 15);
  assert.equal(today.at(-1).axis, '15');
  assert.equal(today.at(-1).open, true);
  assert.equal(today.at(-1).label, '15:00');
});

test('range labels', () => {
  assert.equal(reportDayLabel('2026-09-05', 'en'), 'Sep 5');
  assert.equal(reportRangeLabel({ from: '2026-09-05', to: '2026-09-05' }, 'th'), '5 ก.ย. 2569');
  assert.equal(reportRangeLabel({ from: '2026-09-02', to: TODAY }, 'th'), '2–15 ก.ย. 2569');
  assert.equal(reportRangeLabel({ from: '2026-08-28', to: '2026-09-03' }, 'th'), '28 ส.ค. – 3 ก.ย. 2569');
  assert.equal(reportRangeLabel({ from: '2025-12-25', to: '2026-01-07' }, 'en'), 'Dec 25, 2025 – Jan 7, 2026');
});

test('the calendar lays a month out in Sunday-first weeks', () => {
  const weeks = calendarWeeks(2026, 9);
  // 1 Sep 2026 is a Tuesday.
  assert.deepEqual(weeks[0], [null, null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
  assert.ok(weeks.every((week) => week.length === 7));
  assert.equal(weeks.flat().filter(Boolean).length, 30);
});

test('calendar taps pick one day or a range', () => {
  let draft = tapRangeDay({ from: null, to: null }, '2026-09-05');
  assert.deepEqual(draftToRange(draft), { from: '2026-09-05', to: '2026-09-05' });
  draft = tapRangeDay(draft, '2026-09-10');
  assert.deepEqual(draft, { from: '2026-09-05', to: '2026-09-10' });
  assert.deepEqual(tapRangeDay(draft, '2026-09-01'), { from: '2026-09-01', to: null });
  assert.deepEqual(tapRangeDay({ from: '2026-09-05', to: null }, '2026-09-03'), { from: '2026-09-03', to: null });
  assert.deepEqual(tapRangeDay({ from: '2026-09-05', to: null }, '2026-09-05'), { from: '2026-09-05', to: '2026-09-05' });
  assert.equal(draftToRange({ from: null, to: null }), null);
});

test('amounts to buy move up a unit from a thousand', () => {
  assert.equal(readableAmount(14080.58, 'กรัม', 'th'), '14.1 กก.');
  assert.equal(readableAmount(5693.06, 'มล.', 'th'), '5.7 ลิตร');
  assert.equal(readableAmount(450.4, 'กรัม', 'th'), '450 กรัม');
  assert.equal(readableAmount(2.5, 'ฟอง', 'th'), '2.5 ฟอง');
});

test('out of stock is listed before running low', () => {
  const { out, low } = sortStockRisks([{ id: 1, status: 'low' }, { id: 2, status: 'out' }, { id: 3, status: 'out' }]);
  assert.deepEqual(out.map((risk) => risk.id), [2, 3]);
  assert.deepEqual(low.map((risk) => risk.id), [1]);
});
