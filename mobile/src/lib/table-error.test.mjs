import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bulkFailureLines,
  bulkResultTitle,
  TABLE_ACTIONS,
  tableFailure,
  tableFailureCode,
  tableFailureReason,
  tableLoadFailureLine,
} from './table-error.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(mobileRoot, '..');

/** What src/api/client.ts throws: the server's `error` as the message, the raw body as details. */
function apiError(message, status, code) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.status = status;
  error.url = 'http://example.invalid/api/v1/tables';
  error.details = JSON.stringify(code ? { error: message, code } : { error: message });
  return error;
}

/**
 * Every refusal the table-management endpoints can send, with the status the
 * controller sends it at, and what it must become.
 */
const SERVER_REFUSALS = [
  ['table has order history; mark it inactive instead', 409, 'delete', 'has_history'],
  ['table has an active reservation; cancel it first', 409, 'delete', 'has_reservation'],
  ['table has an open order', 400, 'save', 'has_open_order'],
  ['cannot delete a zone that still has tables', 409, 'zone_delete', 'zone_has_tables'],
  ['zone prefix is already used', 400, 'zone_save', 'prefix_taken'],
  ['zone prefix must be 8 characters or fewer', 400, 'zone_save', 'prefix_too_long'],
  ['zone name is required', 400, 'zone_save', 'name_required'],
  ['table zone not found', 400, 'add', 'zone_missing'],
  ['table zone not found', 400, 'save', 'zone_missing'],
  ['table zone not found', 400, 'move', 'zone_missing'],
  ['count must be between 1 and 200', 400, 'add', 'count_range'],
  ['capacity must be between 1 and 50', 400, 'add', 'capacity_range'],
  ['capacity must be between 1 and 50', 400, 'save', 'capacity_range'],
  ['could not find an unused table number', 400, 'add', 'no_free_number'],
  ['resource already exists', 409, 'zone_save', 'prefix_taken'],
  ['resource already exists', 409, 'add', 'label_clash'],
  ['resource already exists', 409, 'move', 'label_clash'],
  ['resource already exists', 409, 'zone_reorder', 'label_clash'],
  ['resource not found', 404, 'save', 'not_found'],
  ['resource not found', 404, 'delete', 'not_found'],
  ['resource not found', 404, 'regenerate', 'not_found'],
  ['resource not found', 404, 'move', 'not_found'],
  ['resource not found', 404, 'zone_save', 'zone_missing'],
  ['resource not found', 404, 'zone_delete', 'zone_missing'],
  ['resource not found', 404, 'zone_reorder', 'zone_missing'],
  ['missing manage_table permission', 403, 'add', 'forbidden'],
  ['missing table permission', 403, 'load', 'forbidden'],
  ['internal server error', 500, 'save', 'server_busy'],
  ['service temporarily unavailable', 503, 'load', 'server_busy'],
  ['table is in use', 409, 'save', 'table_in_use'],
  ['table is in use', 409, 'delete', 'table_in_use'],
  ['table is in use', 409, 'move', 'table_in_use'],
  ['table is in use', 409, 'regenerate', 'table_in_use'],
  ['table is in use', 409, 'zone_save', 'table_in_use'],
  ['invalid request', 400, 'add', 'unknown'],
  ['invalid table status', 400, 'save', 'unknown'],
  ['table status must be free or inactive', 400, 'save', 'unknown'],
];

test('every server refusal maps to its own code', () => {
  for (const [raw, status, action, code] of SERVER_REFUSALS) {
    assert.equal(tableFailureCode(apiError(raw, status), action), code, `${raw} (${status}) on ${action}`);
  }
});

test('the English the server sends never reaches the screen', () => {
  for (const [raw, status, action] of SERVER_REFUSALS) {
    const thai = tableFailure(apiError(raw, status), action);
    const shown = [thai.title, thai.message || ''].join(' ');
    assert.ok(!shown.toLowerCase().includes(raw.toLowerCase()), `${raw} leaked on ${action}: ${shown}`);
    assert.doesNotMatch(shown, /[A-Za-z]{3,}/, `English words on a Thai screen for ${raw}: ${shown}`);
    const english = tableFailure(apiError(raw, status), action, 'en');
    const said = [english.title, english.message || ''].join(' ').toLowerCase();
    assert.ok(!said.includes(raw.toLowerCase()), `${raw} leaked in English on ${action}: ${said}`);
  }
});

test('the lock refusal says the table is in use, whatever the status or wording', () => {
  const expected = { code: 'table_in_use', title: 'บันทึกไม่สำเร็จ', message: 'โต๊ะนี้กำลังใช้งาน', reload: 'plan' };
  assert.deepEqual(tableFailure(apiError('table is in use', 409), 'save'), expected);
  assert.deepEqual(tableFailure(apiError('Table is in use; close it first', 400), 'save'), expected);
  assert.deepEqual(tableFailure(apiError('something new', 409, 'table_in_use'), 'save'), expected, 'the code alone is enough');
  assert.deepEqual(tableFailure(apiError('this table is still in use', 409), 'save'), expected);
  assert.equal(tableFailure(apiError('table is in use', 409), 'delete').title, 'ลบไม่ได้');
  assert.equal(tableFailure(apiError('table is in use', 409), 'regenerate').title, 'สร้าง QR ใหม่ไม่สำเร็จ');
  // A plain 409 that is not about use keeps its own meaning.
  assert.equal(tableFailureCode(apiError('table has order history; mark it inactive instead', 409), 'delete'), 'has_history');
});

test('the lock refusal on a zone save is about the zone, not one table', () => {
  // A new prefix renumbers every table in the zone, so one table in service refuses it.
  assert.deepEqual(tableFailure(apiError('table is in use', 409), 'zone_save'), {
    code: 'table_in_use',
    title: 'บันทึกโซนไม่สำเร็จ',
    message: 'โซนนี้มีโต๊ะที่กำลังใช้งาน',
    reload: 'plan',
  });
  assert.equal(tableFailure(apiError('table is in use', 409), 'zone_save', 'en').message, 'A table in this zone is being served.');
});

test('each step has its own title, and an unknown failure says only that', () => {
  const titles = {
    load: 'โหลดผังโต๊ะไม่สำเร็จ',
    add: 'เพิ่มโต๊ะไม่สำเร็จ',
    save: 'บันทึกไม่สำเร็จ',
    delete: 'ลบไม่ได้',
    regenerate: 'สร้าง QR ใหม่ไม่สำเร็จ',
    zone_save: 'บันทึกโซนไม่สำเร็จ',
    zone_delete: 'ลบโซนไม่ได้',
    zone_reorder: 'จัดลำดับโซนไม่สำเร็จ',
    move: 'ย้ายโซนไม่สำเร็จ',
  };
  assert.deepEqual([...TABLE_ACTIONS].sort(), Object.keys(titles).sort());
  for (const [action, title] of Object.entries(titles)) {
    assert.deepEqual(tableFailure(apiError('something nobody mapped', 400), action), { code: 'unknown', title });
    assert.deepEqual(tableFailure(null, action), { code: 'unknown', title });
  }
});

test('the messages are the section\'s own words', () => {
  const said = (raw, status, action) => tableFailure(apiError(raw, status), action).message;
  assert.equal(said('table has order history; mark it inactive instead', 409, 'delete'), 'มีประวัติออเดอร์');
  assert.equal(said('table has an active reservation; cancel it first', 409, 'delete'), 'มีการจองอยู่ ยกเลิกการจองก่อน');
  assert.equal(said('table has an open order', 400, 'save'), 'มีออเดอร์เปิดอยู่');
  assert.equal(said('cannot delete a zone that still has tables', 409, 'zone_delete'), 'ยังมีโต๊ะในโซนนี้');
  assert.equal(said('zone prefix is already used', 400, 'zone_save'), 'คำนำหน้านี้ถูกใช้แล้ว');
  assert.equal(said('resource already exists', 409, 'add'), 'เลขโต๊ะซ้ำกับโต๊ะอื่น');
  assert.equal(said('table zone not found', 400, 'add'), 'ไม่พบโซนนี้แล้ว');
  assert.equal(said('could not find an unused table number', 400, 'add'), 'หาเลขโต๊ะว่างไม่ได้ เปลี่ยนคำนำหน้าของโซน');
  assert.equal(said('resource not found', 404, 'save'), 'โต๊ะนี้ถูกลบไปแล้ว');
  assert.equal(said('missing manage_table permission', 403, 'save'), 'บัญชีนี้แก้ไขโต๊ะไม่ได้');
  assert.equal(said('missing table permission', 403, 'load'), 'ไม่มีสิทธิ์ดูผังโต๊ะ');
  assert.equal(said('internal server error', 500, 'save'), 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง');
  assert.equal(said('zone name is required', 400, 'zone_save'), 'ใส่ชื่อโซน');
});

test('a dropped connection is offline in the auth screens\' words', () => {
  for (const error of [new TypeError('Network request failed'), new Error('Failed to fetch'), 'Network Error']) {
    assert.deepEqual(tableFailure(error, 'add'), {
      code: 'offline',
      title: 'เพิ่มโต๊ะไม่สำเร็จ',
      message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่',
    });
  }
  assert.equal(tableFailureCode(apiError('request timeout', 504), 'save'), 'server_busy');
  assert.equal(tableFailureCode({ status: 502 }, 'save'), 'server_busy');
});

test('field problems sit under their field, everything else is a toast', () => {
  assert.equal(tableFailure(apiError('zone prefix is already used', 400), 'zone_save').field, 'prefix');
  assert.equal(tableFailure(apiError('resource already exists', 409), 'zone_save').field, 'prefix');
  assert.equal(tableFailure(apiError('zone prefix must be 8 characters or fewer', 400), 'zone_save').field, 'prefix');
  assert.equal(tableFailure(apiError('zone name is required', 400), 'zone_save').field, 'name');
  assert.equal(tableFailure(apiError('resource already exists', 409), 'add').field, undefined);
  assert.equal(tableFailure(apiError('table has an open order', 400), 'save').field, undefined);
});

test('refusals that mean the screen is stale ask for a reload, and history offers closing instead', () => {
  const reload = (raw, status, action) => tableFailure(apiError(raw, status), action).reload;
  assert.equal(reload('table zone not found', 400, 'add'), 'plan');
  assert.equal(reload('resource already exists', 409, 'add'), 'plan');
  assert.equal(reload('table is in use', 409, 'save'), 'plan');
  assert.equal(reload('table has an open order', 400, 'save'), 'plan');
  assert.equal(reload('table has an active reservation; cancel it first', 409, 'delete'), 'plan');
  assert.equal(reload('cannot delete a zone that still has tables', 409, 'zone_delete'), 'plan');
  assert.equal(reload('resource not found', 404, 'delete'), 'plan');
  assert.equal(reload('missing manage_table permission', 403, 'save'), 'membership');
  assert.equal(reload('zone prefix is already used', 400, 'zone_save'), undefined);
  assert.equal(reload('internal server error', 500, 'save'), undefined);

  assert.equal(tableFailure(apiError('table has order history; mark it inactive instead', 409), 'delete').offerDeactivate, true);
  assert.equal(tableFailure(apiError('table has an active reservation; cancel it first', 409), 'delete').offerDeactivate, undefined);
});

test('a first load that failed says one line', () => {
  assert.equal(tableLoadFailureLine(new TypeError('Network request failed')), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  assert.equal(tableLoadFailureLine(apiError('missing table permission', 403)), 'ไม่มีสิทธิ์ดูผังโต๊ะ');
  assert.equal(tableLoadFailureLine(apiError('internal server error', 500)), 'โหลดผังโต๊ะไม่สำเร็จ');
  assert.equal(tableLoadFailureLine(null, 'en'), 'Could not load the tables');
  assert.equal(tableLoadFailureLine(new TypeError('Network request failed'), 'en'), 'Cannot reach the server');
});

test('a partial bulk result counts what went through and names what did not', () => {
  assert.equal(bulkResultTitle('close', 3, 5), 'ปิดได้ 3 จาก 5 โต๊ะ');
  assert.equal(bulkResultTitle('open', 2, 4), 'เปิดได้ 2 จาก 4 โต๊ะ');
  assert.equal(bulkResultTitle('move', 4, 5), 'ย้ายได้ 4 จาก 5 โต๊ะ');
  assert.equal(bulkResultTitle('delete', 3, 5), 'ลบได้ 3 จาก 5 โต๊ะ');
  assert.equal(bulkResultTitle('seats', 1, 2), 'ตั้งที่นั่งได้ 1 จาก 2 โต๊ะ');
  assert.equal(bulkResultTitle('move', 4, 5, 'en'), 'Moved 4 of 5 tables');

  assert.equal(
    bulkFailureLines([
      { label: 'T2', reason: tableFailureReason('has_history') },
      { label: 'T3', reason: tableFailureReason('has_history') },
    ]),
    'T2, T3 มีประวัติออเดอร์',
  );
  assert.equal(
    bulkFailureLines([
      { label: 'T3', reason: 'กำลังใช้งาน' },
      { label: 'T7', reason: 'จอง' },
    ]),
    'T3 กำลังใช้งาน, T7 จอง',
  );
  assert.equal(bulkFailureLines([{ label: 'T7', reason: tableFailureReason('label_clash') }]), 'T7 เลขซ้ำกับโต๊ะอื่น');
  assert.equal(bulkFailureLines([]), '');
});

test('every per-table reason is short Thai', () => {
  for (const code of [
    'table_in_use', 'has_history', 'has_reservation', 'has_open_order', 'zone_has_tables', 'prefix_taken',
    'prefix_too_long', 'name_required', 'label_clash', 'zone_missing', 'no_free_number', 'count_range',
    'capacity_range', 'not_found', 'forbidden', 'offline', 'server_busy', 'unknown',
  ]) {
    const reason = tableFailureReason(code);
    assert.ok(reason.length > 0 && reason.length <= 24, `${code}: ${reason}`);
    assert.doesNotMatch(reason, /[A-Za-z]{3,}/);
    assert.ok(tableFailureReason(code, 'en').length > 0);
  }
  assert.equal(tableFailureReason('table_in_use'), 'กำลังใช้งาน');
});

test('the server still says every refusal this map recognises', async () => {
  const sources = await Promise.all([
    path.join(repoRoot, 'backend', 'internal', 'service', 'table_service.go'),
    path.join(repoRoot, 'backend', 'internal', 'service', 'table_service_helpers.go'),
    path.join(repoRoot, 'backend', 'internal', 'controller', 'errors.go'),
    path.join(repoRoot, 'backend', 'internal', 'controller', 'table.go'),
  ].map((file) => readFile(file, 'utf8')));
  const backend = sources.join('\n');
  const mapped = new Set(
    SERVER_REFUSALS
      .filter(([, , , code]) => code !== 'unknown')
      .map(([raw]) => raw),
  );
  for (const raw of mapped) {
    assert.ok(backend.includes(`"${raw}"`), `the backend no longer says "${raw}"; update table-error.ts`);
  }
});

test('the lock refusal is the fixed text the server answers with 409', async () => {
  const [service, controller] = await Promise.all([
    readFile(path.join(repoRoot, 'backend', 'internal', 'service', 'table_service.go'), 'utf8'),
    readFile(path.join(repoRoot, 'backend', 'internal', 'controller', 'table.go'), 'utf8'),
  ]);
  assert.match(service, /var ErrTableInUse = errors\.New\("table is in use"\)/);
  assert.match(
    controller,
    /if errors\.Is\(err, service\.ErrTableInUse\) \{\s*return http\.StatusConflict\s*\}/,
    'the controller no longer answers the lock with 409',
  );
});
