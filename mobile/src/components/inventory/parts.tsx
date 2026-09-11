import { GlassView } from 'expo-glass-effect';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet, GlassButton, GlassHeaderPane, GlassPanel, LIQUID_GLASS } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { money } from '@/src/lib/format';
import { countPayload, quickAmounts, reorderQuantityFor, reorderShare, restockStep, stockShare, stockStatus, type StockStatus } from '@/src/lib/inventory-list';
import { palette } from '@/src/theme';
import type { Ingredient } from '@/src/types/ingredient';

// The inventory screens' pieces, built the way the design page was drawn: one
// shape per piece, two materials. On iOS 26 the cards, rails and buttons are
// Liquid Glass; everywhere else the same shapes are cream with a pale orange
// edge and a warm shadow doing the work the glass does. Every colour is the
// app's own palette — nothing new was added for this screen.

export const HEADER_BUTTON = 46;
export const HEADER_FADE = 15;
export const HEADER_PAD_TOP = 4;
// The rail is a pill, and a smaller one than the search above it: the search
// is where the hand goes, the rail is a setting.
const RAIL_HEIGHT = 38;
export const SEARCH_HEIGHT = 50;
/** Between the rows of the header block. */
const HEADER_ROW_GAP = 8;

export function fmt(value: number | string, locale: string, digits = 2): string {
  return Number(value).toLocaleString(locale, { maximumFractionDigits: digits });
}

export function statusLabel(status: StockStatus, language: DisplayLanguage): string {
  if (status === 'out') return language === 'th' ? 'หมด' : 'Out';
  if (status === 'low') return language === 'th' ? 'ใกล้หมด' : 'Low';
  return language === 'th' ? 'พอใช้' : 'OK';
}

export function statusColour(status: StockStatus): { ink: string; soft: string } {
  if (status === 'out') return { ink: palette.danger, soft: palette.dangerSoft };
  if (status === 'low') return { ink: palette.warning, soft: palette.warningSoft };
  return { ink: palette.success, soft: palette.successSoft };
}

/**
 * A card: glass on iOS 26, cream with a pale edge everywhere else.
 *
 * `solid` skips the glass on every platform. Glass is for the control layer —
 * the header, the dock, a sheet — not for content that scrolls. Each glass
 * view refracts what is behind it on every frame, and thirty cards each with
 * two glass buttons inside made ninety of them in one scroll view: the list
 * stuttered on an iPad. Apple's own guidance says the same — the content layer
 * is opaque, the controls float over it in glass.
 */
export function Card({ children, style, radius = 22, solid }: { children: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; solid?: boolean }) {
  if (solid) {
    return (
      <View style={[{ borderRadius: radius, borderCurve: 'continuous', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, style]}>
        {children}
      </View>
    );
  }
  return (
    <GlassPanel
      radius={radius}
      style={style as ViewStyle}
      interactive={false}
      fallback={palette.surface}
      fallbackBorder={palette.border}
    >
      {children}
    </GlassPanel>
  );
}

/**
 * The floating header: the glass pane, a back button, a title and an optional
 * rail underneath (the status segments). Everything below scrolls under it, so
 * the screen has to start its content at `headerContentTop`.
 */
export function headerContentTop(insetsTop: number, withRail: boolean, withBar = false): number {
  return insetsTop + headerBlockHeight(withBar, withRail) + HEADER_FADE + 10;
}

/** The header's rows below the safe area: title, then the search bar, then the rail. */
function headerBlockHeight(withBar: boolean, withRail: boolean): number {
  return HEADER_PAD_TOP + HEADER_BUTTON + (withBar ? HEADER_ROW_GAP + SEARCH_HEIGHT : 0) + (withRail ? HEADER_ROW_GAP + RAIL_HEIGHT : 0);
}

export function FloatingHeader({
  title,
  subtitle,
  onBack,
  backLabel,
  backIcon = 'chevron-back',
  trailing,
  bar,
  rail,
  centered,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backLabel: string;
  /** "close" when the header is leaving a mode rather than a screen. */
  backIcon?: AppIconName;
  trailing?: ReactNode;
  /** The search row, SEARCH_HEIGHT tall, under the title. */
  bar?: ReactNode;
  /** The status rail, under the bar. */
  rail?: ReactNode;
  centered?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const solidTo = headerBlockHeight(Boolean(bar), Boolean(rail));
  // How much room the title has to leave at each end. The back button is always
  // 46 across; the trailing control is whatever the screen put there — a round
  // button, or "เลือกทั้งหมด", which is twice as wide. Reserving the wider of
  // the two at BOTH ends is what keeps the title on the screen's centre line
  // while keeping it clear of either control.
  const [reserve, setReserve] = useState(HEADER_BUTTON);
  return (
    <>
      <GlassHeaderPane top={insets.top} solidTo={solidTo} fade={HEADER_FADE} />
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, paddingTop: insets.top + HEADER_PAD_TOP, paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {centered ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: reserve + 12 }}>
              <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', color: palette.textStrong, lineHeight: 24 }}>{title}</Text>
              {subtitle ? <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted, marginTop: 1 }}>{subtitle}</Text> : null}
            </View>
          ) : null}
          <GlassButton icon={backIcon} label={backLabel} onPress={onBack} />
          <View style={{ flex: 1, minWidth: 0 }}>
            {!centered ? (
              <>
                <Text numberOfLines={1} style={{ fontSize: 24, fontWeight: '700', color: palette.textStrong, lineHeight: 30 }}>{title}</Text>
                {subtitle ? <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted, marginTop: 1 }}>{subtitle}</Text> : null}
              </>
            ) : null}
          </View>
          <View onLayout={(event) => setReserve(Math.max(HEADER_BUTTON, Math.round(event.nativeEvent.layout.width)))}>
            {trailing ?? <View style={{ width: HEADER_BUTTON, height: HEADER_BUTTON }} />}
          </View>
        </View>
        {bar ? <View style={{ marginTop: HEADER_ROW_GAP, height: SEARCH_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 8 }}>{bar}</View> : null}
        {rail ? <View style={{ marginTop: HEADER_ROW_GAP }}>{rail}</View> : null}
      </View>
    </>
  );
}

/**
 * The three-way status rail. The chosen cell is a black thumb that moves, not
 * a colour that jumps: tap another cell and the list changes at once while the
 * thumb sets off a beat later and glides over; put a finger on it and it
 * follows the finger, then settles on the nearest cell when let go.
 *
 * The white labels are a second copy of the row, clipped inside the thumb and
 * shifted the opposite way, so a label turns white exactly as the thumb passes
 * over it — no crossfade to time, nothing to get out of step.
 */
const RAIL_PAD = 4;
const RAIL_GAP = 4;
// Pill ends: the thumb is as round as it is tall, and so is the rail around it.
const THUMB_RADIUS = (RAIL_HEIGHT - RAIL_PAD * 2) / 2;
const RAIL_RADIUS = RAIL_HEIGHT / 2;

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  const [width, setWidth] = useState(0);
  const count = options.length;
  const cell = width > 0 ? (width - RAIL_PAD * 2 - RAIL_GAP * (count - 1)) / count : 0;
  const step = cell + RAIL_GAP;
  const maxX = step * (count - 1);
  const index = Math.max(0, options.findIndex((option) => option.value === value));

  const x = useRef(new Animated.Value(0)).current;
  // Where the thumb is right now, read off the native value so a drag can
  // pick it up mid-glide.
  const at = useRef(0);
  useEffect(() => {
    const id = x.addListener(({ value: current }) => { at.current = current; });
    return () => x.removeListener(id);
  }, [x]);
  const dragging = useRef(false);
  const grabbed = useRef(0);
  // The PanResponder is built once; it reads the live figures through this.
  const live = useRef({ index, step, maxX, options, onChange });
  live.current = { index, step, maxX, options, onChange };

  const glide = (to: number) => Animated.spring(x, { toValue: to, useNativeDriver: true, damping: 22, stiffness: 190, mass: 0.9 }).start();

  // A tap changes the list at once; the thumb leaves a beat later. Moving it
  // in the same frame as the tap read as a warp.
  useEffect(() => {
    if (!step || dragging.current) return;
    const timer = setTimeout(() => glide(index * step), 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step]);

  const settle = () => {
    dragging.current = false;
    const { step: s, maxX: m, options: rows, onChange: change, index: was } = live.current;
    const target = s ? Math.round(Math.min(m, Math.max(0, at.current)) / s) : was;
    glide(target * s);
    if (target !== was) {
      void Haptics.selectionAsync();
      change(rows[target].value);
    }
  };

  const pan = useRef(
    PanResponder.create({
      // The thumb takes its touch the moment a finger lands on it, so holding
      // it and dragging works from the first frame. The first cut waited to
      // steal the touch from the cell underneath once the finger moved, and
      // the cell never gave it up. Taps on the other cells are still theirs.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Nothing above gets to take a drag away half-way through.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragging.current = true;
        grabbed.current = at.current;
        x.stopAnimation();
      },
      onPanResponderMove: (_event, gesture) => {
        const { maxX: m } = live.current;
        x.setValue(Math.min(m, Math.max(0, grabbed.current + gesture.dx)));
      },
      onPanResponderRelease: settle,
      onPanResponderTerminate: settle,
    }),
  ).current;

  const labelOf = (option: { label: string; count?: number }, on: boolean) => (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#FFFFFF' : palette.muted }}>{option.label}</Text>
      {option.count !== undefined ? (
        <Text style={{ fontSize: 13, fontWeight: '600', color: on ? 'rgba(255,255,255,0.8)' : palette.placeholder, fontVariant: ['tabular-nums'] }}>{option.count}</Text>
      ) : null}
    </View>
  );

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ height: RAIL_HEIGHT, padding: RAIL_PAD, borderRadius: RAIL_RADIUS, backgroundColor: LIQUID_GLASS ? 'rgba(255,237,213,0.55)' : palette.surfaceStrong }}
    >
      <View style={{ flex: 1, flexDirection: 'row', gap: RAIL_GAP }}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: option.value === value }}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, flexDirection: 'row' }}
          >
            {labelOf(option, false)}
          </Pressable>
        ))}
      </View>
      {cell > 0 ? (
        // Shadow on the outer view, clip on the inner: one view cannot do both on iOS.
        <Animated.View
          {...pan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={options[index]?.label}
          style={{ position: 'absolute', top: RAIL_PAD, left: RAIL_PAD, width: cell, height: RAIL_HEIGHT - RAIL_PAD * 2, borderRadius: THUMB_RADIUS, transform: [{ translateX: x }], shadowColor: '#3d2b1f', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}
        >
          <View style={{ flex: 1, borderRadius: THUMB_RADIUS, backgroundColor: palette.textStrong, overflow: 'hidden' }}>
            <Animated.View style={{ flexDirection: 'row', gap: RAIL_GAP, width: width - RAIL_PAD * 2, height: '100%', transform: [{ translateX: Animated.multiply(x, -1) }] }}>
              {options.map((option) => (
                <View key={option.value} style={{ width: cell, flexDirection: 'row' }}>{labelOf(option, true)}</View>
              ))}
            </Animated.View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

export function TotalsCard({ value, needsOrder, language }: { value: number; needsOrder: number; language: DisplayLanguage }) {
  return (
    <Card style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <View>
        <Text style={{ fontSize: 11.5, color: palette.muted }}>{language === 'th' ? 'มูลค่าคลังรวม' : 'Inventory value'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'], lineHeight: 28 }}>{money(value, language)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 11.5, color: palette.muted }}>{language === 'th' ? 'ต้องสั่งของ' : 'To reorder'}</Text>
        <Text style={{ fontSize: 22, fontWeight: '600', color: palette.primaryInk, fontVariant: ['tabular-nums'], lineHeight: 28 }}>
          {needsOrder}
          <Text style={{ fontSize: 11.5, fontWeight: '500', color: palette.muted }}> {language === 'th' ? 'รายการ' : 'items'}</Text>
        </Text>
      </View>
    </Card>
  );
}

export function StatusPill({ status, language }: { status: StockStatus; language: DisplayLanguage }) {
  const colour = statusColour(status);
  return (
    <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: colour.soft }}>
      <Text style={{ fontSize: 11, fontWeight: '600', color: colour.ink }}>{statusLabel(status, language)}</Text>
    </View>
  );
}

/**
 * The level bar: how much of this shelf is filled, with a tick where the
 * reorder level falls. The tick used to sit at the middle by construction,
 * because the bar's end was defined as twice the reorder level; now both ends
 * are real numbers and the tick lands wherever the reorder level actually is.
 *
 * Nothing is drawn when the shelf has no observed maximum — an empty bar there
 * would read as "we are out" when the truth is "nothing has been seen yet".
 */
export function LevelBar({ item, height = 6 }: { item: Ingredient; height?: number }) {
  const share = stockShare(item);
  const status = stockStatus(item);
  const mark = reorderShare(item);
  if (share === null) return null;
  return (
    <View style={{ marginTop: 8, height, borderRadius: height / 2, backgroundColor: palette.surfaceStrong }}>
      <View style={{ width: `${Math.round(share * 100)}%`, height: '100%', borderRadius: height / 2, backgroundColor: statusColour(status).ink }} />
      {mark === null ? null : (
        <View style={{ position: 'absolute', left: `${Math.round(mark * 100)}%`, top: -3, width: 2, height: height + 6, borderRadius: 1, backgroundColor: palette.muted, opacity: 0.5 }} />
      )}
    </View>
  );
}

export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: checked ? palette.primary : palette.border, backgroundColor: checked ? palette.primary : 'transparent', alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}>
      {checked ? <AppIcon name="checkmark" size={15} color={palette.primaryText} /> : null}
    </View>
  );
}

/** A 44px rounded-square button: solid orange for the primary act, glass for the rest. */
/** Where a button sits on the window, so something can grow out of it. */
export type Anchor = { x: number; y: number; width: number; height: number };

// The round buttons: the filter beside the search, the + and … on a card.
// They were rounded squares; the owner asked for circles, which the header's
// own glass buttons already are, so now everything that is pressed here is round.
export const SQUARE_RADIUS = 22;

export function SquareButton({ icon, label, onPress, primary, disabled, size = 44, solid }: { icon: AppIconName; label: string; onPress: (anchor: Anchor) => void; primary?: boolean; disabled?: boolean; size?: number; /** No glass, on any platform — for a button that lives inside scrolling content. */ solid?: boolean }) {
  const shape = { width: size, height: size, borderRadius: size / 2, alignItems: 'center' as const, justifyContent: 'center' as const };
  const self = useRef<View>(null);
  const press = () => {
    const node = self.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
  };
  if (primary) {
    return (
      <Pressable ref={self} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={press} hitSlop={4} style={({ pressed }) => ({ opacity: pressed ? 0.85 : disabled ? 0.5 : 1 })}>
        {LIQUID_GLASS && !solid ? (
          <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" tintColor="rgba(194,65,12,0.86)" style={shape}>
            <AppIcon name={icon} size={Math.round(size * 0.5)} color="#ffffff" />
          </GlassView>
        ) : (
          <View style={{ ...shape, backgroundColor: palette.primary, shadowColor: palette.primary, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
            <AppIcon name={icon} size={Math.round(size * 0.5)} color="#ffffff" />
          </View>
        )}
      </Pressable>
    );
  }
  const face = <AppIcon name={icon} size={Math.round(size * 0.45)} color={palette.muted} />;
  return (
    <Pressable ref={self} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={press} hitSlop={4} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {solid ? (
        <View style={{ ...shape, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }}>{face}</View>
      ) : (
        <GlassPanel radius={shape.borderRadius} style={shape} fallback={palette.surface} fallbackBorder={palette.border}>{face}</GlassPanel>
      )}
    </Pressable>
  );
}

export function IngredientCard({
  item,
  language,
  locale,
  selecting,
  selected,
  canManage,
  onPress,
  onRestock,
  onMore,
}: {
  item: Ingredient;
  language: DisplayLanguage;
  locale: string;
  selecting: boolean;
  selected: boolean;
  canManage: boolean;
  onPress: () => void;
  onRestock: () => void;
  /** Passed where the … button is, so the menu can grow out of that spot. */
  onMore: (anchor: Anchor) => void;
}) {
  const status = stockStatus(item);
  const colour = statusColour(status);
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={selecting ? t(`เลือก ${item.name}`, `Select ${item.name}`) : t(`ดู ${item.name}`, `View ${item.name}`)}
      onPress={onPress}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.985 : 1 }] })}
    >
      <Card solid style={{ padding: 12, flexDirection: 'row', gap: 10, ...(selected ? { borderWidth: 1.5, borderColor: palette.primary } : {}) }}>
        {selecting ? <CheckBox checked={selected} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: '600', color: palette.textStrong }}>{item.name}</Text>
            <StatusPill status={status} language={language} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
            <Text style={{ fontSize: 22, fontWeight: '600', color: status === 'ok' ? palette.textStrong : colour.ink, fontVariant: ['tabular-nums'], lineHeight: 28 }}>{fmt(item.stock, locale)}</Text>
            <Text style={{ fontSize: 12, color: palette.muted }}>{item.unit}</Text>
            <Text style={{ marginLeft: 'auto', fontSize: 12, color: palette.muted, fontVariant: ['tabular-nums'] }}>฿{fmt(item.cost_per_unit, locale)} / {item.unit}</Text>
          </View>
          <LevelBar item={item} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <Text numberOfLines={1} style={{ maxWidth: '50%', fontSize: 11.5, fontWeight: '600', color: palette.muted }}>{item.category?.name ?? t('ไม่มีหมวด', 'Uncategorised')}</Text>
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: palette.placeholder }}>
              {Number(item.min_stock) > 0 ? t(`ขั้นต่ำ ${fmt(item.min_stock, locale)} ${item.unit}`, `Min ${fmt(item.min_stock, locale)} ${item.unit}`) : t('ยังไม่ตั้งขั้นต่ำ', 'No reorder level')}
            </Text>
            {!selecting ? <AppIcon name="chevron-forward" size={16} color={palette.placeholder} /> : null}
          </View>
        </View>
        {!selecting && canManage ? (
          <View style={{ justifyContent: 'center', gap: 6 }}>
            <SquareButton solid primary icon="add" label={t('เติมสต็อก', 'Restock')} onPress={onRestock} />
            <SquareButton solid icon="ellipsis-horizontal" label={t('ตัวเลือก', 'Options')} onPress={onMore} />
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}

/** The bottom dock: a gradient fade so the list dissolves into it, then the buttons. */
export function Dock({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5 }}>
      <LinearGradient pointerEvents="none" colors={['rgba(255,247,237,0)', palette.canvas]} locations={[0, 0.55]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 22, paddingBottom: Math.max(insets.bottom, 12) + 6 }}>{children}</View>
    </View>
  );
}

export function DockButton({ label, icon, onPress, secondary, disabled }: { label: string; icon?: AppIconName; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, paddingHorizontal: 14 }}>
      {icon ? <AppIcon name={icon} size={20} color={secondary ? palette.textStrong : '#ffffff'} /> : null}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1, fontSize: 16, fontWeight: '600', color: secondary ? palette.textStrong : '#ffffff' }}>{label}</Text>
    </View>
  );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 })}>
      {secondary ? (
        <GlassPanel radius={27} fallback={palette.surface} fallbackBorder={palette.border}>{inner}</GlassPanel>
      ) : LIQUID_GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" tintColor="rgba(194,65,12,0.84)" style={{ borderRadius: 27, shadowColor: palette.primary, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }}>
          {inner}
        </GlassView>
      ) : (
        <View style={{ borderRadius: 27, backgroundColor: palette.primary, shadowColor: palette.primary, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}>{inner}</View>
      )}
    </Pressable>
  );
}

// ----------------------------------------------------------------- sheets

export function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, paddingRight: 64 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
      {subtitle ? <Text style={{ fontSize: 12, color: palette.muted, marginTop: 1 }}>{subtitle}</Text> : null}
    </View>
  );
}

export function SheetAction({ icon, label, onPress, danger, divided }: { icon: AppIconName; label: string; onPress: () => void; danger?: boolean; divided?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        paddingHorizontal: 16,
        backgroundColor: pressed ? 'rgba(249,115,22,0.12)' : 'transparent',
        ...(divided ? { borderTopWidth: 1, borderTopColor: palette.divider, marginTop: 6, paddingTop: 6 } : {}),
      })}
    >
      <AppIcon name={icon} size={20} color={danger ? palette.danger : palette.muted} />
      <Text style={{ fontSize: 15, fontWeight: '500', color: danger ? palette.danger : palette.textStrong }}>{label}</Text>
    </Pressable>
  );
}

export function Stepper({ value, step, unit, onChange }: { value: number; step: number; unit: string; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  // The keys are the save button's colour: they are the act, the field is the
  // answer. Round, like every other button on the inventory screens.
  const key = (icon: AppIconName, label: string, to: number, disabled?: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(Math.max(0, Math.round(to * 100) / 100))}
      hitSlop={6}
      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: LIQUID_GLASS ? 'rgba(194,65,12,0.9)' : palette.primary, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}
    >
      <AppIcon name={icon} size={26} color="#ffffff" />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginTop: 4 }}>
      {key('remove', '−', value - step, value <= 0)}
      {/* The number sits at the exact centre of the row: the field is centred
          text with the unit hung on its right, so the digits do not drift. */}
      <View style={{ flex: 1, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <TextInput
          value={text}
          onChangeText={(next) => { setText(next); const n = Number(next); if (Number.isFinite(n) && n >= 0) onChange(n); }}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={unit}
          style={{ minWidth: 72, textAlign: 'center', fontSize: 30, fontWeight: '700', color: palette.textStrong, paddingVertical: 0, fontVariant: ['tabular-nums'] }}
        />
        <Text style={{ fontSize: 14, color: palette.muted }}>{unit}</Text>
      </View>
      {key('add', '+', value + step)}
    </View>
  );
}

export function QuickChips({ amounts, value, onPick, prefix = '+' }: { amounts: number[]; value: number; onPick: (amount: number) => void; prefix?: string }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingHorizontal: 16, marginTop: 14 }}>
      {amounts.map((amount) => {
        const on = amount === value;
        return (
          <Pressable key={amount} accessibilityRole="button" onPress={() => onPick(amount)} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            {on ? (
              <View style={{ height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: palette.primary, justifyContent: 'center' }}>
                <Text style={{ fontSize: 13.5, fontWeight: '600', color: '#fff' }}>{prefix}{amount.toLocaleString('th-TH')}</Text>
              </View>
            ) : (
              <GlassPanel radius={18} style={{ height: 36, paddingHorizontal: 14, justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
                <Text style={{ fontSize: 13.5, fontWeight: '500', color: palette.text }}>{prefix}{amount.toLocaleString('th-TH')}</Text>
              </GlassPanel>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, borderRadius: 14, backgroundColor: LIQUID_GLASS ? 'rgba(255,237,213,0.55)' : palette.surfaceStrong, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 13.5, color: palette.muted }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'], color: tone === 'ok' ? palette.success : tone === 'bad' ? palette.danger : palette.textStrong }}>{value}</Text>
    </View>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 16 }}>{children}</View>;
}

export function SheetButton({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: disabled ? 0.5 : pressed ? 0.88 : 1 })}>
      {secondary ? (
        <GlassPanel radius={25} style={{ height: 50, alignItems: 'center', justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: palette.textStrong }}>{label}</Text>
        </GlassPanel>
      ) : (
        <View style={{ height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: LIQUID_GLASS ? 'rgba(194,65,12,0.9)' : palette.primary }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * Restock: a stepper in the ingredient's own unit, four one-tap amounts, and
 * what the shelf will hold afterwards. If the ingredient has a unit cost the
 * sheet says what the restock will cost, because the API writes that as an
 * expense — money nobody typed should still be money everybody saw.
 */
export function RestockSheet({
  item,
  open,
  onClose,
  onSubmit,
  busy,
  language,
  locale,
}: {
  item: Ingredient | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (quantity: number) => void;
  busy: boolean;
  language: DisplayLanguage;
  locale: string;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [amount, setAmount] = useState(0);
  useEffect(() => { if (open && item) setAmount(restockStep(item)); }, [open, item]);
  if (!item) return null;
  const cost = Number(item.cost_per_unit) * amount;
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.62} label={t('ปิด', 'Close')} showClose>
      <SheetTitle title={t('เติมสต็อก', 'Restock')} subtitle={t(`${item.name} · ตอนนี้ ${fmt(item.stock, locale)} ${item.unit}`, `${item.name} · now ${fmt(item.stock, locale)} ${item.unit}`)} />
      <Stepper value={amount} step={restockStep(item)} unit={item.unit} onChange={setAmount} />
      <QuickChips amounts={quickAmounts(item)} value={amount} onPick={setAmount} />
      <KeyValue label={t('คงเหลือหลังเติม', 'Stock after')} value={`${fmt(Number(item.stock) + amount, locale)} ${item.unit}`} />
      {cost > 0 ? <KeyValue label={t('จะบันทึกรายจ่าย', 'Expense recorded')} value={money(cost, language)} /> : null}
      <SheetFooter>
        <SheetButton label={t(`บันทึก +${fmt(amount, locale)} ${item.unit}`, `Save +${fmt(amount, locale)} ${item.unit}`)} onPress={() => onSubmit(amount)} disabled={busy || amount <= 0} />
      </SheetFooter>
    </BottomSheet>
  );
}

/** Set the counted quantity. Zero is allowed and means the shelf is empty. */
export function CountSheet({
  item,
  open,
  onClose,
  onSubmit,
  busy,
  language,
  locale,
}: {
  item: Ingredient | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: NonNullable<ReturnType<typeof countPayload>> | null) => void;
  busy: boolean;
  language: DisplayLanguage;
  locale: string;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [amount, setAmount] = useState(0);
  useEffect(() => { if (open && item) setAmount(Number(item.stock)); }, [open, item]);
  if (!item) return null;
  const difference = amount - Number(item.stock);
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.58} label={t('ปิด', 'Close')} showClose>
      <SheetTitle title={t('ปรับยอด', 'Set count')} subtitle={item.name} />
      <Stepper value={amount} step={restockStep(item)} unit={item.unit} onChange={setAmount} />
      <KeyValue
        label={t('ส่วนต่าง', 'Difference')}
        value={`${difference > 0 ? '+' : ''}${fmt(difference, locale)} ${item.unit}`}
        tone={difference > 0 ? 'ok' : difference < 0 ? 'bad' : undefined}
      />
      {amount === 0 ? (
        <Text style={{ paddingHorizontal: 16, marginTop: 8, fontSize: 11.5, color: palette.placeholder }}>{t('นับได้ 0 จะบันทึกเป็นการตัดออกทั้งหมด', 'A count of 0 is saved as removing everything')}</Text>
      ) : null}
      <SheetFooter>
        <SheetButton label={t('บันทึกยอดที่นับได้', 'Save counted quantity')} onPress={() => onSubmit(countPayload(item, amount))} disabled={busy} />
      </SheetFooter>
    </BottomSheet>
  );
}

/** A short text action in the header, the same material as the round buttons. */
export function HeaderTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <GlassPanel radius={HEADER_BUTTON / 2} style={{ height: HEADER_BUTTON, paddingHorizontal: 14, justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: palette.textStrong }}>{label}</Text>
      </GlassPanel>
    </Pressable>
  );
}

/** The search capsule: a magnifier, the field and a clear button, in the card material. */
export function SearchCapsule({ value, onChangeText, placeholder, clearLabel }: { value: string; onChangeText: (value: string) => void; placeholder: string; clearLabel: string }) {
  return (
    <GlassPanel radius={25} interactive={false} style={{ flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, gap: 8 }} fallback={palette.surface} fallbackBorder={palette.border}>
      <AppIcon name="search-outline" size={18} color={palette.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        returnKeyType="search"
        clearButtonMode="never"
        style={{ flex: 1, fontSize: 15, color: palette.textStrong, paddingVertical: 0 }}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={() => onChangeText('')} hitSlop={8} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name="close-circle" size={18} color={palette.placeholder} />
        </Pressable>
      ) : null}
    </GlassPanel>
  );
}

/** A choice chip for the filter sheet: solid orange when on, the card material when not. */
export function ChoiceChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      {on ? (
        <View style={{ height: 38, paddingHorizontal: 14, borderRadius: 999, backgroundColor: palette.primary, justifyContent: 'center' }}>
          <Text style={{ fontSize: 13.5, fontWeight: '600', color: '#fff' }}>{label}</Text>
        </View>
      ) : (
        <GlassPanel radius={19} style={{ height: 38, paddingHorizontal: 14, justifyContent: 'center' }} fallback={palette.surface} fallbackBorder={palette.border}>
          <Text style={{ fontSize: 13.5, fontWeight: '500', color: palette.text }}>{label}</Text>
        </GlassPanel>
      )}
    </Pressable>
  );
}

/**
 * A percentage picked by dragging, with the quantity it comes to shown against
 * the shelf it belongs to.
 *
 * Typing a number means working out what 20% of this particular shelf is before
 * you can tell whether you meant it; dragging lets you find the quantity you
 * wanted and read the percentage off afterwards. It steps in fives because
 * nobody reorders at 23%, and every step is felt as well as seen.
 */
export function PercentSlider({
  value,
  maxStock,
  unit,
  locale,
  onChange,
}: {
  value: number;
  maxStock: number;
  unit: string;
  locale: string;
  onChange: (percent: number) => void;
}) {
  const KNOB = 26;
  const [width, setWidth] = useState(0);
  const travel = Math.max(1, width - KNOB);
  // The responder is built once, so the live figures reach it through a ref.
  const live = useRef({ travel, onChange, value });
  live.current = { travel, onChange, value };

  const percentAt = (x: number) => {
    const share = Math.max(0, Math.min(1, (x - KNOB / 2) / live.current.travel));
    return Math.round((share * 100) / 5) * 5;
  };
  const settle = (percent: number) => {
    if (percent === live.current.value) return;
    void Haptics.selectionAsync();
    live.current.onChange(percent);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => settle(percentAt(event.nativeEvent.locationX)),
      onPanResponderMove: (event) => settle(percentAt(event.nativeEvent.locationX)),
    }),
  ).current;

  const left = (value / 100) * travel;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 }}>
      <View {...pan.panHandlers} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height: 34, justifyContent: 'center' }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: palette.surfaceStrong }}>
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: left + KNOB / 2, borderRadius: 4, backgroundColor: palette.primary, opacity: 0.55 }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left,
            width: KNOB,
            height: KNOB,
            borderRadius: KNOB / 2,
            backgroundColor: palette.surface,
            borderWidth: 2,
            borderColor: palette.primary,
            shadowColor: '#3d2b1f',
            shadowOpacity: 0.22,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 2 },
            elevation: 3,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={{ fontSize: 11, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>0%</Text>
        <Text style={{ fontSize: 12, fontWeight: '600', color: palette.primaryInk, fontVariant: ['tabular-nums'] }}>
          {fmt(reorderQuantityFor(maxStock, value), locale)} {unit}
        </Text>
        <Text style={{ fontSize: 11, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>100%</Text>
      </View>
    </View>
  );
}

export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: palette.muted, letterSpacing: 0.2, marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

// ------------------------------------------------------------ dates

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "10 ก.ย. 69" / "10 Sep 2026". */
export function shortDate(iso: string | undefined, language: DisplayLanguage): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  if (language === 'th') return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${String(date.getFullYear() + 543).slice(-2)}`;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortTime(iso: string | undefined, language: DisplayLanguage): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** The day heading over a run of history rows: "วันนี้ · 10 ก.ย. 69", "เมื่อวาน · …", or the date alone. */
export function dayHeading(iso: string | undefined, language: DisplayLanguage, now = new Date()): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  const label = shortDate(iso, language);
  if (days === 0) return language === 'th' ? `วันนี้ · ${label}` : `Today · ${label}`;
  if (days === 1) return language === 'th' ? `เมื่อวาน · ${label}` : `Yesterday · ${label}`;
  return label;
}

export function dayKey(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// ------------------------------------------------ the grouped form
// iOS-style: a caption, a white card of rows, the label left and the value right.

/** A section: a small caption, a white card of rows, an optional note under it. */
export function FormGroup({ title, footer, action, children }: { title?: string; footer?: string; /** A control on the caption's right — a mode switch for the rows below. */ action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      {title || action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 16, marginRight: 16, marginBottom: 7 }}>
          <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{title ?? ''}</Text>
          {action}
        </View>
      ) : null}
      <View style={{ backgroundColor: palette.surface, borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}>
        {children}
      </View>
      {footer ? <Text style={{ fontSize: 12, color: palette.placeholder, marginHorizontal: 16, marginTop: 7, lineHeight: 17 }}>{footer}</Text> : null}
    </View>
  );
}

/** A row with the label on the left and whatever is typed on the right. */
export function FormRow({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 16, paddingRight: 16, gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <Text style={{ fontSize: 15.5, color: palette.text, minWidth: 96 }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>{children}</View>
    </View>
  );
}

export function FormField({
  value,
  onChangeText,
  placeholder,
  numeric,
  prefix,
  suffix,
  readOnly,
  autoCapitalize,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  prefix?: string;
  suffix?: string;
  readOnly?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
}) {
  if (readOnly) {
    return (
      <Text numberOfLines={1} style={{ fontSize: 15.5, color: palette.muted, textAlign: 'right', fontVariant: numeric ? ['tabular-nums'] : undefined }}>
        {prefix ? `${prefix} ` : ''}{value || '—'}{suffix ? ` ${suffix}` : ''}
      </Text>
    );
  }
  return (
    <>
      {prefix ? <Text style={{ fontSize: 15.5, color: palette.placeholder }}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        keyboardType={numeric ? 'decimal-pad' : undefined}
        autoCapitalize={autoCapitalize ?? (numeric ? 'none' : 'sentences')}
        selectTextOnFocus={numeric}
        style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 15.5, color: palette.textStrong, paddingVertical: 0, fontVariant: numeric ? ['tabular-nums'] : undefined }}
      />
      {suffix ? <Text style={{ fontSize: 13.5, color: palette.placeholder }}>{suffix}</Text> : null}
    </>
  );
}

/** A row that opens a picker: the chosen value on the right, a chevron after it. */
export function FormPickRow({ label, value, first, onPress }: { label: string; value: string; first?: boolean; onPress?: () => void }) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 16, paddingRight: onPress ? 10 : 16, gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <Text style={{ fontSize: 15.5, color: palette.text, minWidth: 96 }}>{label}</Text>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontSize: 15.5, color: onPress ? palette.textStrong : palette.muted }}>{value}</Text>
      {onPress ? <AppIcon name="chevron-forward" size={17} color={palette.placeholder} /> : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? palette.surfaceSubtle : 'transparent' })}>
      {inner}
    </Pressable>
  );
}
