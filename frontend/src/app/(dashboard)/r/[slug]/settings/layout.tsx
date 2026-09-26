"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, Globe, Search, Store, User, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useIOSActiveStates, useIsMobile } from "../inventory/mobile/primitives";
import { useRestaurantNav, useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { BACK_CONTROL, BACK_ICON } from "@/src/components/shared/backControl";
import { FOCUS_RING, RAISED, SettingsMobileContext, SettingsSearchContext, TEXT_FOCUS } from "./_components/SettingsPrimitives";
import SettingsViewAllPage from "./page";

type NavItem = { key: "account" | "display" | "restaurant"; href: string; label: string; icon?: ReactNode };

const ICON = "mr-2 h-5 w-5 shrink-0";

/**
 * Whether the phone's chip strip overflows and where it sits - the same
 * affordance as the stock page's ChipRow (inventory/mobile/primitives.tsx).
 */
function useScrollAffordance(shown: boolean) {
  const ref = useRef<HTMLUListElement>(null);
  const [state, setState] = useState({ scrollable: false, ratio: 0, progress: 0 });
  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const overflow = node.scrollWidth - node.clientWidth;
    if (overflow <= 1) {
      setState((current) => (current.scrollable ? { scrollable: false, ratio: 0, progress: 0 } : current));
      return;
    }
    setState({ scrollable: true, ratio: node.clientWidth / node.scrollWidth, progress: node.scrollLeft / overflow });
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure, shown]);
  return { ref, ...state };
}

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
      frame = requestAnimationFrame(() => setHasResults(root.querySelector("[data-setting-row]:not([hidden]), section[data-settings-group]:not([hidden])") !== null));
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

  // ---- Phone ---------------------------------------------------------------
  // Chosen 26 ก.ย. 2569: one long page of cards, a fixed bar with the title,
  // a search button and a strip of chips. A chip lights the moment it is
  // tapped, the page glides to its card and the card flashes once - so the
  // last cards, which can never reach the top, still show where the tap went.
  // Every settings route draws the same page; /settings/account and the rest
  // only decide which card it opens on. The computer's layout below is untouched.
  const isMobile = useIsMobile();
  useIOSActiveStates();
  const searchParams = useSearchParams();
  const phoneBarRef = useRef<HTMLDivElement>(null);
  const [phoneBarHeight, setPhoneBarHeight] = useState(0);
  const [phoneSearch, setPhoneSearch] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // While set, the page is gliding to a tapped chip's card and the scroll
  // must not move the lit chip; the next touch or wheel hands it back.
  const chipLockRef = useRef(false);
  const flashTimerRef = useRef(0);
  const { ref: chipsRef, scrollable: chipsScroll, ratio: chipsRatio, progress: chipsProgress } = useScrollAffordance(Boolean(isMobile) && !phoneSearch);
  const chipsThumb = Math.max(chipsRatio * 100, 35);

  useEffect(() => {
    const bar = phoneBarRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    // Fixed, with a spacer of its measured height: html and body clip
    // overflow-x, so position: sticky does not stick on a phone.
    const observer = new ResizeObserver(() => setPhoneBarHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isMobile]);

  // The lit chip follows the card under the bar as the page is scrolled.
  useEffect(() => {
    if (!isMobile) return;
    let frame = 0;
    const spy = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (chipLockRef.current) return;
        const line = (phoneBarRef.current?.offsetHeight ?? 0) + 24;
        let current: string | null = null;
        document.querySelectorAll<HTMLElement>("section[data-settings-group]:not([hidden])").forEach((section) => {
          if (section.getBoundingClientRect().top <= line) current = section.dataset.settingsGroup ?? null;
        });
        if (current === "delete") current = "qr";
        setActiveChip((previous) => current ?? previous ?? "account");
      });
    };
    const release = () => {
      chipLockRef.current = false;
    };
    spy();
    window.addEventListener("scroll", spy, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    window.addEventListener("wheel", release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", spy);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("wheel", release);
    };
  }, [isMobile]);

  // Keep the lit chip inside the strip.
  useEffect(() => {
    const strip = chipsRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-chip="${activeChip}"]`);
    if (!strip || !chip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
  }, [activeChip, chipsRef]);

  const goToCard = useCallback((id: string, smooth: boolean) => {
    const section = document.querySelector<HTMLElement>(`section[data-settings-group="${id}"]`);
    if (!section) return false;
    chipLockRef.current = true;
    setActiveChip(id);
    section.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    window.clearTimeout(flashTimerRef.current);
    setFlash(id);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 1200);
    return true;
  }, []);

  // /settings/account, /settings/restaurant?group=billing and the rest open
  // the page at their card, once it has loaded (the restaurant's arrives late).
  const openAt =
    pagePath === "/settings/account" ? "account"
      : pagePath === "/settings/display" ? "display"
        : pagePath === "/settings/restaurant" ? searchParams.get("group") || "identity"
          : null;
  useEffect(() => {
    if (!isMobile || !openAt) return;
    const observer = new MutationObserver(() => {
      if (goToCard(openAt, false)) observer.disconnect();
    });
    const frame = requestAnimationFrame(() => {
      if (!goToCard(openAt, false)) observer.observe(document.body, { childList: true, subtree: true });
    });
    const stop = window.setTimeout(() => observer.disconnect(), 8000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [goToCard, isMobile, openAt]);

  useEffect(() => () => window.clearTimeout(flashTimerRef.current), []);

  if (isMobile === null) return <div className="min-h-dvh" />;
  if (isMobile) {
    const th = language === "th";
    const chips: { id: string; label: string }[] = [
      { id: "account", label: th ? "บัญชี" : "Account" },
      { id: "display", label: th ? "การแสดงผล" : "Display" },
    ];
    if (can(activeMembership, "manage_restaurant_settings")) {
      chips.push(
        { id: "identity", label: th ? "ข้อมูลร้าน" : "Restaurant" },
        { id: "operations", label: th ? "เวลาและโต๊ะ" : "Hours" },
        { id: "billing", label: th ? "การคิดเงิน" : "Billing" },
        { id: "promptpay", label: th ? "พร้อมเพย์" : "PromptPay" },
        { id: "qr", label: "QR" },
      );
    }
    const closeSearch = () => {
      setQuery("");
      setPhoneSearch(false);
    };

    return (
      <div
        data-inventory-mobile=""
        data-settings-root=""
        className="min-h-dvh bg-(--inv-canvas) pb-12 text-(--inv-body)"
        style={{ "--settings-bar": `${phoneBarHeight + 12}px` } as CSSProperties}
      >
        <div
          ref={phoneBarRef}
          className="fixed inset-x-0 top-0 z-30 border-b border-(--inv-hairline) bg-(--inv-canvas)/95 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur"
        >
          <div className="flex items-center gap-2 px-4">
            {phoneSearch ? (
              <div role="search" className="relative min-w-0 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--inv-muted)" />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeSearch();
                  }}
                  placeholder={copy.searchLabel}
                  aria-label={copy.searchLabel}
                  className="h-10 w-full rounded-xl bg-(--inv-surface-strong) pl-9 pr-3 text-[16px] text-(--inv-heading) outline-none placeholder:text-(--inv-muted) focus:ring-2 focus:ring-(--inv-action)/30 [&::-webkit-search-cancel-button]:hidden"
                />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={goBack}
                  aria-label={copy.back}
                  className={`ui-press -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-(--inv-action) ${FOCUS_RING}`}
                >
                  <ChevronLeft aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
                </button>
                <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-(--inv-heading)">{copy.title}</h1>
              </>
            )}
            <button
              type="button"
              onClick={() => (phoneSearch ? closeSearch() : setPhoneSearch(true))}
              aria-label={phoneSearch ? copy.clear : copy.searchLabel}
              className={`ui-press flex h-10 shrink-0 items-center justify-center rounded-xl ${phoneSearch ? "px-2 text-[15px] font-semibold text-(--inv-action)" : "w-10 bg-(--inv-surface-strong) text-(--inv-body)"} ${FOCUS_RING}`}
            >
              {phoneSearch ? (th ? "ยกเลิก" : "Cancel") : <Search aria-hidden="true" className="h-[18px] w-[18px]" />}
            </button>
          </div>

          {phoneSearch ? null : (
            <>
              <div className="relative mt-2.5">
                <ul ref={chipsRef} aria-label={copy.categories} className="soft-scrollbar-hide flex gap-1.5 overflow-x-auto px-4">
                  {chips.map((chip) => {
                    const on = activeChip === chip.id;
                    return (
                      <li key={chip.id} className="shrink-0">
                        <button
                          type="button"
                          data-chip={chip.id}
                          aria-current={on ? "true" : undefined}
                          onClick={() => goToCard(chip.id, true)}
                          className={`ui-press whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${FOCUS_RING} ${
                            on
                              ? "border-(--inv-action) bg-(--inv-action-soft) text-(--inv-action)"
                              : "border-(--inv-hairline) bg-(--inv-surface) text-(--inv-muted)"
                          }`}
                        >
                          {chip.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {chipsScroll ? (
                  <>
                    <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-(--inv-canvas) to-transparent transition-opacity duration-200 ${chipsProgress > 0.02 ? "opacity-100" : "opacity-0"}`} />
                    <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-(--inv-canvas) to-transparent transition-opacity duration-200 ${chipsProgress < 0.98 ? "opacity-100" : "opacity-0"}`} />
                  </>
                ) : null}
              </div>
              {chipsScroll ? (
                // A short centred track under the chips, the stock page's: it
                // only says there is more to the side.
                <div aria-hidden="true" className="mx-auto mt-2 h-[3px] w-12 overflow-hidden rounded-full bg-(--inv-surface-strong)">
                  <div
                    className="h-full rounded-full bg-(--inv-action)"
                    style={{ width: `${chipsThumb}%`, transform: `translateX(${(chipsProgress * (100 - chipsThumb) * 100) / chipsThumb}%)` }}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
        <div aria-hidden="true" style={{ height: phoneBarHeight }} />

        <div ref={contentRef} className="flex flex-col gap-4 px-4 pt-3">
          <SettingsSearchContext.Provider value={query}>
            <SettingsMobileContext.Provider value={{ mobile: true, group: null, showTitles: false, flash }}>
              {query && !hasResults ? (
                <p className="py-6 text-center text-[13px] text-(--inv-faint)">{copy.noMatch(query.trim())}</p>
              ) : null}
              <SettingsViewAllPage />
            </SettingsMobileContext.Provider>
          </SettingsSearchContext.Provider>
        </div>
      </div>
    );
  }

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
          className={`mr-2 ${BACK_CONTROL}`}
        >
          <ArrowLeft aria-hidden="true" className={BACK_ICON} />
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
          className={`h-10 w-full rounded ${RAISED} pl-12 pr-12 text-[16px] leading-10 text-gray-950 placeholder:text-gray-600 dark:text-white dark:placeholder:text-gray-300 [&::-webkit-search-cancel-button]:hidden ${TEXT_FOCUS}`}
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
