// The shared answer to "what does a failed request say to the person in front
// of the phone". The server answers in English and in its own words ("missing
// view_orders permission", "record not found", "internal server error"), and
// React Native's fetch says "Network request failed"; screens used to print
// either straight under their red heading. The rule: never show the API's own
// wording. A screen maps the failures it knows (a name already taken, a table
// in service) with its own mapper first, and falls back to this one for the
// failures every screen shares.
//
// An unmapped failure gives `undefined`: the step's title stands alone, with
// nothing vague after it.

export type ApiFailureKind =
  | 'offline'
  | 'server_busy'
  | 'rate_limited'
  | 'forbidden'
  | 'not_found'
  | 'unknown';

/** The HTTP status src/api/client.ts puts on its ApiError, when there is one. */
export function apiFailureStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function failureText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

/**
 * The `code` of the error body the server sent, which src/api/client.ts keeps
 * as the raw text in ApiError.details. Empty when there is none. A code is for
 * telling refusals apart, never for display.
 */
export function apiFailureCode(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const details = (err as { details?: unknown }).details;
  if (typeof details !== 'string' || !details.trim().startsWith('{')) return '';
  try {
    const code = (JSON.parse(details) as { code?: unknown }).code;
    return typeof code === 'string' ? code : '';
  } catch {
    return '';
  }
}

/**
 * Whether the server's text contains `words`. For telling apart two refusals
 * that share a status and a code (a plan that expired or was cancelled, both
 * 410) - it answers yes or no, so the text itself never reaches the screen.
 */
export function apiFailureSays(err: unknown, words: string): boolean {
  const needle = words.trim().toLowerCase();
  return needle !== '' && failureText(err).toLowerCase().includes(needle);
}

/** Sorts a failure into the few kinds every screen can say something about. */
export function apiFailureKind(err: unknown): ApiFailureKind {
  const status = apiFailureStatus(err);
  if (status !== null) {
    if (status >= 500) return 'server_busy';
    if (status === 429) return 'rate_limited';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not_found';
  }
  const message = failureText(err).trim().toLowerCase();
  if (!message) return 'unknown';
  // No status: the request never got an answer. RN says "Network request
  // failed"; a dropped LAN backend reaches us the same way.
  if (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error') || message.includes('timeout')) {
    return 'offline';
  }
  if (message.includes('internal server error') || message.includes('temporarily unavailable')) return 'server_busy';
  if (message.includes('too many requests')) return 'rate_limited';
  if (message.includes('missing ') && message.includes('permission')) return 'forbidden';
  // "Not found" is read from the wording only with no status or a 409. A 404
  // decided above; a 400 "ingredient category not found" is a bad field, and
  // "ไม่พบรายการนี้แล้ว" under it read as if the ingredient itself were gone.
  // A 409 is how the ingredient delete answers every failure, so its
  // "ingredient not found" is the ingredient already gone. The category, table
  // and zone deletes answer a missing row with a 404, decided above.
  if ((status === null || status === 409) && message.includes('not found')) return 'not_found';
  return 'unknown';
}

const DETAILS: Record<Exclude<ApiFailureKind, 'unknown'>, { th: string; en: string }> = {
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว', en: 'The service is having trouble.' },
  rate_limited: { th: 'ส่งคำขอถี่เกินไป', en: 'Too many attempts.' },
  forbidden: { th: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', en: 'This account does not have permission for this.' },
  not_found: { th: 'ไม่พบรายการนี้แล้ว', en: 'This no longer exists.' },
};

/**
 * The line under a failed step's title: the app's own words for a failure
 * every screen shares, or `undefined` when there is nothing better to say than
 * the title. Never the server's wording.
 */
export function apiFailureDetail(err: unknown, language: 'th' | 'en'): string | undefined {
  const kind = apiFailureKind(err);
  return kind === 'unknown' ? undefined : DETAILS[kind][language];
}
