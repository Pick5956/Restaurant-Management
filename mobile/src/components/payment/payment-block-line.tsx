import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

/**
 * Why taking payment is held back, said beside the action it holds back:
 * "ครัวยังทำไม่เสร็จ 2 รายการ". `onRetry` adds the one recovery the screen
 * offers - re-reading a bill whose last refresh failed.
 */
export function PaymentBlockLine({ text, onRetry }: { text: string; onRetry?: () => Promise<void> | void }) {
  const { copy } = useDisplayPreferences();
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    void Promise.resolve(onRetry()).finally(() => setRetrying(false));
  };

  return (
    <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 20, fontWeight: '600', color: palette.warning, fontVariant: ['tabular-nums'] }}>
        {text}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: retrying }}
          disabled={retrying}
          hitSlop={8}
          onPress={retry}
          style={({ pressed }) => ({
            minHeight: 30,
            minWidth: 88,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 12,
            borderRadius: 15,
            borderCurve: 'continuous',
            backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
          })}
        >
          {retrying ? (
            <ActivityIndicator color={palette.primaryInk} size="small" />
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 20, fontWeight: '600', color: palette.primaryInk }}>
              {copy('ลองอีกครั้ง', 'Try again')}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}
