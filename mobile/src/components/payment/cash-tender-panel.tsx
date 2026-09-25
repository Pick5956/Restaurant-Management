import * as Haptics from 'expo-haptics';
import { LayoutAnimation, Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import { CashKeypad } from '@/src/components/payment/cash-keypad';
import type { CashTenderState, TenderChoice } from '@/src/components/payment/use-cash-tender';
import { formatTender } from '@/src/lib/cash-tender';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

const ROW_HAIRLINE = '#F3EDE7';
const CHIP_HEIGHT = 40;
const ON_INK = '#FFFFFF';

type Chip = { key: string; label: string; choice: TenderChoice };

/**
 * How much cash the customer handed over: "พอดี", the likely round-ups, or
 * any amount on the keypad. Under the chips, what was received and the change
 * to hand back, worked out as the amount is chosen.
 */
export function CashTenderPanel({ tender }: { tender: CashTenderState }) {
  const { copy, language } = useDisplayPreferences();
  const reducedMotion = useReducedMotion();
  const chips: Chip[] = [
    { key: 'exact', label: copy('พอดี', 'Exact'), choice: 'exact' },
    ...tender.quick.map((amount) => ({ key: String(amount), label: formatTender(amount, language), choice: amount })),
    { key: 'custom', label: copy('จำนวนอื่น', 'Other amount'), choice: 'custom' },
  ];

  const choose = (choice: TenderChoice) => {
    if (choice === tender.choice) return;
    // The keypad coming or going changes the sheet's height; let it ease.
    const keypadMoves = (choice === 'custom') !== (tender.choice === 'custom');
    if (keypadMoves && !reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    void Haptics.selectionAsync().catch(() => undefined);
    tender.pick(choice);
  };

  return (
    <View style={{ gap: 12 }}>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {chips.map((chip) => {
          const on = chip.choice === tender.choice;
          return (
            <Pressable
              key={chip.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              hitSlop={4}
              onPress={() => choose(chip.choice)}
              style={({ pressed }) => ({
                minHeight: CHIP_HEIGHT,
                justifyContent: 'center',
                paddingHorizontal: 16,
                borderRadius: CHIP_HEIGHT / 2,
                borderCurve: 'continuous',
                borderWidth: 1,
                borderColor: on ? palette.textStrong : palette.divider,
                backgroundColor: on ? palette.textStrong : pressed ? palette.surfaceSubtle : palette.surface,
              })}
            >
              <Text numberOfLines={1} style={{ fontSize: 14, lineHeight: 20, fontWeight: '600', color: on ? ON_INK : palette.text, fontVariant: ['tabular-nums'] }}>
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TenderCard tender={tender} />
      {tender.choice === 'custom' ? <CashKeypad onPress={tender.press} /> : null}
    </View>
  );
}

/** Received, then the change - or what is still short, in red, since short is a real state. */
function TenderCard({ tender }: { tender: CashTenderState }) {
  const { copy, language } = useDisplayPreferences();
  const known = tender.received !== null;
  const short = known && !tender.enough;
  return (
    <View style={{ borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: palette.divider, backgroundColor: palette.surface, overflow: 'hidden' }}>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14 }}>
        <Text style={{ fontSize: 14, lineHeight: 20, color: palette.muted }}>{copy('รับมา', 'Received')}</Text>
        <Text
          numberOfLines={1}
          selectable
          style={{ fontSize: 15, lineHeight: 22, fontWeight: known ? '600' : '500', color: known ? palette.textStrong : palette.muted, fontVariant: ['tabular-nums'] }}
        >
          {tender.received === null ? copy('ยังไม่ระบุ', 'Not entered') : formatTender(tender.received, language)}
        </Text>
      </View>
      <View
        accessibilityLiveRegion="polite"
        style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: ROW_HAIRLINE }}
      >
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: short ? '600' : '400', color: short ? palette.danger : palette.muted }}>
          {short ? copy('ยังขาด', 'Short') : copy('เงินทอน', 'Change')}
        </Text>
        <Text
          numberOfLines={1}
          selectable
          style={{ fontSize: 17, lineHeight: 24, fontWeight: '600', color: short ? palette.danger : known ? palette.textStrong : palette.muted, fontVariant: ['tabular-nums'] }}
        >
          {formatTender(short ? tender.short : tender.change, language)}
        </Text>
      </View>
    </View>
  );
}
