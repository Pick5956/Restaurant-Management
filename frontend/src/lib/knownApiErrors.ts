import { apiErrorCode, apiErrorMessage } from "./apiErrors";

// The server refusals a person can act on, read into kinds. The server answers
// in its own English ("x is sold out", "order is already closed"), and pages
// used to put that text straight into banners and toasts. A refusal more than
// one page meets is matched here and nowhere else - the stock wording from
// ensureMenuCapacity above all, which the QR pages and the POS order page both
// read through stockRefusal; a bill closed or a dish moved on another screen,
// which the kitchen and the POS order page read through orderItemStatusRefusal;
// and a dish or its options changed on the menu, which the QR pages and the
// POS order page read through menuRefusal. A page turns the kind into its own
// copy. The two POS pages also keep a table of the refusals only their own
// actions meet (ORDER_REFUSALS, OPEN_ORDER_REFUSALS), none of them a wording
// read here; anything read in neither place falls to apiFailureText and the
// page's own line. The strings mirror backend/internal/service:
// customer_order_service.go, order_flow_helpers.go (ensureMenuCapacity),
// order_service.go (AddItem, UpdateItem, SendToKitchen, UpdateItemStatus,
// validateSelectedMenuOptions), expense_service.go and promotion_service.go.

function serverMessage(error: unknown) {
  return apiErrorMessage(error).trim();
}

/** A dish the queue can no longer cover, from ensureMenuCapacity. */
export type StockRefusal =
  | { kind: "sold_out"; menu: string }
  | { kind: "only_left"; menu: string; left: number };

export function stockRefusal(message: string): StockRefusal | null {
  const text = message.trim();
  const onlyLeft = /^only (\d+) left for (.+)$/.exec(text);
  if (onlyLeft) return { kind: "only_left", menu: onlyLeft[2], left: Number(onlyLeft[1]) };
  const soldOut = /^(.+) is sold out$/.exec(text);
  if (soldOut) return { kind: "sold_out", menu: soldOut[1] };
  return null;
}

/** stockRefusal read off a failed request. */
export function stockRefusalOf(error: unknown): StockRefusal | null {
  return stockRefusal(serverMessage(error));
}

type CustomerTableRefusal =
  | { kind: "outside_restaurant" }
  | { kind: "table_not_open" }
  | { kind: "order_closed" }
  | { kind: "qr_invalid" }
  | { kind: "menu_unavailable" }
  | { kind: "options_changed" };

/** What the customer QR pages can tell a guest about a refused load or order. */
export type CustomerOrderRefusal = StockRefusal | CustomerTableRefusal;

const CUSTOMER_REFUSALS: ReadonlyMap<string, CustomerTableRefusal> = new Map<string, CustomerTableRefusal>([
  ["table is not open for customer ordering", { kind: "table_not_open" }],
  ["order is already closed", { kind: "order_closed" }],
  ["table QR code is not valid", { kind: "qr_invalid" }],
  ["table QR code is no longer valid", { kind: "qr_invalid" }],
]);

/**
 * A dish, or the options chosen for it, that the menu no longer offers as
 * ordered: deleted, taken off sale, or its option groups changed while the
 * cart or the order was open. Both order services send these.
 */
export type MenuRefusal = "menu_gone" | "menu_unavailable" | "options_changed";

const MENU_REFUSALS: ReadonlyMap<string, MenuRefusal> = new Map<string, MenuRefusal>([
  ["menu item not found", "menu_gone"],
  ["menu item is unavailable", "menu_unavailable"],
  ["too many selected options", "options_changed"],
  ["selected option id is invalid", "options_changed"],
  ["ตัวเลือกนี้ไม่พร้อมใช้งานสำหรับเมนูนี้", "options_changed"],
]);

// validateSelectedMenuOptions names the option group inside its refusal, so a
// cart built before the owner changed a dish's options is read by shape.
const OPTION_RULE_CHANGED = /^กรุณาเลือก .+ อย่างน้อย \d+ ตัวเลือก$|^.+ เลือกได้สูงสุด \d+ ตัวเลือก$/;

export function menuRefusal(error: unknown): MenuRefusal | null {
  const message = serverMessage(error);
  const known = MENU_REFUSALS.get(message);
  if (known) return known;
  return OPTION_RULE_CHANGED.test(message) ? "options_changed" : null;
}

export function customerOrderRefusal(error: unknown): CustomerOrderRefusal | null {
  if (apiErrorCode(error) === "OUTSIDE_RESTAURANT") return { kind: "outside_restaurant" };
  const message = serverMessage(error);
  if (!message) return null;
  const known = CUSTOMER_REFUSALS.get(message);
  if (known) return known;
  // A guest is told the same for a dish deleted and one taken off sale.
  const menu = menuRefusal(error);
  if (menu) return { kind: menu === "options_changed" ? "options_changed" : "menu_unavailable" };
  return stockRefusal(message);
}

/**
 * A staff change to an order the server turned down because the screen was
 * behind: the bill closed, or another screen already moved the dish.
 * OrderService words the first per action ("cannot add item to a closed
 * order", "cannot update item status on closed order", "cannot send a closed
 * order to kitchen", ...): every one starts "cannot" and names a "closed
 * order", not always at the end. The customer QR's "order is already closed"
 * is not one.
 */
export type OrderItemStatusRefusal = "order_closed" | "item_changed";

const ORDER_CLOSED = /^cannot .*\bclosed order\b/;

export function orderItemStatusRefusal(error: unknown): OrderItemStatusRefusal | null {
  const message = serverMessage(error);
  if (ORDER_CLOSED.test(message)) return "order_closed";
  if (message.startsWith("invalid item status transition")) return "item_changed";
  return null;
}

export type ExpenseRefusal = "amount_too_large" | "gone" | "stock_in_locked";

export function expenseRefusal(error: unknown): ExpenseRefusal | null {
  switch (serverMessage(error)) {
    case "amount is too large":
      return "amount_too_large";
    case "expense not found":
      return "gone";
    case "stock-in expenses cannot be edited or deleted":
      return "stock_in_locked";
    default:
      return null;
  }
}

/** A dish or category the promotion names was deleted while the form was open. */
export function promotionTargetsGone(error: unknown): boolean {
  return /^promotion (menu item|category) not found$/.test(serverMessage(error));
}

/**
 * Restoring a removed member whose role was deleted meanwhile. They come back
 * through a new invitation, which gives them a role the restaurant still has.
 */
export function memberRoleUnavailable(error: unknown): boolean {
  return apiErrorCode(error) === "role_unavailable";
}
