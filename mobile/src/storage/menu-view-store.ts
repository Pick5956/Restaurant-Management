import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

import {
  DEFAULT_MENU_VIEW_MODE,
  parseMenuViewMode,
  type MenuViewMode,
} from '@/src/lib/menu-view-mode';

// How the order screen lays its menu out, picked with the view button in the
// menu's filter row. Per device, not per account or restaurant: it is how the
// person holding this phone reads a menu. One value for the whole app, held
// here and handed out through useSyncExternalStore, so the button, the grid
// and an order screen further down the stack never disagree about it.
//
// Read synchronously once per session, the first time anything asks, so an
// order screen's very first frame is already in the saved layout instead of
// drawing photo tiles and then jumping to rows. Written in the background on
// change. A failed read or write only costs the choice surviving a restart.

const MENU_VIEW_MODE_KEY = 'dishy_menu_view_mode';

let current: MenuViewMode = DEFAULT_MENU_VIEW_MODE;
let loaded = false;
let persisting = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  let raw: string | null = null;
  try {
    raw = SecureStore.getItem(MENU_VIEW_MODE_KEY);
  } catch {
    raw = null;
  }
  current = parseMenuViewMode(raw);
}

function getSnapshot(): MenuViewMode {
  load();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One write at a time, always finishing on the newest choice. Native writes are
 * not guaranteed to land in the order they were sent, and three quick taps
 * through the modes must not leave the second one on disk.
 */
function persist(): void {
  if (persisting) return;
  persisting = true;
  const value = current;
  SecureStore.setItemAsync(MENU_VIEW_MODE_KEY, value)
    .catch(() => {
      // Storage unavailable: the choice lives for this session only.
    })
    .finally(() => {
      persisting = false;
      if (current !== value) persist();
    });
}

function setMenuViewMode(next: MenuViewMode): void {
  // Settle the saved value first, so a first read that has not happened yet
  // cannot later overwrite what was just chosen.
  load();
  const mode = parseMenuViewMode(next);
  if (mode === current) return;
  current = mode;
  for (const listener of [...listeners]) listener();
  persist();
}

/**
 * The menu layout this device uses on the order screen, and the setter the view
 * button calls. Every caller shares one value; the setter keeps its identity
 * across renders.
 */
export function useMenuViewMode(): readonly [MenuViewMode, (next: MenuViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, getSnapshot);
  return [mode, setMenuViewMode] as const;
}
