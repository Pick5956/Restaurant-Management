// A whole day of orders, page by page. The order list caps a page at 200, and
// /home used to ask for one page and stop, so a day past 200 orders silently
// lost every order after the 200th from its takings. This keeps asking while the
// server says there is more, up to a hard ceiling so a runaway response can
// never loop.
//
// The fetch is passed in, so the loop itself runs under node --test without a
// network; src/api/order.ts wires it to listOrders as loadDayOrders.

/** The server's own page cap (backend ListOrders: limit 1..200). */
export const DAY_ORDERS_PAGE_LIMIT = 200;
/** 2,000 orders in one Bangkok day before the loop gives up. */
export const DAY_ORDERS_MAX_PAGES = 10;

export type DayOrdersPage<T> = {
  orders?: T[] | null;
  pagination?: { has_more?: boolean } | null;
};

export type DayOrders<T> = {
  orders: T[];
  /** False when the ceiling stopped the loop while the server still had more. */
  complete: boolean;
};

/**
 * Every order the pages return, first page first. The list is newest first, so
 * an order opened between two page reads pushes one row from page n onto page
 * n + 1 and the same order would arrive twice; it is kept once, by ID.
 *
 * Not handled: the reverse. The list is offset-paged, so an order removed from
 * a page already read (closing a table that was opened but never ordered on
 * soft-deletes its order) pulls every later row up by one, and the first row
 * of the next page lands on the page already read and is never fetched. On a
 * day past one page, each such removal between two reads can drop one order
 * from the count; one page (up to 200 orders) is never affected. A keyset
 * cursor (the last opened_at and ID) from the backend would close it.
 */
export async function collectDayOrders<T extends { ID: number }>(
  fetchPage: (page: number) => Promise<DayOrdersPage<T>>,
  maxPages = DAY_ORDERS_MAX_PAGES,
): Promise<DayOrders<T>> {
  const seen = new Set<number>();
  const orders: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchPage(page);
    for (const order of response.orders ?? []) {
      if (seen.has(order.ID)) continue;
      seen.add(order.ID);
      orders.push(order);
    }
    if (!response.pagination?.has_more) return { orders, complete: true };
  }
  return { orders, complete: false };
}
