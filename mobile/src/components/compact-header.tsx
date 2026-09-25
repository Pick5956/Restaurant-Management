import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { GlassButton } from '@/src/components/ai/chrome';
import { AppText as Text } from '@/src/components/app-text';
import {
  COMPACT_BAR_PADDING_BOTTOM,
  COMPACT_BAR_PADDING_TOP,
  COMPACT_BUTTON,
  COMPACT_ROW_GAP,
  compactActionFit,
} from '@/src/lib/compact-header';
import { LIQUID_GLASS } from '@/src/lib/liquid-glass';
import { goBackOr } from '@/src/lib/navigation-runtime';
import { WORKSPACE_HUB_ROUTE } from '@/src/lib/workspace-route';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

// The compact bar AppScreen pins at the top once a screen's own heading has
// scrolled away (the owner's Grab reference, 23 ก.ย. 2569): the big heading
// goes with the content, and only the essentials come down with the reader -
// back, the title on one line, the screen's action, and optionally one row of
// the controls a long list is read through.
//
// The title band follows one progress value, 0 while the expanded title is on
// screen and 1 once it has gone. The row under it follows its own: 0 until
// the page's own copy of those controls has slid up to the row's place, 1
// from then on. Until that hand-off the row's band is see-through and takes
// no touch, so the page's controls are seen and tapped through it instead of
// being drawn twice. Both values are the scroll offset interpolated on the
// native thread, or a plain 0/1 under reduced motion.

/** The expanded heading's round buttons; the slot the compact back button sits in keeps their width so a centred title stays on the centre line. */
const HEADING_BUTTON = 46;
/** How far the bar's contents travel as they settle in. */
const SETTLE_DISTANCE = 6;
/** The soft shade under the bar's edge, so content visibly slides beneath it. */
const SHADE_HEIGHT = 8;

// 16/600 on one line: a step under the expanded title (typeScale.hero, 20/600),
// which is still on the page further up.
const COMPACT_TITLE = {
  color: palette.textStrong,
  fontSize: 16,
  fontWeight: '600',
  lineHeight: 24,
  letterSpacing: -0.2,
} as const;

export type CompactHeaderProgress = Animated.AnimatedInterpolation<number> | number;

type Ramp = Animated.AnimatedInterpolation<number> | number;

/** The progress mapped through a piecewise-linear curve, native or plain. */
function ramp(progress: CompactHeaderProgress, input: number[], output: number[]): Ramp {
  if (typeof progress !== 'number') {
    return progress.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
  }
  if (progress <= input[0]) return output[0];
  for (let index = 1; index < input.length; index += 1) {
    if (progress <= input[index]) {
      const span = input[index] - input[index - 1];
      const t = span > 0 ? (progress - input[index - 1]) / span : 1;
      return output[index - 1] + (output[index] - output[index - 1]) * t;
    }
  }
  return output[output.length - 1];
}

/** The bar's bottom edge: a hairline, and a shade over whatever slides under. */
function Edge({ opacity }: { opacity: Ramp }) {
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, opacity }}>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.divider }} />
      {/* Not a shadow on the surface: while the surface is fading it is
          translucent, and a layer's shadow shows through its own body. */}
      <LinearGradient
        colors={['rgba(61, 43, 31, 0.07)', 'rgba(61, 43, 31, 0)']}
        style={{ position: 'absolute', left: 0, right: 0, top: '100%', height: SHADE_HEIGHT }}
      />
    </Animated.View>
  );
}

export type CompactHeaderProps = {
  title: string;
  showBack: boolean;
  centerTitle: boolean;
  action?: ReactNode;
  /** One row of controls under the title. */
  row?: ReactNode;
  progress: CompactHeaderProgress;
  /** Up for touches and screen readers. Driven from JS, with hysteresis. */
  shown: boolean;
  /** The row's own progress: 1 from the hand-off on. */
  rowProgress: CompactHeaderProgress;
  /** The row's own switch for touches and screen readers. */
  rowShown: boolean;
  topInset: number;
  horizontalPadding: number;
  maxWidth: number;
  background: string;
  onLayout: (event: LayoutChangeEvent) => void;
  /** The row's slot, measured from the top edge of the scroll view under the
   *  bar: where the page's own row has to reach for the hand-off. */
  onRowLayout?: (slot: { y: number; height: number }) => void;
};

export function CompactHeader({
  title,
  showBack,
  centerTitle,
  action,
  row,
  progress,
  shown,
  rowProgress,
  rowShown,
  topInset,
  horizontalPadding,
  maxWidth,
  background,
  onLayout,
  onRowLayout,
}: CompactHeaderProps) {
  const { copy } = useDisplayPreferences();
  const [actionBox, setActionBox] = useState<{ width: number; height: number } | null>(null);
  const fit = compactActionFit(actionBox);

  const motion = useMemo(() => {
    const settle = ramp(progress, [0, 1], [-SETTLE_DISTANCE, 0]);
    // A Liquid Glass button is never faded: glass under a parent whose alpha
    // is below 1 renders flat until the alpha is back at 1, so a reader who
    // stopped mid-band would see a broken button. It pops in on a scale
    // instead, as the assistant sheet's header buttons do. Without the
    // material there is nothing to break, and it fades like the title.
    const pop = ramp(progress, [0, 0.35, 1], [0.01, 0.8, 1]);
    return {
      settle,
      text: { opacity: progress, transform: [{ translateY: settle }] },
      button: (scale: number, shiftX: number) => (LIQUID_GLASS
        ? { transform: [{ translateX: shiftX }, { translateY: settle }, { scale: pop }, { scale }] }
        : { opacity: progress, transform: [{ translateX: shiftX }, { translateY: settle }, { scale }] }),
    };
  }, [progress]);
  // The title band's edge gives way to the row's once the row is in. Keyed on
  // whether there is a row, not on the element: a page hands over a fresh
  // element every render, and a new interpolation each time would rebuild the
  // edge's native props node on every keystroke.
  const hasRow = row != null;
  const titleEdge = useMemo(() => (hasRow ? ramp(rowProgress, [0, 1], [1, 0]) : 1), [hasRow, rowProgress]);

  // The title band: the status bar and the title row, plus the gap under it
  // when a row follows. It owns the status-bar band as well as its own row:
  // two same-coloured views meeting at a seam show a hairline exactly where
  // no edge belongs.
  const titleBand = topInset + COMPACT_BAR_PADDING_TOP + COMPACT_BUTTON + (row ? COMPACT_ROW_GAP : COMPACT_BAR_PADDING_BOTTOM);

  return (
    // Hidden, it is neither touchable nor read: the expanded heading is the
    // screen's heading until it has gone. Shown, its title band takes every
    // touch in its bounds, so nothing sliding under it can be tapped through
    // it; the row's band does the same only once the row is in.
    <View
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
      onLayout={onLayout}
      pointerEvents={shown ? 'box-none' : 'none'}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 }}
    >
      <Animated.View
        pointerEvents={shown ? 'auto' : 'none'}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: titleBand, backgroundColor: background, opacity: progress }}
      >
        <Edge opacity={titleEdge} />
      </Animated.View>
      {row ? (
        <Animated.View
          pointerEvents={rowShown ? 'auto' : 'none'}
          style={{ position: 'absolute', top: titleBand, left: 0, right: 0, bottom: 0, backgroundColor: background, opacity: rowProgress }}
        >
          <Edge opacity={1} />
        </Animated.View>
      ) : null}
      <View pointerEvents="box-none" style={{ alignItems: 'center', paddingHorizontal: horizontalPadding, paddingTop: topInset + COMPACT_BAR_PADDING_TOP, paddingBottom: COMPACT_BAR_PADDING_BOTTOM }}>
        <View pointerEvents="box-none" style={{ width: '100%', maxWidth, gap: COMPACT_ROW_GAP }}>
          <View pointerEvents="auto" style={{ height: COMPACT_BUTTON, flexDirection: 'row', alignItems: 'center', gap: COMPACT_ROW_GAP }}>
            {showBack ? (
              <View style={{ width: HEADING_BUTTON }}>
                <Animated.View style={[{ width: COMPACT_BUTTON }, motion.button(1, 0)]}>
                  <GlassButton icon="chevron-back" label={copy('ย้อนกลับ', 'Go back')} onPress={() => goBackOr(router, WORKSPACE_HUB_ROUTE)} size={COMPACT_BUTTON} />
                </Animated.View>
              </View>
            ) : null}
            <Animated.View style={[{ minWidth: 0, flex: 1 }, motion.text]}>
              {/* Not a second header: the expanded title is still in the
                  accessibility tree, further up the page. */}
              <Text accessible={false} importantForAccessibility="no" numberOfLines={1} style={[COMPACT_TITLE, centerTitle ? { textAlign: 'center' } : null]}>
                {title}
              </Text>
            </Animated.View>
            {action ? (
              <Animated.View
                onLayout={(event) => {
                  const { width, height } = event.nativeEvent.layout;
                  setActionBox((box) => (box && box.width === width && box.height === height ? box : { width, height }));
                }}
                style={motion.button(fit.scale, fit.shiftX)}
              >
                {action}
              </Animated.View>
            ) : centerTitle && showBack ? <View style={{ width: HEADING_BUTTON }} /> : null}
          </View>
          {row ? (
            // Not read and not touchable until the hand-off: the page's own
            // row is the one on screen until then, and it is right underneath.
            <Animated.View
              accessibilityElementsHidden={!rowShown}
              importantForAccessibility={rowShown ? 'auto' : 'no-hide-descendants'}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                onRowLayout?.({ y: COMPACT_BAR_PADDING_TOP + y, height });
              }}
              pointerEvents={rowShown ? 'auto' : 'none'}
              style={{ opacity: rowProgress }}
            >
              {row}
            </Animated.View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
