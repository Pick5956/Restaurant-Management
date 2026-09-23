// The bill's non-payment actions in the app's own words: loading the bill,
// sending a round to the kitchen, deleting an unsent line, taking a made dish
// off the bill. The API refuses in English ("cannot send a closed order to
// kitchen", "no pending items to send"), and the bill used to print that
// straight into its toasts. Mapped onto the few outcomes staff can act on;
// anything else returns null so the caller says only which step failed.
// Patterned on payment-failure.ts and auth-error.ts.

import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { paymentFailureCode } from './payment-failure.ts';

export type BillActionFailureCode =
  | 'order_closed'
  | 'nothing_to_send'
  | 'already_sent'
  | 'sold_out'
  | 'gone'
  | 'offline'
  | 'server_busy'
  | 'unknown';

function rawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : '';
}

/** Maps whatever the API or the network said onto what staff can act on. */
export function billActionFailureCode(err: unknown): BillActionFailureCode {
  const message = rawMessage(err).trim().toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('closed order') || message.includes('order is already closed')) return 'order_closed';
  if (message.includes('no pending items to send')) return 'nothing_to_send';
  if (message.includes('only pending items can be edited') || message.includes('order item status transition is forbidden')) {
    return 'already_sent';
  }
  if (message.includes('is unavailable') || message.includes('unavailable ingredient')) return 'sold_out';
  if (message.includes('not found')) return 'gone';
  // The network and a struggling server read the same here as at payment.
  const shared = paymentFailureCode(message);
  if (shared === 'offline' || shared === 'server_busy') return shared;
  return 'unknown';
}

const MESSAGES: Record<BillActionFailureCode, { th: string; en: string } | null> = {
  order_closed: { th: 'ออเดอร์นี้ปิดไปแล้ว', en: 'This order is already closed' },
  nothing_to_send: { th: 'ไม่มีรายการรอส่งครัว', en: 'Nothing is waiting to go to the kitchen' },
  already_sent: { th: 'รายการนี้ส่งครัวไปแล้ว', en: 'This item has already gone to the kitchen' },
  sold_out: { th: 'มีเมนูที่หมดแล้ว', en: 'Something on it is sold out' },
  gone: { th: 'ไม่พบรายการนี้แล้ว', en: 'This is no longer there' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง', en: 'Cannot reach the server. Try again' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง', en: 'The service is having trouble. Try again' },
  // The caller names the step that failed; a second vague line adds nothing.
  unknown: null,
};

/** The mapped reason for a failed bill action, or null when only the step can be named. */
export function billActionFailureMessage(err: unknown, language: DisplayLanguage): string | null {
  const message = MESSAGES[billActionFailureCode(err)];
  return message ? message[language] : null;
}
