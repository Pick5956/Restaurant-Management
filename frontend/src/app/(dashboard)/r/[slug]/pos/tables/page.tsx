"use client";

import NumberInput from "@/src/components/shared/NumberInput";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { CalendarClock, MapPin, ReceiptText, Search, ShoppingBag, Users } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { can } from "@/src/lib/rbac";
import { createOrder, listOrders } from "@/src/lib/order";
import { orderPosHref } from "@/src/lib/orderNavigation";
import { createPosTableNavigationGuard } from "@/src/lib/posTableNavigation";
import { listTables } from "@/src/lib/table";
import {
  cancelReservation as cancelReservationApi,
  findTableHold,
  listReservations,
  reservationErrorMessage,
  reserveTable as reserveTableApi,
  reserveTableInput,
  type Reservation,
} from "@/src/lib/reservation";
import {
  formatReservationClock,
  initialReservationWhen,
  reservationClock,
  reservationInstantFor,
  reservationReminder,
  reservationWhenProblem,
  type ReservationWhen,
} from "@/src/lib/reservationSchedule";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import type { Order } from "@/src/types/order";
import type { RestaurantTable, TableStatus } from "@/src/types/table";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { Skeleton } from "@/src/components/shared/Skeleton";
import OperationalPageShell from "@/src/components/shared/OperationalPageShell";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import SegmentedControl from "@/src/components/shared/SegmentedControl";
import RealtimeConnectionNotice from "@/src/components/shared/RealtimeConnectionNotice";
import ReservationHistoryModal from "@/src/components/tables/ReservationHistoryModal";
import ReservationWhenPicker from "@/src/components/tables/ReservationWhenPicker";
import TakeawayOrderCards from "@/src/components/tables/TakeawayOrderCards";
import { activeTakeaways } from "@/src/lib/takeawayOrders";
import { useOrderEvents } from "@/src/hooks/useOrderEvents";
import { useVisiblePolling } from "@/src/hooks/useVisiblePolling";

const TAKEAWAY_ZONE = "takeaway";
const activeOrderStatuses = ["open", "sent_to_kitchen", "cooking", "ready", "served"];
const tableRefreshIntervalMs = 60_000;
type TableSheetMode = "open" | "reserved";
/** What the free-table sheet is for. The form and its one footer action follow it. */
type TableSheetIntent = "dine_in" | "reserve";

// The steppers in the party-size row. Each presses on its own with a darker
// fill; no ui-press, whose nudge made the whole row look as if it sank.
const COUNT_STEP_CLASS =
  "group text-[13px] font-semibold text-gray-700 outline-none transition-colors duration-75 hover:bg-gray-50 active:bg-gray-200 focus-visible:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-200 dark:hover:bg-gray-700 dark:active:bg-gray-600";
// The glyph inside a stepper: it dips under the finger, so a tap is felt
// without the row around it moving.
const COUNT_STEP_GLYPH = "inline-block transition-transform duration-100 ease-out group-active:scale-75 group-disabled:scale-100";

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
  const router = useRestaurantRouter();
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
  const [sheetIntent, setSheetIntent] = useState<TableSheetIntent>("dine_in");
  // Seeded from the clock, never a literal: the next quarter hour, which is
  // tomorrow once that falls past midnight.
  const [reservationWhen, setReservationWhen] = useState<ReservationWhen>(() => initialReservationWhen(new Date()));
  const [reservationWhenError, setReservationWhenError] = useState("");
  // The booking behind a reserved table: the party size the guest gave and when
  // it was made live on the reservation, not on the table row.
  const [heldReservation, setHeldReservation] = useState<Reservation | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const reservationLookupRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [navigationPending, startNavigationTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");
  const refreshInFlight = useRef(false);
  const sheetErrorRef = useRef<HTMLDivElement>(null);
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
        confirmReservation: "ยืนยันจอง",
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
        sheetIntent: "ทำรายการกับโต๊ะ",
        dineIn: "ทานที่ร้าน",
        reserveMode: "จองโต๊ะ",
        reserveTitle: "จองโต๊ะ",
        reserving: "กำลังจอง",
        slotPassed: "เวลาที่เลือกผ่านไปแล้ว เลือกเวลาใหม่",
        invalidTime: "เวลาไม่ถูกต้อง พิมพ์แบบ 20:30",
        tooFar: "จองล่วงหน้าได้ไม่เกิน 1 ปี",
        scheduledSuccess: (table: string, time: string) => `จอง ${table} เวลา ${time} แล้ว`,
        reserveError: "จองโต๊ะไม่สำเร็จ",
        cancelError: "ยกเลิกการจองไม่สำเร็จ",
        guestName: "ชื่อผู้จอง",
        guestPhone: "เบอร์โทร",
        bookedFor: "เวลาที่จอง",
        noName: "ไม่ระบุชื่อ",
        close: "ปิด",
        confirmCancelReservation: "ยืนยันยกเลิกการจอง",
        bookedLabel: "จอง",
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
        confirmReservation: "Confirm reservation",
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
        sheetIntent: "Table action",
        dineIn: "Dine-in",
        reserveMode: "Reserve",
        reserveTitle: "Reserve",
        reserving: "Reserving",
        slotPassed: "That time has already passed. Choose another.",
        invalidTime: "That is not a valid time. Type it like 20:30.",
        tooFar: "Bookings can be made up to 1 year ahead.",
        scheduledSuccess: (table: string, time: string) => `${table} booked for ${time}.`,
        reserveError: "Could not reserve the table.",
        cancelError: "Could not cancel the reservation.",
        guestName: "Guest name",
        guestPhone: "Phone",
        bookedFor: "Booked for",
        noName: "No name",
        close: "Close",
        confirmCancelReservation: "Confirm cancellation",
        bookedLabel: "Booked",
      };

  const inactiveNoticeLabel = copy.inactiveNotice;

  // The banner sits at the top of a sheet that scrolls as one piece, so on a
  // phone it is out of sight by the time anyone taps the footer. Bring it back.
  useEffect(() => {
    if (sheetError) sheetErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [sheetError]);

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
      ].some((value) => String(value ?? "").toLowerCase().includes(keyword));
    }).forEach((table) => {
      const key = table.zone_id ? String(table.zone_id) : "none";
      if (!groups.has(key)) groups.set(key, { label: table.table_zone?.name || table.zone || copy.noZone, tables: [] });
      groups.get(key)?.tables.push(table);
    });
    return Array.from(groups.values());
  }, [copy.noZone, search, tables, zoneFilter]);

  // Open takeaway orders get a zone of their own on the floor, so a takeaway can
  // be reopened from here like any table. "takeaway" is its zone-filter key.
  const takeaways = useMemo(() => activeTakeaways(orders, search), [orders, search]);
  const showTakeaways = zoneFilter === "all" || zoneFilter === TAKEAWAY_ZONE;

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
  const allTakeawayCount = useMemo(() => activeTakeaways(orders).length, [orders]);
  const zoneSelectOptions = useMemo(
    () => [
      { value: "all", label: `${allZonesLabel} (${tables.length})` },
      ...zoneOptions.map((zone) => ({ value: zone.key, label: `${zone.label} (${zone.count})` })),
      ...(allTakeawayCount ? [{ value: TAKEAWAY_ZONE, label: `${copy.takeaway} (${allTakeawayCount})` }] : []),
    ],
    [allTakeawayCount, allZonesLabel, copy.takeaway, tables.length, zoneOptions],
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

  /** Everything the reservation parts of the sheet hold, back to a fresh start. */
  const resetReservationDraft = useCallback(() => {
    reservationLookupRef.current += 1;
    setReservationName("");
    setReservationPhone("");
    setSheetIntent("dine_in");
    setReservationWhen(initialReservationWhen(new Date()));
    setReservationWhenError("");
    setHeldReservation(null);
    setConfirmCancel(false);
  }, []);

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
    resetReservationDraft();
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
      resetReservationDraft();
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
      // The party size the guest actually gave, and when the booking was made,
      // live on the reservation. Missing them costs two facts on the sheet,
      // never the sheet, so a failed lookup leaves the table's own details.
      const lookup = reservationLookupRef.current;
      void listReservations({ status: "active", limit: 100 })
        .then((res) => {
          if (reservationLookupRef.current !== lookup) return;
          const hold = findTableHold(res.data.reservations ?? [], table.ID);
          setHeldReservation(hold);
          if (hold?.guest_count) setCustomerCount(hold.guest_count);
        })
        .catch(() => undefined);
      return;
    }
    if (table.status === "inactive") {
      showToast({ title: inactiveNoticeLabel, tone: "warning" });
      return;
    }
    resetReservationDraft();
    setSelectedTable(table);
    setTakeawayOpen(false);
    setSheetMode("open");
    setSheetClosing(false);
    setCustomerCount(Math.max(1, Math.min(table.capacity || 1, 6)));
    setCustomerName("");
    setCustomerPhone("");
    setNote("");
  }, [activeOrderByTable, inactiveNoticeLabel, isNavigating, navigateToOrder, resetReservationDraft, showToast, tables]);

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
      setSheetError("");
      resetReservationDraft();
    }, 180);
  };
  const openOrderBackdrop = useBackdropClose(closeOpenOrderSheet);

  /** Close the sheet after a reservation action went through. */
  const finishReservationSheet = () => {
    setSheetClosing(true);
    window.setTimeout(() => {
      setSelectedTable(null);
      setSheetMode("open");
      setSheetClosing(false);
      setSheetError("");
      resetReservationDraft();
    }, 180);
  };

  const submitReservation = async () => {
    if (!selectedTable || submitting || isNavigating) return;
    if (!hasValidPhone(reservationPhone)) {
      setSheetError(copy.reservationPhoneRequired);
      return;
    }
    const now = new Date();
    // Checked against the clock at the moment of confirming, not when the time
    // was picked: a sheet can sit open long enough for its time to go by, and
    // refusing here is the difference between saying so and silently filing a
    // booking in the past.
    const problem = reservationWhenProblem(reservationWhen, now);
    if (problem) {
      setReservationWhenError(problem === "passed" ? copy.slotPassed : problem === "too_far" ? copy.tooFar : copy.invalidTime);
      return;
    }
    const instant = reservationInstantFor(reservationWhen);
    const tableLabel = selectedTable.display_label || selectedTable.table_number;
    setSubmitting(true);
    setError("");
    setSheetError("");
    try {
      const res = await reserveTableApi(selectedTable.ID, reserveTableInput({
        phone: reservationPhone,
        name: reservationName,
        guestCount: customerCount,
        instant,
      }));
      // Merged rather than replaced: the reserve response carries the table row
      // without the upcoming-booking fields the list attaches.
      setTables((current) => current.map((table) => table.ID === res.data.ID ? { ...table, ...res.data } : table));
      showToast({
        title: instant
          ? copy.scheduledSuccess(tableLabel, formatReservationClock(instant.toISOString(), language, now))
          : copy.reservedSuccess,
      });
      finishReservationSheet();
      // A booking for later leaves the table's status alone and only shows up
      // as its reminder, which comes from the table list.
      void load(false);
    } catch (error) {
      setSheetError(reservationErrorMessage(apiErrorMessage(error), language, copy.reserveError));
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
    // Two presses. The button sits beside the one that seats the guests, and a
    // cancelled booking cannot be put back.
    if (!confirmCancel) {
      setConfirmCancel(true);
      setSheetError("");
      return;
    }
    setSubmitting(true);
    setError("");
    setSheetError("");
    try {
      const res = await cancelReservationApi(selectedTable.ID);
      setTables((current) => current.map((table) => table.ID === res.data.ID ? { ...table, ...res.data } : table));
      showToast({ title: copy.reservationCancelled });
      finishReservationSheet();
    } catch (error) {
      setConfirmCancel(false);
      setSheetError(reservationErrorMessage(apiErrorMessage(error), language, copy.cancelError));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canTake) return <PermissionDenied title={copy.denied} />;

  const reservingIntent = !takeawayOpen && sheetMode === "open" && sheetIntent === "reserve";
  const sheetTableLabel = selectedTable?.display_label || selectedTable?.table_number || "";

  const customerCountField = (
    // A div, not a label: a label hands every click inside it to its input, so
    // tapping − focused the number field and lit the orange focus edge. The
    // buttons press on their own (a darker fill), never the whole box.
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.customerCount}</span>
      {/* One row: −5 and +5 at the ends,
          −1 and +1 beside the count. Down as well as up, because overshooting
          is as common as undershooting. No focus edge on the number: the
          owner wanted the row to stay still whatever is tapped. */}
      <div className="grid h-12 grid-cols-[72px_72px_1fr_72px_72px] divide-x divide-gray-200 overflow-hidden rounded-md border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
        <button type="button" aria-label="-5" onClick={() => setCustomerCount((current) => Math.max(1, current - 5))} disabled={customerCount <= 1} className={COUNT_STEP_CLASS}>
          <span className={COUNT_STEP_GLYPH}>−5</span>
        </button>
        <button type="button" aria-label="-1" onClick={() => setCustomerCount((current) => Math.max(1, current - 1))} disabled={customerCount <= 1} className={`${COUNT_STEP_CLASS} text-lg`}>
          <span className={COUNT_STEP_GLYPH}>−</span>
        </button>
        <NumberInput min={1} inputMode="numeric" aria-label={copy.customerCount} value={customerCount} onValue={setCustomerCount} className="h-full min-w-0 bg-transparent px-2 text-center text-[18px] font-semibold tabular-nums text-gray-900 outline-none dark:text-white" />
        <button type="button" aria-label="+1" onClick={() => setCustomerCount((current) => current + 1)} className={`${COUNT_STEP_CLASS} text-lg`}>
          <span className={COUNT_STEP_GLYPH}>+</span>
        </button>
        <button type="button" aria-label="+5" onClick={() => setCustomerCount((current) => current + 5)} className={COUNT_STEP_CLASS}>
          <span className={COUNT_STEP_GLYPH}>+5</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {isNavigating ? (
        <div aria-hidden="true" className="fixed inset-0 z-[var(--z-modal)] cursor-wait bg-transparent" />
      ) : null}
      <div data-shell-sticky="" className="fixed inset-x-0 top-0 z-20 bg-white/82 backdrop-blur-md dark:bg-[#0f0f0f]/82 transition-[left] duration-300 ease-in-out lg:inset-auto">
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
                className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white py-2 pl-7 pr-3 text-[15px] outline-none focus:border-orange-500 shadow-(--dashboard-control-shadow) placeholder:text-[15px] dark:bg-gray-800"
                aria-label={copy.search}
              />
            </label>
            <div className="flex gap-2 lg:order-last lg:ml-auto">
              <button
                type="button"
                onClick={() => setReservationsOpen(true)}
                className="ui-press inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white px-3 text-[13px] font-semibold text-gray-800 shadow-(--dashboard-control-shadow) hover:border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 lg:flex-none"
              >
                <CalendarClock className="h-4 w-4" />
                {copy.reservationHistory}
              </button>
              <button
                type="button"
                disabled={isNavigating}
                onClick={openTakeawaySheet}
                className="ui-press inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white px-3 text-[13px] font-semibold text-gray-800 shadow-(--dashboard-control-shadow) hover:border-gray-300 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-60 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 lg:flex-none"
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
 triggerClassName="rounded-xl shadow-(--dashboard-control-shadow)"
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
          {showTakeaways ? <TakeawayOrderCards orders={takeaways} language={language} disabled={isNavigating} onOpen={navigateToOrder} /> : null}
          {groupedTables.length || (showTakeaways && takeaways.length) ? groupedTables.map((group) => (
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
                  const disabled = status === "reserved" || status === "inactive";
                  const bookingClock = reservationClock(table.upcoming_reservation_at, language);
                  const bookingReminder = reservationReminder(table.upcoming_reservation_at, new Date(), language);
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
                      className={`ui-press group relative flex min-h-[118px] overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[transform,translate,box-shadow,border-color] dark:border-gray-800 dark:bg-gray-800 ${disabled ? "cursor-default opacity-70" : "hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:hover:border-gray-700 dark:hover:bg-gray-800"}`}
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
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className={`rounded-md px-2 py-1 text-[11px] font-semibold leading-none ${tableStatusPillClass(status)}`}>{statusLabel}</span>
                            {/* A booking for later leaves the table free to sell, so
                                without this it is invisible until the guests are at
                                the door. Clock only: the card has no room for a date,
                                and the backend only surfaces the next twelve hours. */}
                            {bookingClock ? (
                              <span
                                title={bookingReminder ?? undefined}
                                className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-1 text-[11px] font-semibold leading-none tabular-nums text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
                              >
                                <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
                                {copy.bookedLabel} {bookingClock}
                              </span>
                            ) : null}
                          </div>
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
                            <div className="min-h-[22px]" />
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
                {takeawayOpen
                  ? copy.openTakeaway
                  : `${sheetMode === "reserved" ? copy.reserved : reservingIntent ? copy.reserveTitle : copy.openOrder} · ${sheetTableLabel}`}
              </h2>
              {takeawayOpen && <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{copy.takeawayHelp}</p>}
            </div>
            {sheetError && <div ref={sheetErrorRef} role="alert" className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{sheetError}</div>}
            {sheetMode === "reserved" && selectedTable ? (
              <>
                <div className="space-y-4 p-4">
                  {/* The guest count is not repeated here: the stepper below
                      carries it, prefilled with the party size the guest gave. */}
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{copy.guestName}</dt>
                      <dd className="mt-0.5 truncate text-[14px] font-semibold text-gray-950 dark:text-white">{selectedTable.reservation_name || heldReservation?.name || copy.noName}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{copy.guestPhone}</dt>
                      <dd className="mt-0.5 truncate font-mono text-[14px] font-semibold tabular-nums text-gray-950 dark:text-white">{selectedTable.reservation_phone || heldReservation?.phone || "-"}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{copy.bookedFor}</dt>
                      <dd className="mt-0.5 truncate text-[14px] font-semibold tabular-nums text-gray-950 dark:text-white">
                        {heldReservation ? formatReservationClock(heldReservation.reserved_for || heldReservation.CreatedAt, language) : "-"}
                      </dd>
                    </div>
                  </dl>
                  {customerCountField}
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                  <button type="button" disabled={isNavigating} onClick={closeOpenOrderSheet} className="ui-press h-10 rounded-md border border-gray-200 px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
                    {copy.close}
                  </button>
                  <button
                    type="button"
                    disabled={submitting || isNavigating}
                    onClick={cancelReservation}
                    className={`ui-press h-10 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold disabled:opacity-50 ${
                      confirmCancel
                        ? "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-500"
                        : "border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800"
                    }`}
                  >
                    {confirmCancel ? copy.confirmCancelReservation : copy.cancelReservation}
                  </button>
                  <button type="button" disabled={submitting || isNavigating} onClick={acceptReservation} className="ui-press col-span-2 h-10 whitespace-nowrap rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white">
                    {copy.acceptReservation}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-4 p-4">
                  {/* A mode, not a second button: the form below and the one
                      action in the footer both follow it, so the sheet never
                      shows a reservation form under "Open table". */}
                  {!takeawayOpen && (
                    <SegmentedControl
                      label={copy.sheetIntent}
                      value={sheetIntent}
                      disabled={submitting || isNavigating}
                      onChange={(next) => {
                        setSheetIntent(next);
                        setSheetError("");
                      }}
                      options={[
                        { value: "dine_in", label: copy.dineIn },
                        { value: "reserve", label: copy.reserveMode },
                      ]}
                    />
                  )}
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
                  {reservingIntent ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.reservationNameOptional}</span>
                          <input
                            value={reservationName}
                            onChange={(event) => setReservationName(event.target.value)}
                            maxLength={80}
                            placeholder={copy.reservationNamePlaceholder}
                            className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 text-[15px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 sm:h-10 sm:text-[13px]"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">
                            {copy.reservationPhone}
                            <span className="ml-0.5 text-red-600 dark:text-red-400">*</span>
                          </span>
                          <input
                            value={reservationPhone}
                            onChange={(event) => setReservationPhone(normalizePhone(event.target.value))}
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder={copy.reservationPhonePlaceholder}
                            className="h-11 w-full rounded-md border border-gray-200 bg-white px-3 font-mono text-[15px] tabular-nums outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 sm:h-10 sm:text-[13px]"
                          />
                        </label>
                      </div>
                      {customerCountField}
                      <ReservationWhenPicker
                        value={reservationWhen}
                        onChange={(next) => {
                          setReservationWhen(next);
                          setReservationWhenError("");
                          setSheetError("");
                        }}
                        onInvalidTime={() => setReservationWhenError(copy.invalidTime)}
                        error={reservationWhenError}
                        language={language}
                        disabled={submitting || isNavigating}
                      />
                    </>
                  ) : (
                    <>
                      {!takeawayOpen && customerCountField}
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.note}</span>
                        <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-24 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 sm:min-h-20 sm:text-[13px]" />
                      </label>
                    </>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
                  <button type="button" disabled={isNavigating} onClick={closeOpenOrderSheet} className="ui-press h-11 rounded-md border border-gray-200 px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 sm:h-9 sm:text-[12px]">
                    {copy.cancel}
                  </button>
                  {reservingIntent ? (
                    <button
                      type="button"
                      disabled={submitting || isNavigating}
                      onClick={submitReservation}
                      className="ui-press inline-flex h-11 items-center justify-center gap-2 rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white sm:h-9 sm:text-[12px]"
                    >
                      {submitting ? copy.reserving : copy.confirmReservation}
                    </button>
                  ) : (
                    <button type="button" disabled={submitting || isNavigating} onClick={openOrder} className="ui-press inline-flex h-11 items-center justify-center gap-2 rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:cursor-wait disabled:opacity-60 dark:bg-orange-700 dark:text-white sm:h-9 sm:text-[12px]">
                      {submitting ? (takeawayOpen ? copy.openingTakeaway : copy.openingTable) : takeawayOpen ? copy.confirmTakeaway : copy.confirm}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ReservationHistoryModal
        open={reservationsOpen}
        onClose={() => setReservationsOpen(false)}
        onChanged={() => void load(false)}
        onSeatHold={async (reservation) => {
          const res = await createOrder({
            table_id: reservation.table_id,
            order_type: "dine_in",
            customer_count: Math.max(1, reservation.guest_count ?? 1),
            customer_name: reservation.name,
            customer_phone: reservation.phone,
            seat_reservation: true,
          });
          setReservationsOpen(false);
          navigateToOrder(res.data);
        }}
        canResolve={canTake}
        language={language}
      />
      </div>
      </OperationalPageShell>
    </>
  );
}
