"use client";

import type { ReactNode } from "react";

// The pieces the two settings windows share: Dishy AI's settings (the
// reference, AISettingsModal) and the app settings opened from the account
// menu (SettingsModal, 27 ก.ย. 2569). One switch, one row, one group heading,
// so the two windows cannot drift apart.

export function Switch({ on, onChange, disabled, label, labelledBy }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean; label?: string; labelledBy?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => onChange(!on)}
      // A flat track and a plain white knob (19 ก.ย. 2569: the owner asked for
      // an ordinary switch, not the raised 3D one). The knob keeps the same 2px
      // inset on both ends: 44px track, 20px knob, 20px travel.
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-orange-500" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        // Pinned 2px from the top and the left; "on" slides it by the free
        // width (44 − 20 − 2×2 = 20px) so the right inset is the same 2px.
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function Row({ id, label, hint, children }: { id?: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div
      data-setting-id={id}
      className="flex items-center justify-between gap-4 border-t border-gray-100 py-3 transition-[background-color] duration-700 first:border-t-0 dark:border-gray-800"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-[18px] text-gray-800 dark:text-gray-100">{label}</p>
        {hint ? <p className="mt-0.5 text-[11.5px] leading-4 text-gray-500 dark:text-gray-400">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {/* A real heading, not a small grey caps label: the owner asked for the
          group names ("การตอบ") to read bigger, as in Claude's settings (26 ก.ย. 2569). */}
      <p className="text-[15px] font-semibold leading-6 text-gray-900 dark:text-gray-100">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] bg-gray-50 px-3 py-2.5 text-[11.5px] leading-[17px] text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">{children}</p>
  );
}

// A row the search lands on is lit for a moment, the way Claude's settings
// point at the setting you searched for. Written out whole so Tailwind keeps
// the classes; the outline paints around the row without moving anything.
export const FLASH_CLASSES = ["rounded-md", "bg-orange-50", "outline", "outline-8", "outline-orange-50", "dark:bg-orange-950/40", "dark:outline-orange-950/40"];

/** Every word typed must appear somewhere in the texts. */
export function matchesSearch(query: string, ...texts: Array<string | undefined>) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = texts.filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}
