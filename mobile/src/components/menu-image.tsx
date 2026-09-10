import { useMemo, useState } from 'react';
import {
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
import { radius } from '@/src/theme';

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

export function MenuImage({
  imageUrl,
  variant = 'row',
  size,
  style,
  onError,
  ...props
}: MenuImageProps) {
  const resolvedUrl = useMemo(() => resolveMenuImageUrl(imageUrl), [imageUrl]);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usePlaceholder = !resolvedUrl || failedUrl === resolvedUrl;
  const squareSize = size ?? (variant === 'editor-thumbnail' ? 96 : 56);
  const square = variant === 'row' || variant === 'editor-thumbnail';
  const source = usePlaceholder ? menuPlaceholder : { uri: resolvedUrl };

  const handleError: NonNullable<ImageProps['onError']> = (event) => {
    if (resolvedUrl) setFailedUrl(resolvedUrl);
    onError?.(event);
  };

  if (!square) {
    return (
      <View style={[styles.landscapeFrame, style]}>
        <Image
          {...props}
          source={source}
          resizeMode="cover"
          style={styles.landscapeImage}
          onError={handleError}
        />
      </View>
    );
  }

  return (
    <Image
      {...props}
      source={source}
      resizeMode="contain"
      style={[
        styles.image,
        { width: squareSize, height: squareSize },
        style,
      ]}
      onError={handleError}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: radius.md,
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
});
