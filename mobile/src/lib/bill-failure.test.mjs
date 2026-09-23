import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { billActionFailureCode, billActionFailureMessage } from './bill-failure.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the API refusals staff can act on map to their own outcome', () => {
  assert.equal(billActionFailureCode(new Error('cannot send a closed order to kitchen')), 'order_closed');
  assert.equal(billActionFailureCode(new Error('cannot edit item on a closed order')), 'order_closed');
  assert.equal(billActionFailureCode(new Error('order is already closed')), 'order_closed');
  assert.equal(billActionFailureCode(new Error('no pending items to send')), 'nothing_to_send');
  assert.equal(billActionFailureCode(new Error('only pending items can be edited')), 'already_sent');
  assert.equal(billActionFailureCode(new Error('order item status transition is forbidden')), 'already_sent');
  assert.equal(billActionFailureCode(new Error('menu item is unavailable')), 'sold_out');
  assert.equal(billActionFailureCode(new Error('menu recipe contains an unavailable ingredient')), 'sold_out');
  assert.equal(billActionFailureCode(new Error('order not found')), 'gone');
});

test('the network and a struggling server read as they do at payment', () => {
  assert.equal(billActionFailureCode(new TypeError('Network request failed')), 'offline');
  assert.equal(billActionFailureCode(new Error('internal server error')), 'server_busy');
});

test('anything else says nothing beyond the step that failed', () => {
  assert.equal(billActionFailureCode(new Error('something new the server says')), 'unknown');
  assert.equal(billActionFailureCode(null), 'unknown');
  assert.equal(billActionFailureCode({ message: 'not an Error' }), 'unknown');
  assert.equal(billActionFailureMessage(new Error('something new the server says'), 'th'), null);
});

test('the mapped words are the app\'s own, in both languages', () => {
  assert.equal(billActionFailureMessage(new Error('no pending items to send'), 'th'), 'ไม่มีรายการรอส่งครัว');
  assert.equal(billActionFailureMessage(new Error('no pending items to send'), 'en'), 'Nothing is waiting to go to the kitchen');
  const thai = billActionFailureMessage(new Error('cannot send a closed order to kitchen'), 'th');
  assert.doesNotMatch(thai, /closed order/);
});

test('the bill never shows the server wording: err.message only feeds the payment mapper', async () => {
  const bill = await readFile(path.join(mobileRoot, 'app', 'order', 'bill.tsx'), 'utf8');
  const uses = bill.match(/\berr\.message\b/g) ?? [];
  assert.equal(uses.length, 1, 'err.message is read once, by paymentFailureCode');
  assert.match(bill, /paymentFailureCode\(err instanceof Error \? err\.message : ''\)/);
  assert.equal((bill.match(/billActionFailureMessage\(err, language\)/g) ?? []).length, 5, 'load, refresh, send, delete and remove all map their failure');
});
