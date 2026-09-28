/**
 * One grid rule for every surface that shows menu cards: POS order taking and
 * menu management. Both used to hard-code column counts (`grid-cols-3
 * lg:grid-cols-4 xl:grid-cols-5`), which fixed the number of cards per row and
 * let the card itself stretch with the viewport — so the same menu looked one
 * size on POS and a much larger one on the menu page, and a wide screen left
 * gutters on either side of a centred block.
 *
 * `auto-fill` inverts that: the card keeps a size and the row takes as many as
 * it fits, wrapping on its own when the screen is narrow. The minimums step up
 * per breakpoint so a phone still gets three columns instead of one very wide
 * card.
 */
export const CARD_GRID_COLUMN_CLASS = [
  "grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]",
  "sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]",
  "lg:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]",
  "xl:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]",
].join(" ");

export const MENU_CARD_GRID_CLASS = [
  "grid auto-rows-max content-start items-start gap-2.5 sm:gap-4",
  CARD_GRID_COLUMN_CLASS,
].join(" ");

/**
 * The "N left" badge beside a card's price, on both surfaces. Ten or fewer
 * portions turns it amber (owner, 2026-09-22); otherwise it is a plain grey
 * chip, darker than the card so it reads as a chip at all.
 */
export const LOW_STOCK_THRESHOLD = 10;

export function menuStockBadgeClass(isLow: boolean): string {
  return `shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold leading-none ${
    isLow
      ? "bg-amber-500 text-white dark:bg-amber-400 dark:text-gray-950"
      : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
  }`;
}

/** Card shell shared by both surfaces, so a menu item is one object everywhere. */
export const MENU_CARD_SHELL_CLASS =
  "relative flex min-h-[168px] flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-left transition-transform dark:border-gray-800 dark:bg-gray-900 sm:min-h-[214px]";
