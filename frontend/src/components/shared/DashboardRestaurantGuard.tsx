"use client";

import { useEffect, useLayoutEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { restaurantRepository } from "@/src/app/repositories/restaurantRepository";
import { useAuth } from "@/src/providers/AuthProvider";
import { findMembershipForRestaurantSlug, restaurantHref, splitRestaurantPath } from "@/src/lib/restaurantPath";
import { DashboardPageSkeleton } from "./Skeleton";

// The restaurant in the URL is the restaurant this tab works in.
//
// It used to be the other way round: a cookie chose the restaurant and the URL
// said nothing, so a second tab switching restaurants silently moved this one
// too. Here the slug is resolved against the user's memberships and made the
// active restaurant before any page renders; a slug the user is not a member
// of goes to the picker, carrying the page they were after.
export default function DashboardRestaurantGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, memberships, activeMembership, setActiveRestaurant } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ slug?: string | string[] }>();
  const slug = typeof params?.slug === "string" ? params.slug : null;
  const routeMembership = findMembershipForRestaurantSlug(memberships, slug);
  const routeRestaurantId = routeMembership?.restaurant_id ?? null;
  const canonicalSlug = routeMembership?.restaurant?.slug ?? null;
  const activeRestaurantId = activeMembership?.restaurant_id ?? null;

  // Pin this tab's API requests to the URL's restaurant on EVERY resolve, not
  // only when it differs from the active one. Skipping the equal case was a
  // real bug: a tab opened on the restaurant the cookie already named was
  // never pinned, so when another tab switched restaurants its next request
  // followed the cookie and loaded the other restaurant's data under this
  // restaurant's name. A layout effect, because it runs before any page's
  // useEffect - the first fetch must already see the pin.
  useLayoutEffect(() => {
    if (routeRestaurantId !== null) restaurantRepository.bindTab(routeRestaurantId);
  }, [routeRestaurantId]);

  useEffect(() => {
    if (routeRestaurantId !== null && canonicalSlug) {
      restaurantRepository.refreshRememberedSlug(routeRestaurantId, canonicalSlug);
    }
  }, [canonicalSlug, routeRestaurantId]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    const { path } = splitRestaurantPath(pathname);
    if (routeRestaurantId === null) {
      const target = path === "/" ? "" : `${path}${window.location.search}`;
      router.replace(target ? `/restaurants?next=${encodeURIComponent(target)}` : "/restaurants");
      return;
    }
    // /r/<id>/... works, but the address bar should show the name.
    if (canonicalSlug && slug !== canonicalSlug) {
      router.replace(`${restaurantHref(canonicalSlug, path)}${window.location.search}`);
      return;
    }
    if (activeRestaurantId !== routeRestaurantId) setActiveRestaurant(routeRestaurantId);
  }, [activeRestaurantId, canonicalSlug, loading, pathname, routeRestaurantId, router, setActiveRestaurant, slug, user]);

  if (loading) {
    return <DashboardPageSkeleton />;
  }

  if (!user || !routeMembership) {
    return null;
  }

  // Never render a page against the previous restaurant, not even for a frame.
  if (activeRestaurantId !== routeRestaurantId) {
    return <DashboardPageSkeleton />;
  }

  return <>{children}</>;
}
