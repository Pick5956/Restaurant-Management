// Where the nav rail shows, for the code that has to ask in JavaScript.
//
// In px, the same widths as the tablet: and lg: breakpoints, which are set in
// px in globals.css (@theme). Everything that decides the layout has to switch
// at one width. On 27 ก.ย. 2569 this file first moved the JS checks from
// 1024px to Tailwind's default 64rem so they would agree with the lg:
// classes: with the owner's desktop Chrome on a bigger font they had split,
// and the page came out half desktop, half phone. But a media query's rem is
// the browser's font setting, so the layout then moved with it: DevTools' iPad
// mini (768px) got the phone layout a real iPad mini never shows. The
// breakpoints went to px instead, with html pinned to 16px.
//
// From lg: the full rail, which the owner can shrink to icons.
export const RAIL_FULL_QUERY = "(min-width: 1024px)";
// From the tablet breakpoint (744px, an iPad mini held upright) up to lg the
// rail shows icons only, and its menu button opens the full menu over the
// page (owner, 27 ก.ย. 2569). Below it a phone keeps the menu tab on the
// left edge.
export const RAIL_ICONS_QUERY = "(744px <= width < 1024px)";
// The icon rail's width; the tablet:…left-[68px] classes on fixed bars repeat
// it.
export const RAIL_ICONS_WIDTH = "68px";
