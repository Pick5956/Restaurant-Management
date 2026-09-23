import { useState } from 'react';
import { View } from 'react-native';

import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { radius, spacing } from '@/src/theme';

/** The tablet tile's width in the real grid (MenuManageTile's flexBasis). */
const TABLET_TILE = 240;

/**
 * The menu grid before its first answer, in the tiles' own shapes: the square
 * photo, the name, the price, and the พร้อมขาย row with its switch. Two rows,
 * so the dishes land where the eye is already looking. It is drawn only while
 * the screen has no dishes at all, never over a list on a reload.
 */
export function MenuManageSkeleton({ label, tabletWorkspace }: { label: string; tabletWorkspace: boolean }) {
  const [width, setWidth] = useState(0);
  const tile = tabletWorkspace ? TABLET_TILE : Math.floor(width * 0.48);
  const columns = tabletWorkspace ? Math.max(2, Math.floor((width + spacing.md) / (TABLET_TILE + spacing.md))) : 2;

  return (
    <SkeletonReveal label={label}>
      <View
        onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.md }}
      >
        {/* Nothing until the row knows its width: a guessed square snapping to
            the real one reads as the screen jumping. */}
        {width > 0 ? Array.from({ length: columns * 2 }, (_, index) => (
          <View key={index} style={{ width: tile, gap: spacing.sm }}>
            <Bone height={tile} radius={radius.md} />
            <View style={{ gap: spacing.sm, paddingHorizontal: spacing.xs, paddingTop: 2 }}>
              <Bone height={15} radius={6} width="78%" />
              <Bone height={15} radius={6} width="42%" />
            </View>
            <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs }}>
              <Bone height={12} radius={6} width="38%" />
              <Bone height={31} radius={16} width={51} />
            </View>
          </View>
        )) : null}
      </View>
    </SkeletonReveal>
  );
}
