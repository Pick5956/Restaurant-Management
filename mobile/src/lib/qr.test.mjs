import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createQrMatrix, qrMatrixPath, qrViewBoxSize } from './qr.ts';
import {
  createQrMatrix as webCreateQrMatrix,
  qrMatrixPath as webQrMatrixPath,
  qrViewBoxSize as webQrViewBoxSize,
} from '../../../frontend/src/lib/qr.ts';

// Invented tokens: the real one is a table's access key and never belongs in a test.
const FAKE_TOKEN = '0123456789abcdef'.repeat(3);
const customerUrl = (token) => `https://dishy.pro/customer/t/${token}`;

const SAMPLES = [
  customerUrl(FAKE_TOKEN),
  customerUrl('f'.repeat(48)),
  `http://192.0.2.10:3000/customer/t/${'9'.repeat(48)}`,
  'https://dishy.pro',
  'A',
  'สแกนหรือเปิดลิงก์นี้เพื่อสั่งอาหารที่โต๊ะ T5',
  'emoji \u{1F35C} and a lone surrogate \uD800 here',
  `https://dishy.pro/customer/t/${'ab'.repeat(90)}`,
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('the phone draws exactly the matrix the web draws', () => {
  for (const text of SAMPLES) {
    assert.deepEqual(createQrMatrix(text), webCreateQrMatrix(text), text);
  }
});

test('the SVG path and view box match the web for every quiet zone', () => {
  for (const text of SAMPLES) {
    const matrix = createQrMatrix(text);
    const webMatrix = webCreateQrMatrix(text);
    for (const quietZone of [undefined, 0, 2, 4]) {
      assert.equal(qrMatrixPath(matrix, quietZone), webQrMatrixPath(webMatrix, quietZone), `${text} @ ${quietZone}`);
      assert.equal(qrViewBoxSize(matrix, quietZone), webQrViewBoxSize(webMatrix, quietZone));
    }
  }
});

test('the output is pinned, so a change to either copy cannot pass unseen', () => {
  // Recorded from frontend/src/lib/qr.ts on 2026-09-23.
  const pinned = [
    [customerUrl(FAKE_TOKEN), 37, 45, '83736522aedecc090bf3eec4ab7090b11e29c1947bbf221329ea448b26862e85'],
    ['https://dishy.pro', 25, 33, '28fe2705cc88cb91ad75d5a2755e54496eb4179e89cca707a395810530c0997b'],
    ['A', 21, 29, '405f4a5cde4663be079244b7e625133bd27ddf8fcda0182be9d7d7da82c01c35'],
  ];
  for (const [text, size, viewBox, hash] of pinned) {
    const matrix = createQrMatrix(text);
    assert.equal(matrix.length, size, text);
    assert.equal(qrViewBoxSize(matrix), viewBox);
    assert.equal(sha256(qrMatrixPath(matrix)), hash, text);
  }
});

test('the matrix is a square QR with its three finder patterns', () => {
  const matrix = createQrMatrix(customerUrl(FAKE_TOKEN));
  const size = matrix.length;
  assert.equal((size - 17) % 4, 0, 'size is 4 x version + 17');
  for (const row of matrix) assert.equal(row.length, size);
  for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let delta = 0; delta < 7; delta += 1) {
      assert.equal(matrix[y][x + delta], true, 'finder top edge');
      assert.equal(matrix[y + 6][x + delta], true, 'finder bottom edge');
      assert.equal(matrix[y + delta][x], true, 'finder left edge');
    }
    assert.equal(matrix[y + 1][x + 1], false, 'finder ring');
    assert.equal(matrix[y + 3][x + 3], true, 'finder centre');
  }
});

test('the path is one run per row of dark modules, offset by the quiet zone', () => {
  const matrix = createQrMatrix('A');
  const path = qrMatrixPath(matrix, 4);
  assert.match(path, /^(M\d+ \d+h\d+v1h-\d+z)+$/);
  assert.ok(path.startsWith('M4 4h7v1h-7z'), 'the top-left finder starts the first row');
  assert.ok(qrMatrixPath(matrix, 0).startsWith('M0 0h7v1h-7z'));
});

test('bad input is refused, not drawn wrong', () => {
  assert.throws(() => createQrMatrix(''), RangeError);
  assert.throws(() => createQrMatrix('x'.repeat(400)), RangeError);
  const matrix = createQrMatrix('A');
  assert.throws(() => qrMatrixPath(matrix, -1), RangeError);
  assert.throws(() => qrMatrixPath(matrix, 1.5), RangeError);
  assert.throws(() => qrViewBoxSize([[true]]), RangeError);
  assert.throws(() => qrMatrixPath([[true, false], [false]]), RangeError);
});

test('the longest text that fits encodes the same as the web, one byte more does not', () => {
  // Version 10 at level M carries 213 bytes.
  const longest = 'x'.repeat(213);
  assert.deepEqual(createQrMatrix(longest), webCreateQrMatrix(longest));
  assert.equal(createQrMatrix(longest).length, 57);
  assert.throws(() => createQrMatrix('x'.repeat(214)), RangeError);
});
