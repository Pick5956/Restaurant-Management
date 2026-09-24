import { APP_FONT_SCALE, scaleFont } from './app-font.ts';
import type {
  HubFloor,
  HubInsights,
  HubInventoryStock,
  HubKitchen,
  HubMenuStock,
  HubNavItem,
  HubRowKey,
  HubSlot,
  HubTakings,
  HubTone,
} from './hub-types.ts';

// Layout B, "เวที" (hub-final.json, runnerUp): which service tiles straddle the
// stage's edge and how they pair, whether the shop is working right now, and
// the one number a shelf chip carries; and, after the stress pass of
// 2026-09-23, every width, column and line count the stage decides from its
// measured column and the OS text size. Pure, so node --test runs it; the
// drawing is src/components/hub/hub-stage.tsx.

export type StageTileKey = 'pos' | 'kitchen' | 'orders';

/** One row of raised tiles under the stage, always in the order floor, kitchen, orders. */
export type StageTileRow =
  | { kind: 'wide'; key: StageTileKey }
  | { kind: 'pair'; keys: readonly ['kitchen', 'orders'] };

/**
 * The floor tile runs full width, kitchen and orders pair up under it, and the
 * order is the same for every role. Orders pairs only when it has a value. The
 * orders row and its paid count share one gate now (view_orders), so a member
 * who sees the row can count it; the check stays because a tile with nothing
 * under its title would stretch to the kitchen's height as an empty box. It
 * drops to a compact wide tile instead.
 */
export function stageTileRows(keys: readonly HubRowKey[], ordersHasValue: boolean): StageTileRow[] {
  const has = (key: StageTileKey) => keys.includes(key);
  const rows: StageTileRow[] = [];
  if (has('pos')) rows.push({ kind: 'wide', key: 'pos' });
  if (has('kitchen') && has('orders') && ordersHasValue) {
    rows.push({ kind: 'pair', keys: ['kitchen', 'orders'] });
    return rows;
  }
  if (has('kitchen')) rows.push({ kind: 'wide', key: 'kitchen' });
  if (has('orders')) rows.push({ kind: 'wide', key: 'orders' });
  return rows;
}

/** The first tile under the stage. It hosts the heartbeat when the stage carries no takings line. */
export function firstStageTile(rows: readonly StageTileRow[]): StageTileKey | null {
  const first = rows[0];
  if (!first) return null;
  return first.kind === 'wide' ? first.key : first.keys[0];
}

export type StageActivity = 'busy' | 'idle' | 'unknown';

/**
 * Whether the shop is working, read from the tile loaders and never from the
 * opening hours, which cannot be told apart from their defaults.
 * - busy: a table is seated, a bill is waiting (at a table or to take away),
 *   or a round is cooking.
 * - idle: every floor or kitchen value this member has has arrived and none of
 *   that holds.
 * - unknown: still loading, failed, or neither value is on this hub.
 */
export function stageActivity(floor: HubSlot<HubFloor>, kitchen: HubSlot<HubKitchen>): StageActivity {
  const floorValue = floor.status === 'ready' ? floor.value : null;
  const kitchenValue = kitchen.status === 'ready' ? kitchen.value : null;
  const billsWaiting = Boolean(floorValue && (floorValue.waitingBills > 0 || floorValue.takeawayBills > 0));
  const seated = billsWaiting || Boolean(floorValue && floorValue.cells.some((cell) => cell.tone === 'occupied'));
  const cooking = Boolean(kitchenValue && kitchenValue.cooking > 0);
  if (seated || cooking) return 'busy';
  const present = [floor, kitchen].filter((slot) => slot.status !== 'off');
  if (present.length && present.every((slot) => slot.status === 'ready' && slot.value)) return 'idle';
  return 'unknown';
}

/** A shelf chip's badge: a count in a status tone. Brand orange is not a status, so it is never one. */
export type ShelfBadge = { count: number; tone: Extract<HubTone, 'danger' | 'warning' | 'info'> };

export type ShelfValues = {
  menu: HubSlot<HubMenuStock>;
  inventory: HubSlot<HubInventoryStock>;
  insights: HubSlot<HubInsights>;
};

function readyValue<T>(slot: HubSlot<T>): T | null {
  return slot.status === 'ready' ? slot.value : null;
}

/**
 * The one number a shelf chip carries, in the most severe tone present:
 * sold-out dishes (else dishes running low), stock that is out (else low),
 * unseen insights. Only a value that asks for action gets a badge. Zero,
 * loading, a failed load and a value this member may not read get none; the
 * chip's accessibility label says the full value instead.
 */
export function shelfBadge(key: HubRowKey, values: ShelfValues): ShelfBadge | null {
  if (key === 'menu') {
    const menu = readyValue(values.menu);
    if (menu && menu.soldOut > 0) return { count: menu.soldOut, tone: 'danger' };
    if (menu && menu.low > 0) return { count: menu.low, tone: 'warning' };
    return null;
  }
  if (key === 'inventory') {
    const stock = readyValue(values.inventory);
    if (stock && stock.out > 0) return { count: stock.out, tone: 'danger' };
    if (stock && stock.low > 0) return { count: stock.low, tone: 'warning' };
    return null;
  }
  if (key === 'ai') {
    const insights = readyValue(values.insights);
    if (insights && insights.unseen > 0) return { count: insights.unseen, tone: 'info' };
  }
  return null;
}

/** Two digits at most: a badge is a mark, and the full count is in the chip's accessibility label. */
export function shelfBadgeText(count: number): string {
  const whole = Math.max(0, Math.round(count));
  return whole > 99 ? '99+' : String(whole);
}

export type StageShelfGroup = { key: 'shop' | 'team'; items: HubNavItem[] };

/**
 * The shelf under the tiles: 'งานร้าน', then 'ข้อมูลและบัญชี', each in the
 * order the items came and dropped when empty. The service items (home, pos,
 * kitchen, orders) live on the stage and its tiles, never on the shelf.
 */
export function stageShelfGroups(items: readonly HubNavItem[]): StageShelfGroup[] {
  return (['shop', 'team'] as const)
    .map((key) => ({ key, items: items.filter((item) => item.group === key) }))
    .filter((group) => group.items.length > 0);
}

// ---------------------------------------------------------------- the column

/**
 * The stage's content column before it has been measured: the window less the
 * tablet rail and both gutters, capped at the layout's width. The column's own
 * onLayout replaces it; it only has to be right on the first frame.
 */
export function stageContentWidth(windowWidth: number, gutter: number, contentMax: number, railWidth: number): number {
  return Math.max(0, Math.min(contentMax, windowWidth - railWidth - gutter * 2));
}

// ---------------------------------------------------------------- text size

/** Android's 'Largest' (1.3) and up: the size at which the pair was seen cutting its words. */
export const LARGE_TEXT_SCALE = 1.3;

/** A tile's figure and status line keep to one line, and may take a second at a large OS text size. */
export function valueLines(fontScale: number): 1 | 2 {
  return fontScale >= LARGE_TEXT_SCALE ? 2 : 1;
}

// ---------------------------------------------------------------- kitchen and orders

/** At the default text size the pair stacks below this content width, as it always has. */
export const PAIR_MIN_WIDTH = 340;
const PAIR_GAP = 10;
/** The kitchen's share of the pair (flex 1.4 against the orders' 1). */
const KITCHEN_SHARE = 1.4 / 2.4;
/** A tile's padding and edge (14 + 1 a side), and the status dot with its gap (6 + 5). */
const TILE_INSET = 30;
const STATUS_DOT = 11;

/** What the kitchen's status line has to draw in, beside the orders tile. */
function kitchenTextRoom(contentWidth: number): number {
  return (contentWidth - PAIR_GAP) * KITCHEN_SHARE - TILE_INSET - STATUS_DOT;
}

/**
 * Whether kitchen and orders stack instead of pairing. The words grow with the
 * OS text size and the tiles do not, so the room the status line has at
 * PAIR_MIN_WIDTH has to grow with it: at 1.3 a Pixel 6 stacks, which is where
 * 'เกินเวลา 13, เสร็จแล้ว 15' was seen cut.
 */
export function pairStacks(contentWidth: number, fontScale: number): boolean {
  return kitchenTextRoom(contentWidth) < kitchenTextRoom(PAIR_MIN_WIDTH) * Math.max(1, fontScale);
}

// ---------------------------------------------------------------- shelf

export type ShelfLayout = { sideBySide: boolean; columns: 1 | 2 };

const CHIP_GAP = 10;
const GROUP_GAP = 16;
/** A chip's padding (12 a side), its 36 icon and the 10 gap before the title. */
const CHIP_CHROME = 70;
/** The narrowest title slot a chip keeps (a 320 dp phone at the default size); longer titles take a second line. */
const CHIP_TITLE_MIN = 66;
/** Beside the other group a chip keeps a roomier slot, about 180 dp a chip at the default size. */
const CHIP_TITLE_ROOMY = 110;

function twoChipsFit(width: number, title: number, fontScale: number): boolean {
  return (width - CHIP_GAP) / 2 >= CHIP_CHROME + title * Math.max(1, fontScale);
}

/**
 * The shelf's groups and columns, from the measured column (so a tablet's rail
 * is already out of it) and the OS text size. Two columns at most: past that
 * a chip's title slot is narrower than a phone's. The groups stand side by
 * side only when each can hold two roomy chips, and a group drops to one
 * column when two chips would leave a title no room.
 */
export function shelfLayout(contentWidth: number, fontScale: number): ShelfLayout {
  const sideWidth = (contentWidth - GROUP_GAP) / 2;
  const sideBySide = twoChipsFit(sideWidth, CHIP_TITLE_ROOMY, fontScale);
  const groupWidth = sideBySide ? sideWidth : contentWidth;
  return { sideBySide, columns: twoChipsFit(groupWidth, CHIP_TITLE_MIN, fontScale) ? 2 : 1 };
}

// ---------------------------------------------------------------- heartbeat

export type StageHeartbeat = {
  /** The now-dot on the takings curve beats. */
  curve: boolean;
  /** The icon ring on this tile beats instead. */
  tile: StageTileKey | null;
};

/** A drawn curve that rises ends at its top, clear of the axis labels under it. */
function curveRises(takings: HubSlot<HubTakings>): boolean {
  const curve = takings.status === 'ready' ? takings.value?.curve : null;
  return Boolean(curve && curve.cumulative.some((value) => value > 0));
}

/**
 * The screen's one heartbeat, only while the shop is busy. It sits on the
 * now-dot only when the curve rises: a flat line (nothing paid yet, or only a
 * ฿0 bill) ends on the baseline, where the ring crosses the now label under
 * it. Otherwise it moves to the first tile's icon.
 */
export function stageHeartbeat(
  activity: StageActivity,
  takingsShown: boolean,
  takings: HubSlot<HubTakings>,
  rows: readonly StageTileRow[],
): StageHeartbeat {
  if (activity !== 'busy') return { curve: false, tile: null };
  if (takingsShown && curveRises(takings)) return { curve: true, tile: null };
  return { curve: false, tile: firstStageTile(rows) };
}

// ---------------------------------------------------------------- floor strip

export type FloorStripShape = 'row' | 'rows' | 'bar';

export const FLOOR_CELL_GAP = 3;
export const FLOOR_MIN_CELL = 8;
const FLOOR_ONE_ROW_MAX = 30;
const FLOOR_TWO_ROW_MAX = 60;
export const FLOOR_BAR_HEIGHT = 12;
/** The narrowest a state keeps on the bar, however small its share: a 1 pt bill is no cue. */
export const FLOOR_BAR_MIN_PART = 10;
export const FLOOR_BAR_GAP = 2;

/**
 * Up to 30 tables in one row, up to 60 in two, and past that one proportional
 * bar. Once the strip's width is known it also steps down early when a row of
 * minimum-width cells would not fit (a 320 pt phone holds about 25 per row).
 */
export function floorStripShape(count: number, width: number): FloorStripShape {
  const fit = width > 0 ? Math.max(1, Math.floor((width + FLOOR_CELL_GAP) / (FLOOR_MIN_CELL + FLOOR_CELL_GAP))) : Number.POSITIVE_INFINITY;
  if (count <= Math.min(FLOOR_ONE_ROW_MAX, fit)) return 'row';
  if (count <= Math.min(FLOOR_TWO_ROW_MAX, fit * 2)) return 'rows';
  return 'bar';
}

/** How tall the strip draws for this many tables: the bone's height when that count is remembered. */
export function floorStripHeight(count: number, width: number, cellHeight: number): number {
  if (count <= 0) return 0;
  const shape = floorStripShape(count, width);
  if (shape === 'rows') return cellHeight * 2 + FLOOR_CELL_GAP;
  return shape === 'bar' ? FLOOR_BAR_HEIGHT : cellHeight;
}

// The table count each restaurant's floor last showed, kept on the device so
// the bone is drawn at the strip's real height from the first frame of a cold
// start (stress test, 2026-09-23: 31-60 tables jumped 15 pt on every open).
// Stored as [restaurantId, tables] pairs, most recent last: an object would
// iterate its numeric keys in ascending order and lose which shop came last.

/** How many restaurants' table counts the device keeps. */
export const REMEMBERED_FLOORS_MAX = 20;

export type RememberedFloors = ReadonlyMap<number, number>;

const isCount = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min;

/** The stored counts; anything unreadable is dropped, never thrown. */
export function parseRememberedFloors(raw: string | null): RememberedFloors {
  if (!raw) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (!Array.isArray(parsed)) return new Map();
  const pairs = parsed.filter((entry): entry is [number, number] => (
    Array.isArray(entry) && entry.length === 2 && isCount(entry[0], 1) && isCount(entry[1], 0)
  ));
  return new Map(pairs.slice(-REMEMBERED_FLOORS_MAX));
}

/** A new map with this restaurant's count set and moved to the end, the oldest dropped past the cap. */
export function rememberFloor(floors: RememberedFloors, restaurantId: number, tables: number): RememberedFloors {
  const pairs = [...floors].filter(([id]) => id !== restaurantId);
  return new Map([...pairs, [restaurantId, tables] as [number, number]].slice(-REMEMBERED_FLOORS_MAX));
}

export function serializeRememberedFloors(floors: RememberedFloors): string {
  return JSON.stringify([...floors]);
}

/**
 * A cell's width in a row of `columns`: an even share of the width, capped so
 * a floor of a few tables reads as a few table squares from the row's start
 * rather than a full-width bar. Pass Infinity for no cap.
 */
export function floorCellWidth(columns: number, width: number, maxCell: number): number {
  const share = (width - (columns - 1) * FLOOR_CELL_GAP) / Math.max(1, columns);
  return Math.min(maxCell, share);
}

/**
 * Each state's width on the bar, in the order given: its share of what the
 * gaps leave, and never under FLOOR_BAR_MIN_PART, so one bill among 500
 * tables stays a visible mark. A zero share gets 0 and no gap.
 */
export function floorBarWidths(shares: readonly number[], width: number): number[] {
  const present = shares.filter((share) => share > 0).length;
  const widths = shares.map(() => 0);
  let room = width - Math.max(0, present - 1) * FLOOR_BAR_GAP;
  let open = shares.map((share, index) => (share > 0 ? index : -1)).filter((index) => index >= 0);
  // At most four states, so a few passes settle it: pin whatever falls under
  // the minimum, then share what is left among the rest.
  for (;;) {
    const total = open.reduce((sum, index) => sum + shares[index], 0);
    const small = open.filter((index) => (shares[index] / total) * room < FLOOR_BAR_MIN_PART);
    if (!small.length || small.length === open.length) {
      for (const index of open) widths[index] = small.length ? room / open.length : (shares[index] / total) * room;
      return widths;
    }
    for (const index of small) widths[index] = FLOOR_BAR_MIN_PART;
    room -= small.length * FLOOR_BAR_MIN_PART;
    open = open.filter((index) => !small.includes(index));
  }
}

// ---------------------------------------------------------------- shop name

/** The smallest a long shop name is drawn before it ellipsizes, as iOS's minimumFontScale 0.8 does. */
export const NAME_MIN_SCALE = 0.8;

/**
 * The authored font size that fits a name measured `natural` wide at `size`
 * into `available`, never under NAME_MIN_SCALE of it; past that the line
 * ellipsizes. Android's adjustsFontSizeToFit has no floor (minimumFontScale is
 * iOS-only) and shrank long names to about 9 pt. The drawn size is floored to
 * a whole pixel so AppText's rounding never pushes it back over the width.
 */
export function fittedNameSize(natural: number, available: number, size: number): number {
  if (natural <= 0 || available <= 0 || natural <= available) return size;
  const drawn = scaleFont(size);
  const fitted = Math.floor((drawn * available) / natural);
  const floor = Math.floor(drawn * NAME_MIN_SCALE);
  return Math.max(fitted, floor) / APP_FONT_SCALE;
}
