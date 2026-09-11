import type { Ingredient } from '@/src/types/ingredient';

// The pure part of the inventory list: what counts as low, how rows are found,
// ordered and summed, and the numbers the restock sheet offers. Nothing here
// touches React or the network, so all of it is exercised by
// inventory-list.test.mjs without a device.

export type StockStatus = 'ok' | 'low' | 'out';
export type StatusFilter = 'all' | StockStatus;
export type SortKey = 'urgent' | 'recent' | 'name' | 'value';
/** 'all' · 'none' (uncategorised) · a category id as a string. */
export type CategoryFilter = string;

export function stockStatus(item: Pick<Ingredient, 'stock' | 'min_stock'>): StockStatus {
  const stock = Number(item.stock);
  const min = Number(item.min_stock);
  if (stock <= 0) return 'out';
  if (min > 0 && stock <= min) return 'low';
  return 'ok';
}

/**
 * How full the level bar is, 0..1, or null when this shelf has no observed
 * maximum to measure against.
 *
 * The bar used to divide by twice the reorder level, so its right-hand end was
 * a number nobody had ever chosen — "full" meant "twice the level at which I
 * reorder", which is not a thing anyone knows about their own shelf. It now
 * divides by max_stock, the most the shelf has actually been seen to hold, and
 * the web divides by the same number. One bar, one meaning, both screens.
 */
export function stockShare(item: Pick<Ingredient, 'stock' | 'max_stock'>): number | null {
  const ceiling = Number(item.max_stock ?? 0);
  if (!(ceiling > 0)) return null;
  const share = Number(item.stock) / ceiling;
  return Math.max(0, Math.min(1, share));
}

/**
 * Where the reorder mark sits along that bar, 0..1, or null when it would land
 * at or past the end — a reorder level above everything the shelf has ever held
 * has no place on the bar, and drawing it at the far end would say the shelf is
 * permanently short.
 */
export function reorderShare(item: Pick<Ingredient, 'min_stock' | 'max_stock'>): number | null {
  const ceiling = Number(item.max_stock ?? 0);
  const min = Number(item.min_stock);
  if (!(ceiling > 0) || !(min > 0) || min >= ceiling) return null;
  return min / ceiling;
}

/** The quantity a share of the shelf's maximum works out to. */
export function reorderQuantityFor(maxStock: number, percent: number): number {
  if (!(maxStock > 0) || !(percent > 0)) return 0;
  return Math.round(((maxStock * percent) / 100) * 10000) / 10000;
}

export function filterIngredients(
  items: Ingredient[],
  query: { search: string; category: CategoryFilter; status: StatusFilter },
): Ingredient[] {
  const term = query.search.trim().toLowerCase();
  return items.filter((item) => {
    if (query.status !== 'all' && stockStatus(item) !== query.status) return false;
    if (query.category !== 'all') {
      const own = item.category_id ? String(item.category_id) : 'none';
      if (own !== query.category) return false;
    }
    if (term) {
      const haystack = [item.name, item.sku, item.category?.name].map((value) => String(value || '').toLowerCase());
      if (!haystack.some((value) => value.includes(term))) return false;
    }
    return true;
  });
}

const statusRank: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };

/**
 * "ด่วนก่อน" is the default on the phone: out first, then low, then fine, and
 * inside each bucket the one with the least cover leads. Someone opening this
 * on a phone is standing at the fridge and wants to know what is missing; the
 * web defaults to "recent" because someone at a desk wants to see what moved.
 */
export function sortIngredients(items: Ingredient[], key: SortKey): Ingredient[] {
  const copy = [...items];
  const byName = (a: Ingredient, b: Ingredient) => a.name.localeCompare(b.name, 'th');
  if (key === 'name') return copy.sort(byName);
  if (key === 'value') {
    return copy.sort((a, b) => Number(b.stock) * Number(b.cost_per_unit) - Number(a.stock) * Number(a.cost_per_unit) || byName(a, b));
  }
  if (key === 'recent') {
    return copy.sort((a, b) => {
      const left = a.UpdatedAt ? Date.parse(a.UpdatedAt) : 0;
      const right = b.UpdatedAt ? Date.parse(b.UpdatedAt) : 0;
      return right - left || byName(a, b);
    });
  }
  return copy.sort((a, b) => {
    const rank = statusRank[stockStatus(a)] - statusRank[stockStatus(b)];
    if (rank !== 0) return rank;
    const left = a.days_left ?? Number.POSITIVE_INFINITY;
    const right = b.days_left ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return byName(a, b);
  });
}

export function inventoryTotals(items: Ingredient[]) {
  let value = 0;
  let low = 0;
  let out = 0;
  for (const item of items) {
    value += Number(item.stock) * Number(item.cost_per_unit);
    const status = stockStatus(item);
    if (status === 'low') low += 1;
    if (status === 'out') out += 1;
  }
  return { value, low, out, all: items.length, needsOrder: low + out };
}

/** Rounds to a number a person would type: 50s above a hundred, 5s above ten. */
export function niceQuantity(raw: number): number {
  if (!(raw > 0)) return 1;
  if (raw >= 100) return Math.round(raw / 50) * 50 || 50;
  if (raw >= 10) return Math.round(raw / 5) * 5 || 5;
  return Math.max(1, Math.round(raw));
}

/** Step for the restock stepper: a tenth of the reorder level, in nice numbers. */
export function restockStep(item: Pick<Ingredient, 'stock' | 'min_stock'>): number {
  const min = Number(item.min_stock);
  const base = min > 0 ? min / 10 : Math.max(1, Number(item.stock) / 10);
  return niceQuantity(base);
}

/**
 * The one-tap amounts on the restock sheet: a top-up, a partial order, one
 * reorder level and two. Ten taps on "+" is fine with a mouse and a chore with
 * a thumb. Duplicates after rounding collapse, so a tiny minimum still offers
 * distinct choices rather than four copies of "1".
 */
export function quickAmounts(item: Pick<Ingredient, 'stock' | 'min_stock'>): number[] {
  const min = Number(item.min_stock);
  const base = min > 0 ? min : Math.max(10, Number(item.stock));
  const raw = [base * 0.1, base * 0.4, base, base * 2].map(niceQuantity);
  return [...new Set(raw)].sort((a, b) => a - b);
}

/**
 * What a physical count becomes on the wire. The API refuses an absolute set of
 * zero three layers deep, so an empty shelf is recorded as removing exactly
 * what is left — the same end state. A count equal to the current stock is no
 * change, and returns null so the caller sends nothing.
 */
export function countPayload(
  item: Pick<Ingredient, 'stock'>,
  counted: number,
): { type: 'out' | 'adjust'; quantity: number } | null {
  const stock = Number(item.stock);
  if (!(counted >= 0)) return null;
  if (counted === stock) return null;
  if (counted === 0) return stock > 0 ? { type: 'out', quantity: stock } : null;
  return { type: 'adjust', quantity: counted };
}

/**
 * A restock suggestion: fill the shelf back to the most it has held. Before
 * max_stock existed this aimed at twice the reorder level, which nobody chose;
 * ingredients that still have no observed maximum keep that fallback.
 */
export function suggestedRestock(item: Pick<Ingredient, 'stock' | 'min_stock' | 'max_stock'>): number {
  const ceiling = Number(item.max_stock ?? 0);
  const target = ceiling > 0 ? ceiling : Number(item.min_stock) * 2;
  return Math.max(0, target - Number(item.stock));
}
