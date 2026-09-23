import { useEffect, useRef, useState } from 'react';
import { Alert, View, type TextInput } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { DangerAction } from '@/src/components/form/parts';
import { animateFloorChange, hapticSuccess, usePlanEnv } from '@/src/components/table-plan/plan-context';
import { BodyFrame, GroupCard, KitBlock, KitField, KitRow, PlanButton, RoundKey, type BodyChrome } from '@/src/components/table-plan/sheet-kit';
import { bulkFailureLines } from '@/src/lib/table-error';
import {
  firstFreePrefix,
  nextZoneDisplayOrder,
  normalizeZonePrefix,
  planLabel,
  planStatus,
  planStatusWord,
  tableLabel,
  tableLocked,
  tableZoneId,
  ZONE_NAME_MAX,
  ZONE_PREFIX_MAX,
  zoneOrderPosition,
  zoneRelabelPreview,
} from '@/src/lib/table-plan';
import { palette } from '@/src/theme';
import type { RestaurantTable, TableZone } from '@/src/types/table';

// A room (zone): its name, its prefix with the relabel it causes, its place in
// the order, and deleting it. Deleting a room that still has tables is never a
// dead end: it hands over to the selection with those tables picked, so ย้ายโซน
// is one tap away. Tables in service are the exception (owner, 2026-09-23):
// while the room holds one, it cannot be emptied, so its delete stops at an
// Alert naming them - and its prefix, which would renumber them, stays put.

export function RoomEditorBody({ chrome, zoneId, onClose, onHandoff, onCreated }: {
  chrome: BodyChrome;
  /** null: a new room. */
  zoneId: number | null;
  onClose: () => void;
  /** Delete with tables: pick them on the floor instead, and ask about the room once they have moved. */
  onHandoff: (zone: TableZone, tableIds: number[]) => void;
  onCreated: (zone: TableZone) => void;
}) {
  const env = usePlanEnv();
  const { t, language, tables, zones, activeOrderIds } = env;
  const liveZone = zoneId === null ? null : zones.find((item) => item.ID === zoneId) ?? null;
  // The zone as last seen: a deleted room's sheet is closing, and keeps its
  // content while it slides away instead of collapsing to an empty strip.
  const lastZoneRef = useRef<TableZone | null>(liveZone);
  if (liveZone) lastZoneRef.current = liveZone;
  const zone = liveZone ?? lastZoneRef.current;
  const creating = zoneId === null;
  const [name, setName] = useState(zone?.name ?? '');
  const [prefix, setPrefix] = useState(() => zone?.prefix ?? firstFreePrefix(zones));
  const [errors, setErrors] = useState<{ name?: string | null; prefix?: string | null }>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busyRef = useRef(false);
  const prefixRef = useRef<TextInput>(null);

  // Deleted elsewhere while open: there is nothing left to edit.
  const gone = !creating && liveZone === null;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  const roomTables: RestaurantTable[] = zone ? tables.filter((table) => tableZoneId(table) === zone.ID) : [];
  const inService = roomTables.filter((table) => tableLocked(table, activeOrderIds));
  const inServiceWords = bulkFailureLines(inService.map((table) => ({
    label: planLabel(table),
    reason: planStatusWord(planStatus(table, activeOrderIds), language),
  })));
  const relabel = zone ? zoneRelabelPreview(tables, zone, prefix, activeOrderIds) : null;
  const prefixChanged = Boolean(zone) && prefix !== String(zone?.prefix ?? '');
  const renumbers = Boolean(relabel && relabel.changes.length > 0);
  const nameChanged = !creating && name.trim() !== String(zone?.name ?? '').trim();
  const dirty = creating || nameChanged || prefixChanged;

  // Problems the prefix field can say before the server does.
  const prefixProblem = relabel?.locked.length
    ? inServiceWords
    : relabel?.firstClash
      ? t(`${relabel.firstClash} ซ้ำกับโต๊ะอื่น`, `${relabel.firstClash} is taken`)
      : null;
  const prefixError = errors.prefix ?? prefixProblem;
  const canSave = dirty && !prefixProblem;
  const position = zone ? zoneOrderPosition(zones, zone.ID) : null;

  const { setDirty } = env;
  useEffect(() => {
    setDirty(!creating && (nameChanged || prefixChanged));
  }, [creating, nameChanged, prefixChanged, setDirty]);
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
    const input = {
      name: name.trim(),
      prefix,
      display_order: zone ? zone.display_order : nextZoneDisplayOrder(zones),
      // Sent back exactly as loaded; nothing on the phone gives it a meaning.
      is_active: zone ? zone.is_active : true,
    };
    const result = zone ? await env.api.saveZone(zone.ID, input) : await env.api.createZone(input);
    setSaving(false);
    settle();
    if (!result.ok) {
      const { failure } = result;
      if (failure.field) {
        setErrors({ [failure.field]: failure.message ?? failure.title });
        return;
      }
      env.report(failure);
      return;
    }
    const saved = result.value;
    hapticSuccess();
    if (!zone) {
      env.setZones((current) => [...current, saved]);
      env.announce(t(`เพิ่มโซน ${saved.name} แล้ว`, `Added ${saved.name}`));
      onCreated(saved);
      return;
    }
    env.setZones((current) => current.map((item) => (item.ID === saved.ID ? saved : item)));
    env.announce(t(`บันทึก ${saved.name} แล้ว`, `Saved ${saved.name}`));
    onClose();
    if (renumbers && relabel) {
      // The server rewrote the labels: read them back, then light them up.
      const ids = relabel.changes.map((change) => change.id);
      void env.reload().then(() => env.flash(ids, 'flash'));
    }
  };

  const save = () => {
    if (busyRef.current || !canSave) return;
    const nextErrors = {
      name: name.trim() ? null : t('ใส่ชื่อโซน', 'Enter a zone name'),
      prefix: prefix ? null : t('ใส่คำนำหน้า', 'Enter a prefix'),
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.prefix) return;
    if (renumbers && relabel) {
      Alert.alert(t(`เปลี่ยนเลข ${relabel.changes.length} โต๊ะ?`, `Renumber ${relabel.changes.length} tables?`), `${relabel.from} → ${relabel.to}`, [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: t('เปลี่ยนเลข', 'Renumber'), onPress: () => { void commit(); } },
      ]);
      return;
    }
    void commit();
  };

  const openDelete = () => {
    if (!zone) return;
    if (inService.length > 0) {
      Alert.alert(t('ลบโซนไม่ได้', 'Cannot delete the zone'), inServiceWords);
      return;
    }
    setConfirmDelete(true);
  };

  const confirm = async () => {
    if (!zone) return;
    if (roomTables.length > 0) {
      setConfirmDelete(false);
      onHandoff(zone, roomTables.filter((table) => !tableLocked(table, activeOrderIds)).map((table) => table.ID));
      return;
    }
    if (!begin()) return;
    setDeleting(true);
    const result = await env.api.removeZone(zone.ID);
    setDeleting(false);
    settle();
    if (!result.ok) {
      setConfirmDelete(false);
      env.report(result.failure);
      return;
    }
    onClose();
    animateFloorChange(tables.length);
    env.setZones((current) => current.filter((item) => item.ID !== zone.ID));
    env.announce(t(`ลบโซน ${zone.name} แล้ว`, `Deleted ${zone.name}`));
  };

  const title = zone ? zone.name : t('โซนใหม่', 'New zone');
  const withTables = roomTables.length > 0;

  return (
    <BodyFrame
      chrome={chrome}
      footer={confirmDelete ? null : (
        <PlanButton
          disabled={!canSave}
          label={creating ? t('เพิ่มโซน', 'Add zone') : t('บันทึก', 'Save')}
          loading={saving}
          onPress={save}
        />
      )}
      title={title}
    >
      <GroupCard>
        <View style={{ gap: 12, padding: 14 }}>
          <KitField
            error={errors.name}
            label={t('ชื่อ', 'Name')}
            maxLength={ZONE_NAME_MAX}
            onChangeText={(text) => {
              setName(text);
              if (errors.name) setErrors((current) => ({ ...current, name: null }));
            }}
            onSubmitEditing={() => prefixRef.current?.focus()}
            returnKeyType="next"
            value={name}
          />
          <KitField
            autoCapitalize="characters"
            error={prefixError}
            label={t('คำนำหน้า', 'Prefix')}
            maxLength={ZONE_PREFIX_MAX}
            onChangeText={(text) => {
              setPrefix(normalizeZonePrefix(text));
              if (errors.prefix) setErrors((current) => ({ ...current, prefix: null }));
            }}
            onSubmitEditing={save}
            ref={prefixRef}
            returnKeyType="done"
            unit={prefix ? tableLabel({ ID: 0, prefix }, 1) : undefined}
            value={prefix}
          />
        </View>
        {renumbers && relabel ? (
          <KitBlock title={t('เลขโต๊ะ', 'Numbers')}>
            <Text numberOfLines={2} style={{ fontSize: 13.5, lineHeight: 20, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
              {`${relabel.from} → ${relabel.to}`}
            </Text>
          </KitBlock>
        ) : null}
        {zone && position && position.total >= 2 ? (
          <KitRow title={t('ลำดับ', 'Order')}>
            <Text style={{ fontSize: 15, lineHeight: 22, fontWeight: '500', color: palette.muted, fontVariant: ['tabular-nums'] }}>
              {t(`${position.position} จาก ${position.total}`, `${position.position} of ${position.total}`)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <RoundKey disabled={position.position <= 1} icon="arrow-up" label={t('เลื่อนขึ้น', 'Move up')} onPress={() => env.reorderZone(zone.ID, -1)} />
              <RoundKey disabled={position.position >= position.total} icon="arrow-down" label={t('เลื่อนลง', 'Move down')} onPress={() => env.reorderZone(zone.ID, 1)} />
            </View>
          </KitRow>
        ) : null}
      </GroupCard>
      {zone ? (
        <View style={{ marginTop: 8 }}>
          <DangerAction
            cancelLabel={t('เก็บไว้', 'Keep')}
            confirmIcon={withTables ? 'checkmark-done-outline' : undefined}
            confirmLabel={withTables ? t('เลือกโต๊ะ', 'Pick tables') : t('ลบโซน', 'Delete zone')}
            confirmVariant={withTables ? 'secondary' : 'danger'}
            icon="trash-outline"
            label={t('ลบโซน', 'Delete zone')}
            loading={deleting}
            message={withTables
              ? t(`${zone.name} ยังมี ${roomTables.length} โต๊ะ`, `${zone.name} still has ${roomTables.length} tables`)
              : t(`ลบโซน ${zone.name}?`, `Delete ${zone.name}?`)}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => { void confirm(); }}
            onOpen={openDelete}
            open={confirmDelete}
          />
        </View>
      ) : null}
    </BodyFrame>
  );
}
