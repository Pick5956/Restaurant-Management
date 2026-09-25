import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { CompactStepper } from '@/src/components/table-plan/count-stepper';
import { alertBulkPartial, BULK_LIMIT, bulkDoneWords, runBulk, type BulkResult } from '@/src/components/table-plan/plan-bulk';
import { adoptMovedRow, animateFloorChange, mergeTableRow, usePlanEnv } from '@/src/components/table-plan/plan-context';
import { BodyFrame, ChoiceMark, GroupCard, KitAction, KitRow, PlanButton, type BodyChrome } from '@/src/components/table-plan/sheet-kit';
import type { BulkVerb } from '@/src/lib/table-error';
import {
  bulkMoveLabels,
  compressLabelRuns,
  floorOrder,
  mostCommonCapacity,
  roomName,
  TABLE_CAPACITY_RANGE,
  tableLocked,
  tableZoneId,
  zoneChoices,
  type PlanLanguage,
  type RoomKey,
} from '@/src/lib/table-plan';
import { tableEditorSaveStatus } from '@/src/lib/table-workflow';
import { palette } from '@/src/theme';
import type { RestaurantTable, TableZone } from '@/src/types/table';

// What the selection dock opens: moving the chosen tables to another zone, and
// the ⋯ actions (seats for all of them, or deleting them). A table in service
// is never among them - the floor does not let one be picked - and if a reload
// locked one after it was picked, it is left out here as well.

const CLASH_INK = '#B91C1C';

export type BulkFinish = {
  /** The tables that went through, for the flash. */
  doneIds: number[];
  /** The tables that did not: they stay selected. */
  failedIds: number[];
  /** What a screen reader hears when every table went through: "ลบ 5 โต๊ะแล้ว". */
  announcement: string | null;
};

function finished(verb: BulkVerb, doneIds: number[], failedIds: number[], language: PlanLanguage): BulkFinish {
  return { doneIds, failedIds, announcement: doneIds.length ? bulkDoneWords(verb, doneIds.length, language) : null };
}

function useMovers(selectedIds: ReadonlySet<number>) {
  const env = usePlanEnv();
  return useMemo(
    () => floorOrder(env.tables, env.zones).filter((table) => selectedIds.has(table.ID) && !tableLocked(table, env.activeOrderIds)),
    [env.activeOrderIds, env.tables, env.zones, selectedIds],
  );
}

type Destination = { key: RoomKey; zone: TableZone | null; name: string; labels: string; clash: string | null };

export function BulkMoveBody({ chrome, selectedIds, onFinished }: {
  chrome: BodyChrome;
  selectedIds: ReadonlySet<number>;
  onFinished: (result: BulkFinish) => void;
}) {
  const env = usePlanEnv();
  const { t, language, tables, zones, activeOrderIds } = env;
  const movers = useMovers(selectedIds);
  const [choice, setChoice] = useState<RoomKey | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const busyRef = useRef(false);

  const destinations = useMemo<Destination[]>(() => {
    const ordered = floorOrder(tables, zones);
    const ids = movers.map((table) => table.ID);
    const options: { key: RoomKey; zone: TableZone | null }[] = [
      { key: 'none', zone: null },
      ...zoneChoices(zones, null).map((zone) => ({ key: zone.ID as RoomKey, zone })),
    ];
    return options.flatMap(({ key, zone }) => {
      const plan = bulkMoveLabels(ordered, ids, zone, activeOrderIds);
      // A zone that already holds every mover is not a destination.
      if (plan.moves.length === 0) return [];
      return [{
        key,
        zone,
        name: roomName({ zone }, language),
        labels: compressLabelRuns(plan.moves.map((move) => move.to)),
        clash: plan.firstClash,
      }];
    });
  }, [activeOrderIds, language, movers, tables, zones]);

  const chosen = destinations.find((item) => item.key === choice && !item.clash) ?? null;

  const run = async () => {
    if (busyRef.current || !chosen) return;
    busyRef.current = true;
    env.setBusy(true);
    const target = chosen.zone;
    // Movers already in the target are left alone: the server would renumber them anyway.
    const moving = movers.filter((table) => (target ? tableZoneId(table) !== target.ID : tableZoneId(table) !== null));
    setProgress(`0/${moving.length}`);
    // One at a time, in floor order: each move takes the next number in the zone.
    const result: BulkResult<RestaurantTable> = await runBulk(
      moving,
      1,
      (table) => env.api.moveTable(table.ID, target ? target.ID : null),
      (_table, outcome) => {
        if (!outcome.ok) return;
        animateFloorChange(tables.length);
        env.setTables((current) => adoptMovedRow(current, outcome.value, target));
      },
      (done, total) => setProgress(`${done}/${total}`),
    );
    busyRef.current = false;
    env.setBusy(false);
    setProgress(null);
    if (result.failed.length) {
      alertBulkPartial('move', moving.length, result.failed, language);
      if (result.failed.some(({ failure }) => failure.reload === 'plan')) void env.reload();
    }
    onFinished(finished('move', result.done.map(({ table }) => table.ID), result.failed.map(({ table }) => table.ID), language));
  };

  return (
    <BodyFrame
      chrome={chrome}
      footer={<PlanButton disabled={!chosen} label={t('ย้าย', 'Move')} loading={progress !== null} onPress={() => { void run(); }} progress={progress} />}
      title={t('ย้ายไปโซน', 'Move to zone')}
    >
      <GroupCard>
        {destinations.map((item, index) => {
          const on = item.key === choice;
          return (
            <Pressable
              accessibilityLabel={item.clash ? `${item.name}, ${t(`${item.clash} ซ้ำกับโต๊ะอื่น`, `${item.clash} is taken`)}` : `${item.name}, ${item.labels}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: Boolean(item.clash) }}
              disabled={Boolean(item.clash)}
              key={String(item.key)}
              onPress={() => setChoice(item.key)}
              style={({ pressed }) => ({ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: '#F3EDE7', backgroundColor: pressed ? palette.surfaceSubtle : palette.surface })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 22, fontWeight: '600', color: palette.textStrong }}>{item.name}</Text>
                <Text
                  ellipsizeMode="middle"
                  numberOfLines={1}
                  style={{ fontSize: 12.5, lineHeight: 18, fontWeight: item.clash ? '600' : '400', color: item.clash ? CLASH_INK : palette.placeholder, fontVariant: ['tabular-nums'] }}
                >
                  {item.clash ? t(`${item.clash} ซ้ำกับโต๊ะอื่น`, `${item.clash} is taken`) : item.labels}
                </Text>
              </View>
              {item.clash ? null : <ChoiceMark on={on} />}
            </Pressable>
          );
        })}
      </GroupCard>
    </BodyFrame>
  );
}

export function BulkMoreBody({ chrome, selectedIds, onFinished }: {
  chrome: BodyChrome;
  selectedIds: ReadonlySet<number>;
  onFinished: (result: BulkFinish) => void;
}) {
  const env = usePlanEnv();
  const { t, language, tables } = env;
  const targets = useMovers(selectedIds);
  const [mode, setMode] = useState<'menu' | 'seats'>('menu');
  const [seats, setSeats] = useState(() => mostCommonCapacity(targets));
  const [progress, setProgress] = useState<string | null>(null);
  const busyRef = useRef(false);

  const begin = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    env.setBusy(true);
    return true;
  };
  const settle = () => {
    busyRef.current = false;
    env.setBusy(false);
    setProgress(null);
  };

  const save = async (list: readonly RestaurantTable[], status: (table: RestaurantTable) => RestaurantTable['status'], capacity: (table: RestaurantTable) => number) => runBulk(
    list,
    BULK_LIMIT,
    (table) => env.api.saveTable(table.ID, { zone_id: tableZoneId(table), capacity: capacity(table), status: status(table) }),
    (_table, outcome) => {
      if (outcome.ok) env.setTables((current) => mergeTableRow(current, outcome.value));
    },
    (done, total) => setProgress(`${done}/${total}`),
  );

  const setAllSeats = async () => {
    if (!begin()) return;
    const list = targets;
    const result = await save(list, (table) => tableEditorSaveStatus(table.status, table.status), () => seats);
    settle();
    if (result.failed.length) {
      alertBulkPartial('seats', list.length, result.failed, language);
      if (result.failed.some(({ failure }) => failure.reload === 'plan')) void env.reload();
    }
    onFinished(finished('seats', result.done.map(({ table }) => table.ID), result.failed.map(({ table }) => table.ID), language));
  };

  /**
   * The tables a delete was refused for because they have order history, closed
   * instead. Any other refusal (a booking, a table gone into service) stays
   * selected alongside the ones that could not be closed either.
   */
  const closeInstead = async (list: RestaurantTable[], deletedIds: number[], otherFailedIds: number[]) => {
    if (!begin()) return;
    const result = await save(list, () => 'inactive', (table) => table.capacity);
    settle();
    if (result.failed.length) alertBulkPartial('close', list.length, result.failed, language);
    const closedIds = result.done.map(({ table }) => table.ID);
    onFinished({
      doneIds: [...deletedIds, ...closedIds],
      failedIds: [...otherFailedIds, ...result.failed.map(({ table }) => table.ID)],
      announcement: closedIds.length ? bulkDoneWords('close', closedIds.length, language) : null,
    });
  };

  const removeAll = async () => {
    if (!begin()) return;
    // The list shrinks as the rows go: the report counts the tables asked for.
    const list = targets;
    setProgress(`0/${list.length}`);
    const result = await runBulk(
      list,
      1,
      (table) => env.api.removeTable(table.ID),
      (table, outcome) => {
        if (!outcome.ok) return;
        animateFloorChange(tables.length);
        env.setTables((current) => current.filter((item) => item.ID !== table.ID));
      },
      (done, total) => setProgress(`${done}/${total}`),
    );
    settle();
    const deletedIds = result.done.map(({ table }) => table.ID);
    if (!result.failed.length) {
      onFinished(finished('delete', deletedIds, [], language));
      return;
    }
    if (result.failed.some(({ failure }) => failure.reload === 'plan')) void env.reload();
    const withHistory = result.failed.filter(({ failure }) => failure.offerDeactivate).map(({ table }) => table);
    const otherFailedIds = result.failed.filter(({ failure }) => !failure.offerDeactivate).map(({ table }) => table.ID);
    const finish = () => onFinished(finished('delete', deletedIds, result.failed.map(({ table }) => table.ID), language));
    alertBulkPartial('delete', list.length, result.failed, language, withHistory.length ? [
      { text: t('ตกลง', 'OK'), style: 'cancel', onPress: finish },
      { text: t('ปิดใช้งานแทน', 'Close them instead'), onPress: () => { void closeInstead(withHistory, deletedIds, otherFailedIds); } },
    ] : [{ text: t('ตกลง', 'OK'), onPress: finish }]);
  };

  const askRemove = () => {
    if (busyRef.current || targets.length === 0) return;
    Alert.alert(t(`ลบ ${targets.length} โต๊ะ?`, `Delete ${targets.length} tables?`), undefined, [
      { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
      { text: t('ลบ', 'Delete'), style: 'destructive', onPress: () => { void removeAll(); } },
    ]);
  };

  if (mode === 'seats') {
    return (
      <BodyFrame
        chrome={chrome}
        footer={<PlanButton disabled={targets.length === 0} label={t('บันทึก', 'Save')} loading={progress !== null} onPress={() => { void setAllSeats(); }} progress={progress} />}
        title={t('ตั้งจำนวนที่นั่ง', 'Set seats')}
      >
        <GroupCard>
          <KitRow first title={t('ที่นั่ง', 'Seats')}>
            <CompactStepper
              decreaseLabel={t('ลดที่นั่ง', 'Fewer seats')}
              increaseLabel={t('เพิ่มที่นั่ง', 'More seats')}
              label={t('ที่นั่ง', 'Seats')}
              max={TABLE_CAPACITY_RANGE.max}
              min={TABLE_CAPACITY_RANGE.min}
              onChange={setSeats}
              value={seats}
            />
          </KitRow>
        </GroupCard>
      </BodyFrame>
    );
  }

  return (
    <BodyFrame chrome={chrome}>
      <GroupCard>
        <KitAction disabled={progress !== null} first icon="people-outline" label={t('ตั้งจำนวนที่นั่ง', 'Set seats')} onPress={() => setMode('seats')} />
        <KitAction
          danger
          disabled={progress !== null}
          icon="trash-outline"
          label={progress ? `${t('ลบโต๊ะที่เลือก', 'Delete selected')} ${progress}` : t('ลบโต๊ะที่เลือก', 'Delete selected')}
          onPress={askRemove}
        />
      </GroupCard>
    </BodyFrame>
  );
}
