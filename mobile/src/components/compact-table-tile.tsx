import { GlassView } from 'expo-glass-effect';
import { useCallback, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import { scaleFont } from '@/src/lib/app-font';
import { LIQUID_GLASS } from '@/src/lib/liquid-glass';
import { reservationClock } from '@/src/lib/reservation-schedule';
import { tileIsMuted, tileToneFor, type TableTileStatus } from '@/src/lib/table-tile-tone';
import { palette, radius, spacing } from '@/src/theme';

/**
 * The compact table tile: three to a row, and only what tells the floor whether
 * it can seat someone.
 *
 * Its own component rather than JSX inside the grid's `.map()`, because the press
 * animation needs a `useRef` per tile and a hook cannot be called in a loop. The
 * detailed card is untouched and still lives inline in that map.
 *
 *   ┌──────────────┐
 *   │ T5     🕐18:00│   number left, booking chip right
 *   │ จอง           │   status word
 *   └──────────────┘
 *
 * It wears the assistant screen's material rather than a flat card: real Liquid
 * Glass on iOS 26, and the same translucent-white-with-a-hairline fallback the
 * assistant uses everywhere else. The status colour is what the glass is tinted
 * with, so the material carries the state instead of a separate marker sitting
 * on top of it.
 *
 * The booking chip sits on the number's line, not the status line. The status
 * word is the long one (`กำลังใช้งาน`) and the table number is short, so the
 * slack is all on the top line; beside the status word the chip truncated Thai
 * on any occupied table that also had a booking.
 */

const TILE_RADIUS = radius.md;


/**
 * Every fontSize and lineHeight passes through `scaleFont` inside AppText, so the
 * tile's height has to be expressed in the same units or it drifts the moment
 * APP_FONT_SCALE is retuned — and react-native crops Thai tone marks silently
 * when it does. `minHeight` rather than `height` for the same reason one step
 * further out: AppText does not set `allowFontScaling={false}`, so the reader's
 * own OS text size stacks on top of ours and the tile has to be free to grow.
 */
const TILE_MIN_HEIGHT = spacing.sm + scaleFont(30) + scaleFont(20) + spacing.sm;

export function CompactTableTile({
  label,
  statusLabel,
  status,
  upcomingReservationAt,
  language,
  accessibilityLabel,
  onPress,
  width,
  minWidth,
  maxWidth,
  flexGrow,
  flexBasis,
}: {
  label: string;
  statusLabel: string;
  status: TableTileStatus;
  upcomingReservationAt?: string | null;
  language: 'th' | 'en';
  accessibilityLabel: string;
  onPress: () => void;
  width?: number | `${number}%`;
  minWidth: number;
  maxWidth?: number;
  flexGrow: number;
  flexBasis: number | 'auto';
}) {
  const tone = tileToneFor(status);
  const muted = tileIsMuted(status);
  const reducedMotion = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;
  const bookingTime = reservationClock(upcomingReservationAt, language);

  const animate = useCallback(
    (toValue: number) => {
      if (reducedMotion) {
        // The state still changes, only its travel is removed. Press feedback is
        // not decoration — a tile that answers nothing reads as broken.
        press.setValue(toValue);
        return;
      }
      if (toValue === 1) {
        Animated.spring(press, {
          toValue: 1,
          damping: 18,
          stiffness: 320,
          mass: 0.7,
          useNativeDriver: true,
        }).start();
        return;
      }
      // Released through a small negative overshoot rather than by springing
      // straight back. A spring returning from 0.955 overshoots by well under a
      // percent, which is invisible — precisely the inert press this redesign
      // was asked to fix. Dipping to -0.4 first puts the tile at about 1.02 on
      // the way back, which can actually be seen.
      Animated.sequence([
        Animated.timing(press, { toValue: -0.4, duration: 90, useNativeDriver: true }),
        Animated.spring(press, {
          toValue: 0,
          damping: 14,
          stiffness: 260,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]).start();
    },
    [press, reducedMotion],
  );

  const tileScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.955] });
  // Clamped on the left so the release overshoot cannot drive the wash to a
  // negative opacity, which reads as a flicker at the end of every tap.
  const washOpacity = press.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0.08, 0.12],
    extrapolateLeft: 'clamp',
  });

  const surface = {
    minHeight: TILE_MIN_HEIGHT,
    borderRadius: TILE_RADIUS,
    // Clips the wash into the corner radius. The shadow lives on the Pressable
    // one level out, because putting a shadow and an overflow clip on the same
    // view is what eats the shadow on Android.
    overflow: 'hidden' as const,
  };

  const body = (
    <>
      {/* Deliberately not `opacity` on the tile: fading fill and Thai text
          together toward the canvas is the visual grammar of disabled, not
          pressed, which is why the old 0.72 read as nothing happening. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: tone.press,
          opacity: washOpacity,
        }}
      />
      <View style={{ paddingHorizontal: 9, paddingTop: spacing.sm, paddingBottom: 9 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs, minHeight: scaleFont(30) }}>
          {/* One ink on every live tile, never the status colour: scanning a
              mixed grid for "T12" must not depend on knowing its state first.
              Colour answers what state, ink answers which table.

              adjustsFontSizeToFit rather than a length rule, because zone
              prefixes make real labels like `ZONE-11`, and at a fixed 20pt
              five of those truncate to an identical `ZONE…` — a row of tables
              nobody can tell apart. The label shrinks into whatever width the
              chip leaves it instead of being cut. No letterSpacing anywhere near
              a Thai run: values small enough to be safe are too small to read,
              and larger ones detach sara and tone marks from their consonant. */}
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.55}
            numberOfLines={1}
            selectable
            style={{
              minWidth: 0,
              flexShrink: 1,
              color: muted ? palette.muted : palette.textStrong,
              fontSize: 20,
              lineHeight: 30,
              fontWeight: '700',
              fontVariant: ['tabular-nums'],
              textDecorationLine: muted ? 'line-through' : 'none',
            }}
          >
            {label}
          </Text>
          {/* flexShrink 0: the clock is the payload, so the table label gives up
              size before the time gives up a digit. */}
          {bookingTime ? (
            <View
              style={{
                flexShrink: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 2,
                borderRadius: radius.full,
                backgroundColor: tone.chip,
                paddingLeft: 3,
                paddingRight: 5,
                paddingVertical: 1,
              }}
            >
              <AppIcon color={tone.ink} name="time-outline" size={11} />
              <Text
                selectable
                style={{
                  color: tone.ink,
                  fontSize: 11,
                  lineHeight: 17,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {bookingTime}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          selectable
          style={{ color: tone.ink, fontSize: 13, lineHeight: 20, fontWeight: '600' }}
        >
          {statusLabel}
        </Text>
      </View>
    </>
  );

  return (
    // Scale changes no layout, so the grid never reflows while a tile is held.
    <Animated.View style={{ width, minWidth, maxWidth, flexGrow, flexBasis, transform: [{ scale: tileScale }] }}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={() => animate(1)}
        onPressOut={() => animate(0)}
        // The same lift the assistant's glass controls carry. Whatever is behind
        // a translucent surface shows through it, so the tile needs its own edge
        // to read as an object rather than as a patch of the canvas.
        style={{
          borderRadius: TILE_RADIUS,
          shadowColor: '#3D2B1F',
          shadowOpacity: 0.1,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        }}
      >
        {LIQUID_GLASS ? (
          <GlassView
            glassEffectStyle="regular"
            isInteractive
            // The table map is light-only, so the glass must not follow a dark
            // system theme. A fixed tint, never a state colour changed at
            // runtime: the native view keeps wearing the old one if it changes.
            colorScheme="light"
            tintColor={tone.tint}
            style={surface}
          >
            {body}
          </GlassView>
        ) : (
          <View style={[surface, { backgroundColor: tone.fill, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.9)' }]}>
            {body}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
