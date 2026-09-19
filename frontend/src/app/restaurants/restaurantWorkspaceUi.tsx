"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/src/providers/AuthProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import { useLanguage, type Language } from "@/src/providers/LanguageProvider";
import { getCurrentUser } from "@/src/lib/auth";
import AppLogo from "@/src/components/shared/AppLogo";
import AppWordmark from "@/src/components/shared/AppWordmark";
import DashboardAccountMenu from "@/src/components/shared/DashboardAccountMenu";
import type { User } from "@/src/types/auth";

export const RESTAURANT_TYPES = ["ร้านอาหาร", "คาเฟ่", "ชาบู/ปิ้งย่าง", "เดลิเวอรี", "ฟู้ดทรัค"];

const RESTAURANT_TYPE_LABELS: Record<string, Record<Language, string>> = {
  "ร้านอาหาร": { th: "ร้านอาหาร", en: "Restaurant" },
  "คาเฟ่": { th: "คาเฟ่", en: "Cafe" },
  "ชาบู/ปิ้งย่าง": { th: "ชาบู/ปิ้งย่าง", en: "Shabu / Grill" },
  "เดลิเวอรี": { th: "เดลิเวอรี", en: "Delivery" },
  "ฟู้ดทรัค": { th: "ฟู้ดทรัค", en: "Food truck" },
};

export function getRestaurantTypeLabel(type: string, language: Language) {
  return RESTAURANT_TYPE_LABELS[type]?.[language] ?? type;
}

export function formatUserName(user: User | null, language: Language = "th") {
  if (!user) return language === "th" ? "ผู้ใช้" : "User";
  if (user.nickname?.trim()) return user.nickname.trim();

  const parts = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part) => part && part !== "-");

  return parts.length ? parts.join(" ") : user.email;
}

export function useWorkspaceUser() {
  const { user } = useAuth();
  const [profileUser, setProfileUser] = useState<User | null>(null);

  useEffect(() => {
    if (user) return;
    getCurrentUser().then((res) => {
      if (res?.data) setProfileUser(res.data);
    });
  }, [user]);

  return user ?? profileUser;
}

export function ThemeButton() {
  const { theme, mounted, toggle } = useTheme();
  const { language } = useLanguage();
  const isDark = mounted && theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={language === "th" ? "สลับธีม" : "Toggle theme"}
      title={
        isDark
          ? language === "th"
            ? "สลับเป็น Light mode"
            : "Switch to light mode"
          : language === "th"
            ? "สลับเป็น Dark mode"
            : "Switch to dark mode"
      }
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900 dark:hover:text-white"
    >
      {isDark ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  );
}

export function BrandMark() {
  return (
    <Link href="/restaurants" className="flex items-center gap-2.5">
      <AppLogo decorative size={36} />
      <div className="leading-none">
        <AppWordmark height={18} className="text-gray-950 dark:text-white" />
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-400">Restaurant operations</p>
      </div>
    </Link>
  );
}

export function WorkspaceShell({
  title = "",
  description = "",
  children,
  hideIntro = false,
  maxWidthClass = "max-w-6xl",
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  hideIntro?: boolean;
  maxWidthClass?: string;
}) {
  const { language } = useLanguage();

  return (
    <div className="min-h-dvh bg-slate-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="fixed inset-x-0 top-0 z-[var(--z-sticky)] border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <BrandMark />
          <div className="flex items-center gap-1.5">
            <DashboardAccountMenu />
          </div>
        </div>
      </header>

      <main className={`mx-auto w-full px-4 pb-6 pt-[calc(4rem+1.5rem)] sm:px-6 lg:px-8 lg:pb-8 lg:pt-[calc(4rem+2rem)] ${maxWidthClass}`}>
        {!hideIntro ? (
          <div>
            <p className="text-xs font-semibold text-orange-600 dark:text-orange-400">
              {language === "th" ? "พื้นที่จัดการร้าน" : "Restaurant workspace"}
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white sm:text-3xl">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">{description}</p>
          </div>
        ) : null}

        {children}
      </main>
    </div>
  );
}

export function BackToRestaurants() {
  const { language } = useLanguage();

  return (
    <Link
      href="/restaurants"
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      {language === "th" ? "กลับไปเลือกร้าน" : "Back to restaurants"}
    </Link>
  );
}
