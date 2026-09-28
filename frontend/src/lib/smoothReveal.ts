"use client";

import { useCallback, useEffect, useState } from "react";

// Smooth typing for a streamed answer.
//
// The model's stream arrives in bursts - Gemini sends the answer in pieces of a
// few dozen characters about a third of a second apart - and painting each piece
// the moment it lands made the reply jump forward a line at a time (owner, 28
// ก.ย. 2569: "ค่อย ๆ พิมพ์ออกมาให้ลื่นขึ้น"). Here what has arrived is revealed
// at a steady pace instead: the backlog drains smoothly, faster when it is long,
// never slower than a floor, so the text keeps moving between bursts.
//
// Counting is by grapheme, not by UTF-16 unit, so a Thai vowel or tone mark
// never shows on its own before the consonant it sits on.

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("th", { granularity: "grapheme" })
    : null;

/** The text split into user-perceived characters. */
export function graphemes(text: string): string[] {
  if (!segmenter) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** How long the backlog takes to shrink by about two thirds, in ms. */
export const REVEAL_TIME_CONSTANT_MS = 350;
/** The slowest the text ever moves while there is more to show. */
export const REVEAL_MIN_PER_SECOND = 40;

/**
 * How far the reveal moves in one frame: a share of the backlog (so a long
 * backlog drains quickly) or the floor rate, whichever is more, and never past
 * what has arrived.
 */
export function revealStep(backlog: number, elapsedMs: number): number {
  if (backlog <= 0 || elapsedMs <= 0) return 0;
  const share = backlog * (1 - Math.exp(-elapsedMs / REVEAL_TIME_CONSTANT_MS));
  const floor = (REVEAL_MIN_PER_SECOND * elapsedMs) / 1000;
  return Math.min(backlog, Math.max(share, floor));
}

/**
 * A partial answer may stop inside bold: "ยอดขาย **93,5". The markdown renderer
 * would print the lone "**" until the closing pair arrives, so an unmatched
 * trailing marker is held back.
 */
export function tidyPartialMarkdown(text: string): string {
  const markers = text.match(/\*\*/g)?.length ?? 0;
  if (markers % 2 === 0) return text;
  const last = text.lastIndexOf("**");
  return text.slice(0, last) + text.slice(last + 2);
}

/** The longest start two texts share, counted in graphemes. */
function sharedPrefix(a: string[], b: string[]): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  return at;
}

/** The longest a finished answer waits for the reveal to catch up, in ms. */
export const SETTLE_MAX_MS = 700;

type RevealEngine = {
  aim: (text: string) => void;
  clear: () => void;
  settle: (final: string) => Promise<void>;
  dispose: () => void;
};

/**
 * The frame loop, kept outside React: everything it counts lives in this
 * closure, and React only hears the text to paint.
 */
function createRevealEngine(paint: (text: string | null) => void): RevealEngine {
  let target: string[] = [];
  let position = 0;
  let frame: number | null = null;
  let lastTick = 0;
  let waiters: Array<() => void> = [];

  const release = () => {
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve());
  };

  const tick = (now: number) => {
    const total = target.length;
    const elapsed = lastTick ? Math.min(now - lastTick, 100) : 16;
    lastTick = now;
    position += revealStep(total - position, elapsed);
    const count = Math.min(total, Math.floor(position));
    paint(tidyPartialMarkdown(target.slice(0, count).join("")));
    if (count >= total) {
      frame = null;
      lastTick = 0;
      release();
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastTick = 0;
  };

  return {
    aim(text) {
      const next = graphemes(text);
      // A draft is normally the previous one plus more; if it was rewritten
      // (cleaned, reformatted), carry on from where the two still agree.
      position = Math.min(position, sharedPrefix(target, next));
      target = next;
      if (frame === null) frame = requestAnimationFrame(tick);
    },
    clear() {
      stop();
      target = [];
      position = 0;
      paint(null);
      release();
    },
    settle(final) {
      // Nothing streamed: there is no draft on screen to hand over from.
      if (target.length === 0) return Promise.resolve();
      this.aim(final);
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SETTLE_MAX_MS);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    dispose() {
      stop();
      release();
    },
  };
}

/**
 * Follows `target` (the draft so far, null when there is none) and returns the
 * part of it to show now, plus `settle(final)`: aim the reveal at the finished
 * answer and resolve once it is fully shown (or SETTLE_MAX_MS passed), so the
 * caller can swap the draft for the real message without a jump.
 */
export function useSmoothReveal(target: string | null): { text: string | null; settle: (final: string) => Promise<void> } {
  const [shown, setShown] = useState<string | null>(null);
  const [engine] = useState(() => createRevealEngine(setShown));

  useEffect(() => {
    if (target === null) engine.clear();
    else engine.aim(target);
  }, [target, engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  const settle = useCallback((final: string) => engine.settle(final), [engine]);
  return { text: shown, settle };
}
