import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESERVATION_ACTIONS,
  reservationFailure,
  reservationFailureCode,
  reservationLoadFailureLine,
} from './reservation-error.ts';

/** What src/api/client.ts throws: the server's `error` as the message, the raw body as details. */
function apiError(message, status) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.status = status;
  error.url = 'http://example.invalid/api/v1/reservations/7/resolve';
  error.details = JSON.stringify({ error: message });
  return error;
}

/**
 * Every refusal the resolve and open-order endpoints send for this screen,
 * with its status, the step it comes from, and what it must become.
 */
const SERVER_REFUSALS = [
  ['reservation is already resolved', 400, 'cancel', 'already_resolved', 'รายการนี้ถูกปิดไปแล้ว', true],
  ['reservation not found', 400, 'arrive', 'not_found', 'ไม่พบรายการจองนี้', true],
  ['reservation changed while it was being resolved', 400, 'cancel', 'changed', 'รายการนี้เพิ่งเปลี่ยน ลองอีกครั้ง', true],
  ['table has no active reservation', 400, 'seat_hold', 'no_active_reservation', 'โต๊ะนี้ไม่มีการจองแล้ว', true],
  ['table already has an open order', 400, 'seat_hold', 'open_order', 'โต๊ะนี้มีออเดอร์เปิดอยู่', true],
  ['table is inactive', 400, 'seat_hold', 'table_inactive', 'โต๊ะนี้ปิดใช้งานอยู่', false],
  ['table not found', 400, 'seat_hold', 'table_missing', 'ไม่พบโต๊ะนี้แล้ว', true],
  ['missing reservation permission', 403, 'cancel', 'forbidden', 'บัญชีนี้ทำรายการจองไม่ได้', false],
  ['missing take_order permission', 403, 'seat_hold', 'forbidden', 'บัญชีนี้เปิดออเดอร์ไม่ได้', false],
  ['resource not found', 404, 'cancel', 'not_found', 'ไม่พบรายการจองนี้', true],
  ['resource not found', 404, 'seat_hold', 'table_missing', 'ไม่พบโต๊ะนี้แล้ว', true],
  ['internal server error', 500, 'arrive', 'server_busy', 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', false],
  ['service temporarily unavailable', 503, 'cancel', 'server_busy', 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', false],
];

test('every server refusal maps to the app\'s own words, and says when the list is stale', () => {
  for (const [message, status, action, code, thai, reload] of SERVER_REFUSALS) {
    const err = apiError(message, status);
    assert.equal(reservationFailureCode(err, action), code, message);
    const failure = reservationFailure(err, action, 'th');
    assert.equal(failure.code, code, message);
    assert.equal(failure.message, thai, message);
    assert.equal(failure.reload === true, reload, `${message}: reload`);
    const english = reservationFailure(err, action, 'en');
    assert.ok(english.message && english.message.length > 0, `${message}: english message`);
  }
});

test('no output ever carries the server\'s English', () => {
  const raw = [
    ...SERVER_REFUSALS.map(([message, status]) => apiError(message, status)),
    apiError('something the server has never said before', 400),
    new TypeError('Network request failed'),
  ];
  for (const err of raw) {
    const said = err.message.toLowerCase();
    for (const action of RESERVATION_ACTIONS) {
      for (const language of ['th', 'en']) {
        const failure = reservationFailure(err, action, language);
        for (const text of [failure.title, failure.message ?? '']) {
          assert.ok(!text.toLowerCase().includes(said), `${action}/${language} leaked "${err.message}"`);
        }
      }
      for (const language of ['th', 'en']) {
        assert.ok(!reservationLoadFailureLine(err, language).toLowerCase().includes(said));
      }
    }
  }
});

test('each step names itself in the title', () => {
  const err = apiError('reservation is already resolved', 400);
  assert.equal(reservationFailure(err, 'cancel', 'th').title, 'ยกเลิกการจองไม่สำเร็จ');
  assert.equal(reservationFailure(err, 'arrive', 'th').title, 'รับลูกค้าไม่สำเร็จ');
  assert.equal(reservationFailure(err, 'seat_hold', 'th').title, 'รับลูกค้าและเปิดออเดอร์ไม่สำเร็จ');
  assert.equal(reservationFailure(err, 'load', 'th').title, 'โหลดประวัติการจองไม่สำเร็จ');
  assert.equal(reservationFailure(err, 'load_more', 'th').title, 'โหลดการจองเพิ่มเติมไม่สำเร็จ');
  assert.equal(reservationFailure(err, 'cancel', 'en').title, 'Could not cancel the reservation');
  assert.equal(reservationFailure(err, 'seat_hold', 'en').title, 'Could not seat the guests and open an order');
});

test('an unknown failure is the title alone, with no reload', () => {
  for (const err of [apiError('something new', 400), null, undefined, 'plain string', 42, {}]) {
    const failure = reservationFailure(err, 'cancel', 'th');
    assert.equal(failure.code, 'unknown');
    assert.equal(failure.message, undefined);
    assert.equal(failure.reload, undefined);
  }
});

test('offline is recognised from the fetch failure, whatever the step', () => {
  const err = new TypeError('Network request failed');
  for (const action of RESERVATION_ACTIONS) {
    const failure = reservationFailure(err, action, 'th');
    assert.equal(failure.code, 'offline');
    assert.equal(failure.message, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
    assert.equal(failure.reload, undefined);
  }
});

test('reading the list never asks to reload itself', () => {
  const err = apiError('reservation not found', 400);
  assert.equal(reservationFailure(err, 'load', 'th').reload, undefined);
  assert.equal(reservationFailure(err, 'load_more', 'th').reload, undefined);
  assert.equal(reservationFailure(err, 'load_more', 'th').message, undefined);
});

test('the failed-load line names the cause a person can act on', () => {
  assert.equal(reservationLoadFailureLine(new TypeError('Network request failed'), 'th'), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  assert.equal(reservationLoadFailureLine(apiError('missing reservation permission', 403), 'th'), 'ไม่มีสิทธิ์ดูประวัติการจอง');
  assert.equal(reservationLoadFailureLine(apiError('internal server error', 500), 'th'), 'โหลดประวัติการจองไม่สำเร็จ');
  assert.equal(reservationLoadFailureLine(apiError('internal server error', 500), 'en'), 'Could not load reservation history');
  assert.equal(reservationLoadFailureLine(null, 'en'), 'Could not load reservation history');
});
