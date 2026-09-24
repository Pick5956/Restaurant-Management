// What a failed invitation check or accept says on the invite screen. The
// server answers in English and in its own words ("membership is suspended",
// "invitation is no longer usable"), and the screen used to print that under
// its red heading. The failures a person can act on get the app's own words;
// anything else gets the screen's own line, never the server's.

export type InviteFailureCode =
  | 'suspended'
  | 'other_email'
  | 'not_usable'
  | 'account_inactive'
  | 'not_found'
  | 'offline'
  | 'server_busy'
  | 'rate_limited'
  | 'unknown';

/**
 * Maps whatever the API said onto the few failures a person can act on. The
 * HTTP status decides first: a tunnel or proxy outage reaches the app as
 * "Request failed (530)" (src/api/client.ts names a non-JSON body that way) and
 * the rate limiter as "too many requests" (429) or "rate limit unavailable"
 * (503). None of those is a bad invitation, and falling through to the
 * screen's fallback blamed the invitation for the server's hiccup.
 */
export function inviteFailureCode(raw: string | null | undefined, status?: number | null): InviteFailureCode {
  if (typeof status === 'number' && Number.isFinite(status)) {
    if (status >= 500) return 'server_busy';
    if (status === 429) return 'rate_limited';
  }
  const message = String(raw || '').trim().toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('membership is suspended')) return 'suspended';
  if (message.includes('different email')) return 'other_email';
  if (message.includes('no longer usable')) return 'not_usable';
  if (message.includes('user account is not active')) return 'account_inactive';
  if (message.includes('invalid invitation token') || message.includes('not found')) return 'not_found';
  // React Native's fetch says "Network request failed"; a dropped LAN backend
  // reaches us the same way.
  if (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error')) {
    return 'offline';
  }
  if (message.includes('temporarily unavailable') || message.includes('internal server error') || message.includes('timeout')) {
    return 'server_busy';
  }
  return 'unknown';
}

const MESSAGES: Record<Exclude<InviteFailureCode, 'unknown'>, { th: string; en: string }> = {
  suspended: { th: 'บัญชีนี้ถูกพักการใช้งานในร้านนี้ ติดต่อเจ้าของร้าน', en: 'This account is suspended at this restaurant. Contact the owner.' },
  other_email: { th: 'คำเชิญนี้เป็นของอีเมลอื่น', en: 'This invitation is for a different email.' },
  not_usable: { th: 'คำเชิญนี้ใช้ไม่ได้แล้ว ขอลิงก์ใหม่จากร้าน', en: 'This invitation can no longer be used. Ask the restaurant for a new link.' },
  account_inactive: { th: 'บัญชีนี้ถูกปิดใช้งาน', en: 'This account is not active.' },
  not_found: { th: 'ไม่พบคำเชิญหรือคำเชิญถูกลบแล้ว', en: 'The invitation was not found or has been deleted.' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  // The cause only: the way to try again is already under this line - the
  // screen's ลองอีกครั้ง button, or the accept button itself.
  server_busy: { th: 'ระบบขัดข้องชั่วคราว', en: 'The service is having trouble.' },
  rate_limited: { th: 'ส่งคำขอถี่เกินไป', en: 'Too many attempts.' },
};

/** The status src/api/client.ts puts on its ApiError, when the failure has one. */
function failureStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

/** The line under the invite screen's red heading: the app's words, or `fallback`. */
export function inviteFailureMessage(err: unknown, language: 'th' | 'en', fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const code = inviteFailureCode(raw, failureStatus(err));
  return code === 'unknown' ? fallback : MESSAGES[code][language];
}
