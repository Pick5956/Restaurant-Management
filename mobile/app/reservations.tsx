import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { listReservations, resolveReservation } from '@/src/api/reservation';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import {
  Button,
  ChipGroup,
  EdgeRow,
  EdgeSection,
  EmptyState,
  Feedback,
  StatusBadge,
  Surface,
} from '@/src/components/ui';
import { loadFilteredReplacement } from '@/src/lib/filter-reload';
import { can } from '@/src/lib/rbac';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { canViewReservationHistory } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type {
  Reservation,
  ReservationStatus,
} from '@/src/types/reservation';

type ReservationFilter = 'all' | ReservationStatus;

const pageSize = 50;

function formatDateTime(value: string | null | undefined, language: 'th' | 'en') {
  if (!value) return '−';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '−';
  return date.toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReservationsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const canView = canViewReservationHistory(
    can(activeMembership, 'view_tables'),
    can(activeMembership, 'manage_table'),
    can(activeMembership, 'take_order'),
  );
  const [filter, setFilter] = useState<ReservationFilter>('all');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [counts, setCounts] = useState<Partial<Record<ReservationStatus, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const requestGenerationRef = useRef(createRequestGeneration());
  const canResolve = can(activeMembership, 'manage_table') || can(activeMembership, 'take_order');

  const load = useCallback(async () => {
    if (!canView) {
      requestGenerationRef.current.invalidate();
      setReservations([]);
      setCounts({});
      setLoading(false);
      return;
    }
    const request = requestGenerationRef.current.begin();
    setLoading(true);
    setError(null);
    setReservations([]);
    setCounts({});
    const result = await loadFilteredReplacement(() => listReservations({
        status: filter === 'all' ? '' : filter,
        limit: pageSize,
      }));
    if (!requestGenerationRef.current.isCurrent(request)) return;
    if (result.ok) {
      const response = result.data;
      setReservations(response.reservations || []);
      setCounts(response.counts || {});
    } else {
      setReservations([]);
      setCounts({});
      setError(result.error instanceof Error
        ? result.error.message
        : copy('โหลดประวัติการจองไม่สำเร็จ', 'Could not load reservation history'));
    }
    setLoading(false);
  }, [canView, copy, filter]);

  // The only way to close a booking that never held its table. Without it a
  // scheduled reservation stays `active` for ever, whether the guests came or
  // not, and the list fills with rows nobody can act on.
  const resolve = useCallback(async (reservation: Reservation, status: 'seated' | 'cancelled') => {
    setResolvingId(reservation.ID);
    setError(null);
    try {
      await resolveReservation(reservation.ID, status);
      await load();
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : copy('ปิดรายการจองไม่สำเร็จ', 'Could not close the reservation'));
    } finally {
      setResolvingId(null);
    }
  }, [copy, load]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      requestGenerationRef.current.invalidate();
    };
  }, [load]));

  if (!canView) {
    return (
      <AppScreen title={copy('ประวัติการจองโต๊ะ', 'Reservation history')} centerTitle topLevel={false}>
        <EmptyState
          title={copy('ไม่มีสิทธิ์ดูประวัติการจอง', 'No permission to view reservations')}
          detail={copy(
            'ต้องมีสิทธิ์ดูโต๊ะ จัดการโต๊ะ หรือรับออเดอร์',
            'Table viewing, table management, or order-taking permission is required.',
          )}
        />
      </AppScreen>
    );
  }

  const statusCopy: Record<ReservationStatus, string> = {
    active: copy('กำลังจอง', 'Active'),
    seated: copy('รับลูกค้าแล้ว', 'Seated'),
    cancelled: copy('ยกเลิก / ไม่มา', 'Cancelled / no-show'),
  };
  const statusTone: Record<ReservationStatus, 'info' | 'success' | 'danger'> = {
    active: 'info',
    seated: 'success',
    cancelled: 'danger',
  };
  const totalCount = (counts.active || 0) + (counts.seated || 0) + (counts.cancelled || 0);
  const filterOptions: Array<{ label: string; value: ReservationFilter }> = [
    { label: copy(`ทั้งหมด ${totalCount.toLocaleString('th-TH')}`, `All ${totalCount.toLocaleString('en-US')}`), value: 'all' },
    { label: copy(`กำลังจอง ${(counts.active || 0).toLocaleString('th-TH')}`, `Active ${(counts.active || 0).toLocaleString('en-US')}`), value: 'active' },
    { label: copy(`รับแล้ว ${(counts.seated || 0).toLocaleString('th-TH')}`, `Seated ${(counts.seated || 0).toLocaleString('en-US')}`), value: 'seated' },
    { label: copy(`ยกเลิก ${(counts.cancelled || 0).toLocaleString('th-TH')}`, `Cancelled ${(counts.cancelled || 0).toLocaleString('en-US')}`), value: 'cancelled' },
  ];
  const tabletLayout = width >= breakpoints.tablet;

  return (
    <AppScreen
      title={copy('ประวัติการจองโต๊ะ', 'Reservation history')}
      centerTitle
      topLevel={false}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      // The list runs to every booking the restaurant has ever taken, so the
      // filter that decides what is in it has to stay reachable from the bottom
      // of it.
      stickyHeading
      stickyContent={<ChipGroup value={filter} onChange={setFilter} options={filterOptions} scrollable />}
    >
      {error ? (
        <Feedback
          title={copy('โหลดประวัติการจองไม่ได้', 'Could not load reservation history')}
          detail={error}
          tone="danger"
        />
      ) : null}
      {tabletLayout ? (
        <Surface>
          {loading && !reservations.length ? (
            <EmptyState title={copy('กำลังโหลดประวัติการจอง', 'Loading reservation history')} />
          ) : reservations.length ? (
            <View>
              {reservations.map((reservation, index) => (
                <View
                  key={reservation.ID}
                  style={{
                    gap: spacing.sm,
                    borderTopWidth: index ? 1 : 0,
                    borderTopColor: palette.border,
                    paddingVertical: spacing.lg,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                    <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: palette.surfaceSubtle }}>
                      <AppIcon color={palette.text} name="calendar-outline" size={20} />
                    </View>
                    <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                      <Text selectable style={typeScale.cardTitle}>
                        {reservation.table_label
                          || reservation.table?.display_label
                          || reservation.table?.table_number
                          || copy('ไม่ระบุโต๊ะ', 'Unknown table')}
                      </Text>
                      <Text selectable style={[typeScale.body, { color: palette.text }]}>
                        {reservation.name || copy('ไม่ระบุชื่อ', 'No guest name')}
                      </Text>
                    </View>
                    <StatusBadge label={statusCopy[reservation.status]} tone={statusTone[reservation.status]} />
                  </View>
                  <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                    {copy('เบอร์โทร', 'Phone')}: {reservation.phone || '−'}
                    {reservation.guest_count ? ` · ${copy(`${reservation.guest_count} คน`, `${reservation.guest_count} guests`)}` : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
                    {/* Only booked-for-later reservations carry a time. A hold
                        has none by design, and printing an empty field for it
                        would read as missing data rather than a different kind
                        of booking. */}
                    {reservation.reserved_for ? (
                      <View style={{ minWidth: 130, flex: 1, gap: 2 }}>
                        <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                          {copy('นัดเวลา', 'Arriving')}
                        </Text>
                        <Text selectable style={[typeScale.caption, { fontWeight: '700' }]}>
                          {formatDateTime(reservation.reserved_for, language)}
                        </Text>
                      </View>
                    ) : null}
                    <View style={{ minWidth: 130, flex: 1, gap: 2 }}>
                      <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                        {copy('จองเมื่อ', 'Reserved at')}
                      </Text>
                      <Text selectable style={typeScale.caption}>
                        {formatDateTime(reservation.CreatedAt, language)}
                      </Text>
                    </View>
                    <View style={{ minWidth: 130, flex: 1, gap: 2 }}>
                      <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                        {copy('ปิดรายการเมื่อ', 'Closed at')}
                      </Text>
                      <Text selectable style={typeScale.caption}>
                        {formatDateTime(reservation.resolved_at, language)}
                      </Text>
                    </View>
                  </View>
                  {reservation.status === 'active' && canResolve ? (
                    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                      <Button
                        compact
                        label={copy('รับลูกค้าแล้ว', 'Guests arrived')}
                        onPress={() => { void resolve(reservation, 'seated'); }}
                        loading={resolvingId === reservation.ID}
                        style={{ flex: 1 }}
                        variant="secondary"
                      />
                      <Button
                        compact
                        label={copy('ยกเลิก', 'Cancel')}
                        onPress={() => { void resolve(reservation, 'cancelled'); }}
                        loading={resolvingId === reservation.ID}
                        style={{ flex: 1 }}
                        variant="secondary"
                      />
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              title={copy('ยังไม่มีประวัติในสถานะนี้', 'No reservations in this status')}
              detail={copy('รายการใหม่จะปรากฏหลังมีการจองโต๊ะ', 'New entries appear after a table is reserved.')}
            />
          )}
        </Surface>
      ) : (
        <View style={{ gap: spacing.md }}>
          <EdgeSection>
            {loading && !reservations.length ? (
              <View style={{ paddingHorizontal: spacing.lg }}>
                <EmptyState title={copy('กำลังโหลดประวัติการจอง', 'Loading reservation history')} />
              </View>
            ) : reservations.length ? reservations.map((reservation) => {
              const tableLabel = reservation.table_label
                || reservation.table?.display_label
                || reservation.table?.table_number
                || copy('ไม่ระบุโต๊ะ', 'Unknown table');
              const guestName = reservation.name || copy('ไม่ระบุชื่อ', 'No guest name');
              const detail = [
                `${guestName} · ${copy('เบอร์โทร', 'Phone')}: ${reservation.phone || '−'}${reservation.guest_count ? ` · ${copy(`${reservation.guest_count} คน`, `${reservation.guest_count} guests`)}` : ''}`,
                // Only a scheduled booking has a time to arrive at; a hold does not.
                ...(reservation.reserved_for
                  ? [`${copy('นัดเวลา', 'Arriving')}: ${formatDateTime(reservation.reserved_for, language)}`]
                  : []),
                `${copy('จองเมื่อ', 'Reserved at')}: ${formatDateTime(reservation.CreatedAt, language)}`,
                `${copy('ปิดรายการเมื่อ', 'Closed at')}: ${formatDateTime(reservation.resolved_at, language)}`,
              ].join('\n');
              const isActive = reservation.status === 'active' && canResolve;

              return (
                <EdgeRow
                  key={reservation.ID}
                  title={tableLabel}
                  detail={detail}
                  icon="calendar-outline"
                  style={{ minHeight: 104 }}
                  // Stacked, not side by side. `EdgeRow`'s trailing slot has no
                  // flex, so it never shrinks and the title/detail column absorbs
                  // every pixel it takes. Two Thai labels in a row came to about
                  // 180dp of a 360dp phone, which left the booking's own name,
                  // phone and arrival time as a ~90dp ribbon of ellipsis — the
                  // details the staff member needs in order to know which booking
                  // they are about to accept. Stacking halves the width and still
                  // fits the row's 104dp height.
                  trailing={isActive ? (
                    <View style={{ alignItems: 'stretch', gap: spacing.sm }}>
                      <Button
                        compact
                        label={copy('รับลูกค้าแล้ว', 'Guests arrived')}
                        onPress={() => { void resolve(reservation, 'seated'); }}
                        loading={resolvingId === reservation.ID}
                        variant="secondary"
                      />
                      <Button
                        compact
                        label={copy('ยกเลิก', 'Cancel')}
                        onPress={() => { void resolve(reservation, 'cancelled'); }}
                        loading={resolvingId === reservation.ID}
                        variant="secondary"
                      />
                    </View>
                  ) : <StatusBadge label={statusCopy[reservation.status]} tone={statusTone[reservation.status]} />}
                />
              );
            }) : (
              <View style={{ paddingHorizontal: spacing.lg }}>
                <EmptyState
                  title={copy('ยังไม่มีประวัติในสถานะนี้', 'No reservations in this status')}
                  detail={copy('รายการใหม่จะปรากฏหลังมีการจองโต๊ะ', 'New entries appear after a table is reserved.')}
                />
              </View>
            )}
          </EdgeSection>
        </View>
      )}
    </AppScreen>
  );
}
