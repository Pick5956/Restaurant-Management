"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ImagePlus, Minus, Move, Plus } from "lucide-react";
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
  type MenuBackgroundPreviewResult,
  type MenuImageUploadOptions,
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
const BACKGROUND_PREVIEW_DEBOUNCE_MS = 400;
const BACKGROUND_PREVIEW_TIMEOUT_MS = 30_000;

interface CropperCopy {
  chooseImage: string;
  adjustImage: string;
  cropTitle: string;
  cropHint: string;
  cropAria: string;
  zoom: string;
  zoomOut: string;
  zoomIn: string;
  reset: string;
  cancel: string;
  apply: string;
  applying: string;
  invalidFile: string;
  loadError: string;
  cropError: string;
  removeBackground: string;
  removeBackgroundHelp: string;
  backgroundStrength: string;
  cutLess: string;
  cutMore: string;
  previewingBackground: string;
  backgroundPreviewRequired: string;
  backgroundPreviewUnavailable: string;
  backgroundPreviewError: string;
  backgroundPreviewReady: string;
  backgroundPreviewAria: string;
}

interface MenuImageCropperProps {
  currentImageUrl: string;
  disabled?: boolean;
  copy: CropperCopy;
  onPreview: (
    file: File,
    backgroundStrength: number,
    signal?: AbortSignal,
  ) => Promise<MenuBackgroundPreviewResult>;
  onUpload: (file: File, options: MenuImageUploadOptions) => Promise<boolean>;
  onError: (message: string) => void;
  onEditingChange?: (editing: boolean) => void;
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

interface CurrentBackgroundPreview extends MenuBackgroundPreviewResult {
  generation: number;
  file: File;
}

type BackgroundPreviewStatus = "idle" | "updating" | "ready" | "unavailable" | "error";

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
const formatZoom = (zoom: number) => `${zoom > 0 ? "+" : ""}${zoom}%`;

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

async function createCroppedMenuFile({
  image,
  naturalSize,
  sourceName,
  zoom,
  positionX,
  positionY,
  forBackgroundRemoval,
}: {
  image: HTMLImageElement;
  naturalSize: Size;
  sourceName: string;
  zoom: number;
  positionX: number;
  positionY: number;
  forBackgroundRemoval: boolean;
}) {
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
    zoomPercent: zoom,
    positionX,
    positionY,
  });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, frame.x, frame.y, frame.width, frame.height);

  const mimeType = forBackgroundRemoval
    ? MENU_BACKGROUND_PROCESSING_MIME_TYPE
    : MENU_IMAGE_OUTPUT_MIME_TYPE;
  const blob = await canvasToBlob(
    canvas,
    mimeType,
    forBackgroundRemoval ? undefined : MENU_IMAGE_OUTPUT_QUALITY,
  );
  return new File([blob], menuImageOutputName(sourceName, forBackgroundRemoval), {
    type: mimeType,
    lastModified: Date.now(),
  });
}

export default function MenuImageCropper({
  currentImageUrl,
  disabled = false,
  copy,
  onPreview,
  onUpload,
  onError,
  onEditingChange,
}: MenuImageCropperProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceName, setSourceName] = useState("menu-image");
  const [zoom, setZoom] = useState(0);
  const [positionX, setPositionX] = useState(0.5);
  const [positionY, setPositionY] = useState(0.5);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [applying, setApplying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(MENU_BACKGROUND_REMOVAL_DEFAULT);
  const [backgroundStrength, setBackgroundStrength] = useState(MENU_BACKGROUND_DEFAULT_STRENGTH);
  const [backgroundPreview, setBackgroundPreview] = useState<CurrentBackgroundPreview | null>(null);
  const [previewingBackground, setPreviewingBackground] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<BackgroundPreviewStatus>("idle");
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef("");
  const dragStartRef = useRef<DragStart | null>(null);
  const previewGenerationRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPreviewRef = useRef(onPreview);
  const editing = Boolean(sourceUrl);
  const currentBackgroundPreview = backgroundPreview?.generation === previewGenerationRef.current
    ? backgroundPreview
    : null;

  const invalidateBackgroundPreview = () => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    if (previewRequestTimeoutRef.current) {
      clearTimeout(previewRequestTimeoutRef.current);
      previewRequestTimeoutRef.current = null;
    }
    previewGenerationRef.current += 1;
    setBackgroundPreview(null);
    setPreviewingBackground(false);
    setPreviewStatus("idle");
  };

  const resetBackgroundRemoval = () => {
    invalidateBackgroundPreview();
    setRemoveBackground(MENU_BACKGROUND_REMOVAL_DEFAULT);
    setBackgroundStrength(MENU_BACKGROUND_DEFAULT_STRENGTH);
    setPreviewingBackground(false);
    setPreviewStatus("idle");
  };

  onPreviewRef.current = onPreview;

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => () => {
    previewAbortRef.current?.abort();
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    if (previewRequestTimeoutRef.current) clearTimeout(previewRequestTimeoutRef.current);
    previewGenerationRef.current += 1;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    onEditingChange?.(false);
  }, [onEditingChange]);

  useEffect(() => {
    if (!editing || !viewportRef.current) return;
    const viewport = viewportRef.current;
    const updateSize = () => {
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [editing]);

  useEffect(() => {
    if (!sourceUrl) {
      imageRef.current = null;
      return;
    }

    let active = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!active) return;
      imageRef.current = image;
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      if (!active) return;
      imageRef.current = null;
      setNaturalSize(null);
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
      zoomPercent: zoom,
      positionX,
      positionY,
    });
  }, [naturalSize, positionX, positionY, viewportSize, zoom]);

  const resetPlacement = () => {
    if (zoom !== 0 || positionX !== 0.5 || positionY !== 0.5) {
      invalidateBackgroundPreview();
    }
    setZoom(0);
    setPositionX(0.5);
    setPositionY(0.5);
  };

  const clearEditor = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
    setSourceUrl("");
    setSourceName("menu-image");
    setNaturalSize(null);
    setApplying(false);
    setDragging(false);
    dragStartRef.current = null;
    resetBackgroundRemoval();
    resetPlacement();
  };

  const openCurrentImage = () => {
    if (!currentImageUrl) return;
    onError("");
    resetBackgroundRemoval();
    setSourceName("menu-image");
    setNaturalSize(null);
    resetPlacement();
    setSourceUrl(currentImageUrl);
  };

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_FILE_SIZE) {
      onError(copy.invalidFile);
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    onError("");
    resetBackgroundRemoval();
    setSourceName(file.name || "menu-image");
    setNaturalSize(null);
    resetPlacement();
    setSourceUrl(objectUrlRef.current);
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!previewFrame || disabled || applying) return;
    invalidateBackgroundPreview();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      positionX,
      positionY,
    };
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || !previewFrame) return;
    const next = moveCropPosition({
      positionX: start.positionX,
      positionY: start.positionY,
      deltaX: event.clientX - start.pointerX,
      deltaY: event.clientY - start.pointerY,
      offsetRangeX: viewportSize.width - previewFrame.width,
      offsetRangeY: viewportSize.height - previewFrame.height,
    });
    invalidateBackgroundPreview();
    setPositionX(next.positionX);
    setPositionY(next.positionY);
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;
    setDragging(false);
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!previewFrame) return;
    const step = event.shiftKey ? 24 : 8;
    let deltaX = 0;
    let deltaY = 0;
    if (event.key === "ArrowLeft") {
      deltaX = -step;
    } else if (event.key === "ArrowRight") {
      deltaX = step;
    } else if (event.key === "ArrowUp") {
      deltaY = -step;
    } else if (event.key === "ArrowDown") {
      deltaY = step;
    } else {
      return;
    }
    event.preventDefault();
    const next = moveCropPosition({
      positionX,
      positionY,
      deltaX,
      deltaY,
      offsetRangeX: viewportSize.width - previewFrame.width,
      offsetRangeY: viewportSize.height - previewFrame.height,
    });
    invalidateBackgroundPreview();
    setPositionX(next.positionX);
    setPositionY(next.positionY);
  };

  const previewReady = Boolean(previewFrame);

  useEffect(() => {
    if (!removeBackground || !previewReady || !naturalSize || dragging) return;
    const image = imageRef.current;
    if (!image) return;

    const requestGeneration = previewGenerationRef.current;

    const previewBackground = async (generation: number) => {
      if (previewGenerationRef.current !== generation) return;

      const abortController = new AbortController();
      previewAbortRef.current = abortController;
      previewRequestTimeoutRef.current = setTimeout(
        () => abortController.abort(),
        BACKGROUND_PREVIEW_TIMEOUT_MS,
      );
      setPreviewingBackground(true);
      setPreviewStatus("updating");

      try {
        const croppedFile = await createCroppedMenuFile({
          image,
          naturalSize,
          sourceName,
          zoom,
          positionX,
          positionY,
          forBackgroundRemoval: true,
        });
        if (previewGenerationRef.current !== generation) return;

        const result = await onPreviewRef.current(
          croppedFile,
          backgroundStrength,
          abortController.signal,
        );
        if (previewGenerationRef.current !== generation) return;
        if (result.can_remove && !result.preview_data_url.trim()) {
          throw new Error("Background preview returned no image.");
        }
        if (clampMenuBackgroundStrength(result.strength) !== backgroundStrength) {
          throw new Error("Background preview returned a different strength.");
        }

        setBackgroundPreview({ ...result, generation, file: croppedFile });
        setPreviewStatus(result.can_remove ? "ready" : "unavailable");
      } catch {
        if (previewGenerationRef.current === generation) {
          setBackgroundPreview(null);
          setPreviewStatus("error");
        }
      } finally {
        if (previewGenerationRef.current === generation) {
          if (previewAbortRef.current === abortController) previewAbortRef.current = null;
          if (previewRequestTimeoutRef.current) {
            clearTimeout(previewRequestTimeoutRef.current);
            previewRequestTimeoutRef.current = null;
          }
          setPreviewingBackground(false);
        }
      }
    };

    previewDebounceRef.current = setTimeout(() => {
      previewDebounceRef.current = null;
      void previewBackground(requestGeneration);
    }, BACKGROUND_PREVIEW_DEBOUNCE_MS);

    return () => {
      if (previewDebounceRef.current) {
        clearTimeout(previewDebounceRef.current);
        previewDebounceRef.current = null;
      }
    };
  }, [backgroundStrength, dragging, naturalSize, positionX, positionY, previewReady, removeBackground, sourceName, sourceUrl, zoom]);

  const applyCrop = async () => {
    if (!imageRef.current || !naturalSize) {
      onError(copy.loadError);
      return;
    }
    if (removeBackground && !currentBackgroundPreview?.can_remove) {
      onError(copy.backgroundPreviewRequired);
      return;
    }

    setApplying(true);
    onError("");
    try {
      const croppedFile = removeBackground
        ? currentBackgroundPreview!.file
        : await createCroppedMenuFile({
            image: imageRef.current,
            naturalSize,
            sourceName,
            zoom,
            positionX,
            positionY,
            forBackgroundRemoval: false,
          });
      if (await onUpload(croppedFile, {
        removeBackground,
        backgroundStrength,
      })) {
        clearEditor();
      }
    } catch {
      onError(copy.cropError);
    } finally {
      setApplying(false);
    }
  };

  const cropCanvasStyle = removeBackground
    && currentBackgroundPreview?.can_remove
    && currentBackgroundPreview.preview_data_url
    ? {
        backgroundColor: "#eef0f2",
        backgroundImage: `url(${currentBackgroundPreview.preview_data_url}), conic-gradient(#f8fafc 25%, #e5e7eb 0 50%, #f8fafc 0 75%, #e5e7eb 0)`,
        backgroundPosition: "center, 0 0",
        backgroundRepeat: "no-repeat, repeat",
        backgroundSize: "contain, 16px 16px",
      }
    : previewFrame
      ? {
          backgroundImage: `url(${sourceUrl})`,
          backgroundPosition: `${previewFrame.x}px ${previewFrame.y}px`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${previewFrame.width}px ${previewFrame.height}px`,
        }
      : undefined;

  if (editing) {
    return (
      <div className="space-y-3">
        <div>
          <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">{copy.cropTitle}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{copy.cropHint}</p>
        </div>

        <div
          ref={viewportRef}
          role="group"
          tabIndex={0}
          aria-busy={removeBackground && previewingBackground}
          aria-label={currentBackgroundPreview?.can_remove ? copy.backgroundPreviewAria : copy.cropAria}
          onKeyDown={moveWithKeyboard}
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`relative aspect-square w-full touch-none overflow-hidden rounded-md border border-gray-300 bg-slate-50 outline-none dark:border-gray-700 dark:bg-gray-950 ${
            dragging ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={cropCanvasStyle}
        >
          {!previewFrame ? (
            <div className="absolute inset-0 grid place-items-center text-[12px] text-gray-500 dark:text-gray-400">
              {copy.applying}
            </div>
          ) : null}
          <div className="pointer-events-none absolute inset-0 border border-white/65 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.16)]" />
          <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md bg-gray-950/75 px-2 py-1 text-[10px] font-medium text-white">
            <Move className="h-3.5 w-3.5" aria-hidden="true" />
            3:3
          </span>
          {removeBackground && previewStatus === "updating" ? (
            <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 rounded-md bg-gray-950/75 px-2 py-1 text-[10px] font-medium text-white">
              {copy.previewingBackground}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2">
          <button
            type="button"
            disabled={disabled || applying || zoom <= MIN_ZOOM}
            onClick={() => {
              invalidateBackgroundPreview();
              setZoom((value) => clampZoom(value - ZOOM_STEP));
            }}
            aria-label={copy.zoomOut}
            title={copy.zoomOut}
            className="ui-press grid h-10 w-10 place-items-center rounded-md border border-gray-200 bg-white text-gray-700 hover:border-gray-400 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <label className="min-w-0">
            <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-600 dark:text-gray-300">
              <span>{copy.zoom}</span>
              <span className="font-mono tabular-nums">{formatZoom(zoom)}</span>
            </span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={ZOOM_STEP}
              value={zoom}
              aria-valuetext={formatZoom(zoom)}
              disabled={disabled || applying}
              onChange={(event) => {
                invalidateBackgroundPreview();
                setZoom(Number(event.target.value));
              }}
              className="h-2 w-full accent-orange-600 disabled:opacity-50"
            />
            <span className="mt-1 grid grid-cols-3 font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-500">
              <span>-100%</span>
              <span className="text-center">0%</span>
              <span className="text-right">+100%</span>
            </span>
          </label>
          <button
            type="button"
            disabled={disabled || applying || zoom >= MAX_ZOOM}
            onClick={() => {
              invalidateBackgroundPreview();
              setZoom((value) => clampZoom(value + ZOOM_STEP));
            }}
            aria-label={copy.zoomIn}
            title={copy.zoomIn}
            className="ui-press grid h-10 w-10 place-items-center rounded-md border border-gray-200 bg-white text-gray-700 hover:border-gray-400 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">{copy.removeBackground}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-gray-500 dark:text-gray-400">{copy.removeBackgroundHelp}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={removeBackground}
              aria-label={copy.removeBackground}
              disabled={disabled || applying}
              onClick={() => {
                invalidateBackgroundPreview();
                setRemoveBackground((value) => !value);
                onError("");
              }}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none disabled:opacity-45 ${
                removeBackground ? "bg-orange-600" : "bg-gray-300 dark:bg-gray-700"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                  removeBackground ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {removeBackground ? (
            <div className="space-y-2 pt-1">
              <label className="block">
                <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-300">
                  <span>{copy.backgroundStrength}</span>
                  <span className="font-mono tabular-nums">{backgroundStrength}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={backgroundStrength}
                  aria-label={copy.backgroundStrength}
                  aria-valuetext={`${backgroundStrength}%`}
                  disabled={disabled || applying}
                  onChange={(event) => {
                    invalidateBackgroundPreview();
                    setBackgroundStrength(clampMenuBackgroundStrength(Number(event.target.value)));
                    onError("");
                  }}
                  className="mt-1 h-2 w-full accent-orange-600 disabled:opacity-50"
                />
                <span className="mt-0.5 flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                  <span>{copy.cutLess}</span>
                  <span>{copy.cutMore}</span>
                </span>
              </label>

              <p
                role="status"
                aria-live="polite"
                className={`text-[10px] leading-4 ${
                  previewStatus === "unavailable" || previewStatus === "error"
                    ? "font-medium text-amber-700 dark:text-amber-300"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {previewStatus === "ready"
                  ? copy.backgroundPreviewReady
                  : previewStatus === "unavailable"
                    ? copy.backgroundPreviewUnavailable
                    : previewStatus === "error"
                      ? copy.backgroundPreviewError
                      : previewStatus === "updating"
                        ? copy.previewingBackground
                        : copy.backgroundPreviewRequired}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={disabled || applying}
            onClick={resetPlacement}
            className="h-9 rounded-md px-2 text-[12px] font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            {copy.reset}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled || applying}
              onClick={clearEditor}
              className="h-9 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={
                disabled
                || applying
                || previewingBackground
                || !previewFrame
                || (removeBackground && !currentBackgroundPreview?.can_remove)
              }
              onClick={() => { void applyCrop(); }}
              className="ui-press h-9 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white"
            >
              {applying ? copy.applying : copy.apply}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <label
        title={copy.chooseImage}
        className={`group relative block aspect-square w-24 shrink-0 overflow-hidden rounded-md bg-transparent ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        <input
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
        <span
          role="img"
          aria-label={copy.adjustImage}
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${currentImageUrl || "/menu-placeholder-v2.webp"})` }}
        />
        <span className="pointer-events-none absolute inset-0 bg-gray-950/0 transition-colors group-hover:bg-gray-950/5" />
        <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-md bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        </span>
      </label>
      <div className="min-w-0 pt-0.5">
        {currentImageUrl ? (
          <button
            type="button"
            disabled={disabled}
            onClick={openCurrentImage}
            className="h-8 rounded-md border border-gray-200 bg-white px-2.5 text-[11px] font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
          >
            {copy.adjustImage}
          </button>
        ) : null}
      </div>
    </div>
  );
}
