import { useEffect, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { GhostTile, PlanTile, PreviewGhost, tileGeometry, type PlanHighlight } from '@/src/components/table-plan/plan-tile';
import {
  PLAN_TILE_LABEL_FONT,
  planLabel,
  planStatus,
  roomName,
  roomValue,
  tableLocked,
  type ActiveOrderIds,
  type PlanLanguage,
  type PlanRoom,
  type RoomKey,
} from '@/src/lib/table-plan';
import { ghostSpan, PLAN_TILE_GAP, type GridMetrics } from '@/src/lib/table-plan-screen';
import { palette } from '@/src/theme';
import type { RestaurantTable } from '@/src/types/table';

// The floor in setup mode: one section per room, in the server's order, each a
// header and a grid of setup tiles ending in the ghost add tile.

/**
 * Every label measured once at the full tile size, never seen or heard, so the
 * grid can pick the one size the widest fits at. Unique labels only.
 */
export function LabelRuler({ labels, onWidest }: { labels: readonly string[]; onWidest: (width: number) => void }) {
  const widths = useRef(new Map<string, number>());
  const unique = useMemo(() => Array.from(new Set(labels)), [labels]);
  const onWidestRef = useRef(onWidest);
  onWidestRef.current = onWidest;
  const report = () => {
    const widest = Math.max(0, ...unique.map((label) => widths.current.get(label) ?? 0));
    onWidestRef.current(widest);
  };
  useEffect(() => {
    report();
    // Re-read when the set of labels changes; a label measured before keeps its width.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unique]);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, opacity: 0, alignItems: 'flex-start' }}>
      {unique.map((label) => (
        <Text
          key={label}
          numberOfLines={1}
          onLayout={(event) => {
            widths.current.set(label, event.nativeEvent.layout.width);
            report();
          }}
          style={{ fontSize: PLAN_TILE_LABEL_FONT, lineHeight: Math.round(PLAN_TILE_LABEL_FONT * 1.6), fontWeight: '700', fontVariant: ['tabular-nums'] }}
        >
          {label}
        </Text>
      ))}
    </View>
  );
}

export type FloorHandlers = {
  onTilePress: (table: RestaurantTable) => void;
  onTileLongPress: (table: RestaurantTable) => void;
  onRoomPress: (room: PlanRoom) => void;
  onRoomToggle: (room: PlanRoom) => void;
  onAdd: (room: PlanRoom) => void;
};

function RoomCheck({ state }: { state: 'all' | 'some' | 'none' }) {
  const on = state === 'all';
  return (
    <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 0 : 1.5, borderColor: state === 'some' ? palette.primary : '#E4D8CD', backgroundColor: on ? palette.primary : '#ffffff' }}>
      {on ? <AppIcon color="#ffffff" name="checkmark" size={15} /> : state === 'some' ? <View style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: palette.primary }} /> : null}
    </View>
  );
}

export function RoomSection({
  room,
  first,
  showValue,
  canManage,
  selecting,
  selected,
  activeOrderIds,
  metrics,
  labelFontSize,
  language,
  t,
  focusedTableId,
  highlights,
  reveal,
  showGhost,
  ghostPulse,
  previewLabels,
  handlers,
  onLayoutY,
  scrollTargetId,
  onTargetLayout,
}: {
  room: PlanRoom;
  first: boolean;
  /** Dropped when the shop has one room: the summary card already says it. */
  showValue: boolean;
  canManage: boolean;
  selecting: boolean;
  selected: ReadonlySet<number>;
  activeOrderIds: ActiveOrderIds;
  metrics: GridMetrics;
  labelFontSize: number;
  language: PlanLanguage;
  t: (th: string, en: string) => string;
  focusedTableId: number | null;
  highlights: ReadonlyMap<number, PlanHighlight>;
  reveal: ReadonlyMap<number, number>;
  showGhost: boolean;
  ghostPulse?: number;
  previewLabels: readonly string[] | null;
  handlers: FloorHandlers;
  onLayoutY: (key: RoomKey, y: number) => void;
  /** A tile the floor wants to scroll to once it has landed. */
  scrollTargetId?: number | null;
  /** Where that tile is, from the top of this room. */
  onTargetLayout?: (y: number) => void;
}) {
  const name = roomName(room, language);
  // The lock: only tables that are not in service count for the room's check.
  const eligible = room.tables.filter((table) => !tableLocked(table, activeOrderIds));
  const chosen = eligible.filter((table) => selected.has(table.ID)).length;
  const checkState: 'all' | 'some' | 'none' = eligible.length > 0 && chosen === eligible.length ? 'all' : chosen > 0 ? 'some' : 'none';
  const realZone = room.zone !== null;
  // ไม่มีโซน is never edited; in selection any room with a table to pick toggles.
  const pressable = selecting ? eligible.length > 0 : canManage && realZone;
  const value = showValue ? roomValue(room, language) : null;
  const gridYRef = useRef(0);
  const single = tileGeometry(metrics);
  const previews = previewLabels ?? [];
  const span = ghostSpan(room.tables.length + previews.length, metrics.columns);

  return (
    <View onLayout={(event) => onLayoutY(room.key, event.nativeEvent.layout.y)} style={{ marginTop: first ? 0 : 28, gap: 10 }}>
      <Pressable
        accessibilityLabel={value ? `${name}, ${value}` : name}
        accessibilityRole={pressable ? (selecting ? 'checkbox' : 'button') : 'header'}
        accessibilityState={selecting && pressable ? { checked: checkState === 'all' ? true : checkState === 'some' ? 'mixed' : false } : undefined}
        disabled={!pressable}
        onPress={() => (selecting ? handlers.onRoomToggle(room) : handlers.onRoomPress(room))}
        style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 12, borderCurve: 'continuous', backgroundColor: pressed ? palette.surfaceSubtle : 'transparent' })}
      >
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.textStrong }}>{name}</Text>
        {value ? <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: 12.5, lineHeight: 18, fontWeight: '500', color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{value}</Text> : null}
        <View style={{ flex: 1 }} />
        {selecting ? (
          eligible.length > 0 ? <RoomCheck state={checkState} /> : null
        ) : canManage && realZone ? (
          <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
            <AppIcon color={palette.primaryInk} name="create-outline" size={16} />
          </View>
        ) : null}
      </Pressable>
      <View
        onLayout={(event) => {
          gridYRef.current = event.nativeEvent.layout.y;
        }}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: PLAN_TILE_GAP }}
      >
        {room.tables.map((table) => {
          const locked = tableLocked(table, activeOrderIds);
          return (
            <PlanTile
              focused={focusedTableId === table.ID}
              geometry={single}
              highlight={highlights.get(table.ID) ?? null}
              interactive={canManage}
              key={table.ID}
              labelFontSize={labelFontSize}
              language={language}
              locked={locked}
              onLayout={scrollTargetId === table.ID && onTargetLayout ? (y) => onTargetLayout(gridYRef.current + y) : undefined}
              // A table in service is never a way into selection.
              onLongPress={canManage && !locked && !selecting ? () => handlers.onTileLongPress(table) : undefined}
              onPress={canManage ? () => handlers.onTilePress(table) : undefined}
              revealDelay={reveal.get(table.ID) ?? null}
              selected={selected.has(table.ID)}
              selecting={selecting}
              status={planStatus(table, activeOrderIds)}
              table={table}
            />
          );
        })}
        {previews.map((label) => (
          <PreviewGhost geometry={single} key={`preview-${label}`} label={label} labelFontSize={labelFontSize} />
        ))}
        {showGhost ? (
          <GhostTile
            accessibilityLabel={room.zone ? t(`เพิ่มโต๊ะใน ${name}`, `Add tables to ${name}`) : t('เพิ่มโต๊ะ ไม่มีโซน', 'Add tables, no zone')}
            geometry={tileGeometry(metrics, span)}
            label={t('เพิ่มโต๊ะ', 'Add tables')}
            onPress={() => handlers.onAdd(room)}
            pulseToken={ghostPulse}
            wide={span > 1}
          />
        ) : null}
      </View>
    </View>
  );
}

/** The one way to add a room, after the last one. The hub shelf chip's look. */
export function AddRoomChip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ marginTop: 24, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderCurve: 'continuous', backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface }}>
        <AppIcon color={palette.primaryInk} name="add" size={20} />
      </View>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500', color: palette.textStrong }}>{label}</Text>
    </Pressable>
  );
}

/** Every label on the floor, for the ruler. */
export function floorLabels(tables: readonly RestaurantTable[]): string[] {
  return tables.map(planLabel);
}
