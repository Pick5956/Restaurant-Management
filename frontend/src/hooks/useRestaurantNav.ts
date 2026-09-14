"use client";

import { useCallback, useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/src/providers/AuthProvider";
import { restaurantHref, splitRestaurantPath } from "@/src/lib/restaurantPath";

/**
 * Navigation inside a restaurant. Callers keep using restaurant-relative paths
 * ("/menu", "/pos/tables") and this puts them under /r/<slug>.
 *
 * - `href(path)`    for a `<Link href>`
 * - `push(path)` / `replace(path)` for the router
 * - `pagePath`      the current page WITHOUT the /r/<slug> prefix, which is
 *                   what every "am I on /menu?" comparison has to use
 *
 * In a restaurant URL the slug comes from the URL; anywhere else (the picker,
 * an invitation) it falls back to the active membership's slug.
 */
export function useRestaurantNav() {
  const params = useParams<{ slug?: string | string[] }>();
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { activeMembership } = useAuth();
  const routeSlug = typeof params?.slug === "string" ? params.slug : null;
  const slug = routeSlug ?? activeMembership?.restaurant?.slug ?? null;

  const href = useCallback((path: string) => restaurantHref(slug, path), [slug]);
  const push = useCallback((path: string) => router.push(restaurantHref(slug, path)), [router, slug]);
  const replace = useCallback((path: string) => router.replace(restaurantHref(slug, path)), [router, slug]);
  const pagePath = useMemo(() => splitRestaurantPath(pathname).path, [pathname]);

  return { slug, href, push, replace, pagePath };
}

/**
 * `useRouter()` for pages inside a restaurant: `push`, `replace` and `prefetch`
 * accept restaurant-relative paths and scope them; everything else is the
 * router itself. Stable while the slug is, so it is safe in dependency lists.
 */
export function useRestaurantRouter() {
  const router = useRouter();
  const { slug } = useRestaurantNav();
  return useMemo(() => ({
    ...router,
    push: (path: string, options?: Parameters<typeof router.push>[1]) => router.push(restaurantHref(slug, path), options),
    replace: (path: string, options?: Parameters<typeof router.replace>[1]) => router.replace(restaurantHref(slug, path), options),
    prefetch: (path: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(restaurantHref(slug, path), options),
  }), [router, slug]);
}
