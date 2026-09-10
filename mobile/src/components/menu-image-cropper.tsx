import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  PanResponder,
  PixelRatio,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { MenuImage } from '@/src/components/menu-image';
import { useTabSwipeExclusionHandlers } from '@/src/components/tab-swipe-context';
import { Button } from '@/src/components/ui';
import {
  MENU_IMAGE_BACKGROUND_STRENGTH_DEFAULT,
  MENU_IMAGE_BACKGROUND_STRENGTH_MAX,
  MENU_IMAGE_BACKGROUND_STRENGTH_MIN,
  MENU_IMAGE_BACKGROUND_STRENGTH_STEP,
  MENU_IMAGE_BACKGROUND_PROCESSING_MIME_TYPE,
  MENU_IMAGE_BACKGROUND_PROCESSING_QUALITY,
  MENU_IMAGE_MAX_ZOOM,
  MENU_IMAGE_MIN_ZOOM,
  MENU_IMAGE_OUTPUT_HEIGHT,
  MENU_IMAGE_OUTPUT_MIME_TYPE,
  MENU_IMAGE_OUTPUT_QUALITY,
  MENU_IMAGE_OUTPUT_WIDTH,
  MENU_IMAGE_ZOOM_STEP,
  calculateMenuImageFrame,
  inferMenuImageMimeType,
  menuImageBackgroundStrengthFromTrackPosition,
  menuImageCaptureLogicalSize,
  menuImageOutputName,
  menuImageZoomFromTrackPosition,
  moveMenuImagePosition,
  normalizeMenuImageBackgroundStrength,
  validateMenuImageAsset,
  type MenuImageBackgroundOptions,
  type MenuImageBackgroundPreview,
  type MenuImageFrame,
  type MenuImageUploadFile,
  type MenuImageUploadResult,
} from '@/src/lib/menu-image';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { palette, radius, spacing, typeScale } from '@/src/theme';

type Copy = (thai: string, english: string) => string;
const BACKGROUND_PREVIEW_DEBOUNCE_MS = 350;
const BACKGROUND_PREVIEW_TIMEOUT_MS = 30_000;

interface MenuImageCropperProps {
  currentImageUrl: string;
  copy: Copy;
  disabled?: boolean;
  onPreview: (
    file: MenuImageUploadFile,
    backgroundStrength: number,
    signal?: AbortSignal,
  ) => Promise<MenuImageBackgroundPreview>;
  onUpload: (file: MenuImageUploadFile, options: MenuImageBackgroundOptions) => Promise<MenuImageUploadResult>;
  onError: (message: string) => void;
  onEditingChange?: (editing: boolean) => void;
}

interface Size {
  width: number;
  height: number;
}

interface DragStart {
  positionX: number;
  positionY: number;
}

const clampZoom = (value: number) => Math.min(
  MENU_IMAGE_MAX_ZOOM,
  Math.max(MENU_IMAGE_MIN_ZOOM, value),
);

const formatZoom = (value: number) => `${value > 0 ? '+' : ''}${value}%`;

function ZoomSlider({
  copy,
  disabled,
  value,
  onChange,
}: {
  copy: Copy;
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  const trackWidthRef = useRef(trackWidth);
  const tabSwipeExclusionHandlers = useTabSwipeExclusionHandlers();
  valueRef.current = value;
  disabledRef.current = disabled;
  trackWidthRef.current = trackWidth;

  const setFromTrackPosition = (locationX: number) => {
    const width = trackWidthRef.current;
    if (!width || disabledRef.current) return;
    const nextValue = menuImageZoomFromTrackPosition(locationX, width);
    if (nextValue !== null && nextValue !== valueRef.current) onChange(nextValue);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onPanResponderGrant: (event) => {
      setFromTrackPosition(event.nativeEvent.locationX);
    },
    onPanResponderMove: (event) => {
      setFromTrackPosition(event.nativeEvent.locationX);
    },
    onPanResponderRelease: (event) => {
      setFromTrackPosition(event.nativeEvent.locationX);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [onChange]);

  const changeByStep = (direction: -1 | 1) => {
    if (disabledRef.current) return;
    const nextValue = clampZoom(valueRef.current + direction * MENU_IMAGE_ZOOM_STEP);
    if (nextValue !== valueRef.current) onChange(nextValue);
  };

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') changeByStep(1);
    if (event.nativeEvent.actionName === 'decrement') changeByStep(-1);
  };

  const progress = (value - MENU_IMAGE_MIN_ZOOM)
    / (MENU_IMAGE_MAX_ZOOM - MENU_IMAGE_MIN_ZOOM);

  return (
    <View style={styles.zoomColumn}>
      <View style={styles.zoomLabelRow}>
        <Text style={styles.zoomLabel}>{copy('Zoom', 'Zoom')}</Text>
        <Text style={styles.zoomValue}>{formatZoom(value)}</Text>
      </View>
      <View
        {...tabSwipeExclusionHandlers}
        {...panResponder.panHandlers}
        accessibilityActions={[
          { name: 'decrement', label: copy('ย่อรูป', 'Zoom out') },
          { name: 'increment', label: copy('ขยายรูป', 'Zoom in') },
        ]}
        accessibilityLabel={copy('Zoom รูปเมนู', 'Menu image zoom')}
        accessibilityRole="adjustable"
        accessibilityState={{ disabled }}
        accessibilityValue={{
          min: MENU_IMAGE_MIN_ZOOM,
          max: MENU_IMAGE_MAX_ZOOM,
          now: value,
          text: formatZoom(value),
        }}
        onAccessibilityAction={onAccessibilityAction}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        style={[styles.sliderTouchArea, disabled && styles.disabled]}
      >
        <View pointerEvents="none" style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.sliderThumb, { left: `${progress * 100}%` }]} />
        </View>
      </View>
      <View style={styles.zoomScaleRow}>
        <Text style={styles.zoomScale}>-100%</Text>
        <Text style={styles.zoomScale}>0%</Text>
        <Text style={styles.zoomScale}>+100%</Text>
      </View>
    </View>
  );
}

interface ApprovedBackgroundPreview {
  file: MenuImageUploadFile;
  preview: MenuImageBackgroundPreview;
}

function BackgroundStrengthControl({
  copy,
  disabled,
  value,
  onChange,
}: {
  copy: Copy;
  disabled: boolean;
  value: number;
  onChange: (value: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  const trackWidthRef = useRef(trackWidth);
  const tabSwipeExclusionHandlers = useTabSwipeExclusionHandlers();
  valueRef.current = value;
  disabledRef.current = disabled;
  trackWidthRef.current = trackWidth;

  const setFromTrackPosition = (locationX: number) => {
    if (!trackWidthRef.current || disabledRef.current) return;
    const nextValue = menuImageBackgroundStrengthFromTrackPosition(
      locationX,
      trackWidthRef.current,
    );
    if (nextValue !== null && nextValue !== valueRef.current) onChange(nextValue);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabledRef.current,
    onMoveShouldSetPanResponder: () => !disabledRef.current,
    onPanResponderGrant: (event) => {
      setFromTrackPosition(event.nativeEvent.locationX);
    },
    onPanResponderMove: (event) => setFromTrackPosition(event.nativeEvent.locationX),
    onPanResponderRelease: (event) => {
      setFromTrackPosition(event.nativeEvent.locationX);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [onChange]);

  const changeByStep = (direction: -1 | 1) => {
    if (disabledRef.current) return;
    const nextValue = normalizeMenuImageBackgroundStrength(
      valueRef.current + direction * MENU_IMAGE_BACKGROUND_STRENGTH_STEP,
    );
    if (nextValue !== valueRef.current) onChange(nextValue);
  };
  const progress = (value - MENU_IMAGE_BACKGROUND_STRENGTH_MIN)
    / (MENU_IMAGE_BACKGROUND_STRENGTH_MAX - MENU_IMAGE_BACKGROUND_STRENGTH_MIN);

  return (
    <View style={styles.strengthRow}>
      <Pressable
        accessibilityLabel={copy('ตัดน้อยลง', 'Cut less')}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || value <= MENU_IMAGE_BACKGROUND_STRENGTH_MIN }}
        disabled={disabled || value <= MENU_IMAGE_BACKGROUND_STRENGTH_MIN}
        onPress={() => changeByStep(-1)}
        style={({ pressed }) => [
          styles.zoomButton,
          (disabled || value <= MENU_IMAGE_BACKGROUND_STRENGTH_MIN) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <AppIcon color={palette.text} name="remove-outline" size={19} />
      </Pressable>
      <View style={styles.zoomColumn}>
        <View style={styles.zoomLabelRow}>
          <Text style={styles.zoomLabel}>{copy('ความแรงในการตัด', 'Removal strength')}</Text>
          <Text style={styles.zoomValue}>{value}%</Text>
        </View>
        <View
          {...tabSwipeExclusionHandlers}
          {...panResponder.panHandlers}
          accessibilityActions={[
            { name: 'decrement', label: copy('ตัดน้อยลง', 'Cut less') },
            { name: 'increment', label: copy('ตัดมากขึ้น', 'Cut more') },
          ]}
          accessibilityLabel={copy('ความแรงในการตัดพื้นหลัง', 'Background removal strength')}
          accessibilityRole="adjustable"
          accessibilityState={{ disabled }}
          accessibilityValue={{
            min: MENU_IMAGE_BACKGROUND_STRENGTH_MIN,
            max: MENU_IMAGE_BACKGROUND_STRENGTH_MAX,
            now: value,
            text: `${value}%`,
          }}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') changeByStep(1);
            if (event.nativeEvent.actionName === 'decrement') changeByStep(-1);
          }}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          style={[styles.sliderTouchArea, disabled && styles.disabled]}
        >
          <View pointerEvents="none" style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${progress * 100}%` }]} />
            <View style={[styles.sliderThumb, { left: `${progress * 100}%` }]} />
          </View>
        </View>
        <View style={styles.zoomScaleRow}>
          <Text style={styles.zoomScale}>{copy('น้อย', 'Less')}</Text>
          <Text style={styles.zoomScale}>{copy('มาก', 'More')}</Text>
        </View>
      </View>
      <Pressable
        accessibilityLabel={copy('ตัดมากขึ้น', 'Cut more')}
        accessibilityRole="button"
        accessibilityState={{ disabled: disabled || value >= MENU_IMAGE_BACKGROUND_STRENGTH_MAX }}
        disabled={disabled || value >= MENU_IMAGE_BACKGROUND_STRENGTH_MAX}
        onPress={() => changeByStep(1)}
        style={({ pressed }) => [
          styles.zoomButton,
          (disabled || value >= MENU_IMAGE_BACKGROUND_STRENGTH_MAX) && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <AppIcon color={palette.text} name="add-outline" size={19} />
      </Pressable>
    </View>
  );
}

export function MenuImageCropper({
  currentImageUrl,
  copy,
  disabled = false,
  onPreview,
  onUpload,
  onError,
  onEditingChange,
}: MenuImageCropperProps) {
  const [sourceUri, setSourceUri] = useState('');
  const [sourceName, setSourceName] = useState('menu-image');
  const [zoom, setZoom] = useState(0);
  const [positionX, setPositionX] = useState(0.5);
  const [positionY, setPositionY] = useState(0.5);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [backgroundStrength, setBackgroundStrength] = useState(MENU_IMAGE_BACKGROUND_STRENGTH_DEFAULT);
  const [backgroundPreview, setBackgroundPreview] = useState<MenuImageBackgroundPreview | null>(null);
  const [approvedBackgroundPreview, setApprovedBackgroundPreview] = useState<ApprovedBackgroundPreview | null>(null);
  const [backgroundError, setBackgroundError] = useState('');
  const captureTargetRef = useRef<View | null>(null);
  const copyRef = useRef(copy);
  const onErrorRef = useRef(onError);
  const onPreviewRef = useRef(onPreview);
  const sourceTokenRef = useRef(0);
  const positionRef = useRef({ x: positionX, y: positionY });
  const frameRef = useRef<MenuImageFrame | null>(null);
  const viewportSizeRef = useRef(viewportSize);
  const disabledRef = useRef(disabled);
  const applyingRef = useRef(applying);
  const previewGenerationRef = useRef(createRequestGeneration());
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef<DragStart | null>(null);
  const tabSwipeExclusionHandlers = useTabSwipeExclusionHandlers();
  const editing = Boolean(sourceUri);
  const processing = applying || previewing;
  const removedPercent = backgroundPreview
    ? Math.round(Math.min(100, Math.max(0,
      backgroundPreview.removed_ratio <= 1
        ? backgroundPreview.removed_ratio * 100
        : backgroundPreview.removed_ratio)))
    : 0;
  const sourceRenderToken = sourceTokenRef.current;
  const pixelRatio = PixelRatio.get();
  const captureSize = useMemo(
    () => menuImageCaptureLogicalSize(pixelRatio),
    [pixelRatio],
  );
  const displayScale = viewportSize.width > 0
    ? viewportSize.width / captureSize.width
    : 1;

  positionRef.current = { x: positionX, y: positionY };
  viewportSizeRef.current = viewportSize;
  disabledRef.current = disabled;
  applyingRef.current = applying;
  copyRef.current = copy;
  onErrorRef.current = onError;
  onPreviewRef.current = onPreview;

  const cancelBackgroundPreviewRequest = useCallback(() => {
    if (previewDebounceRef.current) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
  }, []);

  const invalidateBackgroundPreview = useCallback(() => {
    cancelBackgroundPreviewRequest();
    previewGenerationRef.current.invalidate();
    setBackgroundPreview(null);
    setApprovedBackgroundPreview(null);
    setBackgroundError('');
    setPreviewing(false);
    setPreviewRevision((current) => current + 1);
  }, [cancelBackgroundPreviewRequest]);

  const changeZoom = useCallback((value: number) => {
    invalidateBackgroundPreview();
    setZoom(clampZoom(value));
  }, [invalidateBackgroundPreview]);

  const changeBackgroundStrength = useCallback((value: number) => {
    invalidateBackgroundPreview();
    setBackgroundStrength(normalizeMenuImageBackgroundStrength(value));
  }, [invalidateBackgroundPreview]);

  const toggleBackgroundRemoval = useCallback(() => {
    invalidateBackgroundPreview();
    setRemoveBackground((current) => !current);
  }, [invalidateBackgroundPreview]);

  const previewFrame = useMemo(() => {
    if (!naturalSize || !captureSize.width || !captureSize.height) return null;
    return calculateMenuImageFrame({
      naturalWidth: naturalSize.width,
      naturalHeight: naturalSize.height,
      cropWidth: captureSize.width,
      cropHeight: captureSize.height,
      zoomPercent: zoom,
      positionX,
      positionY,
    });
  }, [captureSize, naturalSize, positionX, positionY, zoom]);
  frameRef.current = previewFrame;

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  useEffect(() => () => {
    sourceTokenRef.current += 1;
    cancelBackgroundPreviewRequest();
    previewGenerationRef.current.invalidate();
    onEditingChange?.(false);
  }, [cancelBackgroundPreviewRequest, onEditingChange]);

  const resetPlacement = () => {
    invalidateBackgroundPreview();
    positionRef.current = { x: 0.5, y: 0.5 };
    setZoom(0);
    setPositionX(0.5);
    setPositionY(0.5);
  };

  const clearEditor = () => {
    sourceTokenRef.current += 1;
    setSourceUri('');
    setSourceName('menu-image');
    setNaturalSize(null);
    setSourceLoaded(false);
    setApplying(false);
    setDragging(false);
    setRemoveBackground(false);
    setBackgroundStrength(MENU_IMAGE_BACKGROUND_STRENGTH_DEFAULT);
    dragStartRef.current = null;
    resetPlacement();
  };

  const openSource = (
    uri: string,
    name: string,
    knownSize?: Size,
  ) => {
    const token = sourceTokenRef.current + 1;
    sourceTokenRef.current = token;
    onError('');
    setSourceUri(uri);
    setSourceName(name || 'menu-image');
    setNaturalSize(knownSize && knownSize.width > 0 && knownSize.height > 0
      ? knownSize
      : null);
    setSourceLoaded(false);
    setRemoveBackground(false);
    setBackgroundStrength(MENU_IMAGE_BACKGROUND_STRENGTH_DEFAULT);
    resetPlacement();

    if (knownSize && knownSize.width > 0 && knownSize.height > 0) return;
    Image.getSize(
      uri,
      (width, height) => {
        if (sourceTokenRef.current !== token) return;
        setNaturalSize({ width, height });
      },
      () => {
        if (sourceTokenRef.current !== token) return;
        setNaturalSize(null);
        onError(copy(
          'เปิดรูปเพื่อจัดวางไม่สำเร็จ กรุณาเลือกรูปใหม่',
          'Could not open this image for positioning. Choose a new image.',
        ));
      },
    );
  };

  const selectImage = async () => {
    if (disabled || applying) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = inferMenuImageMimeType(
        asset.mimeType,
        asset.fileName || asset.uri,
      );
      const issue = validateMenuImageAsset({
        mimeType,
        fileSize: asset.fileSize,
      });
      if (issue) {
        onError(copy(
          'อัปโหลดรูปไม่สำเร็จ กรุณาใช้ไฟล์ jpg, png หรือ webp ขนาดไม่เกิน 5MB',
          'Could not upload image. Use jpg, png, or webp up to 5MB.',
        ));
        return;
      }
      openSource(asset.uri, asset.fileName || 'menu-image', {
        width: asset.width,
        height: asset.height,
      });
    } catch {
      onError(copy(
        'เปิดรูปเพื่อจัดวางไม่สำเร็จ กรุณาเลือกรูปใหม่',
        'Could not open this image for positioning. Choose a new image.',
      ));
    }
  };

  const cropPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => Boolean(
      frameRef.current && !disabledRef.current && !applyingRef.current,
    ),
    onMoveShouldSetPanResponder: () => Boolean(
      frameRef.current && !disabledRef.current && !applyingRef.current,
    ),
    onPanResponderGrant: () => {
      invalidateBackgroundPreview();
      dragStartRef.current = {
        positionX: positionRef.current.x,
        positionY: positionRef.current.y,
      };
      setDragging(true);
    },
    onPanResponderMove: (_event, gesture) => {
      const start = dragStartRef.current;
      const frame = frameRef.current;
      if (!start || !frame) return;
      const scale = viewportSizeRef.current.width / captureSize.width || 1;
      const next = moveMenuImagePosition({
        positionX: start.positionX,
        positionY: start.positionY,
        deltaX: gesture.dx / scale,
        deltaY: gesture.dy / scale,
        offsetRangeX: captureSize.width - frame.width,
        offsetRangeY: captureSize.height - frame.height,
      });
      positionRef.current = { x: next.positionX, y: next.positionY };
      setPositionX(next.positionX);
      setPositionY(next.positionY);
    },
    onPanResponderRelease: () => {
      dragStartRef.current = null;
      setDragging(false);
    },
    onPanResponderTerminate: () => {
      dragStartRef.current = null;
      setDragging(false);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [captureSize.height, captureSize.width, invalidateBackgroundPreview]);

  const captureOutput = useCallback(async (
    forBackgroundRemoval: boolean,
  ): Promise<MenuImageUploadFile> => {
    const target = captureTargetRef.current;
    if (!target || !previewFrame || !sourceLoaded) {
      throw new Error('Menu image is not ready to capture.');
    }

    let capturedUri = '';
    try {
      capturedUri = await captureRef(target, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      let converted: ImageResult;
      const context = ImageManipulator.manipulate(capturedUri);
      try {
        context.resize({
          width: MENU_IMAGE_OUTPUT_WIDTH,
          height: MENU_IMAGE_OUTPUT_HEIGHT,
        });
        const renderedImage = await context.renderAsync();
        try {
          converted = await renderedImage.saveAsync({
            format: forBackgroundRemoval ? SaveFormat.PNG : SaveFormat.WEBP,
            compress: forBackgroundRemoval
              ? MENU_IMAGE_BACKGROUND_PROCESSING_QUALITY
              : MENU_IMAGE_OUTPUT_QUALITY,
          });
        } finally {
          renderedImage.release();
        }
      } finally {
        context.release();
      }

      if (
        converted.width !== MENU_IMAGE_OUTPUT_WIDTH
        || converted.height !== MENU_IMAGE_OUTPUT_HEIGHT
      ) {
        throw new Error('Unexpected menu image output size.');
      }

      return {
        uri: converted.uri,
        name: menuImageOutputName(sourceName, forBackgroundRemoval),
        type: forBackgroundRemoval
          ? MENU_IMAGE_BACKGROUND_PROCESSING_MIME_TYPE
          : MENU_IMAGE_OUTPUT_MIME_TYPE,
      };
    } finally {
      if (capturedUri) releaseCapture(capturedUri);
    }
  }, [previewFrame, sourceLoaded, sourceName]);

  const runBackgroundPreview = useCallback(async () => {
    if (!removeBackground || applying || dragging) return;
    cancelBackgroundPreviewRequest();
    const request = previewGenerationRef.current.begin();
    const abortController = new AbortController();
    const requestedStrength = backgroundStrength;
    previewAbortRef.current = abortController;
    previewTimeoutRef.current = setTimeout(
      () => abortController.abort(),
      BACKGROUND_PREVIEW_TIMEOUT_MS,
    );
    setPreviewing(true);
    setBackgroundError('');
    onErrorRef.current('');
    try {
      const file = await captureOutput(true);
      if (!previewGenerationRef.current.isCurrent(request)) return;
      const preview = await onPreviewRef.current(file, requestedStrength, abortController.signal);
      if (!previewGenerationRef.current.isCurrent(request)) return;
      if (
        !preview.can_remove
        || !preview.preview_data_url?.trim()
        || normalizeMenuImageBackgroundStrength(preview.strength) !== requestedStrength
      ) {
        setBackgroundPreview(null);
        setApprovedBackgroundPreview(null);
        setBackgroundError(copyRef.current(
          'ระบบแยกพื้นหลังรูปนี้ได้ไม่ชัด ลองปรับความแรง หรือปิดการตัดพื้นหลังเพื่อใช้รูปเดิม',
          'The background could not be separated reliably. Adjust the strength or turn background removal off to use the original image.',
        ));
        return;
      }
      setBackgroundPreview(preview);
      setApprovedBackgroundPreview({ file, preview });
    } catch {
      if (!previewGenerationRef.current.isCurrent(request)) return;
      setApprovedBackgroundPreview(null);
      setBackgroundPreview(null);
      setBackgroundError(copyRef.current(
        'อัปเดตภาพที่ตัดไม่สำเร็จ ขยับรูปหรือปรับความแรงเพื่อให้ระบบลองใหม่ หรือปิดการตัดพื้นหลัง',
        'Could not update the cutout. Move the image or adjust the strength to try again, or turn background removal off.',
      ));
    } finally {
      if (previewGenerationRef.current.isCurrent(request)) {
        if (previewAbortRef.current === abortController) previewAbortRef.current = null;
        if (previewTimeoutRef.current) {
          clearTimeout(previewTimeoutRef.current);
          previewTimeoutRef.current = null;
        }
        setPreviewing(false);
      }
    }
  }, [
    applying,
    backgroundStrength,
    cancelBackgroundPreviewRequest,
    captureOutput,
    dragging,
    removeBackground,
  ]);

  useEffect(() => {
    if (
      !removeBackground
      || disabled
      || applying
      || dragging
      || !previewFrame
      || !sourceLoaded
    ) {
      return;
    }

    const debounce = setTimeout(() => {
      if (previewDebounceRef.current === debounce) previewDebounceRef.current = null;
      void runBackgroundPreview();
    }, BACKGROUND_PREVIEW_DEBOUNCE_MS);
    previewDebounceRef.current = debounce;

    return () => {
      clearTimeout(debounce);
      if (previewDebounceRef.current === debounce) previewDebounceRef.current = null;
    };
  }, [
    applying,
    disabled,
    previewFrame,
    dragging,
    previewRevision,
    removeBackground,
    runBackgroundPreview,
    sourceLoaded,
  ]);

  const applyCrop = async () => {
    if (removeBackground && !approvedBackgroundPreview) {
      setBackgroundError(copy(
        'รอให้ภาพที่ตัดอัปเดตเสร็จ แล้วจึงใช้รูปนี้',
        'Wait for the cutout to finish updating before using this image.',
      ));
      return;
    }

    setApplying(true);
    setBackgroundError('');
    onError('');
    try {
      const file = removeBackground
        ? approvedBackgroundPreview!.file
        : await captureOutput(false);
      const uploaded = await onUpload(file, {
        removeBackground,
        backgroundStrength,
      });
      if (removeBackground && !uploaded.uploaded) {
        setBackgroundError(copy(
          'ตัดพื้นหลังและอัปโหลดไม่สำเร็จ รูปเดิมยังไม่ถูกเปลี่ยน ลองอีกครั้งหรือปิดการตัดพื้นหลัง',
          'Background removal and upload failed. The original image was kept. Try again or turn background removal off.',
        ));
        return;
      }
      if (removeBackground && uploaded.uploaded && !uploaded.backgroundRemoved) {
        setBackgroundError(copy(
          'ระบบยังไม่ได้ตัดพื้นหลัง รูปเดิมจึงยังไม่ถูกเปลี่ยน ลองปรับความแรงให้ภาพอัปเดตใหม่ หรือปิดการตัดพื้นหลัง',
          'The background was not removed, so the original image was kept. Adjust the strength for a new cutout or turn background removal off.',
        ));
        return;
      }

      if (uploaded.uploaded) {
        AccessibilityInfo.announceForAccessibility(copy(
          'อัปโหลดรูปเมนูแล้ว',
          'Menu image uploaded.',
        ));
        clearEditor();
      }
    } catch {
      onError(copy(
        'จัดวางรูปไม่สำเร็จ กรุณาเลือกรูปใหม่',
        'Could not position this image. Choose a new image.',
      ));
    } finally {
      setApplying(false);
    }
  };

  const onViewportLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setViewportSize({ width, height });
  };

  const moveWithAccessibility = (deltaX: number, deltaY: number) => {
    const frame = frameRef.current;
    if (!frame || disabled || applying) return;
    invalidateBackgroundPreview();
    const scale = displayScale || 1;
    const next = moveMenuImagePosition({
      positionX: positionRef.current.x,
      positionY: positionRef.current.y,
      deltaX: deltaX / scale,
      deltaY: deltaY / scale,
      offsetRangeX: captureSize.width - frame.width,
      offsetRangeY: captureSize.height - frame.height,
    });
    positionRef.current = { x: next.positionX, y: next.positionY };
    setPositionX(next.positionX);
    setPositionY(next.positionY);
  };

  const onCropAccessibilityAction = (event: AccessibilityActionEvent) => {
    switch (event.nativeEvent.actionName) {
      case 'moveLeft': moveWithAccessibility(-8, 0); break;
      case 'moveRight': moveWithAccessibility(8, 0); break;
      case 'moveUp': moveWithAccessibility(0, -8); break;
      case 'moveDown': moveWithAccessibility(0, 8); break;
    }
  };

  if (!editing) {
    return (
      <View style={styles.field}>
        <View style={styles.thumbnailRow}>
          <Pressable
            accessibilityHint={copy(
              'เปิดคลังรูปเพื่อเลือกรูปเมนู',
              'Opens the photo library to choose a menu image.',
            )}
            accessibilityLabel={copy('เลือกรูป', 'Choose image')}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => { void selectImage(); }}
            style={({ pressed }) => [
              styles.thumbnailButton,
              disabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <MenuImage
              accessible={false}
              imageUrl={currentImageUrl}
              size={96}
              variant="editor-thumbnail"
            />
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={styles.replaceBadge}
            >
              <AppIcon color={palette.primaryText} name="image-outline" size={16} />
            </View>
          </Pressable>
          {currentImageUrl.trim() ? (
            <Button
              compact
              disabled={disabled}
              label={copy('ปรับตำแหน่งรูป', 'Adjust image')}
              onPress={() => openSource(currentImageUrl.trim(), 'menu-image')}
              variant="secondary"
            />
          ) : null}
        </View>
        <Text style={styles.supportText}>
          {copy(
            'รองรับ jpg, png, webp ไม่เกิน 5MB · เลือกตัดพื้นหลังได้หลังจัดวางรูป',
            'Supports jpg, png, webp up to 5MB · Background removal is optional after positioning',
          )}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <View style={styles.cropIntroduction}>
        <Text style={styles.fieldLabel}>
          {copy('จัดวางรูปเมนู', 'Position menu image')}
        </Text>
        <Text style={styles.cropHint}>
          {copy(
            'กรอบนี้ตรงกับรูปบนการ์ดเมนู ลากเพื่อจัดตำแหน่ง และปรับ Zoom ได้ตั้งแต่ -100% ถึง +100%',
            'This frame matches the menu card. Drag to reposition and adjust Zoom from -100% to +100%.',
          )}
        </Text>
      </View>

      <View
        {...tabSwipeExclusionHandlers}
        {...cropPanResponder.panHandlers}
        accessibilityActions={[
          { name: 'moveLeft', label: copy('เลื่อนรูปไปทางซ้าย', 'Move image left') },
          { name: 'moveRight', label: copy('เลื่อนรูปไปทางขวา', 'Move image right') },
          { name: 'moveUp', label: copy('เลื่อนรูปขึ้น', 'Move image up') },
          { name: 'moveDown', label: copy('เลื่อนรูปลง', 'Move image down') },
        ]}
        accessibilityHint={copy(
          'ใช้นิ้วลากเพื่อเลื่อนรูป',
          'Drag with one finger to move the image.',
        )}
        accessibilityLabel={copy(
          'พื้นที่จัดวางรูปเมนู',
          'Menu image positioning area',
        )}
        accessibilityRole="adjustable"
        accessibilityState={{
          busy: removeBackground
            && (dragging || previewing || (!approvedBackgroundPreview && !backgroundError)),
        }}
        accessible
        onAccessibilityAction={onCropAccessibilityAction}
        onLayout={onViewportLayout}
        style={styles.cropViewport}
      >
        {viewportSize.width > 0 && previewFrame ? (
          <View
            pointerEvents="none"
            style={[
              styles.captureWrapper,
              {
                width: captureSize.width,
                height: captureSize.height,
                left: (viewportSize.width - captureSize.width) / 2,
                top: (viewportSize.height - captureSize.height) / 2,
                transform: [{ scale: displayScale }],
              },
            ]}
          >
            <View
              ref={captureTargetRef}
              collapsable={false}
              style={[
                styles.captureTarget,
                { width: captureSize.width, height: captureSize.height },
              ]}
            >
              <Image
                key={`${sourceRenderToken}:${sourceUri}`}
                accessible={false}
                onError={() => {
                  if (sourceTokenRef.current !== sourceRenderToken) return;
                  setSourceLoaded(false);
                  onError(copy(
                    'เปิดรูปเพื่อจัดวางไม่สำเร็จ กรุณาเลือกรูปใหม่',
                    'Could not open this image for positioning. Choose a new image.',
                  ));
                }}
                onLoad={() => {
                  if (sourceTokenRef.current === sourceRenderToken) setSourceLoaded(true);
                }}
                resizeMode="stretch"
                source={{ uri: sourceUri }}
                style={{
                  position: 'absolute',
                  left: previewFrame.x,
                  top: previewFrame.y,
                  width: previewFrame.width,
                  height: previewFrame.height,
                }}
              />
            </View>
          </View>
        ) : null}
        {removeBackground && backgroundPreview?.preview_data_url?.trim() ? (
          <View pointerEvents="none" style={styles.backgroundPreviewOverlay}>
            <Image
              accessible={false}
              resizeMode="stretch"
              source={{ uri: backgroundPreview.preview_data_url }}
              style={styles.backgroundPreviewImage}
            />
          </View>
        ) : null}
        {!previewFrame || !sourceLoaded ? (
          <View pointerEvents="none" style={styles.cropLoading}>
            <ActivityIndicator color={palette.muted} />
            <Text style={styles.supportText}>
              {copy('กำลังเตรียมรูป...', 'Preparing image...')}
            </Text>
          </View>
        ) : null}
        <View pointerEvents="none" style={styles.cropBorder} />
        <View pointerEvents="none" style={styles.aspectBadge}>
          <AppIcon color={palette.primaryText} name="move-outline" size={14} />
          <Text style={styles.aspectBadgeText}>3:3</Text>
        </View>
      </View>

      <View style={styles.zoomRow}>
        <Pressable
          accessibilityLabel={copy('ย่อรูป', 'Zoom out')}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || applying || zoom <= MENU_IMAGE_MIN_ZOOM }}
          disabled={disabled || applying || zoom <= MENU_IMAGE_MIN_ZOOM}
          onPress={() => changeZoom(zoom - MENU_IMAGE_ZOOM_STEP)}
          style={({ pressed }) => [
            styles.zoomButton,
            (disabled || applying || zoom <= MENU_IMAGE_MIN_ZOOM) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <AppIcon color={palette.text} name="remove-outline" size={19} />
        </Pressable>
        <ZoomSlider
          copy={copy}
          disabled={disabled || applying}
          onChange={changeZoom}
          value={zoom}
        />
        <Pressable
          accessibilityLabel={copy('ขยายรูป', 'Zoom in')}
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || applying || zoom >= MENU_IMAGE_MAX_ZOOM }}
          disabled={disabled || applying || zoom >= MENU_IMAGE_MAX_ZOOM}
          onPress={() => changeZoom(zoom + MENU_IMAGE_ZOOM_STEP)}
          style={({ pressed }) => [
            styles.zoomButton,
            (disabled || applying || zoom >= MENU_IMAGE_MAX_ZOOM) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <AppIcon color={palette.text} name="add-outline" size={19} />
        </Pressable>
      </View>

      <View style={styles.backgroundRemovalSection}>
        <Pressable
          accessibilityHint={copy(
            'เปิดแล้วภาพที่ตัดจะอัปเดตในกรอบจัดวางโดยอัตโนมัติ',
            'Turn on to update the cutout automatically inside the positioning frame.',
          )}
          accessibilityLabel={copy('ตัดพื้นหลังรูปอาหาร', 'Remove food photo background')}
          accessibilityRole="switch"
          accessibilityState={{ checked: removeBackground, disabled: disabled || applying }}
          disabled={disabled || applying}
          onPress={toggleBackgroundRemoval}
          style={({ pressed }) => [
            styles.backgroundToggle,
            pressed && styles.pressed,
            (disabled || applying) && styles.disabled,
          ]}
        >
          <View style={[
            styles.backgroundToggleIndicator,
            removeBackground && styles.backgroundToggleIndicatorActive,
          ]}>
            {removeBackground ? <AppIcon color={palette.primaryText} name="checkmark" size={16} /> : null}
          </View>
          <View style={styles.backgroundToggleCopy}>
            <Text style={styles.fieldLabel}>{copy('ตัดพื้นหลัง', 'Remove background')}</Text>
            <Text style={styles.supportText}>{copy(
              'ปิดไว้เป็นค่าเริ่มต้น เปิดเมื่อต้องการให้เหลือเฉพาะอาหาร',
              'Off by default. Turn on when you want to keep only the food.',
            )}</Text>
          </View>
        </Pressable>

        {removeBackground ? (
          <View style={styles.backgroundRemovalControls}>
            <BackgroundStrengthControl
              copy={copy}
              disabled={disabled || applying}
              onChange={changeBackgroundStrength}
              value={backgroundStrength}
            />
            {dragging ? (
              <Text accessibilityLiveRegion="polite" style={styles.backgroundStatus}>
                {copy(
                  'กำลังจัดตำแหน่งรูป...',
                  'Positioning image...',
                )}
              </Text>
            ) : previewing || (!approvedBackgroundPreview && !backgroundError) ? (
              <View accessibilityLiveRegion="polite" style={styles.backgroundStatusRow}>
                <ActivityIndicator color={palette.muted} size="small" />
                <Text style={styles.backgroundStatus}>
                  {previewing
                    ? copy('กำลังอัปเดตภาพที่ตัด...', 'Updating cutout...')
                    : copy('กำลังเตรียมภาพที่ตัด...', 'Preparing cutout...')}
                </Text>
              </View>
            ) : approvedBackgroundPreview ? (
              <Text accessibilityLiveRegion="polite" style={styles.backgroundSuccess}>
                {copy(
                  `ตัดพื้นหลังแล้วประมาณ ${removedPercent.toLocaleString('th-TH')}% · เส้นสีส้มคือขอบที่เก็บไว้`,
                  `About ${removedPercent.toLocaleString('en-US')}% removed · the orange line marks the kept edge.`,
                )}
              </Text>
            ) : backgroundError ? (
              <Text accessibilityRole="alert" style={styles.backgroundError}>
                {backgroundError}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.editorActions}>
        <Button
          compact
          disabled={disabled || applying}
          label={copy('คืนค่าตำแหน่ง', 'Reset position')}
          onPress={resetPlacement}
          variant="ghost"
        />
        <View style={styles.confirmActions}>
          <Button
            compact
            disabled={disabled || applying}
            label={copy('ยกเลิก', 'Cancel')}
            onPress={clearEditor}
            variant="secondary"
          />
          <Button
            compact
            disabled={disabled || processing || !previewFrame || !sourceLoaded || (removeBackground && !approvedBackgroundPreview)}
            label={applying
              ? copy('กำลังเตรียมรูป...', 'Preparing image...')
              : copy('ใช้รูปนี้', 'Use this image')}
            loading={applying}
            onPress={() => { void applyCrop(); }}
          />
        </View>
      </View>
      {dragging ? (
        <Text accessibilityLiveRegion="polite" style={styles.srOnly}>
          {copy('กำลังเลื่อนรูป', 'Moving image')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  thumbnailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  thumbnailButton: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  replaceBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: palette.primary,
  },
  supportText: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  editor: {
    gap: spacing.md,
  },
  cropIntroduction: {
    gap: 2,
  },
  cropHint: {
    color: palette.muted,
    fontSize: 12,
    lineHeight: 19,
  },
  cropViewport: {
    width: '100%',
    aspectRatio: 1,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surfaceSubtle,
  },
  captureWrapper: {
    position: 'absolute',
  },
  captureTarget: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  backgroundPreviewOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.surfaceSubtle,
  },
  cropLoading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceSubtle,
  },
  cropBorder: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.68)',
  },
  aspectBadge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.md,
    backgroundColor: palette.navigationBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  aspectBadgeText: {
    color: palette.primaryText,
    fontSize: 11,
    fontWeight: '700',
  },
  zoomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  zoomButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  zoomColumn: {
    minWidth: 0,
    flex: 1,
  },
  zoomLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  zoomLabel: {
    color: palette.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  zoomValue: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sliderTouchArea: {
    height: 30,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 5,
    borderRadius: radius.full,
    backgroundColor: palette.borderStrong,
  },
  sliderFill: {
    height: 5,
    borderRadius: radius.full,
    backgroundColor: palette.accent,
  },
  sliderThumb: {
    position: 'absolute',
    top: -7.5,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderWidth: 2,
    borderColor: palette.surface,
    borderRadius: radius.full,
    backgroundColor: palette.accent,
  },
  zoomScaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  zoomScale: {
    color: palette.placeholder,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backgroundRemovalSection: {
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
  },
  backgroundToggle: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  backgroundToggleIndicator: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
  },
  backgroundToggleIndicatorActive: {
    borderColor: palette.primary,
    backgroundColor: palette.primary,
  },
  backgroundToggleCopy: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  backgroundRemovalControls: {
    gap: spacing.md,
  },
  backgroundPreviewImage: {
    width: '100%',
    height: '100%',
  },
  backgroundStatusRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backgroundStatus: {
    color: palette.muted,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  backgroundSuccess: {
    color: palette.success,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  backgroundError: {
    color: palette.danger,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  confirmActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.76,
  },
  srOnly: {
    ...typeScale.caption,
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
