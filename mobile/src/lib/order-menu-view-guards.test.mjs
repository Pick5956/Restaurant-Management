import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Call-site guards for the order screen's menu layouts (owner, 2026-09-24: a
// button that lays the menu out another way, one dish per row and so on). The
// grid, the list row and the compact tile are three native trees the unit tests
// never mount, and every fault this feature can have is one wrong line at a call
// site: the button left out of the filter row, a layout that keeps its own copy
// of the mode, a sold-out dish that still takes a tap in one layout, the badge
// or the stock chip redrawn by hand in a fourth place and drifting. So these
// read the source and assert on the lines that matter.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (relative) => readFileSync(path.join(mobileRoot, relative), 'utf8');
/**
 * The file without its comments, so a note naming what not to do is not the
 * thing done. A JSX comment goes with its braces, so the elements either side
 * of it read as neighbours.
 */
const code = (relative) => source(relative)
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

const GRID = 'src/components/order-menu-grid.tsx';
const PARTS = 'src/components/order-menu/menu-tile-parts.tsx';
const ROW = 'src/components/order-menu/menu-list-row.tsx';
const COMPACT = 'src/components/order-menu/menu-compact-tile.tsx';
const TOGGLE = 'src/components/order-menu/menu-view-toggle.tsx';

/** One top-level function, from its declaration to the brace that closes it at column 0. */
function topLevelFunction(text, name) {
  const start = text.search(new RegExp(`^(?:export )?function ${name}\\b`, 'm'));
  assert.ok(start >= 0, `${name} is missing`);
  const end = text.indexOf('\n}\n', start);
  assert.ok(end > start, `${name} never closes`);
  return text.slice(start, end + 2);
}

/** Every JSX element named `component` in `text`, opening tag through its self-close. */
function elements(text, component) {
  return [...text.matchAll(new RegExp(`<${component}\\b[^>]*?/>`, 'g'))].map((match) => match[0]);
}

const count = (text, needle) => text.split(needle).length - 1;

test('the layout button sits in the filter row between the picker and the magnifier, and gives way to an open search', () => {
  const grid = code(GRID);
  const bar = topLevelFunction(grid, 'OrderMenuFilterBar');
  assert.match(grid, /import \{ MenuViewToggle \} from '@\/src\/components\/order-menu\/menu-view-toggle';/);
  assert.match(grid, /import \{ useMenuViewMode \} from '@\/src\/storage\/menu-view-store';/);

  // Read from the shared store, and before the search branch returns early -
  // a hook below an early return is called on some renders and not others.
  assert.match(bar, /const \[viewMode, setViewMode\] = useMenuViewMode\(\);/);
  assert.ok(bar.indexOf('useMenuViewMode()') < bar.indexOf('if (searchOpen) {'), 'the mode is read after the search branch returns');

  const closedAt = bar.indexOf('\n  }\n  return (');
  assert.ok(closedAt > 0, 'the closed filter row is missing');
  const searching = bar.slice(bar.indexOf('if (searchOpen) {'), closedAt);
  const closed = bar.slice(closedAt);
  assert.equal(count(bar, '<MenuViewToggle'), 1, 'the layout button is drawn more than once');
  assert.doesNotMatch(searching, /<MenuViewToggle\b/, 'the layout button crowds the search field');
  // The category chips, then the layout button, then the magnifier at the
  // trailing edge it always had - on the phone and the tablet alike, since the
  // row is shared. The chips were a dropdown until 2026-09-25.
  assert.match(
    closed,
    /<FilterChipRow\b[\s\S]*?trailing=\{\(\s*<>\s*<MenuViewToggle value=\{viewMode\} onChange=\{setViewMode\} \/>\s*<IconButton\s+accessibilityLabel=\{copy\('ค้นหาเมนู', 'Search menu'\)\}\s+icon="search-outline"/,
  );
  assert.doesNotMatch(closed, /<Select\b/);

  // The button itself: the magnifier's glass, and - like the tables screen's
  // density button - the glyph and the name of the layout the tap switches TO.
  const toggle = code(TOGGLE);
  assert.match(toggle, /const next = nextMenuViewMode\(value\);/);
  assert.match(toggle, /<IconButton\b[\s\S]*?icon=\{menuViewModeIcon\(next\)\}[\s\S]*?variant="glass"/);
  assert.match(toggle, /const nextLabel = menuViewModeLabel\(next, language\);/);
  assert.match(toggle, /accessibilityLabel=\{[^\n]{0,120}nextLabel/);
  assert.doesNotMatch(toggle, /menuViewModeIcon\(value\)/, 'the glyph shows the layout already on screen');
  // A light tick with the tap, its rejection swallowed so a phone without a
  // motor neither warns nor loses the layout change that follows.
  assert.match(toggle, /void Haptics\.selectionAsync\(\)\.catch\(\(\) => undefined\);\s*onChange\(next\);/);
});

test('both menu screens get the layouts through the shared components and own no mode of their own', () => {
  for (const screen of ['app/order/[id].tsx', 'app/order/served.tsx']) {
    const text = code(screen);
    assert.match(text, /<OrderMenuFilterBar\b/, `${screen} lost the shared filter row`);
    assert.match(text, /<OrderMenuGrid\b/, `${screen} lost the shared grid`);
    assert.doesNotMatch(text, /useMenuViewMode|MenuViewToggle|<MenuListRow|<MenuCompactTile/, `${screen} lays the menu out itself`);
  }
  // The props both screens already pass are the whole contract - nothing new
  // they would have to learn about.
  const grid = code(GRID);
  const gridProps = grid.slice(grid.indexOf('type OrderMenuGridProps = {'), grid.indexOf('};', grid.indexOf('type OrderMenuGridProps = {')));
  assert.deepEqual(
    [...gridProps.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]),
    ['groups', 'countByMenu', 'tabletWorkspace', 'onPressItem', 'accessibilityLabelFor'],
  );
});

test('the grid draws the layout the store holds, one component per mode', () => {
  const grid = topLevelFunction(code(GRID), 'OrderMenuGrid');
  // The one shared value - the button and every grid on the stack agree.
  assert.match(grid, /const \[mode\] = useMenuViewMode\(\);/);
  assert.doesNotMatch(grid, /useState<MenuViewMode>|useState\(\s*'(?:grid|list|compact)'\s*\)/, 'the grid keeps a mode of its own');

  assert.match(grid, /if \(mode === 'list'\) \{\s*return <MenuListRow key=\{item\.ID\}/);
  assert.match(grid, /if \(mode === 'compact'\) \{\s*return <MenuCompactTile key=\{item\.ID\}[^>]*\bwidth=\{compact\.tileWidth\}/);
  assert.match(grid, /return \(\s*<MenuPhotoTile\b/);
  // Rows stack flush - each draws its own hairline - and the tiles wrap.
  assert.match(grid, /if \(mode === 'list'\) return <View>\{dishes\}<\/View>;/);
  assert.match(grid, /flexWrap: 'wrap', gap: mode === 'compact' \? COMPACT_TILE_GAP : spacing\.md/);
  // Lines between rows only, as the order summary on the same screen draws
  // them: none under a category's last dish, above the next heading.
  assert.match(grid, /const dishes = items\.map\(\(item, index\) => \{/);
  assert.ok(
    elements(grid, 'MenuListRow').some((tag) => tag.includes('separated={index < items.length - 1}')),
    'the last row of a category draws a line under it',
  );
  assert.match(code(ROW), /separated = true \}: MenuListRowProps/);
  assert.match(code(ROW), /\{separated \? \(\s*<View\s+pointerEvents="none"/);

  // The compact tiles size from the measured column on every device, so the
  // grid measures itself always, and draws nothing until it has a width.
  assert.match(grid, /const compact = compactColumns\(gridWidth, COMPACT_TILE_GAP\);/);
  assert.match(grid, /<View onLayout=\{\(event\) => setGridWidth\(Math\.floor\(event\.nativeEvent\.layout\.width\)\)\}/);
  assert.doesNotMatch(grid, /onLayout=\{tabletWorkspace \?/, 'the phone never measures, so compact never draws there');
  assert.match(grid, /const measuring = mode === 'compact' \? !compact\.tileWidth : mode === 'grid' && tabletWorkspace && !tileWidth;/);
  assert.match(grid, /const sections = measuring \? null : groups\.map\(/);

  // A screen opening in its saved layout draws at once, as it always did; only
  // a layout picked while the grid is up settles in.
  assert.match(grid, /const \[openedIn\] = useState\(mode\);/);
  assert.match(grid, /if \(!switched && mode !== openedIn\) setSwitched\(true\);/);
  assert.match(grid, /\{switched && sections \? \(\s*<MotionReveal key=\{mode\}/);
});

test('the photo grid keeps its look: the same tile, the full-size badge pinned over the photo', () => {
  const grid = code(GRID);
  const photo = topLevelFunction(grid, 'MenuPhotoTile');
  assert.match(photo, /width: tabletWorkspace \? tileWidth : '48%'/);
  assert.match(photo, /<MenuImage[\s\S]{0,300}imageUrl=\{item\.image_url\}[\s\S]{0,120}variant="card"/);
  assert.match(
    photo,
    /\{count > 0 \? \(\s*<View pointerEvents="none" style=\{\{ position: 'absolute', top: spacing\.sm, right: spacing\.sm \}\}>\s*<CountBadge count=\{count\} \/>/,
  );
  // formatTender, not money(): the price as the dish's bill line will read it.
  assert.match(photo, /<Text selectable style=\{\[typeScale\.number, \{ flex: 1, fontSize: 15, fontWeight: '600' \}\]\}>\{formatTender\(item\.price, language\)\}<\/Text>\s*<StockMark item=\{item\} soldOut=\{soldOut\} \/>/);
  // The two layouts without a photo to sit on use the smaller badge.
  for (const [name, file] of [['list row', ROW], ['compact tile', COMPACT]]) {
    assert.match(code(file), /<CountBadge\b[^>]*\bsmall\b/, `${name} draws the photo tile's full-size badge`);
  }
});

test('the badge and the stock mark are drawn by the shared parts, never copied into a layout', () => {
  const parts = code(PARTS);
  assert.match(parts, /export function CountBadge\(/);
  assert.match(parts, /export function StockMark\(/);
  // Each piece of markup lives exactly once, in the parts.
  assert.equal(count(parts, "copy('หมด', 'Sold out')"), 1);
  assert.equal(count(parts, 'menuStockBadge('), 1);
  assert.equal(count(parts, "copy('ไม่จำกัด', 'No limit')"), 1);
  assert.equal(count(parts, 'borderColor: palette.controlBorder'), 1);

  for (const [name, file] of [['grid', GRID], ['list row', ROW], ['compact tile', COMPACT]]) {
    const text = code(file);
    assert.match(text, /import \{ CountBadge, StockMark \} from '@\/src\/components\/order-menu\/menu-tile-parts';/, `${name} does not use the shared parts`);
    assert.ok(elements(text, 'CountBadge').some((tag) => /\bcount=\{count\}/.test(tag)), `${name} draws no count badge`);
    assert.ok(
      elements(text, 'StockMark').some((tag) => /\bitem=\{item\}/.test(tag) && /\bsoldOut=\{soldOut\}/.test(tag)),
      `${name} draws no stock mark`,
    );
    // The markup that belongs to the parts, redrawn by hand.
    assert.doesNotMatch(text, /menuStockBadge\(/, `${name} works out the stock chip itself`);
    assert.doesNotMatch(text, /copy\('หมด', 'Sold out'\)/, `${name} writes its own sold-out word`);
    assert.doesNotMatch(text, /copy\('ไม่จำกัด', 'No limit'\)/, `${name} writes its own stock chip`);
    assert.doesNotMatch(text, /borderColor: palette\.controlBorder|rgba\(61, 43, 31, 0\.24\)/, `${name} draws its own count badge`);
  }

  // The stock chip is filled with the compact tile's own cream, so on that tile
  // it vanished and left only its padding, 6pt of indent under the price. The
  // compact tile draws the mark bare; the photo tile and the row sit on the
  // white canvas and keep the chip.
  assert.ok(elements(code(COMPACT), 'StockMark').every((tag) => /\bbare\b/.test(tag)), 'the compact tile draws the stock chip on its own fill');
  for (const [name, file] of [['grid', GRID], ['list row', ROW]]) {
    assert.ok(elements(code(file), 'StockMark').every((tag) => !/\bbare\b/.test(tag)), `${name} lost the stock chip`);
  }
  // Bare drops the chip's fill and padding and nothing else; the chip keeps
  // the look it had on the photo tile before the layouts: amber at low stock,
  // a quiet grey otherwise.
  const mark = topLevelFunction(parts, 'StockMark');
  assert.match(
    mark,
    /style=\{bare\s*\? \{ flexShrink: 0 \}\s*: \{ flexShrink: 0, borderRadius: radius\.sm, backgroundColor: low \? palette\.warningSoft : palette\.surfaceSubtle, paddingHorizontal: 6, paddingVertical: 2 \}\}/,
  );
  assert.match(mark, /color: low \? palette\.warning : palette\.muted/);
});

test('the count badge draws nothing at 0, and keeps the sizes every layout was built around', () => {
  const parts = code(PARTS);
  // The list row hands every dish to CountBadge whatever its count, so a badge
  // that drew at 0 would put a "0" beside every dish in the list.
  assert.match(topLevelFunction(parts, 'CountBadge'), /\): JSX\.Element \| null \{\s*if \(count <= 0\) return null;/);

  // The photo tile's badge is the size it was before it moved into the parts;
  // the small one is what the compact tile keeps its name clear of.
  assert.match(parts, /regular: \{ diameter: 34, fontSize: 13, lineHeight: 18 \}/);
  assert.match(parts, /minWidth: size\.diameter,\s*height: size\.diameter,/);
  const small = Number(parts.match(/small: \{ diameter: (\d+),/)?.[1]);
  assert.equal(small, 26);
  assert.equal(
    Number(code(COMPACT).match(/^const BADGE_DIAMETER = (\d+);$/m)?.[1]),
    small,
    'the compact tile clears its name for a badge of another size',
  );
});

test('a sold-out dish greys out and takes no tap in every layout, and says the same thing to a screen reader', () => {
  const grid = code(GRID);
  const body = topLevelFunction(grid, 'OrderMenuGrid');
  // Decided once per dish and handed to whichever layout is up, so no layout
  // can disagree about what is sold out or what a dish is called aloud.
  assert.equal(count(body, 'const soldOut = isMenuSoldOut(item);'), 1);
  assert.equal(count(body, 'const count = countByMenu.get(item.ID) ?? 0;'), 1);
  assert.match(
    body,
    /const accessibilityLabel = soldOut \? copy\(`\$\{item\.name\} หมด`, `\$\{item\.name\}, sold out`\) : accessibilityLabelFor\(item, count\);/,
  );
  for (const component of ['MenuPhotoTile', 'MenuListRow', 'MenuCompactTile']) {
    const calls = elements(body, component);
    assert.equal(calls.length, 1, `${component} is not drawn exactly once`);
    for (const prop of ['soldOut={soldOut}', 'count={count}', 'accessibilityLabel={accessibilityLabel}', 'onPress={onPress}', 'item={item}']) {
      assert.ok(calls[0].includes(prop), `${component} is not handed ${prop}`);
    }
  }

  const layouts = [
    ['photo tile', topLevelFunction(grid, 'MenuPhotoTile')],
    ['list row', code(ROW)],
    ['compact tile', code(COMPACT)],
  ];
  for (const [name, text] of layouts) {
    assert.match(text, /<Pressable\b/, `${name} is not a pressable`);
    assert.match(text, /\bdisabled=\{soldOut\}/, `${name} still takes a tap when sold out`);
    assert.match(text, /accessibilityState=\{\{ disabled: soldOut \}\}/, `${name} does not say it is unavailable`);
    assert.match(text, /accessibilityRole="button"/, `${name} is not announced as a button`);
    assert.match(text, /accessibilityLabel=\{accessibilityLabel\}/, `${name} speaks a label of its own`);
    // Greyed the same, and a press answers the same, whichever layout is up.
    assert.match(
      text,
      /opacity: soldOut \? 0\.48 : pressed \? 0\.72 : 1,\s*transform: \[\{ translateY: pressed \? 1 : 0 \}\],/,
      `${name} greys a sold-out dish or answers a press differently`,
    );
  }
});
