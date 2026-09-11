import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  classifyHorizontalSwipe,
  getAdjacentNavigationTarget,
  getNavigationIndexByRouteName,
  getNavigationRouteName,
  getPagerSceneTranslateXFromPosition,
  isPagerSwipeCooldownActive,
  notePagerVerticalScrollActivity,
  PAGER_VERTICAL_SCROLL_COOLDOWN_MS,
  resetRouteStack,
  resolvePagerAnimationDuration,
  resolvePagerDockSelectionPlan,
  resolvePagerGestureStartPlan,
  resolvePhoneNavigationIndicatorMetrics,
  resolvePagerAnimationSettlement,
  resolvePagerRouteSyncAction,
  resolvePagerSwipeSettlement,
  resolveTabChangeTick,
  shouldStartPagerHorizontalSwipe,
  shouldOpenSettings,
  TAB_CHANGE_RETURN_WINDOW_MS,
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
    '/kitchen',
  );

  assert.deepEqual(actions, ['dismiss-all', 'replace:/kitchen']);
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

test('account navigation is a no-op on settings and all settings subroutes', () => {
  assert.equal(shouldOpenSettings('/settings'), false);
  assert.equal(shouldOpenSettings('/settings/account'), false);
  assert.equal(shouldOpenSettings('/settings/restaurant'), false);
});

test('account navigation remains available outside the settings route family', () => {
  assert.equal(shouldOpenSettings('/home'), true);
  assert.equal(shouldOpenSettings('/more'), true);
  assert.equal(shouldOpenSettings('/settings-legacy'), true);
});

test('horizontal swipes map left to the next tab and right to the previous tab', () => {
  assert.equal(
    classifyHorizontalSwipe({ deltaX: -72, deltaY: 12, velocityX: -320 }),
    1,
  );
  assert.equal(
    classifyHorizontalSwipe({ deltaX: 72, deltaY: -12, velocityX: 320 }),
    -1,
  );
});

test('a short swipe is accepted when its horizontal release velocity is high enough', () => {
  assert.equal(
    classifyHorizontalSwipe({ deltaX: -18, deltaY: 4, velocityX: -900 }),
    1,
  );
});

test('slow short movement is not classified as a tab swipe', () => {
  assert.equal(
    classifyHorizontalSwipe({ deltaX: 24, deltaY: 3, velocityX: 180 }),
    null,
  );
});

test('vertical scrolling blocks an otherwise valid horizontal pager gesture', () => {
  const blockedUntil = notePagerVerticalScrollActivity(0, 1_000);

  assert.equal(
    blockedUntil,
    1_000 + PAGER_VERTICAL_SCROLL_COOLDOWN_MS,
  );
  assert.equal(isPagerSwipeCooldownActive(blockedUntil, 1_001), true);
  assert.equal(
    shouldStartPagerHorizontalSwipe(
      { deltaX: -5, deltaY: 1 },
      isPagerSwipeCooldownActive(blockedUntil, 1_001),
    ),
    false,
  );
});

test('post-scroll horizontal pager lock lasts exactly 30 milliseconds', () => {
  const blockedUntil = notePagerVerticalScrollActivity(0, 5_000);

  assert.equal(PAGER_VERTICAL_SCROLL_COOLDOWN_MS, 30);
  assert.equal(isPagerSwipeCooldownActive(blockedUntil, 5_029), true);
  assert.equal(isPagerSwipeCooldownActive(blockedUntil, 5_030), false);
});

test('horizontal pager gestures resume at the exact end of the scroll cooldown', () => {
  const blockedUntil = notePagerVerticalScrollActivity(0, 2_000);

  assert.equal(
    isPagerSwipeCooldownActive(blockedUntil, blockedUntil - 1),
    true,
  );
  assert.equal(isPagerSwipeCooldownActive(blockedUntil, blockedUntil), false);
  assert.equal(
    shouldStartPagerHorizontalSwipe(
      { deltaX: -5, deltaY: 1 },
      isPagerSwipeCooldownActive(blockedUntil, blockedUntil),
    ),
    true,
  );
});

test('pager responder admission keeps its minimum distance and direction dominance', () => {
  assert.equal(
    shouldStartPagerHorizontalSwipe({ deltaX: 4, deltaY: 0 }, false),
    false,
  );
  assert.equal(
    shouldStartPagerHorizontalSwipe({ deltaX: 5, deltaY: 5 }, false),
    false,
  );
  assert.equal(
    shouldStartPagerHorizontalSwipe({ deltaX: 5, deltaY: 1 }, false),
    true,
  );
});

test('continued vertical momentum extends the pager cooldown from its latest activity', () => {
  const firstDeadline = notePagerVerticalScrollActivity(0, 3_000);
  const momentumDeadline = notePagerVerticalScrollActivity(firstDeadline, 3_180);
  const staleDeadline = notePagerVerticalScrollActivity(momentumDeadline, 3_100);

  assert.equal(
    momentumDeadline,
    3_180 + PAGER_VERTICAL_SCROLL_COOLDOWN_MS,
  );
  assert.equal(staleDeadline, momentumDeadline);
  assert.equal(isPagerSwipeCooldownActive(momentumDeadline, firstDeadline), true);
});

test('phone navigation indicator stays inside every dock slot on narrow screens', () => {
  const dockWidth = 288;

  for (const itemCount of [1, 2, 3, 5]) {
    const metrics = resolvePhoneNavigationIndicatorMetrics(dockWidth, itemCount, 4);

    assert.ok(metrics);
    assert.equal(metrics.slotWidth, dockWidth / itemCount);
    assert.equal(metrics.indicatorInset, 4);
    assert.equal(metrics.indicatorWidth, metrics.slotWidth - 8);

    for (const position of [0, (itemCount - 1) / 2, itemCount - 1]) {
      const left = metrics.indicatorInset + position * metrics.slotWidth;
      const right = left + metrics.indicatorWidth;

      assert.ok(left >= 0);
      assert.ok(right <= dockWidth);
    }
  }
});

test('phone navigation indicator rejects unusable dock geometry', () => {
  assert.equal(resolvePhoneNavigationIndicatorMetrics(0, 5, 4), null);
  assert.equal(resolvePhoneNavigationIndicatorMetrics(Number.NaN, 5, 4), null);
  assert.equal(resolvePhoneNavigationIndicatorMetrics(288, 0, 4), null);
  assert.equal(resolvePhoneNavigationIndicatorMetrics(288, 2.5, 4), null);
  assert.equal(resolvePhoneNavigationIndicatorMetrics(288, 5, -1), null);
});

test('a released short drag settles exactly on the committed page', () => {
  const items = [
    { href: '/home' },
    { href: '/tables' },
    { href: '/kitchen' },
  ];
  const settlement = resolvePagerSwipeSettlement(
    items,
    1,
    { deltaX: -17, deltaY: 2, velocityX: -120 },
    390,
  );

  assert.deepEqual(settlement, { targetIndex: 1, shouldNavigate: false });
  const interruptedReturn = resolvePagerAnimationSettlement({
    committedIndex: 1,
    finished: false,
    ownsTransition: true,
    targetIndex: settlement.targetIndex,
  });
  assert.deepEqual(interruptedReturn, { completed: false, position: 1 });
  assert.equal(
    getPagerSceneTranslateXFromPosition(1, interruptedReturn.position, 390),
    0,
  );
});

test('post-release tab switching uses 500 milliseconds without slowing rollback', () => {
  assert.equal(
    resolvePagerAnimationDuration({
      navigateAfterAnimation: true,
      settleAfterGesture: true,
      travel: 0.65,
    }),
    500,
  );
  assert.equal(
    resolvePagerAnimationDuration({
      navigateAfterAnimation: false,
      settleAfterGesture: true,
      travel: 0.35,
    }),
    180,
  );
});

test('dock selections jump directly and can supersede an in-flight swipe', () => {
  assert.deepEqual(
    resolvePagerDockSelectionPlan({
      committedIndex: 1,
      itemCount: 5,
      pendingRouteIndex: null,
      targetIndex: 3,
      transitionActive: false,
    }),
    {
      animation: 'none',
      interruptsTransition: false,
      position: 3,
      shouldNavigate: true,
    },
  );
  assert.deepEqual(
    resolvePagerDockSelectionPlan({
      committedIndex: 1,
      itemCount: 5,
      pendingRouteIndex: 2,
      targetIndex: 4,
      transitionActive: true,
    }),
    {
      animation: 'none',
      interruptsTransition: true,
      position: 4,
      shouldNavigate: true,
    },
  );
  assert.deepEqual(
    resolvePagerDockSelectionPlan({
      committedIndex: 2,
      itemCount: 5,
      pendingRouteIndex: null,
      targetIndex: 2,
      transitionActive: true,
    }),
    {
      animation: 'none',
      interruptsTransition: true,
      position: 2,
      shouldNavigate: false,
    },
  );
  assert.deepEqual(
    resolvePagerDockSelectionPlan({
      committedIndex: 0,
      itemCount: 5,
      pendingRouteIndex: 1,
      targetIndex: 0,
      transitionActive: true,
    }),
    {
      animation: 'none',
      interruptsTransition: true,
      position: 0,
      shouldNavigate: true,
    },
    'the committed tab must still dispatch when it cancels a pending swipe route',
  );
});

test('a consecutive swipe starts from the pending target without waiting for settle', () => {
  const items = [
    { href: '/home' },
    { href: '/tables' },
    { href: '/kitchen' },
  ];
  const firstSwipe = resolvePagerSwipeSettlement(
    items,
    0,
    { deltaX: -8, deltaY: 1, velocityX: -350 },
    390,
  );
  assert.deepEqual(firstSwipe, { targetIndex: 1, shouldNavigate: true });

  const nextGesture = resolvePagerGestureStartPlan({
    committedIndex: 0,
    itemCount: items.length,
    pendingRouteIndex: firstSwipe.targetIndex,
  });
  assert.deepEqual(nextGesture, {
    routeIndexToReaffirm: 1,
    startIndex: 1,
  });
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      nextGesture.startIndex,
      { deltaX: -8, deltaY: 1, velocityX: -350 },
      390,
    ),
    { targetIndex: 2, shouldNavigate: true },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      nextGesture.startIndex,
      { deltaX: -3, deltaY: 1, velocityX: -200 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
    'canceling the second gesture must retain the reaffirmed pending tab',
  );
});

test('route acknowledgement preserves a running settle and ignores stale route updates', () => {
  assert.equal(
    resolvePagerRouteSyncAction({
      activeIndex: 1,
      pendingRouteIndex: 4,
      permittedItemsChanged: false,
    }),
    'ignore-stale',
  );
  assert.equal(
    resolvePagerRouteSyncAction({
      activeIndex: 4,
      pendingRouteIndex: 4,
      permittedItemsChanged: false,
    }),
    'acknowledge',
  );
  assert.equal(
    resolvePagerRouteSyncAction({
      activeIndex: 2,
      pendingRouteIndex: null,
      permittedItemsChanged: false,
    }),
    'reconcile',
  );
  assert.equal(
    resolvePagerRouteSyncAction({
      activeIndex: 2,
      pendingRouteIndex: 2,
      permittedItemsChanged: true,
    }),
    'reconcile',
  );
});

test('a pager swipe commits at half the viewport without needing release velocity', () => {
  const items = [
    { href: '/home' },
    { href: '/tables' },
    { href: '/kitchen' },
  ];

  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -194, deltaY: 3, velocityX: -299 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: 194, deltaY: 3, velocityX: 299 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -195, deltaY: 3, velocityX: -1 },
      390,
    ),
    { targetIndex: 2, shouldNavigate: true },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: 195, deltaY: 3, velocityX: 1 },
      390,
    ),
    { targetIndex: 0, shouldNavigate: true },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -195, deltaY: 3, velocityX: Number.POSITIVE_INFINITY },
      390,
    ),
    { targetIndex: 2, shouldNavigate: true },
  );
});

test('a deliberate fast flick commits before half the viewport in either direction', () => {
  const items = [
    { href: '/home' },
    { href: '/tables' },
    { href: '/kitchen' },
  ];

  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -5, deltaY: 1, velocityX: -300 },
      390,
    ),
    { targetIndex: 2, shouldNavigate: true },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: 5, deltaY: 1, velocityX: 300 },
      390,
    ),
    { targetIndex: 0, shouldNavigate: true },
  );
});

test('a short pager movement must meet both flick speed and minimum distance', () => {
  const items = [
    { href: '/home' },
    { href: '/tables' },
    { href: '/kitchen' },
  ];

  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -5, deltaY: 1, velocityX: -299 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -4, deltaY: 1, velocityX: -4_000 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
});

test('a fast flick cannot commit when its release velocity reverses direction', () => {
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      [{ href: '/home' }, { href: '/tables' }, { href: '/kitchen' }],
      1,
      { deltaX: -5, deltaY: 1, velocityX: 4_000 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
});

test('a pager swipe still needs to be predominantly horizontal at half the viewport', () => {
  const items = [
    { href: '/home' },
    { href: '/tables' },
    { href: '/kitchen' },
  ];

  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -205, deltaY: 205, velocityX: -4_000 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -5, deltaY: 5, velocityX: -4_000 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
});

test('an invalid pager viewport cannot commit navigation', () => {
  assert.equal(
    resolvePagerSwipeSettlement(
      [{ href: '/home' }, { href: '/tables' }],
      0,
      { deltaX: -250, deltaY: 0 },
      0,
    ),
    null,
  );
});

test('a swipe beyond either pager edge settles on the current page', () => {
  const items = [{ href: '/home' }, { href: '/tables' }];

  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      0,
      { deltaX: 210, deltaY: 4, velocityX: 320 },
      390,
    ),
    { targetIndex: 0, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -210, deltaY: 4, velocityX: -320 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      0,
      { deltaX: 5, deltaY: 1, velocityX: 300 },
      390,
    ),
    { targetIndex: 0, shouldNavigate: false },
  );
  assert.deepEqual(
    resolvePagerSwipeSettlement(
      items,
      1,
      { deltaX: -5, deltaY: 1, velocityX: -300 },
      390,
    ),
    { targetIndex: 1, shouldNavigate: false },
  );
});

test('an interrupted current pager animation rolls back to the committed page', () => {
  assert.deepEqual(
    resolvePagerAnimationSettlement({
      committedIndex: 1,
      finished: false,
      ownsTransition: true,
      targetIndex: 2,
    }),
    { completed: false, position: 1 },
  );
});

test('a stale interrupted pager animation leaves the newer transition alone', () => {
  assert.equal(
    resolvePagerAnimationSettlement({
      committedIndex: 1,
      finished: false,
      ownsTransition: false,
      targetIndex: 2,
    }),
    null,
  );
});

test('a completed pager animation settles exactly on its target page', () => {
  assert.deepEqual(
    resolvePagerAnimationSettlement({
      committedIndex: 1,
      finished: true,
      ownsTransition: true,
      targetIndex: 2,
    }),
    { completed: true, position: 2 },
  );
});

test('mostly vertical movement is rejected even with enough distance or velocity', () => {
  assert.equal(
    classifyHorizontalSwipe({ deltaX: -72, deltaY: 68, velocityX: -900 }),
    null,
  );
  assert.equal(
    classifyHorizontalSwipe({ deltaX: 12, deltaY: 80, velocityX: 900 }),
    null,
  );
});

test('adjacent navigation targets follow the passed permission-filtered item order', () => {
  const permittedItems = [
    { key: 'home', href: '/home' },
    { key: 'kitchen', href: '/kitchen' },
    { key: 'more', href: '/more' },
  ];

  assert.deepEqual(getAdjacentNavigationTarget(permittedItems, 1, -1), {
    index: 0,
    href: '/home',
  });
  assert.deepEqual(getAdjacentNavigationTarget(permittedItems, 1, 1), {
    index: 2,
    href: '/more',
  });
});

test('adjacent navigation targets stop at both boundaries without wrapping', () => {
  const items = [{ href: '/home' }, { href: '/orders' }];

  assert.equal(getAdjacentNavigationTarget(items, 0, -1), null);
  assert.equal(getAdjacentNavigationTarget(items, items.length - 1, 1), null);
  assert.equal(getAdjacentNavigationTarget([], 0, 1), null);
  assert.equal(getAdjacentNavigationTarget(items, -1, 1), null);
});

test('the tab navigator route name is the canonical navigation index', () => {
  const permittedItems = [
    { key: 'home', href: '/home' },
    { key: 'pos', href: '/tables' },
    { key: 'kitchen', href: '/kitchen' },
  ];

  assert.equal(getNavigationIndexByRouteName(permittedItems, 'home'), 0);
  assert.equal(getNavigationIndexByRouteName(permittedItems, 'tables'), 1);
  assert.equal(getNavigationIndexByRouteName(permittedItems, 'pos'), 1);
  assert.equal(getNavigationIndexByRouteName(permittedItems, 'kitchen'), 2);
  assert.equal(getNavigationIndexByRouteName(permittedItems, 'orders'), -1);
  assert.equal(getNavigationIndexByRouteName(permittedItems, null), -1);
});

// The tab bar dispatches JUMP_TO by route name. It used to send item.key, which
// is only the same string by coincidence: "pos" is served by tables.tsx, so the
// navigator was asked for a route it does not have and answered "The action
// 'JUMP_TO' with payload {"name":"pos"} was not handled by any navigator" while
// the tab stayed put.
test('the JUMP_TO route name is the file behind the tab, not the tab key', () => {
  assert.equal(getNavigationRouteName({ key: 'home', href: '/home' }), 'home');
  assert.equal(getNavigationRouteName({ key: 'pos', href: '/tables' }), 'tables');
  assert.equal(getNavigationRouteName({ key: 'more', href: '/more/' }), 'more');
});

// The real guard: whatever name the tab bar dispatches has to resolve back to
// the same tab. This fails for any future item whose key and href disagree, not
// just the one that broke.
test('every tab dispatches a name that resolves back to itself', () => {
  const permittedItems = [
    { key: 'home', href: '/home' },
    { key: 'pos', href: '/tables' },
    { key: 'kitchen', href: '/kitchen' },
    { key: 'orders', href: '/orders' },
    { key: 'more', href: '/more' },
  ];

  permittedItems.forEach((item, index) => {
    const dispatched = getNavigationRouteName(item);
    assert.equal(
      getNavigationIndexByRouteName(permittedItems, dispatched),
      index,
      `tab ${item.key} dispatches ${dispatched}, which does not resolve back to it`,
    );
  });
});

test('absolute pager position keeps the target scene fixed across route synchronization', () => {
  assert.equal(getPagerSceneTranslateXFromPosition(1, 1, 360), 0);
  assert.equal(getPagerSceneTranslateXFromPosition(2, 1, 360), 360);
  assert.equal(getPagerSceneTranslateXFromPosition(2, 1.5, 360), 180);
  assert.equal(getPagerSceneTranslateXFromPosition(1, 1.5, 360), -180);
  assert.equal(getPagerSceneTranslateXFromPosition(2, 2, 360), 0);
});

test('absolute pager position safely rejects invalid geometry', () => {
  assert.equal(getPagerSceneTranslateXFromPosition(1, Number.NaN, 360), 0);
  assert.equal(getPagerSceneTranslateXFromPosition(1, 1, 0), 0);
  assert.equal(getPagerSceneTranslateXFromPosition(1, 1, -360), 0);
  assert.equal(
    getPagerSceneTranslateXFromPosition(Number.POSITIVE_INFINITY, 1, 360),
    0,
  );
});

// The unit tests above prove the helper is right; this one proves the tab bar
// actually calls it. The bug was not in a function - it was one call site
// passing target.key where a route name belongs, which every pure-logic test in
// this file would happily stay green through.
test('the tab bar dispatches JUMP_TO through getNavigationRouteName', async () => {
  const layout = await readFile(
    new URL('../../app/(primary)/_layout.tsx', import.meta.url),
    'utf8',
  );

  const dispatch = layout.slice(layout.indexOf("type: 'JUMP_TO'"));
  const payload = dispatch.slice(0, dispatch.indexOf('}'));

  assert.match(
    payload,
    /name: getNavigationRouteName\(/,
    'JUMP_TO must carry the route name from getNavigationRouteName',
  );
  assert.doesNotMatch(
    payload,
    /name: \w+\.key/,
    'dispatching an item key asks for a route the navigator does not have',
  );
});

test('the tab-change tick is held back only for a quick return to the tab just left', () => {
  const quick = TAB_CHANGE_RETURN_WINDOW_MS - 1;
  const slow = TAB_CHANGE_RETURN_WINDOW_MS + 1;

  // 2 -> 3 ticks; 3 -> 2 quickly is the undo and is silent.
  let step = resolveTabChangeTick(null, { from: 2, to: 3, now: 1000 });
  assert.equal(step.tick, true);
  step = resolveTabChangeTick(step.memory, { from: 3, to: 2, now: 1000 + quick });
  assert.equal(step.tick, false);
  // ...and after the silent return, going back out to 3 quickly is a new change.
  step = resolveTabChangeTick(step.memory, { from: 2, to: 3, now: 1000 + quick + quick });
  assert.equal(step.tick, true);

  // 2 -> 3, then quickly on to 1 from 2? No: 3 -> 2 (silent), 2 -> 1 quickly ticks.
  step = resolveTabChangeTick(null, { from: 2, to: 3, now: 5000 });
  step = resolveTabChangeTick(step.memory, { from: 3, to: 2, now: 5000 + quick });
  assert.equal(step.tick, false);
  step = resolveTabChangeTick(step.memory, { from: 2, to: 1, now: 5000 + quick + quick });
  assert.equal(step.tick, true);

  // A return that is not quick is an ordinary change.
  step = resolveTabChangeTick(null, { from: 2, to: 3, now: 9000 });
  step = resolveTabChangeTick(step.memory, { from: 3, to: 2, now: 9000 + slow });
  assert.equal(step.tick, true);

  // Going on to a third tab quickly is not a return.
  step = resolveTabChangeTick(null, { from: 2, to: 3, now: 12000 });
  step = resolveTabChangeTick(step.memory, { from: 3, to: 4, now: 12000 + quick });
  assert.equal(step.tick, true);

  // Staying put never ticks and leaves the memory alone.
  const memory = { leftIndex: 2, at: 15000 };
  assert.deepEqual(resolveTabChangeTick(memory, { from: 3, to: 3, now: 15001 }), { tick: false, memory });
});
