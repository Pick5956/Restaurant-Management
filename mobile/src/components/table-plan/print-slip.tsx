import { forwardRef } from 'react';
import { View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { QrCode } from '@/src/components/table-plan/qr-code';
import { RECEIPT_WIDTH_DOTS_58MM } from '@/src/lib/printer';

// The card that goes on the table: the shop, the table and its zone, and the
// ordering QR, laid out at the 58 mm head's own 384-dot width in pure black on
// white, like the receipt slip. It is rendered off screen and captured - for
// the Bluetooth printer on Android, and as an image to share on iOS. A plain
// View, never a Modal: nothing here is drawn over the screen.

const INK = '#000000';
const PAPER = '#FFFFFF';
const QR_DOTS = 300;

export const QrPrintSlip = forwardRef<View, {
  shopName: string;
  label: string;
  zone: string;
  url: string;
}>(function QrPrintSlip({ shopName, label, zone, url }, ref) {
  return (
    <View
      // Android's view flattening would otherwise drop this container and leave
      // view-shot with nothing to capture.
      collapsable={false}
      ref={ref}
      style={{ width: RECEIPT_WIDTH_DOTS_58MM, alignItems: 'center', gap: 6, backgroundColor: PAPER, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 }}
    >
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: INK }}>{shopName}</Text>
      <Text numberOfLines={2} style={{ textAlign: 'center', color: INK }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: INK }}>{label}</Text>
        <Text style={{ fontSize: 15, fontWeight: '500', color: INK }}>{` ${zone}`}</Text>
      </Text>
      <QrCode quietZone={4} size={QR_DOTS} value={url} />
    </View>
  );
});
