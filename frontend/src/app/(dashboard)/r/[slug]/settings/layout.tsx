"use client";

import Link from "next/link";
import { ArrowLeft, Globe, Search, Store, User, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRestaurantNav, useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { FOCUS_RING, RAISED, SettingsSearchContext } from "./_components/SettingsPrimitives";

type NavItem = { key: "account" | "display" | "restaurant"; href: string; label: string; icon?: ReactNode };

const ICON = "mr-2 h-5 w-5 shrink-0";

/**
 * The settings frame, laid out after the reference the owner chose: a back
 * arrow and title, a full-width search, then the category list beside the
 * rows (a scrolling strip above them on a phone). /settings shows every
 * category at once and has no entry of its own; each other entry is its own
 * page. While a query is typed every category is shown and the rows that do
 * not match hide.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const { language } = useLanguage();
  const { activeMembership } = useAuth();
  const { pagePath, href } = useRestaurantNav();
  const router = useRestaurantRouter();
  const [query, setQuery] = useState("");
  const [inView, setInView] = useState<string | null>(null);
  const [hasResults, setHasResults] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const isViewAll = pagePath === "/settings";

  const copy = language === "th"
    ? { title: "ตั้งค่า", back: "ย้อนกลับ", search: "ค้นหา", searchLabel: "ค้นหาการตั้งค่า", clear: "ล้างคำค้นหา", categories: "หมวดการตั้งค่า", noMatch: (q: string) => `ไม่พบการตั้งค่าที่ตรงกับ “${q}”`, account: "บัญชี", display: "ภาษาและการแสดงผล", restaurant: "ร้านอาหาร" }
    : { title: "Settings", back: "Back", search: "Search", searchLabel: "Search settings", clear: "Clear search", categories: "Settings categories", noMatch: (q: string) => `No settings match “${q}”`, account: "Account", display: "Language and display", restaurant: "Restaurant" };

  // One list, no groups: the owner moved the restaurant in beside the personal
  // categories on 2026-09-21, when the team entry was dropped (staff and their
  // permissions live on the staff page, which is where that entry only pointed).
  const items: NavItem[] = [
    { key: "account", href: "/settings/account", label: copy.account, icon: <User aria-hidden="true" className={ICON} /> },
    { key: "display", href: "/settings/display", label: copy.display, icon: <Globe aria-hidden="true" className={ICON} /> },
  ];
  if (can(activeMembership, "manage_restaurant_settings")) {
    items.push({ key: "restaurant", href: "/settings/restaurant", label: copy.restaurant, icon: <Store aria-hidden="true" className={ICON} /> });
  }

  // On a phone the list is a strip that scrolls sideways; bring the open
  // category into it instead of leaving it past the right edge.
  const navRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const strip = navRef.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !current || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = current.offsetLeft - strip.clientWidth / 2 + current.offsetWidth / 2;
  }, [pagePath]);

  // On "View all", the category whose rows are at the top of the screen is
  // marked in the list, as the reference does.
  useEffect(() => {
    if (!isViewAll) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-category]"));
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visible.set((entry.target as HTMLElement).dataset.settingsCategory ?? "", entry.isIntersecting));
        const first = sections.find((section) => visible.get(section.dataset.settingsCategory ?? ""));
        setInView(first?.dataset.settingsCategory ?? null);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [isViewAll]);

  // Whether anything is left once the query has hidden what does not match.
  // Rows also arrive after their page loads, so recount when the tree changes.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    const recount = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHasResults(root.querySelector("[data-setting-row]:not([hidden])") !== null));
    };
    recount();
    const observer = new MutationObserver(recount);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [query]);

  const onSearch = (value: string) => {
    setQuery(value);
    if (value.trim() && !isViewAll) router.push("/settings");
  };

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/home");
  };

  return (
    // The reference's page container: at most 1440 wide and centred, 16px
    // sides and 32px below. The top is deeper than the reference's 8px, which
    // sits under its 64px header bar; this page has no bar above it.
    <div data-settings-root="" className="mx-auto min-h-dvh pt-4 lg:pt-10 w-full max-w-[1440px] bg-white px-4 pb-8 text-gray-950 dark:bg-gray-950 dark:text-white">
      <div className="mb-6 flex h-11 items-center">
        <button
          type="button"
          onClick={goBack}
          aria-label={copy.back}
          // The same back control the rest of the web app uses (expenses, POS,
          // reports): a bordered square, no round grey blob of its own.
          className={`ui-press mr-4 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-(--dashboard-control-shadow) transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 ${FOCUS_RING}`}
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <h1 className="text-[24px] font-semibold leading-8">{copy.title}</h1>
      </div>

      <div role="search" className="relative mb-4">
        <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-600 dark:text-gray-300" />
        <input
          type="search"
          value={query}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder={copy.search}
          aria-label={copy.searchLabel}
          // A 40px line box and no vertical padding, so Thai tone marks are
          // not clipped (see fieldClass in SettingsPrimitives).
          className={`h-10 w-full rounded ${RAISED} pl-12 pr-12 text-[16px] leading-10 text-gray-950 placeholder:text-gray-600 dark:text-white dark:placeholder:text-gray-300 [&::-webkit-search-cancel-button]:hidden ${FOCUS_RING}`}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={copy.clear}
            className={`absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded text-gray-600 hover:bg-(--settings-field-hover) dark:text-gray-300 ${FOCUS_RING}`}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <hr className="my-4 border border-[color:var(--dashboard-shell-border)]" />

      <div className="md:flex md:items-stretch">
        <nav aria-label={copy.categories} className="md:shrink-0">
          <ul ref={navRef} className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
            {items.map((item) => {
              const active = pagePath === item.href;
              const marked = !active && isViewAll && inView === item.key;
              return (
                <li key={item.key} className="shrink-0">
                  <Link
                    href={href(item.href)}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setQuery("")}
                    className={`flex h-[34px] items-center whitespace-nowrap rounded px-3 text-[16px] transition-colors md:h-8 ${FOCUS_RING} ${
                      active
                        ? "bg-orange-700 text-white"
                        : marked
                          ? "text-orange-700 hover:bg-gray-100 dark:text-orange-400 dark:hover:bg-gray-800"
                          : "text-gray-950 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-800"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <hr className="my-4 border border-[color:var(--dashboard-shell-border)] md:hidden" />
        <div aria-hidden="true" className={`mx-4 hidden w-px shrink-0 md:block ${RAISED}`} />

        <div ref={contentRef} className="min-w-0 flex-1">
          <SettingsSearchContext.Provider value={query}>
            {query && !hasResults ? (
              <p className="py-2 text-[16px] text-gray-950 opacity-80 dark:text-white">{copy.noMatch(query.trim())}</p>
            ) : null}
            {children}
          </SettingsSearchContext.Provider>
        </div>
      </div>
    </div>
  );
}
