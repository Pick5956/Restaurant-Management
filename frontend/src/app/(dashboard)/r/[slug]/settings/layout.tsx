"use client";

import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, Globe, QrCode, Receipt, Search, Store, User, Wallet, X, type LucideIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import UserAvatar from "@/src/components/shared/UserAvatar";
import { useTheme } from "@/src/providers/ThemeProvider";
import { useIOSActiveStates, useIsMobile } from "../inventory/mobile/primitives";
import { useRestaurantNav, useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { BACK_CONTROL, BACK_ICON } from "@/src/components/shared/backControl";
import { FOCUS_RING, RAISED, SettingsMobileContext, SettingsSearchContext, TEXT_FOCUS } from "./_components/SettingsPrimitives";

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
  const { activeMembership, user } = useAuth();
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

  // ---- Phone ---------------------------------------------------------------
  // The stock page's phone look (inventory/mobile, chosen 26 ก.ย. 2569): the
  // computer's category list becomes the first screen, and each category - each
  // restaurant group, too - is a short screen of its own behind a centred title
  // and an orange back chevron. Nothing has to be scrolled to, so a tap always
  // lands. The computer's layout below is untouched.
  const isMobile = useIsMobile();
  useIOSActiveStates();
  const searchParams = useSearchParams();
  const { theme, mounted } = useTheme();
  const phoneGroup = pagePath === "/settings/restaurant" ? searchParams.get("group") : null;
  const phoneNavRef = useRef<HTMLDivElement>(null);
  const [phoneNavHeight, setPhoneNavHeight] = useState(0);
  useEffect(() => {
    const bar = phoneNavRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    // Fixed, with a spacer of its measured height: html and body clip
    // overflow-x, so position: sticky does not stick on a phone.
    const observer = new ResizeObserver(() => setPhoneNavHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [isMobile]);

  if (isMobile === null) return <div className="min-h-dvh" />;
  if (isMobile) {
    const th = language === "th";
    const canRestaurant = can(activeMembership, "manage_restaurant_settings");
    const isOwner = activeMembership?.role?.name === "owner";
    const groupTitles: Record<string, string> = th
      ? { identity: "ข้อมูลร้าน", operations: "เวลาและโต๊ะ", billing: "การคิดเงิน", promptpay: "รับเงินพร้อมเพย์", qr: "สั่งอาหารผ่าน QR", delete: "ลบร้านอาหาร" }
      : { identity: "Restaurant", operations: "Hours and tables", billing: "Billing", promptpay: "PromptPay", qr: "QR ordering", delete: "Delete restaurant" };
    const title =
      pagePath === "/settings/account" ? copy.account
        : pagePath === "/settings/display" ? copy.display
          : pagePath === "/settings/restaurant" ? (phoneGroup && groupTitles[phoneGroup]) || copy.restaurant
            : copy.title;
    const onLanding = isViewAll;
    const name = [user?.first_name, user?.last_name].map((part) => part?.trim()).filter((part) => part && part !== "-").join(" ") || user?.email || "";
    const displaySummary = `${language === "th" ? "ไทย" : "English"} · ${mounted && theme === "dark" ? (th ? "มืด" : "Dark") : th ? "สว่าง" : "Light"}`;
    const restaurantRows: { id: string; icon: LucideIcon; tone: string }[] = [
      { id: "identity", icon: Store, tone: "bg-(--inv-action-soft) text-(--inv-action)" },
      { id: "operations", icon: Clock, tone: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300" },
      { id: "billing", icon: Receipt, tone: "bg-(--inv-ok-soft) text-(--inv-ok)" },
      { id: "promptpay", icon: Wallet, tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300" },
      { id: "qr", icon: QrCode, tone: "bg-(--inv-low-soft) text-amber-700 dark:text-amber-300" },
    ];
    const row = (to: string, label: string, icon: LucideIcon | null, tone: string, value?: string, last = false) => {
      const Icon = icon;
      return (
        <Link
          key={to}
          href={href(to)}
          onClick={() => setQuery("")}
          className={`ui-press flex min-h-[50px] items-center gap-3 px-3 ${last ? "" : "border-b border-(--inv-hairline)"} ${FOCUS_RING}`}
        >
          {Icon ? (
            <span className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] ${tone}`}>
              <Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={2} />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[15px] text-(--inv-body)">{label}</span>
          {value ? <span className="max-w-[45%] truncate text-[15px] text-(--inv-muted)">{value}</span> : null}
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
        </Link>
      );
    };
    const eyebrow = (text: string) => (
      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">{text}</p>
    );
    const card = "mb-[22px] overflow-hidden rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface)";

    return (
      <div data-inventory-mobile="" data-settings-root="" className="min-h-dvh bg-(--inv-canvas) pb-10 text-(--inv-body)">
        <div
          ref={phoneNavRef}
          className="fixed inset-x-0 top-0 z-30 border-b border-(--inv-hairline) bg-(--inv-canvas)/95 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (onLanding ? goBack() : router.push("/settings"))}
              aria-label={copy.back}
              className={`ui-press flex min-h-[44px] min-w-[64px] items-center rounded-(--inv-radius) px-1 text-(--inv-action) ${FOCUS_RING}`}
            >
              <ChevronLeft aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-(--inv-heading)">{title}</h1>
            <div className="min-w-[64px]" />
          </div>
        </div>
        <div aria-hidden="true" style={{ height: phoneNavHeight }} />

        <div ref={contentRef} className="px-4 pt-3">
          {onLanding ? (
            <div role="search" className="relative mb-[18px]">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--inv-muted)" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={th ? "ค้นหาการตั้งค่า" : "Search settings"}
                aria-label={copy.searchLabel}
                className="h-10 w-full rounded-(--inv-radius) bg-(--inv-surface-strong) pl-9 pr-10 text-[16px] text-(--inv-heading) outline-none placeholder:text-(--inv-muted) focus:ring-2 focus:ring-(--inv-action)/30 [&::-webkit-search-cancel-button]:hidden"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label={copy.clear} className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center text-(--inv-muted)">
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          {onLanding && !query.trim() ? (
            <>
              <Link
                href={href("/settings/account")}
                className={`ui-press mb-[22px] flex items-center gap-3 rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface) p-3.5 shadow-(--inv-shadow) ${FOCUS_RING}`}
              >
                <UserAvatar src={user?.profile_image} name={name} size={52} className="h-[52px] w-[52px] text-[17px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold text-(--inv-heading)">{name}</span>
                  <span className="block truncate text-[12.5px] text-(--inv-muted)">{user?.email}</span>
                </span>
                <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
              </Link>

              {eyebrow(th ? "ของฉัน" : "Me")}
              <div className={card}>
                {row("/settings/account", copy.account, User, "bg-(--inv-action-soft) text-(--inv-action)", undefined)}
                {row("/settings/display", copy.display, Globe, "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300", displaySummary, true)}
              </div>

              {canRestaurant ? (
                <>
                  {eyebrow(copy.restaurant)}
                  <div className={card}>
                    {restaurantRows.map((item, index) =>
                      row(`/settings/restaurant?group=${item.id}`, groupTitles[item.id], item.icon, item.tone, undefined, index === restaurantRows.length - 1),
                    )}
                  </div>
                  {isOwner ? (
                    <div className={card}>
                      <Link
                        href={href("/settings/restaurant?group=delete")}
                        className={`ui-press flex min-h-[50px] items-center justify-center px-3 text-[15px] font-semibold text-(--inv-out) ${FOCUS_RING}`}
                      >
                        {groupTitles.delete}
                      </Link>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : (
            <SettingsSearchContext.Provider value={query}>
              <SettingsMobileContext.Provider value={{ mobile: true, group: phoneGroup, showTitles: Boolean(query.trim()) || (pagePath === "/settings/restaurant" && !phoneGroup) }}>
                {query && !hasResults ? (
                  <p className="py-6 text-center text-[13px] text-(--inv-faint)">{copy.noMatch(query.trim())}</p>
                ) : null}
                {children}
              </SettingsMobileContext.Provider>
            </SettingsSearchContext.Provider>
          )}
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
