import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { insightKey } from './ai-insight-key.ts';
import { collectDayOrders, DAY_ORDERS_MAX_PAGES } from './day-orders.ts';
import {
  homeRevenueCurve,
  summarizeHomeOrders,
  summarizeInventory,
  summarizeKitchenQueue,
} from './home-dashboard.ts';
import {
  branchLabel,
  floorFigure,
  floorSegments,
  HUB_DAY_LOADERS,
  HUB_HEAVY_LOADERS,
  HUB_LIGHT_LOADERS,
  HUB_LOADER_KEYS,
  HUB_ORDER_STREAM_PERMISSIONS,
  HUB_ROW_LOADERS,
  HUB_TIMING,
  hubClockLabel,
  hubFigureText,
  hubFloor,
  hubFocusLoad,
  hubHeldValueIsCurrent,
  hubInventoryStock,
  hubKitchen,
  hubLoadDecision,
  hubLoaderMinAge,
  hubLoaderMinInterval,
  hubLoaderPlan,
  hubLoadersForEvents,
  hubMenuStock,
  hubPaidToday,
  hubPaidTodayRequest,
  hubPollLoaders,
  hubSegmentsText,
  hubShouldRecover,
  hubStaleDayLoaders,
  hubTakings,
  hubUnseenInsights,
  insightsSegments,
  inventorySegments,
  kitchenFigure,
  kitchenLaneLabel,
  kitchenSegments,
  menuSegments,
  mostSevereTone,
  paidTodayFigure,
} from './hub-data.ts';
import { isKitchenOrderChangeEvent } from './order-events.ts';
import { buildOrderListPath } from './order-query.ts';
import { orderListRequest, orderRoutePermissions } from './permission-parity.ts';
import { can } from './rbac.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(mobileRoot, '..');
const source = (relative) => readFileSync(path.join(mobileRoot, relative), 'utf8');
/** The file without its comments, so a note naming what not to call is not a call. */
const code = (relative) => source(relative)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

// 14:32 in Bangkok.
const NOW = Date.parse('2026-09-23T07:32:00Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

// ---------------------------------------------------------------- takings

const dayOrders = [
  { ID: 1, status: 'completed', order_type: 'dine_in', payment_status: 'paid', grand_total: 500, closed_at: '2026-09-23T03:15:00Z' },
  { ID: 2, status: 'completed', order_type: 'takeaway', payment_status: 'paid', grand_total: 300, closed_at: '2026-09-23T05:40:00Z' },
  { ID: 3, status: 'cancelled', order_type: 'dine_in', payment_status: 'paid', grand_total: 1000, closed_at: '2026-09-23T04:00:00Z' },
  { ID: 4, status: 'open', order_type: 'dine_in', payment_status: 'unpaid', grand_total: 200, opened_at: '2026-09-23T06:00:00Z' },
];

test('takings are /home\'s own figure and curve for the same orders and hour', () => {
  const takings = hubTakings(dayOrders, NOW);
  assert.equal(takings.amount, 800);
  assert.equal(takings.amount, summarizeHomeOrders(dayOrders).paidRevenue);
  assert.deepEqual(takings.curve, homeRevenueCurve(dayOrders, 14));
  assert.deepEqual(takings.curve, { startHour: 10, endHour: 14, cumulative: [500, 500, 800, 800, 800] });
  assert.equal(takings.startLabel, '10:00');
  assert.equal(takings.nowLabel, '14:32');
});

test('a day with nothing paid is 0 with no curve, labelled from the current hour', () => {
  const takings = hubTakings([dayOrders[3]], NOW);
  assert.deepEqual(takings, { amount: 0, curve: null, startLabel: '14:00', nowLabel: '14:32' });
  assert.deepEqual(hubTakings([], NOW), { amount: 0, curve: null, startLabel: '14:00', nowLabel: '14:32' });
});

// Stress test, 2026-09-23: a ฿0 bill closed at 08:10 drew '10:00' on the left
// of the axis and '08:30' on the right.
test('a ฿0 bill before opening never runs the axis backwards', () => {
  const zeroBill = { ID: 9, status: 'completed', order_type: 'dine_in', payment_status: 'paid', grand_total: 0, closed_at: '2026-09-23T01:10:00Z' };
  const takings = hubTakings([zeroBill], Date.parse('2026-09-23T01:30:00Z'));
  assert.equal(takings.amount, 0);
  assert.equal(takings.startLabel, '08:00');
  assert.equal(takings.nowLabel, '08:30');
  assert.ok(takings.startLabel <= takings.nowLabel);
  assert.deepEqual(takings.curve, { startHour: 8, endHour: 8, cumulative: [0] });
});

test('the clock label is Bangkok time on a 24-hour clock, midnight included', () => {
  assert.equal(hubClockLabel(Date.parse('2026-09-23T17:05:00Z')), '00:05');
  assert.equal(hubClockLabel(new Date('2026-09-23T16:59:00Z')), '23:59');
});

// ---------------------------------------------------------------- floor

const tables = [
  { ID: 1, status: 'free', zone_id: 2 },
  // The column says occupied but nothing is open on it: the tile paints free.
  { ID: 2, status: 'occupied', zone_id: 1 },
  { ID: 3, status: 'free', zone_id: 2 },
  { ID: 4, status: 'reserved', zone_id: null },
  { ID: 5, status: 'inactive', zone_id: 1 },
  // Inactive on paper, but someone is eating there: the tile paints occupied.
  { ID: 6, status: 'inactive', zone_id: 2 },
];
const activeOrders = [
  { status: 'served', order_type: 'dine_in', table_id: 3, payment_status: 'unpaid' },
  { status: 'cooking', order_type: 'dine_in', table_id: 6, payment_status: 'unpaid' },
  { status: 'ready', order_type: 'takeaway', table_id: null, payment_status: 'unpaid' },
  { status: 'completed', order_type: 'dine_in', table_id: 1, payment_status: 'paid' },
];

test('the floor runs zone by zone in the tables screen\'s order, inactive tiles left out', () => {
  const floor = hubFloor(tables, activeOrders);
  assert.deepEqual(floor.cells.map((cell) => cell.key), ['1', '3', '6', '2', '4']);
  assert.deepEqual(floor.cells.map((cell) => cell.tone), ['free', 'occupied', 'occupied', 'free', 'reserved']);
  assert.equal(floor.total, 5);
  assert.equal(floor.free, 2);
});

test('waiting bills are the cells drawn with a bill edge; takeaway bills are counted apart', () => {
  // Stress test, 2026-09-23: "รอเช็คบิล 4" beside one blue cell, because the
  // count took in takeaway bills that have no cell.
  const floor = hubFloor(tables, activeOrders);
  assert.deepEqual(floor.cells.filter((cell) => cell.waitingBill).map((cell) => cell.key), ['3']);
  assert.equal(floor.waitingBills, 1);
  assert.equal(floor.takeawayBills, 1);
});

test('the bill count always equals the blue cells, whatever the mix of orders', () => {
  const unpaid = (order) => ({ payment_status: 'unpaid', ...order });
  const floorTables = [1, 2, 3, 4, 5].map((ID) => ({ ID, status: 'free', zone_id: null }));
  const mixes = [
    // One table bill and three takeaway bills.
    [unpaid({ status: 'served', order_type: 'dine_in', table_id: 2 }), ...[1, 2, 3].map(() => unpaid({ status: 'ready', order_type: 'takeaway', table_id: null }))],
    // Takeaway bills only, every table free.
    [1, 2, 3].map(() => unpaid({ status: 'ready', order_type: 'takeaway', table_id: null })),
    // Two unpaid bills on one table are one cell.
    [unpaid({ status: 'served', order_type: 'dine_in', table_id: 4 }), unpaid({ status: 'ready', order_type: 'dine_in', table_id: 4 })],
  ];
  const expected = [{ waitingBills: 1, takeawayBills: 3 }, { waitingBills: 0, takeawayBills: 3 }, { waitingBills: 1, takeawayBills: 0 }];
  mixes.forEach((orders, index) => {
    const floor = hubFloor(floorTables, orders);
    assert.equal(floor.waitingBills, floor.cells.filter((cell) => cell.waitingBill).length, `mix ${index}`);
    assert.deepEqual({ waitingBills: floor.waitingBills, takeawayBills: floor.takeawayBills }, expected[index], `mix ${index}`);
  });
});

test('an empty floor is every table free and no bill waiting', () => {
  const floor = hubFloor(tables.slice(0, 4).map((table) => ({ ...table, status: 'free' })), []);
  assert.deepEqual(
    { free: floor.free, total: floor.total, waitingBills: floor.waitingBills, takeawayBills: floor.takeawayBills },
    { free: 4, total: 4, waitingBills: 0, takeawayBills: 0 },
  );
  assert.deepEqual(hubFloor([], []), { free: 0, total: 0, waitingBills: 0, takeawayBills: 0, cells: [] });
});

// ---------------------------------------------------------------- kitchen

const queue = [
  { ID: 11, kitchen_batch: 1, order_type: 'dine_in', table_id: 3, table: { display_label: 'T3', table_number: '3' }, kitchen_sent_at: minutesAgo(12), items: [{ status: 'cooking' }] },
  { ID: 12, kitchen_batch: 1, order_type: 'takeaway', order_number: '20260923-004', customer_name: ' คุณเอ ', kitchen_sent_at: minutesAgo(6), items: [{ status: 'pending' }, { status: 'ready' }] },
  { ID: 13, kitchen_ticket_id: 'ticket-13', order_type: 'dine_in', table_id: 7, table: { display_label: '', table_number: '7' }, kitchen_sent_at: minutesAgo(1), items: [{ status: 'cooking' }] },
  { ID: 14, kitchen_batch: 2, order_type: 'dine_in', table_id: 9, table: { display_label: 'T9' }, kitchen_sent_at: minutesAgo(20), items: [{ status: 'ready' }] },
  { ID: 15, order_type: 'takeaway', kitchen_sent_at: minutesAgo(30), items: [{ status: 'cancelled' }] },
  { ID: 16, order_type: 'dine_in', table_id: 12, kitchen_sent_at: null, items: [{ status: 'cooking', sent_at: minutesAgo(3) }] },
];

test('the kitchen tile is the kitchen board\'s own stats', () => {
  const kitchen = hubKitchen(queue, NOW);
  assert.deepEqual({ cooking: kitchen.cooking, overdue: kitchen.overdue, done: kitchen.done }, { cooking: 4, overdue: 1, done: 2 });
});

test('lanes run longest wait first, filled over the ten-minute target', () => {
  const kitchen = hubKitchen(queue, NOW);
  assert.deepEqual(kitchen.lanes.map((lane) => lane.label), ['T3', '#4', '12', '7']);
  assert.deepEqual(kitchen.lanes.map((lane) => lane.key), ['11:1', '12:1', '16:0', 'ticket-13']);
  assert.deepEqual(kitchen.lanes.map((lane) => lane.progress), [1, 0.6, 0.3, 0.1]);
  assert.deepEqual(kitchen.lanes.map((lane) => lane.urgency), ['overdue', 'warning', 'normal', 'normal']);
});

test('overdue follows the round\'s kitchen stamp, not the older item stamp /home reads', () => {
  // A second round on an order whose first items went out fifteen minutes ago.
  const secondRound = [{ ID: 21, order_type: 'dine_in', opened_at: minutesAgo(40), kitchen_sent_at: minutesAgo(2), items: [{ status: 'cooking', sent_at: minutesAgo(15) }] }];
  assert.equal(hubKitchen(secondRound, NOW).overdue, 0);
  assert.equal(summarizeKitchenQueue(secondRound, new Date(NOW)).overdueKitchen, 1);
});

test('an idle kitchen is zero rounds and no lanes', () => {
  assert.deepEqual(hubKitchen([], NOW), { cooking: 0, overdue: 0, done: 0, lanes: [] });
});

// Stress test, 2026-09-23: a lane column is 21-40 pt wide, so 'ริมน้ำ01',
// 'ซื้อกลับบ้าน', customer names and phone numbers were all cut to stubs.
const dineInAt = (code) => ({ order_type: 'dine_in', table_id: 1, table: { display_label: code, table_number: code } });

test('a table lane is its code; a code over four letters keeps its number and its zone\'s first letter', () => {
  for (const code of ['T3', 'A01', 'A12', 'T100', 'ก01']) assert.equal(kitchenLaneLabel(dineInAt(code), 'th'), code);
  assert.equal(kitchenLaneLabel(dineInAt('ริมน้ำ07'), 'th'), 'ร07');
  // A leading Thai vowel keeps the consonant it is said after.
  assert.equal(kitchenLaneLabel(dineInAt('เรือนไม้03'), 'th'), 'เร03');
  assert.equal(kitchenLaneLabel(dineInAt('VIP01'), 'en'), 'V01');
  // Nothing to shorten to: the whole code, and the lane's middle ellipsis is the last resort.
  assert.equal(kitchenLaneLabel(dineInAt('Garden'), 'th'), 'Garden');
  assert.equal(kitchenLaneLabel(dineInAt('12345'), 'th'), '12345');
  assert.equal(kitchenLaneLabel({ order_type: 'dine_in', table_id: 12 }, 'th'), '12');
  assert.equal(kitchenLaneLabel({ order_type: 'dine_in', table_id: null }, 'th'), '−');
});

test('two tables whose short codes would match keep their whole codes on the lanes', () => {
  const round = (ID, display_label, minutes) => ({
    ID,
    kitchen_batch: 1,
    order_type: 'dine_in',
    table_id: ID,
    table: { display_label },
    kitchen_sent_at: minutesAgo(minutes),
    items: [{ status: 'cooking' }],
  });
  const clash = hubKitchen([round(1, 'ริมน้ำ07', 9), round(2, 'ระเบียง07', 8), round(3, 'เรือนไม้03', 7)], NOW);
  assert.deepEqual(clash.lanes.map((lane) => lane.label), ['ริมน้ำ07', 'ระเบียง07', 'เร03']);
  const english = hubKitchen([round(4, 'VIP01', 5), round(5, 'Veranda01', 4)], NOW, 'en');
  assert.deepEqual(english.lanes.map((lane) => lane.label), ['VIP01', 'Veranda01']);
  // Two rounds on one table are one table: its short code on both.
  const sameTable = hubKitchen([round(6, 'ริมน้ำ07', 6), { ...round(6, 'ริมน้ำ07', 3), ID: 7, kitchen_batch: 2 }], NOW);
  assert.deepEqual(sameTable.lanes.map((lane) => lane.label), ['ร07', 'ร07']);
});

test('a takeaway lane is its short order number, never the customer\'s name or phone', () => {
  const takeaway = (extra = {}) => ({ order_type: 'takeaway', order_number: '20260923-015', ...extra });
  assert.equal(kitchenLaneLabel(takeaway(), 'th'), '#15');
  assert.equal(kitchenLaneLabel(takeaway({ customer_name: 'คุณสมศักดิ์' }), 'th'), '#15');
  assert.equal(kitchenLaneLabel(takeaway({ customer_name: '0812345678', customer_phone: '0812345678' }), 'en'), '#15');
  assert.equal(kitchenLaneLabel(takeaway({ order_number: '20260923-1234' }), 'th'), '#1234');
  // No order number to shorten: the kitchen screen's own takeaway word.
  assert.equal(kitchenLaneLabel({ order_type: 'takeaway', customer_name: '0899999999' }, 'th'), 'กลับบ้าน');
  assert.equal(kitchenLaneLabel({ order_type: 'takeaway' }, 'en'), 'Takeaway');
  assert.equal(hubKitchen(queue, NOW, 'en').lanes[1].label, '#4');
});

// The demo seeders end an order number in ' (Test)' (entity.TestOrderSuffix);
// matched at the very end, every seeded takeaway fell back to the long word.
test('a seeded takeaway order number still shortens to its running count', () => {
  const takeaway = (order_number) => ({ order_type: 'takeaway', order_number });
  assert.equal(kitchenLaneLabel(takeaway('20260919-001 (Test)'), 'th'), '#1');
  assert.equal(kitchenLaneLabel(takeaway('20260919-128 (TEST)'), 'en'), '#128');
  assert.equal(kitchenLaneLabel(takeaway('20260919-042(Test)'), 'th'), '#42');
  assert.equal(kitchenLaneLabel(takeaway('(Test)'), 'th'), 'กลับบ้าน');
});

// ---------------------------------------------------------------- orders, stock, AI

test('the paid count asks exactly what the orders archive asks, one row', () => {
  const request = hubPaidTodayRequest('2026-09-23');
  assert.deepEqual(request, orderListRequest('archive', { date: '2026-09-23', page: 1, limit: 1 }));
  assert.equal(buildOrderListPath(request), '/api/v1/orders?payment_status=paid&date=2026-09-23&page=1&limit=1');
});

test('the paid count is the pagination total', () => {
  assert.deepEqual(hubPaidToday({ orders: [{}], pagination: { total: 23 } }), { count: 23 });
  assert.deepEqual(hubPaidToday({ orders: [], pagination: { total: 0 } }), { count: 0 });
  assert.deepEqual(hubPaidToday({ orders: [{}] }), { count: 1 });
});

test('the menu badge counts dishes whose stock ran out, not dishes switched off by hand', () => {
  // Stress test, 2026-09-23: seasonal dishes switched off on purpose kept a red
  // badge on the menu chip every day. The backend switches a dish off itself
  // when an ingredient in its recipe runs out (disableMenusForDepletedIngredients),
  // so a dish is counted by its stock, whatever the switch says.
  const stock = hubMenuStock([
    // Switched off by hand: stock to spare, or no recipe at all.
    { is_available: false, remaining_servings: 50 },
    { is_available: false, remaining_servings: null },
    { is_available: false },
    // Switched off with three portions left is off, not low.
    { is_available: false, remaining_servings: 3 },
    // Out: switched off by the backend when its stock ran out, and the last portion claimed by the queue.
    { is_available: false, remaining_servings: 0 },
    { is_available: true, remaining_servings: 0 },
    // The POS grid's amber badge.
    { is_available: true, remaining_servings: 10 },
    { is_available: true, remaining_servings: 1 },
    { is_available: true, remaining_servings: 11 },
    { is_available: true, remaining_servings: null },
    { is_available: true },
  ]);
  assert.deepEqual(stock, { soldOut: 2, low: 2 });
  assert.deepEqual(hubMenuStock([{ is_available: false, remaining_servings: 20 }, { is_available: false }]), { soldOut: 0, low: 0 });
});

test('inventory is the inventory screen\'s count, not the 1.5x rule', () => {
  const ingredients = [
    { stock: 0, min_stock: 5, cost_per_unit: 1 },
    { stock: 5, min_stock: 5, cost_per_unit: 1 },
    { stock: 7, min_stock: 5, cost_per_unit: 1 },
    { stock: 3, min_stock: 0, cost_per_unit: 1 },
  ];
  assert.deepEqual(hubInventoryStock(ingredients), { out: 1, low: 1 });
  assert.equal(summarizeInventory(ingredients).lowStock, 2);
});

test('unseen insights are counted against the assistant\'s seen keys', () => {
  const insights = [
    { kind: 'stock_low', title: 'ของใกล้หมด', metric: '3' },
    { kind: 'sales_down', title: 'ยอดลด', metric: '-18%' },
  ];
  assert.deepEqual(hubUnseenInsights(insights, [insightKey(insights[0])]), { unseen: 1 });
  assert.deepEqual(hubUnseenInsights(insights, []), { unseen: 2 });
  assert.deepEqual(hubUnseenInsights([], ['x']), { unseen: 0 });
  assert.equal(insightKey(insights[1]), 'sales_down|ยอดลด|-18%');
});

// ---------------------------------------------------------------- wording

const floorOf = (free, total, waitingBills = 0, takeawayBills = 0) => ({ free, total, waitingBills, takeawayBills, cells: [] });

test('figures keep the screens\' own words, numbers marked strong', () => {
  const floor = floorOf(8, 14, 2);
  assert.equal(hubFigureText(floorFigure(floor, 'th')), 'ว่าง 8 จาก 14 โต๊ะ');
  assert.equal(hubFigureText(floorFigure(floor, 'en')), '8 of 14 tables free');
  assert.deepEqual(floorFigure(floor, 'th').filter((piece) => piece.strong).map((piece) => piece.text), ['8', '14']);
  const kitchen = { cooking: 4, overdue: 1, done: 7, lanes: [] };
  assert.equal(hubFigureText(kitchenFigure(kitchen, 'th')), 'กำลังทำ 4 รอบ');
  assert.equal(hubFigureText(kitchenFigure({ ...kitchen, cooking: 0 }, 'en')), 'Cooking 0 rounds');
  assert.equal(hubFigureText(paidTodayFigure({ count: 23 }, 'th')), 'ปิดบิลวันนี้ 23');
  assert.equal(hubFigureText(paidTodayFigure({ count: 1234 }, 'en')), 'Paid today 1,234');
});

test('a shop with no tables says so, never "0 of 0"', () => {
  assert.deepEqual(floorFigure(floorOf(0, 0), 'th'), [{ text: 'ยังไม่มีโต๊ะ' }]);
  assert.deepEqual(floorFigure(floorOf(0, 0, 0, 2), 'en'), [{ text: 'No tables yet' }]);
});

test('English counts agree with their number: one table, one round', () => {
  assert.equal(hubFigureText(floorFigure(floorOf(1, 1), 'en')), '1 of 1 table free');
  assert.equal(hubFigureText(floorFigure(floorOf(0, 1), 'en')), '0 of 1 table free');
  assert.equal(hubFigureText(floorFigure(floorOf(1, 2), 'en')), '1 of 2 tables free');
  const kitchen = { cooking: 1, overdue: 0, done: 0, lanes: [] };
  assert.equal(hubFigureText(kitchenFigure(kitchen, 'en')), 'Cooking 1 round');
  assert.equal(hubFigureText(kitchenFigure({ ...kitchen, cooking: 2 }, 'en')), 'Cooking 2 rounds');
  assert.equal(hubFigureText(kitchenFigure(kitchen, 'th')), 'กำลังทำ 1 รอบ');
  assert.equal(hubFigureText(floorFigure(floorOf(1, 1), 'th')), 'ว่าง 1 จาก 1 โต๊ะ');
});

test('bills at tables and takeaway bills are said apart, as info, and none is said', () => {
  assert.deepEqual(floorSegments(floorOf(4, 22, 1, 3), 'th'), [
    { text: 'รอเช็คบิล 1', tone: 'info' },
    { text: 'กลับบ้าน 3', tone: 'info' },
  ]);
  assert.equal(hubSegmentsText(floorSegments(floorOf(4, 22, 1, 3), 'th')), 'รอเช็คบิล 1, กลับบ้าน 3');
  assert.deepEqual(floorSegments(floorOf(4, 22, 2, 0), 'th'), [{ text: 'รอเช็คบิล 2', tone: 'info' }]);
  assert.deepEqual(floorSegments(floorOf(22, 22, 0, 3), 'th'), [{ text: 'กลับบ้าน 3', tone: 'info' }]);
  assert.deepEqual(floorSegments(floorOf(0, 0, 0, 2), 'th'), [{ text: 'กลับบ้าน 2', tone: 'info' }]);
  assert.equal(hubSegmentsText(floorSegments(floorOf(4, 22, 1, 3), 'en')), 'Waiting to pay 1, Takeaway 3');
  assert.deepEqual(floorSegments(floorOf(0, 0), 'th'), [{ text: 'ไม่มีบิลรอ' }]);
  assert.deepEqual(floorSegments(floorOf(0, 0), 'en'), [{ text: 'No bills waiting' }]);
});

test('kitchen line: late is danger and done is success only above zero', () => {
  assert.deepEqual(kitchenSegments({ cooking: 4, overdue: 1, done: 7, lanes: [] }, 'th'), [
    { text: 'เกินเวลา 1', tone: 'danger' },
    { text: 'เสร็จแล้ว 7', tone: 'success' },
  ]);
  const idle = kitchenSegments({ cooking: 0, overdue: 0, done: 0, lanes: [] }, 'th');
  assert.deepEqual(idle, [{ text: 'เกินเวลา 0' }, { text: 'เสร็จแล้ว 0' }]);
  assert.equal(hubSegmentsText(idle), 'เกินเวลา 0, เสร็จแล้ว 0');
  assert.equal(hubSegmentsText(kitchenSegments({ cooking: 1, overdue: 0, done: 2, lanes: [] }, 'en')), 'Overdue 0, Finished 2');
});

test('menu line: sold out danger, low warning, or nothing sold out', () => {
  assert.deepEqual(menuSegments({ soldOut: 3, low: 2 }, 'th'), [
    { text: 'หมด 3 เมนู', tone: 'danger' },
    { text: 'ใกล้หมด 2', tone: 'warning' },
  ]);
  assert.deepEqual(menuSegments({ soldOut: 0, low: 2 }, 'th'), [{ text: 'ใกล้หมด 2', tone: 'warning' }]);
  assert.deepEqual(menuSegments({ soldOut: 0, low: 0 }, 'th'), [{ text: 'ไม่มีเมนูหมด' }]);
  assert.equal(hubSegmentsText(menuSegments({ soldOut: 3, low: 2 }, 'th')), 'หมด 3 เมนู, ใกล้หมด 2');
  assert.equal(hubSegmentsText(menuSegments({ soldOut: 0, low: 0 }, 'en')), 'Nothing sold out');
});

test('inventory line: out danger, low warning, or all stocked', () => {
  assert.deepEqual(inventorySegments({ out: 2, low: 5 }, 'th'), [
    { text: 'หมด 2', tone: 'danger' },
    { text: 'ใกล้หมด 5', tone: 'warning' },
  ]);
  assert.deepEqual(inventorySegments({ out: 0, low: 5 }, 'th'), [{ text: 'ใกล้หมด 5', tone: 'warning' }]);
  assert.deepEqual(inventorySegments({ out: 0, low: 0 }, 'th'), [{ text: 'ของครบ' }]);
  assert.equal(hubSegmentsText(inventorySegments({ out: 2, low: 5 }, 'en')), 'Out 2, Low 5');
});

test('insights line: unseen is info, or nothing new', () => {
  assert.deepEqual(insightsSegments({ unseen: 2 }, 'th'), [{ text: 'ควรรู้วันนี้ 2', tone: 'info' }]);
  assert.deepEqual(insightsSegments({ unseen: 0 }, 'th'), [{ text: 'ไม่มีเรื่องใหม่' }]);
  assert.deepEqual(insightsSegments({ unseen: 0 }, 'en'), [{ text: 'Nothing new' }]);
});

test('no value line ever joins with a middle dot or leaves itself empty', () => {
  const lines = [
    floorSegments(floorOf(1, 2, 3, 2), 'th'),
    floorSegments(floorOf(0, 0), 'en'),
    kitchenSegments({ cooking: 1, overdue: 2, done: 3, lanes: [] }, 'th'),
    menuSegments({ soldOut: 1, low: 1 }, 'th'),
    inventorySegments({ out: 0, low: 0 }, 'th'),
    insightsSegments({ unseen: 0 }, 'en'),
  ];
  for (const line of lines) {
    assert.ok(line.length > 0);
    assert.ok(line.every((segment) => segment.text.trim().length > 0));
    assert.ok(!hubSegmentsText(line).includes('·'));
  }
});

test('the leading dot takes the most severe tone present', () => {
  assert.equal(mostSevereTone([{ text: 'a', tone: 'warning' }, { text: 'b', tone: 'danger' }]), 'danger');
  assert.equal(mostSevereTone([{ text: 'a', tone: 'success' }, { text: 'b', tone: 'info' }]), 'info');
  assert.equal(mostSevereTone([{ text: 'a' }]), null);
});

test('branch label matches the web: สาขา added only when missing, a missing branch said', () => {
  assert.equal(branchLabel('สาขาหลัก', 'th'), 'สาขาหลัก');
  assert.equal(branchLabel('สยาม', 'th'), 'สาขาสยาม');
  assert.equal(branchLabel('  เซ็นทรัล  ', 'th'), 'สาขาเซ็นทรัล');
  assert.equal(branchLabel('', 'th'), 'ไม่ระบุสาขา');
  assert.equal(branchLabel(null, 'th'), 'ไม่ระบุสาขา');
  assert.equal(branchLabel(undefined, 'en'), 'No branch set');
  assert.equal(branchLabel('Main branch', 'en'), 'Main branch');
  assert.equal(branchLabel('Siam', 'en'), 'Siam branch');
  assert.equal(branchLabel('สาขาหลัก', 'en'), 'สาขาหลัก');
});

// ---------------------------------------------------------------- who loads what

// backend/config/seed/seed.go
const SEEDED = {
  manager: ['view_dashboard', 'manage_menu', 'manage_promotions', 'view_tables', 'manage_table', 'take_order', 'view_orders', 'take_payment', 'view_kitchen', 'update_order_status', 'view_inventory', 'manage_inventory', 'manage_expenses', 'view_reports', 'manage_invites', 'manage_members', 'manage_roles', 'view_audit_log', 'manage_restaurant_settings'],
  cashier: ['take_order', 'take_payment', 'view_orders', 'view_dashboard', 'view_kitchen', 'view_inventory'],
  waiter: ['take_order', 'take_payment', 'view_orders', 'view_dashboard', 'view_kitchen', 'view_inventory'],
  chef: ['view_kitchen', 'update_order_status', 'view_inventory'],
};

const member = (roleName, permissions) => ({
  role: { name: roleName, permissions: permissions ? JSON.stringify(permissions) : undefined },
});
const planFor = (roleName, permissions) => {
  const membership = member(roleName, permissions);
  return hubLoaderPlan({ can: (permission) => can(membership, permission), roleName });
};

test('owner: every loader, the stream and the takings', () => {
  assert.deepEqual(planFor('owner', ['*']), {
    takings: true, floor: true, kitchen: true, paidToday: true, menu: true, inventory: true, insights: true, stream: true,
  });
});

test('manager: everything but the assistant', () => {
  assert.deepEqual(planFor('manager', SEEDED.manager), {
    takings: true, floor: true, kitchen: true, paidToday: true, menu: true, inventory: true, insights: false, stream: true,
  });
});

test('seeded waiter and cashier: floor, kitchen, paid count and stock, no takings', () => {
  const expected = { takings: false, floor: true, kitchen: true, paidToday: true, menu: false, inventory: true, insights: false, stream: true };
  assert.deepEqual(planFor('waiter', SEEDED.waiter), expected);
  assert.deepEqual(planFor('cashier', SEEDED.cashier), expected);
});

test('seeded chef: the kitchen and the stock', () => {
  assert.deepEqual(planFor('chef', SEEDED.chef), {
    takings: false, floor: false, kitchen: true, paidToday: false, menu: false, inventory: true, insights: false, stream: true,
  });
});

test('take_order alone: the floor only, never the archive\'s paid query', () => {
  assert.deepEqual(planFor('waiter', ['take_order']), {
    takings: false, floor: true, kitchen: false, paidToday: false, menu: false, inventory: false, insights: false, stream: true,
  });
});

test('a member with stock and settings only opens no stream', () => {
  assert.deepEqual(planFor('staff', ['view_inventory']), {
    takings: false, floor: false, kitchen: false, paidToday: false, menu: false, inventory: true, insights: false, stream: false,
  });
});

test('the fallback role lists apply when a role carries no permissions', () => {
  // rbac.ts fallback: cashier = view_dashboard, take_payment, view_orders, view_tables.
  assert.deepEqual(planFor('cashier'), {
    takings: false, floor: false, kitchen: false, paidToday: true, menu: false, inventory: false, insights: false, stream: true,
  });
});

// What each backend endpoint accepts (controllers in backend/internal/controller),
// and what puts each row on the hub (app-shell navigation). Both are pinned to
// their sources further down.
const BACKEND_ACCEPTS = {
  // ListOrders with a date: requireOrderListAccess lets take_order through only for status=active.
  takings: (has) => has('view_orders'),
  floor: (has) => ['view_tables', 'manage_table', 'take_order'].some(has) && (has('view_orders') || has('take_order')),
  kitchen: (has) => has('view_kitchen'),
  paidToday: (has) => has('view_orders'),
  menu: (has) => ['view_menu', 'manage_menu', 'take_order', 'manage_promotions'].some(has),
  inventory: (has) => has('view_inventory') || has('manage_inventory'),
  insights: (_has, roleName) => roleName === 'owner',
  stream: (has) => HUB_ORDER_STREAM_PERMISSIONS.some(has),
};
const ROW_SHOWN = {
  takings: (has) => has('view_dashboard'),
  floor: (has) => has('take_order'),
  kitchen: (has) => has('view_kitchen'),
  // The orders row: app-shell gates it on orderRoutePermissions (view_orders).
  paidToday: (has) => orderRoutePermissions.some(has),
  menu: (has) => has('view_menu') || has('manage_menu'),
  inventory: (has) => has('view_inventory') || has('manage_inventory'),
  insights: (_has, roleName) => roleName === 'owner',
};

test('no permission set can make a hub request the backend refuses, or load a row that is not shown', () => {
  const relevant = ['view_dashboard', 'view_orders', 'view_reports', 'take_order', 'take_payment', 'view_kitchen', 'update_order_status', 'view_menu', 'manage_menu', 'view_inventory', 'manage_inventory', 'view_tables'];
  for (const roleName of ['owner', 'staff']) {
    for (let mask = 0; mask < 1 << relevant.length; mask += 1) {
      const granted = relevant.filter((_, index) => mask & (1 << index));
      const has = (permission) => granted.includes(permission);
      const plan = hubLoaderPlan({ can: has, roleName });
      for (const key of HUB_LOADER_KEYS) {
        if (!plan[key]) continue;
        assert.ok(BACKEND_ACCEPTS[key](has, roleName), `${key} would 403 for ${granted.join(',')}`);
        assert.ok(ROW_SHOWN[key](has, roleName), `${key} loads for a hidden row: ${granted.join(',')}`);
      }
      if (plan.stream) assert.ok(BACKEND_ACCEPTS.stream(has), `stream would 403 for ${granted.join(',')}`);
      // Takings are for owners and managers: /home, the day list and the reports.
      assert.equal(plan.takings, has('view_dashboard') && has('view_orders') && has('view_reports'));
    }
  }
});

test('the row gates mirror app-shell navigation', () => {
  const shell = source('src/components/app-shell.tsx');
  const row = (key) => shell.split('\n').find((line) => line.includes(`{ key: '${key}',`)) ?? '';
  assert.match(row('home'), /permission: 'view_dashboard'/);
  assert.match(row('pos'), /permission: 'take_order'/);
  assert.match(row('kitchen'), /permission: 'view_kitchen'/);
  assert.match(row('orders'), /permissions: orderRoutePermissions/);
  assert.match(row('menu'), /permission: 'view_menu', fallbackPermission: 'manage_menu'/);
  assert.match(row('inventory'), /permission: 'view_inventory', fallbackPermission: 'manage_inventory'/);
  assert.match(row('ai'), /ownerOnly: true/);
});

const backendFile = (relative) => path.join(repoRoot, 'backend', 'internal', 'controller', relative);
const backendPresent = existsSync(backendFile('order.go'));

test('the endpoint gates mirror the backend controllers', { skip: !backendPresent && 'backend not checked out' }, () => {
  const read = (relative) => readFileSync(backendFile(relative), 'utf8');
  const order = read('order.go');
  const listAccess = order.slice(order.indexOf('func requireOrderListAccess'), order.indexOf('func requireOrderReadAccess'));
  assert.match(listAccess, /memberCan\(c, "view_orders"\)/);
  assert.match(listAccess, /memberCan\(c, "take_order"\) &&\s*normalizedOrderListStatus\(c\) == "active"/);
  const queue = order.slice(order.indexOf('func (ctrl *OrderController) KitchenQueue'));
  assert.match(queue.slice(0, 400), /requireOrderAccess\(c, "view_kitchen"\)/);
  const events = order.slice(order.indexOf('func (ctrl *OrderController) OrderEvents'));
  for (const permission of HUB_ORDER_STREAM_PERMISSIONS) assert.ok(events.slice(0, 400).includes(`"${permission}"`), permission);
  assert.match(read('table.go'), /"view_tables", "manage_table", "take_order"/);
  assert.match(read('ingredient.go'), /"view_inventory", "manage_inventory"/);
  assert.match(read('menu.go'), /"view_menu", "manage_menu", "take_order", "manage_promotions"/);
  const insights = read('ai.go');
  assert.match(insights.slice(insights.indexOf('func (ctrl *AIController) ProactiveInsights'), insights.indexOf('func (ctrl *AIController) ProactiveInsights') + 300), /requireAIOwner\(c\)/);
});

test('each row names the loaders its page can move', () => {
  const rows = ['home', 'pos', 'kitchen', 'orders', 'menu', 'inventory', 'tables-manage', 'expenses', 'reports', 'ai', 'settings'];
  assert.deepEqual(Object.keys(HUB_ROW_LOADERS).sort(), [...rows].sort());
  for (const row of rows) for (const key of HUB_ROW_LOADERS[row]) assert.ok(HUB_LOADER_KEYS.includes(key), `${row}: ${key}`);
  assert.deepEqual(HUB_ROW_LOADERS.inventory, ['inventory', 'menu']);
  // Menu and stock never ride the stream, so the pages that move them name them:
  // an order at POS commits portions and taking payment finalises ready food
  // (stock out, a dish switched off); the kitchen deducts stock on ready and a
  // cancel releases portions.
  assert.deepEqual(HUB_ROW_LOADERS.pos, ['floor', 'kitchen', 'paidToday', 'takings', 'menu', 'inventory']);
  assert.deepEqual(HUB_ROW_LOADERS.kitchen, ['kitchen', 'floor', 'menu', 'inventory']);
});

// ---------------------------------------------------------------- the order stream

test('a resync reloads the four order-driven loaders', () => {
  assert.deepEqual(hubLoadersForEvents({ actions: [], resync: true }), ['takings', 'floor', 'kitchen', 'paidToday']);
  assert.deepEqual(hubLoadersForEvents({ actions: [], resync: false }), []);
});

test('only a bill closing touches the paid count and the day list', () => {
  assert.deepEqual(hubLoadersForEvents({ actions: ['order.closed'], resync: false }), ['takings', 'floor', 'paidToday']);
  assert.deepEqual(hubLoadersForEvents({ actions: ['order.paid'], resync: false }), ['takings', 'floor', 'kitchen', 'paidToday']);
  assert.deepEqual(hubLoadersForEvents({ actions: ['order.cancelled'], resync: false }), ['takings', 'floor', 'kitchen', 'paidToday']);
});

test('kitchen actions reload the kitchen and the floor; the rest the floor alone', () => {
  for (const action of ['order.sent_to_kitchen', 'item.status_updated', 'customer_order.submitted', 'order.updated']) {
    assert.deepEqual(hubLoadersForEvents({ actions: [action], resync: false }), ['floor', 'kitchen'], action);
  }
  for (const action of ['order.created', 'item.added', 'item.updated', 'item.deleted', 'order.repriced']) {
    assert.deepEqual(hubLoadersForEvents({ actions: [action], resync: false }), ['floor'], action);
  }
});

test('the kitchen tile reloads on exactly the kitchen screen\'s actions, and nothing rides the stream to stock or AI', () => {
  const actions = ['order.created', 'order.updated', 'order.cancelled', 'order.closed', 'order.paid', 'item.added', 'item.updated', 'item.deleted', 'order.sent_to_kitchen', 'item.status_updated', 'customer_order.submitted'];
  for (const action of actions) {
    const keys = hubLoadersForEvents({ actions: [action], resync: false });
    assert.equal(keys.includes('kitchen'), isKitchenOrderChangeEvent({ type: 'orders.changed', action, occurred_at: '' }), action);
    for (const heavy of HUB_HEAVY_LOADERS) assert.ok(!keys.includes(heavy), `${action} -> ${heavy}`);
  }
  assert.deepEqual(hubLoadersForEvents({ actions, resync: true }), ['takings', 'floor', 'kitchen', 'paidToday']);
});

// ---------------------------------------------------------------- when to load

const idle = { loadedAt: null, startedAt: null, inFlight: false };

test('light loaders keep 10 s, heavy ones five minutes, the day list a 15 s gap', () => {
  for (const key of HUB_LIGHT_LOADERS) assert.equal(hubLoaderMinAge(key), 10_000);
  for (const key of HUB_HEAVY_LOADERS) assert.equal(hubLoaderMinAge(key), 300_000);
  assert.equal(hubLoaderMinInterval('takings'), 15_000);
  assert.equal(hubLoaderMinInterval('floor'), 3_000);
  assert.deepEqual([...HUB_LIGHT_LOADERS, ...HUB_HEAVY_LOADERS].sort(), [...HUB_LOADER_KEYS].sort());
});

test('a first load runs; a young value is left alone', () => {
  assert.deepEqual(hubLoadDecision(idle, { now: 1_000, minAgeMs: 10_000, minIntervalMs: 3_000 }), { kind: 'run' });
  const loaded = { loadedAt: 50_000, startedAt: 49_000, inFlight: false };
  assert.deepEqual(hubLoadDecision(loaded, { now: 55_000, minAgeMs: 10_000, minIntervalMs: 3_000 }), { kind: 'fresh' });
  assert.deepEqual(hubLoadDecision(loaded, { now: 60_000, minAgeMs: 10_000, minIntervalMs: 3_000 }), { kind: 'run' });
});

test('changes within the gap wait for a trailing call; one in flight is queued', () => {
  const recent = { loadedAt: 50_500, startedAt: 50_000, inFlight: false };
  assert.deepEqual(hubLoadDecision(recent, { now: 51_000, minIntervalMs: 3_000 }), { kind: 'wait', delayMs: 2_000 });
  assert.deepEqual(hubLoadDecision(recent, { now: 53_000, minIntervalMs: 3_000 }), { kind: 'run' });
  const flying = { loadedAt: 40_000, startedAt: 50_000, inFlight: true };
  assert.deepEqual(hubLoadDecision(flying, { now: 51_000, minIntervalMs: 3_000 }), { kind: 'queue' });
});

test('force skips the age and the gap but never doubles a request in flight', () => {
  const recent = { loadedAt: 50_500, startedAt: 50_000, inFlight: false };
  assert.deepEqual(hubLoadDecision(recent, { now: 50_600, minAgeMs: 300_000, minIntervalMs: 3_000, force: true }), { kind: 'run' });
  assert.deepEqual(hubLoadDecision({ ...recent, inFlight: true }, { now: 50_600, minIntervalMs: 3_000, force: true }), { kind: 'queue' });
});

test('a failed load is retried on the next focus, not treated as fresh', () => {
  // loadedAt only moves on success.
  const failed = { loadedAt: null, startedAt: 50_000, inFlight: false };
  assert.deepEqual(hubLoadDecision(failed, { now: 60_000, minAgeMs: 10_000, minIntervalMs: 3_000 }), { kind: 'run' });
});

test('recovery polling waits until the stream has been down 30 s', () => {
  assert.equal(hubShouldRecover(null, 100_000), false);
  assert.equal(hubShouldRecover(80_000, 100_000), false);
  assert.equal(hubShouldRecover(70_000, 100_000), true);
  assert.equal(HUB_TIMING.recoveryPollMs, 30_000);
  assert.equal(HUB_TIMING.clockTickMs, 20_000);
  assert.equal(HUB_TIMING.connectedSkipMs, 2_000);
});

test('the slow poll always reloads the floor, and the kitchen once the stream has been down 30 s', () => {
  // A table reserved, freed or switched off publishes no order event.
  assert.deepEqual(hubPollLoaders(null, 100_000), ['floor']);
  assert.deepEqual(hubPollLoaders(80_000, 100_000), ['floor']);
  assert.deepEqual(hubPollLoaders(70_000, 100_000), ['floor', 'kitchen']);
  for (const heavy of HUB_HEAVY_LOADERS) assert.ok(!hubPollLoaders(0, 100_000).includes(heavy), heavy);
});

// Loaded at T0 (the request left 200 ms earlier), the hub covered at T0+1 s -
// its stream closes - and back at T0+8 s: a bill paid on another phone at T0+5 s
// reached nobody, and the stream's greeting is skipped on reconnect.
const T0 = 50_000;
const loadedAtT0 = { loadedAt: T0, loadedFrom: T0 - 200, startedAt: T0 - 200, inFlight: false };
const decideOnFocus = (key, clock, lastBlurAt, forced = false) => hubLoadDecision(clock, {
  now: T0 + 8_000,
  minIntervalMs: hubLoaderMinInterval(key),
  ...hubFocusLoad(key, clock, lastBlurAt, forced),
});

test('a refocus inside 10 s reloads every light value loaded before the blur', () => {
  assert.deepEqual(decideOnFocus('floor', loadedAtT0, T0 + 1_000), { kind: 'run' });
  assert.deepEqual(decideOnFocus('kitchen', loadedAtT0, T0 + 1_000), { kind: 'run' });
  assert.deepEqual(decideOnFocus('paidToday', loadedAtT0, T0 + 1_000), { kind: 'run' });
  // The day list keeps its 15 s gap, with a trailing call rather than none.
  assert.deepEqual(decideOnFocus('takings', loadedAtT0, T0 + 1_000), { kind: 'wait', delayMs: 6_800 });
});

test('with no blur since the value left, a young light value is still fresh', () => {
  for (const key of HUB_LIGHT_LOADERS) {
    assert.deepEqual(decideOnFocus(key, loadedAtT0, null), { kind: 'fresh' }, key);
    // A request that left after the blur saw everything the stream missed.
    const afterBlur = { loadedAt: T0 + 3_000, loadedFrom: T0 + 2_500, startedAt: T0 + 2_500, inFlight: false };
    assert.deepEqual(decideOnFocus(key, afterBlur, T0 + 1_000), { kind: 'fresh' }, key);
  }
});

test('a blur changes nothing for menu, stock and AI, which never ride the stream', () => {
  for (const key of HUB_HEAVY_LOADERS) {
    assert.deepEqual(decideOnFocus(key, loadedAtT0, T0 + 1_000), { kind: 'fresh' }, key);
    assert.deepEqual(decideOnFocus(key, loadedAtT0, T0 + 1_000, true), { kind: 'run' }, key);
  }
});

test('a request still in flight from before the blur is followed by one more', () => {
  const flying = { loadedAt: T0 - 60_000, loadedFrom: T0 - 60_500, startedAt: T0 + 500, inFlight: true };
  const options = hubFocusLoad('floor', flying, T0 + 1_000, false);
  assert.equal(options.afterChange, true);
  assert.deepEqual(decideOnFocus('floor', flying, T0 + 1_000), { kind: 'queue' });
  // A value the hub never had is never fresh either.
  assert.equal(hubFocusLoad('floor', { loadedAt: null, startedAt: null, inFlight: false }, T0, false).minAgeMs, 0);
});

// ---------------------------------------------------------------- after midnight

// 23:59:30 on the 23rd and 00:00:05 on the 24th, Bangkok.
const LATE = Date.parse('2026-09-23T16:59:30Z');
const PAST_MIDNIGHT = Date.parse('2026-09-23T17:00:05Z');
const heldFrom = (at) => ({ loadedAt: at + 300, loadedFrom: at, startedAt: at, inFlight: false });

test('the takings and the paid count belong to one day; nothing else does', () => {
  assert.deepEqual(HUB_DAY_LOADERS, ['takings', 'paidToday']);
  for (const key of HUB_DAY_LOADERS) assert.ok(HUB_LIGHT_LOADERS.includes(key), key);
});

test('after midnight yesterday\'s takings and paid count are no value at all', () => {
  assert.equal(hubHeldValueIsCurrent('takings', '2026-09-23', LATE), true);
  assert.equal(hubHeldValueIsCurrent('takings', '2026-09-23', PAST_MIDNIGHT), false);
  assert.equal(hubHeldValueIsCurrent('paidToday', '2026-09-23', PAST_MIDNIGHT), false);
  assert.equal(hubHeldValueIsCurrent('takings', '2026-09-24', PAST_MIDNIGHT), true);
  assert.equal(hubHeldValueIsCurrent('takings', null, PAST_MIDNIGHT), false);
  // The floor, the kitchen and the stock are whatever the last load said.
  for (const key of ['floor', 'kitchen', 'menu', 'inventory', 'insights']) {
    assert.equal(hubHeldValueIsCurrent(key, '2026-09-23', PAST_MIDNIGHT), true, key);
  }
});

test('every tick after midnight asks again for a day value until one lands', () => {
  // Stress test, 2026-09-23: the day reload went out once; when it failed,
  // yesterday's total stayed under "ยอดวันนี้" until something else reloaded it.
  const clocks = Object.fromEntries(HUB_LOADER_KEYS.map((key) => [key, heldFrom(LATE)]));
  const stale = (overrides, now) => hubStaleDayLoaders((key) => overrides[key] ?? clocks[key], now);
  assert.deepEqual(stale({}, LATE + 20_000), []);
  assert.deepEqual(stale({}, PAST_MIDNIGHT), ['takings', 'paidToday']);
  // A failed reload moves only startedAt, so the next tick asks again.
  const failed = { ...clocks.takings, startedAt: PAST_MIDNIGHT };
  assert.deepEqual(stale({ takings: failed }, PAST_MIDNIGHT + 20_000), ['takings', 'paidToday']);
  // Once today's value lands it stops.
  assert.deepEqual(stale({ takings: heldFrom(PAST_MIDNIGHT) }, PAST_MIDNIGHT + 20_000), ['paidToday']);
  // Nothing held yet belongs to no day: a first load is the focus load's and its retry's.
  const never = { loadedAt: null, loadedFrom: null, startedAt: PAST_MIDNIGHT, inFlight: false };
  assert.deepEqual(stale({ takings: never, paidToday: never }, PAST_MIDNIGHT + 20_000), []);
});

// ---------------------------------------------------------------- a whole day of orders

test('the day list pages on has_more and keeps an order once', async () => {
  const pages = {
    1: { orders: [{ ID: 5 }, { ID: 4 }], pagination: { has_more: true } },
    // An order opened between the reads pushed #4 onto page two.
    2: { orders: [{ ID: 4 }, { ID: 3 }], pagination: { has_more: true } },
    3: { orders: [{ ID: 2 }], pagination: { has_more: false } },
  };
  const asked = [];
  const result = await collectDayOrders(async (page) => {
    asked.push(page);
    return pages[page];
  });
  assert.deepEqual(asked, [1, 2, 3]);
  assert.deepEqual(result.orders.map((order) => order.ID), [5, 4, 3, 2]);
  assert.equal(result.complete, true);
});

test('the day list stops at its ceiling and says it is incomplete', async () => {
  let asked = 0;
  const result = await collectDayOrders(async (page) => {
    asked += 1;
    return { orders: [{ ID: page }], pagination: { has_more: true } };
  });
  assert.equal(asked, DAY_ORDERS_MAX_PAGES);
  assert.equal(result.orders.length, DAY_ORDERS_MAX_PAGES);
  assert.equal(result.complete, false);
});

test('a page without pagination ends the day list', async () => {
  const result = await collectDayOrders(async () => ({ orders: [{ ID: 1 }] }));
  assert.deepEqual(result, { orders: [{ ID: 1 }], complete: true });
});

// ---------------------------------------------------------------- guards at the call sites

test('the hub derives through the screens\' own helpers, never the /home summaries', () => {
  const lib = code('src/lib/hub-data.ts');
  for (const helper of ['kitchenBoardStats(', 'inventoryTotals(', 'tableTileStatus(', 'menuStockBadge(', 'summarizeHomeOrders(', 'homeRevenueCurve(', "orderListRequest('archive'"]) {
    assert.ok(lib.includes(helper), helper);
  }
  for (const other of ['summarizeKitchenQueue', 'summarizeInventory']) assert.ok(!lib.includes(other), other);
  const hook = code('src/hooks/use-hub-data.ts');
  for (const skipped of ['listReservations', 'listExpenses', 'getManagerReport', 'summarizeKitchenQueue', 'summarizeInventory']) {
    assert.ok(!hook.includes(skipped), skipped);
  }
  assert.match(hook, /listOrders\(\{ status: 'active', limit: 200 \}\)/);
  assert.match(hook, /listOrders\(hubPaidTodayRequest\(today\)\)/);
  assert.match(hook, /loadDayOrders\(today\)/);
});

test('/home reads the same paged day list as the hub', () => {
  const home = code('app/home.tsx');
  assert.match(home, /loadDayOrders\(selectedDate\)/);
  assert.ok(!/listOrders\(\{ date: selectedDate/.test(home));
});

test('everything the hub runs is tied to its focus', () => {
  // The hub stays mounted under every page pushed over it: a stream or timer
  // not tied to focus keeps running under the kitchen for the whole session.
  const hook = code('src/hooks/use-hub-data.ts');
  assert.match(hook, /useOrderEvents\(onOrderEvents, \{\s*enabled: isFocused && /);
  const start = hook.indexOf('useFocusEffect(useCallback(() => {');
  const end = hook.indexOf('}, [controller, planKey, scope]));');
  assert.ok(start > 0 && end > start, 'focus effect not found');
  const focus = hook.slice(start, end);
  const outside = hook.slice(0, start) + hook.slice(end);
  const count = (text, needle) => text.split(needle).length - 1;
  assert.equal(count(outside, 'setInterval('), 0, 'an interval outside the focus effect');
  assert.equal(count(focus, 'setInterval('), count(focus, 'clearInterval('), 'every interval is cleared on blur');
  // InteractionManager is deprecated in RN 0.86 and warns on screen; the heavy
  // loads wait out the pop animation on a timer that blur clears.
  assert.doesNotMatch(hook, /InteractionManager/);
  assert.match(focus, /const heavy = setTimeout\(/);
  assert.match(focus, /clearTimeout\(heavy\)/);
  assert.match(focus, /focusedRef\.current = false;/);
  assert.match(focus, /clearTrailing\(runtimeRef\.current\)/);
  // The one timeout outside it is the trailing call, which refuses to run blurred.
  assert.equal(count(outside, 'setTimeout('), 1);
  assert.match(outside, /setTimeout\(\(\) => \{\s*runtime\.trailingTimer = null;\s*if \(focusedRef\.current && /);
});

test('a refocus reloads through hubFocusLoad with the blur the cleanup recorded', () => {
  // Without the blur stamp, or with a bare minimum age, a refocus inside 10 s
  // fetches nothing while the stream's greeting is skipped: changes made while
  // the hub was covered never arrive.
  const hook = code('src/hooks/use-hub-data.ts');
  const start = hook.indexOf('useFocusEffect(useCallback(() => {');
  const end = hook.indexOf('}, [controller, planKey, scope]));');
  const focus = hook.slice(start, end);
  assert.match(focus, /const blurredAt = lastBlurAtRef\.current;/);
  assert.match(focus, /controller\.request\(key, hubFocusLoad\(key, runtimeRef\.current\[key\]\.clock, blurredAt, forced\.has\(key\)\)\)/);
  assert.match(focus, /HUB_LIGHT_LOADERS\.forEach\(focusLoad\)/);
  assert.match(focus, /HUB_HEAVY_LOADERS\.forEach\(focusLoad\)/);
  assert.ok(!hook.includes('hubLoaderMinAge('), 'a focus load skips hubFocusLoad');
  const cleanup = focus.slice(focus.lastIndexOf('return () => {'));
  assert.match(cleanup, /lastBlurAtRef\.current = Date\.now\(\);/);
  // The stamp hubFocusLoad compares with the blur: when the held value's request left.
  assert.match(hook, /const startedAt = Date\.now\(\);/);
  assert.match(hook, /loadedAt: Date\.now\(\), loadedFrom: startedAt/);
  // The slow poll goes through hubPollLoaders, so the floor is polled while the stream is live.
  assert.match(focus, /for \(const key of hubPollLoaders\(notLiveSinceRef\.current, Date\.now\(\)\)\) void controller\.request\(key\);/);
});

test('after midnight the hook shows no day value from yesterday, and retries the day reload on every tick', () => {
  const hook = code('src/hooks/use-hub-data.ts');
  const start = hook.indexOf('useFocusEffect(useCallback(() => {');
  const end = hook.indexOf('}, [controller, planKey, scope]));');
  const focus = hook.slice(start, end);
  // The tick asks by the day each held value was asked for, not by a day it
  // noted before the reload landed.
  assert.match(focus, /for \(const key of hubStaleDayLoaders\(\(key\) => runtimeRef\.current\[key\]\.clock, at\)\) \{\s*void controller\.request\(key, \{ force: true \}\);/);
  assert.ok(!hook.includes('dayRef'), 'a day stamp moved before the reload landed');
  // Each value keeps the day its request was made for, and the slot and the
  // failure path both ask whether that day is still today.
  assert.match(hook, /const today = formatBangkokDate\(new Date\(startedAt\)\);/);
  assert.match(hook, /status: 'ready', raw, day: today/);
  assert.match(hook, /held\.raw !== null && hubHeldValueIsCurrent\(key, held\.day, Date\.now\(\)\)/);
  assert.match(hook, /entry\.status === 'ready' && !hubHeldValueIsCurrent\(key, entry\.day, clock\)/);
});

test('the kitchen keeps its stream: the wrapper passes the kitchen\'s own filter', () => {
  const wrapper = code('src/hooks/use-kitchen-order-events.ts');
  assert.match(wrapper, /useOrderEvents\(\(\) => callback\(\), \{/);
  assert.match(wrapper, /accepts: isKitchenOrderChangeEvent/);
  assert.ok(!wrapper.includes('skipConnectedRefreshWithinMs'));
});

test('insightKey lives in the lib and the sheet only re-exports it', () => {
  const sheet = code('src/components/ai/insights-sheet.tsx');
  assert.ok(!sheet.includes('function insightKey'));
  assert.match(sheet, /import \{ insightKey \} from '@\/src\/lib\/ai-insight-key';/);
  assert.match(sheet, /export \{ insightKey \};/);
});
