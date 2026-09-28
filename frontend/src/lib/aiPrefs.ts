"use client";

import { useCallback, useSyncExternalStore } from "react";

// Per-device assistant preferences.
//
// Two things the settings screen changes live in the browser rather than on the
// restaurant row: whether follow-up suggestions appear under answers (a reading
// preference, not shop policy) and a cached copy of what the assistant calls the
// owner, so the greeting is right on first paint instead of after the settings
// request returns. Both are conveniences: the page renders correctly with
// neither stored.

const FOLLOW_UPS_KEY = "aiFollowUpsEnabled";
const OWNER_TITLE_KEY = "aiOwnerTitle";
const CHANGE_EVENT = "ai-prefs-change";

// The server's default too (aiDefaultOwnerTitle); it answers with this when the
// owner has not set one, which is how the screens tell "not set" apart.
export const DEFAULT_OWNER_TITLE_TH = "เจ้าของร้าน";
export const DEFAULT_OWNER_TITLE_EN = "Owner";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the
    // preference then simply does not persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function followUpsEnabled(): boolean {
  return read(FOLLOW_UPS_KEY) !== "off";
}

export function setFollowUpsEnabled(enabled: boolean) {
  write(FOLLOW_UPS_KEY, enabled ? null : "off");
}

/** Whether follow-up suggestions show under answers; re-renders when toggled. */
export function useFollowUpsEnabled(): boolean {
  return useSyncExternalStore(subscribe, followUpsEnabled, () => true);
}

export function cachedOwnerTitle(): string {
  return read(OWNER_TITLE_KEY)?.trim() ?? "";
}

export function cacheOwnerTitle(title: string) {
  const trimmed = title.trim();
  write(OWNER_TITLE_KEY, trimmed === "" ? null : trimmed);
}

/** The cached title, "" when the owner has not set one; re-renders when it changes. */
export function useCachedOwnerTitle(): string {
  return useSyncExternalStore(subscribe, cachedOwnerTitle, () => "");
}

/**
 * The greeting at the top of an empty thread. The title is whatever the owner
 * asked to be called; with none set, the greeting is the one the screen has
 * always shown.
 */
export function welcomeFor(language: "th" | "en", title: string): string {
  const name = title.trim();
  if (language === "th") return `สวัสดี${name || DEFAULT_OWNER_TITLE_TH}`;
  return `Hello, ${name || DEFAULT_OWNER_TITLE_EN}`;
}

/** Convenience for the two chat surfaces: the greeting for the cached title. */
export function useWelcome(language: "th" | "en"): string {
  const title = useCachedOwnerTitle();
  return welcomeFor(language, title);
}

/** Setter pair for the settings screen, stable across renders. */
export function useFollowUpsSetting(): [boolean, (enabled: boolean) => void] {
  const enabled = useFollowUpsEnabled();
  const set = useCallback((next: boolean) => setFollowUpsEnabled(next), []);
  return [enabled, set];
}
