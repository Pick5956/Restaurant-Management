export interface CropFrameInput {
  naturalWidth: number;
  naturalHeight: number;
  cropWidth: number;
  cropHeight: number;
  zoomPercent: number;
  positionX: number;
  positionY: number;
}

export interface CropFrame {
  width: number;
  height: number;
  x: number;
  y: number;
}

export interface CropPositionInput {
  positionX: number;
  positionY: number;
  deltaX: number;
  deltaY: number;
  offsetRangeX: number;
  offsetRangeY: number;
}

export const MENU_IMAGE_OUTPUT_MIME_TYPE = "image/webp";
export const MENU_IMAGE_OUTPUT_QUALITY = 0.9;

// Background removal was taken out of the menu editor on 28 ก.ย. 2569 (owner),
// on web and in the app. The backend endpoints still accept the old options;
// the clients simply no longer send them, which the server reads as "keep".
export function menuImageOutputName(sourceName?: string | null) {
  const baseName = String(sourceName || "")
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .trim();
  return `${baseName || "menu-image"}-cropped.webp`;
}

// The photo's edge stops at the frame's edge, at every zoom (owner, 28 ก.ย.
// 2569): bigger than the frame it slides until its edge meets the frame's,
// smaller it slides until it meets the frame's edge from inside. A photo that
// is exactly the frame's size has nowhere to go, and so does not move. A brief
// "travel floor" that let square photos slide past their edge was tried the
// same day and removed.
const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const clampZoomPercent = (value: number) => Math.min(100, Math.max(-100, value));

export function calculateCropFrame(input: CropFrameInput): CropFrame {
  const {
    naturalWidth,
    naturalHeight,
    cropWidth,
    cropHeight,
    positionX,
    positionY,
  } = input;

  if (naturalWidth <= 0 || naturalHeight <= 0 || cropWidth <= 0 || cropHeight <= 0) {
    throw new Error("Image and crop dimensions must be positive.");
  }

  const zoomPercent = Number.isFinite(input.zoomPercent)
    ? clampZoomPercent(input.zoomPercent)
    : 0;
  const coverScale = Math.max(cropWidth / naturalWidth, cropHeight / naturalHeight);
  const containScale = Math.min(cropWidth / naturalWidth, cropHeight / naturalHeight);
  const minimumScale = containScale * 0.5;
  const scale = zoomPercent < 0
    ? coverScale + (coverScale - minimumScale) * (zoomPercent / 100)
    : coverScale * (1 + zoomPercent / 100);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    width,
    height,
    x: (cropWidth - width) * clampUnit(positionX),
    y: (cropHeight - height) * clampUnit(positionY),
  };
}

export function moveCropPosition(input: CropPositionInput) {
  return {
    positionX: Math.abs(input.offsetRangeX) > Number.EPSILON
      ? clampUnit(input.positionX + input.deltaX / input.offsetRangeX)
      : 0.5,
    positionY: Math.abs(input.offsetRangeY) > Number.EPSILON
      ? clampUnit(input.positionY + input.deltaY / input.offsetRangeY)
      : 0.5,
  };
}
