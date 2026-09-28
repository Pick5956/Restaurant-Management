"use client";

import { smoothScroll } from "@/src/hooks/smoothScroll";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Calls `apply` every time the page moves — on scroll, on resize, on each
 * step of the wheel glide — and after every render. `apply` writes styles
 * straight onto elements. It used to set React state once a frame, which drew
 * the whole page again on every frame of a scroll and put the moving pictures
 * a frame behind the page, so they shuddered as they rose (28 ก.ย. 2569).
 */
export function useScrollDriven(apply: () => void) {
  const latest = useRef(apply);
  useLayoutEffect(() => {
    latest.current = apply;
    apply();
  });
  useEffect(() => {
    const on = () => latest.current();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    // The wheel glides and coasts here the way it does on every dashboard
    // page (ShellScroll). The landing page scrolls the window, not a box, so
    // the root element takes it.
    const stopGlide = smoothScroll(document.documentElement, on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      stopGlide?.();
    };
  }, []);
}

/**
 * 0 → 1 while a tall wrapper scrolls past the sticky screen inside it: 0 when
 * its top meets the top of the window, 1 when its bottom meets the bottom.
 */
export function stickyProgress(el: HTMLElement | null) {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const span = r.height - window.innerHeight;
  return span > 0 ? clamp(-r.top / span) : 0;
}

/**
 * Like stickyProgress, but starting the moment the wrapper's top comes up
 * over the bottom of the window, so what it holds can arrive while it scrolls
 * in instead of leaving a black screen until it reaches the top.
 */
export function enterProgress(el: HTMLElement | null) {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  return clamp((window.innerHeight - r.top) / r.height);
}

/** 0 at the top of the page, 1 at the bottom. */
export function docProgress() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? clamp(window.scrollY / max) : 0;
}

/** Rises into place the first time it comes into view. */
export function FadeUp({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShown(true);
        io.disconnect();
      }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      // No blur: blurring the big web screenshot for a whole second made it
      // crawl up in steps instead of gliding (28 ก.ย. 2569).
      className={`transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100"
      } ${className}`}
    >
      {children}
    </div>
  );
}
