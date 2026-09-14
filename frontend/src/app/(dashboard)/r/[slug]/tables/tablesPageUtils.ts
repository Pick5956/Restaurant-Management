import type { RestaurantTableInput, TableStatus, TableTagInput, TableZoneInput } from "@/src/types/table";

export const emptyTableForm: RestaurantTableInput = { zone_id: null, capacity: 2, status: "free", tag_ids: [] };
export const emptyZoneForm: TableZoneInput = { name: "", prefix: "", display_order: 0, is_active: true };
export const emptyTagForm: TableTagInput = { name: "", color: "gray", display_order: 0, is_active: true };

export function statusMeta(language: "th" | "en") {
  return {
    free: { label: language === "th" ? "ว่าง" : "Free", cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-200" },
    occupied: { label: language === "th" ? "ใช้งาน" : "Occupied", cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200" },
    reserved: { label: language === "th" ? "จอง" : "Reserved", cls: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-900/20 dark:text-sky-200" },
    inactive: { label: language === "th" ? "ปิดใช้งาน" : "Inactive", cls: "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300" },
  } satisfies Record<TableStatus, { label: string; cls: string }>;
}

export const tagBadgeClass = "border-2 border-gray-950 bg-white text-gray-950 shadow-none dark:border-white dark:bg-gray-950 dark:text-white";

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

export function safeQrFileName(label: string) {
  const safeLabel = label.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "table";
  return `qr-${safeLabel}.png`;
}
