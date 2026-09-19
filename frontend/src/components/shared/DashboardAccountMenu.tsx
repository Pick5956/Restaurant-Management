"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Languages, LogOut, Moon, Sparkles, Sun } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import UserAvatar from "@/src/components/shared/UserAvatar";
import { roleLabel } from "@/src/lib/roleLabels";

// useLayoutEffect warns during server rendering, and this only ever runs in the
// browser, so fall back to useEffect on the server.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Panel = "main" | "theme" | "language" | "assistant";


function MenuButton({
  icon,
  label,
  value,
  onClick,
  danger = false,
  chevron = false,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  danger?: boolean;
  chevron?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 w-full items-center gap-3 px-3 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-gray-900 ${
        danger ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-100"
      }`}
    >
      <span className={`grid h-5 w-5 shrink-0 place-items-center ${danger ? "text-red-500 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? <span className="max-w-24 truncate text-[12px] text-gray-500 dark:text-gray-400">{value}</span> : null}
      {chevron ? <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" /> : null}
    </button>
  );
}

function OptionButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 w-full items-center gap-3 px-3 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-gray-900 ${
        active ? "font-semibold text-gray-950 dark:text-white" : "text-gray-700 dark:text-gray-200"
      }`}
    >
      <span className="grid h-5 w-5 place-items-center">{active ? <Check className="h-4 w-4" strokeWidth={2.5} /> : null}</span>
      <span>{label}</span>
    </button>
  );
}

// variant picks the trigger, not the menu. `icon` is the 40px avatar button
// the top bars use; `rail` is the full-width row in the sidebar foot, which
// has room to name the person and their role.
export default function DashboardAccountMenu({
  variant = "icon",
}: {
  variant?: "icon" | "rail";
} = {}) {
  const { user, logout, activeMembership } = useAuth();
  const { href: restaurantPageHref } = useRestaurantNav();
  const { language, setLanguage } = useLanguage();
  const { theme, mounted, toggle, showAIAssistant, setShowAIAssistant } = useTheme();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("main");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const isDark = mounted && theme === "dark";
  const displayName = user ? (user.nickname?.trim() || `${user.first_name} ${user.last_name === "-" ? "" : user.last_name}`.trim()) : language === "th" ? "ผู้ใช้งาน" : "User";
  const roleText = roleLabel(activeMembership?.role, language);

  // The trigger used to live in the top bar, so this opened downward from a
  // right-anchored point. It now sits in the sidebar foot, where rect.bottom is
  // the bottom of the screen: the menu was placed just past it and never seen.
  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menu = menuRef.current;
    const width = menu?.offsetWidth ?? 288;
    const height = menu?.offsetHeight ?? 0;
    const margin = 8;

    // Prefer below; flip above when the trigger is near the bottom edge.
    let top = rect.bottom + margin;
    if (height > 0 && top + height > window.innerHeight - margin) {
      top = rect.top - margin - height;
    }
    if (height > 0) {
      top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    }

    // Align to the trigger's leading edge, then keep the whole panel on screen.
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));

    setMenuPosition({ top, left });
  }, []);

  const copy = language === "th"
    ? {
        account: "บัญชีผู้ใช้",
        profile: "ดูบัญชีของคุณ",
        theme: "ธีม",
        themeValue: isDark ? "มืด" : "สว่าง",
        language: "แสดงภาษา",
        languageValue: "ไทย",
        aiAssistant: "Dishy AI",
        aiAssistantValue: showAIAssistant ? "เปิด" : "ปิด",
        aiAssistantOn: "เปิด",
        aiAssistantOff: "ปิด",
        logout: "ออกจากระบบ",
        back: "กลับ",
        light: "สว่าง",
        dark: "มืด",
      }
    : {
        account: "Account",
        profile: "View your account",
        theme: "Appearance",
        themeValue: isDark ? "Dark" : "Light",
        language: "Display language",
        languageValue: "English",
        aiAssistant: "Dishy AI",
        aiAssistantValue: showAIAssistant ? "On" : "Off",
        aiAssistantOn: "On",
        aiAssistantOff: "Off",
        logout: "Log out",
        back: "Back",
        light: "Light",
        dark: "Dark",
      };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
        setPanel("main");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (!open) return;

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, panel, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setPanel("main");
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  // Choosing an option finishes the interaction, so the menu closes with it.
  // The panel resets too, so the next open starts at the top instead of inside
  // whichever sub-panel was last used. The Back buttons still only setPanel -
  // they are navigation, not a decision.
  const commitChoice = () => {
    setPanel("main");
    setOpen(false);
  };

  const selectLanguage = (next: Language) => {
    setLanguage(next);
    commitChoice();
  };


  const switchTheme = (dark: boolean) => {
    if (dark !== isDark) toggle();
    commitChoice();
  };

  const selectAssistantVisibility = (next: boolean) => {
    setShowAIAssistant(next);
    commitChoice();
  };

  return (
    <div ref={rootRef} className="relative">
      {variant === "rail" ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => { setOpen((current) => !current); setPanel("main"); }}
          aria-label={copy.account}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent p-1.5 text-left transition-colors hover:border-[var(--rail-border)] hover:bg-[var(--rail-hover-bg)]"
        >
          <UserAvatar src={user?.profile_image} name={displayName} size={34} className="h-[34px] w-[34px] shrink-0 text-[13px] text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[12px] font-bold leading-[1.6] text-[var(--rail-fg)]">{displayName}</span>
            {/* Hidden on short viewports, where the nav needs the rows back. */}
            <span className="truncate text-[11px] leading-[1.6] text-[var(--rail-fg-muted)] [@media(max-height:760px)]:hidden">{roleText}</span>
          </span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => { setOpen((current) => !current); setPanel("main"); }}
          aria-label={copy.account}
          aria-expanded={open}
          aria-haspopup="menu"
          className="ui-press inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-900"
        >
          <UserAvatar src={user?.profile_image} name={displayName} size={30} className="h-8 w-8 text-[11px] text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
        </button>
      )}

      {open && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-[calc(var(--z-modal)+1)] w-72 max-w-[calc(100dvw-1rem)] overflow-hidden rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white py-2 shadow-[0_2px_4px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.14)] dark:bg-gray-950 dark:shadow-[0_2px_4px_rgba(0,0,0,0.35),0_16px_40px_rgba(0,0,0,0.55)] ${menuPosition ? "" : "opacity-0"}`}
          style={{ top: menuPosition?.top ?? -9999, left: menuPosition?.left ?? -9999 }}
        >
          {panel === "main" ? (
            <>
              <div className="flex gap-3 px-3 pb-3">
                <UserAvatar src={user?.profile_image} name={displayName} size={36} className="h-9 w-9 text-[12px] text-orange-600 dark:bg-orange-900/30 dark:text-orange-400" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-gray-950 dark:text-white">{displayName}</p>
                  <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">{user?.email ?? ""}</p>
                  <Link href={restaurantPageHref("/settings/account")} onClick={() => setOpen(false)} className="mt-1 inline-flex text-[12px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200">
                    {copy.profile}
                  </Link>
                </div>
              </div>
              <div className="border-t border-[color:var(--dashboard-shell-border)]" />
              <MenuButton icon={isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} label={copy.theme} value={copy.themeValue} chevron onClick={() => setPanel("theme")} />
              <MenuButton icon={<Languages className="h-4 w-4" />} label={copy.language} value={copy.languageValue} chevron onClick={() => setPanel("language")} />
              {activeMembership?.role?.name === "owner" ? (
                <MenuButton icon={<Sparkles className="h-4 w-4" />} label={copy.aiAssistant} value={copy.aiAssistantValue} chevron onClick={() => setPanel("assistant")} />
              ) : null}
              <div className="border-t border-[color:var(--dashboard-shell-border)]" />
              <MenuButton icon={<LogOut className="h-4 w-4" />} label={copy.logout} danger onClick={logout} />
            </>
          ) : null}

          {panel === "theme" ? (
            <>
              <button type="button" onClick={() => setPanel("main")} className="flex h-10 w-full items-center gap-2 px-3 text-left text-[13px] font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-900">
                <ChevronLeft className="h-4 w-4" />
                {copy.theme}
              </button>
              <OptionButton label={copy.light} active={!isDark} onClick={() => switchTheme(false)} />
              <OptionButton label={copy.dark} active={isDark} onClick={() => switchTheme(true)} />
            </>
          ) : null}

          {panel === "language" ? (
            <>
              <button type="button" onClick={() => setPanel("main")} className="flex h-10 w-full items-center gap-2 px-3 text-left text-[13px] font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-900">
                <ChevronLeft className="h-4 w-4" />
                {copy.language}
              </button>
              <OptionButton label="ไทย" active={language === "th"} onClick={() => selectLanguage("th")} />
              <OptionButton label="English" active={language === "en"} onClick={() => selectLanguage("en")} />
            </>
          ) : null}


          {panel === "assistant" && activeMembership?.role?.name === "owner" ? (
            <>
              <button type="button" onClick={() => setPanel("main")} className="flex h-10 w-full items-center gap-2 px-3 text-left text-[13px] font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-900">
                <ChevronLeft className="h-4 w-4" />
                {copy.aiAssistant}
              </button>
              <OptionButton label={copy.aiAssistantOn} active={showAIAssistant} onClick={() => selectAssistantVisibility(true)} />
              <OptionButton label={copy.aiAssistantOff} active={!showAIAssistant} onClick={() => selectAssistantVisibility(false)} />
            </>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
