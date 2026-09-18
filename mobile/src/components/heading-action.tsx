import { Pressable } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { palette } from '@/src/theme';

/**
 * The orange button on a heading. On a phone it is a 46pt circle, the same
 * width as the glass back button across from it, so the centred title stays centred;
 * on a tablet it carries its words.
 */
export function HeadingAction({ icon, label, onPress, compact }: { icon: AppIconName; label: string; onPress: () => void; compact: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        height: 46,
        minWidth: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: compact ? 0 : 16,
        borderRadius: 23,
        backgroundColor: palette.primary,
        opacity: pressed ? 0.85 : 1,
        shadowColor: palette.primary,
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      })}
    >
      <AppIcon name={icon} size={compact ? 22 : 18} color="#fff" />
      {compact ? null : <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#fff' }}>{label}</Text>}
    </Pressable>
  );
}
