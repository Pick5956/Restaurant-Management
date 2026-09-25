import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  goBackOr,
  leaveForWorkspaceRoute,
  resetRouteStack,
  rootStackRouteNames,
  stackRouteName,
  workspaceExitSteps,
} from './navigation-runtime.ts';

test('root-level resets replace without dispatching an unhandled pop-to-top action', () => {
  const actions = [];

  resetRouteStack(
    {
      canDismiss: () => false,
      dismissAll: () => actions.push('dismiss-all'),
      replace: (href) => actions.push(`replace:${href}`),
    },
    '/login',
  );

  assert.deepEqual(actions, ['replace:/login']);
});

test('restaurant switching dismisses the prior stack before entering the new workspace', () => {
  const actions = [];

  resetRouteStack(
    {
      canDismiss: () => true,
      dismissAll: () => actions.push('dismiss-all'),
      replace: (href) => actions.push(`replace:${href}`),
    },
    '/more',
  );

  assert.deepEqual(actions, ['dismiss-all', 'replace:/more']);
});

test('auth and restaurant invalidation targets use the same non-backtrackable reset', () => {
  for (const target of ['/login', '/restaurants']) {
    const actions = [];

    resetRouteStack(
      {
        canDismiss: () => true,
        dismissAll: () => actions.push('dismiss-all'),
        replace: (href) => actions.push(`replace:${href}`),
      },
      target,
    );

    assert.deepEqual(actions, ['dismiss-all', `replace:${target}`]);
  }
});

// ------------------------------------------------------------ workspace exits

/**
 * The app Stack as expo-router 57 moves it (build/react-navigation StackRouter
 * and router.js): dismissAll pops to the bottom route, dismissTo pops to the
 * nearest route of that name or, when there is none, swaps ONLY the top route
 * for it, replace swaps the top route, push appends, back pops one and is
 * unhandled on a single route. Each route carries a key so a test can tell a
 * screen kept from one mounted again.
 */
function stack(names) {
  let next = 0;
  const route = (name) => ({ name, key: `${name}-${next++}` });
  const routes = names.map(route);
  const unhandled = [];
  const router = {
    routes,
    unhandled,
    names: () => routes.map((item) => item.name),
    dismissAll: () => { routes.splice(1); },
    dismissTo: (href) => {
      const name = stackRouteName(href);
      const at = routes.map((item) => item.name).lastIndexOf(name);
      if (at >= 0) routes.splice(at + 1);
      else routes.splice(routes.length - 1, 1, route(name));
    },
    replace: (href) => { routes.splice(routes.length - 1, 1, route(stackRouteName(href))); },
    push: (href) => { routes.push(route(stackRouteName(href))); },
    canGoBack: () => routes.length > 1,
    back: () => {
      if (routes.length > 1) routes.pop();
      else unhandled.push('GO_BACK');
    },
  };
  return router;
}

const leave = (names, href) => {
  const router = stack(names);
  leaveForWorkspaceRoute(router, router.names(), href);
  return router;
};

// The owner, 2026-09-25: a table's bill paid, and the floor it landed on had a
// back button that did nothing. The old exit cleared the stack to one screen.
test('a paid bill lands on the floor with the hub beneath it, and back goes to the hub', () => {
  const router = stack(['more', 'tables', 'order/[id]', 'order/bill']);
  const floor = router.routes[1].key;
  leaveForWorkspaceRoute(router, router.names(), '/tables');
  assert.deepEqual(router.names(), ['more', 'tables']);
  // The floor the waiter came from, not a new one: its scroll and zone stay.
  assert.equal(router.routes[1].key, floor);
  router.back();
  assert.deepEqual(router.names(), ['more']);
  assert.deepEqual(router.unhandled, []);
});

test('the old exit is what stranded it: one screen, and back unhandled', () => {
  const router = stack(['more', 'tables', 'order/[id]', 'order/bill']);
  resetRouteStack({ ...router, canDismiss: () => router.routes.length > 1 }, '/tables');
  assert.deepEqual(router.names(), ['tables']);
  router.back();
  assert.deepEqual(router.unhandled, ['GO_BACK']);
});

test('every way into a bill leaves it for [hub, target] with no order screen left', () => {
  const cases = [
    [['more', 'tables', 'order/[id]', 'order/bill'], '/tables'],
    [['more', 'tables', 'reservations', 'order/[id]', 'order/bill'], '/tables'],
    [['more', 'home', 'order/[id]', 'order/bill'], '/tables'],
    [['more', 'reports', 'order/[id]', 'order/bill'], '/tables'],
    [['more', 'orders', 'order/bill'], '/tables'],
    [['more', 'orders', 'order/bill'], '/orders'],
    [['more', 'home', 'order/[id]', 'order/bill'], '/orders'],
    [['more', 'home', 'order/[id]', 'order/bill'], '/home'],
    // A session stranded by the old exit, mended on the next payment.
    [['tables', 'order/[id]', 'order/bill'], '/tables'],
    [['orders', 'order/bill'], '/orders'],
  ];
  for (const [names, href] of cases) {
    const router = leave(names, href);
    const label = `${names.join(' > ')} to ${href}`;
    assert.deepEqual(router.names(), ['more', stackRouteName(href)], label);
    router.back();
    assert.deepEqual(router.names(), ['more'], label);
    assert.deepEqual(router.unhandled, [], label);
  }
});

test('a tablet rail tap switches screens on the hub instead of piling them up or dropping the hub', () => {
  // From the hub: pushed, the hub kept (a replace had dropped it).
  assert.deepEqual(leave(['more'], '/menu').names(), ['more', 'menu']);
  // From one screen to another: still two deep, however many taps.
  let router = stack(['more']);
  for (const href of ['/kitchen', '/tables', '/kitchen', '/orders', '/tables']) {
    leaveForWorkspaceRoute(router, router.names(), href);
    assert.deepEqual(router.names(), ['more', stackRouteName(href)], href);
  }
  // Inside an order, the floor's item pops back to the floor already open.
  router = stack(['more', 'tables', 'order/[id]']);
  const floor = router.routes[1].key;
  leaveForWorkspaceRoute(router, router.names(), '/tables');
  assert.deepEqual(router.names(), ['more', 'tables']);
  assert.equal(router.routes[1].key, floor);
  // The screen already on top: nothing moves.
  router = stack(['more', 'kitchen']);
  const kitchen = router.routes[1].key;
  leaveForWorkspaceRoute(router, router.names(), '/kitchen');
  assert.equal(router.routes[1].key, kitchen);
  // The hub's own item goes down to it.
  assert.deepEqual(leave(['more', 'tables', 'order/[id]'], '/more').names(), ['more']);
  assert.deepEqual(leave(['tables'], '/more').names(), ['more']);
});

test('the steps are planned from the stack, and a pop never leaves the hub out', () => {
  assert.deepEqual(workspaceExitSteps(['more', 'tables', 'order/[id]', 'order/bill'], '/tables'), ['pop-to']);
  assert.deepEqual(workspaceExitSteps(['more', 'home', 'order/[id]', 'order/bill'], '/tables'), ['dismiss-all', 'push']);
  assert.deepEqual(workspaceExitSteps(['more'], '/tables'), ['push']);
  assert.deepEqual(workspaceExitSteps(['tables', 'order/[id]', 'order/bill'], '/tables'), ['dismiss-all', 'replace-with-hub', 'push']);
  assert.deepEqual(workspaceExitSteps(['more', 'tables'], '/tables'), []);
  assert.deepEqual(workspaceExitSteps(['more'], '/more'), []);
  // dismissTo on its own is wrong whenever the target is missing: it swaps the
  // top only, so the order screen stays under the floor.
  const bare = stack(['more', 'home', 'order/[id]', 'order/bill']);
  bare.dismissTo('/tables');
  assert.deepEqual(bare.names(), ['more', 'home', 'order/[id]', 'tables']);
});

test('route names and the root state read the way expo-router names them', () => {
  assert.equal(stackRouteName('/tables'), 'tables');
  assert.equal(stackRouteName('/more'), 'more');
  assert.equal(stackRouteName('/orders?status=paid'), 'orders');
  const state = { routes: [{ name: '__root', state: { routes: [{ name: 'more' }, { name: 'tables' }, { name: 'order/[id]' }] } }] };
  assert.deepEqual(rootStackRouteNames(state), ['more', 'tables', 'order/[id]']);
  assert.deepEqual(rootStackRouteNames({ routes: [{ name: 'more' }, { name: 'kitchen' }] }), ['more', 'kitchen']);
  assert.deepEqual(rootStackRouteNames(undefined), []);
});

test('a back button with nothing beneath goes to its fallback instead of doing nothing', () => {
  const stranded = stack(['tables']);
  goBackOr(stranded, '/more');
  assert.deepEqual(stranded.names(), ['more']);
  assert.deepEqual(stranded.unhandled, []);
  const normal = stack(['more', 'tables']);
  goBackOr(normal, '/more');
  assert.deepEqual(normal.names(), ['more']);
});

// ------------------------------------------------------------- call sites

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (relative) => (await readFile(path.join(mobileRoot, relative), 'utf8')).replace(/\r\n/g, '\n');

async function sourceFiles(dir) {
  const entries = await readdir(path.join(mobileRoot, dir), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [relative] : [];
  }));
  return files.flat();
}

test('the bill leaves through the workspace exit, read from its own stack', async () => {
  const bill = await read('app/order/bill.tsx');
  assert.match(bill, /const leaveBill = \(\) => leaveForWorkspaceRoute\(\s*router,\s*navigation\.getState\(\)\?\.routes\.map\(\(route\) => route\.name\) \?\? \[\],\s*billExitRoute\(canTakeOrder, canViewOrders\),\s*\);/);
  assert.equal((bill.match(/leaveBill\(\)/g) || []).length, 1, 'payment success leaves through leaveBill');
  assert.match(bill, /onPress=\{leaveBill\} \/>/);
  assert.doesNotMatch(bill, /resetRouteStack/);
});

// resetRouteStack leaves one screen, so it is only for a screen that is a root
// with no back button. Any other target strands whoever lands there.
test('resetRouteStack only ever targets a root screen', async () => {
  const roots = new Set(["'/login'", "'/restaurants'", 'WORKSPACE_HUB_ROUTE', "'/more'"]);
  const files = [...await sourceFiles('app'), ...await sourceFiles('src')].filter((file) => !file.endsWith('navigation-runtime.ts'));
  let calls = 0;
  for (const file of files) {
    const source = await read(file);
    for (const [, target] of source.matchAll(/resetRouteStack\(router, ([^;]+)\);/g)) {
      calls += 1;
      const root = roots.has(target) || /^getDefaultWorkspaceRoute\(/.test(target);
      assert.ok(root, `${file} resets the stack onto ${target}, which has a back button`);
    }
  }
  assert.ok(calls >= 6, `only ${calls} resets were found; the pattern no longer matches the call sites`);
});

test('every back button checks there is somewhere to go', async () => {
  const shell = await read('src/components/app-shell.tsx');
  assert.match(shell, /<GlassButton icon="chevron-back" label=\{copy\('ย้อนกลับ', 'Go back'\)\} onPress=\{\(\) => goBackOr\(router, WORKSPACE_HUB_ROUTE\)\} \/>/);
  const compact = await read('src/components/compact-header.tsx');
  assert.match(compact, /onPress=\{\(\) => goBackOr\(router, WORKSPACE_HUB_ROUTE\)\} size=\{COMPACT_BUTTON\}/);
  const auth = await read('src/components/auth-screen.tsx');
  assert.match(auth, /onPress=\{\(\) => goBackOr\(router, '\/'\)\}/);
  for (const [file, source] of [['app-shell', shell], ['compact-header', compact], ['auth-screen', auth]]) {
    assert.doesNotMatch(source, /chevron-back[^\n]*router\.back\(\)/, file);
  }
});

test('the tablet rail switches through the workspace exit', async () => {
  const shell = await read('src/components/app-shell.tsx');
  assert.match(shell, /onPress=\{\(\) => leaveForWorkspaceRoute\(\s*router,\s*rootStackRouteNames\(navigationRef\.getRootState\(\)\),\s*item\.href as never,\s*\)\}/);
  assert.doesNotMatch(shell, /router\.replace\(item\.href/);
  assert.doesNotMatch(shell, /router\.navigate\(item\.href/);
});
