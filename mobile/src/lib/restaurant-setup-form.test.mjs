import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLOCK_PATTERN,
  DEFAULT_TABLE_COUNT,
  PHONE_MIN_DIGITS,
  TABLE_COUNT_RANGE,
  contactSummary,
  firstSetupProblem,
  isClock,
  normalizeClockInput,
  phoneDigits,
  restaurantSetupFailureCode,
  restaurantSetupFailureToast,
  setupFieldMessage,
  setupProblemsForFailure,
  setupFieldProblems,
} from './restaurant-setup-form.ts';

// The server's own limits (sanitizeRestaurantFields). If the backend moves,
// these move with it; the form must never be stricter or looser than the API.
test('the limits mirror the backend', () => {
  assert.deepEqual(TABLE_COUNT_RANGE, { min: 1, max: 500 });
  assert.equal(DEFAULT_TABLE_COUNT, 12);
  assert.equal(PHONE_MIN_DIGITS, 9);
  assert.equal(String(CLOCK_PATTERN), String(/^([01]\d|2[0-3]):[0-5]\d$/));
});

test('a time typed on a number pad becomes HH:mm', () => {
  assert.equal(normalizeClockInput('9:00'), '09:00');
  assert.equal(normalizeClockInput('930'), '09:30');
  assert.equal(normalizeClockInput('0930'), '09:30');
  assert.equal(normalizeClockInput('9.30'), '09:30');
  assert.equal(normalizeClockInput(' 2200 '), '22:00');
  assert.equal(normalizeClockInput('22'), '22:00');
  assert.equal(normalizeClockInput('9'), '09:00');
  assert.equal(normalizeClockInput('10:00'), '10:00');
  assert.equal(normalizeClockInput('00:00'), '00:00');
});

test('a time that is not one stays as typed, so the field can say so', () => {
  assert.equal(normalizeClockInput('25:00'), '25:00');
  assert.equal(normalizeClockInput('24:00'), '24:00');
  assert.equal(normalizeClockInput('10:60'), '10:60');
  assert.equal(normalizeClockInput('ab'), 'ab');
  assert.equal(normalizeClockInput('9:0'), '9:0');
  assert.equal(normalizeClockInput(''), '');
  assert.equal(normalizeClockInput('   '), '');
});

test('isClock accepts exactly what the backend accepts', () => {
  for (const good of ['00:00', '09:30', '23:59', '12:00']) assert.equal(isClock(good), true, good);
  for (const bad of ['9:00', '24:00', '23:60', '0930', '', '10:00 ']) assert.equal(isClock(bad), false, bad);
});

test('phone digits ignore spaces, dashes and the plus sign', () => {
  assert.equal(phoneDigits('080-000-0000'), 10);
  assert.equal(phoneDigits('+66 80 000 0000'), 11);
  assert.equal(phoneDigits('02 000'), 5);
  assert.equal(phoneDigits(''), 0);
});

const valid = { name: 'ร้านตัวอย่าง', open: '10:00', close: '22:00', tables: '12', phone: '' };

test('a filled form has no problems', () => {
  assert.deepEqual(setupFieldProblems(valid), {});
  assert.deepEqual(setupFieldProblems({ ...valid, phone: '080-000-0000' }), {});
  assert.deepEqual(setupFieldProblems({ ...valid, open: '9:00', close: '2130' }), {});
});

test('blank times and a blank count are left to their defaults', () => {
  assert.deepEqual(setupFieldProblems({ ...valid, open: '', close: ' ', tables: '' }), {});
});

test('each problem is named under its own field', () => {
  assert.deepEqual(setupFieldProblems({ ...valid, name: '   ' }), { name: 'required' });
  assert.deepEqual(setupFieldProblems({ ...valid, phone: '080-000' }), { phone: 'short' });
  assert.deepEqual(setupFieldProblems({ ...valid, open: '25:00' }), { open: 'invalid' });
  assert.deepEqual(setupFieldProblems({ ...valid, close: 'ab' }), { close: 'invalid' });
  for (const tables of ['0', '501', '999', '-5', '1.5', 'x']) {
    assert.deepEqual(setupFieldProblems({ ...valid, tables }), { tables: 'range' }, tables);
  }
  for (const tables of ['1', '500', '12']) {
    assert.deepEqual(setupFieldProblems({ ...valid, tables }), {}, tables);
  }
});

test('the first problem in screen order takes focus', () => {
  assert.equal(firstSetupProblem({}), null);
  assert.equal(firstSetupProblem({ tables: 'range', name: 'required' }), 'name');
  assert.equal(firstSetupProblem({ tables: 'range', phone: 'short' }), 'phone');
  assert.equal(firstSetupProblem({ close: 'invalid', tables: 'range' }), 'close');
});

test('field messages are said in the screen language', () => {
  assert.equal(setupFieldMessage('name', 'th'), 'กรอกชื่อร้านก่อน');
  assert.equal(setupFieldMessage('name', 'en'), 'Enter a restaurant name');
  assert.equal(setupFieldMessage('phone', 'th'), 'เบอร์โทรไม่ครบ 9 หลัก');
  assert.equal(setupFieldMessage('open', 'th'), 'เวลาไม่ถูกต้อง');
  assert.equal(setupFieldMessage('tables', 'th'), 'ใส่ได้ 1–500 โต๊ะ');
});

test('the server wording is classified, never shown', () => {
  const cases = [
    ['phone must have at least 9 digits', 'phone'],
    ['table_count must be between 1 and 500', 'tables'],
    ['open_time and close_time must use HH:mm', 'hours'],
    ['restaurant name is required', 'name'],
    ['Network request failed', 'offline'],
    ['internal server error', 'server_busy'],
    ['invalid request', 'unknown'],
    ['restaurant name is too long', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
  ];
  for (const [raw, code] of cases) {
    assert.equal(restaurantSetupFailureCode(raw), code, String(raw));
  }
  for (const [raw] of cases) {
    for (const language of ['th', 'en']) {
      const toast = restaurantSetupFailureToast(raw, language);
      const words = `${toast.title} ${toast.message ?? ''}`;
      if (raw) assert.ok(!words.includes(raw), `${raw} leaked into ${language}`);
    }
  }
});

test('the toast names the step and adds a line only when it helps', () => {
  assert.deepEqual(restaurantSetupFailureToast('Network request failed', 'th'), {
    title: 'สร้างร้านไม่สำเร็จ',
    message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่',
  });
  assert.deepEqual(restaurantSetupFailureToast('invalid request', 'en'), { title: 'Could not create the restaurant' });
  assert.deepEqual(restaurantSetupFailureToast('table_count must be between 1 and 500', 'th'), {
    title: 'สร้างร้านไม่สำเร็จ',
    message: 'จำนวนโต๊ะต้องอยู่ระหว่าง 1–500',
  });
  // The shop exists: the title has to say so, or the owner makes a second one.
  assert.deepEqual(restaurantSetupFailureToast('secure store failed', 'th', 'open'), { title: 'สร้างร้านแล้ว แต่เข้าร้านไม่สำเร็จ' });
  assert.deepEqual(restaurantSetupFailureToast('secure store failed', 'en', 'open'), { title: 'Restaurant created, but it could not be opened' });
});

test('a failure the server tied to a field lands under that field', () => {
  assert.deepEqual(setupProblemsForFailure('phone'), { phone: 'short' });
  assert.deepEqual(setupProblemsForFailure('tables'), { tables: 'range' });
  assert.deepEqual(setupProblemsForFailure('name'), { name: 'required' });
  assert.deepEqual(setupProblemsForFailure('hours'), {});
  assert.deepEqual(setupProblemsForFailure('offline'), {});
  assert.deepEqual(setupProblemsForFailure('unknown'), {});
});

test('contact summary joins with a comma and says nothing when blank', () => {
  assert.equal(contactSummary('080-000-0000', '1 ถนนตัวอย่าง'), '080-000-0000, 1 ถนนตัวอย่าง');
  assert.equal(contactSummary('  ', '1 ถนนตัวอย่าง\n  แขวงตัวอย่าง'), '1 ถนนตัวอย่าง แขวงตัวอย่าง');
  assert.equal(contactSummary('080-000-0000', ''), '080-000-0000');
  assert.equal(contactSummary('', ''), null);
  assert.ok(!String(contactSummary('a', 'b')).includes(' · '));
});
