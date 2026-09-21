import { billDiscountLines } from "@/src/lib/billPromotions";
import { groupOrderItems } from "@/src/lib/orderItemGroups";
import type { Bill, OrderItem } from "@/src/types/order";
import type { Restaurant } from "@/src/types/restaurant";

const BANGKOK_TZ = "Asia/Bangkok";

// Receipts always read in Thai time, whatever timezone the device is set to. A bare
// date like order_date ("2026-08-25") carries no clock, so it is anchored to Bangkok
// midnight and printed without a time — otherwise new Date() reads it as UTC midnight
// and prints a spurious 07:00 (00:00 UTC shifted into +07:00).
function formatReceiptDate(value: string | null | undefined, locale: string) {
  if (!value) return "-";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T00:00:00+07:00` : value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(
    locale,
    dateOnly
      ? { dateStyle: "short", timeZone: BANGKOK_TZ }
      : { dateStyle: "short", timeStyle: "short", timeZone: BANGKOK_TZ },
  );
}

function fulfillmentType(item: OrderItem) {
  return item.fulfillment_type === "takeaway" ? "takeaway" : "dine_in";
}

function staffName(bill: Bill) {
  const staff = bill.order.staff;
  if (!staff) return "-";
  return staff.nickname?.trim() || [staff.first_name, staff.last_name]
    .map((part) => part?.trim())
    .filter((part) => part && part !== "-")
    .join(" ") || "-";
}

export default function ThermalReceipt({
  bill,
  language,
  locationLabel,
  restaurant,
}: {
  bill: Bill;
  language: "th" | "en";
  locationLabel: string;
  restaurant?: Restaurant;
}) {
  const locale = language === "th" ? "th-TH" : "en-US";
  const payment = bill.payments.at(-1) ?? null;
  const groups = groupOrderItems(bill.items.filter((item) => item.status !== "cancelled"));
  const sections = (["dine_in", "takeaway"] as const)
    .map((key) => ({ key, groups: groups.filter((group) => fulfillmentType(group.firstItem) === key) }))
    .filter((section) => section.groups.length > 0);
  const paidAt = payment?.paid_at || bill.order.closed_at || bill.order.order_date || bill.order.opened_at;
  const money = (value: number) => `฿${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const copy = language === "th"
    ? {
        receipt: "ใบเสร็จรับเงิน",
        reference: "เลขอ้างอิง",
        date: "วันที่",
        location: "โต๊ะ / ช่องทาง",
        cashier: "พนักงาน",
        dineIn: "ทานที่ร้าน",
        takeaway: "กลับบ้าน",
        subtotal: "ยอดอาหาร",
        discount: "ส่วนลด",
        service: "ค่าบริการ",
        vat: "ภาษีมูลค่าเพิ่ม",
        total: "ยอดสุทธิ",
        payment: "ชำระโดย",
        cash: "เงินสด",
        qr: "PromptPay QR",
        thanks: "ขอบคุณที่ใช้บริการ",
      }
    : {
        receipt: "RECEIPT",
        reference: "Reference",
        date: "Date",
        location: "Table / channel",
        cashier: "Cashier",
        dineIn: "Dine-in",
        takeaway: "Takeaway",
        subtotal: "Subtotal",
        discount: "Discount",
        service: "Service charge",
        vat: "VAT",
        total: "TOTAL",
        payment: "Payment",
        cash: "Cash",
        qr: "PromptPay QR",
        thanks: "Thank you",
      };

  return (
    <article data-print-only data-thermal-receipt className="hidden text-black">
      <header className="text-center">
        <h1 className="text-[16px] font-bold leading-tight">{restaurant?.name?.trim() || "Dishy"}</h1>
        {restaurant?.branch_name?.trim() ? <p className="mt-0.5 text-[10px] leading-tight">{restaurant.branch_name}</p> : null}
        {restaurant?.address?.trim() ? <p className="mt-1 text-[9px] leading-[1.35]">{restaurant.address}</p> : null}
        {restaurant?.phone?.trim() ? <p className="mt-0.5 text-[9px] leading-tight">Tel. {restaurant.phone}</p> : null}
        <div className="my-2 border-t border-dashed border-black" />
        <h2 className="text-[13px] font-bold leading-tight">{copy.receipt}</h2>
      </header>

      <dl className="mt-2 space-y-0.5 text-[9px] leading-[1.35]">
        <div className="flex justify-between gap-2"><dt>{copy.reference}</dt><dd className="font-mono font-semibold tabular-nums">{bill.order.order_number}</dd></div>
        <div className="flex justify-between gap-2"><dt>{copy.date}</dt><dd className="text-right tabular-nums">{formatReceiptDate(paidAt, locale)}</dd></div>
        <div className="flex justify-between gap-2"><dt>{copy.location}</dt><dd className="text-right font-semibold">{locationLabel}</dd></div>
        <div className="flex justify-between gap-2"><dt>{copy.cashier}</dt><dd className="max-w-[28mm] truncate text-right">{staffName(bill)}</dd></div>
      </dl>

      <div className="my-2 border-t border-dashed border-black" />

      <div className="space-y-2">
        {sections.map((section) => (
          <section key={section.key}>
            {sections.length > 1 || section.key === "takeaway" || bill.order.order_type === "takeaway" ? (
              <h3 className="mb-1 text-[9px] font-bold">{section.key === "takeaway" ? copy.takeaway : copy.dineIn}</h3>
            ) : null}
            <div className="space-y-1.5">
              {section.groups.map((group) => {
                const item = group.firstItem;
                const unitTotal = group.quantity > 0 ? group.subtotal / group.quantity : group.subtotal;
                return (
                  <div key={group.key} className="break-inside-avoid text-[10px] leading-[1.3]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 font-semibold">{item.menu_name}</p>
                      <p className="shrink-0 font-mono font-semibold tabular-nums">{money(group.subtotal)}</p>
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] tabular-nums">{group.quantity} × {money(unitTotal)}</p>
                    {item.selected_options?.length ? <p className="mt-0.5 text-[8px] leading-[1.3]">+ {item.selected_options.map((option) => option.option_name).join(", ")}</p> : null}
                    {item.note ? <p className="mt-0.5 text-[8px] leading-[1.3]">* {item.note}</p> : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="my-2 border-t border-dashed border-black" />

      <dl className="space-y-1 text-[10px] leading-tight">
        <div className="flex justify-between gap-2"><dt>{copy.subtotal}</dt><dd className="font-mono tabular-nums">{money(bill.subtotal)}</dd></div>
        {billDiscountLines(bill, copy.discount).map((line) => (
          <div key={line.key} className="flex justify-between gap-2"><dt className="min-w-0">{line.label}</dt><dd className="shrink-0 font-mono tabular-nums">-{money(line.amount)}</dd></div>
        ))}
        {bill.service_charge_enabled || bill.service_charge_amount > 0 ? <div className="flex justify-between gap-2"><dt>{copy.service} {bill.service_charge_enabled ? `${bill.service_charge_rate}%` : ""}</dt><dd className="font-mono tabular-nums">{money(bill.service_charge_amount)}</dd></div> : null}
        {bill.vat_enabled || bill.vat_amount > 0 ? <div className="flex justify-between gap-2"><dt>{copy.vat} {bill.vat_enabled ? `${bill.vat_rate}%` : ""}</dt><dd className="font-mono tabular-nums">{money(bill.vat_amount)}</dd></div> : null}
        <div className="mt-1.5 flex items-end justify-between gap-2 border-y border-black py-1.5">
          <dt className="text-[12px] font-bold">{copy.total}</dt>
          <dd className="font-mono text-[15px] font-extrabold tabular-nums">{money(bill.grand_total)}</dd>
        </div>
      </dl>

      {payment ? (
        <dl className="mt-2 space-y-1 text-[10px] leading-tight">
          <div className="flex justify-between gap-2"><dt>{copy.payment}</dt><dd className="font-semibold">{payment.method === "cash" ? copy.cash : copy.qr}</dd></div>
        </dl>
      ) : null}

      <footer className="mt-3 border-t border-dashed border-black pt-2 text-center">
        <p className="text-[10px] font-semibold">{copy.thanks}</p>
        <p className="mt-1 font-mono text-[8px] tabular-nums">{bill.order.order_number}</p>
      </footer>
    </article>
  );
}
