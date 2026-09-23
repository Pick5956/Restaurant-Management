import { Pressable, View, type PressableProps } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { segmentsText, ValueLine } from '@/src/components/hub/value-line';
import { MotionCrossfade } from '@/src/components/motion';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import type { HubSegment } from '@/src/lib/hub-types';
import { palette } from '@/src/theme';

// One row of a tinted-icon list: the "เพิ่มเติม" screen's rows (15 ก.ย. 2569),
// shared with settings so the two read as one family.

export type ToolRowLook = { wash: string; ink: string; title: string };

/** The icon square of a row whose value is at danger (sold out, out of stock). */
export const TOOL_ROW_DANGER_ICON: Pick<ToolRowLook, 'wash' | 'ink'> = { wash: palette.dangerSoft, ink: palette.danger };

/** 12.5 x 1.44: a tone mark on the second line is not clipped (was 17). */
const DETAIL_LINE = 18;

export type ToolRowProps = Omit<PressableProps, 'children' | 'style' | 'onPress'> & {
  icon: AppIconName;
  title: string;
  /**
   * The second line. A string reads as before (muted, regular). Segments are
   * joined with ", ", only toned ones coloured, led by a dot in the most
   * severe tone (see ValueLine).
   */
  detail?: string | readonly HubSegment[];
  /** The value is on its way: a bone stands in the second line. */
  detailLoading?: boolean;
  /**
   * The row expects a value: it keeps the two-line height (64) from the first
   * paint, and the value fades in where the bone stood when it lands, so
   * nothing under it jumps. The bone unmounts as the value lands.
   */
  reserveDetail?: boolean;
  first: boolean;
  look: ToolRowLook;
  /** Merged over `look`, e.g. TOOL_ROW_DANGER_ICON while the row's value is at danger. */
  lookOverride?: Partial<ToolRowLook>;
  onPress: () => void;
  /** Off for a row that acts rather than opens a page, such as signing out. */
  showChevron?: boolean;
};

function hasDetail(detail: ToolRowProps['detail']): boolean {
  if (!detail) return false;
  return typeof detail === 'string' ? detail.length > 0 : detail.some((segment) => segment.text);
}

export function ToolRow({
  icon,
  title,
  detail,
  detailLoading = false,
  reserveDetail = false,
  first,
  look,
  lookOverride,
  onPress,
  showChevron = true,
  accessibilityLabel,
  ...rest
}: ToolRowProps) {
  const tone = lookOverride ? { ...look, ...lookOverride } : look;
  const detailShown = hasDetail(detail);
  const detailWords = !detailShown ? '' : typeof detail === 'string' ? detail : segmentsText(detail ?? []);
  const segments: readonly HubSegment[] = !detailShown ? [] : typeof detail === 'string' ? [{ text: detail }] : detail ?? [];

  const line = detailShown ? (
    // Plain strings keep the old regular weight, so settings reads as it did.
    <ValueLine segments={segments} size={12.5} plainWeight={typeof detail === 'string' ? '400' : '500'} />
  ) : null;
  const bone = (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: DETAIL_LINE, justifyContent: 'center' }}>
      <SkeletonReveal label={title}>
        <Bone width={96} height={12} radius={6} />
      </SkeletonReveal>
    </View>
  );

  // A row that reserves its line fades the value in over the bone's place; a
  // row that does not shows whichever it has, as settings always did. The bone
  // leaves the tree the moment the value lands: MotionCrossfade keeps its
  // inactive layer mounted, and a mounted Bone keeps the shared shimmer loop
  // running - under every page pushed over the hub, for the whole session.
  const second = reserveDetail && (detailLoading || detailShown)
    ? <MotionCrossfade active={!detailLoading} inactiveContent={detailLoading ? bone : null} activeContent={line} minHeight={DETAIL_LINE} />
    : detailLoading ? bone : line;

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (detailWords ? `${title}, ${detailWords}` : title)}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        // A row with no second line does not need the height one had: 64 left a
        // band of empty paper above and below every name (16 ก.ย. 2569).
        minHeight: detailShown || detailLoading || reserveDetail ? 64 : 56,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.divider,
        backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
      })}
    >
      <View style={{ width: 38, height: 38, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: tone.wash }}>
        <AppIcon name={icon} size={21} color={tone.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Quieter than the heading above the card: this is one of four things
            inside a group, not the name of the group. */}
        <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '500', color: tone.title }}>{title}</Text>
        {second}
      </View>
      {showChevron ? <AppIcon name="chevron-forward" size={19} color={palette.placeholder} /> : null}
    </Pressable>
  );
}
