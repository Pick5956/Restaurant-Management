"use client";

import Image from "next/image";
import { Loader2 } from "lucide-react";
import {
  createContext,
  useContext,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { FLAT_FIELD_EDGE, FLAT_FIELD_ERROR } from "@/src/components/shared/flatField";
import { Skeleton } from "@/src/components/shared/Skeleton";
import ThemedSelect, { type ThemedSelectOption } from "@/src/components/shared/ThemedSelect";
import ThemedTimeInput from "@/src/components/shared/ThemedTimeInput";
import { useLanguage } from "@/src/providers/LanguageProvider";

// The settings pages copy a reference settings layout the owner chose
// (2026-09-19): every setting is one row - a title, a line saying what it does,
// and its control on the right - with a hairline under it and no cards. Sizes
// were measured from the reference page; the fonts and colours are Dishy's.
// Pages compose these components and never restate the classes.

/** A 2px ring standing 2px off the control, in the brand orange. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 dark:focus-visible:outline-orange-400";

/** The flat tinted surface every control sits on (no edge). */
/** --settings-field in globals.css: the reference's #f0f1f2 (dark #303030). */
export const RAISED = "bg-(--settings-field)";
const RAISED_HOVER = "hover:bg-(--settings-field-hover)";
const HAIRLINE = "border-[color:var(--dashboard-shell-border)]";

/** Control widths from the reference: selects and fields 300, buttons 220. */
export const FIELD_WIDTH = "w-full md:w-[300px]";
export const ACTION_WIDTH = "w-full md:w-[220px]";

/**
 * A text box's hover and focus edge, shared with every flat field in the app
 * (see flatField.ts). The 2px orange-700 ring (FOCUS_RING) stays on buttons,
 * links and the switch.
 */
export const TEXT_FOCUS = FLAT_FIELD_EDGE;

/**
 * A one-line field has no vertical padding and a line box the full 40px: the
 * browser clips an input's text to its line box, and with 8px padding that box
 * was 24px - short enough to slice the tone marks off stacked Thai vowels
 * (ตี๋, ปั๊ม, กี้). A textarea keeps its padding; its lines are not clipped.
 */
function fieldClass(error: boolean, fullWidth = false, multiline = false) {
  return [
    multiline ? "block min-w-0 rounded p-2" : "block h-10 min-w-0 rounded px-2 leading-10",
    "text-[16px] text-gray-950 transition-colors",
    RAISED,
    fullWidth ? "w-full" : FIELD_WIDTH,
    "placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400",
    // An invalid field keeps its red edge while it is hovered or typed in.
    error ? FLAT_FIELD_ERROR : TEXT_FOCUS,
    "disabled:cursor-not-allowed disabled:opacity-50",
    "scroll-mt-24",
  ].join(" ");
}

const FIELD_ERROR = "mt-1.5 text-[12px] leading-5 text-red-700 dark:text-red-400";

// ---------------------------------------------------------------------------
// Search

/** What the settings search box holds; rows that do not match hide. */
export const SettingsSearchContext = createContext("");

/** Every word of the query has to appear in the row's title or description. */
export function matchesSetting(query: string, ...texts: Array<string | undefined>): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = texts.filter(Boolean).join(" ").toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

// ---------------------------------------------------------------------------
// The row

type RowProps = {
  title: string;
  /** Left out when the title already says it ("ชื่อ", "ละติจูด"): a line that
   *  only repeats the label is noise, not help. */
  description?: string;
  children: ReactNode;
  /** The input the title labels. Without it the title is plain text with an id. */
  htmlFor?: string;
  titleId?: string;
};

/**
 * One setting. With a description: the 18px title, then 4px lower a row of the
 * description (14px, 80% opacity, at most half the width) and the control,
 * pushed to the ends, both starting at the same line. Without one the control
 * moves up beside the title, because a line holding nothing but a control left
 * the row looking broken open. A hairline under either shape; phones stack.
 */
export function SettingsItem({ title, description, children, htmlFor, titleId }: RowProps) {
  const query = useContext(SettingsSearchContext);
  const titleClass = "block text-[18px] leading-7 text-gray-950 dark:text-white";
  const titleNode = htmlFor ? (
    <label htmlFor={htmlFor} id={titleId} className={titleClass}>{title}</label>
  ) : (
    <p id={titleId} className={titleClass}>{title}</p>
  );
  const control = <div className="min-w-0 md:shrink-0">{children}</div>;
  return (
    <div data-setting-row hidden={!matchesSetting(query, title, description)} className={`mb-2 border-b pb-4 ${HAIRLINE}`}>
      {description ? (
        <>
          {titleNode}
          <div className="mt-1 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <p className="text-[14px] leading-5 text-gray-950 opacity-80 md:max-w-[50%] dark:text-white">{description}</p>
            {control}
          </div>
        </>
      ) : (
        // The title never moves: it sits at the top of every row, described or
        // not. Here the control comes up to that same top line.
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
          {titleNode}
          {control}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons

type ButtonVariant = "primary" | "secondary" | "danger" | "danger-secondary";

const BUTTON_TONE: Record<ButtonVariant, string> = {
  primary: "bg-orange-700 text-white hover:bg-orange-800 active:bg-orange-900",
  secondary: `${RAISED} ${RAISED_HOVER} text-gray-950 active:bg-gray-300 dark:text-white dark:active:bg-gray-600`,
  // The filled red is for the last step of a destructive action - the confirm
  // inside its dialog. The button that only opens that dialog is the flat grey
  // one in red type: filled orange and filled red side by side read as one.
  danger: "bg-red-700 text-white hover:bg-red-800 active:bg-red-900",
  "danger-secondary": `${RAISED} ${RAISED_HOVER} text-red-700 active:bg-gray-300 dark:text-red-400 dark:active:bg-gray-600`,
};

/** A button's look, for a Link that has to act as one. */
export function settingsButtonClass(variant: ButtonVariant, extra = "") {
  return [
    "ui-press relative inline-flex h-10 shrink-0 items-center justify-center overflow-hidden rounded px-3 text-[16px] transition-colors",
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
      {loading ? <Loader2 aria-hidden="true" className="absolute inset-0 m-auto h-5 w-5 motion-safe:animate-spin" /> : null}
    </button>
  );
}

/** A row whose control is one action button. */
export function SettingsActionRow({ title, description, ...button }: { title: string; description?: string } & Parameters<typeof SettingsButton>[0]) {
  return (
    <SettingsItem title={title} description={description}>
      <SettingsButton {...button} className={`${ACTION_WIDTH} ${button.className ?? ""}`} />
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
        <div className={FIELD_WIDTH}>
          <ThemedTimeInput value={value} onChange={onChange} disabled={disabled} error={error} boundary="filled" aria-labelledby={titleId} />
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

/** The bare flat input with its error line, for a field outside a row (a dialog). */
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
        className={fieldClass(Boolean(error), fullWidth)}
      />
      {error ? <p id={errorId} className={FIELD_ERROR}>{error}</p> : null}
    </>
  );
}

export function SettingsTextArea({ label, description, value, onChange, error, disabled, onCommit }: Omit<FieldProps, "type" | "placeholder" | "inputMode" | "autoComplete">) {
  const inputId = useId();
  const errorId = useId();
  return (
    <SettingsItem title={label} description={description} htmlFor={inputId}>
      <textarea
        id={inputId}
        value={value}
        rows={3}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        className={`${fieldClass(Boolean(error), false, true)} resize-y leading-6`}
      />
      {error ? <p id={errorId} className={FIELD_ERROR}>{error}</p> : null}
    </SettingsItem>
  );
}

export function SettingsSelect({ label, description, value, onChange, options }: { label: string; description?: string; value: string; onChange: (value: string) => void; options: ThemedSelectOption[] }) {
  const titleId = useId();
  return (
    <SettingsItem title={label} description={description} titleId={titleId}>
      <ThemedSelect value={value} onChange={onChange} options={options} boundary="filled" aria-labelledby={titleId} className={FIELD_WIDTH} />
    </SettingsItem>
  );
}

/** A value that can be read here but not edited. */
export function SettingsValue({ label, description, value }: { label: string; description?: string; value: string }) {
  return (
    <SettingsItem title={label} description={description}>
      <p className={`${FIELD_WIDTH} truncate text-[16px] leading-10 text-gray-950 dark:text-white md:text-right`}>{value}</p>
    </SettingsItem>
  );
}

// ---------------------------------------------------------------------------
// Switch

/**
 * "Off [switch] On", the reference's toggle: a 30x10 track under a 20px thumb
 * that sits at either end. The words are for the eye; the row title names the
 * switch and aria-checked carries its state.
 */
export function SettingsSwitch({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const { language } = useLanguage();
  const titleId = useId();
  const [offWord, onWord] = language === "en" ? ["Off", "On"] : ["ปิด", "เปิด"];
  return (
    <SettingsItem title={label} description={description} titleId={titleId}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={titleId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        // 40px like every other control in a settings row, so the rows stand
        // the same height whatever they hold.
        className={`flex h-10 items-center gap-2 rounded text-[16px] text-gray-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-white ${FOCUS_RING}`}
      >
        <span aria-hidden="true">{offWord}</span>
        <span aria-hidden="true" className="relative block h-5 w-10">
          <span className={`absolute left-[5px] top-[5px] h-2.5 w-[30px] rounded-full ${checked ? "bg-orange-700" : RAISED}`} />
          <span
            className={`absolute top-0 h-5 w-5 rounded-full transition-[left] duration-200 motion-reduce:transition-none ${
              checked ? "left-5 bg-orange-700" : "left-0 bg-gray-400 dark:bg-gray-600"
            }`}
          />
        </span>
        <span aria-hidden="true">{onWord}</span>
      </button>
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
      <div className="flex items-center gap-4">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded ${RAISED} ${shape === "wide" ? "h-10 w-16" : "h-10 w-10"}`}>
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
            <span className="px-1 text-center text-[11px] leading-4 text-gray-600 dark:text-gray-400">{emptyLabel}</span>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onFile} tabIndex={-1} />
        <SettingsButton loading={busy} aria-label={`${actionLabel} ${title}`} onClick={() => inputRef.current?.click()} className="flex-1 md:w-[220px] md:flex-none">
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
    : `${RAISED} text-gray-600 dark:text-gray-300`;
  return <span className={`inline-flex shrink-0 items-center rounded px-2 py-1 text-[12px] font-semibold ${toneClass}`}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Focus and loading

/** The shape of a settings page while it loads, never a centred spinner. The
 *  bars are hidden from screen readers; `label` is what they announce instead. */
export function SettingsSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className={`mb-2 border-b pb-4 ${HAIRLINE}`}>
          <Skeleton className="h-6 w-44 motion-reduce:animate-none" />
          <div className="mt-1 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <Skeleton className="h-4 w-full max-w-sm motion-reduce:animate-none" />
            <Skeleton className="h-12 w-full motion-reduce:animate-none md:w-[300px]" />
          </div>
        </div>
      ))}
    </div>
  );
}
