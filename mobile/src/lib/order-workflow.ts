import type { Order, OrderItem, OrderItemStatus } from '@/src/types/order';

type KitchenItem = Pick<OrderItem, 'status'>;
type KitchenTicket = Pick<Order, 'ID' | 'kitchen_batch' | 'kitchen_ticket_id'>;
type EmptyOrderCandidate = Pick<Order, 'order_type' | 'table_id' | 'status'> & {
  items?: readonly { status?: string }[] | null;
};
type CancelOrderCandidate = Pick<Order, 'order_type' | 'payment_status' | 'status'> & {
  items?: readonly { status?: string }[] | null;
};

export function canCloseEmptyOrder(order: EmptyOrderCandidate | null | undefined) {
  const activeItemCount = order?.items?.filter((item) => item.status !== 'cancelled').length ?? 0;
  return Boolean(
    order
    && order.order_type === 'dine_in'
    && order.table_id
    && order.status === 'open'
    && activeItemCount === 0,
  );
}

export function canCancelOrderForRole(
  roleName: string | null | undefined,
  status: Order['status'],
) {
  if (status === 'completed' || status === 'cancelled') return false;
  return roleName !== 'waiter' || status === 'open';
}

export function canCancelOrderFromDetail(
  order: CancelOrderCandidate | null | undefined,
  roleName: string | null | undefined,
) {
  if (!order || order.payment_status === 'paid') return false;
  const hasActiveItems = order.items?.some((item) => item.status !== 'cancelled') ?? false;
  const canRecoverEmptyTakeaway = order.order_type === 'takeaway';
  return (hasActiveItems || canRecoverEmptyTakeaway)
    && canCancelOrderForRole(roleName, order.status);
}

export function isKitchenComplete(items: KitchenItem[] | null | undefined) {
  return canTakeOrderPayment(items);
}

export function activeOrderItems<T extends KitchenItem>(
  items: readonly T[] | null | undefined,
) {
  return (items ?? []).filter((item) => item.status !== 'cancelled');
}

export function undeliveredOrderItems<T extends KitchenItem>(
  items: readonly T[] | null | undefined,
) {
  return activeOrderItems(items).filter(
    (item) => item.status === 'pending' || item.status === 'cooking',
  );
}

export function canOpenOrderBill(items: readonly KitchenItem[] | null | undefined) {
  const activeItems = activeOrderItems(items);
  return activeItems.length > 0
    && activeItems.every((item) => item.status !== 'pending');
}

export function canTakeOrderPayment(items: readonly KitchenItem[] | null | undefined) {
  const activeItems = activeOrderItems(items);
  return activeItems.length > 0
    && activeItems.every((item) => item.status === 'ready' || item.status === 'served');
}

export function kitchenTicketKey(ticket: KitchenTicket) {
  const backendKey = ticket.kitchen_ticket_id?.trim();
  return backendKey || `${ticket.ID}:${ticket.kitchen_batch ?? 0}`;
}

export function paymentReceivedAmount(
  _method: 'cash' | 'promptpay_qr',
  grandTotal: number,
) {
  return grandTotal;
}

export function billExitRoute(canTakeOrder: boolean, canViewOrders: boolean) {
  if (canTakeOrder) return '/tables' as const;
  if (canViewOrders) return '/orders' as const;
  return '/home' as const;
}

// Two states only, matching the web. The bill screen leaves as soon as a
// payment succeeds rather than re-reading the bill, so there is no window
// in which a paid order can still be sitting on an unpaid-looking screen.
export function billPaymentStage(paymentStatus: 'unpaid' | 'paid') {
  return paymentStatus === 'paid' ? 'paid' as const : 'due' as const;
}

export function isCookingItem(status: OrderItemStatus) {
  return status === 'pending' || status === 'cooking';
}

export function isKitchenDoneItem(status: OrderItemStatus) {
  return status === 'ready' || status === 'served';
}

export function isOptionSelectionBelowMinimum(
  minSelect: number | null | undefined,
  selectedCount: number,
) {
  const normalizedMinimum = Math.max(0, Number(minSelect) || 0);
  return selectedCount < normalizedMinimum;
}

/**
 * Why a dish the kitchen already made is coming off the bill. Picked from this
 * list rather than typed: the reason is written into the day's cancellation
 * record, and a waiter standing at a table with a customer waiting was being
 * handed an empty box and a keyboard. Five covers what actually happens in
 * service; anything rarer is a conversation with the manager, not a text field.
 */
export const SERVED_REMOVAL_REASONS: { key: string; th: string; en: string }[] = [
  { key: 'customer_cancelled', th: 'ลูกค้ายกเลิก', en: 'Customer cancelled' },
  { key: 'not_ordered', th: 'ลูกค้าไม่ได้สั่งรายการนี้', en: 'Customer did not order this' },
  { key: 'wrong_item', th: 'ทำผิดรายการ', en: 'Wrong item made' },
  { key: 'quality', th: 'อาหารมีปัญหา', en: 'Problem with the food' },
  { key: 'comp', th: 'ร้านยกให้ลูกค้า', en: 'On the house' },
];

export function validateKitchenCancelReason(value: string) {
  const reason = value.trim();
  if (!reason) return { reason: null, error: 'required' as const };
  if (reason.length > 500) return { reason: null, error: 'too_long' as const };
  return { reason, error: null };
}

/**
 * A receipt can be reprinted once the order is finished and settled - the same
 * rule the web archive uses. A paid but still-running order has no final
 * receipt yet, and an unpaid one has nothing to reprint.
 */
export function canReprintReceipt(
  order: { status?: string | null; payment_status?: string | null },
): boolean {
  return order.status === 'completed' && order.payment_status === 'paid';
}
