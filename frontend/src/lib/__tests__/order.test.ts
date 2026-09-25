import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../apiClient", () => ({ apiClient }));

import { customerOrderRefusal, menuRefusal, orderItemStatusRefusal, stockRefusalOf } from "../knownApiErrors";
import { listAllOrders, ORDER_LIST_PAGE_LIMIT } from "../order";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

/** An axios failure as apiClient throws it. */
const failure = (status: number, error: string) => {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(error, "ERR_BAD_REQUEST", config, undefined, { status, statusText: "", headers: {}, config, data: { error } });
};

const page = (ids: number[], hasMore: boolean) => ({
  data: {
    orders: ids.map((ID) => ({ ID })),
    pagination: { page: 1, limit: ORDER_LIST_PAGE_LIMIT, total: 0, has_more: hasMore },
  },
});

const requestedParams = () => apiClient.get.mock.calls.map(([, config]) => (config as { params: unknown }).params);

describe("listAllOrders", () => {
  beforeEach(() => {
    apiClient.get.mockReset();
  });

  it("walks every page the server reports and joins them in order", async () => {
    apiClient.get
      .mockResolvedValueOnce(page([1, 2], true))
      .mockResolvedValueOnce(page([3], true))
      .mockResolvedValueOnce(page([4], false));

    const orders = await listAllOrders({ date: "2026-09-24" });

    expect(orders.map((order) => order.ID)).toEqual([1, 2, 3, 4]);
    expect(requestedParams()).toEqual([
      { date: "2026-09-24", page: 1, limit: ORDER_LIST_PAGE_LIMIT },
      { date: "2026-09-24", page: 2, limit: ORDER_LIST_PAGE_LIMIT },
      { date: "2026-09-24", page: 3, limit: ORDER_LIST_PAGE_LIMIT },
    ]);
  });

  it("asks for the largest page and stops after one when there is no more", async () => {
    apiClient.get.mockResolvedValueOnce(page([7], false));

    const orders = await listAllOrders({ status: "active" });

    expect(orders.map((order) => order.ID)).toEqual([7]);
    expect(requestedParams()).toEqual([{ status: "active", page: 1, limit: 200 }]);
  });

  it("stops on an empty page even when the server still claims more", async () => {
    apiClient.get.mockResolvedValueOnce(page([1], true)).mockResolvedValueOnce(page([], true));

    const orders = await listAllOrders();

    expect(orders.map((order) => order.ID)).toEqual([1]);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it("keeps an order once when a new order pushes it onto the next page", async () => {
    apiClient.get.mockResolvedValueOnce(page([9, 8], true)).mockResolvedValueOnce(page([8, 7], false));

    const orders = await listAllOrders({ status: "active" });

    expect(orders.map((order) => order.ID)).toEqual([9, 8, 7]);
  });

  it("fails as a whole when a later page fails, never with a partial list", async () => {
    apiClient.get.mockResolvedValueOnce(page([1], true)).mockRejectedValueOnce(new Error("network"));

    await expect(listAllOrders()).rejects.toThrow("network");
  });
});

// The helper is only worth what its call sites do with it: a page that asked
// for one page of 200 by hand would drop the rest of the day again.
describe("order list call sites", () => {
  const home = read("src/app/(dashboard)/r/[slug]/home/page.tsx");
  const floor = read("src/app/(dashboard)/r/[slug]/pos/tables/page.tsx");

  it("home reads the whole day, not the newest 200 orders", () => {
    expect(home).toMatch(/canViewOrders \? listAllOrders\(\{ date: selectedDate \}\)/);
    expect(home).not.toMatch(/\blistOrders\(/);
  });

  it("home sends each live request only under the permission the server checks for it", () => {
    expect(home).toContain('const canViewOrders = can(activeMembership, "view_orders");');
    expect(home).toContain(
      'const canViewTables = can(activeMembership, "take_order") || can(activeMembership, "view_tables") || can(activeMembership, "manage_table");',
    );
    expect(home).toContain('const canViewKitchen = can(activeMembership, "view_kitchen");');
    expect(home).toMatch(/canViewTables \? listTables\(\)/);
    expect(home).toMatch(/canViewKitchen \? kitchenQueue\(\)/);
  });

  it("the floor loads every live order, so the oldest table is not left looking free", () => {
    expect(floor).toMatch(/Promise\.all\(\[listTables\(\), listAllOrders\(\{ status: "active" \}\)\]\)/);
  });

  it("the table layout locks every table with a live order, not those on the newest page", () => {
    const layout = read("src/app/(dashboard)/r/[slug]/tables/page.tsx");
    expect(layout).toContain('return activeOrderTableIds(await listAllOrders({ status: "active" }));');
    expect(layout).not.toMatch(/\blistOrders\(/);
  });

  it("the sidebar offers the archive only to the permission its paid-order list needs", () => {
    const sidebar = read("src/components/shared/Sidebar.tsx");
    const archive = read("src/app/(dashboard)/r/[slug]/orders/page.tsx");
    // The archive's list is not the operational status=active read that
    // take_order alone may make, so the server answers it only under view_orders.
    expect(archive).toMatch(/listOrders\(\{\s*payment_status: "paid",/);
    const entry = sidebar.slice(sidebar.indexOf("href: '/orders'"), sidebar.indexOf("href: '/inventory'"));
    expect(entry.match(/permission: (.*)/)?.[1].trim()).toBe("'view_orders',");
  });
});

describe("POS floor open-order fallback", () => {
  const floor = read("src/app/(dashboard)/r/[slug]/pos/tables/page.tsx");

  it("a failed lookup of the table's open order finds nothing instead of escaping", () => {
    const helper = floor.slice(floor.indexOf("const findOpenTableOrder"), floor.indexOf("const openOrder = async"));
    expect(helper).toMatch(/try \{\s*const orderRes = await listOrders\(\{ status: "active", table_id: tableID \}\);[\s\S]*?\} catch \{\s*return null;\s*\}/);
  });

  it("both refusals look the order up only through the guarded helper", () => {
    expect(floor.match(/await findOpenTableOrder\(tableID\)/g)).toHaveLength(2);
    expect(floor.match(/await listOrders\(/g)).toHaveLength(1);
  });
});

describe("POS order page reads", () => {
  const orderPage = read("src/app/(dashboard)/r/[slug]/pos/orders/[orderNumber]/page.tsx");

  it("applies only the newest read of the order", () => {
    expect(orderPage).toContain("const [loadRequests] = useState(createRequestGeneration);");
    expect(orderPage).toMatch(
      /const request = loadRequests\.begin\(\);[\s\S]*?if \(!loadRequests\.isCurrent\(request\)\) return;\s*if \(background && actionInFlightRef\.current\) return;\s*setOrder\(orderRes\.data\);/,
    );
  });

  it("lets an action's order beat a read still in flight", () => {
    expect(orderPage).toMatch(/const applyActionOrder = \(next: Order\) => \{\s*loadRequests\.invalidate\(\);\s*setOrder\(next\);/);
    expect(orderPage).toMatch(/const next = await action\(\);\s*applyActionOrder\(next\);/);
    expect(orderPage).not.toMatch(/setOrder\(response\.data\)/);
  });

  it("a read that lands takes down the banner a failed background read left", () => {
    const load = orderPage.slice(orderPage.indexOf("const load = async"), orderPage.indexOf("const applyActionOrder"));
    expect(load).toMatch(
      /setMenuItems\(menuRes\.data\.menu_items\);[\s\S]*?setError\(\(current\) => \(current === copy\.loadError \? "" : current\)\);\s*\} catch \{/,
    );
  });

  it("a line voided part-way re-reads the bill and drops the dialog's stale group", () => {
    const confirm = orderPage.slice(orderPage.indexOf("const confirmCancelBillItem"), orderPage.indexOf("const confirmPayment"));
    expect(confirm).toMatch(/await updateOrderItemStatus\(order\.ID, target\.ID, "cancelled", reason\);\s*voided \+= 1;/);
    expect(confirm).toMatch(
      /\} catch \(error\) \{\s*if \(voided > 0\) \{[\s\S]*?setBillCancelTarget\(null\);[\s\S]*?await reloadBill\(\);\s*void load\(\{ background: true \}\);\s*\}/,
    );
  });
});

describe("reservation history paging", () => {
  const history = read("src/components/tables/ReservationHistoryModal.tsx");

  it("asks for the server's largest page instead of its default 20 rows", () => {
    expect(history).toContain("const RESERVATION_PAGE_SIZE = 100;");
    expect(history).toMatch(/listReservations\(\{ \.\.\.\(filter === "all" \? \{\} : \{ status: filter \}\), limit: RESERVATION_PAGE_SIZE \}\)/);
  });

  it("offers the rest behind a load-more control worded like the mobile app", () => {
    expect(history).toMatch(/limit: RESERVATION_PAGE_SIZE,\s*offset: nextOffset,/);
    expect(history).toMatch(/\{hasMore \? \([\s\S]*?onClick=\{\(\) => void loadMore\(\)\}[\s\S]*?\{copy\.loadMore\}/);
    expect(history).toContain('loadMore: "โหลดการจองเพิ่มเติม"');
    expect(history).toContain('loadMore: "Load more bookings"');
    expect(history).not.toMatch(/รีเฟรช|Refresh/);
  });

  it("a new first page clears a next page still on its way, so the button never sticks disabled", () => {
    expect(history).toMatch(/const load = useCallback\(async \(\) => \{\s*const request = listRequests\.begin\(\);[\s\S]*?setLoadingMore\(false\);[\s\S]*?setLoading\(true\);/);
  });

  it("a failed first page says the app's own words, never the API's", () => {
    const load = history.slice(history.indexOf("const load = useCallback"), history.indexOf("const loadMore = async"));
    expect(load).toContain("setError(copy.loadError);");
    expect(load).not.toMatch(/apiErrorMessage/);
  });

  it("another filter's rows and paging never stay under a filter whose first page failed", () => {
    const load = history.slice(history.indexOf("const load = useCallback"), history.indexOf("const loadMore = async"));
    expect(load).toMatch(/if \(rowsFilterRef\.current !== filter\) \{\s*rowsFilterRef\.current = null;\s*setReservations\(\[\]\);\s*setHasMore\(false\);\s*setNextOffset\(0\);/);
    expect(load).toMatch(/rowsFilterRef\.current = filter;\s*setReservations\(rows\);/);
    expect(load).toMatch(/\} catch \{\s*if \(!listRequests\.isCurrent\(request\)\) return;[\s\S]*?setHasMore\(false\);/);
  });

  it("load-more waits for a first page in flight, known before the next render", () => {
    expect(history).toMatch(/const loadMore = async \(\) => \{[\s\S]*?if \(loadingRef\.current \|\| loadingMore \|\| !hasMore\) return;/);
    expect(history).toMatch(/const request = listRequests\.begin\(\);\s*loadingRef\.current = true;/);
    expect(history).toMatch(/disabled=\{loading \|\| loadingMore\}\s*onClick=\{\(\) => void loadMore\(\)\}/);
  });

  it("the rows follow the copy rules: comma between values, a missing value said, no subtitle", () => {
    expect(history).not.toMatch(/ · /);
    expect(history).not.toMatch(/\|\| "-"/);
    expect(history).not.toMatch(/return "-"/);
    expect(history).not.toMatch(/subtitle/);
    expect(history).toContain('noPhone: "ไม่ระบุเบอร์"');
    expect(history).toContain('notClosed: "ยังไม่ปิด"');
  });
});

// The two POS pages read the server's wording only to recognise a refusal; what
// staff see is always the app's own copy. The rule: never show the API's words.
type Refusal = { needles: string[]; th: string; en: string };

/** The `{ needles: [...], th, en }` table a page declares as `const <name>`, in order. */
const refusalTable = (source: string, name: string): Refusal[] => {
  const start = source.indexOf(`const ${name}:`);
  const table = source.slice(start, source.indexOf("\n];", start));
  return [...table.matchAll(/\{ needles: \[([^\]]+)\], th: "([^"]+)", en: "([^"]+)" \}/g)].map(([, needles, th, en]) => ({
    needles: [...needles.matchAll(/"([^"]+)"/g)].map(([, needle]) => needle),
    th,
    en,
  }));
};

/** The same lookup the pages run: the first entry the message contains. */
const firstRefusal = (table: Refusal[], message: string) => {
  const refusal = message.trim().toLowerCase();
  return table.find((entry) => entry.needles.some((needle) => refusal.includes(needle)));
};

/** The `kind: { th, en }` copy a page declares as `const <name>: Record<...>`, by kind. */
const kindCopy = (source: string, name: string): Record<string, { th: string; en: string }> => {
  const start = source.indexOf(`const ${name}:`);
  const table = source.slice(start, source.indexOf("\n};", start));
  return Object.fromEntries([...table.matchAll(/(\w+): \{ th: "([^"]+)", en: "([^"]+)" \}/g)].map(([, kind, th, en]) => [kind, { th, en }]));
};

const backendService = (file: string) => readFileSync(join(process.cwd(), "..", "backend", "internal", "service", file), "utf8");

/** Every error string the backend's services build, as written, verbs and all. */
const backendErrorFormats = () => {
  const dir = join(process.cwd(), "..", "backend", "internal", "service");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".go") && !file.endsWith("_test.go"))
    .flatMap((file) => [...readFileSync(join(dir, file), "utf8").matchAll(/(?:errors\.New|fmt\.Errorf)\("((?:[^"\\]|\\.)*)"/g)])
    .map(([, message]) => message);
};

/** Every error string the backend's services build, lower-cased. */
const backendErrorStrings = () => backendErrorFormats().map((message) => message.toLowerCase());

/** A backend format as the server would send it, with its verbs filled in. */
const sentMessage = (format: string) => format.replace(/%[-+# 0]*\d*(?:\.\d+)?([a-z])/gi, (_verb, kind: string) => (kind === "d" || kind === "f" ? "2" : "ข้าวผัด"));

const apiErrorMessageLines = (source: string) =>
  source.split(/\r?\n/).filter((line) => line.includes("apiErrorMessage(")).map((line) => line.trim());

/** A function's source from `const <name> = async` up to the next marker. */
const between = (source: string, from: string, to: string) => source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from)));
const catchOf = (fn: string) => fn.slice(fn.indexOf("} catch (error) {"));

describe("POS floor failures", () => {
  const floor = read("src/app/(dashboard)/r/[slug]/pos/tables/page.tsx");
  const refusals = refusalTable(floor, "OPEN_ORDER_REFUSALS");

  it("reads the server's wording only to recognise a refusal, never as the line shown", () => {
    expect(floor).not.toMatch(/apiErrorMessage\([^)]*\)\s*\|\|/);
    expect(floor).not.toMatch(/const message = apiErrorMessage/);
    expect(apiErrorMessageLines(floor)).toEqual([
      "const refusalOf = (error: unknown) => apiErrorMessage(error).trim().toLowerCase();",
      // reservationErrorMessage maps the booking refusals, then the shared
      // failure line (offline, 403, 5xx) the sheet's other actions say, then the step's copy.
      "setSheetError(reservationErrorMessage(apiErrorMessage(error), language, apiFailureText(error, language, copy.reserveError)));",
      "setSheetError(reservationErrorMessage(apiErrorMessage(error), language, apiFailureText(error, language, copy.cancelError)));",
    ]);
  });

  it("a table that already has an open order is said in the sheet when that order cannot be found", () => {
    expect(refusals[0]).toEqual({
      needles: ["table already has an open order"],
      th: "โต๊ะนี้มีออเดอร์เปิดอยู่แล้ว",
      en: "This table already has an open order.",
    });
    const openOrder = between(floor, "const openOrder = async", "const handleTableClick");
    expect(openOrder).toMatch(/setError\(""\);\s*setSheetError\(""\);\s*try \{/);
    expect(openOrder).toMatch(/if \(capturedTable && tableID && tableHasOpenOrder\(error\)\) \{\s*const activeOrder = await findOpenTableOrder\(tableID\);/);
    expect(catchOf(openOrder)).toContain("setSheetError(openOrderFailureText(error, language, copy.saveError));");
    // The page banner sits under the open sheet's z-50 overlay.
    expect(catchOf(openOrder)).not.toContain("setError(");
  });

  it("seating a booked table says its refusal in the sheet the same way", () => {
    const accept = between(floor, "const acceptReservation = async", "const cancelReservation = async");
    expect(accept).toMatch(/if \(tableHasOpenOrder\(error\)\) \{\s*const activeOrder = await findOpenTableOrder\(tableID\);/);
    expect(catchOf(accept)).toContain("setSheetError(openOrderFailureText(error, language, copy.saveError));");
  });

  it("an unrecognised failure is the shared failure line or the action's own, never the server's", () => {
    expect(floor).toContain("return known ? known[language] : apiFailureText(error, language, fallback);");
    expect(floor).toContain("OPEN_ORDER_REFUSALS.find((entry) => entry.needles.some((needle) => refusal.includes(needle)))");
  });

  it("every refusal it recognises is one the server sends, and each has its own Thai and English", () => {
    const backend = backendErrorStrings();
    expect(refusals.length).toBeGreaterThanOrEqual(5);
    for (const entry of refusals) {
      for (const needle of entry.needles) expect(backend.some((message) => message.includes(needle)), needle).toBe(true);
      expect(entry.th).toMatch(/[฀-๿]/);
      expect(entry.en).not.toMatch(/[฀-๿]/);
    }
    expect(firstRefusal(refusals, "table has no active reservation")?.th).toBe("โต๊ะนี้ไม่มีการจองแล้ว");
    expect(firstRefusal(refusals, "table is reserved")?.th).toBe("โต๊ะนี้ถูกจองไว้");
  });
});

describe("POS order page failures", () => {
  const orderPage = read("src/app/(dashboard)/r/[slug]/pos/orders/[orderNumber]/page.tsx");
  const refusals = refusalTable(orderPage, "ORDER_REFUSALS");
  const stockCopy = kindCopy(orderPage, "STOCK_REFUSALS");
  const itemStatusCopy = kindCopy(orderPage, "ITEM_STATUS_REFUSALS");
  const menuCopy = kindCopy(orderPage, "MENU_REFUSALS");

  /** What orderFailureText answers: the readers in knownApiErrors first, then the page's own table. */
  const answer = (message: string) => {
    const error = failure(400, message);
    const stock = stockRefusalOf(error);
    if (stock) return stockCopy[stock.kind];
    const itemStatus = orderItemStatusRefusal(error);
    if (itemStatus) return itemStatusCopy[itemStatus];
    const menu = menuRefusal(error);
    if (menu) return menuCopy[menu];
    return firstRefusal(refusals, message);
  };

  it("reads the server's wording only to recognise a refusal, never as the line shown", () => {
    expect(orderPage).not.toMatch(/apiErrorMessage\([^)]*\)\s*\|\|/);
    // The stock refusals are read by stockRefusalOf in knownApiErrors, not here.
    expect(apiErrorMessageLines(orderPage)).toEqual(["const refusalOf = (error: unknown) => apiErrorMessage(error).trim().toLowerCase();"]);
    expect(orderPage).toContain("return known ? known[language] : apiFailureText(error, language, fallback);");
    expect(orderPage).toContain("ORDER_REFUSALS.find((entry) => entry.needles.some((needle) => refusal.includes(needle)))");
  });

  it("every action's failure is a toast in the app's words, above the bill and the sheets", () => {
    expect(orderPage).toMatch(
      /const showActionFailure = \(error: unknown, fallback: string = copy\.saveError\) => \{\s*showToast\(\{ tone: "error", title: orderFailureText\(error, language, fallback\) \}\);/,
    );
    const actions: Array<[from: string, to: string, call: string]> = [
      ["const runAction = async", "const addSelectedMenu = async", "showActionFailure(error);"],
      ["const requestCloseEmptyTable = async", "const sendToKitchen = async", "showActionFailure(error, takeaway ? copy.closeTakeawayError : copy.closeTableError);"],
      ["const loadBill = async", "const hasRequiredOptions", "showActionFailure(error, copy.billLoadError);"],
      ["const reloadBill = async", "const addServedItem = async", "showActionFailure(error, copy.billReloadError);"],
      ["const addServedItem = async", "const isPendingOnlyGroup", "showActionFailure(error);"],
      ["const adjustBillPendingGroup = async", "const addServedUnit = async", "showActionFailure(error);"],
      ["const addServedUnit = async", "const decreaseBillGroup", "showActionFailure(error);"],
      ["const confirmCancelBillItem = async", "const confirmPayment = async", "showActionFailure(error, copy.voidError);"],
      ["const confirmPayment = async", "const orderItemCount", "showActionFailure(error, copy.paymentError);"],
    ];
    for (const [from, to, call] of actions) {
      const failure = catchOf(between(orderPage, from, to));
      expect(failure, from).toContain(call);
      // The header banner sits under the bill and every sheet (z-20 under z-50).
      expect(failure, from).not.toContain("setError(");
    }
  });

  it("a line voided part-way warns over the bill how much came off, so the rest is not charged", () => {
    const confirm = between(orderPage, "const confirmCancelBillItem = async", "const confirmPayment = async");
    expect(confirm).toMatch(/lineTargets = billCancelTarget\.items\.filter\(\(it\) => it\.status !== "cancelled"\);\s*for \(const target of lineTargets\) \{/);
    expect(confirm).toMatch(
      /if \(voided > 0\) \{[\s\S]*?showToast\(\{ tone: "warning", title: copy\.partialVoidToast\(unitCount\(lineTargets\.slice\(0, voided\)\), unitCount\(lineTargets\)\) \}\);[\s\S]*?await reloadBill\(\);[\s\S]*?\} else \{\s*showActionFailure\(error, copy\.voidError\);\s*\}/,
    );
    expect(orderPage).toContain("partialVoidToast: (done: number, total: number) => `ยกเลิกได้ ${done} จาก ${total} รายการ ตรวจบิลอีกครั้ง`,");
    expect(orderPage).toContain("partialVoidToast: (done: number, total: number) => `Voided ${done} of ${total} items. Check the bill again.`,");
  });

  it("every refusal it recognises is one the server sends, and each has its own Thai and English", () => {
    const backend = backendErrorStrings();
    // The table parsed at all; the refusals other pages meet are read in knownApiErrors.
    expect(refusals.length).toBeGreaterThanOrEqual(8);
    for (const entry of refusals) {
      for (const needle of entry.needles) expect(backend.some((message) => message.includes(needle)), needle).toBe(true);
      expect(entry.th).toMatch(/[฀-๿]/);
      expect(entry.en).not.toMatch(/[฀-๿]/);
    }
  });

  it("reads the refusals other pages meet through knownApiErrors, before its own table", () => {
    expect(orderPage).toContain(
      'import { menuRefusal, orderItemStatusRefusal, stockRefusalOf, type MenuRefusal, type OrderItemStatusRefusal, type StockRefusal } from "@/src/lib/knownApiErrors";',
    );
    expect(orderPage).toMatch(
      /function orderFailureText\([^)]*\): string \{\s*const stock = stockRefusalOf\(error\);\s*if \(stock\) return STOCK_REFUSALS\[stock\.kind\]\[language\];\s*const itemStatus = orderItemStatusRefusal\(error\);\s*if \(itemStatus\) return ITEM_STATUS_REFUSALS\[itemStatus\]\[language\];\s*const menu = menuRefusal\(error\);\s*if \(menu\) return MENU_REFUSALS\[menu\]\[language\];\s*const refusal = refusalOf\(error\);/,
    );
    expect(Object.keys(stockCopy)).toEqual(["sold_out", "only_left"]);
    expect(Object.keys(itemStatusCopy)).toEqual(["order_closed", "item_changed"]);
    expect(Object.keys(menuCopy)).toEqual(["menu_gone", "menu_unavailable", "options_changed"]);
    for (const copy of [...Object.values(stockCopy), ...Object.values(itemStatusCopy), ...Object.values(menuCopy)]) {
      expect(copy.th).toMatch(/[฀-๿]/);
      expect(copy.en).not.toMatch(/[฀-๿]/);
    }
  });

  it("its own table matches no wording knownApiErrors already reads, so each is matched in one place", () => {
    const shared = backendErrorFormats()
      .map(sentMessage)
      .filter((message) => {
        const error = failure(400, message);
        return Boolean(stockRefusalOf(error) || orderItemStatusRefusal(error) || menuRefusal(error) || customerOrderRefusal(error));
      });
    for (const message of [
      "cannot add item to a closed order",
      "cannot update item status on closed order",
      "cannot send a closed order to kitchen",
      "invalid item status transition from ข้าวผัด to ข้าวผัด",
      "menu item not found",
      "menu item is unavailable",
      "too many selected options",
      "กรุณาเลือก ข้าวผัด อย่างน้อย 2 ตัวเลือก",
      "ข้าวผัด is sold out",
    ]) {
      expect(shared, message).toContain(message);
    }
    for (const message of shared) expect(firstRefusal(refusals, message)?.th, message).toBeUndefined();
  });

  it("each refusal gets the page's answer for it, the shared readers first", () => {
    const th = (message: string) => answer(message)?.th;
    // Every OrderService refusal that names a closed order, wherever the words
    // fall: "cannot send a closed order to kitchen" does not end in them.
    const closedRefusals = backendErrorStrings().filter((message) => message.startsWith("cannot") && message.includes("closed order"));
    expect(closedRefusals).toContain("cannot send a closed order to kitchen");
    for (const closed of closedRefusals) {
      expect(th(closed), closed).toBe("ออเดอร์นี้ปิดไปแล้ว");
    }
    expect(th("cannot add item to a closed order")).toBe("ออเดอร์นี้ปิดไปแล้ว");
    expect(answer("cannot update item status on closed order")?.en).toBe("This order is already closed.");
    expect(th("invalid item status transition from served to cooking")).toBe("รายการนี้เปลี่ยนสถานะไปแล้ว");
    expect(th("front-of-house void requires every item to be sent: order item status transition is forbidden")).toBe(
      "ส่งรายการที่รอเข้าครัวก่อน แล้วค่อยยกเลิก",
    );
    expect(th("only pending items can be edited")).toBe("รายการนี้ส่งเข้าครัวแล้ว");
    expect(th("menu item not found")).toBe("ไม่พบเมนูนี้แล้ว");
    expect(th("menu item is unavailable")).toBe("เมนูนี้ปิดขายอยู่");
    expect(th("menu recipe contains an unavailable ingredient")).toBe("วัตถุดิบของเมนูนี้หมด");
    for (const options of ["too many selected options", "กรุณาเลือก ความเผ็ด อย่างน้อย 1 ตัวเลือก", "ท็อปปิ้ง เลือกได้สูงสุด 2 ตัวเลือก", "ตัวเลือกนี้ไม่พร้อมใช้งานสำหรับเมนูนี้"]) {
      expect(th(options), options).toBe("ตัวเลือกไม่ตรงกับเมนูแล้ว เลือกใหม่อีกครั้ง");
    }
    expect(th("only 2 left for Pad Thai")).toBe("เมนูนี้เหลือไม่พอ");
    // The refusal an order with every line voided also gets; confirmPayment
    // reads the bill first and answers that case itself (below).
    expect(th("order must be completed by the kitchen before payment")).toBe("ครัวยังทำรายการไม่ครบ");
    expect(th("all active order items must be completed by the kitchen before payment")).toBe("ครัวยังทำรายการไม่ครบ");
    expect(th("received amount is less than grand total")).toBe("ยอดสุทธิเปลี่ยนแล้ว ตรวจยอดอีกครั้ง");
    expect(answer("received amount is less than grand total")?.en).toBe("The total has changed. Check it again.");
    // validateEmptyTableClose: a status check, then an items check. Each says its own thing.
    expect(th("only an open table can be closed without an order")).toBe("ออเดอร์นี้เปลี่ยนไปแล้ว");
    expect(answer("only an open table can be closed without an order")?.en).toBe("This order has changed.");
    expect(th("table order already has items")).toBe("ออเดอร์นี้มีรายการแล้ว");
    expect(th("internal server error")).toBeUndefined();
    expect(th("resource not found")).toBeUndefined();
  });

  it("offers no payment on a bill with no line left to charge", () => {
    expect(orderPage).toContain("disabled={submitting || !canPay || billUndelivered > 0 || billGroups.length === 0} onClick={confirmPayment}");
    expect(orderPage).toContain('const billGroups = groupOrderItems(bill.items.filter((it) => it.status !== "cancelled"));');
  });

  /** STALE_BILL_REFUSALS as the page declares it. */
  const staleNeedles = () => {
    const start = orderPage.indexOf("const STALE_BILL_REFUSALS");
    return [...orderPage.slice(start, orderPage.indexOf("] as const;", start)).matchAll(/"([^"]+)"/g)].map(([, needle]) => needle);
  };

  it("a refused payment on a bill that is behind reads the bill again before saying why, instead of asking staff to reopen it", async () => {
    const failure = catchOf(between(orderPage, "const confirmPayment = async", "const orderItemCount"));
    expect(failure).toMatch(
      /const stale = billIsStale\(error\);\s*const fresh = stale \? await reloadBill\(\) : null;\s*if \(fresh && !billHasCharge\(fresh\)\) showToast\(\{ tone: "error", title: copy\.nothingToCharge \}\);\s*else if \(!stale \|\| fresh\) showActionFailure\(error, copy\.paymentError\);\s*actionInFlightRef\.current = false;\s*setSubmitting\(false\);/,
    );
    // Run the branch: one toast whichever way it goes, never the reload's
    // failure and then a refusal about a bill that is not on screen.
    const branch = failure.slice(failure.indexOf("const stale = "), failure.indexOf("actionInFlightRef.current = false;"));
    const said = async (refusal: string, reloaded: { items: { status: string }[] } | null) => {
      const toasts: string[] = [];
      const run = new Function(
        "error", "billIsStale", "reloadBill", "billHasCharge", "showToast", "showActionFailure", "copy",
        `return (async () => { ${branch} })();`,
      );
      await run(
        refusal,
        (error: string) => staleNeedles().some((needle) => error.includes(needle)),
        async () => {
          if (!reloaded) toasts.push("billReloadError");
          return reloaded;
        },
        (bill: { items: { status: string }[] }) => bill.items.some((item) => item.status !== "cancelled"),
        (toast: { title: string }) => toasts.push(toast.title),
        (_error: unknown, title: string) => toasts.push(title),
        { nothingToCharge: "nothingToCharge", paymentError: "paymentError" },
      );
      return toasts;
    };
    const kitchen = "order must be completed by the kitchen before payment";
    expect(await said(kitchen, { items: [{ status: "cancelled" }] })).toEqual(["nothingToCharge"]);
    expect(await said(kitchen, { items: [{ status: "served" }] })).toEqual(["paymentError"]);
    expect(await said(kitchen, null)).toEqual(["billReloadError"]);
    expect(await said("payment method is invalid", null)).toEqual(["paymentError"]);
    // reloadBill hands back the bill it put on screen, and nothing when the read failed.
    expect(between(orderPage, "const reloadBill = async", "const addServedItem = async")).toMatch(
      /const reloadBill = async \(\): Promise<Bill \| null> => \{\s*if \(!order\) return null;[\s\S]*?setBill\(res\.data\);[\s\S]*?return res\.data;\s*\} catch \(error\) \{\s*showActionFailure\(error, copy\.billReloadError\);\s*return null;\s*\}/,
    );
    const needles = staleNeedles();
    expect(needles).toEqual(["less than grand total", "completed by the kitchen"]);
    const backend = backendErrorStrings();
    for (const needle of needles) expect(backend.some((message) => message.includes(needle)), needle).toBe(true);
    expect(orderPage).toMatch(/const billIsStale = \(error: unknown\) => \{\s*const refusal = refusalOf\(error\);\s*return STALE_BILL_REFUSALS\.some\(\(needle\) => refusal\.includes\(needle\)\);/);
    expect(orderPage).not.toMatch(/เปิดบิลใหม่|Open the bill again/);
  });

  it("a payment refused after every line was voided on another screen says there is nothing to charge", () => {
    // PayOrder settles the order's status from its lines before it validates,
    // and with no line left that is "open", so the refusal staff get is the
    // kitchen one - never validateOrderReadyForPayment's last line.
    const payOrder = between(backendService("order_service.go"), "func (s *OrderService) PayOrder(", "\n}");
    expect(payOrder.indexOf("refreshOrderStatusFromItems(tx, order, userID)")).toBeGreaterThan(0);
    expect(payOrder.indexOf("refreshOrderStatusFromItems(tx, order, userID)")).toBeLessThan(payOrder.indexOf("validateOrderReadyForPayment(order)"));
    expect(between(backendService("order_flow_helpers.go"), "func orderStatusFromItems(", "\n}")).toMatch(/if len\(active\) == 0 \{[^}]*return entity\.OrderStatusOpen\s*\}/);
    expect(between(backendService("order_service.go"), "func validateOrderReadyForPayment(", "\n}")).toMatch(
      /status := effectiveOrderStatus\(order\)\s*if status != entity\.OrderStatusReady && status != entity\.OrderStatusServed \{\s*return errors\.New\("order must be completed by the kitchen before payment"\)/,
    );

    // That refusal marks the bill stale, the bill is read again, and a bill
    // with nothing left on it answers for itself.
    const refusal = "order must be completed by the kitchen before payment";
    expect(staleNeedles().some((needle) => refusal.includes(needle))).toBe(true);
    expect(orderPage).toContain('const billHasCharge = (bill: Bill) => bill.items.some((item) => item.status !== "cancelled");');
    expect(orderPage).toContain('nothingToCharge: "บิลนี้ไม่มีรายการให้เก็บเงิน",');
    expect(orderPage).toContain('nothingToCharge: "There is nothing on this bill to charge.",');
    // The wording the server never sends for it is matched nowhere on the page.
    expect(orderPage).not.toContain("completed kitchen item");
    expect(answer("order must include a completed kitchen item before payment")).toBeUndefined();
  });

  it("the payment, void and close-table steps fall back to their own line, not the generic one", () => {
    for (const line of [
      'paymentError: "รับเงินไม่สำเร็จ"',
      'paymentError: "Could not take payment."',
      'voidError: "ยกเลิกรายการไม่สำเร็จ"',
      'voidError: "Could not void the item."',
      'closeTableError: "ปิดโต๊ะไม่สำเร็จ"',
      'closeTableError: "Could not close the table."',
      'closeTakeawayError: "ยกเลิกออเดอร์ไม่สำเร็จ"',
      'closeTakeawayError: "Could not discard the order."',
    ]) {
      expect(orderPage).toContain(line);
    }
  });

  it("a group's '-' takes the unit off its newest pending line, never the oldest", () => {
    // A group can hold a happy-hour line and a later full-price one; taking
    // from the oldest removed the discounted unit and the bill went up.
    expect(orderPage).not.toContain("pendingItems[0]");
    const pending = between(orderPage, "const adjustPendingGroup = async", "const renderOrderItemGroup");
    expect(pending).toMatch(/const item = newestPendingItem\(group\);\s*if \(!order \|\| !item\) return;/);
    const bill = between(orderPage, "const adjustBillPendingGroup = async", "const addServedUnit = async");
    expect(bill).toContain("const item = newestPendingItem(group) ?? group.firstItem;");
    expect(bill).toMatch(/if \(delta < 0 && item\.quantity === 1\) \{\s*await deleteOrderItem\(order\.ID, item\.ID\);/);
  });
});

describe("stock wording", () => {
  const orderPage = read("src/app/(dashboard)/r/[slug]/pos/orders/[orderNumber]/page.tsx");

  it("stockRefusalOf reads ensureMenuCapacity's refusal off a failed request", () => {
    expect(stockRefusalOf(failure(400, "only 2 left for Pad Thai"))).toEqual({ kind: "only_left", menu: "Pad Thai", left: 2 });
    expect(stockRefusalOf(failure(400, "ข้าวผัด กุ้ง is sold out"))).toEqual({ kind: "sold_out", menu: "ข้าวผัด กุ้ง" });
    expect(stockRefusalOf(failure(400, "cannot add item to a closed order"))).toBeNull();
    expect(stockRefusalOf(new Error("only 2 left for Pad Thai"))).toBeNull();
  });

  it("the POS order page reads it through knownApiErrors, before its own table and in its capacity toast", () => {
    expect(orderPage).toMatch(/import \{[^}]*\bstockRefusalOf\b[^}]*\btype StockRefusal\b[^}]*\} from "@\/src\/lib\/knownApiErrors";/);
    expect(orderPage).toMatch(
      /function orderFailureText\([^)]*\): string \{\s*const stock = stockRefusalOf\(error\);\s*if \(stock\) return STOCK_REFUSALS\[stock\.kind\]\[language\];/,
    );
    expect(orderPage).toContain('sold_out: { th: "เมนูนี้หมดแล้ว", en: "This menu item is sold out." },');
    expect(orderPage).toContain('only_left: { th: "เมนูนี้เหลือไม่พอ", en: "Not enough of this menu item is left." },');
    const notify = between(orderPage, "const notifyCapacityError = ", "const showActionFailure = ");
    expect(notify).toMatch(/const stock = stockRefusalOf\(error\);\s*if \(!stock\) return false;/);
    expect(notify).toContain('title: stock.kind === "only_left" ? copy.leftToast(stock.left, menuName) : copy.soldOutToast(menuName),');
    expect(firstRefusal(refusalTable(orderPage, "ORDER_REFUSALS"), "only 2 left for Pad Thai")).toBeUndefined();
    expect(firstRefusal(refusalTable(orderPage, "ORDER_REFUSALS"), "Pad Thai is sold out")).toBeUndefined();
  });

  /**
   * A source without its comments. A string is stepped over whole, so a "//"
   * inside one ("https://...") is not taken for the start of a comment.
   */
  const withoutComments = (source: string) =>
    source.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (token) =>
      token.startsWith("/") ? "" : token,
    );

  // ensureMenuCapacity's wording as a string or a regex would spell it. "for"
  // is optional: a matcher that stops at "left" (the POS page once read the
  // count with /only\s+(\d+)\s+left/i) recognises the same refusal.
  const WORDING = String.raw`(?:sold(?: |\\s)[+*]?out|(?: |\\s)[+*]?left(?:(?: |\\s)[+*]?for)?(?=\\s|[ /"'\x60$)]))`;
  const STRING_WITH_WORDING = String.raw`["'\x60][^"'\x60\n]*${WORDING}`;
  const REGEX_WITH_WORDING = String.raw`\/(?:[^/\\\n]|\\.)*${WORDING}(?:[^/\\\n]|\\.)*\/[a-z]*`;
  const MATCHING_ON_WORDING = [
    new RegExp(String.raw`\.(?:includes|startsWith|endsWith|indexOf)\(\s*${STRING_WITH_WORDING}`, "i"),
    new RegExp(String.raw`\bneedles\s*:\s*\[[^\]]*?${STRING_WITH_WORDING}`, "i"),
    new RegExp(String.raw`${REGEX_WITH_WORDING}\s*\.(?:test|exec)\(`, "i"),
    new RegExp(String.raw`\.match(?:All)?\(\s*${REGEX_WITH_WORDING}`, "i"),
  ];
  const NAMED_REGEX_WITH_WORDING = new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*${REGEX_WITH_WORDING}`, "gi");

  /**
   * Whether a source recognises a refusal by the stock wording: the wording as
   * an includes()/needles argument, or in a regex used with .test/.exec/.match.
   * Where it is only shown or explained (a toast, a comment) it does not count.
   */
  const matchesStockWording = (source: string) => {
    const code = withoutComments(source);
    if (MATCHING_ON_WORDING.some((pattern) => pattern.test(code))) return true;
    return [...code.matchAll(NAMED_REGEX_WITH_WORDING)].some(([, name]) =>
      new RegExp(String.raw`\b${name}\s*\.(?:test|exec)\(|\.match(?:All)?\(\s*${name}\b`).test(code),
    );
  };

  it("the guard flags the wording where a source matches on it, never where it is shown or explained", () => {
    for (const snippet of [
      'if (refusal.includes("sold out")) return;',
      'const ROWS = [{ needles: ["closed order", "sold out"], th: "หมด", en: "Gone" }];',
      "const soldOut = /^(.+) is sold out$/.exec(text);",
      "const left = message.match(/^only (\\d+) left for (.+)$/);",
      "const m = raw.match(/only\\s+(\\d+)\\s+left/i);",
      'if (message.includes(" left")) return;',
      "const SOLD_OUT = /sold\\s+out/i;\nif (SOLD_OUT.test(message)) return;",
      'const url = "https://example.test"; if (text.endsWith(" is sold out")) return;',
    ]) {
      expect(matchesStockWording(snippet), snippet).toBe(true);
    }
    for (const snippet of [
      "{/* sold out badge */}",
      "// the dish is sold out\nconst ready = true;",
      "/* only 2 left for Pad Thai */",
      "soldOutToast: (name: string) => `${name} is sold out`,",
      "leftToast: (n: number, name: string) => `Only ${n} left for ${name}`,",
      'if (label.includes(" leftover")) return;',
      'sold_out: { th: "เมนูนี้หมดแล้ว", en: "This menu item is sold out." },',
      'const hint = "sold out"; // said, not matched',
    ]) {
      expect(matchesStockWording(snippet), snippet).toBe(false);
    }
  });

  it("knownApiErrors.ts is the one place the stock wording is matched, as its header says", () => {
    const header = read("src/lib/knownApiErrors.ts");
    expect(header).toMatch(/stock wording from\s*\/\/ ensureMenuCapacity above all/);
    const sources = (dir: string): string[] =>
      readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
      });
    const offenders = sources("src")
      .filter((path) => path !== "src/lib/knownApiErrors.ts")
      .filter((path) => matchesStockWording(read(path)));
    expect(offenders).toEqual([]);
    expect(matchesStockWording(read("src/lib/knownApiErrors.ts"))).toBe(true);
  });
});
