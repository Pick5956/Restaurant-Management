"use client";

import { useContext, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Minus, Plus, type LucideIcon } from "lucide-react";
import { FOCUS_RING, SettingsMobileContext, SettingsSearchContext, matchesSetting } from "./SettingsPrimitives";

// The settings on a phone (chosen 26 ก.ย. 2569): one long page, a strip of
// chips at the top, and every topic a card of its own - an icon, a name, a
// one-line summary, and inside it controls shaped by what they set (a theme is
// picked from two small screens, a rate from pills, a table count with - and
// +) rather than the same form row repeated. Painted with the stock page's
// phone tokens (--inv-*), which the layout's data-inventory-mobile root brings.
// The pages keep their own state and save calls; these are only the looks.

/** Whether the settings are drawn for a phone. */
export function useSettingsPhone() {
  return useContext(SettingsMobileContext).mobile;
}

// ---------------------------------------------------------------------------
// Section

export function MobileSection({
  id,
  title,
  summary,
  icon: Icon,
  tone,
  keywords = "",
  hero,
  danger = false,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  icon?: LucideIcon;
  /** Classes for the icon tile: its background and colour. */
  tone?: string;
  /** Extra words the search should find this card by (its field labels). */
  keywords?: string;
  /** Replaces the icon header with a picture header (the profile, the cover). */
  hero?: ReactNode;
  danger?: boolean;
  children?: ReactNode;
}) {
  const { flash } = useContext(SettingsMobileContext);
  const query = useContext(SettingsSearchContext);
  const lit = flash === id;
  return (
    <section
      data-settings-group={id}
      aria-label={title}
      hidden={!matchesSetting(query, title, summary, keywords)}
      className={`scroll-mt-(--settings-bar) overflow-hidden rounded-[22px] border shadow-(--inv-shadow) transition-[box-shadow] duration-700 ${
        danger ? "border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20" : "border-(--inv-hairline) bg-(--inv-surface)"
      } ${lit ? "ring-[3px] ring-(--inv-action)/40" : "ring-0"}`}
    >
      {hero ?? (
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          {Icon ? (
            <span className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl ${tone ?? ""}`}>
              <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className={`text-[16px] font-semibold ${danger ? "text-red-700 dark:text-red-400" : "text-(--inv-heading)"}`}>{title}</h2>
            {summary ? <p className="truncate text-[12.5px] text-(--inv-muted)">{summary}</p> : null}
          </div>
        </div>
      )}
      {children ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fields

export function MobileLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 ml-0.5 block text-[12.5px] font-semibold text-(--inv-muted)">
      {children}
    </label>
  );
}

export function MobileInput({
  label,
  value,
  onChange,
  onCommit,
  placeholder,
  inputMode,
  autoComplete,
  error,
  suffix,
  multiline = false,
  type = "text",
  disabled,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Saves: runs when the field is left, and on Enter. */
  onCommit?: () => void;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  error?: string;
  suffix?: string;
  multiline?: boolean;
  type?: "text" | "time";
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const errorId = useId();
  const box = `w-full min-w-0 rounded-[14px] bg-(--inv-canvas) text-[16px] text-(--inv-heading) outline-none transition placeholder:text-(--inv-faint) focus:ring-2 focus:ring-(--inv-action)/30 disabled:opacity-50 ${
    error ? "ring-2 ring-red-400/60" : ""
  }`;
  return (
    <div className={`mb-3 ${className}`}>
      <MobileLabel htmlFor={id}>{label}</MobileLabel>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          className={`${box} resize-none px-3.5 py-3 leading-6`}
        />
      ) : (
        <div className="relative">
          <input
            id={id}
            type={type}
            value={value}
            placeholder={placeholder}
            inputMode={inputMode}
            autoComplete={autoComplete}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onCommit}
            onKeyDown={(event) => {
              if (onCommit && event.key === "Enter") event.currentTarget.blur();
            }}
            className={`${box} h-12 px-3.5 ${suffix ? "pr-12" : ""}`}
          />
          {suffix ? <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-(--inv-muted)">{suffix}</span> : null}
        </div>
      )}
      {error ? <p id={errorId} className="mt-1 ml-0.5 text-[12px] text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switches and choices

export function MobileToggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
        checked ? "bg-(--inv-action)" : "bg-(--inv-surface-strong)"
      }`}
    >
      <span className={`absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow transition-[left] duration-200 motion-reduce:transition-none ${checked ? "left-[23px]" : "left-[3px]"}`} />
    </button>
  );
}

/** A soft tile with a switch on its first line; what the switch opens sits under it. */
export function MobileSwitchTile({
  title,
  hint,
  checked,
  onChange,
  children,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2.5 rounded-2xl bg-(--inv-canvas) px-3.5 py-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[15px] font-semibold text-(--inv-heading)">{title}</p>
        <MobileToggle checked={checked} onChange={onChange} label={title} />
      </div>
      {hint ? <p className="mt-1 text-[12.5px] leading-[18px] text-(--inv-muted)">{hint}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function MobilePills<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`ui-press min-h-[36px] rounded-full border px-3.5 text-[13.5px] transition ${FOCUS_RING} ${
              on
                ? "border-(--inv-action) bg-(--inv-action-soft) font-semibold text-(--inv-action)"
                : "border-(--inv-hairline) bg-(--inv-surface) text-(--inv-body)"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A count set with - and +, the number large between them. */
export function MobileStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const button = `ui-press flex h-11 w-11 items-center justify-center rounded-[14px] disabled:opacity-40 ${FOCUS_RING}`;
  return (
    <div>
      <MobileLabel>{label}</MobileLabel>
      <div className="flex items-center gap-2.5">
        <button type="button" aria-label={`${label} −1`} disabled={value <= min} onClick={() => onChange(value - 1)} className={`${button} bg-(--inv-canvas) text-(--inv-body)`}>
          <Minus aria-hidden="true" className="h-5 w-5" />
        </button>
        <output className="flex-1 text-center text-[22px] font-bold tabular-nums text-(--inv-heading)">{value}</output>
        <button type="button" aria-label={`${label} +1`} disabled={value >= max} onClick={() => onChange(value + 1)} className={`${button} bg-(--inv-action-soft) text-(--inv-action)`}>
          <Plus aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function MobileBadge({ tone, children }: { tone: "ok" | "brand" | "neutral"; children: ReactNode }) {
  const cls = tone === "ok" ? "bg-(--inv-ok-soft) text-(--inv-ok)" : tone === "brand" ? "bg-(--inv-action-soft) text-(--inv-action)" : "bg-(--inv-surface-strong) text-(--inv-muted)";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// The bill preview

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * What a bill of `base` comes to with the rates set - the same arithmetic the
 * server does in order_flow_helpers.go unpaidCharges: service on the food,
 * then VAT on food + service, each rounded to satang. A preview that did it
 * differently would tell the owner a price the till then contradicts.
 */
export function billPreview(base: number, serviceOn: boolean, serviceRate: number, vatOn: boolean, vatRate: number) {
  const service = serviceOn && Number.isFinite(serviceRate) ? round2((base * serviceRate) / 100) : 0;
  const vat = vatOn && Number.isFinite(vatRate) ? round2(((base + service) * vatRate) / 100) : 0;
  return { service, vat, total: round2(base + service + vat) };
}
