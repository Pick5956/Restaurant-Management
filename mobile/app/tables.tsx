import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, useWindowDimensions, View, type ViewStyle } from 'react-native';

import { listOrders } from '@/src/api/order';
import { listTables } from '@/src/api/table';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { CompactTableTile } from '@/src/components/compact-table-tile';
import { FilterChipRow } from '@/src/components/filter-chip-row';
import { usePrimaryTabSceneStatus } from '@/src/components/primary-tabs-runtime';
import { Bone, ContentReveal, SkeletonReveal } from '@/src/components/skeleton';
import { Button, EmptyState, Feedback, IconButton, SearchField, SectionHeader } from '@/src/components/ui';
import { apiFailureDetail } from '@/src/lib/api-failure';
import { money, tableStatusLabel } from '@/src/lib/format';
import { can } from '@/src/lib/rbac';
import { createRequestGeneration, shouldStartRequest } from '@/src/lib/request-generation';
import { reservationReminder } from '@/src/lib/reservation-schedule';
import { tableLocked } from '@/src/lib/table-plan';
import { sharedTileLabelSize, tableTileStatus, TILE_LABEL_FONT, tileToneFor } from '@/src/lib/table-tile-tone';
import { activeTakeaways, TAKEAWAY_ZONE } from '@/src/lib/takeaway-orders';
import { canViewReservationHistory, tableEntryAction } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, statusTone, typeScale } from '@/src/theme';
import type { Order } from '@/src/types/order';
import type { RestaurantTable } from '@/src/types/table';

const activeOrderStatuses = ['open', 'sent_to_kitchen', 'cooking', 'ready', 'served'];

// The detailed card's pieces, shared by the table card and the takeaway card.
const DETAILED_CARD_TITLE = { minWidth: 0, flex: 1, fontSize: 18, fontWeight: '600', lineHeight: 26 } as const;

/** The status in a small pill at the card's top right, where the web POS card puts it. */
function DetailedCardPill({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexShrink: 0, borderRadius: radius.sm, backgroundColor: 'rgba(255, 255, 255, 0.72)', paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text numberOfLines={1} style={[typeScale.caption, { color, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

/** The order number and its total on one line; the number truncates before the total does. */
function DetailedCardTotal({ orderNumber, total }: { orderNumber: string; total: string }) {
  return (
    // The total at the web card's modest size: at typeScale.number it took so
    // much of a two-column card that the order number lost its last digits.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Text numberOfLines={1} style={[typeScale.caption, { minWidth: 0, flex: 1, color: palette.muted, fontSize: 12, fontVariant: ['tabular-nums'] }]}>{orderNumber}</Text>
      <Text selectable style={{ flexShrink: 0, color: palette.textStrong, fontSize: 15, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{total}</Text>
    </View>
  );
}

export default function TablesScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  // Kept in the stored preferences, not screen state: the choice outlives the
  // screen, and re-picking it after every app start is a chore.
  const { copy, language, compactTables: compactView, setCompactTables } = useDisplayPreferences();
  const canTakeOrder = can(activeMembership, 'take_order');
  const canManageTables = can(activeMembership, 'manage_table');
  const canViewHistory = canViewReservationHistory(
    can(activeMembership, 'view_tables'),
    canManageTables,
    canTakeOrder,
  );
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  // The magnifier hands the filter row over to the field; scrolling hands it back.
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState('all');
  const [loading, setLoading] = useState(true);
  // The app's line under "โหลดผังโต๊ะไม่ได้" when there is one, never the server's words.
  const [error, setError] = useState<{ detail?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGenerationRef = useRef(createRequestGeneration());
  const foregroundRequestRef = useRef<number | null>(null);
  const adjacentWarmRequestedRef = useRef(false);
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();

  const load = useCallback(async (quiet = false) => {
    if (!shouldStartRequest(quiet, foregroundRequestRef.current !== null)) return;

    const request = requestGenerationRef.current.begin();
    if (!quiet) {
      foregroundRequestRef.current = request;
      setLoading(true);
    }
    setError(null);
    try {
      const [tableResponse, orderResponse] = await Promise.all([
        listTables(),
        listOrders({ status: 'active', limit: 200 }),
      ]);
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setTables(tableResponse.tables || []); setOrders(orderResponse.orders || []);
    } catch (err) {
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setError({ detail: apiFailureDetail(err, language) });
    } finally {
      if (!quiet && foregroundRequestRef.current === request) {
        foregroundRequestRef.current = null;
        if (requestGenerationRef.current.isCurrent(request)) setLoading(false);
      }
    }
  }, [language]);
  useEffect(() => {
    if (
      primaryTabSceneStatus !== 'adjacent' ||
      adjacentWarmRequestedRef.current
    ) return;
    adjacentWarmRequestedRef.current = true;
    void load();
  }, [load, primaryTabSceneStatus]);

  useFocusEffect(useCallback(() => {
    if (adjacentWarmRequestedRef.current) {
      adjacentWarmRequestedRef.current = false;
    } else {
      void load();
    }
    const timer = setInterval(() => {
      void load(true);
    }, 10000);
    return () => {
      clearInterval(timer);
      requestGenerationRef.current.invalidate();
      foregroundRequestRef.current = null;
      setLoading(false);
    };
  }, [load]));

  const activeOrderByTable = useMemo(() => {
    const map = new Map<number, Order>();
    orders.filter((order) => activeOrderStatuses.includes(order.status) && order.table_id).forEach((order) => map.set(Number(order.table_id), order));
    return map;
  }, [orders]);
  const activeOrderIds = useMemo(() => new Set(activeOrderByTable.keys()), [activeOrderByTable]);
  // The manager's way from a table on the floor to its setup (owner,
  // 2026-09-23): a long press on a table that is not in service opens it in
  // table management. A table in service stays out of reach there until it is
  // closed through service, so for it - and for everyone else - a long press
  // does nothing new.
  const managementShortcut = (table: RestaurantTable) => (
    canManageTables && !tableLocked(table, activeOrderIds)
      ? () => router.push({ pathname: '/table-management', params: { table: String(table.ID) } })
      : undefined
  );
  const zones = useMemo(() => {
    const map = new Map<string, string>();
    tables.forEach((table) => {
      const key = String(table.zone_id || 'none');
      if (!map.has(key)) map.set(key, table.table_zone?.name || table.zone || copy('ไม่มีโซน', 'No zone'));
    });
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [copy, tables]);
  const groups = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const map = new Map<string, { key: string; label: string; tables: RestaurantTable[] }>();
    tables.filter((table) => {
      const zoneMatches = selectedZone === 'all' || String(table.zone_id || 'none') === selectedZone;
      const searchMatches = !keyword || [table.table_number, table.display_label, table.table_zone?.name].some((value) => String(value || '').toLowerCase().includes(keyword));
      return zoneMatches && searchMatches;
    }).forEach((table) => {
      const key = String(table.zone_id || 'none');
      if (!map.has(key)) map.set(key, { key, label: table.table_zone?.name || table.zone || copy('ไม่มีโซน', 'No zone'), tables: [] });
      map.get(key)?.tables.push(table);
    });
    return Array.from(map.values());
  }, [copy, search, selectedZone, tables]);
  // Open takeaway orders get a section of their own above the zones, as on the
  // web POS: a takeaway has no table, so without it the floor had no way back
  // to one. The zone picker gains a "สั่งกลับบ้าน" entry while any are open.
  const takeaways = useMemo(() => activeTakeaways(orders, search), [orders, search]);
  const allTakeawayCount = useMemo(() => activeTakeaways(orders).length, [orders]);
  const showTakeaways = selectedZone === 'all' || selectedZone === TAKEAWAY_ZONE;
  const zoneOptions = useMemo(() => [
    ...zones,
    ...(allTakeawayCount ? [{ value: TAKEAWAY_ZONE, label: copy(`สั่งกลับบ้าน (${allTakeawayCount})`, `Takeaway (${allTakeawayCount})`) }] : []),
  ], [allTakeawayCount, copy, zones]);
  useEffect(() => {
    if (selectedZone !== 'all' && !zoneOptions.some((zone) => zone.value === selectedZone)) setSelectedZone('all');
  }, [selectedZone, zoneOptions]);
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  // Phones get an exact two-column grid; tablets may grow to fill a row but are
  // capped, so one card left over on the last row keeps the size of the rest.
  // No minimum height: a row of cards already stretches to its tallest one.
  const detailedCardStyle = (fill: string, pressed: boolean): ViewStyle => ({
    width: tabletWorkspace ? undefined : '48%',
    minWidth: tabletWorkspace ? 164 : 0,
    maxWidth: tabletWorkspace ? 260 : undefined,
    flexGrow: tabletWorkspace ? 1 : 0,
    flexBasis: tabletWorkspace ? 176 : 'auto',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: fill,
    borderRadius: radius.md,
    backgroundColor: fill,
    padding: spacing.md,
    opacity: pressed ? 0.72 : 1,
    transform: [{ translateY: pressed ? 1 : 0 }],
  });
  // One label size for every compact tile, small enough that the longest
  // table label in the restaurant shows whole (owner, 2026-09-22). Every
  // label is measured once at the full size by an invisible copy below, and
  // the grid's width says how much room a tile gives its label: 31% of the
  // grid on a phone, the 108 minimum on a tablet, less the tile's padding and
  // hairline. Takeaway tiles take the same size, and a long guest name is
  // cut in the middle rather than shrinking the whole grid.
  const [gridWidth, setGridWidth] = useState(0);
  const [widestLabel, setWidestLabel] = useState(0);
  const labelWidths = useRef(new Map<string, number>());
  const tableLabels = useMemo(
    () => Array.from(new Set(tables.map((table) => table.display_label || table.table_number))),
    [tables],
  );
  const tileLabelRoom = (tabletWorkspace ? 108 : gridWidth * 0.31) - 20;
  const labelFontSize = sharedTileLabelSize(widestLabel, tileLabelRoom);
  const measureLabel = (label: string, labelWidth: number) => {
    labelWidths.current.set(label, labelWidth);
    const widest = Math.max(0, ...tableLabels.map((current) => labelWidths.current.get(current) ?? 0));
    setWidestLabel((previous) => (Math.abs(previous - widest) < 0.5 ? previous : widest));
  };
  // One instant for the whole grid rather than a fresh Date per table, so every
  // card decides "is this booking today" against the same moment.
  const now = new Date();

  function open(table: RestaurantTable) {
    setNotice(null);
    const order = activeOrderByTable.get(table.ID);
    if (!canTakeOrder) {
      setNotice(copy('บัญชีนี้ไม่มีสิทธิ์รับออเดอร์', 'This account cannot take orders'));
      return;
    }
    const action = tableEntryAction(table.status, Boolean(order));
    if (action === 'resume' && order) { router.push({ pathname: '/order/[id]', params: { id: String(order.ID) } }); return; }
    if (action === 'blocked') { setNotice(copy('โต๊ะนี้ปิดใช้งานอยู่ เปิดออเดอร์ไม่ได้', 'This table is inactive and cannot accept an order')); return; }
    if (action === 'reservation') { router.push({ pathname: '/table-reservation' as never, params: { tableId: String(table.ID) } } as never); return; }
    router.push({ pathname: '/order/new' as never, params: { tableId: String(table.ID) } } as never);
  }

  function openTakeaway(order: Order) {
    setNotice(null);
    if (!canTakeOrder) {
      setNotice(copy('บัญชีนี้ไม่มีสิทธิ์รับออเดอร์', 'This account cannot take orders'));
      return;
    }
    router.push({ pathname: '/order/[id]', params: { id: String(order.ID) } });
  }

  // Opening the search takes the filter row over: the zone picker is gone until
  // this runs. `Keyboard.dismiss()` is not redundant with unmounting the field -
  // unmounting blurs it, and blur puts the keyboard away a frame later, which
  // reads as the row snapping back and the keyboard trailing after it.
  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearch('');
    setSearchOpen(false);
  }, []);

  // The secondary actions live in the header as icons rather than in the filter
  // row, which belongs to the zone picker and the magnifier. Each carries its
  // label for screen readers, the only name an icon-only control has.
  const headerActions = [
    // The icon shows the density being switched TO, not the one in use: a
    // toggle that shows its current state gives you nothing to predict from.
    <IconButton
      key="density"
      accessibilityLabel={compactView ? copy('มุมมองแบบเต็ม', 'Detailed view') : copy('มุมมองแบบย่อ', 'Compact view')}
      icon={compactView ? 'grid-outline' : 'apps-outline'}
      onPress={() => setCompactTables(!compactView)}
      variant="glass"
    />,
    canTakeOrder ? <IconButton key="takeaway" accessibilityLabel={copy('ซื้อกลับบ้าน', 'Takeaway')} icon="bag-handle-outline" onPress={() => router.push({ pathname: '/order/new' as never, params: { type: 'takeaway' } } as never)} variant="glass" /> : null,
    // Neither glyph names this screen on its own: a bare clock reads as
    // "something about time", and the clipboard that replaced it reads as "a
    // list" without saying a list of what. The clock rides the clipboard as a
    // badge so the pair says "the list of bookings", which is what is behind it.
    canViewHistory ? <IconButton key="history" accessibilityLabel={copy('ประวัติการจองโต๊ะ', 'Reservation history')} badgeIcon="time-outline" icon="clipboard-outline" onPress={() => router.push('/reservations' as never)} variant="glass" /> : null,
  ].filter(Boolean);

  // The order screen's filter bar, to the letter. Pinned under the heading, one
  // row rather than two: the zone chips and a magnifier share it (FilterChipRow,
  // owner 2026-09-25, in place of a dropdown), and the search field takes the
  // chips' place only while it is being used. An earlier row of zone chips cost
  // a whole line of its own and scrolled away with the first zone; these sit
  // beside the magnifier in the pinned row.
  const zoneFilterBar = zoneOptions.length > 1 ? (
    <>
      {searchOpen ? (
        // No close button. Scrolling the map is what ends the search, which is
        // the gesture already being made to look at the results — a dedicated
        // dismiss control would only be in the way of the field it sits beside.
        <SearchField
          accessibilityLabel={copy('ค้นหาโต๊ะหรือโซน', 'Search tables or zones')}
          autoFocus
          clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
          value={search}
          onChangeText={setSearch}
          placeholder={copy('ค้นหาโต๊ะ', 'Search tables')}
        />
      ) : (
        <FilterChipRow
          options={[{ key: 'all', label: copy('ทุกโซน', 'All zones') }, ...zoneOptions.map((zone) => ({ key: zone.value, label: zone.label }))]}
          value={selectedZone}
          onChange={setSelectedZone}
          trailing={(
            <IconButton
              accessibilityLabel={copy('ค้นหาโต๊ะ', 'Search tables')}
              icon="search-outline"
              onPress={() => setSearchOpen(true)}
              variant="glass"
            />
          )}
        />
      )}
    </>
  ) : (
    // With one zone there is nothing to pick, and a dropdown holding a single
    // dead option is worse than no dropdown. The row gives its width back to the
    // search field, which is then the only thing the bar is for.
    <SearchField
      accessibilityLabel={copy('ค้นหาโต๊ะหรือโซน', 'Search tables or zones')}
      clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
      value={search}
      onChangeText={setSearch}
      placeholder={copy('ค้นหาโต๊ะ', 'Search tables')}
    />
  );

  return (
    // The heading is the one number the floor is actually reading. The screen's
    // own name went with the total table count: the dock below already says
    // which screen this is, and a title that never changes is a line spent on
    // something nobody looks at twice.
    <AppScreen
      title={copy(`${activeOrderByTable.size.toLocaleString('th-TH')} โต๊ะกำลังใช้งาน`, `${activeOrderByTable.size.toLocaleString('en-US')} tables in use`)}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      // The same pinned header the order screen uses. The table map runs several
      // zones long, and both the things you steer it with — the search and the
      // zone picker — used to scroll away with the first zone, leaving no way to
      // reach the last one except more scrolling.
      stickyHeading
      stickyContent={zoneFilterBar}
      // The open search field is a stage, not a control sitting alongside the
      // others: while it is up, the first touch anywhere else on the screen is
      // spent closing it and putting the keyboard away, and reaches nothing
      // underneath. This replaced closing on scroll, which could only end the
      // stage one way - so dismissing the keyboard without also scrolling left
      // the row stuck showing a search box nobody was typing in.
      //
      // Any typed keyword goes with it, so the grid can never stay filtered by
      // a search box that is no longer on screen.
      onTouchOutsideStickyContent={searchOpen ? closeSearch : undefined}
      action={headerActions.length ? <View style={{ flexDirection: 'row', gap: spacing.sm }}>{headerActions}</View> : undefined}
    >
      {error ? <Feedback title={copy('โหลดผังโต๊ะไม่ได้', 'Could not load the table map')} detail={error.detail} tone="danger" /> : null}
      {notice ? <Feedback title={copy('ยังเปิดโต๊ะนี้ไม่ได้', 'This table cannot be opened yet')} detail={notice} tone="warning" /> : null}
      {!canTakeOrder ? <Feedback title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')} detail={copy('เลือกโหมดงานอื่นที่บัญชีนี้ได้รับอนุญาตจากเมนูด้านล่าง', 'Choose another work mode allowed for this account from the menu below.')} tone="info" /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.xl }}>
        <View onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)} style={{ minWidth: 0, flex: 1, gap: spacing.xl }}>
          {compactView ? (
            // The ruler: every table label at the full tile size, never seen or
            // heard, so the grid can pick the one size the widest fits at.
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, opacity: 0, alignItems: 'flex-start' }}>
              {tableLabels.map((label) => (
                <Text
                  key={label}
                  numberOfLines={1}
                  onLayout={(event) => measureLabel(label, event.nativeEvent.layout.width)}
                  style={{ fontSize: TILE_LABEL_FONT, lineHeight: 34, fontWeight: '700', fontVariant: ['tabular-nums'] }}
                >
                  {label}
                </Text>
              ))}
            </View>
          ) : null}
          {showTakeaways && takeaways.length ? (
            <View style={{ gap: spacing.md }}>
              <SectionHeader
                title={copy('สั่งกลับบ้าน', 'Takeaway')}
                inlineDetail={copy(`${takeaways.length.toLocaleString('th-TH')} ออเดอร์`, `${takeaways.length.toLocaleString('en-US')} ${takeaways.length === 1 ? 'order' : 'orders'}`)}
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                {takeaways.map((order) => {
                  const name = order.customer_name?.trim() || copy('ไม่ระบุชื่อ', 'No name');
                  const kind = copy('กลับบ้าน', 'Takeaway');
                  const accessibilityLabel = copy(`กลับบ้าน ${name}, ${order.order_number}`, `Takeaway ${name}, ${order.order_number}`);
                  if (compactView) {
                    return (
                      <CompactTableTile
                        accessibilityLabel={accessibilityLabel}
                        flexBasis={tabletWorkspace ? 116 : 'auto'}
                        flexGrow={tabletWorkspace ? 1 : 0}
                        key={`takeaway-${order.ID}`}
                        label={name}
                        labelFontSize={labelFontSize}
                        language={language}
                        maxWidth={tabletWorkspace ? 160 : undefined}
                        minWidth={tabletWorkspace ? 108 : 0}
                        onPress={() => openTakeaway(order)}
                        status="takeaway"
                        statusLabel={kind}
                        width={tabletWorkspace ? undefined : '31%'}
                      />
                    );
                  }
                  // The detailed card, in the takeaway blue and laid out like the
                  // table card: the guest in place of the table, the phone in
                  // place of the seats.
                  const tone = tileToneFor('takeaway');
                  return (
                    <Pressable
                      accessibilityLabel={accessibilityLabel}
                      accessibilityRole="button"
                      key={`takeaway-${order.ID}`}
                      onPress={() => openTakeaway(order)}
                      style={({ pressed }) => detailedCardStyle(tone.fill, pressed)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                        <Text selectable numberOfLines={1} style={[DETAILED_CARD_TITLE, { color: tone.ink }]}>{name}</Text>
                        <DetailedCardPill color={tone.ink} label={kind} />
                      </View>
                      <Text selectable numberOfLines={1} style={[typeScale.caption, { color: palette.muted }]}>
                        {order.customer_phone?.trim() || copy('ไม่มีเบอร์', 'No phone')}
                      </Text>
                      <View style={{ flex: 1 }} />
                      <DetailedCardTotal orderNumber={order.order_number} total={money(order.grand_total, language)} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
          {groups.length ? (
            <ContentReveal style={{ gap: spacing.xl }}>
            {groups.map((group) => {
              // Free out of total, not the total alone. "12 โต๊ะ" is a fact about
              // the restaurant that never changes during service; how many of them
              // can take someone right now is the question being asked of this
              // screen. Counted the same way the tiles are painted, so the number
              // and the green cards under it can never disagree.
              const freeCount = group.tables.filter(
                (table) => tableTileStatus(table.status, activeOrderByTable.has(table.ID)) === 'free',
              ).length;
              return (
              <View key={group.key} style={{ gap: spacing.md }}>
                <SectionHeader
                  title={group.label}
                  inlineDetail={copy(
                    `ว่าง ${freeCount.toLocaleString('th-TH')} จาก ${group.tables.length.toLocaleString('th-TH')}`,
                    `${freeCount.toLocaleString('en-US')} of ${group.tables.length.toLocaleString('en-US')} free`,
                  )}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                  {group.tables.map((table) => {
                    const order = activeOrderByTable.get(table.ID);
                    // A table with an active order always reads as occupied (amber),
                    // matching web POS. On the floor green means "free", so tinting a
                    // busy table green misreads at a glance, which is the whole job of
                    // this tile.
                    const statusLabel = order
                      ? copy('กำลังใช้งาน', 'In use')
                      : tableStatusLabel(table.status, language);
                    const reminder = reservationReminder(table.upcoming_reservation_at, now, language);
                    const accessibilityLabel = copy(
                      `โต๊ะ ${table.display_label || table.table_number}, ${order ? 'กำลังใช้งาน' : tableStatusLabel(table.status, language)}${reminder ? `, ${reminder}` : ''}`,
                      `Table ${table.display_label || table.table_number}, ${order ? 'in use' : tableStatusLabel(table.status, language)}${reminder ? `, ${reminder}` : ''}`,
                    );
                    if (compactView) {
                      // Three to a row, and only what tells the floor whether it can
                      // seat someone: which table, and whether it is taken. The
                      // booking reminder stays because losing it is the difference
                      // between a warning and no warning, but the guest count, order
                      // number and running total are all detail for a screen you have
                      // already decided to open.
                      return (
                        <CompactTableTile
                          accessibilityLabel={accessibilityLabel}
                          flexBasis={tabletWorkspace ? 116 : 'auto'}
                          flexGrow={tabletWorkspace ? 1 : 0}
                          key={table.ID}
                          label={table.display_label || table.table_number}
                          labelFontSize={labelFontSize}
                          language={language}
                          maxWidth={tabletWorkspace ? 160 : undefined}
                          minWidth={tabletWorkspace ? 108 : 0}
                          onLongPress={managementShortcut(table)}
                          onPress={() => open(table)}
                          status={tableTileStatus(table.status, Boolean(order))}
                          statusLabel={statusLabel}
                          upcomingReservationAt={table.upcoming_reservation_at}
                          width={tabletWorkspace ? undefined : '31%'}
                        />
                      );
                    }
                    // The detailed card, laid out like the web POS table card
                    // (owner, 2026-09-22: the old one left too much empty space):
                    // the table and its status pill on one line, the seats under
                    // it, the order and its total at the foot. It is the only
                    // reader of statusTone here — the compact tile carries its own
                    // map, so repainting one view could never repaint the other.
                    const tone = order ? 'warning' : table.status === 'reserved' ? 'info' : table.status === 'inactive' ? 'neutral' : 'success';
                    const tint = statusTone(tone);
                    return (
                      <Pressable
                        accessibilityLabel={accessibilityLabel}
                        accessibilityRole="button"
                        key={table.ID}
                        onLongPress={managementShortcut(table)}
                        onPress={() => open(table)}
                        style={({ pressed }) => detailedCardStyle(tint.backgroundColor, pressed)}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                          <Text selectable numberOfLines={1} style={[DETAILED_CARD_TITLE, { color: tint.color }]}>{table.display_label || table.table_number}</Text>
                          <DetailedCardPill color={tint.color} label={statusLabel} />
                        </View>
                        {/* The booking shares the seats line rather than taking one
                            of its own. A line of its own grew the card, and because
                            a wrapped row stretches to its tallest tile that pushed
                            every card beside it out with empty space. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                          <Text selectable numberOfLines={1} style={[typeScale.caption, { minWidth: 0, flex: 1, color: palette.muted }]}>{order
                            ? copy(`${order.customer_count.toLocaleString('th-TH')} คน`, `${order.customer_count.toLocaleString('en-US')} guests`)
                            : copy(`${table.capacity.toLocaleString('th-TH')} ที่นั่ง`, `${table.capacity.toLocaleString('en-US')} seats`)}
                          </Text>
                          {reminder ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <AppIcon color={palette.info} name="time-outline" size={13} />
                              <Text selectable numberOfLines={1} style={[typeScale.caption, { color: palette.info, fontWeight: '700' }]}>{reminder}</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={{ flex: 1 }} />
                        {/* A free table ends at its seats, as on the web: no "tap
                            to open" line, which only explained the card. */}
                        {order ? (
                          <DetailedCardTotal orderNumber={order.order_number} total={money(order.grand_total, language)} />
                        ) : table.status === 'reserved' ? (
                          <Text selectable numberOfLines={1} style={[typeScale.caption, { color: tint.color, fontWeight: '700' }]}>{table.reservation_name || copy('ไม่ระบุชื่อผู้จอง', 'No guest name')}</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              );
            })}
            </ContentReveal>
          ) : loading && !tables.length ? (
            <SkeletonReveal label={copy('กำลังโหลดโต๊ะ', 'Loading tables')} style={{ gap: spacing.md }}>
              <Bone width={150} height={16} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                {Array.from({ length: 6 }, (_, index) => (
                  <Bone
                    key={index}
                    height={tabletWorkspace ? 112 : 104}
                    radius={16}
                    style={tabletWorkspace ? { flexBasis: 176, flexGrow: 1, minWidth: 164 } : { width: '48%' }}
                  />
                ))}
              </View>
            </SkeletonReveal>
          ) : null}
        </View>
      </View>
      {!loading && !groups.length && !(showTakeaways && takeaways.length) ? <EmptyState title={copy('ไม่พบโต๊ะ', 'No tables found')} detail={tables.length ? copy('ลองเปลี่ยนคำค้น', 'Try a different search.') : canManageTables ? copy('สร้างโต๊ะในหน้าจัดการโต๊ะก่อนรับออเดอร์', 'Create tables in Table management before taking orders.') : copy('ร้านนี้ยังไม่มีโต๊ะที่พร้อมรับออเดอร์', 'This restaurant has no tables ready for orders yet.')} action={canManageTables ? <Button label={copy('ไปหน้าจัดการโต๊ะ', 'Open Table management')} onPress={() => router.push('/table-management')} /> : undefined} /> : null}
    </AppScreen>
  );
}
