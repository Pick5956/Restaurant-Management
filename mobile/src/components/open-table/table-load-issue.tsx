import { View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { Button } from '@/src/components/ui';
import { palette, radius, spacing } from '@/src/theme';

// The one line the open-table form shows above itself when it has no table to
// open: none was chosen, the chosen one is gone, or the load failed. The line
// is the state's name and nothing after it; a failed load adds ลองอีกครั้ง,
// which is the only retry the screen has.

const DANGER_WORDS = '#7F1D1D';

export function TableLoadIssue({ text, icon = 'alert-circle-outline', retryLabel, onRetry }: {
  text: string;
  icon?: AppIconName;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  const retry = retryLabel && onRetry ? { label: retryLabel, onPress: onRetry } : null;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 52,
        paddingVertical: spacing.sm,
        paddingLeft: 14,
        paddingRight: retry ? spacing.sm : 14,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        backgroundColor: palette.dangerSoft,
      }}
    >
      <AppIcon color={palette.danger} name={icon} size={20} />
      <Text accessibilityRole="alert" style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontWeight: '600', color: DANGER_WORDS }}>
        {text}
      </Text>
      {retry ? <Button compact variant="secondary" label={retry.label} onPress={retry.onPress} /> : null}
    </View>
  );
}
