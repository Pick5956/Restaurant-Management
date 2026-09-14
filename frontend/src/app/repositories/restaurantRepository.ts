import Cookies from "js-cookie";

const ACTIVE_KEY = "active_restaurant_id";
const ACTIVE_SLUG_KEY = "active_restaurant_slug";

// Which restaurant THIS TAB is working in.
//
// The URL decides that now (/r/<slug>/...), and DashboardRestaurantGuard writes
// it here when it resolves the slug. It is a module variable on purpose: every
// tab has its own copy, so a second tab switching restaurants can no longer
// retarget this tab's requests - which the cookie alone did, because a cookie
// is shared by every tab in the browser.
let tabActiveId: number | null = null;

// The cookies are still written, but they only mean "the restaurant used
// last": the proxy reads the slug to send an old /home link somewhere, and a
// fresh tab starts from them until its URL says otherwise.
export const restaurantRepository = {
  getActiveId(): number | null {
    if (tabActiveId !== null) return tabActiveId;
    const raw = Cookies.get(ACTIVE_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  },

  /**
   * Pin THIS tab's requests to a restaurant without touching the shared
   * cookies. The guard calls it for every restaurant URL it resolves - not only
   * when switching - because a tab whose URL happens to match the cookie at
   * load time otherwise never gets pinned, and follows the cookie the moment
   * another tab changes it.
   */
  bindTab(id: number) {
    tabActiveId = id;
  },

  /**
   * Keep the remembered slug true to its restaurant. Only corrects the name -
   * it never changes WHICH restaurant is remembered - so it is safe to call
   * from every tab. Without it, renaming a restaurant left the old slug in
   * the cookie and an old /home link went through the dead name to the picker.
   */
  refreshRememberedSlug(id: number, slug: string) {
    if (Cookies.get(ACTIVE_KEY) === String(id) && Cookies.get(ACTIVE_SLUG_KEY) !== slug) {
      Cookies.set(ACTIVE_SLUG_KEY, slug, { expires: 1 });
    }
  },

  setActiveId(id: number, slug?: string | null) {
    tabActiveId = id;
    Cookies.set(ACTIVE_KEY, String(id), { expires: 1 });
    if (slug) Cookies.set(ACTIVE_SLUG_KEY, slug, { expires: 1 });
  },

  clearActiveId() {
    tabActiveId = null;
    Cookies.remove(ACTIVE_KEY);
    Cookies.remove(ACTIVE_SLUG_KEY);
  },
};
