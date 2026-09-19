import { formatCurrency, localeForLanguage, type AppLanguage } from "@/src/lib/format";
import type {
  Promotion,
  PromotionDiscountKind,
  PromotionInput,
  PromotionTarget,
  PromotionType,
} from "@/src/lib/promotion";

// Pure rules behind the promotions page: form <-> API, what a promotion says
// in one line, and whether it is running right now. The "running" check mirrors
// backend/internal/service/promotion_engine.go promotionRunsAt, so the chip on
// a row and the till agree about the same minute.

export const EVERY_DAY = 127;
/** Monday-first, the way a Thai shop reads its week; values are Sunday-based bits. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const DAY_SHORT: Record<AppLanguage, readonly string[]> = {
  th: ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};

export function dayLabel(bit: number, language: AppLanguage) {
  return DAY_SHORT[language][bit];
}

export type TargetRef = { kind: "menu" | "category"; id: number };
export type BundleSlot = { quantity: number; targets: TargetRef[] };

export type PromotionForm = {
  id: number | null;
  name: string;
  type: PromotionType;
  buyQuantity: number;
  getQuantity: number;
  discountKind: PromotionDiscountKind;
  discountValue: number;
  bundlePrice: number;
  minSubtotal: number;
  maxDiscount: number;
  /** Dishes for buy-X-get-Y and dish discounts. */
  targets: TargetRef[];
  /** Slots for a bundle, in order. */
  slots: BundleSlot[];
  daysMask: number;
  timed: boolean;
  startTime: string;
  endTime: string;
  dated: boolean;
  startDate: string;
  endDate: string;
};

export function emptyPromotionForm(): PromotionForm {
  return {
    id: null,
    name: "",
    type: "buy_x_get_y",
    buyQuantity: 1,
    getQuantity: 1,
    discountKind: "percent",
    discountValue: 0,
    bundlePrice: 0,
    minSubtotal: 0,
    maxDiscount: 0,
    targets: [],
    slots: [{ quantity: 1, targets: [] }, { quantity: 1, targets: [] }],
    daysMask: EVERY_DAY,
    timed: false,
    startTime: "",
    endTime: "",
    dated: false,
    startDate: "",
    endDate: "",
  };
}

function toRef(target: PromotionTarget): TargetRef | null {
  if (target.menu_item_id) return { kind: "menu", id: target.menu_item_id };
  if (target.category_id) return { kind: "category", id: target.category_id };
  return null;
}

function toTarget(ref: TargetRef, groupIndex: number, quantity: number): Omit<PromotionTarget, "ID"> {
  return {
    group_index: groupIndex,
    quantity,
    menu_item_id: ref.kind === "menu" ? ref.id : null,
    category_id: ref.kind === "category" ? ref.id : null,
  };
}

export function promotionToForm(promotion: Promotion): PromotionForm {
  const base = emptyPromotionForm();
  const refs = promotion.targets.map(toRef).filter((ref): ref is TargetRef => ref !== null);
  let slots = base.slots;
  if (promotion.type === "bundle_price") {
    const groups = new Map<number, BundleSlot>();
    for (const target of [...promotion.targets].sort((a, b) => a.group_index - b.group_index)) {
      const ref = toRef(target);
      if (!ref) continue;
      const slot = groups.get(target.group_index) ?? { quantity: Math.max(1, target.quantity), targets: [] };
      slot.targets.push(ref);
      groups.set(target.group_index, slot);
    }
    if (groups.size > 0) slots = [...groups.values()];
  }
  return {
    ...base,
    id: promotion.ID,
    name: promotion.name,
    type: promotion.type,
    buyQuantity: promotion.type === "buy_x_get_y" ? promotion.buy_quantity : base.buyQuantity,
    getQuantity: promotion.type === "buy_x_get_y" ? promotion.get_quantity : base.getQuantity,
    discountKind: promotion.discount_kind || base.discountKind,
    discountValue: promotion.discount_value,
    bundlePrice: promotion.bundle_price,
    minSubtotal: promotion.min_subtotal,
    maxDiscount: promotion.max_discount,
    targets: promotion.type === "bundle_price" ? [] : refs,
    slots,
    daysMask: promotion.days_mask || EVERY_DAY,
    timed: Boolean(promotion.start_time && promotion.end_time),
    startTime: promotion.start_time,
    endTime: promotion.end_time,
    dated: Boolean(promotion.start_date || promotion.end_date),
    startDate: promotion.start_date,
    endDate: promotion.end_date,
  };
}

/** The request body for the form, carrying only what its type uses. */
export function formToPromotionInput(form: PromotionForm): PromotionInput {
  const discounted = form.type === "item_discount" || form.type === "bill_discount";
  let targets: Omit<PromotionTarget, "ID">[] = [];
  if (form.type === "bundle_price") {
    targets = form.slots.flatMap((slot, index) => slot.targets.map((ref) => toTarget(ref, index, slot.quantity)));
  } else if (form.type !== "bill_discount") {
    targets = form.targets.map((ref) => toTarget(ref, 0, 1));
  }
  return {
    name: form.name.trim(),
    type: form.type,
    start_date: form.dated ? form.startDate : "",
    end_date: form.dated ? form.endDate : "",
    days_mask: form.daysMask,
    start_time: form.timed ? form.startTime : "",
    end_time: form.timed ? form.endTime : "",
    buy_quantity: form.type === "buy_x_get_y" ? form.buyQuantity : 0,
    get_quantity: form.type === "buy_x_get_y" ? form.getQuantity : 0,
    discount_kind: discounted ? form.discountKind : "",
    discount_value: discounted ? form.discountValue : 0,
    bundle_price: form.type === "bundle_price" ? form.bundlePrice : 0,
    min_subtotal: form.type === "bill_discount" ? form.minSubtotal : 0,
    max_discount: form.type === "bill_discount" && form.discountKind === "percent" ? form.maxDiscount : 0,
    targets,
  };
}

export type PromotionFormProblem =
  | "name"
  | "quantities"
  | "discount"
  | "percent"
  | "targets"
  | "bundle_price"
  | "bundle_slots"
  | "bundle_size"
  | "days"
  | "hours"
  | "dates";

/** Every field the server would refuse, in the order the form shows them. */
export function promotionFormProblems(form: PromotionForm): PromotionFormProblem[] {
  const problems: PromotionFormProblem[] = [];
  if (!form.name.trim()) problems.push("name");
  switch (form.type) {
    case "buy_x_get_y":
      if (form.buyQuantity < 1 || form.getQuantity < 1) problems.push("quantities");
      if (form.targets.length === 0) problems.push("targets");
      break;
    case "item_discount":
      if (!(form.discountValue > 0)) problems.push("discount");
      else if (form.discountKind === "percent" && form.discountValue > 100) problems.push("percent");
      if (form.targets.length === 0) problems.push("targets");
      break;
    case "bundle_price":
      if (!(form.bundlePrice > 0)) problems.push("bundle_price");
      if (form.slots.some((slot) => slot.targets.length === 0)) problems.push("bundle_slots");
      else if (form.slots.reduce((sum, slot) => sum + slot.quantity, 0) < 2) problems.push("bundle_size");
      break;
    case "bill_discount":
      if (!(form.discountValue > 0)) problems.push("discount");
      else if (form.discountKind === "percent" && form.discountValue > 100) problems.push("percent");
      break;
  }
  if ((form.daysMask & EVERY_DAY) === 0) problems.push("days");
  if (form.timed && (!form.startTime || !form.endTime || form.startTime === form.endTime)) problems.push("hours");
  if (form.dated && (!form.startDate || !form.endDate || form.endDate < form.startDate)) problems.push("dates");
  return problems;
}

function money(value: number, language: AppLanguage) {
  return formatCurrency(value, language, Number.isInteger(value) ? 0 : 2);
}

function percent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

export function promotionRuleSummary(promotion: Promotion, language: AppLanguage): string {
  const th = language === "th";
  const off = promotion.discount_kind === "percent"
    ? percent(promotion.discount_value)
    : money(promotion.discount_value, language);
  switch (promotion.type) {
    case "buy_x_get_y":
      return th
        ? `ซื้อ ${promotion.buy_quantity} แถม ${promotion.get_quantity}`
        : `Buy ${promotion.buy_quantity} get ${promotion.get_quantity}`;
    case "item_discount":
      return th ? `ลด ${off}` : `${off} off`;
    case "bundle_price":
      return th ? `ราคาเซ็ต ${money(promotion.bundle_price, language)}` : `Set for ${money(promotion.bundle_price, language)}`;
    case "bill_discount": {
      const cap = promotion.discount_kind === "percent" && promotion.max_discount > 0
        ? th ? `, ลดสูงสุด ${money(promotion.max_discount, language)}` : `, up to ${money(promotion.max_discount, language)}`
        : "";
      if (promotion.min_subtotal > 0) {
        return th
          ? `ครบ ${money(promotion.min_subtotal, language)} ลด ${off}${cap}`
          : `${off} off bills from ${money(promotion.min_subtotal, language)}${cap}`;
      }
      return th ? `ลดทั้งบิล ${off}${cap}` : `${off} off the bill${cap}`;
    }
  }
}

export type PromotionNames = {
  menu: (id: number) => string | undefined;
  category: (id: number) => string | undefined;
};

export function targetLabel(ref: TargetRef, names: PromotionNames, language: AppLanguage): string {
  const th = language === "th";
  if (ref.kind === "menu") return names.menu(ref.id) ?? (th ? "เมนูที่ถูกลบ" : "Removed dish");
  const name = names.category(ref.id);
  if (name === undefined) return th ? "หมวดที่ถูกลบ" : "Removed category";
  return th ? `หมวด${name}` : `${name} category`;
}

/** The dishes a promotion counts: "ชาเย็น, หมวดเครื่องดื่ม", or a bundle's slots
 *  "ข้าวผัด/กะเพรา + หมวดเครื่องดื่ม ×2". A bill discount counts the whole bill. */
export function promotionTargetsSummary(promotion: Promotion, names: PromotionNames, language: AppLanguage): string {
  if (promotion.type === "bill_discount") return "";
  const form = promotionToForm(promotion);
  if (promotion.type === "bundle_price") {
    return form.slots
      .filter((slot) => slot.targets.length > 0)
      .map((slot) => {
        const dishes = slot.targets.map((ref) => targetLabel(ref, names, language)).join("/");
        return slot.quantity > 1 ? `${dishes} ×${slot.quantity}` : dishes;
      })
      .join(" + ");
  }
  return form.targets.map((ref) => targetLabel(ref, names, language)).join(", ");
}

function daysSummary(mask: number, language: AppLanguage): string {
  if ((mask & EVERY_DAY) === EVERY_DAY || mask <= 0) return language === "th" ? "ทุกวัน" : "Every day";
  const positions = WEEK_ORDER.map((bit, index) => ((mask >> bit) & 1 ? index : -1)).filter((index) => index >= 0);
  const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  if (positions.length >= 3 && contiguous) {
    return `${dayLabel(WEEK_ORDER[positions[0]], language)}–${dayLabel(WEEK_ORDER[positions[positions.length - 1]], language)}`;
  }
  return positions.map((position) => dayLabel(WEEK_ORDER[position], language)).join(" ");
}

export function formatPromotionDate(date: string, language: AppLanguage, now: Date): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const sameYear = year === Number(bangkokParts(now).date.slice(0, 4));
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(value);
}

/** "จ.–ศ., 14:00–17:00, 1 ก.ย.–30 ก.ย." - days first, then hours, then dates. */
export function promotionScheduleSummary(
  promotion: Pick<Promotion, "days_mask" | "start_time" | "end_time" | "start_date" | "end_date">,
  language: AppLanguage,
  now: Date,
): string {
  const th = language === "th";
  const parts = [daysSummary(promotion.days_mask, language)];
  if (promotion.start_time && promotion.end_time) parts.push(`${promotion.start_time}–${promotion.end_time}`);
  const start = promotion.start_date ? formatPromotionDate(promotion.start_date, language, now) : "";
  const end = promotion.end_date ? formatPromotionDate(promotion.end_date, language, now) : "";
  if (start && end) parts.push(`${start}–${end}`);
  else if (start) parts.push(th ? `ตั้งแต่ ${start}` : `from ${start}`);
  else if (end) parts.push(th ? `ถึง ${end}` : `until ${end}`);
  return parts.join(", ");
}

const bangkokFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function bangkokParts(at: Date) {
  const parts: Record<string, string> = {};
  for (const part of bangkokFormat.formatToParts(at)) parts[part.type] = part.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    clock: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

type Schedule = Pick<Promotion, "days_mask" | "start_time" | "end_time" | "start_date" | "end_date">;

export function promotionRunsAt(promotion: Schedule, at: Date): boolean {
  const now = bangkokParts(at);
  let day = now;
  if (promotion.start_time && promotion.end_time) {
    if (promotion.start_time < promotion.end_time) {
      if (now.clock < promotion.start_time || now.clock >= promotion.end_time) return false;
    } else if (now.clock < promotion.start_time) {
      // Past midnight: still the night that began the day before. Bangkok
      // keeps no daylight saving, so 24 hours back is exactly yesterday.
      if (now.clock >= promotion.end_time) return false;
      day = bangkokParts(new Date(at.getTime() - 86_400_000));
    }
  }
  if (promotion.start_date && day.date < promotion.start_date) return false;
  if (promotion.end_date && day.date > promotion.end_date) return false;
  const mask = promotion.days_mask > 0 ? promotion.days_mask : EVERY_DAY;
  return (mask & (1 << day.weekday)) !== 0;
}

export type PromotionState = "off" | "running" | "waiting" | "upcoming" | "ended";

export function promotionStateAt(promotion: Schedule & Pick<Promotion, "is_active">, at: Date): PromotionState {
  if (!promotion.is_active) return "off";
  if (promotionRunsAt(promotion, at)) return "running";
  const today = bangkokParts(at).date;
  if (promotion.end_date && today > promotion.end_date) return "ended";
  if (promotion.start_date && today < promotion.start_date) return "upcoming";
  return "waiting";
}
