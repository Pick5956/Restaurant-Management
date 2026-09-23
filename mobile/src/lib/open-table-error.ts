// What a failed step on the open-table screen (/order/new) says to the waiter.
//
// The order and table APIs refuse in English and in their own terms - "table
// already has an open order", "table is already booked for that time",
// "resource already exists" - and the screen used to print that into a panel
// on the page. This maps each refusal onto the app's own Thai/English, the way
// auth-error.ts and table-error.ts do: a title naming the step, and a message
// only when there is something to say beyond it. The server's wording never
// comes back out.
//
// A problem with one field (the phone, the booking time) carries `field` so
// the screen shows it under that field; every other outcome goes through
// useToast. `stale` means the table changed under the screen, so it reloads.

export type OpenTableLanguage = 'th' | 'en';

export const OPEN_TABLE_ACTIONS = ['load', 'open', 'takeaway', 'reserve'] as const;

export type OpenTableAction = (typeof OPEN_TABLE_ACTIONS)[number];

export type OpenTableFailureCode =
  | 'open_order_exists'
  | 'table_reserved'
  | 'not_free'
  | 'inactive'
  | 'not_found'
  | 'slot_taken'
  | 'phone_invalid'
  | 'forbidden'
  | 'offline'
  | 'server_busy'
  | 'unknown';

export type OpenTableFailure = {
  code: OpenTableFailureCode;
  /** Names the step that failed. */
  title: string;
  /** Present only when it says more than the title. */
  message?: string;
  /** Show under this field instead of raising a toast. */
  field?: 'phone' | 'time';
  /** The table changed since the screen loaded it. */
  stale?: true;
};

/** What the dine-in form shows above itself when there is no table to open. */
export type OpenTableIssue = 'no_table' | 'missing' | 'failed';

type Words = { th: string; en: string };

type Failed = { message: string; status: number | null; code: string };

/** Reads what src/api/client.ts throws (ApiError), a plain Error, a string, or nothing. */
function readFailure(err: unknown): Failed {
  if (err === null || err === undefined) return { message: '', status: null, code: '' };
  if (typeof err === 'string') return { message: err, status: null, code: '' };
  if (typeof err !== 'object') return { message: String(err), status: null, code: '' };
  const source = err as { message?: unknown; status?: unknown; details?: unknown };
  const status = typeof source.status === 'number' && Number.isFinite(source.status) ? source.status : null;
  return {
    message: typeof source.message === 'string' ? source.message : '',
    status,
    code: bodyCode(source.details),
  };
}

/** The `code` field of the error body the server sent, when there is one. */
function bodyCode(details: unknown): string {
  if (typeof details !== 'string' || !details.trim().startsWith('{')) return '';
  try {
    const parsed = JSON.parse(details) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code : '';
  } catch {
    return '';
  }
}

function isOffline(message: string): boolean {
  // React Native's fetch says "Network request failed"; a dropped LAN backend
  // reaches us the same way.
  return message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('network error');
}

function isServerBusy(message: string, status: number | null, code: string): boolean {
  if (status !== null && status >= 500) return true;
  if (code === 'internal_error' || code === 'service_unavailable') return true;
  return message.includes('temporarily unavailable')
    || message.includes('internal server error')
    || message.includes('timeout');
}

function isForbidden(message: string, status: number | null, code: string): boolean {
  if (status === 403 || code === 'forbidden') return true;
  return message.startsWith('missing ') && message.includes('permission');
}

/** Maps whatever the API said onto the failures a waiter can act on. */
export function openTableFailureCode(err: unknown, action: OpenTableAction): OpenTableFailureCode {
  const failed = readFailure(err);
  const message = failed.message.trim().toLowerCase();
  const { status, code } = failed;

  if (message.includes('open order')) return 'open_order_exists';
  if (message.includes('table is reserved')) return 'table_reserved';
  if (message.includes('not free')) return 'not_free';
  if (message.includes('table is inactive')) return 'inactive';
  if (message.includes('already booked')) return 'slot_taken';
  if (message.includes('reservation phone')) return 'phone_invalid';
  if (message.includes('table not found') || message.includes('table_id is required')) return 'not_found';
  // A duplicate key. On a booking it is the one-booking-per-slot index; on a
  // dine-in order it is the one-open-order-per-table index. A takeaway has no
  // table, so there it is a clash nobody at the counter can act on.
  if (message.includes('already exists') || status === 409) {
    if (action === 'reserve') return 'slot_taken';
    if (action === 'open') return 'open_order_exists';
    return 'unknown';
  }
  if (isOffline(message)) return 'offline';
  if (isForbidden(message, status, code)) return 'forbidden';
  if (status === 404 || message.includes('resource not found')) return 'not_found';
  if (isServerBusy(message, status, code)) return 'server_busy';
  return 'unknown';
}

const TITLES: Record<OpenTableAction, Words> = {
  load: { th: 'โหลดข้อมูลโต๊ะไม่สำเร็จ', en: 'Could not load the table' },
  open: { th: 'เปิดออเดอร์ไม่สำเร็จ', en: 'Could not open the order' },
  takeaway: { th: 'เปิดออเดอร์ไม่สำเร็จ', en: 'Could not open the order' },
  reserve: { th: 'จองโต๊ะไม่สำเร็จ', en: 'Could not reserve the table' },
};

const MESSAGES: Record<Exclude<OpenTableFailureCode, 'forbidden' | 'unknown'>, Words> = {
  open_order_exists: { th: 'โต๊ะนี้มีออเดอร์เปิดอยู่แล้ว', en: 'An order is already open on this table.' },
  table_reserved: { th: 'โต๊ะนี้ถูกจองไว้', en: 'This table is held for a booking.' },
  not_free: { th: 'โต๊ะนี้ไม่ว่างแล้ว', en: 'This table is no longer free.' },
  inactive: { th: 'โต๊ะนี้ปิดใช้งานอยู่', en: 'This table is switched off.' },
  not_found: { th: 'ไม่พบโต๊ะนี้แล้ว', en: 'This table no longer exists.' },
  slot_taken: { th: 'เวลานี้มีคนจองโต๊ะนี้แล้ว', en: 'Someone has already booked this table for that time.' },
  phone_invalid: { th: 'กรอกเบอร์โทรอย่างน้อย 9 หลัก', en: 'Enter a phone number with at least 9 digits.' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' },
};

const FORBIDDEN: Record<OpenTableAction, Words> = {
  load: { th: 'บัญชีนี้ดูโต๊ะไม่ได้', en: 'This account cannot view tables.' },
  open: { th: 'บัญชีนี้ไม่มีสิทธิ์รับออเดอร์', en: 'This account cannot take orders.' },
  takeaway: { th: 'บัญชีนี้ไม่มีสิทธิ์รับออเดอร์', en: 'This account cannot take orders.' },
  reserve: { th: 'บัญชีนี้จองโต๊ะไม่ได้', en: 'This account cannot reserve tables.' },
};

const FIELDS: Partial<Record<OpenTableFailureCode, 'phone' | 'time'>> = {
  phone_invalid: 'phone',
  slot_taken: 'time',
};

const STALE: ReadonlySet<OpenTableFailureCode> = new Set([
  'open_order_exists',
  'table_reserved',
  'not_free',
  'inactive',
  'not_found',
]);

/** The words for a failure already reduced to its code. */
export function describeOpenTableFailure(
  code: OpenTableFailureCode,
  action: OpenTableAction,
  language: OpenTableLanguage = 'th',
): OpenTableFailure {
  const failure: OpenTableFailure = { code, title: TITLES[action][language] };
  const message = code === 'unknown' ? null : code === 'forbidden' ? FORBIDDEN[action] : MESSAGES[code];
  if (message) failure.message = message[language];
  const field = FIELDS[code];
  if (field) failure.field = field;
  if (STALE.has(code)) failure.stale = true;
  return failure;
}

/**
 * The failure of one step on the open-table screen, ready for a toast or a
 * field. Never contains the server's own words.
 */
export function openTableFailure(
  err: unknown,
  action: OpenTableAction,
  language: OpenTableLanguage = 'th',
): OpenTableFailure {
  return describeOpenTableFailure(openTableFailureCode(err, action), action, language);
}

const ISSUE_LINES: Record<OpenTableIssue, Words> = {
  no_table: { th: 'ยังไม่ได้เลือกโต๊ะ', en: 'No table chosen' },
  missing: { th: 'ไม่พบโต๊ะนี้', en: 'Table not found' },
  failed: { th: 'โหลดข้อมูลโต๊ะไม่สำเร็จ', en: 'Could not load the table' },
};

/**
 * The one line the dine-in form shows when it has no table to open: none was
 * chosen, the chosen one is gone, or the load failed (and why, when the why is
 * something the waiter can see to).
 */
export function openTableIssueLine(
  issue: OpenTableIssue,
  loadFailure: OpenTableFailureCode | null,
  language: OpenTableLanguage = 'th',
): string {
  if (issue === 'failed' && loadFailure === 'offline') {
    return language === 'th' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' : 'Cannot reach the server';
  }
  if (issue === 'failed' && loadFailure === 'forbidden') return FORBIDDEN.load[language];
  return ISSUE_LINES[issue][language];
}

/** Whether trying the load again could help: not when the account lacks access. */
export function openTableIssueRetries(issue: OpenTableIssue, loadFailure: OpenTableFailureCode | null): boolean {
  return issue === 'failed' && loadFailure !== 'forbidden';
}
