import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archiveDateLabel,
  archiveDateTimeLine,
  archiveRowTitle,
  archiveTableZone,
  groupArchiveByDay,
} from './order-archive.ts';

const order = (over) => ({
  ID: 1,
  order_number: '20260916-001',
  order_type: 'dine_in',
  status: 'completed',
  payment_status: 'paid',
  grand_total: 100,
  opened_at: '2026-09-16T05:00:00Z',
  ...over,
});

test('the archive groups orders by their Bangkok day, in the order the server sent them', () => {
  const days = groupArchiveByDay([
    order({ ID: 1, opened_at: '2026-09-16T06:42:00Z', grand_total: 1240 }),
    // 00:30 Bangkok on the 16th is still the 15th in UTC.
    order({ ID: 2, opened_at: '2026-09-15T17:30:00Z', grand_total: 320 }),
    order({ ID: 3, opened_at: '2026-09-15T13:16:00Z', grand_total: 2180 }),
    order({ ID: 4, opened_at: '2026-08-12T04:49:00Z', grand_total: 89 }),
  ]);

  assert.deepEqual(days.map((day) => day.date), ['2026-09-16', '2026-09-15', '2026-08-12']);
  assert.deepEqual(days.map((day) => day.orders.map((o) => o.ID)), [[1, 2], [3], [4]]);
  assert.deepEqual(days.map((day) => day.total), [1560, 2180, 89]);
  assert.deepEqual(days.map((day) => day.paidCount), [2, 1, 1]);
});

test('a cancelled order stays listed but is left out of the day total and bill count', () => {
  const [day] = groupArchiveByDay([
    order({ ID: 1, grand_total: 575 }),
    order({ ID: 2, grand_total: 415, status: 'cancelled' }),
  ]);
  assert.equal(day.orders.length, 2);
  assert.equal(day.paidCount, 1);
  assert.equal(day.total, 575);
});

test('an order with no usable opening time lands under its own unknown day rather than crashing the list', () => {
  const days = groupArchiveByDay([order({ ID: 1, opened_at: '' }), order({ ID: 2 })]);
  assert.equal(days.length, 2);
  assert.equal(days[0].date, '');
});

test('the zone comes from the zone record, then the legacy zone string, else nothing', () => {
  assert.equal(archiveTableZone(order({ table: { display_label: 'T1', zone: 'ชั้น 1', table_zone: { name: 'ริมน้ำ' } } })), 'ริมน้ำ');
  assert.equal(archiveTableZone(order({ table: { display_label: 'T1', zone: 'ชั้น 1', table_zone: null } })), 'ชั้น 1');
  assert.equal(archiveTableZone(order({ table: { display_label: 'T1', zone: '  ' } })), '');
  assert.equal(archiveTableZone(order({})), '');
});

test('the day filter reads as every day until one is chosen', () => {
  assert.equal(archiveDateLabel(null, 'th'), 'ทุกวัน');
  assert.equal(archiveDateLabel(null, 'en'), 'All days');
  assert.equal(archiveDateLabel('2026-09-16', 'th'), '16 ก.ย. 2569');
  assert.equal(archiveDateLabel('2026-09-16', 'en'), 'Sep 16, 2026');
});

test('a row is named after its table, then takeaway, then the order number', () => {
  const copy = (th, en) => th;
  assert.equal(archiveRowTitle(order({ table: { display_label: 'A-12' } }), copy), 'A-12');
  assert.equal(archiveRowTitle(order({ order_type: 'takeaway' }), copy), 'ซื้อกลับบ้าน');
  assert.equal(archiveRowTitle(order({}), copy), '20260916-001');
});

test('the full date line pads the day, uses the Buddhist year in Thai, and ends with น.', () => {
  // 02:03 Bangkok on the 9th is 19:03 UTC on the 8th.
  assert.equal(archiveDateTimeLine('2026-09-08T19:03:00Z', 'th'), '09 ก.ย. 2569, 02:03 น.');
  assert.equal(archiveDateTimeLine('2026-09-08T19:03:00Z', 'en'), 'Sep 09, 2026, 02:03');
  assert.equal(archiveDateTimeLine('', 'th'), '');
  assert.equal(archiveDateTimeLine('not a date', 'th'), '');
});
