"use client";

import { useEffect, useMemo, useState } from "react";
import DateRangeButton from "@/src/components/shared/DateRangeButton";
import { ChevronRight } from "lucide-react";
import PaidReceiptDialog from "@/src/components/orders/PaidReceiptDialog";
import ReportSummaryCards from "./ReportSummaryCards";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { RestaurantCardSkeleton } from "@/src/components/shared/Skeleton";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { smoothScroll } from "@/src/hooks/smoothScroll";
import { formatCurrency, formatNumber } from "@/src/lib/format";
import { getOrderBill } from "@/src/lib/order";
import { can } from "@/src/lib/rbac";
import { getManagerReportRange, getSalesDetail } from "@/src/lib/report";
import {
  bangkokToday,
  matchPreset,
  presetRange,
  rangeDayCount,
  rangeProblem,
  REPORT_MAX_DAYS,
  REPORT_PRESETS,
  type ReportPreset,
  type ReportRange,
} from "@/src/lib/reportRange";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { tableName } from "@/src/app/(dashboard)/r/[slug]/orders/ordersPageUtils";
import { formatHistoryRange } from "@/src/app/(dashboard)/r/[slug]/inventory/inventoryHistoryUtils";
import type { Bill } from "@/src/types/order";
import type { ManagerReport, SalesDetailReport } from "@/src/types/report";

export default function ReportsPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const lang = language as "th" | "en";
  const canView = can(activeMembership, "view_reports");
  const [report, setReport] = useState<ManagerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The period, chosen by the owner (15 ก.ย. 2569) — the same presets and the
  // same 93-day limit as the app. `draft` is what the date fields hold; it
  // becomes `range` once it is a range the server accepts.
  const [today] = useState(() => bangkokToday());
  const [range, setRange] = useState<ReportRange>(() => presetRange("last14", bangkokToday()));
  const [draft, setDraft] = useState<ReportRange>(range);

  const copy = useMemo(() => language === "th"
    ? {
        denied: "ไม่มีสิทธิ์ดูรายงาน",
        eyebrow: "Reports",
        title: "รายงานผู้จัดการ",
        subtitle: "ยอดขาย ต้นทุนเมนู และวัตถุดิบเสี่ยงจากข้อมูลขายจริง",
        loadError: "โหลดรายงานไม่สำเร็จ",
        revenue: "ยอดขาย",
        orders: "ออเดอร์",
        foodCost: "ต้นทุนวัตถุดิบ",
        profit: "กำไรขั้นต้น",
        margin: "มาร์จิน",
        salesDays: "ยอดขายรายวัน",
        menuMargins: "เมนูและกำไร",
        menu: "เมนู",
        qty: "จำนวน",
        cost: "ต้นทุน",
        noData: "ยังไม่มีข้อมูลในช่วงนี้",
        date: "วันที่",
        time: "เวลา",
        table: "โต๊ะ",
        order: "ออเดอร์",
        loadingDay: "กำลังโหลดรายการของวันนี้...",
        dayCapped: "แสดงเฉพาะรายการแรกของวันนี้",
        close: "ปิด",
        receiptError: "เปิดใบเสร็จไม่สำเร็จ",
        grossRevenue: "รายได้รวม",
        expenses: "รายจ่ายรวม",
        netProfit: "กำไรสุทธิ",
        beforeDiscount: "ก่อนหักส่วนลด",
        discountNote: (discount: string, received: string) => `หักส่วนลดโปร ${discount} แล้ว รับเงินจริง ${received}`,
        marginInfo: "มาร์จินคืออะไร",
        period: "ช่วงเวลา",
        from: "ตั้งแต่",
        to: "ถึง",
        days: (n: number) => `${n} วัน`,
        presets: { today: "วันนี้", yesterday: "เมื่อวาน", last7: "7 วัน", last14: "14 วัน", last30: "30 วัน", thisMonth: "เดือนนี้", lastMonth: "เดือนก่อน" } as Record<ReportPreset, string>,
        problems: { order: "วันเริ่มต้องไม่หลังวันจบ", future: "ยังไม่ถึงวันที่เลือก", tooLong: `เลือกได้ไม่เกิน ${REPORT_MAX_DAYS} วัน` },
      }
    : {
        denied: "You do not have permission to view reports.",
        eyebrow: "Reports",
        title: "Manager report",
        subtitle: "Sales, menu food cost, and stock risks from real order data.",
        loadError: "Could not load report.",
        revenue: "Revenue",
        orders: "Orders",
        foodCost: "Food cost",
        profit: "Gross profit",
        margin: "Margin",
        salesDays: "Daily sales",
        menuMargins: "Menu margin",
        menu: "Menu",
        qty: "Qty",
        cost: "Cost",
        noData: "No data in this period yet.",
        date: "Date",
        time: "Time",
        table: "Table",
        order: "Order",
        loadingDay: "Loading this day's orders...",
        dayCapped: "Showing the first orders of this day only.",
        close: "Close",
        receiptError: "Could not open that receipt.",
        grossRevenue: "Gross revenue",
        expenses: "Total expenses",
        netProfit: "Net profit",
        beforeDiscount: "Before discounts",
        discountNote: (discount: string, received: string) => `After ${discount} in promotion discounts, ${received} received`,
        marginInfo: "What is margin?",
        period: "Period",
        from: "From",
        to: "To",
        days: (n: number) => `${n} days`,
        presets: { today: "Today", yesterday: "Yesterday", last7: "7 days", last14: "14 days", last30: "30 days", thisMonth: "This month", lastMonth: "Last month" } as Record<ReportPreset, string>,
        problems: { order: "The start must not be after the end", future: "That day has not come yet", tooLong: `Choose ${REPORT_MAX_DAYS} days or fewer` },
      }, [language]);

  // A day opens in a dialog. Only one is open at a time, so a single slot for
  // the fetched day is enough — reopening a day refetches it.
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<SalesDetailReport | null>(null);
  const [dayDetailLoading, setDayDetailLoading] = useState(false);
  const [dayDetailFailed, setDayDetailFailed] = useState(false);
  const toggleDay = (date: string) => setOpenDay((current) => (current === date ? null : date));
  const dayBackdrop = useBackdropClose(() => setOpenDay(null));

  // The receipt dialog stacks on top of the day dialog, so the day stays open
  // underneath and closing the receipt lands back on the same order list.
  const [receiptBill, setReceiptBill] = useState<Bill | null>(null);
  const [receiptLoadingId, setReceiptLoadingId] = useState<number | null>(null);
  const [receiptError, setReceiptError] = useState("");

  const openReceipt = async (orderId: number) => {
    setReceiptLoadingId(orderId);
    setReceiptError("");
    try {
      const res = await getOrderBill(orderId);
      setReceiptBill(res.data);
    } catch {
      setReceiptError(copy.receiptError);
    } finally {
      setReceiptLoadingId(null);
    }
  };

  useEffect(() => {
    if (!openDay) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [openDay]);

  useEffect(() => {
    if (!openDay) return;
    let cancelled = false;
    setDayDetailLoading(true);
    setDayDetailFailed(false);
    setDayDetail(null);
    getSalesDetail(openDay)
      .then((res) => {
        if (!cancelled) setDayDetail(res.data);
      })
      .catch(() => {
        if (!cancelled) setDayDetailFailed(true);
      })
      .finally(() => {
        if (!cancelled) setDayDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openDay]);

  const load = async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await getManagerReportRange(range.from, range.to);
      setReport(res.data);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(loadTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, language, range.from, range.to]);

  const preset = matchPreset(range, today);
  const draftProblem = rangeProblem(draft, today);
  // A typed date applies as soon as the range is one the server accepts; until
  // then the note under the fields says why, and the report stays as it was.
  const editDraft = (next: ReportRange) => {
    setDraft(next);
    if (rangeProblem(next, today)) return;
    setRange({ from: next.from, to: next.to > today ? today : next.to });
  };
  const choosePreset = (value: ReportPreset) => {
    const next = presetRange(value, today);
    setRange(next);
    setDraft(next);
  };

  if (!canView) return <PermissionDenied title={copy.denied} />;

  // Net profit = revenue − recipe cost − expenses that are not ingredient
  // purchases (26 ก.ย. 2569). The fallback is the same formula for a server
  // that does not send net_profit.
  const operatingExpenses = report?.summary.operating_expenses ?? 0;
  const netProfit = report ? (report.summary.net_profit ?? report.summary.profit - operatingExpenses) : 0;

  return (
    <div className="min-h-dvh bg-slate-100 px-4 py-4 text-gray-900 dark:bg-gray-950 dark:text-white sm:px-6 lg:px-8 lg:py-6">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="sr-only">{copy.title}</h1>
        {/* The same range button as the inventory history (26 ก.ย. 2569), in
            place of a dropdown, two date fields and a "ดู" button. */}
        <DateRangeButton
          label={formatHistoryRange(range.from, range.to, lang)}
          ariaLabel={copy.period}
          presets={REPORT_PRESETS.map((key) => ({ key, label: copy.presets[key] }))}
          activeKey={preset}
          onPreset={choosePreset}
          from={draft.from}
          to={draft.to}
          onFrom={(from) => editDraft({ ...draft, from })}
          onTo={(to) => editDraft({ ...draft, to })}
          fromLabel={copy.from}
          toLabel={copy.to}
          maxDate={today}
          highlighted={preset !== "last14"}
          note={draftProblem ? <span className="text-red-600 dark:text-red-400">{copy.problems[draftProblem]}</span> : null}
        />
        <span className="text-[12px] text-gray-500 tabular-nums">{copy.days(rangeDayCount(range))}</span>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          <RestaurantCardSkeleton />
          <RestaurantCardSkeleton />
          <RestaurantCardSkeleton />
        </div>
      ) : report ? (
        <div className="space-y-4">
          <ReportSummaryCards
            summary={report.summary}
            netProfit={netProfit}
            operatingExpenses={operatingExpenses}
            lang={lang}
            copy={copy}
          />

          <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
            <section className="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <h2 className="text-sm font-semibold">{copy.salesDays}</h2>
              </div>
              {report.sales_days.length ? (
                // overflow-y-hidden: a hovered row's lift and tilt push past the
                // table box, and a scroll container counts that as content to
                // scroll to. Clip it instead of growing a stray scrollbar.
                <div className="overflow-x-auto overflow-y-hidden">
                  {/* border-separate so a hovered row can cast a shadow; the
                      dividers move onto the cells to survive it. */}
                  <table className="w-full min-w-[420px] border-separate border-spacing-0 text-left text-sm [&_tbody_td]:border-b [&_tbody_td]:border-gray-100 dark:[&_tbody_td]:border-gray-800">
                    <thead className="text-xs text-gray-500">
                      <tr className="[&_th]:border-b [&_th]:border-gray-200 dark:[&_th]:border-gray-800">
                        <th className="px-4 py-2 font-medium">{copy.date}</th>
                        <th className="px-4 py-2 text-right font-medium">{copy.orders}</th>
                        <th className="px-4 py-2 text-right font-medium">{copy.revenue}</th>
                        <th className="px-4 py-2 text-right font-medium">{copy.profit}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.sales_days.map((day) => {
                        const open = openDay === day.order_date;
                        return (
                          <tr
                            key={day.order_date}
                            onClick={() => toggleDay(day.order_date)}
                            aria-haspopup="dialog"
                            className={`cursor-pointer transition-colors ${open ? "bg-gray-100 dark:bg-gray-800" : "bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800/60"}`}
                          >
                            <td className="px-4 py-2.5 font-medium">
                              {/* flex, not inline-flex: an inline box with the
                                  icon sat on the text baseline and made each row
                                  2px taller than the menu table's rows. */}
                              <span className="flex items-center gap-1.5">
                                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                                {day.order_date}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">{formatNumber(day.orders, lang)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(day.revenue, lang)}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${day.profit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                              {formatCurrency(day.profit, lang)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-8 text-center text-sm text-gray-500">{copy.noData}</p>
              )}
            </section>

            {/* overflow-hidden also makes the section a scroll box, so the grid
                lets it shrink to the phone's width and the table scrolls inside.
                Without it the 560px table pushed the section past the screen,
                where the page clips it and nothing scrolls (28 ก.ย. 2569). */}
            <section className="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <h2 className="text-sm font-semibold">{copy.menuMargins}</h2>
              </div>
              <div className="overflow-x-auto">
                {/* The same header and row sizes as the daily table beside it, so
                    their lines run level across the page (28 ก.ย. 2569). */}
                <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left text-sm [&_tbody_td]:border-b [&_tbody_td]:border-gray-100 dark:[&_tbody_td]:border-gray-800">
                  <thead className="text-xs text-gray-500">
                    <tr className="[&_th]:border-b [&_th]:border-gray-200 dark:[&_th]:border-gray-800">
                      <th className="px-4 py-2 font-medium">{copy.menu}</th>
                      <th className="px-4 py-2 text-right font-medium">{copy.qty}</th>
                      <th className="px-4 py-2 text-right font-medium">{copy.revenue}</th>
                      <th className="px-4 py-2 text-right font-medium">{copy.cost}</th>
                      <th className="px-4 py-2 text-right font-medium">{copy.margin}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.menu_margins.length ? report.menu_margins.map((item) => (
                      <tr key={`${item.menu_id}-${item.menu_name}`}>
                        <td className="px-4 py-2.5 font-medium">{item.menu_name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(item.quantity, lang)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(item.revenue, lang)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(item.cost, lang)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatNumber(item.margin, lang)}%</td>
                      </tr>
                    )) : <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">{copy.noData}</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

        </div>
      ) : null}

      {openDay ? (
        <div {...dayBackdrop} className="motion-overlay fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="sales-day-title" className="motion-dialog flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900 sm:max-h-[calc(100vh-2rem)]">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800 sm:px-5">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{copy.salesDays}</p>
                <h2 id="sales-day-title" className="mt-0.5 text-[16px] font-semibold text-gray-950 dark:text-white">{openDay}</h2>
              </div>
              <button type="button" onClick={() => setOpenDay(null)} className="ui-press h-9 shrink-0 rounded-xl border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">{copy.close}</button>
            </div>

            <div ref={smoothScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
              {receiptError ? <p className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{receiptError}</p> : null}
              {dayDetailLoading ? (
                <p className="py-8 text-center text-xs text-gray-500">{copy.loadingDay}</p>
              ) : dayDetail?.orders.length ? (
                <>
                  <div className="overflow-x-auto overflow-y-hidden">
                  <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left text-xs [&_tbody_td]:border-b [&_tbody_td]:border-gray-200 dark:[&_tbody_td]:border-gray-800">
                    <thead className="text-gray-500">
                      <tr>
                        <th className="py-1 font-medium">{copy.order}</th>
                        <th className="py-1 font-medium">{copy.table}</th>
                        <th className="py-1 text-right font-medium">{copy.time}</th>
                        <th className="py-1 text-right font-medium">{copy.revenue}</th>
                        <th className="py-1 text-right font-medium">{copy.cost}</th>
                        <th className="py-1 text-right font-medium">{copy.profit}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayDetail.orders.map((order) => (
                        <tr
                          key={order.order_id}
                          onClick={() => void openReceipt(order.order_id)}
                          aria-haspopup="dialog"
                          aria-busy={receiptLoadingId === order.order_id}
                          className={`cursor-pointer bg-white transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800/60 ${receiptLoadingId === order.order_id ? "opacity-50" : ""}`}
                        >
                          <td className="py-1.5 font-mono">{order.order_number}</td>
                          <td className="py-1.5 truncate">{order.table_label || order.customer_name || "-"}</td>
                          <td className="py-1.5 text-right font-mono text-gray-500">
                            {new Date(order.completed_at).toLocaleTimeString(lang === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{formatCurrency(order.revenue, lang)}</td>
                          <td className="py-1.5 text-right tabular-nums text-gray-500">{formatCurrency(order.cost, lang)}</td>
                          <td className={`py-1.5 text-right font-semibold tabular-nums ${order.profit < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                            {formatCurrency(order.profit, lang)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                  {dayDetail.has_more ? <p className="pt-2 text-center text-[11px] text-gray-500">{copy.dayCapped}</p> : null}
                </>
              ) : (
                <p className="py-8 text-center text-xs text-gray-500">{dayDetailFailed ? copy.loadError : copy.noData}</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {receiptBill ? (
        <PaidReceiptDialog
          bill={receiptBill}
          language={lang}
          locationLabel={tableName(receiptBill.order, lang)}
          restaurant={activeMembership?.restaurant}
          paper="a4"
          onClose={() => setReceiptBill(null)}
        />
      ) : null}
    </div>
  );
}
