import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INGREDIENT_UNITS,
  buildIngredientCreateInput,
  buildIngredientMetadataInput,
  ingredientUnitOptions,
  ingredientToFormValues,
  reorderPercentOf,
  validateStockAdjustmentQuantity,
} from './inventory-form.ts';

const completeForm = {
  name: '  Salmon  ',
  sku: '  FISH-01  ',
  categoryId: '7',
  imageUrl: '  https://example.com/salmon.jpg  ',
  unit: 'กิโลกรัม',
  stock: '8.25',
  minStock: '2',
  minPercent: '0',
  cost: '315.75',
  yieldPercent: '92',
  storageType: 'chilled',
};

test('builds the complete metadata update without including stock', () => {
  const payload = buildIngredientMetadataInput(completeForm);

  assert.deepEqual(payload, {
    name: 'Salmon',
    sku: 'FISH-01',
    category_id: 7,
    image_url: 'https://example.com/salmon.jpg',
    unit: 'กิโลกรัม',
    min_stock: 2,
    // Always present, never omitted: this form owns the choice between a share
    // of the shelf's maximum and a plain quantity, so leaving the field out
    // would keep a percentage the owner has just switched away from.
    min_percent: 0,
    cost_per_unit: 315.75,
    yield_percent: 92,
    storage_type: 'chilled',
  });
  assert.equal(Object.hasOwn(payload, 'stock'), false);
});

test('round-trips every editable backend metadata field without changing stock', () => {
  const item = {
    ID: 14,
    restaurant_id: 3,
    name: 'Salmon',
    sku: 'FISH-01',
    category_id: 7,
    image_url: 'https://example.com/salmon.jpg',
    unit: 'กิโลกรัม',
    stock: 8.25,
    min_stock: 2,
    cost_per_unit: 315.75,
    yield_percent: 92,
    storage_type: 'chilled',
  };

  const values = ingredientToFormValues(item);
  const payload = buildIngredientMetadataInput(values);

  assert.equal(values.stock, '8.25');
  assert.deepEqual(payload, {
    name: item.name,
    sku: item.sku,
    category_id: item.category_id,
    image_url: item.image_url,
    unit: item.unit,
    min_stock: item.min_stock,
    min_percent: 0,
    cost_per_unit: item.cost_per_unit,
    yield_percent: item.yield_percent,
    storage_type: item.storage_type,
  });
  assert.equal(Object.hasOwn(payload, 'stock'), false);
});

test('keeps initial stock only in the create payload', () => {
  const payload = buildIngredientCreateInput(completeForm);

  assert.equal(payload.stock, 8.25);
  assert.equal(payload.image_url, 'https://example.com/salmon.jpg');
  assert.equal(Object.hasOwn(payload, 'base_unit'), false);
  assert.equal(Object.hasOwn(payload, 'purchase_unit_default'), false);
  assert.equal(Object.hasOwn(payload, 'conversion_factor_default'), false);
});

test('uses backend-compatible metadata defaults without discarding the stock unit', () => {
  const payload = buildIngredientMetadataInput({
    ...completeForm,
    categoryId: 'none',
    storageType: '',
  });

  assert.equal(payload.category_id, undefined);
  assert.equal(payload.unit, 'กิโลกรัม');
  assert.equal(payload.storage_type, 'room_temp');
});

test('matches the canonical Thai unit choices used by the web inventory form', () => {
  assert.deepEqual(INGREDIENT_UNITS, [
    'กรัม',
    'กิโลกรัม',
    'มิลลิลิตร',
    'ลิตร',
    'ชิ้น',
    'ลูก',
    'ฟอง',
    'ใบ',
    'แผ่น',
    'ขวด',
    'แพ็ก',
    'ถุง',
    'กล่อง',
  ]);
});

test('keeps a legacy custom unit available without duplicating canonical units', () => {
  assert.deepEqual(ingredientUnitOptions('ลัง'), ['ลัง', ...INGREDIENT_UNITS]);
  assert.deepEqual(ingredientUnitOptions('กิโลกรัม'), INGREDIENT_UNITS);
  assert.deepEqual(ingredientUnitOptions('กก.'), ['กก.', ...INGREDIENT_UNITS]);
});

test('falls back to the canonical kilogram unit when backend data has no unit', () => {
  const values = ingredientToFormValues({
    ID: 14,
    restaurant_id: 3,
    name: 'Salmon',
    sku: '',
    category_id: null,
    image_url: '',
    unit: ' ',
    stock: 0,
    min_stock: 0,
    cost_per_unit: 0,
    yield_percent: 100,
    storage_type: 'room_temp',
  });

  assert.equal(values.unit, 'กิโลกรัม');
});

test('rejects a blank stock adjustment as required', () => {
  assert.deepEqual(validateStockAdjustmentQuantity('   '), {
    ok: false,
    reason: 'required',
  });
});

test('rejects zero and negative stock adjustments as non-positive', () => {
  assert.deepEqual(validateStockAdjustmentQuantity('0'), {
    ok: false,
    reason: 'positive',
  });
  assert.deepEqual(validateStockAdjustmentQuantity('-2'), {
    ok: false,
    reason: 'positive',
  });
});

test('allows setting the stock balance to zero but not below zero', () => {
  assert.deepEqual(validateStockAdjustmentQuantity('0', 'adjust'), {
    ok: true,
    quantity: 0,
  });
  assert.deepEqual(validateStockAdjustmentQuantity('-2', 'adjust'), {
    ok: false,
    reason: 'non_negative',
  });
});

test('rejects malformed stock adjustments instead of partially parsing them', () => {
  assert.deepEqual(validateStockAdjustmentQuantity('2kg'), {
    ok: false,
    reason: 'invalid',
  });
});

test('accepts a positive decimal stock adjustment', () => {
  assert.deepEqual(validateStockAdjustmentQuantity('2.75'), {
    ok: true,
    quantity: 2.75,
  });
});

test('a form set to a share of the maximum sends the share as well as the quantity', () => {
  const payload = buildIngredientMetadataInput({ ...completeForm, minPercent: '20', minStock: '1900' });

  assert.equal(payload.min_percent, 20);
  assert.equal(payload.min_stock, 1900);
});

test('a share above a whole shelf is capped rather than sent as typed', () => {
  assert.equal(reorderPercentOf({ minPercent: '250' }), 100);
  assert.equal(reorderPercentOf({}), 0);
});
