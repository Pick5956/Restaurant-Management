import { billDiscountLines } from './bill-promotions.ts';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { Bill } from '@/src/types/order';
import type { Restaurant } from '@/src/types/restaurant';

function receiptMoney(value: number, language: DisplayLanguage): string {
  return `฿${Number(value || 0).toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function staffName(bill: Bill): string {
  const staff = bill.order.staff;
  if (!staff) return '-';
  return staff.nickname?.trim()
    || [staff.first_name, staff.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ')
    || '-';
}

function receiptDate(bill: Bill, language: DisplayLanguage): string {
  const payment = bill.payments.at(-1);
  const value = payment?.paid_at
    || bill.order.closed_at
    || bill.order.opened_at
    || bill.order.order_date;
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function locationLabel(bill: Bill, language: DisplayLanguage): string {
  return bill.order.table?.display_label
    || (bill.order.order_type === 'takeaway'
      ? language === 'th' ? 'ซื้อกลับบ้าน' : 'Takeaway'
      : bill.order.order_number);
}

export type ReceiptRestaurant = Pick<
  Restaurant,
  'name' | 'branch_name' | 'address' | 'phone'
>;

export interface ReceiptModelItem {
  key: string;
  quantity: string;
  name: string;
  amount: string;
  options: string;
  note: string;
}

export interface ReceiptModelTotal {
  key: string;
  label: string;
  amount: string;
  emphasis: boolean;
}

export interface ReceiptModel {
  heading: string[];
  title: string;
  meta: Array<{ key: string; label: string; value: string }>;
  items: ReceiptModelItem[];
  totals: ReceiptModelTotal[];
  paymentLine: string;
  footer: string;
}

/**
 * One structured description of a receipt, shared by the text that gets shared
 * to a customer and the bitmap that gets rastered to the counter printer, so the
 * two can never drift apart on which lines a receipt is supposed to carry.
 */
export function buildReceiptModel(
  bill: Bill,
  restaurant?: ReceiptRestaurant,
  language: DisplayLanguage = 'th',
): ReceiptModel {
  const payment = bill.payments.at(-1);
  const copy = (thai: string, english: string) => language === 'th' ? thai : english;
  const locale = language === 'th' ? 'th-TH' : 'en-US';

  const totals: ReceiptModelTotal[] = [
    {
      key: 'subtotal',
      label: copy('ยอดอาหาร', 'Food subtotal'),
      amount: receiptMoney(bill.subtotal, language),
      emphasis: false,
    },
  ];
  for (const line of billDiscountLines(bill, copy('ส่วนลด', 'Discount'))) {
    totals.push({
      key: line.key,
      label: line.label,
      amount: `−${receiptMoney(line.amount, language)}`,
      emphasis: false,
    });
  }
  if (bill.service_charge_enabled || bill.service_charge_amount > 0) {
    totals.push({
      key: 'service',
      label: copy('ค่าบริการ', 'Service charge'),
      amount: receiptMoney(bill.service_charge_amount, language),
      emphasis: false,
    });
  }
  if (bill.vat_enabled || bill.vat_amount > 0) {
    totals.push({
      key: 'vat',
      label: 'VAT',
      amount: receiptMoney(bill.vat_amount, language),
      emphasis: false,
    });
  }
  totals.push({
    key: 'grand',
    label: copy('ยอดสุทธิ', 'Grand total'),
    amount: receiptMoney(bill.grand_total, language),
    emphasis: true,
  });

  return {
    heading: [
      restaurant?.name?.trim() || 'Dishy',
      restaurant?.branch_name?.trim() || '',
      restaurant?.address?.trim() || '',
      restaurant?.phone?.trim() ? `Tel. ${restaurant.phone.trim()}` : '',
    ].filter(Boolean),
    title: copy('ใบเสร็จรับเงิน', 'Receipt'),
    meta: [
      { key: 'reference', label: copy('เลขอ้างอิง', 'Reference'), value: bill.order.order_number },
      { key: 'date', label: copy('วันที่', 'Date'), value: receiptDate(bill, language) },
      { key: 'location', label: copy('โต๊ะ / ช่องทาง', 'Table / channel'), value: locationLabel(bill, language) },
      { key: 'staff', label: copy('พนักงาน', 'Staff'), value: staffName(bill) },
    ],
    items: bill.items.map((item, index) => ({
      key: String(item.ID ?? index),
      quantity: item.quantity.toLocaleString(locale),
      name: item.menu_name,
      amount: receiptMoney(item.subtotal, language),
      options: item.selected_options?.length
        ? item.selected_options.map((option) => option.option_name).join(', ')
        : '',
      note: item.note?.trim() || '',
    })),
    totals,
    paymentLine: payment
      ? `${copy('ชำระโดย', 'Paid by')} ${payment.method === 'cash' ? copy('เงินสด', 'Cash') : 'PromptPay QR'}`
      : copy('ยังไม่ชำระ', 'Unpaid'),
    footer: copy('ขอบคุณที่ใช้บริการ', 'Thank you'),
  };
}
