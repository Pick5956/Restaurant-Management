"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { useCoarsePointer } from "@/src/hooks/useCoarsePointer";
import { useLanguage } from "@/src/providers/LanguageProvider";

const HOURS = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => index.toString().padStart(2, "0"));
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const CELL_HEIGHT = 40;
const CELL_GAP = 2;
const VISIBLE_ROWS = 5;
const COLUMN_WIDTH = 68;
const COLUMN_HEIGHT = VISIBLE_ROWS * CELL_HEIGHT + (VISIBLE_ROWS - 1) * CELL_GAP;
const COLUMN_GAP = 8;
const PANEL_PADDING = 10;
const LABEL_BLOCK = 23;
const PANEL_WIDTH = COLUMN_WIDTH * 2 + COLUMN_GAP + PANEL_PADDING * 2;
const PANEL_HEIGHT = COLUMN_HEIGHT + LABEL_BLOCK + PANEL_PADDING * 2;
const VIEWPORT_MARGIN = 8;

function normalizeTime(value: string) {
  const match = value.match(TIME_PATTERN);
  if (!match) return "00:00";
  return `${match[1]}:${match[2]}`;
}

/**
 * What the phone's own time picker handed back, as HH:MM, or null to keep the
 * saved time. iOS sends an empty value when the time is cleared, and a picker
 * with seconds enabled sends HH:MM:SS.
 */
export function acceptNativeTime(value: string): string | null {
  const minutes = value.slice(0, 5);
  return TIME_PATTERN.test(minutes) && (value.length === 5 || /^:\d{2}(\.\d+)?$/.test(value.slice(5)))
    ? minutes
    : null;
}

function formatPreview(value: string) {
  const [hourText, minuteText] = normalizeTime(value).split(":");
  const hour = Number.parseInt(hourText, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour.toString().padStart(2, "0")}:${minuteText} ${period}`;
}

/**
 * Centre a column on its selected row by setting scrollTop directly.
 * scrollIntoView would also scroll the settings form behind the panel.
 */
function centerOn(column: HTMLElement | null, index: number, smooth: boolean) {
  if (!column || index < 0) return;
  const target = index * (CELL_HEIGHT + CELL_GAP) - (COLUMN_HEIGHT - CELL_HEIGHT) / 2;
  const top = Math.max(0, Math.min(target, column.scrollHeight - column.clientHeight));
  column.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
}

function TimeColumn({
  label,
  values,
  selected,
  onSelect,
  columnRef,
}: {
  label: string;
  values: string[];
  selected: string;
  onSelect: (value: string, viaKeyboard: boolean) => void;
  columnRef: React.RefObject<HTMLDivElement | null>;
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const index = values.indexOf(selected);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? values.length - 1
          : Math.min(Math.max(index + step, 0), values.length - 1);
    onSelect(values[next], true);
  };

  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <div
        ref={columnRef}
        role="listbox"
        aria-label={label}
        aria-activedescendant={`${label}-${selected}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ height: COLUMN_HEIGHT, width: COLUMN_WIDTH }}
        className="snap-y snap-mandatory overflow-y-auto rounded-md bg-gray-50 p-1 outline-none dark:bg-gray-800/50"
      >
        <div className="flex flex-col" style={{ gap: CELL_GAP }}>
          {values.map((entry) => {
            const isSelected = entry === selected;
            return (
              <button
                key={entry}
                id={`${label}-${entry}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                onClick={() => onSelect(entry, false)}
                style={{ height: CELL_HEIGHT }}
                className={`flex w-full shrink-0 snap-center items-center justify-center rounded-md font-mono text-[14px] font-semibold tabular-nums transition-colors ${
                  isSelected
                    ? "bg-orange-700 text-white"
                    : "text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                }`}
              >
                {entry}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ThemedTimeInput({
  value,
  onChange,
  disabled,
  error,
  help,
  boundary = "subtle",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  help?: string;
  // "filled" is the settings pages' field - a flat tinted box with no edge,
  // 48px tall - matching ThemedSelect's option of the same name.
  boundary?: "subtle" | "filled";
  // Names the OS time input on touch devices. Pass the visible label when the
  // field is not inside a <label>; inside one, the label already names it.
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const { language } = useLanguage();
  const nativePicker = useCoarsePointer();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hourColumnRef = useRef<HTMLDivElement>(null);
  const minuteColumnRef = useRef<HTMLDivElement>(null);
  const buttonId = useId();
  const pickerId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  const current = normalizeTime(value);
  const [currentHour, currentMinute] = current.split(":");

  const copy =
    language === "th"
      ? { hour: "ชั่วโมง", minute: "นาที", choose: "เลือกเวลา" }
      : { hour: "Hour", minute: "Minute", choose: "Choose time" };

  const closePicker = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  /**
   * Writes the panel offset straight to the node. Routing this through React
   * state made the panel repaint a frame after the browser had already scrolled,
   * which reads as the panel lagging behind its field. A direct style write in
   * the scroll handler lands in the same frame as the scroll, and transform
   * keeps the move on the compositor.
   */
  const applyPosition = useCallback(() => {
    const panel = panelRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!panel || !rect) return;
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN);
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), maxLeft);
    const opensAbove =
      window.innerHeight - rect.bottom < PANEL_HEIGHT + 12 && rect.top > PANEL_HEIGHT + 12;
    const rawTop = opensAbove ? rect.top - PANEL_HEIGHT - 8 : rect.bottom + 8;
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - PANEL_HEIGHT - VIEWPORT_MARGIN);
    const top = Math.min(Math.max(VIEWPORT_MARGIN, rawTop), maxTop);
    panel.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }, []);

  const openPicker = () => setOpen(true);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePicker();
      }
    };
    // The panel is fixed to the viewport, so a scroll anywhere would leave it
    // stranded away from its field. Re-anchor on every scroll, and give up once
    // the trigger itself has scrolled out of sight.
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false);
        return;
      }
      applyPosition();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", applyPosition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", applyPosition);
    };
  }, [applyPosition, closePicker, open]);

  // Land both columns on the saved time before the panel paints, so it never
  // shows 00:00 first and scrolls afterwards.
  useLayoutEffect(() => {
    if (!open) return;
    applyPosition();
    centerOn(hourColumnRef.current, HOURS.indexOf(currentHour), false);
    centerOn(minuteColumnRef.current, MINUTES.indexOf(currentMinute), false);
    // Open is the only trigger; later moves scroll themselves in onSelect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A disabled field stays the disabled button everywhere: screen readers still
  // find it and announce it unavailable.
  const nativeControl = nativePicker && !disabled;
  const filled = boundary === "filled";
  // An error on the filled face is an inset red edge; keyboard focus draws the
  // orange ring outside it, so both read at once.
  const fieldClassName = filled
    ? `flex h-12 w-full items-center gap-2.5 rounded bg-(--settings-field) px-4 text-left transition-colors hover:bg-(--settings-field-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:outline-orange-400 ${
      error ? "shadow-[inset_0_0_0_2px_var(--color-red-700)] dark:shadow-[inset_0_0_0_2px_var(--color-red-400)]" : ""
    }`
    : `flex h-11 w-full items-center gap-2.5 rounded-md border bg-white px-3 text-left outline-none transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-900 sm:h-10 ${
      error
        ? "border-red-300 focus:border-red-500 dark:border-red-900/60"
        : "border-gray-200 focus:border-orange-500 dark:border-gray-700"
    }`;
  const nativeFaceFocus = filled
    ? "group-has-[input:focus-visible]:outline-2 group-has-[input:focus-visible]:outline-offset-2 group-has-[input:focus-visible]:outline-orange-700 dark:group-has-[input:focus-visible]:outline-orange-400"
    : error ? "group-has-[input:focus]:border-red-500" : "group-has-[input:focus]:border-orange-500";
  const descriptionClassName = filled
    ? `mt-1.5 text-[12px] leading-5 ${error ? "text-red-700 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`
    : `mt-1 text-[11px] ${error ? "text-red-600 dark:text-red-300" : "text-gray-500 dark:text-gray-500"}`;
  const fieldFace = (
    <>
      <Clock className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
      <span className="font-mono text-[14px] font-semibold tabular-nums text-gray-900 dark:text-white">
        {current}
      </span>
      <span className="truncate text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
        {formatPreview(current)}
      </span>
      <ChevronDown
        className={`ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </>
  );

  return (
    <div ref={rootRef} className="relative">
      {nativeControl ? (
        // On a touch device the drawn field is only a face: a plain div, so the
        // native input is the first form control inside any wrapping <label>.
        // That label then names the input and a tap on its text focuses the
        // input - with a button here it would click the button and open the
        // drawn panel under the OS picker.
        <div className="group relative">
          <div
            aria-hidden="true"
            className={`${fieldClassName} ${nativeFaceFocus}`}
          >
            {fieldFace}
          </div>
          <input
            type="time"
            value={current}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={error || help ? descriptionId : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              const next = acceptNativeTime(event.target.value);
              if (next) onChange(next);
            }}
            // 16px or iOS zooms the page in when the wheel opens.
            className="absolute inset-0 block h-full w-full min-w-0 cursor-pointer appearance-none text-[16px] opacity-0"
          />
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          id={buttonId}
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls={open ? pickerId : undefined}
          // Named by the caller's label, then by its own text, so the time it
          // holds is still read out after the label.
          aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${buttonId}` : undefined}
          aria-describedby={error || help ? descriptionId : undefined}
          // aria-invalid is not allowed on a button; the error is already read
          // through aria-describedby. This marks it for code that has to find
          // the first invalid field after a failed save.
          data-invalid={error ? "true" : undefined}
          onClick={() => (open ? setOpen(false) : openPicker())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openPicker();
            }
          }}
          className={fieldClassName}
        >
          {fieldFace}
        </button>
      )}

      {(error || help) && (
        <p
          id={descriptionId}
          className={descriptionClassName}
        >
          {error || help}
        </p>
      )}

      {open && !disabled && (
        <div
          ref={panelRef}
          id={pickerId}
          role="dialog"
          aria-labelledby={buttonId}
          aria-label={copy.choose}
          className="motion-dialog-stationary fixed z-[var(--z-dropdown)] rounded-md border border-gray-200 bg-white shadow-lg shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/40"
          style={{ left: 0, top: 0, width: PANEL_WIDTH, padding: PANEL_PADDING, willChange: "transform" }}
        >
          <div className="flex" style={{ gap: COLUMN_GAP }}>
            <TimeColumn
              label={copy.hour}
              values={HOURS}
              selected={currentHour}
              columnRef={hourColumnRef}
              onSelect={(hour, viaKeyboard) => {
                onChange(`${hour}:${currentMinute}`);
                if (viaKeyboard) centerOn(hourColumnRef.current, HOURS.indexOf(hour), true);
              }}
            />
            <TimeColumn
              label={copy.minute}
              values={MINUTES}
              selected={currentMinute}
              columnRef={minuteColumnRef}
              onSelect={(minute, viaKeyboard) => {
                onChange(`${currentHour}:${minute}`);
                if (viaKeyboard) centerOn(minuteColumnRef.current, MINUTES.indexOf(minute), true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
