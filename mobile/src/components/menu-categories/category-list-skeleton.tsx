import { View } from 'react-native';

import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { palette, radius, spacing } from '@/src/theme';

const NAME_WIDTHS = ['58%', '42%', '66%', '48%'] as const;

/**
 * The list while it loads, in the shape it will take: the grip, a name and
 * the count under it, row for row. Until the categories arrive the screen
 * shows this, never the empty state - a shop with categories must not read
 * "ยังไม่มีหมวดเมนู" for a moment first.
 */
export function CategoryListSkeleton({ framed, label }: { framed: boolean; label: string }) {
  return (
    <SkeletonReveal label={label}>
      <View
        style={framed
          ? { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface }
          : { marginHorizontal: -spacing.lg, backgroundColor: palette.surface }}
      >
        {NAME_WIDTHS.map((width) => (
          <View key={width} style={{ minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg }}>
            <View style={{ width: 32, alignItems: 'center' }}>
              <Bone height={16} radius={5} width={22} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <Bone height={16} radius={6} width={width} />
              <Bone height={12} radius={5} width={64} />
            </View>
          </View>
        ))}
      </View>
    </SkeletonReveal>
  );
}
