"use client";

import * as React from "react";

// Animated "Siri-style" orb — a self-contained conic-gradient sphere that slowly
// rotates. Pure CSS (no dependencies). Warm orange/amber defaults so it matches
// the app theme; pass `colors` to override. Used as the assistant avatar and the
// empty-state centerpiece.

function cn(...classes: Array<string | undefined | null | false>) {
  return classes.filter(Boolean).join(" ");
}

// Every frame the orb repaints six conic gradients through a blur + contrast
// filter, with a backdrop-filter layer over them. On an iPhone that competed
// with scrolling: the expenses page stuttered with the floating orb in the
// corner (19 ก.ย. 2569). While anything on the page scrolls, <html> carries
// data-scrolling and every orb holds still; it turns again 180ms after the
// scroll stops. One listener for all orbs, added by the first one mounted.
const SCROLL_IDLE_MS = 180;
let scrollWatchers = 0;
let scrollIdleTimer: number | undefined;
function onAnyScroll() {
  const root = document.documentElement;
  if (!root.hasAttribute("data-scrolling")) root.setAttribute("data-scrolling", "");
  window.clearTimeout(scrollIdleTimer);
  scrollIdleTimer = window.setTimeout(() => root.removeAttribute("data-scrolling"), SCROLL_IDLE_MS);
}
function watchScrolling() {
  scrollWatchers += 1;
  // capture: also hears scrolls of inner scrollers (lists, sheets), which do
  // not bubble to window.
  if (scrollWatchers === 1) window.addEventListener("scroll", onAnyScroll, { passive: true, capture: true });
  return () => {
    scrollWatchers -= 1;
    if (scrollWatchers > 0) return;
    window.removeEventListener("scroll", onAnyScroll, { capture: true });
    window.clearTimeout(scrollIdleTimer);
    document.documentElement.removeAttribute("data-scrolling");
  };
}

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.008;
const BLUR_MIN_SMALL = 1;
const BLUR_MULTIPLIER_LARGE = 0.015;
const BLUR_MIN_LARGE = 4;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;

export interface SiriOrbProps {
  animationDuration?: number;
  className?: string;
  colors?: {
    bg?: string;
    c1?: string;
    c2?: string;
    c3?: string;
  };
  size?: string;
  /** True while the mic is listening — the orb glows and swirls faster. */
  active?: boolean;
  /** Voice loudness 0..1. Scales and brightens the orb while `active`. */
  level?: number;
  /** Hold still — for an orb that is mounted but off screen, e.g. inside a
   *  closed panel, where the turning costs a repaint every frame for nothing. */
  paused?: boolean;
}

export const SiriOrb: React.FC<SiriOrbProps> = ({
  size = "192px",
  className,
  colors,
  animationDuration = 20,
  active = false,
  level = 0,
  paused = false,
}) => {
  React.useEffect(watchScrolling, []);

  // Warm palette tuned to the app's orange/amber theme.
  const defaultColors = {
    bg: "oklch(97% 0.02 70)",
    c1: "oklch(78% 0.17 45)", // orange
    c2: "oklch(83% 0.15 80)", // amber
    c3: "oklch(72% 0.18 25)", // red-orange
  };

  const finalColors = { ...defaultColors, ...colors };

  const sizeValue = Number.parseInt(size.replace("px", ""), 10);

  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL)
      : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);

  const contrastAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL)
      : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);

  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL)
      : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);

  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL)
      : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);

  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return MASK_RADIUS_TINY;
    if (value < SIZE_THRESHOLD_SMALL) return MASK_RADIUS_SMALL;
    if (value < SIZE_THRESHOLD_MEDIUM) return MASK_RADIUS_MEDIUM;
    return MASK_RADIUS_LARGE;
  };

  const maskRadius = getMaskRadius(sizeValue);

  const getFinalContrast = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) return CONTRAST_TINY;
    if (value < SIZE_THRESHOLD_SMALL) {
      return Math.max(contrastAmount * CONTRAST_MULTIPLIER_FINAL, CONTRAST_MIN_FINAL);
    }
    return contrastAmount;
  };

  const finalContrast = getFinalContrast(sizeValue);

  // Voice reaction: a floor while listening (so it visibly wakes up even in a
  // quiet room) plus a loudness-driven swell/glow on top.
  const voiceLevel = active ? Math.min(1, Math.max(0, level)) : 0;
  const voiceScale = active ? 1.04 + voiceLevel * 0.14 : 1;
  const glowSpread = Math.round(sizeValue * (0.12 + voiceLevel * 0.3));
  const glowAlpha = (0.3 + voiceLevel * 0.45).toFixed(2);
  const spinDuration = active
    ? Math.max(3, animationDuration * (1 - voiceLevel * 0.6) * 0.35)
    : animationDuration;

  return (
    <div
      className={cn("siri-orb", className)}
      data-paused={paused ? "" : undefined}
      style={
        {
          width: size,
          height: size,
          transform: `translateZ(0) scale(${voiceScale})`,
          boxShadow: active ? `0 0 ${glowSpread}px rgba(249, 115, 22, ${glowAlpha})` : undefined,
          transition: "transform 90ms ease-out, box-shadow 140ms ease-out",
          "--bg": finalColors.bg,
          "--c1": finalColors.c1,
          "--c2": finalColors.c2,
          "--c3": finalColors.c3,
          "--animation-duration": `${spinDuration}s`,
          "--blur-amount": `${blurAmount}px`,
          "--contrast-amount": finalContrast,
          "--dot-size": `${dotSize}px`,
          "--shadow-spread": `${shadowSpread}px`,
          "--mask-radius": maskRadius,
        } as React.CSSProperties
      }
    >
      <style>{`
        @property --angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        .siri-orb {
          display: grid;
          grid-template-areas: "stack";
          overflow: hidden;
          border-radius: 50%;
          position: relative;
          /* Give each orb its own compositor layer so its continuous conic-gradient
             repaint stays isolated and never forces its parent (e.g. the floating
             chat panel) to re-raster while opening/closing. */
          transform: translateZ(0);
        }
        .siri-orb::before,
        .siri-orb::after {
          content: "";
          display: block;
          grid-area: stack;
          width: 100%;
          height: 100%;
          border-radius: 50%;
        }
        .siri-orb::before {
          background:
            conic-gradient(from calc(var(--angle) * 2) at 25% 70%, var(--c3), transparent 20% 80%, var(--c3)),
            conic-gradient(from calc(var(--angle) * 2) at 45% 75%, var(--c2), transparent 30% 60%, var(--c2)),
            conic-gradient(from calc(var(--angle) * -3) at 80% 20%, var(--c1), transparent 40% 60%, var(--c1)),
            conic-gradient(from calc(var(--angle) * 2) at 15% 5%, var(--c2), transparent 10% 90%, var(--c2)),
            conic-gradient(from calc(var(--angle) * 1) at 20% 80%, var(--c1), transparent 10% 90%, var(--c1)),
            conic-gradient(from calc(var(--angle) * -2) at 85% 10%, var(--c3), transparent 20% 80%, var(--c3));
          box-shadow: inset var(--bg) 0 0 var(--shadow-spread) calc(var(--shadow-spread) * 0.2);
          filter: blur(var(--blur-amount)) contrast(var(--contrast-amount));
          animation: siri-orb-rotate var(--animation-duration) linear infinite;
          /* iOS Safari does not clip this blurred, animated layer to the parent's
             rounded overflow (it is on its own compositor layer), so the square
             corners of the blur region show as an orange box behind the orb. A
             circular mask on the layer itself clips it reliably where the parent
             cannot. closest-side = the inscribed circle, matching border-radius:50%. */
          -webkit-mask-image: radial-gradient(circle closest-side, #000 98%, transparent 100%);
          mask-image: radial-gradient(circle closest-side, #000 98%, transparent 100%);
        }
        .siri-orb::after {
          background-image: radial-gradient(circle at center, var(--bg) var(--dot-size), transparent var(--dot-size));
          background-size: calc(var(--dot-size) * 2) calc(var(--dot-size) * 2);
          backdrop-filter: blur(calc(var(--blur-amount) * 2)) contrast(calc(var(--contrast-amount) * 2));
          mix-blend-mode: overlay;
        }
        .siri-orb[style*="--mask-radius: 0%"]::after { mask-image: none; }
        .siri-orb:not([style*="--mask-radius: 0%"])::after {
          mask-image: radial-gradient(black var(--mask-radius), transparent 75%);
        }
        @keyframes siri-orb-rotate { to { --angle: 360deg; } }
        .siri-orb[data-paused]::before,
        [data-orbs-paused] .siri-orb::before,
        html[data-scrolling] .siri-orb::before { animation-play-state: paused; }
        /* Keep the orb gently alive even under reduced-motion (decorative,
           slow rotation) instead of freezing it — the owner wants it moving. */
        @media (prefers-reduced-motion: reduce) {
          .siri-orb::before { animation-duration: calc(var(--animation-duration) * 1.6); }
        }
      `}</style>
    </div>
  );
};

export default SiriOrb;
