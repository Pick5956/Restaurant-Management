type CatalogItem = {
  ID: number;
  name: string;
  description?: string | null;
  category_id: number;
  categories?: readonly { category_id: number }[];
};

type CatalogCategory = {
  ID: number;
  name: string;
};

type StockItem = {
  is_available: boolean;
  /** Portions the stock can still make after what queued orders have claimed;
   *  null or absent means the dish has no recipe and is never stock-limited. */
  remaining_servings?: number | null;
};

/**
 * A dish that cannot go on an order right now: switched off by hand, or the
 * last portion its ingredients can make is already claimed. The grid used to
 * check only the switch, so a dish that ran out of stock still looked
 * orderable. Same rule as the web POS tile. It is read from the data the
 * order screen loaded when it opened; the screen does not poll, so a dish that
 * sells out while it sits open is refused by the add itself, as a toast.
 */
export function isMenuSoldOut(item: StockItem): boolean {
  return !item.is_available || (typeof item.remaining_servings === 'number' && item.remaining_servings <= 0);
}

/** Portions left at or below which the stock badge turns amber. */
export const LOW_STOCK_SERVINGS = 10;

export type MenuStockBadge =
  | { kind: 'low' | 'plenty'; count: number }
  | { kind: 'unlimited' };

/**
 * The badge beside a dish's price on the order grid: how many portions are
 * left, amber at ten or fewer, or "not limited" for a dish with no recipe. Every
 * orderable dish carries one (owner, 2026-09-22, the same rule as the web POS
 * tile); a sold-out dish gets none, since its sold-out word already answers.
 */
export function menuStockBadge(item: StockItem): MenuStockBadge | null {
  if (isMenuSoldOut(item)) return null;
  if (typeof item.remaining_servings !== 'number') return { kind: 'unlimited' };
  const count = item.remaining_servings;
  return { kind: count <= LOW_STOCK_SERVINGS ? 'low' : 'plenty', count };
}

/**
 * How many dish tiles fit across a grid `width` wide, and how wide each one is
 * so the row runs edge to edge. On a tablet the grid shares the screen with the
 * dish panel, so it is sized from the column it was given rather than from the
 * window. Never fewer than two across: one photo per row reads as a list.
 */
export function menuGridColumns(width: number, minTile: number, gap: number): { columns: number; tileWidth: number } {
  if (!Number.isFinite(width) || width <= 0) return { columns: 2, tileWidth: 0 };
  const columns = Math.max(2, Math.floor((width + gap) / (minTile + gap)));
  // Rounded down: a tile a fraction of a point too wide pushes the last one in
  // the row onto a row of its own.
  const tileWidth = Math.floor((width - gap * (columns - 1)) / columns);
  return { columns, tileWidth };
}

export type MenuCatalogGroup<T> = {
  key: string;
  label: string;
  items: T[];
};

/**
 * The menu picker's category-and-search filter. `categoryId` is the Select's
 * value: `'all'`, or a category id as a string. A dish linked into a category
 * matches it as well as its main one.
 */
export function filterMenuCatalog<T extends CatalogItem>(
  items: readonly T[] | null | undefined,
  { categoryId, search }: { categoryId: string; search: string },
): T[] {
  const keyword = search.trim().toLowerCase();
  const wanted = Number(categoryId);
  return (items || []).filter((item) => {
    const categoryMatch = categoryId === 'all'
      || item.category_id === wanted
      || Boolean(item.categories?.some((link) => link.category_id === wanted));
    const searchMatch = !keyword
      || [item.name, item.description].some((value) => String(value || '').toLowerCase().includes(keyword));
    return categoryMatch && searchMatch;
  });
}

/**
 * Buckets dishes under their main category, in the order the menu lists them.
 * Grouped the way the table map groups by zone: a flat run of dishes gives no
 * clue where one part of the menu ends and the next begins.
 *
 * Inside each category the dishes that can be ordered come first and the sold
 * out ones (`isMenuSoldOut`) sink to the bottom, each part keeping the menu's
 * order (owner, 2026-09-24). Only the dishes move: a category keeps its place
 * even when everything in it is sold out, so the menu's shape stays the same
 * through the day.
 */
export function groupMenuByCategory<T extends CatalogItem & StockItem>(
  items: readonly T[],
  categories: readonly CatalogCategory[],
  uncategorisedLabel: string,
): MenuCatalogGroup<T>[] {
  const nameById = new Map(categories.map((category) => [category.ID, category.name]));
  const groups = new Map<string, MenuCatalogGroup<T>>();
  items.forEach((item) => {
    const key = String(item.category_id || 0);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      return;
    }
    groups.set(key, { key, label: nameById.get(item.category_id) || uncategorisedLabel, items: [item] });
  });
  return [...groups.values()].map((group) => ({ ...group, items: soldOutLast(group.items) }));
}

/** Orderable dishes, then sold-out ones, each in the order they came in. */
function soldOutLast<T extends StockItem>(items: readonly T[]): T[] {
  const orderable: T[] = [];
  const soldOut: T[] = [];
  items.forEach((item) => (isMenuSoldOut(item) ? soldOut : orderable).push(item));
  return [...orderable, ...soldOut];
}

/**
 * Quantity per dish across the order lines that were not there when the page
 * opened (`baselineIds`), skipping cancelled ones. The served-item page badges
 * its tiles with this: the item screen does the adding, so the page learns what
 * landed only from the order it reloads on the way back.
 */
export function addedQuantityByMenu(
  items: readonly { ID?: number; menu_id?: number; status?: string; quantity?: number }[] | null | undefined,
  baselineIds: ReadonlySet<number>,
): Map<number, number> {
  const counts = new Map<number, number>();
  (items || []).forEach((item) => {
    if (typeof item.ID !== 'number' || baselineIds.has(item.ID) || item.status === 'cancelled') return;
    const menuId = item.menu_id;
    const quantity = item.quantity;
    if (!Number.isInteger(menuId) || (menuId as number) <= 0) return;
    if (!Number.isFinite(quantity) || (quantity as number) <= 0) return;
    counts.set(menuId as number, (counts.get(menuId as number) ?? 0) + (quantity as number));
  });
  return counts;
}
