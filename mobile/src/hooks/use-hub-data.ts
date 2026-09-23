import { useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getProactiveInsights } from '@/src/api/ai';
import { listIngredients } from '@/src/api/ingredient';
import { listMenuItems } from '@/src/api/menu';
import { kitchenQueue, listOrders, loadDayOrders } from '@/src/api/order';
import { listTables } from '@/src/api/table';
import { useOrderEvents, type OrderEventBatch } from '@/src/hooks/use-order-events';
import { readSeenInsights } from '@/src/lib/ai-prefs';
import {
  HUB_HEAVY_LOADERS,
  HUB_LIGHT_LOADERS,
  HUB_LOADER_KEYS,
  HUB_ROW_LOADERS,
  HUB_TIMING,
  hubFloor,
  hubFocusLoad,
  hubHeldValueIsCurrent,
  hubInventoryStock,
  hubKitchen,
  hubLoadDecision,
  hubLoaderMinInterval,
  hubLoaderPlan,
  hubLoadersForEvents,
  hubMenuStock,
  hubPaidToday,
  hubPaidTodayRequest,
  hubPollLoaders,
  hubStaleDayLoaders,
  hubTakings,
  hubUnseenInsights,
  type HubLoaderClock,
  type HubLoaderKey,
  type HubLoaderPlan,
} from '@/src/lib/hub-data';
import type {
  HubData,
  HubFloor,
  HubInsights,
  HubInventoryStock,
  HubMenuStock,
  HubPaidToday,
  HubRowKey,
  HubSlot,
} from '@/src/lib/hub-types';
import { formatBangkokDate } from '@/src/lib/order-query';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import type { Order } from '@/src/types/order';

// The hub's data (hub-final.json, winner.fetchPlan). The hub is the root of the
// stack and never unmounts while pages are pushed over it, so every request,
// interval, timeout and the order stream starts on focus and stops on blur:
// nothing here runs underneath the kitchen or any other screen.
//
// Each loader owns its slot and keeps its last good value; there is no
// Promise.all gate, so a slow menu never holds back the floor. Light loaders
// (floor, kitchen, paid count, takings) reload on focus once 10 s old, and on
// every refocus whatever their age, since the stream was closed while the hub
// was covered (hubFocusLoad); heavy ones (menu, stock, AI) after interactions
// settle, once five minutes old - except what the page just visited can have
// changed (noteOpened), which reloads at once. Order events reload only what
// an action can move, each loader at most every 3 s (the day list every 15 s)
// with a trailing call.

/** About one stack pop; the heavy lists start once the hub is back on screen. */
const HEAVY_LOAD_DELAY_MS = 350;

type FetchContext = { today: string; seenScope: string };

type HubRaw = {
  /** The day list itself, so the clock tick can redraw the curve without a request. */
  takings: Order[];
  floor: HubFloor;
  /** The queue itself, so the clock tick can age the lanes without a request. */
  kitchen: Order[];
  paidToday: HubPaidToday;
  menu: HubMenuStock;
  inventory: HubInventoryStock;
  insights: HubInsights;
};

type LoaderEntry<K extends HubLoaderKey> = {
  status: 'loading' | 'ready' | 'error';
  raw: HubRaw[K] | null;
  /** The Bangkok day the value was asked for; a day value from an ended day is no value (hubHeldValueIsCurrent). */
  day: string | null;
};

type LoaderStates = { [K in HubLoaderKey]: LoaderEntry<K> };

type LoaderRuntime = {
  clock: HubLoaderClock;
  /** Run once more when the request in flight lands: a change arrived after it left. */
  trailing: boolean;
  trailingTimer: ReturnType<typeof setTimeout> | null;
  promise: Promise<void> | null;
};

type LoadOptions = {
  minAgeMs?: number;
  /** Ignore the value's age and the 3 s gap (pull-to-refresh, a retry, the page just visited). */
  force?: boolean;
  /** The request answers a change newer than one already in flight, so it must follow it. */
  afterChange?: boolean;
};

const FETCHERS: { [K in HubLoaderKey]: (context: FetchContext) => Promise<HubRaw[K]> } = {
  takings: async ({ today }) => (await loadDayOrders(today)).orders,
  // The pair app/tables.tsx loads.
  floor: async () => {
    const [tables, orders] = await Promise.all([listTables(), listOrders({ status: 'active', limit: 200 })]);
    return hubFloor(tables.tables || [], orders.orders || []);
  },
  kitchen: async () => (await kitchenQueue()).orders || [],
  paidToday: async ({ today }) => hubPaidToday(await listOrders(hubPaidTodayRequest(today))),
  menu: async () => hubMenuStock((await listMenuItems()).menu_items || []),
  inventory: async () => hubInventoryStock((await listIngredients()).ingredients || []),
  // The assistant screen's own unseen count: its insights against its seen list.
  insights: async ({ seenScope }) => {
    const [response, seen] = await Promise.all([getProactiveInsights(), readSeenInsights(seenScope)]);
    return hubUnseenInsights(response.insights ?? [], seen);
  },
};

function initialStates(): LoaderStates {
  return {
    takings: { status: 'loading', raw: null, day: null },
    floor: { status: 'loading', raw: null, day: null },
    kitchen: { status: 'loading', raw: null, day: null },
    paidToday: { status: 'loading', raw: null, day: null },
    menu: { status: 'loading', raw: null, day: null },
    inventory: { status: 'loading', raw: null, day: null },
    insights: { status: 'loading', raw: null, day: null },
  };
}

function freshRuntime(): Record<HubLoaderKey, LoaderRuntime> {
  const entries = HUB_LOADER_KEYS.map((key): [HubLoaderKey, LoaderRuntime] => [key, {
    clock: { loadedAt: null, loadedFrom: null, startedAt: null, inFlight: false },
    trailing: false,
    trailingTimer: null,
    promise: null,
  }]);
  return Object.fromEntries(entries) as Record<HubLoaderKey, LoaderRuntime>;
}

function clearTrailing(runtimes: Record<HubLoaderKey, LoaderRuntime>) {
  for (const key of HUB_LOADER_KEYS) {
    const runtime = runtimes[key];
    if (runtime.trailingTimer !== null) clearTimeout(runtime.trailingTimer);
    runtime.trailingTimer = null;
    runtime.trailing = false;
  }
}

/** The slots, stamped with the restaurant and person they belong to. */
type HubStore = { scope: string; entries: LoaderStates };

function withEntry<K extends HubLoaderKey>(store: HubStore, key: K, entry: LoaderEntry<K>): HubStore {
  return { ...store, entries: { ...store.entries, [key]: entry } };
}

/** Which loaders run for the active member; `takings` is also the owner's gate on showing the figure. */
export function useHubLoaderPlan(): HubLoaderPlan {
  const { activeMembership } = useAuth();
  return useMemo(() => hubLoaderPlan({
    can: (permission) => can(activeMembership, permission),
    roleName: activeMembership?.role?.name,
  }), [activeMembership]);
}

export function useHubData(): HubData {
  const { activeMembership } = useAuth();
  const { language } = useDisplayPreferences();
  const isFocused = useIsFocused();
  const plan = useHubLoaderPlan();
  const planKey = [...HUB_LOADER_KEYS.map((key) => plan[key]), plan.stream].map(Number).join('');

  const restaurantId = activeMembership?.restaurant_id ?? null;
  // Also the assistant's seen-insights scope, spelled as app/ai-assistant.tsx spells it.
  const scope = `${restaurantId ?? 0}:${activeMembership?.user_id ?? 0}`;

  // A different restaurant or person starts from nothing, in the same render:
  // the last shop's numbers must never paint under the new shop's name.
  const [store, setStore] = useState<HubStore>(() => ({ scope, entries: initialStates() }));
  if (store.scope !== scope) setStore({ scope, entries: initialStates() });
  const states = store.entries;
  const [clock, setClock] = useState(() => Date.now());

  const planRef = useRef(plan);
  const scopeRef = useRef(scope);
  const generationRef = useRef(0);
  const runtimeRef = useRef(freshRuntime());
  const focusedRef = useRef(false);
  /** When the hub last lost focus, which closed its order stream. */
  const lastBlurAtRef = useRef<number | null>(null);
  const forcedRef = useRef<ReadonlySet<HubLoaderKey>>(new Set());
  const notLiveSinceRef = useRef<number | null>(null);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  useEffect(() => {
    scopeRef.current = scope;
    return () => {
      // Whatever is still in flight for the old scope lands nowhere.
      generationRef.current += 1;
      clearTrailing(runtimeRef.current);
      runtimeRef.current = freshRuntime();
      forcedRef.current = new Set();
    };
  }, [scope]);

  const controller = useMemo(() => {
    const request = (key: HubLoaderKey, options: LoadOptions = {}): Promise<void> => {
      if (!planRef.current[key]) return Promise.resolve();
      const runtime = runtimeRef.current[key];
      const decision = hubLoadDecision(runtime.clock, {
        now: Date.now(),
        minAgeMs: options.minAgeMs,
        minIntervalMs: hubLoaderMinInterval(key),
        force: options.force,
      });
      if (decision.kind === 'fresh') return Promise.resolve();
      if (decision.kind === 'queue') {
        if (options.afterChange) runtime.trailing = true;
        return runtime.promise ?? Promise.resolve();
      }
      if (decision.kind === 'wait') {
        if (runtime.trailingTimer === null) {
          runtime.trailingTimer = setTimeout(() => {
            runtime.trailingTimer = null;
            if (focusedRef.current && runtimeRef.current[key] === runtime) void request(key, { afterChange: true });
          }, decision.delayMs);
        }
        return Promise.resolve();
      }
      return run(key, runtime);
    };

    const run = <K extends HubLoaderKey>(key: K, runtime: LoaderRuntime): Promise<void> => {
      const generation = generationRef.current;
      const scopeAtStart = scopeRef.current;
      const isCurrent = () => generation === generationRef.current;
      const startedAt = Date.now();
      // The day this request asks for: the same instant loadedFrom records.
      const today = formatBangkokDate(new Date(startedAt));
      runtime.clock = { ...runtime.clock, startedAt, inFlight: true };
      const fetcher = FETCHERS[key] as (context: FetchContext) => Promise<HubRaw[K]>;
      const promise = fetcher({ today, seenScope: scopeAtStart })
        .then(
          (raw) => {
            runtime.clock = { ...runtime.clock, loadedAt: Date.now(), loadedFrom: startedAt };
            if (!isCurrent()) return;
            setStore((prev) => (prev.scope !== scopeAtStart ? prev : withEntry(prev, key, { status: 'ready', raw, day: today })));
          },
          () => {
            if (!isCurrent()) return;
            // A quiet reload keeps the last good value; only a first load shows
            // the failure - and a reload of yesterday's day value, which is no
            // value today.
            setStore((prev) => {
              if (prev.scope !== scopeAtStart) return prev;
              const held = prev.entries[key];
              if (held.raw !== null && hubHeldValueIsCurrent(key, held.day, Date.now())) return prev;
              return withEntry(prev, key, { status: 'error', raw: null, day: null });
            });
          },
        )
        .finally(() => {
          runtime.clock = { ...runtime.clock, inFlight: false };
          runtime.promise = null;
          if (!runtime.trailing) return;
          runtime.trailing = false;
          if (isCurrent() && focusedRef.current) void request(key, { afterChange: true });
        });
      runtime.promise = promise;
      return promise;
    };

    return { request };
  }, []);

  const onOrderEvents = useCallback((batch: OrderEventBatch) => {
    for (const key of hubLoadersForEvents(batch)) void controller.request(key, { afterChange: true });
  }, [controller]);

  // One stream, only while the hub is the screen on top and the backend would
  // accept this member on it (HUB_ORDER_STREAM_PERMISSIONS).
  const streamStatus = useOrderEvents(onOrderEvents, {
    enabled: isFocused && Boolean(restaurantId) && plan.stream,
    restaurantId,
    skipConnectedRefreshWithinMs: HUB_TIMING.connectedSkipMs,
  });
  const streamStatusRef = useRef(streamStatus);
  useEffect(() => {
    streamStatusRef.current = streamStatus;
    if (streamStatus === 'live') notLiveSinceRef.current = null;
    else if (notLiveSinceRef.current === null) notLiveSinceRef.current = Date.now();
  }, [streamStatus]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    const forced = forcedRef.current;
    forcedRef.current = new Set();
    const now = Date.now();
    setClock(now);
    notLiveSinceRef.current = streamStatusRef.current === 'live' ? null : now;
    const blurredAt = lastBlurAtRef.current;
    const focusLoad = (key: HubLoaderKey) => {
      void controller.request(key, hubFocusLoad(key, runtimeRef.current[key].clock, blurredAt, forced.has(key)));
    };

    HUB_LIGHT_LOADERS.forEach(focusLoad);
    // The heavy lists wait out the stack's pop animation so returning to the hub
    // stays smooth. Not InteractionManager: RN 0.86 deprecates it, warns on
    // screen, and only defers a tick anyway.
    const heavy = setTimeout(() => {
      if (!focusedRef.current) return;
      HUB_HEAVY_LOADERS.forEach(focusLoad);
    }, HEAVY_LOAD_DELAY_MS);

    // Ages the kitchen lanes and the takings clock from what is cached. After
    // midnight the two day values reload, and go on reloading on every tick
    // until one lands, so a failed reload is asked again rather than forgotten.
    const tick = setInterval(() => {
      const at = Date.now();
      setClock(at);
      for (const key of hubStaleDayLoaders((key) => runtimeRef.current[key].clock, at)) {
        void controller.request(key, { force: true });
      }
    }, HUB_TIMING.clockTickMs);

    // The floor, whose table-only changes publish no order event, and the
    // kitchen too while the stream has been down a while; nothing heavy.
    const recovery = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      for (const key of hubPollLoaders(notLiveSinceRef.current, Date.now())) void controller.request(key);
    }, HUB_TIMING.recoveryPollMs);

    return () => {
      focusedRef.current = false;
      lastBlurAtRef.current = Date.now();
      clearTimeout(heavy);
      clearInterval(tick);
      clearInterval(recovery);
      clearTrailing(runtimeRef.current);
    };
    // planKey and scope re-run the focus loads when the member's access or shop changes.
  }, [controller, planKey, scope]));

  const retry = useCallback((key: HubLoaderKey) => {
    setStore((prev) => (prev.entries[key].status === 'error' ? withEntry(prev, key, { status: 'loading', raw: null, day: null }) : prev));
    void controller.request(key, { force: true });
  }, [controller]);

  const retries = useMemo(() => {
    const entries = HUB_LOADER_KEYS.map((key): [HubLoaderKey, () => void] => [key, () => retry(key)]);
    return Object.fromEntries(entries) as Record<HubLoaderKey, () => void>;
  }, [retry]);

  const refresh = useCallback(async () => {
    await Promise.all(HUB_LOADER_KEYS.map((key) => controller.request(key, { force: true })));
  }, [controller]);

  const noteOpened = useCallback((row: HubRowKey) => {
    forcedRef.current = new Set([...forcedRef.current, ...HUB_ROW_LOADERS[row]]);
  }, []);

  const kitchenRaw = states.kitchen.raw;
  const kitchenValue = useMemo(
    () => (kitchenRaw ? hubKitchen(kitchenRaw, clock, language) : null),
    [clock, kitchenRaw, language],
  );
  const takingsRaw = states.takings.raw;
  const takingsValue = useMemo(
    () => (takingsRaw ? hubTakings(takingsRaw, clock) : null),
    [clock, takingsRaw],
  );

  return useMemo<HubData>(() => {
    const slot = <T,>(key: HubLoaderKey, value: T | null): HubSlot<T> => {
      if (!plan[key]) return { status: 'off', value: null, retry: retries[key] };
      const entry = states[key];
      // Past midnight, yesterday's takings and paid count are bones until the new day's land.
      if (entry.status === 'ready' && !hubHeldValueIsCurrent(key, entry.day, clock)) {
        return { status: 'loading', value: null, retry: retries[key] };
      }
      return { status: entry.status, value, retry: retries[key] };
    };
    return {
      takings: slot('takings', takingsValue),
      floor: slot('floor', states.floor.raw),
      kitchen: slot('kitchen', kitchenValue),
      paidToday: slot('paidToday', states.paidToday.raw),
      menu: slot('menu', states.menu.raw),
      inventory: slot('inventory', states.inventory.raw),
      insights: slot('insights', states.insights.raw),
      refresh,
      noteOpened,
    };
  }, [clock, kitchenValue, noteOpened, plan, refresh, retries, states, takingsValue]);
}
