import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { NativeModules, PermissionsAndroid, Platform, type View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import {
  RECEIPT_WIDTH_DOTS_58MM,
  mergeScannedPrinters,
  planReceiptRasterBands,
  parseScannedDevice,
  parseScannedDeviceList,
  type DiscoveredPrinter,
  type PrinterFailureCode,
  type SavedPrinter,
  type ScannedDevice,
} from '@/src/lib/printer';
import {
  clearSelectedPrinter,
  getSelectedPrinter,
  setSelectedPrinter,
} from '@/src/storage/printer-store';

const PAPER_WIDTH_MM_58 = 58;
const SCAN_TIMEOUT_MS = 20000;

export type PrinterOutcome =
  | { ok: true }
  | { ok: false; code: PrinterFailureCode | string; message?: string };

export type PrinterBluetoothState =
  | 'PoweredOn'
  | 'PoweredOff'
  | 'Unauthorized'
  | 'Unsupported'
  | 'Resetting'
  | 'Unknown';

interface PrinterContextValue {
  ready: boolean;
  /** Bluetooth Classic (SPP) printers are reachable from Android only. */
  supported: boolean;
  selectedPrinter: SavedPrinter | null;
  bluetoothState: PrinterBluetoothState;
  printing: boolean;
  selectPrinter: (printer: SavedPrinter) => Promise<void>;
  forgetPrinter: () => Promise<void>;
  refreshBluetoothState: () => Promise<PrinterBluetoothState>;
  enableBluetooth: () => Promise<PrinterOutcome>;
  scanPrinters: (onUpdate?: (printers: DiscoveredPrinter[]) => void) => Promise<
    { ok: true; printers: DiscoveredPrinter[] } | { ok: false; code: string; message?: string }
  >;
  testPrinter: (address: string) => Promise<PrinterOutcome>;
  printReceiptView: (view: View | null) => Promise<PrinterOutcome>;
}

const PrinterContext = createContext<PrinterContextValue | null>(null);

function devBuildOnlyMessage() {
  return 'พิมพ์ผ่านบลูทูธใช้ได้ผ่าน Development Build เท่านั้น ไม่รองรับ Expo Go';
}

async function loadPrinterModule() {
  // Expo Go ships neither the printer's native module nor react-native-fs, and
  // the library throws while it is being evaluated. The catch below turns that
  // into this message, but in development Metro has already shown the throw as
  // an "Uncaught Error" red screen on every Android launch. So it is not
  // imported at all where the native half is missing.
  if (!NativeModules.RNThermalPrinter || !NativeModules.RNFSManager) {
    throw new Error(devBuildOnlyMessage());
  }
  try {
    return await import('@finan-me/react-native-thermal-printer');
  } catch {
    throw new Error(devBuildOnlyMessage());
  }
}

function failureFrom(error: unknown, fallbackCode: PrinterFailureCode): PrinterOutcome {
  const native = error as { code?: string; message?: string } | null;
  return {
    ok: false,
    code: native?.code || fallbackCode,
    message: native?.message,
  };
}

/**
 * Asks for the Bluetooth runtime permissions that exist on this Android release.
 * API 31 split the old install-time BLUETOOTH permission into SCAN and CONNECT;
 * below that there is nothing to request at runtime for talking to an already
 * paired device, which is the flow the printer picker leads with.
 */
async function requestAndroidBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return true;

  const required = [
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  ];
  const granted = await PermissionsAndroid.requestMultiple(required);

  // Checked key by key rather than over Object.values(): a result object that
  // came back empty - which is what happens when a permission is missing from
  // the merged manifest - would make `every` vacuously true and let the scan run
  // without access, where Android returns an empty device list instead of an
  // error and the failure looks like "no printers found".
  return required.every(
    (permission) => granted[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

export function PrinterProvider({ children }: { children: ReactNode }) {
  const supported = Platform.OS === 'android';
  const [ready, setReady] = useState(false);
  const [selectedPrinter, setSelectedPrinterState] = useState<SavedPrinter | null>(null);
  const [bluetoothState, setBluetoothState] = useState<PrinterBluetoothState>('Unknown');
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let active = true;
    getSelectedPrinter()
      .then((stored) => {
        if (active) setSelectedPrinterState(stored);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectPrinter = useCallback(async (printer: SavedPrinter) => {
    await setSelectedPrinter(printer);
    setSelectedPrinterState({ address: printer.address, name: printer.name });
  }, []);

  const forgetPrinter = useCallback(async () => {
    await clearSelectedPrinter();
    setSelectedPrinterState(null);
  }, []);

  const refreshBluetoothState = useCallback(async (): Promise<PrinterBluetoothState> => {
    if (!supported) {
      setBluetoothState('Unsupported');
      return 'Unsupported';
    }

    try {
      const { BluetoothStateManager } = await loadPrinterModule();
      const state = (await BluetoothStateManager.getState()) as PrinterBluetoothState;
      setBluetoothState(state);
      return state;
    } catch {
      setBluetoothState('Unknown');
      return 'Unknown';
    }
  }, [supported]);

  const enableBluetooth = useCallback(async (): Promise<PrinterOutcome> => {
    if (!supported) return { ok: false, code: 'UNSUPPORTED_PLATFORM' };

    try {
      const { BluetoothStateManager } = await loadPrinterModule();
      await BluetoothStateManager.enable();
      await refreshBluetoothState();
      return { ok: true };
    } catch (error) {
      return failureFrom(error, 'BLUETOOTH_NOT_ENABLED');
    }
  }, [refreshBluetoothState, supported]);

  const scanPrinters = useCallback(async (
    onUpdate?: (printers: DiscoveredPrinter[]) => void,
  ) => {
    if (!supported) {
      return { ok: false as const, code: 'UNSUPPORTED_PLATFORM' };
    }

    try {
      const granted = await requestAndroidBluetoothPermissions();
      if (!granted) return { ok: false as const, code: 'PERMISSION_DENIED' };

      const printerModule = await loadPrinterModule();
      const { ThermalPrinter } = printerModule;

      // The native scan resolves with nothing but `success` - the device lists
      // arrive afterwards as events, despite what the library's ScanResult type
      // declares. Paired devices are emitted synchronously while the scan call
      // is still running, so the listeners have to be attached first.
      const paired: ScannedDevice[] = [];
      const found: ScannedDevice[] = [];
      const subscriptions: { remove: () => void }[] = [];
      const cleanUp = () => {
        subscriptions.forEach((subscription) => {
          try {
            subscription.remove();
          } catch {
            // A listener that is already gone is not a scan failure.
          }
        });
        subscriptions.length = 0;
      };
      const publish = () => onUpdate?.(mergeScannedPrinters(paired, found));

      try {
        return await new Promise<
          { ok: true; printers: DiscoveredPrinter[] } | { ok: false; code: string; message?: string }
        >((resolve) => {
          let settled = false;
          const finish = (
            outcome:
              | { ok: true; printers: DiscoveredPrinter[] }
              | { ok: false; code: string; message?: string },
          ) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(outcome);
          };

          // Android device discovery runs about twelve seconds; the cap keeps a
          // missing DISCOVER_DONE from hanging the picker forever, and whatever
          // was collected by then is still worth showing.
          const timer = setTimeout(() => {
            finish({ ok: true, printers: mergeScannedPrinters(paired, found) });
          }, SCAN_TIMEOUT_MS);

          subscriptions.push(ThermalPrinter.addDiscoveryEventListener(
            ThermalPrinter.EVENT_DEVICE_ALREADY_PAIRED,
            (data) => {
              paired.push(...parseScannedDeviceList(data?.devices));
              publish();
            },
          ));
          subscriptions.push(ThermalPrinter.addDiscoveryEventListener(
            ThermalPrinter.EVENT_DEVICE_FOUND,
            (data) => {
              const device = parseScannedDevice(data?.device);
              if (!device) return;
              found.push(device);
              publish();
            },
          ));
          subscriptions.push(ThermalPrinter.addDiscoveryEventListener(
            ThermalPrinter.EVENT_DEVICE_DISCOVER_DONE,
            (data) => {
              // The completion event repeats both lists, so it is treated as the
              // authoritative answer rather than trusting the running tally.
              const finalPaired = parseScannedDeviceList(data?.paired);
              const finalFound = parseScannedDeviceList(data?.found);
              finish({
                ok: true,
                printers: mergeScannedPrinters(
                  finalPaired.length ? finalPaired : paired,
                  finalFound.length ? finalFound : found,
                ),
              });
            },
          ));
          subscriptions.push(ThermalPrinter.addDiscoveryEventListener(
            ThermalPrinter.EVENT_BLUETOOTH_NOT_SUPPORT,
            () => finish({ ok: false, code: 'BLUETOOTH_NOT_SUPPORTED' }),
          ));

          void ThermalPrinter.NativePrinter.scanBluetoothDevices().catch((error: unknown) => {
            const native = error as { code?: string; message?: string } | null;
            finish({
              ok: false,
              code: native?.code || 'CONNECTION_FAILED',
              message: native?.message,
            });
          });
        });
      } finally {
        cleanUp();
        try {
          await ThermalPrinter.NativePrinter.stopScanDevices();
        } catch {
          // Discovery may already have stopped on its own.
        }
      }
    } catch (error) {
      const native = error as { code?: string; message?: string } | null;
      return {
        ok: false as const,
        code: native?.code || 'CONNECTION_FAILED',
        message: native?.message,
      };
    }
  }, [supported]);

  const testPrinter = useCallback(async (address: string): Promise<PrinterOutcome> => {
    if (!supported) return { ok: false, code: 'UNSUPPORTED_PLATFORM' };

    try {
      const granted = await requestAndroidBluetoothPermissions();
      if (!granted) return { ok: false, code: 'PERMISSION_DENIED' };

      const { ThermalPrinter } = await loadPrinterModule();
      const result = await ThermalPrinter.NativePrinter.testConnection(address);
      if (result?.success) return { ok: true };
      return {
        ok: false,
        code: result?.error?.code || 'CONNECTION_FAILED',
        message: result?.error?.message,
      };
    } catch (error) {
      return failureFrom(error, 'CONNECTION_FAILED');
    }
  }, [supported]);

  const printReceiptView = useCallback(async (view: View | null): Promise<PrinterOutcome> => {
    if (!supported) return { ok: false, code: 'UNSUPPORTED_PLATFORM' };
    if (!selectedPrinter) return { ok: false, code: 'NO_PRINTER_SELECTED' };
    if (!view) return { ok: false, code: 'CAPTURE_FAILED' };

    setPrinting(true);
    let capturedUri = '';
    let rasterUri = '';
    try {
      const granted = await requestAndroidBluetoothPermissions();
      if (!granted) return { ok: false, code: 'PERMISSION_DENIED' };

      try {
        capturedUri = await captureRef(view, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
        });
      } catch (error) {
        return failureFrom(error, 'CAPTURE_FAILED');
      }

      // The slip is laid out in density-independent pixels, so on a 3x phone the
      // capture comes back around 1150 px wide. Downscaling to the head's own
      // 384 dots here means the printer receives the bitmap 1:1, and the extra
      // detail thrown away acts as supersampling that keeps Thai tone marks
      // legible once the driver thresholds it to pure black and white.
      const context = ImageManipulator.manipulate(capturedUri);
      context.resize({ width: RECEIPT_WIDTH_DOTS_58MM });
      const rendered = await context.renderAsync();
      let rasterHeight = 0;
      try {
        rasterHeight = rendered.height;
        const resized = await rendered.saveAsync({ format: SaveFormat.PNG });
        rasterUri = resized.uri;
      } finally {
        rendered.release();
      }

      const bands = planReceiptRasterBands(rasterHeight);
      if (!bands.length) return { ok: false, code: 'CAPTURE_FAILED' };

      const { ThermalPrinter } = await loadPrinterModule();
      for (let index = 0; index < bands.length; index += 1) {
        const band = bands[index];
        const isLastBand = index === bands.length - 1;

        // A single-band slip is sent as captured, so the common short receipt
        // takes exactly the path it always did.
        let bandUri = rasterUri;
        if (bands.length > 1) {
          const bandContext = ImageManipulator.manipulate(rasterUri);
          bandContext.crop({
            originX: 0,
            originY: band.originY,
            width: RECEIPT_WIDTH_DOTS_58MM,
            height: band.height,
          });
          const bandImage = await bandContext.renderAsync();
          try {
            bandUri = (await bandImage.saveAsync({ format: SaveFormat.PNG })).uri;
          } finally {
            bandImage.release();
          }
        }

        const result = await ThermalPrinter.NativePrinter.printImage(
          selectedPrinter.address,
          bandUri,
          {
            widthPx: RECEIPT_WIDTH_DOTS_58MM,
            align: 'center',
            // Only the final band cuts, otherwise the slip is guillotined into
            // pieces; the earlier ones hold the socket open so the receipt is
            // not reconnected - and re-initialised - between bands.
            isCutPaper: isLastBand,
            keepAlive: !isLastBand,
          },
          { paperWidthMm: PAPER_WIDTH_MM_58 },
        );

        if (!result?.success) {
          return {
            ok: false,
            code: result?.error?.code || 'WRITE_FAILED',
            message: result?.error?.message,
          };
        }
      }

      return { ok: true };
    } catch (error) {
      return failureFrom(error, 'WRITE_FAILED');
    } finally {
      setPrinting(false);
      if (capturedUri) {
        try {
          releaseCapture(capturedUri);
        } catch {
          // A leftover temp file is not worth failing a completed print over.
        }
      }
    }
  }, [selectedPrinter, supported]);

  const value = useMemo<PrinterContextValue>(() => ({
    ready,
    supported,
    selectedPrinter,
    bluetoothState,
    printing,
    selectPrinter,
    forgetPrinter,
    refreshBluetoothState,
    enableBluetooth,
    scanPrinters,
    testPrinter,
    printReceiptView,
  }), [
    bluetoothState,
    enableBluetooth,
    forgetPrinter,
    printReceiptView,
    printing,
    ready,
    refreshBluetoothState,
    scanPrinters,
    selectPrinter,
    selectedPrinter,
    supported,
    testPrinter,
  ]);

  return (
    <PrinterContext.Provider value={value}>
      {children}
    </PrinterContext.Provider>
  );
}

export function usePrinter() {
  const context = useContext(PrinterContext);
  if (!context) {
    throw new Error('usePrinter must be used inside PrinterProvider');
  }
  return context;
}
