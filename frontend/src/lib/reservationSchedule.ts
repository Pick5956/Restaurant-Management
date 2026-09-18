/**
 * Turning a booking's day and clock into the instant the reservation API takes.
 *
 * The web POS books any day up to a year ahead at any minute: a large restaurant
 * takes bookings weeks out, for the time the guest actually asks for. The app
 * still offers quarter-hour slots for today and tomorrow. Both send a single
 * RFC 3339 instant, which the backend truncates to the minute, so the two never
 * have to agree on a slot list.
 */

export type ReservationChoice = "now" | "today" | "tomorrow" | "date";

export interface ReservationWhen {
  choice: ReservationChoice;
  /** The local calendar day, YYYY-MM-DD. Ignored for a hold. */
  date: string;
  /** 24-hour HH:MM. Ignored for a hold. */
  time: string;
}

export type ReservationWhenProblem = "invalid" | "passed" | "too_far";

/** How far ahead the calendar reaches. */
export const RESERVATION_MAX_DAYS_AHEAD = 365;

const QUARTER_MINUTES = 15;
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

const pad = (value: number) => String(value).padStart(2, "0");

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a YYYY-MM-DD key, or null when the key is not a real day. */
export function dateFromKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Date rolls 2026-02-30 into March. A key that does not survive the round
  // trip was never a day, and booking it would file the guest on another one.
  return localDateKey(date) === key ? date : null;
}

export function addDaysToKey(key: string, days: number): string {
  const date = dateFromKey(key);
  if (!date) return key;
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

function clockOf(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** No hour starts with 3 or more and has a second digit, so "930" is 9:30, not hour 93. */
function hourDigitCount(digits: string): number {
  return digits !== "" && digits[0] >= "3" ? 1 : 2;
}

/** What the time field shows while a time is typed: the digits, with the colon put in. */
export function reservationTimeDraft(input: string): string {
  const digits = input.replace(/\D/g, "");
  const hourLength = hourDigitCount(digits);
  const capped = digits.slice(0, hourLength + 2);
  if (capped.length <= hourLength) return capped;
  return `${capped.slice(0, hourLength)}:${capped.slice(hourLength)}`;
}

/** Whether every digit of the time has been typed. */
export function isCompleteReservationTime(draft: string): boolean {
  const digits = draft.replace(/\D/g, "");
  return digits !== "" && digits.length === hourDigitCount(digits) + 2;
}

/**
 * A typed time as HH:MM, or null when it is not a time of day. A lone minute
 * digit is the tens - "20:3" is 20:30 - because it is the one typed first.
 */
export function parseReservationTime(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;
  const hourLength = hourDigitCount(digits);
  const capped = digits.slice(0, hourLength + 2);
  const hour = Number(capped.slice(0, hourLength));
  const minuteDigits = capped.slice(hourLength);
  const minute = minuteDigits.length === 1 ? Number(minuteDigits) * 10 : Number(minuteDigits || "0");
  if (hour > 23 || minute > 59) return null;
  return clockOf(hour * 60 + minute);
}

/**
 * The quarter hour before or after. An odd minute snaps to its neighbour rather
 * than moving a flat fifteen, so 20:21 goes to 20:30, not 20:36. Typing is for
 * odd minutes; the buttons are for getting to a round time fast.
 */
export function stepReservationTime(time: string, direction: 1 | -1): string {
  const minutes = minutesOf(time);
  if (minutes === null) return time;
  const next = direction === 1
    ? Math.floor(minutes / QUARTER_MINUTES) * QUARTER_MINUTES + QUARTER_MINUTES
    : Math.ceil(minutes / QUARTER_MINUTES) * QUARTER_MINUTES - QUARTER_MINUTES;
  return next < 0 || next > LAST_MINUTE_OF_DAY ? time : clockOf(next);
}

/** One minute either way, for the arrow keys. */
export function nudgeReservationTime(time: string, deltaMinutes: number): string {
  const minutes = minutesOf(time);
  if (minutes === null) return time;
  return clockOf(Math.min(LAST_MINUTE_OF_DAY, Math.max(0, minutes + deltaMinutes)));
}

/** Where a new booking starts: the next quarter hour, which is tomorrow once that is past midnight. */
export function initialReservationWhen(now: Date): ReservationWhen {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const next = Math.floor(minutes / QUARTER_MINUTES) * QUARTER_MINUTES + QUARTER_MINUTES;
  const today = localDateKey(now);
  if (next > LAST_MINUTE_OF_DAY) return { choice: "tomorrow", date: addDaysToKey(today, 1), time: "00:00" };
  return { choice: "today", date: today, time: clockOf(next) };
}

/**
 * Today and tomorrow are pinned to real dates the moment they are chosen, so a
 * sheet left open across midnight still means the day the staffer picked - and
 * is refused as passed, rather than quietly moving the booking a day later.
 */
export function chooseReservationDay(when: ReservationWhen, choice: ReservationChoice, now: Date): ReservationWhen {
  const today = localDateKey(now);
  if (choice === "today") return { ...when, choice, date: today };
  if (choice === "tomorrow") return { ...when, choice, date: addDaysToKey(today, 1) };
  if (choice === "date") return { ...when, choice, date: reservationDayBookable(when.date, now) ? when.date : today };
  return { ...when, choice };
}

export function reservationDayBookable(key: string, now: Date, maxDaysAhead = RESERVATION_MAX_DAYS_AHEAD): boolean {
  const day = dateFromKey(key);
  const today = localDateKey(now);
  const first = dateFromKey(today);
  const last = dateFromKey(addDaysToKey(today, maxDaysAhead));
  return Boolean(day && first && last && day >= first && day <= last);
}

/** The absolute instant a booking refers to, or null for a hold - or for a day or time that does not exist. */
export function reservationInstantFor(when: ReservationWhen): Date | null {
  if (when.choice === "now") return null;
  const day = dateFromKey(when.date);
  const minutes = minutesOf(when.time);
  if (!day || minutes === null) return null;
  day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return day;
}

/** Why a booking cannot be filed as it stands, or null when it can. */
export function reservationWhenProblem(when: ReservationWhen, now: Date): ReservationWhenProblem | null {
  if (when.choice === "now") return null;
  const instant = reservationInstantFor(when);
  if (!instant) return "invalid";
  // The current minute counts as gone: a booking for it has already started.
  if (instant.getTime() <= now.getTime()) return "passed";
  if (!reservationDayBookable(when.date, now)) return "too_far";
  return null;
}

/** A month as whole weeks from Sunday: day keys, with null for the padding either side. */
export function calendarMonthCells(year: number, month: number): (string | null)[] {
  const cells: (string | null)[] = Array.from({ length: new Date(year, month, 1).getDay() }, () => null);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(localDateKey(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when;
}

const localeOf = (language: "th" | "en") => (language === "th" ? "th-TH" : "en-US");

function clock(when: Date, language: "th" | "en") {
  return when.toLocaleTimeString(localeOf(language), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** The day, with the year once it is not this year's: a booking taken a year out must not read as next month's. */
function day(when: Date, now: Date, language: "th" | "en") {
  return when.toLocaleDateString(localeOf(language), {
    day: "numeric",
    month: "short",
    ...(when.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * "จอง 16:00" for a booking later today, with the day as well once it is not
 * today, so a booking for tomorrow morning read late tonight cannot be mistaken
 * for one due in minutes.
 */
export function reservationReminder(
  reservedFor: string | null | undefined,
  now: Date,
  language: "th" | "en" = "th",
): string | null {
  const when = parseInstant(reservedFor);
  if (!when) return null;
  const label = language === "th" ? "จอง" : "Booked";
  if (when.toDateString() === now.toDateString()) return `${label} ${clock(when, language)}`;
  return `${label} ${day(when, now, language)} ${clock(when, language)}`;
}

/**
 * The clock alone, for the table card. The backend only surfaces bookings from
 * an hour back to twelve hours ahead, so outside the small hours this is
 * today's, and the card has no room for a date without truncating the status.
 */
export function reservationClock(value: string | null | undefined, language: "th" | "en" = "th"): string | null {
  const when = parseInstant(value);
  return when ? clock(when, language) : null;
}

/** A booking's time on a detail line: the clock, with the date only when it is not today. */
export function formatReservationClock(
  value: string | null | undefined,
  language: "th" | "en" = "th",
  now: Date = new Date(),
): string {
  const when = parseInstant(value);
  if (!when) return "-";
  if (when.toDateString() === now.toDateString()) return clock(when, language);
  return `${day(when, now, language)} ${clock(when, language)}`;
}
