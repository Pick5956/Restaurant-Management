import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { apiFailureDetail } from './api-failure.ts';
import { billActionFailureMessage } from './bill-failure.ts';
import { formatTender } from './cash-tender.ts';
import { stockFailure, stockFailureMessage } from './order-item-error.ts';

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

// 2026-09-24: the header menu's print entry stays tappable while a print runs,
// and `printing` is state, so a second tap sent the receipt to the printer again.
test('a receipt already printing is not started a second time', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const print = block(bill, 'async function printReceipt(');
  assert.match(print, /if \(!bill \|\| !canAccessBill \|\| printStartedRef\.current\) return;/);
  assert.match(print, /printStartedRef\.current = true;\s*try \{\s*const result = await printReceiptView\(slipRef\.current\);/);
  assert.match(block(print, 'finally'), /printStartedRef\.current = false;/);
  assert.equal(bill.split('printReceiptView(').length - 1, 1, 'the slip is printed from somewhere the latch does not cover');
});

// Review, 2026-09-24: a print that failed with a code the app does not know put
// the printer library's own message under the title, in English.
test('a failed print gives the app\'s reason or only the title, never the printer library\'s words', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  const print = block(bill, 'async function printReceipt(');
  assert.match(print, /printFailed\(printerFailureReason\(result\.code, language\)\);/);
  assert.doesNotMatch(print, /result\.message/, 'the native message reaches the toast again');
  // No reason, no detail line: the title already says the print failed.
  assert.match(
    print,
    /const printFailed = \(detail: string \| null\) => showToast\(\{\s*tone: 'error',\s*title: copy\('พิมพ์ใบเสร็จไม่สำเร็จ', 'Could not print'\),\s*\.\.\.\(detail \? \{ message: detail \} : \{\}\),\s*\}\);/,
  );
});

// 2026-09-24: the summary rows went through money(), which rounds to the baht,
// under a total written with its satang: the lines read out to a customer did
// not add up to the sum they were asked to pay.
test('every amount on the bill keeps its satang, the way the total does', async () => {
  const bill = await read('app', 'order', 'bill.tsx');
  // A call, not the footer comment's `money()`.
  assert.doesNotMatch(bill, /\bmoney\((?!\))/, 'an amount on the bill is rounded to the baht again');
  assert.match(bill, /\[copy\('ยอดอาหาร', 'Food subtotal'\), formatTender\(bill\.subtotal, language\)\]/);
  assert.match(bill, /`−\$\{formatTender\(line\.amount, language\)\}`/);
  assert.match(bill, /formatTender\(bill\.service_charge_amount, language\)/);
  assert.match(bill, /formatTender\(bill\.vat_amount, language\)/);
  assert.match(bill, /\{formatTender\(item\.subtotal, language\)\}/);
  // The amount due a viewer without the payment permission sees.
  assert.match(bill, /\{copy\('ยอดคงเหลือ', 'Amount due'\)\}[\s\S]{0,200}\{formatTender\(bill\.grand_total, language\)\}/);
});

test('rows written the way the total is add up to it', () => {
  // ฿100.50 of food, 7% VAT on it: the rounded rows read ฿101 + ฿7 under ฿107.54.
  const rows = [formatTender(100.5, 'th'), formatTender(7.04, 'th')];
  assert.deepEqual(rows, ['฿100.50', '฿7.04']);
  assert.equal(formatTender(107.54, 'th'), '฿107.54');
  const sum = rows.reduce((total, row) => total + Math.round(Number(row.replace(/[฿,]/g, '')) * 100), 0);
  assert.equal(sum, 10754);
});

// Review, 2026-09-24: the order screen still went through money(), which
// rounds to the baht, while the bill kept its satang - the same order read
// ฿108 on one screen and ฿107.54 on the next.
test('the order screen writes the same order\'s amounts the way its bill does', async () => {
  const detail = await read('app', 'order', '[id].tsx');
  assert.doesNotMatch(detail, /\bmoney\(/, 'an amount on the order screen is rounded to the baht again');
  assert.match(detail, /import \{ formatTender \} from '@\/src\/lib\/cash-tender';/);
  assert.match(detail, /\{formatTender\(item\.subtotal, language\)\}/);
  assert.match(detail, /\{formatTender\(order\.grand_total, language\)\}/);
  assert.match(detail, /value=\{formatTender\(currentRoundSummary\.subtotal, language\)\}/);
  assert.equal(formatTender(107.54, 'th'), '฿107.54');
  assert.equal(formatTender(108, 'th'), '฿108');
});

// Review, 2026-09-24: the dish tile, the item editor and its add button still
// went through money(): a ฿45.50 dish read ฿46 on all three and ฿45.50 on the
// line it added to the bill.
//
// Review, 2026-09-25: the compact tile and the list row, the other two layouts
// of the same menu, were left on money() - the same dish read ฿45.50 or ฿46
// depending on the layout toggle.
test('a dish is priced on its tile, its editor and its add button the way its bill line is', async () => {
  const [editor, grid, compact, row] = await Promise.all([
    read('src', 'components', 'order-item-editor.tsx'),
    read('src', 'components', 'order-menu-grid.tsx'),
    read('src', 'components', 'order-menu', 'menu-compact-tile.tsx'),
    read('src', 'components', 'order-menu', 'menu-list-row.tsx'),
  ]);
  for (const [name, source] of [
    ['order-item-editor.tsx', editor],
    ['order-menu-grid.tsx', grid],
    ['menu-compact-tile.tsx', compact],
    ['menu-list-row.tsx', row],
  ]) {
    // A call, not a comment's `money()`.
    assert.doesNotMatch(source, /\bmoney\((?!\))/, `${name} rounds a price to the baht again`);
    assert.match(source, /import \{ formatTender \} from '@\/src\/lib\/cash-tender';/);
  }
  assert.match(editor, /\{formatTender\(menu\.price, language\)\}/);
  assert.match(editor, /\+\{formatTender\(option\.price_delta, language\)\}/);
  // All three layouts of the order menu: photo, compact and list.
  for (const [name, source] of [['photo tile', grid], ['compact tile', compact], ['list row', row]]) {
    assert.match(source, /\{formatTender\(item\.price, language\)\}/, `the ${name} does not price the dish as its bill line`);
  }

  const from = editor.indexOf('export function OrderItemAddButton(');
  const button = editor.slice(from, editor.indexOf('\nexport function ', from + 1));
  assert.match(button, /const amount = formatTender\(total, language\);/);
  // The action and its amount are two values on one line: a comma, not a dot.
  assert.match(button, /copy\(`บันทึกรายการ, \$\{amount\}`, `Save item, \$\{amount\}`\)/);
  assert.match(button, /copy\(`เพิ่มเข้าบิล, \$\{amount\}`, `Add to bill, \$\{amount\}`\)/);
  assert.match(button, /copy\(`เพิ่มเข้าออเดอร์, \$\{amount\}`, `Add to order, \$\{amount\}`\)/);
  assert.doesNotMatch(button, / · /, 'the add button joins its action and amount with a middle dot');

  assert.equal(formatTender(45.5, 'th'), '฿45.50');
  assert.equal(`เพิ่มเข้าออเดอร์, ${formatTender(45.5, 'th')}`, 'เพิ่มเข้าออเดอร์, ฿45.50');
});

/** The chain the order screen and the item editor put a refused write through. */
function orderWriteReason(err, language) {
  const failure = stockFailure(err instanceof Error ? err.message : '');
  return failure
    ? stockFailureMessage(failure, language)
    : billActionFailureMessage(err, language) ?? apiFailureDetail(err, language);
}

// Review, 2026-09-24: the order screen's and the served-item page's loads put
// err.message under their red heading - "record not found", "missing
// view_orders permission", RN's "Network request failed" - in English, to Thai
// restaurant staff. The rule: never show the API's own wording.
test('the order screens never put a failure\'s own wording on screen', async () => {
  const files = [
    ['app/order/[id].tsx', await read('app', 'order', '[id].tsx')],
    ['app/order/served.tsx', await read('app', 'order', 'served.tsx')],
    ['app/order/new.tsx', await read('app', 'order', 'new.tsx')],
    ['src/components/order-item-editor.tsx', await read('src', 'components', 'order-item-editor.tsx')],
  ];
  // The stock mapper reads the message to recognise its two refusals; that is
  // the only place a message may go. It is stripped first, and then every way
  // of reading a failure's own text out of it counts: `err.message` and
  // `err?.message`, `(err as Error).message`, `String(err)`, `${err}` and
  // `err.toString()` all put the same English on screen.
  const mapperInput = /stockFailure\(err instanceof Error \? err\.message : ''\)/g;
  const rawWording = new RegExp([
    String.raw`\b(?:err|error|e)\??\.message\b`,
    String.raw`\(\s*(?:err|error|e)\s+as\s+[^)]+\)\??\.message\b`,
    String.raw`\bString\(\s*(?:err|error|e)\s*\)`,
    String.raw`\$\{\s*(?:err|error|e)\s*\}`,
    String.raw`\b(?:err|error|e)\??\.toString\(`,
  ].join('|'));
  for (const sample of ['err.message', 'error?.message', '(err as Error).message', '(e as { message: string })?.message', 'String(err)', '`${error}`', 'err.toString()']) {
    assert.match(sample, rawWording, `the guard misses ${sample}`);
  }
  for (const [name, source] of files) {
    assert.doesNotMatch(source.replace(mapperInput, ''), rawWording, `${name} puts a failure's own wording on screen`);
  }
  const [[, detail], [, served], [, opener], [, editor]] = files;

  // A failed load: the panel's title names it, the detail is the app's reason
  // or nothing, and the panel still shows when there is no reason to give.
  for (const [name, source, count] of [['app/order/[id].tsx', detail, 2], ['app/order/served.tsx', served, 1]]) {
    assert.match(source, /setError\(apiFailureDetail\(err, language\) \?\? ''\);/, `${name} no longer maps its load failure`);
    assert.equal(source.split('error !== null ? <Feedback').length - 1, count, `${name} hides the load failure when there is no reason to give`);
    assert.equal(source.split('detail={error || undefined}').length - 1, count, `${name} draws an empty detail line`);
  }
  assert.match(editor, /\.catch\(\(err: unknown\) => setError\(apiFailureDetail\(err, language\) \?\? copy\('โหลดเมนูไม่สำเร็จ'/);

  // A refused write: the stock refusal, then the bill's, then everyone's.
  const chain = /const reason = failure\s*\? stockFailureMessage\(failure, language\)\s*: billActionFailureMessage\(err, language\) \?\? apiFailureDetail\(err, language\);/;
  assert.match(detail, chain, 'the order screen\'s write failure skips a mapper');
  assert.match(editor, chain, 'the item editor\'s write failure skips a mapper');
  for (const source of [detail, editor]) assert.match(source, /\.\.\.\(reason \? \{ message: reason \} : \{\}\),/);

  // The open-table screen already maps every step through its own mapper.
  assert.match(opener, /openTableFailure\(err, 'reserve', language\)/);
  assert.match(opener, /openTableFailure\(err, takeaway \? 'takeaway' : 'open', language\)/);
  assert.match(opener, /setLoadFailure\(openTableFailureCode\(err, 'load'\)\);/);
});

test('a refused write is said in the app\'s words, or not at all', () => {
  const forbidden = Object.assign(new Error('missing take_order permission'), { status: 403 });
  assert.equal(orderWriteReason(new Error('ข้าวผัด is sold out'), 'th'), 'ข้าวผัด หมดแล้ว');
  assert.equal(orderWriteReason(new Error('only pending items can be edited'), 'th'), 'รายการนี้ส่งครัวไปแล้ว');
  assert.equal(orderWriteReason(new Error('cannot add items to a closed order'), 'th'), 'ออเดอร์นี้ปิดไปแล้ว');
  assert.equal(orderWriteReason(forbidden, 'th'), 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  assert.equal(orderWriteReason(new Error('Network request failed'), 'en'), 'Cannot reach the server. Try again');
  // Nothing better to say than the title: nothing, never the server's English.
  assert.equal(orderWriteReason(new Error('order item quantity overflow'), 'th'), undefined);
  // A load says the shared reasons only.
  assert.equal(apiFailureDetail(Object.assign(new Error('record not found'), { status: 404 }), 'th'), 'ไม่พบรายการนี้แล้ว');
  assert.equal(apiFailureDetail(new Error('pq: relation does not exist'), 'th'), undefined);
});
