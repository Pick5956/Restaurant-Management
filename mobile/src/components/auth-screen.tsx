import { router } from 'expo-router';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassButton } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { BrandMark } from '@/src/components/brand-mark';
import { MotionReveal } from '@/src/components/motion';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';

function LanguageControl() {
  const { copy, language, setLanguage } = useDisplayPreferences();
  const nextLanguage = language === 'th' ? 'en' : 'th';
  return (
    <Pressable
      accessibilityLabel={copy('เปลี่ยนเป็นภาษาอังกฤษ', 'Switch to Thai')}
      accessibilityRole="button"
      hitSlop={3}
      onPress={() => setLanguage(nextLanguage)}
      style={({ pressed }) => ({
        minWidth: 64,
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
        paddingHorizontal: spacing.md,
        opacity: pressed ? 0.72 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <AppIcon color={palette.muted} name="language-outline" size={18} />
      <Text allowFontScaling={false} style={{ color: palette.textStrong, fontSize: 12, fontWeight: '800' }}>
        {language === 'th' ? 'TH' : 'EN'}
      </Text>
    </Pressable>
  );
}

function BackButton() {
  const { copy } = useDisplayPreferences();
  return (
    <GlassButton icon="chevron-back" label={copy('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />
  );
}

function AuthArtwork() {
  return (
    <View
      style={{
        pointerEvents: 'none',
        flex: 1,
        justifyContent: 'space-between',
        overflow: 'hidden',
        backgroundColor: palette.navigationSurface,
        padding: spacing.xxxl,
      }}
    >
      <BrandMark inverse size={42} />
      <MotionReveal distance={0} style={{ alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 360, height: 360, alignItems: 'center', justifyContent: 'center' }}>
          <View
            style={{
              position: 'absolute',
              width: 360,
              height: 360,
              borderWidth: 1,
              borderColor: palette.navigationMuted,
              borderRadius: radius.full,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: 244,
              height: 244,
              borderWidth: 1,
              borderColor: palette.accentMuted,
              borderRadius: radius.full,
            }}
          />
          <View
            style={{
              width: 104,
              height: 104,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: palette.navigationMuted,
              borderRadius: radius.full,
              backgroundColor: palette.primary,
            }}
          >
            <BrandMark inverse showName={false} size={58} />
          </View>
        </View>
      </MotionReveal>
      {/* A pager's bars and a dot on the ring used to sit here, for a carousel
          that never existed; the owner allows no round dots. This keeps the
          disc where the space-between layout put it. */}
      <View style={{ height: 3 }} />
    </View>
  );
}

export function AuthScreen({
  title,
  subtitle,
  children,
  showBack = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  showBack?: boolean;
}) {
  const { width } = useWindowDimensions();
  const tablet = width >= breakpoints.tablet;

  // typeScale.hero (20/600) is the app's ceiling, the same title every other
  // screen draws. This one was 29-31pt at weight 800, louder than anything the
  // owner allows (16 ก.ย. 2569), and the type test could not see it behind a
  // ternary. No gap between the two lines: their leading already parts them.
  const heading = (
    <View style={{ minWidth: 0, flex: showBack ? 1 : undefined }}>
      <Text accessibilityRole="header" numberOfLines={showBack ? 2 : undefined} selectable style={typeScale.hero}>
        {title}
      </Text>
      {subtitle ? <Text selectable style={[typeScale.body, { color: palette.muted }]}>{subtitle}</Text> : null}
    </View>
  );

  const form = (
    <View
      style={{
        minWidth: 0,
        flex: tablet ? 1 : undefined,
        alignItems: 'center',
        justifyContent: tablet ? 'center' : 'flex-start',
        backgroundColor: palette.surface,
        paddingHorizontal: tablet ? 52 : spacing.xxl,
        paddingVertical: tablet ? spacing.xxxl : spacing.xl,
      }}
    >
      <MotionReveal style={{ width: '100%', maxWidth: 440 }}>
        <View style={{ gap: tablet ? 28 : spacing.xxl }}>
          {showBack ? (
            // A pushed step reads like every other pushed screen (ScreenHeading):
            // the title beside the round back button, not a row below it.
            <View style={{ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <BackButton />
              {heading}
              <LanguageControl />
            </View>
          ) : (
            <>
              <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
                {tablet ? <View /> : <BrandMark size={40} />}
                <LanguageControl />
              </View>
              {heading}
            </>
          )}

          {children}
        </View>
      </MotionReveal>
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={{ flex: 1, backgroundColor: palette.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ minHeight: tablet ? 720 : undefined, flex: 1, flexDirection: tablet ? 'row' : 'column' }}>
            {tablet ? <View style={{ width: '42%', minHeight: 720 }}><AuthArtwork /></View> : null}
            {form}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
