"use client";

import { Phone, ReceiptText } from "lucide-react";
import type { Order } from "@/src/types/order";

type Props = {
  orders: Order[];
  language: "th" | "en";
  disabled: boolean;
  onOpen: (order: Order) => void;
};

const COPY = {
  th: { zone: "สั่งกลับบ้าน", kind: "กลับบ้าน", noName: "ไม่ระบุชื่อ", noPhone: "ไม่มีเบอร์", count: (n: number) => `${n} ออเดอร์` },
  en: { zone: "Takeaway", kind: "Takeaway", noName: "No name", noPhone: "No phone", count: (n: number) => `${n} ${n === 1 ? "order" : "orders"}` },
};

/**
 * The takeaway orders still open, drawn as table cards in a zone of their own
 * so they can be reopened from the floor plan the way a table can. A takeaway
 * has no table, so before this it could only be found again through the
 * orders page.
 */
export default function TakeawayOrderCards({ orders, language, disabled, onOpen }: Props) {
  if (!orders.length) return null;
  const copy = COPY[language];
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-[color:var(--dashboard-shell-border)] pb-2">
        <h2 className="truncate text-[15px] font-bold leading-tight text-gray-950 dark:text-white">{copy.zone}</h2>
        <span className="shrink-0 text-[12px] tabular-nums text-gray-500 dark:text-gray-400">{copy.count(orders.length)}</span>
      </div>
      <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {orders.map((order) => (
          <button
            key={order.ID}
            type="button"
            disabled={disabled}
            onClick={() => onOpen(order)}
            className="ui-press group relative flex min-h-[118px] overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[transform,translate,box-shadow,border-color] hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-800 dark:hover:border-gray-700"
          >
            <span className="w-1.5 shrink-0 bg-blue-600 dark:bg-blue-500" />
            {/* The details run the card's full width: name beside the badge,
                the phone under it, number and total on the last line. */}
            <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-3 pb-2.5 pt-2.5">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[16px] font-semibold leading-tight tracking-tight text-gray-950 dark:text-white">
                  {order.customer_name?.trim() || copy.noName}
                </p>
                <span className="shrink-0 rounded-md bg-blue-50 px-2 py-1 text-[12px] font-semibold leading-none text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                  {copy.kind}
                </span>
              </div>
              <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-gray-600 dark:text-gray-300">
                <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{order.customer_phone?.trim() || copy.noPhone}</span>
              </p>
              <div className="mt-auto flex items-end justify-between gap-3 border-t border-gray-300 pt-2.5 dark:border-gray-600">
                <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-[13px] font-medium tabular-nums text-gray-500 dark:text-gray-400">
                  <ReceiptText className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
                  <span className="truncate">{order.order_number}</span>
                </p>
                <p className="shrink-0 text-[13px] font-bold leading-5 tabular-nums text-gray-950 dark:text-white">฿{order.total_amount.toLocaleString()}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
