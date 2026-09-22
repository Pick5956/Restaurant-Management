"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Clock3, ReceiptText } from "lucide-react";
import { BACK_CONTROL, BACK_ICON } from "@/src/components/shared/backControl";
import LanguageToggle from "@/src/components/shared/LanguageToggle";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { useVisiblePolling } from "@/src/hooks/useVisiblePolling";
import { getCustomerTableOrder, type CustomerTablePayload } from "@/src/lib/customerOrder";
import {
  customerOrderItemStatusLabel,
  customerTableMenuHref,
  summarizeCustomerOrderItems,
} from "@/src/lib/customerOrderView";
import { useLanguage } from "@/src/providers/LanguageProvider";
import type { OrderItemStatus } from "@/src/types/order";

const statusClass: Record<OrderItemStatus, string> = {
  pending: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  cooking: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  ready: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  served: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
};

export default function CustomerTableOrdersPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const { language } = useLanguage();
  const [payload, setPayload] = useState<CustomerTablePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const copy = language === "th"
    ? {
        title: "รายการที่โต๊ะสั่งแล้ว",
        subtitle: "ติดตามอาหารทั้งหมดของโต๊ะนี้",
        back: "กลับไปสั่งอาหาร",
        loading: "กำลังโหลดรายการ",
        loadError: "โหลดรายการที่สั่งไม่สำเร็จ",
        table: "โต๊ะ",
        order: "ออเดอร์",
        itemCount: "จำนวนอาหาร",
        itemUnit: "รายการ",
        foodTotal: "รวมค่าอาหาร",
        emptyTitle: "ยังไม่มีรายการที่ส่งแล้ว",
        emptyBody: "เมื่อส่งออเดอร์เข้าครัว รายการจะปรากฏในหน้านี้",
        noOrderTitle: "โต๊ะนี้ยังไม่เปิดรับออเดอร์",
        noOrderBody: "กรุณาเรียกพนักงานให้เปิดโต๊ะก่อน",
        note: "หมายเหตุ",
      }
    : {
        title: "Your table orders",
        subtitle: "Track everything ordered for this table",
        back: "Back to menu",
        loading: "Loading orders",
        loadError: "Could not load table orders",
        table: "Table",
        order: "Order",
        itemCount: "Food items",
        itemUnit: "items",
        foodTotal: "Food total",
        emptyTitle: "No sent items yet",
        emptyBody: "Items will appear here after an order is sent to the kitchen.",
        noOrderTitle: "This table is not open yet",
        noOrderBody: "Ask staff to open the table before ordering.",
        note: "Note",
      };

  const load = useCallback(async () => {
    setError("");

    try {
      const response = await getCustomerTableOrder(token);
      setPayload(response.data);
    } catch (loadError) {
      setError(apiErrorMessage(loadError) || copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, token]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [load]);
  useVisiblePolling(load, {
    enabled: Boolean(payload),
    intervalMs: 30_000,
    runImmediately: false,
  });

  const items = useMemo(() => payload?.order?.items ?? [], [payload?.order?.items]);
  const summary = useMemo(() => summarizeCustomerOrderItems(items), [items]);
  const tableLabel = payload?.table.display_label || payload?.table.table_number || "-";

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-white px-4 text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">{copy.loading}</div>;
  }

  if (!payload) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-4 text-center dark:bg-gray-950">
        <p className="text-sm font-medium text-red-600 dark:text-red-300">{error || copy.loadError}</p>
        <Link href={customerTableMenuHref(token)} className="ui-press inline-flex h-11 items-center gap-2 rounded-md border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-200">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {copy.back}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white pb-8 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Link href={customerTableMenuHref(token)} aria-label={copy.back} title={copy.back} className={BACK_CONTROL}>
            <ArrowLeft className={BACK_ICON} aria-hidden="true" />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-600 dark:text-orange-400">{payload.restaurant.name}</p>
            <h1 className="truncate text-[16px] font-semibold">{copy.title}</h1>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4">
        {error ? <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</div> : null}

        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-950/35 dark:text-orange-300">
            <ReceiptText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{copy.table} {tableLabel}</p>
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
              {payload.order ? `${copy.order} ${payload.order.order_number} · ${copy.subtitle}` : copy.subtitle}
            </p>
          </div>
        </div>

        {payload.order ? (
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            <div className="grid grid-cols-2 border-b border-gray-200 dark:border-gray-800">
              <div className="px-4 py-3">
                <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{copy.itemCount}</p>
                <p className="mt-0.5 font-mono text-[16px] font-semibold tabular-nums">{summary.itemCount} {copy.itemUnit}</p>
              </div>
              <div className="border-l border-gray-200 px-4 py-3 text-right dark:border-gray-800">
                <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{copy.foodTotal}</p>
                <p className="mt-0.5 font-mono text-[16px] font-semibold tabular-nums">฿{summary.total.toLocaleString()}</p>
              </div>
            </div>

            {items.length ? (
              <div className="divide-y divide-gray-200 dark:divide-gray-800">
                {items.map((item) => (
                  <div key={item.ID} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
                    <div
                      role="img"
                      aria-label={`${item.menu_name}`}
                      className="h-14 w-14 shrink-0 rounded-md bg-transparent bg-contain bg-center bg-no-repeat sm:h-16 sm:w-16"
                      style={{ backgroundImage: `url(${item.image_url || "/menu-placeholder-v2.webp"})` }}
                    />
                    <div className="min-w-0">
                      <p className="min-w-0 truncate text-[13px] font-semibold">{item.menu_name}</p>
                      {item.selected_options?.map((option) => (
                        <p key={option.ID} className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{option.group_name}: {option.option_name}</p>
                      ))}
                      {item.note ? <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{copy.note}: {item.note}</p> : null}
                      <div className="mt-2 flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusClass[item.status]}`}>
                          {customerOrderItemStatusLabel(item.status, language)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[13px] font-semibold tabular-nums">฿{item.subtotal.toLocaleString()}</p>
                      <p className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">x{item.quantity}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-12 text-center">
                <ReceiptText className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-700" aria-hidden="true" />
                <p className="mt-3 text-[14px] font-semibold">{copy.emptyTitle}</p>
                <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-gray-500 dark:text-gray-400">{copy.emptyBody}</p>
              </div>
            )}
          </section>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-5 text-center dark:border-amber-900/50 dark:bg-amber-950/25">
            <p className="text-[14px] font-semibold text-amber-900 dark:text-amber-100">{copy.noOrderTitle}</p>
            <p className="mt-1 text-[12px] text-amber-800 dark:text-amber-200">{copy.noOrderBody}</p>
          </div>
        )}
      </main>

    </div>
  );
}
