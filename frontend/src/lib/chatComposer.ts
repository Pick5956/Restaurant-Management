import { useCallback, useLayoutEffect, useRef, useState } from "react";

// The chat box that grows with what is being typed, and opens taller on demand.
//
// Both chat surfaces pinned the field to one line: the assistant page used
// `<textarea rows={1}>` with a `max-h-40` that never applied (a textarea keeps
// the height its `rows` gives it unless something sets it), and the floating
// chat used a plain `<input>`, which cannot wrap at all. On a phone a long
// sentence scrolled sideways out of view, so the owner could not read back what
// they had written before sending it.

/** Tallest the field grows on its own, in pixels. Matches Tailwind's max-h-40. */
export const COMPOSER_COLLAPSED_MAX_PX = 160;

/** Share of the window the expanded field may take. */
export const COMPOSER_EXPANDED_VIEWPORT_RATIO = 0.55;

/**
 * The expand button appears once the text is taller than the collapsed field.
 *
 * It is the collapsed cap itself, not something lower: below the cap the field
 * already shows every line, so pressing expand would change nothing on screen
 * and the button would look broken.
 */
export const COMPOSER_EXPAND_THRESHOLD_PX = COMPOSER_COLLAPSED_MAX_PX;

/**
 * composerHeight is how tall the field should be for the content it holds.
 *
 * Collapsed it grows with the text up to a few lines, then scrolls inside.
 * Expanded it may take a little over half the window — enough to read a long
 * message whole, never so much that the conversation above it disappears.
 */
export function composerHeight(scrollHeight: number, expanded: boolean, viewportHeight: number): number {
  const cap = expanded
    ? Math.max(COMPOSER_COLLAPSED_MAX_PX, Math.round(viewportHeight * COMPOSER_EXPANDED_VIEWPORT_RATIO))
    : COMPOSER_COLLAPSED_MAX_PX;
  return Math.min(Math.max(scrollHeight, 0), cap);
}

/**
 * composerCanExpand reports whether the expand button is worth showing.
 *
 * It appears once the text no longer fits the collapsed field, so pressing it
 * actually reveals hidden lines. A button that is always there is one more
 * thing in a crowded row on a phone, and expanding a two-word question shows
 * nothing new.
 */
export function composerCanExpand(scrollHeight: number): boolean {
  return scrollHeight > COMPOSER_EXPAND_THRESHOLD_PX;
}

/**
 * useAutoGrowTextarea keeps a textarea's height in step with its content.
 *
 * The height is set from scrollHeight rather than from a line count because the
 * text wraps: one long Thai sentence with no spaces is several visual lines and
 * no newlines at all. Measuring after a reset to "auto" is what lets the field
 * shrink again when text is deleted.
 */
export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Reset first: scrollHeight of an element already sized to its content
    // reports that size, so without this the field could only ever grow.
    el.style.height = "auto";
    const viewport = typeof window === "undefined" ? 0 : window.innerHeight;
    setCanExpand(composerCanExpand(el.scrollHeight));
    el.style.height = `${composerHeight(el.scrollHeight, expanded, viewport)}px`;
  }, [expanded]);

  useLayoutEffect(() => {
    measure();
  }, [measure, value]);

  // An emptied field collapses back, and so does the expanded state: leaving it
  // open after sending would cover the answer that just arrived.
  //
  // Adjusted during render rather than in an effect. An effect would render the
  // expanded composer once, then immediately render it again collapsed - the
  // flash React documents this pattern to avoid, and what
  // `react-hooks/set-state-in-effect` is pointing at.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value === "") setExpanded(false);
  }

  return { ref, expanded, setExpanded, canExpand };
}
