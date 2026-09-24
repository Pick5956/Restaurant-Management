import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import {
  cancelReservation,
  listReservations,
  reserveTable,
} from '@/src/api/reservation';
import { createOrder } from '@/src/api/order';
import { listTables } from '@/src/api/table';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import {
  ActionDock,
  Button,
  ChipGroup,
  EmptyState,
  Feedback,
  SectionHeader,
  StatusBadge,
  Surface,
  TextField,
} from '@/src/components/ui';
import { openTableFailure } from '@/src/lib/open-table-error';
import { can } from '@/src/lib/rbac';
import { reservationFailure } from '@/src/lib/reservation-error';
import { formatReservationClock } from '@/src/lib/reservation-schedule';
import { reservationArrivalOrderInput } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type { Reservation } from '@/src/types/reservation';
import type { RestaurantTable } from '@/src/types/table';

function defaultGuestCount(table: RestaurantTable | null | undefined) {
  return String(Math.max(1, Math.min(table?.capacity || 1, 6)));
}

export default function TableReservationScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const canTakeOrder = can(activeMembership, 'take_order');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  const { tableId: rawId } = useLocalSearchParams<{ tableId?: string }>();
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [tableId, setTableId] = useState(Number(rawId || 0));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [guestCount, setGuestCount] = useState('1');
  const [saving, setSaving] = useState(false);
  // Only a failed load sits on the page: the step's own title, and the app's
  // line under it when there is one - never the server's words. A refused
  // action is a toast, and a problem with the phone sits under the phone.
  const [loadError, setLoadError] = useState<{ title: string; detail?: string } | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  // Bumped when a refusal says the table changed under the screen.
  const [reloadKey, setReloadKey] = useState(0);
  const seededFor = useRef<string | undefined | null>(null);

  useEffect(() => {
    if (!canTakeOrder) return undefined;
    let active = true;
    listTables()
      .then((response) => {
        if (!active) return;
        const next = response.tables || [];
        setTables(next);
        setLoadError(null);
        // The form starts from the table the floor sent us to, once. A reload
        // after a refusal keeps the words already on screen and never puts
        // back a table the refusal let go.
        if (seededFor.current === rawId) return;
        seededFor.current = rawId;
        const selectedTable = next.find((item) => item.ID === Number(rawId));
        if (selectedTable) {
          setTableId(selectedTable.ID);
          setGuestCount(defaultGuestCount(selectedTable));
        }
      })
      .catch((err) => {
        if (!active) return;
        const failure = openTableFailure(err, 'load', language);
        setLoadError({ title: failure.title, detail: failure.message });
      });
    return () => {
      active = false;
    };
  }, [canTakeOrder, language, rawId, reloadKey]);

  const reloadTables = () => setReloadKey((key) => key + 1);

  // The table row carries the guest's name and phone but not when the booking
  // was made or how many are coming — those live on the reservation. Failing to
  // find it costs two fields on the card, never the screen, so this deliberately
  // has no error branch.
  useEffect(() => {
    if (!canTakeOrder || !tableId) return;
    listReservations({ status: 'active', limit: 100 })
      .then((response) => {
        const match = response.reservations.find((item) => item.table_id === tableId) || null;
        setReservation(match);
        // The party size the guest actually gave, in preference to a guess made
        // from how many chairs the table has.
        if (match?.guest_count) setGuestCount(String(match.guest_count));
      })
      .catch(() => setReservation(null));
  }, [canTakeOrder, reloadKey, tableId]);

  const selected = tables.find((item) => item.ID === tableId) || null;
  const options = useMemo(
    () => tables
      .filter((item) => item.status === 'free' || item.status === 'reserved' || item.ID === tableId)
      .map((item) => ({
        label: `${item.display_label || item.table_number}${item.status === 'reserved' ? copy(', จองแล้ว', ', Reserved') : ''}`,
        value: item.ID,
      })),
    [copy, tableId, tables],
  );

  // The name and phone fields are only for a new booking; a booked table shows
  // its own guest read-only. So picking another table keeps what the waiter
  // typed, which is the whole point of letting a refused table go.
  function choose(id: number) {
    const item = tables.find((current) => current.ID === id);
    setTableId(id);
    setGuestCount(defaultGuestCount(item));
    setConfirmCancel(false);
    setPhoneError(null);
  }

  async function reserve() {
    if (!canTakeOrder || selected?.status === 'reserved') return;
    if (!tableId) {
      showToast({
        tone: 'error',
        title: copy('จองโต๊ะไม่สำเร็จ', 'Could not reserve the table'),
        message: copy('เลือกโต๊ะก่อน', 'Choose a table first.'),
      });
      return;
    }
    if (phone.replace(/\D/g, '').length < 9) {
      setPhoneError(copy('กรอกเบอร์โทรอย่างน้อย 9 หลัก', 'Enter a phone number with at least 9 digits.'));
      return;
    }
    setSaving(true);
    setPhoneError(null);
    try {
      await reserveTable(tableId, {
        reservation_phone: phone.trim(),
        reservation_name: name.trim(),
      });
      router.back();
    } catch (err) {
      const failure = openTableFailure(err, 'reserve', language);
      if (failure.field === 'phone') setPhoneError(failure.message ?? failure.title);
      else showToast({ tone: 'error', title: failure.title, message: failure.message });
      // Someone else booked, opened, switched off or removed this table: let it
      // go, so the waiter picks another with the name and phone still typed in,
      // and read the floor again. Keeping it would turn the screen into the
      // other booking.
      if (failure.stale) {
        setTableId(0);
        reloadTables();
      }
    } finally {
      setSaving(false);
    }
  }

  async function acceptReservation() {
    if (!canTakeOrder || !selected || selected.status !== 'reserved') return;
    // The booking is the table's, never what this screen had typed: the order
    // is opened under the name and phone the table was booked with.
    const input = reservationArrivalOrderInput(selected.ID, {
      customerCount: guestCount,
      customerName: selected.reservation_name,
      customerPhone: selected.reservation_phone,
    });
    setSaving(true);
    try {
      const order = await createOrder(input);
      router.replace({
        pathname: '/order/[id]',
        params: { id: String(order.ID) },
      });
    } catch (err) {
      const failure = reservationFailure(err, 'seat_hold', language);
      showToast({ tone: 'error', title: failure.title, message: failure.message });
      if (failure.reload) reloadTables();
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!canTakeOrder || !selected || selected.status !== 'reserved') return;
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setSaving(true);
    try {
      await cancelReservation(selected.ID);
      router.back();
    } catch (err) {
      const failure = reservationFailure(err, 'cancel', language);
      showToast({ tone: 'error', title: failure.title, message: failure.message });
      if (failure.reload) {
        // The booking moved on elsewhere; the question no longer applies.
        setConfirmCancel(false);
        reloadTables();
      }
    } finally {
      setSaving(false);
    }
  }

  if (!canTakeOrder) {
    return (
      <AppScreen title={copy('จองโต๊ะ', 'Table reservation')} topLevel={false}>
        <EmptyState
          title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')}
          detail={copy(
            'ต้องมีสิทธิ์รับออเดอร์เพื่อจัดการการจองโต๊ะ',
            'Order-taking permission is required to manage table reservations.',
          )}
        />
      </AppScreen>
    );
  }

  const isReserved = selected?.status === 'reserved';

  return (
    <AppScreen
      title={isReserved
        ? copy('รายละเอียดการจอง', 'Reservation details')
        : copy('จองโต๊ะ', 'Table reservation')}
      topLevel={false}
      footer={!tabletWorkspace && !confirmCancel ? (
        <ActionDock>
          <Button
            icon={isReserved ? 'restaurant-outline' : 'calendar-outline'}
            label={isReserved ? copy('รับลูกค้าและเปิดออเดอร์', 'Seat guests and open order') : copy('ยืนยันจองโต๊ะ', 'Confirm reservation')}
            onPress={() => { if (isReserved) void acceptReservation(); else void reserve(); }}
            loading={saving}
          />
        </ActionDock>
      ) : undefined}
    >
      {loadError ? (
        <Feedback
          title={loadError.title}
          detail={loadError.detail}
          tone="danger"
        />
      ) : null}
      <View style={{ flexDirection: tabletWorkspace && isReserved ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
      <Surface style={{ width: tabletWorkspace && isReserved ? undefined : '100%', minWidth: 0, flex: tabletWorkspace && isReserved ? 1.2 : undefined }}>
        {/* No table picker once a booking exists. You arrive here by tapping the
            booked table, so offering every other table reads as though the screen
            did not know which one you came from — and picking one here would
            silently show you a different table's booking. */}
        {isReserved ? null : (
          <>
            <SectionHeader title={copy('ข้อมูลการจอง', 'Reservation details')} />
            <ChipGroup
              label={copy('โต๊ะ', 'Table')}
              value={tableId}
              onChange={choose}
              options={options}
            />
          </>
        )}
        {isReserved ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Text selectable numberOfLines={1} style={[typeScale.hero, { minWidth: 0, flex: 1 }]}>
                {selected?.display_label || selected?.table_number || copy('โต๊ะ', 'Table')}
              </Text>
              <StatusBadge label={copy('กำลังจอง', 'Active reservation')} tone="info" />
            </View>
            {/* Four short facts in two rows rather than four stacked ones. The
                guest count is read here, not typed: this screen answers "who is
                this and how many", and the count is still adjustable on the
                order itself once the guests are seated. */}
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                  <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('ชื่อผู้จอง', 'Guest name')}</Text>
                  <Text selectable numberOfLines={1} style={typeScale.cardTitle}>{selected?.reservation_name || copy('ไม่ระบุชื่อ', 'No guest name')}</Text>
                </View>
                <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                  <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('เบอร์โทร', 'Phone')}</Text>
                  <Text selectable numberOfLines={1} style={typeScale.cardTitle}>{selected?.reservation_phone || copy('ไม่มีเบอร์โทร', 'No phone')}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                  <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('จำนวนลูกค้า', 'Guests')}</Text>
                  <Text selectable style={typeScale.cardTitle}>{guestCount}</Text>
                </View>
                <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                  <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('เวลาที่จอง', 'Booked')}</Text>
                  <Text selectable numberOfLines={1} style={typeScale.cardTitle}>
                    {formatReservationClock(reservation?.reserved_for || reservation?.CreatedAt, language)}
                  </Text>
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            <TextField
              icon="person-outline"
              label={copy('ชื่อเล่นที่จอง (ไม่บังคับ)', 'Reservation name (optional)')}
              value={name}
              onChangeText={setName}
              maxLength={80}
            />
            <TextField
              error={phoneError}
              icon="call-outline"
              label={copy('เบอร์โทรที่จอง', 'Reservation phone')}
              value={phone}
              onChangeText={(text) => {
                setPhoneError(null);
                setPhone(text);
              }}
              keyboardType="phone-pad"
              maxLength={32}
            />
            {tabletWorkspace ? <Button
              icon="calendar-outline"
              label={copy('ยืนยันจองโต๊ะ', 'Confirm reservation')}
              onPress={() => { void reserve(); }}
              loading={saving}
            /> : null}
          </>
        )}
      </Surface>
      {/* The "Seat guests" card is gone: it was a heading, a sentence and an icon
          wrapped around a button that the footer already carries. What is left
          is the one action the footer does not have. */}
      {isReserved ? (
        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 0.8 : undefined, gap: spacing.sm }}>
          {tabletWorkspace ? (
            <Button
              icon="restaurant-outline"
              label={copy('รับลูกค้าและเปิดออเดอร์', 'Seat guests and open order')}
              onPress={() => { void acceptReservation(); }}
              loading={saving}
            />
          ) : null}
          <Button
            icon="close-circle-outline"
            variant={confirmCancel ? 'danger' : 'secondary'}
            label={confirmCancel
              ? copy('ยืนยันยกเลิกการจอง', 'Confirm reservation cancellation')
              : copy('ยกเลิกการจอง', 'Cancel reservation')}
            onPress={() => { void cancel(); }}
            loading={saving}
          />
        </View>
      ) : null}
      </View>
    </AppScreen>
  );
}
