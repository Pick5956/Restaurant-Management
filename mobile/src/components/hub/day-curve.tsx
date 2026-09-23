import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { AppText as Text } from '@/src/components/app-text';
import { useLoopGate } from '@/src/components/hub/loop-gate';

// The day's takings as a line: cumulative paid revenue per hour, ending at now.
// Drawn in the measured box itself - the viewBox is the box's own width and
// height, so nothing is stretched and the end point is where the dot is drawn.

export type CurvePoint = { x: number; y: number };
export type CurvePath = { line: string; area: string; end: CurvePoint | null };

/**
 * The line and the filled area under it for a series, in a width x height box
 * with `pad` kept clear on every side. Straight runs between points with the
 * corners softened: a smooth-looking line without a curve-fitting library, and
 * it never overshoots a value. Fewer than two values give empty paths.
 */
export function curvePath(values: readonly number[], width: number, height: number, pad: number): CurvePath {
  if (values.length < 2) return { line: '', area: '', end: null };
  const max = Math.max(...values, 1);
  const stepX = (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => ({
    x: pad + index * stepX,
    y: pad + (height - pad * 2) * (1 - value / max),
  }));
  let line = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const next = points[index];
    const cx = (prev.x + next.x) / 2;
    line += ` C ${cx} ${prev.y}, ${cx} ${next.y}, ${next.x} ${next.y}`;
  }
  const last = points[points.length - 1];
  const area = `${line} L ${last.x} ${height} L ${points[0].x} ${height} Z`;
  return { line, area, end: last };
}

const PAD = 4;
/** Room around the box for the heartbeat ring (r up to 11 plus its stroke) at the end point. */
const BLEED = 13;
const DOT_R = 3.5;
const RING_FROM = 4;
const RING_TO = 11;
const RING_MS = 2400;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The paths for the curve. No series, or nothing paid yet, is a flat baseline
 * with its end at now; a single hour rises from nothing to that hour's total.
 */
function dayCurveGeometry(values: readonly number[] | null | undefined, width: number, height: number): CurvePath {
  const series = values ?? [];
  if (series.length >= 2) return curvePath(series, width, height, PAD);
  if (series.length === 1 && series[0] > 0) return curvePath([0, series[0]], width, height, PAD);
  const y = height - PAD;
  return { line: `M ${PAD} ${y} L ${width - PAD} ${y}`, area: '', end: { x: width - PAD, y } };
}

export type DayCurveProps = {
  /** Cumulative paid revenue per hour (HubTakings.curve.cumulative); null or empty draws a flat baseline. */
  values: readonly number[] | null | undefined;
  /** Left axis label, e.g. '10:00'. */
  startLabel: string;
  /** Right axis label, e.g. '14:32'. */
  nowLabel: string;
  /** Height of the curve itself; the axis labels add 16 under it. Default 44. */
  height?: number;
  /**
   * The screen's one heartbeat: a ring that swells off the end dot. Pass it
   * only while there is activity; it also stops whenever the screen is not
   * focused, the app is in the background or reduced motion is on.
   */
  pulse?: boolean;
  /** Stroke, dot and area colour. Default white, for the orange strip. */
  color?: string;
  /** Axis label ink. Default rgba(255,255,255,0.78). */
  labelColor?: string;
  /** Default 2.2. */
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
};

export function DayCurve({
  values,
  startLabel,
  nowLabel,
  height = 44,
  pulse = false,
  color = '#FFFFFF',
  labelColor = 'rgba(255,255,255,0.78)',
  strokeWidth = 2.2,
  style,
}: DayCurveProps) {
  const [width, setWidth] = useState(0);
  const running = useLoopGate(pulse);
  // An svg id may not carry the colons React puts in useId().
  const gradientId = `dayCurveFill${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const path = useMemo(() => (width > 0 ? dayCurveGeometry(values, width, height) : null), [height, values, width]);
  const label = { fontSize: 11, lineHeight: 16, fontWeight: '500' as const, color: labelColor, fontVariant: ['tabular-nums' as const] };

  return (
    <View style={style}>
      <View
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
        }}
        style={{ height }}
      >
        {path ? (
          // The svg reaches BLEED past the box on every side so the ring at the
          // end point (top-right, where a cumulative line always ends) is not
          // cut off; the viewBox keeps box coordinates, one unit to one point.
          <Svg
            pointerEvents="none"
            width={width + BLEED * 2}
            height={height + BLEED * 2}
            viewBox={`${-BLEED} ${-BLEED} ${width + BLEED * 2} ${height + BLEED * 2}`}
            style={{ position: 'absolute', left: -BLEED, top: -BLEED }}
          >
            <Defs>
              <SvgGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity="0.30" />
                <Stop offset="1" stopColor={color} stopOpacity="0" />
              </SvgGradient>
            </Defs>
            {path.area ? <Path d={path.area} fill={`url(#${gradientId})`} /> : null}
            <Path d={path.line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            {running && path.end ? <PulseRing cx={path.end.x} cy={path.end.y} color={color} /> : null}
            {path.end ? <Circle cx={path.end.x} cy={path.end.y} r={DOT_R} fill={color} /> : null}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text numberOfLines={1} style={label}>{startLabel}</Text>
        <Text numberOfLines={1} style={label}>{nowLabel}</Text>
      </View>
    </View>
  );
}

/**
 * The ring around the now-dot, inside the svg so it sits exactly on the point.
 * react-native-svg props cannot run on the native driver; it is one element,
 * mounted only while useLoopGate allows it.
 */
function PulseRing({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  const beat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    beat.setValue(0);
    const loop = Animated.loop(Animated.timing(beat, { toValue: 1, duration: RING_MS, easing: EASE, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [beat]);

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={beat.interpolate({ inputRange: [0, 1], outputRange: [RING_FROM, RING_TO] })}
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeOpacity={beat.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] })}
    />
  );
}
