import { Pressable, View, type PressableProps } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { palette } from '@/src/theme';

const ROW_HAIRLINE = '#F3EDE7';

/**
 * A row in a card that opens the fields under it: the settings ActionRow's
 * icon tile and words, with a chevron that turns. `detail` is the value the
 * closed row stands for; pass nothing while it is open, since the fields
 * underneath already show it.
 */
export function ContactDisclosure({
  icon,
  title,
  detail,
  open,
  onToggle,
  first,
  ...rest
}: Omit<PressableProps, 'children' | 'onPress' | 'style'> & {
  icon: AppIconName;
  title: string;
  detail?: string | null;
  open: boolean;
  onToggle: () => void;
  first?: boolean;
}) {
  return (
    <Pressable
      {...rest}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: ROW_HAIRLINE,
        backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
        <AppIcon color={palette.primaryInk} name={icon} size={19} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: palette.textStrong }}>{title}</Text>
        {detail ? (
          <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 17, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{detail}</Text>
        ) : null}
      </View>
      <AppIcon color={palette.placeholder} name={open ? 'chevron-up' : 'chevron-down'} size={16} />
    </Pressable>
  );
}
