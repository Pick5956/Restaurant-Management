import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { useLoopGate } from '@/src/components/hub/loop-gate';
import { useReducedMotion } from '@/src/components/motion';
import { controlShadow, palette } from '@/src/theme';

// A service tile on the hub: white, raised, one tap target, its own icon and
// title at the top and whatever live value the layout puts under them.
//
// Every state change is an overlay's opacity on the native driver, not a
// colour interpolation: the danger wash, the pressed wash and the icon's
// danger ink each sit over the resting look and fade in. The shadow lives on
// the outer view, which never clips - Android drops a shadow drawn by a view
// that also has overflow hidden.

export const SERVICE_TILE_EDGE = '#EFE7DF';
/** The danger edge statusTone('danger') draws with. */
export const SERVICE_TILE_ALERT_EDGE = '#FECACA';

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const NATIVE_DRIVER = Platform.OS !== 'web';
const ALERT_MS = 240;
const PRESS_MS = 120;
const RING_MS = 1800;

export type ServiceTileProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: AppIconName;
  title: string;
  /**
   * Real trouble on this tile (a round past its time). Background and edge
   * crossfade to dangerSoft / #FECACA over 240 ms and the icon turns danger.
   */
  alert?: boolean;
  /** Corner radius of the tile. Default 18. */
  radius?: number;
  /** The icon squircle's side. Default 30 (radius 10, glyph 17); 38 gives radius 12, glyph 21. */
  iconSize?: number;
  /** Overrides for the title (default 15/500, line 21, textStrong). */
  titleStyle?: StyleProp<TextStyle>;
  /** Scale while pressed. Default 0.98. Ignored under reduced motion. */
  pressScale?: number;
  /**
   * This tile's icon hosts the screen's one heartbeat: a ring that swells off
   * the squircle (scale 1 to 1.5, opacity 0.6 to 0, 1.8 s), brand orange, or
   * danger while `alert` holds. It runs only while the screen is focused, the
   * app is in the foreground and reduced motion is off; pass it only while
   * there is activity.
   */
  heartbeat?: boolean;
  /** Optional element at the right end of the header row. */
  headerRight?: ReactNode;
  /** The outer, shadowed view: flex, width, margins. */
  style?: StyleProp<ViewStyle>;
  /** The padded content column (padding 14 by default), e.g. justifyContent: 'space-between'. */
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** The squircle's corner radius and glyph size for a side, matching 30 -> 10/17 and 38 -> 12/21. */
function squircleMetrics(size: number) {
  return { radius: Math.round(size * 0.32), glyph: Math.round(size * 0.56) };
}

export function ServiceTile({
  icon,
  title,
  alert = false,
  radius = 18,
  iconSize = 30,
  titleStyle,
  pressScale = 0.98,
  heartbeat = false,
  headerRight,
  style,
  contentStyle,
  children,
  onPressIn,
  onPressOut,
  ...rest
}: ServiceTileProps) {
  const reduced = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;
  const alertProgress = useRef(new Animated.Value(alert ? 1 : 0)).current;

  useEffect(() => {
    alertProgress.stopAnimation();
    if (reduced) {
      alertProgress.setValue(alert ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(alertProgress, {
      toValue: alert ? 1 : 0,
      duration: ALERT_MS,
      easing: EASE,
      useNativeDriver: NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [alert, alertProgress, reduced]);

  const animatePress = (to: 0 | 1) => {
    press.stopAnimation();
    if (reduced) {
      press.setValue(to);
      return;
    }
    Animated.timing(press, { toValue: to, duration: PRESS_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER }).start();
  };

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1 : pressScale] });
  // Pressed on a tile already at danger: a deeper step of its own wash rather
  // than the brand cream, which would read as the alert switching off.
  const pressWash = alert ? SERVICE_TILE_ALERT_EDGE : palette.surfaceSubtle;
  const pressOpacity = press.interpolate({ inputRange: [0, 1], outputRange: [0, alert ? 0.45 : 1] });

  return (
    <Animated.View
      style={[
        {
          borderRadius: radius,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: SERVICE_TILE_EDGE,
          backgroundColor: palette.surface,
        },
        controlShadow,
        style,
        { transform: [{ scale }] },
      ]}
    >
      {/* Covers the edge too (inset -1), so the edge crossfades with the wash. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -1,
          right: -1,
          bottom: -1,
          left: -1,
          borderRadius: radius,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: SERVICE_TILE_ALERT_EDGE,
          backgroundColor: palette.dangerSoft,
          opacity: alertProgress,
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: Math.max(0, radius - 1),
          borderCurve: 'continuous',
          backgroundColor: pressWash,
          opacity: pressOpacity,
        }}
      />
      <Pressable
        {...rest}
        accessibilityRole="button"
        onPressIn={(event: GestureResponderEvent) => {
          animatePress(1);
          onPressIn?.(event);
        }}
        onPressOut={(event: GestureResponderEvent) => {
          animatePress(0);
          onPressOut?.(event);
        }}
        // flexGrow, not flex: 1 - a flex-basis of 0 collapses the tile when its
        // parent's height comes from content, and grows to fill a stretched row.
        style={[{ flexGrow: 1, padding: 14 }, contentStyle]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TileIcon icon={icon} size={iconSize} alert={alert} alertProgress={alertProgress} heartbeat={heartbeat} />
          <Text numberOfLines={1} style={[{ flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500', color: palette.textStrong }, titleStyle]}>
            {title}
          </Text>
          {headerRight}
        </View>
        {children}
      </Pressable>
    </Animated.View>
  );
}

function TileIcon({ icon, size, alert, alertProgress, heartbeat }: {
  icon: AppIconName;
  size: number;
  alert: boolean;
  alertProgress: Animated.Value;
  heartbeat: boolean;
}) {
  const { radius, glyph } = squircleMetrics(size);
  const fill = { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius, borderCurve: 'continuous' as const };
  const centred = { ...fill, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View style={{ width: size, height: size }}>
      {heartbeat ? <HeartbeatRing radius={radius} color={alert ? palette.danger : palette.primary} /> : null}
      <View style={[fill, { backgroundColor: palette.surfaceSubtle }]} />
      {/* On the danger wash a pale-danger squircle would vanish into the tile,
          so the squircle turns white and the glyph carries the danger. */}
      <Animated.View style={[fill, { backgroundColor: palette.surface, opacity: alertProgress }]} />
      <Animated.View style={[centred, { opacity: alertProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
        <AppIcon name={icon} size={glyph} color={palette.primaryInk} />
      </Animated.View>
      <Animated.View style={[centred, { opacity: alertProgress }]}>
        <AppIcon name={icon} size={glyph} color={palette.danger} />
      </Animated.View>
    </View>
  );
}

/** The heartbeat, gated on focus, foreground and reduced motion by useLoopGate. */
function HeartbeatRing({ radius, color }: { radius: number; color: string }) {
  const running = useLoopGate(true);
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!running) return undefined;
    beat.setValue(0);
    const loop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: RING_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [beat, running]);

  if (!running) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        borderRadius: radius,
        borderCurve: 'continuous',
        borderWidth: 2,
        borderColor: color,
        opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
        transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }],
      }}
    />
  );
}
