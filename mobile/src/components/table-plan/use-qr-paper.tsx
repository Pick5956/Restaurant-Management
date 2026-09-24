import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState, type RefObject } from 'react';
import { Alert, Platform, View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { QrPrintSlip } from '@/src/components/table-plan/print-slip';
import { printerFailureReason } from '@/src/lib/printer';
import type { PlanLanguage } from '@/src/lib/table-plan';
import { usePrinter } from '@/src/providers/printer-provider';
import { useToast } from '@/src/providers/toast-provider';

// Putting a table's QR on paper. Both platforms share the slip as an image
// (expo-sharing, approved by the owner on 2026-09-23: Save Image, AirPrint,
// LINE, anything the phone offers). Android can also print the 384-dot slip on
// the shop's Bluetooth printer; iOS has no Bluetooth Classic. The capture is
// react-native-view-shot, which the receipt already uses.

export type QrSlipContent = { label: string; zone: string; url: string };

export type QrPaperMode = 'print' | 'share';

/** Android has a Bluetooth printer to send the slip to; iOS only shares. */
export const QR_PAPER_PRINTS = Platform.OS === 'android';

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function useQrPaper({ language, t }: { language: PlanLanguage; t: (th: string, en: string) => string }) {
  const printer = usePrinter();
  const { showToast } = useToast();
  const slipRef = useRef<View>(null);
  const [slip, setSlip] = useState<QrSlipContent | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const askForPrinter = useCallback(() => {
    Alert.alert(t('ยังไม่ได้เลือกเครื่องพิมพ์', 'No printer selected'), undefined, [
      { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
      { text: t('ตั้งค่าเครื่องพิมพ์', 'Printer settings'), onPress: () => router.push('/settings/printer' as never) },
    ]);
  }, [t]);

  const run = useCallback(async (content: QrSlipContent, mode: QrPaperMode) => {
    if (busyRef.current) return;
    const printing = mode === 'print' && QR_PAPER_PRINTS;
    if (printing && !printer.selectedPrinter) {
      askForPrinter();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setSlip(content);
    // The slip has to be laid out with this table on it before it is captured.
    await nextFrame();
    await nextFrame();
    try {
      if (printing) {
        const result = await printer.printReceiptView(slipRef.current);
        if (result.ok) {
          showToast({ title: t('ส่งไปเครื่องพิมพ์แล้ว', 'Sent to the printer') });
        } else if (result.code === 'NO_PRINTER_SELECTED') {
          askForPrinter();
        } else {
          // The mapped words only: the printer's own message is never shown,
          // and a code with no mapped reason adds no line under the title.
          const reason = printerFailureReason(result.code, language);
          showToast({ tone: 'error', title: t('พิมพ์ QR ไม่สำเร็จ', 'Could not print the QR'), ...(reason ? { message: reason } : {}) });
        }
        return;
      }
      let uri: string | null = null;
      try {
        uri = await captureRef(slipRef, { format: 'png', quality: 1, result: 'tmpfile' });
        await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: content.label });
      } catch {
        showToast({ tone: 'error', title: t('แชร์รูป QR ไม่สำเร็จ', 'Could not share the QR') });
      } finally {
        if (uri) releaseCapture(uri);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [askForPrinter, language, printer, showToast, t]);

  return { run, busy, slip, slipRef };
}

/**
 * The slip, rendered off screen for the capture: a plain View far to the left,
 * never a Modal, so nothing is drawn over the screen.
 */
export function QrSlipHost({ slip, slipRef, shopName }: {
  slip: QrSlipContent | null;
  slipRef: RefObject<View | null>;
  shopName: string;
}) {
  if (!slip) return null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: -10000 }}
    >
      <QrPrintSlip label={slip.label} ref={slipRef} shopName={shopName} url={slip.url} zone={slip.zone} />
    </View>
  );
}
