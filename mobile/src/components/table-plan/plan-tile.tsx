import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View, type DimensionValue } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { usePressScale } from '@/src/components/table-plan/press-scale';
import { useReducedMotion } from '@/src/components/motion';
import type { PlanHighlightKind } from '@/src/components/table-plan/plan-context';
import { planLabel, planStatusWord, planTileAccessibilityLabel, type PlanLanguage } from '@/src/lib/table-plan';
import { gridMetrics, spanWidth, type GridMetrics } from '@/src/lib/table-plan-screen';
import { tileToneFor } from '@/src/lib/table-tile-tone';
import { breakpoints, palette } from '@/src/theme';
import type { RestaurantTable, TableStatus } from '@/src/types/table';

// The setup tile: the order-taking floor's tile in setup mode. Flat - no glass
// and no shadow - so the plan never passes for the live floor and Android draws
// it the same. A free table is plain white with its seats; only a table in use,
// held or closed takes its status fill and word.

const TILE_RADIUS = 12;
const TILE_MIN_HEIGHT = 62;
const FREE_EDGE = '#E4D8CD';
const RING = '#C2410C';

export type TileGeometry = { width: DimensionValue };

/** The grid for this window: three columns on a phone, as many as fit from 768pt. */
export function floorGrid(gridWidth: number, windowWidth: number): GridMetrics {
  return gridMetrics(gridWidth, windowWidth >= breakpoints.tablet);
}

/** A tile `span` columns wide; before the grid is measured, a third of it per column. */
export function tileGeometry(metrics: GridMetrics, span = 1): TileGeometry {
  if (metrics.tileWidth <= 0) return { width: span >= metrics.columns ? '100%' : `${31 * span}%` };
  return { width: spanWidth(metrics, span) };
}

export type PlanHighlight = { kind: PlanHighlightKind; token: number };

function labelLineHeight(fontSize: number) {
  return Math.round(fontSize * 1.6);
}

function CheckCircle({ checked }: { checked: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: checked ? 0 : 1.5, borderColor: FREE_EDGE, backgroundColor: checked ? RING : '#ffffff' }}
    >
      {checked ? <AppIcon color="#ffffff" name="checkmark" size={13} /> : null}
    </View>
  );
}

/** A 2px orange ring just outside a tile, on its own view so the tile never changes size. */
function Ring({ opacity }: { opacity?: Animated.Value }) {
  const style = { position: 'absolute' as const, top: -3, left: -3, right: -3, bottom: -3, borderRadius: TILE_RADIUS + 2, borderCurve: 'continuous' as const, borderWidth: 2, borderColor: RING };
  if (opacity) return <Animated.View pointerEvents="none" style={[style, { opacity }]} />;
  return <View pointerEvents="none" style={style} />;
}

/** A saved tile flashes where it now sits (600 ms); a new one wears a fading ring (1.2 s). */
function useHighlight(highlight: PlanHighlight | null | undefined) {
  const glow = useRef(new Animated.Value(0)).current;
  const token = highlight?.token ?? 0;
  const kind = highlight?.kind;
  useEffect(() => {
    if (!token || !kind) return undefined;
    glow.setValue(1);
    const animation = Animated.timing(glow, {
      toValue: 0,
      duration: kind === 'ring' ? 1200 : 600,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [glow, kind, token]);
  return glow;
}

/** New tiles arrive 40 ms apart; `delay` null means the tile was already there. */
function useReveal(delay: number | null | undefined) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(delay === null || delay === undefined ? 1 : 0)).current;
  useEffect(() => {
    if (delay === null || delay === undefined) return undefined;
    if (reduced) {
      progress.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(progress, { toValue: 1, delay, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduced]);
  return {
    opacity: progress,
    translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
  };
}

export function PlanTile({
  table,
  status,
  locked,
  labelFontSize,
  geometry,
  language,
  interactive,
  selecting,
  selected,
  focused,
  highlight,
  revealDelay,
  onPress,
  onLongPress,
  onLayout,
}: {
  table: RestaurantTable;
  status: TableStatus;
  /** In service: never selectable, never a way into selection. */
  locked: boolean;
  labelFontSize: number;
  geometry: TileGeometry;
  language: PlanLanguage;
  /** A manage_table member: the tile is a button. Everyone else gets a plain view. */
  interactive: boolean;
  selecting: boolean;
  selected: boolean;
  /** The tablet inspector is showing this table. */
  focused?: boolean;
  highlight?: PlanHighlight | null;
  /** Set on a tile that was just added: it arrives after this many ms. */
  revealDelay?: number | null;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Where the tile landed in its grid: the floor scrolls to a tile just added. */
  onLayout?: (y: number) => void;
}) {
  const reveal = useReveal(revealDelay);
  const tone = tileToneFor(status);
  const free = status === 'free';
  const closed = status === 'inactive';
  const lineHeight = labelLineHeight(labelFontSize);
  const press = usePressScale(0.96);
  const glow = useHighlight(highlight);
  // The lock (owner, 2026-09-23): a table in service is never picked for a
  // bulk action. In selection it has no check circle and does not press.
  const checkable = selecting && !locked;
  const inert = selecting && locked;
  const label = planLabel(table);
  const seatsInk = free ? palette.muted : tone.ink;

  const surface = {
    minHeight: TILE_MIN_HEIGHT,
    borderRadius: TILE_RADIUS,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: free ? FREE_EDGE : 'rgba(255,255,255,0.9)',
    backgroundColor: free ? '#FFFFFF' : tone.fill,
    paddingTop: 9,
    paddingHorizontal: 10,
    paddingBottom: 9,
    justifyContent: 'space-between' as const,
  };

  const body = (
    <>
      {highlight?.kind === 'flash' ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: palette.surfaceStrong, opacity: glow }} />
      ) : null}
      {/* Not selectable: Android drops the ellipsis on selectable text. Cut in
          the middle, so a long zone prefix keeps the digits (SECO…Q03). */}
      <Text
        ellipsizeMode="middle"
        numberOfLines={1}
        style={{ paddingRight: checkable ? 22 : 0, fontSize: labelFontSize, lineHeight, fontWeight: '700', color: closed ? palette.muted : palette.textStrong, textDecorationLine: closed ? 'line-through' : 'none', fontVariant: ['tabular-nums'] }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <View style={{ flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <AppIcon color={seatsInk} name="people-outline" size={12} />
          <Text style={{ fontSize: 12.5, lineHeight: 18, fontWeight: '700', color: seatsInk, fontVariant: ['tabular-nums'] }}>{table.capacity}</Text>
        </View>
        {free ? null : (
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, lineHeight: 18, fontWeight: '600', color: tone.ink }}>{planStatusWord(status, language)}</Text>
        )}
      </View>
      {checkable ? <CheckCircle checked={selected} /> : null}
    </>
  );

  const accessibilityLabel = planTileAccessibilityLabel(table, status, language);

  return (
    <Animated.View
      onLayout={onLayout ? (event) => onLayout(event.nativeEvent.layout.y) : undefined}
      style={{ ...geometry, opacity: reveal.opacity, transform: [{ translateY: reveal.translateY }, { scale: press.scale }] }}
    >
      {interactive ? (
        <Pressable
          accessibilityLabel={accessibilityLabel}
          accessibilityRole={checkable ? 'checkbox' : 'button'}
          accessibilityState={checkable ? { checked: selected } : inert ? { disabled: true } : undefined}
          delayLongPress={350}
          disabled={inert}
          onLongPress={onLongPress}
          onPress={onPress}
          onPressIn={press.pressIn}
          onPressOut={press.pressOut}
          style={({ pressed }) => [surface, pressed && free ? { backgroundColor: palette.surfaceSubtle } : null]}
        >
          {body}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={accessibilityLabel} style={surface}>
          {body}
        </View>
      )}
      {(checkable && selected) || focused ? <Ring /> : null}
      {highlight?.kind === 'ring' ? <Ring opacity={glow} /> : null}
    </Animated.View>
  );
}

/** The last tile of every room, for managers: add tables to this room. */
export function GhostTile({ geometry, wide, label, accessibilityLabel, onPress, pulseToken }: {
  geometry: TileGeometry;
  /** Spanning more than one column: the icon sits beside the word. */
  wide?: boolean;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  /** A new room's ghost pulses once, to say where its tables go. */
  pulseToken?: number;
}) {
  const press = usePressScale(0.96);
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!pulseToken || reduced) return undefined;
    const beat = (to: number) => Animated.timing(pulse, { toValue: to, duration: 75, easing: Easing.inOut(Easing.quad), useNativeDriver: true });
    const animation = Animated.sequence([beat(1.05), beat(1), beat(1.05), beat(1)]);
    animation.start();
    return () => animation.stop();
  }, [pulse, pulseToken, reduced]);

  return (
    <Animated.View style={{ ...geometry, transform: [{ scale: Animated.multiply(press.scale, pulse) }] }}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        onPressIn={press.pressIn}
        onPressOut={press.pressOut}
        style={({ pressed }) => ({
          flexGrow: 1,
          minHeight: TILE_MIN_HEIGHT,
          flexDirection: wide ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: wide ? 6 : 2,
          borderRadius: TILE_RADIUS,
          borderCurve: 'continuous',
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: 'rgba(172,58,11,0.45)',
          backgroundColor: pressed ? palette.surfaceSubtle : 'transparent',
        })}
      >
        <AppIcon color={palette.primaryInk} name="add" size={18} />
        <Text numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: palette.primaryInk }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The tablet's preview of tables about to be added: where they will stand, with the labels they will get. */
export function PreviewGhost({ geometry, label, labelFontSize }: { geometry: TileGeometry; label: string; labelFontSize: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ ...geometry, minHeight: TILE_MIN_HEIGHT, justifyContent: 'center', paddingHorizontal: 10, borderRadius: TILE_RADIUS, borderCurve: 'continuous', borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(172,58,11,0.45)', backgroundColor: palette.surfaceSubtle }}
    >
      <Text ellipsizeMode="middle" numberOfLines={1} style={{ fontSize: labelFontSize, lineHeight: labelLineHeight(labelFontSize), fontWeight: '700', color: palette.primaryInk, fontVariant: ['tabular-nums'] }}>{label}</Text>
    </View>
  );
}
