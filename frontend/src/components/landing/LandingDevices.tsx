"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { WEB_MOCKS } from "./LandingWebMocks";

// An iPhone at the screenshots' own 923×2000 proportions: thin bezel, no drawn
// status bar, since the screenshot carries its own.
export function Phone({ src, alt, className = "", style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  return (
    <PhoneFrame className={className} style={style}>
      <PhoneShot src={src} alt={alt} />
    </PhoneFrame>
  );
}

/**
 * One phone, several screens. Moving to a later screen pushes it in from the
 * right over the one before, which slides a little left and darkens — the way
 * a page opens in the app itself; going back runs it in reverse (28 ก.ย. 2569).
 */
export function PhoneScreens({ shots, active }: { shots: { src: string; alt: string }[]; active: number }) {
  return (
    <PhoneFrame>
      {shots.map((shot, i) => (
        <div
          key={shot.src}
          aria-hidden={i !== active}
          className={`absolute inset-0 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none ${
            i < active ? "-translate-x-1/4" : i > active ? "translate-x-full" : "translate-x-0"
          } ${i > 0 ? "shadow-[-12px_0_24px_rgba(0,0,0,0.25)]" : ""}`}
          style={{ zIndex: i }}
        >
          <PhoneShot src={shot.src} alt={shot.alt} />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 bg-black transition-opacity duration-700 ${i < active ? "opacity-30" : "opacity-0"}`}
          />
        </div>
      ))}
    </PhoneFrame>
  );
}

function PhoneFrame({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      style={style}
      className={`relative aspect-[923/2000] rounded-[15%/7%] bg-[#1c1c1e] p-[2.4%] shadow-[0_50px_100px_-30px_rgba(0,0,0,0.45)] ring-1 ring-black/20 ${className}`}
    >
      <div className="relative h-full overflow-hidden rounded-[13%/6%] bg-white">
        {children}
        {/* The camera stays put above every screen, even one sliding past. */}
        <div aria-hidden="true" className="absolute left-1/2 top-[1.3%] z-50 h-[3.1%] w-[30%] -translate-x-1/2 rounded-full bg-black" />
      </div>
    </div>
  );
}

function PhoneShot({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="h-full w-full object-cover object-top" draggable={false} />;
}

// An iPad held landscape. It runs the web, not an app, so it shows a web page.
export function Tablet({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[4.5%/6.4%] bg-[#1c1c1e] p-[1.8%] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.85)] ring-1 ring-white/15">
      <div className="relative aspect-[1194/834] overflow-hidden rounded-[3%/4.3%] bg-[#fbf7f2]">{children}</div>
    </div>
  );
}

// A browser window. The address bar is a shape only, with no address in it.
// With `tabs`, the page picker takes the bar's place, so the pages and the way
// to switch them are always on screen together.
export function Browser({ tabs, children }: { tabs?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] bg-[#1c1c1e] shadow-[0_60px_120px_-30px_rgba(0,0,0,0.85)] ring-1 ring-white/10">
      <div className={`flex items-center gap-3 border-b border-white/5 px-3 sm:px-4 ${tabs ? "h-12" : "h-9"}`}>
        <div aria-hidden="true" className={`flex shrink-0 gap-1.5 ${tabs ? "max-sm:hidden" : ""}`}>
          {["#ff5f57", "#febc2e", "#28c840"].map((color) => (
            <span key={color} className="h-3 w-3 rounded-full" style={{ background: color }} />
          ))}
        </div>
        {tabs ? (
          <div className="soft-scrollbar-hide min-w-0 flex-1 overflow-x-auto sm:ml-3">{tabs}</div>
        ) : (
          <>
            <div aria-hidden="true" className="mx-auto h-6 w-1/2 max-w-sm rounded-md bg-white/[0.06]" />
            <div className="w-[52px] max-sm:hidden" />
          </>
        )}
      </div>
      {/* 16:9, the shape of the 1920×1080 screenshots in public/landing, so
          none of a screenshot is cut off at the sides. */}
      <div className="relative aspect-video bg-[#161618]">{children}</div>
    </div>
  );
}

// Lays a 1280×800 drawing out at full size and scales it to its frame. It is
// a picture of a page, so assistive tech gets one label, not the fake UI.
function Scaled({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1280));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} role="img" aria-label={label} className="absolute inset-0 overflow-hidden">
      <div aria-hidden="true" style={{ width: 1280, height: 800, transform: `scale(${scale})`, transformOrigin: "0 0" }}>{children}</div>
    </div>
  );
}

function useImageReady(src: string) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const probe = new window.Image();
    probe.onload = () => setReady(true);
    probe.src = src;
  }, [src]);
  return ready;
}

/**
 * A screen of the web app: the real screenshot at public/landing/<file> once
 * one is there, the drawn stand-in for that file until then. The file is
 * probed first, so a missing one never shows a broken-image icon.
 */
export function WebShot({ file, alt }: { file: string; alt: string }) {
  const src = `/landing/${file}`;
  const ready = useImageReady(src);
  if (ready) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className="h-full w-full object-cover object-top" draggable={false} />;
  }
  const Mock = WEB_MOCKS[file];
  return Mock ? <Scaled label={alt}><Mock /></Scaled> : <div role="img" aria-label={alt} className="h-full w-full bg-[#161618]" />;
}
