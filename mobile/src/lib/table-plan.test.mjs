import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  activeOrderTableIds,
  bulkAvailabilityAction,
  bulkMoveLabels,
  compressLabelRuns,
  firstFreePrefix,
  floorOrder,
  MAX_TABLE_LABEL_PROBES,
  matchesPlanQuery,
  mostCommonCapacity,
  moveTargetLabel,
  moveZoneInOrder,
  newTablesSince,
  nextSequence,
  nextTableLabels,
  nextZoneDisplayOrder,
  normalizeZonePrefix,
  PLAN_TILE_LABEL_FONT,
  PLAN_TILE_LABEL_MIN_FONT,
  planFloor,
  planLabel,
  planRooms,
  planStatus,
  planStatusWord,
  planSummary,
  planTableTitle,
  planTileAccessibilityLabel,
  planZoneName,
  renumberZones,
  roomName,
  roomValue,
  selectableTableIds,
  stepperValue,
  tableLabel,
  tableLocked,
  tableZoneId,
  tablesWithUpcomingBooking,
  upcomingBookingNote,
  zoneChoices,
  zoneOrderPosition,
  zoneRelabelPreview,
} from './table-plan.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(mobileRoot, '..');

// ---------------------------------------------------------------------------
// Fixtures. Invented shops only: names, zones and tokens are made up here.
// ---------------------------------------------------------------------------

function zone(ID, prefix, overrides = {}) {
  return {
    ID,
    restaurant_id: 1,
    name: `โซน ${prefix || ID}`,
    prefix,
    display_order: ID,
    is_active: true,
    ...overrides,
  };
}

function table(ID, label, overrides = {}) {
  return {
    ID,
    restaurant_id: 1,
    zone_id: null,
    table_number: label,
    display_label: label,
    sequence_number: Number(/(\d+)$/.exec(label)?.[1] || 0),
    capacity: 2,
    zone: '',
    status: 'free',
    customer_token: 'a'.repeat(48),
    ...overrides,
  };
}

const riverside = zone(7, 'GARDENXY', { name: 'ลานหลังร้าน ใต้ร่มไม้', display_order: 1 });

/** An invented shop: T1-T17 unzoned, GARDENXY01-05 in one zone with a long prefix. */
function inventedShop() {
  const unzoned = Array.from({ length: 17 }, (_, index) => table(index + 1, `T${index + 1}`, { capacity: index < 2 ? 4 : 2 }));
  const zoned = Array.from({ length: 5 }, (_, index) => {
    const label = `GARDENXY0${index + 1}`;
    return table(101 + index, label, {
      zone_id: riverside.ID,
      zone: riverside.name,
      sequence_number: index + 1,
      capacity: 4,
      table_zone: riverside,
    });
  });
  return { tables: [...unzoned, ...zoned], zones: [riverside] };
}

// ---------------------------------------------------------------------------
// Status and the lock rule
// ---------------------------------------------------------------------------

test('active orders are collected by table: anything not completed or cancelled, as the server locks', () => {
  const ids = activeOrderTableIds([
    { table_id: 1, status: 'open' },
    { table_id: 2, status: 'sent_to_kitchen' },
    { table_id: 3, status: 'cooking' },
    { table_id: 4, status: 'ready' },
    { table_id: 5, status: 'served' },
    { table_id: 6, status: 'completed' },
    { table_id: 7, status: 'cancelled' },
    // A status the app does not know yet is still an open order to the server
    // (tableReleasingOrderStatuses lists only completed and cancelled).
    { table_id: 8, status: 'awaiting_payment' },
    { table_id: null, status: 'open' },
    { status: 'open' },
    { table_id: 0, status: 'open' },
  ]);
  assert.deepEqual([...ids].sort((a, b) => a - b), [1, 2, 3, 4, 5, 8]);
});

test('with orders loaded, an active order paints the table in use whatever its column says', () => {
  const orders = new Set([1, 3]);
  assert.equal(planStatus(table(1, 'T1'), orders), 'occupied');
  assert.equal(planStatus(table(3, 'T3', { status: 'inactive' }), orders), 'occupied');
  assert.equal(planStatus(table(2, 'T2'), orders), 'free');
  assert.equal(planStatus(table(4, 'T4', { status: 'reserved' }), orders), 'reserved');
  assert.equal(planStatus(table(5, 'T5', { status: 'inactive' }), orders), 'inactive');
});

test('without orders the column decides, and an occupied column never reads free', () => {
  for (const missing of [null, undefined]) {
    assert.equal(planStatus(table(1, 'T1', { status: 'occupied' }), missing), 'occupied');
    assert.equal(planStatus(table(2, 'T2'), missing), 'free');
    assert.equal(planStatus(table(3, 'T3', { status: 'reserved' }), missing), 'reserved');
    assert.equal(planStatus(table(4, 'T4', { status: 'inactive' }), missing), 'inactive');
  }
  // The column still says occupied although the loaded orders show nothing on
  // it (a lagging column, or an order past the list's page). The server locks
  // it on that column, so the tile has to say why instead of reading free.
  assert.equal(planStatus(table(1, 'T1', { status: 'occupied' }), new Set()), 'occupied');
});

test('the lock: every table that is not free of service is locked, and inactive alone is not', () => {
  const none = new Set();
  assert.equal(tableLocked(table(1, 'T1'), none), false);
  assert.equal(tableLocked(table(1, 'T1'), new Set([1])), true, 'an active order locks it');
  assert.equal(tableLocked(table(1, 'T1', { status: 'occupied' }), none), true);
  assert.equal(tableLocked(table(1, 'T1', { status: 'occupied' }), null), true);
  assert.equal(tableLocked(table(1, 'T1', { status: 'reserved' }), none), true);
  assert.equal(tableLocked(table(1, 'T1', { status: 'reserved' }), null), true);
  assert.equal(tableLocked(table(1, 'T1', { status: 'inactive' }), none), false, 'closed tables stay editable so they can reopen');
  assert.equal(tableLocked(table(1, 'T1', { status: 'inactive' }), new Set([1])), true);
  assert.equal(
    tableLocked(table(1, 'T1', { upcoming_reservation_at: '2026-09-23T12:00:00Z', upcoming_reservation_name: 'ลูกค้า' }), none),
    false,
    'a later booking does not lock a free table',
  );
});

test('a locked table always shows a status word, and an unlocked one never shows in-use', () => {
  for (const status of ['free', 'occupied', 'reserved', 'inactive']) {
    for (const orders of [null, new Set(), new Set([1])]) {
      const subject = table(1, 'T1', { status });
      const shown = planStatus(subject, orders);
      assert.equal(
        tableLocked(subject, orders),
        shown === 'occupied' || shown === 'reserved',
        `${status} with ${orders ? [...orders].join(',') || 'no orders' : 'orders unknown'}`,
      );
    }
  }
});

test('the status words are the floor\'s words', () => {
  assert.equal(planStatusWord('free'), 'ว่าง');
  assert.equal(planStatusWord('occupied'), 'กำลังใช้งาน');
  assert.equal(planStatusWord('reserved'), 'จอง');
  assert.equal(planStatusWord('inactive'), 'ปิดใช้งาน');
  assert.equal(planStatusWord('occupied', 'en'), 'In use');
  assert.equal(planStatusWord('inactive', 'en'), 'Inactive');
});

test('only unlocked tables can be selected for a bulk action', () => {
  const tables = [
    table(1, 'T1'),
    table(2, 'T2', { status: 'occupied' }),
    table(3, 'T3', { status: 'reserved' }),
    table(4, 'T4', { status: 'inactive' }),
    table(5, 'T5'),
  ];
  assert.deepEqual(selectableTableIds(tables, new Set([5])), [1, 4]);
  assert.deepEqual(selectableTableIds(tables, null), [1, 4, 5]);
});

test('the availability button closes when any selected table is free, and opens only when all are closed', () => {
  const none = new Set();
  assert.equal(bulkAvailabilityAction([table(1, 'T1'), table(2, 'T2', { status: 'inactive' })], none), 'close');
  assert.equal(bulkAvailabilityAction([table(1, 'T1', { status: 'inactive' }), table(2, 'T2', { status: 'inactive' })], none), 'open');
  assert.equal(bulkAvailabilityAction([], none), null);
  // Locked tables are never acted on, even if they slipped into a selection.
  assert.equal(bulkAvailabilityAction([table(1, 'T1', { status: 'occupied' })], none), null);
  assert.equal(bulkAvailabilityAction([table(1, 'T1', { status: 'inactive' }), table(2, 'T2', { status: 'reserved' })], none), 'open');
  assert.equal(bulkAvailabilityAction([table(1, 'T1'), table(2, 'T2', { status: 'inactive' })], new Set([1])), 'open');
});

// ---------------------------------------------------------------------------
// Numbering: a mirror of BulkCreateTables, MoveTableZone and UpdateZone
// ---------------------------------------------------------------------------

test('tableLabel is the server\'s: T<n> without a zone, prefix plus two digits in one', () => {
  assert.equal(tableLabel(null, 1), 'T1');
  assert.equal(tableLabel(null, 105), 'T105');
  assert.equal(tableLabel(zone(1, 'A'), 1), 'A01');
  assert.equal(tableLabel(zone(1, 'A'), 12), 'A12');
  assert.equal(tableLabel(zone(1, 'A'), 100), 'A100');
  assert.equal(tableLabel(zone(1, 'GARDENXY'), 6), 'GARDENXY06');
  assert.equal(tableLabel(zone(1, ''), 3), 'Z03', 'an empty prefix falls back to Z');
  assert.equal(tableLabel(zone(1, '  '), 3), 'Z03');
  assert.equal(tableLabel(zone(1, ' B '), 3), 'B03', 'the prefix is trimmed');
});

test('the next sequence is the highest in that zone plus one, gaps are not refilled', () => {
  const tables = [
    table(1, 'T1'),
    table(2, 'T5'),
    table(3, 'A02', { zone_id: 9, sequence_number: 2 }),
    table(4, 'LEGACY', { sequence_number: undefined }),
  ];
  assert.equal(nextSequence(tables, null), 6);
  assert.equal(nextSequence(tables, zone(9, 'A')), 3);
  assert.equal(nextSequence(tables, zone(10, 'B')), 1);
  assert.equal(nextSequence([], null), 1);
  // zone_id 0 is how an older row says "no zone".
  assert.equal(nextSequence([table(1, 'T8', { zone_id: 0 })], null), 9);
});

test('an empty shop previews T1-T10', () => {
  const labels = nextTableLabels([], null, 10);
  assert.deepEqual(labels, ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']);
  assert.equal(compressLabelRuns(labels), 'T1–T10');
});

test('a zone continues from its own highest sequence', () => {
  const { tables } = inventedShop();
  assert.deepEqual(nextTableLabels(tables, riverside, 3), ['GARDENXY06', 'GARDENXY07', 'GARDENXY08']);
  assert.equal(compressLabelRuns(nextTableLabels(tables, riverside, 3)), 'GARDENXY06–GARDENXY08');
  assert.deepEqual(nextTableLabels(tables, null, 1), ['T18']);
});

test('a label another zone already holds is skipped, and numbering continues past it', () => {
  // A zone prefixed "T" numbers T01...T10, and T10 is also the eleventh
  // zone-less label: nextFreeTableLabel skips it.
  const zoneT = zone(3, 'T');
  const tables = [
    ...Array.from({ length: 8 }, (_, index) => table(index + 1, `T${index + 1}`)),
    table(50, 'T10', { zone_id: zoneT.ID, sequence_number: 10 }),
  ];
  const labels = nextTableLabels(tables, null, 3);
  assert.deepEqual(labels, ['T9', 'T11', 'T12']);
  assert.equal(compressLabelRuns(labels), 'T9, T11–T12');
});

test('the skip compares table_number, the column the server probes, not the display label', () => {
  const tables = [
    table(1, 'T1'),
    table(2, 'T2', { display_label: 'หน้าร้าน' }),
    table(3, 'X9', { display_label: 'T3', sequence_number: 0, zone_id: 44 }),
  ];
  assert.deepEqual(nextTableLabels(tables, null, 2), ['T3', 'T4']);
  const legacy = [table(1, 'T1'), table(2, 'T3', { display_label: 'ริมหน้าต่าง', zone_id: 44, sequence_number: 0 })];
  assert.deepEqual(nextTableLabels(legacy, null, 2), ['T2', 'T4']);
});

test('three digits from one hundred', () => {
  const zoneA = zone(4, 'A');
  const tables = [table(1, 'A99', { zone_id: 4, sequence_number: 99 })];
  assert.deepEqual(nextTableLabels(tables, zoneA, 2), ['A100', 'A101']);
  assert.equal(compressLabelRuns(['A99', 'A100', 'A101']), 'A99–A101');
  const nine = [table(1, 'A09', { zone_id: 4, sequence_number: 9 })];
  assert.deepEqual(nextTableLabels(nine, zoneA, 2), ['A10', 'A11']);
});

test('an empty prefix numbers as Z, like the server', () => {
  assert.deepEqual(nextTableLabels([], zone(5, ''), 2), ['Z01', 'Z02']);
});

test('a zone that does not exist yet (ID 0) starts at 01 with its typed prefix', () => {
  const { tables } = inventedShop();
  assert.deepEqual(nextTableLabels(tables, { ID: 0, prefix: 'C' }, 3), ['C01', 'C02', 'C03']);
});

test('nothing is previewed for a count below one', () => {
  assert.deepEqual(nextTableLabels([], null, 0), []);
  assert.deepEqual(nextTableLabels([], null, -3), []);
  assert.deepEqual(nextTableLabels([], null, Number.NaN), []);
});

test('the probe gives up where the server does, and the preview comes back short', () => {
  const zoneT = zone(3, 'T');
  // 500 labels in a row already taken: T1...T500 held by a zone prefixed "T"
  // would read T01..., so fill the zone-less run directly instead.
  const blocked = Array.from({ length: MAX_TABLE_LABEL_PROBES }, (_, index) =>
    table(1000 + index, `T${index + 2}`, { zone_id: zoneT.ID, sequence_number: index + 2 }),
  );
  const tables = [table(1, 'T1'), ...blocked];
  assert.deepEqual(nextTableLabels(tables, null, 2), [], 'T2...T501 are all taken');
  const oneShort = blocked.slice(0, MAX_TABLE_LABEL_PROBES - 1);
  assert.deepEqual(nextTableLabels([table(1, 'T1'), ...oneShort], null, 1), [`T${MAX_TABLE_LABEL_PROBES + 1}`]);
});

test('runs are compressed with an en dash and joined with a comma', () => {
  assert.equal(compressLabelRuns([]), '');
  assert.equal(compressLabelRuns(['T18']), 'T18');
  assert.equal(compressLabelRuns(['T11', 'T12']), 'T11–T12');
  assert.equal(compressLabelRuns(['T5', 'A06', 'A07']), 'T5, A06–A07');
  assert.equal(compressLabelRuns(['T3', 'T2']), 'T3, T2', 'only ascending neighbours join');
  assert.equal(compressLabelRuns(['VIP', 'T1', 'T2']), 'VIP, T1–T2');
  assert.equal(compressLabelRuns(['A01', 'B02']), 'A01, B02', 'a run never crosses prefixes');
});

test('a move takes the next sequence at the end of the target zone, with no probe', () => {
  const { tables } = inventedShop();
  const t5 = tables.find((item) => item.ID === 5);
  assert.deepEqual(moveTargetLabel(tables, t5, riverside), { label: 'GARDENXY06', clash: false });
  const second = tables.find((item) => item.ID === 102);
  assert.deepEqual(moveTargetLabel(tables, second, null), { label: 'T18', clash: false });
  // The same zone still renumbers to the end: MoveTableZone counts the table itself.
  assert.deepEqual(moveTargetLabel(tables, second, riverside), { label: 'GARDENXY06', clash: false });
});

test('a move onto a label someone else holds is a clash, its own old label is not', () => {
  const zoneT = zone(3, 'T');
  const tables = [
    ...Array.from({ length: 9 }, (_, index) => table(200 + index, `T0${index + 1}`, { zone_id: 3, sequence_number: index + 1 })),
    table(1, 'T3'),
    table(2, 'T10'),
  ];
  assert.deepEqual(moveTargetLabel(tables, tables.find((item) => item.ID === 1), zoneT), { label: 'T10', clash: true });
  // T10 moving into the "T" zone lands on T10 again: the same row, no clash.
  assert.deepEqual(moveTargetLabel(tables, tables.find((item) => item.ID === 2), zoneT), { label: 'T10', clash: false });
});

test('a bulk move numbers movers in floor order and skips those already there', () => {
  const { tables } = inventedShop();
  const plan = bulkMoveLabels(tables, [102, 7, 3], riverside);
  assert.deepEqual(plan.moves, [
    { id: 3, from: 'T3', to: 'GARDENXY06', clash: false },
    { id: 7, from: 'T7', to: 'GARDENXY07', clash: false },
  ]);
  assert.deepEqual(plan.skipped, [102]);
  assert.equal(plan.firstClash, null);
});

test('a bulk move flags the first clash with a table that is not moving', () => {
  const zoneT = zone(3, 'T');
  const tables = [
    ...Array.from({ length: 8 }, (_, index) => table(200 + index, `T0${index + 1}`, { zone_id: 3, sequence_number: index + 1 })),
    table(1, 'T3'),
    table(2, 'T4'),
    table(9, 'T10'),
  ];
  const plan = bulkMoveLabels(tables, new Set([1, 2]), zoneT);
  assert.deepEqual(plan.moves, [
    { id: 1, from: 'T3', to: 'T09', clash: false },
    { id: 2, from: 'T4', to: 'T10', clash: true },
  ]);
  assert.equal(plan.firstClash, 'T10');
});

test('a bulk move frees each mover\'s old label for the ones after it', () => {
  const zoneQ = zone(3, 'T');
  const tables = [
    ...Array.from({ length: 9 }, (_, index) => table(index + 1, `T${index + 1}`)),
    table(11, 'T11', { zone_id: zoneQ.ID, sequence_number: 11 }),
    table(12, 'T12', { zone_id: zoneQ.ID, sequence_number: 12 }),
  ];
  const plan = bulkMoveLabels(tables, [11, 12], null);
  assert.deepEqual(plan.moves, [
    { id: 11, from: 'T11', to: 'T10', clash: false },
    { id: 12, from: 'T12', to: 'T11', clash: false },
  ]);
  assert.equal(plan.firstClash, null);
});

test('a bulk move leaves a locked table where it is, and numbers the rest as if it were not there', () => {
  const { tables } = inventedShop();
  const withBusy = tables.map((item) => (item.ID === 4 ? { ...item, status: 'reserved' } : item));
  // T3 has an active order, T4 is held: the server refuses both, and a refused
  // move takes no sequence, so T7 is the first to land.
  const plan = bulkMoveLabels(withBusy, [3, 4, 7], riverside, new Set([3]));
  assert.deepEqual(plan.moves, [{ id: 7, from: 'T7', to: 'GARDENXY06', clash: false }]);
  assert.deepEqual(plan.locked, [3, 4]);
  assert.deepEqual(plan.skipped, []);
  // Without the orders the column still locks the held table.
  assert.deepEqual(bulkMoveLabels(withBusy, [3, 4, 7], riverside).locked, [4]);
  assert.deepEqual(bulkMoveLabels(tables, [3], riverside).locked, []);
});

test('a prefix change relabels every table on its own sequence', () => {
  const { tables } = inventedShop();
  const preview = zoneRelabelPreview(tables, riverside, 'B');
  assert.equal(preview.from, 'GARDENXY01–GARDENXY05');
  assert.equal(preview.to, 'B01–B05');
  assert.equal(preview.changes.length, 5);
  assert.equal(preview.firstClash, null);
  const gappy = [
    table(1, 'A01', { zone_id: 4, sequence_number: 1 }),
    table(2, 'A03', { zone_id: 4, sequence_number: 3 }),
  ];
  assert.equal(zoneRelabelPreview(gappy, zone(4, 'A'), 'b').to, 'B01, B03', 'typed lower case is upper-cased like the server');
});

test('a prefix change that lands on another table\'s label names the clash', () => {
  const zoneA = zone(4, 'A');
  const tables = [
    table(1, 'T10'),
    table(2, 'A09', { zone_id: 4, sequence_number: 9 }),
    table(3, 'A10', { zone_id: 4, sequence_number: 10 }),
  ];
  const preview = zoneRelabelPreview(tables, zoneA, 'T');
  assert.equal(preview.to, 'T09–T10');
  assert.equal(preview.firstClash, 'T10');
});

test('a prefix change is checked row by row in id order, the order the server rewrites them', () => {
  // Prefix A to A1: sequence 5 becomes A105, which sequence 105 still holds
  // until its own row is rewritten. The server rewrites by id, so whether that
  // clashes depends on which of the two rows has the lower id.
  const zoneA = zone(4, 'A');
  const laterFirst = [
    table(20, 'A05', { zone_id: 4, sequence_number: 5 }),
    table(10, 'A105', { zone_id: 4, sequence_number: 105 }),
  ];
  const clear = zoneRelabelPreview(laterFirst, zoneA, 'A1');
  assert.equal(clear.firstClash, null, 'A105 is rewritten to A1105 before A05 needs its label');
  assert.deepEqual(clear.changes.map((change) => `${change.from}>${change.to}`), ['A05>A105', 'A105>A1105'], 'shown in sequence order');

  const earlierFirst = [
    table(10, 'A05', { zone_id: 4, sequence_number: 5 }),
    table(20, 'A105', { zone_id: 4, sequence_number: 105 }),
  ];
  assert.equal(zoneRelabelPreview(earlierFirst, zoneA, 'A1').firstClash, 'A105');
});

test('a prefix change names the tables in service, which make the server refuse all of it', () => {
  const { tables } = inventedShop();
  const withHold = tables.map((item) => (item.ID === 104 ? { ...item, status: 'reserved' } : item));
  assert.deepEqual(zoneRelabelPreview(withHold, riverside, 'B', new Set([102])).locked, [102, 104]);
  assert.deepEqual(zoneRelabelPreview(withHold, riverside, 'B').locked, [104]);
  assert.deepEqual(zoneRelabelPreview(tables, riverside, 'B', new Set([5])).locked, [], 'a busy table in another room does not count');
  assert.deepEqual(zoneRelabelPreview(withHold, riverside, 'GARDENXY').locked, [], 'no prefix change, nothing to refuse');
});

test('an unchanged or empty prefix relabels nothing', () => {
  const { tables } = inventedShop();
  for (const prefix of ['GARDENXY', ' gardenxy ', '', '   ']) {
    const preview = zoneRelabelPreview(tables, riverside, prefix);
    assert.deepEqual(preview.changes, [], prefix);
    assert.equal(preview.firstClash, null);
  }
  assert.deepEqual(zoneRelabelPreview(tables, zone(99, 'Q'), 'R').changes, [], 'an empty zone has nothing to relabel');
});

// ---------------------------------------------------------------------------
// Rooms, search and filters
// ---------------------------------------------------------------------------

test('rooms follow the server: no zone first, then display order, then id', () => {
  const late = zone(3, 'C', { display_order: 2, name: 'ห้องหลัง' });
  const early = zone(9, 'B', { display_order: 1, name: 'ห้องหน้า' });
  const tie = zone(4, 'D', { display_order: 2, name: 'ห้องข้าง' });
  const tables = [
    table(1, 'C02', { zone_id: 3, sequence_number: 2 }),
    table(2, 'C01', { zone_id: 3, sequence_number: 1 }),
    table(3, 'T2', { sequence_number: 2 }),
    table(4, 'T1', { sequence_number: 1 }),
    table(5, 'B01', { zone_id: 9, sequence_number: 1, capacity: 6 }),
  ];
  const rooms = planRooms(tables, [late, early, tie]);
  assert.deepEqual(rooms.map((room) => room.key), ['none', 9, 3, 4]);
  assert.deepEqual(rooms[0].tables.map(planLabel), ['T1', 'T2']);
  assert.deepEqual(rooms[2].tables.map(planLabel), ['C01', 'C02']);
  assert.equal(rooms[1].seats, 6);
  assert.equal(rooms[3].count, 0, 'an empty zone is still a room');
});

test('floor order is the rooms read top to bottom, and drives the order of a bulk move', () => {
  const zoneA = zone(1, 'A', { display_order: 1 });
  const tables = [
    table(3, 'A02', { zone_id: 1, sequence_number: 2 }),
    table(1, 'T2', { sequence_number: 2 }),
    table(2, 'A01', { zone_id: 1, sequence_number: 1 }),
    table(4, 'T1', { sequence_number: 1 }),
  ];
  const ordered = floorOrder(tables, [zoneA]);
  assert.deepEqual(ordered.map(planLabel), ['T1', 'T2', 'A01', 'A02']);
  const plan = bulkMoveLabels(ordered, [3, 1, 2], zone(2, 'B'));
  assert.deepEqual(plan.moves.map((move) => `${move.from}>${move.to}`), ['T2>B01', 'A01>B02', 'A02>B03']);
});

test('the no-zone room shows only when it holds tables or there are no zones', () => {
  const zoneA = zone(1, 'A');
  const zoned = [table(1, 'A01', { zone_id: 1, sequence_number: 1 })];
  assert.deepEqual(planRooms(zoned, [zoneA]).map((room) => room.key), [1]);
  assert.deepEqual(planRooms([table(2, 'T1'), ...zoned], [zoneA]).map((room) => room.key), ['none', 1]);
  assert.deepEqual(planRooms([], []).map((room) => room.key), ['none']);
  assert.deepEqual(planRooms([], [zoneA]).map((room) => room.key), [1]);
});

test('inactive zones and zones the list did not return keep their tables visible', () => {
  const closedZone = zone(2, 'B', { is_active: false, name: 'ห้องปิด' });
  const orphanZone = zone(8, 'Q', { name: 'ห้องที่ไม่อยู่ในรายการ', display_order: 5 });
  const tables = [
    table(1, 'B01', { zone_id: 2, sequence_number: 1 }),
    table(2, 'Q01', { zone_id: 8, sequence_number: 1, table_zone: orphanZone }),
    table(3, 'R01', { zone_id: 12, sequence_number: 1, zone: 'ชื่อเก่า' }),
  ];
  const rooms = planRooms(tables, [closedZone]);
  assert.deepEqual(rooms.map((room) => room.key), [2, 8, 12]);
  assert.equal(roomName(rooms[1]), 'ห้องที่ไม่อยู่ในรายการ');
  assert.equal(roomName(rooms[2]), 'ชื่อเก่า');
  assert.equal(rooms.reduce((sum, room) => sum + room.count, 0), 3);
});

test('room names and values say the missing value', () => {
  const { tables, zones } = inventedShop();
  const rooms = planRooms(tables, [...zones, zone(30, 'V', { name: 'ห้อง VIP', display_order: 9 })]);
  assert.equal(roomName(rooms[0]), 'ไม่มีโซน');
  assert.equal(roomName(rooms[0], 'en'), 'No zone');
  assert.equal(roomValue(rooms[0]), '17 โต๊ะ, 38 ที่นั่ง');
  assert.equal(roomName(rooms[1]), 'ลานหลังร้าน ใต้ร่มไม้');
  assert.equal(roomValue(rooms[1]), '5 โต๊ะ, 20 ที่นั่ง');
  assert.equal(roomValue(rooms[2]), 'ไม่มีโต๊ะ');
  assert.equal(roomValue(rooms[2], 'en'), 'No tables');
  assert.equal(roomValue({ ...rooms[1], count: 1, seats: 4 }, 'en'), '1 table, 4 seats');
});

test('a digits-only search matches the number at the end of the label', () => {
  const { tables, zones } = inventedShop();
  const found = tables.filter((item) => matchesPlanQuery(item, '5', zones)).map(planLabel);
  assert.deepEqual(found, ['T5', 'T15', 'GARDENXY05']);
  assert.deepEqual(tables.filter((item) => matchesPlanQuery(item, '05', zones)).map(planLabel), ['T5', 'T15', 'GARDENXY05']);
  assert.deepEqual(tables.filter((item) => matchesPlanQuery(item, '12', zones)).map(planLabel), ['T12']);
});

test('digits inside a zone prefix do not count as the table number', () => {
  const z2 = zone(6, 'Z2');
  const tables = [
    table(1, 'Z201', { zone_id: 6, sequence_number: 1, table_zone: z2 }),
    table(2, 'Z212', { zone_id: 6, sequence_number: 12, table_zone: z2 }),
  ];
  assert.deepEqual(tables.filter((item) => matchesPlanQuery(item, '2', [z2])).map(planLabel), ['Z212']);
  assert.deepEqual(tables.filter((item) => matchesPlanQuery(item, '1', [z2])).map(planLabel), ['Z201', 'Z212']);
});

test('a text search matches label, table number and zone name, ignoring case', () => {
  const { tables, zones } = inventedShop();
  assert.equal(tables.filter((item) => matchesPlanQuery(item, 'gardenxy0', zones)).length, 5);
  assert.equal(tables.filter((item) => matchesPlanQuery(item, 'ร่มไม้', zones)).length, 5);
  assert.equal(tables.filter((item) => matchesPlanQuery(item, ' t1 ', zones)).length, 9, 'T1, T10-T17');
  assert.equal(tables.filter((item) => matchesPlanQuery(item, '', zones)).length, tables.length);
  assert.equal(matchesPlanQuery(table(1, 'X1', { display_label: 'หน้าต่าง' }), 'หน้า', []), true);
});

test('the floor filters by room, status and search together', () => {
  const { tables, zones } = inventedShop();
  const orders = new Set([1, 2, 103]);
  const all = planFloor(tables, zones, { room: 'all', status: null, query: '' }, orders);
  assert.deepEqual(all.map((room) => room.tables.length), [17, 5]);

  const busy = planFloor(tables, zones, { room: 'all', status: 'occupied', query: '' }, orders);
  assert.deepEqual(busy.map((room) => room.tables.map(planLabel)), [['T1', 'T2'], ['GARDENXY03']]);
  assert.equal(busy[0].count, 17, 'the room value keeps counting the whole room');

  const zoned = planFloor(tables, zones, { room: riverside.ID, status: null, query: '' }, orders);
  assert.deepEqual(zoned.map((room) => room.key), [riverside.ID]);

  const combined = planFloor(tables, zones, { room: 'none', status: 'free', query: '1' }, orders);
  assert.deepEqual(combined.map((room) => room.tables.map(planLabel)), [['T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T17']]);

  assert.deepEqual(planFloor(tables, zones, { room: 'all', status: 'reserved', query: '' }, orders), []);
});

test('a room filter keeps an empty room, a status or search drops it', () => {
  const vip = zone(30, 'V', { name: 'ห้อง VIP', display_order: 9 });
  const { tables, zones } = inventedShop();
  const withVip = [...zones, vip];
  assert.deepEqual(planFloor(tables, withVip, { room: 30, status: null, query: '' }, null).map((room) => room.key), [30]);
  assert.deepEqual(planFloor(tables, withVip, { room: 'all', status: null, query: '' }, null).map((room) => room.key), ['none', 7, 30]);
  assert.deepEqual(planFloor(tables, withVip, { room: 'all', status: 'free', query: '' }, null).map((room) => room.key), ['none', 7]);
  assert.deepEqual(planFloor(tables, withVip, { room: 55, status: null, query: '' }, null), [], 'a room that is gone yields nothing');
});

// ---------------------------------------------------------------------------
// Summary, labels and defaults
// ---------------------------------------------------------------------------

test('the summary counts the whole inventory the floor\'s way, with pills only for a real mix', () => {
  const { tables } = inventedShop();
  const summary = planSummary(tables, new Set([1, 2, 3, 4, 5, 6, 101]));
  assert.equal(summary.tables, 22);
  assert.equal(summary.seats, 58);
  assert.deepEqual(summary.counts, { free: 15, occupied: 7, reserved: 0, inactive: 0 });
  assert.deepEqual(summary.pills, ['free', 'occupied']);

  const withClosed = planSummary([...tables, table(300, 'T30', { status: 'inactive' }), table(301, 'T31', { status: 'reserved' })], new Set());
  assert.deepEqual(withClosed.pills, ['free', 'reserved', 'inactive']);
  assert.equal(withClosed.tables, 24);

  assert.deepEqual(planSummary([table(1, 'T1')], null).pills, [], 'one status alone draws no pills');
  assert.deepEqual(planSummary([], null), {
    tables: 0,
    seats: 0,
    counts: { free: 0, occupied: 0, reserved: 0, inactive: 0 },
    pills: [],
  });
});

test('a table is named by its display label, and its zone is always said', () => {
  const { tables, zones } = inventedShop();
  const t5 = tables.find((item) => item.ID === 5);
  const second = tables.find((item) => item.ID === 103);
  assert.equal(planLabel(table(1, 'T9', { display_label: '' })), 'T9');
  assert.deepEqual(planTableTitle(t5, zones), { label: 'T5', zone: 'ไม่มีโซน' });
  assert.deepEqual(planTableTitle(second, zones), { label: 'GARDENXY03', zone: 'ลานหลังร้าน ใต้ร่มไม้' });
  // A rename reaches the zones list before the preloaded table_zone.
  assert.equal(planZoneName(second, [{ ...riverside, name: 'ดาดฟ้า' }]), 'ดาดฟ้า');
  assert.equal(planZoneName(t5, zones, 'en'), 'No zone');
  assert.equal(planZoneName(table(1, 'R01', { zone_id: 12, zone: '' }), []), 'ไม่มีโซน');
  assert.equal(tableZoneId(table(1, 'T1', { zone_id: 0 })), null);
  assert.equal(tableZoneId(table(1, 'T1', { zone_id: undefined })), null);
  assert.equal(tableZoneId(table(1, 'A1', { zone_id: 4 })), 4);
});

test('the tile reads its label, status and seats aloud, and says a missing QR', () => {
  const tile = table(103, 'GARDENXY03', { capacity: 4 });
  assert.equal(planTileAccessibilityLabel(tile, 'free'), 'โต๊ะ GARDENXY03, ว่าง, 4 ที่นั่ง');
  assert.equal(
    planTileAccessibilityLabel({ ...tile, customer_token: '' }, 'occupied'),
    'โต๊ะ GARDENXY03, กำลังใช้งาน, 4 ที่นั่ง, ไม่มี QR',
  );
  assert.equal(planTileAccessibilityLabel({ ...tile, capacity: 1 }, 'free', 'en'), 'Table GARDENXY03, Free, 1 seat');
});

test('the default seats are the most common capacity, ties to the smaller', () => {
  assert.equal(mostCommonCapacity([table(1, 'A', { capacity: 4 }), table(2, 'B', { capacity: 4 }), table(3, 'C', { capacity: 2 })]), 4);
  assert.equal(mostCommonCapacity([table(1, 'A', { capacity: 6 }), table(2, 'B', { capacity: 2 })]), 2);
  assert.equal(mostCommonCapacity([]), 2);
  assert.equal(mostCommonCapacity([], 4), 4);
  assert.equal(mostCommonCapacity([table(1, 'A', { capacity: 0 }), table(2, 'B', { capacity: 99 })]), 2, 'values outside 1-50 are ignored');
});

test('a new zone gets the first free letter, T last because zone-less tables are T<n>', () => {
  assert.equal(firstFreePrefix([]), 'A');
  assert.equal(firstFreePrefix([zone(1, 'A'), zone(2, 'b')]), 'C');
  assert.equal(firstFreePrefix([zone(1, 'GARDENXY')]), 'A');
  const allButT = 'ABCDEFGHIJKLMNOPQRSUVWXYZ'.split('').map((letter, index) => zone(index + 1, letter));
  assert.equal(firstFreePrefix(allButT), 'T');
  assert.equal(firstFreePrefix([...allButT, zone(99, 'T')]), 'AA');
});

test('a typed prefix keeps A-Z and 0-9, upper-cased, eight at most', () => {
  assert.equal(normalizeZonePrefix('ab-1 ก'), 'AB1');
  assert.equal(normalizeZonePrefix('gardenxyx'), 'GARDENXY');
  assert.equal(normalizeZonePrefix(''), '');
  assert.equal(normalizeZonePrefix(null), '');
});

test('a stepper field clamps what is typed and may be empty while typing', () => {
  assert.equal(stepperValue('', 1, 200), null);
  assert.equal(stepperValue('300', 1, 200), 200);
  assert.equal(stepperValue('0', 1, 200), 1);
  assert.equal(stepperValue('12a', 1, 200), 12);
  assert.equal(stepperValue('007', 1, 50), 7);
  assert.equal(stepperValue('abc', 1, 50), null);
});

test('zone choices are the active zones plus the one in use', () => {
  const zones = [zone(1, 'A'), zone(2, 'B', { is_active: false }), zone(3, 'C')];
  assert.deepEqual(zoneChoices(zones, null).map((item) => item.ID), [1, 3]);
  assert.deepEqual(zoneChoices(zones, 2).map((item) => item.ID), [1, 2, 3]);
});

test('the rows a bulk create added are the ids that were not there before, in sequence order', () => {
  const before = [table(1, 'T1'), table(2, 'T2')];
  const after = [...before, table(9, 'T4', { sequence_number: 4 }), table(8, 'T3', { sequence_number: 3 })];
  assert.deepEqual(newTablesSince(before, after).map(planLabel), ['T3', 'T4']);
  assert.deepEqual(newTablesSince(after, after), []);
});

test('a new zone goes after the highest display order, not after the zone count', () => {
  assert.equal(nextZoneDisplayOrder([]), 1);
  assert.equal(nextZoneDisplayOrder([zone(1, 'A', { display_order: 3 }), zone(2, 'B', { display_order: 1 })]), 4);
});

test('zones reorder one step at a time and renumber to 1..n', () => {
  const zones = [zone(1, 'A', { display_order: 5 }), zone(2, 'B', { display_order: 2 }), zone(3, 'C', { display_order: 9 })];
  const down = moveZoneInOrder(zones, 2, 1);
  assert.deepEqual(down.map((item) => item.ID), [1, 2, 3]);
  const up = moveZoneInOrder(zones, 3, -1);
  assert.deepEqual(up.map((item) => item.ID), [2, 3, 1]);
  assert.deepEqual(moveZoneInOrder(zones, 2, -1).map((item) => item.ID), [2, 1, 3], 'the first stays first');
  assert.deepEqual(moveZoneInOrder(zones, 404, 1).map((item) => item.ID), [2, 1, 3]);

  const renumbered = renumberZones(up);
  assert.deepEqual(renumbered.zones.map((item) => [item.ID, item.display_order]), [[2, 1], [3, 2], [1, 3]]);
  assert.deepEqual(renumbered.changed.map((item) => item.ID), [2, 3, 1]);
  assert.equal(zones[0].display_order, 5, 'the input is never mutated');
  assert.deepEqual(renumberZones(renumbered.zones).changed, []);

  assert.deepEqual(zoneOrderPosition(zones, 1), { position: 2, total: 3 });
  assert.equal(zoneOrderPosition(zones, 404), null);
});

test('closing a table with a booking due says whose and when, and a locked table is never asked about', () => {
  // Built in local time, so the clock reads the same in any time zone.
  const at = (hour, minute) => new Date(2026, 8, 23, hour, minute).toISOString();
  const t5 = table(5, 'T5', { upcoming_reservation_at: at(19, 0), upcoming_reservation_name: 'คุณนภา' });
  const t8 = table(8, 'T8', { upcoming_reservation_at: at(20, 30), upcoming_reservation_name: '' });
  const t9 = table(9, 'T9');
  const busy = table(11, 'T11', { upcoming_reservation_at: at(21, 0), upcoming_reservation_name: 'คุณเอ' });
  const held = table(12, 'T12', { status: 'reserved', upcoming_reservation_at: at(18, 0) });

  assert.deepEqual(tablesWithUpcomingBooking([t9, t8, t5, busy, held], new Set([11])).map(planLabel), ['T8', 'T5']);
  assert.equal(upcomingBookingNote([t5]), 'มีจอง 19:00, คุณนภา');
  assert.equal(upcomingBookingNote([t8]), 'มีจอง 20:30, ไม่ระบุชื่อ', 'a missing name is said');
  assert.equal(upcomingBookingNote([t5, t9, t8]), 'มีจอง T5 19:00, T8 20:30');
  // A bulk close names the table even when only one of them has a booking:
  // its title counts tables, it does not name them.
  assert.equal(upcomingBookingNote([t5, t9]), 'มีจอง T5 19:00');
  assert.equal(upcomingBookingNote([t9]), null);
  assert.equal(upcomingBookingNote([]), null);
  assert.equal(upcomingBookingNote([t5], 'en'), 'Booked 19:00, คุณนภา');
  assert.equal(upcomingBookingNote([t8], 'en'), 'Booked 20:30, no name');
  assert.equal(upcomingBookingNote([t5, t8], 'en'), 'Booked T5 19:00, T8 20:30');
  assert.equal(upcomingBookingNote([table(3, 'T3', { upcoming_reservation_at: 'not a date' })]), null);
});

test('the setup tile label sits below the 19-20 band', () => {
  assert.equal(PLAN_TILE_LABEL_FONT, 18);
  assert.equal(PLAN_TILE_LABEL_MIN_FONT, 12);
});

// ---------------------------------------------------------------------------
// Drift guard: the numbering above is a copy of the server's. If the server
// changes how it numbers, this test must fail before the preview starts lying.
// ---------------------------------------------------------------------------

test('the server still numbers the way this preview assumes', async () => {
  const helpers = await readFile(path.join(repoRoot, 'backend', 'internal', 'service', 'table_service_helpers.go'), 'utf8');
  const service = await readFile(path.join(repoRoot, 'backend', 'internal', 'service', 'table_service.go'), 'utf8');
  const repository = await readFile(path.join(repoRoot, 'backend', 'internal', 'repository', 'table_repository.go'), 'utf8');
  assert.match(helpers, /return fmt\.Sprintf\("T%d", sequence\)/);
  assert.match(helpers, /prefix = "Z"/);
  assert.match(helpers, /return fmt\.Sprintf\("%s%02d", prefix, sequence\)/);
  assert.match(helpers, new RegExp(`const maxTableLabelProbes = ${MAX_TABLE_LABEL_PROBES}\\b`));
  assert.match(service, /nextFreeTableLabel\(tx, restaurantID, zone, next\+i\)/, 'bulk create probes every label');
  assert.match(service, /label := tableLabel\(zone, next\)/, 'a move does not probe');
  assert.match(service, /label := tableLabel\(zone, tables\[i\]\.SequenceNumber\)/, 'a prefix change keeps each sequence');
  assert.match(repository, /Where\("restaurant_id = \? AND table_number = \?", restaurantID, tableNumber\)/);
  assert.match(repository, /COALESCE\(MAX\(sequence_number\), 0\)/);
  assert.match(repository, /CASE WHEN restaurant_tables\.zone_id IS NULL THEN 0 ELSE 1 END asc, table_zones\.display_order asc, restaurant_tables\.sequence_number asc/);
  assert.match(repository, /Order\("display_order asc, id asc"\)/);
  assert.match(repository, /ListTablesInZoneForUpdate[\s\S]*?Order\("id asc"\)/, 'a prefix change rewrites rows in id order');
});

test('the server still locks exactly the tables tableLocked locks', async () => {
  const service = await readFile(path.join(repoRoot, 'backend', 'internal', 'service', 'table_service.go'), 'utf8');
  const repository = await readFile(path.join(repoRoot, 'backend', 'internal', 'repository', 'table_repository.go'), 'utf8');
  assert.match(
    service,
    /func tableInService\(status string, hasOpenOrder bool\) bool \{\s*return hasOpenOrder \|\| status == entity\.TableStatusOccupied \|\| status == entity\.TableStatusReserved\s*\}/,
    'the server\'s lock predicate changed; update tableLocked',
  );
  assert.match(
    repository,
    /var tableReleasingOrderStatuses = \[\]string\{entity\.OrderStatusCompleted, entity\.OrderStatusCancelled\}/,
    'the statuses that end an order changed; update activeOrderTableIds',
  );
  assert.match(service, /var ErrTableInUse = errors\.New\("table is in use"\)/);
  for (const entry of ['UpdateTable', 'RegenerateCustomerToken', 'DeleteTable', 'MoveTableZone']) {
    const body = service.slice(service.indexOf(`func (s *TableService) ${entry}(`));
    const end = body.indexOf('\nfunc ');
    assert.match(body.slice(0, end), /ensureTableEditable\(tx, restaurantID, table\)/, `${entry} checks the lock`);
  }
  assert.match(service, /if prefixChanged \{\s*if err := ensureTablesEditable\(tx, restaurantID, tables\)/, 'a prefix change checks every table in the zone');
});
