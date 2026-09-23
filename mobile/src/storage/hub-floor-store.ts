import * as SecureStore from 'expo-secure-store';

import {
  parseRememberedFloors,
  rememberFloor,
  serializeRememberedFloors,
  type RememberedFloors,
} from '@/src/lib/hub-stage-layout';

// The table count each restaurant's floor last showed, for the Stage floor
// bone. Read synchronously once per session, so the very first frame of a cold
// start already has the strip's height; written in the background when a floor
// lands with a different count. A failed read or write only costs the bone its
// exact height, never the screen.

const HUB_FLOOR_TABLES_KEY = 'hub_floor_tables';

let remembered: RememberedFloors | null = null;

function load(): RememberedFloors {
  if (remembered) return remembered;
  let raw: string | null = null;
  try {
    raw = SecureStore.getItem(HUB_FLOOR_TABLES_KEY);
  } catch {
    raw = null;
  }
  remembered = parseRememberedFloors(raw);
  return remembered;
}

/** The table count this restaurant's floor last showed on this device, or null. */
export function readLastFloorTables(restaurantId: number): number | null {
  return load().get(restaurantId) ?? null;
}

export function writeLastFloorTables(restaurantId: number, tables: number): void {
  const current = load();
  const newest = [...current.keys()].at(-1);
  if (current.get(restaurantId) === tables && newest === restaurantId) return;
  const next = rememberFloor(current, restaurantId, tables);
  remembered = next;
  SecureStore.setItemAsync(HUB_FLOOR_TABLES_KEY, serializeRememberedFloors(next)).catch(() => {
    // Storage unavailable: the count lives for this session only.
  });
}
