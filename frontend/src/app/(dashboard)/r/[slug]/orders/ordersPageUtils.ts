import type { Order, OrderItem, OrderStatus } from "@/src/types/order";

type Language = "th" | "en";

export const statusClass: Record<OrderStatus, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/40 dark:bg-sky-900/20 dark:text-sky-300",
  sent_to_kitchen: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300",
  cooking: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300",
  served: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300",
  completed: "border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300",
  cancelled: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300",
};

export function isTakeawayOrder(order: Order) {
  return order.order_type === "takeaway";
}

export function takeawayLabel(order: Order, language: Language = "en") {
  const label = language === "th" ? "กลับบ้าน" : "Takeaway";
  return order.customer_name?.trim() ? `${label} · ${order.customer_name.trim()}` : label;
}

export function itemFulfillmentType(item: OrderItem) {
  return item.fulfillment_type === "takeaway" ? "takeaway" : "dine_in";
}

export function tableName(order: Order, language: Language = "en") {
  if (isTakeawayOrder(order)) return takeawayLabel(order, language);
  const table = order.table;
  if (!table) return order.table_id ? `#${order.table_id}` : "-";
  return table.display_label || table.table_number || (order.table_id ? `#${order.table_id}` : "-");
}

export function zoneName(order: Order) {
  if (isTakeawayOrder(order)) return "";
  return order.table?.table_zone?.name || order.table?.zone || "";
}

export function itemCount(order: Order) {
  return order.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
}

export function orderTime(order: Order) {
  return order.closed_at || order.opened_at || order.CreatedAt;
}

export function canReprintReceipt(order: Pick<Order, "status" | "payment_status">) {
  return order.status === "completed" && order.payment_status === "paid";
}
