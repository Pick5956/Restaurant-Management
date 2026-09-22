/**
 * The flat text box the settings pages introduced (2026-09-19): a tinted fill
 * with no border, `--settings-field` in globals.css with its own dark value.
 * Hover and focus draw a 1px edge inside the box - grey on hover, orange-500 on
 * focus, the same colours every bordered field in the app turns - so the box
 * never changes size. The edge is an inset ring, not a box-shadow, so a caller
 * can still give the box a drop shadow without the shadow vanishing the
 * moment the box is hovered. The heavy 2px orange-700 ring is for buttons and
 * links; on a box someone is typing in it read as a dark frame (owner,
 * 2026-09-21).
 *
 * Used by the settings primitives, ThemedSelect's "filled" and "tinted" faces,
 * and every box on the menu page (2026-09-21: the settings fill and edges, but
 * each box keeps the corner radius it had).
 */
export const FLAT_FIELD_SURFACE = "border-0 bg-(--settings-field)";

export const FLAT_FIELD_EDGE =
  "outline-none ring-inset hover:ring-1 hover:ring-gray-300 focus:ring-1 focus:ring-orange-500 dark:hover:ring-gray-700 dark:focus:ring-orange-500";

/** An invalid flat field keeps a 2px red edge whether it is hovered, focused or neither. */
export const FLAT_FIELD_ERROR = "outline-none ring-2 ring-inset ring-red-700 dark:ring-red-400";

/** One flat field: surface plus the edge it wears now. */
export function flatField(invalid = false): string {
  return `${FLAT_FIELD_SURFACE} ${invalid ? FLAT_FIELD_ERROR : FLAT_FIELD_EDGE}`;
}
