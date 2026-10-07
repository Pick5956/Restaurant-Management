import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  type ImageProps,
  type ImageStyle,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { apiUrl } from '@/src/api/client';
import { resolveBackendMediaUrl } from '@/src/lib/media-url';
import { palette, radius } from '@/src/theme';

const menuPlaceholder = require('../../assets/images/menu-placeholder-v2.webp') as ImageSourcePropType;

export type MenuImageVariant = 'card' | 'hero' | 'row' | 'editor-thumbnail';

export type MenuImageProps = Omit<ImageProps, 'resizeMode' | 'source' | 'style'> & {
  imageUrl?: string | null;
  variant?: MenuImageVariant;
  size?: number;
  style?: StyleProp<ImageStyle & ViewStyle>;
};

function resolveMenuImageUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    return resolveBackendMediaUrl(trimmed, apiUrl).trim() || null;
  } catch {
    return null;
  }
}

/**
 * While a dish's photo is still coming over the network, its slot shows a
 * tinted square with a small spinner (owner, 29 ก.ย. 2569): an empty slot read
 * as a missing photo, not one on its way.
 */
function LoadingCover() {
  return (
    <View pointerEvents="none" style={styles.loadingCover}>
      <ActivityIndicator size="small" color={palette.muted} />
    </View>
  );
}

export function MenuImage({
  imageUrl,
  variant = 'row',
  size,
  style,
  onError,
  onLoadEnd,
  ...props
}: MenuImageProps) {
  const resolvedUrl = useMemo(() => resolveMenuImageUrl(imageUrl), [imageUrl]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const usePlaceholder = !resolvedUrl || failedUrl === resolvedUrl;
  const loading = !usePlaceholder && loadedUrl !== resolvedUrl;
  const squareSize = size ?? (variant === 'editor-thumbnail' ? 96 : 56);
  const square = variant === 'row' || variant === 'editor-thumbnail';
  const source = usePlaceholder ? menuPlaceholder : { uri: resolvedUrl };

  const handleError: NonNullable<ImageProps['onError']> = (event) => {
    if (resolvedUrl) setFailedUrl(resolvedUrl);
    onError?.(event);
  };
  // onLoadEnd fires after a success and after a failure alike, so the cover
  // comes off either way; a failure swaps in the placeholder through onError.
  const handleLoadEnd = () => {
    if (resolvedUrl) setLoadedUrl(resolvedUrl);
    onLoadEnd?.();
  };

  if (!square) {
    return (
      <View style={[styles.landscapeFrame, loading && styles.loadingFrame, style]}>
        <Image
          {...props}
          source={source}
          resizeMode="cover"
          style={styles.landscapeImage}
          onError={handleError}
          onLoadEnd={handleLoadEnd}
        />
        {loading ? <LoadingCover /> : null}
      </View>
    );
  }

  return (
    <View style={[styles.squareFrame, { width: squareSize, height: squareSize }, loading && styles.loadingFrame, style]}>
      <Image
        {...props}
        source={source}
        resizeMode="contain"
        style={styles.squareImage}
        onError={handleError}
        onLoadEnd={handleLoadEnd}
      />
      {loading ? <LoadingCover /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  squareFrame: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  squareImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  landscapeFrame: {
    width: '100%',
    // Square, matching the crop the editor exports. See MENU_IMAGE_OUTPUT_*.
    aspectRatio: 1,
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  landscapeImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  loadingFrame: {
    backgroundColor: palette.surfaceSubtle,
  },
  loadingCover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
