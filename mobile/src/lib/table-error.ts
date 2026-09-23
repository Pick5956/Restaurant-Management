// What a failed table-management step says to the person holding the phone.
//
// The table API refuses in English and in its own terms - "table has order
// history; mark it inactive instead", "resource already exists" - and the old
// screens printed that straight into a Feedback panel. This maps each refusal
// onto the app's own Thai/English, patterned on auth-error.ts: a title naming
// the step, and a message only when there is something to say beyond it. The
// server's wording never comes back out.
//
// Field problems (a zone name, a prefix) carry `field` so the screen puts them
// under that field; every other outcome goes through useToast as an Alert.

export type TableLanguage = 'th' | 'en';

export const TABLE_ACTIONS = [
  'load',
  'add',
  'save',
  'delete',
  'regenerate',
  'zone_save',
  'zone_delete',
  'zone_reorder',
  'move',
] as const;

export type TableAction = (typeof TABLE_ACTIONS)[number];

export type TableFailureCode =
  | 'table_in_use'
  | 'has_history'
  | 'has_reservation'
  | 'has_open_order'
  | 'zone_has_tables'
  | 'prefix_taken'
  | 'prefix_too_long'
  | 'name_required'
  | 'label_clash'
  | 'zone_missing'
  | 'no_free_number'
  | 'count_range'
  | 'capacity_range'
  | 'not_found'
  | 'forbidden'
  | 'offline'
  | 'server_busy'
  | 'unknown';

export type TableFailure = {
  code: TableFailureCode;
  /** Names the step that failed. */
  title: string;
  /** Present only when it says more than the title. */
  message?: string;
  /** Render under this field instead of raising a toast. */
  field?: 'name' | 'prefix';
  /**
   * The screen is stale: 'plan' reloads tables, zones and orders; 'membership'
   * reloads the member's permissions (a 403 means they changed).
   */
  reload?: 'plan' | 'membership';
  /** An order-history refusal: the Alert offers ปิดใช้งานแทน. */
  offerDeactivate?: true;
};

type Words = { th: string; en: string };

const ZONE_ACTIONS: ReadonlySet<TableAction> = new Set(['zone_save', 'zone_delete', 'zone_reorder']);

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

/** The lock (owner, 2026-09-23): a table in service cannot be changed from table management. */
function isTableInUse(message: string, status: number | null, code: string): boolean {
  if (code === 'table_in_use') return true;
  if (message.includes('table is in use')) return true;
  return status === 409 && message.includes('in use');
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

/** Maps whatever the API said onto the failures a person can act on. */
export function tableFailureCode(err: unknown, action: TableAction): TableFailureCode {
  const failed = readFailure(err);
  const message = failed.message.trim().toLowerCase();
  const { status, code } = failed;

  if (isTableInUse(message, status, code)) return 'table_in_use';
  if (message.includes('order history')) return 'has_history';
  if (message.includes('active reservation')) return 'has_reservation';
  if (message.includes('open order')) return 'has_open_order';
  if (message.includes('still has tables')) return 'zone_has_tables';
  if (message.includes('prefix is already used')) return 'prefix_taken';
  if (message.includes('prefix must be 8')) return 'prefix_too_long';
  if (message.includes('zone name is required')) return 'name_required';
  if (message.includes('table zone not found')) return 'zone_missing';
  if (message.includes('could not find an unused table number')) return 'no_free_number';
  if (message.includes('count must be between')) return 'count_range';
  if (message.includes('capacity must be between')) return 'capacity_range';
  // A duplicate key: on a zone save it is the prefix index (a soft-deleted zone
  // still holds its prefix); anywhere else it is a table label another table holds.
  if (message.includes('already exists')) return action === 'zone_save' ? 'prefix_taken' : 'label_clash';
  if (isOffline(message)) return 'offline';
  if (status === 403 || message.includes('missing manage_table permission') || message.includes('missing table permission')) {
    return 'forbidden';
  }
  if (status === 404 || message.includes('resource not found')) {
    return ZONE_ACTIONS.has(action) ? 'zone_missing' : 'not_found';
  }
  if (isServerBusy(message, status)) return 'server_busy';
  return 'unknown';
}

const TITLES: Record<TableAction, Words> = {
  load: { th: 'โหลดผังโต๊ะไม่สำเร็จ', en: 'Could not load the tables' },
  add: { th: 'เพิ่มโต๊ะไม่สำเร็จ', en: 'Could not add tables' },
  save: { th: 'บันทึกไม่สำเร็จ', en: 'Could not save' },
  delete: { th: 'ลบไม่ได้', en: 'Could not delete' },
  regenerate: { th: 'สร้าง QR ใหม่ไม่สำเร็จ', en: 'Could not make a new QR' },
  zone_save: { th: 'บันทึกโซนไม่สำเร็จ', en: 'Could not save the zone' },
  zone_delete: { th: 'ลบโซนไม่ได้', en: 'Could not delete the zone' },
  zone_reorder: { th: 'จัดลำดับโซนไม่สำเร็จ', en: 'Could not reorder the zones' },
  move: { th: 'ย้ายโซนไม่สำเร็จ', en: 'Could not move the table' },
};

const MESSAGES: Record<Exclude<TableFailureCode, 'forbidden' | 'unknown'>, Words> = {
  table_in_use: { th: 'โต๊ะนี้กำลังใช้งาน', en: 'This table is being served.' },
  has_history: { th: 'มีประวัติออเดอร์', en: 'It has past orders.' },
  has_reservation: { th: 'มีการจองอยู่ ยกเลิกการจองก่อน', en: 'It is booked. Cancel the booking first.' },
  has_open_order: { th: 'มีออเดอร์เปิดอยู่', en: 'An order is still open on it.' },
  zone_has_tables: { th: 'ยังมีโต๊ะในโซนนี้', en: 'Tables are still in this zone.' },
  prefix_taken: { th: 'คำนำหน้านี้ถูกใช้แล้ว', en: 'That prefix is taken.' },
  prefix_too_long: { th: 'คำนำหน้ายาวเกินไป', en: 'That prefix is too long.' },
  name_required: { th: 'ใส่ชื่อโซน', en: 'Enter a zone name.' },
  label_clash: { th: 'เลขโต๊ะซ้ำกับโต๊ะอื่น', en: 'Another table has that number.' },
  zone_missing: { th: 'ไม่พบโซนนี้แล้ว', en: 'That zone is gone.' },
  no_free_number: { th: 'หาเลขโต๊ะว่างไม่ได้ เปลี่ยนคำนำหน้าของโซน', en: 'No free table number. Change the zone prefix.' },
  count_range: { th: 'เพิ่มได้ครั้งละ 1–200 โต๊ะ', en: 'Add 1–200 tables at a time.' },
  capacity_range: { th: 'ที่นั่งต่อโต๊ะ 1–50', en: 'Seats per table: 1–50.' },
  not_found: { th: 'โต๊ะนี้ถูกลบไปแล้ว', en: 'This table has been deleted.' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' },
};

/** A zone's new prefix renumbers all its tables, so the lock refuses it for any one of them. */
const ZONE_IN_USE: Words = { th: 'โซนนี้มีโต๊ะที่กำลังใช้งาน', en: 'A table in this zone is being served.' };
const FORBIDDEN_TO_VIEW: Words = { th: 'ไม่มีสิทธิ์ดูผังโต๊ะ', en: 'This account cannot view the tables.' };
const FORBIDDEN_TO_EDIT: Words = { th: 'บัญชีนี้แก้ไขโต๊ะไม่ได้', en: 'This account cannot change tables.' };

const FIELDS: Partial<Record<TableFailureCode, 'name' | 'prefix'>> = {
  prefix_taken: 'prefix',
  prefix_too_long: 'prefix',
  name_required: 'name',
};

const RELOADS: Partial<Record<TableFailureCode, 'plan' | 'membership'>> = {
  table_in_use: 'plan',
  has_reservation: 'plan',
  has_open_order: 'plan',
  zone_has_tables: 'plan',
  label_clash: 'plan',
  zone_missing: 'plan',
  not_found: 'plan',
  forbidden: 'membership',
};

function messageFor(code: TableFailureCode, action: TableAction): Words | null {
  if (code === 'unknown') return null;
  if (code === 'forbidden') return action === 'load' ? FORBIDDEN_TO_VIEW : FORBIDDEN_TO_EDIT;
  if (code === 'table_in_use' && ZONE_ACTIONS.has(action)) return ZONE_IN_USE;
  return MESSAGES[code];
}

/**
 * The failure of one table-management step, ready for a toast or a field: the
 * step's title, a message when there is one, and what the screen should do
 * about it. Never contains the server's own words.
 */
export function tableFailure(err: unknown, action: TableAction, language: TableLanguage = 'th'): TableFailure {
  const code = tableFailureCode(err, action);
  const failure: TableFailure = { code, title: TITLES[action][language] };
  const message = messageFor(code, action);
  if (message) failure.message = message[language];
  const field = FIELDS[code];
  if (field) failure.field = field;
  const reload = RELOADS[code];
  if (reload) failure.reload = reload;
  if (code === 'has_history') failure.offerDeactivate = true;
  return failure;
}

/** The one line a failed first load of the floor shows above ลองอีกครั้ง. */
export function tableLoadFailureLine(err: unknown, language: TableLanguage = 'th'): string {
  const code = tableFailureCode(err, 'load');
  if (code === 'offline') return language === 'th' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' : 'Cannot reach the server';
  if (code === 'forbidden') return language === 'th' ? 'ไม่มีสิทธิ์ดูผังโต๊ะ' : 'No access to the tables';
  return TITLES.load[language];
}

const REASONS: Record<TableFailureCode, Words> = {
  table_in_use: { th: 'กำลังใช้งาน', en: 'in use' },
  has_history: { th: 'มีประวัติออเดอร์', en: 'has past orders' },
  has_reservation: { th: 'มีการจองอยู่', en: 'booked' },
  has_open_order: { th: 'มีออเดอร์เปิดอยู่', en: 'order open' },
  zone_has_tables: { th: 'ยังมีโต๊ะในโซน', en: 'zone has tables' },
  prefix_taken: { th: 'คำนำหน้าซ้ำ', en: 'prefix taken' },
  prefix_too_long: { th: 'คำนำหน้ายาวเกินไป', en: 'prefix too long' },
  name_required: { th: 'ไม่มีชื่อโซน', en: 'no zone name' },
  label_clash: { th: 'เลขซ้ำกับโต๊ะอื่น', en: 'number taken' },
  zone_missing: { th: 'ไม่พบโซนแล้ว', en: 'zone gone' },
  no_free_number: { th: 'หาเลขโต๊ะว่างไม่ได้', en: 'no free number' },
  count_range: { th: 'จำนวนเกินกำหนด', en: 'count out of range' },
  capacity_range: { th: 'ที่นั่งเกินกำหนด', en: 'seats out of range' },
  not_found: { th: 'ถูกลบไปแล้ว', en: 'deleted' },
  forbidden: { th: 'ไม่มีสิทธิ์', en: 'no access' },
  offline: { th: 'เชื่อมต่อไม่ได้', en: 'offline' },
  server_busy: { th: 'ระบบขัดข้อง', en: 'service trouble' },
  unknown: { th: 'ไม่สำเร็จ', en: 'failed' },
};

/** A short reason after a table label in a partial bulk report: "T7 เลขซ้ำกับโต๊ะอื่น". */
export function tableFailureReason(code: TableFailureCode, language: TableLanguage = 'th'): string {
  return REASONS[code][language];
}

export type BulkVerb = 'close' | 'open' | 'move' | 'delete' | 'seats';

const BULK_VERBS: Record<BulkVerb, Words> = {
  close: { th: 'ปิด', en: 'Closed' },
  open: { th: 'เปิด', en: 'Opened' },
  move: { th: 'ย้าย', en: 'Moved' },
  delete: { th: 'ลบ', en: 'Deleted' },
  seats: { th: 'ตั้งที่นั่ง', en: 'Set seats on' },
};

/** "ย้ายได้ 4 จาก 5 โต๊ะ": the title of a bulk action that only partly went through. */
export function bulkResultTitle(verb: BulkVerb, done: number, total: number, language: TableLanguage = 'th'): string {
  const words = BULK_VERBS[verb];
  if (language === 'th') return `${words.th}ได้ ${done} จาก ${total} โต๊ะ`;
  return `${words.en} ${done} of ${total} ${total === 1 ? 'table' : 'tables'}`;
}

/**
 * The tables a bulk action left behind, grouped by reason in the order they
 * came: "T2, T3 มีประวัติออเดอร์, T7 จอง". `reason` is already worded - a
 * tableFailureReason, or the status word of a table that was left out.
 */
export function bulkFailureLines(failures: readonly { label: string; reason: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const { label, reason } of failures) {
    const labels = groups.get(reason);
    if (labels) labels.push(label);
    else groups.set(reason, [label]);
  }
  return [...groups].map(([reason, labels]) => `${labels.join(', ')} ${reason}`).join(', ');
}
