import { publicApiClient } from "./apiClient";
import { apiFailureKind, apiFailureText } from "./apiFailure";
import { apiErrorMessage } from "./apiErrors";
import { customerOrderRefusal } from "./knownApiErrors";
import type {
  OrderItemFulfillmentType,
  OrderItemStatus,
  OrderStatus,
} from "../types/order";

export interface CustomerRestaurant {
  name: string;
  branch_name: string;
  logo: string;
  open_time: string;
  close_time: string;
  /** Restaurant requires the device to be on-site before ordering. */
  geofence_required?: boolean;
}

export interface CustomerTable {
  table_number: string;
  display_label: string;
  capacity: number;
  zone?: string;
}

export interface CustomerCategory {
  ID: number;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface CustomerMenuOption {
  ID: number;
  name: string;
  price_delta: number;
  is_default: boolean;
  display_order: number;
  is_active: boolean;
}

export interface CustomerMenuOptionGroup {
  ID: number;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  display_order: number;
  is_active: boolean;
  options: CustomerMenuOption[];
}

export interface CustomerMenuItem {
  ID: number;
  category_id: number;
  category?: CustomerCategory;
  name: string;
  price: number;
  image_url: string;
  description: string;
  is_available: boolean;
  /**
   * Portions still makeable from current stock after subtracting what queued orders
   * have already claimed. Undefined/null means the item has no recipe (not
   * stock-limited); 0 means sold out.
   */
  remaining_servings?: number | null;
  display_order: number;
  categories: Array<{ category_id: number }>;
  option_groups: CustomerMenuOptionGroup[];
}

export interface CustomerOrderItem {
  ID: number;
  menu_name: string;
  image_url: string;
  unit_price: number;
  options_total: number;
  quantity: number;
  subtotal: number;
  fulfillment_type: OrderItemFulfillmentType;
  note: string;
  status: OrderItemStatus;
  selected_options: Array<{
    ID: number;
    group_name: string;
    option_name: string;
    price_delta: number;
  }>;
}

export interface CustomerOrder {
  order_number: string;
  status: OrderStatus;
  items: CustomerOrderItem[];
}

export interface CustomerTablePayload {
  restaurant: CustomerRestaurant;
  table: CustomerTable;
  categories: CustomerCategory[];
  menu_items: CustomerMenuItem[];
  order?: CustomerOrder;
  /** Items were held for staff confirmation because location was unverified. */
  awaiting_staff_confirm?: boolean;
}

export interface CustomerCartItemInput {
  menu_id: number;
  quantity: number;
  note?: string;
  selected_option_ids?: number[];
}

export interface SubmitCustomerOrderInput {
  note?: string;
  items: CustomerCartItemInput[];
  /** Device location; omitted when the customer declines or it is unavailable. */
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

/**
 * Reads the device location for the geofence check. Never rejects: when the
 * customer declines (or the browser cannot answer in time) it resolves to null
 * and the order is held for staff confirmation instead of being blocked.
 */
export function readDeviceLocation(timeoutMs = 8000): Promise<GeolocationCoordinates | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: GeolocationCoordinates | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        finish(position.coords);
      },
      () => {
        window.clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

export const getCustomerTableOrder = (token: string) =>
  publicApiClient.get<CustomerTablePayload>(`/api/public/table-orders/${token}`);

export const createCustomerOrderRequestKey = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `customer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

export const submitCustomerTableOrder = (
  token: string,
  data: SubmitCustomerOrderInput,
  requestKey: string,
) =>
  publicApiClient.post<CustomerTablePayload>(
    `/api/public/table-orders/${token}/submit`,
    data,
    { headers: { "Idempotency-Key": requestKey } },
  );

/**
 * What one QR submit may carry, mirrored from validateCustomerSubmitRequest
 * (backend customer_order_service.go). The menu page keeps the cart inside
 * these, so a guest never builds an order the server turns down on every
 * try. apiWording.test.ts fails when the two drift apart.
 */
export const CUSTOMER_ORDER_LIMITS = {
  /** Cart lines in one submit (customerOrderMaxItems). */
  maxLines: 50,
  /** Portions on one line (customerOrderMaxItemQuantity). */
  maxLineQuantity: 20,
  /** Portions across the whole submit (customerOrderMaxTotalQuantity). */
  maxTotalQuantity: 100,
  /** Characters in a line's note (customerOrderMaxItemNoteRunes). */
  maxItemNoteLength: 250,
  /** Characters in the order's note (customerOrderMaxOrderNoteRunes). */
  maxOrderNoteLength: 500,
} as const;

type CartLineQuantity = { quantity: number };

const cartPortions = (cart: ReadonlyArray<CartLineQuantity>) =>
  cart.reduce((sum, line) => sum + line.quantity, 0);

/** Portions a new cart line may hold; 0 when the cart can take no new line. */
export function customerNewLineRoom(cart: ReadonlyArray<CartLineQuantity>): number {
  if (cart.length >= CUSTOMER_ORDER_LIMITS.maxLines) return 0;
  const left = CUSTOMER_ORDER_LIMITS.maxTotalQuantity - cartPortions(cart);
  return Math.max(0, Math.min(CUSTOMER_ORDER_LIMITS.maxLineQuantity, left));
}

/** Whether one more portion fits on a line already in the cart. */
export function customerLineCanGrow(cart: ReadonlyArray<CartLineQuantity>, line: CartLineQuantity): boolean {
  return line.quantity < CUSTOMER_ORDER_LIMITS.maxLineQuantity
    && cartPortions(cart) < CUSTOMER_ORDER_LIMITS.maxTotalQuantity;
}

/** A submit the server refused for its size, which the limits above keep from happening. */
export type CustomerOrderLimitRefusal = "too_much" | "note_too_long";

// knownApiErrors.ts is where server wording is normally read; these sit
// beside the limits they belong to, and are matched here only.
const LIMIT_REFUSALS: ReadonlyMap<string, CustomerOrderLimitRefusal> = new Map<string, CustomerOrderLimitRefusal>([
  ["order can include up to 50 items", "too_much"],
  ["item quantity must be between 1 and 20", "too_much"],
  ["order quantity is too large", "too_much"],
  ["item note is too long", "note_too_long"],
  ["order note is too long", "note_too_long"],
]);

export function customerOrderLimitRefusal(error: unknown): CustomerOrderLimitRefusal | null {
  return LIMIT_REFUSALS.get(apiErrorMessage(error).trim()) ?? null;
}

/**
 * A failed request on a guest's QR page: the shared lines for a lost
 * connection, a busy server or too many tries, and `fallback` for anything
 * else. The other shared lines speak to signed-in staff ("this account",
 * "no longer exists") and mean nothing to a guest.
 */
export function customerFailureText(error: unknown, language: "th" | "en", fallback: string): string {
  switch (apiFailureKind(error)) {
    case "offline":
    case "server_busy":
    case "rate_limited":
      return apiFailureText(error, language, fallback);
    default:
      return fallback;
  }
}

/**
 * The line a guest reads when a table page does not load: a dead QR code in
 * the page's words, otherwise what customerFailureText says for the page.
 */
export function customerTableLoadText(
  error: unknown,
  language: "th" | "en",
  copy: { qrInvalid: string; loadError: string },
): string {
  if (customerOrderRefusal(error)?.kind === "qr_invalid") return copy.qrInvalid;
  return customerFailureText(error, language, copy.loadError);
}
