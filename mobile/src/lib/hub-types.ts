// The contract between the hub's data layer (src/hooks/use-hub-data.ts, pure
// derivations in src/lib/hub-data.ts) and the two hub layouts being compared
// (src/components/hub/hub-stage.tsx).
// Owner, 2026-09-23: build both on the phone, then pick one.
import type { ReactNode } from 'react';

import type { AppIconName } from '@/src/components/app-icon';

/** Every destination the hub can list, keyed as in app-shell's NavItem.key. */
export type HubRowKey =
  | 'home' | 'pos' | 'kitchen' | 'orders'
  | 'menu' | 'inventory' | 'tables-manage' | 'expenses'
  | 'reports' | 'ai' | 'settings';

export type HubGroupKey = 'work' | 'shop' | 'team';

/** A destination this member may open, in MORE_GROUPS order. */
export type HubNavItem = {
  key: HubRowKey;
  title: string;
  icon: AppIconName;
  href: string;
  group: HubGroupKey;
};

/** Status colours only. Money, counts of paid bills and configuration take none. */
export type HubTone = 'danger' | 'warning' | 'info' | 'success';

/** One piece of a value line. Segments are joined with ", "; only toned pieces are coloured. */
export type HubSegment = { text: string; tone?: HubTone };

/**
 * One loader's state.
 * - `off`: this member may not read the value; render the destination without one.
 * - `loading`: nothing has arrived yet this session (show bones).
 * - `ready`: `value` is set. A quiet reload keeps status `ready` and the old value.
 * - `error`: the first load failed and nothing is cached; `retry` reloads this loader only.
 */
export type HubSlot<T> = {
  status: 'off' | 'loading' | 'ready' | 'error';
  value: T | null;
  retry: () => void;
};

export type HubTakings = {
  /** Paid revenue today, as /home counts it (summarizeHomeOrders). */
  amount: number;
  /** Cumulative paid revenue per hour, as homeRevenueCurve; null on a day with nothing paid. */
  curve: { startHour: number; endHour: number; cumulative: number[] } | null;
  /** '10:00' - the curve's first hour, or the current hour when there is no curve. */
  startLabel: string;
  /** '14:32' - the current Bangkok time. */
  nowLabel: string;
};

export type HubTableTone = 'free' | 'occupied' | 'reserved';

export type HubTableCell = {
  key: string;
  tone: HubTableTone;
  /** An unpaid served/ready order sits on it (waitingBillOrders). */
  waitingBill: boolean;
};

export type HubFloor = {
  /** Tables whose tile would read free, as tables.tsx decides (tableTileStatus). */
  free: number;
  /** Every table except inactive ones. */
  total: number;
  /**
   * Unpaid served/ready orders sitting on a table: exactly the cells drawn with
   * a bill edge. Takeaway bills are counted apart so the line and the strip
   * never disagree (stress test, 2026-09-23).
   */
  waitingBills: number;
  /** Unpaid served/ready takeaway orders, which have no cell on the strip. */
  takeawayBills: number;
  /** In the tables screen's order: zone, then table. Inactive tables are left out. */
  cells: HubTableCell[];
};

export type HubKitchenLane = {
  key: string;
  /** The ticket's table as the kitchen board prints it ('T3'), or its takeaway label. */
  label: string;
  /** Minutes waited over KITCHEN_TARGET_MINUTES, clamped to 0..1. */
  progress: number;
  urgency: 'normal' | 'warning' | 'overdue';
};

export type HubKitchen = {
  /** kitchenBoardStats, exactly as the kitchen screen derives it. */
  cooking: number;
  overdue: number;
  done: number;
  /** Cooking rounds, longest wait first. */
  lanes: HubKitchenLane[];
};

export type HubPaidToday = { count: number };
export type HubMenuStock = { soldOut: number; low: number };
export type HubInventoryStock = { out: number; low: number };
export type HubInsights = { unseen: number };

export type HubData = {
  takings: HubSlot<HubTakings>;
  floor: HubSlot<HubFloor>;
  kitchen: HubSlot<HubKitchen>;
  paidToday: HubSlot<HubPaidToday>;
  menu: HubSlot<HubMenuStock>;
  inventory: HubSlot<HubInventoryStock>;
  insights: HubSlot<HubInsights>;
  /** Pull-to-refresh: reloads every enabled loader, ignoring minimum ages. */
  refresh: () => Promise<void>;
  /** Call before navigating, so coming back from that page refetches its value at once. */
  noteOpened: (row: HubRowKey) => void;
};

export type HubShop = {
  name: string;
  /** 'สาขาหลัก' / 'ไม่ระบุสาขา' - see branchLabel in hub-data.ts. */
  branch: string;
  role: string;
  /** Monogram letter(s) for the fallback tile (restaurantMark). */
  mark: string;
  logoUrl: string | null;
  coverUrl: string | null;
  /** Show 'สลับร้าน' only when the member has several restaurants. */
  canSwitch: boolean;
  onSwitch: () => void;
};

/** What app/more.tsx hands to either layout. Each layout renders its own AppScreen. */
export type HubLayoutProps = {
  shop: HubShop;
  items: HubNavItem[];
  data: HubData;
  /** Owners and managers only (owner, 2026-09-23). */
  showTakings: boolean;
  onOpen: (item: HubNavItem) => void;
  /** Rendered at the very end of the scroll content: the temporary A/B switch. */
  footer?: ReactNode;
};
