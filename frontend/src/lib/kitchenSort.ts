// The kitchen board's two orders, shared shape with the app
// (mobile/src/lib/kitchen-board.ts). "รอนานสุด" puts the round that has waited
// longest first — what to cook next. "ล่าสุด" puts the round that just came in
// first — for checking an order the moment it lands. Added 14 ก.ย. 2569.

export type KitchenSortMode = "waiting" | "latest";

type SortableTicket = {
  opened_at?: string | null;
  kitchen_sent_at?: string | null;
  items?: readonly { sent_at?: string | null }[] | null;
};

function stamp(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * When the round reached the kitchen: its own send stamp, else the earliest
 * item send, else when the bill was opened. The same fallbacks the app uses.
 */
export function kitchenTicketStartedAt(ticket: SortableTicket): number | null {
  const sent = stamp(ticket.kitchen_sent_at);
  if (sent !== null) return sent;
  const itemTimes = (ticket.items ?? [])
    .map((item) => stamp(item.sent_at))
    .filter((value): value is number => value !== null);
  if (itemTimes.length) return Math.min(...itemTimes);
  return stamp(ticket.opened_at);
}

/**
 * Oldest round first for "waiting", newest first for "latest". Rounds with no
 * stamp at all go last in both; ties keep the queue's own order, so the board
 * does not reshuffle between refreshes.
 */
export function sortKitchenTickets<T extends SortableTicket>(tickets: readonly T[], mode: KitchenSortMode): T[] {
  const direction = mode === "latest" ? -1 : 1;
  return tickets
    .map((ticket, index) => ({ ticket, index, at: kitchenTicketStartedAt(ticket) }))
    .sort((left, right) => {
      if (left.at === right.at) return left.index - right.index;
      if (left.at === null) return 1;
      if (right.at === null) return -1;
      return (left.at - right.at) * direction;
    })
    .map((entry) => entry.ticket);
}
