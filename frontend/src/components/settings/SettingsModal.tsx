"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Globe, Search, Store, User, X, type LucideIcon } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { listenForSettings, type OpenSettingsDetail, type SettingsSection } from "@/src/lib/settingsModal";
import { FLASH_CLASSES, matchesSearch } from "@/src/components/shared/settingsModalKit";
import AccountSettings from "./AccountSettings";
import DisplaySettings from "./DisplaySettings";
import RestaurantSettings from "./RestaurantSettings";

// The app's settings in one floating window, opened from the account menu
// (27 ก.ย. 2569). The owner asked for the settings page to become the window
// Dishy AI's settings already are (AISettingsModal), so this is that window:
// the same card, sidebar with a search, section list, close band, and on a
// phone the same full-screen list that drills into a section. The sections are
// the old pages' - account, language and display, restaurant - each saving a
// setting the moment it changes, as they did on the page.

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = { account: User, display: Globe, restaurant: Store };

function copy(language: "th" | "en") {
  return language === "th"
    ? {
        settings: "ตั้งค่า",
        close: "ปิด",
        back: "กลับ",
        search: "ค้นหาการตั้งค่า",
        searchEmpty: (q: string) => `ไม่พบการตั้งค่าที่ตรงกับ “${q}”`,
        sections: {
          account: { name: "บัญชี", blurb: "รูปโปรไฟล์ · ชื่อ · เบอร์โทร" },
          display: { name: "ภาษาและการแสดงผล", blurb: "ภาษา · ธีม · ปุ่มผู้ช่วย AI" },
          restaurant: { name: "ร้านอาหาร", blurb: "ข้อมูลร้าน · เวลา · การคิดเงิน · QR" },
        },
      }
    : {
        settings: "Settings",
        close: "Close",
        back: "Back",
        search: "Search settings",
        searchEmpty: (q: string) => `No settings match “${q}”`,
        sections: {
          account: { name: "Account", blurb: "Photo · name · phone" },
          display: { name: "Language and display", blurb: "Language · theme · AI button" },
          restaurant: { name: "Restaurant", blurb: "Profile · hours · billing · QR" },
        },
      };
}

type SearchResult = { id: string; section: SettingsSection; label: string; group: string };

export default function SettingsModal() {
  const { language } = useLanguage();
  const { activeMembership } = useAuth();
  const t = copy(language);
  const sections: SettingsSection[] = can(activeMembership, "manage_restaurant_settings")
    ? ["account", "display", "restaurant"]
    : ["account", "display"];

  const [open, setOpen] = useState(false);
  // Leaving plays the exit first, then unmounts - the AI settings' timing.
  const [closing, setClosing] = useState(false);
  // Desktop always shows a section; a phone shows the section list first and
  // drills in (mobileOpen), as the AI settings do.
  const [section, setSection] = useState<SettingsSection>("account");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  // The row or group a search result or an old address points at, to scroll
  // to and light once it has rendered.
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    const show = (detail: OpenSettingsDetail) => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      setClosing(false);
      setSection(detail.section ?? "account");
      // A named section opens straight into it on a phone too ("ดูบัญชีของคุณ");
      // the plain "ตั้งค่า" starts at the list.
      setMobileOpen(Boolean(detail.section));
      setQuery("");
      setJumpTo(detail.focus ?? null);
      setOpen(true);
    };
    return listenForSettings(show);
  }, []);

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 200);
  };

  // Escape closes, unless it was meant for something inside: the search box
  // clears itself first, and the delete-restaurant dialog handles its own.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const focused = document.activeElement;
      if (focused && focused !== document.body && !cardRef.current?.contains(focused)) return;
      requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // The search reads the rows off the screen: every section is mounted (the
  // ones not shown are hidden), and each row carries its name and note in
  // data-setting-* attributes, so nothing has to list the settings twice.
  // Recounted as the tree changes - the restaurant's rows arrive after it loads.
  useEffect(() => {
    const card = cardRef.current;
    const trimmed = query.trim();
    // With nothing typed the list is not drawn, so the last results can stay.
    if (!open || !card || !trimmed) return;
    const names = copy(language).sections;
    const collect = () => {
      const found: SearchResult[] = [];
      card.querySelectorAll<HTMLElement>("[data-settings-section] [data-setting-row]").forEach((row) => {
        const key = row.closest<HTMLElement>("[data-settings-section]")?.dataset.settingsSection as SettingsSection | undefined;
        if (!key) return;
        const label = row.dataset.settingLabel ?? "";
        const group = row.closest<HTMLElement>("[data-settings-group-title]")?.dataset.settingsGroupTitle ?? "";
        if (matchesSearch(trimmed, label, row.dataset.settingHint, group, names[key].name)) {
          found.push({ id: row.dataset.settingId ?? "", section: key, label, group });
        }
      });
      setResults(found);
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(card, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, query, language]);

  // Bring the picked row (or group) into view and light it, once it exists.
  useEffect(() => {
    const card = cardRef.current;
    if (!open || !jumpTo || !card) return;
    const target = () => card.querySelector<HTMLElement>(`[data-setting-id="${jumpTo}"], [data-settings-group="${jumpTo}"]`);
    let frame = 0;
    const land = (node: HTMLElement) => {
      setJumpTo(null);
      node.scrollIntoView({ block: node.matches("[data-settings-group]") ? "start" : "center", behavior: "smooth" });
      node.classList.add(...FLASH_CLASSES);
      // Its own timer, not this effect's cleanup: clearing jumpTo re-runs the
      // effect, and a cleanup that cancelled this left the row lit for good.
      window.setTimeout(() => node.classList.remove(...FLASH_CLASSES), 1600);
    };
    // A frame later, so the section it is in has been shown; an address that
    // points into the restaurant waits for it to load (at most 8 seconds).
    const observer = new MutationObserver(() => {
      const node = target();
      if (node) {
        observer.disconnect();
        land(node);
      }
    });
    frame = requestAnimationFrame(() => {
      const node = target();
      if (node) land(node);
      else observer.observe(card, { childList: true, subtree: true });
    });
    const stop = window.setTimeout(() => {
      observer.disconnect();
      setJumpTo(null);
    }, 8000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [open, jumpTo, section, mobileOpen]);

  if (!open || typeof document === "undefined") return null;

  const activeSection: SettingsSection = sections.includes(section) ? section : "account";
  const SectionIcon = SECTION_ICONS[activeSection];
  const trimmedQuery = query.trim();

  const openResult = (result: SearchResult) => {
    setSection(result.section);
    setMobileOpen(true);
    setQuery("");
    setJumpTo(result.id);
  };

  const searchBox = (
    <div role="search" className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) openResult(results[0]);
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            e.preventDefault();
            setQuery("");
          }
        }}
        placeholder={t.search}
        aria-label={t.search}
        className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2.5 text-[16px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/15 sm:text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 [&::-webkit-search-cancel-button]:hidden"
      />
    </div>
  );

  // What the search found, each with where it lives. Enter opens the first.
  const searchResults = (
    <div className="flex flex-col gap-0.5">
      {results.length === 0 ? (
        <p className="px-2.5 py-3 text-[12px] leading-5 text-gray-500 dark:text-gray-400">{t.searchEmpty(trimmedQuery)}</p>
      ) : (
        results.map((result) => {
          const Icon = SECTION_ICONS[result.section];
          return (
            <button
              key={result.id}
              type="button"
              onClick={() => openResult(result)}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-[18px] text-gray-800 dark:text-gray-100">{result.label}</span>
                <span className="block text-[11.5px] leading-4 text-gray-500 dark:text-gray-400">
                  {[t.sections[result.section].name, result.group].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  const sectionNav = sections.map((key) => {
    const Icon = SECTION_ICONS[key];
    const active = key === activeSection;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setSection(key)}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
          active
            ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
            : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" /> {t.sections[key].name}
      </button>
    );
  });

  // Portalled to <body> so no page's stacking context can hold it under a bar.
  return createPortal(
    <div
      className={`${closing ? "ai-settings-out" : "ai-settings-in"} fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-0 sm:p-4`}
      onClick={requestClose}
    >
      <div aria-hidden="true" className="ai-settings-backdrop absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        ref={cardRef}
        className="ai-settings-card relative flex h-full w-full overflow-hidden bg-white shadow-xl dark:bg-gray-950 sm:h-[560px] sm:max-h-[85vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Desktop sidebar */}
        <aside className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-gray-200 bg-gray-50 p-3 pt-4 dark:border-gray-800 dark:bg-gray-900/50 sm:flex">
          <div className="mb-2">{searchBox}</div>
          {trimmedQuery ? searchResults : sectionNav}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone: the section list, until a section is opened */}
          {!mobileOpen && (
            <div className="flex min-h-0 flex-1 flex-col sm:hidden">
              <header className="flex items-center justify-end border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-800">
                <button onClick={requestClose} aria-label={t.close} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
                <div className="mb-3">{searchBox}</div>
                {trimmedQuery ? (
                  <div className="overflow-hidden rounded-[14px] border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">{searchResults}</div>
                ) : (
                  <div className="flex flex-col overflow-hidden rounded-[14px] border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    {sections.map((key) => {
                      const Icon = SECTION_ICONS[key];
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setSection(key);
                            setMobileOpen(true);
                          }}
                          className="flex min-h-16 items-center gap-3.5 border-t border-gray-100 px-4 py-3 text-left first:border-t-0 active:bg-gray-50 dark:border-gray-800 dark:active:bg-gray-800"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium leading-5 text-gray-800 dark:text-gray-100">{t.sections[key].name}</span>
                            <span className="mt-0.5 block text-[12px] leading-4 text-gray-500 dark:text-gray-400">{t.sections[key].blurb}</span>
                          </span>
                          <ChevronRight className="h-[18px] w-[18px] shrink-0 text-gray-300 dark:text-gray-600" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* The section itself: always on desktop, after a tap on a phone.
              Kept mounted (hidden) while the phone shows the list, so the
              search can read every row. */}
          <div className={`${mobileOpen ? "flex" : "hidden"} relative min-h-0 flex-1 flex-col sm:flex`}>
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-800 sm:absolute sm:inset-x-0 sm:top-0 sm:z-10 sm:h-14 sm:justify-end sm:border-0 sm:bg-white sm:px-4 sm:py-0 sm:dark:bg-gray-950 sm:after:pointer-events-none sm:after:absolute sm:after:inset-x-0 sm:after:top-full sm:after:h-5 sm:after:bg-gradient-to-b sm:after:from-white sm:after:to-transparent sm:after:content-[''] sm:dark:after:from-gray-950">
              <div className="flex min-w-0 items-center gap-2 sm:hidden">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={`${t.back} · ${t.sections[activeSection].name}`}
                  className="-ml-1 flex items-center gap-1.5 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <ChevronLeft className="h-5 w-5" />
                  <SectionIcon className="h-4 w-4 text-orange-500" />
                </button>
              </div>
              <button onClick={requestClose} aria-label={t.close} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-4 sm:mt-14 sm:px-6 sm:pt-3">
              {sections.map((key) => (
                <div key={key} data-settings-section={key} hidden={key !== activeSection} className="flex flex-col gap-5 [&[hidden]]:hidden">
                  {key === "account" ? <AccountSettings /> : key === "display" ? <DisplaySettings /> : <RestaurantSettings />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
