import { Pressable, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { palette } from '@/src/theme';

// One row of a tinted-icon list: the "เพิ่มเติม" screen's rows (15 ก.ย. 2569),
// shared with settings so the two read as one family.

export function ToolRow({ icon, title, detail, first, look, onPress, showChevron = true }: {
  icon: AppIconName;
  title: string;
  detail?: string;
  first: boolean;
  look: { wash: string; ink: string; title: string };
  onPress: () => void;
  /** Off for a row that acts rather than opens a page, such as signing out. */
  showChevron?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        // A row with no second line does not need the height one had: 64 left a
        // band of empty paper above and below every name (16 ก.ย. 2569).
        minHeight: detail ? 64 : 56,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.divider,
        backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
      })}
    >
      <View style={{ width: 38, height: 38, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: look.wash }}>
        <AppIcon name={icon} size={21} color={look.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Quieter than the heading above the card: this is one of four things
            inside a group, not the name of the group. */}
        <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '500', color: look.title }}>{title}</Text>
        {detail ? <Text numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 17, color: palette.muted }}>{detail}</Text> : null}
      </View>
      {showChevron ? <AppIcon name="chevron-forward" size={19} color={palette.placeholder} /> : null}
    </Pressable>
  );
}
