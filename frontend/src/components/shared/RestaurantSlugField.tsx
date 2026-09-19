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
  // The settings pages draw every field as a flat tinted box with no edge; the
  // setting row's own title names the field, so the caption is for screen
  // readers only.
  settings: {
    label: "block min-w-0",
    caption: "sr-only",
    height: "h-12",
    radius: "rounded",
    surface: "bg-(--settings-field)",
    border: "border-transparent",
    errorBorder: "border-transparent shadow-[inset_0_0_0_2px_var(--color-red-700)] dark:shadow-[inset_0_0_0_2px_var(--color-red-400)]",
    focus: "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-700 dark:focus-within:outline-orange-400",
    disabled: "opacity-50",
    text: "text-[16px]",
    message: "mt-1.5 text-[12px] leading-5 text-red-700 dark:text-red-400",
  },
  onboarding: {
    label: "block space-y-2",
    caption: "text-sm font-medium text-gray-800 dark:text-gray-200",
    height: "h-[42px]",
    radius: "rounded-md",
    surface: "bg-white dark:bg-gray-900",
    border: "border-gray-300 dark:border-gray-700",
    errorBorder: "border-red-300 dark:border-red-900/60",
    focus: "focus-within:border-orange-500",
    disabled: "opacity-60",
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
        className={`flex w-full min-w-0 items-center ${styles.radius} border transition-colors ${styles.surface} ${styles.height} ${
          message
            ? `${styles.errorBorder} ${variant === "onboarding" ? "focus-within:border-red-500" : styles.focus}`
            : `${styles.border} ${styles.focus}`
        } ${disabled ? styles.disabled : ""}`}
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
