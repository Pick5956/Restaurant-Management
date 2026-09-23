import { useOrderEvents, type OrderRealtimeStatus } from '@/src/hooks/use-order-events';
import { isKitchenOrderChangeEvent } from '@/src/lib/order-events';

type KitchenOrderEventsOptions = {
  enabled?: boolean;
  restaurantId?: number | null;
};

/**
 * `live` once the server has greeted the stream, `offline` after it drops and
 * while the backoff waits, `idle` when nothing is listening - the screen is not
 * focused, or there is no restaurant yet - so a paused stream is never reported
 * to the kitchen as a fault.
 */
export type KitchenRealtimeStatus = OrderRealtimeStatus;

/**
 * Listens for restaurant-scoped order invalidations and asks the screen to
 * reload its REST snapshot. REST remains the kitchen queue source of truth.
 *
 * A thin wrapper over useOrderEvents since 2026-09-23 (the hub needed every
 * order action, not only the kitchen's): the same stream, the same actions
 * (isKitchenOrderChangeEvent), and a `connected` greeting that always reloads.
 */
export function useKitchenOrderEvents(
  callback: () => void | Promise<void>,
  { enabled = true, restaurantId }: KitchenOrderEventsOptions = {},
): KitchenRealtimeStatus {
  return useOrderEvents(() => callback(), {
    enabled,
    restaurantId,
    accepts: isKitchenOrderChangeEvent,
  });
}
