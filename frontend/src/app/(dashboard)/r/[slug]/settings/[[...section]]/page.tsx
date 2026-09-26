"use client";

import { useEffect } from "react";
import { useRestaurantNav, useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { openSettings, settingsRequestForPath } from "@/src/lib/settingsModal";

/**
 * The settings are a window now, not a page (27 ก.ย. 2569). The old addresses
 * - /settings, /settings/account, /settings/restaurant?group=billing, which the
 * AI and older links still use - open that window at the same place and step
 * back to the page they were opened from.
 */
export default function SettingsAddress() {
  const { pagePath } = useRestaurantNav();
  const router = useRestaurantRouter();
  useEffect(() => {
    // A window already open to requests means this came from a link on a
    // page of the restaurant: step back to that page and the window opens
    // over it. Otherwise (typed in, reloaded, or from a page outside the
    // restaurant) going back would drop the request, so the home page takes
    // this address's place and the window opens there.
    const heard = openSettings(settingsRequestForPath(pagePath, window.location.search));
    if (heard) router.back();
    else router.replace("/home");
    // Once per visit to the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
