import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import {
  Button,
  EdgeSection,
  EdgeSectionHeader,
  EmptyState,
  Feedback,
  StatusBadge,
} from '@/src/components/ui';
import {
  describePrinterFailure,
  looksLikeReceiptPrinter,
  type DiscoveredPrinter,
} from '@/src/lib/printer';
import { usePrinter } from '@/src/providers/printer-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { palette, radius, spacing, typeScale } from '@/src/theme';

export default function PrinterSettingsScreen() {
  const { copy, language } = useDisplayPreferences();
  const {
    bluetoothState,
    enableBluetooth,
    forgetPrinter,
    printing,
    ready,
    refreshBluetoothState,
    scanPrinters,
    selectPrinter,
    selectedPrinter,
    supported,
    testPrinter,
  } = usePrinter();
  const [printers, setPrinters] = useState<DiscoveredPrinter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testingAddress, setTestingAddress] = useState<string | null>(null);
  // Scan, test, choose and forget are all taps; each reports through a toast
  // (14 ก.ย.). The two info panels about the platform stay in the page.
  const { showToast } = useToast();
  const setError = (detail: string) => showToast({ tone: 'error', title: copy('เชื่อมต่อไม่สำเร็จ', 'Connection failed'), message: detail });
  const setNotice = (detail: string) => showToast({ title: detail });

  useEffect(() => {
    if (!supported) return;
    void refreshBluetoothState();
  }, [refreshBluetoothState, supported]);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const state = await refreshBluetoothState();
      if (state === 'PoweredOff') {
        const enabled = await enableBluetooth();
        if (!enabled.ok) {
          setError(describePrinterFailure(enabled.code, language, enabled.message));
          return;
        }
      }

      // Paired devices are reported the moment the scan starts, so they are
      // rendered as they arrive instead of making the user wait out the full
      // discovery sweep for the printer that was already set up.
      setPrinters([]);
      const result = await scanPrinters(setPrinters);
      if (!result.ok) {
        setError(describePrinterFailure(result.code, language, result.message));
        return;
      }
      setPrinters(result.printers);
      if (!result.printers.length) {
        showToast({ tone: 'info', title: copy(
          'ยังไม่พบอุปกรณ์ ลองจับคู่เครื่องพิมพ์ในการตั้งค่าบลูทูธของเครื่องก่อน',
          'No devices yet. Pair the printer in your phone Bluetooth settings first.',
        ) });
      }
    } finally {
      setScanning(false);
    }
  }, [copy, enableBluetooth, language, refreshBluetoothState, scanPrinters]);

  async function choose(printer: DiscoveredPrinter) {
    setTestingAddress(printer.address);
    try {
      const result = await testPrinter(printer.address);
      if (!result.ok) {
        setError(describePrinterFailure(result.code, language, result.message));
        return;
      }
      await selectPrinter({ address: printer.address, name: printer.name });
      setNotice(copy(
        `เลือก ${printer.name} เป็นเครื่องพิมพ์ใบเสร็จแล้ว`,
        `${printer.name} is now the receipt printer.`,
      ));
    } finally {
      setTestingAddress(null);
    }
  }

  async function forget() {
    await forgetPrinter();
    setNotice(copy('ลบเครื่องพิมพ์ที่เลือกไว้แล้ว', 'The selected printer was removed.'));
  }

  if (!supported) {
    return (
      <AppScreen title={copy('เครื่องพิมพ์ใบเสร็จ', 'Receipt printer')} topLevel={false}>
        <Feedback
          tone="info"
          title={copy('รองรับเฉพาะ Android', 'Android only')}
          detail={copy(
            `เครื่องพิมพ์ความร้อนแบบพกพาสื่อสารด้วย Bluetooth Classic (SPP) ซึ่ง ${Platform.OS === 'ios' ? 'iOS' : 'แพลตฟอร์มนี้'} อนุญาตเฉพาะอุปกรณ์ที่ผ่านการรับรอง MFi เท่านั้น ใช้เครื่อง Android เพื่อพิมพ์ใบเสร็จ`,
            `Portable thermal printers speak Bluetooth Classic (SPP), which ${Platform.OS === 'ios' ? 'iOS' : 'this platform'} only allows for MFi-certified accessories. Use an Android device to print receipts.`,
          )}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={copy('เครื่องพิมพ์ใบเสร็จ', 'Receipt printer')}
      subtitle={copy('เชื่อมต่อเครื่องพิมพ์ความร้อน 58 มม. ผ่านบลูทูธ', 'Connect a 58 mm thermal printer over Bluetooth')}
      topLevel={false}
    >

      <View style={{ gap: spacing.sm }}>
        <EdgeSectionHeader
          title={copy('เครื่องพิมพ์ที่ใช้งาน', 'Active printer')}
          detail={copy('ใบเสร็จจะถูกส่งไปที่เครื่องนี้', 'Receipts are sent to this printer')}
        />
        <EdgeSection>
          <View style={{ gap: spacing.md, padding: spacing.md }}>
            {selectedPrinter ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <AppIcon color={palette.accent} name="print" size={22} />
                  <View style={{ minWidth: 0, flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700' }}>
                      {selectedPrinter.name}
                    </Text>
                    <Text numberOfLines={1} style={[typeScale.caption, { color: palette.muted }]}>
                      {selectedPrinter.address}
                    </Text>
                  </View>
                  <StatusBadge tone="success" label={copy('พร้อมใช้งาน', 'Ready')} />
                </View>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <Button
                    compact
                    variant="secondary"
                    icon="flash-outline"
                    label={copy('ทดสอบการเชื่อมต่อ', 'Test connection')}
                    disabled={printing || testingAddress === selectedPrinter.address}
                    onPress={async () => {
                      setTestingAddress(selectedPrinter.address);
                      try {
                        const result = await testPrinter(selectedPrinter.address);
                        if (result.ok) {
                          setNotice(copy('เชื่อมต่อเครื่องพิมพ์ได้', 'The printer responded.'));
                        } else {
                          setError(describePrinterFailure(result.code, language, result.message));
                        }
                      } finally {
                        setTestingAddress(null);
                      }
                    }}
                  />
                  <Button
                    compact
                    variant="secondary"
                    icon="trash-outline"
                    label={copy('ลบออก', 'Remove')}
                    onPress={forget}
                  />
                </View>
              </>
            ) : (
              <EmptyState
                title={copy('ยังไม่ได้เลือกเครื่องพิมพ์', 'No printer selected')}
                detail={copy(
                  'จับคู่เครื่องพิมพ์ในการตั้งค่าบลูทูธของเครื่องก่อน แล้วกดค้นหาด้านล่าง',
                  'Pair the printer in your phone Bluetooth settings, then search below.',
                )}
              />
            )}
          </View>
        </EdgeSection>
      </View>

      <View style={{ gap: spacing.sm }}>
        <EdgeSectionHeader
          title={copy('อุปกรณ์บลูทูธ', 'Bluetooth devices')}
          detail={bluetoothState === 'PoweredOff'
            ? copy('บลูทูธปิดอยู่', 'Bluetooth is off')
            : copy('อุปกรณ์ที่จับคู่ไว้จะอยู่ด้านบน', 'Paired devices are listed first')}
        />
        <Button
          icon="search-outline"
          variant="secondary"
          label={scanning
            ? copy('กำลังค้นหา…', 'Searching…')
            : copy('ค้นหาเครื่องพิมพ์', 'Search for printers')}
          loading={scanning}
          disabled={!ready}
          onPress={runScan}
        />
        {printers.length ? (
          <EdgeSection>
            {printers.map((printer) => {
              const active = selectedPrinter?.address === printer.address;
              const busy = testingAddress === printer.address;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active, busy }}
                  disabled={busy}
                  key={printer.address}
                  onPress={() => choose(printer)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    padding: spacing.md,
                    borderRadius: radius.md,
                    opacity: pressed || busy ? 0.68 : 1,
                  })}
                >
                  <AppIcon
                    color={active ? palette.accent : palette.muted}
                    name={looksLikeReceiptPrinter(printer.name) ? 'print-outline' : 'bluetooth-outline'}
                    size={20}
                  />
                  <View style={{ minWidth: 0, flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: active ? '700' : '600' }}>
                      {printer.name}
                    </Text>
                    <Text numberOfLines={1} style={[typeScale.caption, { color: palette.muted }]}>
                      {printer.address}
                    </Text>
                  </View>
                  {printer.paired ? (
                    <StatusBadge tone="info" label={copy('จับคู่แล้ว', 'Paired')} />
                  ) : null}
                  {busy ? (
                    <Text style={[typeScale.caption, { color: palette.muted }]}>
                      {copy('กำลังทดสอบ…', 'Testing…')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </EdgeSection>
        ) : null}
      </View>

      <Feedback
        tone="info"
        title={copy('ใบเสร็จพิมพ์เป็นภาพ', 'Receipts print as an image')}
        detail={copy(
          'Dishy วาดใบเสร็จด้วยฟอนต์ของเครื่องแล้วส่งเป็นภาพ ภาษาไทยจึงออกครบทุกวรรณยุกต์แม้เครื่องพิมพ์จะไม่มีฟอนต์ไทยในเฟิร์มแวร์',
          'Dishy renders the receipt with the phone font and sends it as a bitmap, so Thai prints correctly even when the printer firmware has no Thai font.',
        )}
      />
    </AppScreen>
  );
}
