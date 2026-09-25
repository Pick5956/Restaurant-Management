// What the reservation history shows, worked out apart from how it is drawn:
// each booking's own time, the Bangkok day it falls on, the days in order, and
// the words on a row. The screen is app/reservations.tsx.
//
// A booking's time is the time the guests come (`reserved_for`); a booking that
// held its table straight away has none, so the moment it was made stands in -
// the same fallback the reservation screen uses for "เวลาที่จอง". Before this the
// phone list led with the moment a booking was TYPED IN, which reads as the
// booking time and is not.
//
// Every clock and day here is Bangkok's, whatever zone the device is set to:
// the backend closes stale bookings on Bangkok's calendar and the order archive
// cuts its days the same way. Thailand keeps no daylight saving, so the offset
// is a constant and the arithmetic below needs no Intl time-zone data.

import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { Reservation, ReservationStatus } from '@/src/types/reservation';

import { formatPhone } from './format.ts';

export type ReservationFilter = 'all' | ReservationStatus;

export const RESERVATION_FILTERS: readonly ReservationFilter[] = ['all', 'active', 'seated', 'cancelled'];

export type ReservationCounts = Partial<Record<ReservationStatus, number>>;

export type ReservationDay = {
  /** YYYY-MM-DD in Bangkok, or '' for bookings that carry no usable time. */
  date: string;
  reservations: Reservation[];
};

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_TH = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Words = { th: string; en: string };

const pad = (value: number) => String(value).padStart(2, '0');

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

/** The wall clock in Bangkok, read off a UTC date shifted by +7 h. */
function bangkokWall(time: number): Date {
  return new Date(time + BANGKOK_OFFSET_MS);
}

/** YYYY-MM-DD in Bangkok, '' when the value is not a time. */
export function bangkokDayKey(value: Date | string | null | undefined): string {
  const time = toTime(value);
  if (time === null) return '';
  const wall = bangkokWall(time);
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
}

/** "19:30" in Bangkok, 24-hour in both languages; null when the value is not a time. */
export function bangkokClock(value: Date | string | null | undefined): string | null {
  const time = toTime(value);
  if (time === null) return null;
  const wall = bangkokWall(time);
  return `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
}

/**
 * The booking's own time: when the guests come, or - for a booking that held
 * its table there and then - when it was made. Null only for a row with neither.
 */
export function reservationMoment(reservation: Pick<Reservation, 'reserved_for' | 'CreatedAt'>): string | null {
  if (toTime(reservation.reserved_for) !== null) return reservation.reserved_for ?? null;
  if (toTime(reservation.CreatedAt) !== null) return reservation.CreatedAt ?? null;
  return null;
}

/** The Bangkok day a booking falls on, '' when it carries no usable time. */
export function reservationDayKey(reservation: Pick<Reservation, 'reserved_for' | 'CreatedAt'>): string {
  return bangkokDayKey(reservationMoment(reservation));
}

/**
 * The loaded bookings cut into Bangkok days. Bookings still open read soonest
 * first - the next table to get ready is on top; every other view reads latest
 * first, like any history. Rows without a time go last, in the order they came.
 * It always regroups the whole array, so a page loaded later lands in its day.
 */
export function groupReservationsByDay(rows: readonly Reservation[], filter: ReservationFilter): ReservationDay[] {
  const ascending = filter === 'active';
  const timed: { reservation: Reservation; time: number }[] = [];
  const untimed: Reservation[] = [];
  for (const reservation of rows) {
    const time = toTime(reservationMoment(reservation));
    if (time === null) untimed.push(reservation);
    else timed.push({ reservation, time });
  }
  timed.sort((a, b) => {
    const byTime = ascending ? a.time - b.time : b.time - a.time;
    if (byTime !== 0) return byTime;
    return ascending ? a.reservation.ID - b.reservation.ID : b.reservation.ID - a.reservation.ID;
  });

  const days: ReservationDay[] = [];
  for (const { reservation, time } of timed) {
    const date = bangkokDayKey(new Date(time));
    const last = days[days.length - 1];
    if (last && last.date === date) last.reservations.push(reservation);
    else days.push({ date, reservations: [reservation] });
  }
  if (untimed.length) days.push({ date: '', reservations: untimed });
  return days;
}

function keyParts(key: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function shiftDayKey(key: string, delta: number): string {
  const parts = keyParts(key);
  if (!parts) return '';
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12) + delta * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const RELATIVE_DAYS: { delta: number; words: Words }[] = [
  { delta: 0, words: { th: 'วันนี้', en: 'Today' } },
  { delta: 1, words: { th: 'พรุ่งนี้', en: 'Tomorrow' } },
  { delta: -1, words: { th: 'เมื่อวาน', en: 'Yesterday' } },
];

function relativeDay(date: string, todayKey: string): Words | null {
  return RELATIVE_DAYS.find(({ delta }) => shiftDayKey(todayKey, delta) === date)?.words ?? null;
}

/** "14 ก.ย." / "14 Sep", with the year only when it is not this year's. */
function calendarDay(date: string, todayKey: string, language: DisplayLanguage, weekday: boolean): string {
  const parts = keyParts(date);
  if (!parts) return date;
  const th = language === 'th';
  const sameYear = keyParts(todayKey)?.year === parts.year;
  const year = sameYear ? '' : ` ${th ? parts.year + 543 : parts.year}`;
  const month = (th ? MONTHS_TH : MONTHS_EN)[parts.month - 1];
  const dayName = weekday
    ? `${(th ? WEEKDAYS_TH : WEEKDAYS_EN)[new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay()]} `
    : '';
  return `${dayName}${parts.day} ${month}${year}`;
}

/** The heading over a day: วันนี้, พรุ่งนี้, เมื่อวาน, or "จ. 14 ก.ย.". */
export function reservationDayLabel(date: string, todayKey: string, language: DisplayLanguage): string {
  if (!date) return language === 'th' ? 'ไม่ระบุวัน' : 'No date';
  const relative = relativeDay(date, todayKey);
  if (relative) return relative[language];
  return calendarDay(date, todayKey, language, true);
}

/** "วันนี้ 20:16" / "14 ก.ย. 20:16": a moment after a label; null when the value is not a time. */
export function reservationStamp(value: string | null | undefined, todayKey: string, language: DisplayLanguage): string | null {
  const clock = bangkokClock(value);
  if (!clock) return null;
  const date = bangkokDayKey(value);
  const relative = relativeDay(date, todayKey);
  // Lower case in English: the stamp always follows a label ("Booked today 20:16").
  const day = relative ? (language === 'th' ? relative.th : relative.en.toLowerCase()) : calendarDay(date, todayKey, language, false);
  return `${day} ${clock}`;
}

/**
 * "จองเมื่อ 14 ก.ย. 20:16" - the last line of EVERY row, holds included. The
 * owner asked for exactly that on 2026-09-16: rows whose last line differed
 * were the inconsistency they were seeing. Null only when the time is unknown.
 */
export function reservationCreatedLine(
  reservation: Pick<Reservation, 'CreatedAt'>,
  todayKey: string,
  language: DisplayLanguage,
): string | null {
  const stamp = reservationStamp(reservation.CreatedAt, todayKey, language);
  if (!stamp) return null;
  return language === 'th' ? `จองเมื่อ ${stamp}` : `Booked ${stamp}`;
}

/** "ปิดรายการเมื่อ 15 ก.ย. 19:40"; null while the booking is still open. */
export function reservationClosedLine(
  reservation: Pick<Reservation, 'resolved_at'>,
  todayKey: string,
  language: DisplayLanguage,
): string | null {
  const stamp = reservationStamp(reservation.resolved_at, todayKey, language);
  if (!stamp) return null;
  return language === 'th' ? `ปิดรายการเมื่อ ${stamp}` : `Closed ${stamp}`;
}

/** "T4 ริมน้ำ", or "T4 ไม่มีโซน": the table and its zone as one value; a missing zone is said. */
export function reservationTableTitle(
  reservation: Pick<Reservation, 'table_label' | 'table'>,
  language: DisplayLanguage,
): string {
  const th = language === 'th';
  const label = reservation.table_label
    || reservation.table?.display_label
    || reservation.table?.table_number
    || (th ? 'ไม่ระบุโต๊ะ' : 'Unknown table');
  const zone = reservation.table?.table_zone?.name?.trim()
    || reservation.table?.zone?.trim()
    || (th ? 'ไม่มีโซน' : 'No zone');
  return `${label} ${zone}`;
}

/**
 * The guest line in two parts, so the name alone gives way to an ellipsis and
 * the phone and party size never lose a character: { name, rest }.
 */
export function reservationGuestParts(
  reservation: Pick<Reservation, 'name' | 'phone' | 'guest_count'>,
  language: DisplayLanguage,
): { name: string; rest: string } {
  const th = language === 'th';
  const name = reservation.name?.trim() || (th ? 'ไม่ระบุชื่อ' : 'No guest name');
  const phone = formatPhone(reservation.phone) || (th ? 'ไม่มีเบอร์' : 'No phone');
  const count = Number(reservation.guest_count);
  const party = Number.isFinite(count) && count > 0
    ? (th ? `${Math.trunc(count)} คน` : `${Math.trunc(count)} ${Math.trunc(count) === 1 ? 'guest' : 'guests'}`)
    : (th ? 'ไม่ระบุจำนวนคน' : 'Party size not set');
  return { name, rest: [phone, party].join(', ') };
}

export function reservationTotal(counts: ReservationCounts): number {
  return (counts.active || 0) + (counts.seated || 0) + (counts.cancelled || 0);
}

/** What one filter segment counts. */
export function reservationFilterCount(filter: ReservationFilter, counts: ReservationCounts): number {
  return filter === 'all' ? reservationTotal(counts) : counts[filter] || 0;
}

const FILTER_WORDS: Record<ReservationFilter, Words> = {
  all: { th: 'ทั้งหมด', en: 'All' },
  active: { th: 'กำลังจอง', en: 'Active' },
  seated: { th: 'รับแล้ว', en: 'Seated' },
  cancelled: { th: 'ยกเลิก', en: 'Cancelled' },
};

export function reservationFilterWord(filter: ReservationFilter, language: DisplayLanguage): string {
  return FILTER_WORDS[filter][language];
}

const STATUS_WORDS: Record<ReservationStatus, Words> = {
  active: { th: 'กำลังจอง', en: 'Active' },
  seated: { th: 'รับลูกค้าแล้ว', en: 'Seated' },
  // The server also closes a booking whose guests never came this way.
  cancelled: { th: 'ยกเลิก / ไม่มา', en: 'Cancelled / no-show' },
};

export function reservationStatusWord(status: ReservationStatus, language: DisplayLanguage): string {
  return STATUS_WORDS[status]?.[language] ?? status;
}

export type ReservationStatusTone = 'info' | 'success' | 'danger';

export function reservationStatusTone(status: ReservationStatus): ReservationStatusTone {
  if (status === 'seated') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'info';
}

/**
 * A later page added to the rows already shown. A booking that shows up twice
 * (a new booking shifted the server's offsets) keeps its place and takes the
 * newer copy.
 */
export function mergeReservationPage(existing: readonly Reservation[], next: readonly Reservation[]): Reservation[] {
  const incoming = new Map<number, Reservation>();
  for (const reservation of next) {
    if (!incoming.has(reservation.ID)) incoming.set(reservation.ID, reservation);
  }
  const seen = new Set<number>();
  const merged = existing.map((reservation) => {
    seen.add(reservation.ID);
    return incoming.get(reservation.ID) ?? reservation;
  });
  for (const reservation of incoming.values()) {
    if (!seen.has(reservation.ID)) merged.push(reservation);
  }
  return merged;
}

/** The server never returns more than this many rows in one request. */
export const RESERVATION_PAGE_MAX = 100;

/**
 * How many rows a reload asks for. Reloading the same view after an action
 * keeps what was already scrolled into (up to the server's cap), so the list
 * does not collapse to its first page under the row just tapped.
 */
export function reservationReloadLimit(shown: number, pageSize: number): number {
  const base = Math.max(1, Math.trunc(pageSize) || 1);
  const kept = Number.isFinite(shown) ? Math.trunc(shown) : 0;
  return Math.min(RESERVATION_PAGE_MAX, Math.max(base, kept));
}
