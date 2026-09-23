import type { JSX } from 'react';
import { View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { menuStockBadge } from '@/src/lib/menu-catalog';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, radius, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';

// The photo tile keeps the full-size badge; the list row and the compact tile
// have no photo to sit on, so theirs steps down to fit a line of text.
const COUNT_BADGE_SIZES = {
  regular: { diameter: 34, fontSize: 13, lineHeight: 18 },
  small: { diameter: 26, fontSize: 12, lineHeight: 16 },
} as const;

type CountBadgeProps = {
  count: number;
  small?: boolean;
};

/**
 * How many of a dish are in the round being taken: the bare number in a white
 * circle with a soft orange ring, the owner's pick on 15 Sep. Nothing at 0.
 * Position-free - the photo tile pins it top right over the image, the list row
 * puts it at the trailing edge - so every layout draws the same badge.
 */
export function CountBadge({ count, small = false }: CountBadgeProps): JSX.Element | null {
  if (count <= 0) return null;
  const size = small ? COUNT_BADGE_SIZES.small : COUNT_BADGE_SIZES.regular;
  return (
    <View
      pointerEvents="none"
      style={{
        // A true circle for any count a round can hold; the minimum width only
        // gives way past three digits.
        minWidth: size.diameter,
        height: size.diameter,
        paddingHorizontal: 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        borderWidth: 2,
        // The softer control orange the category select uses, a step down from
        // the brand orange the number keeps.
        borderColor: palette.controlBorder,
        backgroundColor: palette.surface,
        // An even glow on every side, the owner's pick over a dropped shadow.
        // Stronger than `controlShadow`, which vanished against the pale
        // placeholder art behind it.
        boxShadow: '0 0 2px rgba(61, 43, 31, 0.18), 0 0 8px rgba(61, 43, 31, 0.24)',
      }}
    >
      {/* Capped scaling keeps the count inside its circle; the dish's own
          accessibility label already speaks the number. */}
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ color: palette.primary, fontSize: size.fontSize, fontWeight: '800', lineHeight: size.lineHeight, fontVariant: ['tabular-nums'] }}
      >
        {count}
      </Text>
    </View>
  );
}

type StockMarkProps = {
  item: MenuItem;
  soldOut: boolean;
  /**
   * The words without the chip, for a dish drawn on a tinted tile. The chip's
   * fills are the tile's own cream (and an amber a shade off it), so there it
   * vanished and only its padding showed - the line sat 6pt in from the price
   * above it - and a chip on a tile is a box on a box anyway.
   */
  bare?: boolean;
};

/**
 * What is left of a dish, beside its price. A sold-out dish says so in a plain
 * grey word, no chip: no dot, no red frame - the tile is already greyed out, and
 * a red badge made "sold out" the loudest thing on a tile nobody can use (owner,
 * 2026-09-19). Every orderable dish shows its portions left (owner, 2026-09-22,
 * as on the web POS): amber at ten or fewer, a quiet grey otherwise, and
 * "ไม่จำกัด" for a dish with no recipe.
 */
export function StockMark({ item, soldOut, bare = false }: StockMarkProps): JSX.Element | null {
  const { copy } = useDisplayPreferences();
  if (soldOut) {
    return (
      <Text selectable style={[typeScale.caption, { flexShrink: 0, color: palette.neutral, fontWeight: '600' }]}>
        {copy('หมด', 'Sold out')}
      </Text>
    );
  }
  const badge = menuStockBadge(item);
  if (!badge) return null;
  const low = badge.kind === 'low';
  return (
    <View
      style={bare
        ? { flexShrink: 0 }
        : { flexShrink: 0, borderRadius: radius.sm, backgroundColor: low ? palette.warningSoft : palette.surfaceSubtle, paddingHorizontal: 6, paddingVertical: 2 }}
    >
      <Text maxFontSizeMultiplier={1.2} style={[typeScale.caption, { color: low ? palette.warning : palette.muted, fontWeight: '700' }]}>
        {badge.kind === 'unlimited'
          ? copy('ไม่จำกัด', 'No limit')
          : copy(`เหลือ ${badge.count.toLocaleString('th-TH')}`, `${badge.count.toLocaleString('en-US')} left`)}
      </Text>
    </View>
  );
}
