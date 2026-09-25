// Where AppScreen's page may rest, and where it goes back to when iOS leaves
// it somewhere else.
//
// UIScrollView only springs an out-of-range offset back while a drag or a
// bounce is running. Two things stop that from happening and leave the page
// resting past its end - rows piled under the top, heading gone - until it is
// touched again:
//
// - `scrollEnabled` turning off in the middle of a pan or a bounce. UIKit
//   cancels the pan and freezes the offset where it is; turning it back on
//   does not re-clamp. A lifted category row does exactly this.
// - the content getting shorter. UIScrollView does not clamp contentOffset
//   when contentSize shrinks, and RN only clamps the top on a remount.
//
// Android clamps both itself (ReactScrollView.onLayoutChange), and has no
// rubber band to strand an offset in the first place.

type Bounds = {
  /** The scroll view's content height, padding included. */
  contentHeight: number;
  /** The scroll view's own height. */
  viewportHeight: number;
  /**
   * Room iOS adds under the content on its own: with
   * `contentInsetAdjustmentBehavior="automatic"` a scroll view that runs to the
   * bottom of the display is inset by the home indicator, and a page may rest
   * there legitimately.
   */
  slack?: number;
};

/** The furthest a page can legitimately rest. Never negative. */
export function restingMaxOffset({ contentHeight, viewportHeight, slack = 0 }: Bounds): number {
  if (!Number.isFinite(contentHeight) || !Number.isFinite(viewportHeight)) return 0;
  return Math.max(0, contentHeight + Math.max(0, slack) - viewportHeight);
}

/**
 * Where a page resting outside its range should be sent back to, or null when
 * it is inside it (so nothing moves). A sub-point difference is rounding, not
 * a stranded page.
 *
 * `clampTop` is off for a page with a refresh control: a refresh in progress
 * holds the offset negative on purpose, to show the spinner.
 */
export function strandedScrollTarget({
  offset,
  clampTop = true,
  ...bounds
}: Bounds & { offset: number; clampTop?: boolean }): number | null {
  if (!Number.isFinite(offset)) return null;
  const max = restingMaxOffset(bounds);
  if (offset > max + 1) return max;
  if (clampTop && offset < -1) return 0;
  return null;
}
