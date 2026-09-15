import {
  kitchenRoundDurationSeconds,
  kitchenRoundFinishedAt,
  kitchenTicketStartedAt,
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

/**
 * The board's two orders. "รอนานสุด" (the default) puts the ticket that has
 * waited longest on top — what to cook next. "ล่าสุด" puts the round that just
 * came in on top — what was just ordered, for checking a table's order the
 * moment it lands. The owner asked for the second on 14 ก.ย.
 */
export type KitchenSortMode = 'waiting' | 'latest';

/**
 * Newest round first, by the moment it reached the kitchen. Rounds with no
 * stamp at all sink to the bottom; ties keep the queue's own order.
 */
export function sortTicketsByLatest<T extends BoardTicket>(tickets: readonly T[]): T[] {
  return tickets
    .map((ticket, index) => ({ ticket, index, at: kitchenTicketStartedAt(ticket) }))
    .sort((left, right) => {
      if (left.at === right.at) return left.index - right.index;
      if (left.at === null) return 1;
      if (right.at === null) return -1;
      return right.at - left.at;
    })
    .map((entry) => entry.ticket);
}

export function sortTickets<T extends BoardTicket>(tickets: readonly T[], mode: KitchenSortMode, now = Date.now()): T[] {
  return mode === 'latest' ? sortTicketsByLatest(tickets) : sortTicketsByWait(tickets, now);
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

/**
 * The tablet board lays tickets out as lanes, left to right (the owner chose
 * this on 15 ก.ย. 2569). A lane counts as out of sight once less than half of it
 * is on screen, and this is how many are, for the "+N" at the right edge.
 */
export function lanesOutOfSight(total: number, laneWidth: number, gap: number, scrollX: number, viewportWidth: number): number {
  if (total <= 0 || laneWidth <= 0 || viewportWidth <= 0) return 0;
  const step = laneWidth + gap;
  const visibleEdge = Math.max(0, scrollX) + viewportWidth;
  let shown = 0;
  for (let index = 0; index < total; index += 1) {
    const middle = index * step + laneWidth / 2;
    if (middle <= visibleEdge) shown = index + 1;
  }
  return total - shown;
}

export type { KitchenUrgency };
