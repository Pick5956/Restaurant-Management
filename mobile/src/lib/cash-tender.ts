// The arithmetic of taking cash at the table: which notes a customer is likely
// to hand over, what goes back as change, and what the cashier typed on the
// keypad. Everything is done in whole satang, because a bill carries satang as
// soon as service charge or VAT is on, and float subtraction does not:
// 1500 - 1424.3 is 75.70000000000005 in floating point, and a cashier handed
// that figure has to round it in their head.

import type { DisplayLanguage } from '@/src/lib/display-preferences';

export type PaymentMethod = 'cash' | 'promptpay_qr';

/** The longest amount the keypad takes: ฿9,999,999 is more than any one bill. */
export const KEYPAD_MAX_DIGITS = 7;

/** How many round-up amounts sit beside "พอดี". More than this is a wall of chips. */
export const QUICK_TENDER_LIMIT = 3;

/** Thai notes a customer pays with, smallest first. */
const TENDER_STEPS = [100, 500, 1000] as const;

/** A small bill is paid with a 20 or a 50 as often as with a 100. */
const SMALL_BILL_STEPS = [20, 50] as const;
const SMALL_BILL_UNDER = 100;

const SATANG_PER_BAHT = 100;

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | 'back' | 'clear';

export interface Tender {
  /** What was handed over, in baht; null until the cashier says. */
  received: number | null;
  /** What goes back to the customer. Zero while short or unknown. */
  change: number;
  /** How much is still missing. Zero once enough has been handed over. */
  short: number;
  /** Whether the amount handed over covers the bill. */
  enough: boolean;
}

export interface PaidPayment {
  method: PaymentMethod;
  amount: number;
  received_amount: number;
  change_amount: number;
}

export function toSatang(value: number): number {
  return Math.round(value * SATANG_PER_BAHT);
}

function fromSatang(value: number): number {
  return value / SATANG_PER_BAHT;
}

function isPositiveAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The amounts a customer is likely to hand over for this bill: the total
 * rounded up to the next 100, 500 and 1,000 (and 20 and 50 on a small bill).
 * Only amounts above the total - the exact amount is its own chip - with
 * duplicates folded, smallest first, at most QUICK_TENDER_LIMIT.
 */
export function quickTenderAmounts(total: number): number[] {
  if (!isPositiveAmount(total)) return [];
  const due = toSatang(total);
  const steps: readonly number[] = total < SMALL_BILL_UNDER
    ? [...SMALL_BILL_STEPS, ...TENDER_STEPS]
    : TENDER_STEPS;
  const amounts = new Set<number>();
  for (const step of steps) {
    const stepSatang = step * SATANG_PER_BAHT;
    const rounded = Math.ceil(due / stepSatang) * stepSatang;
    if (rounded > due) amounts.add(fromSatang(rounded));
  }
  return [...amounts].sort((left, right) => left - right).slice(0, QUICK_TENDER_LIMIT);
}

/** Change and shortfall for what was handed over, exact to the satang. */
export function tenderChange(total: number, received: number | null): Tender {
  if (received === null || !Number.isFinite(received) || received < 0) {
    return { received: null, change: 0, short: 0, enough: false };
  }
  const due = Math.max(0, toSatang(total));
  const given = toSatang(received);
  return {
    received: fromSatang(given),
    change: given >= due ? fromSatang(given - due) : 0,
    short: given < due ? fromSatang(due - given) : 0,
    enough: given >= due,
  };
}

/**
 * One key on the cash keypad. Whole baht only: nobody counts satang coins
 * into a keypad. No leading zeros, and nothing past KEYPAD_MAX_DIGITS.
 */
export function keypadNext(digits: string, key: KeypadKey): string {
  if (key === 'clear') return '';
  if (key === 'back') return digits.slice(0, -1);
  if (digits === '' && (key === '0' || key === '00')) return '';
  if (digits.length >= KEYPAD_MAX_DIGITS) return digits;
  return `${digits}${key}`.slice(0, KEYPAD_MAX_DIGITS);
}

/** The keypad's digits as baht, or null when nothing has been typed. */
export function keypadAmount(digits: string): number | null {
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/**
 * Money the way a cashier counts it: "฿1,424" for whole baht, "฿287.50" once
 * there are satang. money() in format.ts always rounds to whole baht, which
 * turned a ฿12.50 change into ฿13.
 */
export function formatTender(value: number | null | undefined, language: DisplayLanguage): string {
  const satang = toSatang(Number(value) || 0);
  const fraction = satang % SATANG_PER_BAHT === 0 ? 0 : 2;
  return `฿${fromSatang(satang).toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  })}`;
}

/**
 * The received amount the payment call carries. Cash sends what was handed
 * over, so the server records the change it already knows how to compute;
 * anything short of the total, and every PromptPay transfer, sends the total.
 */
export function cashReceivedToSend(method: PaymentMethod, total: number, received: number | null): number {
  if (method !== 'cash' || received === null || !Number.isFinite(received)) return total;
  return toSatang(received) >= toSatang(total) ? received : total;
}

/**
 * What to tell the cashier when the server recorded a different total from the
 * one on screen. It prices the order once more under the payment's own lock,
 * so a promotion that started or ended since the bill loaded moves the total -
 * and a cash payment still goes through whenever the notes handed over cover
 * the new figure, with a change the sheet never showed. Null when the amount
 * recorded is the amount that was shown.
 */
export function repricedPaymentLine(
  shownTotal: number,
  payment: PaidPayment | null | undefined,
  language: DisplayLanguage,
): string | null {
  if (!payment || !Number.isFinite(payment.amount)) return null;
  if (toSatang(payment.amount) === toSatang(shownTotal)) return null;
  const copy = (thai: string, english: string) => (language === 'th' ? thai : english);
  const parts = [`${copy('ยอดเปลี่ยนเป็น', 'Total changed to')} ${formatTender(payment.amount, language)}`];
  if (payment.method === 'cash') {
    parts.push(`${copy('ทอน', 'Change')} ${formatTender(payment.change_amount, language)}`);
  }
  return parts.join(', ');
}

/**
 * How a paid bill was paid, on one line: "เงินสด ฿1,424, รับมา ฿1,500,
 * ทอน ฿76". The received and change parts appear only when change was given.
 */
export function paidPaymentLine(payment: PaidPayment | null | undefined, language: DisplayLanguage): string | null {
  if (!payment) return null;
  const copy = (thai: string, english: string) => (language === 'th' ? thai : english);
  const method = payment.method === 'cash' ? copy('เงินสด', 'Cash') : 'PromptPay QR';
  const parts = [`${method} ${formatTender(payment.amount, language)}`];
  if (payment.method === 'cash' && toSatang(payment.change_amount) > 0) {
    parts.push(`${copy('รับมา', 'Received')} ${formatTender(payment.received_amount, language)}`);
    parts.push(`${copy('ทอน', 'Change')} ${formatTender(payment.change_amount, language)}`);
  }
  return parts.join(', ');
}
