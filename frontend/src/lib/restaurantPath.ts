import type { Membership } from "@/src/types/restaurant";

// The web dashboard lives under /r/<slug>/... - dishy.pro/r/kruapick/home.
//
// Everything that names a page (the sidebar, the AI assistant's links, the
// role's landing page) keeps speaking in restaurant-relative paths like
// "/menu" and converts at the edge, with these helpers. The URL is what says
// which restaurant a tab is working in; see DashboardRestaurantGuard.

export const RESTAURANT_PATH_PREFIX = "/r";

/**
 * The top-level pages that exist inside a restaurant. They were served at the
 * site root before slugs, so a bare "/home" is an old link or bookmark to send
 * on to the restaurant it belongs to.
 */
export const RESTAURANT_PAGE_ROOTS = [
  "/home",
  "/orders",
  "/pos",
  "/kitchen",
  "/tables",
  "/menu",
  "/inventory",
  "/expenses",
  "/ai-assistant",
  "/staff",
  "/reports",
  "/settings",
  "/dashboard",
  "/profile",
] as const;

const scopedPathPattern = /^\/r\/([^/?#]+)(.*)$/;
const numericPattern = /^\d+$/;

// Slug rules. These mirror backend/internal/restaurantslug exactly - the tests
// on both sides use the same cases - so the form never accepts what the
// server rejects.
export const RESTAURANT_SLUG_MIN_LENGTH = 3;
export const RESTAURANT_SLUG_MAX_LENGTH = 40;
const SUGGESTED_SLUG_MAX_LENGTH = 32;
const slugShapePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidRestaurantSlug(slug: string): boolean {
  return slug.length >= RESTAURANT_SLUG_MIN_LENGTH
    && slug.length <= RESTAURANT_SLUG_MAX_LENGTH
    && slugShapePattern.test(slug)
    && /[a-z]/.test(slug);
}

/** Keystroke-level cleanup: lowercase, spaces and underscores to hyphens, no
 *  other characters. A trailing hyphen survives so the next word can follow. */
export function sanitizeRestaurantSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, RESTAURANT_SLUG_MAX_LENGTH);
}

/** The slug the server would build from this name, or "" when it has too few
 *  Latin letters to build one - the server then picks a random one. */
export function suggestRestaurantSlug(name: string): string {
  let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > SUGGESTED_SLUG_MAX_LENGTH) {
    slug = slug.slice(0, SUGGESTED_SLUG_MAX_LENGTH);
    const cut = slug.lastIndexOf("-");
    if (cut >= RESTAURANT_SLUG_MIN_LENGTH) slug = slug.slice(0, cut);
    slug = slug.replace(/^-+|-+$/g, "");
  }
  return isValidRestaurantSlug(slug) ? slug : "";
}

/**
 * "/menu" in restaurant "krua-pick" -> "/r/krua-pick/menu", and "/" -> the
 * restaurant's own root. Only restaurant pages are scoped: "/restaurants",
 * "/docs", a full URL or an already-scoped path come back unchanged, so a
 * caller can hand this any destination without checking first.
 */
export function restaurantHref(slug: string | null | undefined, path: string): string {
  if (!slug || scopedPathPattern.test(path)) return path;
  const base = `${RESTAURANT_PATH_PREFIX}/${encodeURIComponent(slug)}`;
  if (path === "/") return base;
  return isLegacyRestaurantPagePath(path.split(/[?#]/)[0]) ? `${base}${path}` : path;
}

/** "/r/krua-pick/menu?x=1" -> { slug: "krua-pick", path: "/menu?x=1" }. */
export function splitRestaurantPath(pathname: string): { slug: string | null; path: string } {
  const match = scopedPathPattern.exec(pathname);
  if (!match) return { slug: null, path: pathname };
  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed escape is just an unknown slug; the guard sends it away.
  }
  const rest = match[2];
  const path = rest === "" || rest === "/" ? "/" : rest.startsWith("/") ? rest : `/${rest}`;
  return { slug, path };
}

export function isLegacyRestaurantPagePath(pathname: string): boolean {
  return RESTAURANT_PAGE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/**
 * Where to go after choosing a restaurant, given where the user was trying to
 * get to. A restaurant page - old style or another restaurant's - lands on the
 * same page in the chosen restaurant; anything else is kept as it is. A bare
 * restaurant root comes back undefined so the caller picks the role's page.
 */
export function rebaseRestaurantPath(next: string | undefined, slug: string): string | undefined {
  if (!next) return undefined;
  const { slug: fromSlug, path } = splitRestaurantPath(next);
  if (fromSlug !== null) {
    const bare = path === "/" || path.startsWith("/?") || path.startsWith("/#");
    return bare ? undefined : restaurantHref(slug, path);
  }
  return isLegacyRestaurantPagePath(next.split(/[?#]/)[0]) ? restaurantHref(slug, next) : next;
}

/**
 * The membership a /r/<slug> URL refers to. A numeric segment is read as the
 * restaurant id - slugs must contain a letter, so the two never collide - which
 * keeps /r/<id> working for anything that has an id but no slug to hand.
 */
export function findMembershipForRestaurantSlug(
  memberships: readonly Membership[],
  slug: string | null | undefined,
): Membership | null {
  if (!slug) return null;
  if (numericPattern.test(slug)) {
    const id = Number(slug);
    return memberships.find((membership) => membership.restaurant_id === id) ?? null;
  }
  return memberships.find((membership) => membership.restaurant?.slug === slug) ?? null;
}
