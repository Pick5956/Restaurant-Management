import type { ReactNode } from 'react';
import { Image, LayoutAnimation, useWindowDimensions, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import { CashTenderPanel } from '@/src/components/payment/cash-tender-panel';
import { MethodSwitch } from '@/src/components/payment/method-switch';
import { useCashTender } from '@/src/components/payment/use-cash-tender';
import { BodyFrame, PlanButton } from '@/src/components/table-plan/sheet-kit';
import { Button, Feedback } from '@/src/components/ui';
import { formatTender, type PaymentMethod } from '@/src/lib/cash-tender';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, typeScale } from '@/src/theme';

const QR_MAX = 260;
const QR_INLINE = 200;
/** The sheet's sides (16 each) and the card inset around it (10 each), with a little air. */
const QR_SHEET_INSET = 72;

export interface PaymentFormProps {
  total: number;
  method: PaymentMethod;
  onMethodChange: (method: PaymentMethod) => void;
  /** The shop's PromptPay QR as a full URL, or '' when it has none. */
  qrUri: string;
  promptpayName: string;
  /** The bill can be paid now: the kitchen is done and the totals are current. */
  ready: boolean;
  /** Why it cannot, said right above the confirm. */
  notice?: ReactNode;
  saving: boolean;
  /** Cash passes what was handed over; PromptPay passes null. */
  onConfirm: (received: number | null) => void;
}

/**
 * Taking payment for a bill: the amount due, cash or PromptPay, and for cash
 * what was handed over and the change. The phone shows it in a sheet over the
 * bill; the tablet shows it inline beside the items. Its confirm says what it
 * confirms - "รับเงินสด ฿500" - so no tap records a payment the cashier did
 * not read.
 */
export function PaymentForm({
  layout,
  isArmed,
  total,
  method,
  onMethodChange,
  qrUri,
  promptpayName,
  ready,
  notice,
  saving,
  onConfirm,
}: PaymentFormProps & {
  layout: 'sheet' | 'inline';
  /** False while a press could still be the tap that opened the sheet. */
  isArmed?: () => boolean;
}) {
  const { copy, language } = useDisplayPreferences();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const tender = useCashTender(total);
  const cash = method === 'cash';
  const hasQr = Boolean(qrUri);
  const blocked = !ready || (cash ? !tender.enough : !hasQr);
  const amount = formatTender(total, language);

  const changeMethod = (next: PaymentMethod) => {
    // The QR and the cash block differ in height; let the change ease.
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onMethodChange(next);
  };

  const confirm = () => {
    if (blocked || saving) return;
    if (isArmed && !isArmed()) return;
    onConfirm(cash ? tender.received : null);
  };

  const label = cash
    ? copy(`รับเงินสด ${amount}`, `Take cash ${amount}`)
    : copy(`ได้รับเงินโอนแล้ว ${amount}`, `Transfer received ${amount}`);

  const body = (
    <>
      {/* A little apart from the controls under it: the figure is what is
          being settled, the rest is how. */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingBottom: 4 }}>
        <Text style={{ fontSize: 13, lineHeight: 20, color: palette.muted }}>{copy('ยอดที่ต้องชำระ', 'Amount due')}</Text>
        <Text selectable style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{amount}</Text>
      </View>
      <MethodSwitch onChange={changeMethod} qrReady={hasQr} value={method} />
      {cash ? (
        <CashTenderPanel tender={tender} />
      ) : (
        <PromptPayPanel name={promptpayName} qrUri={qrUri} size={layout === 'inline' ? QR_INLINE : Math.min(QR_MAX, width - QR_SHEET_INSET)} />
      )}
    </>
  );

  if (layout === 'sheet') {
    return (
      <BodyFrame
        chrome="sheet"
        footer={(
          <View style={{ gap: 10 }}>
            {notice}
            <PlanButton disabled={blocked} label={label} loading={saving} onPress={confirm} />
          </View>
        )}
        title={copy('รับเงิน', 'Take payment')}
      >
        {body}
      </BodyFrame>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      {body}
      {notice}
      <Button
        disabled={blocked}
        icon={cash ? 'cash-outline' : 'qr-code-outline'}
        label={label}
        loading={saving}
        onPress={confirm}
      />
    </View>
  );
}

function PromptPayPanel({ qrUri, name, size }: { qrUri: string; name: string; size: number }) {
  const { copy } = useDisplayPreferences();
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {qrUri ? (
        <Image
          accessibilityLabel={copy('คิวอาร์โค้ดพร้อมเพย์ของร้าน', 'Restaurant PromptPay QR code')}
          resizeMode="contain"
          source={{ uri: qrUri }}
          style={{ width: size, height: size, borderRadius: 12, backgroundColor: palette.surfaceSubtle }}
        />
      ) : (
        <View style={{ alignSelf: 'stretch' }}>
          <Feedback title={copy('ร้านยังไม่ได้ตั้งค่า QR PromptPay', 'PromptPay QR is not configured for this restaurant')} tone="warning" />
        </View>
      )}
      <Text selectable style={typeScale.cardTitle}>{name || 'PromptPay'}</Text>
    </View>
  );
}
