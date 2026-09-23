/**
 * How the order-taking screen lays its dishes out. One button in the menu's
 * filter row cycles through the three, and the choice is remembered on the
 * device, because it is about the person holding it (how well they know the
 * menu, how big their screen is), not about the table they are serving.
 *
 * - `grid`: the big photo tiles, two across on a phone. The default, and the
 *   one a new waiter needs: the photo is how they find the dish.
 * - `list`: one dish per row with a small thumbnail, for scanning a long menu
 *   top to bottom.
 * - `compact`: no photos, three or more soft tiles across, for staff who know
 *   the menu by name and want the most dishes on one screen.
 */
export type MenuViewMode = 'grid' | 'list' | 'compact';

/** Cycle order of the view button. */
export const MENU_VIEW_MODES: readonly MenuViewMode[] = Object.freeze(['grid', 'list', 'compact'] as const);

export const DEFAULT_MENU_VIEW_MODE: MenuViewMode = 'grid';

/**
 * The narrowest a compact tile may get before another column no longer fits.
 * Sized for a two-line dish name at 14pt with its price underneath: at 100pt
 * the tile comes out roughly square, and a phone column still holds three.
 */
const COMPACT_TILE_MIN_WIDTH = 100;

/** A phone always gets at least this many compact tiles across. */
const COMPACT_MIN_COLUMNS = 3;

function isMenuViewMode(value: unknown): value is MenuViewMode {
  return typeof value === 'string' && (MENU_VIEW_MODES as readonly string[]).includes(value);
}

/**
 * The saved mode, read back from device storage. Anything that is not one of
 * the three exact names (nothing saved yet, a value from a build that had a
 * mode this one dropped, a failed read) is the default, never an error.
 */
export function parseMenuViewMode(raw: unknown): MenuViewMode {
  return isMenuViewMode(raw) ? raw : DEFAULT_MENU_VIEW_MODE;
}

/** The mode the view button switches to next, wrapping from the last to the first. */
export function nextMenuViewMode(mode: MenuViewMode): MenuViewMode {
  const index = MENU_VIEW_MODES.indexOf(mode);
  // A mode this build does not know has no place in the cycle; start it over.
  if (index < 0) return DEFAULT_MENU_VIEW_MODE;
  return MENU_VIEW_MODES[(index + 1) % MENU_VIEW_MODES.length];
}

const MODE_LABELS: Readonly<Record<MenuViewMode, { th: string; en: string }>> = Object.freeze({
  grid: { th: 'รูปใหญ่', en: 'Photos' },
  list: { th: 'รายการ', en: 'List' },
  compact: { th: 'แบบย่อ', en: 'Compact' },
});

/** The mode's short name, for the view button's accessibility label. */
export function menuViewModeLabel(mode: MenuViewMode, language: 'th' | 'en'): string {
  const labels = MODE_LABELS[parseMenuViewMode(mode)];
  return language === 'en' ? labels.en : labels.th;
}

const MODE_ICONS: Readonly<Record<MenuViewMode, 'grid-outline' | 'list-outline' | 'apps-outline'>> = Object.freeze({
  grid: 'grid-outline',
  list: 'list-outline',
  // The same glyph the table map uses for its dense view, so "small tiles"
  // reads the same wherever it appears.
  compact: 'apps-outline',
});

/** The Ionicons glyph that draws the mode. */
export function menuViewModeIcon(mode: MenuViewMode): 'grid-outline' | 'list-outline' | 'apps-outline' {
  return MODE_ICONS[parseMenuViewMode(mode)];
}

/**
 * How many compact tiles fit across a grid `width` wide with `gap` between
 * them, and how wide each one is so the row runs edge to edge. Never fewer than
 * three: two photo-less tiles across would waste the space the mode exists to
 * save. A wide tablet column takes as many as keep each tile at least
 * `COMPACT_TILE_MIN_WIDTH`. Before the grid is measured (width 0) the answer is
 * three columns of nothing, and the caller draws nothing until it knows more.
 */
export function compactColumns(width: number, gap: number): { columns: number; tileWidth: number } {
  if (!Number.isFinite(width) || width <= 0) return { columns: COMPACT_MIN_COLUMNS, tileWidth: 0 };
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const columns = Math.max(
    COMPACT_MIN_COLUMNS,
    Math.floor((width + safeGap) / (COMPACT_TILE_MIN_WIDTH + safeGap)),
  );
  // Rounded down: a tile a fraction of a point too wide pushes the last one in
  // the row onto a row of its own. Held at zero for a column too narrow to hold
  // even the gaps, so no caller is ever handed a negative width.
  const tileWidth = Math.max(0, Math.floor((width - safeGap * (columns - 1)) / columns));
  return { columns, tileWidth };
}
