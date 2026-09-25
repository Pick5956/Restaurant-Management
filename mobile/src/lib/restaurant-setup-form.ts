// What the create-restaurant form checks before it sends, and what it says when
// the send fails. The limits mirror the backend's sanitizeRestaurantFields
// (backend/internal/service/restaurant_service_helpers.go): a phone needs 9
// digits, times are HH:mm on a 24-hour clock, and a new shop gets 1-500 tables,
// 12 when none is given. Checking here puts the problem under its own field in
// Thai; left to the server it came back as a line of English on top of the form.

export type SetupLanguage = 'th' | 'en';

export const CLOCK_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TABLE_COUNT_RANGE = { min: 1, max: 500 } as const;
/** What the server creates when the count is left at 0 or blank. */
export const DEFAULT_TABLE_COUNT = 12;
export const PHONE_MIN_DIGITS = 9;

export function isClock(text: string): boolean {
  return CLOCK_PATTERN.test(text);
}

function clockFrom(hours: string, minutes: string): string | null {
  const h = Number(hours);
  const m = Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Reads a time the way people type it on a number pad: "9:00", "9.30", "930",
 * "0930", "22". A valid one comes back as HH:mm; anything else comes back
 * trimmed and unchanged, so the field keeps what was typed and can say it is
 * wrong.
 */
export function normalizeClockInput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const separated = trimmed.match(/^(\d{1,2})[:.](\d{2})$/);
  const packed = trimmed.match(/^(\d{1,2})(\d{2})$/);
  const hourOnly = trimmed.match(/^(\d{1,2})$/);
  const clock = separated
    ? clockFrom(separated[1], separated[2])
    : packed
      ? clockFrom(packed[1], packed[2])
      : hourOnly
        ? clockFrom(hourOnly[1], '00')
        : null;
  return clock ?? trimmed;
}

export function phoneDigits(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

export type SetupField = 'name' | 'phone' | 'open' | 'close' | 'tables';
export type SetupProblem = 'required' | 'invalid' | 'range' | 'short';
export type SetupProblems = Partial<Record<SetupField, SetupProblem>>;

/** The fields in the order the form shows them: the first one wrong takes focus. */
export const SETUP_FIELD_ORDER: readonly SetupField[] = ['name', 'phone', 'open', 'close', 'tables'];

/**
 * What is wrong with the form, field by field. A blank time or table count is
 * not a problem: the form sends its default for those, as it always has.
 */
export function setupFieldProblems(fields: {
  name: string;
  open: string;
  close: string;
  tables: string;
  phone: string;
}): SetupProblems {
  const problems: SetupProblems = {};
  if (!fields.name.trim()) problems.name = 'required';
  const phone = fields.phone.trim();
  if (phone && phoneDigits(phone) < PHONE_MIN_DIGITS) problems.phone = 'short';
  for (const key of ['open', 'close'] as const) {
    const value = fields[key].trim();
    if (value && !isClock(normalizeClockInput(value))) problems[key] = 'invalid';
  }
  const tables = fields.tables.trim();
  if (tables) {
    const count = /^\d+$/.test(tables) ? Number(tables) : Number.NaN;
    if (!(count >= TABLE_COUNT_RANGE.min && count <= TABLE_COUNT_RANGE.max)) problems.tables = 'range';
  }
  return problems;
}

export function firstSetupProblem(problems: SetupProblems): SetupField | null {
  return SETUP_FIELD_ORDER.find((field) => problems[field]) ?? null;
}

const FIELD_MESSAGES: Record<SetupField, { th: string; en: string }> = {
  name: { th: 'กรอกชื่อร้านก่อน', en: 'Enter a restaurant name' },
  phone: { th: `เบอร์โทรไม่ครบ ${PHONE_MIN_DIGITS} หลัก`, en: `Needs at least ${PHONE_MIN_DIGITS} digits` },
  open: { th: 'เวลาไม่ถูกต้อง', en: 'Not a valid time' },
  close: { th: 'เวลาไม่ถูกต้อง', en: 'Not a valid time' },
  tables: {
    th: `ใส่ได้ ${TABLE_COUNT_RANGE.min}–${TABLE_COUNT_RANGE.max} โต๊ะ`,
    en: `${TABLE_COUNT_RANGE.min}–${TABLE_COUNT_RANGE.max} tables`,
  },
};

/** The line under a field that is wrong. */
export function setupFieldMessage(field: SetupField, language: SetupLanguage): string {
  return FIELD_MESSAGES[field][language];
}

export type SetupFailureCode = 'offline' | 'server_busy' | 'phone' | 'hours' | 'tables' | 'name' | 'unknown';

/** Maps whatever the API said onto the few failures a person can act on. */
export function restaurantSetupFailureCode(raw: string | null | undefined): SetupFailureCode {
  const message = String(raw || '').trim().toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error')) {
    return 'offline';
  }
  if (message.includes('temporarily unavailable') || message.includes('internal server error') || message.includes('timeout')) {
    return 'server_busy';
  }
  if (message.includes('phone')) return 'phone';
  if (message.includes('open_time') || message.includes('close_time') || message.includes('hh:mm')) return 'hours';
  if (message.includes('table_count')) return 'tables';
  if (message.includes('restaurant name is required')) return 'name';
  return 'unknown';
}

/**
 * The field problem a failure stands for, when the server named a field. The
 * hours failure names no single field, so it stays in the toast alone.
 */
export function setupProblemsForFailure(code: SetupFailureCode): SetupProblems {
  if (code === 'phone') return { phone: 'short' };
  if (code === 'tables') return { tables: 'range' };
  if (code === 'name') return { name: 'required' };
  return {};
}

const FAILURE_MESSAGES: Record<SetupFailureCode, { th: string; en: string } | null> = {
  offline: { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' },
  server_busy: { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' },
  phone: { th: `เบอร์โทรไม่ครบ ${PHONE_MIN_DIGITS} หลัก`, en: `The phone number needs at least ${PHONE_MIN_DIGITS} digits.` },
  hours: { th: 'เวลาเปิดหรือปิดไม่ถูกต้อง', en: 'The opening or closing time is not valid.' },
  tables: {
    th: `จำนวนโต๊ะต้องอยู่ระหว่าง ${TABLE_COUNT_RANGE.min}–${TABLE_COUNT_RANGE.max}`,
    en: `The table count must be between ${TABLE_COUNT_RANGE.min} and ${TABLE_COUNT_RANGE.max}.`,
  },
  name: { th: 'กรอกชื่อร้านก่อน', en: 'Enter a restaurant name.' },
  // The title already says which step failed; a second vague line adds nothing.
  unknown: null,
};

const FAILURE_TITLES = {
  // The POST itself failed: nothing was created.
  create: { th: 'สร้างร้านไม่สำเร็จ', en: 'Could not create the restaurant' },
  // The shop exists but could not be opened on this phone. The title says it
  // was made: "เปิดร้าน" alone reads as opening for service, and an owner who
  // thought nothing was created would go back and make a second shop.
  open: { th: 'สร้างร้านแล้ว แต่เข้าร้านไม่สำเร็จ', en: 'Restaurant created, but it could not be opened' },
} as const;

/**
 * The toast for a failed create: a title naming the step, and a message only
 * when there is something to say beyond it. The server's own wording is only
 * classified, never shown.
 */
export function restaurantSetupFailureToast(
  raw: string | null | undefined,
  language: SetupLanguage,
  step: keyof typeof FAILURE_TITLES = 'create',
): { title: string; message?: string } {
  const title = FAILURE_TITLES[step][language];
  const message = FAILURE_MESSAGES[restaurantSetupFailureCode(raw)];
  return message ? { title, message: message[language] } : { title };
}

/** The phone and address on one line, for the collapsed row. Null when both are blank. */
export function contactSummary(phone: string, address: string): string | null {
  const parts = [phone, address]
    .map((part) => part.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}
