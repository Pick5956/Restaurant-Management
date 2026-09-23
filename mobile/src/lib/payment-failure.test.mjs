import assert from 'node:assert/strict';
import test from 'node:test';

import {
  paymentBlock,
  paymentBlockText,
  paymentFailureCode,
  paymentFailureMessage,
} from './payment-failure.ts';

// The pay endpoint's own refusals, copied from backend order_service.go.
const KITCHEN_REFUSALS = [
  'all active order items must be completed by the kitchen before payment',
  'order must be completed by the kitchen before payment',
  'order must include a completed kitchen item before payment',
];

test('the pay endpoint wording a cashier can act on is recognised', () => {
  for (const raw of KITCHEN_REFUSALS) assert.equal(paymentFailureCode(raw), 'kitchen_not_done', raw);
  assert.equal(paymentFailureCode('received amount is less than grand total'), 'total_changed');
  assert.equal(paymentFailureCode('Network request failed'), 'offline');
  assert.equal(paymentFailureCode('Failed to fetch'), 'offline');
  assert.equal(paymentFailureCode('internal server error'), 'server_busy');
  assert.equal(paymentFailureCode('Service temporarily unavailable'), 'server_busy');
});

test('anything else is unknown, and unknown says nothing beyond the title', () => {
  assert.equal(paymentFailureCode('invalid payment method'), 'unknown');
  assert.equal(paymentFailureCode('received amount cannot be negative'), 'unknown');
  assert.equal(paymentFailureCode(''), 'unknown');
  assert.equal(paymentFailureCode(null), 'unknown');
  assert.equal(paymentFailureCode(undefined), 'unknown');
  assert.equal(paymentFailureMessage('unknown', 'th'), null);
  assert.equal(paymentFailureMessage('unknown', 'en'), null);
});

test('every mapped failure has its own Thai and English, and none echoes the server', () => {
  const inputs = [
    ...KITCHEN_REFUSALS,
    'received amount is less than grand total',
    'Network request failed',
    'internal server error',
  ];
  for (const raw of inputs) {
    const code = paymentFailureCode(raw);
    for (const language of ['th', 'en']) {
      const message = paymentFailureMessage(code, language);
      assert.ok(message, `${raw} (${language}) has no message`);
      assert.ok(!message.toLowerCase().includes(raw.toLowerCase()), `${raw} is echoed back`);
      assert.doesNotMatch(message, /grand total|before payment|request failed|server error/i);
    }
    assert.match(paymentFailureMessage(code, 'th'), /[ก-๙]/, `${raw} has no Thai`);
  }
});

const item = (status, quantity = 1) => ({ status, quantity });

test('a stale bill leads, whatever else is holding payment back', () => {
  assert.deepEqual(paymentBlock([item('cooking', 2)], true), { kind: 'stale' });
  assert.deepEqual(paymentBlock([item('served')], true), { kind: 'stale' });
});

test('unsent lines, then lines still cooking, counted in dishes', () => {
  assert.deepEqual(paymentBlock([item('pending', 2), item('cooking', 3), item('served')], false), { kind: 'unsent', quantity: 2 });
  assert.deepEqual(paymentBlock([item('cooking', 2), item('cooking', 1), item('ready')], false), { kind: 'kitchen', quantity: 3 });
});

test('a bill the kitchen has finished is not blocked, nor is an empty one', () => {
  assert.equal(paymentBlock([item('ready'), item('served', 4)], false), null);
  // The list itself says there is nothing to charge.
  assert.equal(paymentBlock([], false), null);
});

test('the block reads as one short line in either language', () => {
  assert.equal(paymentBlockText({ kind: 'stale' }, 'th'), 'ยอดยังไม่อัปเดต');
  assert.equal(paymentBlockText({ kind: 'stale' }, 'en'), 'Total not up to date');
  assert.equal(paymentBlockText({ kind: 'kitchen', quantity: 2 }, 'th'), 'ครัวยังทำไม่เสร็จ 2 รายการ');
  assert.equal(paymentBlockText({ kind: 'kitchen', quantity: 2 }, 'en'), '2 items still in the kitchen');
  assert.equal(paymentBlockText({ kind: 'kitchen', quantity: 1 }, 'en'), '1 item still in the kitchen');
  assert.equal(paymentBlockText({ kind: 'unsent', quantity: 3 }, 'th'), 'ยังไม่ส่งเข้าครัว 3 รายการ');
  assert.equal(paymentBlockText({ kind: 'unsent', quantity: 1 }, 'en'), '1 item not sent to the kitchen');
});
