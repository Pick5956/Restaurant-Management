import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { resolveNavigationRequest } from "../aiNavigation";
import { apiFailureText } from "../apiFailure";
import {
  CUSTOMER_ORDER_LIMITS,
  customerLineCanGrow,
  customerNewLineRoom,
  customerFailureText,
  customerOrderLimitRefusal,
  customerTableLoadText,
} from "../customerOrder";
import {
  customerOrderRefusal,
  expenseRefusal,
  memberRoleUnavailable,
  orderItemStatusRefusal,
  promotionTargetsGone,
  stockRefusal,
} from "../knownApiErrors";
import { membershipWith } from "./fixtures";

// The rule: never show the API's own wording to a user. These pages used to
// put `apiErrorMessage(error) || copy.fallback` in their banners and toasts, so
// guests on the QR pages read "Pad Thai is sold out" and "order is already
// closed" in English. The server's text is now matched in knownApiErrors.ts
// only, and each page turns what it recognises into its own copy. These guards
// read the call sites, so reverting one of those lines fails here.

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/** An axios failure as apiClient / publicApiClient throws it. */
function failure(status: number | undefined, error: string, code?: string) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined
    ? undefined
    : { status, statusText: "", headers: {}, config, data: { error, ...(code ? { code } : {}) } };
  return new AxiosError(error, status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

/** Every error format string the backend's services build. */
const backendErrorStrings = () => {
  const dir = join(process.cwd(), "..", "backend", "internal", "service");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".go") && !file.endsWith("_test.go"))
    .flatMap((file) => [...readFileSync(join(dir, file), "utf8").matchAll(/(?:errors\.New|fmt\.Errorf)\("((?:[^"\\]|\\.)*)"/g)])
    .map(([, message]) => message);
};

const apiErrorMessageLines = (source: string) =>
  source.split(/\r?\n/).filter((line) => line.includes("apiErrorMessage(")).map((line) => line.trim());

/** A function's source from `from` up to the next `to`. */
const between = (source: string, from: string, to: string) => {
  const start = source.indexOf(from);
  expect(start, `${from} not found`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(to, start + from.length));
};

const PAGES = {
  kitchen: "src/app/(dashboard)/r/[slug]/kitchen/page.tsx",
  expenses: "src/app/(dashboard)/r/[slug]/expenses/page.tsx",
  orders: "src/app/(dashboard)/r/[slug]/orders/page.tsx",
  promotionDialog: "src/app/(dashboard)/r/[slug]/promotions/PromotionDialog.tsx",
  tables: "src/app/(dashboard)/r/[slug]/tables/page.tsx",
  staff: "src/app/(dashboard)/r/[slug]/staff/page.tsx",
  customerMenu: "src/app/customer/t/[token]/page.tsx",
  customerOrders: "src/app/customer/t/[token]/orders/page.tsx",
} as const;

// The only place one of these pages still reads the raw text: the tables page
// hands it to tableErrorText, which already turns it into the page's words.
const ALLOWED_RAW_READS: Partial<Record<keyof typeof PAGES, string[]>> = {
  tables: ["const raw = apiErrorMessage(err);"],
};

describe("server wording on the kitchen, expenses, archive, promotion, tables, staff and QR pages", () => {
  it.each(Object.entries(PAGES))("%s never puts the server's text on screen", (name, path) => {
    const source = read(path);
    expect(source).not.toMatch(/apiErrorMessage\([^)]*\)\s*(\|\||\?\?)/);
    expect(apiErrorMessageLines(source)).toEqual(ALLOWED_RAW_READS[name as keyof typeof PAGES] ?? []);
  });

  it("the tables page reads the raw text only through its own mapper, then the shared lines", () => {
    const showActionError = between(read(PAGES.tables), "const showActionError", "\n  };");
    expect(showActionError).toContain("tableErrorText(raw, language, apiFailureText(err, language, fallback), context)");
  });
});

describe("customer QR pages", () => {
  it("reads every refusal a guest can act on", () => {
    expect(customerOrderRefusal(failure(403, "you must be at the restaurant to order", "OUTSIDE_RESTAURANT")))
      .toEqual({ kind: "outside_restaurant" });
    expect(customerOrderRefusal(failure(400, "table is not open for customer ordering"))).toEqual({ kind: "table_not_open" });
    expect(customerOrderRefusal(failure(400, "order is already closed"))).toEqual({ kind: "order_closed" });
    expect(customerOrderRefusal(failure(404, "table QR code is not valid"))).toEqual({ kind: "qr_invalid" });
    expect(customerOrderRefusal(failure(400, "table QR code is no longer valid"))).toEqual({ kind: "qr_invalid" });
    expect(customerOrderRefusal(failure(400, "menu item not found"))).toEqual({ kind: "menu_unavailable" });
    expect(customerOrderRefusal(failure(400, "menu item is unavailable"))).toEqual({ kind: "menu_unavailable" });
    expect(customerOrderRefusal(failure(400, "กรุณาเลือก ระดับความเผ็ด อย่างน้อย 1 ตัวเลือก"))).toEqual({ kind: "options_changed" });
    expect(customerOrderRefusal(failure(400, "ท็อปปิ้ง เลือกได้สูงสุด 2 ตัวเลือก"))).toEqual({ kind: "options_changed" });
    expect(customerOrderRefusal(failure(400, "ตัวเลือกนี้ไม่พร้อมใช้งานสำหรับเมนูนี้"))).toEqual({ kind: "options_changed" });
  });

  it("names the dish the kitchen can no longer cover", () => {
    expect(customerOrderRefusal(failure(400, "ข้าวผัด กุ้ง is sold out"))).toEqual({ kind: "sold_out", menu: "ข้าวผัด กุ้ง" });
    expect(customerOrderRefusal(failure(400, "only 2 left for Pad Thai"))).toEqual({ kind: "only_left", menu: "Pad Thai", left: 2 });
    expect(stockRefusal("only 12 left for only 3 left for x")).toEqual({ kind: "only_left", menu: "only 3 left for x", left: 12 });
    expect(stockRefusal("order is already closed")).toBeNull();
  });

  it("leaves everything else to the shared lines and the page's own", () => {
    expect(customerOrderRefusal(failure(400, "order note is too long"))).toBeNull();
    expect(customerOrderRefusal(failure(500, "internal server error"))).toBeNull();
    expect(customerOrderRefusal(failure(undefined, "Network Error"))).toBeNull();
    expect(customerOrderRefusal(new Error("boom"))).toBeNull();
  });

  it("matches wording the backend still sends", () => {
    const backend = backendErrorStrings();
    for (const message of [
      "table is not open for customer ordering",
      "order is already closed",
      "table QR code is not valid",
      "table QR code is no longer valid",
      "menu item not found",
      "menu item is unavailable",
      "selected option id is invalid",
      "ตัวเลือกนี้ไม่พร้อมใช้งานสำหรับเมนูนี้",
      "กรุณาเลือก %s อย่างน้อย %d ตัวเลือก",
      "%s เลือกได้สูงสุด %d ตัวเลือก",
      "%s is sold out",
      "only %d left for %s",
    ]) {
      expect(backend, message).toContain(message);
    }
  });

  it("the menu page's submit toast says the guest's copy, never the server's, and never the load line", () => {
    const menu = read(PAGES.customerMenu);
    const submitOrder = between(menu, "const submitOrder = async", "\n  };");
    expect(submitOrder).toContain('showToast({ title: submitFailureText(err), tone: "error" });');
    const submitFailureText = between(menu, "const submitFailureText", "\n  };");
    // Only the guest's shared lines: a WAF challenge (403) or a 404 on submit
    // must not read "this account has no permission" or "no longer exists".
    expect(submitFailureText).toContain("return customerFailureText(err, language, copy.submitError);");
    expect(menu).not.toContain("apiFailureText");
    expect(submitFailureText).not.toContain("copy.loadError");
    for (const kind of ["outside_restaurant", "table_not_open", "order_closed", "qr_invalid", "menu_unavailable", "options_changed", "sold_out", "only_left"]) {
      expect(submitFailureText).toContain(`case "${kind}":`);
    }
    for (const key of ["submitError:", "soldOutItem:", "onlyLeftItem:", "menuUnavailable:", "optionsChanged:", "orderClosed:", "qrInvalid:"]) {
      expect(menu.split(key).length - 1, `${key} in both languages`).toBe(2);
    }
  });

  it("the orders page says a dead QR code in the guest's words", () => {
    const orders = read(PAGES.customerOrders);
    expect(orders).toContain("setError(customerTableLoadText(loadError, language, { qrInvalid: copy.qrInvalid, loadError: copy.loadError }));");
    expect(orders.split(/\r?\n/).filter((line) => line.trim().startsWith("qrInvalid:"))).toHaveLength(2);
  });
});

describe("kitchen status changes", () => {
  it("reads the two refusals that mean the screen was behind", () => {
    expect(orderItemStatusRefusal(failure(400, "cannot update item status on closed order"))).toBe("order_closed");
    expect(orderItemStatusRefusal(failure(400, "invalid item status transition from ready to ready"))).toBe("item_changed");
    expect(orderItemStatusRefusal(failure(403, "missing permission for this order item status transition"))).toBeNull();
    expect(orderItemStatusRefusal(new Error("boom"))).toBeNull();
    const backend = backendErrorStrings();
    expect(backend).toContain("cannot update item status on closed order");
    expect(backend).toContain("invalid item status transition from %s to %s");
  });

  it("every failed change and the load say the kitchen's own words", () => {
    const kitchen = read(PAGES.kitchen);
    expect(kitchen.split("setError(statusFailureText(error));").length - 1).toBe(4);
    expect(between(kitchen, "const cancelItem = async", "\n  };")).toContain('showToast({ title: statusFailureText(error), tone: "error" });');
    expect(kitchen).toContain("setError(apiFailureText(error, language, copy.loadError));");
    const statusFailureText = between(kitchen, "const statusFailureText", "\n  };");
    expect(statusFailureText).toContain("apiFailureText(error, language, copy.saveError)");
  });
});

describe("expense ledger", () => {
  it("reads the refusals a person can fix", () => {
    expect(expenseRefusal(failure(400, "amount is too large"))).toBe("amount_too_large");
    expect(expenseRefusal(failure(400, "expense not found"))).toBe("gone");
    expect(expenseRefusal(failure(400, "stock-in expenses cannot be edited or deleted"))).toBe("stock_in_locked");
    expect(expenseRefusal(failure(400, "spent_at must be YYYY-MM-DD"))).toBeNull();
    const backend = backendErrorStrings();
    for (const message of ["amount is too large", "expense not found", "stock-in expenses cannot be edited or deleted"]) {
      expect(backend, message).toContain(message);
    }
  });

  it("save, delete and load say the ledger's own words", () => {
    const expenses = read(PAGES.expenses);
    expect(expenses.split("setError(saveFailureText(err));").length - 1).toBe(2);
    // The load's dependency list is pinned by expensesPage.test.ts, so the load
    // keeps its own line rather than taking `language` for the shared ones.
    expect(expenses).toContain("setError(copy.loadError);");
    expect(between(expenses, "const saveFailureText", "\n  };")).toContain("apiFailureText(err, language, copy.saveError)");
  });
});

describe("promotion dialog", () => {
  it("recognises a deleted dish or category, and nothing else", () => {
    expect(promotionTargetsGone(failure(400, "promotion menu item not found"))).toBe(true);
    expect(promotionTargetsGone(failure(400, "promotion category not found"))).toBe(true);
    expect(promotionTargetsGone(failure(400, "promotion name is required"))).toBe(false);
    const backend = backendErrorStrings();
    expect(backend).toContain("promotion menu item not found");
    expect(backend).toContain("promotion category not found");
  });

  it("save and delete toasts say the dialog's own words", () => {
    const dialog = read(PAGES.promotionDialog);
    expect(dialog).toContain("promotionTargetsGone(error) ? copy.goneTargets : apiFailureText(error, language, copy.saveError)");
    expect(dialog).toContain('showToast({ title: apiFailureText(error, language, copy.deleteError), tone: "error" });');
  });
});

describe("order archive", () => {
  it("opens only under view_orders, which the paid list needs", () => {
    const orders = read(PAGES.orders);
    expect(orders).toContain('const canView = can(activeMembership, "view_orders");');
    expect(orders).not.toContain('can(activeMembership, "take_order")');
    expect(orders).toContain("setError(apiFailureText(error, language, copy.receiptLoadError));");
  });

  it("the assistant does not send a take_order-only member to it", () => {
    const takeOrderOnly = resolveNavigationRequest("open order archive", membershipWith("take_order"), "en", "/home");
    expect(JSON.stringify(takeOrderOnly)).not.toContain('"/orders"');
    expect(resolveNavigationRequest("open order archive", membershipWith("view_orders"), "en", "/home"))
      .toMatchObject({ kind: "navigate", href: "/orders" });
  });
});

describe("staff member restore", () => {
  it("recognises a deleted role by the code, not the wording", () => {
    expect(memberRoleUnavailable(failure(400, "role is not available for this restaurant", "role_unavailable"))).toBe(true);
    expect(memberRoleUnavailable(failure(400, "role is not available for this restaurant", "invalid_request"))).toBe(false);
    expect(memberRoleUnavailable(new Error("boom"))).toBe(false);
  });

  it("restoring a member whose role was deleted tells the owner to invite them again", () => {
    const staff = read(PAGES.staff);
    const changeMemberStatus = between(staff, "const changeMemberStatus", "const changeMemberRole");
    expect(changeMemberStatus).toContain("memberRoleUnavailable(err) ? copy.roleUnavailable : memberFailureText(err)");
    expect(staff).toContain('roleUnavailable: "บทบาทเดิมของพนักงานคนนี้ถูกลบแล้ว เชิญเข้าร้านใหม่อีกครั้ง",');
    expect(staff.split("roleUnavailable:").length - 1).toBe(2);
    const withMemberLock = between(staff, "const withMemberLock", "const withRoleAction");
    expect(withMemberLock).toContain("setError(failureText(err));");
    expect(staff).toContain("const memberFailureText = (err: unknown) => apiFailureText(err, language, copy.memberError);");
  });
});

// The guest QR menu used to let a cart grow past what validateCustomerSubmitRequest
// accepts, so a guest read "could not send, try again" on every try. The page
// now holds the cart inside the server's limits; these read the limits from the
// backend and the call sites from the page, so drifting either way fails here.
describe("QR submit limits", () => {
  const limitSource = () =>
    readFileSync(join(process.cwd(), "..", "backend", "internal", "service", "customer_order_service.go"), "utf8");
  const backendLimit = (source: string, name: string) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(source);
    expect(match, name).not.toBeNull();
    return Number(match?.[1]);
  };
  const lines = (count: number, quantity: number) => Array.from({ length: count }, () => ({ quantity }));

  it("mirrors the server's limits", () => {
    const source = limitSource();
    expect(CUSTOMER_ORDER_LIMITS).toEqual({
      maxLines: backendLimit(source, "customerOrderMaxItems"),
      maxLineQuantity: backendLimit(source, "customerOrderMaxItemQuantity"),
      maxTotalQuantity: backendLimit(source, "customerOrderMaxTotalQuantity"),
      maxItemNoteLength: backendLimit(source, "customerOrderMaxItemNoteRunes"),
      maxOrderNoteLength: backendLimit(source, "customerOrderMaxOrderNoteRunes"),
    });
  });

  it("gives a new line only the room the cart has left", () => {
    expect(customerNewLineRoom([])).toBe(20);
    expect(customerNewLineRoom(lines(4, 20))).toBe(20);
    expect(customerNewLineRoom(lines(9, 10))).toBe(10);
    expect(customerNewLineRoom(lines(5, 20))).toBe(0);
    expect(customerNewLineRoom(lines(49, 1))).toBe(20);
    expect(customerNewLineRoom(lines(50, 1))).toBe(0);
  });

  it("stops a line at 20 portions and the cart at 100", () => {
    expect(customerLineCanGrow([{ quantity: 19 }], { quantity: 19 })).toBe(true);
    expect(customerLineCanGrow([{ quantity: 20 }], { quantity: 20 })).toBe(false);
    const full = lines(5, 20).map((line, index) => (index === 0 ? { quantity: 1 } : line));
    expect(customerLineCanGrow(full, full[0])).toBe(true);
    const atCap = [...lines(4, 20), { quantity: 19 }, { quantity: 1 }];
    expect(customerLineCanGrow(atCap, atCap[4])).toBe(false);
  });

  it("reads a size refusal the limits should have kept from happening", () => {
    expect(customerOrderLimitRefusal(failure(400, "order can include up to 50 items"))).toBe("too_much");
    expect(customerOrderLimitRefusal(failure(400, "item quantity must be between 1 and 20"))).toBe("too_much");
    expect(customerOrderLimitRefusal(failure(400, "order quantity is too large"))).toBe("too_much");
    expect(customerOrderLimitRefusal(failure(400, "item note is too long"))).toBe("note_too_long");
    expect(customerOrderLimitRefusal(failure(400, "order note is too long"))).toBe("note_too_long");
    expect(customerOrderLimitRefusal(failure(400, "menu item not found"))).toBeNull();
    expect(customerOrderLimitRefusal(new Error("item note is too long"))).toBeNull();
    const backend = backendErrorStrings();
    for (const message of [
      "order can include up to 50 items",
      "item quantity must be between 1 and 20",
      "order quantity is too large",
      "item note is too long",
      "order note is too long",
    ]) {
      expect(backend, message).toContain(message);
    }
  });

  it("the menu page holds the cart inside the limits", () => {
    const menu = read(PAGES.customerMenu);
    expect(menu).toContain("const newLineRoom = customerNewLineRoom(cart);");
    // The stepper and the field never offer less than one portion, so a full
    // cart cannot show a max of 0 in the sheet.
    expect(menu).toContain("const quantityCap = Math.max(1, newLineRoom);");
    // A full cart stops before the sheet opens, with the toast saying why.
    const openMenu = between(menu, "const openMenu", "\n  };");
    expect(openMenu).toMatch(/if \(newLineRoom <= 0\) \{\s*showToast\(\{ title: copy\.cartFull, tone: "warning" \}\);\s*return;\s*\}/);
    expect(openMenu.indexOf("if (newLineRoom <= 0) {")).toBeLessThan(openMenu.indexOf("setSelectedMenu(item);"));
    expect(menu).toContain("<button type=\"button\" onClick={addToCart} disabled={requiredOptionsMissing || newLineRoom <= 0}");
    const addToCart = between(menu, "const addToCart", "\n  };");
    expect(addToCart).toContain("requiredOptionsMissing || newLineRoom <= 0) return;");
    expect(addToCart).toContain("quantity: Math.min(quantity, newLineRoom),");
    expect(between(menu, "const increaseCartItem", "\n  };")).toContain("item.key === key && customerLineCanGrow(current, item)");
    expect(menu).toContain("onClick={() => increaseCartItem(item.key)} disabled={submitting || !customerLineCanGrow(cart, item)}");
    expect(menu).toContain("<NumberInput min={1} max={quantityCap}");
    expect(menu).toContain("onClick={() => setQuantity((current) => Math.min(quantityCap, current + 1))} disabled={quantity >= quantityCap}");
    expect(menu).toContain("maxLength={CUSTOMER_ORDER_LIMITS.maxItemNoteLength}");
    const submitFailureText = between(menu, "const submitFailureText", "\n  };");
    expect(submitFailureText).toContain('if (limit === "too_much") return copy.cartTooLarge;');
    expect(submitFailureText).toContain('if (limit === "note_too_long") return copy.noteTooLong;');
    for (const key of ["cartFull:", "cartTooLarge:", "noteTooLong:"]) {
      expect(menu.split(key).length - 1, `${key} in both languages`).toBe(2);
    }
  });
});

describe("customer QR pages, after a refusal", () => {
  it("a table that is not open tells the guest what to do next", () => {
    const submitFailureText = between(read(PAGES.customerMenu), "const submitFailureText", "\n  };");
    expect(submitFailureText).toMatch(/case "table_not_open":\s*return copy\.noActiveOrderBody;/);
    expect(submitFailureText).not.toContain("copy.noActiveOrderTitle");
  });

  it("a refusal about the menu re-reads it behind the open summary sheet", () => {
    const menu = read(PAGES.customerMenu);
    expect(between(menu, "const submitOrder = async", "\n  };"))
      .toContain("if (refusal && MENU_CHANGED_REFUSALS.has(refusal.kind)) void refreshMenuInBackground();");
    const refresh = between(menu, "const refreshMenuInBackground", "\n  };");
    expect(refresh).toContain("setPayload(res.data);");
    expect(refresh).not.toContain("setLoading");
    const kinds = between(menu, "const MENU_CHANGED_REFUSALS", "]);");
    for (const kind of ["sold_out", "only_left", "menu_unavailable", "options_changed"]) {
      expect(kinds).toContain(`"${kind}"`);
    }
  });

  it("both pages say a dead QR code the same way, and never a line meant for staff", () => {
    const copy = { qrInvalid: "dead QR", loadError: "page line" };
    const shared = (error: unknown, language: "th" | "en") => apiFailureText(error, language, "unused");
    expect(customerTableLoadText(failure(404, "table QR code is not valid"), "th", copy)).toBe("dead QR");
    expect(customerTableLoadText(failure(404, "resource not found"), "th", copy)).toBe("page line");
    expect(customerTableLoadText(failure(403, "forbidden"), "en", copy)).toBe("page line");
    expect(customerTableLoadText(failure(400, "invalid request"), "en", copy)).toBe("page line");
    expect(customerTableLoadText(new Error("boom"), "en", copy)).toBe("page line");
    for (const error of [failure(undefined, "Network Error"), failure(500, "internal server error"), failure(429, "too many requests")]) {
      expect(customerTableLoadText(error, "th", copy)).toBe(shared(error, "th"));
      expect(customerFailureText(error, "en", "send line")).toBe(shared(error, "en"));
    }
    for (const error of [failure(403, "forbidden"), failure(404, "resource not found"), failure(400, "invalid request"), new Error("boom")]) {
      expect(customerFailureText(error, "th", "send line")).toBe("send line");
    }
    const menu = read(PAGES.customerMenu);
    const orders = read(PAGES.customerOrders);
    expect(orders).not.toContain("apiFailureText");
    expect(between(menu, "const load = async", "\n  };")).toContain("setError(customerTableLoadText(err, language, copy));");
    expect(orders).toContain("setError(customerTableLoadText(loadError, language, { qrInvalid: copy.qrInvalid, loadError: copy.loadError }));");
    const qrLines = (source: string) => source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("qrInvalid:"));
    expect(qrLines(menu)).toEqual(qrLines(orders));
  });

  it("the orders page names a missing table", () => {
    const orders = read(PAGES.customerOrders);
    expect(orders).toContain("const tableLabel = tableNumber ? `${copy.table} ${tableNumber}` : copy.noTable;");
    expect(orders).not.toMatch(/\|\|\s*"-"/);
    expect(orders.split("noTable:").length - 1).toBe(2);
  });
});

describe("kitchen cancel and expense ledger outcomes", () => {
  it("a refused cancel is a toast, never a problem with the reason", () => {
    const kitchen = read(PAGES.kitchen);
    const cancelItem = between(kitchen, "const cancelItem = async", "\n  };");
    expect(cancelItem).toContain("if (orderItemStatusRefusal(error)) closeCancelDialog();");
    expect(cancelItem).toContain('showToast({ title: statusFailureText(error), tone: "error" });');
    const fieldErrors = [...kitchen.matchAll(/setCancelReasonError\(([^)]*)\)/g)].map(([, value]) => value);
    expect(new Set(fieldErrors)).toEqual(new Set(["copy.reasonRequired", '""']));
  });

  it("a takeaway ticket joins the guest's name with a comma, and says a missing one", () => {
    const orderLocationLabel = between(read(PAGES.kitchen), "function orderLocationLabel", "\n}");
    expect(orderLocationLabel).toContain("return `${base}, ${order.customer_name?.trim() || NO_NAME[language]}`;");
    expect(orderLocationLabel).not.toContain(" · ");
  });

  it("the kitchen says a missing table, finish time and duration", () => {
    const kitchen = read(PAGES.kitchen);
    expect(kitchen).toContain('const NO_TABLE = { th: "ไม่ระบุโต๊ะ", en: "No table" } as const;');
    expect(kitchen).toContain('const NO_NAME = { th: "ไม่ระบุชื่อ", en: "no name" } as const;');
    const orderTableLabel = between(kitchen, "function orderTableLabel", "\n}");
    expect(orderTableLabel).toContain("(order.table_id ? String(order.table_id) : null);");
    expect(between(kitchen, "function orderLocationLabel", "\n}"))
      .toContain('return table ? `${language === "th" ? "โต๊ะ" : "Table"} ${table}` : NO_TABLE[language];');
    // The ready corner shows the said value alone, not under a "Table" label.
    expect(kitchen).toContain(": tableLabel ?? NO_TABLE[language];");
    expect(kitchen).toContain('order.order_type === "takeaway" || !tableLabel ? (');
    expect(kitchen).toContain("{finishAt ? `${copy.finishedAt} ${formatClock(finishAt)}` : copy.noFinishTime}");
    expect(kitchen).toContain("{secs != null ? `${copy.timeTaken} ${copy.recallDuration(Math.floor(secs / 60), secs % 60)}` : copy.noDuration}");
    for (const key of ["noFinishTime:", "noDuration:"]) {
      expect(kitchen.split(key).length - 1, `${key} in both languages`).toBe(2);
    }
    expect(kitchen).not.toContain('"-"');
  });

  it("values in one line are joined with a comma, never a middle dot", () => {
    for (const path of [PAGES.kitchen, PAGES.expenses, PAGES.customerMenu, PAGES.customerOrders]) {
      expect(read(path), path).not.toContain("·");
    }
    expect(read(PAGES.kitchen)).toContain("<span>{order.order_number},</span>");
    expect(read(PAGES.expenses)).toContain("label: `${label}, ${formatCurrency(amount, language)}` };");
    expect(read(PAGES.customerMenu)).toContain('{copy.cart}, <span className="font-mono tabular-nums">{cartItemCount}</span> {copy.itemUnit}');
    expect(read(PAGES.customerOrders)).toContain("`${copy.order} ${payload.order.order_number}, ${copy.subtitle}`");
  });

  it("an entry deleted elsewhere leaves the list, and a toast says why", () => {
    const expenses = read(PAGES.expenses);
    const expenseGone = between(expenses, "const expenseGone", "\n  };");
    expect(expenseGone).toContain('if (expenseRefusal(err) !== "gone") return false;');
    expect(expenseGone).toContain("setRefreshTick((tick) => tick + 1);");
    expect(expenseGone).toContain('showToast({ title: copy.expenseGone, tone: "warning" });');
    expect(expenses.split("if (!expenseGone(err)) setError(saveFailureText(err));").length - 1).toBe(2);
  });

  it("the ledger, its print table and its PDF say a missing value", () => {
    const expenses = read(PAGES.expenses);
    expect(expenses).not.toMatch(/(\|\||:)\s*"-"/);
    const pdfBody = between(expenses, "body: sortedExpenses.map((expense, index) => [", "]),");
    expect(pdfBody).toContain("expenseNote(expense),");
    expect(pdfBody).toContain("expenseRecorder(expense),");
    for (const key of ["noNote:", "noRecorder:"]) {
      expect(expenses.split(key).length - 1, `${key} in both languages`).toBe(2);
    }
  });
});
