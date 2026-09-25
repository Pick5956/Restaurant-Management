// What a failed step on the reservation history says to the person holding the
// phone.
//
// The reservation and order endpoints refuse in English and in their own terms
// ("reservation is already resolved", "table already has an open order",
// "missing reservation permission"), and the history screen used to print that
// straight into a panel titled as a load failure - a failed cancel read as "could
// not load the history". This maps each refusal onto the app's own Thai/English,
// patterned on table-error.ts: a title naming the step, a message only when there
// is something to say beyond it, and `reload` when the list on screen is stale.
// The server's wording never comes back out.

export type ReservationLanguage = 'th' | 'en';

export const RESERVATION_ACTIONS = ['load', 'load_more', 'cancel', 'arrive', 'seat_hold'] as const;

/**
 * - load / load_more: reading the list
 * - cancel: closing a booking as cancelled
 * - arrive: closing a booking for later as seated
 * - seat_hold: opening the order on a table the booking is holding
 */
export type ReservationAction = (typeof RESERVATION_ACTIONS)[number];

export type ReservationFailureCode =
  | 'already_resolved'
  | 'not_found'
  | 'changed'
  | 'no_active_reservation'
  | 'open_order'
  | 'table_inactive'
  | 'table_missing'
  | 'forbidden'
  | 'offline'
  | 'server_busy'
  | 'unknown';

export type ReservationFailure = {
  code: ReservationFailureCode;
  /** Names the step that failed. */
  title: string;
  /** Present only when it says more than the title. */
  message?: string;
  /** The rows on screen are stale: reload them. */
  reload?: true;
};

type Words = { th: string; en: string };

type Failed = { message: string; status: number | null };

/** Reads what src/api/client.ts throws (ApiError), a plain Error, a string, or nothing. */
function readFailure(err: unknown): Failed {
  if (err === null || err === undefined) return { message: '', status: null };
  if (typeof err === 'string') return { message: err, status: null };
  if (typeof err !== 'object') return { message: String(err), status: null };
  const source = err as { message?: unknown; status?: unknown };
  const status = typeof source.status === 'number' && Number.isFinite(source.status) ? source.status : null;
  return { message: typeof source.message === 'string' ? source.message : '', status };
}

function isOffline(message: string): boolean {
  // React Native's fetch says "Network request failed"; a dropped LAN backend
  // reaches us the same way.
  return message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('network error');
}

function isServerBusy(message: string, status: number | null): boolean {
  if (status !== null && status >= 500) return true;
  return message.includes('temporarily unavailable')
    || message.includes('internal server error')
    || message.includes('timeout');
}

function isForbidden(message: string, status: number | null): boolean {
  if (status === 403) return true;
  return message.startsWith('missing ') && message.includes('permission');
}

/** Maps whatever the API said onto the failures a person can act on. */
export function reservationFailureCode(err: unknown, action: ReservationAction): ReservationFailureCode {
  const failed = readFailure(err);
  const message = failed.message.trim().toLowerCase();
  const { status } = failed;

  if (message.includes('already resolved')) return 'already_resolved';
  if (message.includes('changed while it was being resolved')) return 'changed';
  if (message.includes('no active reservation')) return 'no_active_reservation';
  if (message.includes('open order')) return 'open_order';
  if (message.includes('table is inactive')) return 'table_inactive';
  if (message.includes('table not found')) return 'table_missing';
  if (message.includes('reservation not found')) return 'not_found';
  if (isOffline(message)) return 'offline';
  if (isForbidden(message, status)) return 'forbidden';
  if (status === 404 || message.includes('resource not found')) {
    return action === 'seat_hold' ? 'table_missing' : 'not_found';
  }
  if (isServerBusy(message, status)) return 'server_busy';
  return 'unknown';
}

const TITLES: Record<ReservationAction, Words> = {
  load: { th: 'โหลดประวัติการจองไม่สำเร็จ', en: 'Could not load reservation history' },
  load_more: { th: 'โหลดการจองเพิ่มเติมไม่สำเร็จ', en: 'Could not load more bookings' },
  cancel: { th: 'ยกเลิกการจองไม่สำเร็จ', en: 'Could not cancel the reservation' },
  arrive: { th: 'รับลูกค้าไม่สำเร็จ', en: 'Could not mark the guests as arrived' },
  seat_hold: { th: 'รับลูกค้าและเปิดออเดอร์ไม่สำเร็จ', en: 'Could not seat the guests and open an order' },
};

const MESSAGES: Record<Exclude<ReservationFailureCode, 'forbidden' | 'unknown'>, Words> = {
  already_resolved: { th: 'รายการนี้ถูกปิดไปแล้ว', en: 'This booking is already closed.' },
  not_found: { th: 'ไม่พบรายการจองนี้', en: 'This booking no longer exists.' },
  changed: { th: 'รายการนี้เพิ่งเปลี่ยน ลองอีกครั้ง', en: 'This booking just changed. Try again.' },
  no_active_reservation: { th: 'โต๊ะนี้ไม่มีการจองแล้ว', en: 'This table is no longer booked.' },
  open_order: { th: 'โต๊ะนี้มีออเดอร์เปิดอยู่', en: 'An order is already open on this table.' },
  table_inactive: { th: 'โต๊ะนี้ปิดใช้งานอยู่', en: 'This table is closed.' },
  table_missing: { th: 'ไม่พบโต๊ะนี้แล้ว', en: 'This table no longer exists.' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' },
};

const FORBIDDEN: Record<ReservationAction, Words> = {
  load: { th: 'บัญชีนี้ดูประวัติการจองไม่ได้', en: 'This account cannot view bookings.' },
  load_more: { th: 'บัญชีนี้ดูประวัติการจองไม่ได้', en: 'This account cannot view bookings.' },
  cancel: { th: 'บัญชีนี้ทำรายการจองไม่ได้', en: 'This account cannot change bookings.' },
  arrive: { th: 'บัญชีนี้ทำรายการจองไม่ได้', en: 'This account cannot change bookings.' },
  seat_hold: { th: 'บัญชีนี้เปิดออเดอร์ไม่ได้', en: 'This account cannot open orders.' },
};

/** Refusals that mean another device has moved the booking or its table on. */
const STALE: ReadonlySet<ReservationFailureCode> = new Set([
  'already_resolved',
  'not_found',
  'changed',
  'no_active_reservation',
  'open_order',
  'table_missing',
]);

const READING: ReadonlySet<ReservationAction> = new Set(['load', 'load_more']);

function messageFor(code: ReservationFailureCode, action: ReservationAction): Words | null {
  if (code === 'unknown') return null;
  if (code === 'forbidden') return FORBIDDEN[action];
  // A booking-level refusal on a list read is not something the reader can
  // act on; the title is the whole story.
  if (READING.has(action) && code !== 'offline' && code !== 'server_busy') return null;
  return MESSAGES[code];
}

/**
 * The failure of one reservation step, ready for a toast: the step's title, a
 * message when there is one, and whether the list should be reloaded. Never
 * contains the server's own words.
 */
export function reservationFailure(
  err: unknown,
  action: ReservationAction,
  language: ReservationLanguage = 'th',
): ReservationFailure {
  const code = reservationFailureCode(err, action);
  const failure: ReservationFailure = { code, title: TITLES[action][language] };
  const message = messageFor(code, action);
  if (message) failure.message = message[language];
  if (!READING.has(action) && STALE.has(code)) failure.reload = true;
  return failure;
}

/** The one line a failed load of the history shows above ลองอีกครั้ง. */
export function reservationLoadFailureLine(err: unknown, language: ReservationLanguage = 'th'): string {
  const code = reservationFailureCode(err, 'load');
  if (code === 'offline') return language === 'th' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' : 'Cannot reach the server';
  if (code === 'forbidden') return language === 'th' ? 'ไม่มีสิทธิ์ดูประวัติการจอง' : 'No access to reservation history';
  return TITLES.load[language];
}
