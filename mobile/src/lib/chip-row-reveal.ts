// Where a sideways row of chips scrolls so its chosen chip is in view.
//
// The menu draws its category chips twice - the filter bar in the page and the
// compact header's row - and each row scrolls on its own. A chip picked in one
// would otherwise sit past the edge of the other, and that row would read as
// nothing chosen. Kept out of the component so it can be tested without a
// native tree.

/** How much of the neighbouring chip is left showing past the one revealed. */
export const CHIP_REVEAL_MARGIN = 16;

type Box = { x: number; width: number };

/**
 * The row offset that brings `chip` fully into view, or null when it already
 * is, so a row the reader can already see never moves under them. Clamped to
 * the row's own range: iOS does not clamp a programmatic scroll, and a row
 * left past its end shows a blank strip.
 */
export function chipRevealOffset({ chip, offset, viewport, content, margin = CHIP_REVEAL_MARGIN }: {
  chip: Box | null | undefined;
  /** The row's current scroll offset. */
  offset: number;
  /** The row's own width. */
  viewport: number;
  /** The width of every chip together. */
  content: number;
  margin?: number;
}): number | null {
  if (!chip || !(viewport > 0) || !(content > 0) || !Number.isFinite(offset)) return null;
  const left = chip.x;
  const right = chip.x + chip.width;
  let target: number;
  if (left < offset - 0.5) {
    target = left - margin;
  } else if (right > offset + viewport + 0.5) {
    // Never past the chip's own start: a chip wider than the row shows its
    // beginning.
    target = Math.min(left - margin, right - viewport + margin);
  } else {
    return null;
  }
  const clamped = Math.min(Math.max(0, content - viewport), Math.max(0, target));
  return Math.abs(clamped - offset) < 1 ? null : clamped;
}
