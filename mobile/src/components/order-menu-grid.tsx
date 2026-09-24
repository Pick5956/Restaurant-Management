import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { FilterChipRow } from '@/src/components/filter-chip-row';
import { MenuImage } from '@/src/components/menu-image';
import { MotionReveal } from '@/src/components/motion';
import { MenuCompactTile } from '@/src/components/order-menu/menu-compact-tile';
import { MenuListRow } from '@/src/components/order-menu/menu-list-row';
import { CountBadge, StockMark } from '@/src/components/order-menu/menu-tile-parts';
import { MenuViewToggle } from '@/src/components/order-menu/menu-view-toggle';
import { EmptyState, IconButton, SearchField, SectionHeader } from '@/src/components/ui';
import { formatTender } from '@/src/lib/cash-tender';
import { isMenuSoldOut, menuGridColumns, type MenuCatalogGroup } from '@/src/lib/menu-catalog';
import { compactColumns, type MenuViewMode } from '@/src/lib/menu-view-mode';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useMenuViewMode } from '@/src/storage/menu-view-store';
import { radius, spacing, typeScale } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';

// The narrowest a tile gets before the row drops a column.
const TABLET_TILE_MIN_WIDTH = 150;

// Tighter than the photo grid's gap: without photos the soft fills are what
// separate the tiles, and the point of the mode is fitting more of them.
const COMPACT_TILE_GAP = spacing.sm;

/**
 * Space between a category and the next, and under each category's heading.
 * The photo grid keeps what it always had. A list row pads itself top and
 * bottom, so its heading pulls in to stay nearer its own rows than the last
 * row of the category above; the compact tiles have no padding of their own,
 * so the categories open up instead.
 */
const SECTION_SPACING: Readonly<Record<MenuViewMode, { between: number; underHeading: number }>> = {
  grid: { between: spacing.md, underHeading: spacing.md },
  list: { between: spacing.md, underHeading: spacing.xs },
  compact: { between: spacing.lg, underHeading: spacing.sm },
};

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
 * One row, not two - the category chips, the layout button and a magnifier
 * share it (FilterChipRow, the pattern /menu, the floor and the table plan
 * use), and the search field takes the row over only while it is being used.
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
  const [viewMode, setViewMode] = useMenuViewMode();
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
    <FilterChipRow
      options={[{ key: 'all', label: copy('ทุกหมวด', 'All categories') }, ...categories.filter((item) => item.is_active).map((item) => ({ key: String(item.ID), label: item.name }))]}
      value={categoryId}
      onChange={onCategoryChange}
      // The layout button between the chips and the magnifier, so the
      // magnifier keeps the trailing edge it has always had under the thumb.
      trailing={(
        <>
          <MenuViewToggle value={viewMode} onChange={setViewMode} />
          <IconButton
            accessibilityLabel={copy('ค้นหาเมนู', 'Search menu')}
            icon="search-outline"
            onPress={onOpenSearch}
            variant="glass"
          />
        </>
      )}
    />
  );
}

type MenuPhotoTileProps = {
  item: MenuItem;
  count: number;
  soldOut: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  tabletWorkspace: boolean;
  tileWidth: number;
};

/** The big photo tile, the default layout. */
function MenuPhotoTile({ item, count, soldOut, onPress, accessibilityLabel, tabletWorkspace, tileWidth }: MenuPhotoTileProps) {
  const { copy, language } = useDisplayPreferences();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: soldOut }}
      disabled={soldOut}
      onPress={onPress}
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
          rounded corners. Same place as the web POS tile - top right. */}
      <View>
        <MenuImage
          accessibilityLabel={copy(`รูปเมนู ${item.name}`, `Photo of ${item.name}`)}
          imageUrl={item.image_url}
          variant="card"
        />
        {count > 0 ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: spacing.sm, right: spacing.sm }}>
            <CountBadge count={count} />
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
          {/* formatTender, not money(): the dish's price as its line on the
              bill will read it, satang included. */}
          <Text selectable style={[typeScale.number, { flex: 1, fontSize: 15, fontWeight: '600' }]}>{formatTender(item.price, language)}</Text>
          <StockMark item={item} soldOut={soldOut} />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The dish grid of the order screen, category by category, in the layout the
 * view button in the filter row last picked on this device: big photo tiles,
 * one dish per row, or photo-less compact tiles. The served-item page renders
 * the same grid, so the two cannot drift apart - and share the one layout.
 */
export function OrderMenuGrid({
  groups,
  countByMenu,
  tabletWorkspace,
  onPressItem,
  accessibilityLabelFor,
}: OrderMenuGridProps) {
  const { copy } = useDisplayPreferences();
  const [mode] = useMenuViewMode();
  const [gridWidth, setGridWidth] = useState(0);
  const { tileWidth } = menuGridColumns(gridWidth, TABLET_TILE_MIN_WIDTH, spacing.md);
  const compact = compactColumns(gridWidth, COMPACT_TILE_GAP);
  // Only a layout picked while the grid is on screen settles in. A screen that
  // opens in its saved layout draws at once, as it always has.
  const [openedIn] = useState(mode);
  const [switched, setSwitched] = useState(false);
  if (!switched && mode !== openedIn) setSwitched(true);

  if (!groups.length) {
    return <EmptyState title={copy('ไม่พบเมนู', 'No menu items found')} detail={copy('ลองเปลี่ยนหมวดหรือคำค้น', 'Try another category or search.')} />;
  }

  const sectionSpacing = SECTION_SPACING[mode];
  // Nothing until the grid knows the width its tiles are sized from: one frame
  // of empty column beats a frame of tiles at a guessed size snapping to the
  // real one. The phone's photo grid sizes by percentage and needs no wait.
  const measuring = mode === 'compact' ? !compact.tileWidth : mode === 'grid' && tabletWorkspace && !tileWidth;

  const renderDishes = (items: readonly MenuItem[]) => {
    const dishes = items.map((item, index) => {
      const count = countByMenu.get(item.ID) ?? 0;
      // Switched off OR out of stock: in every layout the dish greys out and
      // takes no tap, instead of opening a dish that cannot be added.
      const soldOut = isMenuSoldOut(item);
      const accessibilityLabel = soldOut ? copy(`${item.name} หมด`, `${item.name}, sold out`) : accessibilityLabelFor(item, count);
      const onPress = () => onPressItem(item);
      if (mode === 'list') {
        return <MenuListRow key={item.ID} item={item} count={count} soldOut={soldOut} onPress={onPress} accessibilityLabel={accessibilityLabel} separated={index < items.length - 1} />;
      }
      if (mode === 'compact') {
        return <MenuCompactTile key={item.ID} item={item} count={count} soldOut={soldOut} onPress={onPress} accessibilityLabel={accessibilityLabel} width={compact.tileWidth} />;
      }
      return (
        <MenuPhotoTile
          key={item.ID}
          item={item}
          count={count}
          soldOut={soldOut}
          onPress={onPress}
          accessibilityLabel={accessibilityLabel}
          tabletWorkspace={tabletWorkspace}
          tileWidth={tileWidth}
        />
      );
    });
    // Rows stack flush: each draws its own hairline under it, all but the last.
    if (mode === 'list') return <View>{dishes}</View>;
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: mode === 'compact' ? COMPACT_TILE_GAP : spacing.md }}>
        {dishes}
      </View>
    );
  };

  const sections = measuring ? null : groups.map((group) => (
    <View key={group.key} style={{ gap: sectionSpacing.underHeading }}>
      <SectionHeader title={group.label} />
      {renderDishes(group.items)}
    </View>
  ));

  return (
    // Measured on every device: the compact tiles size from this width on a
    // phone too, and a width already known is what lets a switch into them
    // draw on the same frame as the tap.
    <View onLayout={(event) => setGridWidth(Math.floor(event.nativeEvent.layout.width))} style={{ gap: sectionSpacing.between }}>
      {switched && sections ? (
        // Keyed by layout so each pick settles in afresh; the eye follows the
        // menu into its new shape instead of seeing it jump.
        <MotionReveal key={mode} style={{ gap: sectionSpacing.between }}>{sections}</MotionReveal>
      ) : sections}
    </View>
  );
}
