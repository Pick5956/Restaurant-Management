"use client";

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, Minus, Plus, X } from "lucide-react";

/** 44px is the smallest target a finger hits reliably; 52 is for primary actions. */
export const TAP = "min-h-[44px]";
export const TAP_LG = "min-h-[52px]";

/**
 * Below 16px iOS Safari zooms the page on focus and never zooms back, which
 * shifts every subsequent tap target. Every text input on these screens uses it.
 */
export const inputBase =
  "w-full rounded-(--inv-radius) border bg-(--inv-surface) px-3 text-[16px] text-(--inv-heading) outline-none transition placeholder:text-(--inv-faint) focus:border-(--inv-action)-(--inv-action)/20";

export function useIsMobile(breakpoint = 768) {
  // Starts null so the server and the first client paint agree; the tree picks a
  // side only after mount. Rendering both would double every fetch.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => setIsMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [breakpoint]);
  return isMobile;
}

/**
 * iOS Safari only applies :active on touch when a touchstart listener exists
 * somewhere up the tree — with none, every .ui-press in the app is inert on an
 * iPhone (the transition is there, the state never fires). One passive no-op
 * listener on the document is the documented way to turn it on. Registered
 * once per mount of the mobile tree; removed with it.
 */
export function useIOSActiveStates() {
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
}

/** Freezes the page behind an overlay. Restores whatever was there before. */
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [closing, setClosing] = useState(false);

  useScrollLock(open);

  const dismiss = useCallback(() => {
    // With reduced motion there is no exit animation, so animationend never
    // fires — close at once instead of waiting for an event that never comes.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }
    setClosing(true);
  }, [onClose]);

  // Unmount exactly when the exit keyframe finishes, whatever its duration is.
  // A fixed timer used to fire 40ms before the scrim finished fading, so every
  // dismiss ended with a visible snap.
  const finishClose = useCallback(
    (event: React.AnimationEvent<HTMLDivElement>) => {
      if (!closing || event.target !== event.currentTarget) return;
      setClosing(false);
      onClose();
    },
    [closing, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  // No mounted flag is needed: a sheet only opens from a tap, so `open` is
  // always false during SSR and the portal is never reached on the server.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div data-inventory-mobile className="fixed inset-0 z-[55] flex flex-col justify-end">
      <button
        type="button"
        aria-label="close"
        onClick={dismiss}
        className={`absolute inset-0 cursor-default bg-(--inv-scrim) ${closing ? "inv-scrim-exit" : "inv-scrim-enter"}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onAnimationEnd={finishClose}
        className={`relative max-h-[88vh] overflow-hidden rounded-t-(--inv-radius-lg) bg-(--inv-surface) ${
          closing ? "inv-sheet-exit" : "inv-sheet-enter"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex justify-center pt-2">
          <span className="h-1 w-9 rounded-full bg-(--inv-surface-strong)" />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 pb-[10px] pt-[2px]">
          <h2 className="text-[15px] font-semibold text-(--inv-heading)">{title}</h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="ปิด"
            className={`ui-press -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-(--inv-muted) ${TAP}`}
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        <div className="border-t border-(--inv-hairline)" />
        <div
          className="max-h-[64vh] overflow-y-auto overscroll-contain px-4 py-3"
          style={{ "--inv-fade": "var(--inv-surface)" } as React.CSSProperties}
        >
          {children}
        </div>
        {footer && <div className="border-t border-(--inv-hairline) px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function SheetAction({
  label,
  icon,
  onClick,
  danger,
  divided,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  divided?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`ui-press flex w-full items-center gap-3 px-1 text-left text-[15px] font-medium ${TAP} ${
        divided ? "mt-2 border-t border-(--inv-hairline) pt-2" : ""
      } ${danger ? "text-(--inv-out)" : "text-(--inv-heading)"}`}
    >
      <span className={danger ? "text-(--inv-out)" : "text-(--inv-muted)"}>{icon}</span>
      {label}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex items-center gap-1 rounded-(--inv-radius) bg-(--inv-surface-strong) p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={selected}
            type="button"
            onClick={() => onChange(option.value)}
            className={`ui-press flex flex-1 items-center justify-center gap-1.5 rounded-(--inv-radius) px-2 py-2 text-[13px] font-semibold transition ${
              selected
                ? "bg-(--inv-surface) text-(--inv-heading) shadow-(--inv-shadow)"
                : "text-(--inv-muted)"
            }`}
          >
            <span className="truncate">{option.label}</span>
            {option.count !== undefined && (
              <span className={`tabular-nums ${selected ? "text-(--inv-action)" : "text-(--inv-faint)"}`}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Counts in the ingredient's own base unit (กรัม / มล. / ฟอง). The brief asked
 * for a pack stepper, but nothing in the schema records how many units a pack
 * holds, and it differs per ingredient — so the buttons step by a tenth of the
 * reorder level instead, and the number stays typeable.
 */
export function Stepper({
  value,
  step,
  unit,
  onChange,
}: {
  value: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const safeStep = step > 0 ? step : 1;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="ลด"
        onClick={() => onChange(Math.max(0, Math.round((value - safeStep) * 100) / 100))}
        disabled={value <= 0}
        className={`ui-press flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) text-(--inv-heading) disabled:opacity-40 ${TAP}`}
      >
        <Minus className="h-5 w-5" strokeWidth={2} />
      </button>
      <div className="relative min-w-0 flex-1">
        <input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Math.max(0, Number(event.target.value)))}
          className={`${inputBase} h-[52px] border-(--inv-hairline) pr-14 text-center font-semibold tabular-nums`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-(--inv-muted)">
          {unit}
        </span>
      </div>
      <button
        type="button"
        aria-label="เพิ่ม"
        onClick={() => onChange(Math.round((value + safeStep) * 100) / 100)}
        className={`ui-press flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) text-(--inv-heading) ${TAP}`}
      >
        <Plus className="h-5 w-5" strokeWidth={2} />
      </button>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`ui-press flex w-full items-center justify-center gap-2 rounded-(--inv-radius) bg-(--inv-action) px-4 text-[15px] font-semibold text-white transition disabled:opacity-50 ${TAP_LG}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`ui-press flex w-full items-center justify-center gap-2 rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) px-4 text-[15px] font-semibold text-(--inv-heading) transition disabled:opacity-50 ${TAP_LG}`}
    >
      {children}
    </button>
  );
}

/**
 * Tracks whether a scroller actually overflows and where it sits, so the
 * affordance below it is drawn only when there IS more to reach — a permanent
 * bar under a row that already fits reads as a broken decoration.
 */
function useScrollAffordance() {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ scrollable: false, ratio: 0, progress: 0 });

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const overflow = node.scrollWidth - node.clientWidth;
    if (overflow <= 1) {
      setState((current) => (current.scrollable ? { scrollable: false, ratio: 0, progress: 0 } : current));
      return;
    }
    setState({
      scrollable: true,
      ratio: node.clientWidth / node.scrollWidth,
      progress: node.scrollLeft / overflow,
    });
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.addEventListener("scroll", measure, { passive: true });
    // ResizeObserver fires once on observe(), which is the first measurement —
    // no separate call is needed, and calling one here would set state straight
    // out of the effect body. It also covers the row ceasing to overflow when a
    // category is deleted or the phone rotates, neither of which scrolls.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  return { ref, ...state };
}

/**
 * Chip row for filters and date ranges; scrolls rather than wrapping.
 *
 * iOS draws its own scroll indicator, but it is pale grey, it sits hard against
 * the chips, and it fades a moment after the finger lifts — so a row that
 * overflows looks like a row that simply ends. The native one stays hidden and
 * this draws an ember bar instead: it appears only when the row overflows, it
 * has real space above it, and it stays put. A fade on the leading and trailing
 * edge shows which direction still has chips.
 */
export function ChipRow<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const { ref, scrollable, ratio, progress } = useScrollAffordance();
  // One value feeds both the width and the travel, so they can never disagree.
  const thumb = Math.max(ratio * 100, 18);

  return (
    <div className="relative">
      <div
        ref={ref}
        // soft-scrollbar-hide, not a Tailwind arbitrary variant: globals.css sets
        // *::-webkit-scrollbar { height: 8px } outside any @layer, and unlayered
        // CSS beats layered utilities no matter the specificity — the utility
        // version simply lost, which is why the pale native bar kept showing.
        className="soft-scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4"
      >
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={`ui-press shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-[13px] font-semibold transition ${
              option.value === value
                ? "border-(--inv-action) bg-(--inv-action-soft) text-(--inv-action)"
                : "border-(--inv-hairline) bg-(--inv-surface) text-(--inv-muted)"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {scrollable && (
        <>
          {/* Edge fades sit over the chips, outside the 16px gutter, so they read
              as "the row continues" rather than as a border. */}
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute -left-4 top-0 bottom-0 w-8 bg-gradient-to-r from-(--inv-fade) to-transparent transition-opacity duration-200 ${
              progress > 0.02 ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute -right-4 top-0 bottom-0 w-8 bg-gradient-to-l from-(--inv-fade) to-transparent transition-opacity duration-200 ${
              progress < 0.98 ? "opacity-100" : "opacity-0"
            }`}
          />
          {/* 10px of air between the chips and the bar; the pale grey iOS
              indicator used to touch them. */}
          <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-(--inv-surface-strong)">
            {/* No transition: the thumb must track the finger frame for frame.
                With one it lagged behind the chips and read as stutter. */}
            <div
              className="h-full rounded-full bg-(--inv-action)"
              style={{
                width: `${thumb}%`,
                transform: `translateX(${(progress * (100 - thumb) * 100) / thumb}%)`,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function useToastStack() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((message: string) => {
    setToast(message);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { toast, show };
}

/**
 * iOS-style screen header: a back affordance on the left, a centred title, and
 * an optional trailing control. The side slots are fixed width so the title
 * stays optically centred whatever the trailing control is.
 */
export function ScreenNav({
  title,
  onBack,
  backLabel,
  trailing,
}: {
  title: string;
  onBack: () => void;
  backLabel?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-(--inv-hairline) bg-(--inv-canvas)/95 px-2 py-2 backdrop-blur">
      <button
        type="button"
        onClick={onBack}
        className={`ui-press flex min-w-[64px] items-center gap-1 rounded-(--inv-radius) px-2 text-[15px] font-medium text-(--inv-action) ${TAP}`}
      >
        {backLabel ? backLabel : <ChevronLeft className="h-6 w-6" strokeWidth={2} />}
      </button>
      <h1 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-(--inv-heading)">
        {title}
      </h1>
      <div className="flex min-w-[64px] justify-end">{trailing}</div>
    </div>
  );
}

/** Eyebrow + card, the grouped-inset form pattern. */
export function FormGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-[22px]">
      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
        {label}
      </p>
      <div className="overflow-hidden rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface)">
        {children}
      </div>
    </div>
  );
}

/**
 * One 50px form row: label in a fixed left column, value right-aligned, and the
 * unit in its own fixed column so every row's numbers line up down the card.
 */
export function FormRow({
  label,
  children,
  suffix,
  onPress,
  divider = true,
}: {
  label: string;
  children: ReactNode;
  suffix?: string;
  onPress?: () => void;
  divider?: boolean;
}) {
  const body = (
    <div className={`flex min-h-[50px] items-center gap-3 px-3 ${divider ? "border-b border-(--inv-hairline)" : ""}`}>
      <span className="w-[38%] shrink-0 truncate text-[15px] text-(--inv-body)">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
      {suffix !== undefined && (
        <span className="w-[68px] shrink-0 text-right text-[13px] text-(--inv-muted)">{suffix}</span>
      )}
    </div>
  );
  if (!onPress) return body;
  return (
    <button type="button" onClick={onPress} className="ui-press block w-full text-left">
      {body}
    </button>
  );
}
