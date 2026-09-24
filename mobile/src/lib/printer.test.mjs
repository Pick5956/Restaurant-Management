import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  RECEIPT_MAX_BAND_HEIGHT,
  RECEIPT_WIDTH_DOTS_58MM,
  planReceiptRasterBands,
  describePrinterFailure,
  findSavedPrinter,
  isBluetoothPrinterAddress,
  looksLikeReceiptPrinter,
  mergeScannedPrinters,
  normalizeMacAddress,
  parseScannedDevice,
  parseScannedDeviceList,
  printerFailureReason,
  toBluetoothPrinterAddress,
} from './printer.ts';

test('the 58 mm slip is rastered at the printer head width', () => {
  assert.equal(RECEIPT_WIDTH_DOTS_58MM, 384);
});

test('normalizeMacAddress accepts the shapes platforms actually report', () => {
  assert.equal(normalizeMacAddress('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress('AA-BB-CC-DD-EE-FF'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress('aabbccddeeff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress('  AA:BB:CC:DD:EE:FF  '), 'AA:BB:CC:DD:EE:FF');
});

test('normalizeMacAddress rejects anything that is not a MAC', () => {
  assert.equal(normalizeMacAddress(''), null);
  assert.equal(normalizeMacAddress(null), null);
  assert.equal(normalizeMacAddress(undefined), null);
  assert.equal(normalizeMacAddress('AA:BB:CC:DD:EE'), null);
  assert.equal(normalizeMacAddress('AA:BB:CC:DD:EE:FF:00'), null);
  assert.equal(normalizeMacAddress('ZZ:BB:CC:DD:EE:FF'), null);
  assert.equal(normalizeMacAddress('192.0.2.10'), null);
});

test('toBluetoothPrinterAddress adds the transport prefix exactly once', () => {
  assert.equal(
    toBluetoothPrinterAddress('aa:bb:cc:dd:ee:ff'),
    'bt:AA:BB:CC:DD:EE:FF',
  );
  assert.equal(
    toBluetoothPrinterAddress('bt:aa:bb:cc:dd:ee:ff'),
    'bt:AA:BB:CC:DD:EE:FF',
  );
  assert.equal(
    toBluetoothPrinterAddress('BT:AA:BB:CC:DD:EE:FF'),
    'bt:AA:BB:CC:DD:EE:FF',
  );
  assert.equal(toBluetoothPrinterAddress('not-a-printer'), null);
});

test('isBluetoothPrinterAddress guards a stored selection before dialling it', () => {
  assert.equal(isBluetoothPrinterAddress('bt:AA:BB:CC:DD:EE:FF'), true);
  assert.equal(isBluetoothPrinterAddress('lan:192.0.2.10:9100'), false);
  assert.equal(isBluetoothPrinterAddress(''), false);
});

// Anything else in the string used to be stripped before the count, so a
// value with twelve hex letters left in it passed: "lan:192.0.2.10:9100" keeps
// the A of "lan" and eleven digits, and read as A1:92:02:10:91:00.
test('a MAC is hex digits and separators only, never whatever twelve hex letters remain', () => {
  assert.equal(normalizeMacAddress('lan:192.0.2.10:9100'), null);
  assert.equal(normalizeMacAddress('Printer AB:CD:EF:12:34'), null);
  assert.equal(normalizeMacAddress('AA:BB:CC:DD:EE:FF (XP-58)'), null);
  assert.equal(toBluetoothPrinterAddress('lan:192.0.2.10:9100'), null);
  // The shapes platforms report still pass.
  assert.equal(normalizeMacAddress('aa:bb:cc:dd:ee:ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress('AA-BB-CC-DD-EE-FF'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress('aabb.ccdd.eeff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMacAddress(' AA BB CC DD EE FF '), 'AA:BB:CC:DD:EE:FF');
});

test('looksLikeReceiptPrinter recognises the usual advertised names', () => {
  assert.equal(looksLikeReceiptPrinter('XP-58IIH'), true);
  assert.equal(looksLikeReceiptPrinter('Xprinter_2D33'), true);
  assert.equal(looksLikeReceiptPrinter('BlueTooth Printer'), true);
  assert.equal(looksLikeReceiptPrinter('RPP02N'), true);
  assert.equal(looksLikeReceiptPrinter('POS-58'), true);
  assert.equal(looksLikeReceiptPrinter('Galaxy Buds'), false);
  assert.equal(looksLikeReceiptPrinter(''), false);
  assert.equal(looksLikeReceiptPrinter(null), false);
});

test('parseScannedDeviceList reads the JSON string the native module emits', () => {
  const devices = parseScannedDeviceList(
    '[{"name":"Printer001","address":"AA:BB:CC:DD:EE:FF","deviceType":"bt"}]',
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'Printer001');
  assert.equal(devices[0].address, 'AA:BB:CC:DD:EE:FF');
});

test('parseScannedDeviceList also accepts an already-parsed array', () => {
  const devices = parseScannedDeviceList([{ name: 'Printer001', address: 'AA:BB:CC:DD:EE:FF' }]);

  assert.equal(devices.length, 1);
  assert.equal(devices[0].name, 'Printer001');
});

test('parseScannedDeviceList survives every malformed payload', () => {
  assert.deepEqual(parseScannedDeviceList('[]'), []);
  assert.deepEqual(parseScannedDeviceList('not json'), []);
  assert.deepEqual(parseScannedDeviceList('{"paired":1}'), []);
  assert.deepEqual(parseScannedDeviceList(undefined), []);
  assert.deepEqual(parseScannedDeviceList(null), []);
  assert.deepEqual(parseScannedDeviceList(42), []);
  assert.deepEqual(parseScannedDeviceList('[null,3,"x"]'), []);
});

test('parseScannedDevice reads a single device event payload', () => {
  const device = parseScannedDevice('{"name":"Printer001","address":"AA:BB:CC:DD:EE:FF"}');

  assert.equal(device?.address, 'AA:BB:CC:DD:EE:FF');
  assert.equal(parseScannedDevice('[]'), null);
  assert.equal(parseScannedDevice('nope'), null);
  assert.equal(parseScannedDevice(null), null);
  assert.equal(parseScannedDevice(7), null);
});

test('a paired-devices event feeds straight into the printer list', () => {
  const printers = mergeScannedPrinters(
    parseScannedDeviceList(
      '[{"name":"Printer001","address":"AA:BB:CC:DD:EE:FF","deviceType":"bt"},{"name":"Monster Airmars XKT08","address":"11:22:33:44:55:66","deviceType":"bt"}]',
    ),
    [],
  );

  assert.deepEqual(
    printers.map((printer) => printer.name),
    ['Printer001', 'Monster Airmars XKT08'],
  );
  assert.equal(printers[0].address, 'bt:AA:BB:CC:DD:EE:FF');
  assert.equal(printers[0].paired, true);
});

test('mergeScannedPrinters keeps paired devices first, then likely printers', () => {
  const merged = mergeScannedPrinters(
    [{ name: 'Galaxy Buds', address: '11:22:33:44:55:66' }],
    [
      { name: 'Car Audio', address: '77:88:99:AA:BB:CC' },
      { name: 'XP-58IIH', address: 'aa:bb:cc:dd:ee:ff' },
    ],
  );

  assert.deepEqual(
    merged.map((printer) => printer.name),
    ['Galaxy Buds', 'XP-58IIH', 'Car Audio'],
  );
  assert.deepEqual(
    merged.map((printer) => printer.paired),
    [true, false, false],
  );
});

test('mergeScannedPrinters deduplicates a device seen in both lists', () => {
  const merged = mergeScannedPrinters(
    [{ name: 'XP-58IIH', address: 'AA:BB:CC:DD:EE:FF' }],
    [{ name: 'XP-58IIH', address: 'aa:bb:cc:dd:ee:ff' }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].address, 'bt:AA:BB:CC:DD:EE:FF');
  assert.equal(merged[0].paired, true);
});

test('mergeScannedPrinters recovers a name from whichever list carried one', () => {
  const merged = mergeScannedPrinters(
    [{ name: '', address: 'AA:BB:CC:DD:EE:FF' }],
    [{ name: 'XP-58IIH', address: 'AA:BB:CC:DD:EE:FF' }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'XP-58IIH');
  assert.equal(merged[0].paired, true);
});

test('mergeScannedPrinters falls back to the MAC when a device has no name', () => {
  const merged = mergeScannedPrinters([{ address: 'AA:BB:CC:DD:EE:FF' }], []);

  assert.equal(merged[0].name, 'AA:BB:CC:DD:EE:FF');
});

test('mergeScannedPrinters drops entries without a usable address', () => {
  const merged = mergeScannedPrinters(
    [{ name: 'Ghost', address: null }, { name: 'Broken', address: 'nope' }],
    [{ name: 'Nameless', address: undefined }],
  );

  assert.deepEqual(merged, []);
});

test('mergeScannedPrinters handles an empty scan', () => {
  assert.deepEqual(mergeScannedPrinters(), []);
  assert.deepEqual(mergeScannedPrinters([], []), []);
});

test('findSavedPrinter matches a stored selection regardless of casing', () => {
  const printers = mergeScannedPrinters(
    [{ name: 'XP-58IIH', address: 'AA:BB:CC:DD:EE:FF' }],
    [],
  );

  assert.equal(
    findSavedPrinter(printers, { address: 'bt:aa:bb:cc:dd:ee:ff', name: 'XP-58IIH' })?.name,
    'XP-58IIH',
  );
  assert.equal(findSavedPrinter(printers, null), null);
  assert.equal(
    findSavedPrinter(printers, { address: 'bt:00:00:00:00:00:00', name: 'Other' }),
    null,
  );
  assert.equal(findSavedPrinter(printers, { address: 'garbage', name: 'Other' }), null);
});

test('describePrinterFailure translates the codes a waiter can act on', () => {
  assert.match(describePrinterFailure('BLUETOOTH_NOT_ENABLED', 'th'), /บลูทูธปิดอยู่/);
  assert.match(describePrinterFailure('BLUETOOTH_NOT_ENABLED', 'en'), /Bluetooth is off/);
  assert.match(describePrinterFailure('NO_PRINTER_SELECTED', 'th'), /ยังไม่ได้เลือกเครื่องพิมพ์/);
  assert.match(describePrinterFailure('UNSUPPORTED_PLATFORM', 'en'), /Android only/);
});

// Review, 2026-09-24: an unknown code used to put the native module's own
// message on screen - the library's English, or a firmware string. The rule:
// never show that wording; an unmapped failure keeps the step's title.
test('an unknown printer code gives no reason, and never the native message', () => {
  assert.equal(printerFailureReason('SOME_NEW_FIRMWARE_CODE', 'th'), null);
  assert.equal(printerFailureReason(null, 'en'), null);
  assert.equal(printerFailureReason(undefined, 'th'), null);
  assert.equal(printerFailureReason('TIMEOUT', 'th'), 'เครื่องพิมพ์ไม่ตอบสนอง');
  assert.equal(printerFailureReason('TIMEOUT', 'en'), 'The printer did not respond.');
});

test('describePrinterFailure says only that the print failed for an unknown code', () => {
  assert.equal(
    describePrinterFailure('SOME_NEW_FIRMWARE_CODE', 'th', 'Printer said no'),
    'พิมพ์ใบเสร็จไม่สำเร็จ',
  );
  assert.equal(
    describePrinterFailure('SOME_NEW_FIRMWARE_CODE', 'en', 'java.io.IOException: socket closed'),
    'Could not print the receipt.',
  );
  assert.equal(describePrinterFailure(null, 'th'), 'พิมพ์ใบเสร็จไม่สำเร็จ');
  assert.equal(describePrinterFailure(undefined, 'en'), 'Could not print the receipt.');
  assert.equal(describePrinterFailure('', 'en', '   '), 'Could not print the receipt.');
  // A known code still says its own reason, whatever message came with it.
  assert.equal(describePrinterFailure('TIMEOUT', 'en', 'Printer said no'), 'The printer did not respond.');
});

// Review, 2026-09-25: the Bluetooth state manager rejects with its own codes.
// Cancelling the "turn on Bluetooth" prompt came back as ERROR_CANCELLED, which
// FAILURE_COPY did not know, so the settings screen said the receipt had not
// printed under "เชื่อมต่อไม่สำเร็จ".
test('the library\'s Bluetooth codes say what staff can act on', () => {
  const off = { th: 'บลูทูธปิดอยู่ เปิดบลูทูธแล้วลองใหม่', en: 'Bluetooth is off. Turn it on and try again.' };
  for (const code of ['ERROR_CANCELLED', 'ERROR_ENABLE']) {
    assert.equal(printerFailureReason(code, 'th'), off.th, code);
    assert.equal(printerFailureReason(code, 'en'), off.en, code);
  }
  assert.equal(printerFailureReason('ERROR_NO_ADAPTER', 'th'), 'เครื่องนี้ไม่รองรับบลูทูธ');
  assert.equal(printerFailureReason('ERROR_NO_ADAPTER', 'en'), 'This device does not support Bluetooth.');
  // The library's PrintErrorCode E-codes, which every Bluetooth Classic test
  // connection and print failure carries: each reads as the reason it names.
  for (const [code, own] of [
    ['E1001', 'DEVICE_NOT_FOUND'],
    ['E1002', 'TIMEOUT'],
    ['E1003', 'CONNECTION_FAILED'],
    ['E1004', 'CONNECTION_FAILED'],
    ['E2001', 'BLUETOOTH_NOT_ENABLED'],
    ['E2002', 'CONNECTION_FAILED'],
    ['E2003', 'PERMISSION_DENIED'],
    ['E2004', 'BLUETOOTH_NOT_SUPPORTED'],
    ['E4001', 'WRITE_FAILED'],
    ['E5001', 'INVALID_ADDRESS'],
  ]) {
    for (const language of ['th', 'en']) {
      const reason = printerFailureReason(code, language);
      assert.ok(reason, `${code} has no reason in ${language}`);
      assert.equal(reason, printerFailureReason(own, language), `${code} should read as ${own}`);
    }
  }
  assert.equal(printerFailureReason('E2001', 'th'), off.th);
  // Nothing actionable in these: no reason, so the step's title stands alone.
  for (const code of ['ERROR_UNKNOWN', 'ERROR_NO_ACTIVITY', 'SCAN_ERROR', 'E3001', 'E9999', 'constructor', 'toString']) {
    assert.equal(printerFailureReason(code, 'th'), null, code);
    assert.equal(printerFailureReason(code, 'en'), null, code);
  }
});

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

async function sourceFiles(dir) {
  const entries = await readdir(path.join(mobileRoot, dir), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  }));
  return nested.flat();
}

/** The source from `start` up to the end of the block it opens. */
function block(source, start) {
  const from = source.indexOf(start);
  assert.ok(from !== -1, `${start} not found`);
  let depth = 0;
  for (let index = source.indexOf('{', from); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(from, index + 1);
  }
  throw new Error(`${start} never closes`);
}

// describePrinterFailure falls back to "พิมพ์ใบเสร็จไม่สำเร็จ". Enabling
// Bluetooth, a scan, a test connection and a QR slip print no receipt, so that
// line under their titles was wrong. Only the bill's receipt print may call it.
test('only the receipt print can show the receipt fallback line', async () => {
  const files = [...await sourceFiles('app'), ...await sourceFiles('src')]
    .filter((file) => file !== 'src/lib/printer.ts');
  const callers = [];
  for (const file of files) {
    if ((await read(file)).includes('describePrinterFailure(')) callers.push(file);
  }
  assert.deepEqual(callers, ['app/order/bill.tsx']);

  const bill = await read('app', 'order', 'bill.tsx');
  const printReceipt = block(bill, 'async function printReceipt()');
  const everywhere = bill.split('describePrinterFailure(').length;
  assert.equal(printReceipt.split('describePrinterFailure(').length, everywhere,
    'describePrinterFailure is called outside printReceipt');
});

test('the printer settings screen and the QR slip leave an unmapped code at the title', async () => {
  const settings = await read('app', 'settings', 'printer.tsx');
  const reports = settings.match(/setError\([^\n]*\);/g) || [];
  assert.equal(reports.length, 4, 'enable, scan, choose and test each report a failure');
  for (const line of reports) {
    assert.match(line, /^setError\(printerFailureReason\((enabled|result)\.code, language\)\);$/, line);
  }
  const setError = settings.slice(settings.indexOf('const setError ='), settings.indexOf('const setNotice ='));
  assert.match(setError, /\(detail: string \| null\)/);
  assert.match(setError, /\.\.\.\(detail \? \{ message: detail \} : \{\}\)/);
  assert.doesNotMatch(setError, /message: detail[,\s]*\}\);/);

  const qr = await read('src', 'components', 'table-plan', 'use-qr-paper.tsx');
  assert.match(qr, /const reason = printerFailureReason\(result\.code, language\);/);
  assert.match(qr, /\.\.\.\(reason \? \{ message: reason \} : \{\}\)/);
});

test('a short receipt stays a single band, exactly as before banding existed', () => {
  assert.deepEqual(planReceiptRasterBands(500), [{ originY: 0, height: 500 }]);
  assert.deepEqual(
    planReceiptRasterBands(RECEIPT_MAX_BAND_HEIGHT),
    [{ originY: 0, height: RECEIPT_MAX_BAND_HEIGHT }],
  );
});

test('a tall receipt is split into bands that never exceed the limit', () => {
  const bands = planReceiptRasterBands(1500, 600);

  assert.equal(bands.length, 3);
  bands.forEach((band) => assert.ok(band.height <= 600, `${band.height} <= 600`));
});

test('bands tile the receipt with no gap and no overlap', () => {
  for (const total of [601, 1000, 1500, 1801, 2345, 5000]) {
    const bands = planReceiptRasterBands(total, 600);

    assert.equal(bands[0].originY, 0, `first band starts at 0 for ${total}`);
    bands.forEach((band, index) => {
      if (index === 0) return;
      const previous = bands[index - 1];
      assert.equal(
        band.originY,
        previous.originY + previous.height,
        `band ${index} continues the previous one for ${total}`,
      );
    });

    const covered = bands.reduce((sum, band) => sum + band.height, 0);
    assert.equal(covered, total, `bands cover the whole slip for ${total}`);
  }
});

test('bands are divided evenly so the last one is never a sliver', () => {
  // 1210 over a 600 limit would leave a 10 dot tail if it packed full bands
  // first; splitting evenly gives three usable bands instead.
  const bands = planReceiptRasterBands(1210, 600);

  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map((band) => band.height), [404, 403, 403]);
});

test('planReceiptRasterBands rejects heights that cannot be printed', () => {
  assert.deepEqual(planReceiptRasterBands(0), []);
  assert.deepEqual(planReceiptRasterBands(-100), []);
  assert.deepEqual(planReceiptRasterBands(Number.NaN), []);
});

test('an unusable band limit falls back to sending the slip whole', () => {
  assert.deepEqual(planReceiptRasterBands(1500, 0), [{ originY: 0, height: 1500 }]);
  assert.deepEqual(planReceiptRasterBands(1500, -10), [{ originY: 0, height: 1500 }]);
});

// A QR slip reads its failure through printerFailureReason as well, so a shared
// reason never names the receipt: "สร้างภาพใบเสร็จไม่สำเร็จ" under "พิมพ์ QR
// ไม่สำเร็จ" told staff about a receipt nobody printed.
test('no shared printer reason names the receipt', async () => {
  const source = (await readFile(fileURLToPath(new URL('./printer.ts', import.meta.url)), 'utf8')).replace(/\r\n/g, '\n');
  const start = source.indexOf('const FAILURE_COPY');
  const block = source.slice(start, source.indexOf('\n};\n', start));
  const codes = [...block.matchAll(/^  ([A-Z_]+): \{$/gm)].map(([, code]) => code);
  assert.ok(codes.includes('CAPTURE_FAILED') && codes.includes('WRITE_FAILED'), 'FAILURE_COPY was not found');
  for (const code of codes) {
    for (const language of ['th', 'en']) {
      const reason = printerFailureReason(code, language);
      assert.ok(reason, `${code} has no reason in ${language}`);
      assert.doesNotMatch(reason, /ใบเสร็จ|receipt/i, `${code} (${language}) names the receipt`);
    }
  }
});
