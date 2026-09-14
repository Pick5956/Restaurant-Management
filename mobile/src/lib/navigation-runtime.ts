type StackResetRouter<Href> = {
  canDismiss: () => boolean;
  dismissAll: () => void;
  replace: (href: Href) => void;
};

export type HorizontalSwipeDirection = -1 | 1;

export type HorizontalSwipeSample = Readonly<{
  deltaX: number;
  deltaY: number;
  velocityX?: number;
}>;

export type HorizontalSwipeThresholds = Readonly<{
  distance?: number;
  velocity?: number;
  dominanceRatio?: number;
}>;

export type NavigationItemWithHref<Href> = Readonly<{
  href: Href;
}>;

export type NavigationItemWithRouteName = Readonly<{
  key: string;
  href: string;
}>;

export type AdjacentNavigationTarget<Href> = Readonly<{
  index: number;
  href: Href;
}>;

export type PagerSwipeSettlement = Readonly<{
  targetIndex: number;
  shouldNavigate: boolean;
}>;

export type PagerAnimationSettlement = Readonly<{
  completed: boolean;
  position: number;
}>;

export type PagerDockSelectionPlan = Readonly<{
  animation: 'none';
  interruptsTransition: boolean;
  position: number;
  shouldNavigate: boolean;
}>;

export type PagerGestureStartPlan = Readonly<{
  routeIndexToReaffirm: number | null;
  startIndex: number;
}>;

export type PagerRouteSyncAction =
  | 'acknowledge'
  | 'ignore-stale'
  | 'reconcile';

export type PhoneNavigationIndicatorMetrics = Readonly<{
  indicatorInset: number;
  indicatorWidth: number;
  slotWidth: number;
}>;

const DEFAULT_SWIPE_DISTANCE = 48;
const DEFAULT_SWIPE_VELOCITY = 600;
const DEFAULT_SWIPE_DOMINANCE_RATIO = 1.25;
const PAGER_SWIPE_COMMIT_FRACTION = 0.5;
export const PAGER_SWIPE_MIN_DISTANCE = 5;
const PAGER_FLICK_MIN_VELOCITY = 300;
const PAGER_RESPONDER_DOMINANCE_RATIO = 1.35;
export const PAGER_VERTICAL_SCROLL_COOLDOWN_MS = 30;
const PAGER_BASE_SETTLE_DURATION_MS = 180;
const PAGER_NAVIGATION_STEP_DURATION_MS = 40;
const PAGER_NAVIGATION_MAX_DURATION_MS = 280;
const PAGER_POST_RELEASE_SETTLE_DURATION_MS = 500;

export function resetRouteStack<Href>(router: StackResetRouter<Href>, href: Href) {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace(href);
}

export function resolvePhoneNavigationIndicatorMetrics(
  dockWidth: number,
  itemCount: number,
  desiredInset: number,
): PhoneNavigationIndicatorMetrics | null {
  if (
    !Number.isFinite(dockWidth) ||
    dockWidth <= 0 ||
    !Number.isInteger(itemCount) ||
    itemCount <= 0 ||
    !Number.isFinite(desiredInset) ||
    desiredInset < 0
  ) {
    return null;
  }

  const slotWidth = dockWidth / itemCount;
  const indicatorInset = Math.min(desiredInset, slotWidth / 2);

  return {
    indicatorInset,
    indicatorWidth: Math.max(slotWidth - indicatorInset * 2, 0),
    slotWidth,
  };
}

export function shouldOpenSettings(pathname: string) {
  return pathname !== '/settings' && !pathname.startsWith('/settings/');
}

export function notePagerVerticalScrollActivity(
  blockedUntil: number,
  activityTimeMs: number,
) {
  const currentDeadline = Number.isFinite(blockedUntil) ? blockedUntil : 0;
  if (!Number.isFinite(activityTimeMs)) return currentDeadline;

  return Math.max(
    currentDeadline,
    activityTimeMs + PAGER_VERTICAL_SCROLL_COOLDOWN_MS,
  );
}

export function isPagerSwipeCooldownActive(
  blockedUntil: number,
  currentTimeMs: number,
) {
  return Number.isFinite(blockedUntil) &&
    Number.isFinite(currentTimeMs) &&
    currentTimeMs < blockedUntil;
}

export function shouldStartPagerHorizontalSwipe(
  { deltaX, deltaY }: HorizontalSwipeSample,
  swipeBlocked: boolean,
) {
  if (swipeBlocked || ![deltaX, deltaY].every(Number.isFinite)) return false;

  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  return horizontalDistance >= PAGER_SWIPE_MIN_DISTANCE &&
    horizontalDistance > verticalDistance * PAGER_RESPONDER_DOMINANCE_RATIO;
}

export function classifyHorizontalSwipe(
  { deltaX, deltaY, velocityX = 0 }: HorizontalSwipeSample,
  {
    distance = DEFAULT_SWIPE_DISTANCE,
    velocity = DEFAULT_SWIPE_VELOCITY,
    dominanceRatio = DEFAULT_SWIPE_DOMINANCE_RATIO,
  }: HorizontalSwipeThresholds = {},
): HorizontalSwipeDirection | null {
  if (![deltaX, deltaY, velocityX].every(Number.isFinite)) {
    return null;
  }

  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  const requiredDominance = Math.max(1, dominanceRatio);

  if (
    horizontalDistance <= verticalDistance * requiredDominance ||
    (horizontalDistance < Math.max(0, distance) &&
      Math.abs(velocityX) < Math.max(0, velocity))
  ) {
    return null;
  }

  return deltaX < 0 ? 1 : -1;
}

export function getAdjacentNavigationTarget<Href>(
  items: readonly NavigationItemWithHref<Href>[],
  activeIndex: number,
  direction: HorizontalSwipeDirection,
): AdjacentNavigationTarget<Href> | null {
  if (
    !Number.isInteger(activeIndex) ||
    activeIndex < 0 ||
    activeIndex >= items.length
  ) {
    return null;
  }

  const index = activeIndex + direction;
  const item = items[index];

  return item ? { index, href: item.href } : null;
}

export function resolvePagerSwipeSettlement<Href>(
  items: readonly NavigationItemWithHref<Href>[],
  activeIndex: number,
  sample: HorizontalSwipeSample,
  viewportWidth: number,
): PagerSwipeSettlement | null {
  if (
    !Number.isInteger(activeIndex) ||
    activeIndex < 0 ||
    activeIndex >= items.length ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    return null;
  }

  const commitDistance = viewportWidth * PAGER_SWIPE_COMMIT_FRACTION;
  const { deltaX, deltaY, velocityX = 0 } = sample;
  const horizontalDistance = Math.abs(deltaX);
  const hasMatchingFlickDirection = Math.sign(velocityX) === Math.sign(deltaX);
  const isFastFlick = horizontalDistance >= PAGER_SWIPE_MIN_DISTANCE &&
    Number.isFinite(velocityX) &&
    Math.abs(velocityX) >= PAGER_FLICK_MIN_VELOCITY &&
    hasMatchingFlickDirection;
  const direction = horizontalDistance >= commitDistance
    ? classifyHorizontalSwipe(
      { deltaX, deltaY },
      { distance: commitDistance },
    )
    : isFastFlick
      ? classifyHorizontalSwipe(
        { deltaX, deltaY, velocityX },
        {
          distance: commitDistance,
          velocity: PAGER_FLICK_MIN_VELOCITY,
        },
      )
      : null;
  const adjacent = direction
    ? getAdjacentNavigationTarget(items, activeIndex, direction)
    : null;

  return adjacent
    ? { targetIndex: adjacent.index, shouldNavigate: true }
    : { targetIndex: activeIndex, shouldNavigate: false };
}

export function resolvePagerAnimationDuration({
  navigateAfterAnimation,
  settleAfterGesture,
  travel,
}: {
  navigateAfterAnimation: boolean;
  settleAfterGesture: boolean;
  travel: number;
}) {
  const normalizedTravel = Number.isFinite(travel) ? Math.max(0, travel) : 0;
  const baseDuration = navigateAfterAnimation
    ? Math.min(
      PAGER_NAVIGATION_MAX_DURATION_MS,
      PAGER_BASE_SETTLE_DURATION_MS +
        Math.ceil(normalizedTravel) * PAGER_NAVIGATION_STEP_DURATION_MS,
    )
    : PAGER_BASE_SETTLE_DURATION_MS;

  return settleAfterGesture && navigateAfterAnimation
    ? PAGER_POST_RELEASE_SETTLE_DURATION_MS
    : baseDuration;
}

export function resolvePagerDockSelectionPlan({
  committedIndex,
  itemCount,
  pendingRouteIndex,
  targetIndex,
  transitionActive,
}: {
  committedIndex: number;
  itemCount: number;
  pendingRouteIndex: number | null;
  targetIndex: number;
  transitionActive: boolean;
}): PagerDockSelectionPlan | null {
  if (
    !Number.isInteger(committedIndex) ||
    committedIndex < 0 ||
    committedIndex >= itemCount ||
    !Number.isInteger(itemCount) ||
    itemCount <= 0 ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= itemCount
  ) {
    return null;
  }

  const supersedesPendingRoute = pendingRouteIndex !== null &&
    pendingRouteIndex !== targetIndex;

  return {
    animation: 'none',
    interruptsTransition: transitionActive || pendingRouteIndex !== null,
    position: targetIndex,
    shouldNavigate: targetIndex !== committedIndex || supersedesPendingRoute,
  };
}

export function resolvePagerGestureStartPlan({
  committedIndex,
  itemCount,
  pendingRouteIndex,
}: {
  committedIndex: number;
  itemCount: number;
  pendingRouteIndex: number | null;
}): PagerGestureStartPlan | null {
  if (
    !Number.isInteger(itemCount) ||
    itemCount <= 0 ||
    !Number.isInteger(committedIndex) ||
    committedIndex < 0 ||
    committedIndex >= itemCount
  ) {
    return null;
  }

  const hasValidPendingRoute = pendingRouteIndex !== null &&
    Number.isInteger(pendingRouteIndex) &&
    pendingRouteIndex >= 0 &&
    pendingRouteIndex < itemCount;
  const startIndex = hasValidPendingRoute
    ? pendingRouteIndex
    : committedIndex;

  return {
    routeIndexToReaffirm: hasValidPendingRoute && startIndex !== committedIndex
      ? startIndex
      : null,
    startIndex,
  };
}

export function resolvePagerRouteSyncAction({
  activeIndex,
  pendingRouteIndex,
  permittedItemsChanged,
}: {
  activeIndex: number;
  pendingRouteIndex: number | null;
  permittedItemsChanged: boolean;
}): PagerRouteSyncAction {
  if (permittedItemsChanged || pendingRouteIndex === null) {
    return 'reconcile';
  }

  return activeIndex === pendingRouteIndex
    ? 'acknowledge'
    : 'ignore-stale';
}

export function resolvePagerAnimationSettlement({
  committedIndex,
  finished,
  ownsTransition,
  targetIndex,
}: {
  committedIndex: number;
  finished: boolean;
  ownsTransition: boolean;
  targetIndex: number;
}): PagerAnimationSettlement | null {
  if (!ownsTransition) return null;

  return finished
    ? { completed: true, position: targetIndex }
    : { completed: false, position: committedIndex };
}

export function getNavigationIndexByRouteName(
  items: readonly NavigationItemWithRouteName[],
  routeName: string | null | undefined,
): number {
  if (!routeName) return -1;

  const normalizedRouteName = routeName
    .split('/')
    .filter((segment) => segment && !(segment.startsWith('(') && segment.endsWith(')')))
    .at(-1);

  if (!normalizedRouteName) return -1;

  return items.findIndex((item) =>
    item.key === normalizedRouteName ||
    item.href.replace(/^\/+|\/+$/g, '') === normalizedRouteName
  );
}

// The route name a JUMP_TO for this item has to carry.
//
// The tabs navigator names its routes after the files in app/(primary), so the
// name is the item's href, not its key. Those agree for every primary tab
// except "pos", whose screen is tables.tsx: dispatching its key asks for a
// route named "pos" that no navigator has, and React Navigation answers with
// "The action 'JUMP_TO' with payload {\"name\":\"pos\"} was not handled by any
// navigator" while the tab stays where it was.
//
// getNavigationIndexByRouteName already accepts either spelling on the way
// back, which is why the mismatch only ever showed on the outbound trip.
export function getNavigationRouteName(
  item: NavigationItemWithRouteName,
): string {
  return item.href.replace(/^\/+|\/+$/g, '');
}

export function getPagerSceneTranslateXFromPosition(
  sceneIndex: number,
  pagerPosition: number,
  viewportWidth: number,
): number {
  if (
    !Number.isInteger(sceneIndex) ||
    !Number.isFinite(pagerPosition) ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    return 0;
  }

  const translateX = (sceneIndex - pagerPosition) * viewportWidth;
  return Number.isFinite(translateX) ? translateX : 0;
}

// The dock's tab-change tick, and when to hold it back.
//
// A quick there-and-back - 2 to 3, then 3 back to 2 inside the window - is one
// gesture that changed nothing, and ticking twice for it was reported as
// noise. So the return leg is silent when it lands on the tab the previous
// change LEFT, within the window. Only that exact pair: from 2 the next quick
// step to 1 ticks, and after a silent return the memory is cleared, so going
// back out to 3 again ticks too - it is a new change, not an undo.
export const TAB_CHANGE_RETURN_WINDOW_MS = 600;

export type TabChangeTickMemory = {
  leftIndex: number;
  at: number;
} | null;

export function resolveTabChangeTick(
  memory: TabChangeTickMemory,
  change: { from: number; to: number; now: number },
): { tick: boolean; memory: TabChangeTickMemory } {
  if (change.from === change.to) return { tick: false, memory };
  const isQuickReturn = memory !== null
    && change.to === memory.leftIndex
    && change.now - memory.at < TAB_CHANGE_RETURN_WINDOW_MS;
  if (isQuickReturn) return { tick: false, memory: null };
  return { tick: true, memory: { leftIndex: change.from, at: change.now } };
}
