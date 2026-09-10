import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countPayload,
  filterIngredients,
  inventoryTotals,
  niceQuantity,
  quickAmounts,
  restockStep,
  sortIngredients,
  stockShare,
  stockStatus,
  suggestedRestock,
} from './inventory-list.ts';

const item = (overrides) => ({
  ID: 1,
  restaurant_id: 1,
  name: 'x',
  sku: '',
  category_id: null,
  image_url: '',
  unit: 'กรัม',
  stock: 0,
  min_stock: 0,
  cost_per_unit: 0,
  yield_percent: 100,
  storage_type: 'dry',
  ...overrides,
});

test('stockStatus: out beats low, and no minimum means never low', () => {
  assert.equal(stockStatus(item({ stock: 0, min_stock: 100 })), 'out');
  assert.equal(stockStatus(item({ stock: 100, min_stock: 100 })), 'low');
  assert.equal(stockStatus(item({ stock: 101, min_stock: 100 })), 'ok');
  assert.equal(stockStatus(item({ stock: 5, min_stock: 0 })), 'ok');
});

test('stockShare: the reorder level sits at half, full is twice it, no level is null', () => {
  assert.equal(stockShare(item({ stock: 100, min_stock: 100 })), 0.5);
  assert.equal(stockShare(item({ stock: 200, min_stock: 100 })), 1);
  assert.equal(stockShare(item({ stock: 900, min_stock: 100 })), 1);
  assert.equal(stockShare(item({ stock: 0, min_stock: 100 })), 0);
  assert.equal(stockShare(item({ stock: 50, min_stock: 0 })), null);
});

test('filterIngredients matches name, sku or category, then status and category', () => {
  const rows = [
    item({ ID: 1, name: 'กะเพรา', sku: 'HB-01', category_id: 3, category: { ID: 3, name: 'ผัก' }, stock: 0, min_stock: 500 }),
    item({ ID: 2, name: 'หมูสับ', sku: 'MT-02', category_id: 5, category: { ID: 5, name: 'เนื้อสัตว์' }, stock: 7000, min_stock: 4000 }),
    item({ ID: 3, name: 'ข้าวสาร', sku: '', category_id: null, stock: 1700, min_stock: 2500 }),
  ];
  const ids = (list) => list.map((row) => row.ID);
  assert.deepEqual(ids(filterIngredients(rows, { search: 'mt', category: 'all', status: 'all' })), [2]);
  assert.deepEqual(ids(filterIngredients(rows, { search: 'ผัก', category: 'all', status: 'all' })), [1]);
  assert.deepEqual(ids(filterIngredients(rows, { search: '', category: 'none', status: 'all' })), [3]);
  assert.deepEqual(ids(filterIngredients(rows, { search: '', category: '5', status: 'all' })), [2]);
  assert.deepEqual(ids(filterIngredients(rows, { search: '', category: 'all', status: 'low' })), [3]);
  assert.deepEqual(ids(filterIngredients(rows, { search: '', category: 'all', status: 'out' })), [1]);
});

test('sortIngredients: urgent is out → low → ok, least cover first inside a bucket', () => {
  const rows = [
    item({ ID: 1, name: 'ก', stock: 500, min_stock: 100 }),
    item({ ID: 2, name: 'ข', stock: 50, min_stock: 100, days_left: 3 }),
    item({ ID: 3, name: 'ค', stock: 0, min_stock: 100 }),
    item({ ID: 4, name: 'ง', stock: 60, min_stock: 100, days_left: 1 }),
  ];
  assert.deepEqual(sortIngredients(rows, 'urgent').map((row) => row.ID), [3, 4, 2, 1]);
  assert.deepEqual(sortIngredients(rows, 'name').map((row) => row.ID), [1, 2, 3, 4]);
});

test('sortIngredients: value is stock × cost, recent is newest UpdatedAt first', () => {
  const rows = [
    item({ ID: 1, name: 'ก', stock: 10, cost_per_unit: 1, UpdatedAt: '2026-09-01T00:00:00Z' }),
    item({ ID: 2, name: 'ข', stock: 1, cost_per_unit: 100, UpdatedAt: '2026-09-10T00:00:00Z' }),
    item({ ID: 3, name: 'ค', stock: 5, cost_per_unit: 5 }),
  ];
  assert.deepEqual(sortIngredients(rows, 'value').map((row) => row.ID), [2, 3, 1]);
  assert.deepEqual(sortIngredients(rows, 'recent').map((row) => row.ID), [2, 1, 3]);
});

test('inventoryTotals sums value and counts what needs ordering', () => {
  const totals = inventoryTotals([
    item({ stock: 100, min_stock: 50, cost_per_unit: 2 }),
    item({ stock: 0, min_stock: 50, cost_per_unit: 9 }),
    item({ stock: 40, min_stock: 50, cost_per_unit: 1 }),
  ]);
  assert.deepEqual(totals, { value: 240, low: 1, out: 1, all: 3, needsOrder: 2 });
});

test('niceQuantity and restockStep round to numbers a person would type', () => {
  assert.equal(niceQuantity(0.3), 1);
  assert.equal(niceQuantity(7), 7);
  assert.equal(niceQuantity(12), 10);
  assert.equal(niceQuantity(230), 250);
  assert.equal(restockStep(item({ min_stock: 2500 })), 250);
  assert.equal(restockStep(item({ min_stock: 0, stock: 40 })), 4);
  assert.equal(restockStep(item({ min_stock: 0, stock: 0 })), 1);
});

test('quickAmounts offers four distinct rising choices and collapses duplicates', () => {
  assert.deepEqual(quickAmounts(item({ min_stock: 2500 })), [250, 1000, 2500, 5000]);
  assert.deepEqual(quickAmounts(item({ min_stock: 3 })), [1, 3, 6]);
});

test('countPayload: zero removes what is left, same count is nothing, otherwise an absolute set', () => {
  assert.deepEqual(countPayload(item({ stock: 1700 }), 0), { type: 'out', quantity: 1700 });
  assert.equal(countPayload(item({ stock: 0 }), 0), null);
  assert.equal(countPayload(item({ stock: 1700 }), 1700), null);
  assert.deepEqual(countPayload(item({ stock: 1700 }), 2100), { type: 'adjust', quantity: 2100 });
  assert.equal(countPayload(item({ stock: 1700 }), -1), null);
});

test('suggestedRestock tops up to twice the reorder level and never goes negative', () => {
  assert.equal(suggestedRestock(item({ stock: 1700, min_stock: 2500 })), 3300);
  assert.equal(suggestedRestock(item({ stock: 9000, min_stock: 2500 })), 0);
});
