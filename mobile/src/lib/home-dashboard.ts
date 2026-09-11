type KitchenQueueItem = {
  status: string;
  sent_at?: string | null;
};

type KitchenQueueOrder = {
  opened_at: string;
  items?: KitchenQueueItem[];
};

type InventoryLevel = {
  stock: number;
  min_stock: number;
};

type HomeOrder = {
  status: string;
  order_type: string;
  customer_count?: number | null;
  payment_status?: string | null;
  grand_total?: number | string | null;
  total_amount?: number | string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  table?: { ID?: number; display_label?: string } | null;
};

type HomeSalesDay = {
  order_date: string;
  revenue: number;
  profit: number;
};

type HomeMenuItem = {
  menu_id: number;
  menu_name: string;
  quantity: number;
};

export type HomeOperationalCounts = {
  overdueKitchen: number;
  readyKitchen: number;
  activeKitchen: number;
  outOfStock: number;
  lowStock: number;
  occupiedTables: number;
};

export type HomeAccess = {
  canViewKitchen: boolean;
  canViewInventory: boolean;
  canTakeOrder: boolean;
  canViewOrders: boolean;
};

export type HomePriorityKey =
  | 'kitchen-overdue'
  | 'stock-out'
  | 'stock-low'
  | 'kitchen-active'
  | 'take-order'
  | 'orders'
  | 'overview';

export type HomePriority = {
  key: HomePriorityKey;
  count: number;
  href?: '/kitchen' | '/inventory' | '/tables' | '/orders';
  tone: 'danger' | 'success' | 'warning' | 'info' | 'neutral';
};

export type HomeOperationalMetricKey =
  | 'orders-active'
  | 'tables-occupied'
  | 'tables-free'
  | 'tables-reserved'
  | 'kitchen-active'
  | 'kitchen-ready';

export type HomeOperationalMetric = {
  key: HomeOperationalMetricKey;
  count: number;
};

export type HomeOperationalSnapshot = {
  activeOrders: number;
  occupiedTables: number;
  freeTables: number;
  reservedTables: number;
  activeKitchen: number;
  readyKitchen: number;
};

export type HomeOperationalMetricAccess = {
  canViewOrders: boolean;
  canViewTables: boolean;
  canViewKitchen: boolean;
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
const activeOrderStatuses = new Set(['open', 'sent_to_kitchen', 'cooking', 'ready', 'served']);

function toDateKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  if (!dateKeyPattern.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  return toDateKey(parsed) === value ? parsed : null;
}

export function shiftDashboardDate(value: string, days: number) {
  const parsed = parseDateKey(value);
  if (!parsed || !Number.isFinite(days)) return value;
  parsed.setUTCDate(parsed.getUTCDate() + Math.trunc(days));
  return toDateKey(parsed);
}

export function clampDashboardDate(current: string, candidate: string, today: string) {
  if (!parseDateKey(candidate) || !parseDateKey(today) || candidate > today) return current;
  return candidate;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function summarizeHomeOrders(orders: HomeOrder[]) {
  const validOrders = orders.filter((order) => order.status !== 'cancelled');
  const activeOrders = validOrders.filter((order) => activeOrderStatuses.has(order.status));
  const paidOrders = validOrders.filter(
    (order) => order.payment_status === 'paid' || order.status === 'completed',
  );
  const paidRevenue = paidOrders.reduce(
    (sum, order) => sum + finiteNumber(order.grand_total || order.total_amount),
    0,
  );
  const guests = validOrders.reduce((sum, order) => {
    if (order.order_type !== 'dine_in') return sum;
    return sum + Math.max(0, finiteNumber(order.customer_count));
  }, 0);

  return {
    totalOrders: validOrders.length,
    activeOrders: activeOrders.length,
    paidOrders: paidOrders.length,
    paidRevenue,
    averageBill: paidOrders.length ? paidRevenue / paidOrders.length : 0,
    guests,
  };
}

export function summarizeHomeSalesTrend(
  salesDays: HomeSalesDay[],
  anchorDate: string,
  requestedDays = 7,
) {
  const anchor = parseDateKey(anchorDate);
  const days = Math.min(45, Math.max(1, Math.trunc(finiteNumber(requestedDays)) || 7));
  const empty = {
    days,
    current: { revenue: 0, profit: 0 },
    previous: { revenue: 0, profit: 0 },
    delta: { revenue: 0, profit: 0 },
  };
  if (!anchor) return empty;

  const currentEnd = toDateKey(anchor);
  const currentStart = shiftDashboardDate(currentEnd, -(days - 1));
  const previousEnd = shiftDashboardDate(currentEnd, -days);
  const previousStart = shiftDashboardDate(currentEnd, -(days * 2 - 1));
  const current = { revenue: 0, profit: 0 };
  const previous = { revenue: 0, profit: 0 };

  for (const day of salesDays) {
    if (!parseDateKey(day.order_date)) continue;
    const target = day.order_date >= currentStart && day.order_date <= currentEnd
      ? current
      : day.order_date >= previousStart && day.order_date <= previousEnd
        ? previous
        : null;
    if (!target) continue;
    target.revenue += finiteNumber(day.revenue);
    target.profit += finiteNumber(day.profit);
  }

  return {
    days,
    current,
    previous,
    delta: {
      revenue: current.revenue - previous.revenue,
      profit: current.profit - previous.profit,
    },
  };
}

export function buildHomeOperationalMetrics(
  snapshot: HomeOperationalSnapshot,
  access: HomeOperationalMetricAccess,
) {
  const metrics: HomeOperationalMetric[] = [];

  if (access.canViewOrders) {
    metrics.push({ key: 'orders-active', count: snapshot.activeOrders });
  }
  if (access.canViewTables) {
    metrics.push(
      { key: 'tables-occupied', count: snapshot.occupiedTables },
      { key: 'tables-free', count: snapshot.freeTables },
      { key: 'tables-reserved', count: snapshot.reservedTables },
    );
  }
  if (access.canViewKitchen) {
    metrics.push(
      { key: 'kitchen-active', count: snapshot.activeKitchen },
      { key: 'kitchen-ready', count: snapshot.readyKitchen },
    );
  }

  return metrics;
}

export function topHomeMenuItems(items: HomeMenuItem[], requestedLimit = 3) {
  const limit = Math.min(10, Math.max(1, Math.trunc(finiteNumber(requestedLimit)) || 3));
  return [...items]
    .sort((first, second) => (
      finiteNumber(second.quantity) - finiteNumber(first.quantity)
      || first.menu_name.localeCompare(second.menu_name)
      || first.menu_id - second.menu_id
    ))
    .slice(0, limit);
}

export function dashboardLoadFailurePolicy(quiet: boolean) {
  return {
    preserveSnapshot: quiet,
    showError: !quiet,
  };
}

export function shouldStartDashboardLoad(
  quiet: boolean,
  foregroundLoadPending: boolean,
) {
  return !quiet || !foregroundLoadPending;
}

export function shouldReplaceOptionalDashboardSnapshot(
  quiet: boolean,
  sourceFailed: boolean,
) {
  return !quiet || !sourceFailed;
}

function minutesSince(value: string | null | undefined, now: Date) {
  if (!value) return 0;
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((now.getTime() - startedAt) / 60_000));
}

export function summarizeKitchenQueue(orders: KitchenQueueOrder[], now = new Date()) {
  let overdueKitchen = 0;
  let readyKitchen = 0;
  let activeKitchen = 0;

  for (const order of orders) {
    const items = order.items ?? [];
    const activeItems = items.filter((item) => item.status === 'pending' || item.status === 'cooking');
    const hasReady = items.some((item) => item.status === 'ready');

    if (!activeItems.length) {
      if (hasReady) readyKitchen += 1;
      continue;
    }

    activeKitchen += 1;
    const sentTimes = activeItems
      .map((item) => item.sent_at)
      .filter((value): value is string => Boolean(value))
      .sort((first, second) => new Date(first).getTime() - new Date(second).getTime());
    const waited = minutesSince(sentTimes[0] ?? order.opened_at, now);
    if (waited >= 10) overdueKitchen += 1;
  }

  return { overdueKitchen, readyKitchen, activeKitchen };
}

export function summarizeInventory(ingredients: InventoryLevel[]) {
  let outOfStock = 0;
  let lowStock = 0;

  for (const ingredient of ingredients) {
    const stock = Number(ingredient.stock);
    const minimum = Number(ingredient.min_stock);
    if (!Number.isFinite(stock) || !Number.isFinite(minimum)) continue;
    if (stock <= 0) {
      outOfStock += 1;
    } else if (minimum > 0 && stock <= minimum * 1.5) {
      lowStock += 1;
    }
  }

  return { outOfStock, lowStock };
}

export function buildHomeAttention(counts: HomeOperationalCounts, access: HomeAccess): HomePriority[] {
  const alerts: HomePriority[] = [];

  if (access.canViewKitchen && counts.overdueKitchen > 0) {
    alerts.push({ key: 'kitchen-overdue', count: counts.overdueKitchen, href: '/kitchen', tone: 'danger' });
  }
  if (access.canViewInventory && counts.outOfStock > 0) {
    alerts.push({ key: 'stock-out', count: counts.outOfStock, href: '/inventory', tone: 'danger' });
  }
  if (access.canViewInventory && counts.lowStock > 0) {
    alerts.push({ key: 'stock-low', count: counts.lowStock, href: '/inventory', tone: 'warning' });
  }

  return alerts;
}

export function resolveHomePriority(counts: HomeOperationalCounts, access: HomeAccess): HomePriority {
  const attention = buildHomeAttention(counts, access);
  if (attention.length) return attention[0];
  if (access.canViewKitchen && counts.activeKitchen > 0) {
    return { key: 'kitchen-active', count: counts.activeKitchen, href: '/kitchen', tone: 'warning' };
  }
  if (access.canTakeOrder) {
    return { key: 'take-order', count: counts.occupiedTables, href: '/tables', tone: 'info' };
  }
  if (access.canViewOrders) {
    return { key: 'orders', count: 0, href: '/orders', tone: 'info' };
  }
  return { key: 'overview', count: 0, tone: 'neutral' };
}

// ---------------------------------------------------------------- home v2

export type HomeDay = {
  date: string;
  /** 0 = Sunday, as Date.getDay() counts. */
  weekday: number;
  dayOfMonth: number;
  selected: boolean;
  isToday: boolean;
  /** Whether anything was sold that day, when the sales history is known. */
  hasSales: boolean | null;
};

/**
 * The seven days ending today, for the strip that replaced the < date > arrows.
 * A day carries a dot when the sales history says it sold something; with no
 * history at all (no report permission) the dots are simply absent rather than
 * every day pretending to be empty.
 */
export function homeDayStrip(today: string, selectedDate: string, salesDays: HomeSalesDay[] | null): HomeDay[] {
  const sold = salesDays
    ? new Set(salesDays.filter((day) => finiteNumber(day.revenue) > 0).map((day) => day.order_date))
    : null;
  const days: HomeDay[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = shiftDashboardDate(today, -offset);
    const parsed = parseDateKey(date);
    days.push({
      date,
      weekday: parsed ? parsed.getUTCDay() : 0,
      dayOfMonth: parsed ? parsed.getUTCDate() : 0,
      selected: date === selectedDate,
      isToday: date === today,
      hasSales: sold ? sold.has(date) : null,
    });
  }
  return days;
}

/** The hour (0-23) an ISO timestamp falls in, Bangkok time. */
export function bangkokHour(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const text = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(date);
  const hour = Number(text);
  // Some engines print midnight as "24".
  return Number.isFinite(hour) ? hour % 24 : null;
}

export type HomeRevenueCurve = {
  /** First hour on the axis. */
  startHour: number;
  /** Last hour on the axis, inclusive. */
  endHour: number;
  /** Paid revenue accumulated by the end of each hour, one entry per hour. */
  cumulative: number[];
};

/**
 * Paid revenue accumulated hour by hour, for the line on the sales card. Bills
 * count at the hour they were closed, since that is when the money was taken.
 * The axis runs from the first sale (never later than 10:00) to the last one, or
 * to the current hour when the day is still going, so the line ends where the
 * day has actually got to instead of trailing flat to midnight.
 */
export function homeRevenueCurve(orders: HomeOrder[], nowHour: number | null): HomeRevenueCurve | null {
  const byHour = new Array<number>(24).fill(0);
  let any = false;
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    const paid = order.payment_status === 'paid' || order.status === 'completed';
    if (!paid) continue;
    const hour = bangkokHour(order.closed_at || order.opened_at);
    if (hour === null) continue;
    byHour[hour] += finiteNumber(order.grand_total || order.total_amount);
    any = true;
  }
  if (!any && nowHour === null) return null;
  let first = byHour.findIndex((value) => value > 0);
  if (first < 0) first = 10;
  const startHour = Math.min(first, 10);
  let last = 23;
  while (last > startHour && byHour[last] === 0) last -= 1;
  const endHour = nowHour === null ? last : Math.max(Math.min(nowHour, 23), Math.min(last, 23), startHour);
  const cumulative: number[] = [];
  let running = 0;
  for (let hour = startHour; hour <= endHour; hour += 1) {
    running += byHour[hour];
    cumulative.push(running);
  }
  return { startHour, endHour, cumulative };
}

/**
 * What the same weekday a week earlier took, when the history covers it. This is
 * the honest comparison for a finished day; for a day still in progress the
 * caller shows it as a reference figure, never as a percentage against a total
 * that is not in yet.
 */
export function sameWeekdayRevenue(salesDays: HomeSalesDay[] | null, date: string): number | null {
  if (!salesDays) return null;
  const target = shiftDashboardDate(date, -7);
  const day = salesDays.find((entry) => entry.order_date === target);
  return day ? finiteNumber(day.revenue) : null;
}

/** Percentage change, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Bills the kitchen has finished that nobody has paid for yet: the tables that
 * are waiting to check out.
 */
export function waitingBillOrders<T extends HomeOrder>(orders: T[]): T[] {
  return orders.filter((order) =>
    (order.status === 'served' || order.status === 'ready') &&
    order.payment_status !== 'paid',
  );
}

export type HomeTableCell = {
  id: number;
  label: string;
  state: 'busy' | 'bill' | 'reserved' | 'free';
};

/**
 * The floor as a grid of cells. A table whose bill is waiting shows as such
 * rather than merely occupied, because that is the one the front of house has
 * to go to next. Inactive tables are not on the floor.
 */
export function homeTableCells(
  tables: Array<{ ID: number; display_label: string; status: string }>,
  billTableIds: Set<number>,
): HomeTableCell[] {
  return tables
    .filter((table) => table.status !== 'inactive')
    .map((table) => ({
      id: table.ID,
      label: table.display_label,
      state: billTableIds.has(table.ID)
        ? 'bill' as const
        : table.status === 'occupied'
          ? 'busy' as const
          : table.status === 'reserved'
            ? 'reserved' as const
            : 'free' as const,
    }));
}
