import type { JSX } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { MenuImage } from '@/src/components/menu-image';
import { CountBadge, StockMark } from '@/src/components/order-menu/menu-tile-parts';
import { formatTender } from '@/src/lib/cash-tender';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, spacing, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';

// MenuImage's `row` square. Named here because the separator is inset by it.
const THUMBNAIL_SIZE = 56;
// Thumbnail plus the padding above and below it: a one-line dish sits at
// exactly this height, a two-line name grows the row rather than clipping.
const ROW_MIN_HEIGHT = THUMBNAIL_SIZE + spacing.sm * 2;

type MenuListRowProps = {
  item: MenuItem;
  count: number;
  soldOut: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  /**
   * The hairline under the row. Off for the last row of a category: a line is
   * there to part two dishes, and under the last one it would only stand
   * between that dish and the next category's heading. The order summary's
   * rows on the same screen draw their lines between rows only, too.
   */
  separated?: boolean;
};

/**
 * One dish per row, for running an eye down a long menu. The same facts as the
 * photo tile in the same order - name, then price with what is left - with the
 * photo shrunk to a thumbnail and the round's count moved to the trailing edge,
 * where a column of badges shows at a glance what is already in the basket.
 *
 * Each row draws its own separator under it, so a list of these stacks with no
 * gap and no Divider between them. The line is a sibling of the pressable, not
 * a child: a sold-out row fades and a pressed row dips, and the separator does
 * neither, so the lines stay one even weight down the whole list.
 */
export function MenuListRow({ item, count, soldOut, onPress, accessibilityLabel, separated = true }: MenuListRowProps): JSX.Element {
  const { copy, language } = useDisplayPreferences();
  return (
    <View>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: soldOut }}
        disabled={soldOut}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: ROW_MIN_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.sm,
          // The photo tile's own feedback, so a tap answers the same way
          // whichever layout the menu is in.
          opacity: soldOut ? 0.48 : pressed ? 0.72 : 1,
          transform: [{ translateY: pressed ? 1 : 0 }],
        })}
      >
        <MenuImage
          accessibilityLabel={copy(`รูปเมนู ${item.name}`, `Photo of ${item.name}`)}
          imageUrl={item.image_url}
          size={THUMBNAIL_SIZE}
          variant="row"
        />
        {/* Not `selectable`, unlike the tile's text: on Android a selectable
            Text takes the touch for itself, and in a row the text is most of
            what a finger lands on. */}
        <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
          <Text numberOfLines={2} style={[typeScale.cardTitle, { fontWeight: '600' }]}>{item.name}</Text>
          {/* The stock mark follows the price instead of being pushed to the
              far edge: on a tablet-wide row that would put it a hand's width
              from the number it qualifies. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Text style={[typeScale.number, { flexShrink: 0, fontSize: 15, fontWeight: '600' }]}>{formatTender(item.price, language)}</Text>
            <StockMark item={item} soldOut={soldOut} />
          </View>
        </View>
        {/* No slot is held open for it: most rows carry no count, and an empty
            column down the right edge would only take width from the names. */}
        <CountBadge count={count} small />
      </Pressable>
      {separated ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            // Inset to the text column, the iOS list habit: the thumbnails
            // already mark where each row starts, and a line under them would
            // cut the column of photos into boxes.
            left: THUMBNAIL_SIZE + spacing.md,
            right: 0,
            bottom: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: palette.divider,
          }}
        />
      ) : null}
    </View>
  );
}
