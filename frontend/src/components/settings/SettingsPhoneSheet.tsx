"use client";

import { ChevronLeft, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useIOSActiveStates } from "@/src/app/(dashboard)/r/[slug]/inventory/mobile/primitives";
import { useLanguage } from "@/src/providers/LanguageProvider";
import type { OpenSettingsDetail } from "@/src/lib/settingsModal";
import { FOCUS_RING, SettingsMobileContext, SettingsSearchContext } from "./SettingsPrimitives";
import AccountSettings from "./AccountSettings";
import DisplaySettings from "./DisplaySettings";
import RestaurantSettings from "./RestaurantSettings";

// The settings window on a phone (27 ก.ย. 2569): the owner opens it from the
// account menu like on a computer, but inside it keeps the phone settings he
// chose on 26 ก.ย. - a bar with the title and a search button, a strip of
// chips, and one long page of cards (SettingsMobileKit). A chip lights the
// moment it is tapped, the page glides to its card and the card flashes once,
// so the last cards, which can never reach the top, still show where the tap
// went. This was the /settings page's phone layout; it now scrolls inside the
// window instead of the page.

/** Whether the chip strip overflows and where it sits - the stock page's ChipRow affordance. */
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

/** The card a request opens at: the section's first card, or the group it names. */
function cardFor(request: OpenSettingsDetail) {
  if (request.section === "account") return "account";
  if (request.section === "display") return "display";
  if (request.section === "restaurant") return request.focus || "identity";
  return null;
}

export default function SettingsPhoneSheet({
  request,
  canManageRestaurant,
  onClose,
  rootRef,
}: {
  /** What the window was opened for; the page starts at its card. */
  request: OpenSettingsDetail;
  canManageRestaurant: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const { language } = useLanguage();
  const th = language === "th";
  useIOSActiveStates();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hasResults, setHasResults] = useState(true);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // While set, the page is gliding to a tapped chip's card and the scroll
  // must not move the lit chip; the next touch or wheel hands it back.
  const chipLockRef = useRef(false);
  const flashTimerRef = useRef(0);
  const { ref: chipsRef, scrollable: chipsScroll, ratio: chipsRatio, progress: chipsProgress } = useScrollAffordance(!searching);
  const chipsThumb = Math.max(chipsRatio * 100, 35);

  const copy = th
    ? { title: "ตั้งค่า", close: "ปิด", searchLabel: "ค้นหาการตั้งค่า", cancel: "ยกเลิก", categories: "หมวดการตั้งค่า", noMatch: (q: string) => `ไม่พบการตั้งค่าที่ตรงกับ “${q}”` }
    : { title: "Settings", close: "Close", searchLabel: "Search settings", cancel: "Cancel", categories: "Settings categories", noMatch: (q: string) => `No settings match “${q}”` };

  const chips: { id: string; label: string }[] = [
    { id: "account", label: th ? "บัญชี" : "Account" },
    { id: "display", label: th ? "การแสดงผล" : "Display" },
  ];
  if (canManageRestaurant) {
    chips.push(
      { id: "identity", label: th ? "ข้อมูลร้าน" : "Restaurant" },
      { id: "operations", label: th ? "เวลาและโต๊ะ" : "Hours" },
      { id: "billing", label: th ? "การคิดเงิน" : "Billing" },
      { id: "promptpay", label: th ? "พร้อมเพย์" : "PromptPay" },
      { id: "qr", label: "QR" },
    );
  }

  // The lit chip follows the card under the bar as the page is scrolled.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const spy = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (chipLockRef.current) return;
        const line = scroller.getBoundingClientRect().top + 24;
        let current: string | null = null;
        scroller.querySelectorAll<HTMLElement>("section[data-settings-group]:not([hidden])").forEach((section) => {
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
    scroller.addEventListener("scroll", spy, { passive: true });
    scroller.addEventListener("touchstart", release, { passive: true });
    scroller.addEventListener("wheel", release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", spy);
      scroller.removeEventListener("touchstart", release);
      scroller.removeEventListener("wheel", release);
    };
  }, []);

  // Keep the lit chip inside the strip.
  useEffect(() => {
    const strip = chipsRef.current;
    const chip = strip?.querySelector<HTMLElement>(`[data-chip="${activeChip}"]`);
    if (!strip || !chip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
  }, [activeChip, chipsRef]);

  const goToCard = useCallback((id: string, smooth: boolean) => {
    const section = scrollRef.current?.querySelector<HTMLElement>(`section[data-settings-group="${id}"]`);
    if (!section) return false;
    chipLockRef.current = true;
    setActiveChip(id);
    section.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    window.clearTimeout(flashTimerRef.current);
    setFlash(id);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 1200);
    return true;
  }, []);

  // "ดูบัญชีของคุณ", /settings/restaurant?group=billing and the rest open the
  // page at their card, once it has loaded (the restaurant's arrives late).
  const openAt = cardFor(request);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !openAt) return;
    const observer = new MutationObserver(() => {
      if (goToCard(openAt, false)) observer.disconnect();
    });
    const frame = requestAnimationFrame(() => {
      if (!goToCard(openAt, false)) observer.observe(scroller, { childList: true, subtree: true });
    });
    const stop = window.setTimeout(() => observer.disconnect(), 8000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [goToCard, openAt]);

  useEffect(() => () => window.clearTimeout(flashTimerRef.current), []);

  // Whether any card is left once the query has hidden what does not match.
  // Cards also arrive after they load, so recount when the tree changes.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const recount = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHasResults(scroller.querySelector("section[data-settings-group]:not([hidden])") !== null));
    };
    recount();
    const observer = new MutationObserver(recount);
    observer.observe(scroller, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [query]);

  const closeSearch = () => {
    setQuery("");
    setSearching(false);
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      data-inventory-mobile=""
      data-settings-root=""
      className="ai-settings-card absolute inset-0 flex flex-col bg-(--inv-canvas) text-(--inv-body)"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="shrink-0 border-b border-(--inv-hairline) bg-(--inv-canvas)/95 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-2 px-4">
          {searching ? (
            <div role="search" className="relative min-w-0 flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--inv-muted)" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closeSearch();
                  }
                }}
                placeholder={copy.searchLabel}
                aria-label={copy.searchLabel}
                className="h-10 w-full rounded-xl bg-(--inv-surface-strong) pl-9 pr-3 text-[16px] text-(--inv-heading) outline-none placeholder:text-(--inv-muted) focus:ring-2 focus:ring-(--inv-action)/30 [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          ) : (
            <>
              {/* Back to the page the window was opened over. */}
              <button
                type="button"
                onClick={onClose}
                aria-label={copy.close}
                className={`ui-press -ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-(--inv-action) ${FOCUS_RING}`}
              >
                <ChevronLeft aria-hidden="true" className="h-6 w-6" strokeWidth={2} />
              </button>
              <h1 className="min-w-0 flex-1 truncate text-[22px] font-bold text-(--inv-heading)">{copy.title}</h1>
            </>
          )}
          <button
            type="button"
            onClick={() => (searching ? closeSearch() : setSearching(true))}
            aria-label={searching ? copy.cancel : copy.searchLabel}
            className={`ui-press flex h-10 shrink-0 items-center justify-center rounded-xl ${searching ? "px-2 text-[15px] font-semibold text-(--inv-action)" : "w-10 bg-(--inv-surface-strong) text-(--inv-body)"} ${FOCUS_RING}`}
          >
            {searching ? copy.cancel : <Search aria-hidden="true" className="h-[18px] w-[18px]" />}
          </button>
        </div>

        {searching ? null : (
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

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(3rem,env(safe-area-inset-bottom))]"
        // The bar sits above this scroller, so a card only needs a small gap
        // when it is scrolled to the top.
        style={{ "--settings-bar": "12px" } as CSSProperties}
      >
        <div className="flex flex-col gap-4 px-4 pt-3">
          <SettingsSearchContext.Provider value={query}>
            <SettingsMobileContext.Provider value={{ mobile: true, flash }}>
              {query && !hasResults ? (
                <p className="py-6 text-center text-[13px] text-(--inv-faint)">{copy.noMatch(query.trim())}</p>
              ) : null}
              <AccountSettings />
              <DisplaySettings />
              {canManageRestaurant ? <RestaurantSettings /> : null}
            </SettingsMobileContext.Provider>
          </SettingsSearchContext.Provider>
        </div>
      </div>
    </div>
  );
}
