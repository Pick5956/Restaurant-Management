import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatPhone,
  itemStatusLabel,
  money,
  orderStatusLabel,
  tableStatusLabel,
} from './format.ts';

test('formats shared operational labels in the selected display language', () => {
  assert.equal(tableStatusLabel('reserved', 'th'), 'จอง');
  assert.equal(tableStatusLabel('reserved', 'en'), 'Reserved');
  assert.equal(orderStatusLabel('sent_to_kitchen', 'en'), 'Sent to kitchen');
  assert.equal(itemStatusLabel('ready', 'en'), 'Kitchen done');
});

test('formats currency with the selected locale while preserving baht', () => {
  assert.equal(money(1234, 'en'), '฿1,234');
  assert.equal(money(1234, 'th'), '฿1,234');
});

test('a phone number is shown in Thai dashed groups, and left alone when it is not a Thai number', () => {
  assert.equal(formatPhone('0800000000'), '080-000-0000');
  assert.equal(formatPhone('080 000 0000'), '080-000-0000');
  assert.equal(formatPhone('+66800000000'), '080-000-0000');
  assert.equal(formatPhone('021234567'), '02-123-4567');
  assert.equal(formatPhone('5550001234'), '555-000-1234');
  assert.equal(formatPhone('080000000012'), '080000000012');
  assert.equal(formatPhone(''), '');
  assert.equal(formatPhone(undefined), '');
});
