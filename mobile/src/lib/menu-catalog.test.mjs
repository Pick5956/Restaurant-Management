import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addedQuantityByMenu,
  filterMenuCatalog,
  groupMenuByCategory,
} from './menu-catalog.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const catalog = [
  { ID: 1, name: 'ข้าวผัดกุ้ง', description: 'จานเดียว', category_id: 10 },
  { ID: 2, name: 'ต้มยำ', description: '', category_id: 20, categories: [{ category_id: 10 }] },
  { ID: 3, name: 'ชาเย็น', description: 'Thai tea', category_id: 30 },
  { ID: 4, name: 'น้ำเปล่า', description: null, category_id: 0 },
];

test('the catalog filter matches a category by its main or linked category', () => {
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: 'all', search: '' }).map((item) => item.ID), [1, 2, 3, 4]);
  // Dish 2 lives in 20 but is also linked into 10.
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: '10', search: '' }).map((item) => item.ID), [1, 2]);
});

test('the catalog search reads the name and the description, ignoring case and padding', () => {
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: 'all', search: '  THAI ' }).map((item) => item.ID), [3]);
  assert.deepEqual(filterMenuCatalog(catalog, { categoryId: '10', search: 'ต้มยำ' }).map((item) => item.ID), [2]);
  assert.deepEqual(filterMenuCatalog(null, { categoryId: 'all', search: '' }), []);
});

test('groups keep the menu order and name unknown categories once', () => {
  const groups = groupMenuByCategory(catalog, [{ ID: 10, name: 'อาหาร' }, { ID: 30, name: 'เครื่องดื่ม' }], 'ไม่ระบุหมวด');
  assert.deepEqual(groups.map((group) => [group.key, group.label, group.items.map((item) => item.ID)]), [
    ['10', 'อาหาร', [1]],
    ['20', 'ไม่ระบุหมวด', [2]],
    ['30', 'เครื่องดื่ม', [3]],
    ['0', 'ไม่ระบุหมวด', [4]],
  ]);
});

test('the served page counts only lines added since it opened', () => {
  const counts = addedQuantityByMenu([
    { ID: 1, menu_id: 7, status: 'served', quantity: 3 },
    { ID: 2, menu_id: 7, status: 'served', quantity: 2 },
    { ID: 3, menu_id: 8, status: 'served', quantity: 1 },
    { ID: 4, menu_id: 8, status: 'cancelled', quantity: 5 },
    { ID: 5, menu_id: 0, status: 'served', quantity: 1 },
    { ID: 6, menu_id: 9, status: 'served', quantity: Number.NaN },
  ], new Set([1]));
  assert.deepEqual([...counts], [[7, 2], [8, 1]]);
  assert.equal(addedQuantityByMenu(null, new Set()).size, 0);
});

test('the served-item page is the order menu grid, pushed from the bill menu', async () => {
  const [billSource, servedSource, detailSource, gridSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', 'bill.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'served.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-menu-grid.tsx'), 'utf8'),
  ]);

  // A pushed route, so the stack slides it in from the right; the catalog no
  // longer unfolds inside the bill.
  assert.match(billSource, /key: 'add-served'[\s\S]{0,400}pathname: '\/order\/served'/);
  assert.doesNotMatch(billSource, /const \[adding, setAdding\]/);
  assert.doesNotMatch(billSource, /filteredMenu\.map/);

  // Both screens render the one grid, so the served page cannot drift from the
  // order screen it is meant to look like.
  assert.match(detailSource, /<OrderMenuGrid\b/);
  assert.match(servedSource, /<OrderMenuGrid\b/);
  // A tile opens the ordinary item screen, so options, note and quantity are
  // chosen exactly as when taking an order - flagged so the line skips the kitchen.
  assert.match(servedSource, /pathname: '\/order\/item'[\s\S]{0,160}served: '1'/);
  const itemSource = await readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8');
  assert.match(itemSource, /const served = !editing && params\.served === '1';/);
  assert.match(itemSource, /addOrderItem\(orderId, \{[^}]*serve_immediately: served[^}]*\}\)/);
  assert.match(gridSource, /<MenuImage[\s\S]{0,300}imageUrl=\{item\.image_url\}[\s\S]{0,120}variant="card"/);
});
