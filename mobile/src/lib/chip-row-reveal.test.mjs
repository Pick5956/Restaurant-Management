import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CHIP_REVEAL_MARGIN, chipRevealOffset } from './chip-row-reveal.ts';

// The menu shows its category chips in two rows that scroll sideways on their
// own - the filter bar and the compact header's row. A chip picked in one has
// to be in view in the other, or that row reads as nothing chosen.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const row = { offset: 0, viewport: 280, content: 700 };

test('a chip already in view leaves the row where it is', () => {
  assert.equal(chipRevealOffset({ ...row, chip: { x: 0, width: 80 } }), null);
  assert.equal(chipRevealOffset({ ...row, chip: { x: 190, width: 90 } }), null, 'touching the edge is in view');
  assert.equal(chipRevealOffset({ ...row, offset: 100, chip: { x: 120, width: 90 } }), null);
});

test('a chip past the trailing edge is brought in with its neighbour peeking', () => {
  assert.equal(chipRevealOffset({ ...row, chip: { x: 400, width: 100 } }), 500 - 280 + CHIP_REVEAL_MARGIN);
});

test('a chip past the leading edge is brought back in', () => {
  assert.equal(chipRevealOffset({ ...row, offset: 300, chip: { x: 150, width: 80 } }), 150 - CHIP_REVEAL_MARGIN);
  assert.equal(chipRevealOffset({ ...row, offset: 300, chip: { x: 0, width: 80 } }), 0, 'never before the start');
});

test('the row is never sent past its own end', () => {
  // The last chip ends where the content does; the margin would overshoot.
  assert.equal(chipRevealOffset({ ...row, chip: { x: 610, width: 90 } }), 700 - 280);
});

test('a chip wider than the row shows its start', () => {
  assert.equal(chipRevealOffset({ ...row, chip: { x: 300, width: 320 } }), 300 - CHIP_REVEAL_MARGIN);
});

test('nothing moves until the row, its content and the chip are measured', () => {
  assert.equal(chipRevealOffset({ ...row, chip: undefined }), null);
  assert.equal(chipRevealOffset({ ...row, viewport: 0, chip: { x: 400, width: 100 } }), null);
  assert.equal(chipRevealOffset({ ...row, content: 0, chip: { x: 400, width: 100 } }), null);
});

test('ChoiceChips reveals the chosen chip when the row scrolls, and only then', async () => {
  const source = (await readFile(path.join(mobileRoot, 'src/components/form/parts.tsx'), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const start = source.indexOf('export function ChoiceChips');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(body, /chipRevealOffset\(\{ chip: chipBoxes\.current\.get\(value\)/);
  assert.match(body, /useEffect\(\(\) => \{\s*if \(scroll\) revealChosenRef\.current\(true\);\s*\}, \[scroll, value\]\)/, 'a new choice is revealed');
  assert.match(body, /onLayout=\{scroll \? \(event\) =>/, 'chips are measured only in a scrolling row');
  assert.match(body, /<ScrollView\s+ref=\{rowRef\}/);
  assert.match(body, /onScroll=\{\(event\) => \{\s*const x = event\.nativeEvent\.contentOffset\.x;\s*rowBox\.current = \{ \.\.\.rowBox\.current, offset: x \};\s*lead\(x\);/);
});

// Owner, 2026-09-25: the menu's chips wobbled at their ends where a lone row
// (the order screen's) only stretched. A row moved by code used to lead: its
// scroll event landed after the next follow, read as a drag, and pulled the
// dragged row back under the finger. Only the row being dragged leads now, it
// hands on a position clamped to its range, and the stretch stays its own.
test('rows sharing a sync scroll as one, led only by the row under the finger', async () => {
  const source = (await readFile(path.join(mobileRoot, 'src/components/form/parts.tsx'), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const start = source.indexOf('export function ChoiceChips');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.match(source, /export function createChipRowSync\(\): ChipRowSync \{\s*return \{ x: 0, placed: false, followers: new Set\(\) \};/);
  // A follower clamps to its own range.
  assert.match(body, /const target = Math\.min\(Math\.max\(0, content - viewport\), Math\.max\(0, x\)\);\s*if \(Math\.abs\(target - offset\) < 1\) return;\s*rowRef\.current\?\.scrollTo\(\{ x: target, animated: false \}\);/);
  // The finger makes a row the leader; its fling ending, or another row
  // leading, makes it a follower again.
  assert.match(body, /onScrollBeginDrag=\{\(\) => \{ touching\.current = true; \}\}/);
  assert.match(body, /onMomentumScrollEnd=\{\(\) => \{ touching\.current = false; \}\}/);
  assert.match(body, /const follow = \(x: number\) => \{\s*touching\.current = false;\s*followToRef\.current\(x\);\s*\};/);
  // Only the dragged row leads, clamped, and never to itself.
  assert.match(body, /if \(!sync \|\| !touching\.current\) return;/);
  assert.match(body, /const clamped = Math\.min\(Math\.max\(0, content - viewport\), Math\.max\(0, x\)\);\s*sync\.placed = true;\s*if \(Math\.abs\(sync\.x - clamped\) < 1\) return;\s*sync\.x = clamped;/);
  assert.match(body, /if \(follow !== ownFollow\.current\) follow\(clamped\);/);
  assert.match(body, /sync\.followers\.add\(follow\);/);
  assert.match(body, /if \(sync\.placed\) follow\(sync\.x\);/);
  assert.match(body, /sync\.followers\.delete\(follow\);/);
  // A row laid out after the reader moved another takes that position; only
  // a row nobody has moved reveals its own chosen chip.
  assert.match(body, /const settle = \(\) => \{\s*if \(sync\?\.placed\) followToRef\.current\(sync\.x\);\s*else revealChosenRef\.current\(false\);\s*\};/);
  assert.equal((body.match(/settle\(\);/g) || []).length, 3, 'layout, content size and the chosen chip all settle');
  // The stretch past the ends stays, as on every list.
  assert.doesNotMatch(body, /bounces=\{false\}|overScrollMode="never"/);
});
