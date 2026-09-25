import type { Order } from '../types/order';

const ACTIVE_STATUSES = ['open', 'sent_to_kitchen', 'cooking', 'ready', 'served'];

/** The zone-picker key for the takeaway section; the web POS uses the same one. */
export const TAKEAWAY_ZONE = 'takeaway';

/**
 * The takeaway orders still in progress, oldest first so the one waiting longest
 * leads, narrowed by the table map's search (order number, name or phone). A
 * takeaway has no table, so this list is the only way back to it from the floor.
 */
export function activeTakeaways(orders: readonly Order[], search = ''): Order[] {
  const keyword = search.trim().toLowerCase();
  return orders
    .filter((order) => order.order_type === 'takeaway' && ACTIVE_STATUSES.includes(order.status))
    .filter((order) => {
      if (!keyword) return true;
      return [order.order_number, order.customer_name, order.customer_phone]
        .some((value) => String(value ?? '').toLowerCase().includes(keyword));
    })
    .sort((a, b) => a.ID - b.ID);
}
