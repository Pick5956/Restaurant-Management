import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

test('the toast outlives the screen that raised it', async () => {
  const layout = await read('app', '_layout.tsx');

  // The provider has to sit OUTSIDE the navigator. Mounted inside a screen it
  // would unmount with that screen, and the one case this exists for - the bill
  // toasting a successful payment and immediately leaving for the floor - would
  // show nothing at all.
  const providerAt = layout.indexOf('<ToastProvider>');
  const navigatorAt = layout.indexOf('<AppNavigator />');
  assert.ok(providerAt !== -1, 'ToastProvider is not mounted in the root layout');
  assert.ok(navigatorAt !== -1, 'AppNavigator is not mounted in the root layout');
  assert.ok(providerAt < navigatorAt, 'ToastProvider must wrap AppNavigator, not sit inside it');
});

test('paying a bill announces itself before navigating away', async () => {
  const bill = await read('app', 'order', 'bill.tsx');

  const toastAt = bill.indexOf('showToast(');
  const leaveAt = bill.indexOf('resetRouteStack(router, billExitRoute(');
  assert.ok(toastAt !== -1, 'the bill never raises a toast');
  assert.ok(leaveAt !== -1, 'the bill never leaves after payment');
  assert.ok(toastAt < leaveAt, 'the toast must be raised before the route is reset');
});

test('toast timing and stacking match the web', async () => {
  const provider = await read('src', 'providers', 'toast-provider.tsx');

  // frontend/src/components/shared/FeedbackProvider.tsx: 3600ms, last four.
  assert.match(provider, /const DEFAULT_DURATION = 3600;/);
  assert.match(provider, /const MAX_VISIBLE = 4;/);
});

test('the toast is anchored to the top, clear of the bottom docks', async () => {
  const provider = await read('src', 'providers', 'toast-provider.tsx');

  assert.match(provider, /top: insets\.top \+ spacing\.lg/);
  assert.doesNotMatch(provider, /bottom: insets\.bottom/);

  // box-none, or the invisible full-width container would swallow every touch
  // on the screen underneath it.
  assert.match(provider, /pointerEvents="box-none"/);
});

test('the toast is the glass capsule the owner chose, with room for one undo', async () => {
  const provider = await read('src', 'providers', 'toast-provider.tsx');

  // 14 ก.ย. 2569: design B, the dock's material.
  assert.match(provider, /<GlassPanel/);
  assert.match(provider, /action\?: ToastAction/);
  // An error is read, a success glanced at.
  assert.match(provider, /const ERROR_DURATION = 6000;/);
  // Flick up to dismiss; the invisible container still passes touches through.
  assert.match(provider, /PanResponder\.create/);
});

test('screens report what a tap did with a toast, not a banner that pushes the page down', async () => {
  const screens = [
    ['app', '(primary)', 'kitchen.tsx'],
    ['app', 'inventory.tsx'],
    ['app', 'order', 'bill.tsx'],
    ['app', 'order', '[id].tsx'],
    ['app', 'settings', 'account.tsx'],
    ['app', 'settings', 'printer.tsx'],
    ['app', 'settings', 'restaurant.tsx'],
    ['app', 'staff', 'member.tsx'],
  ];
  for (const segments of screens) {
    const source = await read(...segments);
    const name = segments.join('/');
    assert.match(source, /showToast\(/, `${name} never raises a toast`);
    // Only the banner counts: a green tile or a "paid" badge is not a message.
    assert.doesNotMatch(source, /<Feedback[^<]*?tone="success"/s, `${name} still renders a success banner inline`);
  }
});

test('the kitchen keeps its states inline and offers undo on the toast', async () => {
  const kitchen = await read('app', '(primary)', 'kitchen.tsx');

  // A dropped live feed and a view-only account are true until they are not,
  // so they are not toasts.
  assert.match(kitchen, /realtimeStatus === 'offline' \? \(\s*<Feedback/);
  assert.match(kitchen, /!canUpdate \? \(\s*<Feedback/);
  // Done a round → the toast can pull it straight back.
  assert.match(kitchen, /onPress: \(\) => recallByKey\(ticketKey\)/);
  assert.doesNotMatch(kitchen, /setMessage\(/);
});
