import { View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import type { CashTenderState } from '@/src/components/payment/use-cash-tender';
import { formatTender } from '@/src/lib/cash-tender';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

const ROW_HAIRLINE = '#F3EDE7';

/**
 * What was received and the change. Cash is always taken as the exact amount
 * due (owner, 28 ก.ย. 2569): the "พอดี", round-up and other-amount chips and
 * the keypad under them are gone.
 */
export function CashTenderPanel({ tender }: { tender: CashTenderState }) {
  return <TenderCard tender={tender} />;
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
