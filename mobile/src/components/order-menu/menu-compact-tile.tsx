import type { JSX } from 'react';
import { Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { CountBadge, StockMark } from '@/src/components/order-menu/menu-tile-parts';
import { scaleFont } from '@/src/lib/app-font';
import { money } from '@/src/lib/format';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, radius, spacing, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';

// A tile is 100-odd points wide (see `compactColumns`), so the inset sits a
// step under `spacing.md`: every point of it comes out of the name's line.
const TILE_PADDING = 10;

// Authored sizes; AppText scales every one of them by APP_FONT_SCALE.
const NAME_FONT_SIZE = 14;
// 1.57x: Thai tone marks above and sara below are cropped by anything tighter.
const NAME_LINE_HEIGHT = 22;
const PRICE_FONT_SIZE = 15;
const PRICE_LINE_HEIGHT = 22;
// One step between each of the three stacked lines, so they read as one group.
const NAME_PRICE_GAP = 2;
const PRICE_STOCK_GAP = NAME_PRICE_GAP;

// The bare StockMark: one caption line, no chip. Mirrored here, not imported,
// only to size the tile; the mark draws itself.
const STOCK_MARK_HEIGHT = scaleFont(typeScale.caption.lineHeight ?? 20);

// Every tile is at least as tall as a two-line name, its price and the stock
// mark stacked under it, so a grid of them reads as even rows whatever the
// names do. Longer content (a large system text size) grows the tile, and the
// tile stretches to the tallest in its row, so a row still lines up.
const TILE_MIN_HEIGHT =
  TILE_PADDING * 2
  + scaleFont(NAME_LINE_HEIGHT) * 2
  + NAME_PRICE_GAP
  + scaleFont(PRICE_LINE_HEIGHT)
  + PRICE_STOCK_GAP
  + STOCK_MARK_HEIGHT;

// The small CountBadge (contract: a 26pt circle), tucked into the corner so its
// centre sits on the name's first line.
const BADGE_DIAMETER = 26;
const BADGE_INSET = spacing.sm;
// Kept clear at the end of the name while a badge is up, so the count never
// sits on top of a letter.
const BADGE_CLEARANCE = BADGE_INSET + BADGE_DIAMETER + spacing.xs - TILE_PADDING;

// A three-across tile at twice the text size fits three glyphs a line and says
// nothing; the dish's accessibility label carries the full name either way.
const TEXT_SCALE_CAP = 1.3;

type MenuCompactTileProps = {
  item: MenuItem;
  count: number;
  soldOut: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  /** The exact width from `compactColumns`; the tile never grows past it. */
  width: number;
};

/**
 * The photo-less dish tile, for staff who know the menu by name: the same facts
 * as the photo tile in the same order - name, price, what is left - on a soft
 * fill with no frame, three or more across.
 *
 * The round's count takes the photo tile's corner, top right, so the eye finds
 * it in the same place whichever layout the menu is in. The name gives way to
 * it only while it is there: a column held open on every tile would cost about
 * a third of the name's width on all the tiles that carry no count.
 *
 * Price and stock mark stack rather than share a line. At this width a price
 * and "เหลือ 12" do not fit side by side, and letting the mark wrap on some
 * tiles and not others would break the even rows the mode is for. The mark is
 * drawn bare: its chip is filled with the tile's own cream, so on the tile it
 * only showed as padding, and a chip on the tile is a box on a box.
 */
export function MenuCompactTile({
  item,
  count,
  soldOut,
  onPress,
  accessibilityLabel,
  width,
}: MenuCompactTileProps): JSX.Element {
  const { language } = useDisplayPreferences();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: soldOut }}
      disabled={soldOut}
      onPress={onPress}
      style={({ pressed }) => ({
        // An exact width, never a grow factor: a lone tile on a short last row
        // stretched across the screen reads as a more important dish.
        width,
        flexGrow: 0,
        flexShrink: 0,
        // Stretched to the tallest tile in its row, whatever the row container
        // aligns its children to, so the tiles of a row end on one line.
        alignSelf: 'stretch',
        minHeight: TILE_MIN_HEIGHT,
        padding: TILE_PADDING,
        borderRadius: radius.md,
        // A soft fill and no border: the tile is the only box here. A sold-out
        // dish drops the brand warmth for the neutral grey, then fades like
        // the photo tile, so it reads as unavailable rather than merely pale.
        backgroundColor: soldOut ? palette.neutralSoft : palette.surfaceSubtle,
        // The photo tile's own feedback, so a tap answers the same way in
        // every layout.
        opacity: soldOut ? 0.48 : pressed ? 0.72 : 1,
        transform: [{ translateY: pressed ? 1 : 0 }],
      })}
    >
      {/* Not `selectable`: on Android a selectable Text takes the touch for
          itself, and on a tile this small the text is most of what a finger
          lands on. */}
      <Text
        maxFontSizeMultiplier={TEXT_SCALE_CAP}
        numberOfLines={2}
        style={{
          color: palette.text,
          fontSize: NAME_FONT_SIZE,
          fontWeight: '600',
          lineHeight: NAME_LINE_HEIGHT,
          paddingRight: count > 0 ? BADGE_CLEARANCE : 0,
        }}
      >
        {item.name}
      </Text>
      {/* Straight under the name, not pushed to the tile's foot: name and
          price read as one pair, the same trade the photo tile made. */}
      <View style={{ marginTop: NAME_PRICE_GAP, alignItems: 'flex-start', gap: PRICE_STOCK_GAP }}>
        <Text
          maxFontSizeMultiplier={TEXT_SCALE_CAP}
          numberOfLines={1}
          style={[typeScale.number, { fontSize: PRICE_FONT_SIZE, fontWeight: '600', lineHeight: PRICE_LINE_HEIGHT }]}
        >
          {money(item.price, language)}
        </Text>
        <StockMark item={item} soldOut={soldOut} bare />
      </View>
      {count > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: BADGE_INSET, right: BADGE_INSET }}>
          <CountBadge count={count} small />
        </View>
      ) : null}
    </Pressable>
  );
}
