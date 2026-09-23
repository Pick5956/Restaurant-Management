import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { FloorStrip } from '@/src/components/hub/floor-strip';
import { KitchenLanes } from '@/src/components/hub/kitchen-lanes';
import { ServiceTile } from '@/src/components/hub/service-tile';
import { segmentsText, ValueLine } from '@/src/components/hub/value-line';
import { useReducedMotion } from '@/src/components/motion';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { scaleFont } from '@/src/lib/app-font';
import {
  floorFigure,
  floorSegments,
  hubFigureText,
  kitchenFigure,
  kitchenSegments,
  paidTodayFigure,
  type HubFigurePiece,
  type HubLanguage,
} from '@/src/lib/hub-data';
import { FLOOR_CELL_GAP, floorStripHeight, floorStripShape } from '@/src/lib/hub-stage-layout';
import type { HubFloor, HubKitchen, HubNavItem, HubPaidToday, HubSlot } from '@/src/lib/hub-types';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';

// The raised service tiles of layout B, "เวที". They straddle the orange
// stage's lower edge, so they are solid white on every platform and carry a
// warm shadow deep enough to lift them off the orange. Each one is a single
// tap target that opens its screen; a failed first load puts a
// 'ลองอีกครั้ง' pill where the figure would be.

const TILE_RADIUS = 22;
const TILE_ICON = 38;
/** Lifts a white tile off the orange stage; controlShadow is tuned for cream and vanishes there. */
const TILE_SHADOW = '0 8px 20px rgba(124, 45, 18, 0.14), 0 1px 3px rgba(124, 45, 18, 0.10)';
const TILE_TITLE: TextStyle = { fontSize: 14.5, lineHeight: 21, fontWeight: '600' };
// flexGrow: a tile inside a stretched pair fills the row's height.
const TILE_OUTER: ViewStyle = { flexGrow: 1, boxShadow: TILE_SHADOW };

/** Figure words and figure numbers share one 25 pt line so the numbers can sit larger. */
const FIGURE_LINE = 25;
const FIGURE_WORDS: TextStyle = { fontSize: 13, lineHeight: FIGURE_LINE, fontWeight: '500', color: palette.muted };
const FIGURE_NUMBER: TextStyle = { fontSize: 17, lineHeight: FIGURE_LINE, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] };
const STATUS_LINE = 18;
const LABEL_LINE = 19;
const FLOOR_STRIP = 12;
/** The widest a floor cell grows: a floor of a few tables reads as a few squares, not a progress bar. */
const FLOOR_MAX_CELL = 22;
/** A tile's padding and edge, 14 + 1 a side: the strip's width is the tile's less this. */
export const STAGE_TILE_INSET = 30;

const FADE_MS = 180;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const NATIVE_DRIVER = Platform.OS !== 'web';

export type StageTileVariant = 'wide' | 'pair';

type TileProps<T> = {
  item: HubNavItem;
  slot: HubSlot<T>;
  /** This tile's icon hosts the screen's one heartbeat (no rising curve on the stage, and the shop is busy). */
  heartbeat: boolean;
  onOpen: (item: HubNavItem) => void;
  /** Lines the figure and the status line may take: a second only at a large OS text size (valueLines). Default 1. */
  lines?: 1 | 2;
};

/** The small contextual retry after a real first-load failure. Never a circular icon, never the API's words. */
export function RetryPill({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const { copy } = useDisplayPreferences();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignSelf: 'flex-start',
          // minHeight: a large OS text size grows the pill instead of spilling its words.
          minHeight: 28,
          paddingVertical: 3,
          paddingHorizontal: 12,
          borderRadius: 999,
          justifyContent: 'center',
          backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
        },
        style,
      ]}
    >
      <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: LABEL_LINE, fontWeight: '600', color: palette.primaryInk }}>
        {copy('ลองอีกครั้ง', 'Try again')}
      </Text>
    </Pressable>
  );
}

/** A value arriving: it fades in over 180 ms where the bones stood. Instant under reduced motion. */
function FadeIn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      return undefined;
    }
    const animation = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, easing: EASE, useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [opacity, reduced]);

  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

/** 'ว่าง 8 จาก 14 โต๊ะ' with the numbers drawn larger and stronger than the words round them. */
export function TileFigure({ pieces, lines = 1, style }: { pieces: readonly HubFigurePiece[]; lines?: 1 | 2; style?: StyleProp<TextStyle> }) {
  return (
    <Text numberOfLines={lines} style={[FIGURE_WORDS, style]}>
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {/* A nested AppText restates size and line height, or it scales from 14. */}
          {piece.strong ? <Text style={FIGURE_NUMBER}>{piece.text}</Text> : piece.text}
        </Fragment>
      ))}
    </Text>
  );
}

/**
 * A bone in a slot exactly as tall as the line it stands in for, so nothing
 * moves when the value lands. AppText scales every line height (scaleFont), so
 * the slot does too.
 */
function BoneLine({ line, width, height }: { line: number; width: number | `${number}%`; height: number }) {
  return (
    <View style={{ height: scaleFont(line), justifyContent: 'center' }}>
      <Bone width={width} height={height} radius={6} />
    </View>
  );
}

function retryActions(slot: HubSlot<unknown>, label: string) {
  if (slot.status !== 'error') return {};
  return {
    accessibilityActions: [{ name: 'retry', label }],
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'retry') slot.retry();
    },
  };
}

function StageTile<T>({
  item,
  slot,
  heartbeat,
  onOpen,
  alert = false,
  words,
  children,
}: TileProps<T> & {
  alert?: boolean;
  /** The tile's value in words, for its accessibility label; empty while there is none. */
  words: string;
  children?: ReactNode;
}) {
  const { copy } = useDisplayPreferences();
  return (
    <ServiceTile
      {...retryActions(slot, copy('ลองอีกครั้ง', 'Try again'))}
      accessibilityLabel={words ? `${item.title}, ${words}` : item.title}
      alert={alert}
      heartbeat={heartbeat}
      icon={item.icon}
      iconSize={TILE_ICON}
      onPress={() => onOpen(item)}
      pressScale={0.97}
      radius={TILE_RADIUS}
      style={TILE_OUTER}
      title={item.title}
      titleStyle={TILE_TITLE}
    >
      {children}
    </ServiceTile>
  );
}

/**
 * What sits under a tile's title for each state of its slot: bones while the
 * first value is on its way, the pill after a failed first load, the value once
 * it has arrived, and nothing for a value this member may not read.
 */
function SlotBody<T>({
  slot,
  title,
  bones,
  children,
  style,
}: {
  slot: HubSlot<T>;
  title: string;
  bones: ReactNode;
  children: (value: T) => ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  if (slot.status === 'off') return null;
  if (slot.status === 'error') return <RetryPill onPress={slot.retry} style={{ marginTop: 10 }} />;
  if (slot.status === 'ready' && slot.value !== null) {
    return <FadeIn style={[{ marginTop: 10 }, style]}>{children(slot.value)}</FadeIn>;
  }
  return (
    // Hidden, as the board's bones are: the tile's own label names it, and a
    // progressbar nested in the tile's button would be a second TalkBack stop
    // repeating the title. flexGrow carries a stretched pair's height through.
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ marginTop: 10 }, style]}>
      <SkeletonReveal label={title} style={{ flexGrow: 1 }}>
        {bones}
      </SkeletonReveal>
    </View>
  );
}

// ---------------------------------------------------------------- floor

/**
 * The strip's stand-in, drawn at the height the strip will have: one row, two
 * rows or the bar for the table count this restaurant last showed, nothing for
 * a floor with no tables, and one row when no count is known yet.
 */
function FloorStripBone({ tables, width }: { tables: number | null; width: number }) {
  if (tables === null) return <Bone height={FLOOR_STRIP} radius={3} />;
  if (floorStripHeight(tables, width, FLOOR_STRIP) === 0) return null;
  if (floorStripShape(tables, width) !== 'rows') return <Bone height={FLOOR_STRIP} radius={3} />;
  return (
    <View style={{ gap: FLOOR_CELL_GAP }}>
      <Bone height={FLOOR_STRIP} radius={3} />
      <Bone height={FLOOR_STRIP} radius={3} />
    </View>
  );
}

/** 'รับออเดอร์', full width: free tables of the total, the floor strip, then waiting bills. */
export function FloorTile({
  item,
  slot,
  heartbeat,
  onOpen,
  lines = 1,
  stripWidth,
  boneTables,
}: TileProps<HubFloor> & {
  /** The strip's width as the stage expects it (its column less STAGE_TILE_INSET), for the first frame and the bone. */
  stripWidth: number;
  /** The table count this restaurant's floor last showed, or null when none is known. */
  boneTables: number | null;
}) {
  const { language } = useDisplayPreferences();
  const lang: HubLanguage = language;
  const floor = slot.status === 'ready' ? slot.value : null;
  const words = floor ? `${hubFigureText(floorFigure(floor, lang))}, ${segmentsText(floorSegments(floor, lang))}` : '';

  return (
    <StageTile item={item} slot={slot} heartbeat={heartbeat} onOpen={onOpen} words={words}>
      <SlotBody
        slot={slot}
        title={item.title}
        bones={(
          <View style={{ gap: 8 }}>
            <BoneLine line={FIGURE_LINE} width={132} height={14} />
            <FloorStripBone tables={boneTables} width={stripWidth} />
            <BoneLine line={STATUS_LINE} width={96} height={12} />
          </View>
        )}
      >
        {(value) => (
          <View style={{ gap: 8 }}>
            <TileFigure lines={lines} pieces={floorFigure(value, lang)} />
            <FloorStrip
              cellRadius={3}
              cells={value.cells}
              height={FLOOR_STRIP}
              initialWidth={stripWidth}
              maxCellWidth={FLOOR_MAX_CELL}
            />
            <ValueLine lines={lines} segments={floorSegments(value, lang)} />
          </View>
        )}
      </SlotBody>
    </StageTile>
  );
}

// ---------------------------------------------------------------- kitchen

/**
 * 'ครัว': rounds cooking, then overdue and finished. Wide (the chef's hub, or no
 * orders tile to pair with) adds a labelled lane per round. The tile turns to
 * its danger look while any round is past its time.
 */
export function KitchenTile({ item, slot, heartbeat, onOpen, variant, lines = 1 }: TileProps<HubKitchen> & { variant: StageTileVariant }) {
  const { language } = useDisplayPreferences();
  const lang: HubLanguage = language;
  const kitchen = slot.status === 'ready' ? slot.value : null;
  const words = kitchen ? `${hubFigureText(kitchenFigure(kitchen, lang))}, ${segmentsText(kitchenSegments(kitchen, lang))}` : '';
  const wide = variant === 'wide';

  return (
    <StageTile alert={Boolean(kitchen && kitchen.overdue > 0)} item={item} slot={slot} heartbeat={heartbeat} onOpen={onOpen} words={words}>
      <SlotBody
        slot={slot}
        title={item.title}
        bones={(
          <View style={{ gap: 8 }}>
            <BoneLine line={FIGURE_LINE} width={112} height={14} />
            <BoneLine line={STATUS_LINE} width={wide ? 132 : 104} height={12} />
          </View>
        )}
      >
        {(value) => (
          <View style={{ gap: 8 }}>
            <TileFigure lines={lines} pieces={kitchenFigure(value, lang)} />
            {wide ? <KitchenLanes lanes={value.lanes} variant="wide" /> : null}
            <ValueLine lines={lines} segments={kitchenSegments(value, lang)} />
          </View>
        )}
      </SlotBody>
    </StageTile>
  );
}

// ---------------------------------------------------------------- orders

/** The paid count split for the pair: the words at the top of the tile, the number at its foot. */
function paidParts(paid: HubPaidToday, language: HubLanguage) {
  const pieces = paidTodayFigure(paid, language);
  return {
    label: pieces.filter((piece) => !piece.strong).map((piece) => piece.text).join('').trim(),
    number: pieces.filter((piece) => piece.strong).map((piece) => piece.text).join(''),
    words: hubFigureText(pieces),
  };
}

/**
 * 'ออเดอร์': bills paid today, from the archive's own query. In the pair the
 * words sit under the title and the number at the tile's foot, level with the
 * kitchen beside it. A member who may open the archive but not count it gets
 * the title alone.
 */
export function OrdersTile({ item, slot, heartbeat, onOpen, variant }: TileProps<HubPaidToday> & { variant: StageTileVariant }) {
  const { language } = useDisplayPreferences();
  const lang: HubLanguage = language;
  const paid = slot.status === 'ready' ? slot.value : null;
  const words = paid ? paidParts(paid, lang).words : '';
  const pair = variant === 'pair';
  // flexGrow fills the stretched pair, so the number can sit at the foot.
  const grow: ViewStyle | undefined = pair ? { flexGrow: 1 } : undefined;

  return (
    <StageTile item={item} slot={slot} heartbeat={heartbeat} onOpen={onOpen} words={words}>
      <SlotBody
        slot={slot}
        style={grow}
        title={item.title}
        bones={pair ? (
          <View style={{ flexGrow: 1, justifyContent: 'space-between', gap: 6 }}>
            <BoneLine line={LABEL_LINE} width={76} height={12} />
            <BoneLine line={FIGURE_LINE} width={36} height={16} />
          </View>
        ) : <BoneLine line={FIGURE_LINE} width={120} height={14} />}
      >
        {(value) => {
          if (!pair) return <TileFigure pieces={paidTodayFigure(value, lang)} />;
          const parts = paidParts(value, lang);
          return (
            <View style={{ flexGrow: 1, justifyContent: 'space-between', gap: 6 }}>
              <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: LABEL_LINE, fontWeight: '500', color: palette.muted }}>{parts.label}</Text>
              <Text numberOfLines={1} style={FIGURE_NUMBER}>{parts.number}</Text>
            </View>
          );
        }}
      </SlotBody>
    </StageTile>
  );
}
