"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCoarsePointer } from "@/src/hooks/useCoarsePointer";
import { useLanguage } from "@/src/providers/LanguageProvider";

export type ThemedSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type ThemedSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  // compact matches the h-9 action buttons; the default h-10 stays the app-wide size.
  compact?: boolean;
  // Appended to the trigger, for callers that need to change its own box -
  // radius or shadow. className styles the wrapper, which cannot reach the
  // trigger it draws behind, so a shadow set there would sit on a
  // differently-rounded shape.
  triggerClassName?: string;
  // "filled" is the settings pages' field: a flat tinted box with no edge,
  // 48px tall, measured from the settings layout the owner asked them to match.
  boundary?: SelectBoundary;
  // The desktop trigger is a button, not a native select, so it has no implicit
  // name. Call sites were already passing aria-label and TypeScript let it
  // through - JSX skips prop checking for hyphenated attributes - so it
  // silently reached nothing and those dropdowns were announced as an
  // unlabelled button. Declared here and forwarded to whichever control renders.
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

type SelectBoundary = "subtle" | "filled";

const TRIGGER_BASE =
  "w-full border text-left text-gray-900 transition-[background-color,border-color,box-shadow,transform,translate,opacity] dark:text-white";

function triggerShape(boundary: SelectBoundary) {
  return boundary === "filled" ? "rounded px-4 pr-10" : "rounded-md px-3 pr-9";
}

// --settings-field lives in globals.css, with its own dark value.
const TRIGGER_CLOSED_FILLED = "border-transparent bg-(--settings-field) hover:bg-(--settings-field-hover)";
const TRIGGER_OPEN_FILLED = "border-transparent bg-(--settings-field-hover)";

function triggerState(boundary: SelectBoundary, open: boolean) {
  if (boundary === "filled") return open ? TRIGGER_OPEN_FILLED : TRIGGER_CLOSED_FILLED;
  return open ? TRIGGER_OPEN : TRIGGER_CLOSED;
}
const TRIGGER_CLOSED =
  "border-[color:var(--dashboard-shell-border)] bg-white hover:border-[#d6dbe2] hover:bg-gray-50 dark:bg-gray-900 dark:hover:border-[#2c3848] dark:hover:bg-gray-800/60";
const TRIGGER_OPEN =
  "border-[#d6dbe2] bg-gray-50 inset-shadow-[0_0_0_1px_rgba(17,24,39,0.04)] dark:border-[#2c3848] dark:bg-gray-800/60";


function triggerSize(compact: boolean, boundary: SelectBoundary) {
  // The settings rows keep every control at one height (40px), so a select
  // stands exactly as tall as the text field in the row above it.
  if (boundary === "filled") return "h-10 text-[16px]";
  return compact ? "h-9 text-[12px]" : "h-10 text-[13px]";
}

/** The menu trigger's own focus edge. The filled one has no `outline-none`
 *  underneath it: in Tailwind 4 that sets the outline style to none, and a
 *  focus-visible width on top would then draw nothing. */
function menuTriggerFocus(boundary: SelectBoundary) {
  return boundary === "filled"
    ? "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 dark:focus-visible:outline-orange-400 disabled:opacity-50"
    : "outline-none focus-visible:border-orange-500 disabled:opacity-60";
}

/** The drawn field under the touch version's invisible select. */
function nativeTriggerFocus(boundary: SelectBoundary) {
  return boundary === "filled"
    ? "group-has-[select:focus-visible]:outline-2 group-has-[select:focus-visible]:outline-offset-2 group-has-[select:focus-visible]:outline-orange-700 dark:group-has-[select:focus-visible]:outline-orange-400 group-has-[select:disabled]:opacity-50"
    : "group-has-[select:focus-visible]:border-orange-500 group-has-[select:disabled]:opacity-60";
}

function SelectChevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function isThemedSelectInteractionTarget(
  target: Node,
  triggerRoot: Pick<Node, "contains"> | null,
  menuRoot: Pick<Node, "contains"> | null,
) {
  return Boolean(triggerRoot?.contains(target) || menuRoot?.contains(target));
}

function ThemedSelectPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

/**
 * On a phone or tablet the choosing belongs to the operating system: the iOS
 * menu or wheel, the Android dialog - the same control the inventory screens
 * already use (NativeSelect in inventory/mobile/primitives.tsx). A mouse keeps
 * the menu drawn below. Both render the same field, so the page looks the same
 * on every device; only the list that opens differs.
 */
export default function ThemedSelect(props: ThemedSelectProps) {
  const nativePicker = useCoarsePointer();
  return nativePicker ? <ThemedSelectNative {...props} /> : <ThemedSelectMenu {...props} />;
}

/**
 * The field as drawn by the menu version, with an invisible <select> lying over
 * it that takes the tap. The list, dark mode, the system text size and
 * VoiceOver/TalkBack all come from the OS.
 */
export function ThemedSelectNative({
  value,
  onChange,
  options,
  disabled,
  className = "",
  placeholder = "เลือก",
  compact = false,
  triggerClassName = "",
  boundary = "subtle",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: ThemedSelectProps) {
  const { language } = useLanguage();
  const selected = options.find((option) => option.value === value);
  const fallbackPlaceholder = language === "th" ? "เลือก" : "Select";

  return (
    <div className={`group relative ${className}`}>
      <div
        aria-hidden="true"
        className={`${triggerSize(compact, boundary)} ${TRIGGER_BASE} ${triggerShape(boundary)} flex items-center ${nativeTriggerFocus(boundary)} group-has-[select:active]:translate-y-px ${triggerState(boundary, false)} ${triggerClassName}`}
      >
        <span className={`${selected ? "" : "text-gray-500 dark:text-gray-400"} min-w-0 flex-1 truncate`}>
          {selected?.label ?? (placeholder || fallbackPlaceholder)}
        </span>
        <SelectChevron />
      </div>
      <select
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        onChange={(event) => onChange(event.target.value)}
        // 16px or iOS zooms the page in when the list opens.
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-[16px] opacity-0 disabled:cursor-not-allowed"
      >
        {/* A value with no matching option would leave the browser pre-selecting
            the first real option, and picking that one would then fire no change. */}
        {selected ? null : (
          <option value={value} disabled>
            {placeholder || fallbackPlaceholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ThemedSelectMenu({
  value,
  onChange,
  options,
  disabled,
  className = "",
  placeholder = "เลือก",
  compact = false,
  triggerClassName = "",
  boundary = "subtle",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: ThemedSelectProps) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [renderMenu, setRenderMenu] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 256 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const buttonId = useId();
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const fallbackPlaceholder = language === "th" ? "เลือก" : "Select";
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const buttonState = triggerState(boundary, open);

  const enabledIndexFrom = useCallback((start: number, direction: 1 | -1) => {
    if (!options.length) return -1;
    let next = start;
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) return next;
    }
    return -1;
  }, [options]);

  const updateMenuPosition = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;

    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(viewportWidth - margin * 2, Math.max(rect.width, 224));
    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, viewportWidth - width - margin));
    const below = viewportHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const opensAbove = below < 176 && above > below;
    const availableHeight = Math.max(128, opensAbove ? above : below);
    const maxHeight = Math.min(256, availableHeight);
    const top = opensAbove
      ? Math.max(margin, rect.top - maxHeight - 6)
      : Math.min(rect.bottom + 6, viewportHeight - margin - maxHeight);

    setMenuPosition({ left, top, width, maxHeight });
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    updateMenuPosition();
    const nextActive = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : firstEnabledIndex;
    setActiveIndex(nextActive);
    setClosing(false);
    setRenderMenu(true);
    setOpen(true);
  }, [firstEnabledIndex, options, selectedIndex, updateMenuPosition]);

  const closeMenu = useCallback(() => {
    if (!renderMenu || closing) return;

    setOpen(false);
    setActiveIndex(-1);
    setClosing(true);

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      setRenderMenu(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 150);
  }, [closing, renderMenu]);

  const commitOption = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu();
  }, [closeMenu, onChange, options]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!isThemedSelectInteractionTarget(event.target as Node, rootRef.current, menuRef.current)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [closeMenu]);

  useEffect(() => {
    if (!renderMenu) return;
    const frame = window.requestAnimationFrame(updateMenuPosition);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [renderMenu, updateMenuPosition]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        id={buttonId}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            setActiveIndex((current) => enabledIndexFrom(current >= 0 ? current : firstEnabledIndex - 1, 1));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            setActiveIndex((current) => enabledIndexFrom(current >= 0 ? current : (firstEnabledIndex >= 0 ? firstEnabledIndex : 0), -1));
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open && activeIndex >= 0) {
              commitOption(activeIndex);
              return;
            }
            openMenu();
            return;
          }
          if (event.key === "Escape") {
            closeMenu();
          }
        }}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={renderMenu ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        className={`${triggerSize(compact, boundary)} ${TRIGGER_BASE} ${triggerShape(boundary)} ${menuTriggerFocus(boundary)} active:translate-y-px disabled:cursor-not-allowed ${buttonState} ${triggerClassName}`}
      >
        <span className={`${selected ? "" : "text-gray-500 dark:text-gray-400"} block truncate`}>
          {selected?.label ?? (placeholder || fallbackPlaceholder)}
        </span>
        <SelectChevron open={open} />
      </button>

      {renderMenu && !disabled && (
        <ThemedSelectPortal>
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={buttonId}
            className={`${closing ? "themed-select-menu-exit" : "themed-select-menu"} fixed overflow-auto rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white p-1.5 shadow-(--dashboard-control-shadow) dark:bg-gray-900`}
            style={{
              left: menuPosition.left,
              top: menuPosition.top,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
              zIndex: "calc(var(--z-modal) + 1)",
            }}
          >
            {options.map((option, optionIndex) => {
              const active = option.value === value;
              const highlighted = options[activeIndex]?.value === option.value;
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${optionIndex}`}
                  role="option"
                  aria-selected={active}
                  aria-disabled={option.disabled || undefined}
                  type="button"
                  disabled={option.disabled}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(optionIndex);
                  }}
                  onClick={() => {
                    commitOption(optionIndex);
                  }}
                  style={{ "--select-option-index": optionIndex } as CSSProperties}
                  className={`themed-select-option flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] transition-[background-color,color] disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "bg-gray-100 font-semibold text-gray-900 dark:bg-gray-800 dark:text-white"
                      : highlighted
                        ? "bg-gray-50 text-gray-900 dark:bg-gray-800/70 dark:text-white"
                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/70"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {active ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3.5 w-3.5 shrink-0 text-orange-500"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>
        </ThemedSelectPortal>
      )}
    </div>
  );
}
