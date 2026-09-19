import type { Language } from "@/src/providers/LanguageProvider";

const routeTitles: Array<{ match: (pathname: string) => boolean; th: string; en: string }> = [
  { match: (path) => path === "/docs" || path.startsWith("/docs/"), th: "คู่มือการใช้งาน", en: "User guide" },
  { match: (path) => path === "/home", th: "ภาพรวมร้าน", en: "Restaurant overview" },
  { match: (path) => path === "/pos/tables", th: "รับออเดอร์", en: "Take orders" },
  { match: (path) => path === "/kitchen", th: "จอครัว", en: "Kitchen" },
  { match: (path) => path === "/orders", th: "คลังออเดอร์", en: "Order archive" },
  { match: (path) => path === "/menu", th: "จัดการเมนู", en: "Menu management" },
  { match: (path) => path === "/promotions", th: "โปรโมชัน", en: "Promotions" },
  { match: (path) => path === "/tables", th: "จัดการโต๊ะ", en: "Table management" },
  { match: (path) => path === "/inventory", th: "คลังวัตถุดิบ", en: "Inventory" },
  { match: (path) => path === "/expenses", th: "บันทึกรายจ่าย", en: "Expenses" },
  { match: (path) => path === "/staff", th: "ทีมงาน", en: "Team" },
  { match: (path) => path === "/reports", th: "รายงานร้าน", en: "Reports" },
  { match: (path) => path === "/ai-assistant", th: "ผู้ช่วยร้าน", en: "Restaurant assistant" },
  { match: (path) => path === "/settings", th: "ตั้งค่าร้าน", en: "Settings" },
  { match: (path) => path.startsWith("/settings/restaurant"), th: "ข้อมูลร้าน", en: "Restaurant settings" },
  { match: (path) => path.startsWith("/settings/team"), th: "ตั้งค่าทีม", en: "Team settings" },
  { match: (path) => path.startsWith("/settings/account"), th: "บัญชีของฉัน", en: "My account" },
  { match: (path) => path.startsWith("/settings/display"), th: "การแสดงผล", en: "Display settings" },
  { match: (path) => path === "/restaurants", th: "เลือกร้าน", en: "Choose restaurant" },
  { match: (path) => path === "/restaurants/new", th: "สร้างร้านใหม่", en: "Create restaurant" },
  { match: (path) => path === "/restaurants/join", th: "เข้าร่วมร้าน", en: "Join restaurant" },
  { match: (path) => path.startsWith("/invitations/"), th: "คำเชิญเข้าร่วมร้าน", en: "Restaurant invitation" },
  { match: (path) => path === "/reset-password", th: "ตั้งรหัสผ่านใหม่", en: "Reset password" },
  { match: (path) => /^\/customer\/t\/[^/]+\/orders\/?$/.test(path), th: "รายการที่สั่ง", en: "Table orders" },
  { match: (path) => path.startsWith("/customer/t/"), th: "สั่งอาหาร", en: "Order food" },
];

export function pageTitle(pathname: string, language: Language, brand = "Dishy", orderReference?: string) {
  const orderMatch = pathname.match(/^\/pos\/orders\/([^/]+)$/);
  if (orderMatch) {
    const orderNumber = orderReference?.trim() || decodeURIComponent(orderMatch[1]);
    return language === "th" ? `ออเดอร์ ${orderNumber} · ${brand}` : `Order ${orderNumber} · ${brand}`;
  }

  if (pathname === "/") {
    return language === "th" ? `${brand} · ระบบจัดการร้านอาหาร` : `${brand} · Restaurant management`;
  }

  const route = routeTitles.find((item) => item.match(pathname));
  const label = route ? route[language] : language === "th" ? "ระบบจัดการร้าน" : "Restaurant management";
  return `${label} · ${brand}`;
}
