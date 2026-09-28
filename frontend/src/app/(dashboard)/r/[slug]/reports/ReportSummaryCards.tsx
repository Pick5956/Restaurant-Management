"use client";

import { useEffect, useRef, useState } from "react";
import { Info, ReceiptText, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { formatCurrency, formatNumber } from "@/src/lib/format";
import type { ManagerReport } from "@/src/types/report";

type Summary = ManagerReport["summary"];

const card = "rounded-2xl border border-gray-200 bg-white shadow-(--dashboard-control-shadow) dark:border-gray-800 dark:bg-gray-900";
const label = "text-[12px] font-semibold text-gray-500 dark:text-gray-400";

// Each figure keeps one colour everywhere it appears: orange for revenue and
// margin (the site's own), rose for money out, amber for ingredient cost and
// orders, emerald for profit.
const tone = {
  orange: { icon: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400", bar: "bg-orange-500 dark:bg-orange-400", stroke: "stroke-orange-500 dark:stroke-orange-400" },
  rose: { icon: "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400", bar: "bg-rose-500 dark:bg-rose-400" },
  amber: { icon: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400", bar: "bg-amber-500 dark:bg-amber-400" },
  emerald: { icon: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400", bar: "bg-emerald-500 dark:bg-emerald-400" },
};

function IconChip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${className}`}>{children}</span>;
}

/** The margin as a ring. A loss leaves it empty rather than drawing backwards. */
function MarginRing({ margin }: { margin: number }) {
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const filled = (circumference * Math.min(Math.max(margin, 0), 100)) / 100;
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 -rotate-90" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="5" className="stroke-gray-100 dark:stroke-gray-800" />
      <circle cx="18" cy="18" r={r} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`} className={tone.orange.stroke} />
    </svg>
  );
}

/**
 * The margin explained in a bubble over the page (28 ก.ย. 2569), in place of a
 * note that pushed the tables down. A mouse opens it on hover; a tap pins it
 * open until a tap elsewhere or Escape, since a touch screen has no hover.
 */
function MarginTip({ label, title, per100, sum, note }: { label: string; title: string; per100: string; sum: string; note: string }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const open = hovered || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setPinned(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span
      ref={boxRef}
      className="relative ml-auto self-start"
      onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setPinned((value) => !value)}
        className="ui-press rounded-full p-0.5 text-orange-700 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950/40"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className={`absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-gray-900 px-3.5 py-3 text-[12px] leading-5 text-white shadow-xl transition-[opacity,translate] duration-150 ease-out dark:bg-white dark:text-gray-900 ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <span className="absolute bottom-full right-2 border-[6px] border-transparent border-b-gray-900 dark:border-b-white" />
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block">{per100}</span>
        <span className="mt-1 block tabular-nums text-gray-300 dark:text-gray-600">{sum}</span>
        <span className="mt-1.5 block text-[11px] text-gray-400 dark:text-gray-500">{note}</span>
      </span>
    </span>
  );
}

/**
 * The five figures at the top of the revenue page (26 ก.ย. 2569, the owner's
 * pick "แบบ A ย่อ"): revenue on the left with a bar of where that money went,
 * the other four as short cards in a 2×2 beside it. The 2×2 is the height of
 * the revenue card, so no card is stretched over empty space.
 */
export default function ReportSummaryCards({
  summary,
  netProfit,
  operatingExpenses,
  lang,
  copy,
}: {
  summary: Summary;
  netProfit: number;
  operatingExpenses: number;
  lang: "th" | "en";
  copy: {
    grossRevenue: string;
    expenses: string;
    orders: string;
    netProfit: string;
    margin: string;
    marginInfo: string;
    discountNote: (discount: string, received: string) => string;
  };
}) {
  const money = (value: number) => formatCurrency(value, lang);
  const text = lang === "th"
    ? {
        cost: "ต้นทุน", other: "รายจ่ายอื่น", profit: "กำไร", perBill: "เฉลี่ย", perBillUnit: "/ บิล", split: "รายได้แบ่งเป็นต้นทุนวัตถุดิบ รายจ่ายอื่น และกำไร",
        tipTitle: "มาร์จิน = กำไรสุทธิ ÷ รายได้",
        tipPer100: (value: string) => `ขายได้ 100 บาท เหลือเป็นกำไร ${value} บาท`,
        tipSum: (revenue: string, cost: string, other: string, net: string) => `${revenue} − ต้นทุน ${cost} − รายจ่ายอื่น ${other} = กำไร ${net}`,
        tipNote: "ค่าซื้อวัตถุดิบไม่หักซ้ำ เพราะนับในต้นทุนแล้ว",
      }
    : {
        cost: "Food cost", other: "Other", profit: "Profit", perBill: "Avg", perBillUnit: "/ bill", split: "Revenue split into food cost, other expenses and profit",
        tipTitle: "Margin = net profit ÷ revenue",
        tipPer100: (value: string) => `Every 100 baht sold leaves ${value} baht profit`,
        tipSum: (revenue: string, cost: string, other: string, net: string) => `${revenue} − cost ${cost} − other ${other} = profit ${net}`,
        tipNote: "Ingredient purchases aren't taken off twice; the cost already counts them.",
      };

  // The bar splits revenue after discounts, which is what cost + other + net
  // add up to. A loss makes the costs larger than revenue; the bar then scales
  // to the costs and the profit part is simply absent.
  const profitPart = Math.max(netProfit, 0);
  const whole = Math.max(summary.revenue, summary.cost + operatingExpenses + profitPart, 1);
  const share = (value: number) => `${(Math.max(value, 0) / whole) * 100}%`;
  const discount = summary.discount ?? 0;
  const perBill = summary.orders > 0 ? summary.revenue / summary.orders : 0;
  const loss = netProfit < 0;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.6fr)]">
      <div className={`${card} flex flex-col px-4 py-3.5`}>
        <div className="flex items-center justify-between gap-3">
          <span className={label}>{copy.grossRevenue}</span>
          <IconChip className={tone.orange.icon}><Wallet className="h-4 w-4" aria-hidden="true" /></IconChip>
        </div>
        <p className="text-[24px] font-bold leading-tight tracking-tight tabular-nums">{money(summary.gross_revenue ?? summary.revenue)}</p>
        {discount > 0 ? (
          <p className="text-[11px] text-gray-500 tabular-nums dark:text-gray-400">{copy.discountNote(money(discount), money(summary.revenue))}</p>
        ) : null}
        <div className="mt-auto pt-2.5">
        <div role="img" aria-label={text.split} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <span className={tone.amber.bar} style={{ width: share(summary.cost) }} />
          {operatingExpenses > 0 ? <span className={tone.rose.bar} style={{ width: share(operatingExpenses), minWidth: 4 }} /> : null}
          {profitPart > 0 ? <span className={`${tone.emerald.bar} flex-1`} /> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 tabular-nums dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5"><i className={`inline-block h-1.5 w-1.5 rounded-full ${tone.amber.bar}`} />{text.cost} <b className="font-semibold text-gray-900 dark:text-gray-100">{money(summary.cost)}</b></span>
          <span className="inline-flex items-center gap-1.5"><i className={`inline-block h-1.5 w-1.5 rounded-full ${tone.rose.bar}`} />{text.other} <b className="font-semibold text-gray-900 dark:text-gray-100">{money(operatingExpenses)}</b></span>
          <span className="inline-flex items-center gap-1.5"><i className={`inline-block h-1.5 w-1.5 rounded-full ${tone.emerald.bar}`} />{text.profit} <b className="font-semibold text-gray-900 dark:text-gray-100">{money(netProfit)}</b></span>
        </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={`${card} flex items-center gap-3 px-3.5 py-2.5`}>
          <IconChip className={loss ? tone.rose.icon : tone.emerald.icon}><TrendingUp className="h-4 w-4" aria-hidden="true" /></IconChip>
          <div className="min-w-0">
            <p className={label}>{copy.netProfit}</p>
            <p className={`text-[19px] font-bold tracking-tight tabular-nums ${loss ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{money(netProfit)}</p>
          </div>
        </div>
        <div className={`${card} flex items-center gap-3 px-3.5 py-2.5`}>
          <IconChip className={tone.rose.icon}><ReceiptText className="h-4 w-4" aria-hidden="true" /></IconChip>
          <div className="min-w-0">
            <p className={label}>{copy.expenses}</p>
            <p className="text-[19px] font-bold tracking-tight tabular-nums">{money(summary.expenses ?? 0)}</p>
          </div>
        </div>
        <div className={`${card} flex items-center gap-3 px-3.5 py-2.5`}>
          <IconChip className={tone.amber.icon}><ShoppingBag className="h-4 w-4" aria-hidden="true" /></IconChip>
          <div className="min-w-0">
            <p className={label}>{copy.orders}</p>
            <p className="text-[19px] font-bold tracking-tight tabular-nums">{formatNumber(summary.orders, lang)}</p>
          </div>
          {summary.orders > 0 ? (
            <p className="ml-auto hidden text-right text-[11px] leading-snug text-gray-500 tabular-nums dark:text-gray-400 sm:block">
              {text.perBill}<br />{money(Math.round(perBill))} {text.perBillUnit}
            </p>
          ) : null}
        </div>
        <div className={`${card} flex items-center gap-3 px-3.5 py-2.5`}>
          <MarginRing margin={summary.margin} />
          <div className="min-w-0">
            <p className={label}>{copy.margin}</p>
            <p className="text-[19px] font-bold tracking-tight tabular-nums">{formatNumber(summary.margin, lang)}%</p>
          </div>
          <MarginTip
            label={copy.marginInfo}
            title={text.tipTitle}
            per100={text.tipPer100(formatNumber(summary.margin, lang))}
            sum={text.tipSum(money(summary.revenue), money(summary.cost), money(operatingExpenses), money(netProfit))}
            note={text.tipNote}
          />
        </div>
      </div>
    </div>
  );
}
