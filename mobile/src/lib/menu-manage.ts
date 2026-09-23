// The menu manager's (app/menu.tsx) pure logic: what each dish tile says about
// its stock, how the availability switch folds into the list, which view the
// screen is in, and what a failed step says to the person holding the phone.
//
// The failure words follow table-error.ts: the API answers in English and in its
// own terms ("missing manage_menu permission", "resource not found"), so a
// failure maps to a title naming the step and, only when there is something to
// add, a message. The server's wording never comes back out.

import type { Category, MenuItem } from '@/src/types/menu';

import { LOW_STOCK_SERVINGS } from './menu-catalog.ts';

export type MenuManageLanguage = 'th' | 'en';

type Words = { th: string; en: string };

// ---------------------------------------------------------------- stock

export type MenuManageStock =
  | { kind: 'out' }
  | { kind: 'low' | 'plenty'; count: number }
  | { kind: 'unlimited' };

/**
 * The stock mark beside a dish's price. It reads only `remaining_servings`, not
 * the switch: the switch sits on the same tile and already says whether the dish
 * is on sale, and the hub counts "sold out" the same way (remaining <= 0 whatever
 * the switch says). A dish with no recipe is never stock-limited, and says so.
 */
export function menuManageStock(item: Pick<MenuItem, 'remaining_servings'>): MenuManageStock {
  const remaining = item.remaining_servings;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return { kind: 'unlimited' };
  if (remaining <= 0) return { kind: 'out' };
  return { kind: remaining <= LOW_STOCK_SERVINGS ? 'low' : 'plenty', count: remaining };
}

/** The mark's words, also spoken in the tile's accessibility label. */
export function menuStockWords(stock: MenuManageStock, language: MenuManageLanguage): string {
  if (stock.kind === 'out') return language === 'en' ? 'Sold out' : 'หมด';
  if (stock.kind === 'unlimited') return language === 'en' ? 'No limit' : 'ไม่จำกัด';
  return language === 'en'
    ? `${stock.count.toLocaleString('en-US')} left`
    : `เหลือ ${stock.count.toLocaleString('th-TH')}`;
}

// ---------------------------------------------------------------- availability

/** The list with one dish's switch set, as a new array; the other rows keep their identity. */
export function withAvailability<T extends Pick<MenuItem, 'ID' | 'is_available'>>(
  items: readonly T[],
  id: number,
  available: boolean,
): T[] {
  return items.map((entry) => (entry.ID === id && entry.is_available !== available ? { ...entry, is_available: available } : entry));
}

/**
 * Folds the PATCH availability reply into its row. The reply is the bare item
 * (the server reads it back without working out the stock), so replacing the
 * row wholesale dropped `remaining_servings` and a limited dish turned into
 * "no limit" until the next reload. The row keeps what the reply does not carry;
 * a reply that does carry the stock wins.
 */
export function mergeAvailabilityReply<T extends Pick<MenuItem, 'ID'>>(
  items: readonly T[],
  reply: Partial<MenuItem> & Pick<MenuItem, 'ID'>,
): T[] {
  return items.map((entry) => (entry.ID === reply.ID ? { ...entry, ...reply } as T : entry));
}

// ---------------------------------------------------------------- filter

/**
 * The category filter the list may keep. A category deleted or switched off on
 * /menu/categories leaves the options when the screen reloads; keeping its id
 * left the picker blank and the list empty with no visible reason, so it falls
 * back to every category.
 */
export function activeCategoryFilter(
  categoryId: string,
  categories: readonly Pick<Category, 'ID' | 'is_active'>[],
): string {
  if (categoryId === 'all') return 'all';
  return categories.some((category) => category.is_active && String(category.ID) === categoryId) ? categoryId : 'all';
}

// ---------------------------------------------------------------- view

export type MenuManageView = 'skeleton' | 'failed' | 'empty' | 'no_match' | 'list';

/**
 * What the body shows. Dishes on screen always win: a reload that fails over a
 * list keeps the list (the failure is raised as an alert instead). With nothing
 * on screen, a failed load names itself, a finished one says the menu is empty,
 * and until the first answer the skeleton holds the grid's place.
 */
export function menuManageView({ loaded, failed, total, shown }: {
  loaded: boolean;
  failed: boolean;
  total: number;
  shown: number;
}): MenuManageView {
  if (total > 0) return shown > 0 ? 'list' : 'no_match';
  if (failed) return 'failed';
  return loaded ? 'empty' : 'skeleton';
}

// ---------------------------------------------------------------- failures

export type MenuManageAction = 'load' | 'toggle';

export type MenuManageFailureCode = 'forbidden' | 'not_found' | 'offline' | 'server_busy' | 'unknown';

export type MenuManageFailure = {
  code: MenuManageFailureCode;
  /** Names the step that failed. */
  title: string;
  /** Present only when it says more than the title. */
  message?: string;
  /**
   * The screen is stale: 'list' reloads the dishes (the one tapped is gone);
   * 'membership' reloads the member's permissions (a 403 means they changed).
   */
  reload?: 'list' | 'membership';
};

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

/** Maps whatever the API said onto the failures a person can act on. */
export function menuManageFailureCode(err: unknown): MenuManageFailureCode {
  const { message: raw, status } = readFailure(err);
  const message = raw.trim().toLowerCase();
  // React Native's fetch says "Network request failed"; a dropped LAN backend
  // reaches us the same way, with no status at all.
  if (status === null && (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error'))) {
    return 'offline';
  }
  if (status === 403 || message.includes('missing manage_menu permission') || message.includes('missing view_menu permission')) {
    return 'forbidden';
  }
  if (status === 404 || message.includes('resource not found')) return 'not_found';
  if ((status !== null && status >= 500) || message.includes('temporarily unavailable') || message.includes('internal server error')) {
    return 'server_busy';
  }
  return 'unknown';
}

const TITLES: Record<MenuManageAction, Words> = {
  load: { th: 'โหลดเมนูไม่สำเร็จ', en: 'Could not load the menu' },
  toggle: { th: 'เปลี่ยนสถานะเมนูไม่สำเร็จ', en: 'Could not change the menu status' },
};

const FORBIDDEN: Record<MenuManageAction, Words> = {
  load: { th: 'บัญชีนี้ไม่มีสิทธิ์ดูเมนู', en: 'This account cannot view the menu.' },
  toggle: { th: 'บัญชีนี้ไม่มีสิทธิ์จัดการเมนู', en: 'This account cannot manage the menu.' },
};

const DELETED: Words = { th: 'เมนูนี้ถูกลบไปแล้ว', en: 'This dish has been deleted.' };
const OFFLINE: Words = { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' };
const SERVER_BUSY: Words = { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' };

function pick(words: Words, language: MenuManageLanguage): string {
  return language === 'en' ? words.en : words.th;
}

/** A failed menu step in the app's own words: never the server's `message`. */
export function menuManageFailure(err: unknown, action: MenuManageAction, language: MenuManageLanguage = 'th'): MenuManageFailure {
  const code = menuManageFailureCode(err);
  const failure: MenuManageFailure = { code, title: pick(TITLES[action], language) };
  if (code === 'forbidden') {
    failure.message = pick(FORBIDDEN[action], language);
    failure.reload = 'membership';
  } else if (code === 'not_found' && action === 'toggle') {
    // Only a dish can be missing; a 404 on the list itself says nothing more
    // than its title does.
    failure.message = pick(DELETED, language);
    failure.reload = 'list';
  } else if (code === 'offline') {
    failure.message = pick(OFFLINE, language);
  } else if (code === 'server_busy') {
    failure.message = pick(SERVER_BUSY, language);
  }
  return failure;
}

/** The one line a failed first load shows above ลองอีกครั้ง. */
export function menuLoadFailureLine(err: unknown, language: MenuManageLanguage = 'th'): string {
  const code = menuManageFailureCode(err);
  if (code === 'offline') return language === 'en' ? 'Cannot reach the server' : 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
  if (code === 'forbidden') return language === 'en' ? 'No access to the menu' : 'ไม่มีสิทธิ์ดูเมนู';
  return pick(TITLES.load, language);
}
