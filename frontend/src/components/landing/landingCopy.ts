import type { Language } from "@/src/providers/LanguageProvider";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  ChefHat,
  LayoutGrid,
  Package,
  QrCode,
  Receipt,
  ShoppingCart,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// The landing page sells the web first, then the phone app and the iPad.
// Written 27 ก.ย. 2569 with the owner: one idea a line, said the way people
// say it, no "·" or "—" joining phrases, no figures the screenshots already
// show. Every claim here was checked against the code before it went in.

export const PHONE_SHOTS = { home: "/landing/phone-home.jpg", overview: "/landing/phone-overview.jpg" };

type WebStep = { tab: string; file: string; title: string; desc: string };
type Feature = { icon: LucideIcon; title: string; desc: string };
type AppStep = { label: string; title: string; desc: string; shot: string; alt: string };

export type LandingCopy = {
  login: string;
  register: string;
  heroEyebrow: string;
  heroTitle: [string, string];
  heroDesc: string;
  heroShotAlt: string;
  webSteps: WebStep[];
  devicesEyebrow: string;
  devicesTitle: string;
  devicesDesc: string;
  tabletAlt: string;
  phoneAlt: string;
  appSteps: AppStep[];
  featuresEyebrow: string;
  featuresTitle: [string, string];
  features: Feature[];
  ctaTitle: string;
  ctaDesc: string;
};

const FEATURE_ICONS = [ShoppingCart, QrCode, ChefHat, Wallet, LayoutGrid, BookOpen, Package, Receipt, BarChart3, Sparkles, Users, ArrowLeftRight];

const withIcons = (items: Array<[string, string]>): Feature[] =>
  items.map(([title, desc], i) => ({ icon: FEATURE_ICONS[i], title, desc }));

export const LANDING_COPY: Record<Language, LandingCopy> = {
  th: {
    login: "เข้าสู่ระบบ",
    register: "เริ่มใช้งาน",
    heroEyebrow: "ระบบจัดการร้านอาหาร",
    heroTitle: ["ดูแลร้านทั้งร้าน", "จากหน้าจอเดียว"],
    heroDesc: "ตั้งแต่รับออเดอร์ ส่งเข้าครัว จนถึงปิดบิลและดูกำไร",
    heroShotAlt: "หน้าภาพรวมร้านของ Dishy บนคอมพิวเตอร์",
    webSteps: [
      { tab: "ภาพรวม", file: "desktop-home.png", title: "เห็นทั้งร้านในหน้าเดียว", desc: "ยอดขายวันนี้ โต๊ะที่มีลูกค้า คิวในครัว และวัตถุดิบที่ใกล้หมด" },
      { tab: "ครัว", file: "desktop-kitchen.png", title: "ครัวรู้ว่าต้องทำอะไรก่อน", desc: "ออเดอร์เข้าคิวครัวทันทีที่หน้าร้านกดส่ง จานไหนรอนานเกินไปจะขึ้นเป็นสีแดง" },
      { tab: "ปิดบิล", file: "desktop-pos.png", title: "ปิดบิลโดยไม่ต้องคีย์ซ้ำ", desc: "รายการอาหารมาจากออเดอร์ครบแล้ว รับเงินสดหรือ PromptPay แล้วโต๊ะพร้อมรับลูกค้าคนต่อไป" },
      { tab: "รายงาน", file: "desktop-reports.png", title: "รู้ว่าร้านได้กำไรเท่าไร", desc: "ดูยอดขายย้อนหลัง เมนูขายดี และกำไรหลังหักค่าใช้จ่าย" },
      { tab: "Dishy AI", file: "desktop-ai.png", title: "ถามเรื่องร้านเป็นภาษาไทย", desc: "อยากรู้ว่าเมนูไหนขายดี หรือของอะไรใกล้หมด พิมพ์ถามได้เลย คำตอบมาจากข้อมูลจริงของร้าน" },
    ],
    devicesEyebrow: "ไอแพดและมือถือ",
    devicesTitle: "พกร้านไปได้ทุกที่",
    devicesDesc: "เปิดบนไอแพดได้ทันที และมีแอปมือถือสำหรับพนักงานและเจ้าของร้าน ข้อมูลตรงกันทุกเครื่อง",
    tabletAlt: "หน้าภาพรวมร้านของ Dishy บนไอแพด",
    phoneAlt: "หน้าแรกของแอป Dishy บนมือถือ",
    appSteps: [
      { label: "แอปมือถือ", title: "เช็คร้านได้ในแวบเดียว", desc: "เปิดแอปมาก็เห็นยอดขายวันนี้ โต๊ะที่ว่าง และออเดอร์ที่ครัวทำเกินเวลา", shot: PHONE_SHOTS.home, alt: "หน้าแรกของแอป Dishy บนมือถือ" },
      { label: "สรุปรายวัน", title: "รู้กำไรก่อนปิดร้าน", desc: "รายจ่าย กำไร และจำนวนออเดอร์ของวันนี้ พร้อมแจ้งเตือนเมื่อวัตถุดิบใกล้หมด", shot: PHONE_SHOTS.overview, alt: "หน้าภาพรวมร้านในแอป Dishy บนมือถือ" },
    ],
    featuresEyebrow: "ฟีเจอร์",
    featuresTitle: ["ทุกอย่างที่ร้านต้องใช้", "ในระบบเดียว"],
    features: withIcons([
      ["รับออเดอร์ที่โต๊ะ", "พนักงานสั่งอาหารจากมือถือ แล้วส่งเข้าครัวได้ทันที"],
      ["ลูกค้าสั่งเองผ่าน QR", "สแกนที่โต๊ะแล้วสั่งได้เลย ไม่ต้องรอพนักงาน"],
      ["จอครัว", "แยกออเดอร์ใหม่ กำลังทำ และเสร็จแล้วไว้ชัดเจนในจอเดียว"],
      ["เงินสดและ PromptPay", "ปิดบิลจากออเดอร์เดิม ไม่ต้องคีย์รายการใหม่"],
      ["ผังโต๊ะ", "รู้ทันทีว่าโต๊ะไหนว่าง มีลูกค้า หรือรอเช็คบิล"],
      ["เมนูและโปรโมชัน", "แก้ราคา ปิดเมนูที่หมด และจัดโปรได้เอง"],
      ["สต๊อกวัตถุดิบ", "ตัดสต๊อกอัตโนมัติเมื่อขาย และเตือนก่อนของหมด"],
      ["ค่าใช้จ่ายและกำไร", "บันทึกรายจ่าย แล้วเห็นกำไรของแต่ละวัน"],
      ["รายงานยอดขาย", "ดูยอดย้อนหลังและเมนูที่ขายดีที่สุด"],
      ["Dishy AI", "ถามข้อมูลร้านเป็นภาษาไทย แล้วได้คำตอบจากตัวเลขจริง"],
      ["สิทธิ์ตามหน้าที่", "เจ้าของ ผู้จัดการ พนักงานเสิร์ฟ ครัว และแคชเชียร์ เข้าได้เฉพาะหน้าที่ตรงกับงานของตัวเอง"],
      ["หลายสาขา", "ดูแลหลายร้านหรือหลายสาขาจากบัญชีเดียว"],
    ]),
    ctaTitle: "เริ่มใช้ Dishy กับร้านของคุณ",
    ctaDesc: "ตั้งค่าโต๊ะและเมนู เชิญทีมเข้ามา แล้วเริ่มรับออเดอร์ได้เลย",
  },
  en: {
    login: "Sign in",
    register: "Get started",
    heroEyebrow: "Restaurant management system",
    heroTitle: ["Run the whole restaurant", "from one screen"],
    heroDesc: "From taking orders and sending them to the kitchen to closing bills and checking profit.",
    heroShotAlt: "Dishy's restaurant overview on a computer",
    webSteps: [
      { tab: "Overview", file: "desktop-home.png", title: "The whole restaurant on one page", desc: "Today's sales, occupied tables, the kitchen queue and ingredients running low." },
      { tab: "Kitchen", file: "desktop-kitchen.png", title: "The kitchen knows what to cook first", desc: "Orders reach the kitchen the moment the floor sends them. Tickets that wait too long turn red." },
      { tab: "Checkout", file: "desktop-pos.png", title: "Close bills without re-entering items", desc: "Items come straight from the order. Take cash or PromptPay, and the table is ready for the next guests." },
      { tab: "Reports", file: "desktop-reports.png", title: "Know how much you actually made", desc: "Past sales, best-selling dishes and profit after expenses." },
      { tab: "Dishy AI", file: "desktop-ai.png", title: "Ask about your restaurant in plain words", desc: "Which dish sells best? What is running low? Just type the question. Answers come from your restaurant's own data." },
    ],
    devicesEyebrow: "iPad and phone",
    devicesTitle: "Take the restaurant anywhere",
    devicesDesc: "Open it on an iPad right away, with a phone app for staff and owners. Every device shows the same data.",
    tabletAlt: "Dishy's restaurant overview on an iPad",
    phoneAlt: "The Dishy app's home screen on a phone",
    appSteps: [
      { label: "Phone app", title: "Check the restaurant at a glance", desc: "Open the app to see today's sales, free tables and the orders the kitchen is running late on.", shot: PHONE_SHOTS.home, alt: "The Dishy app's home screen on a phone" },
      { label: "Daily summary", title: "Know your profit before closing", desc: "Today's expenses, profit and order count, with an alert when ingredients run low.", shot: PHONE_SHOTS.overview, alt: "The restaurant overview in the Dishy phone app" },
    ],
    featuresEyebrow: "Features",
    featuresTitle: ["Everything a restaurant needs", "in one system"],
    features: withIcons([
      ["Orders at the table", "Staff order from their phones and send it straight to the kitchen."],
      ["QR self-ordering", "Guests scan at the table and order without waiting for staff."],
      ["Kitchen display", "New, cooking and done tickets, clearly apart on one screen."],
      ["Cash and PromptPay", "Close the bill from the same order, with nothing to re-enter."],
      ["Floor plan", "See at once which tables are free, occupied or waiting for the bill."],
      ["Menus and promotions", "Change prices, hide sold-out dishes and run promotions yourself."],
      ["Ingredient stock", "Stock is deducted as you sell, with a warning before it runs out."],
      ["Expenses and profit", "Record expenses and see each day's profit."],
      ["Sales reports", "Past sales and your best-selling dishes."],
      ["Dishy AI", "Ask about your restaurant and get answers from real figures."],
      ["Role-based access", "Owners, managers, waiters, kitchen and cashiers only reach the pages their job needs."],
      ["Multiple branches", "Run several restaurants or branches from one account."],
    ]),
    ctaTitle: "Start using Dishy in your restaurant",
    ctaDesc: "Set up tables and menus, invite your team, and start taking orders.",
  },
};
