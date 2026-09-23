// The menu categories screen's arithmetic: the order the server keeps, moving
// one category to another place, the display_order values a move has to
// write, where a dragged row lands, how far the rows around it step aside,
// how many dishes each category holds, and the name checks the server makes.
//
// There is no reorder endpoint. A category's place is its display_order,
// written through PUT /api/v1/categories/:id one category at a time, so a move
// renumbers the list 1..n and sends only the ones whose number changed.

import type { Category, MenuItem } from '@/src/types/menu';

/** The server's own cap on a category name, in runes (menu_service.go). */
export const CATEGORY_NAME_MAX = 120;

type Ordered = Pick<Category, 'ID' | 'display_order'>;

function orderOf(category: Pick<Category, 'display_order'>): number {
  const value = Number(category.display_order);
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** The server's order: display_order ascending, then ID (repository ListCategories, and the web). */
export function sortCategories<T extends Ordered>(list: readonly T[]): T[] {
  return [...list].sort((left, right) => (orderOf(left) - orderOf(right)) || (left.ID - right.ID));
}

/** The list with the item at `from` taken out and put back at `to`. Out-of-range indexes change nothing. */
export function moveCategory<T>(ordered: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= ordered.length) return [...ordered];
  const target = clamp(to, 0, ordered.length - 1);
  if (target === from) return [...ordered];
  const next = [...ordered];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** One step up (-1) or down (+1) for the category with `id`. The ends stay put. */
export function moveCategoryBy<T extends Pick<Category, 'ID'>>(ordered: readonly T[], id: number, delta: number): T[] {
  const index = ordered.findIndex((category) => category.ID === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return [...ordered];
  return moveCategory(ordered, index, target);
}

/**
 * Numbers an ordering 1..n. `changed` are the categories whose display_order
 * is new, the only ones that need a PUT. Legacy data (all 0, gaps, repeats)
 * renumbers every row the first time.
 */
export function renumberCategories<T extends Pick<Category, 'display_order'>>(ordered: readonly T[]): { categories: T[]; changed: T[] } {
  const categories = ordered.map((category, index) => (
    category.display_order === index + 1 ? category : { ...category, display_order: index + 1 }
  ));
  const changed = categories.filter((category, index) => ordered[index].display_order !== category.display_order);
  return { categories, changed };
}

/** A new category goes last: one past the highest display_order, never below 1 (web parity). */
export function nextCategoryDisplayOrder(list: readonly Pick<Category, 'display_order'>[]): number {
  let highest = 0;
  for (const category of list) highest = Math.max(highest, orderOf(category));
  return highest + 1;
}

/** 1-based place and the count, for "ย้ายไปลำดับ 2". Null when the category is not in the list. */
export function categoryPosition(ordered: readonly Pick<Category, 'ID'>[], id: number): { position: number; total: number } | null {
  const index = ordered.findIndex((category) => category.ID === id);
  return index < 0 ? null : { position: index + 1, total: ordered.length };
}

/**
 * The index a dragged row would drop at. It passes a neighbour once it has
 * travelled past that neighbour's middle. `heights` are the rows' measured
 * heights in their current order; the answer is always a valid index.
 */
export function dragTargetIndex({ fromIndex, offsetY, heights }: { fromIndex: number; offsetY: number; heights: readonly number[] }): number {
  const count = heights.length;
  if (count === 0) return 0;
  const from = clamp(Math.round(fromIndex), 0, count - 1);
  if (!Number.isFinite(offsetY) || offsetY === 0) return from;
  let target = from;
  let travelled = 0;
  if (offsetY > 0) {
    for (let index = from + 1; index < count; index += 1) {
      const height = Math.max(0, heights[index] || 0);
      if (offsetY <= travelled + height / 2) break;
      target = index;
      travelled += height;
    }
    return target;
  }
  for (let index = from - 1; index >= 0; index -= 1) {
    const height = Math.max(0, heights[index] || 0);
    if (-offsetY <= travelled + height / 2) break;
    target = index;
    travelled += height;
  }
  return target;
}

/** How far the row at `index` steps aside while the row from `from` hovers over `to`. */
export function rowShift(index: number, from: number, to: number, liftedHeight: number): number {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -liftedHeight;
  if (to < from && index >= to && index < from) return liftedHeight;
  return 0;
}

/** Where the dragged row settles, measured from its own starting place. */
export function slotOffset(from: number, to: number, heights: readonly number[]): number {
  let offset = 0;
  if (to > from) {
    for (let index = from + 1; index <= to; index += 1) offset += Math.max(0, heights[index] || 0);
    return offset;
  }
  for (let index = to; index < from; index += 1) offset -= Math.max(0, heights[index] || 0);
  return offset;
}

/** How far a dragged row may travel: to the top of the first row, to the bottom of the last. */
export function dragBounds(from: number, heights: readonly number[]): { min: number; max: number } {
  if (heights.length === 0) return { min: 0, max: 0 };
  return {
    min: slotOffset(from, 0, heights),
    max: slotOffset(from, heights.length - 1, heights),
  };
}

type Linked = Pick<MenuItem, 'category_id'> & { categories?: readonly Pick<NonNullable<MenuItem['categories']>[number], 'category_id'>[] | null };

/**
 * Dishes per category, counting a dish's main category and every extra
 * category it is linked to, once per dish - what the server's CategoryInUse
 * refuses a delete over. Every listed category gets an entry, 0 included.
 */
export function categoryDishCounts(
  categories: readonly Pick<Category, 'ID'>[],
  items: readonly Linked[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const category of categories) counts.set(category.ID, 0);
  for (const item of items) {
    const ids = new Set<number>();
    if (item.category_id) ids.add(item.category_id);
    for (const link of item.categories ?? []) {
      if (link?.category_id) ids.add(link.category_id);
    }
    for (const id of ids) {
      const current = counts.get(id);
      if (current !== undefined) counts.set(id, current + 1);
    }
  }
  return counts;
}

/** "3 เมนู", "ไม่มีเมนู": the count under a category's name. */
export function categoryDishLabel(count: number, language: 'th' | 'en'): string {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  if (language === 'th') return value === 0 ? 'ไม่มีเมนู' : `${value.toLocaleString('th-TH')} เมนู`;
  if (value === 0) return 'No dishes';
  return value === 1 ? '1 dish' : `${value.toLocaleString('en-US')} dishes`;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether another category already has this name, compared the way the server's LOWER(name) does. */
export function categoryNameTaken(list: readonly Pick<Category, 'ID' | 'name'>[], name: string, excludeId: number | null = null): boolean {
  const key = nameKey(name);
  if (!key) return false;
  return list.some((category) => category.ID !== excludeId && nameKey(String(category.name ?? '')) === key);
}

export type CategoryNameProblem = 'name_required' | 'name_too_long' | 'name_taken';

/** What the server would refuse about a name, checked before any request. */
export function categoryNameProblem(
  list: readonly Pick<Category, 'ID' | 'name'>[],
  name: string,
  excludeId: number | null = null,
): CategoryNameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return 'name_required';
  if ([...trimmed].length > CATEGORY_NAME_MAX) return 'name_too_long';
  if (categoryNameTaken(list, trimmed, excludeId)) return 'name_taken';
  return null;
}

/**
 * One frame of autoscroll while a row is held near an edge of the visible
 * area: negative scrolls up, positive down, 0 away from the edges. It speeds
 * up the deeper the finger sits in the edge band, up to `maxStep`.
 */
export function autoScrollStep(fingerY: number, top: number, bottom: number, edge = 72, maxStep = 14): number {
  if (!Number.isFinite(fingerY) || bottom <= top) return 0;
  const band = Math.max(1, Math.min(edge, (bottom - top) / 2));
  if (fingerY < top + band) {
    const depth = Math.min(band, top + band - fingerY);
    return -Math.max(1, Math.round((maxStep * depth) / band));
  }
  if (fingerY > bottom - band) {
    const depth = Math.min(band, fingerY - (bottom - band));
    return Math.max(1, Math.round((maxStep * depth) / band));
  }
  return 0;
}

/** A scroll offset held inside [min, max]; a max below min pins it at min. */
export function clampScrollOffset(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
