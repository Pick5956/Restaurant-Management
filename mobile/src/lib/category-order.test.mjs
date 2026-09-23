import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORY_NAME_MAX,
  autoScrollStep,
  categoryDishCounts,
  categoryDishLabel,
  categoryNameProblem,
  categoryNameTaken,
  categoryPosition,
  clampScrollOffset,
  dragBounds,
  dragTargetIndex,
  moveCategory,
  moveCategoryBy,
  nextCategoryDisplayOrder,
  renumberCategories,
  rowShift,
  slotOffset,
  sortCategories,
} from './category-order.ts';

const cat = (ID, display_order, name = `หมวด ${ID}`, is_active = true) => ({ ID, restaurant_id: 1, name, display_order, is_active });

test('categories sort the way the server lists them: display_order, then ID', () => {
  const sorted = sortCategories([cat(5, 2), cat(3, 1), cat(1, 2), cat(9, 0)]);
  assert.deepEqual(sorted.map((c) => c.ID), [9, 3, 1, 5]);
});

test('sorting never mutates the list it was given', () => {
  const list = [cat(2, 2), cat(1, 1)];
  sortCategories(list);
  assert.deepEqual(list.map((c) => c.ID), [2, 1]);
});

test('a move takes one category out and puts it back at the new place', () => {
  const list = [cat(1, 1), cat(2, 2), cat(3, 3), cat(4, 4)];
  assert.deepEqual(moveCategory(list, 0, 2).map((c) => c.ID), [2, 3, 1, 4]);
  assert.deepEqual(moveCategory(list, 3, 0).map((c) => c.ID), [4, 1, 2, 3]);
  assert.deepEqual(moveCategory(list, 1, 1).map((c) => c.ID), [1, 2, 3, 4]);
  // A target past the end lands at the end; a bad source changes nothing.
  assert.deepEqual(moveCategory(list, 0, 99).map((c) => c.ID), [2, 3, 4, 1]);
  assert.deepEqual(moveCategory(list, -1, 2).map((c) => c.ID), [1, 2, 3, 4]);
  assert.deepEqual(list.map((c) => c.ID), [1, 2, 3, 4], 'the original list is untouched');
});

test('one step up or down moves a single place, and the ends stay put', () => {
  const list = [cat(1, 1), cat(2, 2), cat(3, 3)];
  assert.deepEqual(moveCategoryBy(list, 2, -1).map((c) => c.ID), [2, 1, 3]);
  assert.deepEqual(moveCategoryBy(list, 2, 1).map((c) => c.ID), [1, 3, 2]);
  assert.deepEqual(moveCategoryBy(list, 1, -1).map((c) => c.ID), [1, 2, 3]);
  assert.deepEqual(moveCategoryBy(list, 3, 1).map((c) => c.ID), [1, 2, 3]);
  assert.deepEqual(moveCategoryBy(list, 42, 1).map((c) => c.ID), [1, 2, 3]);
});

test('renumbering writes 1..n and reports only the categories whose number changed', () => {
  const ordered = [cat(2, 2), cat(1, 1), cat(3, 3)];
  const { categories, changed } = renumberCategories(ordered);
  assert.deepEqual(categories.map((c) => [c.ID, c.display_order]), [[2, 1], [1, 2], [3, 3]]);
  assert.deepEqual(changed.map((c) => c.ID), [2, 1]);
  assert.equal(categories[2], ordered[2], 'an unchanged category is the same object');
  assert.equal(ordered[0].display_order, 2, 'the input is not mutated');
});

test('legacy orders (all zero, gaps, repeats) renumber every row that is off', () => {
  const { changed } = renumberCategories([cat(1, 0), cat(2, 0), cat(3, 7), cat(4, 4)]);
  assert.deepEqual(changed.map((c) => [c.ID, c.display_order]), [[1, 1], [2, 2], [3, 3]]);
});

test('a renumbered category keeps its name and its hidden flag', () => {
  const { changed } = renumberCategories([cat(9, 5, 'ของหวาน', false)]);
  assert.deepEqual(changed, [{ ID: 9, restaurant_id: 1, name: 'ของหวาน', display_order: 1, is_active: false }]);
});

test('a new category goes after the highest display_order, never at or below 0', () => {
  assert.equal(nextCategoryDisplayOrder([]), 1);
  assert.equal(nextCategoryDisplayOrder([cat(1, 1), cat(2, 9), cat(3, 4)]), 10);
  // categories.length + 1 would have been 3 and collided with the gap-filled 3.
  assert.equal(nextCategoryDisplayOrder([cat(1, 3), cat(2, 3)]), 4);
  assert.equal(nextCategoryDisplayOrder([cat(1, -3), cat(2, 0)]), 1);
});

test('a category position is 1-based with the total', () => {
  const list = [cat(4, 1), cat(7, 2)];
  assert.deepEqual(categoryPosition(list, 7), { position: 2, total: 2 });
  assert.equal(categoryPosition(list, 1), null);
});

test('a dragged row passes a neighbour once it has travelled past its middle', () => {
  const heights = [60, 60, 60, 60];
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: 29, heights }), 0);
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: 31, heights }), 1);
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: 91, heights }), 2);
  assert.equal(dragTargetIndex({ fromIndex: 3, offsetY: -31, heights }), 2);
  assert.equal(dragTargetIndex({ fromIndex: 3, offsetY: -151, heights }), 0);
});

test('the drag target is clamped to the list and follows uneven row heights', () => {
  assert.equal(dragTargetIndex({ fromIndex: 1, offsetY: 5000, heights: [60, 72, 60] }), 2);
  assert.equal(dragTargetIndex({ fromIndex: 1, offsetY: -5000, heights: [60, 72, 60] }), 0);
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: 40, heights: [60, 100, 60] }), 0, 'the tall row needs 50');
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: 51, heights: [60, 100, 60] }), 1);
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: 0, heights: [] }), 0);
  assert.equal(dragTargetIndex({ fromIndex: 9, offsetY: 0, heights: [60, 60] }), 1);
  assert.equal(dragTargetIndex({ fromIndex: 0, offsetY: Number.NaN, heights: [60, 60] }), 0);
});

test('rows between the start and the target step aside by the lifted row height', () => {
  // Dragging index 1 down to 3: rows 2 and 3 move up.
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => rowShift(index, 1, 3, 72)), [0, 0, -72, -72, 0]);
  // Dragging index 3 up to 1: rows 1 and 2 move down.
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => rowShift(index, 3, 1, 72)), [0, 72, 72, 0, 0]);
  assert.deepEqual([0, 1, 2].map((index) => rowShift(index, 1, 1, 72)), [0, 0, 0]);
});

test('the lifted row settles exactly over the rows it passed', () => {
  const heights = [60, 72, 60, 80];
  assert.equal(slotOffset(0, 2, heights), 132);
  assert.equal(slotOffset(3, 1, heights), -132);
  assert.equal(slotOffset(2, 2, heights), 0);
  assert.deepEqual(dragBounds(1, heights), { min: -60, max: 140 });
  assert.deepEqual(dragBounds(0, []), { min: 0, max: 0 });
});

test('dish counts include extra category links, once per dish, like the server delete guard', () => {
  const categories = [cat(1, 1), cat(2, 2), cat(3, 3)];
  const items = [
    { category_id: 1, categories: [{ category_id: 1 }, { category_id: 2 }] },
    { category_id: 2 },
    { category_id: 2, categories: [{ category_id: 2 }] },
    { category_id: 99, categories: [{ category_id: 1 }] },
    { category_id: 0, categories: null },
  ];
  const counts = categoryDishCounts(categories, items);
  assert.equal(counts.get(1), 2);
  assert.equal(counts.get(2), 3);
  assert.equal(counts.get(3), 0, 'an empty category reads 0, not missing');
  assert.equal(counts.has(99), false, 'a category not on the screen is not counted');
});

test('the dish count under a name says none in words', () => {
  assert.equal(categoryDishLabel(0, 'th'), 'ไม่มีเมนู');
  assert.equal(categoryDishLabel(12, 'th'), '12 เมนู');
  assert.equal(categoryDishLabel(1200, 'th'), '1,200 เมนู');
  assert.equal(categoryDishLabel(0, 'en'), 'No dishes');
  assert.equal(categoryDishLabel(1, 'en'), '1 dish');
  assert.equal(categoryDishLabel(3, 'en'), '3 dishes');
  assert.equal(categoryDishLabel(-2, 'th'), 'ไม่มีเมนู');
});

test('a name is taken the way the server compares: trimmed and case-insensitive, never against itself', () => {
  const list = [cat(1, 1, 'Drinks'), cat(2, 2, 'ของหวาน')];
  assert.equal(categoryNameTaken(list, '  drinks '), true);
  assert.equal(categoryNameTaken(list, 'ของหวาน'), true);
  assert.equal(categoryNameTaken(list, 'Drinks', 1), false, 'renaming a category to its own name');
  assert.equal(categoryNameTaken(list, 'DRINKS', 2), true);
  assert.equal(categoryNameTaken(list, 'Soup'), false);
  assert.equal(categoryNameTaken(list, '   '), false);
});

test('the name problems are checked in the server order: empty, too long, taken', () => {
  const list = [cat(1, 1, 'Drinks')];
  assert.equal(categoryNameProblem(list, '  '), 'name_required');
  assert.equal(categoryNameProblem(list, 'ก'.repeat(CATEGORY_NAME_MAX)), null);
  assert.equal(categoryNameProblem(list, 'ก'.repeat(CATEGORY_NAME_MAX + 1)), 'name_too_long');
  // Runes, not UTF-16 units: 120 emoji are 240 units and still fit.
  assert.equal(categoryNameProblem(list, '🍜'.repeat(CATEGORY_NAME_MAX)), null);
  assert.equal(categoryNameProblem(list, 'drinks'), 'name_taken');
  assert.equal(categoryNameProblem(list, 'drinks', 1), null);
  assert.equal(categoryNameProblem(list, 'Soup'), null);
});

test('autoscroll moves only inside the edge bands and speeds up toward the edge', () => {
  assert.equal(autoScrollStep(400, 50, 800), 0);
  assert.ok(autoScrollStep(100, 50, 800) < 0, 'near the top scrolls up');
  assert.ok(autoScrollStep(760, 50, 800) > 0, 'near the bottom scrolls down');
  assert.ok(Math.abs(autoScrollStep(55, 50, 800)) > Math.abs(autoScrollStep(115, 50, 800)), 'deeper is faster');
  assert.equal(autoScrollStep(0, 50, 800), -14, 'past the edge is the top speed');
  assert.equal(autoScrollStep(900, 50, 800), 14);
  assert.equal(autoScrollStep(Number.NaN, 50, 800), 0);
  assert.equal(autoScrollStep(100, 800, 50), 0);
});

test('an autoscroll offset stays inside the list extent', () => {
  assert.equal(clampScrollOffset(-10, 0, 300), 0);
  assert.equal(clampScrollOffset(420, 0, 300), 300);
  assert.equal(clampScrollOffset(120, 0, 300), 120);
  assert.equal(clampScrollOffset(50, 0, -40), 0, 'a list shorter than the screen never scrolls');
});
