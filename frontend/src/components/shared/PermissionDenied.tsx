"use client";

import Link from "next/link";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";

export default function PermissionDenied({ title }: { title?: string }) {
  const { language } = useLanguage();
  const { href: restaurantPageHref } = useRestaurantNav();
  const fallbackTitle = language === "th" ? "ไม่มีสิทธิ์เข้าถึงหน้านี้" : "You do not have access to this page";

  return (
    <div className="min-h-dvh bg-white px-4 py-6 text-gray-900 dark:bg-gray-950 dark:text-gray-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-md border border-gray-200 bg-white p-5 text-center dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold text-gray-950 dark:text-white">{title ?? fallbackTitle}</h1>
        <p className="mt-2 text-[13px] text-gray-500 dark:text-gray-400">
          {language === "th"
            ? "บัญชีนี้ไม่มี permission สำหรับหน้านี้ในร้านปัจจุบัน"
            : "This account does not have permission to open this page in the current restaurant."}
        </p>
        <Link href={restaurantPageHref("/home")} className="mt-4 inline-flex h-9 items-center rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white hover:bg-orange-800 dark:bg-orange-700 dark:text-white">
          {language === "th" ? "กลับหน้าภาพรวม" : "Back to overview"}
        </Link>
      </div>
    </div>
  );
}
