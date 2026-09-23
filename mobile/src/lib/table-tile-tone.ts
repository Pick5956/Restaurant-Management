/**
 * Colours for the compact table tile, and only for it.
 *
 * Deliberately a local map rather than an addition to `statusTone`: the detailed
 * card reads `statusTone` too, and the brief for this redesign was the compact
 * view alone. Touching the shared token would have repainted a card nobody asked
 * to change.
 *
 * The tile wears the assistant screen's material — real Liquid Glass on iOS 26,
 * the same translucent-white-and-hairline fallback everywhere else — so `tint`
 * and `fill` are the same colour expressed twice: `tint` is what the glass is
 * tinted with, `fill` is what the fallback paints. Keep them in step.
 *
 * The colours themselves were chosen against a specific failure. `#ECFDF5`, the
 * old free tint, is *lighter* than the cream canvas it sat on — a luminance of
 * 0.93 against 0.94. It was never a tint; it was a hue rotation at the same
 * lightness, which the eye reads as a display colour cast, and it left the state
 * to be carried entirely by the text. Reaching for another Tailwind `-50` would
 * repeat it exactly.
 *
 * Two rules replace it:
 *
 * 1. Every fill is a real step down in lightness from the canvas.
 * 2. The three live states form a LIGHTNESS LADDER — free 0.79, reserved 0.72,
 *    occupied 0.66. That is what makes the redundancy real: fill and word encode
 *    the same hue, so under deuteranopia (~8% of men) that collapses to nothing,
 *    and a waiter who cannot separate the greens still separates light from dark.
 *
 * Contrast, status word on its own fill: free 6.29, reserved 7.06, occupied
 * 5.73, inactive 6.48. On the booking chip: 7.11 / 8.41 / 7.17 / 7.39. Table
 * number on fill: 12.1 and up. All well above AA.
 */
export type TableTileTone = {
  /** What the glass is tinted with on iOS 26. The same colour as `fill`. */
  tint: string;
  /** What the non-glass fallback paints. */
  fill: string;
  /** The status word, and the booking chip's text and icon. */
  ink: string;
  /** The booking chip's background. */
  chip: string;
  /** The wash that floods the tile under a thumb. */
  press: string;
};

/** `takeaway` is not a table state: it paints the open takeaway orders the map lists in their own section. */
export type TableTileStatus = 'free' | 'occupied' | 'reserved' | 'inactive' | 'takeaway';

/**
 * White, not the status ink.
 *
 * A chip darker than the tile it sits on drags its own text down with it — an
 * ink-at-15% version measured 3.96 on an occupied tile, under AA. Lightening
 * puts every pair above 7, it matches the assistant screen's own pills, and an
 * inset lighter pill reads more like a label than a sticker anyway.
 */
const CHIP = 'rgba(255, 255, 255, 0.78)';

export const tableTileTones: Record<TableTileStatus, TableTileTone> = {
  // Warm celadon.
  free: { tint: 'rgba(220, 235, 210, 0.88)', fill: '#DCEBD2', ink: '#275C3B', chip: CHIP, press: '#2F6B45' },
  // Toasted honey. Kept clearly off the brand orange #C2410C so a busy table
  // never reads as a button.
  occupied: { tint: 'rgba(244, 206, 146, 0.90)', fill: '#F4CE92', ink: '#7A3B0B', chip: CHIP, press: '#9A4A0B' },
  // Blue-and-white china. The one blue that flatters a cream ground, where the
  // old electric sky did not.
  reserved: { tint: 'rgba(207, 222, 238, 0.90)', fill: '#CFDEEE', ink: '#17486A', chip: CHIP, press: '#1D5C86' },
  // The palette's own warm dead grey, not a cool slate, so an out-of-service
  // table looks faded rather than imported from another app.
  inactive: { tint: 'rgba(235, 227, 219, 0.85)', fill: '#EBE3DB', ink: '#6B4636', chip: CHIP, press: '#9C8878' },
  // Periwinkle, the web POS's takeaway blue (2026-09-22). Deeper and bluer than
  // the reserved porcelain so a takeaway never reads as a booked table.
  takeaway: { tint: 'rgba(191, 204, 242, 0.90)', fill: '#BFCCF2', ink: '#1E3A8A', chip: CHIP, press: '#1D4ED8' },
};

/**
 * The status a tile paints, which is not always the status on the table row.
 *
 * A table with an active order reads as occupied whatever its own column says,
 * matching the web POS. On a floor, amber means "someone is sitting there", and
 * a busy table tinted green is the one mistake this tile cannot afford.
 */
export function tableTileStatus(tableStatus: string, hasActiveOrder: boolean): TableTileStatus {
  if (hasActiveOrder) return 'occupied';
  if (tableStatus === 'reserved') return 'reserved';
  if (tableStatus === 'inactive') return 'inactive';
  return 'free';
}

export function tileToneFor(status: TableTileStatus): TableTileTone {
  return tableTileTones[status];
}

/**
 * An out-of-service table recedes and is struck through. The strike is not
 * decoration: it is how a paper floor plan marks a table out, and unlike the
 * fill it survives any lighting or colour vision.
 */
export function tileIsMuted(status: TableTileStatus): boolean {
  return status === 'inactive';
}

/** The compact tile's label size when every label fits, and the floor below which it stops shrinking. */
export const TILE_LABEL_FONT = 20;
export const TILE_LABEL_MIN_FONT = 12;

/**
 * One label size for the whole compact grid: the largest, in half points, at
 * which the widest table label still fits the tile (owner, 2026-09-22 - every
 * table name whole, and every name the same size). `widestAtBase` is that label
 * measured at TILE_LABEL_FONT; `available` is the width a tile gives its label.
 * Until both are known the grid shows the full size rather than a flash of
 * tiny labels.
 */
export function sharedTileLabelSize(
  widestAtBase: number,
  available: number,
  // Another grid can share the rule at its own sizes: the table-management
  // plan measures at 18 (under the 19-20 band) and stops at 12.
  base: number = TILE_LABEL_FONT,
  min: number = TILE_LABEL_MIN_FONT,
): number {
  if (!(widestAtBase > 0) || !(available > 0)) return base;
  const fitting = Math.floor(((base * available) / widestAtBase) * 2) / 2;
  return Math.max(min, Math.min(base, fitting));
}
