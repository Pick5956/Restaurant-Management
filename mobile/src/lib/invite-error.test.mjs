import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inviteFailureCode, inviteFailureMessage } from './invite-error.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 2026-09-24: a suspended member opening an invite link was refused by the
// server with "membership is suspended", and the invite screen printed that
// English line under its red heading.

test('the invite refusals a person can act on are recognised', () => {
  assert.equal(inviteFailureCode('membership is suspended'), 'suspended');
  assert.equal(inviteFailureCode('invitation is for a different email'), 'other_email');
  assert.equal(inviteFailureCode('invitation is no longer usable'), 'not_usable');
  assert.equal(inviteFailureCode('user account is not active'), 'account_inactive');
  assert.equal(inviteFailureCode('invalid invitation token'), 'not_found');
  assert.equal(inviteFailureCode('resource not found'), 'not_found');
  assert.equal(inviteFailureCode('Network request failed'), 'offline');
  assert.equal(inviteFailureCode('internal server error'), 'server_busy');
  assert.equal(inviteFailureCode('something nobody mapped'), 'unknown');
  assert.equal(inviteFailureCode(null), 'unknown');
});

test('the screen says the app\'s words, and its own line for anything unmapped', () => {
  assert.equal(inviteFailureMessage(new Error('membership is suspended'), 'th', 'x'), 'บัญชีนี้ถูกพักการใช้งานในร้านนี้ ติดต่อเจ้าของร้าน');
  assert.equal(inviteFailureMessage(new Error('membership is suspended'), 'en', 'x'), 'This account is suspended at this restaurant. Contact the owner.');
  assert.equal(inviteFailureMessage(new Error('pq: deadlock detected'), 'th', 'รับคำเชิญไม่สำเร็จ'), 'รับคำเชิญไม่สำเร็จ');
  assert.equal(inviteFailureMessage(undefined, 'th', 'รับคำเชิญไม่สำเร็จ'), 'รับคำเชิญไม่สำเร็จ');
});

// What src/api/client.ts throws: an Error carrying the HTTP status.
const apiError = (message, status) => Object.assign(new Error(message), { name: 'ApiError', status });

// A tunnel or proxy outage answers with a non-JSON page, so client.ts names it
// "Request failed (530)"; the rate limiter says "too many requests" (429) or
// "rate limit unavailable" (503). None of them says which invitation is wrong,
// and the screen's fallback used to blame the invitation ("deleted", "ask for
// a new link") for what was the server's hiccup.
test('the status decides before the message: a server outage and a rate limit are not a bad invitation', () => {
  assert.equal(inviteFailureCode('Request failed (530)', 530), 'server_busy');
  assert.equal(inviteFailureCode('rate limit unavailable', 503), 'server_busy');
  assert.equal(inviteFailureCode('invitation not found', 500), 'server_busy');
  assert.equal(inviteFailureCode('too many requests', 429), 'rate_limited');
  // A status that is not an outage leaves the message to decide.
  assert.equal(inviteFailureCode('invitation not found', 404), 'not_found');
  assert.equal(inviteFailureCode('membership is suspended', 403), 'suspended');
  assert.equal(inviteFailureCode('Request failed (530)'), 'unknown');
});

test('an outage or a rate limit says so on the screen, never the invitation fallback', () => {
  const lookupFallback = 'ไม่พบคำเชิญหรือคำเชิญถูกลบแล้ว';
  const acceptFallback = 'รับคำเชิญไม่สำเร็จ กรุณาตรวจบัญชีหรือขอลิงก์ใหม่';
  assert.equal(inviteFailureMessage(apiError('Request failed (530)', 530), 'th', lookupFallback), 'ระบบขัดข้องชั่วคราว');
  assert.equal(inviteFailureMessage(apiError('Request failed (530)', 530), 'en', 'x'), 'The service is having trouble.');
  assert.equal(inviteFailureMessage(apiError('rate limit unavailable', 503), 'th', acceptFallback), 'ระบบขัดข้องชั่วคราว');
  assert.equal(inviteFailureMessage(apiError('too many requests', 429), 'th', acceptFallback), 'ส่งคำขอถี่เกินไป');
  assert.equal(inviteFailureMessage(apiError('too many requests', 429), 'en', 'x'), 'Too many attempts.');
  // An unmapped refusal with an ordinary status still gets the screen's line.
  assert.equal(inviteFailureMessage(apiError('pq: deadlock detected', 400), 'th', acceptFallback), acceptFallback);
});

// The screen's ลองอีกครั้ง button (or the accept button) sits right under the
// line, so an outage or a rate limit names the cause and stops there; "ลองใหม่"
// in the line said the button's job a second time.
test('an outage or a rate limit names the cause without repeating the retry', () => {
  for (const [err, language] of [
    [apiError('Request failed (530)', 530), 'th'],
    [apiError('Request failed (530)', 530), 'en'],
    [apiError('too many requests', 429), 'th'],
    [apiError('too many requests', 429), 'en'],
  ]) {
    const line = inviteFailureMessage(err, language, 'x');
    assert.doesNotMatch(line, /ลองใหม่|ลองอีกครั้ง|try again/i, line);
  }
});

test('the invite screen never shows err.message', async () => {
  const screen = await readFile(path.join(mobileRoot, 'app', 'invite', '[token].tsx'), 'utf8');
  assert.doesNotMatch(screen, /err\.message/);
  assert.equal((screen.match(/setError\(inviteFailureMessage\(err, /g) || []).length, 2);
});

test('the guard runs with the rest of the suite', async () => {
  const pkg = JSON.parse(await readFile(path.join(mobileRoot, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /src\/lib\/invite-error\.test\.mjs/);
});
