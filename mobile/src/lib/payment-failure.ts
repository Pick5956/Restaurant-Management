// Why a payment cannot go through, in the app's own words.
//
// Two halves. Before the tap: paymentBlock() names what is holding payment
// back, so the reason sits beside the greyed-out action instead of in a panel
// under every dish. After the tap: the API refuses in English and in its own
// terms ("all active order items must be completed by the kitchen before
// payment"), and the bill used to print that straight into the failure toast.
// paymentFailureCode() maps it onto the few outcomes a cashier can act on,
// patterned on auth-error.ts; the server's wording never comes back out.

import type { DisplayLanguage } from '@/src/lib/display-preferences';

export type PaymentFailureCode =
  | 'kitchen_not_done'
  | 'total_changed'
  | 'offline'
  | 'server_busy'
  | 'unknown';

/** Maps whatever the pay endpoint said onto the failures a cashier can act on. */
export function paymentFailureCode(raw: string | null | undefined): PaymentFailureCode {
  const message = String(raw || '').trim().toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('completed by the kitchen before payment') || message.includes('completed kitchen item before payment')) {
    return 'kitchen_not_done';
  }
  // The server prices the order again under the payment's own lock; a
  // promotion boundary crossed since the bill loaded lands here.
  if (message.includes('received amount is less than grand total')) return 'total_changed';
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

const FAILURE_MESSAGES: Record<PaymentFailureCode, { th: string; en: string } | null> = {
  kitchen_not_done: { th: 'ครัวยังทำอาหารไม่ครบทุกรายการ', en: 'The kitchen has not finished every item' },
  total_changed: { th: 'ยอดบิลเปลี่ยนแล้ว ตรวจยอดใหม่ก่อนรับเงิน', en: 'The bill total changed. Check it before taking payment' },
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง', en: 'Cannot reach the server. Try again' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองอีกครั้ง', en: 'The service is having trouble. Try again' },
  // The toast's title already says the payment did not go through; a second
  // vague line adds nothing.
  unknown: null,
};

/** The toast message for a failed payment, or null when the title says enough. */
export function paymentFailureMessage(code: PaymentFailureCode, language: DisplayLanguage): string | null {
  const message = FAILURE_MESSAGES[code];
  return message ? message[language] : null;
}

export type PaymentBlock =
  | { kind: 'stale' }
  | { kind: 'unsent'; quantity: number }
  | { kind: 'kitchen'; quantity: number };

interface BlockingItem {
  status: string;
  quantity: number;
}

/**
 * What is holding payment back on this bill, if anything. A stale bill leads:
 * its counts may be wrong, and a retry is the one thing on screen that clears
 * it. Then lines that never reached the kitchen, then lines still cooking,
 * each counted in dishes (quantity), the way the header counts them. An empty
 * bill is not a block here - the list already says it has nothing to charge.
 */
export function paymentBlock(items: readonly BlockingItem[], billStale: boolean): PaymentBlock | null {
  if (billStale) return { kind: 'stale' };
  let unsent = 0;
  let cooking = 0;
  for (const item of items) {
    if (item.status === 'pending') unsent += item.quantity;
    else if (item.status === 'cooking') cooking += item.quantity;
  }
  if (unsent > 0) return { kind: 'unsent', quantity: unsent };
  if (cooking > 0) return { kind: 'kitchen', quantity: cooking };
  return null;
}

/** The block as one short line: "ครัวยังทำไม่เสร็จ 2 รายการ". */
export function paymentBlockText(block: PaymentBlock, language: DisplayLanguage): string {
  const th = language === 'th';
  if (block.kind === 'stale') return th ? 'ยอดยังไม่อัปเดต' : 'Total not up to date';
  const count = block.quantity.toLocaleString(th ? 'th-TH' : 'en-US');
  const items = block.quantity === 1 ? 'item' : 'items';
  if (block.kind === 'unsent') {
    return th ? `ยังไม่ส่งเข้าครัว ${count} รายการ` : `${count} ${items} not sent to the kitchen`;
  }
  return th ? `ครัวยังทำไม่เสร็จ ${count} รายการ` : `${count} ${items} still in the kitchen`;
}
