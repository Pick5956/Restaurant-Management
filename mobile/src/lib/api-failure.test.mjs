import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { apiFailureCode, apiFailureDetail, apiFailureKind, apiFailureSays, apiFailureStatus } from './api-failure.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** An ApiError as src/api/client.ts builds it: an Error with a numeric status. */
function apiError(message, status) {
  return Object.assign(new Error(message), { name: 'ApiError', status });
}

test('the status decides first, then the wording of a request that got no answer', () => {
  assert.equal(apiFailureKind(apiError('Request failed (530)', 530)), 'server_busy');
  assert.equal(apiFailureKind(apiError('internal server error', 500)), 'server_busy');
  assert.equal(apiFailureKind(apiError('too many requests', 429)), 'rate_limited');
  assert.equal(apiFailureKind(apiError('missing view_orders permission', 403)), 'forbidden');
  assert.equal(apiFailureKind(apiError('record not found', 404)), 'not_found');
  assert.equal(apiFailureKind(new TypeError('Network request failed')), 'offline');
  assert.equal(apiFailureKind(new Error('missing manage_menu permission')), 'forbidden');
  assert.equal(apiFailureKind(apiError('menu item is unavailable', 400)), 'unknown');
  assert.equal(apiFailureKind(null), 'unknown');
  assert.equal(apiFailureStatus(apiError('x', 409)), 409);
  assert.equal(apiFailureStatus(new Error('x')), null);
});

test('a status decides "not found": a 400 that mentions it is a bad field, not a gone record', () => {
  assert.equal(apiFailureKind(apiError('ingredient category not found', 400)), 'unknown');
  assert.equal(apiFailureDetail(apiError('ingredient category not found', 400), 'th'), undefined);
  assert.equal(apiFailureKind(apiError('resource not found', 404)), 'not_found');
  // A failure with no status is still read by its wording.
  assert.equal(apiFailureKind(new Error('record not found')), 'not_found');
});

test('a 409 that says "not found" is a record already gone, not a refusal', () => {
  // IngredientController.Delete answers every failure with 409, the ingredient
  // another phone already deleted included. It is gone, not in a recipe.
  const gone = apiError('ingredient not found', 409);
  assert.equal(apiFailureKind(gone), 'not_found');
  assert.equal(apiFailureDetail(gone, 'th'), 'ไม่พบรายการนี้แล้ว');
  assert.equal(apiFailureDetail(gone, 'en'), 'This no longer exists.');
  // The refusals that share that 409 stay for the screen to word.
  assert.equal(apiFailureDetail(apiError('ingredient is used by a menu recipe', 409), 'th'), undefined);
  assert.equal(apiFailureDetail(apiError('category is in use by ingredients', 409), 'th'), undefined);
  // A 400 naming a field it could not find is still that field's problem.
  assert.equal(apiFailureDetail(apiError('ingredient category not found', 400), 'th'), undefined);
});

test('the body code and the wording are read to tell refusals apart, never returned', () => {
  const locked = Object.assign(apiError('cannot change stock units while ingredient is used by a menu recipe', 409), {
    details: JSON.stringify({ error: 'cannot change stock units while ingredient is used by a menu recipe', code: 'ingredient_unit_locked' }),
  });
  assert.equal(apiFailureCode(locked), 'ingredient_unit_locked');
  assert.equal(apiFailureCode(apiError('x', 400)), '');
  assert.equal(apiFailureCode(Object.assign(apiError('x', 502), { details: '<html>Bad gateway</html>' })), '');
  assert.equal(apiFailureCode(Object.assign(apiError('x', 400), { details: '{not json' })), '');
  assert.equal(apiFailureCode(null), '');

  assert.equal(apiFailureSays(apiError('AI action plan was cancelled', 410), 'cancelled'), true);
  assert.equal(apiFailureSays(apiError('AI action plan has expired', 410), 'cancelled'), false);
  assert.equal(apiFailureSays(apiError('anything', 410), '  '), false);
  assert.equal(apiFailureSays(null, 'cancelled'), false);
});

test('the detail is the app\'s words, and nothing for a failure it cannot name', () => {
  assert.equal(apiFailureDetail(new TypeError('Network request failed'), 'th'), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  assert.equal(apiFailureDetail(apiError('missing view_orders permission', 403), 'en'), 'This account does not have permission for this.');
  assert.equal(apiFailureDetail(apiError('invalid item status transition from served to cooking', 400), 'th'), undefined);
  // Never the server's own words, whatever it said.
  for (const raw of ['internal server error', 'record not found', 'missing view_orders permission', 'Request failed (502)']) {
    const detail = apiFailureDetail(apiError(raw, 400), 'th') ?? '';
    assert.ok(!detail.includes(raw), `${raw} leaked into the detail`);
  }
});

test('the guard runs with the rest of the suite', async () => {
  const pkg = JSON.parse(await readFile(path.join(mobileRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /src\/lib\/api-failure\.test\.mjs/);
});
