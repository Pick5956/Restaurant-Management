"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import { AlertTriangle, ArrowLeft, BarChart3, ChevronRight, Info, TrendingUp, Wallet } from "lucide-react";
import PaidReceiptDialog from "@/src/components/orders/PaidReceiptDialog";
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
import type { Bill } from "@/src/types/order";
import type { ManagerReport, SalesDetailReport } from "@/src/types/report";

export default function ReportsPage() {
  // The page glides on the mouse wheel and coasts on after it, like the
  // overview page. The scroller belongs to the shell layout, so it is wired up
  // here and let go when the page is left.
  useEffect(() => smoothScroll(document.querySelector<HTMLElement>("[data-shell-scroll]")), []);
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { href: restaurantPageHref } = useRestaurantNav();
  const lang = language as "th" | "en";
  const canView = can(activeMembership, "view_reports");
  const [report, setReport] = useState<ManagerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The period, chosen by the owner (15 ก.ย. 2569) — the same presets and the
  // same 93-day limit as the app. `draft` is what the date inputs hold until
  // "ดู" applies it, so typing a date does not reload on every keystroke.
  const [today] = useState(() => bangkokToday());
  const [range, setRange] = useState<ReportRange>(() => presetRange("last14", bangkokToday()));
  const [draft, setDraft] = useState<ReportRange>(range);

  const copy = useMemo(() => language === "th"
    ? {
        denied: "ไม่มีสิทธิ์ดูรายงาน",
        back: "กลับหน้าแดชบอร์ด",
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
        afterAll: (value: string) => `รายได้ − รายจ่ายรวม ${value}`,
        entries: (n: number) => `${n} รายการ`,
        beforeDiscount: "ก่อนหักส่วนลด",
        discountNote: (value: string) => `ส่วนลด −${value}`,
        marginInfo: "มาร์จินคืออะไร",
        marginExplain: (per100: string, revenue: string, expenses: string, net: string, margin: string) =>
          `มาร์จินคือส่วนที่เหลือเป็นกำไรสุทธิเมื่อเทียบกับรายได้ · ช่วงนี้ได้รายได้ทุก 100 บาท เหลือ ${per100} บาทหลังหักรายจ่ายทั้งหมด · รายได้ ${revenue} − รายจ่ายรวมทุกหมวด ${expenses} = กำไรสุทธิ ${net} · ${net} ÷ ${revenue} × 100 = ${margin} · วันที่ซื้อของเข้าคลังก้อนใหญ่จะดูกำไรต่ำแม้ของยังอยู่ในคลัง`,
        period: "ช่วงเวลา",
        custom: "กำหนดเอง",
        from: "ตั้งแต่",
        to: "ถึง",
        apply: "ดู",
        days: (n: number) => `${n} วัน`,
        presets: { today: "วันนี้", yesterday: "เมื่อวาน", last7: "7 วันล่าสุด", last14: "14 วันล่าสุด", last30: "30 วันล่าสุด", thisMonth: "เดือนนี้", lastMonth: "เดือนก่อน" } as Record<ReportPreset, string>,
        problems: { order: "วันเริ่มต้องไม่หลังวันจบ", future: "ยังไม่ถึงวันที่เลือก", tooLong: `เลือกได้ไม่เกิน ${REPORT_MAX_DAYS} วัน` },
      }
    : {
        denied: "You do not have permission to view reports.",
        back: "Back to dashboard",
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
        afterAll: (value: string) => `Revenue − expenses ${value}`,
        entries: (n: number) => `${n} entries`,
        beforeDiscount: "Before discounts",
        discountNote: (value: string) => `Discounts −${value}`,
        marginInfo: "What is margin?",
        marginExplain: (per100: string, revenue: string, expenses: string, net: string, margin: string) =>
          `Margin is the share of revenue left as net profit. In this period every 100 baht of revenue left ${per100} baht after all expenses · revenue ${revenue} − all expenses ${expenses} = net profit ${net} · ${net} ÷ ${revenue} × 100 = ${margin} · a day with a big restock shows low profit even though the stock is still on the shelf.`,
        period: "Period",
        custom: "Custom",
        from: "From",
        to: "To",
        apply: "Show",
        days: (n: number) => `${n} days`,
        presets: { today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last14: "Last 14 days", last30: "Last 30 days", thisMonth: "This month", lastMonth: "Last month" } as Record<ReportPreset, string>,
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

  const [marginInfoOpen, setMarginInfoOpen] = useState(false);
  const preset = matchPreset(range, today);
  const draftProblem = rangeProblem(draft, today);
  const applyDraft = () => {
    if (draftProblem) return;
    setRange({ from: draft.from, to: draft.to > today ? today : draft.to });
  };
  const choosePreset = (value: string) => {
    if (value === "custom") return;
    const next = presetRange(value as ReportPreset, today);
    setRange(next);
    setDraft(next);
  };

  if (!canView) return <PermissionDenied title={copy.denied} />;

  return (
    <div className="min-h-dvh bg-slate-100 px-4 py-4 text-gray-900 dark:bg-gray-950 dark:text-white sm:px-6 lg:px-8 lg:py-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="sr-only">{copy.title}</h1>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => { event.preventDefault(); applyDraft(); }}
          >
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-gray-500">
              {copy.period}
              <select
                id="report-period-preset"
                value={preset ?? "custom"}
                onChange={(event) => choosePreset(event.target.value)}
                className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              >
                {REPORT_PRESETS.map((key) => <option key={key} value={key}>{copy.presets[key]}</option>)}
                <option value="custom">{copy.custom}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-gray-500">
              {copy.from}
              <input id="report-period-from" type="date" value={draft.from} max={today} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13px] tabular-nums text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-gray-500">
              {copy.to}
              <input id="report-period-to" type="date" value={draft.to} max={today} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13px] tabular-nums text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100" />
            </label>
            <button
              type="submit"
              disabled={Boolean(draftProblem) || (draft.from === range.from && draft.to === range.to)}
              className="ui-press h-10 rounded-xl bg-orange-600 px-4 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {copy.apply}
            </button>
            <span className="pb-2 text-[12px] text-gray-500 tabular-nums">
              {draftProblem ? <span className="text-red-600">{copy.problems[draftProblem]}</span> : copy.days(rangeDayCount(range))}
            </span>
          </form>
        </div>
        <Link href={restaurantPageHref("/home")} className="ui-press inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {copy.back}
        </Link>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[
              {
                label: copy.grossRevenue,
                value: formatCurrency(report.summary.gross_revenue ?? report.summary.revenue, lang),
                // "ยอดขาย" used to sit beside this card with the same figure
                // whenever no bill had a discount (15 ก.ย. 2569); a discount is
                // now the line under it.
                note: (report.summary.discount ?? 0) > 0
                  ? `${copy.discountNote(formatCurrency(report.summary.discount ?? 0, lang))} · ${formatCurrency(report.summary.revenue, lang)}`
                  : undefined,
                icon: <Wallet className="h-4 w-4" />,
              },
              {
                label: copy.expenses,
                value: formatCurrency(report.summary.expenses ?? 0, lang),
                note: copy.entries(report.summary.expense_count ?? 0),
                icon: <AlertTriangle className="h-4 w-4" />,
              },
              { label: copy.orders, value: formatNumber(report.summary.orders, lang), icon: <BarChart3 className="h-4 w-4" /> },
              {
                label: copy.netProfit,
                value: formatCurrency(report.summary.net_profit ?? report.summary.revenue - (report.summary.expenses ?? 0), lang),
                note: copy.afterAll(formatCurrency(report.summary.expenses ?? 0, lang)),
                icon: <TrendingUp className="h-4 w-4" />,
              },
              {
                label: copy.margin,
                value: `${formatNumber(report.summary.margin, lang)}%`,
                icon: (
                  <button
                    type="button"
                    aria-label={copy.marginInfo}
                    aria-expanded={marginInfoOpen}
                    onClick={() => setMarginInfoOpen((open) => !open)}
                    className="ui-press rounded-full p-0.5 text-orange-700 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950/40"
                  >
                    <Info className="h-4 w-4" aria-hidden="true" />
                  </button>
                ),
              },
            ].map((card: { label: string; value: string; note?: string; icon: React.ReactNode }) => (
              <div key={card.label} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-center justify-between gap-3 text-gray-500">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">{card.label}</span>
                  {card.icon}
                </div>
                <p className="mt-3 text-xl font-semibold tabular-nums">{card.value}</p>
                {card.note ? <p className="mt-1 text-[12px] text-gray-500 tabular-nums">{card.note}</p> : null}
              </div>
            ))}
          </div>
          {marginInfoOpen ? (
            <div role="note" className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-[13px] leading-6 text-orange-900 dark:border-orange-900/40 dark:bg-orange-950/30 dark:text-orange-100">
              <p className="font-semibold">{copy.marginInfo}</p>
              <p>
                {copy.marginExplain(
                  formatNumber(report.summary.margin, lang),
                  formatCurrency(report.summary.revenue, lang),
                  formatCurrency(report.summary.expenses ?? 0, lang),
                  formatCurrency(report.summary.net_profit ?? report.summary.revenue - (report.summary.expenses ?? 0), lang),
                  `${formatNumber(report.summary.margin, lang)}%`,
                )}
              </p>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
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
                              <span className="inline-flex items-center gap-1.5">
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

            <section className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                <h2 className="text-sm font-semibold">{copy.menuMargins}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <th className="px-4 py-3">{copy.menu}</th>
                      <th className="px-4 py-3 text-right">{copy.qty}</th>
                      <th className="px-4 py-3 text-right">{copy.revenue}</th>
                      <th className="px-4 py-3 text-right">{copy.cost}</th>
                      <th className="px-4 py-3 text-right">{copy.margin}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {report.menu_margins.length ? report.menu_margins.map((item) => (
                      <tr key={`${item.menu_id}-${item.menu_name}`}>
                        <td className="px-4 py-3 font-medium">{item.menu_name}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNumber(item.quantity, lang)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.revenue, lang)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.cost, lang)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatNumber(item.margin, lang)}%</td>
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
