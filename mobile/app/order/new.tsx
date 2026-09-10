import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { createOrder } from '@/src/api/order';
import { reserveTable } from '@/src/api/reservation';
import { listTables } from '@/src/api/table';
import { AppText as Text } from '@/src/components/app-text';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { ActionDock, Button, ChipGroup, EmptyState, Feedback, Select, Surface, TextField } from '@/src/components/ui';
import { can } from '@/src/lib/rbac';
import {
  defaultReservationSlot,
  reservationInstant,
  reservationTimeSlots,
  type ReservationDay,
} from '@/src/lib/reservation-schedule';
import { canOpenDineInOrder } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, controlShadow, palette, radius, spacing, typeScale } from '@/src/theme';
import type { RestaurantTable } from '@/src/types/table';

// Matches the 52px stepper the current-round item screen uses: a guest count is
// the only thing this screen asks for, so it gets the same full-size treatment
// rather than the 44px variant used beside a dense order list.
function StepperButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'add' | 'remove';
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: palette.borderStrong,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.surfaceStrong : palette.surface,
        ...controlShadow,
        opacity: disabled ? 0.42 : pressed ? 0.74 : 1,
      })}
    >
      <AppIcon color={palette.textStrong} name={icon} size={22} />
    </Pressable>
  );
}

export default function NewOrderScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy } = useDisplayPreferences();
  const canTakeOrder = can(activeMembership, 'take_order');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  const params = useLocalSearchParams<{
    tableId?: string;
    type?: string;
    customerCount?: string;
    customerName?: string;
    customerPhone?: string;
  }>();
  const tableId = Number(params.tableId || 0);
  const [table, setTable] = useState<RestaurantTable | null>(null);
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>(params.type === 'takeaway' ? 'takeaway' : 'dine_in');
  const [customerCount, setCustomerCount] = useState(params.customerCount || '1');
  const [customerName, setCustomerName] = useState(params.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(params.customerPhone || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The field stays a string so the input can be empty mid-edit; every read
  // clamps it back to a valid count.
  const guestCount = Math.max(1, Number.parseInt(customerCount || '1', 10) || 1);
  const setGuestCount = (next: number) => setCustomerCount(String(Math.max(1, Math.min(9999, next))));
  // The mode the chips select, not a modal flag: the reservation form lives on
  // this page next to the table it belongs to.
  const [reserveMode, setReserveMode] = useState(false);
  const [reserveName, setReserveName] = useState('');
  const [reservePhone, setReservePhone] = useState('');
  const [reserveDay, setReserveDay] = useState<ReservationDay>('today');
  // Seeded from the helper, never from a literal. `reservationTimeSlots` drops
  // times that have already passed, so a hardcoded '19:00' is simply absent from
  // the list after 19:00 — the picker then renders blank and Confirm files the
  // booking at a time earlier today.
  const [reserveSlot, setReserveSlot] = useState(() => defaultReservationSlot('today', new Date()));
  const [reserving, setReserving] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);
  const reserveSlots = reservationTimeSlots(reserveDay, new Date());
  useEffect(() => {
    if (!canTakeOrder || !tableId) return;
    listTables()
      .then((response) => {
        const next = response.tables.find((item) => item.ID === tableId) || null;
        setTable(next);
        if (!next) {
          setError(copy('ไม่พบโต๊ะที่เลือก กรุณากลับไปเลือกโต๊ะใหม่', 'The selected table was not found. Go back and choose a table again.'));
        }
        if (next && !params.customerCount) {
          setCustomerCount(String(Math.max(1, Math.min(next.capacity || 1, 6))));
        }
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : copy('โหลดข้อมูลโต๊ะไม่สำเร็จ', 'Could not load table details'),
        );
      });
  }, [canTakeOrder, copy, params.customerCount, tableId]);
  // One field, both modes. A booking is for a number of people just as much as
  // an order is, and the party size is the thing the guest said on the phone.
  const guestCountField = (
    <View style={{ gap: spacing.sm }}>
      <Text selectable style={{ color: palette.text, fontSize: 13, fontWeight: '600' }}>{copy('จำนวนลูกค้า', 'Guest count')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <StepperButton
          label={copy('ลดจำนวนลูกค้า', 'Decrease guest count')}
          icon="remove"
          disabled={guestCount <= 1}
          onPress={() => setGuestCount(guestCount - 1)}
        />
        {/* Shadow on the wrapper: Android drops a box shadow set on a
            TextInput, and this field sits between two lifted buttons. */}
        <View style={{ flex: 1, minWidth: 0, borderRadius: radius.md, ...controlShadow }}>
          <TextInput
            accessibilityLabel={copy('จำนวนลูกค้า', 'Guest count')}
            keyboardType="number-pad"
            maxLength={4}
            onBlur={() => setGuestCount(guestCount)}
            onChangeText={(text) => setCustomerCount(text.replace(/[^0-9]/g, ''))}
            selectTextOnFocus
            style={[typeScale.number, {
              width: '100%',
              height: 52,
              borderWidth: 1,
              borderColor: palette.controlBorder,
              borderRadius: radius.md,
              backgroundColor: palette.surfaceSubtle,
              fontSize: 22,
              // Same weight as the total on the bill footer. typeScale.number is
              // 800, which is heavier than anything else on the screen and made
              // the count read as the loudest thing on a form.
              fontWeight: '700',
              textAlign: 'center',
            }]}
            value={customerCount}
          />
        </View>
        <StepperButton
          label={copy('เพิ่มจำนวนลูกค้า', 'Increase guest count')}
          icon="add"
          disabled={guestCount >= 9999}
          onPress={() => setGuestCount(guestCount + 1)}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {/* Up and down rather than two sizes of up: overshooting is as common as
            undershooting, and getting back down took ten taps of the stepper. */}
        <Button compact label="+5" onPress={() => setGuestCount(guestCount + 5)} style={{ flex: 1 }} variant="secondary" />
        <Button compact label="−5" onPress={() => setGuestCount(guestCount - 5)} style={{ flex: 1 }} variant="secondary" />
      </View>
    </View>
  );

  async function submitReservation() {
    if (!tableId) return;
    // Same floor the reservation screen enforces, so a number the backend would
    // reject never leaves this sheet.
    if (reservePhone.replace(/\D/g, '').length < 9) {
      setReserveError(copy('กรอกเบอร์โทรอย่างน้อย 9 หลัก', 'Enter a phone number with at least 9 digits.'));
      return;
    }
    // The list is recomputed from the clock on every render, so a slot chosen a
    // few minutes ago can drop out of it while this sheet is open — and
    // `defaultReservationSlot` itself falls back to '19:00' once the day has no
    // bookable time left. Refusing here is the difference between saying so and
    // silently filing a booking in the past.
    if (reserveDay !== 'now' && !reserveSlots.includes(reserveSlot)) {
      setReserveError(copy('เวลาที่เลือกผ่านไปแล้ว เลือกเวลาใหม่', 'That time has already passed. Choose another.'));
      return;
    }
    const instant = reservationInstant(reserveDay, reserveSlot, new Date());
    setReserving(true);
    setReserveError(null);
    try {
      await reserveTable(tableId, {
        reservation_phone: reservePhone.trim(),
        reservation_name: reserveName.trim(),
        guest_count: guestCount,
        // Omitted for a hold: that is what tells the backend to take the table
        // out of service now instead of filing a booking for later.
        ...(instant ? { reserved_for: instant.toISOString() } : null),
      });
      router.back();
    } catch (err) {
      setReserveError(err instanceof Error ? err.message : copy('จองโต๊ะไม่สำเร็จ', 'Could not reserve the table'));
    } finally {
      setReserving(false);
    }
  }

  async function submit() {
    if (!canTakeOrder) return;
    if (orderType === 'dine_in' && !canOpenDineInOrder(tableId, Boolean(table))) {
      setError(copy('เลือกโต๊ะที่ใช้งานได้ก่อนเปิดออเดอร์', 'Choose a valid table before opening the order.'));
      return;
    }
    setSaving(true); setError(null);
    try {
      const takeaway = orderType === 'takeaway';
      const order = await createOrder({
        table_id: takeaway ? null : tableId,
        order_type: orderType,
        customer_count: Math.max(1, Number.parseInt(customerCount || '1', 10) || 1),
        // Guest name and phone belong to takeaway only: a dine-in order is
        // identified by its table, and web POS sends neither field for dine-in.
        customer_name: takeaway ? customerName.trim() : '',
        customer_phone: takeaway ? customerPhone.trim() : '',
        note: note.trim(),
      });
      router.replace({ pathname: '/order/[id]', params: { id: String(order.ID) } });
    } catch (err) { setError(err instanceof Error ? err.message : copy('เปิดออเดอร์ไม่สำเร็จ', 'Could not open the order')); }
    finally { setSaving(false); }
  }
  if (!canTakeOrder) return <AppScreen title={copy('เปิดออเดอร์', 'Open order')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')} /></AppScreen>;
  return (
    <AppScreen
      title={orderType === 'takeaway' ? copy('ออเดอร์ซื้อกลับบ้าน', 'Takeaway order') : copy(`เปิด ${table?.display_label || 'โต๊ะ'}`, `Open ${table?.display_label || 'table'}`)}
      topLevel={false}
      // The footer follows the mode too. A screen showing a reservation form
      // under a button that says "Open order" is the same lie the chips told.
      footer={tabletWorkspace ? undefined : reserveMode ? (
        <ActionDock><Button label={copy('ยืนยันจอง', 'Confirm reservation')} onPress={submitReservation} loading={reserving} /></ActionDock>
      ) : (
        <ActionDock><Button label={copy('เปิดออเดอร์', 'Open order')} onPress={submit} loading={saving} disabled={orderType === 'dine_in' && !canOpenDineInOrder(tableId, Boolean(table))} /></ActionDock>
      )}
    >
      {error ? <Feedback title={copy('เปิดออเดอร์ไม่ได้', 'Could not open the order')} detail={error} tone="danger" /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        {/* Only for the table entry. Arriving from the takeaway shortcut there
            is no table and nothing to choose, so the row is not rendered at all
            rather than shown with a dead option.
            These chips pick a mode and the form below follows them. They used to
            open a sheet for "Reserve" while staying selected on "Dine-in", which
            left the screen claiming one thing and doing another. */}
        {orderType === 'takeaway' ? null : (
          <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 0.8 : undefined }}>
            <ChipGroup
              fill
              value={reserveMode ? 'reservation' : 'dine_in'}
              onChange={(next) => {
                setReserveError(null);
                setReserveMode(next === 'reservation');
              }}
              options={[
                { label: copy('ทานที่ร้าน', 'Dine-in'), value: 'dine_in' },
                { label: copy('จองโต๊ะ', 'Reserve'), value: 'reservation' },
              ]}
            />
          </View>
        )}
        {reserveMode ? (
        <Surface style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1.2 : undefined }}>
          {reserveError ? <Feedback title={copy('จองโต๊ะไม่สำเร็จ', 'Could not reserve the table')} detail={reserveError} tone="danger" /> : null}
          <TextField icon="person-outline" label={copy('ชื่อลูกค้า', 'Customer name')} value={reserveName} onChangeText={setReserveName} maxLength={80} />
          <TextField icon="call-outline" label={copy('เบอร์โทร', 'Phone')} value={reservePhone} onChangeText={setReservePhone} keyboardType="phone-pad" maxLength={32} />
          {guestCountField}
          <ChipGroup
            fill
            label={copy('เวลา', 'Time')}
            value={reserveDay}
            onChange={(next) => {
              setReserveDay(next);
              if (next !== 'now') setReserveSlot(defaultReservationSlot(next, new Date()));
            }}
            options={[
              { label: copy('ตอนนี้', 'Now'), value: 'now' },
              { label: copy('วันนี้', 'Today'), value: 'today' },
              { label: copy('พรุ่งนี้', 'Tomorrow'), value: 'tomorrow' },
            ]}
          />
          {reserveDay === 'now' ? null : (
            <Select value={reserveSlot} onChange={setReserveSlot} options={reserveSlots.map((slot) => ({ label: slot, value: slot }))} />
          )}
          {tabletWorkspace ? <Button label={copy('ยืนยันจอง', 'Confirm reservation')} onPress={submitReservation} loading={reserving} /> : null}
        </Surface>
        ) : (
        <Surface style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1.2 : undefined }}>
          {guestCountField}
          {orderType === 'takeaway' ? (
            <>
              <TextField icon="person-outline" label={copy('ชื่อลูกค้า (ไม่บังคับ)', 'Customer name (optional)')} placeholder={copy('เช่น คุณแนน', 'For example, Nan')} value={customerName} onChangeText={setCustomerName} maxLength={80} />
              <TextField icon="call-outline" label={copy('เบอร์ลูกค้า (ไม่บังคับ)', 'Customer phone (optional)')} placeholder={copy('เช่น 081-234-5678', 'For example, 081-234-5678')} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" maxLength={32} />
            </>
          ) : null}
          {/* Two lines, not three. A table note is "แพ้กุ้ง" or "ขอโต๊ะริมหน้าต่าง",
              and the box grows as it is typed into anyway. */}
          <TextField label={copy('หมายเหตุโต๊ะ', 'Table note')} value={note} onChangeText={setNote} multiline minHeight={72} maxLength={1000} />
          {tabletWorkspace ? <Button label={copy('เปิดออเดอร์', 'Open order')} onPress={submit} loading={saving} disabled={orderType === 'dine_in' && !canOpenDineInOrder(tableId, Boolean(table))} /> : null}
        </Surface>
        )}
      </View>
    </AppScreen>
  );
}
