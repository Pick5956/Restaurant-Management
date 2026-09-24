import { apiClient } from "./apiClient";
import type { AddOrderItemInput, Bill, OpenOrderInput, Order, OrderItemStatus, OrderStatus } from "../types/order";

export type OrderListStatus = OrderStatus | "active" | "closed" | "";

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

export interface OrderListParams {
  status?: OrderListStatus;
  payment_status?: "paid" | "unpaid" | "";
  search?: string;
  include_summary?: boolean;
  table_id?: number;
  date?: string;
  page?: number;
  limit?: number;
}

export const listOrders = (params?: OrderListParams) =>
  apiClient.get<OrderListResponse>("/api/v1/orders", { params });

// The server pages the list at 200 rows, and a busy day or a full floor runs
// past one page. Every page is read and joined, so a day's totals or the live
// floor never quietly stop at the newest rows. Page 1000 is the server's last.
export const ORDER_LIST_PAGE_LIMIT = 200;
const ORDER_LIST_LAST_PAGE = 1000;

export async function listAllOrders(params: Omit<OrderListParams, "page" | "limit"> = {}): Promise<Order[]> {
  const pages: Order[][] = [];
  for (let page = 1; page <= ORDER_LIST_LAST_PAGE; page += 1) {
    const res = await listOrders({ ...params, page, limit: ORDER_LIST_PAGE_LIMIT });
    const rows = res.data.orders ?? [];
    pages.push(rows);
    if (!res.data.pagination?.has_more || rows.length === 0) break;
  }
  // Offset paging over opened_at desc: an order opened between two page reads
  // pushes the last row of one page onto the next. It is kept once, so a
  // takeaway never gets two cards on the floor.
  const seen = new Set<number>();
  return pages.flat().filter((order) => {
    if (seen.has(order.ID)) return false;
    seen.add(order.ID);
    return true;
  });
}

export const getOrder = (id: string | number) =>
  apiClient.get<Order>(`/api/v1/orders/${id}`);

export const createOrder = (data: OpenOrderInput) =>
  apiClient.post<Order>("/api/v1/orders", data);

export const closeEmptyTableOrder = (id: number) =>
  apiClient.post<Order>(`/api/v1/orders/${id}/close-empty-table`);

export const getOrderBill = (id: number) =>
  apiClient.get<Bill>(`/api/v1/orders/${id}/bill`);

export const payOrder = (id: number, data: { method: "cash" | "promptpay_qr"; received_amount?: number; note?: string }) =>
  apiClient.post<Order>(`/api/v1/orders/${id}/pay`, data);

export const addOrderItem = (orderId: number, data: AddOrderItemInput) =>
  apiClient.post<Order>(`/api/v1/orders/${orderId}/items`, data);

export const updateOrderItem = (orderId: number, itemId: number, data: { quantity: number; note?: string }) =>
  apiClient.patch<Order>(`/api/v1/orders/${orderId}/items/${itemId}`, data);

export const deleteOrderItem = (orderId: number, itemId: number) =>
  apiClient.delete<Order>(`/api/v1/orders/${orderId}/items/${itemId}`);

export const updateOrderItemStatus = (orderId: number, itemId: number, status: OrderItemStatus, reason?: string) =>
  apiClient.patch<Order>(`/api/v1/orders/${orderId}/items/${itemId}/status`, { status, reason });

// Void a number of units from a single served/cooking line, with an audit
// reason. Voiding the whole quantity cancels the line; a smaller count splits
// it, keeping the remaining units billable.
export const voidOrderItemUnits = (orderId: number, itemId: number, quantity: number, reason: string) =>
  apiClient.post<Order>(`/api/v1/orders/${orderId}/items/${itemId}/void`, { quantity, reason });

export const sendOrderToKitchen = (orderId: number) =>
  apiClient.post<Order>(`/api/v1/orders/${orderId}/send-to-kitchen`);

export const kitchenQueue = () =>
  apiClient.get<{ orders: Order[] }>("/api/v1/kitchen/queue");
