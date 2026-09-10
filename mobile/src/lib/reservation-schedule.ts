/**
 * Turning "วันนี้ 19:00" into something the API accepts.
 *
 * There is no date-time picker in this app on purpose: every React Native one
 * is a native module, which means a rebuild and locks anyone on Expo Go out of
 * testing it. A day chip plus a list of times covers what a restaurant actually
 * books — today or tomorrow, on the quarter hour — without that cost.
 */

export type ReservationDay = 'now' | 'today' | 'tomorrow';

/** 15 minutes. Finer than this is false precision for a dinner booking. */
const SLOT_MINUTES = 15;

export function reservationTimeSlots(
  day: ReservationDay,
  now: Date,
  openHour = 9,
  closeHour = 23,
): string[] {
  const slots: string[] = [];
  for (let hour = openHour; hour <= closeHour; hour += 1) {
    for (let minute = 0; minute < 60; minute += SLOT_MINUTES) {
      if (hour === closeHour && minute > 0) break;
      slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    }
  }
  if (day !== 'today') return slots;
  // A slot that has already passed cannot be booked, and offering it is how you
  // get a booking silently filed in the past.
  const cutoff = now.getHours() * 60 + now.getMinutes();
  return slots.filter((slot) => slotMinutes(slot) > cutoff);
}

export function slotMinutes(slot: string): number {
  const [hour, minute] = slot.split(':');
  return Number(hour) * 60 + Number(minute);
}

/**
 * The absolute instant a chosen day and slot refer to, or null when the booking
 * is a hold-the-table-now one and carries no time at all.
 */
export function reservationInstant(
  day: ReservationDay,
  slot: string,
  now: Date,
): Date | null {
  if (day === 'now') return null;
  const target = new Date(now);
  if (day === 'tomorrow') target.setDate(target.getDate() + 1);
  const [hour, minute] = slot.split(':');
  target.setHours(Number(hour), Number(minute), 0, 0);
  return target;
}

/**
 * The reminder that goes on a table card: "จอง 16:00" for a booking later today,
 * and the day as well once it is not today, so a booking for tomorrow morning
 * read late tonight cannot be mistaken for one due in minutes.
 */
export function reservationReminder(
  reservedFor: string | null | undefined,
  now: Date,
  language: 'th' | 'en' = 'th',
): string | null {
  if (!reservedFor) return null;
  const when = new Date(reservedFor);
  if (Number.isNaN(when.getTime())) return null;
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  const label = language === 'th' ? 'จอง' : 'Booked';
  if (when.toDateString() === now.toDateString()) return `${label} ${time}`;
  const day = when.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${label} ${day} ${time}`;
}

/**
 * A booking's time on a detail screen: the clock alone when it is today, with
 * the date in front of it when it is not.
 */
export function formatReservationClock(
  value: string | null | undefined,
  language: 'th' | 'en' = 'th',
  now: Date = new Date(),
): string {
  if (!value) return '−';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return '−';
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const time = when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (when.toDateString() === now.toDateString()) return time;
  return `${when.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * The clock alone, for the compact table tile's booking chip.
 *
 * Never the date, unlike `formatReservationClock`. The tile is about 112pt wide,
 * and a `3 ก.ย. 19:00` chip pushes the Thai status word into an ellipsis —
 * `กำลังใช้งาน` becomes `กำลังใช้...`, which is the one thing on the tile that
 * has to stay readable. Dropping the date costs almost nothing here because the
 * backend only surfaces bookings inside a −1h..+12h window, so it is today's in
 * everything but the post-midnight case, and the detail screen carries the full
 * date anyway.
 */
export function reservationClock(
  value: string | null | undefined,
  language: 'th' | 'en' = 'th',
): string | null {
  if (!value) return null;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** The slot to preselect: the next one still bookable today. */
export function defaultReservationSlot(day: ReservationDay, now: Date): string {
  const slots = reservationTimeSlots(day, now);
  return slots[0] || '19:00';
}
