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
 */
export function groupMenuByCategory<T extends CatalogItem>(
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
  return [...groups.values()];
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
