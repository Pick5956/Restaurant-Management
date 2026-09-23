import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Source guards for the open-table screen (/order/new) and the pieces it is
// built from. Each one pins a problem the owner saw on this screen, or a house
// rule it used to break, so the fix cannot quietly come undone.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const screenPath = path.join(mobileRoot, 'app', 'order', 'new.tsx');
const pickerPath = path.join(mobileRoot, 'src', 'components', 'open-table', 'guest-count-picker.tsx');
const issuePath = path.join(mobileRoot, 'src', 'components', 'open-table', 'table-load-issue.tsx');

async function sources() {
  const [screen, picker, issue] = await Promise.all([screenPath, pickerPath, issuePath].map((file) => readFile(file, 'utf8')));
  return { screen, picker, issue };
}

/** The file with its comments taken out, so a note about an old mistake does not trip the guard. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

test('the server never speaks to the waiter on this screen', async () => {
  const { screen } = await sources();
  // listTables, createOrder and reserveTable all refuse in the API's own
  // English; the screen used to print err.message into a panel on the page.
  assert.doesNotMatch(code(screen), /err(or)?\.message/);
  assert.doesNotMatch(code(screen), /<Feedback\b/);
  assert.match(screen, /openTableFailure\(err, 'reserve', language\)/);
  assert.match(screen, /openTableFailure\(err, takeaway \? 'takeaway' : 'open', language\)/);
  assert.match(screen, /openTableFailureCode\(err, 'load'\)/);
  assert.match(screen, /showToast\(/);
});

test('the fields name themselves and explain nothing', async () => {
  const { screen } = await sources();
  const body = code(screen);
  assert.doesNotMatch(body, /ไม่บังคับ/);
  assert.doesNotMatch(body, /\(optional\)/i);
  assert.doesNotMatch(body, /For example/);
  assert.doesNotMatch(body, /เช่น /);
  assert.doesNotMatch(body, /subtitle=/);
  assert.doesNotMatch(body, / · /);
});

test('the screen has one primary action, solid orange, right under the form', async () => {
  const { screen } = await sources();
  const body = code(screen);
  // The pale glass wash read as an outline on the screen's main action.
  assert.doesNotMatch(body, /variant="glass"/);
  assert.doesNotMatch(body, /\bglass\b/);
  // Two Buttons in the source, one per mode, and only one is ever rendered.
  assert.equal(body.match(/<Button\b/g)?.length, 2);
  assert.match(body, /const primaryAction = reserveMode \?/);
  assert.equal(body.match(/\{primaryAction\}/g)?.length, 1);
  // A dock pinned to the bottom of a short form is the blank band the owner saw.
  assert.doesNotMatch(body, /footer=/);
  assert.doesNotMatch(body, /<ActionDock\b/);
});

test('the dine-in and reservation switch is one control', async () => {
  const { screen } = await sources();
  const body = code(screen);
  // ChipGroup drew the chosen option as an orange block and the other as a
  // separate white card: two boxes, not one switch.
  assert.doesNotMatch(body, /<ChipGroup\b/);
  assert.match(body, /<PillTabs<EntryMode>/);
  assert.match(body, /value=\{reserveMode \? 'reservation' : 'dine_in'\}/);
});

test('the guest count has no separate +5 and −5 boxes', async () => {
  const { screen, picker } = await sources();
  for (const source of [screen, picker]) {
    assert.doesNotMatch(code(source), /label="[+−-]5"/);
  }
  assert.match(picker, /QUICK_GUEST_COUNTS\.map/);
  // Holding − or + is how a big party is reached without ten taps.
  assert.match(picker, /useRepeatPress\(step\(-1\)\)/);
  assert.match(picker, /useRepeatPress\(step\(1\)\)/);
  assert.match(picker, /keyboardType="number-pad"/);
  assert.match(picker, /maxLength=\{4\}/);
  assert.match(picker, /selectTextOnFocus/);
});

test('the guest number stays under the screen title, on one line the type test can read', async () => {
  const { picker } = await sources();
  // type-scale.test.mjs checks size and weight per line; with the two on
  // separate lines a 20pt number at weight 700 slipped past it.
  const sizedLines = picker.split('\n').filter((line) => /fontSize:\s*(19|20)\b/.test(line));
  assert.ok(sizedLines.length > 0, 'the guest number sets its size in the picker');
  for (const line of sizedLines) {
    assert.match(line, /fontWeight:\s*'(500|600)'/, line.trim());
  }
});

test('the table note is one line, not a block', async () => {
  const { screen } = await sources();
  const body = code(screen);
  const note = body.split('\n').find((line) => line.includes('onChangeText={setNote}'));
  assert.ok(note, 'the note field is on one line');
  assert.doesNotMatch(note, /multiline|minHeight/);
  assert.match(note, /maxLength=\{1000\}/);
});

test('the screen keeps its gate, its calls and where it goes after', async () => {
  const { screen } = await sources();
  assert.match(screen, /can\(activeMembership, 'take_order'\)/);
  assert.match(screen, /canOpenDineInOrder\(tableId, Boolean\(table\)\)/);
  assert.match(screen, /listTables\(\)/);
  assert.match(screen, /createOrder\(\{/);
  assert.match(screen, /reserveTable\(tableId, \{/);
  // Replace, not push: back from the order must not land on this form again.
  assert.match(screen, /router\.replace\(\{ pathname: '\/order\/\[id\]', params: \{ id: String\(order\.ID\) \} \}\)/);
  assert.match(screen, /router\.back\(\)/);
  assert.match(screen, /customer_name: takeaway \? customerName\.trim\(\) : ''/);
  assert.match(screen, /customer_phone: takeaway \? customerPhone\.trim\(\) : ''/);
  assert.doesNotMatch(screen, /seat_reservation/);
});

test('nothing on this screen opens a raw modal or draws a dot', async () => {
  const { screen, picker, issue } = await sources();
  for (const source of [screen, picker, issue]) {
    assert.doesNotMatch(source, /<Modal\b/);
    assert.doesNotMatch(code(source), /•|StatusBadge/);
  }
});
