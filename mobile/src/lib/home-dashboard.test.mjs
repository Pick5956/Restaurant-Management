import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bangkokHour,
  homeDayStrip,
  homeRevenueCurve,
  homeTableCells,
  percentChange,
  sameWeekdayRevenue,
  waitingBillOrders,
  buildHomeOperationalMetrics,
  buildHomeAttention,
  clampDashboardDate,
  dashboardLoadFailurePolicy,
  resolveHomePriority,
  shiftDashboardDate,
  summarizeHomeOrders,
  summarizeHomeSalesTrend,
  summarizeInventory,
  summarizeKitchenQueue,
  shouldStartDashboardLoad,
  shouldReplaceOptionalDashboardSnapshot,
  topHomeMenuItems,
} from './home-dashboard.ts';

const fullAccess = {
  canViewKitchen: true,
  canViewInventory: true,
  canTakeOrder: true,
  canViewOrders: true,
};

test('background refresh failure preserves the last known dashboard snapshot', () => {
  assert.deepEqual(dashboardLoadFailurePolicy(true), {
    preserveSnapshot: true,
    showError: false,
  });
  assert.deepEqual(dashboardLoadFailurePolicy(false), {
    preserveSnapshot: false,
    showError: true,
  });
});

test('background optional-source failure does not replace known data with a synthetic empty list', () => {
  assert.equal(shouldReplaceOptionalDashboardSnapshot(true, true), false);
  assert.equal(shouldReplaceOptionalDashboardSnapshot(true, false), true);
  assert.equal(shouldReplaceOptionalDashboardSnapshot(false, true), true);
});

test('background polling waits for the foreground dashboard load to finish', () => {
  assert.equal(shouldStartDashboardLoad(true, true), false);
  assert.equal(shouldStartDashboardLoad(true, false), true);
  assert.equal(shouldStartDashboardLoad(false, true), true);
});

test('shifts dashboard dates across month, leap-year, and year boundaries', () => {
  assert.equal(shiftDashboardDate('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDashboardDate('2028-03-01', -1), '2028-02-29');
  assert.equal(shiftDashboardDate('2026-12-31', 1), '2027-01-01');
});

test('accepts valid history dates but never selects an invalid or future date', () => {
  assert.equal(clampDashboardDate('2026-07-29', '2026-07-28', '2026-07-29'), '2026-07-28');
  assert.equal(clampDashboardDate('2026-07-28', '2026-07-30', '2026-07-29'), '2026-07-28');
  assert.equal(clampDashboardDate('2026-07-28', 'not-a-date', '2026-07-29'), '2026-07-28');
});

test('summarizes overdue, ready, and active kitchen tickets from live queue timing', () => {
  const now = new Date('2026-07-29T05:20:00.000Z');
  const counts = summarizeKitchenQueue([
    {
      opened_at: '2026-07-29T05:00:00.000Z',
      items: [{ status: 'cooking', sent_at: '2026-07-29T05:09:00.000Z' }],
    },
    {
      opened_at: '2026-07-29T05:15:00.000Z',
      items: [{ status: 'ready', sent_at: '2026-07-29T05:12:00.000Z' }],
    },
    {
      opened_at: '2026-07-29T05:16:00.000Z',
      items: [{ status: 'pending', sent_at: '2026-07-29T05:16:00.000Z' }],
    },
  ], now);

  assert.deepEqual(counts, {
    overdueKitchen: 1,
    readyKitchen: 1,
    activeKitchen: 2,
  });
});

test('separates out-of-stock ingredients from low-stock ingredients', () => {
  assert.deepEqual(summarizeInventory([
    { stock: 0, min_stock: 10 },
    { stock: 12, min_stock: 10 },
    { stock: 16, min_stock: 10 },
    { stock: 3, min_stock: 0 },
  ]), {
    outOfStock: 1,
    lowStock: 1,
  });
});

test('ranks overdue kitchen work first, then ready food, then inventory risks', () => {
  const counts = {
    overdueKitchen: 2,
    readyKitchen: 3,
    activeKitchen: 4,
    outOfStock: 5,
    lowStock: 6,
    occupiedTables: 7,
  };

  assert.equal(resolveHomePriority(counts, fullAccess).key, 'kitchen-overdue');
  // Ready-to-serve is not an alert: the web filters its done lane off the
  // attention face, so clearing the overdue queue falls straight through to stock.
  assert.equal(resolveHomePriority({ ...counts, overdueKitchen: 0 }, fullAccess).key, 'stock-out');
  assert.equal(resolveHomePriority({ ...counts, overdueKitchen: 0, readyKitchen: 0 }, fullAccess).key, 'stock-out');
});

test('does not surface kitchen or inventory actions without their permissions', () => {
  const counts = {
    overdueKitchen: 9,
    readyKitchen: 8,
    activeKitchen: 7,
    outOfStock: 6,
    lowStock: 5,
    occupiedTables: 4,
  };
  const orderOnlyAccess = {
    canViewKitchen: false,
    canViewInventory: false,
    canTakeOrder: false,
    canViewOrders: true,
  };

  assert.equal(resolveHomePriority(counts, orderOnlyAccess).key, 'orders');
  assert.deepEqual(buildHomeAttention(counts, orderOnlyAccess), []);
});

test('builds only non-zero attention alerts that the current member can open', () => {
  const alerts = buildHomeAttention({
    overdueKitchen: 2,
    readyKitchen: 0,
    activeKitchen: 3,
    outOfStock: 1,
    lowStock: 4,
    occupiedTables: 0,
  }, fullAccess);

  assert.deepEqual(alerts.map((alert) => alert.key), [
    'kitchen-overdue',
    'stock-out',
    'stock-low',
  ]);
});

test('summarizes guests and paid sales without counting cancelled or takeaway guests', () => {
  const summary = summarizeHomeOrders([
    {
      status: 'completed',
      order_type: 'dine_in',
      customer_count: 4,
      payment_status: 'paid',
      grand_total: 800,
      total_amount: 760,
    },
    {
      status: 'open',
      order_type: 'dine_in',
      customer_count: 2,
      payment_status: 'unpaid',
      grand_total: 200,
      total_amount: 200,
    },
    {
      status: 'completed',
      order_type: 'takeaway',
      customer_count: 9,
      payment_status: 'paid',
      grand_total: 300,
      total_amount: 300,
    },
    {
      status: 'cancelled',
      order_type: 'dine_in',
      customer_count: 8,
      payment_status: 'paid',
      grand_total: 900,
      total_amount: 900,
    },
  ]);

  assert.deepEqual(summary, {
    totalOrders: 3,
    activeOrders: 1,
    paidOrders: 2,
    paidRevenue: 1100,
    averageBill: 550,
    guests: 6,
  });
});

test('compares the latest seven calendar days with the previous seven days', () => {
  const trend = summarizeHomeSalesTrend([
    { order_date: '2026-06-30', revenue: 999, profit: 999 },
    { order_date: '2026-07-02', revenue: 300, profit: -50 },
    { order_date: '2026-07-07', revenue: 200, profit: 0 },
    { order_date: '2026-07-08', revenue: 400, profit: 100 },
    { order_date: '2026-07-14', revenue: 300, profit: 100 },
  ], '2026-07-14', 7);

  assert.deepEqual(trend, {
    days: 7,
    current: { revenue: 700, profit: 200 },
    previous: { revenue: 500, profit: -50 },
    delta: { revenue: 200, profit: 250 },
  });
});

test('builds permission-safe floor and operational metrics', () => {
  const snapshot = {
    activeOrders: 5,
    occupiedTables: 4,
    freeTables: 7,
    reservedTables: 2,
    activeKitchen: 3,
    readyKitchen: 1,
  };

  assert.deepEqual(
    buildHomeOperationalMetrics(snapshot, {
      canViewOrders: true,
      canViewTables: true,
      canViewKitchen: false,
    }),
    [
      { key: 'orders-active', count: 5 },
      { key: 'tables-occupied', count: 4 },
      { key: 'tables-free', count: 7 },
      { key: 'tables-reserved', count: 2 },
    ],
  );
  assert.deepEqual(
    buildHomeOperationalMetrics(snapshot, {
      canViewOrders: false,
      canViewTables: false,
      canViewKitchen: true,
    }),
    [
      { key: 'kitchen-active', count: 3 },
      { key: 'kitchen-ready', count: 1 },
    ],
  );
});

test('keeps only the top three monthly menu items in stable sales order', () => {
  assert.deepEqual(topHomeMenuItems([
    { menu_id: 1, menu_name: 'Tea', quantity: 8 },
    { menu_id: 2, menu_name: 'Curry', quantity: 12 },
    { menu_id: 3, menu_name: 'Rice', quantity: 8 },
    { menu_id: 4, menu_name: 'Soup', quantity: 3 },
  ]), [
    { menu_id: 2, menu_name: 'Curry', quantity: 12 },
    { menu_id: 3, menu_name: 'Rice', quantity: 8 },
    { menu_id: 1, menu_name: 'Tea', quantity: 8 },
  ]);
});

test('the day strip ends on today, marks the selected day, and dots only days that sold', () => {
  const days = homeDayStrip('2026-09-11', '2026-09-09', [
    { order_date: '2026-09-05', revenue: 9942, profit: 1 },
    { order_date: '2026-09-08', revenue: 0, profit: 0 },
    { order_date: '2026-09-11', revenue: 5768, profit: 1 },
  ]);
  assert.equal(days.length, 7);
  assert.equal(days[0].date, '2026-09-05');
  assert.equal(days[6].date, '2026-09-11');
  assert.equal(days[6].isToday, true);
  assert.equal(days[4].selected, true);
  assert.equal(days[0].hasSales, true);
  assert.equal(days[3].hasSales, false, 'a day with zero revenue has no dot');
  assert.equal(days[6].weekday, 5, '11 Sep 2026 is a Friday');
});

test('without sales history the strip has no dots at all rather than every day looking empty', () => {
  const days = homeDayStrip('2026-09-11', '2026-09-11', null);
  assert.ok(days.every((day) => day.hasSales === null));
});

test('the revenue curve accumulates paid bills by the hour they closed and stops at the current hour', () => {
  const orders = [
    { status: 'completed', order_type: 'dine_in', payment_status: 'paid', grand_total: 100, closed_at: '2026-09-11T04:30:00Z' }, // 11:30 Bangkok
    { status: 'completed', order_type: 'dine_in', payment_status: 'paid', grand_total: 50, closed_at: '2026-09-11T04:45:00Z' },  // 11:45
    { status: 'served', order_type: 'dine_in', payment_status: 'unpaid', grand_total: 999, closed_at: null, opened_at: '2026-09-11T05:00:00Z' },
    { status: 'cancelled', order_type: 'dine_in', payment_status: 'paid', grand_total: 999, closed_at: '2026-09-11T06:00:00Z' },
    { status: 'completed', order_type: 'takeaway', payment_status: 'paid', grand_total: 25, closed_at: '2026-09-11T07:10:00Z' }, // 14:10
  ];
  const curve = homeRevenueCurve(orders, 15);
  assert.equal(curve.startHour, 10, 'the axis never starts later than opening');
  assert.equal(curve.endHour, 15, 'a day in progress runs to the current hour');
  assert.deepEqual(curve.cumulative, [0, 150, 150, 150, 175, 175]);
});

test("a finished day's curve ends at the last sale, not at midnight", () => {
  const curve = homeRevenueCurve([
    { status: 'completed', order_type: 'dine_in', payment_status: 'paid', grand_total: 10, closed_at: '2026-09-10T13:00:00Z' }, // 20:00
  ], null);
  assert.equal(curve.endHour, 20);
  assert.equal(curve.cumulative.length, 11);
});

test('an empty finished day has no curve', () => {
  assert.equal(homeRevenueCurve([], null), null);
});

test("bangkokHour reads the hour in the shop's timezone", () => {
  assert.equal(bangkokHour('2026-09-11T17:00:00Z'), 0, 'midnight in Bangkok is hour 0, not 24');
  assert.equal(bangkokHour('2026-09-11T04:30:00Z'), 11);
  assert.equal(bangkokHour('not a date'), null);
});

test('the same weekday a week earlier is the only fair comparison offered', () => {
  const history = [{ order_date: '2026-09-04', revenue: 9533, profit: 0 }];
  assert.equal(sameWeekdayRevenue(history, '2026-09-11'), 9533);
  assert.equal(sameWeekdayRevenue(history, '2026-09-10'), null);
  assert.equal(sameWeekdayRevenue(null, '2026-09-11'), null);
  assert.equal(percentChange(5768, 9533), -39);
  assert.equal(percentChange(5768, 0), null);
  assert.equal(percentChange(5768, null), null);
});

test('waiting-bill orders are finished but unpaid, whatever the kitchen calls finished', () => {
  const orders = [
    { status: 'served', order_type: 'dine_in', payment_status: 'unpaid', table: { ID: 3 } },
    { status: 'ready', order_type: 'dine_in', payment_status: 'unpaid', table: { ID: 4 } },
    { status: 'served', order_type: 'dine_in', payment_status: 'paid', table: { ID: 5 } },
    { status: 'cooking', order_type: 'dine_in', payment_status: 'unpaid', table: { ID: 6 } },
  ];
  assert.deepEqual(waitingBillOrders(orders).map((order) => order.table.ID), [3, 4]);
});

test('the floor grid ranks a waiting bill above plain occupancy and leaves inactive tables out', () => {
  const cells = homeTableCells([
    { ID: 1, display_label: 'F01', status: 'occupied' },
    { ID: 2, display_label: 'F02', status: 'occupied' },
    { ID: 3, display_label: 'A01', status: 'reserved' },
    { ID: 4, display_label: 'A02', status: 'free' },
    { ID: 5, display_label: 'X', status: 'inactive' },
  ], new Set([2]));
  assert.deepEqual(cells.map((cell) => `${cell.label}:${cell.state}`), ['F01:busy', 'F02:bill', 'A01:reserved', 'A02:free']);
});
