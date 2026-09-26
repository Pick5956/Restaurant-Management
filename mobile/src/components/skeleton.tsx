import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { useReducedMotion } from '@/src/components/motion';
import { palette } from '@/src/theme';

// Loading skeletons: the shape of a screen drawn before its data arrives, so
// the numbers land where the eye is already looking instead of the page
// growing from a one-line "กำลังโหลด..." box into a full screen. The owner
// chose this over a dimmed-previous-data treatment on 14 ก.ย. 2569.
//
// One light sweeps every bone on the screen together — a shared clock rather
// than one loop per bone, so twenty bones cost one animation and the sweep reads
// as a single pass of light, not twenty flickers out of step. Reduced motion
// stops the sweep and leaves the shapes.

const BONE = '#F3ECE5';
const SWEEP_MS = 1500;
const CONTENT_REVEAL_DELAY_MS = 110;
const CONTENT_REVEAL_MS = 260;
// How long a skeleton stands alone before a spinner joins it.
const SLOW_LOAD_SPINNER_MS = 1000;

let sharedClock: Animated.Value | null = null;
let sharedLoop: Animated.CompositeAnimation | null = null;
let subscribers = 0;

function useSharedShimmer(enabled: boolean) {
  const [clock] = useState(() => {
    if (!sharedClock) sharedClock = new Animated.Value(0);
    return sharedClock;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    subscribers += 1;
    if (!sharedLoop) {
      clock.setValue(0);
      sharedLoop = Animated.loop(Animated.timing(clock, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }));
      sharedLoop.start();
    }
    return () => {
      subscribers -= 1;
      if (subscribers <= 0 && sharedLoop) {
        sharedLoop.stop();
        sharedLoop = null;
        subscribers = 0;
      }
    };
  }, [clock, enabled]);
  return clock;
}

/**
 * One placeholder shape. `onColor` is for bones laid over the orange sales
 * card, where the stone colour would read as a hole cut in it.
 */
export function Bone({ width = '100%', height, radius = 8, onColor = false, style }: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  onColor?: boolean;
  style?: ViewStyle;
}) {
  const reducedMotion = useReducedMotion();
  const clock = useSharedShimmer(!reducedMotion);
  const [measured, setMeasured] = useState(0);
  const band = Math.max(40, measured * 0.6);

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
      style={[{
        width,
        height,
        borderRadius: radius,
        borderCurve: 'continuous',
        overflow: 'hidden',
        backgroundColor: onColor ? 'rgba(255,255,255,0.2)' : BONE,
      }, style]}
    >
      {!reducedMotion && measured > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: band,
            transform: [{ translateX: clock.interpolate({ inputRange: [0, 1], outputRange: [-band, measured] }) }],
          }}
        >
          <LinearGradient
            colors={onColor
              ? ['rgba(255,255,255,0)', 'rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']
              : ['rgba(255,255,255,0)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * What takes the skeleton's place, fading in rather than blinking in (owner,
 * 2026-09-26: every page but the kitchen "flickered" its content in). The
 * kitchen's numbers - its tickets arrive on a LayoutAnimation that fades each
 * one in over 260 ms after 110 ms - on an opacity the native driver runs, not
 * a LayoutAnimation: that one, around a subtree full of text fields, closed
 * the app on iOS. Mount it where the loaded content replaces the skeleton; it
 * fades once, when it first mounts, and never again on a refresh.
 */
export function ContentReveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) { opacity.setValue(1); return undefined; }
    const animation = Animated.timing(opacity, {
      toValue: 1,
      delay: CONTENT_REVEAL_DELAY_MS,
      duration: CONTENT_REVEAL_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

/**
 * Holds the skeleton back for a beat and fades it in. A load that finishes
 * inside ~120 ms never shows it at all — a skeleton that flashes for a frame
 * reads as the screen glitching, which is worse than no placeholder.
 *
 * A load still going after a second also gets a spinner in the middle (owner,
 * 2026-09-26): past that, a page of grey shapes starts to look stuck rather
 * than on its way. One that lands inside the second shows no spinner at all.
 * `spinner={false}` for a skeleton that already says it is working, like the
 * assistant's thinking line.
 */
export function SkeletonReveal({ children, label, style, spinner = true }: { children: ReactNode; label: string; style?: ViewStyle; spinner?: boolean }) {
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const spinnerOpacity = useRef(new Animated.Value(0)).current;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      delay: 120,
      duration: reducedMotion ? 0 : 180,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, reducedMotion]);
  useEffect(() => {
    if (!spinner) return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_SPINNER_MS);
    return () => clearTimeout(timer);
  }, [spinner]);
  useEffect(() => {
    if (!slow) return undefined;
    const animation = Animated.timing(spinnerOpacity, {
      toValue: 1,
      duration: reducedMotion ? 0 : 200,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reducedMotion, slow, spinnerOpacity]);
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={[{ opacity }, style]}
    >
      {children}
      {slow ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View
            style={{
              opacity: spinnerOpacity,
              width: 52,
              height: 52,
              borderRadius: 26,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.surface,
              shadowColor: palette.shadow,
              shadowOpacity: 0.12,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 3 },
              elevation: 3,
            }}
          >
            <ActivityIndicator color={palette.primary} />
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
  );
}
