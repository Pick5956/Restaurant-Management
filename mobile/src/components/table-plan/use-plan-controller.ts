import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import type { TablePlan } from '@/src/hooks/use-table-plan';
import type { BulkFinish } from '@/src/components/table-plan/bulk-bodies';
import { alertBulkPartial, BULK_LIMIT, bulkDoneWords, bulkReloads, runBulk } from '@/src/components/table-plan/plan-bulk';
import { tablePlanApi } from '@/src/components/table-plan/plan-actions';
import { hapticSelect, hapticSuccess, mergeTableRow, type PlanEnv, type PlanHighlightKind } from '@/src/components/table-plan/plan-context';
import type { PlanHighlight } from '@/src/components/table-plan/plan-tile';
import type { TableFailure } from '@/src/lib/table-error';
import {
  bulkAvailabilityAction,
  floorOrder,
  moveZoneInOrder,
  planLabel,
  planStatus,
  renumberZones,
  selectableTableIds,
  tableLocked,
  tableZoneId,
  upcomingBookingNote,
  type PlanLanguage,
  type PlanRoom,
  type RoomKey,
} from '@/src/lib/table-plan';
import type { RestaurantTable, TableZone } from '@/src/types/table';

// The table-management screen's state that is not drawing: the open sheet, the
// selection and its dock actions, the zone reorder, and the ways a result
// shows on the floor (a flash, a ring, new tiles arriving).

export type SheetState =
  | { kind: 'table'; id: number }
  | { kind: 'add'; room: RoomKey; count: number }
  | { kind: 'room'; zoneId: number | null }
  | { kind: 'move' }
  | { kind: 'more' };

export function sheetKey(sheet: SheetState): string {
  switch (sheet.kind) {
    case 'table': return `table:${sheet.id}`;
    case 'add': return `add:${sheet.room}:${sheet.count}`;
    case 'room': return `room:${sheet.zoneId ?? 'new'}`;
    default: return sheet.kind;
  }
}

const REORDER_COMMIT_MS = 600;
const REVEAL_STAGGER_MS = 40;
const REVEAL_MAX_TILES = 12;

export function usePlanController({ plan, language, t, showError, refreshMembership }: {
  plan: TablePlan;
  language: PlanLanguage;
  t: (th: string, en: string) => string;
  showError: (title: string, message?: string) => void;
  refreshMembership: () => void;
}) {
  const { tables, zones, activeOrderIds, reload: reloadPlan, setTables: setPlanTables, setZones: setPlanZones, holdZones } = plan;
  const api = useMemo(() => tablePlanApi(language), [language]);

  // ---- sheets ------------------------------------------------------------
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Counts every open. The body is keyed by it, so each open starts from the
  // row as saved: a draft left unsaved on one table never shows up on the next
  // table the inspector swaps in, or on the same table opened again.
  const [sheetSeq, setSheetSeq] = useState(0);
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const showSheet = useCallback((next: SheetState) => {
    dirtyRef.current = false;
    setSheet(next);
    setSheetSeq((current) => current + 1);
    setSheetOpen(true);
  }, []);
  const closeSheet = useCallback(() => {
    // A body mid-request keeps the sheet up until it settles.
    if (busyRef.current) return;
    dirtyRef.current = false;
    setSheetOpen(false);
  }, []);
  /** On a tablet the inspector swaps bodies in place: an unsaved one asks first. */
  const openGuarded = useCallback((next: SheetState) => {
    if (!dirtyRef.current || !sheetOpen) {
      showSheet(next);
      return;
    }
    Alert.alert(t('ทิ้งการแก้ไข?', 'Discard changes?'), undefined, [
      { text: t('แก้ต่อ', 'Keep editing'), style: 'cancel' },
      { text: t('ทิ้ง', 'Discard'), style: 'destructive', onPress: () => showSheet(next) },
    ]);
  }, [sheetOpen, showSheet, t]);
  /** The tablet inspector giving way to something else (selection): an unsaved body asks first. */
  const closeGuarded = useCallback((then: () => void) => {
    const leave = () => {
      closeSheet();
      then();
    };
    if (!dirtyRef.current || !sheetOpen) {
      leave();
      return;
    }
    Alert.alert(t('ทิ้งการแก้ไข?', 'Discard changes?'), undefined, [
      { text: t('แก้ต่อ', 'Keep editing'), style: 'cancel' },
      { text: t('ทิ้ง', 'Discard'), style: 'destructive', onPress: leave },
    ]);
  }, [closeSheet, sheetOpen, t]);

  // ---- highlights --------------------------------------------------------
  const [highlights, setHighlights] = useState<ReadonlyMap<number, PlanHighlight>>(new Map());
  const [reveal, setReveal] = useState<ReadonlyMap<number, number>>(new Map());
  const tokenRef = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  const later = useCallback((run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      run();
    }, ms);
    timersRef.current.add(timer);
  }, []);
  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  const flash = useCallback((ids: readonly number[], kind: PlanHighlightKind) => {
    if (!ids.length) return;
    tokenRef.current += 1;
    const token = tokenRef.current;
    setHighlights((current) => {
      const next = new Map(current);
      for (const id of ids) next.set(id, { kind, token });
      return next;
    });
    // Cleared once it has played, so a tile remounted by a filter does not play it again.
    later(() => setHighlights((current) => {
      const next = new Map(current);
      for (const id of ids) if (next.get(id)?.token === token) next.delete(id);
      return next;
    }), kind === 'ring' ? 1400 : 800);
  }, [later]);

  const revealTiles = useCallback((ids: readonly number[]) => {
    const delays = new Map<number, number>();
    ids.slice(0, REVEAL_MAX_TILES).forEach((id, index) => delays.set(id, index * REVEAL_STAGGER_MS));
    setReveal(delays);
    later(() => setReveal(new Map()), REVEAL_MAX_TILES * REVEAL_STAGGER_MS + 600);
  }, [later]);

  const announce = useCallback((message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
  }, []);

  const report = useCallback((failure: TableFailure) => {
    showError(failure.title, failure.message);
    if (failure.reload === 'plan') void reloadPlan();
    if (failure.reload === 'membership') refreshMembership();
  }, [refreshMembership, reloadPlan, showError]);

  // ---- zone reorder ------------------------------------------------------
  // Shown at once, saved after a pause. Until its saves have answered, loads
  // keep off the zones (holdZones): a quiet reload landing in the pause would
  // put the old order back and leave nothing to save, and one landing during
  // the saves would show the old order over a reorder that went through.
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const tablesRef = useRef(tables);
  tablesRef.current = tables;
  const reorderSnapshotRef = useRef<TableZone[] | null>(null);
  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reorderSavesRef = useRef(0);
  const syncZoneHold = useCallback(() => {
    holdZones(reorderTimerRef.current !== null || reorderSavesRef.current > 0);
  }, [holdZones]);
  const commitReorder = useCallback(async () => {
    reorderTimerRef.current = null;
    const snapshot = reorderSnapshotRef.current;
    reorderSnapshotRef.current = null;
    const before = new Map((snapshot ?? []).map((zone) => [zone.ID, zone.display_order]));
    const changed = snapshot ? zonesRef.current.filter((zone) => before.get(zone.ID) !== zone.display_order) : [];
    if (!snapshot || !changed.length) {
      syncZoneHold();
      return;
    }
    reorderSavesRef.current += 1;
    const results = await Promise.all(changed.map((zone) => api.reorderZone(zone.ID, {
      name: zone.name,
      prefix: zone.prefix,
      display_order: zone.display_order,
      is_active: zone.is_active,
    })));
    reorderSavesRef.current -= 1;
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok) {
      setPlanZones(snapshot);
      syncZoneHold();
      report({ ...failed.failure, reload: 'plan' });
      return;
    }
    // Saved as shown. Setting the zones drops any load that began before the
    // saves answered, since it read the old order.
    setPlanZones((current) => current);
    syncZoneHold();
  }, [api, report, setPlanZones, syncZoneHold]);
  const reorderZone = useCallback((id: number, delta: -1 | 1) => {
    if (!reorderSnapshotRef.current) reorderSnapshotRef.current = zonesRef.current;
    holdZones(true);
    setPlanZones((current) => renumberZones(moveZoneInOrder(current, id, delta)).zones);
    hapticSelect();
    if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
    reorderTimerRef.current = setTimeout(() => { void commitReorder(); }, REORDER_COMMIT_MS);
  }, [commitReorder, holdZones, setPlanZones]);
  // Leaving the screen mid-pause still saves the order.
  const commitRef = useRef(commitReorder);
  commitRef.current = commitReorder;
  useEffect(() => () => {
    if (reorderTimerRef.current) {
      clearTimeout(reorderTimerRef.current);
      void commitRef.current();
    }
  }, []);

  const setBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
  }, []);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const env: PlanEnv = useMemo(() => ({
    language,
    t,
    api,
    tables,
    zones,
    activeOrderIds,
    report,
    reload: reloadPlan,
    setTables: setPlanTables,
    setZones: setPlanZones,
    flash,
    announce,
    setBusy,
    setDirty,
    reorderZone,
  }), [activeOrderIds, announce, api, flash, language, reloadPlan, setPlanTables, setPlanZones, reorderZone, report, t, tables, zones]);

  // ---- selection ---------------------------------------------------------
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [pendingZoneDelete, setPendingZoneDelete] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  // A table that left, or went into service, since it was picked drops out.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const allowed = new Set(selectableTableIds(tables, activeOrderIds));
      const next = new Set([...current].filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [activeOrderIds, tables]);

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
    setPendingZoneDelete(null);
  }, []);
  const startSelecting = useCallback((ids: readonly number[] = []) => {
    setSelecting(true);
    setSelected(new Set(ids));
  }, []);

  /** A tap in selection. A table in service is never picked (the lock). */
  const toggleTable = useCallback((table: RestaurantTable) => {
    if (tableLocked(table, activeOrderIds)) return;
    hapticSelect();
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(table.ID)) next.delete(table.ID);
      else next.add(table.ID);
      return next;
    });
  }, [activeOrderIds]);

  const toggleMany = useCallback((pool: readonly RestaurantTable[]) => {
    const ids = pool.filter((table) => !tableLocked(table, activeOrderIds)).map((table) => table.ID);
    if (!ids.length) return;
    hapticSelect();
    setSelected((current) => {
      const all = ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [activeOrderIds]);
  const toggleRoom = useCallback((room: PlanRoom) => toggleMany(room.tables), [toggleMany]);

  const selectedTables = useMemo(
    () => floorOrder(tables, zones).filter((table) => selected.has(table.ID)),
    [selected, tables, zones],
  );
  const availability = bulkAvailabilityAction(selectedTables, activeOrderIds);

  /** Asked once the tables of a room being deleted have all moved out. */
  const offerZoneDelete = useCallback((zoneId: number) => {
    const zone = zonesRef.current.find((item) => item.ID === zoneId);
    if (!zone || tablesRef.current.some((table) => tableZoneId(table) === zoneId)) return;
    Alert.alert(t(`ลบโซน ${zone.name}?`, `Delete ${zone.name}?`), undefined, [
      { text: t('เก็บไว้', 'Keep'), style: 'cancel' },
      {
        text: t('ลบโซน', 'Delete zone'),
        style: 'destructive',
        onPress: () => {
          void api.removeZone(zone.ID).then((result) => {
            if (!result.ok) {
              report(result.failure);
              return;
            }
            setPlanZones((current) => current.filter((item) => item.ID !== zone.ID));
            announce(t(`ลบโซน ${zone.name} แล้ว`, `Deleted ${zone.name}`));
          });
        },
      },
    ]);
  }, [announce, api, report, setPlanZones, t]);

  /** A bulk sheet finished: flash what went through, keep what did not selected. */
  const finishBulk = useCallback((sheetKind: 'move' | 'more', { doneIds, failedIds, announcement }: BulkFinish) => {
    busyRef.current = false;
    setSheetOpen(false);
    flash(doneIds, 'flash');
    if (doneIds.length) hapticSuccess();
    const zoneId = pendingZoneDelete;
    if (failedIds.length) {
      setSelected(new Set(failedIds));
    } else {
      stopSelecting();
      if (announcement) announce(announcement);
    }
    // Asked once the moved rows have landed in the list.
    if (sheetKind === 'move' && zoneId !== null) later(() => offerZoneDelete(zoneId), 50);
  }, [announce, flash, later, offerZoneDelete, pendingZoneDelete, stopSelecting]);

  /** The dock's second button: close every free table picked, or open every closed one. */
  const runAvailability = useCallback(() => {
    const action = availability;
    if (!action || running) return;
    const targets = selectedTables.filter((table) => !tableLocked(table, activeOrderIds)
      && (action === 'close' ? planStatus(table, activeOrderIds) === 'free' : table.status === 'inactive'));
    if (!targets.length) return;
    const go = async () => {
      setRunning(true);
      const result = await runBulk(
        targets,
        BULK_LIMIT,
        (table) => api.saveTable(table.ID, { zone_id: tableZoneId(table), capacity: table.capacity, status: action === 'close' ? 'inactive' : 'free' }),
        (_table, outcome) => {
          if (outcome.ok) setPlanTables((current) => mergeTableRow(current, outcome.value));
        },
      );
      setRunning(false);
      flash(result.done.map(({ table }) => table.ID), 'flash');
      if (result.failed.length) {
        alertBulkPartial(action, targets.length, result.failed, language);
        setSelected(new Set(result.failed.map(({ table }) => table.ID)));
        const reloads = bulkReloads(result.failed);
        if (reloads.plan) void reloadPlan();
        if (reloads.membership) refreshMembership();
        return;
      }
      hapticSuccess();
      stopSelecting();
      announce(bulkDoneWords(action, targets.length, language));
    };
    const note = action === 'close' ? upcomingBookingNote(targets, language) : null;
    if (note) {
      const title = targets.length === 1
        ? t(`ปิด ${planLabel(targets[0])}?`, `Close ${planLabel(targets[0])}?`)
        : t(`ปิด ${targets.length} โต๊ะ?`, `Close ${targets.length} tables?`);
      Alert.alert(title, note, [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: t('ปิดใช้งาน', 'Close'), onPress: () => { void go(); } },
      ]);
      return;
    }
    void go();
  }, [activeOrderIds, announce, api, availability, flash, language, refreshMembership, reloadPlan, running, selectedTables, setPlanTables, stopSelecting, t]);

  return {
    env,
    sheet,
    /** The key of the open body: which sheet, and which time it was opened. */
    sheetBodyKey: sheet ? `${sheetKey(sheet)}#${sheetSeq}` : null,
    sheetOpen,
    showSheet,
    openGuarded,
    closeSheet,
    closeGuarded,
    highlights,
    reveal,
    flash,
    revealTiles,
    announce,
    selecting,
    selected,
    selectedTables,
    availability,
    running,
    startSelecting,
    stopSelecting,
    toggleTable,
    toggleMany,
    toggleRoom,
    setPendingZoneDelete,
    finishBulk,
    runAvailability,
  };
}
