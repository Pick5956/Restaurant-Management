// What the confirm card under an assistant command says, kept apart from how
// it is drawn so the wording can be tested without a renderer.
//
// The card was redrawn on 14 ก.ย. 2569 (the owner chose design A): the action
// is the bottom part of the answer bubble, a kicker names what kind of change
// it is, and the change itself is laid out — old value struck through beside
// the new one, or label/value lines for something new — from the parts the
// server sends with each item, not from the one-line sentence.

import type { DisplayLanguage } from '@/src/lib/display-preferences';

export type ConfirmFact = { label: string; value: string };

export type ConfirmItem = {
  title: string;
  change: string;
  unit?: string;
  sideEffects?: string[];
  kind?: string;
  field?: string;
  from?: string;
  to?: string;
  valueUnit?: string;
  delta?: string;
  facts?: ConfirmFact[];
};

export type ConfirmState = 'pending' | 'confirming' | 'done' | 'cancelled' | 'expired';

/** The Ionicons glyph beside the kicker. Kept as a plain string for the tests. */
export type ConfirmIcon =
  | 'add-circle-outline'
  | 'cube-outline'
  | 'speedometer-outline'
  | 'pricetag-outline'
  | 'eye-outline'
  | 'eye-off-outline'
  | 'receipt-outline'
  | 'pricetags-outline'
  | 'restaurant-outline'
  | 'list-outline'
  | 'create-outline'
  | 'checkmark-circle'
  | 'close-circle-outline'
  | 'timer-outline';

type Kicker = { icon: ConfirmIcon; th: string; en: string };

function kickerForItem(item: ConfirmItem): Kicker {
  switch (item.kind) {
    case 'create_ingredient':
      return { icon: 'add-circle-outline', th: 'เพิ่มวัตถุดิบใหม่', en: 'New ingredient' };
    case 'adjust_ingredient_stock':
      if (item.delta?.startsWith('+')) return { icon: 'cube-outline', th: 'รับของเข้าคลัง', en: 'Stock in' };
      if (item.delta?.startsWith('-')) return { icon: 'cube-outline', th: 'ตัดสต๊อก', en: 'Stock out' };
      return { icon: 'cube-outline', th: 'ปรับสต๊อก', en: 'Stock count' };
    case 'set_ingredient_min_stock':
      return { icon: 'speedometer-outline', th: 'ตั้งขั้นต่ำ', en: 'Minimum stock' };
    case 'set_ingredient_cost':
      return { icon: 'pricetag-outline', th: 'ตั้งราคาต้นทุน', en: 'Ingredient cost' };
    case 'set_menu_availability':
      return item.to === 'ปิดขาย' || item.to === 'Unavailable'
        ? { icon: 'eye-off-outline', th: 'ปิดขายเมนู', en: 'Take menu off sale' }
        : { icon: 'eye-outline', th: 'เปิดขายเมนู', en: 'Put menu on sale' };
    case 'create_expense':
      return { icon: 'receipt-outline', th: 'บันทึกรายจ่าย', en: 'New expense' };
    case 'set_menu_price':
      return { icon: 'pricetags-outline', th: 'เปลี่ยนราคาเมนู', en: 'Menu price' };
    case 'create_menu_item':
      return { icon: 'restaurant-outline', th: 'เพิ่มเมนูใหม่', en: 'New menu item' };
    default:
      return { icon: 'create-outline', th: 'แก้ข้อมูล', en: 'Change' };
  }
}

/**
 * The line above the name. While pending it says what kind of change this is;
 * afterwards it says how it ended, so a scrolled-back card reads as history.
 */
export function confirmKicker(items: ConfirmItem[], state: ConfirmState, language: DisplayLanguage): { icon: ConfirmIcon; text: string } {
  const th = language === 'th';
  if (state === 'cancelled') return { icon: 'close-circle-outline', text: th ? 'ยกเลิกแล้ว' : 'Cancelled' };
  if (state === 'expired') return { icon: 'timer-outline', text: th ? 'หมดเวลายืนยัน' : 'Confirmation expired' };
  const base: Kicker = items.length === 1
    ? kickerForItem(items[0])
    : { icon: 'list-outline', th: `แก้ข้อมูล ${items.length} รายการ`, en: `${items.length} changes` };
  if (state === 'done') {
    return { icon: 'checkmark-circle', text: th ? `${base.th}แล้ว` : `${base.en} · done` };
  }
  return { icon: base.icon, text: th ? base.th : base.en };
}

/**
 * How one item's change is laid out: a new row lists what it will hold, a value
 * that moves shows from → to, and anything the server described only as a
 * sentence (an older plan, a kind added later) falls back to that sentence.
 */
export function confirmLayout(item: ConfirmItem): 'facts' | 'delta' | 'sentence' {
  if (item.facts && item.facts.length > 0) return 'facts';
  if (item.from && item.to) return 'delta';
  return 'sentence';
}

/** A multi-item row's name: the field is added where the name alone misleads. */
export function confirmRowName(item: ConfirmItem): string {
  if (item.field && (item.kind === 'set_ingredient_min_stock' || item.kind === 'set_ingredient_cost')) {
    return `${item.title} · ${item.field}`;
  }
  return item.title;
}

/** The confirm button's words; the countdown sits beside them. */
export function confirmLabel(count: number, language: DisplayLanguage): string {
  if (language === 'th') return count > 1 ? `ยืนยันทั้ง ${count}` : 'ยืนยัน';
  return count > 1 ? `Confirm all ${count}` : 'Confirm';
}

export type ConfirmDestination = { href: '/inventory' | '/menu' | '/expenses'; th: string; en: string };

/**
 * Where "see it" goes after a change is saved: the one screen every item
 * landed on. A plan that touched two screens gets no link — picking one would
 * send the owner to half of what they just did.
 */
export function confirmDestination(items: ConfirmItem[]): ConfirmDestination | null {
  const screens = new Set(items.map((item) => screenFor(item.kind)));
  if (screens.size !== 1) return null;
  const [screen] = [...screens];
  if (screen === 'inventory') return { href: '/inventory', th: 'ดูในคลัง', en: 'Open inventory' };
  if (screen === 'menu') return { href: '/menu', th: 'ดูเมนู', en: 'Open menu' };
  if (screen === 'expenses') return { href: '/expenses', th: 'ดูรายจ่าย', en: 'Open expenses' };
  return null;
}

function screenFor(kind: string | undefined): 'inventory' | 'menu' | 'expenses' | null {
  switch (kind) {
    case 'create_ingredient':
    case 'adjust_ingredient_stock':
    case 'set_ingredient_min_stock':
    case 'set_ingredient_cost':
      return 'inventory';
    case 'set_menu_availability':
    case 'set_menu_price':
    case 'create_menu_item':
      return 'menu';
    case 'create_expense':
      return 'expenses';
    default:
      return null;
  }
}

/** "20:28" in the restaurant's clock, for the saved line. */
export function confirmSavedAt(at: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
}

/**
 * A figure from the server with thousands separators: "5073.91" → "5,073.91",
 * "+2000" → "+2,000". The server sends plain digits so every client formats
 * them its own way; anything that is not a plain number ("ปิดขาย") is left as
 * it is. Up to six decimals survive, because a stock of 0.005 kg is real.
 */
export function readableFigure(value: string): string {
  const match = /^([+-]?)(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return value;
  const number = Number(match[2]);
  if (!Number.isFinite(number)) return value;
  return `${match[1]}${number.toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
}
