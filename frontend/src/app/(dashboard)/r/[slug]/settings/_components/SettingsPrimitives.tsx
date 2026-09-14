"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import ThemedTimeInput from "@/src/components/shared/ThemedTimeInput";

export function SettingsShell({
  eyebrow,
  title,
  subtitle,
  action,
  children,
  hideHeader = false,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
  children: ReactNode;
  hideHeader?: boolean;
}) {
  return (
    <div className="min-h-dvh w-full max-w-full overflow-x-hidden bg-slate-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      {/* Settings are forms: hold them to a readable measure and center them so
          fields never stretch edge-to-edge on wide screens. */}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        {hideHeader ? (
          // The sidebar already names the page; keep only a visually-hidden
          // heading so the document outline and screen readers are unaffected.
          <h1 className="sr-only">{title}</h1>
        ) : (
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600 dark:text-orange-400">{eyebrow}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{title}</h1>
              {subtitle ? (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
              ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
        )}

        <main className="w-full">{children}</main>
      </div>
    </div>
  );
}

export function SettingsPanel({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-white">{title}</h2>
          {hint ? <p className="mt-0.5 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{hint}</p> : null}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  help,
  type = "text",
  disabled,
  inputMode,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  help?: string;
  type?: string;
  disabled?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{label}</span>
      {type === "time" ? (
        <ThemedTimeInput value={value} onChange={(nextValue) => onChange?.(nextValue)} disabled={disabled} error={error} help={help} />
      ) : (
        <>
          <input
            type={type}
            value={value}
            placeholder={placeholder}
            inputMode={inputMode}
            disabled={disabled}
            readOnly={!onChange}
            onChange={(event) => onChange?.(event.target.value)}
            className={`h-11 w-full min-w-0 rounded-md border bg-white px-3 text-[14px] text-gray-900 outline-none transition-colors placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-900 dark:text-white sm:h-10 sm:text-[13px] ${
              error
                ? "border-red-300 focus:border-red-500 dark:border-red-900/60"
                : "border-gray-200 focus:border-orange-500 dark:border-gray-700"
            }`}
          />
          {(error || help) && (
            <p className={`mt-1 text-[11px] leading-5 ${error ? "text-red-600 dark:text-red-300" : "text-gray-500 dark:text-gray-400"}`}>
              {error || help}
            </p>
          )}
        </>
      )}
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  error,
  help,
  disabled,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  error?: string;
  help?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <textarea
        value={value}
        rows={4}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={!onChange}
        onChange={(event) => onChange?.(event.target.value)}
        className={`w-full min-w-0 rounded-md border bg-white px-3 py-2 text-[14px] text-gray-900 outline-none transition-colors placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-900 dark:text-white sm:text-[13px] ${
          error
            ? "border-red-300 focus:border-red-500 dark:border-red-900/60"
            : "border-gray-200 focus:border-orange-500 dark:border-gray-700"
        }`}
      />
      {(error || help) && (
        <p className={`mt-1 text-[11px] leading-5 ${error ? "text-red-600 dark:text-red-300" : "text-gray-500 dark:text-gray-400"}`}>
          {error || help}
        </p>
      )}
    </label>
  );
}

export function StatusMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return (
    <div
      aria-live="polite"
      className={`rounded-md border px-3 py-2 text-[12px] ${
        error
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300"
      }`}
    >
      {error || message}
    </div>
  );
}
