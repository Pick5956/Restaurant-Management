"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Check, Loader2 } from "lucide-react";
import { checkRestaurantSlug } from "@/src/lib/restaurant";
import {
  isValidRestaurantSlug,
  RESTAURANT_PATH_PREFIX,
  sanitizeRestaurantSlugInput,
} from "@/src/lib/restaurantPath";
import { useLanguage } from "@/src/providers/LanguageProvider";

export type RestaurantSlugStatus = "idle" | "checking" | "available" | "taken" | "invalid" | "unknown";

// Long enough that a word is finished before it is checked, short enough that
// "taken" appears before the owner looks away from the field.
const CHECK_DELAY_MS = 350;

/**
 * Where a slug stands while it is being typed. "idle" when there is nothing to
 * check - empty, or unchanged from the saved slug. "unknown" when the check
 * itself failed: the form still submits, and the server has the final word.
 */
export function useRestaurantSlugStatus(
  slug: string,
  { restaurantId, savedSlug }: { restaurantId?: number | null; savedSlug?: string | null } = {},
): RestaurantSlugStatus {
  const [checked, setChecked] = useState<{ slug: string; status: RestaurantSlugStatus } | null>(null);
  // Empty is only "nothing to check" where a slug is optional - a new
  // restaurant, which the server names itself. Clearing a saved slug is invalid.
  const local: RestaurantSlugStatus | null = slug === savedSlug || (slug === "" && !savedSlug)
    ? "idle"
    : isValidRestaurantSlug(slug)
      ? null
      : "invalid";

  useEffect(() => {
    if (local !== null) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await checkRestaurantSlug(slug, restaurantId ?? undefined);
        if (cancelled) return;
        const { available, reason } = response.data;
        setChecked({ slug, status: available ? "available" : reason === "taken" ? "taken" : "invalid" });
      } catch {
        if (!cancelled) setChecked({ slug, status: "unknown" });
      }
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [local, restaurantId, slug]);

  if (local !== null) return local;
  return checked?.slug === slug ? checked.status : "checking";
}

const noSubscription = () => () => {};

/** The host the URL will actually be on - dishy.pro in production, localhost in
 *  development - without a hydration mismatch on the server render. */
function useSiteHost() {
  return useSyncExternalStore(noSubscription, () => window.location.host, () => "dishy.pro");
}

const variants = {
  settings: {
    label: "block min-w-0",
    caption: "mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300",
    height: "h-11 sm:h-10",
    border: "border-gray-200 dark:border-gray-700",
    text: "text-[14px] sm:text-[13px]",
    message: "mt-1 text-[11px] leading-5 text-red-600 dark:text-red-300",
  },
  onboarding: {
    label: "block space-y-2",
    caption: "text-sm font-medium text-gray-800 dark:text-gray-200",
    height: "h-[42px]",
    border: "border-gray-300 dark:border-gray-700",
    text: "text-sm",
    message: "text-xs font-medium text-red-600 dark:text-red-300",
  },
} as const;

export default function RestaurantSlugField({
  label,
  value,
  onChange,
  status,
  error,
  placeholder,
  variant = "settings",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  status: RestaurantSlugStatus;
  /** A submit-time error; wins over the live status. */
  error?: string;
  placeholder?: string;
  variant?: keyof typeof variants;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const host = useSiteHost();
  const messageId = useId();
  const styles = variants[variant];

  const message = error || (status === "taken"
    ? language === "th" ? "มีร้านใช้ชื่อนี้แล้ว" : "Another restaurant already uses this name"
    : status === "invalid"
      ? language === "th"
        ? "ใช้ a–z, 0–9 และ - ได้ 3–40 ตัว และต้องมีตัวอักษร"
        : "Use 3–40 of a–z, 0–9 and -, including a letter"
      : "");

  return (
    <label className={styles.label}>
      <span className={styles.caption}>{label}</span>
      <span
        className={`flex w-full min-w-0 items-center rounded-md border bg-white transition-colors dark:bg-gray-900 ${styles.height} ${
          message ? "border-red-300 focus-within:border-red-500 dark:border-red-900/60" : `${styles.border} focus-within:border-orange-500`
        } ${disabled ? "opacity-60" : ""}`}
      >
        <span className={`shrink-0 select-none pl-3 text-gray-500 dark:text-gray-400 ${styles.text}`}>
          {host}
          {RESTAURANT_PATH_PREFIX}/
        </span>
        <input
          value={value}
          onChange={(event) => onChange(sanitizeRestaurantSlugInput(event.target.value))}
          placeholder={placeholder}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
          aria-invalid={message ? "true" : undefined}
          aria-describedby={message ? messageId : undefined}
          className={`h-full min-w-0 flex-1 bg-transparent pr-1 text-gray-900 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed dark:text-white dark:placeholder:text-gray-500 ${styles.text}`}
        />
        <span className="flex w-9 shrink-0 items-center justify-center" aria-hidden="true">
          {status === "checking" ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : null}
          {status === "available" && !error ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : null}
        </span>
      </span>
      {message ? (
        <p id={messageId} role="alert" className={styles.message}>
          {message}
        </p>
      ) : null}
    </label>
  );
}
