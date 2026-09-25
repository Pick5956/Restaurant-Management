"use client";

import Link from "next/link";
import { ArrowLeft, Globe, Search, Store, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRestaurantNav, useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { BACK_CONTROL, BACK_ICON } from "@/src/components/shared/backControl";
import { FOCUS_RING, RAISED, SettingsSearchContext, TEXT_FOCUS } from "./_components/SettingsPrimitives";

/**
 * Whether the phone's group strip overflows and where it sits - the same
 * affordance as the stock page's ChipRow (inventory/mobile/primitives.tsx): the
 * owner asked for its short centred bar here too (25 ก.ย. 2569).
 */
function useScrollAffordance() {
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
    if (!node) return;
    node.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);
  return { ref, ...state };
}

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
    ? { title: "ตั้งค่า", back: "ย้อนกลับ", search: "ค้นหา", searchLabel: "ค้นหาการตั้งค่า", clear: "ล้างคำค้นหา", categories: "หมวดการตั้งค่า", noMatch: (q: string) => `ไม่พบการตั้งค่าที่ตรงกับ “${q}”`, account: "บัญชี", display: "ภาษาและการแสดงผล", restaurant: "ร้านอาหาร", openSearch: "เปิดช่องค้นหา", groups: { account: "บัญชี", display: "การแสดงผล", identity: "ข้อมูลร้าน", operations: "เวลาและโต๊ะ", billing: "การคิดเงิน", promptpay: "พร้อมเพย์", qr: "สั่งผ่าน QR", delete: "ลบร้าน" } }
    : { title: "Settings", back: "Back", search: "Search", searchLabel: "Search settings", clear: "Clear search", categories: "Settings categories", noMatch: (q: string) => `No settings match “${q}”`, account: "Account", display: "Language and display", restaurant: "Restaurant", openSearch: "Open search", groups: { account: "Account", display: "Display", identity: "Restaurant", operations: "Hours and tables", billing: "Billing", promptpay: "PromptPay", qr: "QR ordering", delete: "Delete" } };

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
  // On a phone every group gets a chip in one strip that stays at the top
  // (แบบ B, chosen 25 ก.ย. 2569): the three categories hid six groups of the
  // restaurant's settings behind one word. A chip scrolls to its group; from
  // a single category's page it goes to "all settings" first.
  const canRestaurant = can(activeMembership, "manage_restaurant_settings");
  const isOwner = activeMembership?.role?.name === "owner";
  const groups: { id: keyof typeof copy.groups; label: string }[] = (
    ["account", "display", ...(canRestaurant ? ["identity", "operations", "billing", "promptpay", "qr"] : []), ...(canRestaurant && isOwner ? ["delete"] : [])] as (keyof typeof copy.groups)[]
  ).map((id) => ({ id, label: copy.groups[id] }));
  const [activeGroup, setActiveGroup] = useState<string>("account");
  const [searchOpen, setSearchOpen] = useState(false);
  const pendingGroupRef = useRef<string | null>(null);
  // On a phone the header and the strip are one fixed bar, the way the stock
  // and menu pages hold their toolbars there: html and body clip overflow-x,
  // which makes the body the sticky container, so position: sticky never
  // sticks on a phone. A spacer of the bar's measured height keeps the first
  // row out from under it, and the same height is where a group lands.
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const measure = () => setBarHeight(window.matchMedia("(min-width: 768px)").matches ? 0 : bar.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const { ref: chipsRef, scrollable: chipsScroll, ratio: chipsRatio, progress: chipsProgress } = useScrollAffordance();
  const chipsThumb = Math.max(chipsRatio * 100, 35);

  const scrollToGroup = (id: string) => {
    const target = document.querySelector<HTMLElement>(`[data-settings-group="${id}"]`);
    if (!target) return false;
    setActiveGroup(id);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  };
  const goToGroup = (id: string) => {
    setQuery("");
    if (scrollToGroup(id)) return;
    pendingGroupRef.current = id;
    router.push("/settings");
  };

  // After a chip took the page to "all settings", wait for the group to
  // render (the restaurant's rows load from the server) and then go to it.
  useEffect(() => {
    const id = pendingGroupRef.current;
    if (!isViewAll || !id) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (scrollToGroup(id) || tries > 30) {
        pendingGroupRef.current = null;
        window.clearInterval(timer);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [isViewAll]);

  // The chip lit is the last group whose heading has passed under the strip.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-group]"));
        if (sections.length === 0) return;
        let current = sections[0].dataset.settingsGroup ?? "account";
        for (const section of sections) {
          if (section.getBoundingClientRect().top <= (barRef.current?.offsetHeight ?? 0) + 16) current = section.dataset.settingsGroup ?? current;
        }
        setActiveGroup(current);
      });
    };
    measure();
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", measure, { capture: true });
    };
  }, [pagePath]);

  useEffect(() => {
    const strip = chipsRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!strip || !chip) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
  }, [activeGroup, chipsRef]);

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
    <div
      data-settings-root=""
      style={{ ["--settings-bar" as string]: `${barHeight + 8}px` }}
      className="mx-auto min-h-dvh pt-4 max-md:pt-0 lg:pt-10 w-full max-w-[1440px] bg-white px-4 pb-8 text-gray-950 dark:bg-gray-950 dark:text-white"
    >
      <div
        ref={barRef}
        className="max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:z-30 max-md:bg-white/95 max-md:px-4 max-md:pt-[max(0.75rem,env(safe-area-inset-top))] max-md:shadow-[0_1px_0_rgba(0,0,0,0.06)] max-md:backdrop-blur dark:max-md:bg-gray-950/95"
      >
      <div className="mb-6 flex h-11 items-center max-md:mb-2">
        <button
          type="button"
          onClick={goBack}
          aria-label={copy.back}
          className={`mr-2 ${BACK_CONTROL}`}
        >
          <ArrowLeft aria-hidden="true" className={BACK_ICON} />
        </button>
        <h1 className="text-[24px] font-semibold leading-8 max-md:text-[22px]">{copy.title}</h1>
        <button
          type="button"
          onClick={() => setSearchOpen((open) => !open)}
          aria-label={copy.openSearch}
          aria-expanded={searchOpen || Boolean(query)}
          className={`ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl ${RAISED} text-gray-700 md:hidden dark:text-gray-200 ${FOCUS_RING}`}
        >
          <Search aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>

      <div role="search" className={`relative mb-4 max-md:mb-1 ${searchOpen || query ? "" : "max-md:hidden"}`}>
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

      <hr className="my-4 border border-[color:var(--dashboard-shell-border)] max-md:hidden" />

      <nav aria-label={copy.categories} className="-mx-4 py-2 md:hidden">
        <div className="relative">
          <ul ref={chipsRef} className="soft-scrollbar-hide flex gap-2 overflow-x-auto px-4">
            {groups.map((group) => {
              const active = activeGroup === group.id;
              return (
                <li key={group.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => goToGroup(group.id)}
                    aria-current={active ? "true" : undefined}
                    className={`ui-press whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition ${FOCUS_RING} ${
                      active
                        ? "border-orange-600 bg-orange-50 text-orange-700 dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-300"
                        : "border-gray-200 bg-white text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
                    }`}
                  >
                    {group.label}
                  </button>
                </li>
              );
            })}
          </ul>
          {chipsScroll ? (
            <>
              <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent transition-opacity duration-200 dark:from-gray-950 ${chipsProgress > 0.02 ? "opacity-100" : "opacity-0"}`} />
              <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent transition-opacity duration-200 dark:from-gray-950 ${chipsProgress < 0.98 ? "opacity-100" : "opacity-0"}`} />
            </>
          ) : null}
        </div>
        {chipsScroll ? (
          // A short centred track under the chips, the stock page's: it only
          // says there is more to the side, and follows the finger unanimated.
          <div aria-hidden="true" className="mx-auto mt-2 h-[3px] w-12 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-orange-600"
              style={{ width: `${chipsThumb}%`, transform: `translateX(${(chipsProgress * (100 - chipsThumb) * 100) / chipsThumb}%)` }}
            />
          </div>
        ) : null}
      </nav>
      </div>
      <div aria-hidden="true" className="md:hidden" style={{ height: barHeight }} />

      <div className="md:flex md:items-stretch">
        <nav aria-label={copy.categories} className="hidden md:block md:shrink-0">
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
