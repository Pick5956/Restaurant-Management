"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, History, Undo2, X } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { playBeep } from "@/src/lib/browserAudio";
import { can } from "@/src/lib/rbac";
import { kitchenQueue, updateOrderItemStatus } from "@/src/lib/order";
import { kitchenTicketKey } from "@/src/lib/homeDashboard";
import type { Order, OrderItem } from "@/src/types/order";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { Skeleton } from "@/src/components/shared/Skeleton";
import OperationalPageShell from "@/src/components/shared/OperationalPageShell";
import RealtimeConnectionNotice from "@/src/components/shared/RealtimeConnectionNotice";
import { useConfirm, useToast } from "@/src/components/shared/FeedbackProvider";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useOrderEvents } from "@/src/hooks/useOrderEvents";
import { useVisiblePolling } from "@/src/hooks/useVisiblePolling";

type KitchenLane = "cooking" | "ready";
type CancelTarget = { order: Order; item: OrderItem };

const ITEM_COMPLETE_FEEDBACK_MS = 220;
const ITEM_COLLAPSE_MS = 220;
const TICKET_COMPLETE_FEEDBACK_MS = 360;
const TICKET_COLLAPSE_MS = 260;

function waitForAnimation(duration: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, duration));
}

function shouldReduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function minutesSince(value?: string | null) {
  if (!value) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

// Whole seconds between two timestamps, or null if either is missing. Used by
// the recall modal to show how long a finished item took.
function durationSeconds(from?: string | null, to?: string | null) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
}

// Ticket aging: the cooking-ticket header bar shifts colour with elapsed time —
// emerald when fresh, amber as it ages, red once it is late. Header text is
// theme-based (white in dark, near-black in light), not tied to the bar colour.
function cookingBarClass(minutes: number) {
  if (minutes >= 10) return "bg-red-600";
  if (minutes >= 5) return "bg-amber-500";
  return "bg-emerald-600";
}

function orderTableLabel(order: Order) {
  return order.table?.display_label || order.table?.table_number || (order.table_id ? String(order.table_id) : "-");
}

function orderLocationLabel(order: Order, language: "th" | "en") {
  if (order.order_type === "takeaway") {
    const base = language === "th" ? "กลับบ้าน" : "Takeaway";
    return order.customer_name?.trim() ? `${base} · ${order.customer_name.trim()}` : base;
  }
  return `${language === "th" ? "โต๊ะ" : "Table"} ${orderTableLabel(order)}`;
}

function itemFulfillmentLabel(item: OrderItem, language: "th" | "en") {
  if (item.fulfillment_type === "takeaway") return language === "th" ? "กลับบ้าน" : "Takeaway";
  return language === "th" ? "ทานที่ร้าน" : "Dine-in";
}

function itemFulfillmentBadgeClass(item: OrderItem) {
  return item.fulfillment_type === "takeaway"
    ? "bg-orange-50 text-orange-700 ring-1 ring-orange-200 dark:bg-orange-950/30 dark:text-orange-200 dark:ring-orange-900/60"
    : "bg-white text-gray-500 ring-1 ring-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:ring-gray-800";
}

function shouldShowItemFulfillment(order: Order, item: OrderItem) {
  return (item.fulfillment_type ?? order.order_type) !== order.order_type;
}

export default function KitchenPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const canView = can(activeMembership, "view_kitchen");
  const canUpdate = can(activeMembership, "update_order_status");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [cookingZoneOpen, setCookingZoneOpen] = useState(true);
  const [readyZoneOpen, setReadyZoneOpen] = useState(true);
  const [zoneRipple, setZoneRipple] = useState<{ id: number; lane: KitchenLane; size: number; x: number; y: number } | null>(null);
  const [completingItemIds, setCompletingItemIds] = useState<Set<number>>(() => new Set());
  const [collapsingItemIds, setCollapsingItemIds] = useState<Set<number>>(() => new Set());
  const [completingTicketIds, setCompletingTicketIds] = useState<Set<string>>(() => new Set());
  const [collapsingTicketIds, setCollapsingTicketIds] = useState<Set<string>>(() => new Set());
  const [enteringReadyItemIds, setEnteringReadyItemIds] = useState<Set<number>>(() => new Set());
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState("");
  const [cancelDialogClosing, setCancelDialogClosing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasLoadedRef = useRef(false);
  const ticketIdsRef = useRef<Set<string>>(new Set());
  const zoneRippleIdRef = useRef(0);
  const transitioningItemIdsRef = useRef<Set<number>>(new Set());
  const submittingIdRef = useRef<number | null>(null);
  const cancelDialogRef = useRef<HTMLFormElement>(null);
  const cancelReasonRef = useRef<HTMLTextAreaElement>(null);
  const cancelPreviousFocusRef = useRef<HTMLElement | null>(null);

  const copy = language === "th"
    ? {
        denied: "ไม่มีสิทธิ์ดูจอครัว",
        eyebrow: "Kitchen",
        title: "จอครัว",
        subtitle: "ดูรายการกำลังทำและรายการที่ครัวทำเสร็จ",
        emptyTitle: "ยังไม่มีงานในครัว",
        emptyHint: "เมื่อพนักงานส่งออเดอร์เข้าครัว รายการจะแสดงที่นี่",
        table: "โต๊ะ",
        kitchenBatch: (batch: number) => `รอบ ${batch}`,
        elapsed: "นาที",
        markReady: "เสร็จแล้ว",
        markAllReady: "เสร็จทั้งหมด",
        ready: "เสร็จแล้ว",
        cooking: "กำลังทำ",
        cookingZone: "กำลังปรุงอาหาร",
        readyZone: "โซนเสร็จแล้ว",
        cookingEmpty: "ยังไม่มีรายการกำลังทำ",
        readyEmpty: "ยังไม่มีรายการที่ทำเสร็จ",
        allDone: "เสร็จครบแล้ว",
        remaining: (count: number) => `เหลือ ${count} รายการ`,
        undo: "ย้ายไปกำลังทำ",
        undoAria: (name: string) => `ย้าย ${name} ไปโซนกำลังทำ`,
        undoConfirmTitle: (name: string) => `ต้องการย้าย “${name}” กลับไปโซนกำลังทำหรือไม่?`,
        undoConfirmAction: "ยืนยัน",
        undoConfirmCancel: "ยกเลิก",
        undoSuccess: "ย้ายรายการไปโซนกำลังทำแล้ว",
        cancelItem: "ยกเลิก",
        cancelItemAria: (name: string) => `ยกเลิกรายการ ${name}`,
        cancelTitle: "ยกเลิกรายการอาหาร",
        cancelDescription: (name: string) => `ระบุเหตุผลสำหรับ “${name}” เพื่อเก็บไว้ในประวัติออเดอร์`,
        cancelReason: "เหตุผลที่ยกเลิก",
        cancelPlaceholder: "เช่น ของหมด หรือเหตุสุดวิสัย",
        cancelPresets: ["ของหมด", "อุปกรณ์ขัดข้อง", "เหตุสุดวิสัย"],
        keepItem: "เก็บรายการไว้",
        confirmCancel: "ยืนยันยกเลิก",
        reasonRequired: "กรุณาระบุเหตุผลที่ยกเลิก",
        cancelSuccess: "ยกเลิกรายการแล้ว",
        loadError: "โหลดคิวครัวไม่สำเร็จ",
        saveError: "อัปเดตสถานะไม่สำเร็จ",
        recall: "รายการที่เสร็จสิ้น",
        recallEmpty: "ยังไม่มีรายการที่ครัวทำเสร็จ",
        finishedAt: "เสร็จเมื่อ",
        timeTaken: "ใช้เวลา",
        recallDuration: (m: number, s: number) => `${m} นาที ${s} วินาที`,
        recallClose: "ปิด",
      }
    : {
        denied: "You do not have permission to view the kitchen.",
        eyebrow: "Kitchen",
        title: "Kitchen",
        subtitle: "Track items being prepared and completed by the kitchen.",
        emptyTitle: "No kitchen tickets",
        emptyHint: "Orders will appear here after staff send them to the kitchen.",
        table: "Table",
        kitchenBatch: (batch: number) => `Batch ${batch}`,
        elapsed: "min",
        markReady: "Done",
        markAllReady: "Mark all done",
        ready: "Done",
        cooking: "Cooking",
        cookingZone: "Cooking",
        readyZone: "Done",
        cookingEmpty: "No items are being prepared",
        readyEmpty: "No completed items",
        allDone: "All items done",
        remaining: (count: number) => `${count} items left`,
        undo: "Undo",
        undoAria: (name: string) => `Move ${name} back to cooking`,
        undoConfirmTitle: (name: string) => `Move “${name}” back to the cooking zone?`,
        undoConfirmAction: "Confirm",
        undoConfirmCancel: "Cancel",
        undoSuccess: "Item moved back to cooking",
        cancelItem: "Cancel",
        cancelItemAria: (name: string) => `Cancel ${name}`,
        cancelTitle: "Cancel menu item",
        cancelDescription: (name: string) => `Give a reason for cancelling “${name}” so it is recorded with the order.`,
        cancelReason: "Cancellation reason",
        cancelPlaceholder: "For example, out of stock or an unexpected issue",
        cancelPresets: ["Out of stock", "Equipment issue", "Unexpected issue"],
        keepItem: "Keep item",
        confirmCancel: "Confirm cancellation",
        reasonRequired: "Enter a cancellation reason",
        cancelSuccess: "Item cancelled",
        loadError: "Could not load kitchen queue.",
        saveError: "Could not update item status.",
        recall: "Completed",
        recallEmpty: "No items finished yet",
        finishedAt: "Finished",
        timeTaken: "Took",
        recallDuration: (m: number, s: number) => `${m}m ${s}s`,
        recallClose: "Close",
      };

  const visibleOrders = useMemo(
    () => orders.filter((order) => order.items?.some((item) => item.status === "cooking" || item.status === "ready")),
    [orders],
  );
  const cookingOrders = useMemo(
    () => visibleOrders.filter((order) => order.items?.some((item) => item.status === "cooking")),
    [visibleOrders],
  );
  const readyOrders = useMemo(
    () => visibleOrders.filter((order) => order.items?.some((item) => item.status === "ready")),
    [visibleOrders],
  );
  const activeItems = useMemo(
    () => visibleOrders.flatMap((order) => order.items?.map((item) => ({ order, item })) ?? []),
    [visibleOrders],
  );
  const cookingCount = activeItems.filter(({ item }) => item.status === "cooking").length;
  const readyCount = activeItems.filter(({ item }) => item.status === "ready").length;

  const load = async () => {
    if (!canView) return;
    if (!hasLoadedRef.current) setLoading(true);
    setError("");
    try {
      const res = await kitchenQueue();
      const nextIds = new Set(res.data.orders.map((order) => kitchenTicketKey(order)));
      const hasNewTicket = hasLoadedRef.current && [...nextIds].some((id) => !ticketIdsRef.current.has(id));
      const transitioningItemIds = transitioningItemIdsRef.current;
      const nextOrders = transitioningItemIds.size
        ? res.data.orders.map((order) => ({
            ...order,
            items: order.items?.map((item) => (
              transitioningItemIds.has(item.ID) && item.status === "ready"
                ? { ...item, status: "cooking" as const }
                : item
            )),
          }))
        : res.data.orders;
      setOrders(nextOrders);
      if (hasNewTicket) playBeep(740, "square", 0.04, 0.18);
      ticketIdsRef.current = nextIds;
      hasLoadedRef.current = true;
    } catch (error) {
      setError(apiErrorMessage(error) || copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  const applyItemStatuses = (order: Order, itemIds: number[], status: OrderItem["status"]) => {
    const key = kitchenTicketKey(order);
    const changedItemIds = new Set(itemIds);
    setOrders((current) => current.map((currentOrder) => (
      kitchenTicketKey(currentOrder) === key
        ? {
            ...currentOrder,
            items: currentOrder.items?.map((item: OrderItem) => (
              changedItemIds.has(item.ID) ? { ...item, status } : item
            )),
          }
        : currentOrder
    )));
  };

  const showReadyEntry = (itemIds: number[]) => {
    setEnteringReadyItemIds((current) => {
      const next = new Set(current);
      itemIds.forEach((itemId) => next.add(itemId));
      return next;
    });
    window.setTimeout(() => {
      setEnteringReadyItemIds((current) => {
        const next = new Set(current);
        itemIds.forEach((itemId) => next.delete(itemId));
        return next;
      });
    }, 260);
  };

  const realtimeStatus = useOrderEvents(load, {
    enabled: canView,
    restaurantId: activeMembership?.restaurant_id,
    eventFilter: { kind: "kitchen" },
  });
  useVisiblePolling(load, { enabled: canView, intervalMs: 60_000 });

  const markReady = async (order: Order, itemId: number) => {
    setSubmittingId(itemId);
    setError("");
    transitioningItemIdsRef.current.add(itemId);
    try {
      await updateOrderItemStatus(order.ID, itemId, "ready");
      const animate = !shouldReduceMotion();
      if (animate) setCompletingItemIds((current) => new Set(current).add(itemId));
      await waitForAnimation(animate ? ITEM_COMPLETE_FEEDBACK_MS : 0);
      if (animate) setCollapsingItemIds((current) => new Set(current).add(itemId));
      await waitForAnimation(animate ? ITEM_COLLAPSE_MS : 0);
      transitioningItemIdsRef.current.delete(itemId);
      setCompletingItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
      setCollapsingItemIds((current) => {
        const next = new Set(current);
        next.delete(itemId);
        return next;
      });
      if (animate) showReadyEntry([itemId]);
      applyItemStatuses(order, [itemId], "ready");
    } catch (error) {
      transitioningItemIdsRef.current.delete(itemId);
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmittingId(null);
    }
  };

  const markAllReady = async (order: Order) => {
    const cookingItems = order.items?.filter((item) => item.status === "cooking") ?? [];
    if (!cookingItems.length) return;
    const itemIds = cookingItems.map((item) => item.ID);
    const key = kitchenTicketKey(order);
    setSubmittingId(order.ID);
    setError("");
    itemIds.forEach((itemId) => transitioningItemIdsRef.current.add(itemId));
    try {
      await Promise.all(cookingItems.map((item) => updateOrderItemStatus(order.ID, item.ID, "ready")));
      const animate = !shouldReduceMotion();
      if (animate) setCompletingTicketIds((current) => new Set(current).add(key));
      await waitForAnimation(animate ? TICKET_COMPLETE_FEEDBACK_MS : 0);
      if (animate) setCollapsingTicketIds((current) => new Set(current).add(key));
      await waitForAnimation(animate ? TICKET_COLLAPSE_MS : 0);
      itemIds.forEach((itemId) => transitioningItemIdsRef.current.delete(itemId));
      setCompletingTicketIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      setCollapsingTicketIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      if (animate) showReadyEntry(itemIds);
      applyItemStatuses(order, itemIds, "ready");
    } catch (error) {
      itemIds.forEach((itemId) => transitioningItemIdsRef.current.delete(itemId));
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmittingId(null);
    }
  };

  const revertToCooking = async (order: Order, item: OrderItem) => {
    if (!canUpdate || submittingId !== null) return;
    const confirmed = await confirm({
      title: copy.undoConfirmTitle(item.menu_name),
      confirmLabel: copy.undoConfirmAction,
      cancelLabel: copy.undoConfirmCancel,
      tone: "warning",
    });
    if (!confirmed) return;

    setSubmittingId(item.ID);
    setError("");
    transitioningItemIdsRef.current.add(item.ID);
    try {
      await updateOrderItemStatus(order.ID, item.ID, "cooking");
      applyItemStatuses(order, [item.ID], "cooking");
      showToast({ title: copy.undoSuccess, tone: "info" });
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      transitioningItemIdsRef.current.delete(item.ID);
      setSubmittingId(null);
    }
  };

  // Recall a whole finished round back to cooking (for a quick correctness check).
  // Purely a status revert — it does not touch billing or any other flow.
  const recallOrder = async (order: Order) => {
    if (!canUpdate || submittingId !== null) return;
    const readyItems = (order.items ?? []).filter((item) => item.status === "ready");
    if (!readyItems.length) return;
    const itemIds = readyItems.map((item) => item.ID);
    setSubmittingId(order.ID);
    setError("");
    itemIds.forEach((id) => transitioningItemIdsRef.current.add(id));
    try {
      await Promise.all(readyItems.map((item) => updateOrderItemStatus(order.ID, item.ID, "cooking")));
      applyItemStatuses(order, itemIds, "cooking");
      showToast({ title: copy.undoSuccess, tone: "info" });
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      itemIds.forEach((id) => transitioningItemIdsRef.current.delete(id));
      setSubmittingId(null);
    }
  };

  const openCancelDialog = (order: Order, item: OrderItem) => {
    if (!canUpdate || submittingId !== null) return;
    setCancelTarget({ order, item });
    setCancelReason("");
    setCancelReasonError("");
    setCancelDialogClosing(false);
  };

  const closeCancelDialog = useCallback(() => {
    setCancelDialogClosing(true);
    window.setTimeout(() => {
      setCancelTarget(null);
      setCancelReason("");
      setCancelReasonError("");
      setCancelDialogClosing(false);
    }, 180);
  }, []);

  const cancelBackdrop = useBackdropClose(() => {
    if (submittingId === null) closeCancelDialog();
  });

  const historyBackdrop = useBackdropClose(() => setHistoryOpen(false));

  useEffect(() => {
    if (!historyOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [historyOpen]);

  useEffect(() => {
    submittingIdRef.current = submittingId;
  }, [submittingId]);

  useEffect(() => {
    if (!cancelTarget) return;

    cancelPreviousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => cancelReasonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (submittingIdRef.current !== null) return;
        event.preventDefault();
        closeCancelDialog();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(cancelDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      cancelPreviousFocusRef.current?.focus();
      cancelPreviousFocusRef.current = null;
    };
  }, [cancelTarget, closeCancelDialog]);

  const cancelItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cancelTarget || !canUpdate || submittingId !== null) return;
    const reason = cancelReason.trim();
    if (!reason) {
      setCancelReasonError(copy.reasonRequired);
      cancelReasonRef.current?.focus();
      return;
    }

    const { order, item } = cancelTarget;
    setSubmittingId(item.ID);
    setCancelReasonError("");
    setError("");
    try {
      await updateOrderItemStatus(order.ID, item.ID, "cancelled", reason);
      applyItemStatuses(order, [item.ID], "cancelled");
      showToast({ title: copy.cancelSuccess });
      closeCancelDialog();
    } catch (error) {
      setCancelReasonError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmittingId(null);
    }
  };

  const renderTicket = (order: Order, lane: KitchenLane) => {
    const laneItems = order.items?.filter((item) => item.status === lane) ?? [];
    if (!laneItems.length) return null;

    const oldestStatusAt = laneItems.reduce<string | null>((oldest, item) => {
      const value = lane === "ready"
        ? item.ready_at ?? item.UpdatedAt ?? item.sent_at ?? null
        : item.sent_at ?? order.kitchen_sent_at ?? null;
      if (!value) return oldest;
      if (!oldest || new Date(value) < new Date(oldest)) return value;
      return oldest;
    }, order.kitchen_sent_at ?? null);
    const elapsed = minutesSince(oldestStatusAt ?? order.opened_at);
    const cookingBar = cookingBarClass(elapsed);
    const isReadyLane = lane === "ready";
    const locationLabel = orderLocationLabel(order, language);
    const readyCornerValue = order.order_type === "takeaway"
      ? (language === "th" ? "กลับบ้าน" : "Takeaway")
      : orderTableLabel(order);
    const kitchenBatch = order.kitchen_batch || 1;
    const currentTicketKey = kitchenTicketKey(order);
    const isCompletingTicket = !isReadyLane && completingTicketIds.has(currentTicketKey);
    const isCollapsingTicket = !isReadyLane && collapsingTicketIds.has(currentTicketKey);

    return (
      <div
        key={`${lane}:${kitchenTicketKey(order)}`}
        className={`kitchen-ticket-shell grid ${isCollapsingTicket ? "kitchen-ticket-collapse" : ""}`}
      >
        <div className="min-h-0 overflow-hidden">
          <article
            className={`relative overflow-hidden rounded-md border ${
              isReadyLane
                ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/20"
                : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
            }`}
          >
            {isCompletingTicket ? (
              <div className="kitchen-ticket-success absolute inset-0 z-20 grid place-items-center bg-emerald-600/95 text-white dark:bg-emerald-500/95 dark:text-emerald-950">
                <div className="text-center">
                  <span className="kitchen-success-icon mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <CheckCircle2 className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <p className="mt-2 text-[14px] font-semibold">{copy.allDone}</p>
                </div>
              </div>
            ) : null}
            <div className={`flex items-start justify-between gap-3 px-4 ${isReadyLane ? "py-2.5" : `py-3 ${cookingBar}`}`}>
              <div className="min-w-0">
                {isReadyLane ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p className="text-[15px] font-semibold text-gray-500 dark:text-gray-400">{order.order_number}</p>
                    <span className="text-[13px] font-medium text-gray-400 dark:text-gray-500">{copy.kitchenBatch(kitchenBatch)}</span>
                  </div>
                ) : (
                  <>
                    <h3 className="text-2xl font-bold leading-tight text-gray-950 dark:text-white">{locationLabel}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-medium text-gray-800 dark:text-gray-100">
                      <span>{order.order_number}</span>
                      <span aria-hidden="true">·</span>
                      <span>{copy.kitchenBatch(kitchenBatch)}</span>
                    </p>
                  </>
                )}
              </div>
              <div className="text-right">
                {isReadyLane ? (
                  order.order_type === "takeaway" ? (
                    <p className="text-[16px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{readyCornerValue}</p>
                  ) : (
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="text-[14px] font-bold text-gray-500">{copy.table}</span>
                      <p className="font-mono text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{readyCornerValue}</p>
                    </div>
                  )
                ) : (
                  <>
                    <p className="font-mono text-2xl font-semibold tabular-nums text-gray-950 dark:text-white">{elapsed}</p>
                    <p className="text-[11px] text-gray-800 dark:text-gray-100">{copy.elapsed}</p>
                  </>
                )}
              </div>
            </div>

            {!isReadyLane ? (
              <div className="flex min-h-11 items-center justify-between gap-3 border-y border-black/5 bg-white/60 px-3 py-1.5 dark:border-white/10 dark:bg-gray-900/35 sm:px-4">
                <p className="text-[12px] font-medium tabular-nums text-gray-600 dark:text-gray-300">
                  {copy.remaining(laneItems.length)}
                </p>
                {canUpdate && laneItems.length > 1 ? (
                  <button
                    type="button"
                    disabled={submittingId !== null}
                    onClick={() => markAllReady(order)}
                    className="ui-press inline-flex h-9 items-center justify-center rounded-md px-2 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100/70 hover:text-emerald-900 focus-visible:outline-none disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/35 dark:hover:text-emerald-100"
                  >
                    {copy.markAllReady}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className={`divide-y divide-black/5 bg-white/45 dark:divide-white/10 dark:bg-gray-900/25 ${isReadyLane ? "border-t border-black/5 dark:border-white/10" : ""}`}>
              {laneItems.map((item) => (
                <div
                  key={item.ID}
                  className={`kitchen-item-shell grid ${collapsingItemIds.has(item.ID) ? "kitchen-item-collapse" : ""}`}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div
                      className={`flex min-h-[52px] items-center gap-3 px-3 py-2.5 sm:px-4 ${
                        isReadyLane ? "bg-emerald-50/35 dark:bg-emerald-950/10" : ""
                      } ${completingItemIds.has(item.ID) ? "kitchen-item-complete" : ""} ${
                        isReadyLane && enteringReadyItemIds.has(item.ID) ? "kitchen-item-ready-enter" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className={`font-semibold leading-5 ${isReadyLane ? "text-gray-700 dark:text-gray-200" : "text-gray-900 dark:text-white"}`}>{item.quantity}x {item.menu_name}</p>
                          {shouldShowItemFulfillment(order, item) ? (
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${itemFulfillmentBadgeClass(item)}`}>
                              {itemFulfillmentLabel(item, language)}
                            </span>
                          ) : null}
                        </div>
                        {item.selected_options?.length ? (
                          <div className="mt-1 space-y-0.5 text-[11px] text-gray-500">
                            {item.selected_options.map((option) => (
                              <p key={option.ID}>{option.group_name}: {option.option_name}</p>
                            ))}
                          </div>
                        ) : null}
                        {item.note && <p className="mt-1 text-[12px] text-gray-500">{item.note}</p>}
                      </div>
                      {!canUpdate && isReadyLane ? (
                        <span className="inline-flex h-10 min-w-[82px] shrink-0 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold text-emerald-700 dark:text-emerald-300">
                          <Check className="h-4 w-4" aria-hidden="true" />
                          {copy.ready}
                        </span>
                      ) : canUpdate ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          {isReadyLane ? (
                            <button
                              type="button"
                              aria-label={copy.undoAria(item.menu_name)}
                              title={copy.undo}
                              disabled={submittingId !== null}
                              onClick={() => revertToCooking(order, item)}
                              className="ui-press inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-600 hover:bg-amber-100/70 hover:text-amber-800 focus-visible:outline-none disabled:opacity-50 dark:text-gray-300 dark:hover:bg-amber-950/35 dark:hover:text-amber-200"
                            >
                              <Undo2 className="h-[18px] w-[18px]" aria-hidden="true" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={`${copy.markReady}: ${item.menu_name}`}
                              title={copy.markReady}
                              disabled={submittingId !== null}
                              onClick={() => markReady(order, item.ID)}
                              className="ui-press inline-flex h-10 w-10 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-100/70 hover:text-emerald-800 focus-visible:outline-none disabled:opacity-50 dark:text-emerald-300 dark:hover:bg-emerald-950/35 dark:hover:text-emerald-200"
                            >
                              <Check className="h-5 w-5" strokeWidth={3} aria-hidden="true" />
                            </button>
                          )}
                          {!isReadyLane ? (
                            <button
                              type="button"
                              aria-label={copy.cancelItemAria(item.menu_name)}
                              title={copy.cancelItem}
                              disabled={submittingId !== null}
                              onClick={() => openCancelDialog(order, item)}
                              className="ui-press inline-flex h-10 w-10 items-center justify-center rounded-md text-red-600 transition-colors hover:bg-red-100/70 hover:text-red-800 focus-visible:outline-none disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/35 dark:hover:text-red-200"
                            >
                              <X className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="shrink-0 text-[11px] font-medium text-amber-700 dark:text-amber-300">{copy.cooking}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </div>
    );
  };

  const startZoneRipple = (lane: KitchenLane, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const radius = Math.hypot(
      Math.max(x, bounds.width - x),
      Math.max(y, bounds.height - y),
    );
    zoneRippleIdRef.current += 1;
    setZoneRipple({
      id: zoneRippleIdRef.current,
      lane,
      size: Math.ceil(radius * 2),
      x,
      y,
    });
  };

  const renderZone = (lane: KitchenLane) => {
    const isReadyLane = lane === "ready";
    const open = isReadyLane ? readyZoneOpen : cookingZoneOpen;
    const setOpen = isReadyLane ? setReadyZoneOpen : setCookingZoneOpen;
    const laneOrders = isReadyLane ? readyOrders : cookingOrders;
    const count = isReadyLane ? readyCount : cookingCount;
    const contentId = `kitchen-${lane}-zone`;
    const label = isReadyLane ? copy.readyZone : copy.cookingZone;
    const emptyLabel = isReadyLane ? copy.readyEmpty : copy.cookingEmpty;
    // Only the "done" zone can be collapsed; the cooking zone always stays open.
    const collapsible = isReadyLane;
    const isOpen = collapsible ? open : true;

    const zoneIconLabel = (
      <span className="relative z-10 flex min-w-0 items-center gap-3">
        <span className="min-w-0">
          <span className="block text-[21px] font-semibold leading-tight">{label}</span>
        </span>
      </span>
    );
    const zoneCount = (
      <span
        aria-label={language === "th" ? `${count} รายการ` : `${count} items`}
        className="min-w-8 text-center font-mono text-[24px] font-bold leading-none tabular-nums text-gray-950 dark:text-white"
      >
        {count}
      </span>
    );

    return (
      <section
        aria-label={label}
        className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      >
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onPointerDown={(event) => startZoneRipple(lane, event)}
            onClick={() => setOpen((current) => !current)}
            className="kitchen-zone-trigger relative isolate flex min-h-[52px] w-full items-center justify-between gap-3 overflow-hidden bg-gray-100 px-4 py-1.5 text-left text-gray-900 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700"
          >
            {zoneRipple?.lane === lane ? (
              <span
                key={zoneRipple.id}
                aria-hidden="true"
                className="kitchen-zone-ripple"
                style={{ height: zoneRipple.size, left: zoneRipple.x, top: zoneRipple.y, width: zoneRipple.size }}
              />
            ) : null}
            {zoneIconLabel}
            <span className="relative z-10 flex shrink-0 items-center gap-2">
              {zoneCount}
              <span className="grid h-9 w-9 place-items-center text-gray-500 dark:text-gray-300">
                <ChevronDown
                  className={`h-6 w-6 transition-transform duration-200 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
                  strokeWidth={3}
                  aria-hidden="true"
                />
              </span>
            </span>
          </button>
        ) : (
          <div className="flex min-h-[52px] w-full items-center justify-between gap-3 bg-gray-100 px-4 py-1.5 text-gray-900 dark:bg-gray-800 dark:text-white">
            {zoneIconLabel}
            <span className="flex shrink-0 items-center gap-2 pr-1">
              {zoneCount}
            </span>
          </div>
        )}

        <div
          id={contentId}
          aria-hidden={!isOpen}
          inert={isOpen ? undefined : true}
          className={`kitchen-zone-collapse grid ${isOpen ? "kitchen-zone-collapse-open" : ""}`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="kitchen-zone-collapse-content border-t border-gray-200 p-3 sm:p-4 dark:border-gray-800">
              {loading ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {[0, 1, 2, 3].map((index) => (
                    <Skeleton key={index} className="h-52 w-72 shrink-0" />
                  ))}
                </div>
              ) : laneOrders.length ? (
                // Carousel: show ~4 cards across, scroll horizontally for the rest
                // instead of wrapping onto new rows.
                <div className="flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2">
                  {laneOrders.map((order) => (
                    <div
                      key={`${lane}:${kitchenTicketKey(order)}`}
                      className="min-w-[260px] shrink-0 snap-start"
                      style={{ flexBasis: "calc((100% - 2.25rem) / 4)" }}
                    >
                      {renderTicket(order, lane)}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-[13px] font-semibold text-gray-600 dark:text-gray-300">
                  {emptyLabel}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  };

  if (!canView) return <PermissionDenied title={copy.denied} />;

  const recallLocale = language === "th" ? "th-TH" : "en-US";
  const formatClock = (value?: string | null) =>
    value
      ? new Intl.DateTimeFormat(recallLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value))
      : "-";
  const roundFinishAt = (order: Order) =>
    (order.items ?? [])
      .filter((it) => it.status === "ready")
      .reduce<string | null>((latest, it) => {
        const value = it.ready_at ?? it.UpdatedAt ?? null;
        if (!value) return latest;
        if (!latest || new Date(value) > new Date(latest)) return value;
        return latest;
      }, null);
  // Most recently finished round on top; rounds that finished earlier sink down.
  const recallRounds = [...readyOrders].sort(
    (a, b) => new Date(roundFinishAt(b) ?? 0).getTime() - new Date(roundFinishAt(a) ?? 0).getTime(),
  );

  return (
    <OperationalPageShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      subtitle={copy.subtitle}
      showHeader={false}
    >
      <div style={{ fontFamily: "var(--font-latin), var(--font-kitchen), var(--font-kanit), sans-serif" }}>
      <RealtimeConnectionNotice language={language} status={realtimeStatus} className="mb-4" />

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</div>}

      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="ui-press inline-flex h-10 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          {copy.recall}
        </button>
      </div>

      {renderZone("cooking")}

      {cancelTarget ? (
        <div
          {...cancelBackdrop}
          className={`${cancelDialogClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0`}
        >
          <form
            ref={cancelDialogRef}
            onSubmit={cancelItem}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-cancel-title"
            aria-describedby="kitchen-cancel-description"
            className={`${cancelDialogClosing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900`}
          >
            <div className="flex items-start gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-800">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="kitchen-cancel-title" className="text-[15px] font-semibold text-gray-950 dark:text-white">
                  {copy.cancelTitle}
                </h2>
                <p id="kitchen-cancel-description" className="mt-1 text-[13px] leading-5 text-gray-600 dark:text-gray-400">
                  {copy.cancelDescription(cancelTarget.item.menu_name)}
                </p>
              </div>
              <button
                type="button"
                aria-label={copy.keepItem}
                disabled={submittingId !== null}
                onClick={closeCancelDialog}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-4 py-4">
              <label htmlFor="kitchen-cancel-reason" className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                {copy.cancelReason}
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {copy.cancelPresets.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    disabled={submittingId !== null}
                    onClick={() => {
                      setCancelReason(reason);
                      setCancelReasonError("");
                      cancelReasonRef.current?.focus();
                    }}
                    className={`h-9 rounded-md border px-3 text-[12px] font-semibold transition-colors disabled:opacity-50 ${
                      cancelReason === reason
                        ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-950"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-gray-500 dark:hover:bg-gray-800"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <textarea
                ref={cancelReasonRef}
                id="kitchen-cancel-reason"
                value={cancelReason}
                maxLength={500}
                rows={3}
                disabled={submittingId !== null}
                placeholder={copy.cancelPlaceholder}
                aria-invalid={Boolean(cancelReasonError)}
                aria-describedby={cancelReasonError ? "kitchen-cancel-error" : undefined}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                  if (cancelReasonError) setCancelReasonError("");
                }}
                className={`mt-3 w-full resize-none rounded-md border bg-white px-3 py-2.5 text-[13px] leading-5 text-gray-900 outline-none transition-colors placeholder:text-gray-500 disabled:opacity-60 dark:bg-gray-900 dark:text-white ${
                  cancelReasonError
                    ? "border-red-400 focus:border-red-500 dark:border-red-700"
                    : "border-gray-300 focus:border-gray-500 dark:border-gray-700 dark:focus:border-gray-500"
                }`}
              />
              <div className="mt-1 flex min-h-5 items-start justify-between gap-3">
                {cancelReasonError ? (
                  <p id="kitchen-cancel-error" role="alert" className="text-[12px] font-medium text-red-600 dark:text-red-300">
                    {cancelReasonError}
                  </p>
                ) : <span />}
                <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{cancelReason.length}/500</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
              <button
                type="button"
                disabled={submittingId !== null}
                onClick={closeCancelDialog}
                className="h-10 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {copy.keepItem}
              </button>
              <button
                type="submit"
                disabled={submittingId !== null || !cancelReason.trim()}
                className="h-10 rounded-md bg-red-600 px-3 text-[13px] font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
              >
                {copy.confirmCancel}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {historyOpen ? (
        <div
          {...historyBackdrop}
          className="motion-overlay fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kitchen-recall-title"
            className="motion-bottom-sheet flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 id="kitchen-recall-title" className="text-[16px] font-semibold text-gray-950 dark:text-white">{copy.recall}</h2>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label={copy.recallClose}
                className="ui-press grid h-9 w-9 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {recallRounds.length ? (
                <div className="divide-y divide-gray-100 dark:divide-gray-900">
                  {recallRounds.map((order) => {
                    const readyItems = (order.items ?? []).filter((it) => it.status === "ready");
                    const finishAt = roundFinishAt(order);
                    const startAt = readyItems.reduce<string | null>((earliest, it) => {
                      const value = it.sent_at ?? null;
                      if (!value) return earliest;
                      if (!earliest || new Date(value) < new Date(earliest)) return value;
                      return earliest;
                    }, order.kitchen_sent_at ?? null);
                    const secs = durationSeconds(startAt, finishAt);
                    return (
                      <div key={kitchenTicketKey(order)} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-semibold text-gray-950 dark:text-white">{orderLocationLabel(order, language)}</p>
                          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{copy.kitchenBatch(order.kitchen_batch || 1)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[13px] tabular-nums text-gray-700 dark:text-gray-200">{copy.finishedAt} {formatClock(finishAt)}</p>
                          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                            {copy.timeTaken} {secs != null ? copy.recallDuration(Math.floor(secs / 60), secs % 60) : "-"}
                          </p>
                        </div>
                        {canUpdate ? (
                          <button
                            type="button"
                            title={copy.undo}
                            aria-label={copy.undo}
                            disabled={submittingId !== null}
                            onClick={() => recallOrder(order)}
                            className="ui-press grid h-10 w-10 shrink-0 place-items-center rounded-md text-gray-600 hover:bg-amber-100/70 hover:text-amber-800 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-amber-950/35 dark:hover:text-amber-200"
                          >
                            <Undo2 className="h-[18px] w-[18px]" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center px-4 py-10 text-center text-[13px] font-semibold text-gray-600 dark:text-gray-300">
                  {copy.recallEmpty}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </OperationalPageShell>
  );
}
