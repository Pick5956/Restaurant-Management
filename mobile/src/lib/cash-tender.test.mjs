import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cashReceivedToSend,
  formatTender,
  KEYPAD_MAX_DIGITS,
  keypadAmount,
  keypadNext,
  paidPaymentLine,
  QUICK_TENDER_LIMIT,
  quickTenderAmounts,
  repricedPaymentLine,
  tenderChange,
  toSatang,
} from './cash-tender.ts';

test('quick amounts are the notes a customer is likely to hand over', () => {
  assert.deepEqual(quickTenderAmounts(1424), [1500, 2000]);
  assert.deepEqual(quickTenderAmounts(287.5), [300, 500, 1000]);
  // A small bill is paid with a 50 or a 20 as often as with a 100.
  assert.deepEqual(quickTenderAmounts(45), [50, 60, 100]);
  assert.deepEqual(quickTenderAmounts(1424.3), [1500, 2000]);
  assert.deepEqual(quickTenderAmounts(12345), [12400, 12500, 13000]);
});

test('an exact round total has no round-up: "พอดี" already covers it', () => {
  assert.deepEqual(quickTenderAmounts(1000), []);
  assert.deepEqual(quickTenderAmounts(1500), [2000]);
});

test('quick amounts never exceed the limit and never include the total itself', () => {
  for (const total of [1, 19.75, 45, 99.99, 100, 287.5, 999, 1424, 5000.25]) {
    const amounts = quickTenderAmounts(total);
    assert.ok(amounts.length <= QUICK_TENDER_LIMIT, `${total}: ${amounts}`);
    assert.ok(amounts.every((amount) => toSatang(amount) > toSatang(total)), `${total}: ${amounts}`);
    assert.deepEqual([...amounts].sort((a, b) => a - b), amounts, `${total} not ascending`);
    assert.equal(new Set(amounts).size, amounts.length, `${total} has duplicates`);
  }
});

test('a bill with no amount due offers no quick amounts', () => {
  assert.deepEqual(quickTenderAmounts(0), []);
  assert.deepEqual(quickTenderAmounts(-5), []);
  assert.deepEqual(quickTenderAmounts(Number.NaN), []);
  assert.deepEqual(quickTenderAmounts(Number.POSITIVE_INFINITY), []);
});

test('change is exact to the satang', () => {
  assert.deepEqual(tenderChange(1424, 1500), { received: 1500, change: 76, short: 0, enough: true });
  assert.deepEqual(tenderChange(287.5, 300), { received: 300, change: 12.5, short: 0, enough: true });
  // Float subtraction gives 75.70000000000005 here.
  assert.equal(tenderChange(1424.3, 1500).change, 75.7);
  assert.deepEqual(tenderChange(1424, 1424), { received: 1424, change: 0, short: 0, enough: true });
});

test('a short amount says how much is missing and is not enough', () => {
  assert.deepEqual(tenderChange(1424, 1400), { received: 1400, change: 0, short: 24, enough: false });
  assert.equal(tenderChange(287.5, 287).short, 0.5);
});

test('nothing handed over yet is not enough and owes no change', () => {
  assert.deepEqual(tenderChange(1424, null), { received: null, change: 0, short: 0, enough: false });
  assert.deepEqual(tenderChange(1424, Number.NaN), { received: null, change: 0, short: 0, enough: false });
  assert.deepEqual(tenderChange(1424, -1), { received: null, change: 0, short: 0, enough: false });
});

test('the keypad types whole baht, with no leading zeros', () => {
  let digits = '';
  digits = keypadNext(digits, '0');
  assert.equal(digits, '');
  digits = keypadNext(digits, '00');
  assert.equal(digits, '');
  digits = keypadNext(digits, '1');
  digits = keypadNext(digits, '5');
  digits = keypadNext(digits, '00');
  assert.equal(digits, '1500');
  assert.equal(keypadAmount(digits), 1500);
  digits = keypadNext(digits, 'back');
  assert.equal(digits, '150');
  assert.equal(keypadNext('', 'back'), '');
  assert.equal(keypadNext('1234', 'clear'), '');
});

test('the keypad stops at its digit cap', () => {
  const full = '1'.repeat(KEYPAD_MAX_DIGITS);
  assert.equal(keypadNext(full, '9'), full);
  assert.equal(keypadNext(full, '00'), full);
  // A '00' one short of the cap takes the one zero that fits.
  assert.equal(keypadNext('1'.repeat(KEYPAD_MAX_DIGITS - 1), '00'), `${'1'.repeat(KEYPAD_MAX_DIGITS - 1)}0`);
});

test('an empty keypad is no amount, not zero', () => {
  assert.equal(keypadAmount(''), null);
  assert.equal(keypadAmount('7'), 7);
});

test('money shows satang only when there are some', () => {
  assert.equal(formatTender(1424, 'th'), '฿1,424');
  assert.equal(formatTender(1424, 'en'), '฿1,424');
  assert.equal(formatTender(287.5, 'th'), '฿287.50');
  assert.equal(formatTender(287.5, 'en'), '฿287.50');
  assert.equal(formatTender(75.70000000000005, 'en'), '฿75.70');
  assert.equal(formatTender(0, 'th'), '฿0');
  assert.equal(formatTender(null, 'th'), '฿0');
});

test('cash sends what was handed over; everything else sends the total', () => {
  assert.equal(cashReceivedToSend('cash', 1424, 1500), 1500);
  assert.equal(cashReceivedToSend('cash', 1424, 1424), 1424);
  assert.equal(cashReceivedToSend('cash', 287.5, 300), 300);
  // Short or unknown never reaches the server as a received amount.
  assert.equal(cashReceivedToSend('cash', 1424, 1400), 1424);
  assert.equal(cashReceivedToSend('cash', 1424, null), 1424);
  assert.equal(cashReceivedToSend('promptpay_qr', 1424, 2000), 1424);
  assert.equal(cashReceivedToSend('promptpay_qr', 1424, null), 1424);
});

test('a paid bill says how it was paid on one comma-joined line', () => {
  assert.equal(
    paidPaymentLine({ method: 'cash', amount: 1424, received_amount: 1500, change_amount: 76 }, 'th'),
    'เงินสด ฿1,424, รับมา ฿1,500, ทอน ฿76',
  );
  assert.equal(
    paidPaymentLine({ method: 'cash', amount: 287.5, received_amount: 300, change_amount: 12.5 }, 'en'),
    'Cash ฿287.50, Received ฿300, Change ฿12.50',
  );
  // No change given: the received part would only repeat the amount.
  assert.equal(
    paidPaymentLine({ method: 'cash', amount: 1424, received_amount: 1424, change_amount: 0 }, 'th'),
    'เงินสด ฿1,424',
  );
  assert.equal(
    paidPaymentLine({ method: 'promptpay_qr', amount: 1424, received_amount: 1424, change_amount: 0 }, 'th'),
    'PromptPay QR ฿1,424',
  );
  assert.equal(paidPaymentLine(null, 'th'), null);
  assert.equal(paidPaymentLine(undefined, 'en'), null);
  for (const line of [
    paidPaymentLine({ method: 'cash', amount: 1424, received_amount: 1500, change_amount: 76 }, 'th'),
  ]) {
    assert.doesNotMatch(line, / · |•/);
  }
});

test('a total the server re-priced while paying is told with the change actually recorded', () => {
  // Shown ฿1,424, handed ฿1,500, but a promotion ended in between: the server
  // recorded ฿1,450 and ฿50 change, not the ฿76 the sheet worked out.
  assert.equal(
    repricedPaymentLine(1424, { method: 'cash', amount: 1450, received_amount: 1500, change_amount: 50 }, 'th'),
    'ยอดเปลี่ยนเป็น ฿1,450, ทอน ฿50',
  );
  assert.equal(
    repricedPaymentLine(1424, { method: 'cash', amount: 1400.5, received_amount: 1500, change_amount: 99.5 }, 'en'),
    'Total changed to ฿1,400.50, Change ฿99.50',
  );
  // A transfer has no change; the new figure is what to collect against.
  assert.equal(
    repricedPaymentLine(1424, { method: 'promptpay_qr', amount: 1450, received_amount: 1450, change_amount: 0 }, 'th'),
    'ยอดเปลี่ยนเป็น ฿1,450',
  );
});

test('a payment recorded at the total on screen needs no second line', () => {
  assert.equal(repricedPaymentLine(1424, { method: 'cash', amount: 1424, received_amount: 1500, change_amount: 76 }, 'th'), null);
  // Float noise is not a re-price.
  assert.equal(repricedPaymentLine(1424.3, { method: 'cash', amount: 1424.3000000001, received_amount: 1500, change_amount: 75.7 }, 'th'), null);
  assert.equal(repricedPaymentLine(1424, null, 'th'), null);
  assert.equal(repricedPaymentLine(1424, undefined, 'en'), null);
  assert.equal(repricedPaymentLine(1424, { method: 'cash', amount: Number.NaN, received_amount: 0, change_amount: 0 }, 'th'), null);
});
