import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addedQuantityByMenu,
  filterMenuCatalog,
  groupMenuByCategory,
  isMenuSoldOut,
  menuGridColumns,
  menuStockBadge,
} from './menu-catalog.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const catalog = [
  { ID: 1, name: 'ข้าวผัดกุ้ง', description: 'จานเดียว', category_id: 10, is_available: true },
  { ID: 2, name: 'ต้มยำ', description: '', category_id: 20, categories: [{ category_id: 10 }], is_available: true },
  { ID: 3, name: 'ชาเย็น', description: 'Thai tea', category_id: 30, is_available: true },
  { ID: 4, name: 'น้ำเปล่า', description: null, category_id: 0, is_available: true },
];

test('the catalog filter matches a category by its main or linked category', () => {
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: 'all', search: '' }).map((item) => item.ID), [1, 2, 3, 4]);
  // Dish 2 lives in 20 but is also linked into 10.
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: '10', search: '' }).map((item) => item.ID), [1, 2]);
});

test('the catalog search reads the name and the description, ignoring case and padding', () => {
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: 'all', search: '  THAI ' }).map((item) => item.ID), [3]);
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: '10', search: 'ต้มยำ' }).map((item) => item.ID), [2]);
  assert.deepEqual(filterMenuCatalog(null, { categoryId: 'all', search: '' }), []);
});

test('groups keep the menu order and name unknown categories once', () => {
  const groups = groupMenuByCategory(catalog, [{ ID: 10, name: 'อาหาร' }, { ID: 30, name: 'เครื่องดื่ม' }], 'ไม่ระบุหมวด');
  assert.deepEqual(groups.map((group) => [group.key, group.label, group.items.map((item) => item.ID)]), [
    ['10', 'อาหาร', [1]],
    ['20', 'ไม่ระบุหมวด', [2]],
    ['30', 'เครื่องดื่ม', [3]],
    ['0', 'ไม่ระบุหมวด', [4]],
  ]);
});

// The owner, 2026-09-24: on the order screen a sold-out dish goes to the bottom
// of its own category. Switched off and out of stock both count.
const dish = (ID, category_id, stock = {}) => ({ ID, name: `dish ${ID}`, category_id, is_available: true, ...stock });
const OFF = { is_available: false };
const NONE_LEFT = { remaining_servings: 0 };
const itemIds = (groups) => groups.map((group) => [group.key, group.items.map((item) => item.ID)]);

test('sold-out dishes sink to the bottom of their own category, each part in menu order', () => {
  const groups = groupMenuByCategory([
    dish(1, 10),
    dish(2, 10, OFF),
    dish(3, 10, { remaining_servings: 4 }),
    dish(4, 10, NONE_LEFT),
    dish(5, 10, { remaining_servings: null }),
    dish(6, 10, { is_available: false, remaining_servings: 9 }),
    dish(7, 10, { remaining_servings: 1 }),
  ], [{ ID: 10, name: 'อาหาร' }], 'ไม่ระบุหมวด');
  // Orderable 1, 3, 5, 7 keep their order; sold-out 2, 4, 6 keep theirs below.
  assert.deepEqual(itemIds(groups), [['10', [1, 3, 5, 7, 2, 4, 6]]]);
});

test('a sold-out dish never leaves its category or jumps past another one', () => {
  const groups = groupMenuByCategory([
    dish(1, 10, OFF),
    dish(2, 20),
    dish(3, 10),
    dish(4, 20, NONE_LEFT),
    dish(5, 30),
    dish(6, 20),
  ], [{ ID: 10, name: 'อาหาร' }, { ID: 20, name: 'ของหวาน' }, { ID: 30, name: 'เครื่องดื่ม' }], 'ไม่ระบุหมวด');
  // Category 10 stays first although the dish that opened it is sold out.
  assert.deepEqual(itemIds(groups), [['10', [3, 1]], ['20', [2, 6, 4]], ['30', [5]]]);
  assert.deepEqual(groups.map((group) => group.label), ['อาหาร', 'ของหวาน', 'เครื่องดื่ม']);
});

test('a category that is entirely sold out keeps its place in the menu', () => {
  const groups = groupMenuByCategory([
    dish(1, 10),
    dish(2, 20, OFF),
    dish(3, 30),
    dish(4, 20, NONE_LEFT),
    dish(5, 0, OFF),
  ], [{ ID: 10, name: 'อาหาร' }, { ID: 20, name: 'ของหวาน' }, { ID: 30, name: 'เครื่องดื่ม' }], 'ไม่ระบุหมวด');
  assert.deepEqual(itemIds(groups), [['10', [1]], ['20', [2, 4]], ['30', [3]], ['0', [5]]]);
});

test('sinking sold-out dishes leaves the loaded menu as it was', () => {
  const menu = Object.freeze([dish(1, 10, OFF), dish(2, 10), dish(3, 10, NONE_LEFT), dish(4, 10)]);
  const groups = groupMenuByCategory(menu, [{ ID: 10, name: 'อาหาร' }], 'ไม่ระบุหมวด');
  assert.deepEqual(itemIds(groups), [['10', [2, 4, 1, 3]]]);
  assert.deepEqual(menu.map((item) => item.ID), [1, 2, 3, 4]);
  // The same dish objects, not copies: the grid and the tablet panel key off them.
  assert.equal(groups[0].items[0], menu[1]);
});

test('the order screen and the served page both lay out the grid from the grouping', async () => {
  // A call site that fed the grid its own list would skip the sold-out order.
  const [detailSource, servedSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'served.tsx'), 'utf8'),
  ]);
  for (const [name, source] of [['[id].tsx', detailSource], ['served.tsx', servedSource]]) {
    assert.match(source, /const menuGroups = useMemo\(\(\) => groupMenuByCategory\(/, `${name} groups the menu`);
    assert.match(source, /<OrderMenuGrid\s+groups=\{menuGroups\}/, `${name} hands the grid the grouped menu`);
  }
});

test('the served page counts only lines added since it opened', () => {
  const counts = addedQuantityByMenu([
    { ID: 1, menu_id: 7, status: 'served', quantity: 3 },
    { ID: 2, menu_id: 7, status: 'served', quantity: 2 },
    { ID: 3, menu_id: 8, status: 'served', quantity: 1 },
    { ID: 4, menu_id: 8, status: 'cancelled', quantity: 5 },
    { ID: 5, menu_id: 0, status: 'served', quantity: 1 },
    { ID: 6, menu_id: 9, status: 'served', quantity: Number.NaN },
  ], new Set([1]));
  assert.deepEqual([...counts], [[7, 2], [8, 1]]);
  assert.equal(addedQuantityByMenu(null, new Set()).size, 0);
});

test('a dish is sold out when it is switched off or its stock has no portion left', () => {
  assert.equal(isMenuSoldOut({ is_available: true }), false);
  assert.equal(isMenuSoldOut({ is_available: true, remaining_servings: null }), false);
  assert.equal(isMenuSoldOut({ is_available: true, remaining_servings: 3 }), false);
  // The case the app missed: switched on by hand, but the queue has claimed
  // the last portion the ingredients can make.
  assert.equal(isMenuSoldOut({ is_available: true, remaining_servings: 0 }), true);
  assert.equal(isMenuSoldOut({ is_available: false, remaining_servings: 5 }), true);
});

test('a tablet grid fills the column it is given, never fewer than two across', () => {
  // The column beside the dish panel on a portrait iPad, a landscape one, and
  // a 13-inch one in portrait.
  assert.deepEqual(menuGridColumns(316, 150, 12), { columns: 2, tileWidth: 152 });
  assert.deepEqual(menuGridColumns(660, 150, 12), { columns: 4, tileWidth: 156 });
  assert.deepEqual(menuGridColumns(520, 150, 12), { columns: 3, tileWidth: 165 });
  // Too narrow for two full tiles still gets two, smaller: one photo per row
  // reads as a list.
  assert.deepEqual(menuGridColumns(200, 150, 12), { columns: 2, tileWidth: 94 });
  // Not measured yet.
  assert.deepEqual(menuGridColumns(0, 150, 12), { columns: 2, tileWidth: 0 });
  assert.deepEqual(menuGridColumns(Number.NaN, 150, 12), { columns: 2, tileWidth: 0 });
  // A row never comes out wider than its column, or the last tile wraps onto a
  // row of its own.
  for (let width = 264; width <= 1200; width += 7) {
    const { columns, tileWidth } = menuGridColumns(width, 150, 12);
    assert.ok(columns * tileWidth + (columns - 1) * 12 <= width, `overflows at ${width}`);
  }
});

test('the order grid greys out a dish by the one sold-out rule, from what it loaded on open', async () => {
  const [gridSource, detailSource, tilePartsSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'components', 'order-menu-grid.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    // The sold-out word lives in StockMark, which every menu layout shares.
    readFile(path.join(mobileRoot, 'src', 'components', 'order-menu', 'menu-tile-parts.tsx'), 'utf8'),
  ]);
  // The grid greys a tile out and blocks the tap for either kind of sold out.
  assert.match(gridSource, /const soldOut = isMenuSoldOut\(item\);/);
  assert.match(gridSource, /disabled=\{soldOut\}/);
  assert.doesNotMatch(gridSource, /!item\.is_available/);
  // "หมด" is a plain grey word - no status chip with its dot and red frame.
  for (const source of [gridSource, tilePartsSource]) assert.doesNotMatch(source, /<StatusBadge/);
  assert.match(tilePartsSource, /color: palette\.neutral[^}]*\}\]\}>\s*\{copy\('หมด', 'Sold out'\)\}/);
  // The order screen's + on a line in this round stops at a sold-out dish too.
  assert.match(detailSource, /isMenuSoldOut\(/);
  // The owner, 2026-09-19: the order screen loads when it opens and then stays
  // put - it is not the kitchen board. No timer brings the menu back in.
  assert.doesNotMatch(detailSource, /setInterval\(/);
});

test('the served-item page is the order menu grid, pushed from the bill menu', async () => {
  const [billSource, servedSource, detailSource, gridSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', 'bill.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'served.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-menu-grid.tsx'), 'utf8'),
  ]);

  // A pushed route, so the stack slides it in from the right; the catalog no
  // longer unfolds inside the bill.
  assert.match(billSource, /key: 'add-served'[\s\S]{0,400}pathname: '\/order\/served'/);
  assert.doesNotMatch(billSource, /const \[adding, setAdding\]/);
  assert.doesNotMatch(billSource, /filteredMenu\.map/);

  // Both screens render the one grid, so the served page cannot drift from the
  // order screen it is meant to look like.
  assert.match(detailSource, /<OrderMenuGrid\b/);
  assert.match(servedSource, /<OrderMenuGrid\b/);
  // A tile opens the ordinary item screen, so options, note and quantity are
  // chosen exactly as when taking an order - flagged so the line skips the kitchen.
  assert.match(servedSource, /pathname: '\/order\/item'[\s\S]{0,160}served: '1'/);
  const [itemSource, editorSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-item-editor.tsx'), 'utf8'),
  ]);
  assert.match(itemSource, /const served = !editing && params\.served === '1';/);
  assert.match(itemSource, /useOrderItemEditor\(\{ orderId, menuId, itemId, served,/);
  assert.match(editorSource, /const served = !editing && servedOption;/);
  assert.match(editorSource, /addOrderItem\(orderId, \{[^}]*serve_immediately: served[^}]*\}\)/);
  assert.match(gridSource, /<MenuImage[\s\S]{0,300}imageUrl=\{item\.image_url\}[\s\S]{0,120}variant="card"/);
});

test('on a tablet a dish opens in a phone-width panel beside the grid, split from the start', async () => {
  const [detailSource, servedSource, itemSource, splitSource, editorSource, gridSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'served.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-menu-split.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-item-editor.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-menu-grid.tsx'), 'utf8'),
  ]);

  // The owner, 2026-09-19: on an iPad the item screen was the whole display,
  // its photo alone filling it. Both menu screens split at the tablet
  // breakpoint and a tile fills the panel instead of pushing that screen.
  for (const [name, source] of [['[id].tsx', detailSource], ['served.tsx', servedSource]]) {
    assert.match(source, /const sidePanel = width >= breakpoints\.tablet/, `${name} splits on a tablet`);
    assert.match(source, /<OrderMenuSplit\b/, `${name} renders the split`);
    assert.match(source, /onPressItem=\{\(item\) => \(sidePanel\s*\?\s*pickDish\(item\)/, `${name} opens a tile in the panel`);
    assert.match(source, /<OrderItemPanel\b[\s\S]{0,120}key=\{selectedMenu\.ID\}/, `${name} starts the panel over for each dish`);
    // Split before anything is chosen: the placeholder holds the panel's place.
    assert.match(source, /: <OrderItemPanelPlaceholder \/>/, `${name} shows the placeholder until a dish is chosen`);
  }
  // Only the served page's panel puts the line straight onto the bill.
  assert.match(servedSource, /<OrderItemPanel\b[\s\S]{0,320}\bserved\b/);
  assert.doesNotMatch(detailSource, /<OrderItemPanel\b[^>]*\bserved\b/);

  // The panel is a phone's width whatever the iPad, and the grid beside it
  // sizes its tiles from the column it gets, not from the window.
  assert.match(splitSource, /minWidth: ORDER_PANEL_MIN_WIDTH, maxWidth: ORDER_PANEL_MAX_WIDTH, flexGrow: 35/);
  assert.match(splitSource, /flexGrow: 65/);
  assert.match(editorSource, /export const ORDER_PANEL_MIN_WIDTH = 3\d\d;/);
  assert.match(editorSource, /export const ORDER_PANEL_MAX_WIDTH = 4\d\d;/);
  assert.match(gridSource, /menuGridColumns\(gridWidth, TABLET_TILE_MIN_WIDTH, spacing\.md\)/);
  assert.match(gridSource, /width: tabletWorkspace \? tileWidth : '48%'/);

  // An empty panel says so, in grey, with an icon - nothing more.
  assert.match(splitSource, /copy\('ยังไม่ได้เลือกเมนู', 'No dish chosen'\)/);
  assert.match(splitSource, /statusTone\('muted'\)/);

  // The grid under an open search stays live on a tablet - its results are
  // what gets tapped - so the search closes from its own button instead of
  // from the phone's tap-anywhere stage.
  for (const [name, source] of [['[id].tsx', detailSource], ['served.tsx', servedSource]]) {
    const split = source.slice(source.indexOf('if (sidePanel) {'), source.indexOf('</OrderMenuSplit>'));
    assert.ok(split.includes('<OrderMenuSplit'), `${name} has no split block`);
    assert.doesNotMatch(split, /onTouchOutsideStickyContent/, `${name} turns the tablet grid into a dismiss target`);
    assert.match(source, /onCloseSearch=\{sidePanel \? closeSearch : undefined\}/, `${name} gives the tablet search no way to close`);
    // The owner, 2026-09-19: the panel runs to the top of the screen, and the
    // heading - with the item count at its right end - belongs to the grid's
    // column. AppScreen draws no heading of its own across both.
    assert.match(split, /<AppScreen\b[^>]*\bhideTitle\b/, `${name} draws a heading across the panel`);
    assert.match(split, /header=\{<ScreenHeading\b[^>]*\bshowBack\b/, `${name} has no heading over its grid`);
  }
  assert.match(detailSource, /header=\{<ScreenHeading action=\{summaryAction\}/);
  assert.match(splitSource, /\{header \? <View style=\{\{ paddingBottom: spacing\.xs \}\}>\{header\}<\/View> : null\}\s*\{filterBar\}/);

  // Editing a line from the bill on a tablet gets the same panel, not the
  // phone's full-screen photo.
  assert.match(itemSource, /if \(width >= breakpoints\.tablet\) \{[\s\S]{0,700}<OrderItemPanel\b/);

  // Beside the grid the add is on screen together with the order screen's own
  // writes, which a pushed item screen never was. It takes the screen's lock,
  // and on both screens a load that began before it cannot land after it.
  assert.match(editorSource, /if \(mutationGuard && !mutationGuard\.begin\(\)\) return;/);
  assert.match(editorSource, /finally \{\s*mutationGuard\?\.finish\(\);/);
  assert.match(detailSource, /begin: \(\) => requestGuardRef\.current\.beginMutation\(\),\s*finish: \(\) => requestGuardRef\.current\.finishMutation\(\)/);
  assert.match(detailSource, /<OrderItemPanel\b[\s\S]{0,200}mutationGuard=\{panelMutationGuard\}/);
  assert.match(servedSource, /if \(!loadGeneration\.current\.isCurrent\(request\)\) return;/);
  assert.match(servedSource, /loadGeneration\.current\.invalidate\(\);\s*setOrder\(next\);/);

  // The panel makes room for the keyboard itself. `automaticallyAdjustKeyboardInsets`
  // added no inset to it on the owner's iPad, so the note could not rise above
  // the keyboard; and on the grid beside it the same prop scrolled every dish
  // by the keyboard's height whenever the note took focus.
  const panelSource = editorSource.slice(editorSource.indexOf('export function OrderItemPanel'));
  const autoInsetProp = /^\s*automaticallyAdjustKeyboardInsets\s*$/m;
  assert.doesNotMatch(panelSource, autoInsetProp);
  assert.doesNotMatch(splitSource, autoInsetProp);
  assert.match(panelSource, /setKeyboardInset\(Math\.max\(0, Math\.round\(y \+ height - top\)\)\)/);
  assert.match(panelSource, /contentContainerStyle=\{\{ paddingHorizontal: PANEL_GUTTER, paddingBottom: keyboardInset \}\}/);
  // The scroll the keyboard asks for lands before that room is laid out, and
  // is clamped to the old end; it is asked again once the content has grown.
  assert.match(panelSource, /onContentSizeChange=\{noteKeyboard\.realign\}/);
  assert.match(editorSource, /return \{ noteRef, onNoteFocus, onNoteBlur, realign: alignNoteAboveKeyboard \};/);

  // Every hook before the first early return: one after it throws the moment
  // the permission or the route id changes under a mounted screen.
  const firstReturn = detailSource.indexOf('if (!canAccessOrder) {');
  for (const hook of ['const openOrderSummary = useCallback', 'const panelMutationGuard = useMemo', 'const pickDish = useCallback']) {
    const at = detailSource.indexOf(hook);
    assert.ok(at > 0 && at < firstReturn, `${hook} sits after an early return`);
  }
});

test('every orderable dish carries a stock badge, amber at ten or fewer', () => {
  // Same rule as the web POS tile (2026-09-22): every dish says what is left.
  assert.deepEqual(menuStockBadge({ is_available: true, remaining_servings: 33 }), { kind: 'plenty', count: 33 });
  assert.deepEqual(menuStockBadge({ is_available: true, remaining_servings: 10 }), { kind: 'low', count: 10 });
  assert.deepEqual(menuStockBadge({ is_available: true, remaining_servings: 1 }), { kind: 'low', count: 1 });
});

test('a dish with no recipe says it is not limited instead of showing nothing', () => {
  assert.deepEqual(menuStockBadge({ is_available: true, remaining_servings: null }), { kind: 'unlimited' });
  assert.deepEqual(menuStockBadge({ is_available: true }), { kind: 'unlimited' });
});

test('a sold-out dish gets no stock badge; its sold-out word is the answer', () => {
  assert.equal(menuStockBadge({ is_available: true, remaining_servings: 0 }), null);
  assert.equal(menuStockBadge({ is_available: false, remaining_servings: 20 }), null);
});
