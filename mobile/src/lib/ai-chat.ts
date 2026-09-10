import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { AIGuidedAction } from '@/src/lib/ai-actions';
import type {
  AIChartData,
  AIConversationTurn,
  AINavigation,
  AIReceiptDraft,
} from '@/src/types/ai';

// Pure pieces of the chat screen, ported from the web's aiStream / aiThreads /
// aiGuidedActions / aiPrefs so both surfaces behave the same. Nothing here
// touches React or the network.

// ---------------------------------------------------------------- streaming

export type SSEEvent = { event: string; data: string };

/**
 * Splits what has arrived so far into complete events and the unfinished
 * tail. Understands the wire format gin writes ("event:name\ndata:payload")
 * with or without a space after the colon, multi-line data, and comments.
 */
export function parseSSE(buffer: string): { events: SSEEvent[]; rest: string } {
  const events: SSEEvent[] = [];
  let rest = buffer.replace(/\r\n/g, '\n');
  let at: number;
  while ((at = rest.indexOf('\n\n')) >= 0) {
    const block = rest.slice(0, at);
    rest = rest.slice(at + 2);
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

// ---------------------------------------------------------------- messages

/** Display data a stored turn carries, as the server wrote it. */
export type AITurnDisplay = {
  chart?: AIChartData;
  tools_used?: string[];
  scope_assumed?: boolean;
  action_plan_id?: string;
  model?: string;
  follow_ups?: string[];
  navigate?: AINavigation;
};

/** One bubble on screen. Answers carry whatever they need drawn under them. */
export type AIChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  chart?: AIChartData;
  toolsUsed?: string[];
  scopeAssumed?: boolean;
  planId?: string;
  previewId?: string;
  actions?: AIGuidedAction[];
  /** A one-line outcome under a command bubble ("บันทึกลงระบบแล้ว"). */
  outcome?: { tone: 'good' | 'muted' | 'bad'; text: string };
};

/**
 * Turns from the server become the bubbles the screen renders: a question and
 * an answer per turn, the answer carrying the display data stored with it.
 */
export function turnsToMessages(turns: AIConversationTurn[]): AIChatMessage[] {
  const messages: AIChatMessage[] = [];
  for (const turn of turns) {
    const at = turn.created_at ? new Date(turn.created_at) : new Date();
    const display = (turn.display ?? {}) as AITurnDisplay;
    messages.push({ id: `${turn.id}-q`, role: 'user', content: turn.question, createdAt: at });
    const tools = display.tools_used && display.tools_used.length > 0
      ? display.tools_used
      : turn.tool ? [turn.tool] : undefined;
    messages.push({
      id: turn.id,
      role: 'assistant',
      content: turn.answer,
      createdAt: at,
      chart: display.chart,
      toolsUsed: tools,
      scopeAssumed: display.scope_assumed,
      planId: display.action_plan_id,
      actions: answerChips(display.follow_ups, display.navigate, 'th'),
    });
  }
  return messages;
}

export const MAX_ANSWER_CHIPS = 5;

/**
 * The chips under an answer. "Take me there" goes first when the answer
 * explained a page; then the model's own follow-ups, sent verbatim on tap.
 * Nothing is invented on the phone: no follow-ups from the model means no chips.
 */
export function answerChips(
  followUps: string[] | undefined,
  navigate: AINavigation | null | undefined,
  language: DisplayLanguage,
): AIGuidedAction[] | undefined {
  const go: AIGuidedAction[] = navigate?.href
    ? [{ id: 'nav-answer', href: navigate.href, label: language === 'th' ? `พาไปหน้า${navigate.label}` : `Go to ${navigate.label}` }]
    : [];
  const written = (followUps ?? []).map((text) => text.trim()).filter(Boolean);
  const chips = written.map((text, index) => ({ id: `fu-model-${index}`, label: text, prompt: text }));
  const all = [...go, ...chips].slice(0, MAX_ANSWER_CHIPS);
  return all.length > 0 ? all : undefined;
}

/** Group chats for the list the way a chat app does. */
export type AIThreadGroup = 'today' | 'yesterday' | 'week' | 'older';

export function threadGroup(updatedAt: string | Date, now: Date = new Date()): AIThreadGroup {
  const at = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const t = at.getTime();
  if (t >= startOfToday) return 'today';
  if (t >= startOfToday - day) return 'yesterday';
  if (t >= startOfToday - 6 * day) return 'week';
  return 'older';
}

export function threadGroupLabel(group: AIThreadGroup, language: DisplayLanguage): string {
  const th = { today: 'วันนี้', yesterday: 'เมื่อวาน', week: '7 วันก่อน', older: 'เก่ากว่านั้น' };
  const en = { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', older: 'Older' };
  return (language === 'th' ? th : en)[group];
}

/** Client-side title filter: the list shrinks as the owner types. */
export function matchesThreadQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q);
}

/** The time a chat row shows: clock for today/yesterday, a short date otherwise. */
export function threadStamp(updatedAt: string | Date, language: DisplayLanguage, now: Date = new Date()): string {
  const at = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return '';
  const group = threadGroup(at, now);
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  if (group === 'today' || group === 'yesterday') {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at);
  }
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at);
}

/** True when the server said the conversation the screen holds no longer exists. */
export function isConversationGone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const details = (error as { details?: unknown }).details;
  if (typeof details === 'string') {
    try {
      return (JSON.parse(details) as { code?: string }).code === 'conversation_gone';
    } catch {
      return false;
    }
  }
  return (error as { code?: string }).code === 'conversation_gone';
}

export type AIOutage = { kind: 'quota' | 'provider'; message: string; retryAfterSeconds?: number };

/** The assistant reports an outage rather than answering; read it off the error. */
export function readAIOutage(error: unknown): AIOutage | null {
  if (typeof error !== 'object' || error === null) return null;
  let body: { error?: string; code?: string; retry_after_seconds?: number } | null = null;
  const details = (error as { details?: unknown }).details;
  if (typeof details === 'string') {
    try {
      body = JSON.parse(details);
    } catch {
      body = null;
    }
  } else if ('code' in error) {
    body = error as { error?: string; code?: string; retry_after_seconds?: number };
  }
  const code = body?.code;
  if (code !== 'ai_quota_exceeded' && code !== 'ai_provider_unavailable') return null;
  const seconds = body?.retry_after_seconds;
  return {
    kind: code === 'ai_quota_exceeded' ? 'quota' : 'provider',
    message: body?.error?.trim() || '',
    retryAfterSeconds: typeof seconds === 'number' && seconds > 0 ? seconds : undefined,
  };
}

// ---------------------------------------------------------------- greeting

export const DEFAULT_OWNER_TITLE_TH = 'คุณผู้จัดการ';
export const DEFAULT_OWNER_TITLE_EN = 'Manager';

/** The greeting at the top of an empty thread. */
/**
 * The openers, by the part of the day the owner is in.
 *
 * Hours are the shop's, not a calendar's: a restaurant owner opening this at
 * 23:00 is still working, and greeting them with "good evening" reads as though
 * nobody is paying attention. The late band runs to 05:00 for the same reason.
 *
 * Every line has to work with the name pushed straight onto the end of it, and
 * has to be as true at the start of a shift as at the end of one — the greeting
 * knows the clock and nothing else, so anything that guesses at how the day is
 * going ("busy one today?") will be wrong about half the time.
 */
const GREETINGS: { from: number; th: string[]; en: string[] }[] = [
  {
    from: 5,
    th: ['อรุณสวัสดิ์', 'สวัสดีตอนเช้า', 'เช้านี้เป็นไงบ้าง'],
    en: ['Good morning, ', 'Morning, ', 'Hello, '],
  },
  {
    from: 11,
    th: ['สวัสดีตอนกลางวัน', 'สวัสดี', 'ช่วงนี้เป็นไงบ้าง'],
    en: ['Good afternoon, ', 'Hello, ', 'Hi, '],
  },
  {
    from: 14,
    th: ['สวัสดีตอนบ่าย', 'บ่ายนี้เป็นไงบ้าง', 'สวัสดี'],
    en: ['Good afternoon, ', 'Hello, ', 'Hi, '],
  },
  {
    from: 18,
    th: ['สวัสดีตอนเย็น', 'เย็นนี้เป็นไงบ้าง', 'สวัสดี'],
    en: ['Good evening, ', 'Evening, ', 'Hello, '],
  },
  {
    from: 22,
    th: ['ดึกแล้วนะ', 'ยังไม่พักเลย', 'สวัสดีตอนดึก'],
    en: ['Still up, ', 'Working late, ', 'Good evening, '],
  },
];

/**
 * The greeting on the empty chat: which part of the day it is, and what to call
 * the owner. Nothing else — it is drawn before any shop data has loaded, so a
 * line that sounds like it knows how trade is going would be a guess.
 *
 * `at` and `roll` are arguments rather than read inside, so the choice is a pure
 * function of them: the screen holds one roll for as long as it is open (a
 * greeting that reworded itself on every re-render would be unsettling), and the
 * tests can ask for a specific hour and a specific line.
 */
export function welcomeFor(language: DisplayLanguage, title: string, at: Date = new Date(), roll: number = Math.random()): string {
  const name = title.trim() || (language === 'th' ? DEFAULT_OWNER_TITLE_TH : DEFAULT_OWNER_TITLE_EN);
  const hour = at.getHours();
  // Last band whose start hour has passed; before 05:00 that is the late one,
  // which began the previous evening.
  const band = [...GREETINGS].reverse().find((entry) => hour >= entry.from) ?? GREETINGS[GREETINGS.length - 1];
  const lines = language === 'th' ? band.th : band.en;
  const index = Math.min(lines.length - 1, Math.max(0, Math.floor(roll * lines.length)));
  return `${lines[index]}${name}`;
}

// ---------------------------------------------------------------- confirm card

/** "M:SS" for the countdown ring; never negative. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Split "12 → 17" style change strings the plan carries into a from/to pair. */
export function splitChange(change: string): { from: string; to: string } | null {
  const parts = change.split(/\s*(?:→|->)\s*/);
  if (parts.length !== 2) return null;
  const from = parts[0].trim();
  const to = parts[1].trim();
  if (!from || !to) return null;
  return { from, to };
}

// ---------------------------------------------------------------- receipt scan

const receiptCategoryTh: Record<string, string> = {
  ingredient: 'ค่าวัตถุดิบ',
  labor: 'ค่าแรง',
  rent: 'ค่าเช่า',
  utilities: 'ค่าน้ำค่าไฟ',
  equipment: 'ค่าอุปกรณ์',
  other: 'รายจ่ายอื่น',
};

/**
 * A scanned receipt becomes a sentence in the composer, so the owner reads it,
 * fixes what the scan got wrong, and sends it as an ordinary expense command
 * that still goes through the confirm card. The ledger is never written directly.
 */
export function receiptDraftToCommand(draft: AIReceiptDraft, language: DisplayLanguage): string {
  const amount = Number.isFinite(draft.amount) && draft.amount > 0
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(draft.amount)
    : '';
  const what = [draft.vendor, draft.note].map((part) => part?.trim()).filter(Boolean).join(' ');
  const day = draft.spent_at?.trim();
  if (language === 'th') {
    const category = receiptCategoryTh[draft.category] ?? 'รายจ่าย';
    const parts = [`บันทึก${category}`, what, amount ? `${amount} บาท` : '', day ? `วันที่ ${day}` : ''];
    return parts.filter(Boolean).join(' ');
  }
  const parts = [`Record ${draft.category || 'expense'} expense`, what, amount ? `${amount} baht` : '', day ? `on ${day}` : ''];
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- voice notes

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 for the bytes of a recording. The JS engine the app runs on has no
 * btoa and no Buffer, and the clip is a few hundred kilobytes, so encoding it
 * here costs nothing worth optimising.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += BASE64_ALPHABET[a >> 2];
    out += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += index + 1 < bytes.length ? BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=';
    out += index + 2 < bytes.length ? BASE64_ALPHABET[c & 63] : '=';
  }
  return out;
}
