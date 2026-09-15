import { useCallback, useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { ActionRow, FORM_MAX_WIDTH, FormCard, Note } from '@/src/components/form/parts';
import { GhostButton } from '@/src/components/staff/parts';
import { Button } from '@/src/components/ui';
import {
  describePrinterFailure,
  looksLikeReceiptPrinter,
  type DiscoveredPrinter,
} from '@/src/lib/printer';
import { usePrinter } from '@/src/providers/printer-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, spacing } from '@/src/theme';

// The receipt printer, redrawn on 15 ก.ย. 2569. On an iPhone the page had been
// one blue box over two thirds of empty screen; it now says in the middle of
// the screen, in a few words, to use the Android device at the counter. On
// Android: the printer in use as a card with its test and remove buttons, the
// paired devices first, and the search button under them.

export default function PrinterSettingsScreen() {
  const { width } = useWindowDimensions();
  const { copy, language } = useDisplayPreferences();
  const tablet = width >= breakpoints.tabletWorkspace;
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

  async function testSelected() {
    if (!selectedPrinter) return;
    setTestingAddress(selectedPrinter.address);
    try {
      const result = await testPrinter(selectedPrinter.address);
      if (result.ok) setNotice(copy('เชื่อมต่อเครื่องพิมพ์ได้', 'The printer responded.'));
      else setError(describePrinterFailure(result.code, language, result.message));
    } finally {
      setTestingAddress(null);
    }
  }

  async function forget() {
    await forgetPrinter();
    setNotice(copy('ลบเครื่องพิมพ์ที่เลือกไว้แล้ว', 'The selected printer was removed.'));
  }

  const title = copy('เครื่องพิมพ์ใบเสร็จ', 'Receipt printer');

  if (!supported) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 30, paddingBottom: 60 }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
            <AppIcon name="print-outline" size={30} color={palette.primaryInk} />
          </View>
          <Text style={{ fontSize: 15.5, fontWeight: '700', color: palette.textStrong, textAlign: 'center' }}>{copy('ใช้ได้เฉพาะเครื่อง Android', 'Android devices only')}</Text>
          <Text style={{ fontSize: 13.5, lineHeight: 20, color: palette.muted, textAlign: 'center' }}>
            {copy(
              'เครื่องพิมพ์ใบเสร็จต่อผ่านบลูทูธแบบที่ iPhone และ iPad ไม่เปิดให้แอปใช้ เปิดแอปนี้บนเครื่อง Android ที่เคาน์เตอร์เพื่อพิมพ์',
              'Receipt printers use a kind of Bluetooth that iPhone and iPad do not open to apps. Open this app on the Android device at the counter to print.',
            )}
          </Text>
        </View>
      </AppScreen>
    );
  }

  const busySelected = Boolean(selectedPrinter && testingAddress === selectedPrinter.address);

  return (
    <AppScreen
      title={title}
      subtitle={copy('เครื่องพิมพ์ความร้อน 58 มม. ผ่านบลูทูธ', '58 mm thermal printer over Bluetooth')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
    >
      <View style={{ gap: spacing.md }}>
        <FormCard title={copy('เครื่องที่ใช้อยู่', 'Printer in use')} detail={copy('ใบเสร็จส่งไปที่เครื่องนี้', 'Receipts go to this printer')}>
          {selectedPrinter ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 4 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
                  <AppIcon name="print" size={21} color={palette.primaryInk} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '700', color: palette.textStrong }}>{selectedPrinter.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>{selectedPrinter.address}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: palette.successSoft }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.success }} />
                  <Text style={{ fontSize: 11.5, fontWeight: '600', color: palette.success }}>{copy('พร้อมใช้', 'Ready')}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, padding: 14 }}>
                <View style={{ flex: 1 }}>
                  <Button compact variant="secondary" icon="flash-outline" label={busySelected ? copy('กำลังทดสอบ…', 'Testing…') : copy('พิมพ์ทดสอบ', 'Test print')} disabled={printing || busySelected} onPress={testSelected} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button compact variant="secondary" icon="trash-outline" label={copy('ลบออก', 'Remove')} onPress={forget} />
                </View>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 14 }}>
              <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F0ED' }}>
                <AppIcon name="print-outline" size={21} color="#8B6F5F" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{copy('ยังไม่ได้เลือกเครื่องพิมพ์', 'No printer chosen yet')}</Text>
                <Text style={{ fontSize: 12, lineHeight: 17, color: palette.placeholder }}>{copy('จับคู่เครื่องพิมพ์ในบลูทูธของเครื่องก่อน แล้วค้นหาด้านล่าง', 'Pair the printer in Bluetooth settings first, then search below')}</Text>
              </View>
            </View>
          )}
        </FormCard>

        <FormCard
          title={copy('อุปกรณ์บลูทูธ', 'Bluetooth devices')}
          detail={bluetoothState === 'PoweredOff' ? copy('บลูทูธปิดอยู่', 'Bluetooth is off') : copy('ที่จับคู่แล้วอยู่บน · แตะเพื่อทดสอบและเลือก', 'Paired first · tap one to test and choose it')}
        >
          {printers.map((printer, index) => {
            const active = selectedPrinter?.address === printer.address;
            const busy = testingAddress === printer.address;
            return (
              <ActionRow
                key={printer.address}
                first={index === 0}
                icon={looksLikeReceiptPrinter(printer.name) ? 'print-outline' : 'bluetooth-outline'}
                title={printer.name}
                detail={busy ? copy('กำลังทดสอบ…', 'Testing…') : printer.address}
                onPress={busy ? undefined : () => choose(printer)}
                trailing={(
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {printer.paired ? (
                      <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#E0F2FE' }}>
                        <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#0369A1' }}>{copy('จับคู่แล้ว', 'Paired')}</Text>
                      </View>
                    ) : null}
                    {active ? <AppIcon name="checkmark-circle" size={20} color={palette.primary} /> : null}
                  </View>
                )}
              />
            );
          })}
          <View style={{ padding: 14, paddingTop: printers.length ? 10 : 4, alignItems: 'stretch' }}>
            <GhostButton icon="search-outline" label={scanning ? copy('กำลังค้นหา…', 'Searching…') : printers.length ? copy('ค้นหาอีกครั้ง', 'Search again') : copy('ค้นหาเครื่องพิมพ์', 'Search for printers')} onPress={() => { if (ready && !scanning) void runScan(); }} />
          </View>
        </FormCard>

        <Note text={copy('ใบเสร็จพิมพ์เป็นภาพ ตัวอักษรไทยจึงออกครบทุกวรรณยุกต์แม้เครื่องพิมพ์ไม่มีฟอนต์ไทย แต่ช้ากว่าพิมพ์ตัวอักษรราวหนึ่งวินาที', 'Receipts print as an image, so Thai comes out complete even on a printer with no Thai font — about a second slower than plain text')} />
      </View>
    </AppScreen>
  );
}
