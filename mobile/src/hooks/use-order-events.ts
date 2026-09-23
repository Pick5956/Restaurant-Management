import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { apiUrl } from '@/src/api/client';
import {
  parseOrderChangeEvent,
  parseServerSentEvents,
  type OrderChangeEvent,
} from '@/src/lib/order-events';
import { getToken, getTokenType } from '@/src/storage/session-store';

/**
 * `live` once the server has greeted the stream, `offline` after it drops and
 * while the backoff waits, `idle` when nothing is listening - the screen is not
 * focused, or there is no restaurant yet - so a paused stream is never reported
 * as a fault.
 */
export type OrderRealtimeStatus = 'idle' | 'connecting' | 'live' | 'offline';

/** What woke the callback, coalesced over the debounce. */
export type OrderEventBatch = {
  /** Actions of the order changes that passed `accepts`, each once, in arrival order. */
  actions: string[];
  /**
   * The stream (re)connected, or the app came back to the foreground: events
   * may have been missed, so the snapshot should be reloaded whatever it is.
   */
  resync: boolean;
};

export type OrderEventsOptions = {
  enabled?: boolean;
  restaurantId?: number | null;
  /** Which order changes wake the callback. Every one when left out. */
  accepts?: (event: OrderChangeEvent) => boolean;
  /**
   * Skip the resync the server's `connected` greeting asks for when the
   * previous resync - or the moment the stream was enabled, which is when the
   * screen loaded - was this recent. 0 (the default) never skips. A later
   * reconnect, after a drop, still resyncs: events may have been missed then.
   */
  skipConnectedRefreshWithinMs?: number;
};

const maxRetryDelayMs = 30_000;
const refreshDebounceMs = 100;

function isActiveAppState(state: AppStateStatus | null) {
  return state === null || state === 'active';
}

/**
 * Listens for restaurant-scoped order invalidations and asks the screen to
 * reload its REST snapshot; REST stays the source of truth. One connection per
 * enabled caller, so a screen that stays mounted under others (the hub) must
 * pass `enabled` only while it is focused.
 */
export function useOrderEvents(
  callback: (batch: OrderEventBatch) => void | Promise<void>,
  {
    enabled = true,
    restaurantId,
    accepts,
    skipConnectedRefreshWithinMs = 0,
  }: OrderEventsOptions = {},
) {
  const callbackRef = useRef(callback);
  // Kept in refs so an inline predicate or a changed window never restarts the stream.
  const acceptsRef = useRef(accepts);
  const skipConnectedRef = useRef(skipConnectedRefreshWithinMs);
  const [status, setStatus] = useState<OrderRealtimeStatus>('idle');
  // Written through a ref as well so the async connection loop can report
  // without being re-created whenever the status changes.
  const statusRef = useRef<OrderRealtimeStatus>('idle');
  const reportStatus = useCallback((next: OrderRealtimeStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  useEffect(() => {
    callbackRef.current = callback;
    acceptsRef.current = accepts;
    skipConnectedRef.current = skipConnectedRefreshWithinMs;
  }, [accepts, callback, skipConnectedRefreshWithinMs]);

  useEffect(() => {
    if (!enabled || !restaurantId) {
      reportStatus('idle');
      return;
    }
    reportStatus('connecting');

    let disposed = false;
    let appIsActive = isActiveAppState(AppState.currentState);
    let retryDelayMs = 1_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let wakeRetry: (() => void) | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshRunning = false;
    let connectionAbortController: AbortController | null = null;
    let pendingActions = new Set<string>();
    let pendingResync = false;
    // The screen loads when the stream is enabled, so that counts as a resync.
    let lastResyncAt = Date.now();

    const takePending = (): OrderEventBatch | null => {
      if (!pendingResync && pendingActions.size === 0) return null;
      const batch = { actions: [...pendingActions], resync: pendingResync };
      pendingActions = new Set();
      pendingResync = false;
      return batch;
    };

    const refresh = async () => {
      // A running loop picks up whatever arrived while it was busy.
      if (refreshRunning) return;
      refreshRunning = true;
      try {
        let batch = takePending();
        while (!disposed && batch) {
          try {
            await callbackRef.current(batch);
          } catch {
            // The screen owns load feedback and recovery polling retries.
          }
          batch = takePending();
        }
      } finally {
        refreshRunning = false;
      }
    };

    const queueRefresh = () => {
      if (refreshTimer !== null || disposed) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, refreshDebounceMs);
    };

    const queueResync = () => {
      lastResyncAt = Date.now();
      pendingResync = true;
      queueRefresh();
    };

    const queueAction = (action: string) => {
      pendingActions.add(action);
      queueRefresh();
    };

    const waitBeforeRetry = (delayMs: number) => new Promise<void>((resolve) => {
      const finish = () => {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
        wakeRetry = null;
        resolve();
      };
      wakeRetry = finish;
      retryTimer = setTimeout(finish, delayMs);
    });

    const connect = async (): Promise<'rotate' | 'closed'> => {
      const [token, tokenType] = await Promise.all([getToken(), getTokenType()]);
      if (!token || disposed || !appIsActive) throw new Error('missing active session');

      const abortController = new AbortController();
      connectionAbortController = abortController;
      try {
        const response = await expoFetch(`${apiUrl}/api/v1/events/orders`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `${tokenType} ${token}`,
            'Cache-Control': 'no-cache',
            'X-Restaurant-ID': String(restaurantId),
          },
          signal: abortController.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`order event stream failed (${response.status})`);
        }

        retryDelayMs = 1_000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let rotateRequested = false;

        try {
          while (!disposed && appIsActive) {
            const { value, done } = await reader.read();
            if (done) return rotateRequested ? 'rotate' : 'closed';
            const parsed = parseServerSentEvents(
              buffer,
              decoder.decode(value, { stream: true }),
            );
            buffer = parsed.buffer;

            for (const message of parsed.messages) {
              if (message.event === 'connected') {
                reportStatus('live');
                const skipWithinMs = skipConnectedRef.current;
                if (!(skipWithinMs > 0 && Date.now() - lastResyncAt < skipWithinMs)) queueResync();
                continue;
              }
              if (message.event === 'reconnect') {
                rotateRequested = true;
                continue;
              }
              const event = parseOrderChangeEvent(message);
              if (!event) continue;
              const accept = acceptsRef.current;
              if (!accept || accept(event)) queueAction(event.action);
            }
          }
          return 'closed';
        } finally {
          reader.releaseLock();
        }
      } finally {
        if (connectionAbortController === abortController) {
          connectionAbortController = null;
        }
      }
    };

    const run = async () => {
      while (!disposed) {
        if (!appIsActive) {
          // Backgrounded, not broken: the orders are simply not being watched.
          reportStatus('idle');
          await waitBeforeRetry(maxRetryDelayMs);
          continue;
        }

        let outcome: 'rotate' | 'closed' = 'closed';
        try {
          outcome = await connect();
        } catch {
          if (disposed) return;
        }
        if (disposed || !appIsActive) continue;
        if (outcome === 'rotate') {
          reportStatus('connecting');
          continue;
        }

        reportStatus('offline');
        await waitBeforeRetry(retryDelayMs);
        reportStatus('connecting');
        retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs);
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      const nextIsActive = isActiveAppState(state);
      if (nextIsActive === appIsActive) return;
      appIsActive = nextIsActive;
      retryDelayMs = 1_000;
      if (nextIsActive) {
        wakeRetry?.();
        queueResync();
      } else {
        connectionAbortController?.abort();
        wakeRetry?.();
      }
    });

    void run();
    return () => {
      disposed = true;
      appStateSubscription.remove();
      connectionAbortController?.abort();
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      wakeRetry?.();
      reportStatus('idle');
    };
  }, [enabled, reportStatus, restaurantId]);

  return status;
}
