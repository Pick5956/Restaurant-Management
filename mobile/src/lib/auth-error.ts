// What a sign-in, sign-up or reset failure says to the person in front of the
// phone. The server answers in English and in its own words - "invalid
// credentials", "resource already exists" - and the login screen used to print
// that straight onto the page under a red heading. A waiter reading Thai got a
// line of English that named no way forward.

export type AuthAction = 'sign_in' | 'google' | 'register' | 'reset';

export type AuthFailureCode =
  | 'invalid_credentials'
  | 'google_rejected'
  | 'email_taken'
  | 'account_missing'
  | 'password_too_short'
  | 'password_too_long'
  | 'offline'
  | 'server_busy'
  | 'unknown';

/** Maps whatever the API said onto the few failures a person can act on. */
export function authFailureCode(raw: string | null | undefined): AuthFailureCode {
  const message = String(raw || '').trim().toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('invalid google credentials')) return 'google_rejected';
  if (message.includes('invalid credentials')) return 'invalid_credentials';
  if (message.includes('already exists')) return 'email_taken';
  if (message.includes('user not found') || message.includes('resource not found')) return 'account_missing';
  if (message.includes('at least 8')) return 'password_too_short';
  if (message.includes('at most 72')) return 'password_too_long';
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

const TITLES: Record<AuthAction, { th: string; en: string }> = {
  sign_in: { th: 'เข้าสู่ระบบไม่สำเร็จ', en: 'Could not sign in' },
  google: { th: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ', en: 'Could not sign in with Google' },
  register: { th: 'สร้างบัญชีไม่สำเร็จ', en: 'Could not create the account' },
  reset: { th: 'ส่งลิงก์ไม่สำเร็จ', en: 'Could not send the link' },
};

const MESSAGES: Record<AuthFailureCode, { th: string; en: string } | null> = {
  invalid_credentials: { th: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', en: 'That email or password is incorrect.' },
  google_rejected: { th: 'Google ยืนยันบัญชีนี้ไม่ได้ ลองอีกครั้งหรือใช้อีเมลแทน', en: 'Google could not verify this account. Try again or use email.' },
  email_taken: { th: 'อีเมลนี้มีบัญชีอยู่แล้ว เข้าสู่ระบบได้เลย', en: 'An account already uses this email. Sign in instead.' },
  account_missing: { th: 'ไม่พบบัญชีที่ใช้อีเมลนี้', en: 'No account uses this email.' },
  password_too_short: { th: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร', en: 'The password must be at least 8 characters.' },
  password_too_long: { th: 'รหัสผ่านยาวเกินไป', en: 'That password is too long.' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' },
  // The title already says which step failed; a second vague line adds nothing.
  unknown: null,
};

/**
 * The toast for a failed auth step: a Thai/English title naming the step, and a
 * message only when there is something to say beyond it. The server's own
 * wording never reaches the screen.
 */
export function authFailureToast(
  raw: string | null | undefined,
  action: AuthAction,
  language: 'th' | 'en',
): { title: string; message?: string } {
  const code = authFailureCode(raw);
  const title = TITLES[action][language];
  const message = MESSAGES[code];
  return message ? { title, message: message[language] } : { title };
}
