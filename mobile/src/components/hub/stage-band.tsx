import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { GlassPanel } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { DayCurve } from '@/src/components/hub/day-curve';
import { RetryPill } from '@/src/components/hub/stage-tiles';
import { useReducedMotion } from '@/src/components/motion';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { scaleFont } from '@/src/lib/app-font';
import { money } from '@/src/lib/format';
import { fittedNameSize, NAME_MIN_SCALE } from '@/src/lib/hub-stage-layout';
import type { HubNavItem, HubShop, HubSlot, HubTakings } from '@/src/lib/hub-types';
import { LIQUID_GLASS } from '@/src/lib/liquid-glass';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, typeScale } from '@/src/theme';

// The stage of layout B, "เวที": a warm full-bleed band from the top edge of
// the display, holding the shop and, for owners and managers, today's takings.
// It has no text of its own. The service tiles that follow it in the page are
// pulled up over its foot, so the band reserves that room at its bottom.

const STAGE_DARK = palette.navigationSurface; // #9A3412
const STAGE_LIGHT = palette.primary; // #C2410C
const STAGE_RADIUS = 28;
/** 165 degrees (CSS) as expo-linear-gradient points in the unit box: mostly downward, a little to the right. */
const ANGLE_START = { x: 0.37, y: 0.02 };
const ANGLE_END = { x: 0.63, y: 0.98 };
const COVER_SCRIM = ['rgba(124, 45, 18, 0.80)', 'rgba(194, 65, 12, 0.90)'] as const;
const GLOW = '#FB923C';

const ON_STAGE = '#FFFFFF';
const ON_STAGE_SOFT = 'rgba(255, 255, 255, 0.82)';
/** The two glass capsules on the stage: the role and the switch. The only glass on the page. */
const CAPSULE_TINT = 'rgba(255, 255, 255, 0.16)';
const CAPSULE_EDGE = 'rgba(255, 255, 255, 0.28)';
/**
 * The switch capsule's glass carries its darkness in the tint (colorScheme
 * 'light' glass left untinted frosts pale over the stage or a cover photo and
 * washes out the white label). The flat stand-in keeps CAPSULE_TINT.
 */
const SWITCH_GLASS_TINT = 'rgba(124, 45, 18, 0.25)';
const LOGO_SHADOW = '0 4px 12px rgba(61, 20, 5, 0.25)';

/**
 * Orange drawn above the band's top edge, out of sight. AppScreen turns the
 * rubber band off on an immersive screen today; if it ever comes back (iOS
 * needs it for pull-to-refresh), a pull shows more stage, not a strip of white.
 */
const OVERSCROLL_CAP = 1200;

/** Width of the hidden copy that measures the shop name: wider than any name, so it never wraps. */
const NAME_MEASURE_ROOM = 4000;

const GLOW_MS = 300;
const COVER_MS = 200;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const NATIVE_DRIVER = Platform.OS !== 'web';

// ---------------------------------------------------------------- band

export type StageBandProps = {
  shop: HubShop;
  /** The screen gutter the band breaks out of, so it reaches both edges. */
  bleed: number;
  /** The inner content's cap, the same as the tiles' and the shelf's. */
  contentMaxWidth: number;
  /** The status bar's height; the band paints under it. */
  topInset: number;
  /** Room at the foot for whatever follows it: the tiles' overlap plus a margin. */
  bottomRoom: number;
  logoSize: number;
  /** The warm glow top-right. It fades out over 300 ms once the shop is known to be idle. */
  glow: boolean;
  /** The takings line, or the slim 'ภาพรวม' row, or nothing. */
  children?: ReactNode;
};

export function StageBand({ shop, bleed, contentMaxWidth, topInset, bottomRoom, logoSize, glow, children }: StageBandProps) {
  return (
    <View style={{ marginHorizontal: -bleed }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: -OVERSCROLL_CAP, left: 0, right: 0, height: OVERSCROLL_CAP, backgroundColor: STAGE_DARK }}
      />
      {/* No shadow on the band, so clipping its layers to the rounded foot is safe. */}
      <View
        style={{
          overflow: 'hidden',
          borderBottomLeftRadius: STAGE_RADIUS,
          borderBottomRightRadius: STAGE_RADIUS,
          borderCurve: 'continuous',
          backgroundColor: STAGE_DARK,
        }}
      >
        <LinearGradient
          colors={[STAGE_DARK, STAGE_LIGHT]}
          end={ANGLE_END}
          locations={[0, 0.75]}
          pointerEvents="none"
          start={ANGLE_START}
          style={StyleSheet.absoluteFill}
        />
        {shop.coverUrl ? <StageCover key={shop.coverUrl} uri={shop.coverUrl} /> : null}
        <StageGlow on={glow} />
        <View style={{ alignItems: 'center', paddingTop: topInset + 10, paddingBottom: bottomRoom, paddingHorizontal: bleed }}>
          <View style={{ width: '100%', maxWidth: contentMaxWidth, gap: 12 }}>
            <StageIdentity logoSize={logoSize} shop={shop} />
            {children}
          </View>
        </View>
      </View>
    </View>
  );
}

/** The shop's cover photo is the band when there is one, under a warm scrim; both fade in once it has loaded. */
function StageCover({ uri }: { uri: string }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = useState(false);

  if (failed) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Image
        accessibilityIgnoresInvertColors
        onError={() => setFailed(true)}
        onLoad={() => {
          if (reduced) {
            opacity.setValue(1);
            return;
          }
          Animated.timing(opacity, { toValue: 1, duration: COVER_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER }).start();
        }}
        resizeMode="cover"
        source={{ uri }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient colors={COVER_SCRIM} end={ANGLE_END} start={ANGLE_START} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** A soft radial light top-right. Not a loop: it only fades when the shop turns idle or busy. */
function StageGlow({ on }: { on: boolean }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(on ? 1 : 0)).current;
  // An svg id may not carry the colons React puts in useId().
  const gradientId = `stageGlow${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  useEffect(() => {
    opacity.stopAnimation();
    if (reduced) {
      opacity.setValue(on ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(opacity, { toValue: on ? 1 : 0, duration: GLOW_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [on, opacity, reduced]);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Svg height="100%" width="100%">
        <Defs>
          <RadialGradient cx="85%" cy="10%" id={gradientId} r="60%">
            <Stop offset="0" stopColor={GLOW} stopOpacity={0.35} />
            <Stop offset="1" stopColor={GLOW} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect fill={`url(#${gradientId})`} height="100%" width="100%" x="0" y="0" />
      </Svg>
    </Animated.View>
  );
}

// ---------------------------------------------------------------- identity

/**
 * The logo on a white tile, or the shop's monogram in brand orange. The shadow
 * sits on the tile, which never clips; the image rounds its own corners.
 */
function ShopLogo({ shop, size }: { shop: HubShop; size: number }) {
  const [failed, setFailed] = useState(false);
  const corner = Math.round(size * 0.31);
  const logo = shop.logoUrl && !failed ? shop.logoUrl : null;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: corner,
        borderCurve: 'continuous',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.surface,
        boxShadow: LOGO_SHADOW,
      }}
    >
      {logo ? (
        <Image
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
          resizeMode="cover"
          source={{ uri: logo }}
          style={{ width: size, height: size, borderRadius: corner }}
        />
      ) : (
        <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: palette.primary }}>{shop.mark}</Text>
      )}
    </View>
  );
}

function RoleCapsule({ role }: { role: string }) {
  return (
    <GlassPanel
      fallback={CAPSULE_TINT}
      fallbackBorder={CAPSULE_EDGE}
      interactive={false}
      radius={12}
      // minHeight: a large OS text size grows the capsule instead of clipping its word.
      style={{ flexShrink: 1, minWidth: 0, minHeight: 24, paddingVertical: 2, paddingHorizontal: 9, justifyContent: 'center' }}
      tint={CAPSULE_TINT}
    >
      <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 17, fontWeight: '600', color: ON_STAGE }}>{role}</Text>
    </GlassPanel>
  );
}

function SwitchCapsule({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      // Real glass answers a press itself; the flat stand-in needs the dip.
      style={({ pressed }) => ({ opacity: pressed ? (LIQUID_GLASS ? 0.9 : 0.72) : 1 })}
    >
      <GlassPanel
        fallback={CAPSULE_TINT}
        fallbackBorder={CAPSULE_EDGE}
        radius={17}
        style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 12 }}
        tint={SWITCH_GLASS_TINT}
      >
        <AppIcon color={ON_STAGE} name="swap-horizontal" size={16} />
        <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 19, fontWeight: '600', color: ON_STAGE }}>{label}</Text>
      </GlassPanel>
    </Pressable>
  );
}

/**
 * The shop's name: the only 20 on the page, at the ceiling's own weight. A
 * name too long for its column shrinks to 80% and then ellipsizes. iOS does
 * that itself; Android's adjustsFontSizeToFit has no floor (minimumFontScale
 * is iOS-only, and a long name came out near 9 pt), so there a hidden copy
 * measures the name at full size and fittedNameSize picks the size.
 */
function ShopName({ name }: { name: string }) {
  const [natural, setNatural] = useState(0);
  const [available, setAvailable] = useState(0);
  const heroSize = typeScale.hero.fontSize ?? 20;

  if (Platform.OS === 'ios') {
    return (
      <Text
        accessibilityRole="header"
        adjustsFontSizeToFit
        minimumFontScale={NAME_MIN_SCALE}
        numberOfLines={1}
        style={[typeScale.hero, { color: ON_STAGE }]}
      >
        {name}
      </Text>
    );
  }
  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        setAvailable((current) => (Math.abs(current - next) < 0.5 ? current : next));
      }}
    >
      <Text accessibilityRole="header" numberOfLines={1} style={[typeScale.hero, { color: ON_STAGE, fontSize: fittedNameSize(natural, available, heroSize) }]}>
        {name}
      </Text>
      {/* Laid out wide enough never to wrap, so its first line is the name's full width. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, width: NAME_MEASURE_ROOM, opacity: 0 }}
      >
        <Text
          numberOfLines={1}
          onTextLayout={(event) => {
            const next = event.nativeEvent.lines[0]?.width ?? 0;
            setNatural((current) => (Math.abs(current - next) < 0.5 ? current : next));
          }}
          style={typeScale.hero}
        >
          {name}
        </Text>
      </View>
    </View>
  );
}

/** Logo, name, then branch and role on one line, and 'สลับร้าน' when there is another shop to go to. */
function StageIdentity({ shop, logoSize }: { shop: HubShop; logoSize: number }) {
  const { copy } = useDisplayPreferences();
  return (
    <View style={{ minHeight: Math.max(52, logoSize), flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <ShopLogo key={shop.logoUrl ?? 'mark'} shop={shop} size={logoSize} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <ShopName name={shop.name} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '500', color: ON_STAGE_SOFT }}>
            {shop.branch}
          </Text>
          {shop.role ? <RoleCapsule role={shop.role} /> : null}
        </View>
      </View>
      {shop.canSwitch ? <SwitchCapsule label={copy('สลับร้าน', 'Switch')} onPress={shop.onSwitch} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- takings

/**
 * 'ยอดวันนี้' and the amount on the left, the day's curve ending at now on the
 * right; the whole line opens /home. The now-dot breathes while the shop is
 * busy. Bones while the first value is on its way, the retry pill in the
 * amount's place after a failed first load.
 */
export function StageTakings({
  item,
  slot,
  pulse,
  onOpen,
}: {
  item: HubNavItem;
  slot: HubSlot<HubTakings>;
  pulse: boolean;
  onOpen: (item: HubNavItem) => void;
}) {
  const { copy, language } = useDisplayPreferences();
  const label = copy('ยอดวันนี้', "Today's takings");
  const takings = slot.status === 'ready' ? slot.value : null;
  const amount = takings ? money(takings.amount, language) : null;
  const failed = slot.status === 'error';
  const retryLabel = copy('ลองอีกครั้ง', 'Try again');

  return (
    <Pressable
      accessibilityActions={failed ? [{ name: 'retry', label: retryLabel }] : undefined}
      accessibilityLabel={amount ? `${label}, ${amount}` : label}
      accessibilityRole="button"
      onAccessibilityAction={failed ? (event) => {
        if (event.nativeEvent.actionName === 'retry') slot.retry();
      } : undefined}
      onPress={() => onOpen(item)}
      style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, opacity: pressed ? 0.8 : 1 })}
    >
      <View style={{ minWidth: 104, maxWidth: '50%' }}>
        <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 17, fontWeight: '600', color: ON_STAGE_SOFT }}>{label}</Text>
        {amount ? (
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={1}
            style={{ fontSize: 18, lineHeight: 26, fontWeight: '600', color: ON_STAGE, fontVariant: ['tabular-nums'] }}
          >
            {amount}
          </Text>
        ) : failed ? (
          <RetryPill onPress={slot.retry} style={{ marginTop: 2 }} />
        ) : (
          // Hidden: the line's own label already names it, and a progressbar
          // nested in the button would be a second stop saying the same.
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: scaleFont(26), justifyContent: 'center' }}>
            <SkeletonReveal label={label}>
              <Bone height={16} onColor radius={6} width={96} />
            </SkeletonReveal>
          </View>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {takings ? (
          <DayCurve nowLabel={takings.nowLabel} pulse={pulse} startLabel={takings.startLabel} values={takings.curve?.cumulative} />
        ) : slot.status === 'loading' ? (
          // The curve's own 44, and the axis labels' 16 line (as AppText scales it) under it.
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 44 + scaleFont(16), justifyContent: 'flex-start' }}>
            <SkeletonReveal label={label}>
              <Bone height={44} onColor radius={10} />
            </SkeletonReveal>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** For a member who may open /home but not see the takings: the same slot, one slim white row. */
export function StageHomeRow({ item, onOpen }: { item: HubNavItem; onOpen: (item: HubNavItem) => void }) {
  return (
    <Pressable
      accessibilityLabel={item.title}
      accessibilityRole="button"
      onPress={() => onOpen(item)}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.8 : 1 })}
    >
      <AppIcon color={ON_STAGE} name={item.icon} size={20} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500', color: ON_STAGE }}>{item.title}</Text>
      <AppIcon color={ON_STAGE_SOFT} name="chevron-forward" size={18} />
    </Pressable>
  );
}
