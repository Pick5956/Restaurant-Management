"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { restaurantRepository } from "../repositories/restaurantRepository";
import type { Membership } from "@/src/types/restaurant";
import { WorkspaceShell, getRestaurantTypeLabel, formatUserName, useWorkspaceUser } from "./restaurantWorkspaceUi";
import { RestaurantCardSkeleton } from "@/src/components/shared/Skeleton";
import { getDefaultWorkspaceRoute } from "@/src/lib/workMode";
import { roleLabel } from "@/src/lib/roleLabels";
import { safeNextPathFromSearch } from "@/src/lib/safeRedirect";
import { rebaseRestaurantPath, restaurantHref } from "@/src/lib/restaurantPath";
import { Plus, LogIn, Clock, Grid, ChevronRight, Phone } from "lucide-react";
import AppWordmark from "@/src/components/shared/AppWordmark";

export function getRestaurantCoverPath(type: string | undefined) {
  const normalized = type?.trim().toLowerCase() || "";
  if (normalized.includes("คาเฟ่") || normalized.includes("cafe")) {
    return "/cafe_cover.png";
  }
  if (
    normalized.includes("ชาบู") ||
    normalized.includes("ปิ้งย่าง") ||
    normalized.includes("shabu") ||
    normalized.includes("grill")
  ) {
    return "/grill_cover.png";
  }
  return "/restaurant_cover.png";
}

function RestaurantCard({
  membership,
  onEnter,
}: {
  membership: Membership;
  onEnter: () => void;
}) {
  const { language } = useLanguage();
  const restaurant = membership.restaurant;
  const displayRoleName = roleLabel(membership.role, language);
  const restaurantName = restaurant?.name ?? (language === "th" ? "ร้านอาหาร" : "Restaurant");
  const branchName = restaurant?.branch_name?.trim() || (language === "th" ? "สาขาหลัก" : "Main branch");
  const restaurantType = getRestaurantTypeLabel(restaurant?.restaurant_type?.trim() || "ร้านอาหาร", language);
  const coverPath = restaurant?.cover_image?.trim() || getRestaurantCoverPath(restaurant?.restaurant_type);
  const hours = restaurant?.open_time && restaurant?.close_time
    ? `${restaurant.open_time} - ${restaurant.close_time}`
    : language === "th" ? "ยังไม่ระบุเวลา" : "Hours not set";

  return (
    <button
      type="button"
      onClick={onEnter}
      className="group relative flex min-h-[282px] flex-1 flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-left transition-[border-color,translate] duration-200 ease-out hover:-translate-y-0.5 hover:border-orange-500 focus-visible:outline-none dark:border-gray-800 dark:bg-gray-950 dark:hover:border-orange-500"
    >
      {/* Cover Image banner */}
      <div className="relative h-32 w-full overflow-hidden bg-gray-100 dark:bg-gray-900">
        <Image
          src={coverPath}
          alt=""
          fill
          unoptimized
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.025] motion-reduce:transition-none"
        />
      </div>

      {/* Logo overlapping the cover */}
      <div className="absolute left-4 top-22 z-10 flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border-2 border-white bg-white shadow-sm dark:border-gray-950 dark:bg-gray-950">
        {restaurant?.logo ? (
          <Image
            src={restaurant.logo}
            alt={`${language === "th" ? "โลโก้ร้าน" : "Restaurant logo"} ${restaurantName}`}
            width={44}
            height={44}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
              <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
              <path d="M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3M21 15v7" />
            </svg>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="w-full pt-8 px-4 pb-4 flex flex-col justify-between flex-1">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="truncate text-base font-semibold text-gray-900 dark:text-white group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
              {restaurantName}
            </h3>
            <span className="shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {displayRoleName}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
            {branchName} · {restaurantType}
          </p>

          <div className="mt-4 space-y-2 text-xs text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-800/60 pt-3">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-gray-500 shrink-0" />
              <span className="font-mono">{hours}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Grid className="h-4 w-4 text-gray-500 shrink-0" />
              <span>
                {restaurant?.table_count ? (
                  language === "th" ? (
                    <><span className="font-mono">{restaurant.table_count}</span> โต๊ะ</>
                  ) : (
                    <><span className="font-mono">{restaurant.table_count}</span> tables</>
                  )
                ) : (
                  language === "th" ? "ยังไม่ระบุจำนวนโต๊ะ" : "Tables not set"
                )}
              </span>
            </div>
            {restaurant?.phone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-4 w-4 text-gray-500 shrink-0" />
                <span className="font-mono">{restaurant.phone}</span>
              </div>
            )}
          </div>
        </div>

        <div className="-mx-4 -mb-4 mt-4 flex items-center justify-between bg-gray-950 px-4 py-3 text-xs font-semibold text-white transition-colors group-hover:bg-orange-600 dark:bg-black dark:group-hover:bg-orange-500">
          <span>
            {language === "th" ? "เปิดร้านนี้ใน Dishy" : "Open in Dishy"}
          </span>
          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  );
}

function EmptyRestaurantsState() {
  const { language } = useLanguage();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-md bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 7h18M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
            <path d="M9 12h6M9 16h4" />
          </svg>
        </div>
        <h3 className="mt-4 text-[18px] font-semibold text-gray-900 dark:text-white">
          {language === "th" ? "ยินดีต้อนรับสู่ Dishy" : "Welcome to Dishy"}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-[13px] text-gray-500 dark:text-gray-400">
          {language === "th"
            ? "เลือกช่องทางเริ่มต้นใช้งานระบบจัดการร้านอาหารเพื่อดำเนินการต่อ"
            : "Choose how you would like to get started with the restaurant management system."}
        </p>
        <p className="mt-4 text-xs text-gray-500">
          {language === "th" ? (
            <>ต้องการความช่วยเหลือ? <Link href="/docs" className="text-orange-600 hover:underline font-medium">ดูคู่มือการใช้งาน</Link></>
          ) : (
            <>Need help? <Link href="/docs" className="text-orange-600 hover:underline font-medium">Read the user guide</Link></>
          )}
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/restaurants/new"
          className="group block rounded-md border border-gray-200 bg-white p-5 transition-all hover:border-orange-500 hover:ring-2 hover:ring-orange-500/15 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-orange-500"
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-orange-50 text-orange-600 transition-colors group-hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:group-hover:bg-orange-900/35">
            <Plus className="h-5 w-5" />
          </div>
          <h4 className="mt-4 text-base font-semibold text-gray-900 transition-colors group-hover:text-orange-600 dark:text-white dark:group-hover:text-orange-400">
            {language === "th" ? "สร้างร้านอาหารใหม่" : "Create New Restaurant"}
          </h4>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {language === "th"
              ? "สำหรับเจ้าของร้านหรือผู้บริหารที่ต้องการเปิดร้านอาหารหรือเพิ่มสาขาใหม่"
              : "For owners or managers who want to start a new restaurant or open a branch."}
          </p>
        </Link>

        <Link
          href="/restaurants/join"
          className="group block rounded-md border border-gray-200 bg-white p-5 transition-all hover:border-emerald-500 hover:ring-2 hover:ring-emerald-500/15 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-emerald-500"
        >
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 transition-colors group-hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:group-hover:bg-emerald-900/35">
            <LogIn className="h-5 w-5" />
          </div>
          <h4 className="mt-4 text-base font-semibold text-gray-900 transition-colors group-hover:text-emerald-600 dark:text-white dark:group-hover:text-emerald-400">
            {language === "th" ? "เข้าร่วมร้านอาหาร" : "Join Existing Restaurant"}
          </h4>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {language === "th"
              ? "สำหรับพนักงานเสิร์ฟ กุ๊ก หรือแคชเชียร์ ที่มีลิงก์หรือรหัสเชิญจากเจ้าของร้าน"
              : "For waiters, chefs, or cashiers who have an invitation link or token from the owner."}
          </p>
        </Link>
      </div>
    </div>
  );
}

export default function RestaurantsPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const { memberships, loading, setActiveRestaurant, refreshMemberships } = useAuth();

  const user = useWorkspaceUser();
  const userName = formatUserName(user, language);
  const hasRestaurants = memberships.length > 0;

  useEffect(() => {
    refreshMemberships();
  }, [refreshMemberships]);



  const enterDashboardFor = (membership: Membership) => {
    // The id stands in for a slug only if the membership arrived without one;
    // /r/<id> resolves to the same restaurant and the guard swaps in the name.
    const slug = membership.restaurant?.slug || String(membership.restaurant_id);
    restaurantRepository.setActiveId(membership.restaurant_id, membership.restaurant?.slug);
    setActiveRestaurant(membership.restaurant_id);
    // A page they were sent here from - an old /home link, or another
    // restaurant's /r/<slug>/orders - opens on the restaurant just chosen.
    const next = rebaseRestaurantPath(safeNextPathFromSearch(window.location.search), slug);
    router.push(next ?? restaurantHref(slug, getDefaultWorkspaceRoute(membership)));
  };

  if (!loading && !hasRestaurants) {
    return (
      <WorkspaceShell hideIntro={true} maxWidthClass="max-w-5xl">
        <div className="flex flex-col items-center justify-center pt-10 pb-16">
          <EmptyRestaurantsState />
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell hideIntro={true} maxWidthClass="max-w-[1400px]">
      <div className="mb-7 flex flex-col gap-5 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-gray-800">
        <div>
          <AppWordmark height={13} className="text-orange-600 dark:text-orange-400" />
          <h1 className="mt-2 text-2xl font-bold tracking-[-0.025em] text-gray-950 dark:text-white sm:text-3xl">
            {language === "th" ? "เลือกร้านเพื่อเริ่มงาน" : "Choose a restaurant to start"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
            {language === "th"
              ? `ยินดีต้อนรับคุณ ${userName} เลือกสาขาที่ต้องการดูแลในรอบนี้`
              : `Welcome, ${userName}. Select the location you want to manage this shift.`}
          </p>
        </div>

        {/* Header Action Buttons */}
        <div className="flex flex-row items-center gap-2.5 shrink-0 w-full sm:w-auto">
          <Link
            href="/restaurants/new"
            className="flex-1 sm:flex-none inline-flex h-9 sm:h-10 items-center justify-center gap-1.5 sm:gap-2 rounded-md bg-orange-700 dark:bg-orange-700 text-white dark:text-white px-3 sm:px-4 text-xs sm:text-sm font-semibold transition-all duration-200 hover:bg-gray-850 dark:hover:bg-orange-800 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            <span>{language === "th" ? "สร้างร้านใหม่" : "Create Restaurant"}</span>
          </Link>
          <Link
            href="/restaurants/join"
            className="flex-1 sm:flex-none inline-flex h-9 sm:h-10 items-center justify-center gap-1.5 sm:gap-2 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 px-3 sm:px-4 text-xs sm:text-sm font-semibold transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-900 hover:scale-[1.02] active:scale-[0.98]"
          >
            <LogIn className="h-4 w-4" />
            <span>{language === "th" ? "เข้าร่วมร้าน" : "Join Restaurant"}</span>
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <span>{language === "th" ? "ร้านของคุณ" : "Your restaurants"}</span>
            <span className="rounded-md bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">{memberships.length}</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {loading ? (
            <>
              <RestaurantCardSkeleton />
              <RestaurantCardSkeleton />
              <RestaurantCardSkeleton />
              <RestaurantCardSkeleton />
            </>
          ) : (
            <>
              {memberships.map((membership) => (
                <RestaurantCard
                  key={membership.ID}
                  membership={membership}
                  onEnter={() => enterDashboardFor(membership)}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Help Link Footnote */}
      <div className="mt-12 text-center text-xs text-gray-500">
        {language === "th" ? (
          <>พบปัญหาการใช้งานหรือต้องการเรียนรู้เพิ่มเติม? <Link href="/docs" className="text-orange-600 hover:underline font-medium">ดูคู่มือการใช้งาน</Link></>
        ) : (
          <>Having trouble or want to learn more? <Link href="/docs" className="text-orange-600 hover:underline font-medium">Read the user guide</Link></>
        )}
      </div>
    </WorkspaceShell>
  );
}
