"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  Printer,
  Search,
} from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { can } from "@/src/lib/rbac";
import { getOrderBill, listOrders } from "@/src/lib/order";
import type { Bill, Order } from "@/src/types/order";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import OperationalPageShell from "@/src/components/shared/OperationalPageShell";
import { Skeleton } from "@/src/components/shared/Skeleton";
import PaidReceiptDialog from "@/src/components/orders/PaidReceiptDialog";
import { orderPosHref } from "@/src/lib/orderNavigation";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import { canReprintReceipt, itemCount, orderTime, statusClass, tableName, zoneName } from "./ordersPageUtils";

const ORDERS_PAGE_SIZE = 25;

// Build a compact page list with ellipses for the pager, e.g. 1 … 4 5 6 … 20.
function buildPageList(current: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages: (number | "…")[] = [1];
  if (current > 3) pages.push("…");
  for (let i = Math.max(2, current - 1); i <= Math.min(totalPages - 1, current + 1); i += 1) pages.push(i);
  if (current < totalPages - 2) pages.push("…");
  pages.push(totalPages);
  return pages;
}

export default function OrdersPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { href: restaurantPageHref } = useRestaurantNav();
  const canView = can(activeMembership, "view_orders") || can(activeMembership, "take_order");
  const [orders, setOrders] = useState<Order[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [receiptBill, setReceiptBill] = useState<Bill | null>(null);
  const [receiptLoadingId, setReceiptLoadingId] = useState<number | null>(null);
  const requestVersionRef = useRef(0);
  // The search toolbar is a fixed bar under the mobile top bar; this reserves the
  // exact space it takes so the table doesn't slide underneath it. On lg the bar is
  // a sticky element in normal flow (see [data-shell-sticky] in globals.css), so the
  // spacer is hidden there and no measurement is needed.
  const stickyToolbarRef = useRef<HTMLDivElement>(null);
  const [stickyToolbarHeight, setStickyToolbarHeight] = useState(0);

  const copy = language === "th"
    ? {
        denied: "ไม่มีสิทธิ์ดูคลังออเดอร์",
        eyebrow: "Order archive",
        title: "คลังออเดอร์",
        subtitle: "ประวัติออเดอร์ที่ชำระเงินแล้ว สำหรับตรวจสอบยอดเงิน รายการอาหาร และพิมพ์ใบเสร็จซ้ำ",
        all: "ทั้งหมด",
        active: "กำลังใช้งาน",
        open: "เปิดโต๊ะ",
        sent_to_kitchen: "ส่งเข้าครัว",
        cooking: "ครัวกำลังทำ",
        ready: "เสร็จแล้ว",
        served: "เสร็จแล้ว",
        completed: "เสร็จสิ้น",
        cancelled: "ยกเลิก",
        cancelledReservation: "ยกเลิกจอง",
        unpaid: "ยังไม่ชำระ",
        paid: "ชำระแล้ว",
        search: "ค้นหาเลขออเดอร์ โต๊ะ โซน หรือลูกค้า",
        status: "สถานะ",
        payment: "ชำระเงิน",
        order: "ออเดอร์",
        table: "โต๊ะ",
        zone: "โซน",
        dateTime: "วันเวลา",
        total: "ยอดรวม",
        noOrders: "ไม่พบออเดอร์ในเงื่อนไขนี้",
        noOrdersHint: "ลองเปลี่ยนคำค้นหาหรือหมวดหมู่",
        openOrder: "เปิดออเดอร์",
        noAction: "ไม่มีรายการให้ดำเนินการ",
        noAmount: "ไม่มียอดต้องชำระ",
        reprintReceipt: "ดูใบเสร็จ / พิมพ์ซ้ำ",
        receiptLoadError: "โหลดใบเสร็จไม่สำเร็จ",
        previous: "ก่อนหน้า",
        next: "ถัดไป",
        pageOf: (current: number, pages: number) => `หน้า ${current} จาก ${pages}`,
        ordersCount: (count: number) => `${count} ออเดอร์`,
      }
    : {
        denied: "You do not have permission to view the order archive.",
        eyebrow: "Order archive",
        title: "Order archive",
        subtitle: "A record of paid orders — review totals, item snapshots, and reprint receipts.",
        all: "All",
        active: "Active",
        open: "Open table",
        sent_to_kitchen: "Sent",
        cooking: "Cooking",
        ready: "Done",
        served: "Done",
        completed: "Completed",
        cancelled: "Cancelled",
        cancelledReservation: "Reservation cancelled",
        unpaid: "Unpaid",
        paid: "Paid",
        search: "Search order, table, zone, or customer",
        status: "Status",
        payment: "Payment",
        order: "Order",
        table: "Table",
        zone: "Zone",
        dateTime: "Date / time",
        total: "Total",
        noOrders: "No orders match this view",
        noOrdersHint: "Try another search or category.",
        openOrder: "Open order",
        noAction: "No action available",
        noAmount: "No amount due",
        reprintReceipt: "View / reprint receipt",
        receiptLoadError: "Could not load the receipt.",
        previous: "Previous",
        next: "Next",
        pageOf: (current: number, pages: number) => `Page ${current} of ${pages}`,
        ordersCount: (count: number) => `${count} orders`,
      };

  const locale = language === "th" ? "th-TH" : "en-US";
  const actionLabel = language === "th" ? "จัดการ" : "Action";
  const statusLabel = (status: string) => (copy as unknown as Record<string, string>)[status] ?? status;
  const money = (amount: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 0,
    }).format(amount);

  const formatTime = (value?: string | null) => {
    if (!value) return "-";
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }).format(new Date(value));
  };

  const ordersLoadError = language === "th" ? "โหลดออเดอร์ไม่สำเร็จ" : "Could not load orders.";

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchOrders = useCallback(async (pageToLoad: number) => {
    if (!canView) return;
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setLoading(true);
    setError("");

    try {
      // The archive keeps paid orders only — a true transaction history. Live,
      // unbilled tables (open/cooking/served/…) belong on the floor view, not here.
      const response = await listOrders({
        payment_status: "paid",
        search: debouncedQuery || undefined,
        page: pageToLoad,
        limit: ORDERS_PAGE_SIZE,
      });
      if (requestVersion !== requestVersionRef.current) return;

      const nextOrders = response.data.orders ?? [];
      setOrders(nextOrders);
      setPage(response.data.pagination?.page ?? pageToLoad);
      setTotal(response.data.pagination?.total ?? nextOrders.length);
    } catch {
      if (requestVersion === requestVersionRef.current) {
        setOrders([]);
        setError(ordersLoadError);
      }
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false);
    }
  }, [canView, debouncedQuery, ordersLoadError]);

  // Reload from the first page whenever the filter or search changes.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    void fetchOrders(1);
  }, [fetchOrders]);

  // Track the fixed toolbar's height so the mobile spacer matches it exactly.
  useEffect(() => {
    const node = stickyToolbarRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setStickyToolbarHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [canView]);

  const totalPages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const pageList = buildPageList(page, totalPages);
  const goToPage = (next: number) => {
    if (loading || next < 1 || next > totalPages || next === page) return;
    window.scrollTo({ top: 0 });
    void fetchOrders(next);
  };

  const openReceipt = async (order: Order) => {
    if (!canReprintReceipt(order)) return;
    setReceiptLoadingId(order.ID);
    setError("");
    try {
      const response = await getOrderBill(order.ID);
      setReceiptBill(response.data);
    } catch (error) {
      setError(apiErrorMessage(error) || copy.receiptLoadError);
    } finally {
      setReceiptLoadingId(null);
    }
  };

  if (!canView) return <PermissionDenied title={copy.denied} />;

  return (
    <>
      <div
        data-shell-sticky=""
        ref={stickyToolbarRef}
        className="fixed inset-x-0 top-0 z-20 bg-white/82 backdrop-blur-md dark:bg-[#0f0f0f]/82 transition-[left] duration-300 ease-in-out lg:inset-auto"
      >
        <h1 className="sr-only">{copy.title}</h1>
        <div className="px-4 py-2 sm:px-6 lg:px-8 lg:pb-2 lg:pt-4">
          <div className="w-full max-w-lg">
            <label className="relative block w-full min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.search}
                aria-label={copy.search}
                className="h-10 w-full rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white pl-7 pr-3 text-[13px] outline-none focus:border-orange-500 shadow-(--dashboard-control-shadow) dark:bg-gray-800"
              />
            </label>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="lg:hidden" style={{ height: stickyToolbarHeight }} />
      <OperationalPageShell
        eyebrow={copy.eyebrow}
        title={copy.title}
        subtitle={copy.subtitle}
        showHeader={false}
      >

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <div className="lg:min-w-[980px]">
            <div className="hidden border-b border-gray-200 px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400 lg:grid lg:grid-cols-[minmax(90px,0.8fr)_minmax(80px,0.7fr)_minmax(100px,1fr)_minmax(120px,1fr)_minmax(90px,0.8fr)_minmax(90px,0.8fr)_minmax(100px,0.9fr)_minmax(170px,1.4fr)] lg:items-center lg:gap-3">
              <span>{copy.order}</span>
              <span>{copy.table}</span>
              <span>{copy.zone}</span>
              <span>{copy.dateTime}</span>
              <span>{copy.status}</span>
              <span>{copy.payment}</span>
              <span>{copy.total}</span>
              <span>{actionLabel}</span>
            </div>

            {loading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-20" />
                ))}
              </div>
            ) : orders.length ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-900">
                {orders.map((order, index) => {
                  // A cancelled order with nothing ordered is a cancelled reservation /
                  // no-show: there is no order to open, so we relabel it and drop the action.
                  const isCancelled = order.status === "cancelled";
                  const isEmptyCancelled = isCancelled && itemCount(order) === 0;
                  const orderStatusText = isEmptyCancelled ? copy.cancelledReservation : statusLabel(order.status);
                  return (
                  <div
                    key={order.ID}
                    className={`grid w-full gap-3 px-4 py-3 text-left text-[14px] transition-colors lg:grid-cols-[minmax(90px,0.8fr)_minmax(80px,0.7fr)_minmax(100px,1fr)_minmax(120px,1fr)_minmax(90px,0.8fr)_minmax(90px,0.8fr)_minmax(100px,0.9fr)_minmax(170px,1.4fr)] lg:items-center ${
                      index % 2 === 0
                        ? "bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800/70"
                        : "bg-slate-100/70 hover:bg-slate-200/70 dark:bg-gray-800/55 dark:hover:bg-gray-800/80"
                    }`}
                  >
                    <div className="min-w-0 lg:w-full lg:text-center">
                      <div className="flex min-w-0 items-center gap-2 lg:justify-center">
                        <p className="truncate font-mono text-[14px] font-medium text-gray-800 dark:text-gray-100">{order.order_number}</p>
                        <span className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[12px] font-semibold lg:hidden ${statusClass[order.status]}`}>
                          {orderStatusText}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-500 dark:text-gray-400 lg:hidden">
                        <span className="font-medium text-gray-700 dark:text-gray-200">{tableName(order, language)}</span>
                        {zoneName(order) && <span>{zoneName(order)}</span>}
                        <span>{formatTime(orderTime(order))}</span>
                      </div>
                    </div>
                    <span className="hidden truncate text-center font-medium text-gray-700 dark:text-gray-200 lg:block">
                      {tableName(order, language)}
                    </span>
                    <span className="hidden truncate text-center text-gray-500 dark:text-gray-400 lg:block">
                      {zoneName(order) || "-"}
                    </span>
                    <span className="hidden whitespace-nowrap text-center text-[13px] tabular-nums text-gray-500 dark:text-gray-400 lg:block">
                      {formatTime(orderTime(order))}
                    </span>
                    <span className={`hidden w-fit justify-self-center rounded-md border px-2 py-1 text-[12px] font-semibold lg:inline-flex ${statusClass[order.status]}`}>
                      {orderStatusText}
                    </span>
                    {/* A cancelled order owes nothing, so "unpaid" would falsely imply a pending charge. */}
                    <span className="font-medium text-gray-600 dark:text-gray-300 lg:text-center">
                      {isCancelled
                        ? <span className="text-gray-300 dark:text-gray-600" aria-label={copy.noAmount} title={copy.noAmount}>—</span>
                        : statusLabel(order.payment_status)}
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-gray-950 dark:text-white lg:text-center">
                      {money(order.grand_total || order.total_amount)}
                    </span>
                    <div className="flex justify-end lg:justify-center">
                      {canReprintReceipt(order) ? (
                        <button
                          type="button"
                          disabled={receiptLoadingId === order.ID}
                          onClick={() => { void openReceipt(order); }}
                          className="ui-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800 lg:w-auto"
                        >
                          <Printer className="h-4 w-4" aria-hidden="true" />
                          {copy.reprintReceipt}
                        </button>
                      ) : isEmptyCancelled ? (
                        <span
                          className="inline-flex h-10 w-full items-center justify-center text-[14px] font-semibold text-gray-300 dark:text-gray-600 lg:w-auto lg:px-3"
                          aria-label={copy.noAction}
                          title={copy.noAction}
                        >
                          —
                        </span>
                      ) : (
                        <Link
                          href={restaurantPageHref(orderPosHref(order))}
                          className="ui-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 lg:w-auto"
                        >
                          {copy.openOrder}
                          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[360px] items-center justify-center px-4 py-12 text-center">
                <div>
                  <Archive className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-700" />
                  <p className="mt-3 text-[15px] font-semibold text-gray-900 dark:text-white">{copy.noOrders}</p>
                  <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{copy.noOrdersHint}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!loading && totalPages > 1 ? (
        <nav aria-label={language === "th" ? "แบ่งหน้า" : "Pagination"} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            {copy.pageOf(page, totalPages)} · {copy.ordersCount(total)}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={loading || page <= 1}
              className="ui-press inline-flex h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              ‹ {copy.previous}
            </button>
            <div className="hidden items-center gap-1 sm:flex">
              {pageList.map((entry, index) =>
                entry === "…" ? (
                  <span key={`gap-${index}`} className="px-2 text-[13px] text-gray-400 dark:text-gray-600">…</span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => goToPage(entry)}
                    aria-current={entry === page ? "page" : undefined}
                    className={`ui-press inline-flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-[13px] font-semibold tabular-nums ${
                      entry === page
                        ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                    }`}
                  >
                    {entry}
                  </button>
                ),
              )}
            </div>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={loading || page >= totalPages}
              className="ui-press inline-flex h-9 items-center gap-1 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {copy.next} ›
            </button>
          </div>
        </nav>
      ) : null}

      {receiptBill ? (
        <PaidReceiptDialog
          bill={receiptBill}
          language={language}
          locationLabel={tableName(receiptBill.order, language)}
          restaurant={activeMembership?.restaurant}
          onClose={() => setReceiptBill(null)}
        />
      ) : null}

      </OperationalPageShell>
    </>
  );
}
