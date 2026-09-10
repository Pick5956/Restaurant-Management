import MaskedView from '@react-native-masked-view/masked-view';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { requireNativeViewManager } from 'expo-modules-core';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';

import { ai } from './theme';

// Small chrome shared by the assistant screen: the round buttons in the top
// row, their gradient badge, and the bottom sheet the insights and the chat
// list slide up in.
//
// On iOS 26 the buttons are real Liquid Glass, the system material Apple's own
// apps use — it refracts and reacts to what scrolls under it. Everywhere else
// (older iOS, every Android) the same button falls back to the frosted white
// circle the web page uses, which is why this is one component and not two:
// the screen never asks which platform it is on.
export const LIQUID_GLASS = isLiquidGlassAvailable();

/**
 * A panel in the same material as the buttons: real glass on iOS 26, the
 * frosted white surface everywhere else. `style` is the shape both share;
 * `fallbackStyle` is the border and fill only the non-glass version needs.
 */
export function GlassSurface({
  style,
  fallbackStyle,
  children,
  effect = 'regular',
}: {
  style: StyleProp<ViewStyle>;
  fallbackStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** "clear" blurs what is behind without frosting it pale. */
  effect?: 'regular' | 'clear';
}) {
  if (LIQUID_GLASS) {
    return (
      <GlassView glassEffectStyle={effect} colorScheme="light" style={style}>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, fallbackStyle]}>{children}</View>;
}

export function GlassButton({
  icon,
  label,
  onPress,
  badge,
  dot,
  active,
  size = 46,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  badge?: number;
  /** A small unread mark, when a count would be noise. */
  dot?: boolean;
  active?: boolean;
  size?: number;
}) {
  const icon_ = <AppIcon name={icon} size={size * 0.46} color={active ? ai.deep : ai.ink} />;
  // The shadow is here from the first frame, and it is round from the first
  // frame, because the glass is told its corner radius through props rather
  // than through `style` — see GlassPanel below. iOS builds a shadow from the
  // shape the layer really has: with the radius only in style the glass stayed
  // square for as long as it took the material to appear, which is why this
  // button used to hold its shadow back for a second and then land it late.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} ${badge}` : label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        transform: [{ translateY: pressed ? -1 : 0 }],
        opacity: pressed && LIQUID_GLASS ? 0.85 : 1,
        // Whatever is behind the header is blurred, so the button needs its own
        // edge to read as an object rather than part of the haze.
        shadowColor: '#3d2b1f',
        shadowOpacity: 0.24,
        shadowRadius: 9,
        shadowOffset: { width: 0, height: 3 },
      })}
    >
      {LIQUID_GLASS ? (
        <GlassPanel
          radius={size / 2}
          // A fixed lift, never a state colour: changing this at runtime leaves the
          // native view wearing the old one.
          tint="rgba(255,255,255,0.42)"
          fallback="transparent"
          style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
        >
          {icon_}
        </GlassPanel>
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1,
            borderColor: active ? '#fdba74' : ai.hairline,
            backgroundColor: 'rgba(255,255,255,0.85)',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: 1,
          }}
        >
          {icon_}
        </View>
      )}
      {dot && !badge ? (
        <View
          style={{
            position: 'absolute',
            top: 1,
            right: 1,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: ai.orange,
            borderWidth: 2,
            borderColor: ai.canvas,
          }}
        />
      ) : null}
      {badge ? (
        <LinearGradient
          colors={[ai.orange, ai.amber]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: 'absolute',
            top: -4,
            right: -4,
            height: 16,
            minWidth: 16,
            paddingHorizontal: 4,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: ai.canvas,
          }}
        >
          <Text style={{ fontSize: 9, lineHeight: 12, fontWeight: '700', color: '#ffffff' }}>{badge > 9 ? '9+' : badge}</Text>
        </LinearGradient>
      ) : null}
    </Pressable>
  );
}


export type GlassMenuItem = {
  key: string;
  icon: AppIconName;
  label: string;
  detail?: string;
  /** An unread mark on the row, matching the one on the button that opened it. */
  dot?: boolean;
  onPress: () => void;
};

/**
 * The menu a button opens: it springs out of the corner it was summoned from
 * and settles, the way iOS 26 menus do. Rendered inline rather than in a modal
 * so it shares the screen's own glass and never flashes a second window.
 */
export function GlassMenu({
  open,
  onClose,
  items,
  from,
  style,
}: {
  open: boolean;
  onClose: () => void;
  items: GlassMenuItem[];
  /** Which corner it grows out of. */
  from: 'top-right' | 'bottom-left';
  style?: StyleProp<ViewStyle>;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    const animation = open
      ? Animated.spring(progress, {
          toValue: 1,
          useNativeDriver: true,
          damping: reducedMotion ? 40 : 13,
          stiffness: reducedMotion ? 400 : 190,
          mass: 0.85,
        })
      : Animated.timing(progress, {
          toValue: 0,
          duration: reducedMotion ? 0 : 150,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        });
    animation.start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, progress, reducedMotion]);

  if (!mounted) return null;

  const grow = from === 'top-right' ? 1 : -1;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.04, 1] });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="ปิดเมนู"
        onPress={onClose}
        style={{ position: 'absolute', top: -1000, right: -1000, bottom: -1000, left: -1000, zIndex: 8 }}
      />
      <Animated.View
        style={[
          {
            position: 'absolute',
            zIndex: 9,
            // Grows out of the button's own corner, not out of its middle.
            transformOrigin: from === 'top-right' ? 'top right' : 'bottom left',
            transform: [{ scale }],
          },
          style,
        ]}
      >
        <GlassSurface
          style={{ borderRadius: 22, paddingVertical: 6, minWidth: 232, overflow: 'hidden' }}
          fallbackStyle={{
            backgroundColor: 'rgba(255,255,255,0.97)',
            borderWidth: 1,
            borderColor: ai.hairline,
            shadowColor: '#000',
            shadowOpacity: 0.16,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 8 },
            elevation: 12,
          }}
        >
          {items.map((item, index) => {
            const at = Math.min(0.08 * index, 0.32);
            const rowIn = progress.interpolate({ inputRange: [at, Math.min(at + 0.42, 1), 1], outputRange: [0, 1, 1] });
            return (
            <Animated.View key={item.key} style={{ opacity: rowIn, transform: [{ translateY: rowIn.interpolate({ inputRange: [0, 1], outputRange: [grow * -12, 0] }) }] }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => { onClose(); item.onPress(); }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                minHeight: 48,
                paddingHorizontal: 16,
                backgroundColor: pressed ? 'rgba(249,115,22,0.12)' : 'transparent',
              })}
            >
              <AppIcon name={item.icon} size={20} color={ai.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, color: ai.ink }}>{item.label}</Text>
                {item.detail ? <Text style={{ fontSize: 12, color: ai.faded }}>{item.detail}</Text> : null}
              </View>
              {item.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ai.orange }} /> : null}
            </Pressable>
            </Animated.View>
            );
          })}
        </GlassSurface>
      </Animated.View>
    </>
  );
}

// The native glass view itself, with its corner radii driven by Animated.
//
// Two things had to be true for the shape to change on screen, and neither was
// in the first attempt. The glass's outline — the refracted rim that tells the
// eye what shape it is — is set by the native module from *props* named
// borderTopLeftRadius and so on (see Prop("borderTopLeftRadius") in
// GlassEffectModule.swift), not from `style`. Radii in style only rounded the
// React Native view around it; the glass underneath kept whatever corners it
// had, so the outline never moved and the drop never appeared. And the
// exported GlassView is a function component, which Animated can only drive
// by re-rendering; the host view underneath takes setNativeProps, so the
// corners can be pushed every frame without React in the loop.
const NativeGlassView = (() => {
  if (!LIQUID_GLASS) return GlassView;
  try {
    return requireNativeViewManager('ExpoGlassEffect', 'GlassView');
  } catch {
    return GlassView;
  }
})();
const AnimatedGlassView = Animated.createAnimatedComponent(NativeGlassView);
// The host view takes more props than the exported wrapper's types admit —
// borderCurve and the four radii among them. Animated's wrapper loosens them on
// its own; a plain render needs this.
const RawGlassView = NativeGlassView as ComponentType<Record<string, unknown>>;


/**
 * A pane of glass whose corners the glass itself keeps.
 *
 * `GlassLayer` in ui.tsx rounds only the React Native view around the material.
 * The material's own rim — the refracted outline the eye reads as the shape —
 * comes from props (see NativeGlassView above), so with a radius in `style`
 * alone that rim stays square and its corners sit outside the rounded view: a
 * pale arc at each corner, on every card in a list, which is exactly what the
 * inventory rows showed.
 *
 * The radius goes on both, therefore: as props for the glass, in the style for
 * the view and whatever it clips.
 */
export function GlassPanel({
  radius,
  style,
  tint = 'rgba(255,255,255,0.42)',
  fallback,
  fallbackBorder,
  interactive = true,
  children,
}: {
  /** One radius for all four corners — a card, a capsule, a round button. */
  radius: number;
  style?: ViewStyle;
  /** What the glass is tinted with on iOS 26. */
  tint?: string;
  /** The opaque stand-in painted everywhere else. */
  fallback: string;
  /** The stand-in's edge, since it has no material to separate it. */
  fallbackBorder?: string;
  interactive?: boolean;
  children?: ReactNode;
}) {
  const shape: ViewStyle = { ...style, borderRadius: radius };
  if (!LIQUID_GLASS) {
    return (
      <View style={[shape, fallbackBorder ? { borderWidth: 1, borderColor: fallbackBorder } : null, { backgroundColor: fallback }]}>
        {children}
      </View>
    );
  }
  return (
    <RawGlassView
      glassEffectStyle="regular"
      isInteractive={interactive}
      // These surfaces are light-only; the glass must not follow a dark system theme.
      colorScheme="light"
      tintColor={tint}
      borderCurve="continuous"
      borderTopLeftRadius={radius}
      borderTopRightRadius={radius}
      borderBottomLeftRadius={radius}
      borderBottomRightRadius={radius}
      style={[shape, { overflow: 'hidden' }]}
    >
      {children}
    </RawGlassView>
  );
}

/**
 * The "…" button that becomes the menu.
 *
 * Built from a frame-by-frame read of the Claude app's version (screen
 * recording, 40 fps), which does four things in about half a second:
 *
 *   0.00  the button gives — shrinks to ~85% — and its dots blur away
 *   0.10  it is a drop now, hanging down and to the left of where the button
 *         was, roundest at its bottom-left; there is no button any more
 *   0.20  the drop fills out into a rounded panel, and the menu's text shows
 *         through it blurred and stretched to the panel's shape
 *   0.30  the text sharpens, overshoots tall for a frame, and settles
 *
 * Closing runs the same film backwards: text blurs first, the panel gathers
 * into a drop hanging from the corner, the drop is a circle, the dots return.
 *
 * So there is one piece of glass here, not a button and a panel. At rest it is
 * a 46px circle with three dots in it; open, it is the menu. Its real frame is
 * what animates — width, height, and each corner on its own — because the drop
 * is a shape, not a scaled rectangle: its bottom-left corner rounds far more
 * than its top-right while it hangs. Layout cannot go through the native
 * driver, so this runs on the JS driver; it is one view and it is fine.
 *
 * The text is laid out once at the menu's full size and *scaled* to whatever
 * the frame currently is, from the top-right corner, so it stretches with the
 * glass instead of being clipped by it — that stretch, and the spring carrying
 * the scale a little past 1 before it settles, is the "tall for a frame". The
 * blur is two copies of the same rows, one drawn through a blur filter, cross-
 * fading: the blurred one is what you see mid-morph, the sharp one what you
 * read at the end.
 *
 * Everywhere without Liquid Glass this is the ordinary button and the ordinary
 * menu, at the same spot, so the screen does not care which it got.
 */
export function GlassMorphMenu({
  open,
  onOpen,
  onClose,
  items,
  icon,
  label,
  dot,
  style,
  width = 232,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  items: GlassMenuItem[];
  icon: AppIconName;
  label: string;
  /** An unread mark on the closed button. */
  dot?: boolean;
  /** Where the button's top-right corner sits; the menu opens down and to the left of it. */
  style?: StyleProp<ViewStyle>;
  width?: number;
}) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  // The backdrop that closes on an outside tap stays for the closing animation.
  const [engaged, setEngaged] = useState(open);
  // The list's natural height, measured once it has laid out at full width.
  const [contentHeight, setContentHeight] = useState(0);
  const size = 46;

  useEffect(() => {
    if (open) setEngaged(true);
    // A timed clock, not a spring. The swell and the wobble are written into
    // the shape curves below, where they can be read and tuned; a spring on top
    // of them added a second, unrelated bounce and rushed the drop phase past
    // in five frames. The first version ran in 0.3s and read as a jump from
    // circle to box — the drop needs time on screen to be seen at all.
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: reducedMotion ? 0 : open ? 780 : 560,
      // Fast out of the button, long settle. Closing is gentler both ends.
      easing: open ? Easing.bezier(0.22, 0.8, 0.24, 1) : Easing.bezier(0.4, 0, 0.6, 1),
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (finished && !open) setEngaged(false);
    });
  }, [open, progress, reducedMotion]);

  if (!LIQUID_GLASS) {
    return (
      <View pointerEvents="box-none" style={[{ position: 'absolute', zIndex: 9 }, style]}>
        <GlassButton icon={icon} label={label} dot={dot} onPress={onOpen} />
        <GlassMenu open={open} onClose={onClose} items={items} from="top-right" style={{ top: 0, right: 0 }} />
      </View>
    );
  }

  // Before the first layout the estimate keeps the spring aimed somewhere
  // sensible; the measurement takes over the moment it lands.
  const targetHeight = contentHeight > 0 ? contentHeight : items.length * 48 + 12;
  // 'extend', not 'clamp', on everything that carries the shape: the spring's
  // overshoot past 1 is what makes the panel swell before it settles.
  const grow = { extrapolate: 'extend' as const };
  const clamp = { extrapolate: 'clamp' as const };
  // What makes it water and not a box getting bigger: nothing below moves in
  // step with anything else. The drop stretches *down* first — height is well
  // ahead of width until half-way — and only then bellies out sideways, past
  // its final width and back. Each corner swells and relaxes on its own beat,
  // so the outline is never the same rounded rectangle twice on the way there.
  const along = (stops: number[], values: number[]) =>
    progress.interpolate({ inputRange: stops, outputRange: values, ...grow });
  const span = (fraction: number, from: number, to: number) => from + (to - from) * fraction;
  // For the first 12% it is still the circle, giving under the finger; by
  // half-way it is tall and narrow — the drop; then it bellies out sideways,
  // past its final width, and settles back. Height overshoots too, less.
  //
  // Opening and closing are not the same film run backwards. Run in reverse,
  // that swell comes *first*, and the menu visibly puffed up before it shrank
  // — the hitch on close. Closing holds its size while the text blurs, then
  // gathers into the drop, with no swell anywhere.
  const panelHeight = open
    ? along(
        [0, 0.12, 0.5, 0.72, 0.86, 1],
        [size, size + 4, span(0.6, size, targetHeight), span(1.015, size, targetHeight), span(0.99, size, targetHeight), targetHeight],
      )
    : along(
        [0, 0.2, 0.55, 0.85, 1],
        [size, size + 6, span(0.55, size, targetHeight), targetHeight, targetHeight],
      );
  const panelWidth = open
    ? along(
        [0, 0.12, 0.5, 0.72, 0.86, 1],
        [size, size + 2, span(0.4, size, width), span(0.96, size, width), span(1.035, size, width), width],
      )
    : along(
        [0, 0.2, 0.55, 0.85, 1],
        [size, size + 3, span(0.38, size, width), width, width],
      );
  const corner = (stops: number[], values: number[]) =>
    progress.interpolate({ inputRange: stops, outputRange: values, ...clamp });
  // Each corner's radius is a share of the panel's width *at that moment*, not
  // a number of pixels. Fixed pixels were the reason the drop never showed:
  // at a hundred wide, radii of 46 and 16 leave a forty-pixel straight run
  // along the top, and a shape with straight runs is a box. When two corners
  // together take the whole edge, that edge is one curve — and with the belly
  // pair asked for more than the edge, UIKit rounds it off entirely.
  //
  // Half the width is a circle, so that is where every corner starts; the
  // final 22px is 22/width of the finished panel, so that is where they end.
  // In between the top-right stays tight — the drop hangs from it — and the
  // bottom-left is the belly.
  const rest = 0.5;
  const done = 22 / width;
  const share = (stops: number[], values: number[]) => Animated.multiply(panelWidth, corner(stops, values));
  const cornerTR = share([0, 0.35, 0.7, 1], [rest, 0.26, 0.18, done]);
  const cornerTL = share([0, 0.35, 0.7, 1], [rest, 0.64, 0.34, done]);
  const cornerBR = share([0, 0.4, 0.75, 1], [rest, 0.5, 0.3, done]);
  const cornerBL = share([0, 0.3, 0.55, 0.8, 1], [rest, 0.58, 0.62, 0.28, done]);
  // The give at the start; the sag as it leaves the button, with a small lift
  // past its mark at the end; a lean to the left as it falls; and a degree or
  // so of wobble either way, which is the last thing separating a drop from a
  // shape being resized.
  const squish = corner([0, 0.12, 0.42, 1], [1, 0.86, 1.02, 1]);
  const sag = open
    ? corner([0, 0.12, 0.45, 0.75, 0.9, 1], [0, 3, 14, 4, -2, 0])
    : corner([0, 0.12, 0.45, 0.8, 1], [0, 3, 14, 2, 0]);
  const lean = corner([0, 0.2, 0.5, 0.8, 1], [0, -2, -7, -1, 0]);
  const wobble = progress.interpolate({
    inputRange: [0, 0.2, 0.5, 0.78, 1],
    outputRange: ['0deg', '-1.6deg', '1.2deg', '-0.5deg', '0deg'],
    ...clamp,
  });
  // Matched geometry: the rows are laid out at full size and scaled to the
  // frame, from the same corner the frame grows from.
  // Derived from the frame itself, not from the clock: the first version gave
  // the text its own curve, and when the frame swelled past its width the text
  // did not, so the two bounced out of step and the menu looked like a picture
  // sliding around inside a window. Divided by the frame, they cannot differ.
  const contentScaleX = Animated.divide(panelWidth, width);
  const contentScaleY = Animated.divide(panelHeight, targetHeight);
  // Closing blurs the text first, while the frame still holds its size.
  // Closing, read from the end backwards: sharp text gives way to blurred
  // text at once, the blurred text is gone by the half-way mark, and the
  // drop hangs empty for the rest of the way down — the reference never
  // shows shrinking text inside a small drop, and ours lingering there was
  // what made the close feel slow. The dots come back while it is still a drop.
  const sharpIn = open
    ? progress.interpolate({ inputRange: [0, 0.5, 0.88], outputRange: [0, 0, 1], ...clamp })
    : progress.interpolate({ inputRange: [0, 0.86, 0.97], outputRange: [0, 0, 1], ...clamp });
  const blurredIn = open
    ? progress.interpolate({ inputRange: [0, 0.18, 0.55, 0.92], outputRange: [0, 0.6, 1, 0], ...clamp })
    : progress.interpolate({ inputRange: [0, 0.5, 0.64, 0.88, 1], outputRange: [0, 0, 1, 1, 0], ...clamp });
  const dotsOut = progress.interpolate({ inputRange: [0, open ? 0.2 : 0.4], outputRange: [1, 0], ...clamp });

  const rows = (live: boolean) => (
    <View
      onLayout={live ? (event) => setContentHeight(Math.round(event.nativeEvent.layout.height)) : undefined}
      style={{ paddingVertical: 6 }}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          disabled={!live || !open}
          onPress={() => { onClose(); item.onPress(); }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 48,
            paddingHorizontal: 16,
            backgroundColor: pressed ? 'rgba(249,115,22,0.12)' : 'transparent',
          })}
        >
          <AppIcon name={item.icon} size={20} color={ai.muted} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, color: ai.ink }}>{item.label}</Text>
            {item.detail ? <Text style={{ fontSize: 12, color: ai.faded }}>{item.detail}</Text> : null}
          </View>
          {item.dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ai.orange }} /> : null}
        </Pressable>
      ))}
    </View>
  );

  // Both copies sit at the top-right of the glass at the menu's full width and
  // are scaled from that corner to the frame, so they stretch with the shape.
  const sheet = { position: 'absolute' as const, top: 0, right: 0, width, transformOrigin: 'top right' };

  return (
    <View pointerEvents="box-none" style={[{ position: 'absolute', zIndex: 9, width, height: Math.max(size, targetHeight) }, style]}>
      {engaged ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onClose}
          style={{ position: 'absolute', top: -1000, right: -1000, bottom: -1000, left: -1000, zIndex: 8 }}
        />
      ) : null}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: panelWidth,
          height: panelHeight,
          zIndex: 9,
          transformOrigin: 'top right',
          transform: [{ translateY: sag }, { translateX: lean }, { rotate: wobble }, { scale: squish }],
          // On the wrapper, not the glass: the glass clips its content, and a
          // shadow on a clipping view is clipped away with it.
          shadowColor: '#3d2b1f',
          shadowOpacity: 0.22,
          shadowRadius: 9,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        {/* Closed, the whole circle is the button. Open, this is disabled and
            the rows inside take the taps; the backdrop takes the rest. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          disabled={open}
          hitSlop={open ? 0 : 8}
          onPress={onOpen}
          style={{ flex: 1 }}
        >
          <AnimatedGlassView
            glassEffectStyle="regular"
            isInteractive
            colorScheme="light"
            // A fixed lift, never a state colour: changing this at runtime leaves
            // the native view wearing the old one.
            tintColor="rgba(255,255,255,0.42)"
            // Props, not style: see NativeGlassView above. "continuous" is
            // Apple's own corner curve, the difference between a blob and a box.
            borderCurve="continuous"
            borderTopLeftRadius={cornerTL}
            borderTopRightRadius={cornerTR}
            borderBottomLeftRadius={cornerBL}
            borderBottomRightRadius={cornerBR}
            style={{ flex: 1, overflow: 'hidden' }}
          >
            {/* The rows as read: sharp, live, measured. */}
            <Animated.View
              pointerEvents={open ? 'auto' : 'none'}
              style={[sheet, { opacity: sharpIn, transform: [{ scaleX: contentScaleX }, { scaleY: contentScaleY }] }]}
            >
              {rows(true)}
            </Animated.View>
            {/* The rows as seen through the drop: the same thing under a blur,
                shown while the shape is still moving. */}
            <Animated.View
              pointerEvents="none"
              style={[sheet, { opacity: blurredIn, transform: [{ scaleX: contentScaleX }, { scaleY: contentScaleY }], filter: [{ blur: 9 }] }]}
            >
              {rows(false)}
            </Animated.View>
            {/* The dots, in the circle the glass rests in. */}
            <Animated.View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, right: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: dotsOut }}
            >
              <AppIcon name={icon} size={size * 0.46} color={ai.ink} />
              {dot ? (
                <View style={{ position: 'absolute', top: 5, right: 5, width: 9, height: 9, borderRadius: 5, backgroundColor: ai.orange, borderWidth: 1.5, borderColor: '#fff' }} />
              ) : null}
            </Animated.View>
          </AnimatedGlassView>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// How far a row slides to show its trash button, and the button itself.
const SWIPE_REVEAL = 76;

/**
 * A list row that slides left to uncover a delete button, the way rows do in
 * Mail. The row itself is the moving part; the button sits still underneath
 * and is revealed, growing from small to full as the row clears it.
 *
 * PanResponder rather than a gesture library: the sheet's own drag already
 * works this way, and the list lives inside a Modal, where gesture-handler
 * needs its own root view to hear anything. Only a clearly sideways move takes
 * the touch, so the list still scrolls; a tap on a row that is already open
 * closes it rather than opening the chat underneath — the same rule Mail uses.
 *
 * One row open at a time: opening one asks the parent to close the last.
 */
export function SwipeRow({
  id,
  background,
  onDelete,
  deleteLabel,
  onWillOpen,
  children,
}: {
  id: string;
  /** The list's colour, so the row hides the button while it is closed. */
  background: string;
  onDelete: () => void;
  deleteLabel: string;
  /** Called as this row starts to open, with the way to close it. */
  onWillOpen: (id: string, close: () => void) => void;
  children: React.ReactNode;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const startRef = useRef(0);

  const settle = (to: number) => {
    openRef.current = to !== 0;
    Animated.spring(x, { toValue: to, useNativeDriver: false, damping: 22, stiffness: 280, mass: 0.8 }).start();
  };
  const close = () => settle(0);

  const pan = useRef(
    PanResponder.create({
      // An open row claims the tap so it closes instead of opening the chat.
      onStartShouldSetPanResponder: () => openRef.current,
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4,
      onPanResponderGrant: () => {
        startRef.current = openRef.current ? -SWIPE_REVEAL : 0;
        if (!openRef.current) onWillOpen(id, close);
      },
      onPanResponderMove: (_event, gesture) => {
        let next = Math.min(0, startRef.current + gesture.dx);
        // Past the button the row still follows the finger, but at a third of
        // the pace, so it feels held rather than stopped.
        if (next < -SWIPE_REVEAL) next = -SWIPE_REVEAL + (next + SWIPE_REVEAL) / 3;
        x.setValue(next);
      },
      onPanResponderRelease: (_event, gesture) => {
        const tapped = Math.abs(gesture.dx) < 4 && Math.abs(gesture.dy) < 4;
        if (tapped) {
          settle(0);
          return;
        }
        const at = startRef.current + gesture.dx;
        const open = gesture.vx < -0.3 || (gesture.vx <= 0.3 && at < -SWIPE_REVEAL / 2);
        settle(open ? -SWIPE_REVEAL : 0);
      },
      onPanResponderTerminate: () => settle(openRef.current ? -SWIPE_REVEAL : 0),
    }),
  ).current;

  // The button comes up out of the gap as the row uncovers it.
  const buttonScale = x.interpolate({ inputRange: [-SWIPE_REVEAL, -SWIPE_REVEAL / 2, 0], outputRange: [1, 0.72, 0.4], extrapolate: 'clamp' });
  const buttonOpacity = x.interpolate({ inputRange: [-SWIPE_REVEAL, -SWIPE_REVEAL / 3, 0], outputRange: [1, 0.9, 0], extrapolate: 'clamp' });

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: SWIPE_REVEAL,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: buttonOpacity,
          transform: [{ scale: buttonScale }],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
          onPress={() => { close(); onDelete(); }}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: pressed ? '#b91c1c' : '#dc2626',
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <AppIcon name="trash-outline" size={21} color="#ffffff" />
        </Pressable>
      </Animated.View>
      <Animated.View {...pan.panHandlers} style={{ backgroundColor: background, transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}


/**
 * The blurred band a floating header sits on — the chat screen's, shared.
 *
 * A blurred copy of whatever scrolls past, masked solid from the top of the
 * screen down to `solidTo` below the safe area (the bottom of the header's
 * controls), then faded to nothing over `fade`. No panel and no tint: the fade
 * is the only edge. The ramp is placed against the pane's real height, so it
 * starts at the controls on every phone whatever its status bar measures.
 *
 * Content must start below `top + solidTo + fade`; anything inside the band is
 * still being blurred.
 */
export function GlassHeaderPane({ top, solidTo, fade }: { top: number; solidTo: number; fade: number }) {
  const pane = top + solidTo + fade;
  const solid = (top + solidTo) / pane;
  const at = (through: number) => solid + (1 - solid) * through;
  return (
    <MaskedView
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: pane, zIndex: 2 }}
      maskElement={
        <LinearGradient
          colors={['#000000', '#000000', 'rgba(0,0,0,0.72)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0)']}
          locations={[0, solid, at(0.3), at(0.55), at(0.75), at(0.9), 1]}
          style={{ flex: 1 }}
        />
      }
    >
      <GlassSurface effect="regular" style={{ flex: 1 }} fallbackStyle={{ backgroundColor: 'rgba(255,247,237,0.92)' }}>
        <View />
      </GlassSurface>
    </MaskedView>
  );
}

/** The same material as a capsule, for the suggested-question chips. */
export function GlassPill({
  label,
  onPress,
  stretch,
}: {
  label: string;
  onPress: () => void;
  /** Fill the cell it sits in, so a set of them lines up as a grid. */
  stretch?: boolean;
}) {
  const text = (
    <Text style={{ fontSize: 13.5, fontWeight: '500', color: ai.body, textAlign: 'center' }}>{label}</Text>
  );
  const box = {
    minHeight: 44,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  };
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1, width: stretch ? '100%' : undefined })}
    >
      {LIQUID_GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" style={box}>
          {text}
        </GlassView>
      ) : (
        <View style={{ ...box, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: 'rgba(255,255,255,0.7)' }}>{text}</View>
      )}
    </Pressable>
  );
}

/**
 * A sheet that slides up from the bottom over a scrim. `height` is a fraction
 * of the window ("half" for the insights, 1 for the chat list and settings).
 */
export function BottomSheet({
  open,
  onClose,
  heightFraction = 0.62,
  children,
  label,
  showClose,
  background,
}: {
  open: boolean;
  onClose: () => void;
  /** How much of the screen it covers when it first opens. */
  heightFraction?: number;
  children: ReactNode;
  label: string;
  /** A glass close button in the top-right corner. */
  showClose?: boolean;
  /** The sheet's own colour, so the safe area at the top matches its content. */
  background?: string;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const full = heightFraction >= 1;

  // A part-height sheet is built at its tallest and held down by an offset, so
  // dragging it up costs nothing to lay out: pull it open, pull it back to where
  // it started, or keep pulling to put it away.
  const tallHeight = full ? windowHeight : Math.round(windowHeight * 0.94);
  const restingHeight = full ? windowHeight : Math.round(windowHeight * heightFraction);
  const restingOffset = tallHeight - restingHeight;
  const snap = useRef(new Animated.Value(restingOffset)).current;
  const expandedRef = useRef(false);

  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      drag.setValue(0);
      snap.setValue(restingOffset);
      expandedRef.current = false;
      setShown(true);
    }
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      // The owner asked for every panel to arrive more slowly; the first cut
      // (300/240) read as abrupt on the phone.
      duration: reducedMotion ? 0 : open ? 460 : 340,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && !open) {
        setShown(false);
        drag.setValue(0);
      }
    });
  }, [drag, open, progress, reducedMotion, restingOffset, snap]);

  // The responder is built once, so it reads the current handler through a ref.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const restingOffsetRef = useRef(restingOffset);
  restingOffsetRef.current = restingOffset;
  const tallHeightRef = useRef(tallHeight);
  tallHeightRef.current = tallHeight;

  // Only the strip along the top listens, so a list inside still scrolls.
  //
  // Where the sheet sits is the sum of two values: `snap`, the resting place,
  // and `drag`, how far the finger has taken it from there. On release the two
  // are folded into `snap` in one step before anything animates — zeroing the
  // drag first would throw the sheet back to its old resting place for a frame,
  // which is what made the movement look like it bounced twice.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 3 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        // Upward travel stops where the sheet is fully open; downward is free,
        // because past the bottom the gesture becomes a dismissal.
        const floor = expandedRef.current ? 0 : -restingOffsetRef.current;
        drag.setValue(Math.max(floor, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        const resting = restingOffsetRef.current;
        const floor = expandedRef.current ? 0 : -resting;
        const travelled = Math.max(floor, gesture.dy);
        // Hand the finger's position over to the resting value in one piece.
        snap.setValue((expandedRef.current ? 0 : resting) + travelled);
        drag.setValue(0);

        // A sheet glides to its place on a curve; a spring here reads as a wobble.
        const glide = (to: number, then?: () => void) => {
          Animated.timing(snap, {
            toValue: to,
            duration: 400,
            easing: Easing.bezier(0.2, 0.8, 0.2, 1),
            useNativeDriver: false,
          }).start(({ finished }) => { if (finished) then?.(); });
        };

        if (!expandedRef.current && (travelled < -60 || gesture.vy < -0.6)) {
          expandedRef.current = true;
          glide(0);
          return;
        }
        if (expandedRef.current && (travelled > 60 || gesture.vy > 0.6)) {
          expandedRef.current = false;
          glide(resting);
          return;
        }
        if (!expandedRef.current && (travelled > 90 || gesture.vy > 0.8)) {
          Animated.timing(snap, {
            toValue: tallHeightRef.current,
            duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
            // The close animation resets the offset once it is off screen; doing
            // it here would show the sheet again for a frame on its way out.
          }).start(() => onCloseRef.current());
          return;
        }
        glide(expandedRef.current ? 0 : resting);
      },
      onPanResponderTerminate: () => {
        drag.setValue(0);
        Animated.timing(snap, {
          toValue: expandedRef.current ? 0 : restingOffsetRef.current,
          duration: 220,
          easing: Easing.bezier(0.32, 0.72, 0, 1),
          useNativeDriver: false,
        }).start();
      },
    }),
  ).current;

  const translateY = Animated.add(
    Animated.add(progress.interpolate({ inputRange: [0, 1], outputRange: [tallHeight, 0] }), snap),
    drag,
  );

  // A part-height sheet is a card: glass, rounded all round, and held off the
  // sides and the bottom of the screen. Pulled up to full it is a sheet again —
  // the gaps close, the bottom corners square off against the screen's edge,
  // and the top corners round out to the screen's own radius. Everything about
  // that is driven by `lift`, how far between resting and full the sheet is
  // right now, so the card becomes the sheet continuously under the finger and
  // the glide to either end carries it the rest of the way.
  //
  // (snap + drag) is the sheet's distance below full: restingOffset at rest, 0
  // at full, and anything in between while dragging.
  const CARD_INSET = 10;
  const REST_RADIUS = 28;
  const FULL_RADIUS = 40;
  const lift = full
    ? null
    : Animated.divide(Animated.subtract(restingOffset, Animated.add(snap, drag)), Math.max(1, restingOffset)).interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      });
  const between = (atRest: number, atFull: number) =>
    lift ? lift.interpolate({ inputRange: [0, 1], outputRange: [atRest, atFull] }) : atFull;
  const sideInset = between(CARD_INSET, 0);
  const raise = between(-CARD_INSET, 0);
  const topRadius = between(REST_RADIUS, FULL_RADIUS);
  const bottomRadius = between(REST_RADIUS, 0);
  const bottomPadding = between(10, insets.bottom + 6);

  const inner = (
    <>
      {!full ? <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: 'rgba(60,50,40,0.22)', marginBottom: 6 }} /> : null}
      {!full ? (
        <View {...pan.panHandlers} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 52, zIndex: 2 }} />
      ) : null}
      {showClose ? (
        <View style={{ position: 'absolute', top: 10, right: 14, zIndex: 3 }}>
          <GlassButton icon="close" label={label} onPress={onClose} />
        </View>
      ) : null}
      {children}
    </>
  );

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.3)', opacity: progress }}>
          <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        {/* The shadow lives on this wrapper; the surface inside clips to its
            corners, and a shadow on a clipping view is clipped away with it. */}
        <Animated.View
          style={{
            height: tallHeight,
            marginHorizontal: sideInset,
            transform: [{ translateY: lift ? Animated.add(translateY, raise) : translateY }],
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: -10 },
            elevation: 16,
          }}
        >
          {full ? (
            <View style={{ flex: 1, backgroundColor: background ?? ai.canvas, paddingTop: insets.top, paddingBottom: insets.bottom }}>
              {inner}
            </View>
          ) : LIQUID_GLASS ? (
            // Real glass, in the light scheme whatever the phone is set to. The
            // corners are props, not style — the glass reads its outline from
            // them (see NativeGlassView).
            <AnimatedGlassView
              glassEffectStyle="regular"
              colorScheme="light"
              tintColor="rgba(255,255,255,0.6)"
              borderCurve="continuous"
              borderTopLeftRadius={topRadius}
              borderTopRightRadius={topRadius}
              borderBottomLeftRadius={bottomRadius}
              borderBottomRightRadius={bottomRadius}
              style={{ flex: 1, overflow: 'hidden', paddingTop: 8, paddingBottom: bottomPadding }}
            >
              {inner}
            </AnimatedGlassView>
          ) : (
            <Animated.View
              style={{
                flex: 1,
                overflow: 'hidden',
                backgroundColor: background ?? ai.surface,
                borderCurve: 'continuous',
                borderTopLeftRadius: topRadius,
                borderTopRightRadius: topRadius,
                borderBottomLeftRadius: bottomRadius,
                borderBottomRightRadius: bottomRadius,
                paddingTop: 8,
                paddingBottom: bottomPadding,
              }}
            >
              {inner}
            </Animated.View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}
