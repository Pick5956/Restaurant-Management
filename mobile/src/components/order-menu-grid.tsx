import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { MenuImage } from '@/src/components/menu-image';
import { EmptyState, IconButton, SearchField, SectionHeader, Select } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { isMenuSoldOut, menuGridColumns, type MenuCatalogGroup } from '@/src/lib/menu-catalog';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, radius, spacing, typeScale } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';

// The narrowest a tile gets before the row drops a column.
const TABLET_TILE_MIN_WIDTH = 150;

type OrderMenuGridProps = {
  groups: MenuCatalogGroup<MenuItem>[];
  /** Per-dish count for the badge; a dish absent or at 0 shows none. */
  countByMenu: ReadonlyMap<number, number>;
  /** Size the tiles from the grid's own measured width instead of the phone's
   *  fixed two columns. On a tablet the grid shares the screen with the dish
   *  panel, so the window says nothing about how wide it is. */
  tabletWorkspace: boolean;
  onPressItem: (item: MenuItem) => void;
  accessibilityLabelFor: (item: MenuItem, count: number) => string;
};

type OrderMenuFilterBarProps = {
  categories: readonly Category[];
  categoryId: string;
  onCategoryChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchOpen: boolean;
  onOpenSearch: () => void;
  /** Given on a tablet, where the grid under an open search stays live - its
   *  results are what gets tapped - so the search closes from a button in the
   *  magnifier's place instead of from a tap anywhere else. */
  onCloseSearch?: () => void;
};

/**
 * Pinned with the heading rather than scrolled with the grid: a filter that
 * has scrolled off screen cannot be changed without scrolling back for it.
 * One row, not two - the category picker and a magnifier share it, and the
 * search field takes the picker's place only while it is being used.
 */
export function OrderMenuFilterBar({
  categories,
  categoryId,
  onCategoryChange,
  search,
  onSearchChange,
  searchOpen,
  onOpenSearch,
  onCloseSearch,
}: OrderMenuFilterBarProps) {
  const { copy } = useDisplayPreferences();
  if (searchOpen) {
    const field = (
      <SearchField
        accessibilityLabel={copy('ค้นหาเมนู', 'Search menu')}
        autoFocus
        clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
        value={search}
        onChangeText={onSearchChange}
        placeholder={copy('ค้นหาเมนู', 'Search menu')}
      />
    );
    // No close button on a phone: while this is up the whole screen is a
    // dismiss target, so a dedicated one would only be in the way of the field
    // it sits beside.
    if (!onCloseSearch) return field;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ minWidth: 0, flex: 1 }}>{field}</View>
        <IconButton
          accessibilityLabel={copy('ปิดการค้นหา', 'Close search')}
          icon="close"
          onPress={onCloseSearch}
          variant="glass"
        />
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ minWidth: 0, flex: 1 }}>
        <Select
          value={categoryId}
          onChange={onCategoryChange}
          options={[{ label: copy('ทั้งหมด', 'All'), value: 'all' }, ...categories.filter((item) => item.is_active).map((item) => ({ label: item.name, value: String(item.ID) }))]}
        />
      </View>
      <IconButton
        accessibilityLabel={copy('ค้นหาเมนู', 'Search menu')}
        icon="search-outline"
        onPress={onOpenSearch}
        variant="glass"
      />
    </View>
  );
}

/**
 * The dish grid of the order screen, category by category. The served-item
 * page renders the same grid, so the two cannot drift apart.
 */
export function OrderMenuGrid({
  groups,
  countByMenu,
  tabletWorkspace,
  onPressItem,
  accessibilityLabelFor,
}: OrderMenuGridProps) {
  const { copy, language } = useDisplayPreferences();
  const [gridWidth, setGridWidth] = useState(0);
  const { tileWidth } = menuGridColumns(gridWidth, TABLET_TILE_MIN_WIDTH, spacing.md);

  if (!groups.length) {
    return <EmptyState title={copy('ไม่พบเมนู', 'No menu items found')} detail={copy('ลองเปลี่ยนหมวดหรือคำค้น', 'Try another category or search.')} />;
  }

  return (
    <View
      onLayout={tabletWorkspace ? (event) => setGridWidth(Math.floor(event.nativeEvent.layout.width)) : undefined}
      style={{ gap: spacing.md }}
    >
      {/* Nothing until the tablet grid knows its width: one frame of empty
          column beats a frame of tiles at a guessed size snapping to the real one. */}
      {tabletWorkspace && !tileWidth ? null : groups.map((group) => (
        <View key={group.key} style={{ gap: spacing.md }}>
          <SectionHeader title={group.label} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            {group.items.map((item) => {
              const count = countByMenu.get(item.ID) ?? 0;
              // Switched off OR out of stock: either way the tile greys out and
              // takes no tap, instead of opening a dish that cannot be added.
              const soldOut = isMenuSoldOut(item);
              return (
                <Pressable
                  accessibilityLabel={soldOut ? copy(`${item.name} หมด`, `${item.name}, sold out`) : accessibilityLabelFor(item, count)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: soldOut }}
                  key={item.ID}
                  disabled={soldOut}
                  onPress={() => onPressItem(item)}
                  style={({ pressed }) => ({
                    // An exact width on both: two columns on a phone, and on a
                    // tablet as many as the measured column holds, filling it edge
                    // to edge. A grow factor here fights the column width and
                    // stretches a lone tile on the last row across the screen,
                    // which reads as a different, more important dish than the rest.
                    width: tabletWorkspace ? tileWidth : '48%',
                    flexGrow: 0,
                    gap: spacing.sm,
                    borderRadius: radius.md,
                    backgroundColor: 'transparent',
                    opacity: soldOut ? 0.48 : pressed ? 0.72 : 1,
                    transform: [{ translateY: pressed ? 1 : 0 }],
                  })}
                >
                  {/* The badge sits outside the image frame, which clips to its
                      rounded corners. Same place as the web POS tile - top right -
                      but the bare number in a white circle with a soft orange ring,
                      the owner's pick on 15 Sep. */}
                  <View>
                    <MenuImage
                      accessibilityLabel={copy(`รูปเมนู ${item.name}`, `Photo of ${item.name}`)}
                      imageUrl={item.image_url}
                      variant="card"
                    />
                    {count > 0 ? (
                      <View
                        pointerEvents="none"
                        style={{
                          position: 'absolute',
                          top: spacing.sm,
                          right: spacing.sm,
                          // A true circle for any count a round can hold; the
                          // minimum width only gives way past three digits.
                          minWidth: 34,
                          height: 34,
                          paddingHorizontal: 2,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: radius.full,
                          borderWidth: 2,
                          // The softer control orange the category select uses, a
                          // step down from the brand orange the number keeps.
                          borderColor: palette.controlBorder,
                          backgroundColor: palette.surface,
                          // An even glow on every side, the owner's pick over a
                          // dropped shadow. Stronger than `controlShadow`, which
                          // vanished against the pale placeholder art behind it.
                          boxShadow: '0 0 2px rgba(61, 43, 31, 0.18), 0 0 8px rgba(61, 43, 31, 0.24)',
                        }}
                      >
                        {/* Capped scaling keeps the count inside its circle; the
                            tile's accessibility label already speaks the number. */}
                        <Text maxFontSizeMultiplier={1.2} style={{ color: palette.primary, fontSize: 13, fontWeight: '800', lineHeight: 18, fontVariant: ['tabular-nums'] }}>
                          {count}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {/* No reserved height on the name: it forced a second empty line
                      under every one-line dish, which is what pushed the price so
                      far from it. Prices in a row can now sit at different heights,
                      which is the trade for having name and price read as one pair. */}
                  <View style={{ gap: 2, paddingHorizontal: spacing.xs, paddingBottom: spacing.sm }}>
                    <Text selectable numberOfLines={2} style={[typeScale.cardTitle, { fontWeight: '600' }]}>{item.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Text selectable style={[typeScale.number, { flex: 1, fontSize: 15, fontWeight: '600' }]}>{money(item.price, language)}</Text>
                      {/* A plain grey word, no chip: no dot, no red frame. The tile
                          is already greyed out, and a red badge made "sold out" the
                          loudest thing on a tile nobody can use. Owner, 2026-09-19. */}
                      {soldOut ? (
                        <Text selectable style={[typeScale.caption, { flexShrink: 0, color: palette.neutral, fontWeight: '600' }]}>
                          {copy('หมด', 'Sold out')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
