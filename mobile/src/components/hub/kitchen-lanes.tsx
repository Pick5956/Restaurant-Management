import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import type { HubKitchenLane } from '@/src/lib/hub-types';
import { palette } from '@/src/theme';

// One vertical bar per cooking round, longest wait first, each filled to its
// share of the overdue window and coloured with the kitchen screen's own
// urgency. The figure and status line beside it say the numbers, so the lanes
// are hidden from screen readers. A wide lane's label (kitchenLaneLabel) is
// short already; when a narrow lane still cannot hold it, the middle goes, so
// '#128' never reads as '#1…' and 'T100' never as 'T1…' (stress test, 2026-09-23).

export type KitchenLanesVariant = 'paired' | 'wide';

const VARIANTS = {
  /** Beside the orders tile: short, narrow, no labels. */
  paired: { track: 28, bar: 10, gap: 5, max: 10 },
  /** The kitchen tile on its own: taller bars, each labelled with its table. */
  wide: { track: 36, bar: 14, gap: 4, max: 12 },
} as const;

const TRACK = '#F3ECE5';
const LABEL_LINE = 15;
const LABEL_GAP = 3;
/** A round just sent still shows a sliver of its colour at the foot of the track. */
const MIN_SHOWN = 0.06;
const GROW_MS = 400;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const NATIVE_DRIVER = Platform.OS !== 'web';

const URGENCY_FILL: Record<HubKitchenLane['urgency'], string> = {
  normal: palette.neutral,
  warning: palette.warning,
  overdue: palette.danger,
};

export type KitchenLanesProps = Omit<ViewProps, 'children'> & {
  lanes: readonly HubKitchenLane[];
  variant: KitchenLanesVariant;
  /** Keep the lanes' height when there are none, so an idle kitchen tile does not change size. Default false (renders nothing). */
  keepHeight?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function KitchenLanes({ lanes, variant, keepHeight = false, style, ...rest }: KitchenLanesProps) {
  const reduced = useReducedMotion();
  const look = VARIANTS[variant];
  const wide = variant === 'wide';
  const shown = lanes.slice(0, look.max);
  const fullHeight = look.track + (wide ? LABEL_GAP + LABEL_LINE : 0);
  if (!shown.length && !keepHeight) return null;

  return (
    <View
      {...rest}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: look.gap, minHeight: fullHeight }, style]}
    >
      {shown.map((lane) => (
        wide ? (
          <View key={lane.key} style={{ flex: 1, maxWidth: 40, alignItems: 'center' }}>
            <LaneBar lane={lane} width={look.bar} height={look.track} reduced={reduced} />
            <Text numberOfLines={1} ellipsizeMode="middle" style={{ alignSelf: 'stretch', textAlign: 'center', marginTop: LABEL_GAP, fontSize: 11, lineHeight: LABEL_LINE, fontWeight: '600', color: palette.muted, fontVariant: ['tabular-nums'] }}>
              {lane.label}
            </Text>
          </View>
        ) : (
          <LaneBar key={lane.key} lane={lane} width={look.bar} height={look.track} reduced={reduced} />
        )
      ))}
    </View>
  );
}

/**
 * The fill is a full-height block scaled from the foot of the track, so a
 * round growing on the clock tick eases up on the native driver.
 */
function LaneBar({ lane, width, height, reduced }: { lane: HubKitchenLane; width: number; height: number; reduced: boolean }) {
  const progress = Number.isFinite(lane.progress) ? Math.min(1, Math.max(0, lane.progress)) : 0;
  const target = Math.max(MIN_SHOWN, progress);
  const scale = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    scale.stopAnimation();
    if (reduced) {
      scale.setValue(target);
      return undefined;
    }
    const animation = Animated.timing(scale, { toValue: target, duration: GROW_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [reduced, scale, target]);

  return (
    // No shadow on the track, so clipping the fill to its corners is safe.
    <View style={{ width, height, borderRadius: 4, overflow: 'hidden', backgroundColor: TRACK }}>
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height,
          backgroundColor: URGENCY_FILL[lane.urgency],
          transformOrigin: 'bottom',
          transform: [{ scaleY: scale }],
        }}
      />
    </View>
  );
}
