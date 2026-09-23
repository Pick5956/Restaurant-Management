// The collapsing header's arithmetic, kept out of the component so it can be
// tested without a native tree.
//
// AppScreen's expanded heading scrolls away with the content. Once its title
// has gone, a compact bar pinned at the top takes its place: the back button,
// the title on one line and the screen's action. The bar comes in across the
// last stretch of scroll before the title leaves, driven natively by the
// scroll offset; touches and the accessibility tree follow a JS-side switch
// with a little hysteresis, because neither can be driven by the native
// animation.

/** The last stretch of scroll, in points, over which the compact bar comes in. */
export const COMPACT_HEADER_BAND = 24;

/** The compact bar's round buttons. The expanded heading's are 46. */
export const COMPACT_BUTTON = 40;

/** How far into the band the bar has to be before it takes touches. */
export const COMPACT_SHOW_AT = 0.6;

/** How far back out it has to go before it gives them up again. */
export const COMPACT_HIDE_BELOW = 0.4;

/**
 * The scroll offsets the bar comes in across: it starts `band` points before
 * the expanded heading's bottom edge reaches the top of the scroll view, and
 * is fully in when it does.
 */
export function compactHeaderRange(collapseAt: number, band = COMPACT_HEADER_BAND): [number, number] {
  const end = Math.max(1, Number.isFinite(collapseAt) ? collapseAt : 1);
  return [Math.max(0, end - Math.max(1, band)), end];
}

/** 0 while the expanded title is in view, 1 once it has gone. */
export function compactHeaderProgress(offset: number, collapseAt: number, band = COMPACT_HEADER_BAND): number {
  if (!Number.isFinite(offset)) return 0;
  const [start, end] = compactHeaderRange(collapseAt, band);
  return Math.min(1, Math.max(0, (offset - start) / (end - start)));
}

/**
 * Whether the bar is "up" for touches and screen readers. Two thresholds, so a
 * reader resting in the middle of the band does not flip it every frame.
 */
export function nextCompactShown(shown: boolean, progress: number): boolean {
  return shown ? progress > COMPACT_HIDE_BELOW : progress >= COMPACT_SHOW_AT;
}

/**
 * How the screen's own action is fitted into the compact row: scaled down to
 * the bar's button size when it is taller, and moved so its trailing edge
 * stays on the content edge (a scale shrinks toward the centre).
 */
export function compactActionFit(
  box: { width: number; height: number } | null,
  target = COMPACT_BUTTON,
): { scale: number; shiftX: number } {
  if (!box || !(box.height > target) || !(box.width > 0)) return { scale: 1, shiftX: 0 };
  const scale = target / box.height;
  return { scale, shiftX: (box.width * (1 - scale)) / 2 };
}
