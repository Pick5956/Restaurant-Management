import { Fragment } from 'react';
import { useWindowDimensions, View, type StyleProp, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AppText as Text } from '@/src/components/app-text';
import { scaleFont } from '@/src/lib/app-font';
import type { HubSegment, HubTone } from '@/src/lib/hub-types';
import { palette } from '@/src/theme';

// One line of live values on the hub: "เกินเวลา 1, เสร็จแล้ว 7", "หมด 3 เมนู,
// ใกล้หมด 2". Pieces are joined with a comma, never a middle dot (owner,
// 17 ก.ย.), and only a piece that carries a real status is coloured - a count
// of paid bills, money and configuration stay in the muted ink.

/** Status inks, from the palette and nowhere else. */
export const HUB_TONE_INK: Record<HubTone, string> = {
  danger: palette.danger,
  warning: palette.warning,
  info: palette.info,
  success: palette.success,
};

const SEVERITY: readonly HubTone[] = ['danger', 'warning', 'info', 'success'];

/** The most severe tone present (danger > warning > info > success), or null when no piece carries one. */
export function mostSevereTone(segments: readonly HubSegment[]): HubTone | null {
  for (const tone of SEVERITY) {
    if (segments.some((segment) => segment.tone === tone && segment.text)) return tone;
  }
  return null;
}

/** The line as plain words, for an accessibility label: "เกินเวลา 1, เสร็จแล้ว 7". */
export function segmentsText(segments: readonly HubSegment[]): string {
  return segments.map((segment) => segment.text).filter(Boolean).join(', ');
}

/**
 * A small round mark drawn as a vector circle. A 4-6 pt View with a half-width
 * corner radius is snapped to whole pixels on Android and comes out as a square
 * there (the owner saw squares under the days, 14 ก.ย. 2569).
 */
export function Dot({ size, color, style }: { size: number; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Svg width={size} height={size} style={style}>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={color} />
    </Svg>
  );
}

export type ValueLineProps = Omit<ViewProps, 'children'> & {
  segments: readonly HubSegment[];
  /** Font size; the line height follows at 1.44x so Thai tone marks are not clipped. Default 12.5 (line 18). */
  size?: number;
  /** Weight of the pieces with no tone. Toned pieces are always 500. Default '500'. */
  plainWeight?: '400' | '500';
  /** Ink of the pieces with no tone, and of the commas. Default palette.muted. */
  plainColor?: string;
  /** Lines the pieces may take before the tail is cut. Default 1; with 2 the dot stays level with the first. */
  lines?: 1 | 2;
  textStyle?: StyleProp<TextStyle>;
};

/**
 * Pieces joined with ", ", one line, the toned ones in their status ink at 500,
 * led by a 6 pt dot in the most severe tone present. With no tone at all the
 * line is plain muted text and has no dot. Renders nothing for no pieces: the
 * caller says the missing value ('ไม่มีบิลรอ', 'ของครบ') as a piece of its own.
 */
export function ValueLine({
  segments,
  size = 12.5,
  plainWeight = '500',
  plainColor = palette.muted,
  lines = 1,
  textStyle,
  style,
  ...rest
}: ValueLineProps) {
  const { fontScale } = useWindowDimensions();
  const pieces = segments.filter((segment) => segment.text);
  if (!pieces.length) return null;
  const lineHeight = Math.ceil(size * 1.44);
  const tone = mostSevereTone(pieces);
  const dotSize = 6;
  const wraps = lines > 1;
  const dot = tone ? <Dot size={dotSize} color={HUB_TONE_INK[tone]} /> : null;
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: wraps ? 'flex-start' : 'center', gap: 5, minWidth: 0 }, style]}>
      {/* On two lines the dot sits in a box one drawn line tall, level with the first. */}
      {dot && wraps ? <View style={{ height: scaleFont(lineHeight) * fontScale, justifyContent: 'center' }}>{dot}</View> : dot}
      <Text
        numberOfLines={lines}
        style={[{ flexShrink: 1, fontSize: size, lineHeight, fontWeight: plainWeight, color: plainColor, fontVariant: ['tabular-nums'] }, textStyle]}
      >
        {pieces.map((segment, index) => (
          <Fragment key={index}>
            {index > 0 ? ', ' : null}
            {segment.tone ? (
              // A nested AppText must restate size and line height: AppText
              // scales from 14 when a span leaves them out.
              <Text style={{ fontSize: size, lineHeight, fontWeight: '500', color: HUB_TONE_INK[segment.tone], fontVariant: ['tabular-nums'] }}>
                {segment.text}
              </Text>
            ) : segment.text}
          </Fragment>
        ))}
      </Text>
    </View>
  );
}
