"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => 1 - Math.pow(1 - t, 3);

// Runs `read` once a frame at most while the page scrolls or resizes.
function useScrollFrame(read: () => void) {
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  useEffect(() => {
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => latest.current());
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
}

/**
 * 0 → 1 while a tall wrapper scrolls past the sticky screen inside it: 0 when
 * its top meets the top of the window, 1 when its bottom meets the bottom.
 */
export function useStickyProgress(ref: RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useScrollFrame(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const span = r.height - window.innerHeight;
    setP(span > 0 ? clamp(-r.top / span) : 0);
  });
  return p;
}

/** 0 at the top of the page, 1 at the bottom. */
export function useDocProgress() {
  const [g, setG] = useState(0);
  useScrollFrame(() => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    setG(max > 0 ? clamp(window.scrollY / max) : 0);
  });
  return g;
}

/** Rises and sharpens into place the first time it comes into view. */
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
      className={`transition-[opacity,transform,filter] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100 blur-0" : "translate-y-10 opacity-0 blur-[4px] motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:blur-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}
