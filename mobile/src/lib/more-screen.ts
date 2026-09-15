// What the "เพิ่มเติม" screen lists and how it groups it, apart from how it is
// drawn. Redrawn on 15 ก.ย. 2569 (the owner chose design B): two groups of
// four, so the two columns on a tablet come out the same height, each row with
// a line saying what is inside.

export type MoreGroupKey = 'shop' | 'team';

/**
 * Shop work on the left, people, numbers and the account on the right. The
 * expense ledger moved in with the shop: it is money the shop spends, and it
 * makes both groups four long.
 */
export const MORE_GROUPS: { key: MoreGroupKey; itemKeys: string[] }[] = [
  { key: 'shop', itemKeys: ['menu', 'inventory', 'tables-manage', 'expenses'] },
  // Staff left this list on 15 ก.ย. 2569: it opened the same page as
  // "ทีมและสิทธิ์" in settings, so it lives there alone now.
  { key: 'team', itemKeys: ['reports', 'ai', 'settings'] },
];

export const MORE_DETAILS: Record<string, { th: string; en: string }> = {
  menu: { th: 'ราคา สูตร เปิด-ปิดขาย', en: 'Prices, recipes, availability' },
  inventory: { th: 'สต๊อก ของใกล้หมด รับของเข้า', en: 'Stock, low items, deliveries' },
  'tables-manage': { th: 'โต๊ะ โซน และป้าย', en: 'Tables, zones and tags' },
  expenses: { th: 'รายจ่ายรายวันและรายเดือน', en: 'Daily and monthly spending' },
  staff: { th: 'สมาชิก บทบาท คำเชิญ', en: 'Members, roles, invitations' },
  reports: { th: 'ยอดขาย กำไร เมนูขายดี', en: 'Sales, profit, best sellers' },
  ai: { th: 'ถามเรื่องร้าน หรือสั่งแก้ข้อมูล', en: 'Ask about the shop or make changes' },
  settings: { th: 'บัญชี · ร้าน · ทีมและสิทธิ์ · เครื่องพิมพ์', en: 'Account · shop · team · printer' },
};

/** Groups with only the items this person may open, empty groups dropped. */
export function groupMoreItems<T extends { key: string }>(allowed: readonly T[]): { key: MoreGroupKey; items: T[] }[] {
  return MORE_GROUPS
    .map((group) => ({
      key: group.key,
      items: group.itemKeys
        .map((itemKey) => allowed.find((item) => item.key === itemKey))
        .filter((item): item is T => Boolean(item)),
    }))
    .filter((group) => group.items.length > 0);
}

const LEADING_VOWELS = new Set(['เ', 'แ', 'โ', 'ใ', 'ไ']);

/**
 * The letter on the shop's mark. Thai writes some vowels before the consonant
 * they follow in speech, so "เจ๊หมวย" is marked "เจ", not a lone "เ".
 */
export function restaurantMark(name: string): string {
  const letters = Array.from(name.trim());
  if (!letters.length) return '?';
  if (LEADING_VOWELS.has(letters[0]) && letters.length > 1) return letters[0] + letters[1];
  return letters[0].toLocaleUpperCase();
}
