import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The kitchen's compact bar (owner's Grab reference, 23 ก.ย. 2569). The phone
// board keeps its full heading - tiles, "กำลังทำ" and the order switch - in the
// content; once the heading has scrolled away, the bar carries the same switch
// on its title row. Both faults this guards against are one wrong line at the
// call site, which no test of the board's logic can see.

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

test('the compact bar carries the board order switch, driven by the same state', async () => {
  const kitchen = await read('app', 'kitchen.tsx');
  const tag = mainScreenTag(kitchen);

  // The bar is not switched off: the phone board is exactly the long list it
  // is for, and the tablet never scrolls, so never gets it.
  assert.doesNotMatch(tag, /compactHeader=\{false\}/);
  assert.match(tag, /scroll=\{!isTablet\}/);

  // Phone only, and on the same condition as the board heading's own switch -
  // never an empty slot, never a switch with one ticket to order.
  assert.match(
    tag,
    /compactAction=\{!isTablet && cookingTickets\.length > 1\s*\?\s*<SortSwitch sort=\{sortMode\} onSort=\{sortFromCompactBar\} language=\{language\} \/>\s*:\s*null\}/,
  );
  assert.match(kitchen, /showSort=\{cookingTickets\.length > 1\}/);
  assert.match(tag, /scrollControlRef=\{scrollControlRef\}/);
  // A second copy of the switch, not a second copy of the state: the bar's
  // handler writes the one `sortMode` the heading reads.
  assert.match(kitchen, /const \[sortMode, setSortMode\] = useState<KitchenSortMode>/);
  assert.equal((kitchen.match(/useState<KitchenSortMode>/g) || []).length, 1);
});

test('a new order picked from down the list goes back to the top of the board', async () => {
  const kitchen = await read('app', 'kitchen.tsx');
  const start = kitchen.indexOf('function sortFromCompactBar(');
  assert.ok(start !== -1, 'the compact bar switch has no handler of its own');
  const body = kitchen.slice(start, kitchen.indexOf('\n  }\n', start));

  // Pressing the order already chosen does not move the page.
  assert.match(body, /if \(mode === sortMode\) return;/);
  assert.match(body, /setSortMode\(mode\);/);
  // Reduced motion jumps instead of gliding.
  assert.match(body, /scrollControlRef\.current\?\.scrollTo\(0, !reducedMotion\);/);
});

test('the switch in the bar holds no Liquid Glass and fits the bar row', async () => {
  const parts = await read('src', 'components', 'kitchen', 'parts.tsx');
  const start = parts.indexOf('export function SortSwitch(');
  assert.ok(start !== -1);
  const body = parts.slice(start, parts.indexOf('\n}\n', start));

  // The bar fades in; glass under a fading parent renders flat.
  assert.doesNotMatch(body, /Glass/);
  // The bar's row is 40pt: 3 + 5 + a Kanit 12.5 line + 5 + 3 + the border is
  // just under it, so it is not scaled down there. Growing any of these means
  // checking that sum again.
  assert.match(body, /padding: 3,/);
  assert.match(body, /paddingVertical: 5,/);
  assert.match(body, /fontSize: 12\.5,/);
  assert.doesNotMatch(body, /lineHeight/);
});
