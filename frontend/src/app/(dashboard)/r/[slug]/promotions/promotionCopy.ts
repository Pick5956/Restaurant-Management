import type { AppLanguage } from "@/src/lib/format";
import type { PromotionType } from "@/src/lib/promotion";
import type { PromotionFormProblem, PromotionState } from "./promotionRules";

type StateLabels = Record<Exclude<PromotionState, "upcoming">, string> & { upcoming: (date: string) => string };

export type PromotionCopy = {
  eyebrow: string;
  title: string;
  denied: string;
  add: string;
  edit: string;
  empty: string;
  loadError: string;
  retry: string;
  types: Record<PromotionType, string>;
  states: StateLabels;
  switchFor: (name: string) => string;
  name: string;
  namePlaceholder: string;
  type: string;
  buy: string;
  get: string;
  discount: string;
  percent: string;
  baht: string;
  minSubtotal: string;
  noMinimum: string;
  maxDiscount: string;
  noCap: string;
  bundlePrice: string;
  dishes: string;
  slot: (index: number) => string;
  slotQuantity: string;
  addSlot: string;
  removeSlot: (index: number) => string;
  choose: string;
  done: string;
  search: string;
  categories: string;
  menus: string;
  nothingChosen: string;
  noMatches: string;
  removeTarget: (label: string) => string;
  days: string;
  everyDay: string;
  weekdays: string;
  weekend: string;
  hours: string;
  allDay: string;
  someHours: string;
  from: string;
  to: string;
  dates: string;
  always: string;
  someDates: string;
  startDate: string;
  endDate: string;
  save: string;
  cancel: string;
  remove: string;
  confirmDelete: (name: string) => string;
  created: string;
  saved: string;
  turnedOn: string;
  turnedOff: string;
  deleted: string;
  saveError: string;
  toggleError: string;
  deleteError: string;
  goneTargets: string;
  problems: Record<PromotionFormProblem, string>;
};

const th: PromotionCopy = {
  eyebrow: "Promotions",
  title: "โปรโมชัน",
  denied: "ไม่มีสิทธิ์จัดการโปรโมชัน",
  add: "สร้างโปรโมชัน",
  edit: "แก้ไขโปรโมชัน",
  empty: "ยังไม่มีโปรโมชัน",
  loadError: "โหลดโปรโมชันไม่สำเร็จ",
  retry: "ลองอีกครั้ง",
  types: {
    buy_x_get_y: "ซื้อแถม",
    item_discount: "ลดราคาเมนู",
    bundle_price: "ราคาเซ็ต",
    bill_discount: "ลดท้ายบิล",
  },
  states: {
    running: "ใช้อยู่",
    waiting: "นอกเวลา",
    ended: "หมดเขต",
    off: "ปิดอยู่",
    upcoming: (date) => `เริ่ม ${date}`,
  },
  switchFor: (name) => `เปิดใช้ ${name}`,
  name: "ชื่อโปรโมชัน",
  namePlaceholder: "เช่น ชาเย็น 1 แถม 1",
  type: "ประเภท",
  buy: "ซื้อ",
  get: "แถม",
  discount: "ลด",
  percent: "%",
  baht: "บาท",
  minSubtotal: "ยอดขั้นต่ำ",
  noMinimum: "ไม่มีขั้นต่ำ",
  maxDiscount: "ลดสูงสุด",
  noCap: "ไม่จำกัด",
  bundlePrice: "ราคาเซ็ต",
  dishes: "เมนูที่ร่วม",
  slot: (index) => `จานที่ ${index}`,
  slotQuantity: "จำนวน",
  addSlot: "เพิ่มจาน",
  removeSlot: (index) => `เอาจานที่ ${index} ออก`,
  choose: "เลือกเมนู",
  done: "เสร็จ",
  search: "ค้นหาเมนูหรือหมวด",
  categories: "หมวด",
  menus: "เมนู",
  nothingChosen: "ยังไม่ได้เลือก",
  noMatches: "ไม่พบเมนู",
  removeTarget: (label) => `เอา ${label} ออก`,
  days: "วันในสัปดาห์",
  everyDay: "ทุกวัน",
  weekdays: "จันทร์–ศุกร์",
  weekend: "เสาร์–อาทิตย์",
  hours: "เวลาในวัน",
  allDay: "ทั้งวัน",
  someHours: "เฉพาะบางช่วง",
  from: "เริ่ม",
  to: "ถึง",
  dates: "ระยะโปรโมชัน",
  always: "ไม่มีวันหมดเขต",
  someDates: "มีวันเริ่มและวันจบ",
  startDate: "วันเริ่ม",
  endDate: "วันสิ้นสุด",
  save: "บันทึก",
  cancel: "ยกเลิก",
  remove: "ลบ",
  confirmDelete: (name) => `ลบ ${name}?`,
  created: "สร้างโปรโมชันแล้ว",
  saved: "บันทึกโปรโมชันแล้ว",
  turnedOn: "เปิดโปรโมชันแล้ว",
  turnedOff: "ปิดโปรโมชันแล้ว",
  deleted: "ลบโปรโมชันแล้ว",
  saveError: "บันทึกโปรโมชันไม่สำเร็จ",
  toggleError: "เปลี่ยนสถานะโปรโมชันไม่สำเร็จ",
  deleteError: "ลบโปรโมชันไม่สำเร็จ",
  goneTargets: "มีเมนูหรือหมวดที่ถูกลบไปแล้ว เลือกใหม่อีกครั้ง",
  problems: {
    name: "ใส่ชื่อโปรโมชัน",
    quantities: "ซื้อและแถมอย่างน้อย 1",
    discount: "ใส่ส่วนลดมากกว่า 0",
    percent: "ลดได้ไม่เกิน 100%",
    targets: "เลือกเมนูหรือหมวดอย่างน้อย 1 รายการ",
    bundle_price: "ใส่ราคาเซ็ตมากกว่า 0",
    bundle_slots: "เลือกเมนูให้ครบทุกจาน",
    bundle_size: "เซ็ตต้องมีอย่างน้อย 2 จาน",
    days: "เลือกอย่างน้อย 1 วัน",
    hours: "เลือกเวลาเริ่มและเวลาจบให้ต่างกัน",
    dates: "เลือกวันเริ่มและวันสิ้นสุด วันสิ้นสุดต้องไม่ก่อนวันเริ่ม",
  },
};

const en: PromotionCopy = {
  eyebrow: "Promotions",
  title: "Promotions",
  denied: "You do not have permission to manage promotions.",
  add: "New promotion",
  edit: "Edit promotion",
  empty: "No promotions yet.",
  loadError: "Could not load promotions.",
  retry: "Try again",
  types: {
    buy_x_get_y: "Buy & get",
    item_discount: "Dish discount",
    bundle_price: "Set price",
    bill_discount: "Bill discount",
  },
  states: {
    running: "Live",
    waiting: "Off hours",
    ended: "Ended",
    off: "Off",
    upcoming: (date) => `Starts ${date}`,
  },
  switchFor: (name) => `Turn on ${name}`,
  name: "Name",
  namePlaceholder: "e.g. Thai tea buy 1 get 1",
  type: "Type",
  buy: "Buy",
  get: "Get free",
  discount: "Off",
  percent: "%",
  baht: "THB",
  minSubtotal: "Minimum bill",
  noMinimum: "No minimum",
  maxDiscount: "Up to",
  noCap: "No cap",
  bundlePrice: "Set price",
  dishes: "Dishes",
  slot: (index) => `Dish ${index}`,
  slotQuantity: "Quantity",
  addSlot: "Add dish",
  removeSlot: (index) => `Remove dish ${index}`,
  choose: "Choose dishes",
  done: "Done",
  search: "Search dishes or categories",
  categories: "Categories",
  menus: "Dishes",
  nothingChosen: "None chosen",
  noMatches: "No dishes found",
  removeTarget: (label) => `Remove ${label}`,
  days: "Days of the week",
  everyDay: "Every day",
  weekdays: "Mon–Fri",
  weekend: "Sat–Sun",
  hours: "Time of day",
  allDay: "All day",
  someHours: "Some hours only",
  from: "From",
  to: "To",
  dates: "Promotion period",
  always: "No end date",
  someDates: "Start and end date",
  startDate: "Start date",
  endDate: "End date",
  save: "Save",
  cancel: "Cancel",
  remove: "Delete",
  confirmDelete: (name) => `Delete ${name}?`,
  created: "Promotion created",
  saved: "Promotion saved",
  turnedOn: "Promotion turned on",
  turnedOff: "Promotion turned off",
  deleted: "Promotion deleted",
  saveError: "Could not save the promotion",
  toggleError: "Could not switch the promotion",
  deleteError: "Could not delete the promotion",
  goneTargets: "A dish or category was deleted. Choose again.",
  problems: {
    name: "Enter a name",
    quantities: "Buy and get at least 1",
    discount: "Enter a discount above 0",
    percent: "A discount cannot exceed 100%",
    targets: "Choose at least one dish or category",
    bundle_price: "Enter a set price above 0",
    bundle_slots: "Choose dishes for every slot",
    bundle_size: "A set needs at least 2 dishes",
    days: "Choose at least one day",
    hours: "Choose a start and an end that differ",
    dates: "Choose a start and an end date, the end not before the start",
  },
};

export function promotionCopy(language: AppLanguage): PromotionCopy {
  return language === "th" ? th : en;
}
