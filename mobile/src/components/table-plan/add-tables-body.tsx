import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import { SwitchRow } from '@/src/components/form/parts';
import { CompactStepper, CountBlock } from '@/src/components/table-plan/count-stepper';
import { usePlanEnv } from '@/src/components/table-plan/plan-context';
import { BodyFrame, GroupCard, KitBlock, KitField, KitRow, PlanButton, ZoneChips, type BodyChrome } from '@/src/components/table-plan/sheet-kit';
import {
  compressLabelRuns,
  firstFreePrefix,
  mostCommonCapacity,
  newTablesSince,
  nextTableLabels,
  nextZoneDisplayOrder,
  normalizeZonePrefix,
  stepperValue,
  TABLE_CAPACITY_RANGE,
  TABLE_COUNT_RANGE,
  tableLabel,
  tableZoneId,
  ZONE_NAME_MAX,
  ZONE_PREFIX_MAX,
  zoneChoices,
  type NumberingZone,
  type RoomKey,
} from '@/src/lib/table-plan';
import type { RestaurantTable } from '@/src/types/table';

// Adding tables: how many (the orange block, with the exact labels the server
// will write), which room - an existing one, or a new zone typed in place and
// created in the same press - the seats, and whether they open for service.

/** From this many tables one native confirm asks first. */
const CONFIRM_FROM = 10;

type Choice = RoomKey | 'new';

export type AddPreview = { room: RoomKey; labels: string[] };

function inRoom(table: RestaurantTable, room: RoomKey) {
  const id = tableZoneId(table);
  return room === 'none' ? id === null : id === room;
}

export function AddTablesBody({ chrome, initialRoom, initialCount, onDone, onPreview }: {
  chrome: BodyChrome;
  initialRoom: RoomKey;
  initialCount: number;
  onDone: (created: RestaurantTable[]) => void;
  /** The tablet draws the labels to be created as ghosts in their room. */
  onPreview?: (preview: AddPreview | null) => void;
}) {
  const env = usePlanEnv();
  const { t, tables, zones } = env;
  // Where the form started, so the tablet can tell an untouched form from a draft.
  const [start] = useState(() => ({
    prefix: firstFreePrefix(zones),
    seats: mostCommonCapacity(tables.filter((table) => inRoom(table, initialRoom))),
  }));
  const [choice, setChoice] = useState<Choice>(initialRoom);
  const [zoneName, setZoneName] = useState('');
  const [zonePrefix, setZonePrefix] = useState(start.prefix);
  const [countText, setCountText] = useState(String(initialCount));
  const [seats, setSeats] = useState(start.seats);
  const [open, setOpen] = useState(true);
  const [errors, setErrors] = useState<{ name?: string | null; prefix?: string | null }>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // A zone that vanished on a reload drops back to ไม่มีโซน.
  useEffect(() => {
    if (typeof choice === 'number' && !zones.some((zone) => zone.ID === choice)) setChoice('none');
  }, [choice, zones]);

  const numberingZone: NumberingZone = useMemo(() => {
    if (choice === 'none') return null;
    if (choice === 'new') return { ID: 0, prefix: zonePrefix };
    return zones.find((zone) => zone.ID === choice) ?? null;
  }, [choice, zonePrefix, zones]);

  const count = stepperValue(countText, TABLE_COUNT_RANGE.min, TABLE_COUNT_RANGE.max);
  const labels = useMemo(() => nextTableLabels(tables, numberingZone, count ?? TABLE_COUNT_RANGE.min), [count, numberingZone, tables]);
  const preview = compressLabelRuns(labels);

  const dirty = choice !== initialRoom
    || countText !== String(initialCount)
    || seats !== start.seats
    || !open
    || zoneName.trim() !== ''
    || zonePrefix !== start.prefix;
  const { setDirty } = env;
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  useEffect(() => {
    if (!onPreview) return undefined;
    onPreview(choice === 'new' || count === null ? null : { room: choice, labels });
    return undefined;
  }, [choice, count, labels, onPreview]);
  useEffect(() => () => onPreview?.(null), [onPreview]);

  const initialZoneId = typeof initialRoom === 'number' ? initialRoom : null;
  const options = [
    { key: 'none' as RoomKey, label: t('ไม่มีโซน', 'No zone') },
    ...zoneChoices(zones, typeof choice === 'number' ? choice : initialZoneId).map((zone) => ({ key: zone.ID as RoomKey, label: zone.name })),
  ];

  const pickRoom = (room: RoomKey) => {
    setChoice(room);
    setSeats(mostCommonCapacity(tables.filter((table) => inRoom(table, room))));
  };

  const run = async (amount: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    env.setBusy(true);
    const settle = () => {
      busyRef.current = false;
      setBusy(false);
      env.setBusy(false);
    };

    let zoneId: number | null = typeof choice === 'number' ? choice : null;
    if (choice === 'new') {
      const created = await env.api.createZone({ name: zoneName.trim(), prefix: zonePrefix, display_order: nextZoneDisplayOrder(zones), is_active: true });
      if (!created.ok) {
        settle();
        const { failure } = created;
        const words = failure.message ?? failure.title;
        if (failure.field === 'name') setErrors({ name: words });
        else if (failure.field === 'prefix') setErrors({ prefix: words });
        else env.report(failure);
        return;
      }
      // From here the new zone is an ordinary chip: a retry after the tables
      // fail creates only the tables.
      env.setZones((current) => [...current, created.value]);
      setChoice(created.value.ID);
      zoneId = created.value.ID;
    }

    const before = tables;
    const result = await env.api.addTables({ zone_id: zoneId, count: amount, capacity: seats, status: open ? 'free' : 'inactive' });
    settle();
    if (!result.ok) {
      env.report(result.failure);
      if (result.failure.code === 'zone_missing') setChoice('none');
      return;
    }
    const all = result.value.tables ?? [];
    env.setTables(all);
    onDone(newTablesSince(before, all));
  };

  const submit = () => {
    if (busyRef.current || count === null) return;
    if (choice === 'new') {
      const nextErrors = {
        name: zoneName.trim() ? null : t('ใส่ชื่อโซน', 'Enter a zone name'),
        prefix: zonePrefix ? null : t('ใส่คำนำหน้า', 'Enter a prefix'),
      };
      setErrors(nextErrors);
      if (nextErrors.name || nextErrors.prefix) return;
    }
    if (count >= CONFIRM_FROM) {
      Alert.alert(t(`เพิ่ม ${count} โต๊ะ?`, `Add ${count} tables?`), preview, [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: t('เพิ่ม', 'Add'), onPress: () => { void run(count); } },
      ]);
      return;
    }
    void run(count);
  };

  return (
    <BodyFrame
      chrome={chrome}
      footer={<PlanButton disabled={count === null} label={t('เพิ่มโต๊ะ', 'Add tables')} loading={busy} onPress={submit} />}
      title={t('เพิ่มโต๊ะ', 'Add tables')}
    >
      <CountBlock
        decreaseLabel={t('ลดจำนวนโต๊ะ', 'Fewer tables')}
        increaseLabel={t('เพิ่มจำนวนโต๊ะ', 'More tables')}
        label={t('จำนวนโต๊ะ', 'Number of tables')}
        max={TABLE_COUNT_RANGE.max}
        min={TABLE_COUNT_RANGE.min}
        onChangeText={(text) => {
          const next = stepperValue(text, TABLE_COUNT_RANGE.min, TABLE_COUNT_RANGE.max);
          setCountText(next === null ? '' : String(next));
        }}
        preview={preview}
        text={countText}
        unit={t('โต๊ะ', count === 1 ? 'table' : 'tables')}
        value={count}
      />
      <GroupCard>
        <KitBlock first title={t('โซน', 'Zone')}>
          <ZoneChips
            newChip={{ label: t('โซนใหม่', 'New zone'), on: choice === 'new', onPress: () => setChoice('new') }}
            onChange={pickRoom}
            options={options}
            value={choice === 'new' ? null : choice}
          />
          {choice === 'new' ? (
            <View style={{ gap: 10 }}>
              <KitField
                error={errors.name}
                label={t('ชื่อโซน', 'Zone name')}
                maxLength={ZONE_NAME_MAX}
                onChangeText={(text) => {
                  setZoneName(text);
                  if (errors.name) setErrors((current) => ({ ...current, name: null }));
                }}
                returnKeyType="done"
                value={zoneName}
              />
              <KitField
                autoCapitalize="characters"
                error={errors.prefix}
                label={t('คำนำหน้า', 'Prefix')}
                maxLength={ZONE_PREFIX_MAX}
                onChangeText={(text) => {
                  setZonePrefix(normalizeZonePrefix(text));
                  if (errors.prefix) setErrors((current) => ({ ...current, prefix: null }));
                }}
                returnKeyType="done"
                unit={zonePrefix ? tableLabel({ ID: 0, prefix: zonePrefix }, 1) : undefined}
                value={zonePrefix}
              />
            </View>
          ) : null}
        </KitBlock>
        <KitRow title={t('ที่นั่งต่อโต๊ะ', 'Seats per table')}>
          <CompactStepper
            decreaseLabel={t('ลดที่นั่ง', 'Fewer seats')}
            increaseLabel={t('เพิ่มที่นั่ง', 'More seats')}
            label={t('ที่นั่งต่อโต๊ะ', 'Seats per table')}
            max={TABLE_CAPACITY_RANGE.max}
            min={TABLE_CAPACITY_RANGE.min}
            onChange={setSeats}
            value={seats}
          />
        </KitRow>
        <SwitchRow onChange={setOpen} title={t('เปิดใช้งาน', 'Open')} value={open} />
      </GroupCard>
    </BodyFrame>
  );
}
