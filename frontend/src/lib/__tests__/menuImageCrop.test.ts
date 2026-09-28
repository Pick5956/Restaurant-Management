import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MENU_IMAGE_OUTPUT_MIME_TYPE,
  MENU_IMAGE_OUTPUT_QUALITY,
  calculateCropFrame,
  menuImageOutputName,
  moveCropPosition,
} from "../menuImageCrop";

describe("menu image crop", () => {
  it("always saves compact WebP", () => {
    expect(MENU_IMAGE_OUTPUT_MIME_TYPE).toBe("image/webp");
    expect(MENU_IMAGE_OUTPUT_QUALITY).toBe(0.9);
    expect(menuImageOutputName("pizza.photo.jpg")).toBe("pizza.photo-cropped.webp");
    expect(menuImageOutputName("")).toBe("menu-image-cropped.webp");
  });

  it("has no background removal left on the web (owner, 28 ก.ย. 2569)", () => {
    const cropperSource = readFileSync(
      new URL("../../components/menu/MenuImageCropper.tsx", import.meta.url),
      "utf8",
    );
    const menuApiSource = readFileSync(new URL("../menu.ts", import.meta.url), "utf8");
    const menuPageSource = readFileSync(
      new URL("../../app/(dashboard)/r/[slug]/menu/page.tsx", import.meta.url),
      "utf8",
    );

    for (const source of [cropperSource, menuApiSource, menuPageSource]) {
      expect(source).not.toMatch(/removeBackground|remove_background|background_strength|preview-background|ตัดพื้นหลัง/);
    }
  });

  it("has a zoom slider and no zoom ± buttons", () => {
    const cropperSource = readFileSync(
      new URL("../../components/menu/MenuImageCropper.tsx", import.meta.url),
      "utf8",
    );

    expect(cropperSource).toMatch(/type="range"/);
    expect(cropperSource).not.toMatch(/\bMinus\b|\bPlus\b|copy\.zoomIn|copy\.zoomOut/);
  });

  it("frames the photo in place: change and remove on top, no cancel or use-this-image", () => {
    const cropperSource = readFileSync(
      new URL("../../components/menu/MenuImageCropper.tsx", import.meta.url),
      "utf8",
    );
    const menuPageSource = readFileSync(
      new URL("../../app/(dashboard)/r/[slug]/menu/page.tsx", import.meta.url),
      "utf8",
    );

    expect(cropperSource).toMatch(/copy\.changeImage/);
    expect(cropperSource).toMatch(/copy\.removeImage/);
    expect(cropperSource).not.toMatch(/copy\.apply\b|copy\.cancel\b/);
    expect(cropperSource).toMatch(/exportChanges/);
    // The save crops and uploads the framed photo, then saves the dish.
    expect(menuPageSource).toContain("imageEditorRef.current?.exportChanges()");
    // The basic tab stays mounted, so a photo being framed survives a tab switch.
    expect(menuPageSource).toContain('hidden={itemEditorTab !== "basic"}');
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

  it("stops the photo's edge at the frame's edge, however far it is dragged", () => {
    // Zoomed in: the photo is bigger than the frame and may not uncover it.
    const zoomedIn = { naturalWidth: 700, naturalHeight: 700, cropWidth: 300, cropHeight: 300, zoomPercent: 50 };
    const big = calculateCropFrame({ ...zoomedIn, positionX: 0.5, positionY: 0.5 });
    const farRight = moveCropPosition({
      positionX: 0.5, positionY: 0.5, deltaX: 5000, deltaY: -5000,
      offsetRangeX: 300 - big.width, offsetRangeY: 300 - big.height,
    });
    const pushed = calculateCropFrame({ ...zoomedIn, positionX: farRight.positionX, positionY: farRight.positionY });
    expect(pushed.x).toBeCloseTo(0);
    expect(pushed.y).toBeCloseTo(300 - big.height);

    // Zoomed out: the photo is smaller than the frame and may not leave it.
    const zoomedOut = { ...zoomedIn, zoomPercent: -60 };
    const small = calculateCropFrame({ ...zoomedOut, positionX: 0.5, positionY: 0.5 });
    const farLeft = moveCropPosition({
      positionX: 0.5, positionY: 0.5, deltaX: -5000, deltaY: 5000,
      offsetRangeX: 300 - small.width, offsetRangeY: 300 - small.height,
    });
    const tucked = calculateCropFrame({ ...zoomedOut, positionX: farLeft.positionX, positionY: farLeft.positionY });
    expect(tucked.x).toBeCloseTo(0);
    expect(tucked.x + tucked.width).toBeLessThanOrEqual(300);
    expect(tucked.y + tucked.height).toBeCloseTo(300);
  });

  it("does not move a photo that is exactly the frame's size", () => {
    const frame = calculateCropFrame({
      naturalWidth: 700, naturalHeight: 700, cropWidth: 300, cropHeight: 300,
      zoomPercent: 0, positionX: 0.9, positionY: 0.1,
    });
    expect(frame.x).toBeCloseTo(0);
    expect(frame.y).toBeCloseTo(0);
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
