// The table-management floor ("ผังแก้ได้"): statuses, the lock, the numbering
// preview, rooms, search and the summary - everything the section decides that
// is not drawing.
//
// Numbering is a copy of the server's (backend/internal/service/table_service.go
// and table_service_helpers.go), not a guess at it: BulkCreateTables probes
// every label past any the restaurant already holds, MoveTableZone and a prefix
// change in UpdateZone do not. table-plan.test.mjs reads the Go source and fails
// if that changes, before the preview starts promising labels the server will
// not write.

import type { RestaurantTable, TableStatus, TableZone } from '@/src/types/table';

import { reservationClock } from './reservation-schedule.ts';
import { tableTileStatus } from './table-tile-tone.ts';

export type PlanLanguage = 'th' | 'en';
/** IDs of the tables that have an active order, or null when orders could not be loaded. */
export type ActiveOrderIds = ReadonlySet<number> | null | undefined;
/** A room on the floor: 'none' for ไม่มีโซน, otherwise the zone's ID. */
export type RoomKey = 'none' | number;

/** The setup tile's label size when every label fits, and the floor below which it stops shrinking. Kept under the 19-20 band. */
export const PLAN_TILE_LABEL_FONT = 18;
export const PLAN_TILE_LABEL_MIN_FONT = 12;

/** backend maxTableLabelProbes: this many taken labels in a row and the server gives up. */
export const MAX_TABLE_LABEL_PROBES = 500;
export const TABLE_COUNT_RANGE = { min: 1, max: 200 } as const;
export const TABLE_CAPACITY_RANGE = { min: 1, max: 50 } as const;
export const DEFAULT_TABLE_CAPACITY = 2;
export const ZONE_PREFIX_MAX = 8;
export const ZONE_NAME_MAX = 120;

/**
 * backend tableReleasingOrderStatuses: the only statuses that end an order. The
 * server locks a table while any other order is on it, so this is a denylist.
 * An allowlist of today's live statuses would let one the app has not heard of
 * yet read as free while the server refuses every edit to that table.
 */
const RELEASING_ORDER_STATUSES: ReadonlySet<string> = new Set(['completed', 'cancelled']);
const STATUS_ORDER: readonly TableStatus[] = ['free', 'occupied', 'reserved', 'inactive'];

const STATUS_WORDS: Record<TableStatus, Record<PlanLanguage, string>> = {
  free: { th: 'ว่าง', en: 'Free' },
  occupied: { th: 'กำลังใช้งาน', en: 'In use' },
  reserved: { th: 'จอง', en: 'Reserved' },
  inactive: { th: 'ปิดใช้งาน', en: 'Inactive' },
};

const NO_ZONE: Record<PlanLanguage, string> = { th: 'ไม่มีโซน', en: 'No zone' };
const UNNAMED_ZONE: Record<PlanLanguage, string> = { th: 'ไม่มีชื่อโซน', en: 'Unnamed zone' };

// ---------------------------------------------------------------------------
// Status and the lock
// ---------------------------------------------------------------------------

/** The tables with an order that is neither completed nor cancelled on them: the orders that lock a table. */
export function activeOrderTableIds(orders: readonly { table_id?: number | null; status: string }[]): Set<number> {
  const ids = new Set<number>();
  for (const order of orders) {
    const id = Number(order.table_id);
    if (!RELEASING_ORDER_STATUSES.has(order.status) && Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

/**
 * The status a setup tile shows: the floor's rule (an active order reads in
 * use whatever the column says), and an occupied column reads in use too, with
 * or without the orders loaded. The server locks a table on that column, so a
 * tile that read free there would be refused with no visible reason.
 */
export function planStatus(table: Pick<RestaurantTable, 'ID' | 'status'>, activeOrderIds?: ActiveOrderIds): TableStatus {
  const busy = Boolean(activeOrderIds?.has(table.ID)) || table.status === 'occupied';
  const status = tableTileStatus(table.status, busy);
  return status === 'takeaway' ? 'free' : status;
}

/**
 * The lock (owner, 2026-09-23): a table in service - an active order on it, or
 * its status occupied or reserved - cannot be changed from table management in
 * any way until service closes it. An inactive table is not locked: it has to
 * stay editable so it can be reopened. A free table with only a later booking
 * is not locked either. A locked table's planStatus is always occupied or
 * reserved, so its tile says why in its status word.
 */
export function tableLocked(table: Pick<RestaurantTable, 'ID' | 'status'>, activeOrderIds?: ActiveOrderIds): boolean {
  return Boolean(activeOrderIds?.has(table.ID)) || table.status === 'occupied' || table.status === 'reserved';
}

/** The floor's words: ว่าง / กำลังใช้งาน / จอง / ปิดใช้งาน. */
export function planStatusWord(status: TableStatus, language: PlanLanguage = 'th'): string {
  return STATUS_WORDS[status]?.[language] ?? STATUS_WORDS.free[language];
}

/** The tables a bulk action may touch: every one that is not locked, in the given order. */
export function selectableTableIds(tables: readonly RestaurantTable[], activeOrderIds?: ActiveOrderIds): number[] {
  return tables.filter((table) => !tableLocked(table, activeOrderIds)).map((table) => table.ID);
}

/**
 * The selection dock's second button: close when any selected table is free,
 * open when every one is closed. Locked tables are ignored; null means there is
 * nothing to act on.
 */
export function bulkAvailabilityAction(
  selected: readonly RestaurantTable[],
  activeOrderIds?: ActiveOrderIds,
): 'close' | 'open' | null {
  const open = selected.filter((table) => !tableLocked(table, activeOrderIds));
  if (open.length === 0) return null;
  return open.some((table) => planStatus(table, activeOrderIds) === 'free') ? 'close' : 'open';
}

/**
 * The tables a close has to ask about first: not locked, with a booking due
 * (upcoming_reservation_at). A booking for later does not lock a table, but
 * closing it would leave the guests without one. Keeps the given order.
 */
export function tablesWithUpcomingBooking(
  tables: readonly RestaurantTable[],
  activeOrderIds?: ActiveOrderIds,
): RestaurantTable[] {
  return tables.filter((table) => !tableLocked(table, activeOrderIds) && reservationClock(table.upcoming_reservation_at) !== null);
}

/**
 * The message of the close confirm, or null when nothing being closed has a
 * booking. Closing one table (its label is in the title): "มีจอง 19:00, คุณนภา",
 * and "ไม่ระบุชื่อ" in place of a missing name. Closing several (the title only
 * counts them): "มีจอง T5 19:00, T8 20:30".
 */
export function upcomingBookingNote(tables: readonly RestaurantTable[], language: PlanLanguage = 'th'): string | null {
  const booked = tablesWithUpcomingBooking(tables);
  if (booked.length === 0) return null;
  const lead = language === 'th' ? 'มีจอง' : 'Booked';
  const clock = (table: RestaurantTable) => reservationClock(table.upcoming_reservation_at, language) ?? '';
  if (tables.length === 1) {
    const name = String(booked[0].upcoming_reservation_name ?? '').trim() || (language === 'th' ? 'ไม่ระบุชื่อ' : 'no name');
    return `${lead} ${clock(booked[0])}, ${name}`;
  }
  return `${lead} ${booked.map((table) => `${planLabel(table)} ${clock(table)}`).join(', ')}`;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** What a table is called on screen: display_label, or table_number for a legacy row without one. */
export function planLabel(table: Pick<RestaurantTable, 'display_label' | 'table_number'>): string {
  return String(table.display_label ?? '').trim() || String(table.table_number ?? '');
}

/** The table's zone ID, or null for no zone (null, missing and 0 all mean none). */
export function tableZoneId(table: Pick<RestaurantTable, 'zone_id'>): number | null {
  const id = Number(table.zone_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function listedZoneName(table: RestaurantTable, zones: readonly TableZone[]): string {
  const id = tableZoneId(table);
  if (id === null) return '';
  const listed = zones.find((zone) => zone.ID === id)?.name?.trim();
  return listed || table.table_zone?.name?.trim() || String(table.zone ?? '').trim();
}

/** The zone a table sits in, said even when there is none: "ไม่มีโซน". */
export function planZoneName(table: RestaurantTable, zones: readonly TableZone[], language: PlanLanguage = 'th'): string {
  return listedZoneName(table, zones) || NO_ZONE[language];
}

/** A table and its zone as one value, drawn "T5 ไม่มีโซน": the label and the zone in their own styles. */
export function planTableTitle(
  table: RestaurantTable,
  zones: readonly TableZone[],
  language: PlanLanguage = 'th',
): { label: string; zone: string } {
  return { label: planLabel(table), zone: planZoneName(table, zones, language) };
}

/** "โต๊ะ GARDENXY03, ว่าง, 4 ที่นั่ง", with ", ไม่มี QR" when the table has no customer token. */
export function planTileAccessibilityLabel(
  table: RestaurantTable,
  status: TableStatus,
  language: PlanLanguage = 'th',
): string {
  const seats = Number(table.capacity) || 0;
  const noQr = !String(table.customer_token ?? '').trim();
  if (language === 'th') {
    return `โต๊ะ ${planLabel(table)}, ${planStatusWord(status, 'th')}, ${seats} ที่นั่ง${noQr ? ', ไม่มี QR' : ''}`;
  }
  return `Table ${planLabel(table)}, ${planStatusWord(status, 'en')}, ${seats} ${seats === 1 ? 'seat' : 'seats'}${noQr ? ', no QR' : ''}`;
}

// ---------------------------------------------------------------------------
// Numbering: BulkCreateTables, MoveTableZone and UpdateZone, mirrored
// ---------------------------------------------------------------------------

/**
 * A zone as the numbering sees it; null is ไม่มีโซน. A zone the add sheet is
 * about to create passes ID 0 with its typed prefix: no table sits in it yet.
 */
export type NumberingZone = Pick<TableZone, 'ID' | 'prefix'> | null;

/** One table's relabel: its current label and the one the server will give it. */
export type PlannedMove = { id: number; from: string; to: string; clash: boolean };

function sequenceOf(table: Pick<RestaurantTable, 'sequence_number'>): number {
  const sequence = Number(table.sequence_number);
  return Number.isFinite(sequence) ? sequence : 0;
}

function bySequenceThenId(left: RestaurantTable, right: RestaurantTable): number {
  return sequenceOf(left) - sequenceOf(right) || left.ID - right.ID;
}

function inZone(table: RestaurantTable, zone: NumberingZone): boolean {
  const id = tableZoneId(table);
  return zone === null ? id === null : id === zone.ID;
}

/** Every table_number the restaurant holds: the column the server's unique index and probe use. */
function takenNumbers(tables: readonly RestaurantTable[]): Set<string> {
  const taken = new Set<string>();
  for (const table of tables) {
    const number = String(table.table_number ?? '');
    if (number) taken.add(number);
  }
  return taken;
}

/** backend tableLabel: T<n> with no zone, the prefix (or Z) plus at least two digits in a zone. */
export function tableLabel(zone: NumberingZone, sequence: number): string {
  if (!zone) return `T${sequence}`;
  const prefix = String(zone.prefix ?? '').trim() || 'Z';
  return `${prefix}${String(sequence).padStart(2, '0')}`;
}

/** backend NextSequence: the highest sequence in that zone plus one. Gaps are not refilled. */
export function nextSequence(tables: readonly RestaurantTable[], zone: NumberingZone): number {
  let highest = 0;
  for (const table of tables) {
    if (inZone(table, zone)) highest = Math.max(highest, sequenceOf(table));
  }
  return highest + 1;
}

/**
 * The labels POST /tables/bulk-create will write for `count` tables in `zone`,
 * in order. Any label another table already holds is skipped and counting goes
 * on from there (nextFreeTableLabel). A result shorter than `count` means the
 * server would give up on the whole batch ("could not find an unused table
 * number"); it never happens outside a deliberately crowded shop.
 */
export function nextTableLabels(tables: readonly RestaurantTable[], zone: NumberingZone, count: number): string[] {
  const wanted = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const taken = takenNumbers(tables);
  const labels: string[] = [];
  let sequence = nextSequence(tables, zone);
  for (let made = 0; made < wanted; made += 1) {
    let probes = 0;
    while (taken.has(tableLabel(zone, sequence))) {
      probes += 1;
      sequence += 1;
      if (probes >= MAX_TABLE_LABEL_PROBES) return labels;
    }
    const label = tableLabel(zone, sequence);
    labels.push(label);
    taken.add(label);
    sequence += 1;
  }
  return labels;
}

/** "T9, T11–T12": ascending neighbours with the same prefix join into a run. */
export function compressLabelRuns(labels: readonly string[]): string {
  const runs: { first: string; last: string; stem: string | null; number: number }[] = [];
  for (const label of labels) {
    const match = /^(.*?)(\d+)$/.exec(label);
    const stem = match ? match[1] : null;
    const number = match ? Number(match[2]) : Number.NaN;
    const run = runs[runs.length - 1];
    if (run && stem !== null && run.stem === stem && number === run.number + 1) {
      run.last = label;
      run.number = number;
    } else {
      runs.push({ first: label, last: label, stem, number });
    }
  }
  return runs.map((run) => (run.first === run.last ? run.first : `${run.first}–${run.last}`)).join(', ');
}

/**
 * The label PATCH /tables/:id/move-zone will give `table` in `target`: the next
 * sequence at the end of that zone, with no probe, so `clash` means the server
 * will refuse with 409. Moving to the zone it is already in still renumbers.
 */
export function moveTargetLabel(
  tables: readonly RestaurantTable[],
  table: RestaurantTable,
  target: NumberingZone,
): { label: string; clash: boolean } {
  const label = tableLabel(target, nextSequence(tables, target));
  const clash = tables.some((other) => other.ID !== table.ID && other.table_number === label);
  return { label, clash };
}

/**
 * A bulk move, one PATCH per table in the order of `tables` (pass the floor
 * order, `floorOrder`). Movers already in the target are `skipped`. Locked
 * movers are `locked`: the server refuses them and a refused move takes no
 * sequence, so they are left out of the numbering (a selection should never
 * hold one, but a reload can lock a table after it was picked). Each move frees
 * its old label for the ones after it; `firstClash` is the first label the
 * server would refuse, which makes the destination unusable.
 */
export function bulkMoveLabels(
  tables: readonly RestaurantTable[],
  moverIds: Iterable<number>,
  target: NumberingZone,
  activeOrderIds?: ActiveOrderIds,
): { moves: PlannedMove[]; skipped: number[]; locked: number[]; firstClash: string | null } {
  const wanted = new Set(moverIds);
  const taken = takenNumbers(tables);
  const moves: PlannedMove[] = [];
  const skipped: number[] = [];
  const locked: number[] = [];
  let firstClash: string | null = null;
  let sequence = nextSequence(tables, target);
  for (const table of tables) {
    if (!wanted.has(table.ID)) continue;
    if (tableLocked(table, activeOrderIds)) {
      locked.push(table.ID);
      continue;
    }
    if (inZone(table, target)) {
      skipped.push(table.ID);
      continue;
    }
    taken.delete(String(table.table_number ?? ''));
    const to = tableLabel(target, sequence);
    sequence += 1;
    const clash = taken.has(to);
    if (clash && firstClash === null) firstClash = to;
    taken.add(to);
    moves.push({ id: table.ID, from: planLabel(table), to, clash });
  }
  return { moves, skipped, locked, firstClash };
}

/**
 * What a prefix change on `zone` does to its tables (UpdateZone): every table
 * keeps its sequence and takes the new prefix, one row at a time in id order
 * with no probe, so a row can clash with one not rewritten yet. `changes` are
 * in sequence order, and `from` and `to` are compressed runs for
 * "GARDENXY01–GARDENXY05 → B01–B05". `locked` are the zone's tables in service:
 * any one of them makes the server refuse the whole change ("table is in use"),
 * while a rename alone stays allowed. An unchanged or empty prefix changes
 * nothing (the form requires one).
 */
export function zoneRelabelPreview(
  tables: readonly RestaurantTable[],
  zone: TableZone,
  nextPrefix: string,
  activeOrderIds?: ActiveOrderIds,
): { changes: PlannedMove[]; from: string; to: string; firstClash: string | null; locked: number[] } {
  const prefix = String(nextPrefix ?? '').trim().toUpperCase();
  if (!prefix || prefix === String(zone.prefix ?? '').trim()) {
    return { changes: [], from: '', to: '', firstClash: null, locked: [] };
  }
  const renamed = { ID: zone.ID, prefix };
  const taken = takenNumbers(tables);
  const rewritten = new Map<number, PlannedMove>();
  let firstClash: string | null = null;
  const byRowId = tables.filter((table) => inZone(table, zone)).sort((left, right) => left.ID - right.ID);
  for (const table of byRowId) {
    taken.delete(String(table.table_number ?? ''));
    const to = tableLabel(renamed, sequenceOf(table));
    const clash = taken.has(to);
    if (clash && firstClash === null) firstClash = to;
    taken.add(to);
    rewritten.set(table.ID, { id: table.ID, from: planLabel(table), to, clash });
  }
  const members = [...byRowId].sort(bySequenceThenId);
  const changes = members.flatMap((table) => rewritten.get(table.ID) ?? []);
  return {
    changes,
    from: compressLabelRuns(changes.map((change) => change.from)),
    to: compressLabelRuns(changes.map((change) => change.to)),
    firstClash,
    locked: members.filter((table) => tableLocked(table, activeOrderIds)).map((table) => table.ID),
  };
}

// ---------------------------------------------------------------------------
// Rooms, search and filters
// ---------------------------------------------------------------------------

export type PlanRoom = {
  key: RoomKey;
  /** null for ไม่มีโซน. */
  zone: TableZone | null;
  /** The tables shown, in sequence order (after any status or search filter). */
  tables: RestaurantTable[];
  /** The whole room, whatever the filter shows. */
  count: number;
  seats: number;
};

export type PlanFilter = {
  room: RoomKey | 'all';
  status: TableStatus | null;
  query: string;
};

/** Zones in the server's order: display_order, then ID. */
export function sortZones(zones: readonly TableZone[]): TableZone[] {
  return [...zones].sort((left, right) => (Number(left.display_order) || 0) - (Number(right.display_order) || 0) || left.ID - right.ID);
}

function seatsOf(tables: readonly RestaurantTable[]): number {
  return tables.reduce((sum, table) => sum + (Number(table.capacity) || 0), 0);
}

function makeRoom(key: RoomKey, zone: TableZone | null, tables: RestaurantTable[]): PlanRoom {
  return { key, zone, tables, count: tables.length, seats: seatsOf(tables) };
}

/**
 * The floor's rooms in the server's order: ไม่มีโซน first, then every zone by
 * display_order and ID, inactive and empty zones included so no table ever
 * vanishes. ไม่มีโซน is a room only when it holds tables or there are no zones.
 * A table whose zone the list did not return (a refused or failed zones call)
 * still gets its room, from the zone preloaded on the row.
 */
export function planRooms(tables: readonly RestaurantTable[], zones: readonly TableZone[]): PlanRoom[] {
  const known = new Map<number, { zone: TableZone; order: number }>();
  for (const zone of zones) known.set(zone.ID, { zone, order: Number(zone.display_order) || 0 });
  for (const table of tables) {
    const id = tableZoneId(table);
    if (id === null || known.has(id)) continue;
    const preloaded = table.table_zone && table.table_zone.ID === id ? table.table_zone : null;
    known.set(id, preloaded
      ? { zone: preloaded, order: Number(preloaded.display_order) || 0 }
      : {
        zone: {
          ID: id,
          restaurant_id: table.restaurant_id,
          name: String(table.zone ?? '').trim(),
          prefix: '',
          display_order: 0,
          is_active: true,
        },
        order: Number.POSITIVE_INFINITY,
      });
  }

  const byRoom = new Map<RoomKey, RestaurantTable[]>();
  for (const table of tables) {
    const key: RoomKey = tableZoneId(table) ?? 'none';
    const list = byRoom.get(key);
    if (list) list.push(table);
    else byRoom.set(key, [table]);
  }
  for (const list of byRoom.values()) list.sort(bySequenceThenId);

  const ordered = [...known.values()].sort((left, right) => left.order - right.order || left.zone.ID - right.zone.ID);
  const rooms: PlanRoom[] = [];
  const unzoned = byRoom.get('none') ?? [];
  if (unzoned.length > 0 || ordered.length === 0) rooms.push(makeRoom('none', null, unzoned));
  for (const { zone } of ordered) rooms.push(makeRoom(zone.ID, zone, byRoom.get(zone.ID) ?? []));
  return rooms;
}

/** Every table in floor order: rooms in the server's order, sequences within them. */
export function floorOrder(tables: readonly RestaurantTable[], zones: readonly TableZone[]): RestaurantTable[] {
  return planRooms(tables, zones).flatMap((room) => room.tables);
}

/** The room's header: the zone's name, or ไม่มีโซน. */
export function roomName(room: Pick<PlanRoom, 'zone'>, language: PlanLanguage = 'th'): string {
  if (!room.zone) return NO_ZONE[language];
  return room.zone.name?.trim() || UNNAMED_ZONE[language];
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** "17 โต๊ะ, 38 ที่นั่ง", or "ไม่มีโต๊ะ" for an empty room. */
export function roomValue(room: Pick<PlanRoom, 'count' | 'seats'>, language: PlanLanguage = 'th'): string {
  if (room.count === 0) return language === 'th' ? 'ไม่มีโต๊ะ' : 'No tables';
  if (language === 'th') return `${formatCount(room.count)} โต๊ะ, ${formatCount(room.seats)} ที่นั่ง`;
  return `${formatCount(room.count)} ${room.count === 1 ? 'table' : 'tables'}, ${formatCount(room.seats)} ${room.seats === 1 ? 'seat' : 'seats'}`;
}

function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, '');
}

/** The number at the end of a label, without the zone's prefix: Z201 in a "Z2" zone is 01, not 201. */
function numericTail(table: RestaurantTable, zones: readonly TableZone[]): string | null {
  const label = planLabel(table);
  const id = tableZoneId(table);
  const zone = id === null ? null : zones.find((item) => item.ID === id) ?? table.table_zone ?? null;
  const prefix = id === null ? 'T' : String(zone?.prefix ?? '').trim();
  if (prefix && label.startsWith(prefix)) {
    const rest = label.slice(prefix.length);
    if (/^\d+$/.test(rest)) return rest;
  }
  return /(\d+)$/.exec(label)?.[1] ?? null;
}

/**
 * Search: a digits-only query matches the table number at the end of the label
 * ("5" finds T5, T15 and GARDENXY05, leading zeros ignored); anything else
 * matches the label, table_number or zone name, ignoring case.
 */
export function matchesPlanQuery(table: RestaurantTable, query: string, zones: readonly TableZone[] = []): boolean {
  const needle = String(query ?? '').trim().toLocaleLowerCase();
  if (!needle) return true;
  if (/^\d+$/.test(needle)) {
    const tail = numericTail(table, zones);
    return tail !== null && stripLeadingZeros(tail).includes(stripLeadingZeros(needle));
  }
  return [planLabel(table), String(table.table_number ?? ''), listedZoneName(table, zones)]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

/**
 * The rooms the floor draws under a filter. The room picker keeps its room
 * even when empty (its ghost tile still adds); a status or search keeps only
 * matching tiles and drops rooms left empty. Counts stay the whole room's.
 */
export function planFloor(
  tables: readonly RestaurantTable[],
  zones: readonly TableZone[],
  filter: PlanFilter,
  activeOrderIds?: ActiveOrderIds,
): PlanRoom[] {
  const rooms = planRooms(tables, zones).filter((room) => filter.room === 'all' || room.key === filter.room);
  const query = String(filter.query ?? '').trim();
  if (!filter.status && !query) return rooms;
  return rooms
    .map((room) => ({
      ...room,
      tables: room.tables.filter((table) =>
        (!filter.status || planStatus(table, activeOrderIds) === filter.status) && matchesPlanQuery(table, query, zones)),
    }))
    .filter((room) => room.tables.length > 0);
}

// ---------------------------------------------------------------------------
// Summary and defaults
// ---------------------------------------------------------------------------

export type PlanSummary = {
  tables: number;
  seats: number;
  counts: Record<TableStatus, number>;
  /** The statuses to draw as pills: those above zero, and only when at least two are. */
  pills: TableStatus[];
};

/** The whole inventory, closed tables included, counted the floor's way. */
export function planSummary(tables: readonly RestaurantTable[], activeOrderIds?: ActiveOrderIds): PlanSummary {
  const counts: Record<TableStatus, number> = { free: 0, occupied: 0, reserved: 0, inactive: 0 };
  for (const table of tables) counts[planStatus(table, activeOrderIds)] += 1;
  const present = STATUS_ORDER.filter((status) => counts[status] > 0);
  return { tables: tables.length, seats: seatsOf(tables), counts, pills: present.length >= 2 ? present : [] };
}

/** The seats a new table starts with: the most common capacity (ties to the smaller), else the fallback. */
export function mostCommonCapacity(tables: readonly RestaurantTable[], fallback = DEFAULT_TABLE_CAPACITY): number {
  const tally = new Map<number, number>();
  for (const table of tables) {
    const capacity = Number(table.capacity);
    if (Number.isInteger(capacity) && capacity >= TABLE_CAPACITY_RANGE.min && capacity <= TABLE_CAPACITY_RANGE.max) {
      tally.set(capacity, (tally.get(capacity) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [capacity, count] of tally) {
    if (count > bestCount || (count === bestCount && best !== null && capacity < best)) {
      best = capacity;
      bestCount = count;
    }
  }
  return best ?? fallback;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * The prefix a new zone is pre-filled with: the first letter no zone uses. T
 * comes last, because zone-less tables are T<n> and a "T" zone's T10 is the
 * same label as the tenth of them. Two letters once all 26 are taken.
 */
export function firstFreePrefix(zones: readonly Pick<TableZone, 'prefix'>[]): string {
  const used = new Set(zones.map((zone) => String(zone.prefix ?? '').trim().toUpperCase()));
  const singles = [...LETTERS.filter((letter) => letter !== 'T'), 'T'];
  for (const letter of singles) {
    if (!used.has(letter)) return letter;
  }
  for (const first of LETTERS) {
    for (const second of LETTERS) {
      if (!used.has(first + second)) return first + second;
    }
  }
  return '';
}

/** A prefix as typed: A-Z and 0-9 only, upper-cased, eight at most (the server counts bytes). */
export function normalizeZonePrefix(text: string | null | undefined): string {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ZONE_PREFIX_MAX);
}

/**
 * A number field whose limits are part of the control: digits only, clamped
 * the moment it is typed (300 shows 200), and null while the field is empty.
 */
export function stepperValue(text: string, min: number, max: number): number | null {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return Math.min(max, Math.max(min, Number(digits)));
}

/** Zone chips: the active zones, plus the one in use even when it is inactive, so a chip is always lit. */
export function zoneChoices(zones: readonly TableZone[], keepId: number | null): TableZone[] {
  return sortZones(zones).filter((zone) => zone.is_active !== false || zone.ID === keepId);
}

/** The rows a bulk create added: IDs that were not there before, in sequence order. */
export function newTablesSince(before: readonly RestaurantTable[], after: readonly RestaurantTable[]): RestaurantTable[] {
  const known = new Set(before.map((table) => table.ID));
  return after.filter((table) => !known.has(table.ID)).sort(bySequenceThenId);
}

/** A new zone goes last: the highest display_order plus one, not the zone count plus one. */
export function nextZoneDisplayOrder(zones: readonly Pick<TableZone, 'display_order'>[]): number {
  if (zones.length === 0) return 1;
  return Math.max(...zones.map((zone) => Number(zone.display_order) || 0)) + 1;
}

/** One ↑/↓ tap: the zones in their current order with `id` moved one step. The ends stay put. */
export function moveZoneInOrder(zones: readonly TableZone[], id: number, delta: -1 | 1): TableZone[] {
  const ordered = sortZones(zones);
  const index = ordered.findIndex((zone) => zone.ID === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return ordered;
  const moved = [...ordered];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}

/** Renumbers an ordering to 1..n; `changed` are the zones whose display_order must be PUT. */
export function renumberZones(ordered: readonly TableZone[]): { zones: TableZone[]; changed: TableZone[] } {
  const zones = ordered.map((zone, index) => (zone.display_order === index + 1 ? zone : { ...zone, display_order: index + 1 }));
  const changed = zones.filter((zone, index) => ordered[index].display_order !== zone.display_order);
  return { zones, changed };
}

/** "2 จาก 4": where a zone sits in the order. */
export function zoneOrderPosition(zones: readonly TableZone[], id: number): { position: number; total: number } | null {
  const ordered = sortZones(zones);
  const index = ordered.findIndex((zone) => zone.ID === id);
  return index < 0 ? null : { position: index + 1, total: ordered.length };
}
