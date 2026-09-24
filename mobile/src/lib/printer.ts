import type { DisplayLanguage } from '@/src/lib/display-preferences';

// A 58 mm thermal head prints 384 dots across (~48 mm of printable area at
// 203 dpi). Rendering the slip at exactly this pixel width means the bitmap is
// sent to the printer 1:1 with no resampling, which keeps Thai glyphs sharp -
// they are the reason we raster the receipt instead of sending ESC/POS text at
// all, since the XP-58IIH firmware has no Thai code page.
export const RECEIPT_WIDTH_DOTS_58MM = 384;

// Bluetooth Classic (SPP) is the only transport an XP-58IIH speaks. The library
// addresses every transport through one string, so the prefix is what tells it
// which stack to use.
const BLUETOOTH_ADDRESS_PREFIX = 'bt:';

const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

export interface SavedPrinter {
  address: string;
  name: string;
}

export interface DiscoveredPrinter extends SavedPrinter {
  paired: boolean;
}

export interface ScannedDevice {
  name?: string | null;
  address?: string | null;
  deviceType?: string;
}

/**
 * Normalizes whatever casing/separator the platform reports into the canonical
 * upper-case colon form, so a printer saved today still matches a scan result
 * tomorrow.
 */
export function normalizeMacAddress(value: string | null | undefined): string | null {
  const upper = String(value || '').trim().toUpperCase();
  // Hex digits and the separators platforms write, nothing else. Stripping
  // every other character first let anything with twelve hex letters left in
  // it pass: "lan:192.0.2.10:9100" read as A1:92:02:10:91:00.
  if (!/^[0-9A-F:.\- ]+$/.test(upper)) return null;
  const compact = upper.replace(/[^0-9A-F]/g, '');
  if (compact.length !== 12) return null;

  const mac = compact.match(/.{2}/g)?.join(':') || '';
  return MAC_PATTERN.test(mac) ? mac : null;
}

export function toBluetoothPrinterAddress(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  const withoutPrefix = raw.toLowerCase().startsWith(BLUETOOTH_ADDRESS_PREFIX)
    ? raw.slice(BLUETOOTH_ADDRESS_PREFIX.length)
    : raw;
  const mac = normalizeMacAddress(withoutPrefix);
  return mac ? `${BLUETOOTH_ADDRESS_PREFIX}${mac}` : null;
}

export function isBluetoothPrinterAddress(value: string | null | undefined): boolean {
  return toBluetoothPrinterAddress(value) !== null;
}

// Receipt printers advertise themselves with a small, boringly consistent set of
// names. This never hides a device - an unrecognised name still lists, just
// lower down - because a renamed printer must stay reachable.
const PRINTER_NAME_HINTS = [
  'printer',
  'xprinter',
  'xp-',
  'pos',
  'thermal',
  'receipt',
  'escpos',
  'esc/pos',
  'rpp',
  'mtp',
  'mpt',
  'bluetooth printer',
];

export function looksLikeReceiptPrinter(name: string | null | undefined): boolean {
  const label = String(name || '').trim().toLowerCase();
  if (!label) return false;
  return PRINTER_NAME_HINTS.some((hint) => label.includes(hint));
}

function printerLabel(rawName: string, address: string): string {
  return rawName || address.slice(BLUETOOTH_ADDRESS_PREFIX.length);
}

function isScannedDevice(value: unknown): value is ScannedDevice {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a device list out of a discovery event.
 *
 * The native module hands these over as a JSON *string* even though the
 * library's own type declarations promise an array - the returned scan result
 * carries no device lists at all, only `success`. Both shapes are accepted here
 * so a future version that fixes the declaration keeps working.
 */
export function parseScannedDeviceList(raw: unknown): ScannedDevice[] {
  if (Array.isArray(raw)) return raw.filter(isScannedDevice);
  if (typeof raw !== 'string') return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isScannedDevice) : [];
  } catch {
    return [];
  }
}

export function parseScannedDevice(raw: unknown): ScannedDevice | null {
  if (isScannedDevice(raw) && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw);
    return isScannedDevice(parsed) && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Turns a raw scan result into the list the picker renders: Bluetooth devices
 * only, deduplicated by address, paired devices first (those are the ones the
 * user already set up in Android settings, which is the normal way these
 * printers get connected), then likely printers, then everything else by name.
 */
export function mergeScannedPrinters(
  paired: readonly ScannedDevice[] = [],
  found: readonly ScannedDevice[] = [],
): DiscoveredPrinter[] {
  // The advertised name is kept raw here rather than as a display label, so a
  // device listed twice - nameless in one list, named in the other - can still
  // pick up the real name instead of being pinned to its MAC fallback.
  const byAddress = new Map<string, { address: string; rawName: string; paired: boolean }>();

  const collect = (devices: readonly ScannedDevice[], isPaired: boolean) => {
    devices.forEach((device) => {
      const address = toBluetoothPrinterAddress(device.address);
      if (!address) return;

      const rawName = String(device.name || '').trim();
      const existing = byAddress.get(address);
      byAddress.set(address, {
        address,
        rawName: existing?.rawName || rawName,
        paired: (existing?.paired || isPaired) === true,
      });
    });
  };

  collect(paired, true);
  collect(found, false);

  return Array.from(byAddress.values()).map((entry) => ({
    address: entry.address,
    name: printerLabel(entry.rawName, entry.address),
    paired: entry.paired,
  })).sort((left, right) => {
    if (left.paired !== right.paired) return left.paired ? -1 : 1;

    const leftLikely = looksLikeReceiptPrinter(left.name);
    const rightLikely = looksLikeReceiptPrinter(right.name);
    if (leftLikely !== rightLikely) return leftLikely ? -1 : 1;

    return left.name.localeCompare(right.name);
  });
}

export function findSavedPrinter(
  printers: readonly DiscoveredPrinter[],
  saved: SavedPrinter | null,
): DiscoveredPrinter | null {
  if (!saved) return null;
  const address = toBluetoothPrinterAddress(saved.address);
  if (!address) return null;
  return printers.find((printer) => printer.address === address) || null;
}

// The receipt travels to the printer at 512 bytes every 35 ms, and a 58 mm head
// takes 48 bytes per row, so a tall slip can outrun the printer's buffer. When
// that happens the stream desynchronises and the printer prints the raster bytes
// as text - pages of garbage - and stays that way until it is power cycled.
// Sending the bitmap in bands lets the printer drain between them.
export const RECEIPT_MAX_BAND_HEIGHT = 600;

export interface ReceiptRasterBand {
  originY: number;
  height: number;
}

/**
 * Splits a slip of `totalHeight` dots into bands no taller than `maxBandHeight`.
 *
 * Short receipts - the common case - come back as a single band, so the fast
 * path stays exactly what it was before banding existed. Taller ones are divided
 * as evenly as the height allows rather than into full bands plus a remainder,
 * which avoids ending on a sliver that prints as a seam.
 */
export function planReceiptRasterBands(
  totalHeight: number,
  maxBandHeight: number = RECEIPT_MAX_BAND_HEIGHT,
): ReceiptRasterBand[] {
  if (!Number.isFinite(totalHeight) || totalHeight <= 0) return [];

  const height = Math.floor(totalHeight);
  const limit = Number.isFinite(maxBandHeight) && maxBandHeight > 0
    ? Math.floor(maxBandHeight)
    : height;

  if (height <= limit) return [{ originY: 0, height }];

  const bandCount = Math.ceil(height / limit);
  const baseHeight = Math.floor(height / bandCount);
  const remainder = height - baseHeight * bandCount;

  const bands: ReceiptRasterBand[] = [];
  let originY = 0;
  for (let index = 0; index < bandCount; index += 1) {
    const bandHeight = baseHeight + (index < remainder ? 1 : 0);
    bands.push({ originY, height: bandHeight });
    originY += bandHeight;
  }

  return bands;
}

export type PrinterFailureCode =
  | 'BLUETOOTH_NOT_ENABLED'
  | 'BLUETOOTH_NOT_SUPPORTED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_BUSY'
  | 'CONNECTION_FAILED'
  | 'CONNECTION_LOST'
  | 'WRITE_FAILED'
  | 'PERMISSION_DENIED'
  | 'TIMEOUT'
  | 'INVALID_ADDRESS'
  | 'UNSUPPORTED_DEVICE'
  | 'NO_PRINTER_SELECTED'
  | 'CAPTURE_FAILED'
  | 'UNSUPPORTED_PLATFORM';

const FAILURE_COPY: Record<PrinterFailureCode, { th: string; en: string }> = {
  BLUETOOTH_NOT_ENABLED: {
    th: 'บลูทูธปิดอยู่ เปิดบลูทูธแล้วลองใหม่',
    en: 'Bluetooth is off. Turn it on and try again.',
  },
  BLUETOOTH_NOT_SUPPORTED: {
    th: 'เครื่องนี้ไม่รองรับบลูทูธ',
    en: 'This device does not support Bluetooth.',
  },
  DEVICE_NOT_FOUND: {
    th: 'ไม่พบเครื่องพิมพ์ ตรวจว่าเปิดเครื่องและอยู่ในระยะ',
    en: 'Printer not found. Check that it is on and in range.',
  },
  DEVICE_BUSY: {
    th: 'เครื่องพิมพ์กำลังทำงานอื่นอยู่ รอสักครู่แล้วลองใหม่',
    en: 'The printer is busy. Wait a moment and try again.',
  },
  CONNECTION_FAILED: {
    th: 'เชื่อมต่อเครื่องพิมพ์ไม่สำเร็จ ลองจับคู่ใหม่ในการตั้งค่าบลูทูธ',
    en: 'Could not connect. Try pairing again in Bluetooth settings.',
  },
  CONNECTION_LOST: {
    th: 'การเชื่อมต่อหลุดระหว่างพิมพ์',
    en: 'The connection dropped while printing.',
  },
  WRITE_FAILED: {
    th: 'ส่งข้อมูลไปเครื่องพิมพ์ไม่สำเร็จ',
    en: 'Could not send it to the printer.',
  },
  PERMISSION_DENIED: {
    th: 'ยังไม่ได้อนุญาตให้ใช้บลูทูธ เปิดสิทธิ์ในการตั้งค่าแอป',
    en: 'Bluetooth permission is denied. Allow it in app settings.',
  },
  TIMEOUT: {
    th: 'เครื่องพิมพ์ไม่ตอบสนอง',
    en: 'The printer did not respond.',
  },
  INVALID_ADDRESS: {
    th: 'ที่อยู่เครื่องพิมพ์ไม่ถูกต้อง เลือกเครื่องใหม่อีกครั้ง',
    en: 'The printer address is invalid. Pick the printer again.',
  },
  UNSUPPORTED_DEVICE: {
    th: 'อุปกรณ์นี้ไม่ใช่เครื่องพิมพ์ที่รองรับ',
    en: 'This device is not a supported printer.',
  },
  NO_PRINTER_SELECTED: {
    th: 'ยังไม่ได้เลือกเครื่องพิมพ์ ไปที่ ตั้งค่า > เครื่องพิมพ์',
    en: 'No printer selected yet. Go to Settings > Printer.',
  },
  CAPTURE_FAILED: {
    th: 'สร้างภาพสำหรับพิมพ์ไม่สำเร็จ',
    en: 'Could not render the image to print.',
  },
  UNSUPPORTED_PLATFORM: {
    th: 'พิมพ์ผ่านบลูทูธรองรับเฉพาะ Android เท่านั้น',
    en: 'Bluetooth printing is supported on Android only.',
  },
};

// The Bluetooth state manager in @finan-me/react-native-thermal-printer rejects
// with its own codes, not ours. Cancelling the system "turn on Bluetooth"
// prompt, or the prompt failing to open, still means Bluetooth is off; no
// adapter means the phone has none. ERROR_UNKNOWN, ERROR_NO_ACTIVITY and
// SCAN_ERROR say nothing a waiter can act on, so they stay unmapped.
const NATIVE_CODE_ALIASES: Readonly<Record<string, PrinterFailureCode>> = {
  // BluetoothStateManager (enabling Bluetooth, scanning).
  ERROR_CANCELLED: 'BLUETOOTH_NOT_ENABLED',
  ERROR_ENABLE: 'BLUETOOTH_NOT_ENABLED',
  ERROR_NO_ADAPTER: 'BLUETOOTH_NOT_SUPPORTED',
  // PrintErrorCode, the library's E-codes (printing/shared/errors.ts): every
  // Bluetooth Classic test connection and print failure comes back as one.
  // The network codes and E9xxx have nothing a waiter can act on and stay out.
  E1001: 'DEVICE_NOT_FOUND',
  E1002: 'TIMEOUT',
  E1003: 'CONNECTION_FAILED',
  E1004: 'CONNECTION_FAILED',
  E2001: 'BLUETOOTH_NOT_ENABLED',
  // Its copy already says to pair the printer again.
  E2002: 'CONNECTION_FAILED',
  E2003: 'PERMISSION_DENIED',
  E2004: 'BLUETOOTH_NOT_SUPPORTED',
  E4001: 'WRITE_FAILED',
  E5001: 'INVALID_ADDRESS',
};

/**
 * Maps a native error code onto something a waiter can act on, or null for a
 * code the app does not know. The native module's own message is never the
 * answer: it is the library's English or a firmware string, not the app's
 * words, so an unknown code leaves the caller's title to say what failed.
 * Every caller that is not printing a receipt - enabling Bluetooth, scanning,
 * testing a printer, printing a QR slip - uses this and omits the detail line
 * when it is null.
 */
export function printerFailureReason(
  code: string | null | undefined,
  language: DisplayLanguage = 'th',
): string | null {
  const raw = String(code || '');
  const own = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);
  const resolved = own(NATIVE_CODE_ALIASES, raw) ? NATIVE_CODE_ALIASES[raw] : raw;
  const known = own(FAILURE_COPY, resolved) ? FAILURE_COPY[resolved as PrinterFailureCode] : null;
  if (!known) return null;
  return language === 'th' ? known.th : known.en;
}

/**
 * Always a line, for the receipt print only: the reason when the code is
 * known, otherwise that the receipt did not print. That fallback names the
 * receipt, so anything else - enabling Bluetooth, a scan, a test connection,
 * a QR slip - uses printerFailureReason and says nothing extra when it is null.
 */
export function describePrinterFailure(
  code: string | null | undefined,
  language: DisplayLanguage = 'th',
): string {
  return printerFailureReason(code, language) ?? (language === 'th'
    ? 'พิมพ์ใบเสร็จไม่สำเร็จ'
    : 'Could not print the receipt.');
}
