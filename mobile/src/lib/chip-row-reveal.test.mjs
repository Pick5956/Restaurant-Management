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
  assert.match(body, /onScroll=\{\(event\) => \{\s*rowBox\.current = \{ \.\.\.rowBox\.current, offset: event\.nativeEvent\.contentOffset\.x \}/);
});
