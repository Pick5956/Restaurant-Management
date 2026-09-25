import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import type { KeypadKey } from '@/src/lib/cash-tender';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

const KEY_HEIGHT = 52;
const KEY_GAP = 8;

const ROWS: readonly (readonly KeypadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['00', '0', 'back'],
];

/**
 * The amount a customer handed over, typed in whole baht. A keypad in the
 * sheet rather than the system keyboard: the sheet is a translucent-status-bar
 * Modal that Android never resizes for a keyboard, and a cashier counting
 * notes wants big keys, not a text field. Holding the delete key clears it.
 */
export function CashKeypad({ onPress }: { onPress: (key: KeypadKey) => void }) {
  const { copy } = useDisplayPreferences();
  const tap = (key: KeypadKey) => {
    void Haptics.selectionAsync().catch(() => undefined);
    onPress(key);
  };

  return (
    <View style={{ gap: KEY_GAP }}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={{ flexDirection: 'row', gap: KEY_GAP }}>
          {row.map((key) => (
            <Pressable
              key={key}
              accessibilityLabel={key === 'back' ? copy('ลบตัวเลข', 'Delete digit') : key}
              accessibilityRole="button"
              delayLongPress={450}
              onLongPress={key === 'back' ? () => tap('clear') : undefined}
              onPress={() => tap(key)}
              style={({ pressed }) => ({
                flex: 1,
                height: KEY_HEIGHT,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                borderCurve: 'continuous',
                backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
              })}
            >
              {key === 'back' ? (
                <AppIcon color={palette.textStrong} name="backspace-outline" size={22} />
              ) : (
                <Text style={{ fontSize: 18, lineHeight: 26, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{key}</Text>
              )}
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}
