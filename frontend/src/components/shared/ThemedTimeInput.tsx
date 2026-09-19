"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { useLanguage } from "@/src/providers/LanguageProvider";

const HOURS = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, "0"));
// Opening hours are set on the quarter hour. The old picker scrolled through
// sixty minutes to reach one of these four.
const QUARTERS = ["00", "15", "30", "45"];
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// The wheel: five rows on screen, the middle one is the value.
const ROW = 36;
const VISIBLE_ROWS = 5;
const WHEEL_HEIGHT = ROW * VISIBLE_ROWS;
const EDGE_PAD = ROW * Math.floor(VISIBLE_ROWS / 2);
const PANEL_WIDTH = 232;
const PANEL_PADDING = 12;
const DONE_BLOCK = 46;
const PANEL_HEIGHT = WHEEL_HEIGHT + DONE_BLOCK + PANEL_PADDING * 2;
const VIEWPORT_MARGIN = 8;
// Rows laid out per wheel, so a hard flick still has somewhere to go.
const LOOP_ROWS = 60;
// How long the column must sit still before the value under the band counts.
const SETTLE_MS = 120;

function normalizeTime(value: string) {
  const match = value.match(TIME_PATTERN);
  if (!match) return "00:00";
  return `${match[1]}:${match[2]}`;
}

function formatPreview(value: string) {
  const [hourText, minuteText] = normalizeTime(value).split(":");
  const hour = Number.parseInt(hourText, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour.toString().padStart(2, "0")}:${minuteText} ${period}`;
}

/**
 * One drum of the wheel. The row resting under the band is the value: it is
 * read once scrolling settles (scroll-snap has lined it up by then), and a
 * tap on any row rolls that row to the band. While it turns, the row nearest
 * the band is drawn large from the live scroll position, so the wheel shows
 * what it will land on before it lands.
 *
 * It loops: past 23 comes 00 again. The values are laid out several times
 * over, the wheel opens on the middle copy, and each time it comes to rest it
 * is moved — without animation — to the same value in the middle copy, so
 * there is always a full turn left in either direction. Minutes have only four
 * values, so they get more copies to have the same room to spin.
 */
function WheelColumn({
  label,
  values,
  selected,
  onSelect,
  open,
}: {
  label: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
  open: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const size = values.length;
  // Odd, so there is a middle copy; at least ~60 rows in all.
  const copies = Math.max(5, Math.ceil(LOOP_ROWS / size) | 1);
  const middle = Math.floor(copies / 2) * size;
  const rows = size * copies;
  const selectedIndex = Math.max(0, values.indexOf(selected));
  const [live, setLive] = useState(middle + selectedIndex);

  // Land on the saved value before the panel paints, without animating.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    ref.current.scrollTop = (middle + selectedIndex) * ROW;
    setLive(middle + selectedIndex);
    // Only on open; later moves roll themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(
    () => () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const rollTo = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), rows - 1);
    ref.current?.scrollTo({ top: clamped * ROW, behavior: "smooth" });
  };

  const onScroll = () => {
    const node = ref.current;
    if (!node) return;
    const index = Math.min(Math.max(Math.round(node.scrollTop / ROW), 0), rows - 1);
    setLive(index);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const value = values[index % size];
      if (value !== selected) onSelect(value);
      // Back to the middle copy, same value, same pixels on screen.
      const home = middle + (index % size);
      if (home !== index) node.scrollTop = home * ROW;
    }, SETTLE_MS);
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${label}-${live}`}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={(event) => {
        const step = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        if (!step) return;
        event.preventDefault();
        rollTo(live + step);
      }}
      style={{
        height: WHEEL_HEIGHT,
        paddingTop: EDGE_PAD,
        paddingBottom: EDGE_PAD,
        // Inline, because a site-wide rule sets every scroller to a thin bar
        // and outranks a utility class.
        scrollbarWidth: "none",
        // Rows fade out toward the top and bottom edge, the way a drum turns away.
        maskImage: "linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 32%, black 68%, transparent 100%)",
      }}
      className="relative w-16 snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [&::-webkit-scrollbar]:hidden"
    >
      {Array.from({ length: rows }, (_, index) => {
        const entry = values[index % size];
        const distance = Math.abs(index - live);
        return (
          <button
            key={index}
            id={`${label}-${index}`}
            type="button"
            role="option"
            aria-selected={index === live}
            tabIndex={-1}
            onClick={() => rollTo(index)}
            style={{ height: ROW }}
            className={`flex w-full snap-center items-center justify-center tabular-nums transition-[font-size,color] duration-100 ${
              distance === 0
                ? "text-[22px] font-semibold text-gray-900 dark:text-white"
                : distance === 1
                  ? "text-[16px] font-medium text-gray-400 dark:text-gray-500"
                  : "text-[14px] font-medium text-gray-300 dark:text-gray-600"
            }`}
          >
            {entry}
          </button>
        );
      })}
    </div>
  );
}

export default function ThemedTimeInput({
  value,
  onChange,
  disabled,
  error,
  help,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
  help?: string;
}) {
  const { language } = useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const buttonId = useId();
  const pickerId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  const current = normalizeTime(value);
  const [currentHour, currentMinute] = current.split(":");
  // A time saved before the wheel went to quarters (10:20) keeps its own row,
  // so the wheel still shows what is actually stored.
  const minutes = QUARTERS.includes(currentMinute) ? QUARTERS : [...QUARTERS, currentMinute].sort();

  const copy =
    language === "th"
      ? { hour: "ชั่วโมง", minute: "นาที", choose: "เลือกเวลา", done: "เสร็จ" }
      : { hour: "Hour", minute: "Minute", choose: "Choose time", done: "Done" };

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
      if (event.key === "Escape" || event.key === "Enter") {
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

  // Place the panel before it paints, so it never flashes at the corner.
  useLayoutEffect(() => {
    if (!open) return;
    applyPosition();
  }, [applyPosition, open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={buttonId}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? pickerId : undefined}
        aria-describedby={error || help ? descriptionId : undefined}
        onClick={() => (open ? setOpen(false) : openPicker())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        className={`flex h-11 w-full items-center gap-2.5 rounded-md border bg-white px-3 text-left outline-none transition-[border-color,box-shadow] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-900 sm:h-10 ${
          error
            ? "border-red-300 focus:border-red-500 dark:border-red-900/60"
            : "border-gray-200 focus:border-orange-500 dark:border-gray-700"
        }`}
      >
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
      </button>

      {(error || help) && (
        <p
          id={descriptionId}
          className={`mt-1 text-[11px] ${error ? "text-red-600 dark:text-red-300" : "text-gray-500 dark:text-gray-500"}`}
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
          className="motion-dialog-stationary fixed z-[var(--z-dropdown)] rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/40"
          style={{ left: 0, top: 0, width: PANEL_WIDTH, padding: PANEL_PADDING, willChange: "transform" }}
        >
          <div className="relative flex items-center justify-center gap-1" style={{ height: WHEEL_HEIGHT }}>
            {/* The band behind the middle row: whatever rests on it is the time. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 rounded-xl bg-gray-100 dark:bg-gray-800"
              style={{ top: EDGE_PAD, height: ROW }}
            />
            <WheelColumn
              label={copy.hour}
              values={HOURS}
              selected={currentHour}
              open={open}
              onSelect={(hour) => onChange(`${hour}:${currentMinute}`)}
            />
            <span aria-hidden="true" className="relative pb-0.5 text-[22px] font-semibold text-gray-900 dark:text-white">
              :
            </span>
            <WheelColumn
              label={copy.minute}
              values={minutes}
              selected={currentMinute}
              open={open}
              onSelect={(minute) => onChange(`${currentHour}:${minute}`)}
            />
          </div>
          <button
            type="button"
            onClick={closePicker}
            className="mt-2.5 h-9 w-full rounded-xl bg-orange-700 text-[13px] font-semibold text-white transition hover:bg-orange-800"
          >
            {copy.done}
          </button>
        </div>
      )}
    </div>
  );
}
