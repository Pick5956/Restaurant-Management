import {
  kitchenRoundDurationSeconds,
  kitchenRoundFinishedAt,
  kitchenTicketTiming,
  type KitchenUrgency,
} from './kitchen-workflow.ts';

// The kitchen board's arithmetic, kept out of the screen so it can be tested
// without rendering: which ticket comes first, what the three tiles say, how
// far along a ticket's ten minutes it is, and the short clock labels the
// finished list reads.

/** The ticket is "late" at ten minutes; the bar under its header fills there. */
export const KITCHEN_TARGET_MINUTES = 10;

type BoardTicket = {
  opened_at?: string | null;
  kitchen_sent_at?: string | null;
  items?: readonly {
    sent_at?: string | null;
    ready_at?: string | null;
    status?: string;
  }[] | null;
};

/**
 * Longest wait first. Two tickets that have waited the same number of minutes
 * keep the order the queue gave them, so the board does not reshuffle every
 * time the clock ticks.
 */
export function sortTicketsByWait<T extends BoardTicket>(tickets: readonly T[], now = Date.now()): T[] {
  return tickets
    .map((ticket, index) => ({ ticket, index, minutes: kitchenTicketTiming(ticket, now).minutes }))
    .sort((left, right) => right.minutes - left.minutes || left.index - right.index)
    .map((entry) => entry.ticket);
}

/** 0 at the moment the round reached the kitchen, 1 at ten minutes, never more. */
export function ticketProgress(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(1, minutes / KITCHEN_TARGET_MINUTES);
}

export type KitchenBoardStats = {
  cookingRounds: number;
  cookingItems: number;
  overdueRounds: number;
  doneRounds: number;
  /** Mean kitchen time of the finished rounds that have both stamps, in seconds. */
  averageDoneSeconds: number | null;
  slowestDoneSeconds: number | null;
};

/**
 * What the three tiles say. `cookingItems` counts only the items still
 * cooking, not everything on the ticket: a ticket with two dishes ready and one
 * on the stove is one round with one item to go.
 */
export function kitchenBoardStats(
  cooking: readonly (BoardTicket & { items?: readonly { status?: string }[] | null })[],
  done: readonly BoardTicket[],
  now = Date.now(),
): KitchenBoardStats {
  let cookingItems = 0;
  let overdueRounds = 0;
  for (const ticket of cooking) {
    cookingItems += (ticket.items || []).filter((item) => item.status === 'cooking').length;
    if (kitchenTicketTiming(ticket, now).urgency === 'overdue') overdueRounds += 1;
  }
  const durations = done
    .map((round) => kitchenRoundDurationSeconds(round))
    .filter((value): value is number => value !== null);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    cookingRounds: cooking.length,
    cookingItems,
    overdueRounds,
    doneRounds: done.length,
    averageDoneSeconds: durations.length ? Math.round(total / durations.length) : null,
    slowestDoneSeconds: durations.length ? Math.max(...durations) : null,
  };
}

/** "9 นาที" / "9 min" — the finished list has no room for seconds. */
export function formatKitchenMinutes(seconds: number | null, language: 'th' | 'en'): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '−';
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return language === 'th' ? 'ไม่ถึงนาที' : '<1 min';
  return language === 'th' ? `${minutes} นาที` : `${minutes} min`;
}

/** HH:MM in the shop's own clock, without the seconds the full label carries. */
export function kitchenClockLabel(at: number | null, language: 'th' | 'en'): string {
  if (at === null || !Number.isFinite(at)) return '−';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
}

/** When the most recent finished round was called, for the empty board. */
export function latestFinishedAt(done: readonly BoardTicket[]): number | null {
  let latest: number | null = null;
  for (const round of done) {
    const finished = kitchenRoundFinishedAt(round);
    if (finished !== null && (latest === null || finished > latest)) latest = finished;
  }
  return latest;
}

/** Two columns for the tablet: tickets dealt left, right, left, right. */
export function dealIntoColumns<T>(tickets: readonly T[], columns: number): T[][] {
  const out: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  tickets.forEach((ticket, index) => { out[index % out.length].push(ticket); });
  return out;
}

export type { KitchenUrgency };
