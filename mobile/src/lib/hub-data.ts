import type { AIInsight } from '@/src/types/ai';
import type { Ingredient } from '@/src/types/ingredient';
import type { OrderItemStatus } from '@/src/types/order';

import { canUseAIAssistant } from './ai-actions.ts';
import { insightKey } from './ai-insight-key.ts';
import {
  bangkokHour,
  homeRevenueCurve,
  summarizeHomeOrders,
  waitingBillOrders,
} from './home-dashboard.ts';
import type {
  HubFloor,
  HubInsights,
  HubInventoryStock,
  HubKitchen,
  HubKitchenLane,
  HubMenuStock,
  HubPaidToday,
  HubRowKey,
  HubSegment,
  HubTableCell,
  HubTakings,
  HubTone,
} from './hub-types.ts';
import { inventoryTotals } from './inventory-list.ts';
import { kitchenBoardStats, sortTickets, ticketProgress } from './kitchen-board.ts';
import { kitchenTicketTiming } from './kitchen-workflow.ts';
import { menuStockBadge } from './menu-catalog.ts';
import { firstLetter } from './more-screen.ts';
import { isKitchenOrderChangeEvent } from './order-events.ts';
import { formatBangkokDate } from './order-query.ts';
import { isCookingItem, isKitchenDoneItem, kitchenTicketKey } from './order-workflow.ts';
import { orderListRequest } from './permission-parity.ts';
import { tableTileStatus } from './table-tile-tone.ts';

// The hub's values, derived the way the screen each one opens derives it, so a
// number on the hub is the number the next screen shows (hub-scout pitfalls):
// kitchen rounds through kitchenBoardStats (not summarizeKitchenQueue), stock
// through inventoryTotals (not summarizeInventory), tables through
// tableTileStatus (not the raw status column), takings through
// summarizeHomeOrders as /home does, and the paid count through the archive's
// own query. No React here; src/hooks/use-hub-data.ts does the fetching.

export type HubLanguage = 'th' | 'en';

const count = (value: number, language: HubLanguage) =>
  value.toLocaleString(language === 'th' ? 'th-TH' : 'en-US');

// ---------------------------------------------------------------- takings

type TakingsOrder = Parameters<typeof summarizeHomeOrders>[0][number];

const bangkokClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** '14:32' in the shop's clock. */
export function hubClockLabel(now: number | Date): string {
  // Some engines print midnight as "24" even under h23; bangkokHour guards the same.
  return bangkokClock.format(new Date(now)).replace(/^24/, '00');
}

/** Today's takings as /home counts them: paid or completed, closed hour by hour. */
export function hubTakings(dayOrders: TakingsOrder[], now: number | Date = Date.now()): HubTakings {
  const at = new Date(now);
  const summary = summarizeHomeOrders(dayOrders);
  const nowHour = bangkokHour(at.toISOString());
  const curve = summary.paidOrders > 0 ? homeRevenueCurve(dayOrders, nowHour) : null;
  return {
    amount: summary.paidRevenue,
    curve,
    startLabel: hourLabel(curve ? curve.startHour : nowHour ?? 0),
    nowLabel: hubClockLabel(at),
  };
}

// ---------------------------------------------------------------- floor

type FloorTable = { ID: number; status: string; zone_id?: number | null };
type FloorOrder = { status: string; order_type: string; table_id?: number | null; payment_status?: string | null };

/** The statuses app/tables.tsx treats as someone sitting at the table. */
const ACTIVE_ORDER_STATUSES = new Set(['open', 'sent_to_kitchen', 'cooking', 'ready', 'served']);

/**
 * The floor as the tables screen paints it. Cells run zone by zone in the order
 * the zones first appear in the table list, each zone's tables in list order -
 * exactly how app/tables.tsx groups them - and a table whose tile would read
 * inactive is left out, as is its count.
 *
 * The bill count is the cells drawn with a bill edge, so the line and the strip
 * never disagree: two unpaid bills on one table are one cell. Takeaway bills
 * have no cell and are counted apart - the tables screen's takeaway section
 * (stress test, 2026-09-23, where "รอเช็คบิล 4" sat beside one blue cell).
 */
export function hubFloor(tables: readonly FloorTable[], activeOrders: readonly FloorOrder[]): HubFloor {
  const active = activeOrders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status));
  const seated = new Set(active.filter((order) => order.table_id).map((order) => Number(order.table_id)));
  const waiting = waitingBillOrders([...active]);
  const billTables = new Set(waiting.filter((order) => order.table_id).map((order) => Number(order.table_id)));

  const zones = new Map<string, FloorTable[]>();
  for (const table of tables) {
    const key = String(table.zone_id || 'none');
    const zone = zones.get(key);
    if (zone) zone.push(table);
    else zones.set(key, [table]);
  }

  const cells: HubTableCell[] = [];
  for (const zone of zones.values()) {
    for (const table of zone) {
      const tone = tableTileStatus(table.status, seated.has(table.ID));
      if (tone === 'inactive' || tone === 'takeaway') continue;
      cells.push({ key: String(table.ID), tone, waitingBill: billTables.has(table.ID) });
    }
  }

  return {
    free: cells.filter((cell) => cell.tone === 'free').length,
    total: cells.length,
    waitingBills: cells.filter((cell) => cell.waitingBill).length,
    takeawayBills: waiting.filter((order) => order.order_type === 'takeaway' && !order.table_id).length,
    cells,
  };
}

// ---------------------------------------------------------------- kitchen

type KitchenQueueOrder = {
  ID: number;
  kitchen_ticket_id?: string;
  kitchen_batch?: number;
  order_type: string;
  order_number?: string | null;
  table_id?: number | null;
  opened_at?: string | null;
  kitchen_sent_at?: string | null;
  table?: { display_label?: string | null; table_number?: string | null } | null;
  items?: readonly { status: OrderItemStatus; sent_at?: string | null; ready_at?: string | null }[] | null;
};

/** What a lane label reads. The customer's name and phone are deliberately not in it. */
type KitchenLaneOrder = Pick<KitchenQueueOrder, 'order_type' | 'order_number' | 'table_id' | 'table'>;

/** Letters a lane column holds at its narrowest before its label is cut ('T100', 'A01'). */
const LANE_LABEL_MAX = 4;
const COMBINING_MARK = /\p{M}/u;

/** Letters that take a column of their own: Thai vowel and tone marks sit on a letter. */
const visibleLength = (text: string) => Array.from(text).filter((char) => !COMBINING_MARK.test(char)).length;

/**
 * A table code that fits a lane column. Up to four letters it stays whole;
 * longer, it keeps its number, which tells a zone's tables apart, and only the
 * first letter of its zone prefix: 'ริมน้ำ07' is 'ร07', 'VIP01' is 'V01'. A code
 * with no number, or no letter before it, stays whole.
 */
function laneTableCode(code: string): string {
  if (visibleLength(code) <= LANE_LABEL_MAX) return code;
  const parts = /^(.*?)(\d+)$/u.exec(code);
  const letter = parts ? firstLetter(parts[1]) : null;
  return parts && letter ? letter + parts[2] : code;
}

/**
 * An order number's running count at its end. The demo seeders end theirs in
 * ' (Test)' (entity.TestOrderSuffix), which is read past, not mistaken for no count.
 */
const TAKEAWAY_RUNNING_COUNT = /(\d+)(?:\s*\(test\))?$/i;

/**
 * A kitchen lane's label, short enough for its 21-40 pt column (stress test,
 * 2026-09-23: zone codes, 'ซื้อกลับบ้าน', names and phone numbers were all cut to
 * stubs). A table is its code as the kitchen board prints it, without the
 * "โต๊ะ" word, shortened by laneTableCode. A takeaway is its order number's
 * running count, '20260923-015' being '#15': never the customer's name, which
 * is long and is often a phone number. The lane's middle ellipsis is the last
 * resort; the kitchen screen one tap away has the names.
 */
export function kitchenLaneLabel(order: KitchenLaneOrder, language: HubLanguage): string {
  if (order.order_type === 'takeaway') {
    const count = TAKEAWAY_RUNNING_COUNT.exec(order.order_number?.trim() ?? '')?.[1].replace(/^0+(?=\d)/, '');
    return count ? `#${count}` : (language === 'th' ? 'กลับบ้าน' : 'Takeaway');
  }
  return laneTableCode(laneFullTableCode(order));
}

/** The table's code as the kitchen board prints it, before laneTableCode shortens it. */
function laneFullTableCode(order: KitchenLaneOrder): string {
  return order.table?.display_label?.trim()
    || order.table?.table_number?.trim()
    || (order.table_id ? String(order.table_id) : '−');
}

/**
 * Every lane's label. Two zones that start with the same letter shorten two
 * different tables to one label ('ริมน้ำ07' and 'ระเบียง07' both 'ร07'); those
 * lanes keep their whole codes, and the lane's middle ellipsis keeps both ends.
 * Two rounds on one table share a label, as they should.
 */
function kitchenLaneLabels(orders: readonly KitchenLaneOrder[], language: HubLanguage): string[] {
  const labels = orders.map((order) => kitchenLaneLabel(order, language));
  const codes = orders.map((order) => (order.order_type === 'takeaway' ? null : laneFullTableCode(order)));
  return labels.map((label, index) => {
    const code = codes[index];
    if (code === null || code === label) return label;
    const clashes = labels.some((other, at) => at !== index && other === label && codes[at] !== code);
    return clashes ? code : label;
  });
}

/**
 * The kitchen tile, derived as app/kitchen.tsx derives its board: tickets with
 * an item still cooking, longest wait first; tickets with an item done; the
 * board's own stats; and each lane timed over its cooking items only, as the
 * ticket card times it.
 */
export function hubKitchen(
  queueOrders: readonly KitchenQueueOrder[],
  now: number = Date.now(),
  language: HubLanguage = 'th',
): HubKitchen {
  const cooking = sortTickets(
    queueOrders.filter((order) => (order.items || []).some((item) => isCookingItem(item.status))),
    'waiting',
    now,
  );
  const done = queueOrders.filter((order) => (order.items || []).some((item) => isKitchenDoneItem(item.status)));
  const stats = kitchenBoardStats(cooking, done, now);
  const labels = kitchenLaneLabels(cooking, language);
  const lanes: HubKitchenLane[] = cooking.map((order, index) => {
    const timing = kitchenTicketTiming({
      opened_at: order.opened_at,
      kitchen_sent_at: order.kitchen_sent_at,
      items: (order.items || []).filter((item) => isCookingItem(item.status)),
    }, now);
    return {
      key: kitchenTicketKey(order),
      label: labels[index],
      progress: ticketProgress(timing.minutes),
      urgency: timing.urgency,
    };
  });
  return { cooking: stats.cookingRounds, overdue: stats.overdueRounds, done: stats.doneRounds, lanes };
}

// ---------------------------------------------------------------- orders, stock, AI

/** The archive's own query (orderListRequest), one row, for its pagination total. */
export function hubPaidTodayRequest(date: string) {
  const request = orderListRequest('archive', { date, page: 1, limit: 1 });
  if (!request) throw new Error('archive access is required');
  return request;
}

export function hubPaidToday(response: { orders?: readonly unknown[] | null; pagination?: { total?: number } | null }): HubPaidToday {
  const total = Number(response.pagination?.total);
  return { count: Number.isFinite(total) && total >= 0 ? total : (response.orders ?? []).length };
}

type MenuStockItem = { is_available: boolean; remaining_servings?: number | null };

/**
 * The menu chip's badge: dishes whose stock cannot make another portion, and
 * the POS grid's amber badge (LOW_STOCK_SERVINGS or fewer left). A dish switched
 * off by hand with stock to spare, or with no recipe, is a choice rather than a
 * shortage, and counted, it kept a red badge on the chip every day (stress
 * test, 2026-09-23). The switch alone cannot tell the two apart: the backend
 * switches a dish off itself when an ingredient in its recipe runs out
 * (disableMenusForDepletedIngredients), so it is the stock that is read.
 */
export function hubMenuStock(items: readonly MenuStockItem[]): HubMenuStock {
  const ranOut = (item: MenuStockItem) => typeof item.remaining_servings === 'number' && item.remaining_servings <= 0;
  return {
    soldOut: items.filter(ranOut).length,
    low: items.filter((item) => menuStockBadge(item)?.kind === 'low').length,
  };
}

/** Out and low as the inventory screen counts them (stock <= min_stock), not the 1.5x rule. */
export function hubInventoryStock(ingredients: Ingredient[]): HubInventoryStock {
  const totals = inventoryTotals(ingredients);
  return { out: totals.out, low: totals.low };
}

/** Unseen proactive insights, as the assistant screen counts its badge. */
export function hubUnseenInsights(
  insights: readonly Pick<AIInsight, 'kind' | 'title' | 'metric'>[],
  seen: readonly string[],
): HubInsights {
  const seenKeys = new Set(seen);
  return { unseen: insights.filter((insight) => !seenKeys.has(insightKey(insight))).length };
}

// ---------------------------------------------------------------- wording

/**
 * A figure line whose numbers a layout draws large: 'ว่าง 8 จาก 14 โต๊ะ' is
 * [ว่าง ][8][ จาก ][14][ โต๊ะ] with the numbers strong. Joined, the pieces are
 * the accessibility text.
 */
export type HubFigurePiece = { text: string; strong?: boolean };

/** 'ว่าง 8 จาก 14 โต๊ะ'; a shop with no tables yet says so rather than '0 of 0'. */
export function floorFigure(floor: HubFloor, language: HubLanguage): HubFigurePiece[] {
  if (floor.total === 0) return [{ text: language === 'th' ? 'ยังไม่มีโต๊ะ' : 'No tables yet' }];
  const free = { text: count(floor.free, language), strong: true };
  const total = { text: count(floor.total, language), strong: true };
  return language === 'th'
    ? [{ text: 'ว่าง ' }, free, { text: ' จาก ' }, total, { text: ' โต๊ะ' }]
    : [free, { text: ' of ' }, total, { text: floor.total === 1 ? ' table free' : ' tables free' }];
}

export function kitchenFigure(kitchen: HubKitchen, language: HubLanguage): HubFigurePiece[] {
  const rounds = { text: count(kitchen.cooking, language), strong: true };
  return language === 'th'
    ? [{ text: 'กำลังทำ ' }, rounds, { text: ' รอบ' }]
    : [{ text: 'Cooking ' }, rounds, { text: kitchen.cooking === 1 ? ' round' : ' rounds' }];
}

export function paidTodayFigure(paid: HubPaidToday, language: HubLanguage): HubFigurePiece[] {
  return [
    { text: language === 'th' ? 'ปิดบิลวันนี้ ' : 'Paid today ' },
    { text: count(paid.count, language), strong: true },
  ];
}

export function hubFigureText(pieces: readonly HubFigurePiece[]): string {
  return pieces.map((piece) => piece.text).join('');
}

/**
 * Waiting bills are the cashier's cue, so the line is always said: the bills
 * at tables, which are the strip's blue cells, then the takeaway bills, which
 * have no cell - 'รอเช็คบิล 1, กลับบ้าน 3' - each only when there is one.
 */
export function floorSegments(floor: HubFloor, language: HubLanguage): HubSegment[] {
  const segments: HubSegment[] = [];
  if (floor.waitingBills > 0) {
    const n = count(floor.waitingBills, language);
    segments.push({ text: language === 'th' ? `รอเช็คบิล ${n}` : `Waiting to pay ${n}`, tone: 'info' });
  }
  if (floor.takeawayBills > 0) {
    const n = count(floor.takeawayBills, language);
    segments.push({ text: language === 'th' ? `กลับบ้าน ${n}` : `Takeaway ${n}`, tone: 'info' });
  }
  return segments.length ? segments : [{ text: language === 'th' ? 'ไม่มีบิลรอ' : 'No bills waiting' }];
}

/** The kitchen screen's chips at zero too: 'เกินเวลา 0, เสร็จแล้ว 0'. */
export function kitchenSegments(kitchen: HubKitchen, language: HubLanguage): HubSegment[] {
  const overdue = count(kitchen.overdue, language);
  const done = count(kitchen.done, language);
  return [
    {
      text: language === 'th' ? `เกินเวลา ${overdue}` : `Overdue ${overdue}`,
      ...(kitchen.overdue > 0 ? { tone: 'danger' as const } : {}),
    },
    {
      text: language === 'th' ? `เสร็จแล้ว ${done}` : `Finished ${done}`,
      ...(kitchen.done > 0 ? { tone: 'success' as const } : {}),
    },
  ];
}

export function menuSegments(menu: HubMenuStock, language: HubLanguage): HubSegment[] {
  const segments: HubSegment[] = [];
  if (menu.soldOut > 0) {
    const n = count(menu.soldOut, language);
    segments.push({ text: language === 'th' ? `หมด ${n} เมนู` : `Sold out ${n}`, tone: 'danger' });
  }
  if (menu.low > 0) {
    const n = count(menu.low, language);
    segments.push({ text: language === 'th' ? `ใกล้หมด ${n}` : `Low ${n}`, tone: 'warning' });
  }
  return segments.length ? segments : [{ text: language === 'th' ? 'ไม่มีเมนูหมด' : 'Nothing sold out' }];
}

export function inventorySegments(stock: HubInventoryStock, language: HubLanguage): HubSegment[] {
  const segments: HubSegment[] = [];
  if (stock.out > 0) {
    const n = count(stock.out, language);
    segments.push({ text: language === 'th' ? `หมด ${n}` : `Out ${n}`, tone: 'danger' });
  }
  if (stock.low > 0) {
    const n = count(stock.low, language);
    segments.push({ text: language === 'th' ? `ใกล้หมด ${n}` : `Low ${n}`, tone: 'warning' });
  }
  return segments.length ? segments : [{ text: language === 'th' ? 'ของครบ' : 'All stocked' }];
}

export function insightsSegments(insights: HubInsights, language: HubLanguage): HubSegment[] {
  if (insights.unseen > 0) {
    const n = count(insights.unseen, language);
    return [{ text: language === 'th' ? `ควรรู้วันนี้ ${n}` : `Today's insights ${n}`, tone: 'info' }];
  }
  return [{ text: language === 'th' ? 'ไม่มีเรื่องใหม่' : 'Nothing new' }];
}

/** A value line as one string: segments joined with ', ', never ' · '. */
export function hubSegmentsText(segments: readonly HubSegment[]): string {
  return segments.map((segment) => segment.text).join(', ');
}

const TONE_RANK: Record<HubTone, number> = { danger: 4, warning: 3, info: 2, success: 1 };

/** The tone a leading dot takes: the most severe one present, or none. */
export function mostSevereTone(segments: readonly HubSegment[]): HubTone | null {
  let worst: HubTone | null = null;
  for (const segment of segments) {
    if (segment.tone && (!worst || TONE_RANK[segment.tone] > TONE_RANK[worst])) worst = segment.tone;
  }
  return worst;
}

/**
 * The branch line, ported from frontend/src/lib/branchLabel.ts: "สาขา" is added
 * only when the name lacks it, and a shop with no branch says so.
 */
export function branchLabel(branch: string | null | undefined, language: HubLanguage): string {
  const name = (branch ?? '').trim();
  if (language === 'th') {
    if (!name) return 'ไม่ระบุสาขา';
    return name.startsWith('สาขา') ? name : `สาขา${name}`;
  }
  if (!name) return 'No branch set';
  return /\bbranch$/i.test(name) || name.startsWith('สาขา') ? name : `${name} branch`;
}

// ---------------------------------------------------------------- who loads what

export type HubLoaderKey = 'takings' | 'floor' | 'kitchen' | 'paidToday' | 'menu' | 'inventory' | 'insights';

export const HUB_LOADER_KEYS: readonly HubLoaderKey[] = ['takings', 'floor', 'kitchen', 'paidToday', 'menu', 'inventory', 'insights'];
/** Fired on every focus, skipped while younger than their minimum age. */
export const HUB_LIGHT_LOADERS: readonly HubLoaderKey[] = ['floor', 'kitchen', 'paidToday', 'takings'];
/** Fired after interactions settle, at most every five minutes. Never on the order stream. */
export const HUB_HEAVY_LOADERS: readonly HubLoaderKey[] = ['menu', 'inventory', 'insights'];

/** Any one of these lets the backend's OrderEvents stream open (controller/order.go). */
export const HUB_ORDER_STREAM_PERMISSIONS = ['view_orders', 'take_order', 'take_payment', 'view_kitchen', 'update_order_status'] as const;

export type HubAccess = {
  /** rbac.can bound to the active membership. */
  can: (permission: string) => boolean;
  /** Dishy AI is the owner's alone (canUseAIAssistant, backend requireAIOwner). */
  roleName?: string | null;
};

export type HubLoaderPlan = Record<HubLoaderKey, boolean> & {
  /** Whether the hub may open the order event stream at all. */
  stream: boolean;
};

/**
 * Which loaders run for this member. A loader runs only when its row is on the
 * hub (the nav item's permission, as app-shell's isAllowed decides) and the
 * backend will answer its request, so no hub request can come back 403:
 * - takings: /home's row (view_dashboard), the day list (view_orders), and the
 *   owner's gate on takings (view_reports - owners and managers, 2026-09-23);
 * - floor: the pos row (take_order), which ListTables and status=active accept;
 * - kitchen: view_kitchen, KitchenQueue's own check;
 * - paidToday: view_orders - requireOrderListAccess refuses a take_order-only
 *   member anything but status=active, though the orders row still shows;
 * - menu / inventory: the row's permission, which the list endpoints accept;
 * - insights: the owner only.
 */
export function hubLoaderPlan(access: HubAccess): HubLoaderPlan {
  const can = (permission: string) => access.can(permission);
  const takings = can('view_dashboard') && can('view_orders') && can('view_reports');
  const floor = can('take_order');
  const kitchen = can('view_kitchen');
  const paidToday = can('view_orders');
  const menu = can('view_menu') || can('manage_menu');
  const inventory = can('view_inventory') || can('manage_inventory');
  const insights = canUseAIAssistant(access.roleName ?? undefined);
  const stream = (takings || floor || kitchen || paidToday) && HUB_ORDER_STREAM_PERMISSIONS.some(can);
  return { takings, floor, kitchen, paidToday, menu, inventory, insights, stream };
}

/**
 * What coming back from a row's page should refetch at once, whatever its age.
 * A page can change more than its own value: paying from the floor moves the
 * paid count and the takings, a stock count moves what the menu can still make,
 * and the assistant can switch dishes off. Menu and stock never ride the order
 * stream, so the two pages that move them must name them here: an order taken
 * at POS commits portions (backend MenuRemainingServings counts pending and
 * cooking items), and marking food ready - in the kitchen, or when POS takes
 * payment - deducts ingredient stock and can switch a dish off
 * (deductInventoryForCompletedKitchenItem); a cancel releases portions.
 */
export const HUB_ROW_LOADERS: Record<HubRowKey, readonly HubLoaderKey[]> = {
  home: ['takings'],
  pos: ['floor', 'kitchen', 'paidToday', 'takings', 'menu', 'inventory'],
  kitchen: ['kitchen', 'floor', 'menu', 'inventory'],
  orders: ['paidToday'],
  menu: ['menu'],
  inventory: ['inventory', 'menu'],
  'tables-manage': ['floor'],
  expenses: [],
  reports: [],
  ai: ['insights', 'menu', 'inventory'],
  settings: [],
};

const MONEY_ACTIONS = new Set(['order.paid', 'order.closed', 'order.cancelled']);

/**
 * Which loaders an order-stream batch wakes. Every order action can move the
 * floor. The kitchen reloads on exactly the actions the kitchen screen reloads
 * on (isKitchenOrderChangeEvent), so its tile moves when the board does. Only a
 * bill closing or cancelling touches the paid count and the 200-order day list.
 * A resync (the stream (re)connected, or the app came back) reloads all four.
 * Menu, stock and AI never ride the stream.
 */
export function hubLoadersForEvents(batch: { actions: readonly string[]; resync: boolean }): HubLoaderKey[] {
  const wanted = new Set<HubLoaderKey>();
  if (batch.resync) HUB_LIGHT_LOADERS.forEach((key) => wanted.add(key));
  for (const action of batch.actions) {
    wanted.add('floor');
    if (isKitchenOrderChangeEvent({ type: 'orders.changed', action, occurred_at: '' })) wanted.add('kitchen');
    if (MONEY_ACTIONS.has(action)) {
      wanted.add('paidToday');
      wanted.add('takings');
    }
  }
  return HUB_LOADER_KEYS.filter((key) => wanted.has(key));
}

// ---------------------------------------------------------------- when to load

export const HUB_TIMING = {
  /** A light loader's value younger than this is not refetched on focus. */
  lightMinAgeMs: 10_000,
  /** Nor a heavy one's younger than this. */
  heavyMinAgeMs: 5 * 60_000,
  /** At most one request per loader per this, with a trailing call. */
  minIntervalMs: 3_000,
  /** The day list is the heaviest light request: /home's own 15 s cadence. */
  takingsMinIntervalMs: 15_000,
  /** Ages the kitchen lanes and the clock without a request; the kitchen screen's tick. */
  clockTickMs: 20_000,
  /** The slow poll while focused: the floor every time, the kitchen too while the stream is not live... */
  recoveryPollMs: 30_000,
  /** ...once it has not been live for this long. */
  recoveryAfterMs: 30_000,
  /** The server's `connected` greeting refetches nothing this soon after a focus load. */
  connectedSkipMs: 2_000,
} as const;

export function hubLoaderMinAge(key: HubLoaderKey): number {
  return HUB_HEAVY_LOADERS.includes(key) ? HUB_TIMING.heavyMinAgeMs : HUB_TIMING.lightMinAgeMs;
}

export function hubLoaderMinInterval(key: HubLoaderKey): number {
  return key === 'takings' ? HUB_TIMING.takingsMinIntervalMs : HUB_TIMING.minIntervalMs;
}

export type HubLoaderClock = {
  /** When the last successful load landed. */
  loadedAt: number | null;
  /** When the request whose value is held went out: the moment its snapshot can be older than. */
  loadedFrom?: number | null;
  /** When the last request went out. */
  startedAt: number | null;
  inFlight: boolean;
};

export type HubLoadDecision =
  | { kind: 'fresh' }
  | { kind: 'queue' }
  | { kind: 'wait'; delayMs: number }
  | { kind: 'run' };

/**
 * Whether a load asked for now should go out: `fresh` when the value is young
 * enough for the caller's minimum age, `queue` when one is in flight (it runs
 * once more when that lands), `wait` when the last request left too recently (a
 * trailing call after the gap), else `run`. `force` - pull-to-refresh, or the
 * row just opened - skips the age and the gap but still never doubles up.
 */
export function hubLoadDecision(
  clock: HubLoaderClock,
  request: { now: number; minAgeMs?: number; minIntervalMs: number; force?: boolean },
): HubLoadDecision {
  const { now, minAgeMs, minIntervalMs, force } = request;
  if (!force && minAgeMs !== undefined && clock.loadedAt !== null && now - clock.loadedAt < minAgeMs) {
    return { kind: 'fresh' };
  }
  if (clock.inFlight) return { kind: 'queue' };
  if (!force && clock.startedAt !== null && now - clock.startedAt < minIntervalMs) {
    return { kind: 'wait', delayMs: clock.startedAt + minIntervalMs - now };
  }
  return { kind: 'run' };
}

export type HubFocusLoad = { minAgeMs: number; force: boolean; afterChange: boolean };

/**
 * How a load asked for on focus goes out. The order stream is closed while a
 * page covers the hub, so a light value whose request left before the hub last
 * blurred may have missed a change made meanwhile on another device: on
 * refocus it is never fresh, however young, and one still in flight from
 * before the blur is followed by one more. The focus load then really goes
 * out, which is what lets the server's `connected` greeting be skipped
 * (connectedSkipMs). Heavy values never ride the stream, so a blur changes
 * nothing for them. `forced` is the page just visited (noteOpened).
 */
export function hubFocusLoad(
  key: HubLoaderKey,
  clock: HubLoaderClock,
  lastBlurAt: number | null,
  forced: boolean,
): HubFocusLoad {
  const heldFrom = clock.loadedFrom ?? clock.loadedAt;
  const missedChanges = HUB_LIGHT_LOADERS.includes(key)
    && lastBlurAt !== null
    && (heldFrom === null || heldFrom <= lastBlurAt);
  return {
    minAgeMs: missedChanges ? 0 : hubLoaderMinAge(key),
    force: forced,
    afterChange: missedChanges,
  };
}

/** The loaders whose value belongs to one Bangkok day: the day list and the paid count. */
export const HUB_DAY_LOADERS: readonly HubLoaderKey[] = ['takings', 'paidToday'];

/**
 * Whether a held value still answers for `now`. A day value asked for on a day
 * that has ended is not today's value at all - yesterday's total must never
 * sit under "ยอดวันนี้" - so the slot shows bones until the new day's lands, and
 * a failed reload shows the failure. Every other value is whatever the last
 * load said.
 */
export function hubHeldValueIsCurrent(key: HubLoaderKey, heldDay: string | null, now: number): boolean {
  return !HUB_DAY_LOADERS.includes(key) || heldDay === formatBangkokDate(new Date(now));
}

/**
 * The day values held from an earlier Bangkok day than `now`, by when the
 * held value's request left (loadedFrom only moves on success). The clock tick
 * reloads these every time, so after midnight a failed reload is simply asked
 * again on the next tick until one lands. A loader holding nothing is left to
 * its focus load and its retry.
 */
export function hubStaleDayLoaders(clockOf: (key: HubLoaderKey) => HubLoaderClock, now: number): HubLoaderKey[] {
  const today = formatBangkokDate(new Date(now));
  return HUB_DAY_LOADERS.filter((key) => {
    const clock = clockOf(key);
    const heldFrom = clock.loadedFrom ?? clock.loadedAt;
    return heldFrom !== null && heldFrom !== undefined && formatBangkokDate(new Date(heldFrom)) !== today;
  });
}

/** Recovery polling runs only once the stream has been down for recoveryAfterMs. */
export function hubShouldRecover(notLiveSince: number | null, now: number): boolean {
  return notLiveSince !== null && now - notLiveSince >= HUB_TIMING.recoveryAfterMs;
}

/**
 * What the slow poll reloads while the hub is focused. The floor always: a
 * table reserved, freed or switched off publishes no order event, and the
 * tables screen the floor tile opens polls for exactly that. The kitchen too
 * once the stream has been down recoveryAfterMs. Nothing heavy is polled.
 */
export function hubPollLoaders(notLiveSince: number | null, now: number): HubLoaderKey[] {
  return hubShouldRecover(notLiveSince, now) ? ['floor', 'kitchen'] : ['floor'];
}
