import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { authFailureCode, authFailureToast } from './auth-error.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the API wording a person can act on is recognised', () => {
  assert.equal(authFailureCode('invalid credentials'), 'invalid_credentials');
  assert.equal(authFailureCode('invalid google credentials'), 'google_rejected');
  assert.equal(authFailureCode('resource already exists'), 'email_taken');
  assert.equal(authFailureCode('User not found'), 'account_missing');
  assert.equal(authFailureCode('resource not found'), 'account_missing');
  assert.equal(authFailureCode('password must be at least 8 bytes'), 'password_too_short');
  assert.equal(authFailureCode('password must be at most 72 bytes'), 'password_too_long');
  assert.equal(authFailureCode('Network request failed'), 'offline');
  assert.equal(authFailureCode('internal server error'), 'server_busy');
  assert.equal(authFailureCode(''), 'unknown');
  assert.equal(authFailureCode(null), 'unknown');
  assert.equal(authFailureCode('something nobody mapped'), 'unknown');
});

test('a failed sign-in speaks Thai and never repeats the server', () => {
  assert.deepEqual(authFailureToast('invalid credentials', 'sign_in', 'th'), {
    title: 'เข้าสู่ระบบไม่สำเร็จ',
    message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  });
  assert.deepEqual(authFailureToast('invalid credentials', 'sign_in', 'en'), {
    title: 'Could not sign in',
    message: 'That email or password is incorrect.',
  });
  // An unmapped failure keeps the step's title and says nothing vague after it.
  assert.deepEqual(authFailureToast('boom', 'register', 'th'), { title: 'สร้างบัญชีไม่สำเร็จ' });
  assert.deepEqual(authFailureToast('boom', 'reset', 'en'), { title: 'Could not send the link' });

  for (const action of ['sign_in', 'google', 'register', 'reset']) {
    for (const language of ['th', 'en']) {
      const toast = authFailureToast('invalid credentials', action, language);
      assert.ok(toast.title.length > 0, `${action}/${language} has no title`);
      assert.doesNotMatch(JSON.stringify(toast), /invalid credentials/);
    }
  }
});

test('the auth screens raise a toast and no longer print a red panel', async () => {
  const [login, register, forgot] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'login.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'register.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'forgot-password.tsx'), 'utf8'),
  ]);

  for (const [name, source] of [['login', login], ['register', register], ['forgot-password', forgot]]) {
    assert.match(source, /showToast\(/, `${name} never raises a toast`);
    assert.doesNotMatch(source, /<Feedback\b/, `${name} still renders an inline banner`);
    assert.match(source, /authFailureToast\(/, `${name} does not translate the API's wording`);
  }

  // Email first: the account most people have. Google is the alternative under it.
  assert.ok(
    login.indexOf('autoComplete="current-password"') < login.indexOf('logo-google'),
    'the Google button is still above the email form',
  );
});
