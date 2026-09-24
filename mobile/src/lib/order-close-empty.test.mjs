import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Call-site guards for closing an empty table from the order screen. The rule
// itself (dine-in, open, nothing active) is canCloseEmptyOrder, tested in
// order-workflow.test.mjs; what that test cannot see is where the screen puts
// the control and how it confirms, so these read app/order/[id].tsx.
//
// Owner, 2026-09-24: the full-width "ปิดโต๊ะว่าง" row above the menu had to go
// ("หาที่วางตรงอื่น หรือใช้ icon"). While the order is empty a close icon sits in
// the heading beside the item count, and a native alert with a destructive
// button is the confirmation. The count stays even at "0 รายการ": it is the only
// way into an open order's bill, where an empty table gets a served item added.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const screenPath = path.join(mobileRoot, 'app', 'order', '[id].tsx');

/** The file without its comments, so a note naming what not to do is not the thing done. */
function code(source) {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * The source of the declaration of `name`: from its line up to the next
 * statement at the same indentation, so an assertion about it can never be
 * met by a line somewhere else in the file.
 */
function declaration(source, name) {
  const match = new RegExp(`^([ \\t]*)(?:export )?(?:async )?(?:function|const) ${name}\\b`, 'm').exec(source);
  assert.ok(match, `${name} is declared`);
  const rest = source.slice(match.index + match[0].length);
  const next = new RegExp(`\\n${match[1]}[A-Za-z]`).exec(rest);
  return source.slice(match.index, match.index + match[0].length + (next ? next.index : rest.length));
}

const screen = () => code(readFileSync(screenPath, 'utf8'));

test('the guards read one declaration, not the rest of the file', () => {
  const source = [
    'function outer() {',
    '  const first = (',
    '    <Chip />',
    '  );',
    '  const second = 2;',
    '}',
  ].join('\n');
  assert.equal(declaration(source, 'first'), '  const first = (\n    <Chip />\n  );');
});

test('no full-width close row sits over the menu any more', () => {
  const source = screen();
  assert.doesNotMatch(source, /ปิดโต๊ะว่าง/, 'the old "ปิดโต๊ะว่าง" button is back');
  assert.doesNotMatch(source, /Close empty table/);
  assert.doesNotMatch(source, /\brenderDestructiveActions\b/, 'the destructive action row is back');
  // The alert is the confirmation; the two-step in-page state went with the row.
  assert.doesNotMatch(source, /\bconfirmEmptyClose\b|\bsetConfirmEmptyClose\b/);
  assert.doesNotMatch(source, /ยืนยันปิดโต๊ะ/);
});

test('while the table can be closed a close icon joins the count, which still opens the bill', () => {
  const source = screen();
  const summary = declaration(source, 'summaryAction');

  // The close icon only when canCloseEmpty, and beside the count, never in
  // its place: swapping the count out left an empty table's bill unreachable.
  assert.match(
    summary,
    /canCloseEmpty \? \(\s*<View\b[^>]*>\s*<CloseTableAction\b[\s\S]*?\/>\s*\{orderSummaryChip\}\s*<\/View>\s*\) : orderSummaryChip;/,
    'the count chip is missing while the table can be closed',
  );
  assert.match(declaration(source, 'orderSummaryChip'), /<OrderSummaryAction\b[\s\S]*onPress=\{openOrderSummary\}/);
  assert.equal(source.split('<CloseTableAction').length - 1, 1, 'the close control is drawn in one place only');
  const chip = summary.slice(summary.indexOf('<CloseTableAction'), summary.indexOf('/>', summary.indexOf('<CloseTableAction')));
  assert.match(chip, /onPress=\{confirmCloseEmpty\}/, 'the close control closes without asking');
  // An icon, not a second labelled chip crowding the heading.
  assert.doesNotMatch(chip, /\blabel=/);
  const closeAction = declaration(source, 'CloseTableAction');
  assert.match(closeAction, /icon="close-circle-outline"/);
  assert.doesNotMatch(closeAction, /\blabel=/);
  // A spinner and no taps while the close is in flight.
  assert.match(chip, /busy=\{submitting\}/);
  const headerChip = declaration(source, 'HeaderChip');
  assert.match(headerChip, /disabled=\{busy\}/);
  assert.match(headerChip, /\{busy \? \([\s\S]*<ActivityIndicator\b/);

  // Both layouts put that one chip in their heading.
  assert.match(source, /action=\{summaryAction\}\s*\n\s*>/, 'the phone heading lost the chip');
  assert.match(source, /header=\{<ScreenHeading action=\{summaryAction\}/, 'the tablet heading lost the chip');

  // canCloseEmpty keeps its permission and its rule.
  assert.match(source, /const canCloseEmpty = canTakeOrder && canCloseEmptyOrder\(order\);/);
});

test('a native alert with a destructive button confirms, then the table is closed', () => {
  const source = screen();
  const confirm = declaration(source, 'confirmCloseEmpty');
  assert.match(confirm, /if \(!canCloseEmpty \|\| submitting\) return;/);
  assert.match(confirm, /Alert\.alert\(/);
  // Named for the table it closes: "ปิดโต๊ะ T4 ริมน้ำ?".
  assert.match(confirm, /copy\(`ปิดโต๊ะ \$\{closeTablePlace\}\?`, `Close table \$\{closeTablePlace\}\?`\)/);
  assert.match(confirm, /\{ text: copy\('ยกเลิก', 'Cancel'\), style: 'cancel' \}/);
  assert.match(confirm, /\{ text: copy\('ปิดโต๊ะ', 'Close table'\), style: 'destructive', onPress: \(\) => \{ void closeEmpty\(\); \} \}/);
  // No sentence under the title explaining it.
  assert.match(confirm, /\n\s*undefined,\n/);

  // A takeaway has no table: the same close is "ยกเลิกออเดอร์", named for the
  // customer when there is one, and the keep button does not also say ยกเลิก.
  const takeaway = confirm.slice(confirm.indexOf('if (closingTakeaway) {'), confirm.indexOf('      return;\n    }'));
  assert.ok(takeaway.length > 0, 'the takeaway branch is gone');
  assert.match(takeaway, /copy\(`ยกเลิกออเดอร์กลับบ้านของ \$\{takeawayName\}\?`, `Discard \$\{takeawayName\}'s takeaway order\?`\)/);
  assert.match(takeaway, /copy\('ยกเลิกออเดอร์กลับบ้านนี้\?', 'Discard this takeaway order\?'\)/);
  assert.match(takeaway, /\{ text: copy\('เปิดออเดอร์ไว้', 'Keep order'\), style: 'cancel' \}/);
  assert.match(takeaway, /\{ text: copy\('ยกเลิกออเดอร์', 'Discard order'\), style: 'destructive', onPress: \(\) => \{ void closeEmpty\(\); \} \}/);
  assert.match(source, /const closingTakeaway = order\?\.order_type === 'takeaway';/);

  const close = declaration(source, 'closeEmpty');
  assert.match(close, /if \(!canCloseEmpty\) return;/);
  assert.match(close, /const closed = await mutate\(\(\) => closeEmptyTable\(orderId\)\);/);
  assert.match(close, /if \(closed\) leaveForWorkspaceRoute\(router, navigation\.getState\(\)\?\.routes\.map\(\(route\) => route\.name\) \?\? \[\], '\/tables'\);/);
  assert.doesNotMatch(close, /Alert\.alert\(/, 'closing asks a second time');

  // The table and its zone as one value, joined by a space, no dot.
  const place = declaration(source, 'closeTablePlace');
  assert.match(place, /`\$\{closeTableLabel\} \$\{closeTableZone\}`/);
  assert.doesNotMatch(place, / · /);
  // A table with no zone says so, "T4 ไม่มีโซน", instead of a shorter title
  // (owner, 2026-09-17: a missing value is said, never left blank).
  const zone = declaration(source, 'closeTableZone');
  assert.match(zone, /\|\| copy\('ไม่มีโซน', 'No zone'\);/);
  assert.doesNotMatch(place, /: closeTableLabel;/, 'a table with no zone drops back to its label alone');
});
