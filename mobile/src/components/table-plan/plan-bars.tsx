import { Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { FilterChipRow } from '@/src/components/filter-chip-row';
import { ActionDock, Button, IconButton, SearchField } from '@/src/components/ui';
import { roomName, type PlanLanguage, type PlanRoom, type RoomKey } from '@/src/lib/table-plan';
import { palette, spacing } from '@/src/theme';

// The bars around the floor: the pinned room picker and search (the order-
// taking floor's own bar), the selection bar that replaces it, the selection
// dock, and the header's "เลือก" / "เสร็จ".

export type RoomFilter = RoomKey | 'all';

/** The search appears on its own once a single-room shop has this many tables. */
export const SEARCH_ALONE_FROM = 13;

export function roomFilterValue(filter: RoomFilter): string {
  return filter === 'all' || filter === 'none' ? filter : String(filter);
}

export function parseRoomFilter(value: string): RoomFilter {
  if (value === 'all' || value === 'none') return value;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 'all';
}

export function FilterBar({ rooms, room, onRoom, searchOpen, onOpenSearch, query, onQuery, tableCount, language, t }: {
  rooms: readonly PlanRoom[];
  room: RoomFilter;
  onRoom: (room: RoomFilter) => void;
  searchOpen: boolean;
  onOpenSearch: () => void;
  query: string;
  onQuery: (query: string) => void;
  tableCount: number;
  language: PlanLanguage;
  t: (th: string, en: string) => string;
}) {
  const search = (autoFocus: boolean) => (
    <SearchField
      accessibilityLabel={t('ค้นหาโต๊ะ', 'Search tables')}
      autoFocus={autoFocus}
      clearLabel={t('ล้างคำค้นหา', 'Clear search')}
      onChangeText={onQuery}
      placeholder={t('ค้นหาโต๊ะ', 'Search tables')}
      value={query}
    />
  );
  if (rooms.length >= 2) {
    if (searchOpen) return search(true);
    // The one filter row (FilterChipRow): the zones as chips, the magnifier at
    // the end - a dropdown until 2026-09-25.
    return (
      <FilterChipRow
        onChange={(value) => onRoom(parseRoomFilter(value))}
        options={[
          { key: 'all', label: t('ทุกโซน', 'All zones') },
          ...rooms.map((item) => ({ key: roomFilterValue(item.key), label: roomName(item, language) })),
        ]}
        trailing={<IconButton accessibilityLabel={t('ค้นหาโต๊ะ', 'Search tables')} icon="search-outline" onPress={onOpenSearch} variant="glass" />}
        value={roomFilterValue(room)}
      />
    );
  }
  if (tableCount >= SEARCH_ALONE_FROM) return search(false);
  return null;
}

function TextAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 44, minWidth: 46, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Text numberOfLines={1} style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: palette.primaryInk }}>{label}</Text>
    </Pressable>
  );
}

/** "เลือก" in the header, and "เสร็จ" while selecting. */
export function HeaderSelectAction({ selecting, onPress, t }: { selecting: boolean; onPress: () => void; t: (th: string, en: string) => string }) {
  return <TextAction label={selecting ? t('เสร็จ', 'Done') : t('เลือก', 'Select')} onPress={onPress} />;
}

export function SelectionBar({ count, allChosen, onToggleAll, language, t }: {
  count: number;
  allChosen: boolean;
  onToggleAll: () => void;
  language: PlanLanguage;
  t: (th: string, en: string) => string;
}) {
  const value = language === 'th' ? `${count.toLocaleString('en-US')} โต๊ะ` : `${count.toLocaleString('en-US')} ${count === 1 ? 'table' : 'tables'}`;
  return (
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 15, lineHeight: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <TextAction label={allChosen ? t('ไม่เลือก', 'Select none') : t('เลือกทั้งหมด', 'Select all')} onPress={onToggleAll} />
    </View>
  );
}

export function SelectionDock({ hasZones, availability, count, running, onMove, onAvailability, onMore, t }: {
  hasZones: boolean;
  /** 'close' when any chosen table is free, 'open' when every one is closed. */
  availability: 'close' | 'open' | null;
  count: number;
  /** A close or open is going through: the dock waits for it. */
  running: boolean;
  onMove: () => void;
  onAvailability: () => void;
  onMore: () => void;
  t: (th: string, en: string) => string;
}) {
  const none = count === 0;
  const availabilityLabel = availability === 'open' ? t('เปิดใช้งาน', 'Open') : t('ปิดใช้งาน', 'Close');
  return (
    <ActionDock>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {hasZones ? (
          <View style={{ flex: 1.3 }}>
            <Button disabled={none || running} icon="swap-horizontal-outline" label={t('ย้ายโซน', 'Move')} onPress={onMove} pill />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            disabled={none || availability === null}
            label={availabilityLabel}
            loading={running}
            onPress={onAvailability}
            pill
            variant={hasZones ? 'secondary' : 'primary'}
          />
        </View>
        <IconButton accessibilityLabel={t('ตัวเลือกเพิ่มเติม', 'More actions')} disabled={none || running} icon="ellipsis-horizontal" onPress={onMore} size={48} />
      </View>
    </ActionDock>
  );
}
