/*
 * QR Code Model 2 encoding is adapted from Project Nayuki's QR Code
 * generator, released under the MIT License:
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Copyright (c) Project Nayuki
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

// A port of frontend/src/lib/qr.ts, so the phone draws the same customer QR
// the web draws, on the device, with react-native-svg. The table's customer
// token is its access key: it must never be sent to an outside QR image
// service, and a QR library would be a new dependency.
//
// Two differences from the web copy, neither of which changes a module:
// - UTF-8 is encoded here rather than through TextEncoder, so the bytes do
//   not depend on what the JS engine ships. Lone surrogates become U+FFFD,
//   exactly as TextEncoder does.
// - qrMatrixToPngBlob is left out: it draws on a DOM canvas.
// qr.test.mjs compares every matrix and path with the web implementation.

const MIN_VERSION = 1;
const MAX_VERSION = 10;
const QUIET_ZONE_MODULES = 4;

// QR error-correction level M, versions 1-10. Customer table URLs fit well
// inside this range while retaining enough correction for printed table cards.
const ERROR_CORRECTION_CODEWORDS_PER_BLOCK = [
  0,
  10,
  16,
  26,
  18,
  24,
  16,
  18,
  22,
  22,
  26,
] as const;

const ERROR_CORRECTION_BLOCKS = [
  0,
  1,
  1,
  1,
  2,
  2,
  4,
  4,
  4,
  5,
  5,
] as const;

export type QrMatrix = boolean[][];

class BitBuffer {
  readonly bits: boolean[] = [];

  append(value: number, length: number) {
    if (length < 0 || length > 31 || value >>> length !== 0) {
      throw new RangeError('QR bit value does not fit its declared length');
    }
    for (let index = length - 1; index >= 0; index -= 1) {
      this.bits.push(((value >>> index) & 1) !== 0);
    }
  }
}

/** UTF-8 bytes of `text`, identical to `new TextEncoder().encode(text)`. */
function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function rawDataModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignmentCount = Math.floor(version / 7) + 2;
    result -= (25 * alignmentCount - 10) * alignmentCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number) {
  return Math.floor(rawDataModules(version) / 8)
    - ERROR_CORRECTION_CODEWORDS_PER_BLOCK[version] * ERROR_CORRECTION_BLOCKS[version];
}

function chooseVersion(byteLength: number) {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + byteLength * 8;
    if (requiredBits <= dataCodewords(version) * 8) return version;
  }
  throw new RangeError('Customer table URL is too long to encode as a QR code');
}

function buildDataCodewords(bytes: readonly number[], version: number) {
  const capacityBits = dataCodewords(version) * 8;
  const buffer = new BitBuffer();
  buffer.append(0b0100, 4);
  buffer.append(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) buffer.append(byte, 8);

  const terminatorLength = Math.min(4, capacityBits - buffer.bits.length);
  buffer.append(0, terminatorLength);
  while (buffer.bits.length % 8 !== 0) buffer.bits.push(false);

  const result: number[] = [];
  for (let bitIndex = 0; bitIndex < buffer.bits.length; bitIndex += 8) {
    let value = 0;
    for (let offset = 0; offset < 8; offset += 1) {
      value = (value << 1) | (buffer.bits[bitIndex + offset] ? 1 : 0);
    }
    result.push(value);
  }
  for (let padIndex = 0; result.length < dataCodewords(version); padIndex += 1) {
    result.push(padIndex % 2 === 0 ? 0xec : 0x11);
  }
  return result;
}

function multiplyInGaloisField(left: number, right: number) {
  let result = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((right >>> bit) & 1) * left;
  }
  return result;
}

function reedSolomonDivisor(degree: number) {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;

  for (let divisorIndex = 0; divisorIndex < degree; divisorIndex += 1) {
    for (let coefficient = 0; coefficient < degree; coefficient += 1) {
      result[coefficient] = multiplyInGaloisField(result[coefficient], root);
      if (coefficient + 1 < degree) result[coefficient] ^= result[coefficient + 1];
    }
    root = multiplyInGaloisField(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data: number[], divisor: number[]) {
  const result = Array<number>(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let index = 0; index < divisor.length; index += 1) {
      result[index] ^= multiplyInGaloisField(divisor[index], factor);
    }
  }
  return result;
}

function addErrorCorrectionAndInterleave(data: number[], version: number) {
  const blockCount = ERROR_CORRECTION_BLOCKS[version];
  const errorCorrectionLength = ERROR_CORRECTION_CODEWORDS_PER_BLOCK[version];
  const rawCodewordCount = Math.floor(rawDataModules(version) / 8);
  const shortBlockCount = blockCount - (rawCodewordCount % blockCount);
  const shortBlockLength = Math.floor(rawCodewordCount / blockCount);
  const shortDataLength = shortBlockLength - errorCorrectionLength;
  const divisor = reedSolomonDivisor(errorCorrectionLength);
  const blocks: number[][] = [];
  let dataOffset = 0;

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const blockDataLength = shortDataLength + (blockIndex < shortBlockCount ? 0 : 1);
    const blockData = data.slice(dataOffset, dataOffset + blockDataLength);
    dataOffset += blockDataLength;
    const errorCorrection = reedSolomonRemainder(blockData, divisor);
    if (blockIndex < shortBlockCount) blockData.push(0);
    blocks.push([...blockData, ...errorCorrection]);
  }

  const result: number[] = [];
  for (let index = 0; index < blocks[0].length; index += 1) {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      if (index === shortDataLength && blockIndex < shortBlockCount) continue;
      result.push(blocks[blockIndex][index]);
    }
  }
  return result;
}

function createEmptyMatrix(size: number) {
  return Array.from({ length: size }, () => Array<boolean>(size).fill(false));
}

function setFunctionModule(
  modules: QrMatrix,
  functionModules: QrMatrix,
  x: number,
  y: number,
  dark: boolean,
) {
  modules[y][x] = dark;
  functionModules[y][x] = true;
}

function drawFinderPattern(
  modules: QrMatrix,
  functionModules: QrMatrix,
  centerX: number,
  centerY: number,
) {
  const size = modules.length;
  for (let deltaY = -4; deltaY <= 4; deltaY += 1) {
    for (let deltaX = -4; deltaX <= 4; deltaX += 1) {
      const x = centerX + deltaX;
      const y = centerY + deltaY;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      setFunctionModule(modules, functionModules, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignmentPattern(
  modules: QrMatrix,
  functionModules: QrMatrix,
  centerX: number,
  centerY: number,
) {
  for (let deltaY = -2; deltaY <= 2; deltaY += 1) {
    for (let deltaX = -2; deltaX <= 2; deltaX += 1) {
      const distance = Math.max(Math.abs(deltaX), Math.abs(deltaY));
      setFunctionModule(
        modules,
        functionModules,
        centerX + deltaX,
        centerY + deltaY,
        distance !== 1,
      );
    }
  }
}

function alignmentPatternPositions(version: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = version === 32
    ? 26
    : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) {
    result.splice(1, 0, position);
  }
  return result;
}

function formatBits(mask: number) {
  const data = mask; // Error-correction level M has format bits 00.
  let remainder = data;
  for (let bit = 0; bit < 10; bit += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function drawFormatBits(
  modules: QrMatrix,
  functionModules: QrMatrix | null,
  mask: number,
) {
  const size = modules.length;
  const bits = formatBits(mask);
  const set = (x: number, y: number, bit: number) => {
    modules[y][x] = ((bits >>> bit) & 1) !== 0;
    if (functionModules) functionModules[y][x] = true;
  };

  for (let bit = 0; bit <= 5; bit += 1) set(8, bit, bit);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let bit = 9; bit < 15; bit += 1) set(14 - bit, 8, bit);

  for (let bit = 0; bit < 8; bit += 1) set(size - 1 - bit, 8, bit);
  for (let bit = 8; bit < 15; bit += 1) set(8, size - 15 + bit, bit);
  modules[size - 8][8] = true;
  if (functionModules) functionModules[size - 8][8] = true;
}

function drawVersionBits(
  modules: QrMatrix,
  functionModules: QrMatrix,
  version: number,
) {
  if (version < 7) return;
  let remainder = version;
  for (let bit = 0; bit < 12; bit += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  const bits = (version << 12) | remainder;
  const size = modules.length;

  for (let bit = 0; bit < 18; bit += 1) {
    const dark = ((bits >>> bit) & 1) !== 0;
    const first = size - 11 + (bit % 3);
    const second = Math.floor(bit / 3);
    setFunctionModule(modules, functionModules, first, second, dark);
    setFunctionModule(modules, functionModules, second, first, dark);
  }
}

function drawFunctionPatterns(
  modules: QrMatrix,
  functionModules: QrMatrix,
  version: number,
) {
  const size = modules.length;
  for (let index = 0; index < size; index += 1) {
    setFunctionModule(modules, functionModules, 6, index, index % 2 === 0);
    setFunctionModule(modules, functionModules, index, 6, index % 2 === 0);
  }

  drawFinderPattern(modules, functionModules, 3, 3);
  drawFinderPattern(modules, functionModules, size - 4, 3);
  drawFinderPattern(modules, functionModules, 3, size - 4);

  const alignments = alignmentPatternPositions(version);
  const lastAlignment = alignments.length - 1;
  for (let yIndex = 0; yIndex < alignments.length; yIndex += 1) {
    for (let xIndex = 0; xIndex < alignments.length; xIndex += 1) {
      const overlapsFinder = (
        (xIndex === 0 && yIndex === 0)
        || (xIndex === lastAlignment && yIndex === 0)
        || (xIndex === 0 && yIndex === lastAlignment)
      );
      if (!overlapsFinder) {
        drawAlignmentPattern(
          modules,
          functionModules,
          alignments[xIndex],
          alignments[yIndex],
        );
      }
    }
  }

  drawFormatBits(modules, functionModules, 0);
  drawVersionBits(modules, functionModules, version);
}

function drawCodewords(
  modules: QrMatrix,
  functionModules: QrMatrix,
  codewords: number[],
) {
  const size = modules.length;
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const upward = ((right + 1) & 2) === 0;
      const y = upward ? size - 1 - vertical : vertical;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (functionModules[y][x] || bitIndex >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        bitIndex += 1;
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return (x * y) % 2 + (x * y) % 3 === 0;
    case 6:
      return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
    case 7:
      return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    default:
      throw new RangeError('Invalid QR mask');
  }
}

function applyMask(modules: QrMatrix, functionModules: QrMatrix, mask: number) {
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!functionModules[y][x] && maskApplies(mask, x, y)) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

function linePenalty(line: boolean[]) {
  let result = 0;
  let runLength = 1;
  for (let index = 1; index < line.length; index += 1) {
    if (line[index] === line[index - 1]) {
      runLength += 1;
      if (runLength === 5) result += 3;
      else if (runLength > 5) result += 1;
    } else {
      runLength = 1;
    }
  }
  return result;
}

const FINDER_LIKE_PATTERN = [
  true,
  false,
  true,
  true,
  true,
  false,
  true,
  false,
  false,
  false,
  false,
] as const;

const REVERSED_FINDER_LIKE_PATTERN = [...FINDER_LIKE_PATTERN].reverse();

function finderLikePenalty(line: boolean[]) {
  let result = 0;
  for (let start = 0; start <= line.length - FINDER_LIKE_PATTERN.length; start += 1) {
    const forward = FINDER_LIKE_PATTERN.every((value, index) => line[start + index] === value);
    const reverse = REVERSED_FINDER_LIKE_PATTERN.every(
      (value, index) => line[start + index] === value,
    );
    if (forward || reverse) result += 40;
  }
  return result;
}

function penaltyScore(modules: QrMatrix) {
  const size = modules.length;
  let result = 0;
  let darkModules = 0;

  for (let index = 0; index < size; index += 1) {
    const row = modules[index];
    const column = modules.map((candidateRow) => candidateRow[index]);
    result += linePenalty(row) + linePenalty(column);
    result += finderLikePenalty(row) + finderLikePenalty(column);
    darkModules += row.filter(Boolean).length;
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (
        modules[y][x + 1] === color
        && modules[y + 1][x] === color
        && modules[y + 1][x + 1] === color
      ) {
        result += 3;
      }
    }
  }

  const balancePenalty = Math.floor(
    Math.abs(darkModules * 20 - size * size * 10) / (size * size),
  );
  return result + balancePenalty * 10;
}

function selectBestMask(modules: QrMatrix, functionModules: QrMatrix) {
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(modules, functionModules, mask);
    drawFormatBits(modules, null, mask);
    const penalty = penaltyScore(modules);
    if (penalty < bestPenalty) {
      bestMask = mask;
      bestPenalty = penalty;
    }
    applyMask(modules, functionModules, mask);
  }

  applyMask(modules, functionModules, bestMask);
  drawFormatBits(modules, null, bestMask);
}

/** The dark (true) and light modules of the QR for `text`, byte mode, level M, versions 1-10. */
export function createQrMatrix(text: string): QrMatrix {
  if (!text) throw new RangeError('QR content is required');
  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length);
  const data = buildDataCodewords(bytes, version);
  const codewords = addErrorCorrectionAndInterleave(data, version);
  const size = version * 4 + 17;
  const modules = createEmptyMatrix(size);
  const functionModules = createEmptyMatrix(size);

  drawFunctionPatterns(modules, functionModules, version);
  drawCodewords(modules, functionModules, codewords);
  selectBestMask(modules, functionModules);
  return modules;
}

function validateMatrix(matrix: QrMatrix) {
  if (matrix.length < 21 || matrix.some((row) => row.length !== matrix.length)) {
    throw new RangeError('QR matrix must be square and at least 21 modules wide');
  }
}

/**
 * One SVG path for every dark module, one rectangle per horizontal run, in
 * module units offset by the quiet zone. Draw it in a viewBox of
 * `qrViewBoxSize(matrix, quietZone)` with shapeRendering "crispEdges".
 */
export function qrMatrixPath(matrix: QrMatrix, quietZone = QUIET_ZONE_MODULES) {
  validateMatrix(matrix);
  if (!Number.isInteger(quietZone) || quietZone < 0) {
    throw new RangeError('QR quiet zone must be a non-negative integer');
  }

  const commands: string[] = [];
  for (let y = 0; y < matrix.length; y += 1) {
    let x = 0;
    while (x < matrix.length) {
      if (!matrix[y][x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < matrix.length && matrix[y][x]) x += 1;
      const width = x - start;
      commands.push(`M${start + quietZone} ${y + quietZone}h${width}v1h-${width}z`);
    }
  }
  return commands.join('');
}

/** The side of the square viewBox, in modules, including the quiet zone on both sides. */
export function qrViewBoxSize(matrix: QrMatrix, quietZone = QUIET_ZONE_MODULES) {
  validateMatrix(matrix);
  return matrix.length + quietZone * 2;
}
