import type { MenuItem } from './menu';
import type { RestaurantTable } from './table';
import type { User } from './auth';

export type OrderStatus = 'open' | 'sent_to_kitchen' | 'cooking' | 'ready' | 'served' | 'completed' | 'cancelled';
export type OrderItemStatus = 'pending' | 'cooking' | 'ready' | 'served' | 'cancelled';
export type OrderType = 'dine_in' | 'takeaway';
export type OrderItemFulfillmentType = 'dine_in' | 'takeaway';

export interface OrderItemOption {
  ID: number;
  order_item_id: number;
  order_id: number;
  restaurant_id: number;
  menu_option_id: number;
  option_group_id: number;
  group_name: string;
  option_name: string;
  price_delta: number;
}

export interface OrderItem {
  ID: number;
  order_id: number;
  restaurant_id: number;
  menu_id: number;
  menu_name: string;
  unit_price: number;
  options_total: number;
  quantity: number;
  subtotal: number;
  /** What dish-level promotions took off this line; subtotal is before them. */
  discount_amount?: number;
  fulfillment_type?: OrderItemFulfillmentType;
  note: string;
  status: OrderItemStatus;
  sent_at?: string | null;
  kitchen_batch?: number;
  ready_at?: string | null;
  served_at?: string | null;
  cancelled_reason?: string;
  menu?: MenuItem;
  selected_options?: OrderItemOption[];
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface OrderStatusLog {
  ID: number;
  order_id: number;
  from_status: string;
  to_status: string;
  changed_by: number;
  changed_at: string;
  note: string;
  user?: User;
}

/** One promotion as the server applied it to one order. Name and amount are
 *  copied at the time, so a paid bill keeps them after the promotion changes. */
export interface OrderPromotion {
  ID: number;
  order_id: number;
  promotion_id: number;
  name: string;
  type: string;
  /** How often it applied: two pairs of "1 แถม 1" is 2. */
  times: number;
  amount: number;
}

export interface OrderPayment {
  ID: number;
  order_id: number;
  restaurant_id: number;
  method: 'cash' | 'promptpay_qr';
  amount: number;
  received_amount: number;
  change_amount: number;
  note: string;
  paid_by: number;
  paid_at: string;
}

export interface Order {
  ID: number;
  kitchen_ticket_id?: string;
  kitchen_batch?: number;
  restaurant_id: number;
  table_id?: number | null;
  order_type: OrderType;
  order_number: string;
  order_date: string;
  staff_id: number;
  customer_count: number;
  customer_name?: string;
  customer_phone?: string;
  status: OrderStatus;
  subtotal: number;
  discount_amount: number;
  service_charge_amount: number;
  vat_amount: number;
  total_amount: number;
  grand_total: number;
  payment_status: 'unpaid' | 'paid';
  note: string;
  opened_at: string;
  closed_at?: string | null;
  cancelled_reason?: string;
  version: number;
  kitchen_sent_at?: string | null;
  table?: RestaurantTable;
  staff?: User;
  items?: OrderItem[];
  payments?: OrderPayment[];
  status_logs?: OrderStatusLog[];
  /** Promotions the server applied; their amounts add up to discount_amount. */
  promotions?: OrderPromotion[];
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface Bill {
  order: Order;
  items: OrderItem[];
  subtotal: number;
  discount_amount: number;
  /** Itemises discount_amount. Older servers omit it. */
  promotions?: OrderPromotion[];
  service_charge_enabled: boolean;
  service_charge_rate: number;
  service_charge_amount: number;
  vat_enabled: boolean;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  grand_total: number;
  payment_status: 'unpaid' | 'paid';
  promptpay_name: string;
  promptpay_qr_image: string;
  payments: OrderPayment[];
}
