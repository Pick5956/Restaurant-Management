"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { ImagePlus, RotateCw, Trash2 } from "lucide-react";
import {
  MENU_IMAGE_OUTPUT_MIME_TYPE,
  MENU_IMAGE_OUTPUT_QUALITY,
  calculateCropFrame,
  menuImageOutputName,
  moveCropPosition,
} from "@/src/lib/menuImageCrop";

const OUTPUT_WIDTH = 1200;
// Square since 2026-09-11. The menu-image contract is shared with Expo -
// mobile/src/lib/menu-image.ts holds the same pair - so this ratio moves on
// both platforms or on neither.
const OUTPUT_HEIGHT = 1200;
const MIN_ZOOM = -100;
const MAX_ZOOM = 100;
const ZOOM_STEP = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface CropperCopy {
  chooseImage: string;
  changeImage: string;
  removeImage: string;
  rotateImage: string;
  cropAria: string;
  zoom: string;
  loading: string;
  invalidFile: string;
  loadError: string;
}

interface MenuImageCropperProps {
  currentImageUrl: string;
  /** The photo currentImageUrl was cut from; empty when only the square exists. */
  originalImageUrl?: string;
  /** Where currentImageUrl sat in originalImageUrl's frame. */
  savedPlacement?: Placement;
  disabled?: boolean;
  copy: CropperCopy;
  /** "ลบรูป": the form drops the dish's image. */
  onRemove: () => void;
  onError: (message: string) => void;
}

/**
 * What the menu form asks for when it saves. There is no "use this image"
 * button any more (owner, 28 ก.ย. 2569): the photo is framed in place, and the
 * save crops and uploads it. `null` means nothing changed - no new photo and
 * no move or zoom - so the saved image is kept as it is, not re-encoded.
 *
 * `original` is the whole photo when it is new here (picked or rotated) and
 * must be uploaded too; `null` means the photo being framed is the one the
 * dish already keeps as its original. `placement` is saved with the dish, so
 * the next adjust reopens the whole photo exactly as it was framed.
 */
export interface MenuImageChanges {
  file: File;
  original: File | null;
  placement: Placement;
}

export interface MenuImageCropperHandle {
  exportChanges: () => Promise<MenuImageChanges | null>;
}

interface Size {
  width: number;
  height: number;
}

interface DragStart {
  pointerX: number;
  pointerY: number;
  positionX: number;
  positionY: number;
}

export interface Placement {
  zoom: number;
  positionX: number;
  positionY: number;
}

const CENTRED: Placement = { zoom: 0, positionX: 0.5, positionY: 0.5 };
const formatZoom = (zoom: number) => `${zoom > 0 ? "+" : ""}${zoom}%`;
const samePlacement = (a: Placement, b: Placement) =>
  a.zoom === b.zoom && a.positionX === b.positionX && a.positionY === b.positionY;

/** The track fills from 0% (its middle) out to the thumb, either way. */
function zoomTrackStyle(zoom: number): CSSProperties {
  const at = ((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100;
  const from = Math.min(at, 50);
  const to = Math.max(at, 50);
  return {
    background: `linear-gradient(to right, var(--zoom-track) 0 ${from}%, var(--zoom-fill) ${from}% ${to}%, var(--zoom-track) ${to}% 100%)`,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Could not encode cropped menu image."));
    }, mimeType, quality);
  });
}

async function createCroppedMenuFile(image: HTMLImageElement, naturalSize: Size, sourceName: string, placement: Placement) {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");

  const frame = calculateCropFrame({
    naturalWidth: naturalSize.width,
    naturalHeight: naturalSize.height,
    cropWidth: OUTPUT_WIDTH,
    cropHeight: OUTPUT_HEIGHT,
    zoomPercent: placement.zoom,
    positionX: placement.positionX,
    positionY: placement.positionY,
  });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);

  const blob = await canvasToBlob(canvas, MENU_IMAGE_OUTPUT_MIME_TYPE, MENU_IMAGE_OUTPUT_QUALITY);
  return new File([blob], menuImageOutputName(sourceName), {
    type: MENU_IMAGE_OUTPUT_MIME_TYPE,
    lastModified: Date.now(),
  });
}

// Icon-only tools with no box behind them (owner, 28 ก.ย. 2569): each names
// itself through aria-label and a tooltip, not a word on the button. There is
// no "reset position" any more - beside the rotate arrow it read as a second
// rotate.
const TOOL_BUTTON =
  "ui-press grid h-10 w-10 place-items-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white";
const REMOVE_BUTTON = `${TOOL_BUTTON} hover:!bg-red-50 hover:!text-red-700 dark:hover:!bg-red-950/30 dark:hover:!text-red-300`;

const MenuImageCropper = forwardRef<MenuImageCropperHandle, MenuImageCropperProps>(function MenuImageCropper(
  { currentImageUrl, originalImageUrl = "", savedPlacement = CENTRED, disabled = false, copy, onRemove, onError },
  ref,
) {
  // A photo picked here and not saved yet; until then the saved one is shown.
  const [picked, setPicked] = useState<{ url: string; name: string; file: File } | null>(null);
  // The framing the editor opens at: the saved one when the whole photo is
  // kept, centred when only the square exists (it was saved centred on itself).
  const startPlacement = originalImageUrl ? savedPlacement : CENTRED;
  const [placement, setPlacement] = useState<Placement>(startPlacement);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  // The photo that finished loading, and its size. Keyed by URL, so a size is
  // only ever used for the photo it was measured on.
  const [loaded, setLoaded] = useState<{ url: string; size: Size } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rotating, setRotating] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<DragStart | null>(null);
  // What the frame shows: a photo picked here, else the whole original the
  // dish keeps, else (dishes saved before originals were kept) its square.
  const sourceUrl = picked?.url ?? (currentImageUrl ? originalImageUrl || currentImageUrl : "");
  const hasImage = Boolean(sourceUrl);
  const naturalSize = loaded?.url === sourceUrl ? loaded.size : null;

  // Another dish opened in the same form: start from its saved image and
  // framing. Adjusted while rendering, as React recommends for state that
  // follows a prop.
  const [shownImageUrl, setShownImageUrl] = useState(currentImageUrl);
  if (shownImageUrl !== currentImageUrl) {
    setShownImageUrl(currentImageUrl);
    setPicked(null);
    setPlacement(startPlacement);
  }

  // A picked photo's blob URL is released once it is replaced, dropped or the
  // form closes - the cleanup of the effect that belongs to that photo.
  useEffect(() => {
    if (!picked) return;
    return () => URL.revokeObjectURL(picked.url);
  }, [picked]);

  useEffect(() => {
    if (!hasImage || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const updateSize = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasImage]);

  useEffect(() => {
    if (!sourceUrl) return;

    let active = true;
    const image = new Image();
    // Needed for the canvas export; the uploads route answers with CORS and
    // `Vary: Origin` (backend CORSMiddleware).
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active) return;
      imageRef.current = image;
      setLoaded({ url: sourceUrl, size: { width: image.naturalWidth, height: image.naturalHeight } });
    };
    image.onerror = () => {
      if (!active) return;
      onError(copy.loadError);
    };
    image.src = sourceUrl;
    return () => {
      active = false;
    };
  }, [copy.loadError, onError, sourceUrl]);

  const previewFrame = useMemo(() => {
    if (!naturalSize || !viewportSize.width || !viewportSize.height) return null;
    return calculateCropFrame({
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      cropWidth: viewportSize.width,
      cropHeight: viewportSize.height,
      zoomPercent: placement.zoom,
      positionX: placement.positionX,
      positionY: placement.positionY,
    });
  }, [naturalSize, placement, viewportSize]);

  useImperativeHandle(ref, () => ({
    exportChanges: async () => {
      if (!picked && samePlacement(placement, startPlacement)) return null;
      if (!imageRef.current || !naturalSize) throw new Error("Menu image is not loaded.");
      const file = await createCroppedMenuFile(imageRef.current, naturalSize, picked?.name ?? "menu-image", placement);
      return { file, original: picked?.file ?? null, placement };
    },
  }), [naturalSize, picked, placement, startPlacement]);

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_FILE_SIZE) {
      onError(copy.invalidFile);
      return;
    }
    onError("");
    setPicked({ url: URL.createObjectURL(file), name: file.name || "menu-image", file });
    setPlacement(CENTRED);
  };

  const rotateImage = async () => {
    const image = imageRef.current;
    if (!image || !naturalSize || rotating) return;
    setRotating(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = naturalSize.height;
      canvas.height = naturalSize.width;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
      context.drawImage(image, 0, 0);
      const blob = await canvasToBlob(canvas, MENU_IMAGE_OUTPUT_MIME_TYPE, 0.95);
      const name = picked?.name ?? "menu-image";
      const file = new File([blob], menuImageOutputName(name).replace("-cropped", "-rotated"), { type: MENU_IMAGE_OUTPUT_MIME_TYPE, lastModified: Date.now() });
      setPicked({ url: URL.createObjectURL(blob), name, file });
      // The spot being framed turns with the photo: a quarter turn clockwise
      // takes (x, y) to (1 - y, x).
      setPlacement((current) => ({ ...current, positionX: 1 - current.positionY, positionY: current.positionX }));
    } catch {
      onError(copy.loadError);
    } finally {
      setRotating(false);
    }
  };

  const removeImage = () => {
    setPicked(null);
    setPlacement(CENTRED);
    onError("");
    onRemove();
  };

  const move = (deltaX: number, deltaY: number, from: Placement) => {
    if (!previewFrame) return;
    const next = moveCropPosition({
      positionX: from.positionX,
      positionY: from.positionY,
      deltaX,
      deltaY,
      offsetRangeX: viewportSize.width - previewFrame.width,
      offsetRangeY: viewportSize.height - previewFrame.height,
    });
    setPlacement((current) => ({ ...current, positionX: next.positionX, positionY: next.positionY }));
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!previewFrame || disabled) return;
    // Without this a drag released outside the frame selected the page's text.
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { pointerX: event.clientX, pointerY: event.clientY, positionX: placement.positionX, positionY: placement.positionY };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    move(event.clientX - start.pointerX, event.clientY - start.pointerY, { ...placement, positionX: start.positionX, positionY: start.positionY });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
    setDragging(false);
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 24 : 8;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d) return;
    event.preventDefault();
    move(d[0], d[1], placement);
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp"
      aria-label={copy.chooseImage}
      disabled={disabled}
      onChange={(event) => {
        selectFile(event.target.files?.[0]);
        event.currentTarget.value = "";
      }}
      className="sr-only"
    />
  );

  // Two columns from `sm` (owner, 28 ก.ย. 2569): the frame on the left, lined
  // up under the section heading, and beside it the tools on top and the zoom
  // at the foot - the room the centred column left empty, without making the
  // photo any bigger. A phone stacks them.
  const FRAME = "aspect-square w-full max-w-64 shrink-0 sm:w-64";

  if (!hasImage) {
    return (
      <div>
        {fileInput}
        <button
          type="button"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          className={`ui-press group grid ${FRAME} place-items-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-orange-400 hover:bg-orange-50/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-orange-500`}
        >
          <span className="flex flex-col items-center gap-2 text-[14px] font-semibold text-gray-700 dark:text-gray-200">
            <ImagePlus className="h-7 w-7 text-gray-400 transition-colors group-hover:text-orange-700 dark:text-gray-500" aria-hidden="true" />
            {copy.chooseImage}
          </span>
        </button>
      </div>
    );
  }

  const cropCanvasStyle: CSSProperties | undefined = previewFrame
    ? {
        backgroundImage: `url(${sourceUrl})`,
        backgroundPosition: `${previewFrame.x}px ${previewFrame.y}px`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${previewFrame.width}px ${previewFrame.height}px`,
      }
    : undefined;

  const tools = (
    <div className="flex items-center gap-2">
      <button type="button" disabled={disabled || rotating} onClick={() => fileInputRef.current?.click()} aria-label={copy.changeImage} title={copy.changeImage} className={TOOL_BUTTON}>
        <ImagePlus className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <button type="button" disabled={disabled || rotating || !previewFrame} onClick={() => { void rotateImage(); }} aria-label={copy.rotateImage} title={copy.rotateImage} className={TOOL_BUTTON}>
        <RotateCw className={`h-[18px] w-[18px] ${rotating ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
      </button>
      <button type="button" disabled={disabled || rotating} onClick={removeImage} aria-label={copy.removeImage} title={copy.removeImage} className={`ml-auto ${REMOVE_BUTTON}`}>
        <Trash2 className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-5">
      {fileInput}
      {/* One clean edge: a single hairline on a rounded square. The old frame
          drew a second white inner border with an inset shadow over it. */}
      <div
        ref={viewportRef}
        role="group"
        tabIndex={0}
        aria-label={copy.cropAria}
        onKeyDown={moveWithKeyboard}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative ${FRAME} touch-none select-none overflow-hidden rounded-xl border border-gray-200 bg-gray-50 outline-none transition-[border-color,box-shadow] focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500/20 dark:border-gray-700 dark:bg-gray-800 ${
          dragging ? "cursor-grabbing" : previewFrame ? "cursor-grab" : ""
        }`}
        style={cropCanvasStyle}
      >
        {!previewFrame ? (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-gray-500 dark:text-gray-400">
            {copy.loading}
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-6 sm:max-w-72 sm:py-0.5">
      {tools}
      {/* One slider, no ± buttons. The fill runs from 0% in the middle out to
          the thumb, so in and out read at a glance. */}
      <label className="block">
        <span className="mb-2 flex items-center justify-between text-[13px] font-medium text-gray-700 dark:text-gray-200">
          <span>{copy.zoom}</span>
          <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-[12px] tabular-nums text-gray-900 dark:bg-gray-800 dark:text-white">{formatZoom(placement.zoom)}</span>
        </span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={ZOOM_STEP}
          value={placement.zoom}
          aria-valuetext={formatZoom(placement.zoom)}
          disabled={disabled || !previewFrame}
          onChange={(event) => {
            const zoom = Number(event.target.value);
            setPlacement((current) => ({ ...current, zoom }));
          }}
          style={zoomTrackStyle(placement.zoom)}
          className={[
            "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-50",
            "[--zoom-fill:#c2410c] [--zoom-track:#e5e7eb] dark:[--zoom-fill:#fb923c] dark:[--zoom-track:#374151]",
            "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-orange-700 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110",
            "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-orange-700 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md",
            "dark:[&::-webkit-slider-thumb]:border-orange-400 dark:[&::-moz-range-thumb]:border-orange-400",
            "focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-orange-500/25",
          ].join(" ")}
        />
      </label>
      </div>
    </div>
  );
});

export default MenuImageCropper;
