"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark, ThemeButton, useWorkspaceUser, formatUserName } from "../../restaurants/restaurantWorkspaceUi";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { acceptInvitation, getInvitationByToken, invitationEmailMismatch } from "@/src/lib/invitation";
import { restaurantRepository } from "../../repositories/restaurantRepository";
import { restaurantHref } from "@/src/lib/restaurantPath";
import type { Invitation } from "@/src/types/restaurant";
import { Skeleton, SkeletonText } from "@/src/components/shared/Skeleton";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { roleLabel } from "@/src/lib/roleLabels";

function formatExpiry(value: string | undefined | null, language: "th" | "en") {
  if (!value) return language === "th" ? "ไม่กำหนด" : "No expiry";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return language === "th" ? "ไม่กำหนด" : "No expiry";
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function invitationStateLabel(invitation: Invitation | null, usable: boolean, language: "th" | "en") {
  if (!invitation) return language === "th" ? "กำลังตรวจสอบ" : "Checking";
  if (usable) return language === "th" ? "พร้อมรับคำเชิญ" : "Ready to accept";
  if (invitation.status === "accepted") return language === "th" ? "ถูกใช้งานแล้ว" : "Already accepted";
  if (invitation.status === "revoked") return language === "th" ? "ถูกยกเลิกแล้ว" : "Revoked";
  if (invitation.status === "expired") return language === "th" ? "หมดอายุแล้ว" : "Expired";
  return language === "th" ? "ไม่สามารถใช้งานได้" : "Unavailable";
}

export default function InvitationAcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { logout, openLoginModal, refreshMemberships } = useAuth();
  const { language } = useLanguage();
  const user = useWorkspaceUser();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [usable, setUsable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const acceptOnceRef = useRef(createSingleFlight());

  const copy = language === "th"
    ? {
        logout: "ออกจากระบบ",
        login: "เข้าสู่ระบบ",
        eyebrow: "Restaurant invitation",
        title: "คำเชิญเข้าร่วมร้าน",
        subtitle: "ตรวจสอบรายละเอียดก่อนรับคำเชิญเข้าทีม",
        restaurantFallback: "ร้านอาหาร",
        addressFallback: "ยังไม่ระบุที่อยู่",
        roleLabel: "บทบาท",
        expiryLabel: "หมดอายุ",
        emailLabel: "อีเมลที่รับได้",
        anyEmail: "ทุกบัญชีที่มีลิงก์",
        accountMismatch: "บัญชีนี้ไม่ตรงกับอีเมลในคำเชิญ",
        readyAs: "พร้อมรับคำเชิญในชื่อ",
        loginRequiredTitle: "ต้องเข้าสู่ระบบก่อนรับคำเชิญ",
        loginRequiredBody: "สมัครหรือ login ด้วย Google แล้วกดรับคำเชิญในหน้านี้ได้เลย",
        acceptBusy: "กำลังรับคำเชิญ...",
        acceptButton: "รับคำเชิญและเข้าร่วมร้าน",
        loginToAccept: "เข้าสู่ระบบเพื่อรับคำเชิญ",
        backToRestaurants: "ไปหน้าเลือกร้าน",
        fetchError: "ไม่พบคำเชิญนี้ หรือคำเชิญถูกลบไปแล้ว",
        acceptError: "รับคำเชิญไม่สำเร็จ กรุณาตรวจสอบบัญชีหรือขอคำเชิญใหม่",
      }
    : {
        logout: "Sign out",
        login: "Sign in",
        eyebrow: "Restaurant invitation",
        title: "Join a restaurant",
        subtitle: "Review the details before accepting the invitation.",
        restaurantFallback: "Restaurant",
        addressFallback: "No address provided",
        roleLabel: "Role",
        expiryLabel: "Expires",
        emailLabel: "Allowed email",
        anyEmail: "Any account with this link",
        accountMismatch: "This account does not match the invitation email",
        readyAs: "Ready to accept as",
        loginRequiredTitle: "You need to sign in before accepting",
        loginRequiredBody: "Sign up or continue with Google, then accept the invitation from this page.",
        acceptBusy: "Accepting invitation...",
        acceptButton: "Accept invitation and join",
        loginToAccept: "Sign in to accept",
        backToRestaurants: "Back to restaurants",
        fetchError: "This invitation could not be found or has been removed.",
        acceptError: "Could not accept the invitation. Please verify the account or request a new link.",
      };

  const token = params.token;
  const statusLabel = useMemo(() => invitationStateLabel(invitation, usable, language), [invitation, usable, language]);
  const emailMismatch = invitationEmailMismatch(invitation?.email, user?.email);

  useEffect(() => {
    let active = true;
    const loadTimer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      getInvitationByToken(token)
        .then((res) => {
          if (!active) return;
          setInvitation(res.data.invitation);
          setUsable(res.data.usable);
        })
        .catch(() => {
          if (!active) return;
          setInvitation(null);
          setUsable(false);
          setError(copy.fetchError);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
    };
  }, [copy.fetchError, token]);

  const handleAccept = async () => {
    if (!user) {
      openLoginModal(`/invitations/${token}`);
      return;
    }
    if (!usable || emailMismatch) return;

    await acceptOnceRef.current(async () => {
      setAccepting(true);
      setError("");
      try {
        const res = await acceptInvitation(token);
        const membership = res.data.membership;
        const memberships = await refreshMemberships();
        const joined = memberships.find((item) => item.restaurant_id === membership.restaurant_id);
        const slug = joined?.restaurant?.slug || membership.restaurant?.slug || String(membership.restaurant_id);
        restaurantRepository.setActiveId(membership.restaurant_id, slug);
        router.push(restaurantHref(slug, "/home"));
      } catch {
        setError(copy.acceptError);
      } finally {
        setAccepting(false);
      }
    });
  };

  return (
    <div className="min-h-dvh bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <BrandMark />
          <div className="flex items-center gap-2">
            <ThemeButton />
            {user ? (
              <button
                type="button"
                onClick={logout}
                className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-900"
              >
                {copy.logout}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openLoginModal(`/invitations/${token}`)}
                className="h-9 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-orange-800 dark:bg-orange-700 dark:text-white"
              >
                {copy.login}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600 dark:text-orange-400">{copy.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{copy.title}</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{copy.subtitle}</p>
          </div>

          <div className="space-y-4 p-5">
            {loading ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-full max-w-sm">
                    <Skeleton className="h-5 w-44" />
                    <SkeletonText lines={2} className="mt-3" />
                  </div>
                  <Skeleton className="h-7 w-28" />
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              </div>
            ) : invitation ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-gray-900 dark:text-white">
                      {invitation.restaurant?.name ?? copy.restaurantFallback}
                    </p>
                    <p className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">
                      {invitation.restaurant?.address || copy.addressFallback}
                    </p>
                  </div>
                  <span
                    className={`w-fit rounded-md px-2 py-1 text-[11px] font-medium ${
                      usable
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                    }`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 text-[12px] sm:grid-cols-3">
                  <div>
                    <p className="text-gray-500">{copy.roleLabel}</p>
                    <p className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{roleLabel(invitation.role, language)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{copy.expiryLabel}</p>
                    <p className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{formatExpiry(invitation.expires_at, language)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">{copy.emailLabel}</p>
                    <p className="mt-0.5 truncate font-medium text-gray-800 dark:text-gray-200">{invitation.email || copy.anyEmail}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {user ? (
              <div
                className={`rounded-md border px-3 py-2 ${
                  emailMismatch
                    ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20"
                    : "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-900/15"
                }`}
              >
                <p
                  className={`text-[12px] font-medium ${
                    emailMismatch ? "text-red-800 dark:text-red-300" : "text-emerald-900 dark:text-emerald-200"
                  }`}
                >
                  {emailMismatch ? copy.accountMismatch : `${copy.readyAs} ${formatUserName(user, language)}`}
                </p>
                <p
                  className={`mt-0.5 text-[11px] ${
                    emailMismatch ? "text-red-700/80 dark:text-red-300/80" : "text-emerald-800/80 dark:text-emerald-300/80"
                  }`}
                >
                  {emailMismatch ? `${copy.emailLabel}: ${invitation?.email}` : user.email}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-900/15">
                <p className="text-[12px] font-medium text-amber-900 dark:text-amber-200">{copy.loginRequiredTitle}</p>
                <p className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">{copy.loginRequiredBody}</p>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={loading || !invitation || !usable || emailMismatch || accepting}
                onClick={handleAccept}
                className="h-10 flex-1 rounded-md bg-orange-700 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-700 dark:text-white"
              >
                {accepting ? copy.acceptBusy : user ? copy.acceptButton : copy.loginToAccept}
              </button>
              <Link
                href="/restaurants"
                className="inline-flex h-10 flex-1 items-center justify-center rounded-md border border-gray-200 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {copy.backToRestaurants}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
