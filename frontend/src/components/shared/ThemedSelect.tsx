"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import DropdownChevron from "@/src/components/shared/DropdownChevron";
import { FLAT_FIELD_SURFACE } from "@/src/components/shared/flatField";
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
  // "filled" is the settings pages' field: a flat tinted box with no edge, 40px
  // tall with 16px text.
  boundary?: SelectBoundary;
  // The desktop trigger is a button, not a native select, so it has no implicit
  // name. Call sites were already passing aria-label and TypeScript let it
  // through - JSX skips prop checking for hyphenated attributes - so it
  // silently reached nothing and those dropdowns were announced as an
  // unlabelled button. Declared here and forwarded to whichever control renders.
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export type SelectBoundary = "subtle" | "filled";

// border-color is not transitioned: when an attached list closes, the field's
// bottom edge has to be there at once, not fade in after it.
export const TRIGGER_BASE =
  "w-full border text-left text-gray-900 transition-[background-color,box-shadow,transform,translate,opacity] dark:text-white";

export function triggerShape(boundary: SelectBoundary) {
  return boundary === "filled" ? "rounded px-4 pr-10" : "rounded-md px-3 pr-9";
}

// The filled face draws its edge inside the box, like the flat text fields
// (flatField.ts): grey on hover, orange-500 on keyboard focus. The fill no
// longer darkens on hover - that is what read as too heavy beside them.
// Open, it keeps its plain fill: the list below continues it without a seam.
const TRIGGER_CLOSED_FILLED = `border-transparent ${FLAT_FIELD_SURFACE} ring-inset hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-700`;
// While open, the keyboard focus edge steps aside: it would frame the field
// alone and cut it off from the list. The highlighted row shows where focus is.
const TRIGGER_OPEN_FILLED = `border-transparent ${FLAT_FIELD_SURFACE} focus-visible:!ring-0`;

export function triggerState(boundary: SelectBoundary, open: boolean) {
  if (boundary === "filled") return open ? TRIGGER_OPEN_FILLED : TRIGGER_CLOSED_FILLED;
  return open ? TRIGGER_OPEN : TRIGGER_CLOSED;
}
const TRIGGER_CLOSED =
  "border-[color:var(--dashboard-shell-border)] bg-white hover:border-gray-300 hover:bg-gray-100 dark:bg-gray-900 dark:hover:border-[#2c3848] dark:hover:bg-gray-800";
const TRIGGER_OPEN =
  "border-[#d6dbe2] bg-white focus-visible:!border-[#d6dbe2] dark:border-[#2c3848] dark:bg-gray-900 dark:focus-visible:!border-[#2c3848]";

/** An attached list's fill and edge: the open trigger's, so the two read as one piece. */
export const MENU_SURFACE: Record<SelectBoundary, string> = {
  filled: `border-0 ${FLAT_FIELD_SURFACE}`,
  subtle: "border border-[#d6dbe2] bg-white dark:border-[#2c3848] dark:bg-gray-900",
};


export function triggerSize(compact: boolean, boundary: SelectBoundary) {
  // The settings rows keep every control at one height (40px), so a select
  // stands exactly as tall as the text field in the row above it.
  if (boundary === "filled") return "h-10 text-[16px]";
  return compact ? "h-9 text-[12px]" : "h-10 text-[13px]";
}

/** The menu trigger's own focus edge. The flat faces draw it as a 1px inset
 *  orange-500 edge, the same as a flat text field; the subtle face turns its
 *  border orange. */
function menuTriggerFocus(boundary: SelectBoundary) {
  return boundary !== "subtle"
    ? "outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-orange-500 disabled:opacity-50"
    : "outline-none focus-visible:border-orange-500 disabled:opacity-60";
}

/** The drawn field under the touch version's invisible select. */
export function nativeTriggerFocus(boundary: SelectBoundary) {
  return boundary !== "subtle"
    ? "group-has-[select:focus-visible]:ring-1 group-has-[select:focus-visible]:ring-inset group-has-[select:focus-visible]:ring-orange-500 group-has-[select:disabled]:opacity-50"
    : "group-has-[select:focus-visible]:border-orange-500 group-has-[select:disabled]:opacity-60";
}

export function SelectChevron({ open = false }: { open?: boolean }) {
  return <DropdownChevron open={open} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />;
}

/**
 * Where the open list sits and what it copies from its trigger.
 *
 * An attached list (the owner's reference, 2026-09-21: "ดูเป็นเนื้อเดียวกันกับ
 * ข้อมูลข้างใน") continues the field it came from: flush against it, exactly
 * its width, the same fill and edge, rows a little shorter than the field with the text
 * on the same left edge. The fill comes from the face (MENU_SURFACE); the corner
 * radius, text inset, size and row height are read off the trigger, because
 * callers restyle triggers (rounded-xl toolbar filters) and the list has to
 * follow them. The trigger's live colour is not copied: hover changes it. A
 * trigger narrower than MIN_ATTACHED_WIDTH gets the old detached card instead,
 * so a tiny unit picker can still show readable options.
 */
export type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  /** Distance from the viewport top (below) or bottom (above) edge. */
  offset: number;
  above: boolean;
  attached: boolean;
  radius: string;
  paddingLeft: string;
  fontSize: string;
  rowHeight: number;
};

export const INITIAL_MENU_POSITION: MenuPosition = {
  left: 0,
  width: 0,
  maxHeight: 256,
  offset: 0,
  above: false,
  attached: false,
  radius: "0px",
  paddingLeft: "12px",
  fontSize: "13px",
  rowHeight: 36,
};

const MIN_ATTACHED_WIDTH = 140;
// Rows in an attached list sit 8px shorter than the field that opened them:
// a full field height per row read as padded and cost a row of the list.
const ATTACHED_ROW_INSET = 8;
const ATTACHED_ROW_MIN = 32;
const MENU_MARGIN = 8;
const DETACHED_GAP = 6;

export function menuPositionFor(rect: DOMRect, trigger: HTMLElement, viewportWidth: number, viewportHeight: number): MenuPosition {
  const style = window.getComputedStyle(trigger);
  const attached = rect.width >= MIN_ATTACHED_WIDTH;
  const gap = attached ? 0 : DETACHED_GAP;
  const width = attached
    ? rect.width
    : Math.min(viewportWidth - MENU_MARGIN * 2, Math.max(rect.width, 224));
  const left = attached
    ? rect.left
    : Math.min(Math.max(MENU_MARGIN, rect.left), Math.max(MENU_MARGIN, viewportWidth - width - MENU_MARGIN));
  const below = viewportHeight - rect.bottom - MENU_MARGIN;
  const aboveSpace = rect.top - MENU_MARGIN;
  const above = below < 176 && aboveSpace > below;
  const maxHeight = Math.min(256, Math.max(128, (above ? aboveSpace : below) - gap));
  return {
    left,
    width,
    maxHeight,
    offset: above ? viewportHeight - rect.top + gap : rect.bottom + gap,
    above,
    attached,
    radius: style.borderTopLeftRadius,
    paddingLeft: style.paddingLeft,
    fontSize: style.fontSize,
    rowHeight: Math.max(ATTACHED_ROW_MIN, rect.height - ATTACHED_ROW_INSET),
  };
}

/** The list's own box: a continuation of the trigger, or the detached card. */
export function menuStyle(position: MenuPosition): CSSProperties {
  const placement: CSSProperties = position.above ? { bottom: position.offset } : { top: position.offset };
  const box: CSSProperties = {
    ...placement,
    left: position.left,
    width: position.width,
    maxHeight: position.maxHeight,
    zIndex: "calc(var(--z-modal) + 1)",
  };
  if (!position.attached) return box;
  const joined = position.above
    ? { borderBottomWidth: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }
    : { borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 };
  return {
    ...box,
    borderRadius: position.radius,
    ...joined,
    ["--select-pad" as string]: position.paddingLeft,
    ["--select-font" as string]: position.fontSize,
    ["--select-row" as string]: `${position.rowHeight}px`,
  };
}

/** An attached list unrolls out of the field's edge; it never slides, which would open a gap.
 *  It has no exit motion: it closes in the same frame the field gets its edge back. */
export function menuMotion(above: boolean) {
  return above ? "themed-select-attached-up" : "themed-select-attached";
}

/** While its list is attached, the trigger drops the edge and corners it shares with it. */
export function joinedTriggerStyle(position: MenuPosition, open: boolean): CSSProperties | undefined {
  if (!open || !position.attached) return undefined;
  return position.above
    ? { borderTopColor: "transparent", borderTopLeftRadius: 0, borderTopRightRadius: 0 }
    : { borderBottomColor: "transparent", borderBottomLeftRadius: 0, borderBottomRightRadius: 0 };
}

export function isThemedSelectInteractionTarget(
  target: Node,
  triggerRoot: Pick<Node, "contains"> | null,
  menuRoot: Pick<Node, "contains"> | null,
) {
  return Boolean(triggerRoot?.contains(target) || menuRoot?.contains(target));
}

export function ThemedSelectPortal({ children }: { children: ReactNode }) {
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
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(INITIAL_MENU_POSITION);
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
    const trigger = rootRef.current?.querySelector<HTMLElement>("button");
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || !trigger) return;
    setMenuPosition(menuPositionFor(rect, trigger, window.innerWidth, window.innerHeight));
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

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    // An attached list goes at once, and the field gets its bottom edge back in
    // the same frame. Letting it roll up first kept the field open-ended for the
    // length of the animation, which read as the line arriving late.
    if (menuPosition.attached) {
      setRenderMenu(false);
      setClosing(false);
      return;
    }

    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setRenderMenu(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, 150);
  }, [closing, menuPosition.attached, renderMenu]);

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
        style={joinedTriggerStyle(menuPosition, renderMenu)}
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
            className={
              menuPosition.attached
                ? `${menuMotion(menuPosition.above)} dropdown-scroll fixed overflow-auto ${MENU_SURFACE[boundary]} ${menuPosition.above ? "shadow-[0_-12px_20px_-10px_rgba(0,0,0,0.25)]" : "shadow-[0_12px_20px_-10px_rgba(0,0,0,0.25)]"} dark:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.7)]`
                : `${closing ? "themed-select-menu-exit" : "themed-select-menu"} dropdown-scroll fixed overflow-auto rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white p-1.5 shadow-(--dashboard-control-shadow) dark:bg-gray-900`
            }
            style={menuStyle(menuPosition)}
          >
            {options.map((option, optionIndex) => {
              const active = option.value === value;
              const highlighted = options[activeIndex]?.value === option.value;
              if (menuPosition.attached) {
                return (
                  <button
                    key={option.value}
                    id={`${listboxId}-option-${optionIndex}`}
                    role="option"
                    aria-selected={active}
                    aria-disabled={option.disabled || undefined}
                    type="button"
                    disabled={option.disabled}
                    title={option.label}
                    onMouseEnter={() => {
                      if (!option.disabled) setActiveIndex(optionIndex);
                    }}
                    onClick={() => {
                      commitOption(optionIndex);
                    }}
                    // Rows as tall as the field and the text on its left edge, so
                    // the list reads as the field carrying on. The chosen row is a
                    // darker band of the same fill; the one under the pointer or
                    // the keyboard, a lighter one.
                    className={`flex min-h-(--select-row) w-full items-center px-(--select-pad) text-left text-(length:--select-font) text-gray-900 transition-[background-color] disabled:cursor-not-allowed disabled:opacity-50 dark:text-white ${
                      active
                        ? "bg-black/[0.07] dark:bg-white/[0.12]"
                        : highlighted
                          ? "bg-black/[0.04] dark:bg-white/[0.06]"
                          : ""
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              }
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
