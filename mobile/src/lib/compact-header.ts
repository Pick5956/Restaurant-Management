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
//
// The bar's optional row (the controls a long list is read through) does not
// come in with the title. It waits for the page's own copy of those controls
// to slide up under it and takes over at that exact offset - the hand-off -
// so the two rows are never both on screen (owner, 24 ก.ย. 2569: the menu's
// chips showed twice, the bar's row over the page's row peeking out beneath).

/** The last stretch of scroll, in points, over which the compact bar comes in. */
export const COMPACT_HEADER_BAND = 24;

/** The compact bar's round buttons. The expanded heading's are 46. */
export const COMPACT_BUTTON = 40;

/** How far into the band the bar has to be before it takes touches. */
export const COMPACT_SHOW_AT = 0.6;

/** How far back out it has to go before it gives them up again. */
export const COMPACT_HIDE_BELOW = 0.4;

/** The bar's padding above its title row, below the status bar. */
export const COMPACT_BAR_PADDING_TOP = 6;

/** The bar's padding under its last row. */
export const COMPACT_BAR_PADDING_BOTTOM = 8;

/** Between the title row and the row under it. */
export const COMPACT_ROW_GAP = 8;

/**
 * The stretch of scroll over which the row takes over from the page's own
 * controls. Short on purpose: the two are the same controls in the same place
 * at the hand-off, so a long crossfade would only show them twice.
 */
export const COMPACT_ROW_BAND = 4;

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
 * The scroll offset at which the bar's row takes over from the page's own
 * row: where the page row's centre line meets the slot's centre line, so the
 * controls stay put through the hand-off whatever the two rows' heights.
 *
 * Never before the title has come in (`collapseAt`): a row pinned over a
 * heading still on screen would be a second header. A page whose row sits
 * right under its heading hands off with the title, as it did before.
 *
 * `anchor` is the page row's box in the scroll content (`contentTop` plus its
 * position in the content view); `slot` is the bar's row box measured from the
 * top edge of the scroll view.
 */
export function compactRowHandoff({ contentTop, anchor, slot, collapseAt }: {
  contentTop: number;
  anchor: { y: number; height: number };
  slot: { y: number; height: number };
  collapseAt: number;
}): number {
  const pageCentre = contentTop + anchor.y + anchor.height / 2;
  const slotCentre = slot.y + slot.height / 2;
  const at = Math.round(pageCentre - slotCentre);
  return Math.max(Number.isFinite(collapseAt) ? collapseAt : 0, Number.isFinite(at) ? at : 0);
}

/** The scroll offsets the row comes in across, ending at the hand-off. */
export function compactRowRange(handoffAt: number, band = COMPACT_ROW_BAND): [number, number] {
  const end = Math.max(1, Number.isFinite(handoffAt) ? handoffAt : 1);
  return [Math.max(0, end - Math.max(1, band)), end];
}

/** 0 while the page's own row is still below the slot, 1 from the hand-off on. */
export function compactRowProgress(offset: number, handoffAt: number, band = COMPACT_ROW_BAND): number {
  if (!Number.isFinite(offset)) return 0;
  const [start, end] = compactRowRange(handoffAt, band);
  return Math.min(1, Math.max(0, (offset - start) / (end - start)));
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
