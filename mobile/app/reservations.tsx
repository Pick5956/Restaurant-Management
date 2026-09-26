import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LayoutAnimation, useWindowDimensions, View } from 'react-native';

import { createOrder } from '@/src/api/order';
import { listReservations, resolveReservation } from '@/src/api/reservation';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { RetryPill } from '@/src/components/hub/stage-tiles';
import { useReducedMotion } from '@/src/components/motion';
import { ReservationDayCard, ReservationDayHeader, ReservationRow } from '@/src/components/reservations/reservation-day';
import { ReservationFilterBar } from '@/src/components/reservations/reservation-filter-bar';
import { ReservationListSkeleton } from '@/src/components/reservations/reservation-list-skeleton';
import { ContentReveal } from '@/src/components/skeleton';
import { ReservationSummary } from '@/src/components/reservations/reservation-row-summary';
import { ReservationStatusChip } from '@/src/components/reservations/reservation-status-chip';
import { Button, EmptyState } from '@/src/components/ui';
import { loadFilteredReplacement } from '@/src/lib/filter-reload';
import { can } from '@/src/lib/rbac';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { reservationFailure, reservationLoadFailureLine } from '@/src/lib/reservation-error';
import {
  bangkokClock,
  bangkokDayKey,
  groupReservationsByDay,
  mergeReservationPage,
  reservationClosedLine,
  reservationCreatedLine,
  reservationDayLabel,
  reservationGuestParts,
  reservationMoment,
  reservationReloadLimit,
  reservationTableTitle,
  type ReservationFilter,
} from '@/src/lib/reservation-history';
import { canViewReservationHistory, reservationArrivalOrderInput } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, spacing } from '@/src/theme';
import type {
  Reservation,
  ReservationStatus,
} from '@/src/types/reservation';

const pageSize = 50;

/** Above this many rows a list change lands without animating: it would stutter. */
const ANIMATE_MAX_ROWS = 60;

/**
 * Below this width a phone row's two buttons take the row's full width instead
 * of sitting under the text: at 320dp the text column would leave each button
 * too narrow for "รับลูกค้าแล้ว" on one line.
 */
const INDENT_ACTIONS_MIN_WIDTH = 360;

/** The tablet's action column: two buttons side by side at the end of the row. */
const TABLET_ACTIONS_WIDTH = 288;

const NO_ROWS: Reservation[] = [];

type RowAction = 'seat' | 'cancel';

// The history of every booking, read a day at a time (redrawn 23 ก.ย. 2569).
// Each row leads with the booking's own time - when the guests come, or when a
// held table was held - then the table, then who is coming. A booking for later
// also says when it was taken, as its last line. Rows sit in one card per day;
// statuses are words on their own tint, never a dot.

export default function ReservationsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();
  const canView = canViewReservationHistory(
    can(activeMembership, 'view_tables'),
    can(activeMembership, 'manage_table'),
    can(activeMembership, 'take_order'),
  );
  const [filter, setFilter] = useState<ReservationFilter>('all');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // The filter the rows were loaded for. Rows show only under that filter, so a
  // newly chosen one never flashes the previous one's bookings for a frame.
  const [rowsFilter, setRowsFilter] = useState<ReservationFilter | null>(null);
  const [counts, setCounts] = useState<Partial<Record<ReservationStatus, number>>>({});
  const [countsReady, setCountsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  // Kept raw and put into words at render; the server's own wording never shows.
  const [loadFailure, setLoadFailure] = useState<{ error: unknown } | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolvingAction, setResolvingAction] = useState<RowAction | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const requestGenerationRef = useRef(createRequestGeneration());
  // Read synchronously by every action, so two taps in the same frame cannot
  // both start one.
  const resolvingRef = useRef<number | null>(null);
  // What a reload needs to know about the rows on screen without re-creating
  // load() every time they change.
  const shownRef = useRef<{ filter: ReservationFilter | null; count: number }>({ filter: null, count: 0 });
  const animateNextLoadRef = useRef(false);
  const canResolve = can(activeMembership, 'manage_table') || can(activeMembership, 'take_order');
  const canTakeOrder = can(activeMembership, 'take_order');

  const showRows = useCallback((rows: Reservation[], forFilter: ReservationFilter) => {
    shownRef.current = { filter: forFilter, count: rows.length };
    setReservations(rows);
    setRowsFilter(forFilter);
  }, []);

  const load = useCallback(async () => {
    if (!canView) {
      requestGenerationRef.current.invalidate();
      setReservations([]);
      setCounts({});
      setLoading(false);
      return;
    }
    const request = requestGenerationRef.current.begin();
    // Reloading the same filter - after an action, a pull, coming back to the
    // screen - keeps its rows up while the fresh ones load, so the list neither
    // blanks nor jumps to the top. Another filter's rows are dropped at once.
    const sameFilter = shownRef.current.filter === filter;
    setLoading(true);
    setLoadFailure(null);
    setConfirmCancelId(null);
    if (!sameFilter) {
      setReservations([]);
      setHasMore(false);
    }
    const result = await loadFilteredReplacement(() => listReservations({
        status: filter === 'all' ? '' : filter,
        limit: reservationReloadLimit(sameFilter ? shownRef.current.count : 0, pageSize),
      }));
    if (!requestGenerationRef.current.isCurrent(request)) return;
    const animate = animateNextLoadRef.current;
    animateNextLoadRef.current = false;
    if (result.ok) {
      const response = result.data;
      const rows = response.reservations || [];
      if (animate && rows.length <= ANIMATE_MAX_ROWS) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      showRows(rows, filter);
      // The counts do not depend on the filter, so they are only ever replaced,
      // never zeroed while a reload is out.
      setCounts(response.counts || {});
      setCountsReady(true);
      setHasMore(Boolean(response.has_more) && rows.length > 0);
      setNextOffset(response.next_offset || rows.length);
    } else {
      // No stale rows and no stale counts after a failed reload.
      showRows([], filter);
      setCounts({});
      setCountsReady(false);
      setHasMore(false);
      setLoadFailure({ error: result.error });
    }
    setLoading(false);
  }, [canView, filter, showRows]);

  // The load() of the filter on screen now. An action awaits its API call with
  // the filter bar still live; reloading through its own closure would fetch
  // the filter it started under, win the request generation over the new
  // filter's load, and leave the new filter on its skeleton for good.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const reload = useCallback(() => loadRef.current(), []);

  // The next page of the same filter. It shares the list's request generation:
  // a reload that starts meanwhile wins, and this page is dropped.
  const loadMore = useCallback(async () => {
    if (!canView || loading || loadingMore || !hasMore || rowsFilter !== filter) return;
    const request = requestGenerationRef.current.begin();
    setLoadingMore(true);
    try {
      const result = await loadFilteredReplacement(() => listReservations({
        status: filter === 'all' ? '' : filter,
        limit: pageSize,
        offset: nextOffset,
      }));
      if (!requestGenerationRef.current.isCurrent(request)) return;
      if (result.ok) {
        const response = result.data;
        const page = response.reservations || [];
        showRows(mergeReservationPage(reservations, page), filter);
        if (response.counts) setCounts(response.counts);
        setHasMore(Boolean(response.has_more) && page.length > 0);
        setNextOffset(response.next_offset || nextOffset + page.length);
      } else {
        const failure = reservationFailure(result.error, 'load_more', language);
        showToast({ tone: 'error', title: failure.title, message: failure.message });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [canView, filter, hasMore, language, loading, loadingMore, nextOffset, reservations, rowsFilter, showRows, showToast]);

  const markResolving = useCallback((id: number | null, action: RowAction | null) => {
    resolvingRef.current = id;
    setResolvingId(id);
    setResolvingAction(action);
  }, []);

  // The only way to close a booking that never held its table. Without it a
  // scheduled reservation stays `active` for ever, whether the guests came or
  // not, and the list fills with rows nobody can act on.
  const resolve = useCallback(async (reservation: Reservation, status: 'seated' | 'cancelled') => {
    // One booking at a time, as on the web: a tap while another is in flight is dropped.
    if (resolvingRef.current !== null) return;
    markResolving(reservation.ID, status === 'cancelled' ? 'cancel' : 'seat');
    setConfirmCancelId(null);
    try {
      await resolveReservation(reservation.ID, status);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      animateNextLoadRef.current = !reducedMotion;
      await reload();
    } catch (err) {
      const failure = reservationFailure(err, status === 'cancelled' ? 'cancel' : 'arrive', language);
      showToast({ tone: 'error', title: failure.title, message: failure.message });
      if (failure.reload) void reload();
    } finally {
      markResolving(null, null);
    }
  }, [language, markResolving, reducedMotion, reload, showToast]);

  // A cancel cannot be undone, and on a held table it frees the table, so the
  // first tap asks and the second closes - as the web history and the
  // reservation screen both do. The API takes no reason, so none is asked for.
  const requestCancel = useCallback((reservation: Reservation) => {
    if (resolvingRef.current !== null) return;
    if (confirmCancelId !== reservation.ID) {
      void Haptics.selectionAsync().catch(() => undefined);
      setConfirmCancelId(reservation.ID);
      return;
    }
    void resolve(reservation, 'cancelled');
  }, [confirmCancelId, resolve]);

  // A booking holding its table right now is seated by opening the order on it,
  // exactly as the reservation screen does: the server marks the booking seated
  // and the table in use. Resolving it as seated instead freed the table under
  // the guests who had just sat down (audit, 2026-09-23). A booking for later
  // never held its table, so closing its record is still all it needs.
  const seat = useCallback(async (reservation: Reservation) => {
    if (reservation.reserved_for) {
      await resolve(reservation, 'seated');
      return;
    }
    if (!canTakeOrder) return;
    if (resolvingRef.current !== null) return;
    markResolving(reservation.ID, 'seat');
    setConfirmCancelId(null);
    try {
      const order = await createOrder(reservationArrivalOrderInput(reservation.table_id, {
        customerCount: reservation.guest_count ?? 1,
        customerName: reservation.name,
        customerPhone: reservation.phone,
      }));
      router.push({ pathname: '/order/[id]', params: { id: String(order.ID) } });
    } catch (err) {
      const failure = reservationFailure(err, 'seat_hold', language);
      showToast({ tone: 'error', title: failure.title, message: failure.message });
      if (failure.reload) void reload();
    } finally {
      markResolving(null, null);
    }
  }, [canTakeOrder, language, markResolving, reload, resolve, showToast]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      requestGenerationRef.current.invalidate();
    };
  }, [load]));

  const chooseFilter = useCallback((next: ReservationFilter) => {
    setConfirmCancelId(null);
    setFilter(next);
  }, []);

  const current = rowsFilter === filter;
  const visibleRows = current ? reservations : NO_ROWS;
  const days = useMemo(() => groupReservationsByDay(visibleRows, filter), [visibleRows, filter]);

  if (!canView) {
    return (
      <AppScreen title={copy('ประวัติการจองโต๊ะ', 'Reservation history')} centerTitle topLevel={false}>
        <EmptyState title={copy('ไม่มีสิทธิ์ดูประวัติการจอง', 'No permission to view reservations')} />
      </AppScreen>
    );
  }

  const tabletLayout = width >= breakpoints.tablet;
  const indentActions = width >= INDENT_ACTIONS_MIN_WIDTH;
  const today = bangkokDayKey(new Date());
  // Waiting on rows: a load is out, or the filter just changed and its load has
  // not started yet.
  const pending = loading || !current;
  const anyResolving = resolvingId !== null;
  const missingClock = copy('ไม่ระบุเวลา', 'No time');

  const renderRow = (reservation: Reservation, index: number) => {
    const actionable = reservation.status === 'active' && canResolve;
    const confirming = confirmCancelId === reservation.ID;
    const acting = resolvingId === reservation.ID;
    const canSeat = Boolean(reservation.reserved_for) || canTakeOrder;
    const guest = reservationGuestParts(reservation, language);
    const summary = {
      clock: bangkokClock(reservationMoment(reservation)),
      missingClock,
      title: reservationTableTitle(reservation, language),
      name: guest.name,
      detail: guest.rest,
    };
    // While a cancel is being confirmed, the other button steps back out of it.
    const keepButton = (
      <Button
        compact
        disabled={anyResolving}
        label={copy('เก็บไว้', 'Keep')}
        onPress={() => setConfirmCancelId(null)}
        style={{ flex: 1 }}
        variant="secondary"
      />
    );
    const cancelButton = (
      <Button
        compact
        disabled={anyResolving}
        label={confirming ? copy('ยืนยันยกเลิก', 'Confirm cancel') : copy('ยกเลิก', 'Cancel')}
        loading={acting && resolvingAction === 'cancel'}
        onPress={() => requestCancel(reservation)}
        style={{ flex: 1 }}
        variant={confirming ? 'danger' : canSeat ? 'ghost' : 'secondary'}
      />
    );

    if (tabletLayout) {
      const caption = [
        reservationCreatedLine(reservation, today, language),
        reservationClosedLine(reservation, today, language),
      ].filter(Boolean).join(', ');
      return (
        <ReservationRow first={index === 0} key={reservation.ID}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
            <ReservationSummary
              {...summary}
              caption={caption || null}
              style={{ flex: 1, minWidth: 0 }}
              trailing={<ReservationStatusChip language={language} status={reservation.status} />}
            />
            {actionable ? (
              <View style={{ width: TABLET_ACTIONS_WIDTH, flexDirection: 'row', gap: spacing.sm }}>
                {confirming ? keepButton : canSeat ? (
                  <Button
                    compact
                    disabled={anyResolving}
                    label={copy('รับลูกค้าแล้ว', 'Guests arrived')}
                    loading={acting && resolvingAction === 'seat'}
                    onPress={() => { void seat(reservation); }}
                    style={{ flex: 1 }}
                    variant="secondary"
                  />
                ) : null}
                {cancelButton}
              </View>
            ) : null}
          </View>
        </ReservationRow>
      );
    }

    const phoneActions = actionable ? (
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {confirming ? keepButton : canSeat ? (
          <Button
            compact
            disabled={anyResolving}
            label={copy('รับลูกค้าแล้ว', 'Guests arrived')}
            loading={acting && resolvingAction === 'seat'}
            onPress={() => { void seat(reservation); }}
            style={{ flex: 1 }}
            variant="secondary"
          />
        ) : null}
        {cancelButton}
      </View>
    ) : null;
    return (
      <ReservationRow first={index === 0} key={reservation.ID}>
        <ReservationSummary
          {...summary}
          caption={reservationCreatedLine(reservation, today, language)}
          footer={indentActions ? phoneActions : null}
          // An open booking shows what can be done with it; a closed one, what
          // became of it.
          trailing={actionable ? null : <ReservationStatusChip language={language} status={reservation.status} />}
        />
        {phoneActions && !indentActions ? <View style={{ marginTop: spacing.sm }}>{phoneActions}</View> : null}
      </ReservationRow>
    );
  };

  let body: ReactNode;
  if (loadFailure && !pending) {
    body = (
      <EmptyState
        title={reservationLoadFailureLine(loadFailure.error, language)}
        action={<RetryPill onPress={() => { void load(); }} />}
      />
    );
  } else if (!visibleRows.length && pending) {
    body = <ReservationListSkeleton label={copy('กำลังโหลดประวัติการจอง', 'Loading reservation history')} />;
  } else if (!visibleRows.length) {
    body = (
      <EmptyState
        title={filter === 'all'
          ? copy('ยังไม่มีการจอง', 'No reservations yet')
          : copy('ไม่มีรายการในสถานะนี้', 'Nothing in this status')}
      />
    );
  } else {
    body = (
      <ContentReveal style={{ gap: spacing.xl }}>
        {days.map((day) => (
          <View key={day.date || 'no-date'} style={{ gap: spacing.sm }}>
            <ReservationDayHeader label={reservationDayLabel(day.date, today, language)} />
            <ReservationDayCard>
              {day.reservations.map(renderRow)}
            </ReservationDayCard>
          </View>
        ))}
        {hasMore ? (
          <Button
            disabled={loading}
            label={copy('โหลดการจองเพิ่มเติม', 'Load more bookings')}
            loading={loadingMore}
            onPress={() => { void loadMore(); }}
            variant="secondary"
          />
        ) : null}
      </ContentReveal>
    );
  }

  return (
    <AppScreen
      title={copy('ประวัติการจองโต๊ะ', 'Reservation history')}
      centerTitle
      topLevel={false}
      // A list read row by row does not need the tablet's full 1180.
      contentMaxWidth={tabletLayout ? 960 : undefined}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      // The list runs to every booking the restaurant has ever taken, so the
      // filter that decides what is in it has to stay reachable from the bottom
      // of it.
      stickyHeading
      stickyContent={(
        <ReservationFilterBar
          counts={countsReady ? counts : null}
          countsLoading={!countsReady && loading}
          language={language}
          onChange={chooseFilter}
          value={filter}
        />
      )}
    >
      {body}
    </AppScreen>
  );
}
