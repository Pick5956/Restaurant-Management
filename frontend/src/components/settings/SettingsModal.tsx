"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Search, Store, User, X, type LucideIcon } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { listenForSettings, type OpenSettingsDetail, type SettingsSection } from "@/src/lib/settingsModal";
import { FLASH_CLASSES, matchesSearch } from "@/src/components/shared/settingsModalKit";
import { useIsMobile } from "@/src/app/(dashboard)/r/[slug]/inventory/mobile/primitives";
import AccountSettings from "./AccountSettings";
import DisplaySettings from "./DisplaySettings";
import RestaurantSettings from "./RestaurantSettings";
import SettingsPhoneSheet from "./SettingsPhoneSheet";

// The app's settings in one floating window, opened from the account menu
// (27 ก.ย. 2569). The owner asked for the settings page to become the window
// Dishy AI's settings already are (AISettingsModal), so this is that window:
// the same card, sidebar with a search, section list and close band. The
// sections are the old pages' - account, language and display, restaurant -
// each saving a setting the moment it changes, as they did on the page.
//
// A phone (under 768px) gets the window full screen with the phone settings
// the owner chose on 26 ก.ย. inside it (SettingsPhoneSheet): he asked for
// those cards back rather than Dishy AI's rows (27 ก.ย. 2569).

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = { account: User, display: Globe, restaurant: Store };

function copy(language: "th" | "en") {
  return language === "th"
    ? {
        settings: "ตั้งค่า",
        close: "ปิด",
        search: "ค้นหาการตั้งค่า",
        searchEmpty: (q: string) => `ไม่พบการตั้งค่าที่ตรงกับ “${q}”`,
        sections: {
          account: { name: "บัญชี" },
          display: { name: "ภาษาและการแสดงผล" },
          restaurant: { name: "ร้านอาหาร" },
        },
      }
    : {
        settings: "Settings",
        close: "Close",
        search: "Search settings",
        searchEmpty: (q: string) => `No settings match “${q}”`,
        sections: {
          account: { name: "Account" },
          display: { name: "Language and display" },
          restaurant: { name: "Restaurant" },
        },
      };
}

type SearchResult = { id: string; section: SettingsSection; label: string; group: string };

export default function SettingsModal() {
  const { language } = useLanguage();
  const { activeMembership } = useAuth();
  const isMobile = useIsMobile();
  const t = copy(language);
  const canManageRestaurant = can(activeMembership, "manage_restaurant_settings");
  const sections: SettingsSection[] = canManageRestaurant
    ? ["account", "display", "restaurant"]
    : ["account", "display"];

  const [open, setOpen] = useState(false);
  // Leaving plays the exit first, then unmounts - the AI settings' timing.
  const [closing, setClosing] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");
  // What the window was last opened for; the phone view starts at its card.
  const [request, setRequest] = useState<OpenSettingsDetail>({});
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
      setRequest(detail);
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
  }, [open, jumpTo, section]);

  if (!open || typeof document === "undefined") return null;

  const activeSection: SettingsSection = sections.includes(section) ? section : "account";
  const trimmedQuery = query.trim();

  const openResult = (result: SearchResult) => {
    setSection(result.section);
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

  if (isMobile) {
    return createPortal(
      <div className={`${closing ? "ai-settings-out" : "ai-settings-in"} fixed inset-0 z-[var(--z-modal)]`}>
        <SettingsPhoneSheet request={request} canManageRestaurant={canManageRestaurant} onClose={requestClose} rootRef={cardRef} />
      </div>,
      document.body,
    );
  }

  // Portalled to <body> so no page's stacking context can hold it under a bar.
  return createPortal(
    <div
      className={`${closing ? "ai-settings-out" : "ai-settings-in"} fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4`}
      onClick={requestClose}
    >
      <div aria-hidden="true" className="ai-settings-backdrop absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        ref={cardRef}
        className="ai-settings-card relative flex h-[560px] max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-950"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-gray-200 bg-gray-50 p-3 pt-4 dark:border-gray-800 dark:bg-gray-900/50">
          <div className="mb-2">{searchBox}</div>
          {trimmedQuery ? searchResults : sectionNav}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* The section. A band across the top holds the close control, as in
              Claude's settings: the section scrolls up under it and fades out
              at its lower edge. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-end bg-white px-4 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-5 after:bg-gradient-to-b after:from-white after:to-transparent after:content-[''] dark:bg-gray-950 dark:after:from-gray-950">
              <button onClick={requestClose} aria-label={t.close} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="mt-14 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-3">
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
