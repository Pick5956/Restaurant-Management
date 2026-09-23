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

test('the toast is out of the app until the owner designs its replacement', async () => {
  const provider = await read('src', 'providers', 'toast-provider.tsx');

  // Pulled 14 ก.ย. 2569: the glass capsule never rendered on iOS 26. Nothing is
  // drawn over the screens now...
  assert.doesNotMatch(provider, /<GlassPanel|Animated\.View|position: 'absolute'/);
  // ...but an error must still reach the person who caused it.
  assert.match(provider, /tone === 'error' \|\| tone === 'warning'[\s\S]{0,80}Alert\.alert\(/);
  // A success is still spoken for screen readers.
  assert.match(provider, /AccessibilityInfo\.announceForAccessibility\(/);
});

test('screens report what a tap did through the feedback seam, not a banner that pushes the page down', async () => {
  const screens = [
    ['app', 'kitchen.tsx'],
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

test('the kitchen keeps its states inline and still routes outcomes through the seam', async () => {
  const kitchen = await read('app', 'kitchen.tsx');

  // A dropped live feed and a view-only account are true until they are not,
  // so they are not toasts.
  assert.match(kitchen, /realtimeStatus === 'offline' \? \(\s*<Feedback/);
  assert.match(kitchen, /!canUpdate \? \(\s*<Feedback/);
  // Done a round → the toast can pull it straight back.
  assert.match(kitchen, /onPress: \(\) => recallByKey\(ticketKey\)/);
  assert.doesNotMatch(kitchen, /setMessage\(/);
});
