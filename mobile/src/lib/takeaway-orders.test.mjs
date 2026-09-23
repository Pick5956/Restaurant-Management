import assert from 'node:assert/strict';
import test from 'node:test';

import { activeTakeaways, TAKEAWAY_ZONE } from './takeaway-orders.ts';

const order = (overrides) => ({
  ID: 1,
  order_number: '20260922-001',
  order_type: 'takeaway',
  status: 'open',
  customer_count: 1,
  grand_total: 0,
  ...overrides,
});

test('keeps only takeaway orders that are still in progress', () => {
  const list = activeTakeaways([
    order({ ID: 1 }),
    order({ ID: 2, order_type: 'dine_in', table_id: 4 }),
    order({ ID: 3, status: 'completed' }),
    order({ ID: 4, status: 'cancelled' }),
    order({ ID: 5, status: 'ready' }),
  ]);
  assert.deepEqual(list.map((item) => item.ID), [1, 5]);
});

test('puts the one waiting longest first', () => {
  assert.deepEqual(activeTakeaways([order({ ID: 9 }), order({ ID: 3 })]).map((item) => item.ID), [3, 9]);
});

test('matches the search on order number, name or phone', () => {
  const list = [
    order({ ID: 1, order_number: '20260922-001', customer_name: 'สมชาย' }),
    order({ ID: 2, order_number: '20260922-002', customer_phone: '0800000000' }),
  ];
  assert.deepEqual(activeTakeaways(list, 'สมชาย').map((item) => item.ID), [1]);
  assert.deepEqual(activeTakeaways(list, '0800').map((item) => item.ID), [2]);
  assert.deepEqual(activeTakeaways(list, '-002').map((item) => item.ID), [2]);
  assert.deepEqual(activeTakeaways(list, '  ').map((item) => item.ID), [1, 2]);
});

test('the takeaway zone key cannot collide with a real zone id', () => {
  // Zone keys are numeric ids or "none"; the web POS uses the same key.
  assert.equal(TAKEAWAY_ZONE, 'takeaway');
});
