import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import {
  listOrders,
  type OrderListResponse,
} from '@/src/api/order';
import { AppRefreshControl, AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import { ArchiveCompactRow, ArchiveDayButton, ArchiveDaySheet, ArchiveList, ArchiveSkeleton } from '@/src/components/order-archive';
import { usePrimaryTabSceneStatus } from '@/src/components/primary-tabs-runtime';
import { ContentReveal } from '@/src/components/skeleton';
import {
  Button,
  EdgeSection,
  EmptyState,
  Feedback,
  SearchField,
} from '@/src/components/ui';
import { archiveDateLabel, groupArchiveByDay } from '@/src/lib/order-archive';
import { formatBangkokDate } from '@/src/lib/order-query';
import { orderArchiveFailureDetail, orderListAccess, orderListRequest } from '@/src/lib/permission-parity';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { spacing } from '@/src/theme';
import type { Order } from '@/src/types/order';

// The archive (design C, 17 ก.ย. 2569): search, one day control, then a plain
// list led by the order number. A row opens its bill, where reprinting lives.

const PAGE_SIZE = 25;

function mergeOrderPages(current: Order[], next: Order[]) {
  const byId = new Map(current.map((order) => [order.ID, order]));
  next.forEach((order) => byId.set(order.ID, order));
  return Array.from(byId.values());
}

export default function OrdersScreen() {
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const canViewOrders = can(activeMembership, 'view_orders');
  // view_orders alone: the server refuses take_order the paid list this screen asks for.
  const access = orderListAccess(canViewOrders);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [date, setDate] = useState<string | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [pagination, setPagination] = useState<OrderListResponse['pagination']>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // A failed load: the app's own line under the title, or none.
  const [failure, setFailure] = useState<{ detail?: string } | null>(null);
  const requestIdRef = useRef(0);
  const adjacentWarmRequestedRef = useRef(false);
  const scrollControlRef = useRef<AppScreenScrollControl | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();
  const today = formatBangkokDate();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    requestIdRef.current += 1;
    setOrders([]);
    setPagination(undefined);
  }, [access]);

  const load = useCallback(async (page = 1, append = false) => {
    const requestId = ++requestIdRef.current;
    const request = orderListRequest(access, {
      search: debouncedSearch,
      date,
      page,
      limit: PAGE_SIZE,
    });
    if (!request) {
      setLoading(false);
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    setFailure(null);
    try {
      const response = await listOrders(request);
      if (requestId !== requestIdRef.current) return;
      setOrders((current) => append
        ? mergeOrderPages(current, response.orders || [])
        : response.orders || []);
      setPagination(response.pagination);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      // The app's words, never the server's.
      setFailure({ detail: orderArchiveFailureDetail(err, language) });
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [access, date, debouncedSearch, language]);

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
    return () => {
      requestIdRef.current += 1;
      setLoading(false);
      setLoadingMore(false);
    };
  }, [load]));

  const totalCount = pagination?.total ?? orders.length;
  const days = useMemo(() => groupArchiveByDay(orders), [orders]);
  if (access === 'denied') {
    return <AppScreen title={copy('ออเดอร์', 'Orders')}><EmptyState title={copy('ไม่มีสิทธิ์ดูคลังออเดอร์', 'No permission to view the order archive')} /></AppScreen>;
  }

  const dayLabel = archiveDateLabel(date, language);
  const dayAccessibilityLabel = copy(`วันที่แสดง ${dayLabel} แตะเพื่อเปลี่ยน`, `Showing ${dayLabel}, tap to change`);
  // Another day replaces the list, so the reader starts it from its top - the
  // compact row's day control opens this same sheet from deep in the list. A
  // jump, as the menu and staff rows do: the new day can answer while an
  // animated scroll is still on its way up, and a shorter list landing then
  // looks stranded to the shell, which sends the page to its end instead.
  const applyDay = (next: string | null) => {
    if (next !== date) scrollControlRef.current?.scrollTo(0, false);
    setDate(next);
  };
  // The compact row's search goes back to the page's own field. A jump, not an
  // animation, so the caret lands in a field that is already where it rests.
  const searchFromTop = () => {
    scrollControlRef.current?.scrollTo(0, false);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  return (
    <AppScreen
      title={copy('คลังออเดอร์', 'Order archive')}
      refreshControl={<AppRefreshControl onRefresh={() => load()} />}
      scrollControlRef={scrollControlRef}
      compactRow={(
        <ArchiveCompactRow
          dayLabel={dayLabel}
          dayAccessibilityLabel={dayAccessibilityLabel}
          onDayPress={() => setDayOpen(true)}
          searchLabel={copy('ค้นหาออเดอร์', 'Search orders')}
          onSearchPress={searchFromTop}
        />
      )}
    >
      <View style={{ gap: spacing.md }}>
        {failure ? <Feedback title={copy('โหลดคลังออเดอร์ไม่ได้', 'Could not load the order archive')} detail={failure.detail} tone="danger" /> : null}
        {/* Search and the day control share one row, so neither sits alone on a line. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SearchField
              accessibilityLabel={copy('ค้นหาเลขออเดอร์ โต๊ะ โซน หรือลูกค้า', 'Search order, table, zone, or customer')}
              clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
              glass
              inputRef={searchInputRef}
              value={search}
              onChangeText={setSearch}
              placeholder={copy('ค้นหาออเดอร์', 'Search orders')}
            />
          </View>
          <ArchiveDayButton
            label={dayLabel}
            accessibilityLabel={dayAccessibilityLabel}
            onPress={() => setDayOpen(true)}
          />
        </View>

        {days.length ? (
          <ContentReveal>
            <EdgeSection>
              <ArchiveList
                days={days}
                today={today}
                language={language}
                copy={copy}
                onOpen={(order) => router.push({ pathname: '/order/bill' as never, params: { id: String(order.ID) } } as never)}
              />
            </EdgeSection>
          </ContentReveal>
        ) : loading && !failure ? (
          <ArchiveSkeleton label={copy('กำลังโหลดออเดอร์', 'Loading orders')} />
        ) : null}

        {pagination?.has_more ? (
          <Button
            variant="secondary"
            label={copy('โหลดออเดอร์เพิ่มเติม', 'Load more orders')}
            onPress={() => load((pagination.page || 1) + 1, true)}
            loading={loadingMore}
          />
        ) : null}

        {!loading && !orders.length ? (
          <EmptyState
            title={copy('ไม่พบออเดอร์', 'No orders found')}
            detail={debouncedSearch
              ? copy('ลองเปลี่ยนคำค้นหา', 'Try another search.')
              : date
                ? copy('ลองเลือกวันอื่น', 'Try another day.')
                : copy('ออเดอร์จะเข้ามาที่นี่หลังรับชำระเงินแล้ว', 'Orders arrive here once they have been paid.')}
          />
        ) : null}
      </View>

      <ArchiveDaySheet
        open={dayOpen}
        onClose={() => setDayOpen(false)}
        date={date}
        today={today}
        onApply={applyDay}
        language={language}
      />
    </AppScreen>
  );
}
