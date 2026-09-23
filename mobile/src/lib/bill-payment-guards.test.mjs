import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

/** The source from `start` up to the end of the statement block it opens. */
function block(source, start) {
  const from = source.indexOf(start);
  assert.ok(from !== -1, `${start} not found`);
  let depth = 0;
  for (let index = source.indexOf('{', from); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(from, index + 1);
  }
  throw new Error(`${start} never closes`);
}

// 2026-09-23: one tap on the bill's footer recorded a whole bill in cash. The
// footer button WAS the confirm, live with `cash` preselected. These are
// call-site facts, so they are asserted on the source.
test('the bill footer opens the payment step and never pays on its own', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const payAction = bill.slice(bill.indexOf('const payAction = ('), bill.indexOf('/>', bill.indexOf('const payAction = (')));
  assert.match(payAction, /onPress=\{openPayment\}/);
  assert.doesNotMatch(bill, /onPress=\{pay\}/, 'a button still pays in one tap');
  assert.match(bill, /\?\? \(paymentStage === 'due' && canPay \? payAction : null\)/);
  assert.match(bill, /<PaymentSheet\b/);
  // The form's confirm is the only way into pay().
  assert.match(bill, /onConfirm: \(received\) => \{ void pay\(received\); \}/);
});

test('one payment call, guarded against a second tap and a stale bill', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  assert.equal(bill.split('payOrder(').length - 1, 1, 'payOrder is called from more than one place');
  const pay = block(bill, 'async function pay(');
  assert.match(pay, /payOrder\(orderId, \{/);
  assert.match(pay, /if \(!bill \|\| !canPay \|\| !paymentReady \|\| saving \|\| billStale \|\| payingRef\.current\) return;/);
  // Cash sends what was handed over, through the tested helper.
  assert.match(pay, /received_amount: cashReceivedToSend\(method, bill\.grand_total, received\)/);
});

test('a payment the server re-priced says what was recorded, and a paid bill cannot be paid twice', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const pay = block(bill, 'async function pay(');
  // Cash now sends the notes handed over, so a total moved by a promotion
  // boundary is accepted whenever they cover it; the sheet's change is then wrong.
  assert.match(pay, /const paid = await payOrder\(orderId, \{/);
  assert.match(pay, /repricedPaymentLine\(bill\.grand_total, paid\?\.payments\?\.at\(-1\), language\)/);
  // A success toast is only spoken; the re-priced one has to be drawn.
  assert.match(pay, /tone: 'warning', title: copy\('รับชำระเงินเรียบร้อย'/);
  // The double-tap latch is let go on failure only.
  assert.match(block(pay, 'catch (err)'), /payingRef\.current = false;/);
  assert.doesNotMatch(block(pay, 'finally'), /payingRef\.current = false/);
});

test('a failed payment is told in the app\'s words, never the server\'s', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const pay = block(bill, 'async function pay(');
  const failure = block(pay, 'catch (err)');
  assert.match(failure, /paymentFailureCode\(err instanceof Error \? err\.message : ''\)/);
  assert.match(failure, /message: paymentFailureMessage\(code, language\)/);
  // err.message goes into the mapping and nowhere else.
  assert.equal(failure.split('err.message').length - 1, 1, 'err.message reaches something other than paymentFailureCode');
  assert.doesNotMatch(failure, /actionFailed\(/);
});

test('the payment components draw no dots, no raw modal and no server wording', async () => {
  const dir = path.join(mobileRoot, 'src', 'components', 'payment');
  const files = (await readdir(dir)).filter((name) => /\.tsx?$/.test(name));
  assert.ok(files.includes('payment-sheet.tsx') && files.includes('payment-form.tsx'), files.join(', '));
  for (const name of files) {
    const source = await readFile(path.join(dir, name), 'utf8');
    assert.doesNotMatch(source, /<Modal\b/, `${name} opens a raw Modal`);
    assert.doesNotMatch(source, / · /, `${name} joins values with a middle dot`);
    assert.doesNotMatch(source, /•/, `${name} draws a bullet`);
    assert.doesNotMatch(source, /err\.message/, `${name} shows the server's wording`);
    assert.doesNotMatch(source, /RadioGroup/, `${name} brings back the radio rings`);
  }
});

test('the sheet confirm states what it confirms and holds off a fall-through tap', async () => {
  const [sheet, form] = await Promise.all([
    read('src', 'components', 'payment', 'payment-sheet.tsx'),
    read('src', 'components', 'payment', 'payment-form.tsx'),
  ]);
  assert.match(sheet, /<BottomSheet fit\b/);
  assert.match(sheet, /export const SHEET_ARM_MS = \d{3};/);
  assert.match(sheet, /isArmed=\{isArmed\}/);
  assert.match(form, /if \(isArmed && !isArmed\(\)\) return;/);
  // Cash cannot be confirmed until enough has been handed over.
  assert.match(form, /const blocked = !ready \|\| \(cash \? !tender\.enough : !hasQr\);/);
  assert.match(form, /copy\(`รับเงินสด \$\{amount\}`/);
  assert.match(form, /copy\(`ได้รับเงินโอนแล้ว \$\{amount\}`/);
});

test('the tender starts with nothing handed over', async () => {
  const hook = await read('src', 'components', 'payment', 'use-cash-tender.ts');
  assert.match(hook, /useState<TenderChoice \| null>\(null\)/);
});
