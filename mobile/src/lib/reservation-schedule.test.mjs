import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  defaultReservationSlot,
  reservationInstant,
  reservationReminder,
  reservationTimeSlots,
  slotMinutes,
} from './reservation-schedule.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('slots run on the quarter hour across the service window', () => {
  const slots = reservationTimeSlots('tomorrow', new Date('2026-09-09T12:00:00'));

  assert.equal(slots[0], '09:00');
  assert.equal(slots[1], '09:15');
  assert.equal(slots.at(-1), '23:00');
  assert.ok(slots.every((slot) => [0, 15, 30, 45].includes(slotMinutes(slot) % 60)));
});

test('today drops the slots that have already gone', () => {
  const slots = reservationTimeSlots('today', new Date('2026-09-09T19:20:00'));

  assert.equal(slots[0], '19:30');
  assert.ok(!slots.includes('19:15'), 'a slot in the past must not be offered');
  assert.ok(!slots.includes('09:00'));
});

test('tomorrow keeps the whole day whatever the time is now', () => {
  const lateEvening = new Date('2026-09-09T22:45:00');

  assert.equal(reservationTimeSlots('tomorrow', lateEvening)[0], '09:00');
  assert.equal(reservationTimeSlots('today', lateEvening).length, 1);
});

test('a hold carries no instant, which is what leaves the table sellable', () => {
  assert.equal(reservationInstant('now', '19:00', new Date('2026-09-09T12:00:00')), null);
});

test('the instant lands on the chosen day and slot', () => {
  const now = new Date('2026-09-09T12:00:00');

  const today = reservationInstant('today', '19:30', now);
  assert.equal(today?.getDate(), 9);
  assert.equal(today?.getHours(), 19);
  assert.equal(today?.getMinutes(), 30);
  assert.equal(today?.getSeconds(), 0);

  const tomorrow = reservationInstant('tomorrow', '09:15', now);
  assert.equal(tomorrow?.getDate(), 10);
  assert.equal(tomorrow?.getHours(), 9);
});

test('the instant rolls into the next month rather than landing on day 32', () => {
  const monthEnd = reservationInstant('tomorrow', '19:00', new Date('2026-09-30T12:00:00'));

  assert.equal(monthEnd?.getMonth(), 9, 'September 30th + 1 day is October');
  assert.equal(monthEnd?.getDate(), 1);
});

test('the preselected slot is one that can still be booked', () => {
  const now = new Date('2026-09-09T19:20:00');
  const slot = defaultReservationSlot('today', now);

  assert.equal(slot, '19:30');
  assert.ok(reservationTimeSlots('today', now).includes(slot));
});

test('the table card reminder shows the time alone only when it is today', () => {
  const now = new Date('2026-09-09T12:00:00');

  assert.equal(reservationReminder('2026-09-09T16:00:00', now), 'จอง 16:00');
  // Tomorrow morning read late tonight must not look like "in a few minutes".
  assert.match(reservationReminder('2026-09-10T09:30:00', now) || '', /09:30/);
  assert.notEqual(reservationReminder('2026-09-10T09:30:00', now), 'จอง 09:30');
});

test('a table with no booking gets no reminder rather than an empty one', () => {
  const now = new Date('2026-09-09T12:00:00');

  assert.equal(reservationReminder(null, now), null);
  assert.equal(reservationReminder(undefined, now), null);
  assert.equal(reservationReminder('', now), null);
  assert.equal(reservationReminder('not a date', now), null);
});

test('the sheet omits reserved_for for a hold and sends it otherwise', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', 'order', 'new.tsx'), 'utf8');

  // The call site is the whole feature: a booking that always sent a time would
  // schedule what the staff meant to hold, and one that never sent it would
  // take the table out of service for an evening booking made at lunchtime.
  assert.match(source, /reservationInstant\(reserveDay, reserveSlot, new Date\(\)\)/);
  assert.match(source, /\.\.\.\(instant \? \{ reserved_for: instant\.toISOString\(\) \} : null\)/);
  // The party size is what the guest said on the phone. Dropping it here is how
  // a booking arrives with no idea how many people are coming.
  assert.match(source, /guest_count: guestCount/);
});

test('both modes offer the same guest count control', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', 'order', 'new.tsx'), 'utf8');

  // Defined once and rendered in each branch: the reservation form lost this
  // field entirely when the two modes were first split, and a second copy would
  // be the other way for them to drift apart.
  assert.equal(source.match(/const guestCountField = \(/g)?.length, 1);
  assert.equal(source.match(/\{guestCountField\}/g)?.length, 2);
});
