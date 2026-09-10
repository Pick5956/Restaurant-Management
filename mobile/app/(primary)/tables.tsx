import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { listOrders } from '@/src/api/order';
import { listTables } from '@/src/api/table';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { CompactTableTile } from '@/src/components/compact-table-tile';
import { usePrimaryTabSceneStatus } from '@/src/components/primary-tabs-runtime';
import { Button, EmptyState, Feedback, IconButton, SearchField, SectionHeader, Select } from '@/src/components/ui';
import { money, tableStatusLabel } from '@/src/lib/format';
import { can } from '@/src/lib/rbac';
import { createRequestGeneration, shouldStartRequest } from '@/src/lib/request-generation';
import { reservationReminder } from '@/src/lib/reservation-schedule';
import { tableTileStatus } from '@/src/lib/table-tile-tone';
import { canViewReservationHistory, tableEntryAction } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, statusTone, typeScale } from '@/src/theme';
import type { Order } from '@/src/types/order';
import type { RestaurantTable } from '@/src/types/table';

const activeOrderStatuses = ['open', 'sent_to_kitchen', 'cooking', 'ready', 'served'];

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
  const [error, setError] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : copy('โหลดผังโต๊ะไม่สำเร็จ', 'Could not load the table map'));
    } finally {
      if (!quiet && foregroundRequestRef.current === request) {
        foregroundRequestRef.current = null;
        if (requestGenerationRef.current.isCurrent(request)) setLoading(false);
      }
    }
  }, [copy]);
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
      const searchMatches = !keyword || [table.table_number, table.display_label, table.table_zone?.name, ...(table.tags || []).map((tag) => tag.name)].some((value) => String(value || '').toLowerCase().includes(keyword));
      return zoneMatches && searchMatches;
    }).forEach((table) => {
      const key = String(table.zone_id || 'none');
      if (!map.has(key)) map.set(key, { key, label: table.table_zone?.name || table.zone || copy('ไม่มีโซน', 'No zone'), tables: [] });
      map.get(key)?.tables.push(table);
    });
    return Array.from(map.values());
  }, [copy, search, selectedZone, tables]);
  useEffect(() => {
    if (selectedZone !== 'all' && !zones.some((zone) => zone.value === selectedZone)) setSelectedZone('all');
  }, [selectedZone, zones]);
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
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
    />,
    canTakeOrder ? <IconButton key="takeaway" accessibilityLabel={copy('ซื้อกลับบ้าน', 'Takeaway')} icon="bag-handle-outline" onPress={() => router.push({ pathname: '/order/new' as never, params: { type: 'takeaway' } } as never)} /> : null,
    // Neither glyph names this screen on its own: a bare clock reads as
    // "something about time", and the clipboard that replaced it reads as "a
    // list" without saying a list of what. The clock rides the clipboard as a
    // badge so the pair says "the list of bookings", which is what is behind it.
    canViewHistory ? <IconButton key="history" accessibilityLabel={copy('ประวัติการจองโต๊ะ', 'Reservation history')} badgeIcon="time-outline" icon="clipboard-outline" onPress={() => router.push('/reservations' as never)} /> : null,
  ].filter(Boolean);

  // The order screen's filter bar, to the letter. Pinned under the heading, one
  // row rather than two: the zone picker and a magnifier share it, and the
  // search field takes the picker's place only while it is being used. The row
  // of zone chips this replaced cost a whole line permanently, and both it and
  // the search box used to scroll away with the first zone.
  const zoneFilterBar = zones.length > 1 ? (
    <>
      {searchOpen ? (
        // No close button. Scrolling the map is what ends the search, which is
        // the gesture already being made to look at the results — a dedicated
        // dismiss control would only be in the way of the field it sits beside.
        <SearchField
          accessibilityLabel={copy('ค้นหาโต๊ะ โซน หรือแท็ก', 'Search tables, zones, or tags')}
          autoFocus
          clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
          value={search}
          onChangeText={setSearch}
          placeholder={copy('ค้นหาโต๊ะ', 'Search tables')}
        />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ minWidth: 0, flex: 1 }}>
            <Select
              value={selectedZone}
              onChange={setSelectedZone}
              options={[{ label: copy('ทุกโซน', 'All zones'), value: 'all' }, ...zones]}
            />
          </View>
          <IconButton
            accessibilityLabel={copy('ค้นหาโต๊ะ', 'Search tables')}
            icon="search-outline"
            onPress={() => setSearchOpen(true)}
          />
        </View>
      )}
    </>
  ) : (
    // With one zone there is nothing to pick, and a dropdown holding a single
    // dead option is worse than no dropdown. The row gives its width back to the
    // search field, which is then the only thing the bar is for.
    <SearchField
      accessibilityLabel={copy('ค้นหาโต๊ะ โซน หรือแท็ก', 'Search tables, zones, or tags')}
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
      topLevel
      refreshControl={<AppRefreshControl onRefresh={load} />}
      // The same pinned header the order screen uses. The table map runs several
      // zones long, and both the things you steer it with — the search and the
      // zone picker — used to scroll away with the first zone, leaving no way to
      // reach the last one except more scrolling.
      stickyHeading
      stickyContent={zoneFilterBar}
      // Scrolling the map closes the search and hands the row back to the zone
      // picker. Any typed keyword is cleared with it, so the grid can never stay
      // filtered by a search box that is no longer on screen.
      onScrollStart={() => {
        if (!searchOpen) return;
        setSearch('');
        setSearchOpen(false);
      }}
      action={headerActions.length ? <View style={{ flexDirection: 'row', gap: spacing.sm }}>{headerActions}</View> : undefined}
    >
      {error ? <Feedback title={copy('โหลดผังโต๊ะไม่ได้', 'Could not load the table map')} detail={error} tone="danger" /> : null}
      {notice ? <Feedback title={copy('ยังเปิดโต๊ะนี้ไม่ได้', 'This table cannot be opened yet')} detail={notice} tone="warning" /> : null}
      {!canTakeOrder ? <Feedback title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')} detail={copy('เลือกโหมดงานอื่นที่บัญชีนี้ได้รับอนุญาตจากเมนูด้านล่าง', 'Choose another work mode allowed for this account from the menu below.')} tone="info" /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.xl }}>
        <View style={{ minWidth: 0, flex: 1, gap: spacing.xl }}>
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
                        language={language}
                        maxWidth={tabletWorkspace ? 160 : undefined}
                        minWidth={tabletWorkspace ? 108 : 0}
                        onPress={() => open(table)}
                        status={tableTileStatus(table.status, Boolean(order))}
                        statusLabel={statusLabel}
                        upcomingReservationAt={table.upcoming_reservation_at}
                        width={tabletWorkspace ? undefined : '31%'}
                      />
                    );
                  }
                  // The detailed card, unchanged. It is the only reader of
                  // statusTone here — the compact tile carries its own map, so
                  // repainting one view could never repaint the other.
                  const tone = order ? 'warning' : table.status === 'reserved' ? 'info' : table.status === 'inactive' ? 'neutral' : 'success';
                  const tint = statusTone(tone);
                  return (
                    <Pressable
                      accessibilityLabel={accessibilityLabel}
                      accessibilityRole="button"
                      key={table.ID}
                      onPress={() => open(table)}
                      // Phones get an exact two-column grid; tablets may grow to fill a
                      // row but are capped, so one card left over on the last row keeps
                      // the size of every other card instead of spanning the workspace.
                      //
                      style={({ pressed }) => ({ width: tabletWorkspace ? undefined : '48%', minWidth: tabletWorkspace ? 164 : 0, maxWidth: tabletWorkspace ? 260 : undefined, minHeight: 148, flexGrow: tabletWorkspace ? 1 : 0, flexBasis: tabletWorkspace ? 176 : 'auto', gap: spacing.sm, borderWidth: 1, borderColor: tint.backgroundColor, borderRadius: radius.md, backgroundColor: tint.backgroundColor, padding: spacing.md, opacity: pressed ? 0.72 : 1, transform: [{ translateY: pressed ? 1 : 0 }] })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Text selectable numberOfLines={1} style={{ minWidth: 0, flex: 1, color: tint.color, fontSize: 23, fontWeight: '800', lineHeight: 30 }}>{table.display_label || table.table_number}</Text>
                        <AppIcon color={palette.text} name="chevron-forward" size={19} />
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <View style={{ width: 8, height: 8, borderRadius: radius.full, backgroundColor: tint.color }} />
                        <Text selectable numberOfLines={1} style={[typeScale.caption, { minWidth: 0, flex: 1, color: tint.color, fontWeight: '700' }]}>{statusLabel}</Text>
                      </View>
                      {/* The booking shares the seats line rather than taking one
                          of its own. A line of its own grew the card, and because
                          a wrapped row stretches to its tallest tile that pushed
                          every card beside it out with empty space. Tags give way
                          to it: a table someone is coming for outranks decoration. */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Text selectable numberOfLines={1} style={[typeScale.caption, { minWidth: 0, flex: 1, color: palette.muted }]}>{order
                          ? copy(`${order.customer_count.toLocaleString('th-TH')} คน`, `${order.customer_count.toLocaleString('en-US')} guests`)
                          : copy(`${table.capacity.toLocaleString('th-TH')} ที่นั่ง`, `${table.capacity.toLocaleString('en-US')} seats`)}
                        {!reminder && table.tags?.length ? ` · ${table.tags.map((tag) => tag.name).join(', ')}` : ''}</Text>
                        {reminder ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <AppIcon color={palette.info} name="time-outline" size={13} />
                            <Text selectable numberOfLines={1} style={[typeScale.caption, { color: palette.info, fontWeight: '700' }]}>{reminder}</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flex: 1 }} />
                      {order ? (
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                          <Text selectable style={[typeScale.caption, { flex: 1, color: palette.muted }]}>{order.order_number}</Text>
                          <Text selectable style={typeScale.number}>{money(order.grand_total, language)}</Text>
                        </View>
                      ) : table.status === 'reserved' ? (
                        <Text selectable numberOfLines={1} style={[typeScale.caption, { color: tint.color, fontWeight: '700' }]}>{table.reservation_name || copy('ไม่ระบุชื่อผู้จอง', 'No guest name')}</Text>
                      ) : (
                        <Text selectable numberOfLines={1} style={[typeScale.caption, { color: table.status === 'inactive' ? palette.muted : tint.color, fontWeight: '600' }]}>{table.status === 'inactive' ? copy('ปิดใช้งาน', 'Inactive') : copy('แตะเพื่อเปิดออเดอร์', 'Tap to open')}</Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
            );
          })}
        </View>
      </View>
      {!loading && !groups.length ? <EmptyState title={copy('ไม่พบโต๊ะ', 'No tables found')} detail={tables.length ? copy('ลองเปลี่ยนคำค้น', 'Try a different search.') : canManageTables ? copy('สร้างโต๊ะในหน้าจัดการโต๊ะก่อนรับออเดอร์', 'Create tables in Table management before taking orders.') : copy('ร้านนี้ยังไม่มีโต๊ะที่พร้อมรับออเดอร์', 'This restaurant has no tables ready for orders yet.')} action={canManageTables ? <Button label={copy('ไปหน้าจัดการโต๊ะ', 'Open Table management')} onPress={() => router.push('/table-management')} /> : undefined} /> : null}
    </AppScreen>
  );
}
