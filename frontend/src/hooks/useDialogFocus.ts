"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Where Tab has to land so focus never walks out of a dialog into the page
 * behind its backdrop: wrap at both ends, and pull focus back in when it has
 * already escaped (`activeIndex` -1). Null means the browser's own move is
 * already right.
 */
export function trappedFocusIndex(count: number, activeIndex: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (activeIndex < 0) return backwards ? count - 1 : 0;
  if (backwards && activeIndex === 0) return count - 1;
  if (!backwards && activeIndex === count - 1) return 0;
  return null;
}

type DialogFocusOptions = {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  /** Escape. The caller decides whether closing is allowed right now - not
   *  while a save is in flight. */
  onEscape: () => void;
  /** Focused when the dialog opens; the first focusable control otherwise. */
  initialFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * The keyboard half of a dashboard modal (docs/design-guidelines.md §3.10):
 * focus moves in on open, Tab stays inside, Escape closes, focus goes back to
 * whatever opened it, and the page behind does not scroll. The visual half -
 * backdrop, motion classes, useBackdropClose - stays with the caller, so every
 * modal keeps the shared look it already has.
 */
export function useDialogFocus({ open, containerRef, onEscape, initialFocusRef }: DialogFocusOptions) {
  // Read through a ref so a new callback identity on every render does not
  // re-run the effect, which would pull focus back to the start mid-typing.
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A frame late: the panel is mid-animation and not focusable on the tick
    // it mounts.
    const timer = window.setTimeout(() => {
      const target = initialFocusRef?.current ?? containerRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const next = trappedFocusIndex(items.length, active ? items.indexOf(active) : -1, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, containerRef, initialFocusRef]);
}
