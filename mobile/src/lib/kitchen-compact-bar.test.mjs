import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The kitchen's compact bar (owner's Grab reference, 23 ก.ย. 2569). The phone
// board keeps its full heading - tiles, "กำลังทำ" and the order switch - in the
// content; once the heading has scrolled away, the bar shows the title, in the
// middle. On 25 ก.ย. 2569 the owner took the order switch off the bar and kept
// it on the board heading only ("ปุ่มรอนานสุด ไม่ต้องเอาไว้ header ตอนเลื่อนลง").
// Each of these is one line at the call site, which no test of the board's
// logic can see.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Line endings are normalised so a checkout with CRLF reads the same.
const read = async (...segments) => (await readFile(path.join(mobileRoot, ...segments), 'utf8')).replace(/\r\n/g, '\n');

/** The main `<AppScreen ...>` tag: from its opening to the line holding only ">". */
function mainScreenTag(source) {
  const start = source.lastIndexOf('<AppScreen\n');
  assert.ok(start !== -1, 'the board no longer renders its AppScreen with one prop per line');
  const end = source.indexOf('\n    >\n', start);
  assert.ok(end !== -1, 'the board AppScreen tag no longer ends on its own line');
  return source.slice(start, end);
}

test('the phone bar is the title alone, centred, with no order switch', async () => {
  const kitchen = await read('app', 'kitchen.tsx');
  const tag = mainScreenTag(kitchen);

  // The bar is not switched off: the phone board is exactly the long list it
  // is for, and the tablet never scrolls, so never gets it.
  assert.doesNotMatch(tag, /compactHeader=\{false\}/);
  assert.match(tag, /scroll=\{!isTablet\}/);
  assert.match(tag, /centerTitle=\{!isTablet\}/);
  // No switch on the bar: `action` is the tablet's only, so the bar has none.
  assert.doesNotMatch(tag, /compactAction=/);
  assert.match(tag, /action=\{isTablet && cookingTickets\.length > 1/);
  assert.doesNotMatch(kitchen, /sortFromCompactBar/);
});

test('the board reads longest-waiting first, and its heading keeps the switch', async () => {
  const kitchen = await read('app', 'kitchen.tsx');
  assert.match(kitchen, /const \[sortMode, setSortMode\] = useState<KitchenSortMode>\('waiting'\);/);
  assert.equal((kitchen.match(/useState<KitchenSortMode>/g) || []).length, 1);
  assert.match(kitchen, /<BoardHeading\s+title=\{copy\('กำลังทำ', 'Cooking'\)\}\s+sort=\{sortMode\}\s+onSort=\{setSortMode\}\s+showSort=\{cookingTickets\.length > 1\}/);
});

test('a ticket under five minutes wears the done button green, and its small line stays legible on it', async () => {
  const parts = await read('src', 'components', 'kitchen', 'parts.tsx');
  // The done button's own colour, not a copy of its value.
  assert.match(parts, /const FRESH_HEADER = palette\.success;/);
  assert.doesNotMatch(parts, /#2B1A12/);
  assert.match(parts, /return urgency === 'overdue' \? palette\.danger : urgency === 'warning' \? palette\.warning : FRESH_HEADER;/);
  // 12pt on the green, amber or red header needs 4.5:1; 0.82 white was 4.3 and 3.9.
  assert.match(parts, /fontSize: 12, lineHeight: 16, color: 'rgba\(255,255,255,0\.92\)'/);
});
