import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

// Every page's content used to blink in when its data landed; the owner asked
// for the kitchen's way on all of them (2026-09-26): a skeleton first, then the
// content fading in where it was.

test('ContentReveal fades in with the kitchen numbers, on the native driver', async () => {
  const source = await read('src', 'components', 'skeleton.tsx');
  assert.match(source, /const CONTENT_REVEAL_DELAY_MS = 110;/);
  assert.match(source, /const CONTENT_REVEAL_MS = 260;/);
  assert.match(source, /export function ContentReveal\(/);
  // LayoutAnimation around a subtree of text fields closed the app on iOS.
  assert.doesNotMatch(source, /LayoutAnimation\.configureNext|import \{[^}]*LayoutAnimation[^}]*\} from 'react-native'/);
});

test('every page that loads before it draws fades its content in', async () => {
  const screens = [
    ['app', 'home.tsx'],
    ['app', 'orders.tsx'],
    ['app', 'tables.tsx'],
    ['app', 'table-management.tsx'],
    ['app', 'reservations.tsx'],
    ['app', 'menu.tsx'],
    ['app', 'menu', 'categories.tsx'],
    ['app', 'menu', 'item.tsx'],
    ['app', 'order', '[id].tsx'],
    ['app', 'order', 'bill.tsx'],
    ['app', 'order', 'served.tsx'],
    ['app', 'inventory.tsx'],
    ['app', 'inventory', 'detail.tsx'],
    ['app', 'inventory', 'history.tsx'],
    ['app', 'inventory', 'categories.tsx'],
    ['app', 'inventory', 'item.tsx'],
    ['app', 'expenses.tsx'],
    ['app', 'reports.tsx'],
    ['app', 'staff.tsx'],
    ['app', 'staff', 'member.tsx'],
    ['app', 'staff', 'role.tsx'],
    ['app', 'staff', 'roles.tsx'],
    ['app', 'staff', 'invite.tsx'],
    ['app', 'settings', 'restaurant.tsx'],
  ];
  for (const segments of screens) {
    const source = await read(...segments);
    assert.match(source, /<ContentReveal\b/, `${segments.join('/')} does not fade its content in`);
  }
});

test('a load still going after a second shows a spinner, a quicker one never does', async () => {
  const source = await read('src', 'components', 'skeleton.tsx');
  // Owner, 2026-09-26: a page of grey shapes past a second looks stuck.
  assert.match(source, /const SLOW_LOAD_SPINNER_MS = 1000;/);
  assert.match(source, /setTimeout\(\(\) => setSlow\(true\), SLOW_LOAD_SPINNER_MS\)/);
  assert.match(source, /<ActivityIndicator color=\{palette\.primary\} \/>/);
  // The assistant's thinking line already says it is working.
  const bubbles = await read('src', 'components', 'ai', 'bubbles.tsx');
  assert.match(bubbles, /<SkeletonReveal label=\{label\} style=\{\{ gap: 14 \}\} spinner=\{false\}>/);
});
