import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { createOrder } from '@/src/api/order';
import { reserveTable } from '@/src/api/reservation';
import { listTables } from '@/src/api/table';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { FORM_MAX_WIDTH, PillTabs } from '@/src/components/form/parts';
import { GuestCountPicker } from '@/src/components/open-table/guest-count-picker';
import { TableLoadIssue } from '@/src/components/open-table/table-load-issue';
import { Button, EmptyState, Select, Surface, TextField } from '@/src/components/ui';
import { clampGuestCount, digitsOnly, parseGuestCount, seedGuestCount } from '@/src/lib/guest-count';
import {
  openTableFailure,
  openTableFailureCode,
  openTableIssueLine,
  openTableIssueRetries,
  type OpenTableFailureCode,
  type OpenTableIssue,
} from '@/src/lib/open-table-error';
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
import { useToast } from '@/src/providers/toast-provider';
import { palette, spacing, typeScale } from '@/src/theme';
import type { RestaurantTable } from '@/src/types/table';

type TableLoad = 'idle' | 'loading' | 'ready' | 'missing' | 'failed';
type EntryMode = 'dine_in' | 'reservation';

const FIELD_LABEL = { color: palette.text, fontSize: 13, fontWeight: '600' } as const;

export default function NewOrderScreen() {
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const canTakeOrder = can(activeMembership, 'take_order');
  const params = useLocalSearchParams<{
    tableId?: string;
    type?: string;
    customerCount?: string;
    customerName?: string;
    customerPhone?: string;
  }>();
  const tableId = Number(params.tableId || 0);
  const [table, setTable] = useState<RestaurantTable | null>(null);
  // Where the table stands, and why a load failed as a code rather than words,
  // so switching the language re-words the line instead of leaving it behind.
  const [tableLoad, setTableLoad] = useState<TableLoad>(() => (tableId ? 'loading' : 'idle'));
  const [loadFailure, setLoadFailure] = useState<OpenTableFailureCode | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [orderType] = useState<'dine_in' | 'takeaway'>(params.type === 'takeaway' ? 'takeaway' : 'dine_in');
  const [customerCount, setCustomerCount] = useState(params.customerCount || '1');
  const [customerName, setCustomerName] = useState(params.customerName || '');
  const [customerPhone, setCustomerPhone] = useState(params.customerPhone || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // The field stays a string so the input can be empty mid-edit; every read
  // clamps it back to a valid count.
  const guestCount = parseGuestCount(customerCount);
  // Set once the waiter has chosen a count, so a table answer that lands late
  // does not put the seats-based guess back over their choice.
  const guestTouched = useRef(false);
  const setGuestCount = (next: number) => {
    guestTouched.current = true;
    setCustomerCount(String(clampGuestCount(next)));
  };
  // The mode the switch selects, not a modal flag: the reservation form lives
  // on this page next to the table it belongs to.
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
  // A booking's problems belong to a field: the phone, or the time.
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const reserveSlots = reservationTimeSlots(reserveDay, new Date());

  useEffect(() => {
    if (!canTakeOrder || !tableId) return undefined;
    let active = true;
    setTableLoad('loading');
    listTables()
      .then((response) => {
        if (!active) return;
        const next = response.tables.find((item) => item.ID === tableId) || null;
        setTable(next);
        setLoadFailure(null);
        setTableLoad(next ? 'ready' : 'missing');
        if (next && !params.customerCount && !guestTouched.current) {
          setCustomerCount(String(seedGuestCount(next.capacity)));
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        setLoadFailure(openTableFailureCode(err, 'load'));
        setTableLoad('failed');
      });
    return () => {
      active = false;
    };
  }, [canTakeOrder, params.customerCount, tableId, reloadKey]);

  const reloadTable = () => setReloadKey((key) => key + 1);

  // One control, both modes. A booking is for a number of people just as much
  // as an order is, and the party size is the thing the guest said on the phone.
  const guestCountField = (
    <GuestCountPicker
      count={guestCount}
      decreaseLabel={copy('ลดจำนวนลูกค้า', 'Decrease guest count')}
      increaseLabel={copy('เพิ่มจำนวนลูกค้า', 'Increase guest count')}
      label={copy('จำนวนลูกค้า', 'Guest count')}
      onBlur={() => setCustomerCount(String(guestCount))}
      onChange={setGuestCount}
      onChangeText={(text) => {
        guestTouched.current = true;
        setCustomerCount(digitsOnly(text));
      }}
      quickLabel={(count) => copy(`${count} คน`, count === 1 ? '1 guest' : `${count} guests`)}
      text={customerCount}
    />
  );

  async function submitReservation() {
    if (!tableId) return;
    setPhoneError(null);
    setTimeError(null);
    // Same floor the reservation screen enforces, so a number the backend would
    // reject never leaves this form.
    if (reservePhone.replace(/\D/g, '').length < 9) {
      setPhoneError(copy('กรอกเบอร์โทรอย่างน้อย 9 หลัก', 'Enter a phone number with at least 9 digits.'));
      return;
    }
    // The list is recomputed from the clock on every render, so a slot chosen a
    // few minutes ago can drop out of it while this form is open — and
    // `defaultReservationSlot` itself falls back to '19:00' once the day has no
    // bookable time left. Refusing here is the difference between saying so and
    // silently filing a booking in the past.
    if (reserveDay !== 'now' && !reserveSlots.includes(reserveSlot)) {
      setTimeError(copy('เวลาที่เลือกผ่านไปแล้ว เลือกเวลาใหม่', 'That time has already passed. Choose another.'));
      return;
    }
    const instant = reservationInstant(reserveDay, reserveSlot, new Date());
    setReserving(true);
    try {
      await reserveTable(tableId, {
        reservation_phone: reservePhone.trim(),
        reservation_name: reserveName.trim(),
        guest_count: guestCount,
        // Omitted for a hold: that is what tells the backend to take the table
        // out of service now instead of filing a booking for later.
        ...(instant ? { reserved_for: instant.toISOString() } : null),
      });
      showToast({ title: copy('จองโต๊ะแล้ว', 'Table reserved') });
      router.back();
    } catch (err) {
      const failure = openTableFailure(err, 'reserve', language);
      const words = failure.message ?? failure.title;
      if (failure.field === 'phone') setPhoneError(words);
      else if (failure.field === 'time') setTimeError(words);
      else showToast({ tone: 'error', title: failure.title, message: failure.message });
      if (failure.stale) reloadTable();
    } finally {
      setReserving(false);
    }
  }

  async function submit() {
    if (!canTakeOrder) return;
    if (orderType === 'dine_in' && !canOpenDineInOrder(tableId, Boolean(table))) {
      showToast({
        tone: 'error',
        title: copy('เปิดออเดอร์ไม่สำเร็จ', 'Could not open the order'),
        message: copy('เลือกโต๊ะที่ใช้งานได้ก่อนเปิดออเดอร์', 'Choose a valid table before opening the order.'),
      });
      return;
    }
    const takeaway = orderType === 'takeaway';
    setSaving(true);
    try {
      const order = await createOrder({
        table_id: takeaway ? null : tableId,
        order_type: orderType,
        customer_count: guestCount,
        // Guest name and phone belong to takeaway only: a dine-in order is
        // identified by its table, and web POS sends neither field for dine-in.
        customer_name: takeaway ? customerName.trim() : '',
        customer_phone: takeaway ? customerPhone.trim() : '',
        note: note.trim(),
      });
      router.replace({ pathname: '/order/[id]', params: { id: String(order.ID) } });
    } catch (err) {
      const failure = openTableFailure(err, takeaway ? 'takeaway' : 'open', language);
      showToast({ tone: 'error', title: failure.title, message: failure.message });
      // Someone else opened, booked, switched off or removed this table
      // meanwhile: read it again, so a table that is gone shows as missing and
      // the action goes dim instead of failing the same way twice.
      if (failure.stale && !takeaway) reloadTable();
    } finally {
      setSaving(false);
    }
  }

  if (!canTakeOrder) return <AppScreen title={copy('เปิดออเดอร์', 'Open order')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')} /></AppScreen>;

  const takeaway = orderType === 'takeaway';
  const tableLabel = table?.display_label;
  const title = takeaway
    ? copy('ออเดอร์ซื้อกลับบ้าน', 'Takeaway order')
    : tableLabel
      ? copy(`เปิด ${tableLabel}`, `Open ${tableLabel}`)
      : copy('เปิดโต๊ะ', 'Open table');
  // A dine-in form with no table to open says so, instead of leaving the
  // button dimmed for no stated reason.
  const tableIssue: OpenTableIssue | null = takeaway
    ? null
    : !tableId
      ? 'no_table'
      : tableLoad === 'missing'
        ? 'missing'
        : tableLoad === 'failed'
          ? 'failed'
          : null;

  // One primary action, and it follows the mode: a reservation form under a
  // button that says "Open order" is the lie the old chips told.
  // A day with no bookable time left cannot be confirmed: the time field already
  // says so, and the refusal inside submitReservation would only say "choose
  // another" when there is none to choose.
  const noSlotsLeft = reserveDay !== 'now' && !reserveSlots.length;
  const primaryAction = reserveMode ? (
    <Button
      disabled={!tableId || noSlotsLeft}
      label={copy('ยืนยันจอง', 'Confirm reservation')}
      loading={reserving}
      onPress={submitReservation}
      pill
    />
  ) : (
    <Button
      disabled={orderType === 'dine_in' && !canOpenDineInOrder(tableId, Boolean(table))}
      label={copy('เปิดออเดอร์', 'Open order')}
      loading={saving || (orderType === 'dine_in' && tableLoad === 'loading')}
      onPress={submit}
      pill
    />
  );

  return (
    // No footer dock: the form is short, and a dock pinned to the bottom of a
    // tall phone left a third of the screen blank between the last field and
    // the button. The action sits right under the form instead, on every width.
    <AppScreen title={title} topLevel={false} contentMaxWidth={FORM_MAX_WIDTH}>
      <View style={{ gap: spacing.lg }}>
        {tableIssue ? (
          <TableLoadIssue
            icon={tableIssue === 'failed' && loadFailure === 'offline' ? 'cloud-offline-outline' : 'alert-circle-outline'}
            onRetry={openTableIssueRetries(tableIssue, loadFailure) ? reloadTable : undefined}
            retryLabel={copy('ลองอีกครั้ง', 'Try again')}
            text={openTableIssueLine(tableIssue, loadFailure, language)}
          />
        ) : null}
        {/* Only for the table entry. Arriving from the takeaway shortcut there
            is no table and nothing to choose, so the switch is not rendered at
            all rather than shown with a dead option. One track with one thumb:
            the form below follows it. */}
        {takeaway ? null : (
          <PillTabs<EntryMode>
            onChange={(next) => {
              setPhoneError(null);
              setTimeError(null);
              setReserveMode(next === 'reservation');
            }}
            tabs={[
              { key: 'dine_in', label: copy('ทานที่ร้าน', 'Dine-in') },
              { key: 'reservation', label: copy('จองโต๊ะ', 'Reserve') },
            ]}
            value={reserveMode ? 'reservation' : 'dine_in'}
          />
        )}
        {reserveMode ? (
          <Surface>
            <TextField icon="person-outline" label={copy('ชื่อลูกค้า', 'Customer name')} value={reserveName} onChangeText={setReserveName} maxLength={80} />
            <TextField
              error={phoneError}
              icon="call-outline"
              keyboardType="phone-pad"
              label={copy('เบอร์โทร', 'Phone')}
              maxLength={32}
              onChangeText={(text) => {
                setPhoneError(null);
                setReservePhone(text);
              }}
              value={reservePhone}
            />
            {guestCountField}
            <View style={{ gap: spacing.sm }}>
              <Text style={FIELD_LABEL}>{copy('เวลา', 'Time')}</Text>
              <PillTabs<ReservationDay>
                onChange={(next) => {
                  setTimeError(null);
                  setReserveDay(next);
                  if (next !== 'now') setReserveSlot(defaultReservationSlot(next, new Date()));
                }}
                role="radiogroup"
                tabs={[
                  { key: 'now', label: copy('ตอนนี้', 'Now') },
                  { key: 'today', label: copy('วันนี้', 'Today') },
                  { key: 'tomorrow', label: copy('พรุ่งนี้', 'Tomorrow') },
                ]}
                value={reserveDay}
              />
              {reserveDay === 'now' ? null : (
                <Select
                  disabled={!reserveSlots.length}
                  onChange={(slot) => {
                    setTimeError(null);
                    setReserveSlot(slot);
                  }}
                  options={reserveSlots.map((slot) => ({ label: slot, value: slot }))}
                  // A time that has dropped off the list, or a day with none
                  // left, is said in the field rather than left blank.
                  placeholder={reserveSlots.length ? copy('เลือกเวลา', 'Choose a time') : copy('วันนี้ไม่มีเวลาให้จองแล้ว', 'No times left today')}
                  value={reserveSlot}
                />
              )}
              {timeError ? (
                <Text accessibilityLiveRegion="polite" style={[typeScale.caption, { color: palette.danger }]}>{timeError}</Text>
              ) : null}
            </View>
          </Surface>
        ) : (
          <Surface>
            {guestCountField}
            {takeaway ? (
              <>
                <TextField icon="person-outline" label={copy('ชื่อลูกค้า', 'Customer name')} value={customerName} onChangeText={setCustomerName} maxLength={80} />
                <TextField icon="call-outline" label={copy('เบอร์ลูกค้า', 'Customer phone')} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" maxLength={32} />
              </>
            ) : null}
            {/* One line, not a block. A table note is "แพ้กุ้ง" or "ขอโต๊ะริม
                หน้าต่าง"; a takeaway has no table, so there it is just a note. */}
            <TextField label={takeaway ? copy('หมายเหตุ', 'Note') : copy('หมายเหตุโต๊ะ', 'Table note')} value={note} onChangeText={setNote} maxLength={1000} />
          </Surface>
        )}
        {primaryAction}
      </View>
    </AppScreen>
  );
}
