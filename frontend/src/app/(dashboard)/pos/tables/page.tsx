"use client";

import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, MapPin, ReceiptText, Search, ShoppingBag, Users } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { can } from "@/src/lib/rbac";
import { createOrder, listOrders } from "@/src/lib/order";
import { orderPosHref } from "@/src/lib/orderNavigation";
import { createPosTableNavigationGuard } from "@/src/lib/posTableNavigation";
import { listTables } from "@/src/lib/table";
import { reserveTable as reserveTableApi, cancelReservation as cancelReservationApi } from "@/src/lib/reservation";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import type { Order } from "@/src/types/order";
import type { RestaurantTable, TableStatus } from "@/src/types/table";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { Skeleton } from "@/src/components/shared/Skeleton";
import OperationalPageShell from "@/src/components/shared/OperationalPageShell";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import RealtimeConnectionNotice from "@/src/components/shared/RealtimeConnectionNotice";
import ReservationHistoryModal from "@/src/components/tables/ReservationHistoryModal";
import { useOrderEvents } from "@/src/hooks/useOrderEvents";
import { useVisiblePolling } from "@/src/hooks/useVisiblePolling";

const activeOrderStatuses = ["open", "sent_to_kitchen", "cooking", "ready", "served"];
const tableRefreshIntervalMs = 60_000;
const tagBadgeClass = "border-2 border-gray-950 bg-white text-gray-950 shadow-none dark:border-white dark:bg-gray-900 dark:text-white";
type TableSheetMode = "open" | "reserved";

// Thai numbers are 9 digits (landline) or 10 (mobile): keep digits only and cap at 10.
const PHONE_MAX_DIGITS = 10;
const normalizePhone = (value: string) => value.replace(/\D/g, "").slice(0, PHONE_MAX_DIGITS);
const hasValidPhone = (value: string) => value.replace(/\D/g, "").length >= 9;

function tableAccentClass(status: TableStatus) {
  if (status === "inactive") return "bg-gray-400";
  if (status === "occupied") return "bg-amber-500";
  if (status === "reserved") return "bg-sky-500";
  return "bg-emerald-500";
}

function tableStatusPillClass(status: TableStatus) {
  if (status === "inactive") return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  if (status === "occupied") return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300";
  if (status === "reserved") return "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300";
  return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300";
}

export default function PosTablesPage() {
  const router = useRouter();
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const canTake = can(activeMembership, "take_order");
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [takeawayOpen, setTakeawayOpen] = useState(false);
  const [reservationsOpen, setReservationsOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<TableSheetMode>("open");
  const [sheetClosing, setSheetClosing] = useState(false);
  const [customerCount, setCustomerCount] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [reservationName, setReservationName] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationDraftOpen, setReservationDraftOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationPending, startNavigationTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");
  const refreshInFlight = useRef(false);
  const navigationGuardRef = useRef(createPosTableNavigationGuard());
  const navigationTransitionSeenRef = useRef(false);

  const copy = language === "th"
    ? {
        denied: "ไม่มีสิทธิ์รับออเดอร์",
        eyebrow: "รับออเดอร์",
        title: "เลือกโต๊ะ",
        subtitle: "แตะโต๊ะว่างเพื่อเปิดออเดอร์ หรือแตะโต๊ะที่ใช้งานเพื่อทำรายการต่อ",
        search: "ค้นหาโต๊ะ",
        table: "โต๊ะ",
        takeaway: "สั่งกลับบ้าน",
        openTakeaway: "เปิดออเดอร์กลับบ้าน",
        takeawayHelp: "ใช้สำหรับลูกค้าที่ไม่ได้นั่งโต๊ะ",
        reservationHistory: "ประวัติการจอง",
        customerName: "ชื่อลูกค้า (ไม่บังคับ)",
        customerNamePlaceholder: "เช่น คุณแนน",
        customerPhone: "เบอร์ลูกค้า (ไม่บังคับ)",
        customerPhonePlaceholder: "เช่น 081-234-5678",
        confirmTakeaway: "เปิดออเดอร์",
        noSearchResults: "ไม่พบโต๊ะที่ตรงกับคำค้นหา",
        openOrder: "เปิดออเดอร์",
        reserveTable: "จองไว้",
        confirmReservation: "ยืนยันจอง",
        reservationName: "ชื่อเล่นที่จอง",
        reservationNameOptional: "ชื่อเล่นที่จอง (ไม่บังคับ)",
        reservationNamePlaceholder: "เช่น คุณแนน",
        reservationPhone: "เบอร์ที่จอง",
        reservationPhonePlaceholder: "เช่น 0812345678",
        reservationPhoneRequired: "กรุณาใส่เบอร์ลูกค้าที่จองอย่างน้อย 9 หลัก",
        reservationInfo: "เบอร์จอง",
        acceptReservation: "รับลูกค้าเข้าโต๊ะ",
        cancelReservation: "ยกเลิกจอง",
        reservationCancelled: "ยกเลิกการจองแล้ว",
        customerCount: "จำนวนลูกค้า",
        note: "หมายเหตุ",
        cancel: "ยกเลิก",
        confirm: "เปิดโต๊ะ",
        free: "ว่าง",
        occupied: "ใช้งาน",
        reserved: "จอง",
        inactive: "ปิดใช้งาน",
        openingTable: "กำลังเปิดโต๊ะ",
        openingTakeaway: "กำลังเปิดออเดอร์กลับบ้าน",
        noZone: "ไม่มีโซน",
        total: "ยอดรวม",
        seats: "ที่นั่ง",
        customers: "คน",
        elapsed: "นาที",
        loadError: "โหลดผังโต๊ะไม่สำเร็จ",
        saveError: "เปิดออเดอร์ไม่สำเร็จ",
        reservedNotice: "โต๊ะนี้ถูกจองไว้ ยังเปิดออเดอร์จากหน้านี้ไม่ได้",
        inactiveNotice: "โต๊ะนี้ปิดใช้งานอยู่ เปิดออเดอร์ไม่ได้",
        reservedSuccess: "จองโต๊ะไว้แล้ว",
      }
    : {
        denied: "You do not have permission to take orders.",
        eyebrow: "Order taking",
        title: "Select table",
        subtitle: "Tap a free table to open an order, or continue an active table.",
        search: "Search tables",
        table: "Table",
        takeaway: "Takeaway",
        openTakeaway: "Open takeaway order",
        takeawayHelp: "Use this for customers who are not seated at a table.",
        reservationHistory: "Reservation history",
        customerName: "Customer name (optional)",
        customerNamePlaceholder: "For example, Nan",
        customerPhone: "Customer phone (optional)",
        customerPhonePlaceholder: "For example, 081-234-5678",
        confirmTakeaway: "Open order",
        noSearchResults: "No tables match your search.",
        openOrder: "Open order",
        reserveTable: "Reserve",
        confirmReservation: "Confirm",
        reservationName: "Reservation nickname",
        reservationNameOptional: "Reservation nickname (optional)",
        reservationNamePlaceholder: "For example, Nan",
        reservationPhone: "Reservation phone",
        reservationPhonePlaceholder: "For example, 0812345678",
        reservationPhoneRequired: "Enter the customer's phone number with at least 9 digits.",
        reservationInfo: "Reserved phone",
        acceptReservation: "Seat guests",
        cancelReservation: "Cancel reservation",
        reservationCancelled: "Reservation cancelled.",
        customerCount: "Customers",
        note: "Note",
        cancel: "Cancel",
        confirm: "Open table",
        free: "Free",
        occupied: "Active order",
        reserved: "Reserved",
        inactive: "Inactive",
        openingTable: "Opening table",
        openingTakeaway: "Opening takeaway order",
        noZone: "No zone",
        total: "Total",
        seats: "seats",
        customers: "guests",
        elapsed: "min",
        loadError: "Could not load table layout.",
        saveError: "Could not open order.",
        reservedNotice: "This table is reserved and cannot start an order yet.",
        inactiveNotice: "This table is inactive and cannot open orders.",
        reservedSuccess: "Table reserved.",
      };

  const inactiveNoticeLabel = copy.inactiveNotice;

  useEffect(() => {
    if (navigationPending) {
      navigationTransitionSeenRef.current = true;
      return;
    }
    if (!navigationTransitionSeenRef.current || !isNavigating) return;

    const resetTimer = window.setTimeout(() => {
      navigationTransitionSeenRef.current = false;
      navigationGuardRef.current.reset();
      setIsNavigating(false);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [isNavigating, navigationPending]);

  const navigateToOrder = useCallback((order: Order) => {
    if (!navigationGuardRef.current.tryStart(order.ID)) return;

    setIsNavigating(true);
    setError("");
    startNavigationTransition(() => router.push(orderPosHref(order)));
  }, [router, startNavigationTransition]);


  const activeOrderByTable = useMemo(() => {
    const map = new Map<number, Order>();
    orders
      .filter((order) => activeOrderStatuses.includes(order.status) && order.table_id)
      .forEach((order) => map.set(order.table_id as number, order));
    return map;
  }, [orders]);

  const groupedTables = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const groups = new Map<string, { label: string; tables: RestaurantTable[] }>();
    tables.filter((table) => {
      const key = table.zone_id ? String(table.zone_id) : "none";
      if (zoneFilter !== "all" && key !== zoneFilter) return false;
      if (!keyword) return true;
      return [
        table.table_number,
        table.display_label,
        table.table_zone?.name,
        table.zone,
        ...(table.tags?.map((tag) => tag.name) ?? []),
      ].some((value) => String(value ?? "").toLowerCase().includes(keyword));
    }).forEach((table) => {
      const key = table.zone_id ? String(table.zone_id) : "none";
      if (!groups.has(key)) groups.set(key, { label: table.table_zone?.name || table.zone || copy.noZone, tables: [] });
      groups.get(key)?.tables.push(table);
    });
    return Array.from(groups.values());
  }, [copy.noZone, search, tables, zoneFilter]);

  // When the restaurant has no zones at all, drop the zone chrome entirely so the
  // floor reads as a plain, sequential list instead of a single "No zone" bucket.
  const hasAnyZone = useMemo(() => tables.some((table) => table.zone_id), [tables]);

  const zoneOptions = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    tables.forEach((table) => {
      const key = table.zone_id ? String(table.zone_id) : "none";
      const label = table.table_zone?.name || table.zone || copy.noZone;
      const entry = counts.get(key) ?? { key, label, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    });
    return Array.from(counts.values());
  }, [copy.noZone, tables]);

  /** How many of a zone's tables are open for a walk-in right now. */
  const freeIn = (list: RestaurantTable[]) =>
    list.filter((table) => !activeOrderByTable.has(table.ID) && table.status === "free").length;

  const allZonesLabel = language === "th" ? "ทุกโซน" : "All zones";
  const zoneSelectOptions = useMemo(
    () => [
      { value: "all", label: `${allZonesLabel} (${tables.length})` },
      ...zoneOptions.map((zone) => ({ value: zone.key, label: `${zone.label} (${zone.count})` })),
    ],
    [allZonesLabel, tables.length, zoneOptions],
  );
  const zoneCountLabel = (free: number, total: number) =>
    language === "th" ? `ว่าง ${free} จาก ${total} โต๊ะ` : `${free} of ${total} free`;

  const load = useCallback(async (showLoading = true) => {
    if (!canTake) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [tableRes, orderRes] = await Promise.all([listTables(), listOrders({ status: "active" })]);
      setTables(tableRes.data.tables);
      setOrders(orderRes.data.orders);
    } catch {
      setError(copy.loadError);
    } finally {
      if (showLoading) setLoading(false);
      refreshInFlight.current = false;
    }
  }, [canTake, copy.loadError]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [load]);
  const realtimeStatus = useOrderEvents(() => load(false), {
    enabled: canTake,
    restaurantId: activeMembership?.restaurant_id,
  });
  useVisiblePolling(() => load(false), {
    enabled: canTake,
    intervalMs: tableRefreshIntervalMs,
    runImmediately: false,
  });

  const openTakeawaySheet = () => {
    if (isNavigating) return;
    setSheetError("");
    setSelectedTable(null);
    setTakeawayOpen(true);
    setSheetMode("open");
    setSheetClosing(false);
    setCustomerCount(1);
    setCustomerName("");
    setCustomerPhone("");
    setNote("");
    setReservationName("");
    setReservationPhone("");
    setReservationDraftOpen(false);
  };

  const openOrder = async () => {
    if (isNavigating || (!selectedTable && !takeawayOpen)) return;
    // Capture at call time to prevent race if sheet state changes mid-flight
    const capturedTable = selectedTable;
    const tableID = capturedTable?.ID;
    if (!takeawayOpen && !tableID) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await createOrder(takeawayOpen
        ? {
            order_type: "takeaway",
            customer_count: customerCount,
            customer_name: customerName.trim(),
            customer_phone: customerPhone.trim(),
            note,
          }
        : {
            table_id: tableID,
            order_type: "dine_in",
            customer_count: customerCount,
            note,
          });
      navigateToOrder(res.data);
    } catch (error) {
      const message = apiErrorMessage(error);
      if (capturedTable && tableID && message.includes("table already has an open order")) {
        // Fetch with table_id filter to get the precise active order for this table
        const orderRes = await listOrders({ status: "active", table_id: tableID });
        const activeOrder = orderRes.data.orders.find(
          (order) => order.table_id === tableID && activeOrderStatuses.includes(order.status)
        );
        if (activeOrder) {
          navigateToOrder(activeOrder);
          return;
        }
      }
      setError(message || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTableClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (isNavigating) return;
    const tableId = Number(event.currentTarget.dataset.tableId);
    const table = tables.find((item) => item.ID === tableId);
    if (!table) return;
    setSheetError("");
    const activeOrder = activeOrderByTable.get(table.ID);
    if (activeOrder) {
      navigateToOrder(activeOrder);
      return;
    }
    if (table.status === "reserved") {
      setSelectedTable(table);
      setTakeawayOpen(false);
      setSheetMode("reserved");
      setSheetClosing(false);
      setReservationName(table.reservation_name ?? "");
      setReservationPhone(normalizePhone(table.reservation_phone ?? ""));
      setCustomerCount(Math.max(1, Math.min(table.capacity || 1, 6)));
      setCustomerName("");
      setCustomerPhone("");
      setNote("");
      setReservationDraftOpen(false);
      return;
    }
    if (table.status === "inactive") {
      showToast({ title: inactiveNoticeLabel, tone: "warning" });
      return;
    }
    setSelectedTable(table);
    setTakeawayOpen(false);
    setSheetMode("open");
    setSheetClosing(false);
    setCustomerCount(Math.max(1, Math.min(table.capacity || 1, 6)));
    setCustomerName("");
    setCustomerPhone("");
    setNote("");
    setReservationName("");
    setReservationPhone("");
    setReservationDraftOpen(false);
  }, [activeOrderByTable, inactiveNoticeLabel, isNavigating, navigateToOrder, showToast, tables]);

  const closeOpenOrderSheet = () => {
    if (submitting || isNavigating || sheetClosing) return;
    setSheetClosing(true);
    window.setTimeout(() => {
      setSelectedTable(null);
      setTakeawayOpen(false);
      setSheetMode("open");
      setSheetClosing(false);
      setCustomerName("");
      setCustomerPhone("");
      setReservationName("");
      setReservationPhone("");
      setSheetError("");
      setReservationDraftOpen(false);
    }, 180);
  };
  const openOrderBackdrop = useBackdropClose(closeOpenOrderSheet);

  const reserveTable = async () => {
    if (!selectedTable || submitting || isNavigating) return;
    if (!reservationDraftOpen) {
      setReservationDraftOpen(true);
      setSheetError("");
      return;
    }
    if (!hasValidPhone(reservationPhone)) {
      setSheetError(copy.reservationPhoneRequired);
      return;
    }
    setSubmitting(true);
    setError("");
    setSheetError("");
    try {
      const res = await reserveTableApi(selectedTable.ID, reservationPhone.trim(), reservationName.trim());
      setTables((current) => current.map((table) => table.ID === res.data.ID ? res.data : table));
      showToast({ title: copy.reservedSuccess });
      setSheetClosing(true);
      window.setTimeout(() => {
        setSelectedTable(null);
        setSheetMode("open");
        setSheetClosing(false);
        setReservationName("");
        setReservationPhone("");
        setReservationDraftOpen(false);
      }, 180);
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const acceptReservation = async () => {
    if (!selectedTable || submitting || isNavigating) return;
    const tableID = selectedTable.ID;
    const guestName = reservationName.trim();
    const guestPhone = reservationPhone.trim();
    setSubmitting(true);
    setError("");
    setSheetError("");
    try {
      const res = await createOrder({
        table_id: tableID,
        order_type: "dine_in",
        customer_count: customerCount,
        customer_name: guestName,
        customer_phone: guestPhone,
        note,
        seat_reservation: true,
      });
      navigateToOrder(res.data);
    } catch (error) {
      const message = apiErrorMessage(error);
      if (message.includes("table already has an open order")) {
        const orderRes = await listOrders({ status: "active", table_id: tableID });
        const activeOrder = orderRes.data.orders.find(
          (order) => order.table_id === tableID && activeOrderStatuses.includes(order.status)
        );
        if (activeOrder) {
          navigateToOrder(activeOrder);
          return;
        }
      }
      setSheetError(message || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelReservation = async () => {
    if (!selectedTable || submitting || isNavigating) return;
    setSubmitting(true);
    setError("");
    setSheetError("");
    try {
      const res = await cancelReservationApi(selectedTable.ID);
      setTables((current) => current.map((table) => table.ID === res.data.ID ? res.data : table));
      showToast({ title: copy.reservationCancelled });
      setSheetClosing(true);
      window.setTimeout(() => {
        setSelectedTable(null);
        setSheetMode("open");
        setSheetClosing(false);
        setReservationName("");
        setReservationPhone("");
        setSheetError("");
        setReservationDraftOpen(false);
      }, 180);
    } catch (error) {
      setSheetError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  if (!canTake) return <PermissionDenied title={copy.denied} />;

  const customerCountField = (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.customerCount}</span>
      <div className="grid grid-cols-[56px_1fr_56px] overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <button type="button" onClick={() => setCustomerCount((current) => Math.max(1, current - 1))} disabled={customerCount <= 1} className="ui-press h-14 border-r border-gray-200 text-xl font-semibold text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200">
          -
        </button>
        <input type="number" min={1} value={customerCount} onChange={(event) => setCustomerCount(Math.max(1, Number(event.target.value) || 1))} className="h-14 min-w-0 border-0 bg-transparent px-2 text-center text-[22px] font-semibold tabular-nums text-gray-900 outline-none dark:text-white" />
        <button type="button" onClick={() => setCustomerCount((current) => current + 1)} className="ui-press h-14 border-l border-gray-200 text-xl font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">
          +
        </button>
      </div>
      {/* Up and down rather than two sizes of up: overshooting is as common as
          undershooting, and getting back down meant holding the minus button. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setCustomerCount((current) => current + 5)} className="ui-press h-10 rounded-md border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-800">
          +5
        </button>
        <button type="button" onClick={() => setCustomerCount((current) => Math.max(1, current - 5))} className="ui-press h-10 rounded-md border border-gray-200 bg-white text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-800">
          −5
        </button>
      </div>
    </label>
  );

  return (
    <>
      {isNavigating ? (
        <div aria-hidden="true" className="fixed inset-0 z-[var(--z-modal)] cursor-wait bg-transparent" />
      ) : null}
      <div data-shell-sticky="" className="fixed inset-x-0 top-14 z-20 bg-slate-100/95 backdrop-blur dark:bg-gray-950/95 transition-[left] duration-300 ease-in-out lg:inset-auto">
        <h1 className="sr-only">{copy.eyebrow}</h1>
        <div className="px-4 py-2 sm:px-6 lg:px-8 lg:pb-2 lg:pt-5">
          <div className="grid w-full gap-1.5 lg:flex lg:items-center lg:gap-2">
            <label className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={isNavigating}
                placeholder={copy.search}
                className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white py-2 pl-7 pr-3 text-[15px] outline-none focus:border-orange-500 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] placeholder:text-[15px] dark:bg-gray-800"
                aria-label={copy.search}
              />
            </label>
            <div className="flex gap-2 lg:order-last lg:ml-auto">
              <button
                type="button"
                onClick={() => setReservationsOpen(true)}
                className="ui-press inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white px-3 text-[13px] font-semibold text-gray-800 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 lg:flex-none"
              >
                <CalendarClock className="h-4 w-4" />
                {copy.reservationHistory}
              </button>
              <button
                type="button"
                disabled={isNavigating}
                onClick={openTakeawaySheet}
                className="ui-press inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white px-3 text-[13px] font-semibold text-gray-800 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 lg:flex-none"
              >
                <ShoppingBag className="h-4 w-4" />
                {copy.takeaway}
              </button>
            </div>
            {hasAnyZone && (
              <div className="w-full min-w-0 sm:w-44">
                <ThemedSelect
                  value={zoneFilter}
                  onChange={setZoneFilter}
                  options={zoneSelectOptions}
                  aria-label={allZonesLabel}
 triggerClassName="rounded-xl shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="h-[104px] lg:hidden" />
      <OperationalPageShell
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
        showHeader={false}
      >

      <div className="w-full">
      <RealtimeConnectionNotice language={language} status={realtimeStatus} className="mb-4" />
      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
      {loading || isNavigating ? (
        <div
          role="status"
          aria-live="polite"
          aria-label={language === "th" ? "กำลังโหลด" : "Loading"}
          className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
        >
          {Array.from({ length: 10 }).map((_, index) => <Skeleton key={index} className="h-[118px]" />)}
        </div>
      ) : (
        <div className="space-y-5">
          {groupedTables.length ? groupedTables.map((group) => (
            <section key={group.label}>
              {hasAnyZone && (
                <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-[color:var(--dashboard-shell-border)] pb-2">
                  <h2 className="truncate text-[15px] font-bold leading-tight text-gray-950 dark:text-white">{group.label}</h2>
                  <span className="shrink-0 text-[12px] tabular-nums text-gray-500 dark:text-gray-400">{zoneCountLabel(freeIn(group.tables), group.tables.length)}</span>
                </div>
              )}
              <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {group.tables.map((table) => {
                  const order = activeOrderByTable.get(table.ID);
                  const busy = Boolean(order);
                  const status = busy ? "occupied" : table.status;
                  const shownTags = table.tags?.slice(0, 2) ?? [];
                  const extraTags = Math.max((table.tags?.length ?? 0) - shownTags.length, 0);
                  const disabled = status === "reserved" || status === "inactive";
                  const statusLabel = status === "occupied"
                    ? copy.occupied
                    : status === "reserved"
                      ? copy.reserved
                      : status === "inactive"
                        ? copy.inactive
                        : copy.free;
                  return (
                    <button
                      key={table.ID}
                      type="button"
                      data-table-id={table.ID}
                      disabled={isNavigating}
                      onClick={handleTableClick}
                      className={`ui-press group relative flex min-h-[118px] overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[transform,box-shadow,border-color] dark:border-gray-800 dark:bg-gray-800 ${disabled ? "cursor-default opacity-70" : "hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:hover:border-gray-700 dark:hover:bg-gray-800"}`}
                    >
                      <span className={`w-1.5 shrink-0 ${tableAccentClass(status)}`} />
                      <div className="flex min-w-0 flex-1 flex-col px-3 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">{copy.table}</p>
                                <p className="truncate text-[19px] font-semibold leading-none tracking-tight text-gray-950 dark:text-white">{table.display_label || table.table_number}</p>
                              </div>
                            </div>
                            <div className="mt-2 space-y-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                              {hasAnyZone && (
                                <p className="flex min-w-0 items-start gap-1.5">
                                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                  <span className="min-w-0 break-words leading-4">{table.table_zone?.name || table.zone || copy.noZone}</span>
                                </p>
                              )}
                              <p className="flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {/* Occupied tables show live guest count; free/reserved tables show seat capacity. */}
                                <span>{order ? `${order.customer_count} ${copy.customers}` : `${table.capacity} ${copy.seats}`}</span>
                              </p>
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold leading-none ${tableStatusPillClass(status)}`}>{statusLabel}</span>
                        </div>
                        <div className="mt-auto">
                          {order ? (
                            <div className="flex min-h-[22px] items-end justify-between gap-2">
                              <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[12px] font-medium tabular-nums text-gray-500 dark:text-gray-400">
                                <ReceiptText className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                                <span className="truncate">{order.order_number}</span>
                              </p>
                              <p className="shrink-0 text-[12px] font-bold tabular-nums text-gray-950 dark:text-white">฿{order.total_amount.toLocaleString()}</p>
                            </div>
                          ) : status === "reserved" && table.reservation_phone ? (
                            <p className="truncate text-[12px] font-semibold text-sky-700 dark:text-sky-200">{table.reservation_name ? `${table.reservation_name} · ` : ""}{copy.reservationInfo}: {table.reservation_phone}</p>
                          ) : (
                            <div className="flex min-h-[22px] flex-wrap items-start gap-1 overflow-hidden">
                              {shownTags.map((tag) => <span key={tag.ID} className={`rounded-[4px] px-2 py-0.5 text-[10px] font-extrabold leading-4 tracking-[0.01em] ${tagBadgeClass}`}>{tag.name}</span>)}
                              {extraTags > 0 ? <span className="rounded-[4px] border-2 border-gray-950 bg-white px-2 py-0.5 text-[10px] font-extrabold leading-4 text-gray-950 dark:border-white dark:bg-gray-900 dark:text-white">+{extraTags}</span> : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )) : (
            <div className="rounded-md border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-[13px] font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
              {copy.noSearchResults}
            </div>
          )}
        </div>
      )}

      {(selectedTable || takeawayOpen) && (
        <div {...openOrderBackdrop} className={`${sheetClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-4 backdrop-blur-sm`}>
          <div className={`${sheetClosing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                {takeawayOpen ? copy.openTakeaway : `${sheetMode === "reserved" ? copy.reserved : copy.openOrder} · ${selectedTable?.table_number ?? ""}`}
              </h2>
              {takeawayOpen && <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{copy.takeawayHelp}</p>}
            </div>
            {sheetError && <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{sheetError}</div>}
            {sheetMode === "reserved" && selectedTable ? (
              <>
                <div className="space-y-3 p-4">
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[13px] font-semibold text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100">
                    {selectedTable.reservation_name ? <span className="mb-1 block">{copy.reservationName}: {selectedTable.reservation_name}</span> : null}
                    {copy.reservationInfo}: {selectedTable.reservation_phone || "-"}
                  </div>
                  {customerCountField}
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                  <button type="button" disabled={isNavigating} onClick={closeOpenOrderSheet} className="ui-press h-10 rounded-md border border-gray-200 px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
                    {copy.cancel}
                  </button>
                  <button type="button" disabled={submitting || isNavigating} onClick={cancelReservation} className="ui-press h-10 rounded-md border border-sky-200 bg-sky-50 px-3 text-[13px] font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-950/50">
                    {copy.cancelReservation}
                  </button>
                  <button type="button" disabled={submitting || isNavigating} onClick={acceptReservation} className="ui-press col-span-2 h-10 whitespace-nowrap rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white">
                    {copy.acceptReservation}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3 p-4">
                  {takeawayOpen && (
                    <div className="grid gap-3">
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.customerName}</span>
                        <input
                          value={customerName}
                          onChange={(event) => setCustomerName(event.target.value)}
                          placeholder={copy.customerNamePlaceholder}
                          className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-[15px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 sm:h-10 sm:text-[13px]"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.customerPhone}</span>
                        <input
                          value={customerPhone}
                          onChange={(event) => setCustomerPhone(event.target.value)}
                          inputMode="tel"
                          placeholder={copy.customerPhonePlaceholder}
                          className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-[15px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 sm:h-10 sm:text-[13px]"
                        />
                      </label>
                    </div>
                  )}
                  {customerCountField}
                  <label className="block">
                    <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.note}</span>
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-24 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 sm:min-h-20 sm:text-[13px]" />
                  </label>
                  {reservationDraftOpen && (
                    <div className="motion-reservation-panel rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900/60 dark:bg-sky-950/25">
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-sky-900 dark:text-sky-100">{copy.reservationPhone}<span className="ml-0.5 text-red-600 dark:text-red-400">*</span></span>
                        <input
                          value={reservationPhone}
                          onChange={(event) => setReservationPhone(normalizePhone(event.target.value))}
                          inputMode="tel"
                          autoFocus
                          placeholder={copy.reservationPhonePlaceholder}
                          className="h-11 w-full rounded-md border border-sky-200 bg-white px-3 text-[15px] outline-none focus:border-orange-500 dark:border-sky-800 dark:bg-gray-900 sm:h-10 sm:text-[13px]"
                        />
                      </label>
                      <label className="mt-3 block">
                        <span className="mb-1.5 block text-[12px] font-medium text-sky-900 dark:text-sky-100">{copy.reservationNameOptional}</span>
                        <input
                          value={reservationName}
                          onChange={(event) => setReservationName(event.target.value)}
                          placeholder={copy.reservationNamePlaceholder}
                          className="h-11 w-full rounded-md border border-sky-200 bg-white px-3 text-[15px] outline-none focus:border-orange-500 dark:border-sky-800 dark:bg-gray-900 sm:h-10 sm:text-[13px]"
                        />
                      </label>
                    </div>
                  )}
                </div>
                <div className={`${takeawayOpen ? "grid-cols-2" : "grid-cols-3"} grid gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800`}>
                  {!takeawayOpen && (
                    <button type="button" disabled={submitting || isNavigating} onClick={reserveTable} className={`${reservationDraftOpen ? "bg-sky-700 text-white hover:bg-sky-800 dark:bg-sky-300 dark:text-sky-950 dark:hover:bg-sky-200" : "border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-950/50"} ui-press h-11 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50 sm:h-9 sm:text-[12px]`}>
                      {reservationDraftOpen ? copy.confirmReservation : copy.reserveTable}
                    </button>
                  )}
                  <button type="button" disabled={isNavigating} onClick={closeOpenOrderSheet} className="ui-press h-11 rounded-md border border-gray-200 px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 sm:h-9 sm:text-[12px]">
                    {copy.cancel}
                  </button>
                  <button type="button" disabled={submitting || isNavigating} onClick={openOrder} className="ui-press inline-flex h-11 items-center justify-center gap-2 rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-60 dark:bg-orange-700 dark:text-white sm:h-9 sm:text-[12px]">
                    {submitting ? (takeawayOpen ? copy.openingTakeaway : copy.openingTable) : takeawayOpen ? copy.confirmTakeaway : copy.confirm}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ReservationHistoryModal open={reservationsOpen} onClose={() => setReservationsOpen(false)} language={language} />
      </div>
      </OperationalPageShell>
    </>
  );
}
