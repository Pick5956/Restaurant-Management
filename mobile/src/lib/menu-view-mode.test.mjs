import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MENU_VIEW_MODE,
  MENU_VIEW_MODES,
  compactColumns,
  menuViewModeIcon,
  menuViewModeLabel,
  nextMenuViewMode,
  parseMenuViewMode,
} from './menu-view-mode.ts';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The width a phone gives the menu column: a 360pt screen less the 16pt page
// gutter on each side. The contract promises three compact tiles across here.
const PHONE_COLUMN = 328;
const GAP = 12;

test('the three modes cycle in the order the view button walks them', () => {
  assert.deepEqual([...MENU_VIEW_MODES], ['grid', 'list', 'compact']);
});

test('the photo grid is the default, and the first stop of the cycle', () => {
  // A new install has to open on what the screen looked like before the button
  // existed; anything else rearranges a waiter's menu under them.
  assert.equal(DEFAULT_MENU_VIEW_MODE, 'grid');
  assert.equal(MENU_VIEW_MODES[0], DEFAULT_MENU_VIEW_MODE);
});

test('the mode list cannot be rearranged at runtime', () => {
  assert.ok(Object.isFrozen(MENU_VIEW_MODES));
  assert.throws(() => {
    MENU_VIEW_MODES.push('extra');
  }, TypeError);
  assert.deepEqual([...MENU_VIEW_MODES], ['grid', 'list', 'compact']);
});

test('reads each saved mode back as itself', () => {
  for (const mode of MENU_VIEW_MODES) {
    assert.equal(parseMenuViewMode(mode), mode);
  }
});

test('nothing saved yet reads as the default', () => {
  assert.equal(parseMenuViewMode(null), 'grid');
  assert.equal(parseMenuViewMode(undefined), 'grid');
  assert.equal(parseMenuViewMode(''), 'grid');
});

test('a mode this build does not know reads as the default', () => {
  // A value written by a build that had a mode this one dropped, or a key
  // another feature wrote by mistake. Neither is worth an error on the order
  // screen.
  for (const raw of ['table', 'photos', 'rows', 'dense', 'grid-outline']) {
    assert.equal(parseMenuViewMode(raw), 'grid', raw);
  }
});

test('only the exact stored spelling counts', () => {
  // The store writes the name verbatim, so a changed case or stray whitespace
  // means the value did not come from it.
  for (const raw of ['List', 'COMPACT', ' list', 'list ', 'list\n']) {
    assert.equal(parseMenuViewMode(raw), 'grid', JSON.stringify(raw));
  }
});

test('names inherited from Object are not modes', () => {
  for (const raw of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'length']) {
    assert.equal(parseMenuViewMode(raw), 'grid', raw);
  }
});

test('a value of the wrong type reads as the default', () => {
  for (const raw of [0, 1, 2, NaN, true, false, {}, { mode: 'list' }, ['list'], () => 'list', Symbol('list')]) {
    assert.equal(parseMenuViewMode(raw), 'grid', typeof raw);
  }
});

test('a boxed string is not taken for the mode it wraps', () => {
  assert.equal(parseMenuViewMode(new String('list')), 'grid');
});

test('each tap moves one step along the cycle', () => {
  assert.equal(nextMenuViewMode('grid'), 'list');
  assert.equal(nextMenuViewMode('list'), 'compact');
});

test('the last mode wraps back to the first', () => {
  assert.equal(nextMenuViewMode('compact'), 'grid');
});

test('tapping through the cycle visits every mode once and comes home', () => {
  const seen = [];
  let mode = DEFAULT_MENU_VIEW_MODE;
  for (let tap = 0; tap < MENU_VIEW_MODES.length; tap += 1) {
    seen.push(mode);
    mode = nextMenuViewMode(mode);
  }
  assert.equal(mode, DEFAULT_MENU_VIEW_MODE);
  assert.deepEqual(seen, [...MENU_VIEW_MODES]);
  assert.equal(new Set(seen).size, MENU_VIEW_MODES.length);
});

test('every mode leads to a different mode', () => {
  for (const mode of MENU_VIEW_MODES) {
    const next = nextMenuViewMode(mode);
    assert.notEqual(next, mode);
    assert.ok(MENU_VIEW_MODES.includes(next), next);
  }
});

test('a mode the cycle does not know starts the cycle over', () => {
  assert.equal(nextMenuViewMode('table'), 'grid');
  assert.equal(nextMenuViewMode(undefined), 'grid');
});

test('names each mode in Thai', () => {
  assert.equal(menuViewModeLabel('grid', 'th'), 'รูปใหญ่');
  assert.equal(menuViewModeLabel('list', 'th'), 'รายการ');
  assert.equal(menuViewModeLabel('compact', 'th'), 'แบบย่อ');
});

test('names each mode in English', () => {
  assert.equal(menuViewModeLabel('grid', 'en'), 'Photos');
  assert.equal(menuViewModeLabel('list', 'en'), 'List');
  assert.equal(menuViewModeLabel('compact', 'en'), 'Compact');
});

test('no two modes share a name in either language', () => {
  for (const language of ['th', 'en']) {
    const labels = MENU_VIEW_MODES.map((mode) => menuViewModeLabel(mode, language));
    assert.equal(new Set(labels).size, labels.length, language);
  }
});

test('a label is a short name, not a sentence about the mode', () => {
  // The label follows "มุมมองเมนู" in the button's accessibility label; it
  // names the mode and stops. No punctuation, no separators, no explaining.
  for (const language of ['th', 'en']) {
    for (const mode of MENU_VIEW_MODES) {
      const label = menuViewModeLabel(mode, language);
      assert.ok(label.length > 0 && label.length <= 10, `${mode}/${language}: ${label}`);
      assert.equal(label, label.trim());
      assert.doesNotMatch(label, /[·•.,:;()/|]/, `${mode}/${language}: ${label}`);
    }
  }
});

test('the Thai labels are Thai and the English labels are not', () => {
  for (const mode of MENU_VIEW_MODES) {
    assert.match(menuViewModeLabel(mode, 'th'), /^\p{Script=Thai}+$/u, mode);
    assert.match(menuViewModeLabel(mode, 'en'), /^[A-Za-z ]+$/, mode);
  }
});

test('an unknown mode is named as the default', () => {
  assert.equal(menuViewModeLabel('table', 'th'), 'รูปใหญ่');
  assert.equal(menuViewModeLabel('table', 'en'), 'Photos');
});

test('a language the app does not speak falls back to Thai, the app default', () => {
  assert.equal(menuViewModeLabel('list', 'jp'), 'รายการ');
  assert.equal(menuViewModeLabel('list', undefined), 'รายการ');
});

test('draws each mode with its own glyph', () => {
  assert.equal(menuViewModeIcon('grid'), 'grid-outline');
  assert.equal(menuViewModeIcon('list'), 'list-outline');
  assert.equal(menuViewModeIcon('compact'), 'apps-outline');
});

test('no two modes share a glyph', () => {
  const icons = MENU_VIEW_MODES.map(menuViewModeIcon);
  assert.equal(new Set(icons).size, icons.length);
});

test('an unknown mode is drawn as the default', () => {
  assert.equal(menuViewModeIcon('table'), 'grid-outline');
});

test('every glyph exists in the Ionicons set the app draws with', () => {
  // A name Ionicons does not have renders as an empty box, and TypeScript only
  // catches it where the literal meets the icon prop. Check the real glyph map.
  const glyphMapPath = join(
    mobileRoot,
    'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
  );
  assert.ok(existsSync(glyphMapPath), `Ionicons glyph map not found at ${glyphMapPath}`);
  const glyphs = JSON.parse(readFileSync(glyphMapPath, 'utf8'));
  for (const mode of MENU_VIEW_MODES) {
    const icon = menuViewModeIcon(mode);
    assert.equal(typeof glyphs[icon], 'number', `${mode} -> ${icon}`);
  }
});

test('a phone column holds three compact tiles across', () => {
  assert.deepEqual(compactColumns(PHONE_COLUMN, GAP), { columns: 3, tileWidth: 101 });
  assert.deepEqual(compactColumns(PHONE_COLUMN, 8), { columns: 3, tileWidth: 104 });
});

test('every phone width from the smallest to the largest gets exactly three', () => {
  // 320pt (iPhone SE 1st gen, small Androids) up to 440pt (Pro Max), less the
  // page gutters. More than three would squeeze a two-line Thai name.
  for (let screen = 320; screen <= 440; screen += 1) {
    const { columns } = compactColumns(screen - 32, GAP);
    assert.equal(columns, 3, `screen ${screen}`);
  }
});

test('never fewer than three across, however narrow the column', () => {
  for (const width of [1, 20, 60, 120, 200, 250, 300]) {
    assert.equal(compactColumns(width, GAP).columns, 3, `width ${width}`);
  }
});

test('a wide tablet column takes more tiles across', () => {
  const half = compactColumns(480, GAP);
  const wide = compactColumns(800, GAP);
  assert.ok(half.columns > 3, JSON.stringify(half));
  assert.ok(wide.columns > half.columns, JSON.stringify(wide));
  assert.deepEqual(half, { columns: 4, tileWidth: 111 });
  assert.deepEqual(wide, { columns: 7, tileWidth: 104 });
});

test('past three across, no tile is narrower than the compact minimum', () => {
  for (let width = PHONE_COLUMN; width <= 1400; width += 7) {
    const { columns, tileWidth } = compactColumns(width, GAP);
    if (columns > 3) assert.ok(tileWidth >= 100, `width ${width}: ${columns} x ${tileWidth}`);
  }
});

test('columns only ever grow as the grid widens', () => {
  let previous = 0;
  for (let width = 1; width <= 1600; width += 1) {
    const { columns } = compactColumns(width, GAP);
    assert.ok(columns >= previous, `width ${width}`);
    previous = columns;
  }
});

test('a full row always fits the grid and never leaves a tile of slack', () => {
  // Rounded down so the last tile never wraps onto a row of its own, but only
  // by the rounding: a leftover as wide as a point per column means the row
  // does not run edge to edge.
  for (const gap of [0, 4, 8, 12, 16]) {
    for (let width = 1; width <= 1600; width += 3) {
      const { columns, tileWidth } = compactColumns(width, gap);
      const used = columns * tileWidth + gap * (columns - 1);
      if (width >= gap * (columns - 1)) {
        assert.ok(used <= width, `gap ${gap}, width ${width}: used ${used}`);
        assert.ok(width - used < columns, `gap ${gap}, width ${width}: slack ${width - used}`);
      }
    }
  }
});

test('tile widths are whole points', () => {
  for (let width = 1; width <= 900; width += 1.5) {
    assert.ok(Number.isInteger(compactColumns(width, GAP).tileWidth), `width ${width}`);
  }
});

test('before the grid is measured there are three columns of nothing', () => {
  assert.deepEqual(compactColumns(0, GAP), { columns: 3, tileWidth: 0 });
});

test('a width that is not a real measurement reads as unmeasured', () => {
  for (const width of [-1, -328, NaN, Infinity, -Infinity]) {
    assert.deepEqual(compactColumns(width, GAP), { columns: 3, tileWidth: 0 }, String(width));
  }
});

test('a column too narrow for even the gaps gets a zero width, never a negative one', () => {
  assert.deepEqual(compactColumns(20, GAP), { columns: 3, tileWidth: 0 });
  assert.deepEqual(compactColumns(1, GAP), { columns: 3, tileWidth: 0 });
});

test('a gap that is not a real spacing is treated as no gap', () => {
  const flush = compactColumns(PHONE_COLUMN, 0);
  assert.deepEqual(flush, { columns: 3, tileWidth: 109 });
  for (const gap of [-12, NaN, Infinity, -Infinity]) {
    assert.deepEqual(compactColumns(PHONE_COLUMN, gap), flush, String(gap));
  }
});

test('with no gap the tiles share the width exactly', () => {
  assert.deepEqual(compactColumns(300, 0), { columns: 3, tileWidth: 100 });
  assert.deepEqual(compactColumns(400, 0), { columns: 4, tileWidth: 100 });
  assert.deepEqual(compactColumns(399, 0), { columns: 3, tileWidth: 133 });
});

test('returns a fresh answer each call', () => {
  const first = compactColumns(PHONE_COLUMN, GAP);
  first.columns = 99;
  assert.deepEqual(compactColumns(PHONE_COLUMN, GAP), { columns: 3, tileWidth: 101 });
  const unmeasured = compactColumns(0, GAP);
  unmeasured.columns = 99;
  assert.deepEqual(compactColumns(0, GAP), { columns: 3, tileWidth: 0 });
});
