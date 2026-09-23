import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bangkokClock,
  bangkokDayKey,
  groupReservationsByDay,
  mergeReservationPage,
  RESERVATION_FILTERS,
  RESERVATION_PAGE_MAX,
  reservationClosedLine,
  reservationCreatedLine,
  reservationDayKey,
  reservationDayLabel,
  reservationFilterCount,
  reservationFilterWord,
  reservationGuestParts,
  reservationMoment,
  reservationReloadLimit,
  reservationStamp,
  reservationStatusTone,
  reservationStatusWord,
  reservationTableTitle,
  reservationTotal,
} from './reservation-history.ts';

// Every instant below is written in UTC on purpose: the helpers must give the
// same Bangkok answer whatever zone the machine running the tests is set to.

function booking(id, fields = {}) {
  return {
    ID: id,
    restaurant_id: 1,
    table_id: 10,
    table_label: 'T4',
    name: 'ทดสอบระบบ',
    phone: '0800000000',
    status: 'active',
    reserved_by_user_id: 1,
    guest_count: 2,
    reserved_for: null,
    CreatedAt: '2026-09-14T13:16:00Z',
    table: null,
    ...fields,
  };
}

test('the booking moment is the arrival time, or when it was made for a hold', () => {
  assert.equal(reservationMoment(booking(1, { reserved_for: '2026-09-15T12:30:00Z' })), '2026-09-15T12:30:00Z');
  assert.equal(reservationMoment(booking(1)), '2026-09-14T13:16:00Z');
  assert.equal(reservationMoment(booking(1, { reserved_for: 'not a time' })), '2026-09-14T13:16:00Z');
  assert.equal(reservationMoment(booking(1, { CreatedAt: undefined })), null);
});

test('days and clocks are Bangkok time, not the device zone', () => {
  // 17:30 UTC is 00:30 the next day in Bangkok.
  assert.equal(bangkokDayKey('2026-09-14T17:30:00Z'), '2026-09-15');
  assert.equal(bangkokClock('2026-09-14T17:30:00Z'), '00:30');
  assert.equal(bangkokDayKey('2026-09-14T16:59:00Z'), '2026-09-14');
  assert.equal(bangkokClock('2026-09-14T16:59:00Z'), '23:59');
  assert.equal(bangkokClock('2026-09-14T13:16:00Z'), '20:16');
  assert.equal(bangkokDayKey(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
  assert.equal(bangkokDayKey(''), '');
  assert.equal(bangkokDayKey('nonsense'), '');
  assert.equal(bangkokClock(null), null);
  assert.equal(reservationDayKey(booking(1, { reserved_for: '2026-09-15T18:00:00Z' })), '2026-09-16');
});

test('open bookings read soonest first, every other view latest first', () => {
  const rows = [
    booking(1, { reserved_for: '2026-09-15T12:30:00Z' }), // 15th 19:30
    booking(2, { CreatedAt: '2026-09-15T05:00:00Z' }), // hold, 15th 12:00
    booking(3, { reserved_for: '2026-09-16T11:00:00Z' }), // 16th 18:00
    booking(4, { CreatedAt: '2026-09-14T13:16:00Z' }), // hold, 14th 20:16
  ];
  const active = groupReservationsByDay(rows, 'active');
  assert.deepEqual(active.map((day) => day.date), ['2026-09-14', '2026-09-15', '2026-09-16']);
  assert.deepEqual(active.flatMap((day) => day.reservations.map((row) => row.ID)), [4, 2, 1, 3]);

  for (const filter of ['all', 'seated', 'cancelled']) {
    const latest = groupReservationsByDay(rows, filter);
    assert.deepEqual(latest.map((day) => day.date), ['2026-09-16', '2026-09-15', '2026-09-14'], filter);
    assert.deepEqual(latest.flatMap((day) => day.reservations.map((row) => row.ID)), [3, 1, 2, 4], filter);
  }
});

test('rows with no time go last, and equal times keep a stable order', () => {
  const rows = [
    booking(5, { CreatedAt: undefined }),
    booking(6, { CreatedAt: '2026-09-15T05:00:00Z' }),
    booking(7, { CreatedAt: '2026-09-15T05:00:00Z' }),
  ];
  const days = groupReservationsByDay(rows, 'all');
  assert.deepEqual(days.map((day) => day.date), ['2026-09-15', '']);
  assert.deepEqual(days[0].reservations.map((row) => row.ID), [7, 6]);
  assert.deepEqual(days[1].reservations.map((row) => row.ID), [5]);
  assert.deepEqual(groupReservationsByDay(rows, 'active')[0].reservations.map((row) => row.ID), [6, 7]);
  assert.deepEqual(groupReservationsByDay([], 'all'), []);
});

test('a page loaded later lands in its own day', () => {
  const first = [booking(9, { CreatedAt: '2026-09-15T05:00:00Z' })];
  const later = [booking(3, { reserved_for: '2026-09-15T12:30:00Z', CreatedAt: '2026-09-01T05:00:00Z' })];
  const days = groupReservationsByDay(mergeReservationPage(first, later), 'all');
  assert.equal(days.length, 1);
  assert.deepEqual(days[0].reservations.map((row) => row.ID), [3, 9]);
});

test('day headings say today, tomorrow and yesterday, then the weekday and date', () => {
  const today = '2026-09-23';
  assert.equal(reservationDayLabel('2026-09-23', today, 'th'), 'วันนี้');
  assert.equal(reservationDayLabel('2026-09-24', today, 'th'), 'พรุ่งนี้');
  assert.equal(reservationDayLabel('2026-09-22', today, 'th'), 'เมื่อวาน');
  // 14 September 2026 is a Monday.
  assert.equal(reservationDayLabel('2026-09-14', today, 'th'), 'จ. 14 ก.ย.');
  assert.equal(reservationDayLabel('2026-09-14', today, 'en'), 'Mon 14 Sep');
  assert.equal(reservationDayLabel('2026-09-23', today, 'en'), 'Today');
  assert.equal(reservationDayLabel('2026-09-24', today, 'en'), 'Tomorrow');
  assert.equal(reservationDayLabel('2026-09-22', today, 'en'), 'Yesterday');
  // Another year carries the year, Buddhist era in Thai.
  assert.equal(reservationDayLabel('2025-12-31', today, 'th'), 'พ. 31 ธ.ค. 2568');
  assert.equal(reservationDayLabel('2025-12-31', today, 'en'), 'Wed 31 Dec 2025');
  // Month and year boundaries are crossed by calendar, not by string.
  assert.equal(reservationDayLabel('2026-12-31', '2027-01-01', 'th'), 'เมื่อวาน');
  assert.equal(reservationDayLabel('2026-10-01', '2026-09-30', 'th'), 'พรุ่งนี้');
  assert.equal(reservationDayLabel('', today, 'th'), 'ไม่ระบุวัน');
  assert.equal(reservationDayLabel('', today, 'en'), 'No date');
});

test('stamps name the day and the Bangkok time after a label', () => {
  const today = '2026-09-14';
  assert.equal(reservationStamp('2026-09-14T13:16:00Z', today, 'th'), 'วันนี้ 20:16');
  assert.equal(reservationStamp('2026-09-14T13:16:00Z', today, 'en'), 'today 20:16');
  assert.equal(reservationStamp('2026-09-10T13:16:00Z', today, 'th'), '10 ก.ย. 20:16');
  assert.equal(reservationStamp('2026-09-10T13:16:00Z', today, 'en'), '10 Sep 20:16');
  assert.equal(reservationStamp(null, today, 'th'), null);
});

test('จองเมื่อ closes every row, holds included; ปิดรายการเมื่อ only once closed', () => {
  const today = '2026-09-23';
  const later = booking(1, { reserved_for: '2026-09-24T12:00:00Z', CreatedAt: '2026-09-14T13:16:00Z' });
  assert.equal(reservationCreatedLine(later, today, 'th'), 'จองเมื่อ 14 ก.ย. 20:16');
  assert.equal(reservationCreatedLine(later, today, 'en'), 'Booked 14 Sep 20:16');
  // Owner, 2026-09-16: the last line is "จองเมื่อ" on every row, so a hold keeps it too.
  assert.equal(reservationCreatedLine(booking(2), today, 'th'), 'จองเมื่อ 14 ก.ย. 20:16');
  assert.equal(reservationCreatedLine(booking(2, { CreatedAt: undefined }), today, 'th'), null);
  assert.equal(reservationClosedLine(booking(3, { resolved_at: '2026-09-23T12:40:00Z' }), today, 'th'), 'ปิดรายการเมื่อ วันนี้ 19:40');
  assert.equal(reservationClosedLine(booking(3, { resolved_at: '2026-09-23T12:40:00Z' }), today, 'en'), 'Closed today 19:40');
  assert.equal(reservationClosedLine(booking(4, { resolved_at: null }), today, 'th'), null);
});

test('the table title is the table and its zone as one value, and says what is missing', () => {
  const zoned = { display_label: 'T9', table_number: '9', zone: 'สวน', table_zone: { name: ' ริมน้ำ ' } };
  assert.equal(reservationTableTitle(booking(1, { table: zoned }), 'th'), 'T4 ริมน้ำ');
  assert.equal(reservationTableTitle(booking(1, { table: { ...zoned, table_zone: null } }), 'th'), 'T4 สวน');
  assert.equal(reservationTableTitle(booking(1), 'th'), 'T4 ไม่มีโซน');
  assert.equal(reservationTableTitle(booking(1), 'en'), 'T4 No zone');
  assert.equal(reservationTableTitle(booking(1, { table_label: '', table: zoned }), 'th'), 'T9 ริมน้ำ');
  assert.equal(reservationTableTitle(booking(1, { table_label: '', table: { table_number: '12' } }), 'th'), '12 ไม่มีโซน');
  assert.equal(reservationTableTitle(booking(1, { table_label: '' }), 'th'), 'ไม่ระบุโต๊ะ ไม่มีโซน');
  assert.equal(reservationTableTitle(booking(1, { table_label: '' }), 'en'), 'Unknown table No zone');
  assert.ok(!reservationTableTitle(booking(1), 'th').includes(' · '));
});

test('the guest line keeps the name apart so only it gives way', () => {
  assert.deepEqual(reservationGuestParts(booking(1), 'th'), { name: 'ทดสอบระบบ', rest: '080-000-0000, 2 คน' });
  assert.deepEqual(reservationGuestParts(booking(1, { guest_count: 1 }), 'en'), { name: 'ทดสอบระบบ', rest: '080-000-0000, 1 guest' });
  assert.deepEqual(reservationGuestParts(booking(1, { name: '  ', phone: '', guest_count: 0 }), 'th'), {
    name: 'ไม่ระบุชื่อ',
    rest: 'ไม่มีเบอร์, ไม่ระบุจำนวนคน',
  });
  assert.deepEqual(reservationGuestParts(booking(1, { name: '', phone: '', guest_count: undefined }), 'en'), {
    name: 'No guest name',
    rest: 'No phone, Party size not set',
  });
  for (const language of ['th', 'en']) {
    const parts = reservationGuestParts(booking(1), language);
    assert.ok(!parts.rest.includes(' · ') && !parts.rest.includes('•'));
  }
});

test('filter counts add up and every filter has its word', () => {
  const counts = { active: 3, seated: 7, cancelled: 10 };
  assert.equal(reservationTotal(counts), 20);
  assert.equal(reservationTotal({}), 0);
  assert.equal(reservationFilterCount('all', counts), 20);
  assert.equal(reservationFilterCount('cancelled', counts), 10);
  assert.equal(reservationFilterCount('seated', { active: 1 }), 0);
  assert.deepEqual(RESERVATION_FILTERS.map((filter) => reservationFilterWord(filter, 'th')), ['ทั้งหมด', 'กำลังจอง', 'รับแล้ว', 'ยกเลิก']);
  assert.deepEqual(RESERVATION_FILTERS.map((filter) => reservationFilterWord(filter, 'en')), ['All', 'Active', 'Seated', 'Cancelled']);
});

test('status words and tones stay the screen\'s own', () => {
  assert.equal(reservationStatusWord('active', 'th'), 'กำลังจอง');
  assert.equal(reservationStatusWord('seated', 'th'), 'รับลูกค้าแล้ว');
  assert.equal(reservationStatusWord('cancelled', 'th'), 'ยกเลิก / ไม่มา');
  assert.equal(reservationStatusWord('cancelled', 'en'), 'Cancelled / no-show');
  assert.equal(reservationStatusTone('active'), 'info');
  assert.equal(reservationStatusTone('seated'), 'success');
  assert.equal(reservationStatusTone('cancelled'), 'danger');
});

test('a later page appends, dedupes by ID and takes the newer copy of a repeat', () => {
  const first = [booking(9), booking(8)];
  const next = [booking(8, { status: 'seated' }), booking(7), booking(7, { status: 'cancelled' })];
  const merged = mergeReservationPage(first, next);
  assert.deepEqual(merged.map((row) => row.ID), [9, 8, 7]);
  assert.equal(merged[1].status, 'seated');
  assert.equal(merged[2].status, 'active');
  assert.deepEqual(first.map((row) => row.ID), [9, 8], 'the rows already shown are not mutated');
  assert.deepEqual(mergeReservationPage([], []), []);
});

test('a reload keeps what was scrolled into, up to the server cap', () => {
  assert.equal(reservationReloadLimit(0, 50), 50);
  assert.equal(reservationReloadLimit(12, 50), 50);
  assert.equal(reservationReloadLimit(80, 50), 80);
  assert.equal(reservationReloadLimit(250, 50), RESERVATION_PAGE_MAX);
  assert.equal(reservationReloadLimit(Number.NaN, 50), 50);
});
