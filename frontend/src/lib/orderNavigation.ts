import type { Order } from "@/src/types/order";

export function orderPosHref(order: Pick<Order, "ID" | "order_number">) {
  return `/pos/orders/${order.ID}?ref=${encodeURIComponent(order.order_number)}`;
}

export function canCloseEmptyTableOrder(
  order: Pick<Order, "order_type" | "table_id" | "status"> & { items?: readonly { status?: string }[] },
) {
  // Cancelled items (e.g. the kitchen ran out of stock) leave the order empty,
  // so only non-cancelled items should keep it from being closed.
  const activeItemCount = order.items?.filter((item) => item?.status !== "cancelled").length ?? 0;
  if (order.status !== "open" || activeItemCount !== 0) return false;
  // A dine-in must still hold its table; a takeaway has none, but one opened by
  // mistake needs the same way out — otherwise an empty takeaway can never close.
  if (order.order_type === "dine_in") return Boolean(order.table_id);
  return order.order_type === "takeaway";
}
