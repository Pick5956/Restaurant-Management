import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { orderRoutePermissions } from './permission-parity.ts';

export type AIGuidedAction = {
  id: string;
  href?: string;
  prompt?: string;
  label: string;
  description?: string;
  requiresConfirmation?: boolean;
};

type HasPermission = (permission: string) => boolean;

type NavigationEntry = {
  href: string;
  label: Record<DisplayLanguage, string>;
  permissions?: readonly string[];
  ownerOnly?: boolean;
  aliases: string[];
};

export type AINavigationResolution =
  | {
      kind: 'navigate';
      href: string;
      label: string;
      alreadyThere: boolean;
      message: string;
    }
  | {
      kind: 'suggest';
      message: string;
      options: Array<{ href: string; label: string }>;
    }
  | null;

const navigationEntries: NavigationEntry[] = [
  { href: '/home', label: { th: 'ภาพรวม', en: 'Overview' }, permissions: ['view_dashboard'], aliases: ['home', 'overview', 'dashboard', 'summary', 'ภาพรวม', 'หน้าหลัก', 'แดชบอร์ด', 'สรุป'] },
  // The live orders are the floor's: the tables in service and the takeaways.
  { href: '/tables', label: { th: 'รับออเดอร์', en: 'Order taking' }, permissions: ['take_order'], aliases: ['pos', 'take order', 'order taking', 'active orders', 'รับออเดอร์', 'ขายหน้าร้าน', 'ออเดอร์ที่กำลังทำ'] },
  { href: '/kitchen', label: { th: 'จอครัว', en: 'Kitchen display' }, permissions: ['view_kitchen'], aliases: ['kitchen', 'kds', 'ครัว', 'จอครัว', 'หน้าครัว'] },
  { href: '/menu', label: { th: 'เมนูอาหาร', en: 'Menu' }, permissions: ['view_menu', 'manage_menu'], aliases: ['menu', 'food menu', 'dish', 'เมนู', 'เมนูอาหาร', 'รายการอาหาร'] },
  { href: '/table-management', label: { th: 'ผังโต๊ะ', en: 'Table layout' }, permissions: ['manage_table', 'view_tables'], aliases: ['tables', 'table layout', 'floor plan', 'ผังโต๊ะ', 'จัดการโต๊ะ'] },
  // The paid-order archive, behind the same gate as its tab.
  { href: '/orders', label: { th: 'ออเดอร์', en: 'Orders' }, permissions: orderRoutePermissions, aliases: ['orders', 'order archive', 'ออเดอร์', 'รายการออเดอร์', 'คลังออเดอร์'] },
  { href: '/inventory', label: { th: 'คลังวัตถุดิบ', en: 'Inventory' }, permissions: ['manage_inventory', 'view_inventory'], aliases: ['inventory', 'stock', 'ingredients', 'คลัง', 'คลังวัตถุดิบ', 'วัตถุดิบ', 'สต๊อก', 'สต็อก'] },
  { href: '/ai-assistant', label: { th: 'AI ผู้ช่วย', en: 'AI assistant' }, ownerOnly: true, aliases: ['ai', 'assistant', 'ai assistant', 'ผู้ช่วย ai', 'ai ผู้ช่วย'] },
  { href: '/staff', label: { th: 'พนักงาน', en: 'Staff' }, permissions: ['manage_invites', 'manage_members', 'manage_roles', 'view_audit_log'], aliases: ['staff', 'team', 'employees', 'พนักงาน', 'ทีม', 'ทีมงาน', 'จัดการคน'] },
  { href: '/reports', label: { th: 'รายงาน', en: 'Reports' }, permissions: ['view_reports'], aliases: ['reports', 'report', 'analytics', 'revenue', 'sales report', 'รายงาน', 'ยอดขาย', 'รายได้', 'วิเคราะห์'] },
  { href: '/settings/account', label: { th: 'ตั้งค่าบัญชี', en: 'Account settings' }, aliases: ['account', 'profile', 'my account', 'บัญชี', 'โปรไฟล์', 'บัญชีของฉัน', 'ข้อมูลส่วนตัว'] },
  { href: '/settings/display', label: { th: 'ภาษาและการแสดงผล', en: 'Language and display' }, aliases: ['display', 'language', 'font', 'theme', 'ภาษา', 'การแสดงผล', 'ฟอนต์', 'ธีม'] },
  { href: '/settings/restaurant', label: { th: 'ข้อมูลร้านและการคิดเงิน', en: 'Restaurant and billing' }, permissions: ['manage_restaurant_settings'], aliases: ['restaurant settings', 'billing settings', 'promptpay', 'vat', 'service charge', 'ตั้งค่าร้าน', 'ข้อมูลร้าน', 'การคิดเงิน', 'พร้อมเพย์', 'ภาษี'] },
  { href: '/staff', label: { th: 'ทีมและสิทธิ์', en: 'Team and permissions' }, permissions: ['manage_invites', 'manage_members', 'manage_roles', 'view_audit_log'], aliases: ['team settings', 'permissions', 'roles', 'invitations', 'สิทธิ์', 'บทบาท', 'ทีมและสิทธิ์', 'คำเชิญ'] },
  { href: '/settings', label: { th: 'ตั้งค่า', en: 'Settings' }, aliases: ['settings', 'setting', 'config', 'preferences', 'ตั้งค่า', 'การตั้งค่า'] },
];

const navigationPhrases = [
  'go to',
  'take me',
  'open',
  'navigate',
  'where is',
  'พาไป',
  'ไปหน้า',
  'ไปที่',
  'เปิดหน้า',
  'เปิดเมนู',
  'เข้าเมนู',
  'อยู่ตรงไหน',
  'อยู่ไหน',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canUseAIAssistant(roleName?: string): boolean {
  return roleName === 'owner';
}

function canAccessNavigationEntry(
  entry: NavigationEntry,
  hasPermission: HasPermission,
  isOwner: boolean,
): boolean {
  if (entry.ownerOnly && !isOwner) return false;
  return !entry.permissions?.length || entry.permissions.some(hasPermission);
}

/** The aliases of `entry` that appear word for word in the input. */
function aliasesIn(input: string, entry: NavigationEntry): string[] {
  return entry.aliases
    .map(normalize)
    .filter((alias) => alias.length > 0 && input.includes(alias));
}

/**
 * `alias` is only part of a longer alias another page owns, and that longer
 * one is in the input: "orders" inside "active orders", "ออเดอร์" inside
 * "ออเดอร์ที่กำลังทำ". The longer phrase names the page; the short word inside
 * it is not a second match.
 */
function isInsideLongerAlias(alias: string, longerAliases: readonly string[]): boolean {
  return longerAliases.some((longer) => longer.length > alias.length && longer.includes(alias));
}

function scoreEntry(input: string, entry: NavigationEntry, otherAliases: readonly string[] = []): number {
  let score = 0;
  for (const alias of entry.aliases) {
    const normalizedAlias = normalize(alias);
    if (input === normalizedAlias) score = Math.max(score, 120);
    else if (input.includes(normalizedAlias) && !isInsideLongerAlias(normalizedAlias, otherAliases)) {
      score = Math.max(score, 80 + Math.min(normalizedAlias.length, 20));
    }
    const tokens = normalizedAlias.split(' ');
    if (tokens.length > 1 && tokens.every((token) => input.includes(token))) {
      score = Math.max(score, 70 + tokens.length * 5);
    }
  }
  return score;
}

export function resolveAINavigationRequest(
  input: string,
  hasPermission: HasPermission,
  currentPathname?: string,
  language: DisplayLanguage = 'th',
  isOwner = false,
): AINavigationResolution {
  const normalized = normalize(input);
  if (!normalized || !navigationPhrases.some((phrase) => normalized.includes(phrase))) {
    return null;
  }

  const accessible = navigationEntries
    .filter((entry) => canAccessNavigationEntry(entry, hasPermission, isOwner));
  const matches = accessible
    .map((entry) => {
      const otherAliases = accessible
        .filter((other) => other !== entry)
        .flatMap((other) => aliasesIn(normalized, other));
      return { ...entry, score: scoreEntry(normalized, entry, otherAliases) };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!matches.length) return null;

  const top = matches[0];
  const second = matches[1];
  const alreadyThere = currentPathname === top.href
    || Boolean(currentPathname?.startsWith(`${top.href}/`));
  if (!second || top.score - second.score >= 15 || top.score >= 120) {
    return {
      kind: 'navigate',
      href: top.href,
      label: top.label[language],
      alreadyThere,
      message: alreadyThere
        ? language === 'th' ? `คุณอยู่ที่หน้า${top.label.th}อยู่แล้วครับ` : `You are already on the ${top.label.en} page.`
        : language === 'th' ? `พาไปหน้า${top.label.th}ให้แล้วครับ` : `Opening ${top.label.en}.`,
    };
  }

  return {
    kind: 'suggest',
    message: language === 'th' ? 'ผมเจอหลายหน้าที่ใกล้เคียงกัน เลือกหน้าที่ต้องการได้เลยครับ' : 'I found several matching pages. Choose where you want to go.',
    options: matches.slice(0, 3).map((entry) => ({
      href: entry.href,
      label: entry.label[language],
    })),
  };
}

function canAnalyze(isOwner: boolean): boolean {
  return isOwner;
}

export function resolveAIClarificationRequest(
  input: string,
  hasPermission: HasPermission,
  language: DisplayLanguage = 'th',
  isOwner = false,
): { message: string; actions: AIGuidedAction[] } | null {
  if (!isOwner) return null;
  const text = normalize(input);

  if (text === 'เมนู' || text === 'menu') {
    const actions: AIGuidedAction[] = [];
    if (hasPermission('view_menu') || hasPermission('manage_menu')) {
      actions.push({ id: 'menu-page', href: '/menu', label: language === 'th' ? 'เปิดหน้าจัดการเมนู' : 'Open menu' });
    }
    if (canAnalyze(isOwner)) {
      actions.push({ id: 'menu-top', prompt: language === 'th' ? 'เมนูไหนขายดีที่สุดในช่วง 14 วันล่าสุด?' : 'Which menu items sold best in the last 14 days?', label: language === 'th' ? 'ดูเมนูขายดี' : 'View top sellers' });
      actions.push({ id: 'menu-margin', prompt: language === 'th' ? 'เมนูไหนมี margin ต่ำและควรตรวจสอบ?' : 'Which menu items have a low margin and need review?', label: language === 'th' ? 'ตรวจเมนูกำไรต่ำ' : 'Review low-margin items' });
    }
    return actions.length
      ? { message: language === 'th' ? 'ต้องการทำอะไรเกี่ยวกับเมนูครับ?' : 'What would you like to do with the menu?', actions }
      : null;
  }

  if (['คลัง', 'สต๊อก', 'สต็อก', 'วัตถุดิบ', 'inventory', 'stock'].includes(text)) {
    const actions: AIGuidedAction[] = [];
    if (hasPermission('view_inventory') || hasPermission('manage_inventory')) {
      actions.push({ id: 'inventory-page', href: '/inventory', label: language === 'th' ? 'เปิดหน้าคลังวัตถุดิบ' : 'Open inventory' });
    }
    if (canAnalyze(isOwner)) {
      actions.push({ id: 'inventory-risk', prompt: language === 'th' ? 'วัตถุดิบอะไรใกล้หมดและควรเติมก่อน?' : 'Which ingredients are running low and should be restocked first?', label: language === 'th' ? 'ดูของใกล้หมด' : 'Review low stock' });
    }
    return actions.length
      ? {
          message: language === 'th' ? 'ต้องการเปิดคลัง หรือให้ช่วยตรวจวัตถุดิบที่เสี่ยงหมดครับ?' : 'Would you like to open inventory or review ingredients at risk of running out?',
          actions,
        }
      : null;
  }

  if (
    ['รายงาน', 'ยอดขาย', 'รายได้', 'report', 'reports', 'sales', 'revenue'].includes(text)
    && hasPermission('view_reports')
  ) {
    return {
      message: language === 'th' ? 'ต้องการเปิดรายงาน หรือให้สรุปยอดขายก่อนครับ?' : 'Would you like to open reports or get a sales summary first?',
      actions: [
        { id: 'reports-page', href: '/reports', label: language === 'th' ? 'เปิดหน้ารายงาน' : 'Open reports' },
        { id: 'sales-summary', prompt: language === 'th' ? 'สรุปยอดขายและกำไรในช่วง 14 วันล่าสุดให้หน่อย' : 'Summarize sales and profit for the last 14 days.', label: language === 'th' ? 'สรุปยอดขาย' : 'Summarize sales' },
      ],
    };
  }

  if (text === 'ตั้งค่า' || text === 'settings' || text === 'setting') {
    const actions: AIGuidedAction[] = [
      { id: 'settings-account', href: '/settings/account', label: language === 'th' ? 'ตั้งค่าบัญชี' : 'Account settings' },
      { id: 'settings-display', href: '/settings/display', label: language === 'th' ? 'ภาษาและการแสดงผล' : 'Language and display' },
    ];
    if (hasPermission('manage_restaurant_settings')) {
      actions.push({ id: 'settings-restaurant', href: '/settings/restaurant', label: language === 'th' ? 'ข้อมูลร้านและการคิดเงิน' : 'Restaurant and billing' });
    }
    return { message: language === 'th' ? 'ต้องการตั้งค่าส่วนไหนครับ?' : 'Which settings would you like to open?', actions };
  }

  return null;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function getGuidedAIActions(
  question: string,
  answer: string,
  hasPermission: HasPermission,
  language: DisplayLanguage = 'th',
  isOwner = false,
): AIGuidedAction[] {
  if (!isOwner) return [];
  const text = `${question} ${answer}`.toLowerCase();
  const actions: AIGuidedAction[] = [];
  const add = (action: AIGuidedAction) => {
    if (!actions.some((existing) => existing.id === action.id)) actions.push(action);
  };

  if (includesAny(text, ['stock', 'inventory', 'ingredient', 'restock', 'วัตถุดิบ', 'สต๊อก', 'สต็อก', 'คลัง', 'เติม'])) {
    if (hasPermission('manage_inventory') || hasPermission('view_inventory')) {
      add({
        id: 'review-inventory',
        href: '/inventory',
        label: language === 'th' ? 'ตรวจรายการในคลัง' : 'Review inventory',
        description: language === 'th' ? 'ระบบจะเปิดหน้าคลังให้ตรวจสอบก่อนเท่านั้น ยังไม่มีการปรับจำนวนสต๊อกอัตโนมัติ' : 'This only opens inventory for review. No stock quantity will be changed automatically.',
        requiresConfirmation: true,
      });
    }
  }

  if (includesAny(text, ['margin', 'profit', 'menu', 'กำไร', 'มาร์จิ้น', 'เมนู'])) {
    if (hasPermission('manage_menu') || hasPermission('view_menu')) {
      add({
        id: 'review-menu',
        href: '/menu',
        label: language === 'th' ? 'เปิดหน้าเมนูเพื่อตรวจสอบ' : 'Review menu',
        description: language === 'th' ? 'เปิดรายการเมนูเพื่อดูสูตรและราคา ก่อนตัดสินใจปรับจริง' : 'Open the menu to review recipes and prices before making changes.',
        requiresConfirmation: true,
      });
    }
  }

  if (
    includesAny(text, ['vat', 'promptpay', 'service charge', 'คิดเงิน', 'ภาษี', 'พร้อมเพย์'])
    && hasPermission('manage_restaurant_settings')
  ) {
    add({ id: 'restaurant-billing', href: '/settings/restaurant', label: language === 'th' ? 'เปิดการตั้งค่าร้าน' : 'Open restaurant settings' });
  }

  if (
    hasPermission('view_reports')
    && includesAny(text, ['sales', 'revenue', 'ยอดขาย', 'รายได้', 'กำไร', 'stock', 'สต๊อก', 'สต็อก'])
  ) {
    add({ id: 'open-report', href: '/reports', label: language === 'th' ? 'ดูรายงานเต็ม' : 'View full report' });
  }
  return actions.slice(0, 2);
}

export function getUnclearAIActions(
  hasPermission: HasPermission,
  language: DisplayLanguage = 'th',
  isOwner = false,
): AIGuidedAction[] {
  if (!isOwner) return [];
  const actions: AIGuidedAction[] = [];
  if (canAnalyze(isOwner)) {
    actions.push({
      id: 'unclear-stock-risk',
      prompt: language === 'th' ? 'วัตถุดิบอะไรใกล้หมดและควรเติมก่อน?' : 'Which ingredients are running low and should be restocked first?',
      label: language === 'th' ? 'ตรวจสต๊อก' : 'Review stock',
    });
    if (hasPermission('view_reports')) {
      actions.push({
        id: 'unclear-sales-summary',
        prompt: language === 'th' ? 'สรุปยอดขายและกำไรในช่วง 14 วันล่าสุดให้หน่อย' : 'Summarize sales and profit for the last 14 days.',
        label: language === 'th' ? 'ดูยอดขาย' : 'View sales',
      });
    }
  }
  if (hasPermission('view_menu') || hasPermission('manage_menu')) {
    actions.push({ id: 'unclear-menu-page', href: '/menu', label: language === 'th' ? 'ไปหน้าเมนู' : 'Open menu' });
  }
  return actions.slice(0, 3);
}
