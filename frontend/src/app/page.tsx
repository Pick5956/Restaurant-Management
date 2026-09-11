"use client";

import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import { Pagination } from "swiper/modules";
import "swiper/css/pagination";

import { Fragment } from "react";
import AppLogo from "@/src/components/shared/AppLogo";
import AppWordmark from "@/src/components/shared/AppWordmark";
import LanguageToggle from "@/src/components/shared/LanguageToggle";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import { safeNextPathFromSearch } from "@/src/lib/safeRedirect";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Settings,
  CreditCard,
  Moon,
  ReceiptText,
  ShoppingCart,
  Sun,
  Store,
  Table2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type ShiftMetric = {
  label: string;
  value: string;
  note: string;
  tone: "neutral" | "orange" | "amber" | "emerald" | "sky";
};

type FlowItem = {
  title: string;
  desc: string;
  icon: LucideIcon;
};

type RoleItem = {
  role: string;
  title: string;
  desc: string;
  icon: LucideIcon;
};

type HeroProof = {
  label: string;
  icon: LucideIcon;
};

const HERO_IMAGE_URL = "https://images.unsplash.com/photo-1750950388492-f803d12c4a8a?auto=format&fit=crop&w=2200&q=80";

const HERO_PROOFS: Record<Language, HeroProof[]> = {
  th: [
    { label: "ใช้ได้ทั้งมือถือ แท็บเล็ต และ PC", icon: Download },
    { label: "รองรับร้านได้หลายสาขา", icon: Settings },
    { label: "มีแดชบอร์ดสำหรับเจ้าของร้าน", icon: Store },
  ],
  en: [
    { label: "Works on mobile, tablet, and PC", icon: Download },
    { label: "Manage multiple branches", icon: Settings },
    { label: "Owner dashboard included", icon: Store },
  ],
};

const SHIFT_METRICS: Record<Language, ShiftMetric[]> = {
  th: [
    { label: "โต๊ะใช้งาน", value: "6", note: "จาก 12 โต๊ะ", tone: "amber" },
    { label: "คิวครัว", value: "4", note: "2 รายการใกล้พร้อม", tone: "orange" },
    { label: "ครัวทำเสร็จ", value: "2", note: "รอปิดโต๊ะ", tone: "emerald" },
    { label: "รอชำระ", value: "1", note: "โต๊ะ B2", tone: "sky" },
  ],
  en: [
    { label: "Active tables", value: "6", note: "of 12 tables", tone: "amber" },
    { label: "Kitchen queue", value: "4", note: "2 nearly ready", tone: "orange" },
    { label: "Kitchen completed", value: "2", note: "Awaiting checkout", tone: "emerald" },
    { label: "Awaiting payment", value: "1", note: "Table B2", tone: "sky" },
  ],
};

const FLOW_ITEMS: Record<Language, FlowItem[]> = {
  th: [
    { title: "เปิดโต๊ะ", desc: "เลือกโซนและโต๊ะจากหน้าร้าน แล้วเริ่มออเดอร์โดยไม่ต้องจดแยก", icon: Table2 },
    { title: "รับออเดอร์", desc: "เลือกเมนูและจำนวน ตรวจรายการ แล้วส่งเข้าครัวทันที", icon: ShoppingCart },
    { title: "เข้าครัว", desc: "ครัวเห็นคิวใหม่ กำลังทำ และรายการที่เสร็จแล้วจากจอเดียว", icon: ChefHat },
    { title: "ปิดบิล", desc: "ตรวจรายการ รับเงินสดหรือ PromptPay แล้วคืนสถานะโต๊ะ", icon: ReceiptText },
  ],
  en: [
    { title: "Open a table", desc: "Choose a zone and table, then start an order without separate notes.", icon: Table2 },
    { title: "Take orders", desc: "Choose dishes and quantities, review the order, and send it to the kitchen.", icon: ShoppingCart },
    { title: "Send to kitchen", desc: "Chefs see new, cooking, and completed tickets from one queue.", icon: ChefHat },
    { title: "Close the bill", desc: "Review the order, take cash or PromptPay, and release the table.", icon: ReceiptText },
  ],
};

const ROLE_ITEMS: Record<Language, RoleItem[]> = {
  th: [
    { role: "เจ้าของร้าน", title: "เห็นภาพร้านโดยไม่ต้องถามทุกแผนก", desc: "ดูโต๊ะที่ติดคิว อาหารที่ครัวทำเสร็จ และบิลรอชำระจากภาพรวมเดียว", icon: BarChart3 },
    { role: "พนักงานหน้าร้าน", title: "รับออเดอร์แล้วรู้ทันทีว่าครัวถึงไหน", desc: "ลดการเดินถามครัวซ้ำ และช่วยให้เสิร์ฟอาหารได้ตรงจังหวะ", icon: UsersRound },
    { role: "ครัว", title: "จัดลำดับคิวจากรายการที่อ่านง่าย", desc: "แยกคิวใหม่ กำลังทำ และเสร็จแล้วโดยไม่ต้องไล่กระดาษย้อนหลัง", icon: ChefHat },
    { role: "แคชเชียร์", title: "ตรวจบิลและรับชำระจากข้อมูลเดียวกัน", desc: "ลดการคีย์ซ้ำตอนปิดบิล และคืนโต๊ะให้รอบถัดไปได้เร็วขึ้น", icon: CreditCard },
  ],
  en: [
    { role: "Owner", title: "See the whole restaurant without checking every station", desc: "Review delayed tables, completed kitchen items, and bills awaiting payment from one overview.", icon: BarChart3 },
    { role: "Front-of-house staff", title: "Take orders and see kitchen progress immediately", desc: "Spend less time checking with the kitchen and serve each dish at the right moment.", icon: UsersRound },
    { role: "Kitchen", title: "Prioritize tickets at a glance", desc: "Separate new, cooking, and completed tickets without searching through paper slips.", icon: ChefHat },
    { role: "Cashier", title: "Review bills and take payment from the same order", desc: "Avoid re-entering details at checkout and release tables sooner.", icon: CreditCard },
  ],
};

const LANDING_COPY: Record<Language, {
  nav: [string, string, string];
  login: string;
  register: string;
  heroTitle: string;
  heroImageAlt: string;
  phoneImageAlt: string;
  proofTitle: string;
  proofDesc: string;
  workflowTitle: string;
  workflowDesc: string;
  rolesTitle: string;
  rolesDesc: string;
  aiTitle: string;
  aiDesc: string;
  ctaLabel: string;
  ctaTitle: string;
  ctaDesc: string;
  footerProject: string;
  footerWorkflow: string;
  mockup: Record<string, string>;
}> = {
  th: {
    nav: ["ภาพรวม", "กะร้าน", "ทีม"],
    login: "เข้าสู่ระบบ",
    register: "เริ่มใช้งาน",
    heroTitle: "จัดการร้านได้ผ่านมือถือ",
    heroImageAlt: "ทีมครัวกำลังทำอาหารระหว่างกะเย็นในร้านอาหาร",
    phoneImageAlt: "ตัวอย่าง Dishy บนมือถือ",
    proofTitle: "ยกระดับร้านด้วยข้อมูลที่ทีมเห็นตรงกัน",
    proofDesc: "บริหารออเดอร์ งานครัว การชำระเงิน และภาพรวมร้านจากพื้นที่ทำงานเดียว",
    workflowTitle: "ขั้นตอนการทำงานที่ต่อเนื่อง",
    workflowDesc: "หน้าร้าน ครัว และแคชเชียร์อัปเดตสถานะจากออเดอร์ชุดเดียวกัน ลดการจดซ้ำและการเดินถาม",
    rolesTitle: "แต่ละบทบาทเห็นสิ่งที่ต้องจัดการ",
    rolesDesc: "ระบบแยกหน้างานให้เหมาะกับเจ้าของร้าน พนักงานหน้าร้าน ครัว และแคชเชียร์ โดยใช้สถานะจากกะเดียวกัน",
    aiTitle: "AI ผู้ช่วยสำหรับข้อมูลในร้านของคุณ",
    aiDesc: "ถามยอดขาย เมนู และวัตถุดิบจากข้อมูลที่ระบบมี เพื่อช่วยตรวจสถานการณ์ก่อนตัดสินใจ",
    ctaLabel: "พร้อมเริ่มกะถัดไป",
    ctaTitle: "เปิดร้านด้วยระบบที่เห็นจังหวะงานจริง",
    ctaDesc: "เข้าสู่ระบบเพื่อสร้างร้าน ตั้งค่าโต๊ะ เมนู และเชิญทีมให้ทดลองขั้นตอนหน้าร้าน ครัว และปิดบิล",
    footerProject: "ระบบจัดการงานร้านอาหารสำหรับโปรเจกต์ Pre-capstone",
    footerWorkflow: "ออกแบบสำหรับขั้นตอนการทำงานของร้านอาหารไทย",
    mockup: {
      overview: "ภาพรวมกะร้าน", shift: "กะเย็นวันนี้", open: "เปิดให้บริการ", focusLabel: "สิ่งที่ต้องเห็นในกะนี้", focusTitle: "โต๊ะ คิวครัว และบิลอยู่ในภาพเดียว", focusDesc: "ใช้สำหรับช่วงที่ร้านต้องตัดสินใจเร็ว ไม่ใช่แค่ดูรายงานหลังปิดร้าน", front: "หน้าร้านรับออเดอร์", kitchen: "ครัวอัปเดตสถานะ", cashier: "แคชเชียร์ปิดบิล", floorMap: "ผังโต๊ะ", zones: "โซน A-C", activity: "ความเคลื่อนไหว", live: "สด", kitchenQueue: "คิวครัว", updatedFromPos: "อัปเดตจาก POS", table: "โต๊ะ", paymentTitle: "โต๊ะ B2 รอชำระ", paymentDesc: "ตรวจรายการ รับชำระ และคืนสถานะโต๊ะจากขั้นตอนเดียว",
    },
  },
  en: {
    nav: ["Overview", "Workflow", "Team"],
    login: "Sign in",
    register: "Get started",
    heroTitle: "Run your restaurant from your phone",
    heroImageAlt: "A kitchen team preparing dishes during an evening restaurant shift",
    phoneImageAlt: "Dishy shown on a mobile phone",
    proofTitle: "Keep the whole team aligned with shared restaurant data",
    proofDesc: "Manage orders, kitchen progress, payments, and the live state of your restaurant from one workspace.",
    workflowTitle: "One continuous restaurant workflow",
    workflowDesc: "Front of house, kitchen, and cashier update the same order, reducing duplicate entry and status checks.",
    rolesTitle: "Give every role the right operational view",
    rolesDesc: "Owners, front-of-house staff, kitchen teams, and cashiers each see the work they need while sharing one shift status.",
    aiTitle: "An AI assistant for your restaurant data",
    aiDesc: "Ask about sales, menu performance, and inventory using the data already recorded in the system.",
    ctaLabel: "Ready for the next shift",
    ctaTitle: "Run the next shift around real restaurant work",
    ctaDesc: "Sign in to create a restaurant, configure tables and menus, and invite your team to try the front-of-house, kitchen, and billing flow.",
    footerProject: "Pre-capstone restaurant operations system",
    footerWorkflow: "Built for Thai restaurant workflows",
    mockup: {
      overview: "Live shift overview", shift: "Tonight's shift", open: "Open", focusLabel: "What matters this shift", focusTitle: "Tables, kitchen queue, and bills in one view", focusDesc: "Built for moments when the team needs to act quickly, not only review reports after closing.", front: "Front of house takes orders", kitchen: "Kitchen updates status", cashier: "Cashier closes bills", floorMap: "Floor map", zones: "Zones A-C", activity: "Activity", live: "live", kitchenQueue: "Kitchen queue", updatedFromPos: "Updated from POS", table: "Table", paymentTitle: "Table B2 awaiting payment", paymentDesc: "Review the order, take payment, and release the table from one flow.",
    },
  },
};

const TABLE_TONES = [
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300",
  "border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300",
  "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/25 dark:text-orange-300",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
];

const TABLES: Record<Language, Array<{ id: string; status: string; tone: string }>> = {
  th: ["ว่าง", "กำลังทาน", "ครัวทำเสร็จ", "เปิดบิล", "รอชำระ", "ครัวกำลังทำ"].map((status, index) => ({ id: ["A1", "A2", "A3", "B1", "B2", "C1"][index], status, tone: TABLE_TONES[index] })),
  en: ["Free", "Dining", "Kitchen completed", "Bill opened", "Awaiting payment", "Kitchen cooking"].map((status, index) => ({ id: ["A1", "A2", "A3", "B1", "B2", "C1"][index], status, tone: TABLE_TONES[index] })),
};

const KITCHEN_TICKETS: Record<Language, Array<{ table: string; item: string; state: string; dot: string }>> = {
  th: [
    { table: "A2", item: "กะเพราหมูสับ + ไข่ดาว", state: "กำลังทำ", dot: "bg-amber-500" },
    { table: "A3", item: "ต้มยำกุ้ง, ข้าวเปล่า", state: "เสร็จแล้ว", dot: "bg-emerald-500" },
    { table: "C1", item: "ผัดไทย, ชาไทยเย็น", state: "คิวใหม่", dot: "bg-sky-500" },
  ],
  en: [
    { table: "A2", item: "Minced pork basil + fried egg", state: "Cooking", dot: "bg-amber-500" },
    { table: "A3", item: "Tom yum goong, steamed rice", state: "Done", dot: "bg-emerald-500" },
    { table: "C1", item: "Pad Thai, Thai iced tea", state: "New ticket", dot: "bg-sky-500" },
  ],
};

type MockPip = { text: string; note?: string };
type MockLane = { name: string; tint: string; color: string; pips: MockPip[] };
type MockCard = { kind: "attention" | "floor" | "sales"; title: string; lanes?: MockLane[]; metrics?: boolean };

const LANE_STYLE = {
  red: { tint: "border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300", color: "text-red-600 dark:text-red-300" },
  amber: { tint: "border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300", color: "text-amber-600 dark:text-amber-300" },
  orange: { tint: "border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-900/60 dark:bg-orange-950/25 dark:text-orange-300", color: "text-orange-600 dark:text-orange-300" },
  sky: { tint: "border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300", color: "text-sky-600 dark:text-sky-300" },
  emerald: { tint: "border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300", color: "text-emerald-600 dark:text-emerald-300" },
};

const AI_MOCK: Record<Language, {
  greeting: string;
  question: string;
  answer: string;
  quick: string[];
  placeholder: string;
}> = {
  th: {
    greeting: "ถามอะไรก็ได้เกี่ยวกับร้านของคุณ",
    question: "เมนูไหนขายดีที่สุดเดือนนี้",
    answer: "ผัดไทยขายได้ 148 จาน คิดเป็น 22% ของจานที่ขายทั้งเดือน ตามด้วยกะเพราหมูสับ 121 จาน",
    quick: ["สรุปร้าน", "เมนูขายดี", "วัตถุดิบใกล้หมด", "มูลค่าสต๊อก"],
    placeholder: "ถามเกี่ยวกับร้านของคุณ",
  },
  en: {
    greeting: "Ask anything about your restaurant.",
    question: "Which menu sold best this month?",
    answer: "Pad Thai sold 148 dishes, 22% of everything that left the kitchen this month, with minced pork basil next at 121.",
    quick: ["Summarize today", "Best sellers", "Low stock", "Stock value"],
    placeholder: "Ask about your restaurant",
  },
};

// One dial for the whole mockup: the dashboard is drawn at the sizes it ships
// at and then taken down to fit the section it sits in.
const MOCK_ZOOM = 0.7;

const MOCK_SHELL: Record<Language, { title: string; date: string; month: string; monthNote: string; queue: string; tickets: string; viewKitchen: string; floorTitle: string; viewFloor: string; day: string; monthTab: string }> = {
  th: { title: "ภาพรวม", date: "เสาร์ 30 สิงหาคม", month: "สรุปเดือนนี้", monthNote: "สิงหาคม 2026", queue: "คิวครัว", tickets: "4 ใบ", viewKitchen: "ไปที่ครัว", floorTitle: "ผังโต๊ะ", viewFloor: "ไปที่ผังโต๊ะ", day: "ทั้งวัน", monthTab: "ทั้งเดือน" },
  en: { title: "Overview", date: "Sat 30 August", month: "Month summary", monthNote: "August 2026", queue: "Kitchen queue", tickets: "4 tickets", viewKitchen: "Open kitchen", floorTitle: "Floor map", viewFloor: "Open floor", day: "This day", monthTab: "This month" },
};

// What the open card shows: the kitchen's three lanes with the tickets in
// them, written out the way the card does rather than as pips.
type MockTicket = { table: string; order: string; dishes: string; wait: string; total: string };

const OPEN_LANES: Record<Language, Array<{ name: string; tint: string; color: string; tickets: MockTicket[] }>> = {
  th: [
    { name: "เกินเวลา", ...LANE_STYLE.red, tickets: [{ table: "A2", order: "042", dishes: "กะเพราหมูสับ · ไข่ดาว", wait: "18 นาที", total: "฿240" }] },
    { name: "กำลังทำ", ...LANE_STYLE.amber, tickets: [
      { table: "A3", order: "043", dishes: "ต้มยำกุ้ง · ข้าวเปล่า", wait: "6 นาที", total: "฿320" },
      { table: "C1", order: "044", dishes: "ผัดไทย · ชาไทยเย็น", wait: "2 นาที", total: "฿180" },
    ] },
    { name: "เสร็จแล้ว", ...LANE_STYLE.emerald, tickets: [{ table: "B1", order: "041", dishes: "ข้าวผัดปู · น้ำเปล่า", wait: "1 นาที", total: "฿260" }] },
  ],
  en: [
    { name: "Overdue", ...LANE_STYLE.red, tickets: [{ table: "A2", order: "042", dishes: "Minced pork basil · Fried egg", wait: "18 min", total: "฿240" }] },
    { name: "Cooking", ...LANE_STYLE.amber, tickets: [
      { table: "A3", order: "043", dishes: "Tom yum goong · Steamed rice", wait: "6 min", total: "฿320" },
      { table: "C1", order: "044", dishes: "Pad Thai · Thai iced tea", wait: "2 min", total: "฿180" },
    ] },
    { name: "Done", ...LANE_STYLE.emerald, tickets: [{ table: "B1", order: "041", dishes: "Crab fried rice · Water", wait: "1 min", total: "฿260" }] },
  ],
};

// The rest of what an open card holds: the day's orders and the stock risks
// under the kitchen queue, the party and clock on a table, and the peak hours
// under the sales figures.
const OPEN_EXTRAS: Record<Language, {
  ordersTitle: string; ordersCount: string; viewOrders: string;
  cols: [string, string, string, string];
  orders: Array<{ number: string; where: string; status: string; tone: string; total: string; time: string }>;
  stockTitle: string; stockCount: string; viewStock: string;
  stock: Array<{ name: string; level: string; restock: string }>;
  peakTitle: string; peaks: Array<{ hour: string; value: string }>;
  tables: Array<{ id: string; status: string; color: string; detail: string }>;
}> = {
  th: {
    ordersTitle: "ออเดอร์วันนี้", ordersCount: "18 ออเดอร์", viewOrders: "ดูทั้งหมด",
    cols: ["ออเดอร์", "โต๊ะ", "ยอด", "เวลา"],
    orders: [
      { number: "044", where: "โต๊ะ C1", status: "กำลังทำ", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", total: "฿180", time: "18:41" },
      { number: "043", where: "โต๊ะ A3", status: "กำลังทำ", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", total: "฿320", time: "18:35" },
      { number: "041", where: "โต๊ะ B1", status: "ชำระแล้ว", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", total: "฿260", time: "18:12" },
    ],
    stockTitle: "วัตถุดิบที่ต้องดู", stockCount: "3 รายการ", viewStock: "ไปที่คลัง",
    stock: [
      { name: "หมูสับ", level: "1.2 / 5 กิโลกรัม", restock: "เติม 8 กิโลกรัม" },
      { name: "โหระพา", level: "0.4 / 2 กิโลกรัม", restock: "เติม 3 กิโลกรัม" },
    ],
    peakTitle: "ช่วงที่ขายดี",
    peaks: [{ hour: "18:00", value: "฿4,180" }, { hour: "19:00", value: "฿3,640" }, { hour: "12:00", value: "฿2,910" }],
    tables: [
      { id: "A1", status: "ว่าง", color: "text-emerald-600 dark:text-emerald-300", detail: "4 ที่นั่ง" },
      { id: "A2", status: "ใช้งาน", color: "text-amber-600 dark:text-amber-300", detail: "4 คน · 42 นาที" },
      { id: "A3", status: "ใช้งาน", color: "text-amber-600 dark:text-amber-300", detail: "2 คน · 18 นาที" },
      { id: "B1", status: "จอง", color: "text-sky-600 dark:text-sky-300", detail: "6 คน · 19:30" },
      { id: "B2", status: "รอชำระ", color: "text-orange-600 dark:text-orange-300", detail: "3 คน · 74 นาที" },
      { id: "C1", status: "ว่าง", color: "text-emerald-600 dark:text-emerald-300", detail: "2 ที่นั่ง" },
    ],
  },
  en: {
    ordersTitle: "Today's orders", ordersCount: "18 orders", viewOrders: "View all",
    cols: ["Order", "Table", "Total", "Time"],
    orders: [
      { number: "044", where: "Table C1", status: "Cooking", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", total: "฿180", time: "18:41" },
      { number: "043", where: "Table A3", status: "Cooking", tone: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", total: "฿320", time: "18:35" },
      { number: "041", where: "Table B1", status: "Paid", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", total: "฿260", time: "18:12" },
    ],
    stockTitle: "Stock risks", stockCount: "3 ingredients", viewStock: "Open inventory",
    stock: [
      { name: "Minced pork", level: "1.2 / 5 kg", restock: "Restock 8 kg" },
      { name: "Thai basil", level: "0.4 / 2 kg", restock: "Restock 3 kg" },
    ],
    peakTitle: "Peak hours",
    peaks: [{ hour: "18:00", value: "฿4,180" }, { hour: "19:00", value: "฿3,640" }, { hour: "12:00", value: "฿2,910" }],
    tables: [
      { id: "A1", status: "Available", color: "text-emerald-600 dark:text-emerald-300", detail: "4 seats" },
      { id: "A2", status: "Occupied", color: "text-amber-600 dark:text-amber-300", detail: "4 people · 42 min" },
      { id: "A3", status: "Occupied", color: "text-amber-600 dark:text-amber-300", detail: "2 people · 18 min" },
      { id: "B1", status: "Reserved", color: "text-sky-600 dark:text-sky-300", detail: "6 people · 19:30" },
      { id: "B2", status: "Awaiting payment", color: "text-orange-600 dark:text-orange-300", detail: "3 people · 74 min" },
      { id: "C1", status: "Available", color: "text-emerald-600 dark:text-emerald-300", detail: "2 seats" },
    ],
  },
};

const FACE_CARDS: Record<Language, MockCard[]> = {
  th: [
    {
      kind: "attention",
      title: "งานที่ต้องจัดการตอนนี้",
      lanes: [
        { name: "เกินเวลา", ...LANE_STYLE.red, pips: [{ text: "A2", note: "042" }] },
        { name: "กำลังทำ", ...LANE_STYLE.amber, pips: [{ text: "A3", note: "043" }, { text: "C1", note: "044" }] },
        { name: "วัตถุดิบใกล้หมด", ...LANE_STYLE.orange, pips: [{ text: "หมูสับ" }, { text: "โหระพา" }] },
      ],
    },
    {
      kind: "floor",
      title: "สถานะโต๊ะ",
      lanes: [
        { name: "ใช้งาน", ...LANE_STYLE.amber, pips: [{ text: "A2", note: "4p" }, { text: "A3", note: "2p" }] },
        { name: "จอง", ...LANE_STYLE.sky, pips: [{ text: "B1", note: "6p" }] },
        { name: "ว่าง", ...LANE_STYLE.emerald, pips: [{ text: "A1", note: "4s" }, { text: "C1", note: "2s" }] },
      ],
    },
    { kind: "sales", title: "ยอดขาย", metrics: true },
  ],
  en: [
    {
      kind: "attention",
      title: "Needs attention now",
      lanes: [
        { name: "Overdue", ...LANE_STYLE.red, pips: [{ text: "A2", note: "042" }] },
        { name: "Cooking", ...LANE_STYLE.amber, pips: [{ text: "A3", note: "043" }, { text: "C1", note: "044" }] },
        { name: "Low stock", ...LANE_STYLE.orange, pips: [{ text: "Minced pork" }, { text: "Thai basil" }] },
      ],
    },
    {
      kind: "floor",
      title: "Floor status",
      lanes: [
        { name: "Occupied", ...LANE_STYLE.amber, pips: [{ text: "A2", note: "4p" }, { text: "A3", note: "2p" }] },
        { name: "Reserved", ...LANE_STYLE.sky, pips: [{ text: "B1", note: "6p" }] },
        { name: "Available", ...LANE_STYLE.emerald, pips: [{ text: "A1", note: "4s" }, { text: "C1", note: "2s" }] },
      ],
    },
    { kind: "sales", title: "Sales", metrics: true },
  ],
};

const metricToneClass: Record<ShiftMetric["tone"], string> = {
  neutral: "text-gray-950 dark:text-white",
  orange: "text-orange-600 dark:text-orange-400",
  amber: "text-amber-600 dark:text-amber-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  sky: "text-sky-600 dark:text-sky-400",
};

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { language } = useLanguage();
  const Icon = theme === "dark" ? Sun : Moon;
  const title = theme === "dark"
    ? language === "th" ? "สลับเป็นโหมดสว่าง" : "Switch to light mode"
    : language === "th" ? "สลับเป็นโหมดมืด" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={title}
      title={title}
      className="landing-lift inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} />
    </button>
  );
}

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div
      style={{ transitionDelay: `${delay}ms` }}
      className={`flex flex-col justify-center items-center transition-transform duration-300 ease-out motion-reduce:transition-none ${className}`}
    >
      {children}
    </div>
  );
}

function HeroReveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div style={{ animationDelay: `${delay}ms` }} className={`landing-hero-reveal ${className}`}>
      {children}
    </div>
  );
}

function LandingMotionStyles() {
  return (
    <style>{`
      :root {
        --landing-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --landing-ease-soft: cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes landingHeroPhoto {
        from {
          transform: scale(1.035);
          filter: saturate(0.92) contrast(0.96);
        }
        to {
          transform: scale(1);
          filter: saturate(1) contrast(1);
        }
      }

      @keyframes landingHeroReveal {
        from {
          opacity: 0;
          transform: translateY(14px);
          filter: blur(6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
        }
      }

      @keyframes landingProofReveal {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes landingLivePulse {
        0%, 100% {
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
        }
        45% {
          box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.14);
        }
      }

      .landing-hero-photo {
        animation: landingHeroPhoto 820ms var(--landing-ease-soft) both;
        transform-origin: 62% 44%;
      }

      .landing-hero-reveal {
        opacity: 0;
        animation: landingHeroReveal 560ms var(--landing-ease) both;
      }

      .landing-proof-card {
        opacity: 0;
        animation: landingProofReveal 440ms var(--landing-ease) both;
      }

      .landing-live-chip {
        animation: landingLivePulse 1800ms var(--landing-ease) infinite;
      }

      .landing-lift {
        transition:
          transform 180ms var(--landing-ease),
          border-color 180ms var(--landing-ease),
          background-color 180ms var(--landing-ease),
          box-shadow 180ms var(--landing-ease);
      }

      .landing-lift:hover {
        transform: translateY(-2px);
      }

      .landing-lift:active {
        transform: translateY(0);
      }

      @media (prefers-reduced-motion: reduce) {
        .landing-hero-photo,
        .landing-hero-reveal,
        .landing-proof-card,
        .landing-live-chip {
          animation: none !important;
          opacity: 1 !important;
          transform: none !important;
          filter: none !important;
        }

        .landing-lift {
          transition: none !important;
        }

        .landing-lift:hover,
        .landing-lift:active {
          transform: none !important;
        }

        .ui-press:active {
          transform: none !important;
        }
      }
    `}</style>
  );
}
function SwiperStyle() {
  return(
    <style>{`
  .role-swiper .swiper-wrapper {
    align-items: stretch;
  }

  .role-swiper .swiper-slide {
    height: auto;
    display: flex;
  }

  .role-swiper .swiper-slide > * {
    width: 100%;
  `}</style>
  );
}
function SecondaryButton({onClick, children}: {onClick: () => void; children: ReactNode}) {
  return(
    <button
      type="button"
      onClick={onClick}
      className="ui-press landing-lift inline-flex h-20 w-100 max-w-6xl items-center rounded-[10px] bg-orange-700 px-5 text-xl sm:text-3xl md:text-4xl lg:text-[60px] font-semibold text-white transition-colors hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800"
    >
      {/* กลาง */}
      <span className="flex flex-[6] items-center justify-center">
        {children}
      </span>

      {/* ขวา */}
      <span className="flex flex-[1] items-center justify-end">
        <ArrowRight className="h-6 w-6 shrink-0" strokeWidth={3} />
      </span>
    </button>
  );
}
function PrimaryButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-press landing-lift inline-flex h-25 w-full max-w-6xl items-center rounded-[10px] bg-orange-700 px-5 text-xl sm:text-3xl md:text-4xl lg:text-[60px] font-semibold text-white transition-colors hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800"
    >
      {/* อันแรก — เล็กสุด */}
      <span className="flex flex-[1] items-center justify-start">
         
      </span>

      {/* กลาง */}
      <span className="flex flex-[2] items-center justify-center">
        {children}
      </span>

      {/* ขวา */}
      <span className="flex flex-[1] items-center justify-end">
        <ArrowRight className="h-6 w-6 shrink-0" strokeWidth={3} />
      </span>
    </button>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="max-w-3xl flex flex-col items-center">
      <h2 className="text-3xl font-semibold leading-tight text-gray-950 sm:text-4xl dark:text-white">{title}</h2>
      <p className="mt-4 text-base leading-7 text-gray-600 dark:text-gray-400">{desc}</p>
    </div>
  );
}

function HeroImage({ alt }: { alt: string }) {
  return (
    <Image
      src={HERO_IMAGE_URL}
      alt={alt}
      fill
      priority
      unoptimized
      sizes="100vw"
      className="landing-hero-photo object-cover"
    />
  );
}

function PhoneMockup({ label, language }: { label: string; language: Language }) {
  const copy = LANDING_COPY[language].mockup;
  const phoneTables = [TABLES[language][0], TABLES[language][1], TABLES[language][4]];
  const phoneTickets = KITCHEN_TICKETS[language].slice(0, 2);

  return (
    <div
      role="img"
      aria-label={label}
      className="relative aspect-[9/16] w-48 shrink-0 sm:w-64 md:w-80 lg:w-96"
    >
      <div
        aria-hidden="true"
        className="relative h-full overflow-hidden rounded-[2rem] bg-gray-950 p-[5px] shadow-[0_8px_8px_rgba(3,7,18,0.32)] sm:rounded-[2.5rem] sm:p-2 md:rounded-[3rem]"
      >
        <div className="relative flex h-full flex-col overflow-hidden rounded-[1.7rem] bg-slate-50 text-gray-950 sm:rounded-[2.05rem] md:rounded-[2.5rem]">
          <div className="absolute left-1/2 top-2 z-10 h-3 w-14 -translate-x-1/2 rounded-full bg-gray-950 sm:top-3 sm:h-4 sm:w-20" />

          <div className="flex items-center justify-between px-4 pb-1 pt-2.5 font-mono text-[7px] font-semibold tabular-nums text-gray-600 sm:px-5 sm:pb-2 sm:pt-4 sm:text-[9px] md:px-6 md:text-[11px]">
            <span>09:41</span>
            <span className="flex items-end gap-0.5">
              <span className="h-1 w-0.5 rounded-full bg-gray-500 sm:h-1.5" />
              <span className="h-1.5 w-0.5 rounded-full bg-gray-600 sm:h-2" />
              <span className="h-2 w-0.5 rounded-full bg-gray-800 sm:h-2.5" />
            </span>
          </div>

          <div className="flex items-center gap-1.5 border-b border-gray-200 bg-white px-2.5 py-2 sm:gap-2.5 sm:px-4 sm:py-3 md:px-5">
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white sm:h-7 sm:w-7 md:h-9 md:w-9">
              <Store className="h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <AppWordmark decorative height={10} className="text-gray-950" />
              <p className="truncate text-[6px] text-gray-500 sm:text-[9px] md:text-[11px]">{copy.shift}</p>
            </div>
            <span className="rounded bg-emerald-50 px-1 py-0.5 text-[6px] font-semibold text-emerald-700 sm:px-1.5 sm:text-[8px] md:text-[10px]">
              {copy.open}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden px-2.5 py-2 sm:px-4 sm:py-3 md:px-5 md:py-4">
            <div className="rounded-md bg-gray-950 px-2.5 py-2 text-white sm:px-3.5 sm:py-3 md:px-4 md:py-4">
              <p className="text-[6px] font-medium text-orange-300 sm:text-[8px] md:text-[10px]">
                {copy.focusLabel}
              </p>
              <p className="mt-1 line-clamp-2 text-[9px] font-semibold leading-tight sm:text-xs md:text-base">
                {copy.focusTitle}
              </p>
            </div>

            <div className="grid grid-cols-3 border-b border-gray-200 py-2 sm:py-3 md:py-4">
              {[copy.front, copy.kitchen, copy.cashier].map((item, index) => {
                const Icon = [Table2, ChefHat, ReceiptText][index];
                return (
                  <div
                    key={item}
                    className={`min-w-0 px-1.5 text-center sm:px-2 ${index > 0 ? "border-l border-gray-200" : ""}`}
                  >
                    <Icon className="mx-auto h-3 w-3 text-gray-700 sm:h-4 sm:w-4 md:h-5 md:w-5" strokeWidth={1.8} />
                    <p className="mt-1 truncate text-[6px] font-medium text-gray-600 sm:text-[8px] md:text-[10px]">
                      {item}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="border-b border-gray-200 py-2 sm:py-3 md:py-4">
              <div className="flex items-center justify-between">
                <p className="text-[8px] font-semibold sm:text-[10px] md:text-xs">{copy.floorMap}</p>
                <span className="text-[6px] text-gray-500 sm:text-[8px] md:text-[10px]">{copy.zones}</span>
              </div>
              <div className="mt-1.5 grid grid-cols-3 gap-1 sm:mt-2 sm:gap-1.5 md:gap-2">
                {phoneTables.map((table) => (
                  <div key={table.id} className={`rounded-md border px-1 py-1.5 text-center sm:py-2 md:py-2.5 ${table.tone}`}>
                    <p className="font-mono text-[8px] font-semibold tabular-nums sm:text-[10px] md:text-xs">{table.id}</p>
                    <p className="mt-0.5 truncate text-[5px] font-medium sm:text-[7px] md:text-[9px]">{table.status}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-b border-gray-200 py-2 sm:py-3 md:py-4">
              <div className="flex items-center justify-between">
                <p className="text-[8px] font-semibold sm:text-[10px] md:text-xs">{copy.kitchenQueue}</p>
                <span className="text-[6px] font-medium text-gray-500 sm:text-[8px] md:text-[10px]">{copy.live}</span>
              </div>
              <div className="mt-1.5 space-y-1 sm:mt-2 sm:space-y-1.5">
                {phoneTickets.map((ticket) => (
                  <div key={`${ticket.table}-${ticket.item}`} className="flex items-center gap-1.5 sm:gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full sm:h-2 sm:w-2 ${ticket.dot}`} />
                    <p className="shrink-0 font-mono text-[6px] font-semibold tabular-nums sm:text-[8px] md:text-[10px]">
                      {ticket.table}
                    </p>
                    <p className="min-w-0 flex-1 truncate text-[6px] text-gray-600 sm:text-[8px] md:text-[10px]">
                      {ticket.item}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 py-1.5 sm:py-2.5 md:py-4">
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-600 sm:h-7 sm:w-7 md:h-8 md:w-8">
                <CreditCard className="h-3 w-3 sm:h-4 sm:w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[7px] font-semibold sm:text-[9px] md:text-[11px]">{copy.paymentTitle}</p>
                <p className="mt-0.5 truncate text-[5px] text-gray-500 sm:text-[7px] md:text-[9px]">{copy.paymentDesc}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 border-t border-gray-200 bg-white px-3 py-1.5 text-gray-500 sm:px-5 sm:py-2.5 md:py-3">
            {[BarChart3, Table2, ChefHat, UsersRound].map((Icon, index) => (
              <span key={index} className={`flex justify-center ${index === 0 ? "text-orange-600" : ""}`}>
                <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 md:h-5 md:w-5" strokeWidth={1.8} />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageAndDownload({ btn, language }: { btn: () => void; language: Language }) {
  const copy = LANDING_COPY[language];

  return (
    <div className="m-6 mb-6 flex flex-col items-center gap-6 sm:flex-row sm:justify-start sm:gap-16 md:gap-24 lg:gap-64">
      <PhoneMockup label={copy.phoneImageAlt} language={language} />
      <div className="flex flex-col items-center gap-4 sm:items-center">
        <PrimaryButton onClick={btn}>{copy.register}</PrimaryButton>
       <HeroProofStrip language={language} />
      </div>
    </div>
  );
}
function HeroProofStrip({ language }: { language: Language }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 lg:gap-4">
      {HERO_PROOFS[language].map((item, index) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            style={{ animationDelay: `${260 + index * 70}ms` }}
            className="landing-proof-card rounded-md border border-white/18 bg-gray-950/78 p-3 text-white sm:p-3.5 lg:p-4"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-gray-950 sm:h-9 sm:w-9">
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-orange-200 sm:text-[15px]">
                  {item.label}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AiAssistantMockup({ language }: { language: Language }) {
  const mock = AI_MOCK[language];

  return (
    <div className="relative overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-orange-400 via-amber-400 to-orange-600" />
            <p className="min-w-0 rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm text-gray-800 dark:bg-gray-800/80 dark:text-gray-100">
              {mock.greeting}
            </p>
          </div>

          <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-orange-500 to-amber-500 px-4 py-2.5 text-sm text-white">
            {mock.question}
          </p>

          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-gradient-to-br from-orange-400 via-amber-400 to-orange-600" />
            <p className="min-w-0 rounded-2xl rounded-tl-md bg-gray-100 px-4 py-2.5 text-sm leading-6 text-gray-800 dark:bg-gray-800/80 dark:text-gray-100">
              {mock.answer}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {mock.quick.map((item) => (
              <span
                key={item}
                className="rounded-full border border-gray-200 px-3 py-1 text-[12px] text-gray-600 dark:border-gray-800 dark:text-gray-300"
              >
                {item}
              </span>
            ))}
          </div>

          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-gray-200 px-3 py-2 dark:border-gray-800">
            <span className="min-w-0 flex-1 truncate text-sm text-gray-500">{mock.placeholder}</span>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-600 text-white">
            <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
          </span>
        </div>
      </div>
    </div>
  );
}

function CommandCenterMockup({ language }: { language: Language }) {
  // The real thing opens a card into a folder: its tab keeps its slot in the
  // strip, the others fold down beside it, and the body drops below. Clicking
  // the open tab again puts the grid back.
  const [openCard, setOpenCard] = useState<string | null>(null);
  const cards = FACE_CARDS[language];
  const shell = MOCK_SHELL[language];
  const extras = OPEN_EXTRAS[language];
  const open = cards.find((card) => card.title === openCard) ?? null;

  const laneBlock = (lane: MockLane) => (
    <div key={lane.name} className="flex min-h-0 min-w-0 flex-auto flex-col overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      <div className={`flex items-baseline gap-1.5 border-b px-2 py-0.5 text-[12px] leading-tight ${lane.tint}`}>
        <span className="truncate font-bold uppercase tracking-wide">{lane.name}</span>
        <span className="ml-auto shrink-0 font-mono font-bold tabular-nums">{lane.pips.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-wrap gap-1.5 px-2 py-1.5 leading-none">
        {lane.pips.map((pip) => (
          <span
            key={pip.text}
            className={`inline-flex flex-col items-center justify-center gap-0.5 rounded-md border border-current/30 px-1.5 py-1 font-mono text-[13px] ${lane.color}`}
          >
            <span>{pip.text}</span>
            {pip.note ? <span className="text-[0.68em] opacity-70">{pip.note}</span> : null}
          </span>
          ))}
        </div>
      </div>
    </div>
  );

  const metricTiles = (
    <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
      {SHIFT_METRICS[language].map((metric) => (
        <div key={metric.label} className="flex flex-col items-center justify-center rounded-lg border border-gray-200 p-2 text-center dark:border-gray-800">
          <p className="w-full truncate text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{metric.label}</p>
          <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${metricToneClass[metric.tone]}`}>{metric.value}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative">
      {/* The page itself, shrunk to fit rather than redrawn smaller: every size
          inside is the one the dashboard ships, and `zoom` takes the whole
          thing down together. No width of its own — under `zoom` a block
          already measures itself against the frame in the scaled space, and
          dividing the width back out only pushed the page off the right. */}
      <div className="relative overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
        <div style={{ zoom: MOCK_ZOOM }}>
        {/* The overview page as it ships: its title, the date every figure on
            it is read for, then a card per topic — each a stack of lanes with
            its count and the tables or tickets in it as pips — and the month
            card on a short row of its own under them. */}
        <div className="border-b border-gray-200 bg-slate-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-950">
          <p className="text-[28px] font-bold tracking-tight text-gray-950 dark:text-white sm:text-[34px]">{shell.title}</p>
        </div>

        <div className="flex items-center gap-2 px-4 pt-4">
          <div className="inline-flex max-w-full overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
            <span className="inline-flex h-10 w-10 items-center justify-center border-r border-gray-200 text-gray-600 dark:border-gray-800 dark:text-gray-300">
              <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            </span>
            <span className="inline-flex h-10 min-w-0 items-center gap-2 px-3">
              <CalendarDays className="h-4 w-4 shrink-0 text-gray-500" strokeWidth={1.8} />
              <span className="w-56 min-w-0 truncate text-center text-[13px] font-semibold text-gray-800 dark:text-gray-100">{shell.date}</span>
            </span>
            <span className="inline-flex h-10 w-10 items-center justify-center border-l border-gray-200 text-gray-600 opacity-35 dark:border-gray-800 dark:text-gray-300">
              <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
            </span>
          </div>
        </div>

        {open ? (
          <div className="p-4">
            <div className="flex flex-wrap items-end gap-1.5">
              {cards.map((card) => {
                const isOpen = card.title === open.title;
                return (
                  <button
                    key={card.title}
                    type="button"
                    onClick={() => setOpenCard(isOpen ? null : card.title)}
                    className={`ui-press inline-flex max-w-full items-center rounded-t-lg border px-4 py-2 text-[13px] font-semibold ${
                      isOpen
                        ? "relative z-10 -mb-px border-b-0 border-gray-200 bg-white text-gray-950 dark:border-gray-800 dark:bg-gray-950 dark:text-white"
                        : "translate-y-px border-gray-200 bg-gray-100 text-gray-600 hover:bg-white dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                    }`}
                  >
                    <span className="truncate">{card.title}</span>
                    {isOpen ? (
                      <ChevronUp className="ml-2.5 h-4 w-4 shrink-0 text-gray-500" strokeWidth={1.8} />
                    ) : (
                      <ChevronDown className="ml-2.5 h-3.5 w-3.5 shrink-0 opacity-60" strokeWidth={1.8} />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="overflow-hidden rounded-b-xl rounded-tr-xl border border-gray-200 dark:border-gray-800">
              {open.kind === "attention" ? (
                <>
                  <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                    <div>
                      <p className="text-[13px] font-semibold text-gray-950 dark:text-white">{shell.queue}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{shell.tickets}</p>
                    </div>
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">
                      {shell.viewKitchen}
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                  </div>
                  <div className="grid gap-px bg-gray-200 dark:bg-gray-800 lg:grid-cols-3">
                    {OPEN_LANES[language].map((lane) => (
                      <div key={lane.name} className="bg-white dark:bg-gray-950">
                        <div className={`flex items-center justify-between border-b px-4 py-2.5 ${lane.tint}`}>
                          <p className="text-[12px] font-semibold">{lane.name}</p>
                          <span className="font-mono text-[11px] font-semibold">{lane.tickets.length}</span>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-gray-800">
                          {lane.tickets.map((ticket) => (
                            <div key={ticket.order} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{ticket.table}</span>
                                <span className="font-mono text-[11px] text-gray-500">#{ticket.order}</span>
                              </div>
                              <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">{ticket.dishes}</p>
                              <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                                <span className={lane.color}>{ticket.wait}</span>
                                <span className="font-mono text-gray-500 dark:text-gray-400">{ticket.total}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-200 dark:border-gray-800 xl:flex xl:items-stretch">
                    <div className="min-w-0 xl:flex-1 xl:border-r xl:border-gray-200 xl:dark:border-gray-800">
                      <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <p className="text-[13px] font-semibold text-gray-950 dark:text-white">{extras.ordersTitle}</p>
                          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{extras.ordersCount}</p>
                        </div>
                        <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">
                          {extras.viewOrders}
                          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </span>
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        <div className="grid grid-cols-[minmax(70px,0.6fr)_minmax(90px,1fr)_90px_60px] gap-3 bg-gray-50 px-4 py-2 text-[10px] font-medium text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                          {extras.cols.map((col, index) => (
                            <span key={col} className={index > 1 ? "text-right" : ""}>{col}</span>
                          ))}
                        </div>
                        {extras.orders.map((order) => (
                          <div key={order.number} className="grid grid-cols-[minmax(70px,0.6fr)_minmax(90px,1fr)_90px_60px] items-center gap-3 px-4 py-2.5">
                            <span className="font-mono text-[12px] font-semibold text-gray-950 dark:text-white">#{order.number}</span>
                            <span className="min-w-0 truncate text-[12px] text-gray-600 dark:text-gray-300">
                              {order.where}
                              <span className={`ml-2 inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${order.tone}`}>{order.status}</span>
                            </span>
                            <span className="text-right font-mono text-[12px] font-semibold tabular-nums text-gray-950 dark:text-white">{order.total}</span>
                            <span className="text-right font-mono text-[11px] text-gray-500">{order.time}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-800 xl:w-2/5 xl:border-t-0">
                      <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${LANE_STYLE.orange.tint}`}>
                        <div>
                          <p className="text-[13px] font-semibold">{extras.stockTitle}</p>
                          <p className="mt-0.5 text-[11px] opacity-80">{extras.stockCount}</p>
                        </div>
                        <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-current/30 px-3 text-[12px] font-semibold">
                          {extras.viewStock}
                          <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </span>
                      </div>
                      <div className="grid gap-2 px-4 pb-4 pt-3">
                        {extras.stock.map((item) => (
                          <div key={item.name} className="rounded-md border border-gray-200 px-3 py-2.5 dark:border-gray-800">
                            <div className="flex items-center justify-between gap-3">
                              <span className="truncate text-[13px] font-semibold text-gray-950 dark:text-white">{item.name}</span>
                              <span className="shrink-0 font-mono text-[11px] text-gray-500 dark:text-gray-400">{item.level}</span>
                            </div>
                            <p className="mt-1 font-mono text-[11px] font-semibold text-orange-600 dark:text-orange-300">{item.restock}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : open.kind === "floor" ? (
                <>
                  <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                    <p className="text-[13px] font-semibold text-gray-950 dark:text-white">{shell.floorTitle}</p>
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 dark:border-gray-800 dark:text-gray-300">
                      {shell.viewFloor}
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-gray-200 dark:bg-gray-800 sm:grid-cols-3 lg:grid-cols-6">
                    {extras.tables.map((table) => (
                      <div key={table.id} className="min-h-24 bg-white p-3 dark:bg-gray-950">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-gray-950 dark:text-white">{table.id}</span>
                          <span className={`text-[10px] font-semibold ${table.color}`}>{table.status}</span>
                        </div>
                        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">{table.detail}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-end gap-4 border-b border-gray-200 px-4 pt-3 dark:border-gray-800">
                    <span className="border-b-2 border-gray-900 pb-1.5 text-[17px] font-bold uppercase tracking-wide text-gray-950 dark:border-white dark:text-white">
                      {shell.day}
                    </span>
                    <span className="border-b-2 border-transparent pb-1.5 text-[17px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {shell.monthTab}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
                    {SHIFT_METRICS[language].map((metric) => (
                      <div key={metric.label} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
                        <p className="truncate text-[12px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{metric.label}</p>
                        <p className={`mt-0.5 font-mono text-[22px] font-bold tabular-nums ${metricToneClass[metric.tone]}`}>{metric.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-200 px-4 pb-4 pt-4 dark:border-gray-800">
                    <p className="text-[12px] font-medium text-gray-600 dark:text-gray-300">{extras.peakTitle}</p>
                    <ol className="mt-2 space-y-1.5">
                      {extras.peaks.map((peak, index) => (
                        <li key={peak.hour} className="flex items-baseline gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-800">
                          <span className="font-mono text-[10px] text-gray-500">0{index + 1}</span>
                          <span className="font-mono text-[12px] font-semibold text-gray-950 dark:text-white">{peak.hour}</span>
                          <span className="ml-auto font-mono text-[12px] tabular-nums text-gray-600 dark:text-gray-300">{peak.value}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  onClick={() => setOpenCard(card.title)}
                  className="ui-press group relative flex w-full flex-col items-stretch justify-between gap-3 rounded-xl border border-gray-200 bg-white p-6 text-left !transition-all !duration-300 !ease-out hover:z-10 hover:-rotate-1 hover:scale-[1.05] hover:shadow-lg dark:border-gray-800 dark:bg-gray-950 sm:aspect-[7/10]"
                >
                  <h3 className="rounded-lg bg-gray-100 px-3 py-2 text-center text-[24px] font-bold leading-tight text-gray-950 dark:bg-gray-900 dark:text-white">
                    {card.title}
                  </h3>

                  {card.metrics ? metricTiles : (
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">{card.lanes?.map(laneBlock)}</div>
                  )}
                </button>
              ))}
            </div>

            <div className="px-4 pb-4">
              <div className="flex h-40 w-full flex-col items-center justify-center rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-950">
                <p className="text-[24px] font-bold leading-tight text-gray-950 dark:text-white">{shell.month}</p>
                <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-500">{shell.monthNote}</p>
              </div>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { closeLoginModal, openLoginModal, user, loading } = useAuth();
  const { language } = useLanguage();
  const didRequestAuthOnLanding = useRef(false);
  const authRedirectToRef = useRef<string | undefined>(undefined);
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  const readAuthRedirectTo = useCallback(() => {
    authRedirectToRef.current = safeNextPathFromSearch(window.location.search);
    return authRedirectToRef.current;
  }, []);

  useEffect(() => {
    if (didRequestAuthOnLanding.current || user) return;
    if (readAuthRedirectTo()) return;
    closeLoginModal();
  }, [closeLoginModal, loading, readAuthRedirectTo, user]);

  useEffect(() => {
    if (!loading && user) {
      router.replace(readAuthRedirectTo() ?? "/restaurants");
    }
  }, [loading, readAuthRedirectTo, router, user]);

  useEffect(() => {
    if (loading || user || didRequestAuthOnLanding.current) return;
    const authRedirectTo = readAuthRedirectTo();
    if (!authRedirectTo) return;
    didRequestAuthOnLanding.current = true;
    const timer = window.setTimeout(() => openLoginModal(authRedirectTo), 0);
    return () => window.clearTimeout(timer);
  }, [loading, openLoginModal, readAuthRedirectTo, user]);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(y > 12);
      setProgress(h > 0 ? (y / h) * 100 : 0);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (loading || user) {
    return <div className="min-h-[100dvh] bg-white dark:bg-gray-950" />;
  }

  const headerOnImage = !scrolled;
  const copy = LANDING_COPY[language];
  const openLandingLoginModal = () => {
    didRequestAuthOnLanding.current = true;
    openLoginModal(readAuthRedirectTo());
  };

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <LandingMotionStyles />
      <div
        className="fixed left-0 top-0 z-[60] h-0.5 w-full origin-left bg-orange-500 transition-transform duration-75 motion-reduce:transition-none"
        style={{ transform: `scaleX(${Math.min(progress, 100) / 100})` }}
      />

      <header
        className={`fixed inset-x-0 top-0 z-50 h-16 border-b transition-[background-color,border-color,backdrop-filter] duration-300 ${
          scrolled
            ? "border-gray-200 bg-white/90 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-950/90"
            : "border-white/15 bg-gray-950/44 backdrop-blur-md"
        }`}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <AppLogo decorative size={34} priority />
            <div className="hidden leading-none sm:block">
              <AppWordmark
                height={18}
                className={headerOnImage ? "text-white" : "text-gray-950 dark:text-white"}
              />
              <p className={`mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${headerOnImage ? "text-white/62" : "text-gray-400"}`}>
                Restaurant operations
              </p>
            </div>
          </div>

          <nav className={`hidden items-center gap-6 text-sm font-medium md:flex ${headerOnImage ? "text-white/78" : "text-gray-600 dark:text-gray-400"}`}>
            <a href="#proof" className={`transition-colors ${headerOnImage ? "hover:text-white" : "hover:text-gray-950 dark:hover:text-white"}`}>
              {copy.nav[0]}
            </a>
            <a href="#workflow" className={`transition-colors ${headerOnImage ? "hover:text-white" : "hover:text-gray-950 dark:hover:text-white"}`}>
              {copy.nav[1]}
            </a>
            <a href="#roles" className={`transition-colors ${headerOnImage ? "hover:text-white" : "hover:text-gray-950 dark:hover:text-white"}`}>
              {copy.nav[2]}
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle className="shrink-0" />
            <button
              type="button"
              onClick={openLandingLoginModal}
              className={`ui-press landing-lift inline-flex h-9 items-center justify-center rounded-md px-3.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 ${
                headerOnImage
                  ? "bg-white text-gray-950 hover:bg-gray-100"
                  : "bg-orange-700 text-white hover:bg-orange-800 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800"
              }`}
            >
              {copy.login}
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative min-h-[calc(100dvh-112px)] overflow-hidden bg-gray-950 text-white">
          <HeroImage alt={copy.heroImageAlt} />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,18,0.92)_0%,rgba(3,7,18,0.72)_44%,rgba(3,7,18,0.22)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-gray-950 to-transparent" />
          <div className="justify-center gap-10 relative mx-auto flex min-h-[calc(100dvh-112px)] max-w-7xl flex-col px-4 pb-6 pt-20 sm:min-h-[calc(100dvh-88px)] sm:px-6 sm:pb-7 sm:pt-28 lg:px-8">

            <HeroReveal delay={80}>
              <h1 className="mt-5 max-w-4xl text-[34px] font-semibold leading-[1.08] text-white [text-wrap:balance] sm:text-5xl lg:text-[80px]">
                {copy.heroTitle}
              </h1>
            </HeroReveal>

            <HeroReveal delay={120}>
              <ImageAndDownload btn={openLandingLoginModal} language={language} />
            </HeroReveal>
            
          </div>
        </section>

        <section id="proof" className="border-b border-gray-100 bg-white py-12 dark:border-gray-800 dark:bg-gray-950 sm:py-16">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[0.42fr_0.58fr] lg:items-start lg:px-8">
            <Reveal>
              <SectionHeader
                title={copy.proofTitle}
                desc={copy.proofDesc}
              />          
            </Reveal>

            <Reveal delay={120}>
              <CommandCenterMockup language={language} />
            </Reveal>
          </div>
        </section>

        <section id="workflow" className="border-b border-gray-100 bg-slate-50 py-20 dark:border-gray-800 dark:bg-gray-900/35">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal>
              <SectionHeader
                title={copy.workflowTitle}
                desc={copy.workflowDesc}
              />
            </Reveal>

            <div className="mt-10 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
              {FLOW_ITEMS[language].map((item, index) => {
                const Icon = item.icon;
                return (
                  <Fragment key={item.title}>
                    <Reveal delay={index * 80}>
                      <div className="flex flex-col justify-top h-full items-center h-full p-7 rounded-[20px] border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
                        <div className="pb-5 flex items-center gap-3">
                          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-slate-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                            <Icon className="h-5 w-5" strokeWidth={1.7} />
                          </span>
                        </div>
                        <h3 className="text-lg m-1 font-semibold text-gray-950 dark:text-white">{item.title}</h3>
                        <p className="m-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{item.desc}</p>
                      </div>
                    </Reveal>

                    {index < FLOW_ITEMS[language].length - 1 && (
                      <div className="hidden xl:flex items-center justify-center text-gray-300 dark:text-gray-700">
                        <ArrowRight className="h-5 w-5" strokeWidth={2} />
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </section>

        

        <section id="roles" className="border-b border-gray-100 bg-white py-12 dark:border-gray-800 dark:bg-gray-950 sm:py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal>
              <SectionHeader
                title={copy.rolesTitle}
                desc={copy.rolesDesc}
              />
            </Reveal>
            <SwiperStyle />
            <Swiper
              modules={[Pagination]}
              loop
              pagination={{ clickable: true }}
              breakpoints={{
                0: {
                  slidesPerView: 1.1,
                  spaceBetween: 12,
                },
                640: {
                  slidesPerView: 1.2,
                },
                768: {
                  slidesPerView: 2,
                },
              }}
              className="mt-10 pb-12 role-swiper"
              
            >
              {ROLE_ITEMS[language].map((item, index) => {
                const Icon = item.icon;

                return (
                  <SwiperSlide className="w-full h-auto" key={item.role}>
                    <Reveal delay={index * 80}>
                      <div className="flex h-full flex-col rounded-md border max-w-125 mb-10 border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
                        <div className=" flex items-start gap-4">
                          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-slate-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                            <Icon className="h-5 w-5" strokeWidth={1.7} />
                          </span>

                          <div>
                            <p className="text-[13px] font-semibold text-orange-600 dark:text-orange-400">
                              {item.role}
                            </p>

                            <h3 className="mt-2 text-lg font-semibold text-gray-950 dark:text-white">
                              {item.title}
                            </h3>

                            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                              {item.desc}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Reveal>
                  </SwiperSlide>
                );
              })}
            </Swiper>
          </div>
        </section>

        <section className="border-b border-gray-100 bg-slate-50 py-20 dark:border-gray-800 dark:bg-gray-900/35">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:px-8">
            <Reveal>
              <SectionHeader
                title={copy.aiTitle}
                desc={copy.aiDesc}
              />
            </Reveal>

            <Reveal delay={80}>
              <AiAssistantMockup language={language} />
            </Reveal>
          </div>
        </section>

        <section className="bg-gray-950 py-20 text-white dark:bg-black">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <Reveal>
              <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
                <div>
                  <p className="text-sm font-semibold text-orange-300">{copy.ctaLabel}</p>
                  <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
                    {copy.ctaTitle}
                  </h2>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-gray-300">
                    {copy.ctaDesc}
                  </p>
                </div>
                <SecondaryButton onClick={openLandingLoginModal}>{copy.login}</SecondaryButton>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-100 bg-white py-8 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-sm text-gray-500 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <AppLogo decorative size={28} />
            <AppWordmark height={16} className="text-gray-900 dark:text-white" />
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
            <span>{copy.footerProject}</span>
            <span className="hidden text-gray-300 dark:text-gray-700 sm:inline">/</span>
            <span>{copy.footerWorkflow}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
