/**
 * The one back control on the web: a bare arrow, no border, no fill, no
 * shadow. The owner asked for a single back arrow across the site (2026-09-20)
 * and then, seeing it drawn as a bordered, shadowed square, for exactly this:
 * the plain arrow the settings page first had, without the grey circle it
 * showed on hover either. Hover turns the arrow orange instead; keyboard focus
 * still draws the brand ring. The 40px box keeps the tap target.
 */
export const BACK_CONTROL =
  "ui-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-gray-900 transition-colors hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 dark:text-white dark:hover:text-orange-400 dark:focus-visible:outline-orange-400";

/** The arrow inside it. */
export const BACK_ICON = "h-6 w-6";
