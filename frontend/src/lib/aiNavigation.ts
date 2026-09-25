import { can, TEAM_MANAGEMENT_PERMISSIONS } from "@/src/lib/rbac";
import type { Permission } from "@/src/types/auth";
import type { Membership } from "@/src/types/restaurant";

type NavigationEntry = {
  href: string;
  label: { th: string; en: string };
  permission?: Permission | Permission[];
  aliases: string[];
};

type NavigationMatch = {
  href: string;
  label: string;
  score: number;
};

export type NavigationResolution =
  | {
      kind: "navigate";
      href: string;
      label: string;
      alreadyThere: boolean;
      message: string;
    }
  | {
      kind: "suggest";
      message: string;
      options: Array<{ href: string; label: string }>;
    }
  | null;

const navigationEntries: NavigationEntry[] = [
  {
    href: "/home",
    label: { th: "ภาพรวม", en: "Overview" },
    permission: "view_dashboard",
    aliases: ["home", "overview", "dashboard", "summary", "ภาพรวม", "หน้าหลัก", "แดชบอร์ด", "สรุป"],
  },
  {
    href: "/pos/tables",
    label: { th: "รับออเดอร์", en: "Take orders" },
    permission: "take_order",
    aliases: ["pos", "take order", "take orders", "order taking", "table order", "รับออเดอร์", "รับออเดอร์ลูกค้า", "ขายหน้าร้าน"],
  },
  {
    href: "/kitchen",
    label: { th: "จอครัว", en: "Kitchen" },
    permission: "view_kitchen",
    aliases: ["kitchen", "kds", "kitchen screen", "ครัว", "จอครัว", "หน้าครัว"],
  },
  {
    href: "/menu",
    label: { th: "เมนูอาหาร", en: "Menu" },
    permission: ["view_menu", "manage_menu"],
    aliases: ["menu", "food menu", "dish", "dishes", "เมนู", "เมนูอาหาร", "รายการอาหาร"],
  },
  {
    href: "/promotions",
    label: { th: "โปรโมชัน", en: "Promotions" },
    permission: "manage_promotions",
    aliases: ["promotions", "promotion", "promo", "discounts", "deals", "โปรโมชัน", "โปรโมชั่น", "โปร", "ส่วนลด", "แถม"],
  },
  {
    href: "/tables",
    label: { th: "ผังโต๊ะ", en: "Tables" },
    permission: ["manage_table", "view_tables"],
    aliases: ["tables", "table layout", "floor plan", "ผังโต๊ะ", "โต๊ะ", "จัดการโต๊ะ"],
  },
  {
    href: "/orders",
    label: { th: "คลังออเดอร์", en: "Order archive" },
    // Paid orders only, which the server answers only under view_orders.
    permission: "view_orders",
    aliases: ["orders", "order archive", "sales orders", "ออเดอร์", "รายการออเดอร์", "คลังออเดอร์"],
  },
  {
    href: "/inventory",
    label: { th: "คลังวัตถุดิบ", en: "Inventory" },
    permission: ["manage_inventory", "view_inventory"],
    aliases: ["inventory", "stock", "ingredients", "warehouse", "คลัง", "คลังวัตถุดิบ", "วัตถุดิบ", "สต๊อก"],
  },
  {
    href: "/expenses",
    label: { th: "บันทึกรายจ่าย", en: "Expenses" },
    permission: ["manage_expenses", "view_reports"],
    aliases: ["expenses", "expense", "cash out", "spending", "รายจ่าย", "บันทึกรายจ่าย", "ค่าใช้จ่าย"],
  },
  {
    href: "/ai-assistant",
    label: { th: "Dishy AI", en: "Dishy AI" },
    permission: ["view_reports", "manage_inventory"],
    aliases: ["ai", "assistant", "ai assistant", "copilot", "dishy", "dishy ai", "ผู้ช่วย ai", "ai ผู้ช่วย"],
  },
  {
    href: "/staff",
    label: { th: "พนักงาน", en: "Staff" },
    permission: [...TEAM_MANAGEMENT_PERMISSIONS],
    aliases: ["staff", "team", "employees", "workers", "พนักงาน", "ทีม", "ทีมงาน", "จัดการคน", "team settings", "permissions", "roles", "invitations", "สิทธิ์", "บทบาท", "ทีมและสิทธิ์", "คำเชิญ"],
  },
  {
    href: "/reports",
    label: { th: "รายงาน", en: "Reports" },
    permission: "view_reports",
    aliases: ["reports", "report", "analytics", "revenue", "sales report", "รายงาน", "ยอดขาย", "รายได้", "วิเคราะห์"],
  },
  {
    href: "/settings/account",
    label: { th: "ตั้งค่าบัญชี", en: "Account settings" },
    aliases: ["settings", "setting", "config", "preferences", "ตั้งค่า", "การตั้งค่า", "account", "profile", "my account", "user profile", "บัญชี", "โปรไฟล์", "บัญชีของฉัน", "ข้อมูลส่วนตัว"],
  },
  {
    href: "/settings/display",
    label: { th: "ภาษาและการแสดงผล", en: "Language and display" },
    aliases: ["display", "language", "font", "theme", "appearance", "ภาษา", "การแสดงผล", "ฟอนต์", "ธีม"],
  },
  {
    href: "/settings/restaurant",
    label: { th: "ข้อมูลร้านและการคิดเงิน", en: "Restaurant and billing" },
    permission: "manage_restaurant_settings",
    aliases: [
      "restaurant settings",
      "billing settings",
      "restaurant billing",
      "restaurant profile",
      "promptpay",
      "vat",
      "service charge",
      "ตั้งค่าร้าน",
      "ข้อมูลร้าน",
      "การคิดเงิน",
      "promptpay",
      "vat",
      "service charge",
    ],
  },
];

const navigationPhrases = [
  "go to",
  "take me",
  "bring me",
  "open",
  "navigate",
  "พาไป",
  "ไปหน้า",
  "ไปที่",
  "เปิดหน้า",
  "เปิดเมนู",
  "เข้าเมนู",
];

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPermission(membership: Membership | null | undefined, permission?: Permission | Permission[]) {
  if (!permission) return true;
  const permissions = Array.isArray(permission) ? permission : [permission];
  return permissions.some((item) => can(membership, item));
}

function scoreEntry(normalizedInput: string, entry: NavigationEntry) {
  let score = 0;
  for (const alias of entry.aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) continue;
    if (normalizedInput === normalizedAlias) {
      score = Math.max(score, 120);
      continue;
    }
    if (normalizedInput.includes(normalizedAlias)) {
      score = Math.max(score, 80 + Math.min(normalizedAlias.length, 20));
    }
    const aliasTokens = normalizedAlias.split(" ");
    if (aliasTokens.length > 1 && aliasTokens.every((token) => normalizedInput.includes(token))) {
      score = Math.max(score, 70 + aliasTokens.length * 5);
    }
  }
  return score;
}

export function resolveNavigationRequest(
  input: string,
  membership: Membership | null | undefined,
  language: "th" | "en",
  currentPathname?: string,
): NavigationResolution {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return null;
  const matches: NavigationMatch[] = navigationEntries
    .filter((entry) => hasPermission(membership, entry.permission))
    .map((entry) => ({
      href: entry.href,
      label: entry.label[language],
      score: scoreEntry(normalizedInput, entry),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) return null;

  const top = matches[0];
  const second = matches[1];
  const hasNavigationPhrase = navigationPhrases.some((phrase) => normalizedInput.includes(phrase));
  if (!hasNavigationPhrase) return null;
  const alreadyThere = currentPathname === top.href || Boolean(currentPathname && currentPathname.startsWith(top.href + "/"));

  if (!second || top.score - second.score >= 15 || top.score >= 120) {
    return {
      kind: "navigate",
      href: top.href,
      label: top.label,
      alreadyThere,
      message: language === "th"
        ? alreadyThere
          ? `คุณอยู่ที่หน้า${top.label}อยู่แล้วครับ`
          : `พาไปหน้า${top.label}ให้แล้วครับ`
        : alreadyThere
          ? `You are already on the ${top.label} page.`
          : `Taking you to ${top.label}.`,
    };
  }

  const options = matches.slice(0, 3).map((match) => ({ href: match.href, label: match.label }));
  return {
    kind: "suggest",
    message: language === "th"
      ? "ผมเจอหลายหน้าที่ใกล้เคียงกัน เลือกหน้าที่ต้องการได้เลยครับ"
      : "I found a few close matches. Pick the page you want.",
    options,
  };
}
