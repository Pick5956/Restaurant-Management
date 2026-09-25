import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import type { PaymentMethod } from '@/src/lib/cash-tender';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

const TILE_HEIGHT = 52;
const ON_INK = '#FFFFFF';

type MethodOption = {
  key: PaymentMethod;
  icon: AppIconName;
  label: string;
  /** Why it cannot be picked, said on the tile itself. */
  reason: string | null;
};

/**
 * Cash or PromptPay, as two tiles side by side. Replaces the radio list the
 * bill used, whose rings and filled dots the owner has retired. The chosen
 * tile fills dark, the table-plan chip language; a method the shop has not set
 * up stays visible, dimmed, with its reason on it.
 */
export function MethodSwitch({ value, onChange, qrReady }: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  /** The shop has a PromptPay QR image to show. */
  qrReady: boolean;
}) {
  const { copy } = useDisplayPreferences();
  const options: MethodOption[] = [
    { key: 'cash', icon: 'cash-outline', label: copy('เงินสด', 'Cash'), reason: null },
    {
      key: 'promptpay_qr',
      icon: 'qr-code-outline',
      label: 'PromptPay QR',
      reason: qrReady ? null : copy('ยังไม่ได้ตั้งค่า QR', 'QR not set up'),
    },
  ];

  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
      {options.map((option) => {
        const on = option.key === value;
        const disabled = option.reason !== null;
        return (
          <Pressable
            key={option.key}
            accessibilityLabel={option.reason ? `${option.label}, ${option.reason}` : option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => {
              if (on) return;
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(option.key);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: TILE_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 12,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: on ? palette.textStrong : palette.divider,
              backgroundColor: on ? palette.textStrong : pressed ? palette.surfaceSubtle : palette.surface,
              opacity: disabled ? 0.45 : 1,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon color={on ? ON_INK : palette.muted} name={option.icon} size={19} />
              <Text numberOfLines={1} style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: on ? ON_INK : palette.text }}>
                {option.label}
              </Text>
            </View>
            {option.reason ? (
              <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, color: on ? ON_INK : palette.muted }}>
                {option.reason}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
