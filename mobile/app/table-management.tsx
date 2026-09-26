import { useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, ScrollView, useWindowDimensions, View } from 'react-native';

import { AppRefreshControl, AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import { AddTablesBody, type AddPreview } from '@/src/components/table-plan/add-tables-body';
import { BulkMoreBody, BulkMoveBody } from '@/src/components/table-plan/bulk-bodies';
import { hapticSelect, hapticSuccess, PlanProvider } from '@/src/components/table-plan/plan-context';
import { FilterBar, HeaderSelectAction, SelectionBar, SelectionDock, type RoomFilter } from '@/src/components/table-plan/plan-bars';
import { AddRoomChip, floorLabels, LabelRuler, RoomSection, type FloorHandlers } from '@/src/components/table-plan/plan-floor';
import { PlanInspector } from '@/src/components/table-plan/plan-inspector';
import { ContentReveal } from '@/src/components/skeleton';
import { PlanFailed, PlanSkeleton, PlanState } from '@/src/components/table-plan/plan-states';
import { floorGrid } from '@/src/components/table-plan/plan-tile';
import { RoomEditorBody } from '@/src/components/table-plan/room-editor-body';
import { PlanSheet, type BodyChrome } from '@/src/components/table-plan/sheet-kit';
import { SummaryCard } from '@/src/components/table-plan/summary-card';
import { TableBody } from '@/src/components/table-plan/table-body';
import { usePlanController, type SheetState } from '@/src/components/table-plan/use-plan-controller';
import { QrSlipHost, useQrPaper } from '@/src/components/table-plan/use-qr-paper';
import { usePlanDeepLink, useTablePlan } from '@/src/hooks/use-table-plan';
import { tableManagementAccess } from '@/src/lib/permission-parity';
import { can } from '@/src/lib/rbac';
import { tableLoadFailureLine } from '@/src/lib/table-error';
import {
  compressLabelRuns,
  PLAN_TILE_LABEL_FONT,
  PLAN_TILE_LABEL_MIN_FONT,
  planFloor,
  planLabel,
  planRooms,
  planStatus,
  planSummary,
  selectableTableIds,
  tableLocked,
  tableZoneId,
  type PlanLanguage,
  type PlanRoom,
  type RoomKey,
} from '@/src/lib/table-plan';
import { sharedTileLabelSize } from '@/src/lib/table-tile-tone';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, spacing } from '@/src/theme';
import type { RestaurantTable, TableStatus, TableZone } from '@/src/types/table';

// จัดการโต๊ะ, "ผังแก้ได้": the order-taking floor in setup mode. Rooms in the
// server's order, the same tile grid and one label size, and every change made
// in a sheet over it (inline on a tablet), so each result lands where the owner
// is looking. A table in service is read only here (owner, 2026-09-23): it is
// closed through service first. See src/components/table-plan/.

/** The scroll content starts this far below the pinned header (AppScreen's padding). */
const CONTENT_TOP = spacing.lg;

export default function TableManagementScreen() {
  const { activeMembership } = useAuth();
  const { copy } = useDisplayPreferences();
  const access = tableManagementAccess(can(activeMembership, 'view_tables'), can(activeMembership, 'manage_table'));
  if (!access.canView) {
    return (
      <AppScreen centerTitle title={copy('จัดการโต๊ะ', 'Table management')} topLevel={false}>
        <PlanState icon="lock-closed-outline" line={copy('ไม่มีสิทธิ์ดูผังโต๊ะ', 'No access to the tables')} />
      </AppScreen>
    );
  }
  return <TablePlanScreen canManage={access.canMutate} />;
}

function TablePlanScreen({ canManage }: { canManage: boolean }) {
  const { width } = useWindowDimensions();
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const lang: PlanLanguage = language === 'en' ? 'en' : 'th';
  const title = copy('จัดการโต๊ะ', 'Table management');
  // GET /orders?status=active answers only these members; everyone else reads the status column.
  const canSeeOrders = can(activeMembership, 'view_orders') || can(activeMembership, 'take_order');
  const restaurantId = activeMembership?.restaurant_id ?? null;
  const plan = useTablePlan({ enabled: true, canSeeOrders, restaurantId });
  const { tables, zones, activeOrderIds } = plan;

  const showError = useCallback((errorTitle: string, message?: string) => {
    showToast({ tone: 'error', title: errorTitle, message });
  }, [showToast]);
  const refreshMembership = useCallback(() => {
    void refreshMemberships().catch(() => undefined);
  }, [refreshMemberships]);
  const ctl = usePlanController({ plan, language: lang, t: copy, showError, refreshMembership });
  const paper = useQrPaper({ language: lang, t: copy });
  // The inspector is for editing; a member who can only look gets the floor alone.
  const workspace = width >= breakpoints.tabletWorkspace && canManage;
  const open = workspace ? ctl.openGuarded : ctl.showSheet;

  // ---- filters -------------------------------------------------------------
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('all');
  const [statusFilter, setStatusFilter] = useState<TableStatus | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    setSearchOpen(false);
  }, []);
  const clearFilters = () => {
    setRoomFilter('all');
    setStatusFilter(null);
    closeSearch();
  };
  const allRooms = useMemo(() => planRooms(tables, zones), [tables, zones]);
  // A room that disappears (its zone deleted) resets the picker.
  useEffect(() => {
    if (roomFilter !== 'all' && !allRooms.some((room) => room.key === roomFilter)) setRoomFilter('all');
  }, [allRooms, roomFilter]);
  const rooms = useMemo(
    () => planFloor(tables, zones, { room: roomFilter, status: statusFilter, query }, activeOrderIds),
    [activeOrderIds, query, roomFilter, statusFilter, tables, zones],
  );
  const summary = useMemo(() => planSummary(tables, activeOrderIds), [activeOrderIds, tables]);
  const filtering = statusFilter !== null || query.trim() !== '';

  // ---- the grid and its one label size --------------------------------------
  const [gridWidth, setGridWidth] = useState(0);
  const [widest, setWidest] = useState(0);
  const metrics = floorGrid(gridWidth, width);
  const labelFontSize = sharedTileLabelSize(widest, metrics.labelRoom, PLAN_TILE_LABEL_FONT, PLAN_TILE_LABEL_MIN_FONT);
  const labels = useMemo(() => floorLabels(tables), [tables]);
  const onWidest = useCallback((next: number) => {
    setWidest((current) => (Math.abs(current - next) < 0.5 ? current : next));
  }, []);

  // ---- scrolling to what just changed --------------------------------------
  const scrollControlRef = useRef<AppScreenScrollControl | null>(null);
  const floorScrollRef = useRef<ScrollView>(null);
  const floorTopRef = useRef(0);
  const roomYRef = useRef(new Map<RoomKey, number>());
  const [scrollTarget, setScrollTarget] = useState<{ room: RoomKey; tableId: number | null } | null>(null);
  const [ghostPulse, setGhostPulse] = useState<{ room: RoomKey; token: number } | null>(null);
  const [preview, setPreview] = useState<AddPreview | null>(null);
  const scrollFloorTo = useCallback((y: number) => {
    const top = Math.max(0, floorTopRef.current + y - 12);
    if (workspace) floorScrollRef.current?.scrollTo({ y: top, animated: true });
    else scrollControlRef.current?.scrollTo(CONTENT_TOP + top);
  }, [workspace]);
  const onRoomLayout = useCallback((key: RoomKey, y: number) => {
    roomYRef.current.set(key, y);
    if (scrollTarget && scrollTarget.tableId === null && scrollTarget.room === key) {
      scrollFloorTo(y);
      setScrollTarget(null);
    }
  }, [scrollFloorTo, scrollTarget]);

  // ---- results from the sheets ---------------------------------------------
  const onAdded = useCallback((created: RestaurantTable[]) => {
    ctl.closeSheet();
    if (!created.length) return;
    const room: RoomKey = tableZoneId(created[0]) ?? 'none';
    // Nothing that would hide the new tiles stays on.
    if (statusFilter && statusFilter !== planStatus(created[0], activeOrderIds)) setStatusFilter(null);
    if (query) closeSearch();
    if (roomFilter !== 'all' && roomFilter !== room) setRoomFilter('all');
    const ids = created.map((table) => table.ID);
    ctl.revealTiles(ids);
    ctl.flash(ids, 'ring');
    hapticSuccess();
    const words = compressLabelRuns(created.map(planLabel));
    ctl.announce(copy(`เพิ่ม ${words} แล้ว`, `Added ${words}`));
    setScrollTarget({ room, tableId: created[0].ID });
  }, [activeOrderIds, closeSearch, copy, ctl, query, roomFilter, statusFilter]);

  const onZoneCreated = useCallback((zone: TableZone) => {
    ctl.closeSheet();
    if (roomFilter !== 'all') setRoomFilter('all');
    setGhostPulse({ room: zone.ID, token: Date.now() });
    setScrollTarget({ room: zone.ID, tableId: null });
  }, [ctl, roomFilter]);

  const onHandoff = useCallback((zone: TableZone, ids: number[]) => {
    ctl.closeSheet();
    clearFilters();
    ctl.startSelecting(ids);
    ctl.setPendingZoneDelete(zone.ID);
    // clearFilters is rebuilt every render; its setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctl]);

  usePlanDeepLink(plan.status === 'ready', (link) => {
    if (!canManage) return;
    if (link.kind === 'add') {
      ctl.showSheet({ kind: 'add', room: 'none', count: tables.length ? 1 : 10 });
      return;
    }
    if (tables.some((table) => table.ID === link.id)) ctl.showSheet({ kind: 'table', id: link.id });
    else showToast({ tone: 'warning', title: copy('ไม่พบโต๊ะนี้แล้ว', 'That table is gone') });
  });

  // ---- selection -----------------------------------------------------------
  const selectingRef = useRef(ctl.selecting);
  selectingRef.current = ctl.selecting;
  const { stopSelecting } = ctl;
  // Android's back ends the selection before it would leave the screen.
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!selectingRef.current) return false;
      stopSelecting();
      return true;
    });
    return () => subscription.remove();
  }, [stopSelecting]));

  const visibleEligible = rooms.flatMap((room) => room.tables).filter((table) => !tableLocked(table, activeOrderIds));
  const allChosen = visibleEligible.length > 0 && visibleEligible.every((table) => ctl.selected.has(table.ID));

  const handlers: FloorHandlers = {
    onTilePress: (table) => {
      if (ctl.selecting) {
        ctl.toggleTable(table);
        return;
      }
      open({ kind: 'table', id: table.ID });
    },
    onTileLongPress: (table) => {
      // A table in service is never a way into selection.
      if (tableLocked(table, activeOrderIds)) return;
      hapticSelect();
      const pick = () => ctl.startSelecting([table.ID]);
      if (workspace) ctl.closeGuarded(pick);
      else pick();
    },
    onRoomPress: (room) => {
      if (room.zone) open({ kind: 'room', zoneId: room.zone.ID });
    },
    onRoomToggle: ctl.toggleRoom,
    onAdd: (room) => open({ kind: 'add', room: room.key, count: 1 }),
  };

  const renderBody = (state: SheetState, chrome: BodyChrome) => {
    switch (state.kind) {
      case 'table':
        return <TableBody chrome={chrome} onClose={ctl.closeSheet} paper={paper} tableId={state.id} />;
      case 'add':
        return <AddTablesBody chrome={chrome} initialCount={state.count} initialRoom={state.room} onDone={onAdded} onPreview={workspace ? setPreview : undefined} />;
      case 'room':
        return <RoomEditorBody chrome={chrome} onClose={ctl.closeSheet} onCreated={onZoneCreated} onHandoff={onHandoff} zoneId={state.zoneId} />;
      case 'move':
        return <BulkMoveBody chrome={chrome} onFinished={(result) => ctl.finishBulk('move', result)} selectedIds={ctl.selected} />;
      case 'more':
        return <BulkMoreBody chrome={chrome} onFinished={(result) => ctl.finishBulk('more', result)} selectedIds={ctl.selected} />;
      default:
        return null;
    }
  };

  // ---- pieces --------------------------------------------------------------
  const ready = plan.status === 'ready';
  const emptyShop = ready && tables.length === 0 && zones.length === 0;
  const showGhost = canManage && !filtering && !ctl.selecting;
  const showAddRoom = showGhost && roomFilter === 'all';
  const focusedTableId = workspace && ctl.sheetOpen && ctl.sheet?.kind === 'table' ? ctl.sheet.id : null;
  const addRoom = () => open({ kind: 'room', zoneId: null });

  // Selection is for two or more tables that can be edited; tables in service
  // can never be picked, so they do not count towards offering it.
  const selectableCount = selectableTableIds(tables, activeOrderIds).length;
  const headerAction = canManage && ready && (ctl.selecting || selectableCount >= 2) ? (
    <HeaderSelectAction
      onPress={() => {
        if (ctl.selecting) {
          ctl.stopSelecting();
          return;
        }
        if (workspace) ctl.closeGuarded(() => ctl.startSelecting());
        else ctl.startSelecting();
      }}
      selecting={ctl.selecting}
      t={copy}
    />
  ) : undefined;

  const bar = !ready || tables.length === 0 ? null : ctl.selecting ? (
    <SelectionBar
      allChosen={allChosen}
      count={ctl.selected.size}
      language={lang}
      onToggleAll={() => ctl.toggleMany(visibleEligible)}
      t={copy}
    />
  ) : (
    <FilterBar
      language={lang}
      onOpenSearch={() => setSearchOpen(true)}
      onQuery={setQuery}
      onRoom={setRoomFilter}
      query={query}
      room={roomFilter}
      rooms={allRooms}
      searchOpen={searchOpen}
      t={copy}
      tableCount={tables.length}
    />
  );

  const dock = ctl.selecting ? (
    <SelectionDock
      availability={ctl.availability}
      count={ctl.selected.size}
      hasZones={zones.length > 0}
      onAvailability={ctl.runAvailability}
      onMore={() => open({ kind: 'more' })}
      onMove={() => open({ kind: 'move' })}
      running={ctl.running}
      t={copy}
    />
  ) : undefined;

  const floor = (
    <View
      onLayout={(event) => {
        floorTopRef.current = event.nativeEvent.layout.y;
        setGridWidth(event.nativeEvent.layout.width);
      }}
    >
      <LabelRuler labels={labels} onWidest={onWidest} />
      {rooms.map((room: PlanRoom, index) => (
        <RoomSection
          activeOrderIds={activeOrderIds}
          canManage={canManage}
          first={index === 0}
          focusedTableId={focusedTableId}
          ghostPulse={ghostPulse?.room === room.key ? ghostPulse.token : undefined}
          handlers={handlers}
          highlights={ctl.highlights}
          key={String(room.key)}
          labelFontSize={labelFontSize}
          language={lang}
          metrics={metrics}
          onLayoutY={onRoomLayout}
          onTargetLayout={(y) => {
            requestAnimationFrame(() => {
              scrollFloorTo((roomYRef.current.get(room.key) ?? 0) + y);
              setScrollTarget(null);
            });
          }}
          previewLabels={preview && preview.room === room.key ? preview.labels : null}
          reveal={ctl.reveal}
          room={room}
          scrollTargetId={scrollTarget?.room === room.key ? scrollTarget.tableId : null}
          selected={ctl.selected}
          selecting={ctl.selecting}
          showGhost={showGhost}
          showValue={allRooms.length > 1}
          t={copy}
        />
      ))}
      {showAddRoom ? <AddRoomChip label={copy('เพิ่มโซน', 'Add zone')} onPress={addRoom} /> : null}
    </View>
  );

  const content = plan.status === 'loading' ? (
    <PlanSkeleton label={copy('กำลังโหลดผังโต๊ะ', 'Loading the tables')} />
  ) : plan.status === 'failed' ? (
    <PlanFailed line={tableLoadFailureLine(plan.loadError, lang)} onRetry={() => { void plan.retry(); }} />
  ) : emptyShop ? (
    <View>
      <PlanState
        action={canManage ? { label: copy('เพิ่มโต๊ะ', 'Add tables'), icon: 'add', onPress: () => open({ kind: 'add', room: 'none', count: 10 }) } : null}
        icon="grid-outline"
        line={copy('ยังไม่มีโต๊ะ', 'No tables yet')}
      />
      {canManage ? <AddRoomChip label={copy('เพิ่มโซน', 'Add zone')} onPress={addRoom} /> : null}
    </View>
  ) : (
    <ContentReveal style={{ gap: spacing.xl }}>
      {tables.length ? <SummaryCard language={lang} onStatus={setStatusFilter} status={statusFilter} summary={summary} /> : null}
      {filtering && rooms.length === 0 ? (
        <PlanState action={{ label: copy('ล้างตัวกรอง', 'Clear filters'), onPress: clearFilters }} icon="search-outline" line={copy('ไม่พบโต๊ะ', 'No tables found')} />
      ) : floor}
    </ContentReveal>
  );

  const slip = <QrSlipHost shopName={activeMembership?.restaurant?.name ?? ''} slip={paper.slip} slipRef={paper.slipRef} />;

  if (workspace) {
    const inspectorBody = ctl.sheetOpen && ctl.sheet
      ? <Fragment key={ctl.sheetBodyKey}>{renderBody(ctl.sheet, 'inline')}</Fragment>
      : null;
    return (
      <PlanProvider value={ctl.env}>
        <AppScreen action={headerAction} centerTitle contentMaxWidth={1180} footer={dock} scroll={false} title={title} topLevel={false}>
          <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: 20 }}>
            <View style={{ flex: 1.65, minWidth: 0, minHeight: 0, gap: spacing.md }}>
              {bar}
              <ScrollView
                contentContainerStyle={{ paddingBottom: 32 }}
                keyboardShouldPersistTaps="handled"
                ref={floorScrollRef}
                refreshControl={<AppRefreshControl onRefresh={plan.refresh} />}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
              >
                {content}
              </ScrollView>
            </View>
            <PlanInspector
              body={inspectorBody}
              language={lang}
              onAddRoom={addRoom}
              onClose={ctl.closeSheet}
              onRoom={(room) => handlers.onRoomPress(room)}
              rooms={allRooms}
              t={copy}
            />
          </View>
          {slip}
        </AppScreen>
      </PlanProvider>
    );
  }

  return (
    <PlanProvider value={ctl.env}>
      <AppScreen
        action={headerAction}
        centerTitle
        contentMaxWidth={720}
        footer={dock}
        onTouchOutsideStickyContent={searchOpen && allRooms.length >= 2 ? closeSearch : undefined}
        refreshControl={<AppRefreshControl onRefresh={plan.refresh} />}
        scrollControlRef={scrollControlRef}
        stickyContent={bar}
        stickyHeading
        title={title}
        topLevel={false}
      >
        {content}
        {slip}
        {ctl.sheet ? (
          <PlanSheet
            key={ctl.sheetBodyKey}
            keyboardLift={ctl.sheet.kind === 'add' || ctl.sheet.kind === 'room'}
            label={copy('ปิด', 'Close')}
            onClose={ctl.closeSheet}
            open={ctl.sheetOpen}
          >
            {renderBody(ctl.sheet, 'sheet')}
          </PlanSheet>
        ) : null}
      </AppScreen>
    </PlanProvider>
  );
}
