import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The menu's row in the compact header (owner, 2026-09-23: "the list piled
// under the top, and the header does not come down with it ... look at Grab";
// 2026-09-24: the chips showed twice, and the search button threw the page
// back to its heading). Every rule here lives at a call site - which state
// the row reads, when the page moves and where to, what the search does with
// the row - so the guard reads the source files themselves.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');

/** The source without comments, so a note about a rule never passes for the rule. */
async function code(relative) {
  return (await read(relative))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The body of the named arrow handler, up to its closing `};`. */
function handler(source, name) {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf('\n  };', start);
  assert.ok(end > start, `${name} must close`);
  return source.slice(start, end);
}

test('the menu screen hands the compact header its row and a handle on the scroll', async () => {
  const screen = await code('app/menu.tsx');
  assert.match(screen, /scrollControlRef=\{scrollControlRef\}/);
  assert.match(screen, /compactRow=\{[\s\S]{0,120}<MenuCompactRow\b/);
  assert.doesNotMatch(screen, /compactHeader=\{false\}/, 'the menu keeps the collapsing header');
});

test('the compact row reads the page state, not a copy of it', async () => {
  const screen = await code('app/menu.tsx');
  const row = screen.slice(screen.indexOf('<MenuCompactRow'), screen.indexOf('/>', screen.indexOf('<MenuCompactRow')));
  assert.match(row, /category=\{category\}/);
  assert.match(row, /onCategory=\{setCategory\}/);
  assert.match(row, /options=\{categoryOptions\}/, 'the same options as the full bar');
  const bar = screen.slice(screen.indexOf('<MenuFilterBar'), screen.indexOf('/>', screen.indexOf('<MenuFilterBar')));
  assert.match(bar, /options=\{categoryOptions\}/);
  assert.match(bar, /category=\{category\}/);

  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.match(source, /<ChoiceChips\s+scroll\b[\s\S]{0,200}value=\{category\}/);
  assert.doesNotMatch(source, /useState\(/, 'the row holds no state of its own');
  // The two chip rows scroll sideways as one, so the hand-off is seamless
  // sideways too, wherever the reader had dragged the chips.
  assert.match(screen, /const chipSync = useRef\(createChipRowSync\(\)\)\.current;/);
  assert.match(row, /chipSync=\{chipSync\}/);
  assert.match(bar, /chipSync=\{chipSync\}/);
  assert.match(source, /<ChoiceChips\s+scroll\s+sync=\{chipSync\}/);
  const filterBar = await code('src/components/menu-manage/menu-filter-bar.tsx');
  assert.match(filterBar, /<ChoiceChips\s+scroll\s+sync=\{chipSync\}/);
});

test('a filter picked in the compact row starts the list again from the top', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  const pick = handler(source, 'pick');
  const jump = pick.indexOf('scrollControlRef.current?.scrollTo(0, false)');
  const filter = pick.indexOf('onCategory(value)');
  assert.ok(jump >= 0, 'the page jumps to the top, unanimated');
  assert.ok(filter > jump, 'the jump comes before the list changes');
  assert.match(source, /onChange=\{pick\}/);
});

test('the round search button opens the field in the row, where it is; the page does not move for it', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.match(source, /icon="search-outline"[\s\S]{0,60}onPress=\{onOpenSearch\}/);
  // The one jump to the page's top is the category pick.
  assert.equal((source.match(/scrollTo\(0, false\)/g) || []).length, 1);
  assert.doesNotMatch(source, /focus\(\)/, 'no caret is sent anywhere else');
  // The field takes the chips' place, at the bar's height, and takes the caret itself.
  const field = source.slice(source.indexOf('<SearchField'), source.indexOf('/>', source.indexOf('<SearchField')));
  assert.match(field, /autoFocus/);
  assert.match(field, /compact/);
  assert.match(field, /value=\{search\}/);
  assert.match(field, /onChangeText=\{type\}/);
  assert.match(source, /\{searching \? \(/);
  // One fixed height in both faces: the hand-off is measured from this row's
  // centre, and the field's own Android padding once grew the row and moved it.
  assert.match(source, /\{ height: COMPACT_BUTTON, flexDirection: 'row'/);
  const ui = await code('src/components/ui.tsx');
  // Exactly 40 with no padding of its own; every search box is a fixed-height
  // capsule since 2026-09-25 (field-look.test.mjs), the page's at 44.
  assert.match(ui, /height: compact \? 40 : SEARCH_FIELD_HEIGHT,\s*paddingVertical: 0,/);

  const screen = await code('app/menu.tsx');
  const row = screen.slice(screen.indexOf('<MenuCompactRow'), screen.indexOf('/>', screen.indexOf('<MenuCompactRow')));
  assert.match(row, /search=\{search\}/);
  assert.match(row, /searching=\{searching\}/);
  assert.match(row, /onSearch=\{setSearch\}/);
  assert.match(row, /onOpenSearch=\{\(\) => setSearching\(true\)\}/);
  assert.match(row, /onCloseSearch=\{closeSearch\}/);
  assert.match(screen, /const \[searching, setSearching\] = useState\(false\);/);
});

test('each keystroke starts the results from their top, under the bar, wherever the reader was', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  const type = handler(source, 'type');
  const jump = type.indexOf('scrollControlRef.current?.scrollToCompactRow?.(false)');
  const filter = type.indexOf('onSearch(text)');
  assert.ok(jump >= 0, 'the page jumps to the hand-off, unanimated');
  assert.ok(filter > jump, 'the jump comes before the list changes');
  // The page holds the bar in place while the field is up, however short the answer.
  const screen = await code('app/menu.tsx');
  assert.match(screen, /pinCompactRow=\{searching\}/);
});

test('ยกเลิก puts the keyboard away, the keyword with it, and the chips back', async () => {
  const screen = await code('app/menu.tsx');
  assert.match(screen, /const closeSearch = \(\) => \{\s*Keyboard\.dismiss\(\);\s*setSearch\(''\);\s*setSearching\(false\);\s*\};/);
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.match(source, /onPress=\{onCloseSearch\}/);
  // Words in the brand ink, as "จัดหมวด" in the full bar - not a third round button.
  const cancel = source.slice(source.indexOf('onPress={onCloseSearch}'), source.indexOf('</Pressable>', source.indexOf('onPress={onCloseSearch}')));
  assert.match(cancel, /color: palette\.primaryInk/);
  assert.match(cancel, /\{t\('ยกเลิก', 'Cancel'\)\}/);
});

// The order screen's search stage, copied (owner, 2026-09-25): a touch or a
// drag anywhere under the bar closes the field the same way ยกเลิก does. The
// shell's catcher sits under the compact bar (zIndex 1 against 3), so the field
// and ยกเลิก are the one part left live.
// The full bar's field was a search of its own: typed into, then scrolled past
// or left for a dish, it kept the caret and the keyboard (owner, 2026-09-25).
// Touching it now opens the bar's stage, and leaving the page closes it.
test('the page\'s own field hands the typing to the bar\'s search stage, and leaving closes it', async () => {
  const bar = await code('src/components/menu-manage/menu-filter-bar.tsx');
  assert.match(bar, /onChangeText=\{onSearch\}\s*onFocus=\{onFocusSearch\}/);
  const screen = await code('app/menu.tsx');
  assert.match(screen, /onFocusSearch=\{openSearchFromPage\}/);
  assert.match(screen, /const openSearchFromPage = \(\) => \{\s*if \(searching\) return;\s*setSearching\(true\);\s*requestAnimationFrame\(\(\) => scrollControlRef\.current\?\.scrollToCompactRow\?\.\(false\)\);\s*\};/);
  assert.match(screen, /focusedRef\.current = false;\s*Keyboard\.dismiss\(\);\s*setSearch\(''\);\s*setSearching\(false\);/);
  // The bar's field takes the caret the moment the stage opens.
  const row = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.match(row, /<SearchField[^>]*autoFocus/);
});

test('a touch or drag below the bar closes the search, as on the order screen', async () => {
  const screen = await code('app/menu.tsx');
  assert.match(screen, /onTouchOutsideStickyContent=\{searching \? closeSearch : undefined\}/);
  const order = await code('app/order/[id].tsx');
  assert.match(order, /onTouchOutsideStickyContent=\{searchOpen \? closeSearch : undefined\}/);
  const shell = await code('src/components/app-shell.tsx');
  assert.match(shell, /onPressIn=\{onTouchOutsideStickyContent\}\s*style=\{\{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 \}\}/);
  const bar = await code('src/components/compact-header.tsx');
  assert.match(bar, /style=\{\{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 \}\}/);
});

test('the full bar\'s chips row is the anchor the bar hands its row over at', async () => {
  const filterBar = await code('src/components/menu-manage/menu-filter-bar.tsx');
  assert.match(filterBar, /<CompactRowAnchor style=\{\{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing\.md \}\}>\s*<View style=\{\{ minWidth: 0, flex: 1 \}\}>\s*<ChoiceChips/);
  assert.match(filterBar, /<\/CompactRowAnchor>/);
  // The search field above it is not part of the anchor: it slides under the title band.
  const anchored = filterBar.slice(filterBar.indexOf('<CompactRowAnchor'), filterBar.indexOf('</CompactRowAnchor>'));
  assert.doesNotMatch(anchored, /SearchField/);
});

test('the compact row fades in, so it holds no Liquid Glass and no way off the list', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.doesNotMatch(source, /\bGlass[A-Z]\w*/, 'glass under a fading parent renders flat');
  assert.doesNotMatch(source, /variant="glass"|\bglass\b/);
  assert.doesNotMatch(source, /จัดหมวด|\/menu\/categories/, 'managing categories stays in the full bar');
});
