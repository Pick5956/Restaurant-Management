import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createQrMatrix,
  qrMatrixPath,
  qrViewBoxSize,
} from "../qr";

const CUSTOMER_URL = "https://dishy.pro/customer/t/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("local customer QR generation", () => {
  it("builds a square QR matrix with the required finder patterns", () => {
    const matrix = createQrMatrix(CUSTOMER_URL);

    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect((matrix.length - 17) % 4).toBe(0);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);

    const finderCenters = [
      [3, 3],
      [matrix.length - 4, 3],
      [3, matrix.length - 4],
    ];
    for (const [x, y] of finderCenters) {
      expect(matrix[y][x]).toBe(true);
      expect(matrix[y - 2][x]).toBe(false);
      expect(matrix[y - 3][x]).toBe(true);
    }
  });

  it("creates deterministic inline SVG geometry without exposing the raw URL", () => {
    const matrix = createQrMatrix(CUSTOMER_URL);
    const path = qrMatrixPath(matrix);

    expect(path).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    expect(path).not.toContain(CUSTOMER_URL);
    expect(qrViewBoxSize(matrix)).toBe(matrix.length + 8);
    expect(createQrMatrix(CUSTOMER_URL)).toEqual(matrix);
    expect(createQrMatrix(`${CUSTOMER_URL}a`)).not.toEqual(matrix);
  });

  it("selects valid matrix sizes across every supported QR version", () => {
    const cases = [
      { bytes: 1, size: 21 },
      { bytes: 15, size: 25 },
      { bytes: 27, size: 29 },
      { bytes: 43, size: 33 },
      { bytes: 63, size: 37 },
      { bytes: 85, size: 41 },
      { bytes: 107, size: 45 },
      { bytes: 123, size: 49 },
      { bytes: 153, size: 53 },
      { bytes: 181, size: 57 },
    ];

    for (const { bytes, size } of cases) {
      expect(createQrMatrix("x".repeat(bytes))).toHaveLength(size);
    }
  });

  it("fails closed when content exceeds the supported local QR capacity", () => {
    expect(() => createQrMatrix(`https://dishy.pro/customer/t/${"x".repeat(400)}`))
      .toThrow(/too long/i);
  });

  it("never delegates customer QR rendering or download to a third party", () => {
    const pagePath = fileURLToPath(
      new URL("../../app/(dashboard)/r/[slug]/tables/page.tsx", import.meta.url),
    );
    const pageSource = readFileSync(pagePath, "utf8");

    expect(pageSource).not.toContain("api.qrserver.com");
    expect(pageSource).not.toContain("create-qr-code");
    expect(pageSource).not.toMatch(/fetch\s*\(\s*customerOrderQr/);
    expect(pageSource).toContain("createQrMatrix(customerOrderLink)");
    expect(pageSource).toContain("qrMatrixToPngBlob(customerOrderQr.matrix)");
  });
});
