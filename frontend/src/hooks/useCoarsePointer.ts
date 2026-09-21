"use client";

import { useSyncExternalStore } from "react";

const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(COARSE_POINTER_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/**
 * True when the primary pointer is a finger: phones and tablets. Shared form
 * controls use it to hand the choosing over to the operating system's own
 * picker - the iOS menu or wheel, the Android dialog - instead of a menu we
 * draw. A laptop with a touch screen still reports its mouse as primary, so it
 * keeps the desktop menu.
 *
 * Server rendering and hydration read false, so the markup always matches; a
 * touch device switches to the native control in the render right after.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COARSE_POINTER_QUERY).matches,
    () => false,
  );
}
