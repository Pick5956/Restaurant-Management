import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LOW_STOCK_SERVINGS } from './menu-catalog.ts';
import {
  activeCategoryFilter,
  menuLoadFailureLine,
  menuManageFailure,
  menuManageFailureCode,
  menuManageStock,
  menuManageView,
  menuStockWords,
  mergeAvailabilityReply,
  withAvailability,
} from './menu-manage.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');
/** Source with whole-line // comments dropped, so a guard reads code, not notes. */
const code = async (relative) => (await read(relative))
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

/** What src/api/client.ts throws: the server's `error` as the message, the status beside it. */
function apiError(message, status) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.status = status;
  error.url = 'http://example.invalid/api/v1/menu-items/7/availability';
  error.details = JSON.stringify({ error: message });
  return error;
}

// ---------------------------------------------------------------- stock

test('stock reads remaining servings only: out at zero or below, low at ten or fewer, unlimited without a recipe', () => {
  assert.deepEqual(menuManageStock({ remaining_servings: 0 }), { kind: 'out' });
  assert.deepEqual(menuManageStock({ remaining_servings: -2 }), { kind: 'out' });
  assert.deepEqual(menuManageStock({ remaining_servings: 1 }), { kind: 'low', count: 1 });
  assert.deepEqual(menuManageStock({ remaining_servings: LOW_STOCK_SERVINGS }), { kind: 'low', count: LOW_STOCK_SERVINGS });
  assert.deepEqual(menuManageStock({ remaining_servings: LOW_STOCK_SERVINGS + 1 }), { kind: 'plenty', count: LOW_STOCK_SERVINGS + 1 });
  assert.deepEqual(menuManageStock({ remaining_servings: null }), { kind: 'unlimited' });
  assert.deepEqual(menuManageStock({}), { kind: 'unlimited' });
});

test('a switched-off dish still shows its stock: the switch already says it is off', () => {
  // The hub counts sold out as remaining <= 0 whatever the switch says; the
  // manager tile must agree with it.
  assert.deepEqual(menuManageStock({ is_available: false, remaining_servings: 0 }), { kind: 'out' });
  assert.deepEqual(menuManageStock({ is_available: false, remaining_servings: 4 }), { kind: 'low', count: 4 });
});

test('stock words say every state, including no limit, in both languages', () => {
  assert.equal(menuStockWords({ kind: 'out' }, 'th'), 'หมด');
  assert.equal(menuStockWords({ kind: 'out' }, 'en'), 'Sold out');
  assert.equal(menuStockWords({ kind: 'unlimited' }, 'th'), 'ไม่จำกัด');
  assert.equal(menuStockWords({ kind: 'unlimited' }, 'en'), 'No limit');
  assert.equal(menuStockWords({ kind: 'low', count: 3 }, 'th'), 'เหลือ 3');
  assert.equal(menuStockWords({ kind: 'plenty', count: 1200 }, 'en'), '1,200 left');
});

// ---------------------------------------------------------------- availability

const dishes = () => [
  { ID: 1, name: 'ข้าวผัด', is_available: true, remaining_servings: 4 },
  { ID: 2, name: 'ต้มยำ', is_available: false, remaining_servings: null },
];

test('withAvailability flips one row immutably and leaves the rest untouched', () => {
  const before = dishes();
  const after = withAvailability(before, 1, false);
  assert.notEqual(after, before);
  assert.equal(after[0].is_available, false);
  assert.equal(before[0].is_available, true, 'the input list is not mutated');
  assert.equal(after[1], before[1], 'other rows keep their identity');
  assert.deepEqual(withAvailability(before, 99, false), before, 'an unknown id changes nothing');
});

test('the availability reply is merged, so the stock the reply lacks survives the toggle', () => {
  // The PATCH reply is FindMenuItem without the servings (omitempty drops the
  // field), so a wholesale swap turned a limited dish into "no limit".
  const reply = { ID: 1, name: 'ข้าวผัด', is_available: false, price: 60 };
  const after = mergeAvailabilityReply(dishes(), reply);
  assert.equal(after[0].is_available, false);
  assert.equal(after[0].price, 60);
  assert.equal(after[0].remaining_servings, 4);
  assert.deepEqual(after[1], dishes()[1]);
});

test('a reply that does carry the stock wins over the old count', () => {
  const after = mergeAvailabilityReply(dishes(), { ID: 1, is_available: true, remaining_servings: 0 });
  assert.equal(after[0].remaining_servings, 0);
});

// ---------------------------------------------------------------- filter and view

test('the category filter falls back to all when its category is gone or switched off', () => {
  const categories = [{ ID: 3, is_active: true }, { ID: 4, is_active: false }];
  assert.equal(activeCategoryFilter('all', categories), 'all');
  assert.equal(activeCategoryFilter('3', categories), '3');
  assert.equal(activeCategoryFilter('4', categories), 'all', 'an inactive category is not in the options');
  assert.equal(activeCategoryFilter('9', categories), 'all', 'a deleted category is not in the options');
  assert.equal(activeCategoryFilter('3', []), 'all');
});

test('the view keeps dishes on screen first, then failed, empty, or the skeleton', () => {
  assert.equal(menuManageView({ loaded: false, failed: false, total: 0, shown: 0 }), 'skeleton');
  assert.equal(menuManageView({ loaded: false, failed: true, total: 0, shown: 0 }), 'failed');
  assert.equal(menuManageView({ loaded: true, failed: true, total: 0, shown: 0 }), 'failed');
  assert.equal(menuManageView({ loaded: true, failed: false, total: 0, shown: 0 }), 'empty');
  assert.equal(menuManageView({ loaded: true, failed: false, total: 5, shown: 0 }), 'no_match');
  assert.equal(menuManageView({ loaded: true, failed: false, total: 5, shown: 2 }), 'list');
  assert.equal(menuManageView({ loaded: true, failed: true, total: 5, shown: 5 }), 'list', 'a failed reload keeps the list');
});

// ---------------------------------------------------------------- failures

test('failures map to codes by status and by the server wording, never passing it through', () => {
  assert.equal(menuManageFailureCode(new TypeError('Network request failed')), 'offline');
  assert.equal(menuManageFailureCode(apiError('missing manage_menu permission', 403)), 'forbidden');
  assert.equal(menuManageFailureCode(apiError('resource not found', 404)), 'not_found');
  assert.equal(menuManageFailureCode(apiError('service temporarily unavailable', 503)), 'server_busy');
  assert.equal(menuManageFailureCode(apiError('internal server error', 500)), 'server_busy');
  assert.equal(menuManageFailureCode(apiError('invalid request', 400)), 'unknown');
  assert.equal(menuManageFailureCode(undefined), 'unknown');
  assert.equal(menuManageFailureCode('boom'), 'unknown');
});

test('a failed toggle names the step and, where there is one, a reason and what to reload', () => {
  assert.deepEqual(menuManageFailure(apiError('missing manage_menu permission', 403), 'toggle', 'th'), {
    code: 'forbidden',
    title: 'เปลี่ยนสถานะเมนูไม่สำเร็จ',
    message: 'บัญชีนี้ไม่มีสิทธิ์จัดการเมนู',
    reload: 'membership',
  });
  assert.deepEqual(menuManageFailure(apiError('resource not found', 404), 'toggle', 'en'), {
    code: 'not_found',
    title: 'Could not change the menu status',
    message: 'This dish has been deleted.',
    reload: 'list',
  });
  const offline = menuManageFailure(new TypeError('Network request failed'), 'toggle', 'th');
  assert.equal(offline.message, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  assert.equal(offline.reload, undefined);
  assert.deepEqual(menuManageFailure(apiError('invalid request', 400), 'toggle', 'th'), {
    code: 'unknown',
    title: 'เปลี่ยนสถานะเมนูไม่สำเร็จ',
  });
});

test('a failed load says the load failed, and a 404 on the list adds nothing', () => {
  assert.deepEqual(menuManageFailure(apiError('resource not found', 404), 'load', 'th'), {
    code: 'not_found',
    title: 'โหลดเมนูไม่สำเร็จ',
  });
  const forbidden = menuManageFailure(apiError('missing view_menu permission', 403), 'load', 'en');
  assert.equal(forbidden.message, 'This account cannot view the menu.');
  assert.equal(forbidden.reload, 'membership');
  assert.equal(menuManageFailure(apiError('x', 502), 'load', 'en').message, 'The service is having trouble. Try again.');
});

test('the server wording never comes back out of any failure', () => {
  const raw = [
    apiError('missing manage_menu permission', 403),
    apiError('resource not found', 404),
    apiError('record not found', 400),
    apiError('pq: duplicate key value violates unique constraint', 500),
    new TypeError('Network request failed'),
    new Error('Unexpected token < in JSON'),
  ];
  for (const err of raw) {
    for (const action of ['load', 'toggle']) {
      for (const language of ['th', 'en']) {
        const failure = menuManageFailure(err, action, language);
        const said = `${failure.title} ${failure.message ?? ''}`;
        assert.ok(!said.includes(err.message), `${action}/${language} leaked "${err.message}"`);
      }
      assert.ok(!menuLoadFailureLine(err, 'en').includes(err.message));
    }
  }
});

test('the failed first load shows one line: the connection, the permission, or the step', () => {
  assert.equal(menuLoadFailureLine(new TypeError('Network request failed'), 'th'), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  assert.equal(menuLoadFailureLine(apiError('missing view_menu permission', 403), 'th'), 'ไม่มีสิทธิ์ดูเมนู');
  assert.equal(menuLoadFailureLine(apiError('boom', 500), 'th'), 'โหลดเมนูไม่สำเร็จ');
  assert.equal(menuLoadFailureLine(apiError('boom', 500), 'en'), 'Could not load the menu');
});

// ---------------------------------------------------------------- call-site guards

async function screenFiles() {
  const dir = 'src/components/menu-manage';
  const names = (await readdir(path.join(mobileRoot, dir))).filter((name) => /\.tsx?$/.test(name));
  return Promise.all(['app/menu.tsx', ...names.map((name) => `${dir}/${name}`)].map(async (file) => [file, await read(file)]));
}

test('the menu screen joins nothing with a middle dot and draws no bullet', async () => {
  for (const [file, source] of await screenFiles()) {
    assert.doesNotMatch(source, / · /, `${file} joins values with a middle dot`);
    assert.doesNotMatch(source, /•/, `${file} draws a bullet`);
  }
});

test('the menu screen never shows the API wording and raises action outcomes as a toast', async () => {
  const screen = await code('app/menu.tsx');
  assert.doesNotMatch(screen, /\b(?:err|error)\.message\b/);
  assert.doesNotMatch(screen, /\bFeedback\b/, 'an outcome goes in a toast, not a panel stacked into the page');
  assert.match(screen, /useToast\(\)/);
  assert.match(screen, /menuManageFailure\(err, 'toggle'/);
  assert.match(screen, /menuManageFailure\(err, 'load'/);
});

test('the menu screen has no subtitle restating its counts', async () => {
  const screen = await code('app/menu.tsx');
  assert.doesNotMatch(screen, /\bsubtitle=/);
});

test('the availability switch wears the app colours, not the platform default', async () => {
  const tile = await code('src/components/menu-manage/menu-manage-tile.tsx');
  assert.match(tile, /trackColor=\{\{ false: OFF_TRACK, true: palette\.primary \}\}/);
  assert.match(tile, /thumbColor="#fff"/);
  assert.match(tile, /<Switch\s+\{\.\.\.props\}/, 'the wrapper forwards what it does not own, before its own colours');
  assert.match(tile, /<BrandSwitch\b/);
  const screen = await code('app/menu.tsx');
  assert.doesNotMatch(screen, /<Switch\b/, 'the screen draws no bare Switch');
});

test('the menu screen keeps its data, permissions, navigation and refresh', async () => {
  const screen = await code('app/menu.tsx');
  assert.match(screen, /can\(activeMembership, 'manage_menu'\)/);
  assert.match(screen, /can\(activeMembership, 'view_menu'\)/);
  assert.match(screen, /if \(!canView\) return;/, 'load never calls the API without view rights');
  assert.match(screen, /Promise\.all\(\[listCategories\(\), listMenuItems\(\)\]\)/);
  assert.match(screen, /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\)/);
  assert.match(screen, /<AppRefreshControl onRefresh=\{load\} \/>/);
  assert.match(screen, /router\.push\('\/menu\/item' as never\)/);
  assert.match(screen, /router\.push\('\/menu\/categories' as never\)/);
  assert.match(screen, /pathname: '\/menu\/item' as never, params: \{ id: String\(item\.ID\) \}/);
  assert.match(screen, /filterMenuCatalog\(items, \{ categoryId: category, search \}\)/);
  assert.match(screen, /activeCategoryFilter\(category, categories\)/);
  assert.match(screen, /<MenuImage\b[\s\S]{0,200}variant="card"/);
  assert.match(screen, /switchDisabled=\{!canManage \|\| \(savingId !== null && savingId !== item\.ID\)\}/);
});

test('the switch flips locally before the request, merges the reply, and rolls back on failure', async () => {
  const screen = await code('app/menu.tsx');
  const flip = screen.indexOf('withAvailability(current, item.ID, next)');
  const request = screen.indexOf('await setMenuItemAvailability(item.ID, next)');
  const merge = screen.indexOf('mergeAvailabilityReply(current, updated)');
  const rollback = screen.indexOf('withAvailability(current, item.ID, !next)');
  assert.ok(flip > 0 && request > flip, 'the row flips before the PATCH is awaited');
  assert.ok(merge > request, 'the reply is merged into the row');
  assert.ok(rollback > merge, 'a failure puts the switch back');
  assert.doesNotMatch(screen, /entry\.ID === updated\.ID \? updated/, 'the reply never replaces the row wholesale');
  assert.match(screen, /if \(!canManage \|\| savingRef\.current\) return;/, 'one save at a time');
});

test('a background load that fails after the screen was left raises nothing over the next screen', async () => {
  const screen = await code('app/menu.tsx');
  assert.match(screen, /focusedRef\.current = true;[\s\S]{0,80}return \(\) => \{\s*focusedRef\.current = false;/);
  assert.match(screen, /if \(focusedRef\.current\) showToast\(\{ tone: 'error'/);
});

test('the tile price wraps rather than being cut short beside the stock chip', async () => {
  const tile = await code('src/components/menu-manage/menu-manage-tile.tsx');
  assert.match(tile, /<Text selectable style=\{\[typeScale\.number, \{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' \}\]\}>\{price\}<\/Text>/);
});
