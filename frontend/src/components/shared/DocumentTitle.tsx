"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { splitRestaurantPath } from "@/src/lib/restaurantPath";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { pageTitle } from "@/src/lib/documentTitle";

export default function DocumentTitle() {
  const pathname = usePathname();
  const { language } = useLanguage();
  const { activeMembership } = useAuth();
  useEffect(() => {
    if (pathname === "/docs" || pathname.startsWith("/docs/")) return;

    const restaurantName = activeMembership?.restaurant?.name?.trim();
    const orderReference = new URLSearchParams(window.location.search).get("ref") || undefined;
    const title = pageTitle(splitRestaurantPath(pathname).path, language, restaurantName || "Dishy", orderReference);
    const syncTitle = () => {
      if (document.title !== title) document.title = title;
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) syncTitle();
    };

    syncTitle();

    const observer = new MutationObserver(syncTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    window.addEventListener("focus", syncTitle);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      observer.disconnect();
      window.removeEventListener("focus", syncTitle);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeMembership?.restaurant?.name, language, pathname]);

  return null;
}
