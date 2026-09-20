"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { useCoarsePointer } from "@/src/hooks/useCoarsePointer";
import { useLanguage } from "@/src/providers/LanguageProvider";

const HOURS = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => index.toString().padStart(2, "0"));
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
// A released drag keeps going as far as its speed would carry it in this
// long, capped so a hard flick spins at most this many rows.
const GLIDE_MS = 220;
const GLIDE_MAX_ROWS = 12;
// How long the column must sit still before the value under the band counts.
const SETTLE_MS = 120;

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
 * One drum of the wheel. The row resting under the band is the value: it is
 * read once scrolling settles (scroll-snap has lined it up by then), and a
 * tap on any row rolls that row to the band. While it turns, the row nearest
 * the band is drawn large from the live scroll position, so the wheel shows
 * what it will land on before it lands.
 *
 * It loops: past 23 comes 00 again. The values are laid out several times
 * over, the wheel opens on the middle copy, and each time it comes to rest it
 * is moved — without animation — to the same value in the middle copy, so
 * there is always a full turn left in either direction.
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
  // Where a run of wheel notches is heading, so quick notches add up instead of
  // each starting again from wherever the animation happens to be.
  const wheelTarget = useRef<number | null>(null);
  const wheelCarry = useRef(0);
  // Mouse drag: the pointer's start, and whether it has moved far enough to be
  // a drag rather than a click on a row.
  const drag = useRef<{ y: number; top: number; moved: boolean; id: number } | null>(null);
  // The last few pointer positions of a drag, to measure how fast it was let go.
  const trail = useRef<{ t: number; y: number }[]>([]);
  const glideFrame = useRef<number | null>(null);
  // True while dragging or gliding: scroll-snap is off for both, or it would
  // pull the rows back to the nearest one on every frame.
  const [dragging, setDragging] = useState(false);

  // Land on the saved value before the panel paints, without animating.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    ref.current.scrollTop = (middle + selectedIndex) * ROW;
    setLive(middle + selectedIndex);
    // Only on open; later moves roll themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Latest props for the unmount below, which only sees the first render's.
  const latest = useRef({ onSelect, selected });
  useEffect(() => {
    latest.current = { onSelect, selected };
  });

  // Closing the panel while the wheel is still turning (a quick "เสร็จ" right
  // after a flick) used to drop the turn, because the settle timer died with
  // the column. Whatever row the wheel is on or heading to is kept instead.
  useEffect(
    () => () => {
      if (!settleTimer.current && wheelTarget.current === null) return;
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      const node = ref.current;
      const index = wheelTarget.current ?? (node ? Math.round(node.scrollTop / ROW) : null);
      if (index === null) return;
      const value = values[((index % size) + size) % size];
      if (value !== latest.current.selected) latest.current.onSelect(value);
    },
    // Unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const stopGlide = () => {
    if (glideFrame.current !== null) cancelAnimationFrame(glideFrame.current);
    glideFrame.current = null;
  };

  useEffect(() => stopGlide, []);

  /**
   * Let go of a drag and the wheel carries on, the way it does on an iPhone:
   * it travels as far as the release speed would take it in GLIDE_MS, slows
   * down, and stops square on a row. A slow release barely moves; a flick
   * spins several rows.
   */
  const glide = (velocity: number) => {
    const node = ref.current;
    if (!node) return;
    const travel = Math.max(-GLIDE_MAX_ROWS * ROW, Math.min(GLIDE_MAX_ROWS * ROW, -velocity * GLIDE_MS));
    glideTo(Math.round((node.scrollTop + travel) / ROW));
  };

  /** Ease out from wherever the wheel is now to row `index`, and stop there. */
  const glideTo = (index: number) => {
    const node = ref.current;
    if (!node) return null;
    stopGlide();
    const from = node.scrollTop;
    const target = Math.min(Math.max(index, 0), rows - 1);
    // Closing the panel mid-glide keeps where it was heading.
    wheelTarget.current = target;
    const distance = target * ROW - from;
    const duration = Math.min(900, Math.max(260, Math.abs(distance) * 2.2));
    const start = performance.now();
    setDragging(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.scrollTop = from + distance * eased;
      if (t < 1) {
        glideFrame.current = requestAnimationFrame(step);
      } else {
        glideFrame.current = null;
        setDragging(false);
      }
    };
    glideFrame.current = requestAnimationFrame(step);
    return target;
  };

  const rollTo = (index: number) => {
    stopGlide();
    const clamped = Math.min(Math.max(index, 0), rows - 1);
    ref.current?.scrollTo({ top: clamped * ROW, behavior: "smooth" });
    return clamped;
  };

  // A mouse wheel notch scrolls about 100px by default — three rows at once,
  // which spun the wheel past the hour people were aiming for. Each notch now
  // turns it exactly one row. A trackpad sends many small deltas, so they are
  // added up and a row is taken per ROW of travel. Not a React onWheel: those
  // are passive and cannot stop the page's own scroll.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let lastWheel = 0;
    // Notches in quick succession, counted, so a spin speeds up the way a
    // flick does.
    let streak = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.deltaY) return;
      const delta = event.deltaMode === 1 ? event.deltaY * ROW : event.deltaY;
      const now = event.timeStamp;
      // The first event after a pause always turns one row, whatever its size.
      // Mice differ a lot per notch — 100px on a Windows wheel, a few px on a
      // Mac or a high-resolution Logitech wheel — and waiting for small ones
      // to add up to a whole row left the wheel not moving at all.
      const gap = now - lastWheel;
      const fresh = gap > 150;
      streak = gap < 180 ? streak + 1 : 0;
      lastWheel = now;
      const notch = fresh || Math.abs(delta) >= 50;
      if (notch) wheelCarry.current = 0;
      else wheelCarry.current += delta;
      let steps = notch ? Math.sign(delta) : Math.trunc(wheelCarry.current / ROW);
      if (!steps) return;
      if (!notch) wheelCarry.current -= steps * ROW;
      const from = wheelTarget.current ?? Math.round(node.scrollTop / ROW);
      // Wheel turns glide like a released drag: each one eases the wheel on to
      // its new row, and a fast spin carries further — a single notch is still
      // one row, the third quick one in a row is two, and so on up to four.
      if (notch) steps = Math.sign(steps) * Math.min(4, 1 + Math.floor(streak / 2));
      steps = Math.max(-4, Math.min(4, steps));
      wheelTarget.current = glideTo(from + steps);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // rollTo only reads `rows`, fixed for the life of the column.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const node = ref.current;
    if (!node) return;
    const index = Math.min(Math.max(Math.round(node.scrollTop / ROW), 0), rows - 1);
    setLive(index);
    if (settleTimer.current) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      if (drag.current || glideFrame.current !== null) return;
      settleTimer.current = null;
      wheelTarget.current = null;
      wheelCarry.current = 0;
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
      // Hold the mouse button and drag, the way a finger turns it on a phone.
      // Touch already scrolls natively, so this is mouse only.
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0 || !ref.current) return;
        // Grabbing a gliding wheel stops it where it is, like a finger would.
        if (glideFrame.current !== null) {
          stopGlide();
          setDragging(false);
        }
        drag.current = { y: event.clientY, top: ref.current.scrollTop, moved: false, id: event.pointerId };
        trail.current = [{ t: event.timeStamp, y: event.clientY }];
      }}
      onPointerMove={(event) => {
        const node = ref.current;
        const current = drag.current;
        if (!node || !current || current.id !== event.pointerId) return;
        const dy = event.clientY - current.y;
        if (!current.moved) {
          if (Math.abs(dy) < 4) return;
          // Captured only once it is a drag: capturing on press would send the
          // release to the column instead of the row, and a plain click on a
          // row would stop working.
          current.moved = true;
          try {
            node.setPointerCapture(event.pointerId);
          } catch {
            // The pointer is already gone (released between events); the drag
            // still works for as long as it stays over the wheel.
          }
          setDragging(true);
        }
        node.scrollTop = current.top - dy;
        trail.current.push({ t: event.timeStamp, y: event.clientY });
        if (trail.current.length > 8) trail.current.shift();
      }}
      onPointerUp={(event) => {
        const node = ref.current;
        const current = drag.current;
        if (!node || !current || current.id !== event.pointerId) return;
        drag.current = null;
        if (!current.moved) return;
        if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
        // Speed over the last ~80ms of the drag, in px per ms. A pause before
        // letting go reads as zero, so a careful drag still lands where it is.
        const recent = trail.current.filter((point) => event.timeStamp - point.t <= 80);
        const first = recent[0];
        const velocity =
          first && event.timeStamp - first.t > 0 ? (event.clientY - first.y) / (event.timeStamp - first.t) : 0;
        glide(velocity);
      }}
      onPointerCancel={() => {
        drag.current = null;
        stopGlide();
        setDragging(false);
      }}
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
      // Snapping is off while dragging, or it would yank the rows back to the
      // nearest one under the pointer on every move.
      className={`relative w-16 select-none overflow-y-auto overscroll-contain outline-none [&::-webkit-scrollbar]:hidden ${
        dragging ? "cursor-grabbing" : "cursor-grab snap-y snap-mandatory"
      }`}
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
            onClick={() => {
              wheelTarget.current = null;
              rollTo(index);
            }}
            style={{ height: ROW }}
            className={`flex w-full cursor-[inherit] snap-center items-center justify-center tabular-nums transition-[font-size,color] duration-100 ${
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
  const buttonId = useId();
  const pickerId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);

  const current = normalizeTime(value);
  const [currentHour, currentMinute] = current.split(":");

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

  // A disabled field stays the disabled button everywhere: screen readers still
  // find it and announce it unavailable.
  const nativeControl = nativePicker && !disabled;
  const filled = boundary === "filled";
  // An error on the filled face is an inset red edge; keyboard focus draws the
  // orange ring outside it, so both read at once.
  const fieldClassName = filled
    ? `flex h-10 w-full items-center gap-2.5 rounded bg-(--settings-field) px-4 text-left transition-colors hover:bg-(--settings-field-hover) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:outline-orange-400 ${
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
          className="motion-dialog-stationary fixed z-[var(--z-dropdown)] rounded-2xl border border-gray-200 bg-white shadow-xl shadow-gray-900/10 dark:border-gray-700 dark:bg-gray-900 dark:shadow-black/40"
          style={{ left: 0, top: 0, width: PANEL_WIDTH, padding: PANEL_PADDING, willChange: "transform" }}
          // Forms put this field inside a <label>, and the panel sits inside it
          // in the DOM. A click on anything in the panel that is not a button —
          // the end of a mouse drag lands on the wheel itself — reached the
          // label, which clicked the field and toggled the panel shut.
          onClick={(event) => event.preventDefault()}
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
              values={MINUTES}
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
