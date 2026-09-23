import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORY_ACTIONS,
  categoryActionTitle,
  categoryFailure,
  categoryFailureCode,
  categoryInUseMessage,
  categoryLoadLine,
  categoryNameMessage,
} from './category-error.ts';

/** What src/api/client.ts throws: the server's `error` as the message, the raw body as details. */
function apiError(message, status, code) {
  const error = new Error(message);
  error.name = 'ApiError';
  error.status = status;
  error.url = 'http://example.invalid/api/v1/categories';
  error.details = JSON.stringify(code ? { error: message, code } : { error: message });
  return error;
}

/** Every refusal the category endpoints send, at the status the controller uses. */
const SERVER_REFUSALS = [
  ['category name already exists', 409, 'CATEGORY_NAME_EXISTS', 'name_taken'],
  ['resource already exists', 409, 'conflict', 'name_taken'],
  ['category name is required', 400, 'invalid_request', 'name_required'],
  ['category name is too long', 400, 'invalid_request', 'name_too_long'],
  ['category is still used by menu items', 409, 'conflict', 'in_use'],
  ['resource not found', 404, 'not_found', 'not_found'],
  ['missing manage_menu permission', 403, 'forbidden', 'forbidden'],
  ['missing menu permission', 403, 'forbidden', 'forbidden'],
  ['internal server error', 500, 'internal_error', 'server_busy'],
  ['service temporarily unavailable', 503, 'service_unavailable', 'server_busy'],
  ['invalid request', 400, 'invalid_request', 'unknown'],
];

test('every server refusal maps to its own code', () => {
  for (const [raw, status, code, expected] of SERVER_REFUSALS) {
    assert.equal(categoryFailureCode(apiError(raw, status, code)), expected, `${raw} (${status})`);
  }
});

test('the name clash is read from the body code even when the words change', () => {
  assert.equal(categoryFailureCode(apiError('duplicate', 409, 'CATEGORY_NAME_EXISTS')), 'name_taken');
});

test('a dropped connection and an unknown failure are told apart', () => {
  assert.equal(categoryFailureCode(new TypeError('Network request failed')), 'offline');
  assert.equal(categoryFailureCode(new Error('Failed to fetch')), 'offline');
  assert.equal(categoryFailureCode(new Error('something odd')), 'unknown');
  assert.equal(categoryFailureCode(null), 'unknown');
  assert.equal(categoryFailureCode('oops'), 'unknown');
});

test('a name problem on add or save goes under the name field', () => {
  const taken = categoryFailure(apiError('category name already exists', 409, 'CATEGORY_NAME_EXISTS'), 'add', 'th');
  assert.deepEqual(taken, { code: 'name_taken', title: 'เพิ่มหมวดไม่สำเร็จ', message: 'มีหมวดชื่อนี้แล้ว', field: 'name' });
  const long = categoryFailure(apiError('category name is too long', 400), 'save', 'en');
  assert.deepEqual(long, { code: 'name_too_long', title: 'Could not save the category', message: 'That name is too long.', field: 'name' });
});

test('a name clash during a reorder has no field and reloads the list', () => {
  const failure = categoryFailure(apiError('category name already exists', 409, 'CATEGORY_NAME_EXISTS'), 'reorder', 'th');
  assert.deepEqual(failure, { code: 'name_taken', title: 'จัดลำดับหมวดไม่สำเร็จ', message: 'มีหมวดชื่อซ้ำกัน', reload: 'list' });
});

test('a category that still has dishes is refused in Thai and the counts reload', () => {
  const failure = categoryFailure(apiError('category is still used by menu items', 409, 'conflict'), 'delete', 'th');
  assert.deepEqual(failure, { code: 'in_use', title: 'ลบหมวดไม่ได้', message: 'ยังมีเมนูในหมวดนี้', reload: 'list' });
});

test('a category deleted elsewhere reloads the list', () => {
  for (const action of ['save', 'delete', 'reorder']) {
    const failure = categoryFailure(apiError('resource not found', 404, 'not_found'), action, 'th');
    assert.equal(failure.code, 'not_found');
    assert.equal(failure.message, 'หมวดนี้ถูกลบไปแล้ว');
    assert.equal(failure.reload, 'list');
  }
});

test('a lost permission reloads the membership', () => {
  const edit = categoryFailure(apiError('missing manage_menu permission', 403, 'forbidden'), 'save', 'th');
  assert.deepEqual(edit, { code: 'forbidden', title: 'บันทึกหมวดไม่สำเร็จ', message: 'บัญชีนี้แก้ไขหมวดเมนูไม่ได้', reload: 'membership' });
  const view = categoryFailure(apiError('missing menu permission', 403, 'forbidden'), 'load', 'en');
  assert.equal(view.message, 'This account cannot view the categories.');
});

test('offline and a busy server say so; an unknown failure says only the step', () => {
  assert.equal(categoryFailure(new TypeError('Network request failed'), 'add', 'th').message, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  assert.equal(categoryFailure(apiError('internal server error', 500), 'delete', 'th').message, 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง');
  assert.deepEqual(categoryFailure(apiError('invalid request', 400), 'save', 'th'), { code: 'unknown', title: 'บันทึกหมวดไม่สำเร็จ' });
});

test('a failed reorder always reloads, whatever the reason', () => {
  assert.equal(categoryFailure(new Error('something odd'), 'reorder', 'th').reload, 'list');
  assert.equal(categoryFailure(new TypeError('Network request failed'), 'reorder', 'th').reload, 'list');
});

test('every step has a title in both languages', () => {
  for (const action of CATEGORY_ACTIONS) {
    assert.ok(categoryFailure(null, action, 'th').title.length > 0);
    assert.ok(categoryFailure(null, action, 'en').title.length > 0);
  }
});

test('the English the server sends never reaches the screen', () => {
  for (const [raw, status, code] of SERVER_REFUSALS) {
    for (const action of CATEGORY_ACTIONS) {
      for (const language of ['th', 'en']) {
        const failure = categoryFailure(apiError(raw, status, code), action, language);
        const shown = `${failure.title} ${failure.message ?? ''}`.toLowerCase();
        assert.equal(shown.includes(raw.toLowerCase()), false, `${raw} leaked on ${action} (${language})`);
      }
    }
  }
});

test('a failed first load names the cause in one line', () => {
  assert.equal(categoryLoadLine(new TypeError('Network request failed'), 'th'), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
  assert.equal(categoryLoadLine(apiError('missing menu permission', 403), 'th'), 'ไม่มีสิทธิ์ดูหมวดเมนู');
  assert.equal(categoryLoadLine(apiError('internal server error', 500), 'th'), 'โหลดหมวดเมนูไม่สำเร็จ');
  assert.equal(categoryLoadLine(apiError('internal server error', 500), 'en'), 'Could not load the categories');
});

test('the name field words match the server refusals they stand in for', () => {
  assert.equal(categoryNameMessage('name_required', 'th'), 'ใส่ชื่อหมวด');
  assert.equal(categoryNameMessage('name_too_long', 'th'), 'ชื่อยาวเกินไป');
  assert.equal(categoryNameMessage('name_taken', 'th'), 'มีหมวดชื่อนี้แล้ว');
  assert.equal(categoryNameMessage('name_taken', 'en'), 'That name is taken.');
});

test('a delete stopped before the request says how many dishes are left', () => {
  assert.equal(categoryActionTitle('delete', 'th'), 'ลบหมวดไม่ได้');
  assert.equal(categoryActionTitle('delete', 'en'), 'Could not delete the category');
  assert.equal(categoryInUseMessage(3, 'th'), 'ยังมี 3 เมนูในหมวดนี้');
  assert.equal(categoryInUseMessage(1, 'en'), '1 dish is still in it.');
  assert.equal(categoryInUseMessage(1500, 'en'), '1,500 dishes are still in it.');
});
