import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps, type ViewProps, type ViewStyle } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { palette, radius, spacing } from '@/src/theme';

/** The corner a lifted row is drawn with: the card under it and the clip inside it. */
export const LIFTED_ROW_RADIUS = 12;

/** A framed list's inside corner: its radius less the 1pt border. */
const FRAMED_CORNER = radius.md - 1;

/**
 * How far the count moves down while the name slot holds the rename field. The
 * field draws its orange line 2 to 3.5pt under the name's line box, and the
 * count starts 1pt under it, so the line would cross the tone marks and upper
 * vowels of "ไม่มีเมนู". A translate, not a margin: the row keeps its height and
 * the name does not move.
 */
const SLOT_DETAIL_DROP = 3;

/** The row's box: one place, so the add row cannot drift from the rows under it. */
function rowShell(hasDetail: boolean, roundTop?: boolean, roundBottom?: boolean): ViewStyle {
  const top = roundTop ? FRAMED_CORNER : 0;
  const bottom = roundBottom ? FRAMED_CORNER : 0;
  return {
    minHeight: hasDetail ? 72 : 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: hasDetail ? spacing.sm : spacing.xs,
    borderTopLeftRadius: top,
    borderTopRightRadius: top,
    borderBottomLeftRadius: bottom,
    borderBottomRightRadius: bottom,
  };
}

/** The 32pt leading slot the grip sits in. */
function leadSlot(hasDetail: boolean): ViewStyle {
  return { minHeight: hasDetail ? 48 : 36, width: 32, alignItems: 'center', justifyContent: 'center' };
}

export type CategoryRowProps = Omit<PressableProps, 'children' | 'style'> & {
  name: string;
  /** The live value under the name: "3 เมนู", "ไม่มีเมนู". Omitted while it is not known. */
  detail?: string | null;
  /** A legacy hidden category (is_active false): order-taking skips it, so it reads struck through. */
  hidden?: boolean;
  /** Held under the finger: the lifted card behind it draws the surface. */
  lifted?: boolean;
  /** Round these corners so a pressed row stays inside a framed list's curve. */
  roundTop?: boolean;
  roundBottom?: boolean;
  /**
   * Drawn where the name is - the rename field. The count stays under it, so
   * the row keeps its height when the name turns into the field and back.
   */
  nameSlot?: ReactNode;
  /**
   * Keeps the touch but draws no press: a row whose tap is refused (a save is
   * running, a name is being edited). Not `disabled`: a disabled Pressable
   * passes the touch on, to the swipe row around it, which draws a press of
   * its own, and to the page, which reads it as a tap elsewhere and puts the
   * keyboard away.
   */
  quiet?: boolean;
};

/**
 * One category in the list, drawn on the same grid as the EdgeRow it replaces:
 * a 32pt leading slot, the name at 16/600, the count at 13 under it. The grip
 * in the leading slot says the row can be held and dragged. The whole row is
 * the tap target, and nothing in it is selectable text - a long press on
 * selectable text starts a text selection instead of the drag.
 */
export function CategoryRow({
  name,
  detail,
  hidden,
  lifted,
  roundTop,
  roundBottom,
  nameSlot,
  quiet,
  ...rest
}: CategoryRowProps) {
  const hasDetail = Boolean(detail);
  const hasSlot = nameSlot !== undefined && nameSlot !== null;
  return (
    <Pressable
      {...rest}
      style={({ pressed }) => ({
        ...rowShell(hasDetail, roundTop, roundBottom),
        backgroundColor: !lifted && pressed && !quiet ? palette.surfaceStrong : 'transparent',
      })}
    >
      <View style={leadSlot(hasDetail)}>
        <AppIcon color={lifted ? palette.primaryInk : palette.placeholder} name="reorder-three-outline" size={25} />
      </View>
      <View style={{ minWidth: 0, flex: 1, justifyContent: 'center', gap: 1 }}>
        {hasSlot ? nameSlot : (
          <Text
            numberOfLines={hasDetail ? 2 : 1}
            style={{
              color: hidden ? palette.muted : palette.textStrong,
              fontSize: 16,
              lineHeight: 22,
              fontWeight: '600',
              textDecorationLine: hidden ? 'line-through' : 'none',
            }}
          >
            {name}
          </Text>
        )}
        {detail ? (
          <Text
            numberOfLines={1}
            style={{
              color: palette.muted,
              fontSize: 13,
              lineHeight: 18,
              fontVariant: ['tabular-nums'],
              transform: hasSlot ? [{ translateY: SLOT_DETAIL_DROP }] : undefined,
            }}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export type CategoryInlineRowProps = {
  /** The name field. */
  children: ReactNode;
  roundTop?: boolean;
  roundBottom?: boolean;
};

/**
 * The row a new category is typed into: CategoryRow's box, leading slot and
 * surface, the field where the name goes. Not pressable and not draggable. The
 * leading slot holds a plus where the others hold their grip - there is no
 * order to take hold of yet - so the field lines up with the names under it.
 */
export function CategoryInlineRow({ children, roundTop, roundBottom }: CategoryInlineRowProps) {
  return (
    <View
      // Its own padding answers a touch. The page keeps the keyboard up only
      // for taps a view answers, so a thumb that just misses the field would
      // otherwise count as a tap elsewhere and throw the new name away.
      onStartShouldSetResponder={() => true}
      style={{ ...rowShell(false, roundTop, roundBottom), backgroundColor: palette.surface }}
    >
      <View style={leadSlot(false)}>
        <AppIcon color={palette.placeholder} name="add" size={24} />
      </View>
      <View style={{ minWidth: 0, flex: 1, justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

export type CategoryRowFrameProps = ViewProps & {
  roundTop?: boolean;
  roundBottom?: boolean;
  /** Round all four corners to the lifted card's. */
  lifted?: boolean;
};

/**
 * The clip around one row and the delete rail that slides out from under it.
 * The swipe row paints square surfaces - its red backdrop, the face that slides
 * - and they would poke past a framed list's curve or the lifted card's; the
 * frame rounds them to whichever applies. It clips only what is inside it: the
 * lifted card's shadow is cast by the view around it, which never clips.
 */
export function CategoryRowFrame({ roundTop, roundBottom, lifted, style, ...rest }: CategoryRowFrameProps) {
  const top = lifted ? LIFTED_ROW_RADIUS : roundTop ? FRAMED_CORNER : 0;
  const bottom = lifted ? LIFTED_ROW_RADIUS : roundBottom ? FRAMED_CORNER : 0;
  return (
    <View
      {...rest}
      style={[
        {
          overflow: 'hidden',
          borderCurve: 'continuous',
          borderTopLeftRadius: top,
          borderTopRightRadius: top,
          borderBottomLeftRadius: bottom,
          borderBottomRightRadius: bottom,
        },
        style,
      ]}
    />
  );
}
