"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Check, X } from "lucide-react";
import { useCoarsePointer } from "@/src/hooks/useCoarsePointer";
import { useLanguage } from "@/src/providers/LanguageProvider";
import {
  INITIAL_MENU_POSITION,
  MENU_SURFACE,
  SelectChevron,
  TRIGGER_BASE,
  ThemedSelectPortal,
  isThemedSelectInteractionTarget,
  joinedTriggerStyle,
  menuMotion,
  menuPositionFor,
  menuStyle,
  nativeTriggerFocus,
  triggerShape,
  triggerState,
  type MenuPosition,
  type SelectBoundary,
  type ThemedSelectOption,
} from "@/src/components/shared/ThemedSelect";

/**
 * Pick several from a list, the way the owner's reference language picker does
 * it (2026-09-21): the chosen ones sit as chips inside the field, those the
 * field has no room for collapse into "+N", and the list that opens keeps a
 * checkbox on every row and stays open while you tick. It is the same field and the same
 * attached list as ThemedSelect; only ticking replaces choosing. On a phone the
 * OS multi-picker takes over, as it does for ThemedSelect.
 */
export type ThemedMultiSelectProps = {
  values: string[];
  onChange: (values: string[]) => void;
  options: ThemedSelectOption[];
  placeholder?: string;
  boundary?: SelectBoundary;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  /** A cap on the chips drawn; by default as many as the field has room for. */
  maxChips?: number;
  /** What the "+N" chip says. Pages name what is hidden ("+2 หมวด"); the default is
   *  "+2" in Thai and "+2 more" in English. */
  moreLabel?: (count: number) => string;
};

/** Tick or untick one value. A new pick goes last so the first one stays first. */
export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((current) => current !== value) : [...values, value];
}

/**
 * The OS picker hands back its choice in list order. Keep the ones that were
 * already chosen in their old order and put the new ones after them, so the
 * first pick - a dish's main category - does not change under the owner.
 */
export function mergeSelection(previous: readonly string[], next: readonly string[]): string[] {
  const kept = previous.filter((value) => next.includes(value));
  const added = next.filter((value) => !previous.includes(value));
  return [...kept, ...added];
}

/**
 * The chosen options in the order they were picked - first pick on the left,
 * latest on the right (owner, 2026-09-21: list order read as if the chips were
 * locked in place) - split into chips and the "+N" rest.
 */
export function splitChips(options: readonly ThemedSelectOption[], values: readonly string[], maxChips: number) {
  const chosen = values.flatMap((value) => options.filter((option) => option.value === value));
  return { shown: chosen.slice(0, maxChips), hidden: Math.max(0, chosen.length - maxChips) };
}

export default function ThemedMultiSelect(props: ThemedMultiSelectProps) {
  const nativePicker = useCoarsePointer();
  return nativePicker ? <MultiSelectNative {...props} /> : <MultiSelectMenu {...props} />;
}

type ChipCopy = { remove: string; more: (count: number) => string };

function useChipCopy(moreLabel?: (count: number) => string): ChipCopy {
  const { language } = useLanguage();
  const copy: ChipCopy = language === "th"
    ? { remove: "เอาออก", more: (count) => `+${count}` }
    : { remove: "Remove", more: (count) => `+${count} more` };
  return moreLabel ? { ...copy, more: moreLabel } : copy;
}

const CHIP = "inline-flex h-6 min-w-0 max-w-[11rem] items-center gap-0.5 rounded-full bg-black/[0.07] pl-2.5 pr-0.5 text-[12px] font-semibold text-gray-900 dark:bg-white/[0.12] dark:text-white";
const MORE_CHIP = "inline-flex h-6 shrink-0 items-center rounded-full bg-black/[0.07] px-2.5 text-[12px] font-semibold text-gray-900 dark:bg-white/[0.12] dark:text-white";
/** gap-1.5 between chips. */
const CHIP_GAP = 6;
/** Chips shown before the first measurement, and when nothing can be measured (server render). */
const UNMEASURED_CHIPS = 2;

/**
 * How many chips fit in `available` pixels. All of them when they fit;
 * otherwise as many as fit beside the "+N" chip, and never fewer than one - a
 * single chip too wide for the field shrinks and truncates instead.
 */
export function fittingChips(widths: readonly number[], moreWidth: number, available: number, gap = CHIP_GAP): number {
  if (!widths.length) return 0;
  const all = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  if (all <= available) return widths.length;
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = used + (count ? gap : 0) + width;
    if (next + gap + moreWidth > available) break;
    used = next;
    count += 1;
  }
  return Math.max(1, count);
}

/**
 * The chips row. It shows as many chips as the field has room for and folds
 * only the rest into "+N" (owner, 2026-09-21: "ค่อย + ตอนที่ไม่พอแล้ว"), so
 * a wide field shows every pick and a narrow one gives way. An invisible copy
 * of every chip is measured against the row's width, again whenever the field
 * resizes. Only the × buttons take the pointer: the rest of the field opens
 * the list.
 */
function Chips({
  options,
  values,
  maxChips,
  placeholder,
  disabled,
  onRemove,
  moreLabel,
}: {
  options: readonly ThemedSelectOption[];
  values: readonly string[];
  maxChips: number;
  placeholder: string;
  disabled?: boolean;
  onRemove: (value: string) => void;
  moreLabel?: (count: number) => string;
}) {
  const copy = useChipCopy(moreLabel);
  const chosen = splitChips(options, values, Number.POSITIVE_INFINITY).shown;
  const rowRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  const measureKey = chosen.map((option) => option.label).join("\u0000");
  const widestMore = copy.more(chosen.length);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const ruler = measureRef.current;
    if (!row || !ruler) return;
    const measure = () => {
      const chips = Array.from(ruler.querySelectorAll<HTMLElement>("[data-chip]"), (el) => el.offsetWidth);
      const more = ruler.querySelector<HTMLElement>("[data-more]")?.offsetWidth ?? 0;
      setFit(fittingChips(chips, more, row.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measureKey, widestMore]);

  if (!chosen.length) {
    return <span className="pointer-events-none min-w-0 truncate text-gray-500 dark:text-gray-400">{placeholder}</span>;
  }

  const shownCount = Math.min(maxChips, fit ?? UNMEASURED_CHIPS, chosen.length);
  const shown = chosen.slice(0, shownCount);
  const hidden = chosen.length - shown.length;

  return (
    <span ref={rowRef} className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-1.5">
      {/* The ruler: every chip at its natural width, never seen or heard. */}
      <span ref={measureRef} aria-hidden="true" className="invisible absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap">
        {chosen.map((option) => (
          <span key={option.value} data-chip="" className={CHIP}>
            <span className="truncate">{option.label}</span>
            <span className="h-5 w-5 shrink-0" />
          </span>
        ))}
        <span data-more="" className={MORE_CHIP}>{widestMore}</span>
      </span>

      {shown.map((option) => (
        <span key={option.value} className={CHIP}>
          <span className="truncate">{option.label}</span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${copy.remove} ${option.label}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(option.value);
            }}
            className="pointer-events-auto grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-orange-700 disabled:opacity-50 dark:hover:bg-white/15 dark:focus-visible:outline-orange-400"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      {hidden ? <span className={MORE_CHIP}>{copy.more(hidden)}</span> : null}
    </span>
  );
}

/** The app's own checkbox (the promotion dish picker's): filled orange with a white tick when on. */
function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        checked
          ? "border-orange-600 bg-orange-600 text-white dark:border-orange-500 dark:bg-orange-500"
          : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
      }`}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </span>
  );
}

/** A field that holds chips stands 4px taller than a plain select, so the chips
 *  have air above and below them (owner, 2026-09-21). The open list's rows take
 *  the field's height, so they grow with it. */
function multiSize(compact: boolean, boundary: SelectBoundary) {
  if (boundary === "filled") return "h-11 text-[16px]";
  return compact ? "h-10 text-[12px]" : "h-11 text-[13px]";
}

function fieldClass(boundary: SelectBoundary, compact: boolean, open: boolean) {
  // Keyboard focus lives on the invisible toggle; the field shows it, except
  // while its list is attached below, where a frame around the field alone
  // would cut the two apart.
  const focus = open
    ? ""
    : boundary === "subtle"
      ? "has-[button:focus-visible]:border-orange-500"
      : "ring-inset has-[button:focus-visible]:ring-1 has-[button:focus-visible]:ring-orange-500";
  return `${multiSize(compact, boundary)} ${TRIGGER_BASE} ${triggerShape(boundary)} relative flex items-center overflow-x-clip ${triggerState(boundary, open)} ${focus}`;
}

function MultiSelectMenu({
  values,
  onChange,
  options,
  placeholder,
  boundary = "subtle",
  compact = false,
  disabled,
  className = "",
  "aria-label": ariaLabel,
  maxChips = Number.POSITIVE_INFINITY,
  moreLabel,
}: ThemedMultiSelectProps) {
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>(INITIAL_MENU_POSITION);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const fallbackPlaceholder = language === "th" ? "เลือก" : "Select";

  const updateMenuPosition = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    setMenuPosition(menuPositionFor(field.getBoundingClientRect(), field, window.innerWidth, window.innerHeight));
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    updateMenuPosition();
    setActiveIndex(options.findIndex((option) => !option.disabled));
    setOpen(true);
  }, [disabled, options, updateMenuPosition]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  const toggleAt = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(toggleValue(values, option.value));
  }, [onChange, options, values]);

  const moveActive = useCallback((direction: 1 | -1) => {
    if (!options.length) return;
    setActiveIndex((current) => {
      let next = current;
      for (let step = 0; step < options.length; step += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return current;
    });
  }, [options]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!isThemedSelectInteractionTarget(event.target as Node, rootRef.current, menuRef.current)) closeMenu();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [closeMenu]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(updateMenuPosition);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
    // Chips added or removed can change the field's width on narrow screens.
  }, [open, updateMenuPosition, values.length]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div ref={fieldRef} className={fieldClass(boundary, compact, open)} style={joinedTriggerStyle(menuPosition, open)}>
        {/* The whole field is the toggle; the chips' × buttons sit above it. */}
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          onClick={() => (open ? closeMenu() : openMenu())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                openMenu();
                return;
              }
              moveActive(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (open && activeIndex >= 0) toggleAt(activeIndex);
              else openMenu();
              return;
            }
            if (event.key === "Escape" || event.key === "Tab") closeMenu();
          }}
          className="absolute inset-0 h-full w-full cursor-pointer rounded-[inherit] outline-none disabled:cursor-not-allowed"
        />
        <Chips
          options={options}
          values={values}
          maxChips={maxChips}
          placeholder={placeholder || fallbackPlaceholder}
          disabled={disabled}
          onRemove={(value) => onChange(values.filter((current) => current !== value))}
          moreLabel={moreLabel}
        />
        <SelectChevron open={open} />
      </div>

      {open && !disabled && (
        <ThemedSelectPortal>
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel}
            className={
              menuPosition.attached
                ? `${menuMotion(menuPosition.above)} dropdown-scroll fixed overflow-auto ${MENU_SURFACE[boundary]} ${menuPosition.above ? "shadow-[0_-12px_20px_-10px_rgba(0,0,0,0.25)]" : "shadow-[0_12px_20px_-10px_rgba(0,0,0,0.25)]"} dark:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.7)]`
                : "themed-select-menu dropdown-scroll fixed overflow-auto rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white p-1.5 shadow-(--dashboard-control-shadow) dark:bg-gray-900"
            }
            style={menuStyle(menuPosition)}
          >
            {options.map((option, optionIndex) => {
              const checked = values.includes(option.value);
              const highlighted = optionIndex === activeIndex;
              return (
                <button
                  key={option.value}
                  id={`${listboxId}-option-${optionIndex}`}
                  role="option"
                  aria-selected={checked}
                  aria-disabled={option.disabled || undefined}
                  type="button"
                  disabled={option.disabled}
                  title={option.label}
                  // Ticking keeps focus on the field, so the keyboard carries on.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(optionIndex);
                  }}
                  onClick={() => toggleAt(optionIndex)}
                  className={`flex min-h-[var(--select-row,36px)] w-full items-center gap-3 px-[var(--select-pad,10px)] text-left text-[length:var(--select-font,13px)] text-gray-900 transition-[background-color] disabled:cursor-not-allowed disabled:opacity-50 dark:text-white ${
                    menuPosition.attached ? "" : "rounded-md"
                  } ${highlighted ? "bg-black/[0.05] dark:bg-white/[0.08]" : ""}`}
                  style={{ "--select-option-index": optionIndex } as CSSProperties}
                >
                  <Checkbox checked={checked} />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </ThemedSelectPortal>
      )}
    </div>
  );
}

/** The same field over an invisible <select multiple>: the OS list does the ticking. */
function MultiSelectNative({
  values,
  onChange,
  options,
  placeholder,
  boundary = "subtle",
  compact = false,
  disabled,
  className = "",
  "aria-label": ariaLabel,
  maxChips = Number.POSITIVE_INFINITY,
  moreLabel,
}: ThemedMultiSelectProps) {
  const { language } = useLanguage();
  const fallbackPlaceholder = language === "th" ? "เลือก" : "Select";
  return (
    <div className={`group relative ${className}`}>
      <div className={`${fieldClass(boundary, compact, false)} ${nativeTriggerFocus(boundary)}`}>
        <select
          multiple
          value={values}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(event) => onChange(mergeSelection(values, Array.from(event.target.selectedOptions, (option) => option.value)))}
          // 16px or iOS zooms the page in when the list opens.
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-[16px] opacity-0 disabled:cursor-not-allowed"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <Chips
          options={options}
          values={values}
          maxChips={maxChips}
          placeholder={placeholder || fallbackPlaceholder}
          disabled={disabled}
          onRemove={(value) => onChange(values.filter((current) => current !== value))}
          moreLabel={moreLabel}
        />
        <SelectChevron />
      </div>
    </div>
  );
}
