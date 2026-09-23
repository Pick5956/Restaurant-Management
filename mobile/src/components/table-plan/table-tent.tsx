import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, View } from 'react-native';

import { GlassButton } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { DangerAction } from '@/src/components/form/parts';
import { useReducedMotion } from '@/src/components/motion';
import { QrCode } from '@/src/components/table-plan/qr-code';
import { Button } from '@/src/components/ui';
import { palette } from '@/src/theme';

// The head of the table sheet: an orange "table tent" with the ordering QR on
// a white plate, the table and its zone as one value, and the link's two uses.
// Tapping the plate opens the QR at full size inside the same sheet.

function TentPill({ icon, label, onPress, busy }: { icon: AppIconName; label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={busy}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: pressed ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.2)' })}
    >
      {busy ? <ActivityIndicator color="#ffffff" size="small" /> : <AppIcon color="#ffffff" name={icon} size={16} />}
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: '#ffffff' }}>{label}</Text>
    </Pressable>
  );
}

export function TableTent({ label, zone, closed, url, bookingTime, canCreateQr, creatingQr, onOpenQr, onCreateQr, onShare, onOpenMenu, t }: {
  label: string;
  zone: string;
  /** A closed table's label is struck through. */
  closed: boolean;
  /** The customer menu link, or null when the table has no token. */
  url: string | null;
  /** "18:30" when a booking falls in the window. */
  bookingTime: string | null;
  /** Only a table that is not in service may be given a QR from here. */
  canCreateQr: boolean;
  creatingQr: boolean;
  onOpenQr: () => void;
  onCreateQr: () => void;
  onShare: () => void;
  onOpenMenu: () => void;
  t: (th: string, en: string) => string;
}) {
  return (
    <LinearGradient
      colors={['#B93A0D', '#D9581F', '#EF7A35']}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={{ flexDirection: 'row', gap: 14, borderRadius: 20, borderCurve: 'continuous', padding: 14 }}
    >
      <Pressable
        accessibilityLabel={url ? t(`QR ของโต๊ะ ${label}`, `QR for table ${label}`) : t('ไม่มี QR', 'No QR')}
        accessibilityRole={url ? 'button' : undefined}
        disabled={!url}
        onPress={onOpenQr}
        style={{ width: 112, height: 112, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', padding: 10, backgroundColor: '#ffffff' }}
      >
        {url ? <QrCode quietZone={1} size={92} value={url} /> : (
          <Text style={{ fontSize: 13, fontWeight: '600', color: palette.placeholder, textAlign: 'center' }}>{t('ไม่มี QR', 'No QR')}</Text>
        )}
        {url ? (
          <View style={{ position: 'absolute', right: -6, bottom: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
            <AppIcon color={palette.placeholder} name="expand-outline" size={12} />
          </View>
        ) : null}
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={{ color: '#ffffff' }}>
          <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: '#ffffff', fontVariant: ['tabular-nums'], textDecorationLine: closed ? 'line-through' : 'none' }}>{label}</Text>
          <Text style={{ fontSize: 15, lineHeight: 28, fontWeight: '500', color: 'rgba(255,255,255,0.92)' }}>{` ${zone}`}</Text>
        </Text>
        {bookingTime ? (
          <View style={{ alignSelf: 'flex-start', marginTop: 6, minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)' }}>
            <AppIcon color="#ffffff" name="time-outline" size={12} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#ffffff', fontVariant: ['tabular-nums'] }}>{t(`จอง ${bookingTime}`, `Booked ${bookingTime}`)}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {url ? (
            <>
              <TentPill icon="share-social-outline" label={t('แชร์ลิงก์', 'Share link')} onPress={onShare} />
              <TentPill icon="open-outline" label={t('เปิดเมนู', 'Open menu')} onPress={onOpenMenu} />
            </>
          ) : canCreateQr ? (
            <TentPill busy={creatingQr} icon="qr-code-outline" label={t('สร้าง QR', 'Make QR')} onPress={onCreateQr} />
          ) : null}
        </View>
      </View>
    </LinearGradient>
  );
}

/** The QR at full size, for a guest to scan straight off the phone, and the ways to put it on paper. */
export function QrView({ label, zone, url, onBack, canPrint, busy, onPaper, canRegenerate, regenerating, onRegenerate, t }: {
  label: string;
  zone: string;
  url: string;
  onBack: () => void;
  /** Android, where the shop's Bluetooth printer can take the slip. */
  canPrint: boolean;
  busy: boolean;
  onPaper: (mode: 'print' | 'share') => void;
  /** Off for a table in service: the server refuses, and the tables' printed cards would stop working mid-meal. */
  canRegenerate: boolean;
  regenerating: boolean;
  onRegenerate: () => Promise<boolean>;
  t: (th: string, en: string) => string;
}) {
  const reduced = useReducedMotion();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const firstUrl = useRef(url);
  // A new token cross-fades in rather than snapping.
  useEffect(() => {
    if (firstUrl.current === url) return undefined;
    firstUrl.current = url;
    fade.setValue(reduced ? 1 : 0);
    const animation = Animated.timing(fade, { toValue: 1, duration: reduced ? 0 : 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [fade, reduced, url]);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ alignSelf: 'flex-start' }}>
        <GlassButton icon="chevron-back" label={t('กลับ', 'Back')} onPress={onBack} size={40} />
      </View>
      <Text numberOfLines={2} style={{ color: palette.textStrong }}>
        <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{label}</Text>
        <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: '500', color: palette.muted }}>{` ${zone}`}</Text>
      </Text>
      <View style={{ alignSelf: 'center', width: 272, height: 272, borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: '#EFE7DF', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' }}>
        <Animated.View style={{ opacity: fade }}>
          <QrCode quietZone={2} size={248} value={url} />
        </Animated.View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {canPrint ? (
          <Button disabled={busy} icon="print-outline" label={t('พิมพ์ QR', 'Print QR')} onPress={() => onPaper('print')} style={{ flex: 1 }} variant="secondary" />
        ) : null}
        <Button disabled={busy} icon="share-outline" label={t('แชร์รูป QR', 'Share QR image')} onPress={() => onPaper('share')} style={{ flex: 1 }} variant="secondary" />
      </View>
      {canRegenerate ? (
        <DangerAction
          cancelLabel={t('เก็บไว้', 'Keep')}
          confirmLabel={t('สร้างใหม่', 'Make new')}
          icon="key-outline"
          label={t('สร้าง QR ใหม่', 'New QR')}
          loading={regenerating}
          message={t(`QR เดิมของ ${label} จะสแกนไม่ได้ทันที`, `The current QR for ${label} stops working at once.`)}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            void onRegenerate().then(() => setConfirmOpen(false));
          }}
          onOpen={() => setConfirmOpen(true)}
          open={confirmOpen}
        />
      ) : null}
    </View>
  );
}
