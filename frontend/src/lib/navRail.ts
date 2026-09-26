// Where the nav rail shows, for the code that has to ask in JavaScript.
//
// Written in rem, like Tailwind's md (48rem) and lg (64rem), so a browser set
// to a bigger default font moves these and every md:/lg: class together. The
// rail used to be asked with 1024px while the classes used lg's 64rem; with
// the owner's desktop Chrome on a bigger font the two disagreed between 1024px
// and 64rem, and the page came out half desktop, half phone: content pushed
// right for a rail that was not drawn, the phone menu tab on top, and the
// toolbar spaced twice (27 ก.ย. 2569).
//
// From lg: the full rail, which the owner can shrink to icons.
export const RAIL_FULL_QUERY = "(width >= 64rem)";
// From the tablet breakpoint (46.5rem = 744px, an iPad mini held upright; see
// --breakpoint-tablet in globals.css) up to lg, the rail shows icons only, and
// its menu button opens the full menu over the page (owner, 27 ก.ย. 2569).
// Below it a phone keeps the menu tab on the left edge.
export const RAIL_ICONS_QUERY = "(46.5rem <= width < 64rem)";
// The icon rail's width; the tablet:…left-[68px] classes on fixed bars repeat
// it.
export const RAIL_ICONS_WIDTH = "68px";
