// What a failed step on the menu categories screen says to the person holding
// the phone.
//
// The category API refuses in English and in its own terms - "category name
// already exists", "category is still used by menu items", "resource not
// found" - and the old screen printed that straight into a panel. This maps
// each refusal onto the app's own Thai/English, patterned on table-error.ts: a
// title naming the step, and a message only when there is something to say
// beyond it. The server's wording never comes back out.
//
// A name problem carries `field` so the screen puts it under the name field;
// every other outcome goes through useToast as an Alert.

import type { CategoryNameProblem } from './category-order.ts';

export type CategoryLanguage = 'th' | 'en';

export const CATEGORY_ACTIONS = ['load', 'add', 'save', 'delete', 'reorder'] as const;

export type CategoryAction = (typeof CATEGORY_ACTIONS)[number];

export type CategoryFailureCode =
  | 'name_taken'
  | 'name_required'
  | 'name_too_long'
  | 'in_use'
  | 'not_found'
  | 'forbidden'
  | 'offline'
  | 'server_busy'
  | 'unknown';

export type CategoryFailure = {
  code: CategoryFailureCode;
  /** Names the step that failed. */
  title: string;
  /** Present only when it says more than the title. */
  message?: string;
  /** Render under the name field instead of raising a toast. */
  field?: 'name';
  /** The screen is stale: 'list' reloads the categories, 'membership' the member's permissions. */
  reload?: 'list' | 'membership';
};

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

function isServerBusy(message: string, status: number | null): boolean {
  if (status !== null && status >= 500) return true;
  return message.includes('temporarily unavailable')
    || message.includes('internal server error')
    || message.includes('timeout');
}

/** Maps whatever the API said onto the failures a person can act on. */
export function categoryFailureCode(err: unknown): CategoryFailureCode {
  const failed = readFailure(err);
  const message = failed.message.trim().toLowerCase();
  const { status, code } = failed;

  if (code === 'CATEGORY_NAME_EXISTS' || message.includes('already exists')) return 'name_taken';
  if (message.includes('category name is required')) return 'name_required';
  if (message.includes('category name is too long')) return 'name_too_long';
  if (message.includes('still used by menu items')) return 'in_use';
  if (isOffline(message)) return 'offline';
  if (status === 403 || message.includes('missing manage_menu permission') || message.includes('missing menu permission')) {
    return 'forbidden';
  }
  if (status === 404 || message.includes('resource not found')) return 'not_found';
  if (isServerBusy(message, status)) return 'server_busy';
  return 'unknown';
}

const TITLES: Record<CategoryAction, Words> = {
  load: { th: 'โหลดหมวดเมนูไม่สำเร็จ', en: 'Could not load the categories' },
  add: { th: 'เพิ่มหมวดไม่สำเร็จ', en: 'Could not add the category' },
  save: { th: 'บันทึกหมวดไม่สำเร็จ', en: 'Could not save the category' },
  delete: { th: 'ลบหมวดไม่ได้', en: 'Could not delete the category' },
  reorder: { th: 'จัดลำดับหมวดไม่สำเร็จ', en: 'Could not reorder the categories' },
};

const MESSAGES: Record<Exclude<CategoryFailureCode, 'forbidden' | 'unknown'>, Words> = {
  name_taken: { th: 'มีหมวดชื่อนี้แล้ว', en: 'That name is taken.' },
  name_required: { th: 'ใส่ชื่อหมวด', en: 'Enter a name.' },
  name_too_long: { th: 'ชื่อยาวเกินไป', en: 'That name is too long.' },
  in_use: { th: 'ยังมีเมนูในหมวดนี้', en: 'Dishes are still in this category.' },
  not_found: { th: 'หมวดนี้ถูกลบไปแล้ว', en: 'This category has been deleted.' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' },
};

/** A reorder PUT carries each name back; two legacy names that differ only in case fail it. */
const REORDER_NAME_CLASH: Words = { th: 'มีหมวดชื่อซ้ำกัน', en: 'Two categories share a name.' };
const FORBIDDEN_TO_VIEW: Words = { th: 'ไม่มีสิทธิ์ดูหมวดเมนู', en: 'This account cannot view the categories.' };
const FORBIDDEN_TO_EDIT: Words = { th: 'บัญชีนี้แก้ไขหมวดเมนูไม่ได้', en: 'This account cannot change menu categories.' };

const NAME_CODES: ReadonlySet<CategoryFailureCode> = new Set(['name_taken', 'name_required', 'name_too_long']);
const FIELD_ACTIONS: ReadonlySet<CategoryAction> = new Set(['add', 'save']);

function messageFor(code: CategoryFailureCode, action: CategoryAction): Words | null {
  if (code === 'unknown') return null;
  if (code === 'forbidden') return action === 'load' ? FORBIDDEN_TO_VIEW : FORBIDDEN_TO_EDIT;
  if (code === 'name_taken' && action === 'reorder') return REORDER_NAME_CLASH;
  return MESSAGES[code];
}

function reloadFor(code: CategoryFailureCode, action: CategoryAction): CategoryFailure['reload'] {
  if (code === 'forbidden') return 'membership';
  if (code === 'in_use' || code === 'not_found') return 'list';
  // A reorder that failed part-way left the server with some of the new numbers.
  if (action === 'reorder') return 'list';
  return undefined;
}

/**
 * The failure of one categories step, ready for a toast or the name field: the
 * step's title, a message when there is one, and what the screen should do
 * about it. Never contains the server's own words.
 */
export function categoryFailure(err: unknown, action: CategoryAction, language: CategoryLanguage = 'th'): CategoryFailure {
  const code = categoryFailureCode(err);
  const failure: CategoryFailure = { code, title: TITLES[action][language] };
  const message = messageFor(code, action);
  if (message) failure.message = message[language];
  if (NAME_CODES.has(code) && FIELD_ACTIONS.has(action)) failure.field = 'name';
  const reload = reloadFor(code, action);
  if (reload) failure.reload = reload;
  return failure;
}

/** The title of a step on its own, for a refusal the screen makes before any request. */
export function categoryActionTitle(action: CategoryAction, language: CategoryLanguage = 'th'): string {
  return TITLES[action][language];
}

/** The one line a failed first load shows above ลองอีกครั้ง. */
export function categoryLoadLine(err: unknown, language: CategoryLanguage = 'th'): string {
  const code = categoryFailureCode(err);
  if (code === 'offline') return language === 'th' ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' : 'Cannot reach the server';
  if (code === 'forbidden') return language === 'th' ? 'ไม่มีสิทธิ์ดูหมวดเมนู' : 'No access to menu categories';
  return TITLES.load[language];
}

/** What the name field says about a problem caught before any request. */
export function categoryNameMessage(problem: CategoryNameProblem, language: CategoryLanguage = 'th'): string {
  return MESSAGES[problem][language];
}

/** Why a category with dishes in it cannot go: "ยังมี 3 เมนูในหมวดนี้". */
export function categoryInUseMessage(count: number, language: CategoryLanguage = 'th'): string {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  if (language === 'th') return `ยังมี ${value.toLocaleString('th-TH')} เมนูในหมวดนี้`;
  return value === 1 ? '1 dish is still in it.' : `${value.toLocaleString('en-US')} dishes are still in it.`;
}
