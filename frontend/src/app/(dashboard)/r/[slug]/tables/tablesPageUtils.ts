import { activeOrderStatuses } from "@/src/lib/homeDashboard";
import type { Order } from "@/src/types/order";
import type { RestaurantTable, RestaurantTableInput, TableStatus, TableZoneInput } from "@/src/types/table";

type TableServiceFields = Pick<RestaurantTable, "ID" | "status">;

export const emptyTableForm: RestaurantTableInput = { zone_id: null, capacity: 2, status: "free" };
export const emptyZoneForm: TableZoneInput = { name: "", prefix: "", display_order: 0, is_active: true };

export function statusMeta(language: "th" | "en") {
  return {
    free: { label: language === "th" ? "ว่าง" : "Free", cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200" },
    occupied: { label: language === "th" ? "ใช้งาน" : "Occupied", cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200" },
    reserved: { label: language === "th" ? "จอง" : "Reserved", cls: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-900/20 dark:text-sky-200" },
    inactive: { label: language === "th" ? "ปิดใช้งาน" : "Inactive", cls: "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300" },
  } satisfies Record<TableStatus, { label: string; cls: string }>;
}

export function tableAccentClass(status: TableStatus) {
  if (status === "inactive") return "bg-gray-400";
  if (status === "occupied") return "bg-amber-500";
  if (status === "reserved") return "bg-sky-500";
  return "bg-emerald-500";
}

export function tableStatusPillClass(status: TableStatus) {
  if (status === "inactive") return "bg-gray-100 text-gray-600 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-700";
  if (status === "occupied") return "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/35 dark:text-amber-200 dark:ring-amber-900/70";
  if (status === "reserved") return "bg-sky-50 text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/35 dark:text-sky-200 dark:ring-sky-900/70";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-200 dark:ring-emerald-900/70";
}

export function tableStatusEditorState(status: TableStatus) {
  return {
    status,
    isLifecycleManaged: status === "reserved" || status === "occupied",
    isActive: status !== "inactive",
  };
}

/**
 * The status the drawer edits and saves. The form keeps the status the table
 * opened with; when a held or in-use table leaves service while its drawer is
 * open, that status is stale and the server refuses it, so the live row's
 * status (free or inactive by then) takes over until the owner flips the switch.
 */
export function drawerTableStatus(formStatus: TableStatus, liveStatus: TableStatus | undefined, locked: boolean): TableStatus {
  if (locked || !liveStatus) return formStatus;
  return tableStatusEditorState(formStatus).isLifecycleManaged ? liveStatus : formStatus;
}

/** The tables that hold an order still in service. Takeaways have no table. */
export function activeOrderTableIds(orders: ReadonlyArray<Pick<Order, "table_id" | "status">>): Set<number> {
  const ids = new Set<number>();
  for (const order of orders) {
    if (order.table_id && activeOrderStatuses.has(order.status)) ids.add(order.table_id);
  }
  return ids;
}

/**
 * The status the floor would show: an active order reads in use even when the
 * table's own column has not caught up, the same rule the POS floor and the
 * hub count by.
 */
export function tableServiceStatus(table: TableServiceFields, activeTableIds: ReadonlySet<number>): TableStatus {
  return activeTableIds.has(table.ID) ? "occupied" : table.status;
}

/**
 * A table in service cannot be changed from table management until the
 * service steps close it (the bill paid, the booking finished or cancelled).
 * A table switched off (inactive) is not in service: it must stay editable so
 * it can be switched back on.
 */
export function isTableInService(table: TableServiceFields, activeTableIds: ReadonlySet<number>): boolean {
  const status = tableServiceStatus(table, activeTableIds);
  return status === "occupied" || status === "reserved";
}

/** A zone prefix change renumbers every table in the zone, live ones included. */
export function zoneHasTableInService(
  zoneId: number,
  tables: ReadonlyArray<TableServiceFields & Pick<RestaurantTable, "zone_id">>,
  activeTableIds: ReadonlySet<number>,
): boolean {
  return tables.some((table) => table.zone_id === zoneId && isTableInService(table, activeTableIds));
}

type ErrorCopy = { th: string; en: string };

const TABLE_IN_USE: ErrorCopy = { th: "โต๊ะนี้ยังไม่ว่าง", en: "This table is in use." };
const ZONE_IN_USE: ErrorCopy = { th: "โซนนี้มีโต๊ะที่ยังไม่ว่าง", en: "A table in this zone is in use." };

/** What a refused edit on a table in service says, before or after the server answers. */
export function tableInUseText(language: "th" | "en", context: "table" | "zone" = "table"): string {
  return (context === "zone" ? ZONE_IN_USE : TABLE_IN_USE)[language];
}
const OPEN_ORDER: ErrorCopy = { th: "โต๊ะนี้มีออเดอร์เปิดอยู่", en: "This table has an open order." };
const PREFIX_TAKEN: ErrorCopy = { th: "ตัวอักษรนำหน้านี้ถูกใช้แล้ว", en: "This prefix is already used." };
const ZONE_GONE: ErrorCopy = { th: "ไม่พบโซนนี้แล้ว", en: "This zone no longer exists." };

// Matched as substrings of the server's lower-cased `error`, first hit wins.
const TABLE_ERRORS: ReadonlyArray<[needle: string, copy: ErrorCopy]> = [
  ["open order", OPEN_ORDER],
  ["active reservation", { th: "โต๊ะนี้มีการจองอยู่ ยกเลิกการจองก่อน", en: "This table has a booking. Cancel it first." }],
  ["order history", { th: "โต๊ะนี้มีประวัติออเดอร์ ใช้ปิดใช้งานแทน", en: "This table has past orders. Set it inactive instead." }],
  ["still has tables", { th: "ยังมีโต๊ะในโซนนี้", en: "This zone still has tables." }],
  ["prefix is already used", PREFIX_TAKEN],
  ["prefix must be", { th: "ตัวอักษรนำหน้ายาวเกินไป", en: "The prefix is too long." }],
  ["zone name is required", { th: "กรอกชื่อก่อนบันทึก", en: "Enter a name before saving." }],
  ["table zone not found", ZONE_GONE],
  ["count must be between", { th: "จำนวนโต๊ะต้องอยู่ระหว่าง 1-200", en: "Table count must be 1-200." }],
  ["capacity must be between", { th: "จำนวนที่นั่งต้องอยู่ระหว่าง 1-50", en: "Seats must be 1-50." }],
  ["unused table number", { th: "หาเลขโต๊ะว่างไม่ได้", en: "No free table number is left." }],
  ["manage_table permission", { th: "บัญชีนี้แก้ไขโต๊ะไม่ได้", en: "This account cannot edit tables." }],
];

// The server's lock refusal is "table is in use" (service.ErrTableInUse, 409).
const IN_USE_NEEDLES = ["in use", "in service"];
const NEEDS_RELOAD = [...IN_USE_NEEDLES, "open order", "active reservation", "resource not found", "table zone not found"];

/**
 * The server's refusal in the staff member's language. The API's own English
 * never reaches the screen: anything unrecognised becomes the action's
 * fallback line.
 */
export function tableErrorText(
  raw: string,
  language: "th" | "en",
  fallback: string,
  context: "table" | "zone" = "table",
): string {
  const message = raw.trim().toLowerCase();
  if (!message) return fallback;
  if (IN_USE_NEEDLES.some((needle) => message.includes(needle))) return tableInUseText(language, context);
  if (message === "resource already exists") {
    return context === "zone" ? PREFIX_TAKEN[language] : language === "th" ? "เลขโต๊ะซ้ำกับโต๊ะอื่น" : "The table number clashes with another table.";
  }
  if (message === "resource not found") {
    return context === "zone" ? ZONE_GONE[language] : language === "th" ? "ไม่พบโต๊ะนี้แล้ว" : "This table no longer exists.";
  }
  const known = TABLE_ERRORS.find(([needle]) => message.includes(needle));
  return known ? known[1][language] : fallback;
}

/** A refusal that means the page is showing a table as it no longer is. */
export function tableErrorNeedsReload(raw: string): boolean {
  const message = raw.trim().toLowerCase();
  return NEEDS_RELOAD.some((needle) => message.includes(needle));
}

export function safeQrFileName(label: string) {
  const safeLabel = label.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "table";
  return `qr-${safeLabel}.png`;
}
