import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { appNavigation } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { HUB_TONE_INK, segmentsText } from '@/src/components/hub/value-line';
import { useReducedMotion } from '@/src/components/motion';
import { insightsSegments, inventorySegments, menuSegments, type HubLanguage } from '@/src/lib/hub-data';
import { shelfBadge, shelfBadgeText, type ShelfBadge, type StageShelfGroup } from '@/src/lib/hub-stage-layout';
import type { HubData, HubNavItem, HubSegment } from '@/src/lib/hub-types';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

// The occasional tools under the service tiles: flat cream chips in two headed
// groups, on purpose the opposite of the raised tiles above them - no shadow,
// no edge. A chip's only live value is a badge, and only when something needs
// doing; its accessibility label says the value in full either way.

const CHIP_RADIUS = 18;
const CHIP_GAP = 10;
/** The badge is a mark, and its count is in the chip's label: it grows a little with the OS text size, no more. */
const BADGE_TEXT_MAX_SCALE = 1.2;
const BADGE_MS = 160;

/**
 * A chip's title is the navigation's own label ('เมนูอาหาร', 'Menu'), not the
 * longer name the full-width rows use ('จัดการเมนูอาหาร'), which a half-width
 * chip cut to 'จัดการเมนูอ…' on a 360 dp phone.
 */
function chipTitle(item: HubNavItem, language: HubLanguage): string {
  const nav = [...appNavigation.primaryNavigation, ...appNavigation.managementNavigation].find((entry) => entry.key === item.key);
  if (!nav) return item.title;
  return language === 'th' ? nav.label : nav.labelEn;
}
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const NATIVE_DRIVER = Platform.OS !== 'web';

/** The value a chip's accessibility label reads out, whether or not a badge shows: 'หมด 2, ใกล้หมด 5', 'ของครบ'. */
function chipSegments(item: HubNavItem, data: HubData, language: HubLanguage): HubSegment[] {
  if (item.key === 'menu' && data.menu.status === 'ready' && data.menu.value) return menuSegments(data.menu.value, language);
  if (item.key === 'inventory' && data.inventory.status === 'ready' && data.inventory.value) {
    return inventorySegments(data.inventory.value, language);
  }
  if (item.key === 'ai' && data.insights.status === 'ready' && data.insights.value) return insightsSegments(data.insights.value, language);
  return [];
}

/** Scales in from 0.6 the first time it appears; a count that changes afterwards just changes. */
function ChipBadge({ badge, ring }: { badge: ShelfBadge; ring: string }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (reduced) {
      scale.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(scale, { toValue: 1, duration: BADGE_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [reduced, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: -5,
        right: -5,
        minWidth: 18,
        // minHeight, and a line exactly the ring's inside at the default size:
        // the digits stay inside the pill however the OS text size moves them.
        minHeight: 18,
        paddingHorizontal: 4,
        borderRadius: 9,
        // The ring is the chip's own fill, so the badge reads as cut out of it.
        borderWidth: 2,
        borderColor: ring,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: HUB_TONE_INK[badge.tone],
        transform: [{ scale }],
      }}
    >
      <Text
        maxFontSizeMultiplier={BADGE_TEXT_MAX_SCALE}
        style={{ fontSize: 11, lineHeight: 13, fontWeight: '600', color: '#FFFFFF', fontVariant: ['tabular-nums'] }}
      >
        {shelfBadgeText(badge.count)}
      </Text>
    </Animated.View>
  );
}

export function ShelfChip({
  item,
  title,
  badge,
  accessibilityLabel,
  height,
  onPress,
}: {
  item: HubNavItem;
  /** What the chip says; see chipTitle. */
  title: string;
  badge: ShelfBadge | null;
  accessibilityLabel: string;
  /** The chip's resting height; a title on two lines, or a large OS text size, grows it. */
  height: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: height,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: CHIP_RADIUS,
        borderCurve: 'continuous',
        backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
      })}
    >
      {({ pressed }) => (
        <>
          <View style={{ width: 36, height: 36 }}>
            <View
              style={{
                flex: 1,
                borderRadius: 11,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: palette.surface,
              }}
            >
              <AppIcon color={palette.primaryInk} name={item.icon} size={20} />
            </View>
            {badge ? <ChipBadge badge={badge} ring={pressed ? palette.surfaceStrong : palette.surfaceSubtle} /> : null}
          </View>
          <Text numberOfLines={2} style={{ flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500', color: palette.textStrong }}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Rows of `columns` chips; a short last row keeps its chips at the same width as the rows above. */
function ChipGrid({
  items,
  columns,
  render,
}: {
  items: readonly HubNavItem[];
  columns: number;
  render: (item: HubNavItem) => ReactNode;
}) {
  const rows: HubNavItem[][] = [];
  for (let index = 0; index < items.length; index += columns) rows.push(items.slice(index, index + columns));
  return (
    <View style={{ gap: CHIP_GAP }}>
      {rows.map((row) => (
        <View key={row.map((item) => item.key).join('|')} style={{ flexDirection: 'row', gap: CHIP_GAP }}>
          {row.map(render)}
          {Array.from({ length: columns - row.length }, (_, index) => <View key={`pad-${index}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

/**
 * 'งานร้าน' and 'ข้อมูลและบัญชี', each kept even over a single chip. On a
 * tablet the two groups stand side by side.
 */
export function StageShelf({
  groups,
  data,
  onOpen,
  columns,
  chipHeight,
  sideBySide,
}: {
  groups: readonly StageShelfGroup[];
  data: HubData;
  onOpen: (item: HubNavItem) => void;
  columns: number;
  chipHeight: number;
  sideBySide: boolean;
}) {
  const { copy, language } = useDisplayPreferences();
  const lang: HubLanguage = language;

  const views = groups.map((group) => (
    <View key={group.key} style={{ flex: sideBySide ? 1 : undefined, minWidth: 0, gap: 10 }}>
      {/* Under the screen's own title in size and weight, as on every page. */}
      <Text accessibilityRole="header" style={{ fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.textStrong, paddingHorizontal: 4 }}>
        {group.key === 'shop' ? copy('งานร้าน', 'Shop') : copy('ข้อมูลและบัญชี', 'Insights and account')}
      </Text>
      <ChipGrid
        columns={columns}
        items={group.items}
        render={(item) => {
          const title = chipTitle(item, lang);
          const words = segmentsText(chipSegments(item, data, lang));
          return (
            <ShelfChip
              accessibilityLabel={words ? `${title}, ${words}` : title}
              badge={shelfBadge(item.key, data)}
              height={chipHeight}
              item={item}
              key={item.key}
              onPress={() => onOpen(item)}
              title={title}
            />
          );
        }}
      />
    </View>
  ));

  if (!views.length) return null;
  return sideBySide
    ? <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>{views}</View>
    : <View style={{ gap: 20 }}>{views}</View>;
}
