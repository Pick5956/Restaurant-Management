import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { listOrders } from '@/src/api/order';
import { listTables, listTableZones } from '@/src/api/table';
import { useOrderEvents } from '@/src/hooks/use-order-events';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { activeOrderTableIds } from '@/src/lib/table-plan';
import { planDeepLink, planDeepLinkKey, type PlanDeepLink } from '@/src/lib/table-plan-screen';
import type { RestaurantTable, TableZone } from '@/src/types/table';

// The table-management floor's data: the tables, the zones, and which tables
// have an active order on them (the lock and the in-use count both read it).
//
// Loads on focus, again after an order event (debounced) and every 30 s while
// the screen is focused - quietly, with no spinner and no control. A reload
// never touches a sheet's form: the sheets keep their own drafts and only
// re-read the row. A later background failure keeps the floor as it is.

const QUIET_POLL_MS = 30_000;
const ORDER_EVENT_DEBOUNCE_MS = 400;

export type TablePlanStatus = 'loading' | 'ready' | 'failed';

type Update<T> = T | ((current: T) => T);

export type TablePlan = {
  tables: RestaurantTable[];
  zones: TableZone[];
  /**
   * Tables with an active order, or null when the orders cannot be read (no
   * permission, or no call has answered yet). A later failed call keeps the
   * last set, so a dropped request never unlocks a table in service.
   */
  activeOrderIds: ReadonlySet<number> | null;
  status: TablePlanStatus;
  /** What the first load failed with; later failures are kept quiet. */
  loadError: unknown;
  /** A quiet reload. */
  reload: () => Promise<void>;
  /** The first load again, after it failed. */
  retry: () => Promise<void>;
  /** Pull to refresh. */
  refresh: () => Promise<void>;
  /** Replace the tables with what a mutation returned; any load already in flight is dropped. */
  setTables: (update: Update<RestaurantTable[]>) => void;
  setZones: (update: Update<TableZone[]>) => void;
  /**
   * While on, loads leave the zones alone: a zone reorder shown ahead of its
   * save must not be put back by a quiet reload before the save lands.
   */
  holdZones: (hold: boolean) => void;
};

export function useTablePlan({
  enabled,
  canSeeOrders,
  restaurantId,
}: {
  /** view_tables or manage_table: without either nothing is requested. */
  enabled: boolean;
  /** view_orders or take_order: the only members GET /orders?status=active answers. */
  canSeeOrders: boolean;
  restaurantId: number | null;
}): TablePlan {
  const isFocused = useIsFocused();
  const [tables, setTableState] = useState<RestaurantTable[]>([]);
  const [zones, setZoneState] = useState<TableZone[]>([]);
  const [activeOrderIds, setActiveOrderIds] = useState<ReadonlySet<number> | null>(null);
  const [status, setStatus] = useState<TablePlanStatus>(enabled ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState<unknown>(null);
  const generationRef = useRef(createRequestGeneration());
  const loadedRef = useRef(false);
  const zoneHoldRef = useRef(false);

  // A different restaurant is a different floor.
  useEffect(() => {
    loadedRef.current = false;
    zoneHoldRef.current = false;
    generationRef.current.invalidate();
    setTableState([]);
    setZoneState([]);
    setActiveOrderIds(null);
    setStatus(enabled ? 'loading' : 'ready');
    setLoadError(null);
  }, [enabled, restaurantId]);

  const load = useCallback(async () => {
    if (!enabled) {
      setStatus('ready');
      return;
    }
    const request = generationRef.current.begin();
    if (!loadedRef.current) setStatus('loading');
    try {
      const [tableResponse, zoneResponse, orderResponse] = await Promise.all([
        listTables(),
        listTableZones(),
        canSeeOrders ? listOrders({ status: 'active', limit: 200 }).catch(() => null) : Promise.resolve(null),
      ]);
      if (!generationRef.current.isCurrent(request)) return;
      setTableState(tableResponse.tables ?? []);
      if (!zoneHoldRef.current) setZoneState(zoneResponse.zones ?? []);
      // Without the orders the statuses fall back to the column, silently. A
      // failed call keeps the set it had: the lock only ever loosens on an answer.
      if (orderResponse) setActiveOrderIds(activeOrderTableIds(orderResponse.orders ?? []));
      else if (!canSeeOrders) setActiveOrderIds(null);
      loadedRef.current = true;
      setStatus('ready');
      setLoadError(null);
    } catch (error) {
      if (!generationRef.current.isCurrent(request)) return;
      if (loadedRef.current) return;
      setLoadError(error);
      setStatus('failed');
    }
  }, [canSeeOrders, enabled]);

  const loadRef = useRef(load);
  loadRef.current = load;
  // An order event waits a moment before the floor reloads (see onOrderEvents).
  const eventTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(useCallback(() => {
    void loadRef.current();
    const timer = setInterval(() => {
      void loadRef.current();
    }, QUIET_POLL_MS);
    return () => {
      clearInterval(timer);
      // An event just before leaving must not load a screen nobody is looking at.
      if (eventTimerRef.current) clearTimeout(eventTimerRef.current);
      eventTimerRef.current = null;
      generationRef.current.invalidate();
    };
  }, [canSeeOrders, enabled, restaurantId]));

  // An order opening or closing locks or frees a table: the floor follows.
  const onOrderEvents = useCallback(() => {
    if (eventTimerRef.current) clearTimeout(eventTimerRef.current);
    eventTimerRef.current = setTimeout(() => {
      eventTimerRef.current = null;
      void loadRef.current();
    }, ORDER_EVENT_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => {
    if (eventTimerRef.current) clearTimeout(eventTimerRef.current);
  }, []);
  useOrderEvents(onOrderEvents, {
    enabled: enabled && isFocused && canSeeOrders && Boolean(restaurantId),
    restaurantId,
  });

  const setTables = useCallback((update: Update<RestaurantTable[]>) => {
    // A mutation's answer is newer than whatever a load in flight will bring.
    generationRef.current.invalidate();
    setTableState(update);
  }, []);
  const setZones = useCallback((update: Update<TableZone[]>) => {
    generationRef.current.invalidate();
    setZoneState(update);
  }, []);
  const holdZones = useCallback((hold: boolean) => {
    zoneHoldRef.current = hold;
  }, []);

  const retry = useCallback(async () => {
    setStatus('loading');
    await loadRef.current();
  }, []);

  return {
    tables,
    zones,
    activeOrderIds,
    status,
    loadError,
    reload: load,
    retry,
    refresh: load,
    setTables,
    setZones,
    holdZones,
  };
}

/**
 * Acts on the route's link once the floor has loaded, then clears it from the
 * route so coming back to the screen does not open the sheet a second time.
 */
export function usePlanDeepLink(ready: boolean, onLink: (link: Exclude<PlanDeepLink, null>) => void) {
  const params = useLocalSearchParams<{ table?: string; add?: string }>();
  const link = planDeepLink(params);
  const key = planDeepLinkKey(link);
  const handledRef = useRef<string | null>(null);
  const onLinkRef = useRef(onLink);
  onLinkRef.current = onLink;
  useEffect(() => {
    if (!ready || !link || !key || handledRef.current === key) return;
    handledRef.current = key;
    onLinkRef.current(link);
    router.setParams({ table: undefined, add: undefined });
    // `key` stands for `link`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
}
