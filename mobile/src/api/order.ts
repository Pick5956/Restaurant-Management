import { apiRequest } from './client';
import { buildOrderListPath } from '@/src/lib/order-query';
import type { Bill, Order, OrderItemStatus, OrderStatus, OrderType } from '@/src/types/order';

export type OrderListStatus = OrderStatus | 'active' | 'closed' | '';

export interface OrderListSummary {
  total: number;
  active: number;
  closed: number;
  statuses: Record<OrderStatus, number>;
}

export interface OrderListResponse {
  orders: Order[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    has_more: boolean;
  };
  summary?: OrderListSummary;
}

export function listOrders(params?: {
  status?: OrderListStatus;
  payment_status?: 'paid' | 'unpaid' | '';
  search?: string;
  include_summary?: boolean;
  table_id?: number;
  date?: string;
  page?: number;
  limit?: number;
}) {
  return apiRequest<OrderListResponse>(buildOrderListPath(params));
}

export function kitchenQueue() {
  return apiRequest<{ orders: Order[] }>('/api/v1/kitchen/queue');
}

export function getOrder(id: number) {
  return apiRequest<Order>(`/api/v1/orders/${id}`);
}

export function createOrder(data: {
  table_id?: number | null;
  order_type?: OrderType;
  customer_count: number;
  customer_name?: string;
  customer_phone?: string;
  note?: string;
  seat_reservation?: boolean;
}) {
  return apiRequest<Order>('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getBill(id: number) {
  return apiRequest<Bill>(`/api/v1/orders/${id}/bill`);
}

export function closeEmptyTable(id: number) {
  return apiRequest<Order>(`/api/v1/orders/${id}/close-empty-table`, { method: 'POST' });
}

export function addOrderItem(orderId: number, data: { menu_id: number; quantity: number; note?: string; fulfillment_type?: 'dine_in' | 'takeaway'; selected_option_ids?: number[]; serve_immediately?: boolean }) {
  return apiRequest<Order>(`/api/v1/orders/${orderId}/items`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateOrderItem(
  orderId: number,
  itemId: number,
  // `selected_option_ids` REPLACES the line's options. Leave it off to edit the
  // quantity or note without touching them - the field is a pointer on the
  // server so "not sent" and "cleared" are different requests.
  data: { quantity: number; note?: string; selected_option_ids?: number[] },
) {
  return apiRequest<Order>(`/api/v1/orders/${orderId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteOrderItem(orderId: number, itemId: number) {
  return apiRequest<Order>(`/api/v1/orders/${orderId}/items/${itemId}`, {
    method: 'DELETE',
  });
}

export function sendOrderToKitchen(orderId: number) {
  return apiRequest<Order>(`/api/v1/orders/${orderId}/send-to-kitchen`, {
    method: 'POST',
  });
}

export function updateOrderItemStatus(orderId: number, itemId: number, status: OrderItemStatus, reason?: string) {
  return apiRequest<Order>(`/api/v1/orders/${orderId}/items/${itemId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, reason }),
  });
}

export function payOrder(orderId: number, data: { method: 'cash' | 'promptpay_qr'; received_amount?: number; note?: string }) {
  return apiRequest<Order>(`/api/v1/orders/${orderId}/pay`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
