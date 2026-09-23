// The number of people a table is opened or booked for, as the open-table
// screen keeps it: a string in the field, because the waiter may clear it
// mid-edit, and a clamped whole number everywhere it is read or sent.

export const GUEST_COUNT_MIN = 1;
/** Four digits: the field's maxLength, and more than any room holds. */
export const GUEST_COUNT_MAX = 9999;
/** The party sizes a waiter taps most. Anything bigger is stepped or typed. */
export const QUICK_GUEST_COUNTS = [1, 2, 3, 4, 5, 6] as const;
/** A table's seats seed the count, up to this; a 12-seat table is rarely 12 people. */
const SEED_CEILING = 6;

/** What the count field keeps of what was typed or pasted. */
export function digitsOnly(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

/** Keeps a count inside the range the field and the API accept. */
export function clampGuestCount(count: number): number {
  if (!Number.isFinite(count)) return GUEST_COUNT_MIN;
  return Math.max(GUEST_COUNT_MIN, Math.min(GUEST_COUNT_MAX, Math.trunc(count)));
}

/** The count a field's text stands for. Empty or unreadable text is one guest. */
export function parseGuestCount(text: string | null | undefined): number {
  return clampGuestCount(Number.parseInt(text || '1', 10) || GUEST_COUNT_MIN);
}

/** The count a table's seats suggest before anyone has touched the field. */
export function seedGuestCount(capacity: number | null | undefined): number {
  return Math.max(GUEST_COUNT_MIN, Math.min(capacity || GUEST_COUNT_MIN, SEED_CEILING));
}
