"use client";

import { Fragment, useEffect, useState } from "react";
import { Download, Printer } from "lucide-react";
import { billDiscountLines } from "@/src/lib/billPromotions";
import { groupOrderItems } from "@/src/lib/orderItemGroups";
import type { Bill, OrderItem } from "@/src/types/order";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { printA4, printThermalReceipt } from "@/src/lib/thermalReceiptPrint";
import ThermalReceipt from "@/src/components/orders/ThermalReceipt";
import type { Restaurant } from "@/src/types/restaurant";

function fulfillmentType(item: OrderItem) {
  return item.fulfillment_type === "takeaway" ? "takeaway" : "dine_in";
}

export default function PaidReceiptDialog({
  bill,
  language,
  locationLabel,
  restaurant,
  paper = "thermal",
  onClose,
}: {
  bill: Bill;
  language: "th" | "en";
  locationLabel: string;
  restaurant?: Restaurant;
  // "thermal" prints the 48mm strip for the POS printer; "a4" prints the
  // on-screen receipt on a sheet, for archiving and exporting.
  paper?: "thermal" | "a4";
  onClose: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const locale = language === "th" ? "th-TH" : "en-US";
  const payment = bill.payments.at(-1) ?? null;
  // When the bill was settled. Unpaid or legacy rows fall back to when the
  // order closed, then to when it was created, so a receipt is never undated.
  const receiptAt = payment?.paid_at || bill.order.closed_at || bill.order.CreatedAt;
  const receiptAtLabel = receiptAt
    ? new Date(receiptAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" })
    : "";
  const groups = groupOrderItems(bill.items.filter((item) => item.status !== "cancelled"));
  // Voided/cancelled lines (kitchen cancel, or cancelled before serving) are shown
  // only in this dialog for the record — never on the printed receipt (they carry no
  // charge). Kept ungrouped so each cancellation keeps its own reason.
  const cancelledItems = bill.items.filter((item) => item.status === "cancelled");
  const sections = (["dine_in", "takeaway"] as const)
    .map((key) => ({ key, groups: groups.filter((group) => fulfillmentType(group.firstItem) === key) }))
    .filter((section) => section.groups.length > 0);
  const copy = language === "th"
    ? {
        title: "ใบเสร็จรับเงิน",
        close: "ปิด",
        items: "รายการทั้งหมด",
        dineIn: "ทานที่ร้าน",
        takeaway: "กลับบ้าน",
        subtotal: "ยอดอาหาร",
        discount: "ส่วนลด",
        service: "Service charge",
        vat: "VAT",
        grandTotal: "ยอดสุทธิ",
        payment: "วิธีชำระ",
        cash: "เงินสด",
        qr: "QR PromptPay",
        print: "พิมพ์ใบเสร็จอีกครั้ง",
        savePdf: "บันทึกเป็น PDF",
        item: "รายการ",
        qty: "จำนวน",
        unitPrice: "ราคา/หน่วย",
        amount: "รวม",
        cancelledTitle: "รายการที่ยกเลิก",
        cancelledBadge: "ยกเลิก",
        reasonLabel: "เหตุผล",
        noReason: "ไม่ระบุเหตุผล",
      }
    : {
        title: "Payment receipt",
        close: "Close",
        items: "All items",
        dineIn: "Dine-in",
        takeaway: "Takeaway",
        subtotal: "Subtotal",
        discount: "Discount",
        service: "Service charge",
        vat: "VAT",
        grandTotal: "Grand total",
        payment: "Payment method",
        cash: "Cash",
        qr: "QR PromptPay",
        print: "Print receipt again",
        savePdf: "Save as PDF",
        item: "Item",
        qty: "Qty",
        unitPrice: "Unit price",
        amount: "Amount",
        cancelledTitle: "Cancelled items",
        cancelledBadge: "Cancelled",
        reasonLabel: "Reason",
        noReason: "No reason given",
      };
  const money = (value: number) => `฿${value.toLocaleString(locale, { maximumFractionDigits: 2 })}`;

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  const backdrop = useBackdropClose(requestClose);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div data-reprint-overlay {...backdrop} className={`${closing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4`}>
      <style jsx global>{`
        @media print {
          #archive-print-receipt { position: static !important; display: block !important; ${paper === "a4" ? "" : "width: 48mm !important; padding: 3mm 0 !important;"} height: auto !important; max-height: none !important; margin: 0 auto !important; overflow: visible !important; transform: none !important; color: #111827 !important; background: #fff !important; }
          #archive-print-receipt [data-receipt-scroll] { overflow: visible !important; }
          #archive-print-receipt [data-screen-only] { display: none !important; }
          #archive-print-receipt [data-print-only] { display: block !important; }
          ${paper === "a4" ? "" : `
          #archive-print-receipt [data-screen-receipt] { display: none !important; }
          #archive-print-receipt [data-receipt-item] { border: 0 !important; border-bottom: 1px solid #e5e7eb !important; border-radius: 0 !important; padding: 2mm 0 !important; }
          `}
          #archive-print-receipt .dark\\:text-white, #archive-print-receipt .dark\\:text-gray-200, #archive-print-receipt .dark\\:text-gray-300, #archive-print-receipt .dark\\:text-gray-500 { color: #111827 !important; }
          #archive-print-receipt .dark\\:bg-gray-950 { background: #fff !important; }
          #archive-print-receipt .dark\\:border-gray-800 { border-color: #d1d5db !important; }
        }
      `}</style>
      <div data-reprint-dialog role="dialog" aria-modal="true" aria-labelledby="archive-receipt-title" className={`${closing ? "motion-dialog-exit" : "motion-dialog"} flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-950 sm:max-h-[calc(100vh-2rem)]`}>
        <div id="archive-print-receipt" className="flex min-h-0 flex-1 flex-col">
          <div data-screen-receipt className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950 sm:px-5">
            <div data-screen-only className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{locationLabel} · {bill.order.order_number}</p>
              <h2 id="archive-receipt-title" className="mt-0.5 text-[16px] font-semibold text-gray-950 dark:text-white">{copy.title}</h2>
              {receiptAtLabel ? <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{receiptAtLabel}</p> : null}
            </div>
            <div data-print-only className="hidden">
              <h2 className="text-[16px] font-semibold text-gray-900">{copy.title} #{bill.order.order_number}</h2>
              <p className="mt-0.5 text-[12px] text-gray-600">{locationLabel}</p>
              {receiptAtLabel ? <p className="mt-0.5 text-[11px] text-gray-600">{receiptAtLabel}</p> : null}
            </div>
            <button data-screen-only type="button" onClick={requestClose} className="ui-press h-9 shrink-0 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900">{copy.close}</button>
          </div>

          <div data-screen-receipt data-receipt-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5">
            <section aria-labelledby="archive-receipt-items-title">
              <h3 id="archive-receipt-items-title" className="border-b border-gray-200 py-3 text-[13px] font-semibold text-gray-900 dark:border-gray-800 dark:text-white">{copy.items}</h3>
              {paper === "a4" ? (
                <table className="w-full text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <tr className="border-b border-gray-200 dark:border-gray-800">
                      <th className="py-2 font-medium">{copy.item}</th>
                      <th className="py-2 text-right font-medium">{copy.qty}</th>
                      <th className="py-2 text-right font-medium">{copy.unitPrice}</th>
                      <th className="py-2 text-right font-medium">{copy.amount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {sections.map((section) => (
                      <Fragment key={section.key}>
                        {sections.length > 1 || section.key === "takeaway" || bill.order.order_type === "takeaway" ? (
                          <tr><td colSpan={4} className="pt-3 pb-1 text-[12px] font-semibold text-gray-600 dark:text-gray-300">{section.key === "takeaway" ? copy.takeaway : copy.dineIn}</td></tr>
                        ) : null}
                        {section.groups.map((group) => {
                          const item = group.firstItem;
                          const detail = [
                            item.selected_options?.map((option) => `${option.group_name}: ${option.option_name}`).join(" · "),
                            item.note,
                          ].filter(Boolean).join(" · ");
                          return (
                            <tr key={group.key}>
                              <td className="py-2 align-top text-gray-900 dark:text-white">
                                {item.menu_name}
                                {detail ? <span className="block text-[11px] text-gray-500 dark:text-gray-400">{detail}</span> : null}
                              </td>
                              <td className="py-2 text-right align-top font-mono tabular-nums text-gray-900 dark:text-white">{group.quantity}</td>
                              <td className="py-2 text-right align-top font-mono tabular-nums text-gray-600 dark:text-gray-300">{money(group.subtotal / group.quantity)}</td>
                              <td className="py-2 text-right align-top font-mono tabular-nums text-gray-900 dark:text-white">{money(group.subtotal)}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              ) : (
              <div>
                {sections.map((section) => (
                  <div key={section.key}>
                    {sections.length > 1 || section.key === "takeaway" || bill.order.order_type === "takeaway" ? <p className="border-b border-gray-100 py-2 text-[12px] font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">{section.key === "takeaway" ? copy.takeaway : copy.dineIn}</p> : null}
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {section.groups.map((group) => {
                        const item = group.firstItem;
                        return (
                          <div data-receipt-item key={group.key} className="py-3">
                            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
                              <div
                                role="img"
                                aria-label={`${item.menu_name}`}
                                className="h-14 w-14 shrink-0 rounded-md bg-transparent bg-contain bg-center bg-no-repeat sm:h-16 sm:w-16"
                                style={{ backgroundImage: `url(${item.menu?.image_url || "/menu-placeholder-v2.webp"})` }}
                              />
                              <div className="min-w-0">
                                <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{item.menu_name}</p>
                                {item.selected_options?.length ? <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{item.selected_options.map((option) => `${option.group_name}: ${option.option_name}`).join(" · ")}</p> : null}
                                {item.note ? <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{item.note}</p> : null}
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-[14px] font-semibold tabular-nums text-gray-900 dark:text-white">{money(group.subtotal)}</p>
                                <p className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">x{group.quantity}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </section>

            {cancelledItems.length > 0 ? (
              <section data-screen-only aria-labelledby="archive-receipt-cancelled-title" className="border-t border-dashed border-gray-200 pb-3 dark:border-gray-800">
                <h3 id="archive-receipt-cancelled-title" className="py-3 text-[13px] font-semibold text-gray-900 dark:text-white">{copy.cancelledTitle}</h3>
                <div className="space-y-2">
                  {cancelledItems.map((item) => (
                    <div key={item.ID} className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 dark:border-red-900/40 dark:bg-red-950/20">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-[13px] font-medium text-gray-900 line-through decoration-red-400 dark:text-white">
                          {item.menu_name}{item.quantity > 1 ? ` ×${item.quantity}` : ""}
                        </p>
                        <span className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:border-red-900/50 dark:bg-transparent dark:text-red-300">{copy.cancelledBadge}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-gray-600 dark:text-gray-300">
                        <span className="text-gray-500 dark:text-gray-400">{copy.reasonLabel}:</span> {item.cancelled_reason?.trim() || copy.noReason}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div data-screen-receipt className="shrink-0 space-y-1.5 border-t border-gray-200 bg-white px-4 py-3 text-[12px] text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 sm:px-5">
            <div className="flex justify-between gap-4"><span>{copy.subtotal}</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">{money(bill.subtotal)}</span></div>
            {billDiscountLines(bill, copy.discount).map((line) => (
              <div key={line.key} className="flex justify-between gap-4"><span className="min-w-0 truncate">{line.label}</span><span className="shrink-0 font-mono tabular-nums text-gray-900 dark:text-white">-{money(line.amount)}</span></div>
            ))}
            {bill.service_charge_enabled || bill.service_charge_amount > 0 ? (
              <div className="flex justify-between gap-4"><span>{copy.service} {bill.service_charge_enabled ? `${bill.service_charge_rate}%` : ""}</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">{money(bill.service_charge_amount)}</span></div>
            ) : null}
            {bill.vat_enabled || bill.vat_amount > 0 ? (
              <div className="flex justify-between gap-4"><span>{copy.vat} {bill.vat_enabled ? `${bill.vat_rate}%` : ""}</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">{money(bill.vat_amount)}</span></div>
            ) : null}
            <div className="mt-2 flex items-end justify-between gap-4 border-t border-gray-200 pt-2.5 dark:border-gray-800"><span className="text-[13px] font-semibold text-gray-900 dark:text-white">{copy.grandTotal}</span><span className="font-mono text-[20px] font-extrabold tabular-nums text-gray-950 dark:text-white">{money(bill.grand_total)}</span></div>
            {payment ? (
              <div className="mt-2 space-y-1.5 border-t border-dashed border-gray-300 pt-2.5 dark:border-gray-700">
                <div className="flex justify-between gap-4"><span>{copy.payment}</span><span className="font-semibold text-gray-900 dark:text-white">{payment.method === "cash" ? copy.cash : copy.qr}</span></div>
              </div>
            ) : null}
          </div>
          {paper === "thermal" ? <ThermalReceipt bill={bill} language={language} locationLabel={locationLabel} restaurant={restaurant} /> : null}
        </div>

        <div className="flex shrink-0 justify-end border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
          <button type="button" onClick={() => (paper === "a4" ? printA4 : printThermalReceipt)("archive-print-receipt")} className="ui-press inline-flex h-10 items-center gap-2 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white hover:bg-orange-800 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800">{paper === "a4" ? <Download className="h-4 w-4" aria-hidden="true" /> : <Printer className="h-4 w-4" aria-hidden="true" />}{paper === "a4" ? copy.savePdf : copy.print}</button>
        </div>
      </div>
    </div>
  );
}
