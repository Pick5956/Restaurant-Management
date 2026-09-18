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

/**
 * What a row is called on this screen. The navigation's own label is what fits
 * a rail and a tab bar; here the row is one of four things a person came to
 * manage, so it says which job it is. Only the ones that differ are listed.
 */
export const MORE_TITLES: Record<string, { th: string; en: string }> = {
  menu: { th: 'จัดการเมนูอาหาร', en: 'Manage menu' },
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
