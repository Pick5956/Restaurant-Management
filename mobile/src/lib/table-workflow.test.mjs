import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildReservationActionPath,
  buildReservationListPath,
} from './reservation-query.ts';
import {
  canEditTableAvailability,
  canOpenDineInOrder,
  canViewReservationHistory,
  reservationArrivalOrderInput,
  tableEditorSaveStatus,
  tableEntryAction,
} from './table-workflow.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('inactive tables cannot open a new order', () => {
  assert.equal(tableEntryAction('inactive', false), 'blocked');
});

test('table selection resumes orders before considering the resting table status', () => {
  assert.equal(tableEntryAction('occupied', true), 'resume');
  assert.equal(tableEntryAction('reserved', false), 'reservation');
  assert.equal(tableEntryAction('free', false), 'new');
});

test('the table editor only exposes availability changes for resting table states', () => {
  assert.equal(canEditTableAvailability('free'), true);
  assert.equal(canEditTableAvailability('inactive'), true);
  assert.equal(canEditTableAvailability('reserved'), false);
  assert.equal(canEditTableAvailability('occupied'), false);
});

test('the table editor preserves reservation and order lifecycle status on save', () => {
  assert.equal(tableEditorSaveStatus('reserved', 'free'), 'reserved');
  assert.equal(tableEditorSaveStatus('occupied', 'inactive'), 'occupied');
  assert.equal(tableEditorSaveStatus('free', 'inactive'), 'inactive');
  assert.equal(tableEditorSaveStatus('inactive', 'free'), 'free');
});

test('reservation API paths preserve the backend list and lifecycle contract', () => {
  assert.equal(buildReservationListPath(), '/api/v1/reservations');
  assert.equal(
    buildReservationListPath({ status: 'seated', limit: 50, offset: 20 }),
    '/api/v1/reservations?status=seated&limit=50&offset=20',
  );
  assert.equal(
    buildReservationListPath({ status: '', limit: 500, offset: -2 }),
    '/api/v1/reservations?limit=100',
  );
  assert.equal(buildReservationActionPath(42, 'reserve'), '/api/v1/tables/42/reserve');
  assert.equal(buildReservationActionPath(42, 'cancel'), '/api/v1/tables/42/cancel-reservation');
});

test('reservation history follows the same OR permission contract as web', () => {
  assert.equal(canViewReservationHistory(true, false, false), true);
  assert.equal(canViewReservationHistory(false, true, false), true);
  assert.equal(canViewReservationHistory(false, false, true), true);
  assert.equal(canViewReservationHistory(false, false, false), false);
});

test('accepting a reservation builds an atomic reserved-table order request', () => {
  assert.deepEqual(reservationArrivalOrderInput(42, {
    customerCount: 4,
    customerName: '  คุณแนน  ',
    customerPhone: ' 0812345678 ',
  }), {
    table_id: 42,
    order_type: 'dine_in',
    customer_count: 4,
    customer_name: 'คุณแนน',
    customer_phone: '0812345678',
    seat_reservation: true,
  });
});

test('a dine-in order cannot be submitted for an invalid or missing table', () => {
  assert.equal(canOpenDineInOrder(42, true), true);
  assert.equal(canOpenDineInOrder(42, false), false);
  assert.equal(canOpenDineInOrder(0, true), false);
  assert.equal(canOpenDineInOrder(Number.NaN, true), false);
});

test('iPad order taking gives the full workspace to the table grid without changing phone cards', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', '(primary)', 'tables.tsx'), 'utf8');

  assert.doesNotMatch(source, /\battentionTables\b|โต๊ะที่ต้องดูต่อ|Tables in progress/);
  // Every table comes from one walk over one list. The density toggle renders
  // two tile shapes from inside that walk and returns early for the compact
  // one, so a table can still only appear once; a second `.map` over the tables
  // would mean it is being drawn in two places again, which is the pile-up this
  // test was written to stop.
  assert.equal(source.match(/group\.tables\.map\(/g)?.length, 1);
  assert.equal(source.match(/onPress=\{\(\) => open\(table\)\}/g)?.length, 2);
  assert.match(source, /width:\s*tabletWorkspace \? undefined : '48%'/);
  assert.match(source, /minWidth:\s*tabletWorkspace \? 164 : 0/);
  assert.match(source, /flexBasis:\s*tabletWorkspace \? 176 : 'auto'/);
});

test('table cards keep one size instead of stretching across a partial last row', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', '(primary)', 'tables.tsx'), 'utf8');

  // Phones must not grow at all: two fixed 48% columns, so a lone card on the
  // last row stays half width instead of spanning the screen.
  assert.match(source, /flexGrow:\s*tabletWorkspace \? 1 : 0/);
  // Tablets may fill the row but never past a single card's size.
  assert.match(source, /maxWidth:\s*tabletWorkspace \? 260 : undefined/);
});

test('a table with an active order never reads as available', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', '(primary)', 'tables.tsx'), 'utf8');

  // Occupied is amber whether or not food is ready. Emerald means free, so a
  // busy table must never take the free tint no matter what its items say.
  assert.match(source, /const tone = order \? 'warning'/);
  assert.doesNotMatch(source, /const tone = ready \? 'success'/);
});
