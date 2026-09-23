import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fittedNameSize,
  firstStageTile,
  floorBarWidths,
  floorCellWidth,
  floorStripHeight,
  floorStripShape,
  pairStacks,
  parseRememberedFloors,
  REMEMBERED_FLOORS_MAX,
  rememberFloor,
  serializeRememberedFloors,
  shelfBadge,
  shelfBadgeText,
  shelfLayout,
  stageActivity,
  stageContentWidth,
  stageHeartbeat,
  stageShelfGroups,
  stageTileRows,
  valueLines,
} from './hub-stage-layout.ts';

const noop = () => {};
const ready = (value) => ({ status: 'ready', value, retry: noop });
const loading = () => ({ status: 'loading', value: null, retry: noop });
const failed = () => ({ status: 'error', value: null, retry: noop });
const off = () => ({ status: 'off', value: null, retry: noop });

const floor = (cells, waitingBills = 0, takeawayBills = 0) => ({
  free: cells.filter((cell) => cell.tone === 'free').length,
  total: cells.length,
  waitingBills,
  takeawayBills,
  cells,
});
const cell = (key, tone, waitingBill = false) => ({ key, tone, waitingBill });
const kitchen = (cooking) => ({ cooking, overdue: 0, done: 0, lanes: [] });

test('the floor runs wide and kitchen pairs with orders, for an owner', () => {
  const rows = stageTileRows(['home', 'pos', 'kitchen', 'orders', 'menu', 'settings'], true);
  assert.deepEqual(rows, [
    { kind: 'wide', key: 'pos' },
    { kind: 'pair', keys: ['kitchen', 'orders'] },
  ]);
  assert.equal(firstStageTile(rows), 'pos');
});

test('a chef with only the kitchen gets one wide kitchen tile', () => {
  const rows = stageTileRows(['kitchen', 'inventory', 'settings'], false);
  assert.deepEqual(rows, [{ kind: 'wide', key: 'kitchen' }]);
  assert.equal(firstStageTile(rows), 'kitchen');
});

test('orders that cannot be counted do not pair: the kitchen goes wide and orders drops under it', () => {
  assert.deepEqual(stageTileRows(['pos', 'kitchen', 'orders'], false), [
    { kind: 'wide', key: 'pos' },
    { kind: 'wide', key: 'kitchen' },
    { kind: 'wide', key: 'orders' },
  ]);
});

test('the order is fixed whatever order the items arrive in', () => {
  assert.deepEqual(stageTileRows(['orders', 'kitchen', 'pos'], true), [
    { kind: 'wide', key: 'pos' },
    { kind: 'pair', keys: ['kitchen', 'orders'] },
  ]);
  assert.deepEqual(stageTileRows(['orders', 'kitchen'], true), [{ kind: 'pair', keys: ['kitchen', 'orders'] }]);
  assert.equal(firstStageTile(stageTileRows(['orders', 'kitchen'], true)), 'kitchen');
});

test('no service screens means no tiles, and no heartbeat host', () => {
  const rows = stageTileRows(['settings', 'inventory'], false);
  assert.deepEqual(rows, []);
  assert.equal(firstStageTile(rows), null);
});

test('a seated table, a waiting bill or a cooking round makes the shop busy', () => {
  assert.equal(stageActivity(ready(floor([cell('1', 'occupied'), cell('2', 'free')])), loading()), 'busy');
  assert.equal(stageActivity(ready(floor([cell('1', 'free')], 1)), off()), 'busy');
  assert.equal(stageActivity(off(), ready(kitchen(2))), 'busy');
  assert.equal(stageActivity(failed(), ready(kitchen(1))), 'busy');
});

test('a takeaway bill waiting with every table free still makes the shop busy', () => {
  // waitingBills counts seated bills only (the blue cells); takeaway bills have no cell.
  const allFree = [cell('1', 'free'), cell('2', 'free')];
  assert.equal(stageActivity(ready(floor(allFree, 0, 3)), off()), 'busy');
  assert.equal(stageActivity(ready(floor(allFree, 0, 3)), ready(kitchen(0))), 'busy');
  assert.equal(stageActivity(ready(floor(allFree, 0, 0)), ready(kitchen(0))), 'idle');
});

test('the shop rests only once every value it has has answered empty', () => {
  const emptyFloor = ready(floor([cell('1', 'free'), cell('2', 'reserved')]));
  assert.equal(stageActivity(emptyFloor, ready(kitchen(0))), 'idle');
  assert.equal(stageActivity(emptyFloor, off()), 'idle');
  assert.equal(stageActivity(off(), ready(kitchen(0))), 'idle');
  assert.equal(stageActivity(emptyFloor, loading()), 'unknown');
  assert.equal(stageActivity(emptyFloor, failed()), 'unknown');
  assert.equal(stageActivity(off(), off()), 'unknown');
});

const values = (overrides = {}) => ({
  menu: off(),
  inventory: off(),
  insights: off(),
  ...overrides,
});

test('a shelf badge carries the most severe count, in its status tone', () => {
  assert.deepEqual(shelfBadge('menu', values({ menu: ready({ soldOut: 3, low: 2 }) })), { count: 3, tone: 'danger' });
  assert.deepEqual(shelfBadge('menu', values({ menu: ready({ soldOut: 0, low: 2 }) })), { count: 2, tone: 'warning' });
  assert.deepEqual(shelfBadge('inventory', values({ inventory: ready({ out: 2, low: 5 }) })), { count: 2, tone: 'danger' });
  assert.deepEqual(shelfBadge('inventory', values({ inventory: ready({ out: 0, low: 5 }) })), { count: 5, tone: 'warning' });
  assert.deepEqual(shelfBadge('ai', values({ insights: ready({ unseen: 2 }) })), { count: 2, tone: 'info' });
});

test('nothing to act on, or no value yet, shows no badge', () => {
  assert.equal(shelfBadge('menu', values({ menu: ready({ soldOut: 0, low: 0 }) })), null);
  assert.equal(shelfBadge('inventory', values({ inventory: ready({ out: 0, low: 0 }) })), null);
  assert.equal(shelfBadge('ai', values({ insights: ready({ unseen: 0 }) })), null);
  assert.equal(shelfBadge('menu', values({ menu: loading() })), null);
  assert.equal(shelfBadge('inventory', values({ inventory: failed() })), null);
  assert.equal(shelfBadge('ai', values()), null);
  // Rows with no loader of their own never carry one.
  for (const key of ['tables-manage', 'expenses', 'reports', 'settings']) {
    assert.equal(shelfBadge(key, values({ menu: ready({ soldOut: 9, low: 9 }) })), null);
  }
});

test('a badge never grows past two digits', () => {
  assert.equal(shelfBadgeText(5), '5');
  assert.equal(shelfBadgeText(99), '99');
  assert.equal(shelfBadgeText(120), '99+');
  assert.equal(shelfBadgeText(-1), '0');
});

const item = (key, group) => ({ key, title: key, icon: 'ellipse-outline', href: `/${key}`, group });

test('the shelf holds the shop group, then insights and account, never the service screens', () => {
  const groups = stageShelfGroups([
    item('home', 'work'), item('pos', 'work'), item('kitchen', 'work'), item('orders', 'work'),
    item('menu', 'shop'), item('inventory', 'shop'), item('tables-manage', 'shop'), item('expenses', 'shop'),
    item('reports', 'team'), item('ai', 'team'), item('settings', 'team'),
  ]);
  assert.deepEqual(groups.map((group) => [group.key, group.items.map((entry) => entry.key)]), [
    ['shop', ['menu', 'inventory', 'tables-manage', 'expenses']],
    ['team', ['reports', 'ai', 'settings']],
  ]);
});

test('an empty group is dropped, a group of one keeps its heading', () => {
  const groups = stageShelfGroups([item('kitchen', 'work'), item('settings', 'team')]);
  assert.deepEqual(groups.map((group) => [group.key, group.items.length]), [['team', 1]]);
});

// ---------------------------------------------------------------- content width

test('the content column is the window less the rail and both gutters, capped at the layout width', () => {
  assert.equal(stageContentWidth(411, 16, 720, 0), 379);
  assert.equal(stageContentWidth(360, 16, 720, 0), 328);
  // A landscape tablet: the 92 dp rail takes its share before the gutters do.
  assert.equal(stageContentWidth(1024, 24, 980, 92), 884);
  assert.equal(stageContentWidth(1400, 24, 980, 232), 980);
  assert.equal(stageContentWidth(20, 16, 720, 0), 0);
});

// ---------------------------------------------------------------- kitchen and orders pair

test('kitchen and orders pair at the default text size down to 340 dp of content', () => {
  assert.equal(pairStacks(379, 1), false); // Pixel 6
  assert.equal(pairStacks(340, 1), false);
  assert.equal(pairStacks(339, 1), true);
  assert.equal(pairStacks(328, 1), true); // 360 dp phone, as before
  assert.equal(pairStacks(288, 1), true); // 320 dp phone
  // A smaller OS text size never pairs on a narrower screen than the default does.
  assert.equal(pairStacks(339, 0.85), true);
});

test('a large OS text size stacks the pair before its words are cut', () => {
  // 'เกินเวลา 13, เสร็จแล้ว 15' was cut on a Pixel 6 at 1.3 and at 2.0 (stress, 2026-09-23).
  assert.equal(pairStacks(379, 1.3), true);
  assert.equal(pairStacks(379, 2), true);
  // 'Large' (1.15) needs about 379 dp: a 400 dp column keeps the pair, a 390 dp phone's 358 does not.
  assert.equal(pairStacks(400, 1.15), false);
  assert.equal(pairStacks(358, 1.15), true);
  // A landscape tablet has the room even at 200%.
  assert.equal(pairStacks(884, 2), false);
});

test('a status line may take a second line only at a large OS text size', () => {
  assert.equal(valueLines(1), 1);
  assert.equal(valueLines(1.15), 1);
  assert.equal(valueLines(1.3), 2);
  assert.equal(valueLines(2), 2);
});

// ---------------------------------------------------------------- shelf

test('the shelf keeps two columns on a phone at the default text size, down to 320 dp', () => {
  assert.deepEqual(shelfLayout(379, 1), { sideBySide: false, columns: 2 });
  assert.deepEqual(shelfLayout(328, 1), { sideBySide: false, columns: 2 });
  assert.deepEqual(shelfLayout(288, 1), { sideBySide: false, columns: 2 });
});

test('the shelf drops to one column when a large OS text size leaves a chip no room for its title', () => {
  assert.deepEqual(shelfLayout(379, 1.5), { sideBySide: false, columns: 2 });
  assert.deepEqual(shelfLayout(328, 1.5), { sideBySide: false, columns: 1 });
  assert.deepEqual(shelfLayout(379, 2), { sideBySide: false, columns: 1 });
});

test('a tablet sets the groups side by side at two columns each, measured beside the rail', () => {
  // 1024 landscape with the 92 dp rail: 884 dp of content, not the window's 976.
  assert.deepEqual(shelfLayout(884, 1), { sideBySide: true, columns: 2 });
  // The common 8-inch POS tablet, 962 dp wide with the rail.
  assert.deepEqual(shelfLayout(822, 1), { sideBySide: true, columns: 2 });
  assert.deepEqual(shelfLayout(976, 1), { sideBySide: true, columns: 2 });
  // A phone-width column never splits its groups.
  assert.deepEqual(shelfLayout(720, 1), { sideBySide: false, columns: 2 });
  // At 200% the groups stack again so each chip keeps its title.
  assert.deepEqual(shelfLayout(884, 2), { sideBySide: false, columns: 2 });
});

// ---------------------------------------------------------------- heartbeat

const takings = (curve) => ({ amount: 0, curve, startLabel: '10:00', nowLabel: '14:32' });
const rising = { startHour: 10, endHour: 14, cumulative: [0, 120, 480, 900, 1500] };
const flat = { startHour: 10, endHour: 10, cumulative: [0] };
const ownerRows = [{ kind: 'wide', key: 'pos' }, { kind: 'pair', keys: ['kitchen', 'orders'] }];

test('the now-dot beats only on a curve that rises, clear of the axis labels', () => {
  assert.deepEqual(stageHeartbeat('busy', true, ready(takings(rising)), ownerRows), { curve: true, tile: null });
});

test('with no rising curve the heartbeat moves to the first tile, not onto the axis label', () => {
  // Busy before the first payment: the dot sits on the baseline, over the now label.
  assert.deepEqual(stageHeartbeat('busy', true, ready(takings(null)), ownerRows), { curve: false, tile: 'pos' });
  // A paid ฿0 bill builds a curve that stays flat.
  assert.deepEqual(stageHeartbeat('busy', true, ready(takings(flat)), ownerRows), { curve: false, tile: 'pos' });
  // No curve drawn at all while the takings load or after they fail.
  assert.deepEqual(stageHeartbeat('busy', true, loading(), ownerRows), { curve: false, tile: 'pos' });
  assert.deepEqual(stageHeartbeat('busy', true, failed(), ownerRows), { curve: false, tile: 'pos' });
  // No takings line on the stage.
  assert.deepEqual(stageHeartbeat('busy', false, off(), ownerRows), { curve: false, tile: 'pos' });
});

test('an idle or unknown shop has no heartbeat anywhere', () => {
  assert.deepEqual(stageHeartbeat('idle', true, ready(takings(rising)), ownerRows), { curve: false, tile: null });
  assert.deepEqual(stageHeartbeat('unknown', false, off(), ownerRows), { curve: false, tile: null });
  assert.deepEqual(stageHeartbeat('busy', false, off(), []), { curve: false, tile: null });
});

// ---------------------------------------------------------------- floor strip

test('the strip is one row to 30 tables, two rows to 60, then a bar, stepping down early on a narrow strip', () => {
  assert.equal(floorStripShape(30, 349), 'row');
  assert.equal(floorStripShape(31, 349), 'rows');
  assert.equal(floorStripShape(60, 349), 'rows');
  assert.equal(floorStripShape(61, 349), 'bar');
  // 258 dp holds 23 minimum cells a row.
  assert.equal(floorStripShape(23, 258), 'row');
  assert.equal(floorStripShape(24, 258), 'rows');
  assert.equal(floorStripShape(47, 258), 'bar');
  // Before the width is known only the counts decide.
  assert.equal(floorStripShape(30, 0), 'row');
  assert.equal(floorStripShape(45, 0), 'rows');
});

test('the strip bone is as tall as the strip the last known count draws', () => {
  assert.equal(floorStripHeight(22, 349, 12), 12);
  assert.equal(floorStripHeight(31, 349, 12), 27);
  assert.equal(floorStripHeight(45, 349, 12), 27);
  assert.equal(floorStripHeight(500, 349, 12), 12);
  assert.equal(floorStripHeight(0, 349, 12), 0);
});

// Stress test, 2026-09-23: a 31-60 table floor jumped 15 pt on every cold
// open because the count the bone reads lived only in memory.
test('the last table count survives a restart, one entry per restaurant, newest last', () => {
  const stored = serializeRememberedFloors(rememberFloor(rememberFloor(new Map(), 7, 45), 3, 12));
  const read = parseRememberedFloors(stored);
  assert.equal(read.get(7), 45);
  assert.equal(read.get(3), 12);
  assert.equal(floorStripHeight(read.get(7), 349, 12), 27, 'a cold start draws the two-row bone');
  // Setting a restaurant again moves it to the end and keeps one entry.
  const again = rememberFloor(read, 7, 46);
  assert.deepEqual([...again], [[3, 12], [7, 46]]);
  // The input is left as it was.
  assert.equal(read.get(7), 45);
});

test('the remembered counts stay capped, dropping the oldest restaurant first', () => {
  let floors = new Map();
  for (let id = 1; id <= REMEMBERED_FLOORS_MAX + 3; id += 1) floors = rememberFloor(floors, id, id);
  assert.equal(floors.size, REMEMBERED_FLOORS_MAX);
  assert.equal(floors.has(1), false);
  assert.equal(floors.get(REMEMBERED_FLOORS_MAX + 3), REMEMBERED_FLOORS_MAX + 3);
});

test('an unreadable stored count is no count, never a throw', () => {
  for (const raw of [null, '', 'not json', '{"7":45}', '[[7]]', '[["7",45]]', '[[7,-1]]', '[[0,4]]', '[[7,4.5]]']) {
    assert.equal(parseRememberedFloors(raw).size, 0, String(raw));
  }
  assert.deepEqual([...parseRememberedFloors('[[7,45],["x",1],[8,0]]')], [[7, 45], [8, 0]]);
});

test('a few tables read as a few table squares, not a full-width bar', () => {
  assert.equal(floorCellWidth(1, 349, 22), 22);
  assert.equal(floorCellWidth(5, 349, 22), 22);
  // A full floor still shares the width out below the cap.
  assert.equal(floorCellWidth(22, 349, 22), 13);
  assert.ok(Math.abs(floorCellWidth(23, 349, 22) - 283 / 23) < 1e-9);
  // Uncapped, as layout A draws it.
  assert.equal(floorCellWidth(3, 349, Number.POSITIVE_INFINITY), 343 / 3);
});

test('every state on the bar keeps a visible width, however small its share', () => {
  // 500 tables, one bill, three occupied: the bill and the occupied are 10 pt each, not slivers.
  assert.deepEqual(floorBarWidths([1, 3, 0, 496], 349), [10, 10, 0, 325]);
  // One state alone fills the bar.
  assert.deepEqual(floorBarWidths([80, 0, 0, 0], 349), [349, 0, 0, 0]);
  // Shares above the minimum stay proportional to what is left.
  const widths = floorBarWidths([20, 40, 0, 40], 204);
  assert.deepEqual(widths, [40, 80, 0, 80]);
  const total = (list) => list.reduce((sum, width) => sum + width, 0);
  assert.equal(total(floorBarWidths([1, 3, 2, 494], 349)) + 3 * 2, 349);
});

// ---------------------------------------------------------------- shop name

test('a long shop name shrinks to 80% at most, then ellipsizes', () => {
  // 20 pt authored is 22 px drawn (APP_FONT_SCALE 1.08); sizes come back authored.
  assert.equal(fittedNameSize(180, 200, 20), 20);
  // 10% too wide: 20 px drawn, and 220 * 20 / 22 = 200 fits exactly.
  assert.equal(Math.round(fittedNameSize(220, 200, 20) * 1.08), 20);
  // Far too wide: floored at 80% (17 px drawn), never the 9 pt Android shrank it to.
  assert.equal(Math.round(fittedNameSize(600, 200, 20) * 1.08), 17);
  // Nothing measured yet: the full size.
  assert.equal(fittedNameSize(0, 200, 20), 20);
  assert.equal(fittedNameSize(300, 0, 20), 20);
});
