import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeOpenTableFailure,
  OPEN_TABLE_ACTIONS,
  openTableFailure,
  openTableFailureCode,
  openTableIssueLine,
  openTableIssueRetries,
} from './open-table-error.ts';

/** What src/api/client.ts throws: the server's `error` as the message, the raw body as details. */
function apiError(message, status, code) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.status = status;
  error.url = 'http://example.invalid/api/v1/orders';
  error.details = JSON.stringify(code ? { error: message, code } : { error: message });
  return error;
}

// Every refusal the order and table services give on this screen's three
// calls, as the controller sends it (see backend/internal/controller/errors.go).
const REFUSALS = [
  ['table already has an open order', 400, 'open', 'open_order_exists'],
  ['table has an open order', 400, 'reserve', 'open_order_exists'],
  ['table is reserved', 400, 'open', 'table_reserved'],
  ['table is not free', 400, 'reserve', 'not_free'],
  ['table is inactive', 400, 'open', 'inactive'],
  ['table is inactive', 400, 'reserve', 'inactive'],
  ['table not found', 400, 'open', 'not_found'],
  ['resource not found', 404, 'reserve', 'not_found'],
  ['table is already booked for that time', 400, 'reserve', 'slot_taken'],
  ['resource already exists', 409, 'reserve', 'slot_taken'],
  ['resource already exists', 409, 'open', 'open_order_exists'],
  ['resource already exists', 409, 'takeaway', 'unknown'],
  ['reservation phone is required', 400, 'reserve', 'phone_invalid'],
  ['missing take_order permission', 403, 'open', 'forbidden'],
  ['missing table status permission', 403, 'reserve', 'forbidden'],
  ['Network request failed', null, 'load', 'offline'],
  ['internal server error', 500, 'open', 'server_busy'],
  ['service temporarily unavailable', 503, 'reserve', 'server_busy'],
  ['invalid request', 400, 'open', 'unknown'],
  ['invalid order type', 400, 'takeaway', 'unknown'],
];

test('each refusal maps to one code a waiter can act on', () => {
  for (const [message, status, action, expected] of REFUSALS) {
    assert.equal(openTableFailureCode(apiError(message, status), action), expected, `${action}: ${message}`);
  }
});

test('nothing the server said reaches the words on screen', () => {
  for (const language of ['th', 'en']) {
    for (const [message, status, action] of REFUSALS) {
      const failure = openTableFailure(apiError(message, status), action, language);
      const shown = `${failure.title} ${failure.message ?? ''}`.toLowerCase();
      assert.ok(!shown.includes(message.toLowerCase()), `${language} ${action}: "${message}" leaked into "${shown}"`);
    }
  }
});

test('each step is named in the title, in the chosen language', () => {
  assert.equal(openTableFailure(null, 'load', 'th').title, 'โหลดข้อมูลโต๊ะไม่สำเร็จ');
  assert.equal(openTableFailure(null, 'open', 'th').title, 'เปิดออเดอร์ไม่สำเร็จ');
  assert.equal(openTableFailure(null, 'takeaway', 'th').title, 'เปิดออเดอร์ไม่สำเร็จ');
  assert.equal(openTableFailure(null, 'reserve', 'th').title, 'จองโต๊ะไม่สำเร็จ');
  assert.equal(openTableFailure(null, 'reserve', 'en').title, 'Could not reserve the table');
  for (const action of OPEN_TABLE_ACTIONS) {
    assert.ok(openTableFailure(null, action, 'en').title.startsWith('Could not'));
  }
});

test('an unknown refusal gives the title and nothing vague after it', () => {
  const failure = openTableFailure(apiError('invalid request', 400, 'invalid_request'), 'open', 'th');
  assert.deepEqual(failure, { code: 'unknown', title: 'เปิดออเดอร์ไม่สำเร็จ' });
  assert.deepEqual(openTableFailure(undefined, 'reserve', 'en'), { code: 'unknown', title: 'Could not reserve the table' });
  assert.deepEqual(openTableFailure('something odd', 'load', 'th'), { code: 'unknown', title: 'โหลดข้อมูลโต๊ะไม่สำเร็จ' });
});

test('a phone or time problem goes under its field instead of a toast', () => {
  const phone = openTableFailure(apiError('reservation phone is required', 400), 'reserve', 'th');
  assert.equal(phone.field, 'phone');
  assert.equal(phone.message, 'กรอกเบอร์โทรอย่างน้อย 9 หลัก');

  const time = openTableFailure(apiError('table is already booked for that time', 400), 'reserve', 'th');
  assert.equal(time.field, 'time');
  assert.equal(time.message, 'เวลานี้มีคนจองโต๊ะนี้แล้ว');

  // A duplicate booking the unique index caught is the same problem as the
  // service's own check: the slot is taken.
  assert.equal(openTableFailure(apiError('resource already exists', 409, 'conflict'), 'reserve', 'en').field, 'time');

  for (const [message, status, action] of REFUSALS) {
    const failure = openTableFailure(apiError(message, status), action, 'th');
    if (failure.code !== 'phone_invalid' && failure.code !== 'slot_taken') {
      assert.equal(failure.field, undefined, `${action}: ${message}`);
    }
  }
});

test('a table that changed under the screen asks for a reload', () => {
  for (const code of ['open_order_exists', 'table_reserved', 'not_free', 'inactive', 'not_found']) {
    assert.equal(describeOpenTableFailure(code, 'open', 'th').stale, true, code);
  }
  for (const code of ['slot_taken', 'phone_invalid', 'forbidden', 'offline', 'server_busy', 'unknown']) {
    assert.equal(describeOpenTableFailure(code, 'open', 'th').stale, undefined, code);
  }
});

test('a missing permission says which thing the account cannot do', () => {
  assert.equal(openTableFailure(apiError('missing take_order permission', 403), 'open', 'th').message, 'บัญชีนี้ไม่มีสิทธิ์รับออเดอร์');
  assert.equal(openTableFailure(apiError('missing table status permission', 403), 'reserve', 'th').message, 'บัญชีนี้จองโต๊ะไม่ได้');
  assert.equal(openTableFailure(apiError('forbidden', 403), 'load', 'en').message, 'This account cannot view tables.');
});

test('the code is read from the error body when the message says nothing', () => {
  assert.equal(openTableFailureCode(apiError('Forbidden', 403, 'forbidden'), 'open'), 'forbidden');
  assert.equal(openTableFailureCode(apiError('oops', 418, 'internal_error'), 'open'), 'server_busy');
});

test('the dine-in form names what it is missing instead of going blank', () => {
  assert.equal(openTableIssueLine('no_table', null, 'th'), 'ยังไม่ได้เลือกโต๊ะ');
  assert.equal(openTableIssueLine('missing', null, 'th'), 'ไม่พบโต๊ะนี้');
  assert.equal(openTableIssueLine('failed', 'server_busy', 'th'), 'โหลดข้อมูลโต๊ะไม่สำเร็จ');
  assert.equal(openTableIssueLine('failed', 'unknown', 'en'), 'Could not load the table');
  assert.equal(openTableIssueLine('failed', 'offline', 'th'), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  assert.equal(openTableIssueLine('failed', 'forbidden', 'th'), 'บัญชีนี้ดูโต๊ะไม่ได้');

  // Retrying helps a failed load, but not a missing permission or a table
  // that is not there.
  assert.equal(openTableIssueRetries('failed', 'offline'), true);
  assert.equal(openTableIssueRetries('failed', 'unknown'), true);
  assert.equal(openTableIssueRetries('failed', 'forbidden'), false);
  assert.equal(openTableIssueRetries('missing', null), false);
  assert.equal(openTableIssueRetries('no_table', null), false);
});

test('no line joins values with a middle dot', () => {
  for (const language of ['th', 'en']) {
    for (const [message, status, action] of REFUSALS) {
      const failure = openTableFailure(apiError(message, status), action, language);
      assert.ok(!`${failure.title}${failure.message ?? ''}`.includes('·'));
    }
  }
});
