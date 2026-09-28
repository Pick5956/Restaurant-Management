"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import {
  createContext,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { Skeleton } from "@/src/components/shared/Skeleton";
import ThemedSelect, { type ThemedSelectOption } from "@/src/components/shared/ThemedSelect";
import ThemedTimeInput from "@/src/components/shared/ThemedTimeInput";
import { Group, Switch, matchesSearch } from "@/src/components/shared/settingsModalKit";

// The settings live in a floating window opened from the account menu
// (27 ก.ย. 2569), drawn the way Dishy AI's settings are (AISettingsModal, the
// reference the owner chose): a group heading, then rows of a 13px name, an
// 11.5px line saying what it does, and a small control on the right, a
// hairline between rows. The pages (Account, Display, Restaurant) compose
// these components and never restate the classes.
//
// Every row carries data-setting-* attributes: the window's search reads them
// to list what matches and to jump to the row that was picked.

/** A 2px ring standing 2px off the control, in the brand orange. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 dark:focus-visible:outline-orange-400";

/** The text box every other web form uses (menu, promotions): 40px tall, a
 *  grey hairline that turns orange on focus, no ring (owner, 27 ก.ย. 2569).
 *  Type size is the settings' own. 16px on a phone so iPhone Safari does not
 *  zoom in when it is tapped. */
const INPUT_BASE =
  "h-10 rounded-md border bg-white px-3 text-[16px] text-gray-800 outline-none transition-colors placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[12.5px] dark:bg-gray-800 dark:text-gray-100";
const INPUT_OK = "border-gray-200 focus:border-orange-500 dark:border-gray-700";
const INPUT_ERROR = "border-red-300 focus:border-orange-500 dark:border-red-900/60";

/** Controls on the right of a row share one width, so the rows line up. */
export const CONTROL_WIDTH = "w-44";

const FIELD_ERROR = "mt-1 max-w-44 text-right text-[11px] leading-4 text-red-600 dark:text-red-400";

// ---------------------------------------------------------------------------
// Phone

/**
 * On a phone the window shows the settings chosen for it on 26 ก.ย. 2569
 * (SettingsMobileKit): one long page of cards under a strip of chips. The
 * window sets `mobile`; each page then draws its cards instead of these rows.
 * `flash` is the card a chip just scrolled to, lit for a moment.
 */
export const SettingsMobileContext = createContext<{ mobile: boolean; flash?: string | null }>({ mobile: false, flash: null });

/** What the phone's search box holds; cards that do not match hide. */
export const SettingsSearchContext = createContext("");

/** Every word of the query has to appear somewhere in the texts. */
export const matchesSetting = matchesSearch;

// ---------------------------------------------------------------------------
// The row

type RowProps = {
  title: string;
  /** Left out when the title already says it ("ชื่อ", "ละติจูด"). */
  description?: string;
  children: ReactNode;
  /** The control goes under the text at full width (a textarea) instead of on the right. */
  stack?: boolean;
  /** The input the title labels. Without it the title is plain text with an id. */
  htmlFor?: string;
  titleId?: string;
};

/** One setting: its name and what it does on the left, its control on the right. */
export function SettingsItem({ title, description, children, htmlFor, titleId, stack = false }: RowProps) {
  const rowId = useId();
  const titleClass = "block text-[13px] font-medium leading-[18px] text-gray-800 dark:text-gray-100";
  const titleNode = htmlFor ? (
    <label htmlFor={htmlFor} id={titleId} className={titleClass}>{title}</label>
  ) : (
    <p id={titleId} className={titleClass}>{title}</p>
  );
  const text = (
    <div className="min-w-0">
      {titleNode}
      {description ? <p className="mt-0.5 text-[11.5px] leading-4 text-gray-500 dark:text-gray-400">{description}</p> : null}
    </div>
  );
  return (
    <div
      data-setting-row=""
      data-setting-id={rowId}
      data-setting-label={title}
      data-setting-hint={description}
      className={`border-t border-gray-100 py-3 transition-[background-color] duration-700 first:border-t-0 dark:border-gray-800 ${
        stack ? "flex flex-col gap-2" : "flex items-center justify-between gap-4"
      }`}
    >
      {text}
      {stack ? children : <div className="flex shrink-0 flex-col items-end">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups

/** A named group of rows under the reference's 15px heading. */
export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-settings-group={id} data-settings-group-title={title} aria-label={title}>
      <Group title={title}>{children}</Group>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Buttons

type ButtonVariant = "primary" | "secondary" | "danger" | "danger-secondary";

// The buttons of Dishy AI's settings: an outlined one for most actions, the
// red outline for the one that only opens a destructive step, and filled
// buttons for the last step itself.
const BUTTON_TONE: Record<ButtonVariant, string> = {
  primary: "bg-orange-500 font-semibold text-white hover:bg-orange-600",
  secondary: "border border-gray-200 bg-white font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800",
  danger: "bg-red-600 font-semibold text-white hover:bg-red-700",
  "danger-secondary": "border border-red-200 bg-white font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/30",
};

/** A button's look, for a Link that has to act as one. */
export function settingsButtonClass(variant: ButtonVariant, extra = "") {
  return [
    "relative inline-flex h-8 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-lg px-3 text-[12.5px] transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-50",
    FOCUS_RING,
    BUTTON_TONE[variant],
    extra,
  ].join(" ");
}

/**
 * While `loading`, the label stays in place but turns transparent and a spinner
 * sits over it: the button keeps its width and its accessible name.
 */
export function SettingsButton({
  variant = "secondary",
  loading = false,
  disabled,
  type = "button",
  className = "",
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  loading?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={settingsButtonClass(variant, className)}
    >
      <span className={loading ? "opacity-0" : undefined}>{children}</span>
      {loading ? <Loader2 aria-hidden="true" className="absolute inset-0 m-auto h-3.5 w-3.5 motion-safe:animate-spin" /> : null}
    </button>
  );
}

/** A row whose control is one action button. */
export function SettingsActionRow({ title, description, ...button }: { title: string; description?: string } & Parameters<typeof SettingsButton>[0]) {
  return (
    <SettingsItem title={title} description={description}>
      <SettingsButton {...button} />
    </SettingsItem>
  );
}

// ---------------------------------------------------------------------------
// Fields

type FieldProps = {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: "text" | "time";
  placeholder?: string;
  disabled?: boolean;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  maxLength?: number;
  /** For a dialog that opens with this field focused. */
  inputRef?: Ref<HTMLInputElement>;
  /** Saves the typed value: called when the field loses focus, and on Enter. */
  onCommit?: () => void;
};

export function SettingsField({ label, description, value, onChange, error, type = "text", placeholder, disabled, inputMode, autoComplete, maxLength, inputRef, onCommit }: FieldProps) {
  const inputId = useId();
  const titleId = useId();
  const errorId = useId();
  if (type === "time") {
    return (
      <SettingsItem title={label} description={description} titleId={titleId}>
        <div className={CONTROL_WIDTH}>
          <ThemedTimeInput value={value} onChange={onChange} disabled={disabled} error={error} aria-labelledby={titleId} />
        </div>
      </SettingsItem>
    );
  }
  return (
    <SettingsItem title={label} description={description} htmlFor={inputId}>
      <SettingsInput
        id={inputId}
        value={value}
        onChange={onChange}
        error={error}
        errorId={errorId}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        inputRef={inputRef}
        onCommit={onCommit}
      />
    </SettingsItem>
  );
}

/** The bare input with its error line, for a field outside a row (a dialog). */
export function SettingsInput({
  id,
  value,
  onChange,
  error,
  errorId,
  placeholder,
  disabled,
  inputMode,
  autoComplete,
  maxLength,
  inputRef,
  onCommit,
  fullWidth = false,
  "aria-label": ariaLabel,
}: Omit<FieldProps, "label" | "description" | "type"> & { id: string; errorId: string; fullWidth?: boolean; "aria-label"?: string }) {
  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          // Enter finishes the field the way leaving it does; the blur saves.
          if (onCommit && event.key === "Enter") event.currentTarget.blur();
        }}
        className={`${INPUT_BASE} ${error ? INPUT_ERROR : INPUT_OK} ${fullWidth ? "w-full" : CONTROL_WIDTH}`}
      />
      {error ? <p id={errorId} className={fullWidth ? "mt-1 text-[11px] leading-4 text-red-600 dark:text-red-400" : FIELD_ERROR}>{error}</p> : null}
    </>
  );
}

export function SettingsTextArea({ label, description, value, onChange, error, disabled, onCommit }: Omit<FieldProps, "type" | "placeholder" | "inputMode" | "autoComplete">) {
  const inputId = useId();
  const errorId = useId();
  return (
    <SettingsItem title={label} description={description} htmlFor={inputId} stack>
      <textarea
        id={inputId}
        value={value}
        rows={3}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        className={`${INPUT_BASE} ${error ? INPUT_ERROR : INPUT_OK} h-auto w-full resize-y py-2 leading-5`}
      />
      {error ? <p id={errorId} className="text-[11px] leading-4 text-red-600 dark:text-red-400">{error}</p> : null}
    </SettingsItem>
  );
}

/**
 * Two or three choices are a small segmented control (ไทย | English); a longer
 * list is a dropdown.
 */
export function SettingsSelect({ label, description, value, onChange, options }: { label: string; description?: string; value: string; onChange: (value: string) => void; options: ThemedSelectOption[] }) {
  const titleId = useId();
  if (options.length <= 3) {
    return (
      <SettingsItem title={label} description={description} titleId={titleId}>
        <div role="radiogroup" aria-labelledby={titleId} className="inline-flex gap-0.5 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(option.value)}
                className={`h-7 rounded-md px-3 text-[12.5px] transition-colors ${FOCUS_RING} ${
                  selected
                    ? "bg-white font-semibold text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white"
                    : "font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsItem>
    );
  }
  return (
    <SettingsItem title={label} description={description} titleId={titleId}>
      <ThemedSelect value={value} onChange={onChange} options={options} compact aria-labelledby={titleId} className={CONTROL_WIDTH} triggerClassName="!h-10 !rounded-md !text-[12.5px]" />
    </SettingsItem>
  );
}

/** A value that can be read here but not edited. */
export function SettingsValue({ label, description, value }: { label: string; description?: string; value: string }) {
  return (
    <SettingsItem title={label} description={description}>
      <p className="max-w-56 truncate text-right text-[12.5px] text-gray-600 dark:text-gray-300">{value}</p>
    </SettingsItem>
  );
}

// ---------------------------------------------------------------------------
// Switch

/** Dishy AI's switch, named by the row title; aria-checked carries its state. */
export function SettingsSwitch({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const titleId = useId();
  return (
    <SettingsItem title={label} description={description} titleId={titleId}>
      <Switch on={checked} onChange={onChange} disabled={disabled} labelledBy={titleId} />
    </SettingsItem>
  );
}

// ---------------------------------------------------------------------------
// Media

/**
 * An image the restaurant uploads: the preview sits beside one action. The
 * action reads "change" once there is something to replace, and its accessible
 * name carries the row's title so it is never just "upload".
 */
export function SettingsMediaRow({
  title,
  description,
  imageSrc,
  imageAlt,
  emptyLabel,
  shape = "square",
  fit = "cover",
  uploadLabel,
  replaceLabel,
  busy,
  onFile,
}: {
  title: string;
  description?: string;
  imageSrc: string;
  imageAlt: string;
  emptyLabel: string;
  shape?: "square" | "wide";
  fit?: "cover" | "contain";
  uploadLabel: string;
  replaceLabel: string;
  busy: boolean;
  onFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const actionLabel = imageSrc ? replaceLabel : uploadLabel;
  return (
    <SettingsItem title={title} description={description}>
      <div className="flex items-center gap-2.5">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800 ${shape === "wide" ? "h-10 w-16" : "h-10 w-10"}`}>
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt={imageAlt}
              width={shape === "wide" ? 64 : 40}
              height={40}
              unoptimized
              className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
            />
          ) : (
            <span className="px-1 text-center text-[10px] leading-3 text-gray-500 dark:text-gray-400">{emptyLabel}</span>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} tabIndex={-1} />
        <SettingsButton loading={busy} aria-label={`${actionLabel} ${title}`} onClick={() => inputRef.current?.click()}>
          {actionLabel}
        </SettingsButton>
      </div>
    </SettingsItem>
  );
}

/** A status that is real data: connected, active, suspended. */
export function SettingsBadge({ tone, children }: { tone: "success" | "neutral"; children: ReactNode }) {
  const toneClass = tone === "success"
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  return <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Loading

/** The shape of a section while it loads, never a centred spinner. The bars
 *  are hidden from screen readers; `label` is what they announce instead. */
export function SettingsSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="flex flex-col">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className="flex items-center justify-between gap-4 border-t border-gray-100 py-3 first:border-t-0 dark:border-gray-800">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-3 w-full max-w-60 motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-10 w-44 shrink-0 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
