import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { DangerAction, SwitchRow } from '@/src/components/form/parts';
import { CompactStepper } from '@/src/components/table-plan/count-stepper';
import {
  adoptMovedRow,
  animateFloorChange,
  hapticSuccess,
  mergeTableRow,
  usePlanEnv,
} from '@/src/components/table-plan/plan-context';
import { BodyFrame, GroupCard, KitBlock, KitRow, PlanButton, ZoneChips, type BodyChrome } from '@/src/components/table-plan/sheet-kit';
import { useTableLink, type QrPaper } from '@/src/components/table-plan/table-link';
import { QrView, TableTent } from '@/src/components/table-plan/table-tent';
import { QR_PAPER_PRINTS } from '@/src/components/table-plan/use-qr-paper';
import { reservationClock } from '@/src/lib/reservation-schedule';
import {
  moveTargetLabel,
  planTableTitle,
  TABLE_CAPACITY_RANGE,
  tableZoneId,
  upcomingBookingNote,
  zoneChoices,
  type RoomKey,
} from '@/src/lib/table-plan';
import { canEditTableAvailability, tableEditorSaveStatus } from '@/src/lib/table-workflow';
import { palette } from '@/src/theme';
import type { RestaurantTable, TableStatus } from '@/src/types/table';

// A table that is not in service: its seats, its zone and whether it is open,
// saved together from one button; its QR; and deleting it, with closing it
// instead when the server refuses because it has order history.
//
// The form holds only what was touched. An untouched field follows the row, so
// a reload shows fresh values while the owner's own edits stay as typed.

const CLASH_INK = '#B91C1C';

export function TableEditorBody({ chrome, table, qrOpen, setQrOpen, onClose, onRemoving, paper }: {
  chrome: BodyChrome;
  table: RestaurantTable;
  qrOpen: boolean;
  setQrOpen: (open: boolean) => void;
  onClose: () => void;
  /** The table is about to leave the list because this sheet deleted it. */
  onRemoving: () => void;
  paper: QrPaper;
}) {
  const env = usePlanEnv();
  const { t, language, tables, zones } = env;
  const { label, zone: zoneName } = planTableTitle(table, zones, language);
  const link = useTableLink(table, label, t);

  const [draftSeats, setDraftSeats] = useState<number | null>(null);
  const [draftZone, setDraftZone] = useState<RoomKey | null>(null);
  const [draftOpen, setDraftOpen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [makingQr, setMakingQr] = useState(false);
  const busyRef = useRef(false);

  const savedZone: RoomKey = tableZoneId(table) ?? 'none';
  const savedOpen = table.status !== 'inactive';
  const seats = draftSeats ?? table.capacity;
  const zoneKey = draftZone ?? savedZone;
  const open = draftOpen ?? savedOpen;
  const seatsChanged = seats !== table.capacity;
  const openChanged = open !== savedOpen;
  // Choosing the saved zone again is no change: a same-zone move would still renumber.
  const zoneChanged = zoneKey !== savedZone;
  const target = zoneKey === 'none' ? null : zones.find((zone) => zone.ID === zoneKey) ?? null;
  const relabel = zoneChanged ? moveTargetLabel(tables, table, target) : null;
  const dirty = seatsChanged || openChanged || zoneChanged;
  const canSave = dirty && !relabel?.clash;
  const availabilityEditable = canEditTableAvailability(table.status);

  // A zone that vanished on a reload drops the change.
  useEffect(() => {
    if (typeof draftZone === 'number' && !zones.some((zone) => zone.ID === draftZone)) setDraftZone(null);
  }, [draftZone, zones]);

  const { setDirty } = env;
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const begin = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    env.setBusy(true);
    return true;
  };
  const settle = () => {
    busyRef.current = false;
    env.setBusy(false);
  };

  const commit = async () => {
    if (!begin()) return;
    setSaving(true);
    if (seatsChanged || openChanged) {
      const requested: TableStatus = open ? 'free' : 'inactive';
      // zone_id is validated but never applied by PUT: the saved one keeps it safe.
      const put = await env.api.saveTable(table.ID, { zone_id: tableZoneId(table), capacity: seats, status: tableEditorSaveStatus(table.status, requested) });
      if (!put.ok) {
        setSaving(false);
        settle();
        env.report(put.failure);
        return;
      }
      env.setTables((current) => mergeTableRow(current, put.value));
      setDraftSeats(null);
      setDraftOpen(null);
    }
    let finalLabel = label;
    if (zoneChanged) {
      const moved = await env.api.moveTable(table.ID, target ? target.ID : null);
      if (!moved.ok) {
        setSaving(false);
        settle();
        const { failure } = moved;
        if (seatsChanged || openChanged) {
          // Half saved: the seats and the open state went through. Only the
          // zone stays pending, and pressing save again retries just the move.
          env.report({ ...failure, title: t('บันทึกไม่ครบ', 'Partly saved'), message: [failure.title, failure.message].filter(Boolean).join(', ') });
        } else {
          env.report(failure);
        }
        return;
      }
      animateFloorChange(tables.length);
      env.setTables((current) => adoptMovedRow(current, moved.value, target));
      setDraftZone(null);
      finalLabel = moved.value.display_label || moved.value.table_number || label;
    }
    setSaving(false);
    settle();
    hapticSuccess();
    env.flash([table.ID], 'flash');
    env.announce(t(`บันทึก ${finalLabel} แล้ว`, `Saved ${finalLabel}`));
    onClose();
  };

  const save = () => {
    if (busyRef.current || !canSave) return;
    // Closing a table with a booking due asks first; the booking does not lock it.
    const note = openChanged && !open ? upcomingBookingNote([table], language) : null;
    if (note) {
      Alert.alert(t(`ปิด ${label}?`, `Close ${label}?`), note, [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: t('ปิดใช้งาน', 'Close'), onPress: () => { void commit(); } },
      ]);
      return;
    }
    void commit();
  };

  const closeInstead = async () => {
    if (!begin()) return;
    const put = await env.api.saveTable(table.ID, { zone_id: tableZoneId(table), capacity: table.capacity, status: 'inactive' });
    settle();
    if (!put.ok) {
      env.report(put.failure);
      return;
    }
    env.setTables((current) => mergeTableRow(current, put.value));
    env.flash([table.ID], 'flash');
    env.announce(t(`ปิดใช้งาน ${label} แล้ว`, `Closed ${label}`));
    onClose();
  };

  const remove = async () => {
    if (!begin()) return;
    setDeleting(true);
    const result = await env.api.removeTable(table.ID);
    setDeleting(false);
    settle();
    if (result.ok) {
      onRemoving();
      onClose();
      animateFloorChange(tables.length);
      env.setTables((current) => current.filter((item) => item.ID !== table.ID));
      env.announce(t(`ลบ ${label} แล้ว`, `Deleted ${label}`));
      return;
    }
    setConfirmDelete(false);
    const { failure } = result;
    if (failure.offerDeactivate) {
      // Any past order blocks a delete; retiring the table is the normal way out.
      Alert.alert(t(`ลบ ${label} ไม่ได้`, `Cannot delete ${label}`), failure.message, [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: t('ปิดใช้งานแทน', 'Close it instead'), onPress: () => { void closeInstead(); } },
      ]);
      return;
    }
    if (failure.code === 'not_found') onClose();
    env.report(failure);
  };

  const makeQr = async () => {
    if (!begin()) return false;
    setMakingQr(true);
    const result = await env.api.regenerateQr(table.ID);
    setMakingQr(false);
    settle();
    if (!result.ok) {
      env.report(result.failure);
      return false;
    }
    env.setTables((current) => mergeTableRow(current, result.value));
    hapticSuccess();
    env.announce(t('สร้าง QR ใหม่แล้ว', 'New QR made'));
    return true;
  };

  if (qrOpen && link.url) {
    return (
      <BodyFrame chrome={chrome}>
        <QrView
          canRegenerate
          label={label}
          onBack={() => setQrOpen(false)}
          canPrint={QR_PAPER_PRINTS}
          busy={paper.busy}
          onPaper={(mode) => paper.run({ label, zone: zoneName, url: link.url ?? '' }, mode)}
          onRegenerate={makeQr}
          regenerating={makingQr}
          t={t}
          url={link.url}
          zone={zoneName}
        />
      </BodyFrame>
    );
  }

  const zoneOptions = [
    { key: 'none' as RoomKey, label: t('ไม่มีโซน', 'No zone') },
    ...zoneChoices(zones, typeof savedZone === 'number' ? savedZone : null).map((zone) => ({ key: zone.ID as RoomKey, label: zone.name })),
  ];

  return (
    <BodyFrame
      chrome={chrome}
      footer={confirmDelete ? null : <PlanButton disabled={!canSave} label={t('บันทึก', 'Save')} loading={saving} onPress={save} />}
    >
      <TableTent
        bookingTime={reservationClock(table.upcoming_reservation_at, language)}
        canCreateQr
        closed={table.status === 'inactive'}
        creatingQr={makingQr}
        label={label}
        onCreateQr={() => { void makeQr(); }}
        onOpenMenu={link.openMenu}
        onOpenQr={() => setQrOpen(true)}
        onShare={link.share}
        t={t}
        url={link.url}
        zone={zoneName}
      />
      <GroupCard>
        <KitRow first title={t('ที่นั่ง', 'Seats')}>
          <CompactStepper
            decreaseLabel={t('ลดที่นั่ง', 'Fewer seats')}
            increaseLabel={t('เพิ่มที่นั่ง', 'More seats')}
            label={t('ที่นั่ง', 'Seats')}
            max={TABLE_CAPACITY_RANGE.max}
            min={TABLE_CAPACITY_RANGE.min}
            onChange={(value) => setDraftSeats(value === table.capacity ? null : value)}
            value={seats}
          />
        </KitRow>
        <KitBlock title={t('โซน', 'Zone')}>
          <ZoneChips
            onChange={(key) => setDraftZone(key === savedZone ? null : key)}
            options={zoneOptions}
            value={zoneKey}
          />
        </KitBlock>
        {relabel ? (
          <KitRow title={t('เลขโต๊ะ', 'Number')}>
            {relabel.clash ? (
              <Text numberOfLines={2} style={{ flexShrink: 1, textAlign: 'right', fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: CLASH_INK, fontVariant: ['tabular-nums'] }}>
                {t(`${relabel.label} ซ้ำกับโต๊ะอื่น`, `${relabel.label} is taken`)}
              </Text>
            ) : (
              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
                {`${label} `}
                <Text style={{ color: palette.muted }}>→</Text>
                {` ${relabel.label}`}
              </Text>
            )}
          </KitRow>
        ) : null}
        {availabilityEditable ? (
          <SwitchRow onChange={(value) => setDraftOpen(value === savedOpen ? null : value)} title={t('เปิดใช้งาน', 'Open')} value={open} />
        ) : null}
      </GroupCard>
      <View style={{ marginTop: 8 }}>
        <DangerAction
          cancelLabel={t('เก็บไว้', 'Keep')}
          confirmLabel={t('ลบโต๊ะ', 'Delete table')}
          icon="trash-outline"
          label={t('ลบโต๊ะ', 'Delete table')}
          loading={deleting}
          message={t(`ลบ ${label}?`, `Delete ${label}?`)}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { void remove(); }}
          onOpen={() => setConfirmDelete(true)}
          open={confirmDelete}
        />
      </View>
    </BodyFrame>
  );
}
