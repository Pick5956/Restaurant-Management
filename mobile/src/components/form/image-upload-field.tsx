import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { inferMenuImageMimeType, validateMenuImageAsset, type MenuImageUploadFile } from '@/src/lib/menu-image';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

type Props = {
  label: string;
  /** The stored image's URL; empty when there is none. */
  value: string;
  /** 'wide' for a cover photo, 'square' for a logo or a QR. */
  shape?: 'square' | 'wide';
  icon?: AppIconName;
  disabled?: boolean;
  /** Uploads the picked file; resolves once it is stored. Throws on failure. */
  onUpload: (file: MenuImageUploadFile) => Promise<void>;
  onRemove: () => void;
  onError: (message: string) => void;
};

/**
 * A picture picked from the phone and uploaded, in place of a field for pasting
 * an image link (owner, 28 ก.ย. 2569: nobody has a link to paste). No framing
 * or cropping, unlike the menu photo: the image goes up as it is.
 */
export function ImageUploadField({ label, value, shape = 'square', icon = 'image-outline', disabled = false, onUpload, onRemove, onError }: Props) {
  const { copy } = useDisplayPreferences();
  const [busy, setBusy] = useState(false);
  const wide = shape === 'wide';
  const frame = { width: wide ? 128 : 72, height: 72 };

  const pick = async () => {
    if (disabled || busy) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const type = inferMenuImageMimeType(asset.mimeType, asset.fileName || asset.uri);
      if (validateMenuImageAsset({ mimeType: type, fileSize: asset.fileSize })) {
        onError(copy('ใช้ไฟล์ jpg, png หรือ webp ขนาดไม่เกิน 5MB', 'Use a jpg, png, or webp file up to 5MB.'));
        return;
      }
      setBusy(true);
      await onUpload({ uri: asset.uri, name: asset.fileName || 'image', type });
    } catch {
      onError(copy('อัปโหลดรูปไม่สำเร็จ', 'Could not upload the picture.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            ...frame,
            borderRadius: 12,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: palette.divider,
            backgroundColor: palette.surfaceSubtle,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {value ? (
            <Image accessibilityLabel={label} resizeMode="cover" source={{ uri: value }} style={frame} />
          ) : (
            <AppIcon name={icon} size={24} color={palette.placeholder} />
          )}
          {busy ? (
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)' }}>
              <ActivityIndicator color={palette.primaryInk} />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled || busy}
            onPress={() => { void pick(); }}
            style={({ pressed }) => ({
              minHeight: 40,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 14,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: palette.divider,
              backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
              opacity: disabled || busy ? 0.5 : 1,
            })}
          >
            <AppIcon name="image-outline" size={17} color={palette.text} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: palette.text }}>
              {value ? copy('เปลี่ยนรูป', 'Change') : copy('เลือกรูป', 'Choose')}
            </Text>
          </Pressable>
          {value ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy(`ลบ${label}`, `Remove ${label}`)}
              disabled={disabled || busy}
              hitSlop={6}
              onPress={onRemove}
              style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: pressed ? palette.surfaceSubtle : 'transparent', opacity: disabled || busy ? 0.5 : 1 })}
            >
              <AppIcon name="trash-outline" size={18} color={palette.danger} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}
