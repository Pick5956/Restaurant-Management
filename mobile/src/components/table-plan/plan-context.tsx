import * as Haptics from 'expo-haptics';
import { createContext, useContext } from 'react';
import { LayoutAnimation } from 'react-native';

import type { TablePlanApi } from '@/src/components/table-plan/plan-actions';
import type { TableFailure } from '@/src/lib/table-error';
import type { ActiveOrderIds, PlanLanguage } from '@/src/lib/table-plan';
import type { RestaurantTable, TableZone } from '@/src/types/table';

// What every body in the table-management section reads from the screen: the
// floor's data, the one door to the server (`api`), and the ways a result
// shows - a failure through `report`, a success on the floor itself (`flash`)
// and to a screen reader (`announce`). The bodies are the same on a phone
// sheet and in the tablet inspector, so none of them knows which it is in.

export type PlanHighlightKind = 'flash' | 'ring';

type Update<T> = T | ((current: T) => T);

export type PlanEnv = {
  language: PlanLanguage;
  t: (th: string, en: string) => string;
  api: TablePlanApi;
  tables: RestaurantTable[];
  zones: TableZone[];
  activeOrderIds: ActiveOrderIds;
  /** A failed step: the Alert, and whatever reload the failure asks for. */
  report: (failure: TableFailure) => void;
  reload: () => Promise<void>;
  setTables: (update: Update<RestaurantTable[]>) => void;
  setZones: (update: Update<TableZone[]>) => void;
  /** A saved tile flashes where it now sits; a new one wears a fading ring. */
  flash: (ids: readonly number[], kind: PlanHighlightKind) => void;
  /** Said to VoiceOver/TalkBack; a success is not drawn. */
  announce: (message: string) => void;
  /** A body mid-request: the sheet ignores close until it settles. */
  setBusy: (busy: boolean) => void;
  /** A body holding unsaved changes: the tablet asks before swapping it for another. */
  setDirty: (dirty: boolean) => void;
  /** One ↑/↓ tap in the room sheet, committed after a pause. */
  reorderZone: (id: number, delta: -1 | 1) => void;
};

const PlanContext = createContext<PlanEnv | null>(null);

export const PlanProvider = PlanContext.Provider;

export function usePlanEnv(): PlanEnv {
  const env = useContext(PlanContext);
  if (!env) throw new Error('usePlanEnv must be used inside PlanProvider');
  return env;
}

/** A row the server returned, over the one held: fields the answer leaves out (the booking, the preloaded zone) keep their values. */
export function mergeTableRow(tables: readonly RestaurantTable[], row: RestaurantTable): RestaurantTable[] {
  return tables.map((table) => (table.ID === row.ID ? { ...table, ...row } : table));
}

/**
 * A row PATCH move-zone returned: renumbered and in its new zone. The zone
 * preloaded on the old row would otherwise ride along, so the target is set
 * on it unless the answer carried its own.
 */
export function adoptMovedRow(tables: readonly RestaurantTable[], row: RestaurantTable, target: TableZone | null): RestaurantTable[] {
  return tables.map((table) => (table.ID === row.ID
    ? { ...table, ...row, table_zone: row.table_zone ?? target }
    : table));
}

/** Moves and deletes animate into place on a floor small enough to afford it. */
export const LAYOUT_ANIMATION_MAX_TABLES = 60;

export function animateFloorChange(tableCount: number) {
  if (tableCount > LAYOUT_ANIMATION_MAX_TABLES) return;
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
}

export function hapticSelect() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function hapticSuccess() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
