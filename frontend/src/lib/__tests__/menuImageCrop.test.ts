import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MENU_BACKGROUND_DEFAULT_STRENGTH,
  MENU_BACKGROUND_PROCESSING_MIME_TYPE,
  MENU_BACKGROUND_REMOVAL_DEFAULT,
  MENU_IMAGE_OUTPUT_MIME_TYPE,
  MENU_IMAGE_OUTPUT_QUALITY,
  calculateCropFrame,
  clampMenuBackgroundStrength,
  menuImageOutputName,
  moveCropPosition,
} from "../menuImageCrop";

describe("menu image crop", () => {
  it("keeps compact WebP by default and uses PNG only for background processing", () => {
    expect(MENU_IMAGE_OUTPUT_MIME_TYPE).toBe("image/webp");
    expect(MENU_IMAGE_OUTPUT_QUALITY).toBe(0.9);
    expect(MENU_BACKGROUND_PROCESSING_MIME_TYPE).toBe("image/png");
    expect(menuImageOutputName("pizza.photo.jpg")).toBe("pizza.photo-cropped.webp");
    expect(menuImageOutputName("pizza.photo.jpg", true)).toBe("pizza.photo-cropped.png");
    expect(menuImageOutputName("", true)).toBe("menu-image-cropped.png");
  });

  it("keeps background removal opt-in and clamps the preview strength contract", () => {
    expect(MENU_BACKGROUND_REMOVAL_DEFAULT).toBe(false);
    expect(MENU_BACKGROUND_DEFAULT_STRENGTH).toBe(50);
    expect(clampMenuBackgroundStrength(-20)).toBe(0);
    expect(clampMenuBackgroundStrength(45.4)).toBe(45);
    expect(clampMenuBackgroundStrength(140)).toBe(100);
  });

  it("renders background removal live in the crop viewport and keeps final upload deterministic", () => {
    const cropperSource = readFileSync(
      new URL("../../components/menu/MenuImageCropper.tsx", import.meta.url),
      "utf8",
    );
    const menuApiSource = readFileSync(new URL("../menu.ts", import.meta.url), "utf8");
    const menuPageSource = readFileSync(
      new URL("../../app/(dashboard)/menu/page.tsx", import.meta.url),
      "utf8",
    );

    expect(cropperSource).toMatch(/onPreview/);
    expect(cropperSource).toMatch(/role="switch"/);
    expect(cropperSource).toMatch(/aria-checked=\{removeBackground\}/);
    expect(cropperSource).toMatch(/backgroundPreview/);
    expect(cropperSource).toMatch(/setBackgroundPreview\(null\)/);
    const invalidationSource = cropperSource.slice(
      cropperSource.indexOf("const invalidateBackgroundPreview ="),
      cropperSource.indexOf("const resetBackgroundRemoval ="),
    );
    expect(invalidationSource).toMatch(/setPreviewingBackground\(false\)/);
    expect(invalidationSource).toMatch(/previewAbortRef\.current\?\.abort\(\)/);
    expect(cropperSource).toMatch(/AbortController/);
    expect(cropperSource).toMatch(/BACKGROUND_PREVIEW_TIMEOUT_MS/);
    expect(cropperSource).toMatch(/BACKGROUND_PREVIEW_DEBOUNCE_MS/);
    expect(cropperSource).toMatch(/if \(!removeBackground \|\| !previewReady \|\| !naturalSize \|\| dragging\) return/);
    expect(cropperSource).toMatch(/previewDebounceRef\.current = setTimeout\(\(\) => \{[\s\S]*?void previewBackground\(requestGeneration\)/);
    expect(cropperSource).toMatch(/\[backgroundStrength, dragging, naturalSize, positionX, positionY, previewReady, removeBackground, sourceName, sourceUrl, zoom\]/);
    expect(cropperSource).toMatch(/preview_data_url/);
    expect(cropperSource).toMatch(/backgroundImage: `url\(\$\{currentBackgroundPreview\.preview_data_url\}\), conic-gradient/);
    expect(cropperSource).toMatch(/aria-busy=\{removeBackground && previewingBackground\}/);
    expect(cropperSource).toMatch(/currentBackgroundPreview!\.file/);
    expect(cropperSource).toMatch(/previewStatus/);
    expect(cropperSource).toMatch(/copy\.cutLess/);
    expect(cropperSource).toMatch(/copy\.cutMore/);
    expect(cropperSource).not.toMatch(/copy\.previewBackground/);
    expect(cropperSource).not.toMatch(/onClick=\{\(\) => \{ void previewBackground\(\); \}\}/);
    expect(menuApiSource).toContain("/api/v1/menu-items/preview-background");
    expect(menuApiSource).toContain('formData.append("background_strength"');
    expect(menuApiSource).toContain('formData.append("remove_background"');
    expect(menuPageSource).toMatch(/background_removed/);
    expect(menuPageSource).toContain("ตัดน้อยลง");
    expect(menuPageSource).toContain("ตัดมากขึ้น");
    expect(menuPageSource).toContain("Cut less");
    expect(menuPageSource).toContain("Cut more");
  });

  it("centers a wide image while covering a landscape crop without gaps", () => {
    const frame = calculateCropFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: 0,
      positionX: 0.5,
      positionY: 0.5,
    });

    expect(frame).toEqual({
      width: 1600,
      height: 900,
      x: -200,
      y: 0,
    });
  });

  it("centers a tall image while covering a landscape crop without gaps", () => {
    const frame = calculateCropFrame({
      naturalWidth: 900,
      naturalHeight: 1600,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: 0,
      positionX: 0.5,
      positionY: 0.5,
    });

    expect(frame.width).toBeCloseTo(1200);
    expect(frame.height).toBeCloseTo(2133.333);
    expect(frame.x).toBeCloseTo(0);
    expect(frame.y).toBeCloseTo(-616.667);
  });

  it("zooms out to half of the contain scale at -100%", () => {
    const frame = calculateCropFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: -100,
      positionX: 0.5,
      positionY: 0.5,
    });

    expect(frame.width).toBe(600);
    expect(frame.height).toBe(337.5);
    expect(frame.x).toBe(300);
    expect(frame.y).toBe(281.25);
  });

  it("zooms in to twice the cover scale at +100%", () => {
    const frame = calculateCropFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: 100,
      positionX: 0.5,
      positionY: 0.5,
    });

    expect(frame.width).toBe(3200);
    expect(frame.height).toBe(1800);
    expect(frame.x).toBe(-1000);
    expect(frame.y).toBe(-450);
  });

  it("keeps the preview framing proportional to the exported card image", () => {
    const preview = calculateCropFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 400,
      cropHeight: 300,
      zoomPercent: -60,
      positionX: 0.2,
      positionY: 0.8,
    });
    const output = calculateCropFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: -60,
      positionX: 0.2,
      positionY: 0.8,
    });

    expect(output.width / preview.width).toBeCloseTo(3);
    expect(output.height / preview.height).toBeCloseTo(3);
    expect(output.x / preview.x).toBeCloseTo(3);
    expect(output.y / preview.y).toBeCloseTo(3);
  });

  it("maps drag distance while the image is larger than the frame", () => {
    expect(moveCropPosition({
      positionX: 0.5,
      positionY: 0.5,
      deltaX: 100,
      deltaY: 0,
      offsetRangeX: -133,
      offsetRangeY: 0,
    })).toEqual({ positionX: 0, positionY: 0.5 });

    expect(moveCropPosition({
      positionX: 0.5,
      positionY: 0.5,
      deltaX: -100,
      deltaY: 0,
      offsetRangeX: -133,
      offsetRangeY: 0,
    })).toEqual({ positionX: 1, positionY: 0.5 });
  });

  it("maps drag distance while the zoomed-out image is smaller than the frame", () => {
    expect(moveCropPosition({
      positionX: 0.5,
      positionY: 0.5,
      deltaX: 100,
      deltaY: -100,
      offsetRangeX: 600,
      offsetRangeY: 562.5,
    })).toEqual({
      positionX: 0.5 + 100 / 600,
      positionY: 0.5 - 100 / 562.5,
    });
  });
});
