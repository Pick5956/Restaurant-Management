import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, Switch, View, type KeyboardTypeOptions, type TextInput as NativeTextInput } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { BottomSheet } from '@/src/components/ai/chrome';
import { SheetTitle } from '@/src/components/inventory/parts';
import { useReducedMotion } from '@/src/components/motion';
import { chipRevealOffset } from '@/src/lib/chip-row-reveal';
import { calendarWeeks, monthTitle } from '@/src/lib/report-view';
import { CardHeading, ReportCard } from '@/src/components/reports/parts';
import { ActionDock, Button } from '@/src/components/ui';
import { palette } from '@/src/theme';

// The pieces every editing screen under settings, staff and expenses is built
// from (15 ก.ย. 2569): a white card with a warm hairline and an icon tile in
// its heading, a 44pt field, a row with a switch or a tick, chips that turn
// black when chosen, and the orange save button pinned above the home bar.
// Before this each screen had its own mix of boxed sections and 54pt fields.

type Language = 'th' | 'en';
export const FORM_MAX_WIDTH = 620;

const FOLD_MS = 280;

/**
 * What a fold hides, sliding open and shut. The contents stay mounted and are
 * measured on their own (absolutely placed, so the clipped height never
 * squeezes them); only the height of the window onto them and their opacity
 * move. This replaced LayoutAnimation on 25 ก.ย. 2569: folding a card with
 * that, which unmounts a subtree full of text fields mid-animation, closed the
 * app on iOS with no JS error at all.
 */
export function FoldBody({ open, children }: { open: boolean; children: ReactNode }) {
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [contentHeight, setContentHeight] = useState(0);
  useEffect(() => {
    if (reducedMotion) { progress.setValue(open ? 1 : 0); return; }
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: FOLD_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: false }).start();
  }, [open, progress, reducedMotion]);
  return (
    <Animated.View
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      pointerEvents={open ? 'auto' : 'none'}
      style={{ overflow: 'hidden', height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] }), opacity: progress }}
    >
      <View
        onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

/** A chevron that turns to point up while its section is open. */
export function FoldChevron({ open }: { open: boolean }) {
  const reducedMotion = useReducedMotion();
  const turn = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) { turn.setValue(open ? 1 : 0); return; }
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: FOLD_MS, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
  }, [open, reducedMotion, turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <AppIcon name="chevron-down" size={18} color={palette.placeholder} />
    </Animated.View>
  );
}

/**
 * A card with a heading; `icon` gives the heading a tinted tile. With
 * `onToggle` the heading folds the card away: a turning chevron at its end,
 * the whole heading the target, and only the heading left while `collapsed`.
 * The heading does not tint when pressed; the motion is the answer to the tap.
 */
export function FormCard({ icon, title, detail, trailing, children, style, collapsed = false, onToggle }: {
  icon?: AppIconName;
  title?: string;
  detail?: string;
  trailing?: ReactNode;
  children: ReactNode;
  style?: object;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const chevron = onToggle ? <FoldChevron open={!collapsed} /> : null;
  const heading = title ? (
    icon ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: collapsed ? 10 : 6 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
          <AppIcon name={icon} size={18} color={palette.primaryInk} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
          {detail ? <Text numberOfLines={2} style={{ fontSize: 12, color: palette.placeholder }}>{detail}</Text> : null}
        </View>
        {collapsed ? null : trailing}
        {chevron}
      </View>
    ) : (
      <CardHeading title={title} detail={detail} trailing={<>{collapsed ? null : trailing}{chevron}</>} />
    )
  ) : null;
  return (
    <ReportCard style={style}>
      {heading && onToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggle}
        >
          {heading}
        </Pressable>
      ) : heading}
      {onToggle ? <FoldBody open={!collapsed}>{children}</FoldBody> : children}
    </ReportCard>
  );
}

/** The padded inside of a card that holds fields. */
export function FormBody({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[{ paddingHorizontal: 14, paddingTop: 6, paddingBottom: 14, gap: 12 }, style]}>{children}</View>;
}

/** Two fields side by side. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

export const Field = forwardRef<NativeTextInput, {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  icon?: AppIconName;
  /** Words after the value: "%", "โต๊ะ", "เมตร". */
  unit?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  editable?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'next';
  /** Take the row's share of a FieldRow. */
  grow?: boolean;
  /** What is wrong with the value, in red under the field. */
  error?: string;
  /** A fixed width, for a short value beside a growing one. */
  width?: number;
  /** Named for screen readers when there is no visible label. */
  accessibilityLabel?: string;
}>(function Field({ label, value, onChangeText, placeholder, icon, unit, keyboardType, multiline, maxLength, autoCapitalize, editable = true, onSubmitEditing, returnKeyType, grow, error, width, accessibilityLabel }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 4, ...(grow ? { flex: 1, minWidth: 0 } : {}), ...(width ? { width } : {}) }}>
      {label ? <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 8, minHeight: multiline ? 84 : 44, paddingHorizontal: 12, paddingVertical: multiline ? 10 : 0, borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, borderColor: error ? palette.danger : focused ? palette.primary : palette.fieldBorder, backgroundColor: editable ? palette.fieldFill : '#FAF7F4' }}>
        {icon ? <AppIcon name={icon} size={18} color={focused ? palette.primaryInk : palette.placeholder} /> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label ?? accessibilityLabel}
          autoCapitalize={autoCapitalize ?? (keyboardType === 'email-address' ? 'none' : 'sentences')}
          autoCorrect={keyboardType !== 'email-address'}
          editable={editable}
          keyboardAppearance="light"
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={palette.placeholder}
          returnKeyType={returnKeyType}
          selectionColor={palette.primary}
          style={{ flex: 1, minWidth: 0, fontSize: 15, color: editable ? palette.textStrong : palette.muted, paddingVertical: 0, textAlignVertical: multiline ? 'top' : 'center', minHeight: multiline ? 64 : undefined }}
          value={value}
        />
        {unit ? <Text style={{ fontSize: 12.5, color: palette.placeholder }}>{unit}</Text> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ fontSize: 12, lineHeight: 17, fontWeight: '600', color: palette.danger }}>{error}</Text> : null}
    </View>
  );
});

/** A row in a card that opens or holds one setting. */
function Row({ children, first, onPress, label, disabled }: { children: ReactNode; first?: boolean; onPress?: () => void; label?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      disabled={!onPress || disabled}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: '#F3EDE7', backgroundColor: pressed ? palette.surfaceSubtle : palette.surface, opacity: disabled ? 0.5 : 1 })}
    >
      {children}
    </Pressable>
  );
}

function RowWords({ title, detail, tone }: { title: string; detail?: string; tone?: 'danger' }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: tone === 'danger' ? palette.danger : palette.textStrong }}>{title}</Text>
      {detail ? <Text style={{ fontSize: 12, lineHeight: 17, color: palette.placeholder }}>{detail}</Text> : null}
    </View>
  );
}

export function SwitchRow({ title, detail, value, onChange, first, disabled, icon }: {
  title: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  first?: boolean;
  disabled?: boolean;
  icon?: AppIconName;
}) {
  return (
    <Row first={first} onPress={() => onChange(!value)} label={`${title}${detail ? `, ${detail}` : ''}`} disabled={disabled}>
      {icon ? <AppIcon name={icon} size={19} color={palette.placeholder} /> : null}
      <RowWords title={title} detail={detail} />
      <Switch
        accessibilityLabel={title}
        disabled={disabled}
        ios_backgroundColor="#E4D8CD"
        onValueChange={onChange}
        thumbColor="#fff"
        trackColor={{ false: '#E4D8CD', true: palette.primary }}
        value={value}
      />
    </Row>
  );
}

export function CheckRow({ title, detail, checked, onPress, first }: { title: string; detail?: string; checked: boolean; onPress: () => void; first?: boolean }) {
  return (
    <Row first={first} onPress={onPress} label={`${title}${checked ? ', เลือกอยู่' : ''}`}>
      <RowWords title={title} detail={detail} />
      <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: checked ? palette.primary : '#E4D8CD', backgroundColor: checked ? palette.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <AppIcon name="checkmark" size={14} color="#fff" /> : null}
      </View>
    </Row>
  );
}

/** A row that leads somewhere or does something; `tone` danger for signing out and the like. */
export function ActionRow({ icon, title, detail, onPress, first, trailing, tone }: { icon?: AppIconName; title: string; detail?: string; onPress?: () => void; first?: boolean; trailing?: ReactNode; tone?: 'danger' }) {
  return (
    <Row first={first} onPress={onPress} label={`${title}${detail ? `, ${detail}` : ''}`}>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'danger' ? palette.dangerSoft : palette.surfaceSubtle }}>
          <AppIcon name={icon} size={19} color={tone === 'danger' ? palette.danger : palette.primaryInk} />
        </View>
      ) : null}
      <RowWords title={title} detail={detail} tone={tone} />
      {trailing}
      {onPress && !trailing ? <AppIcon name="chevron-forward" size={16} color={palette.placeholder} /> : null}
    </Row>
  );
}

/**
 * One sideways offset shared by two rows of the same chips - the menu's
 * filter bar and the compact header's row - so the row that comes into view
 * is where the other one was left. Each row registers a follower; a scroll on
 * one row moves the others, clamped to their own range.
 */
/**
 * Rows of the same chips that scroll sideways as one. `placed` is set once any
 * of them has moved: a row laid out after that takes the shared position
 * instead of revealing its chosen chip on its own.
 */
export type ChipRowSync = { x: number; placed: boolean; followers: Set<(x: number) => void> };

export function createChipRowSync(): ChipRowSync {
  return { x: 0, placed: false, followers: new Set() };
}

/** Chips that turn black when chosen, wrapping onto more lines as needed. */
export function ChoiceChips<T extends string | number>({ options, value, onChange, scroll, sync }: {
  options: { key: T; label: string; icon?: AppIconName; tint?: { wash: string; ink: string } }[];
  value: T;
  onChange: (key: T) => void;
  /** One row that scrolls sideways instead of wrapping. */
  scroll?: boolean;
  /** Scroll as one with the other rows sharing this. */
  sync?: ChipRowSync;
}) {
  // A row that scrolls keeps its chosen chip in view. The menu draws these
  // chips twice, in its filter bar and in the compact header's row, each
  // scrolled on its own: a chip picked in one would otherwise sit past the edge
  // of the other, and that row would read as nothing chosen. With `sync` the
  // two also share every sideways drag, so the bar's row takes over from the
  // page's exactly where the reader left it.
  const rowRef = useRef<ScrollView>(null);
  const chipBoxes = useRef(new Map<T, { x: number; width: number }>());
  const rowBox = useRef({ offset: 0, viewport: 0, content: 0 });
  // Whether this is the row the reader is moving: from the finger going down
  // until its fling has stopped, and never once another row leads. Only that
  // row moves the others. A row moved by code - a follow, a reveal - used to
  // lead too: its scroll events arrived after the next follow had gone out,
  // read as a drag of its own, and pulled the dragged row back under the
  // finger. That was the wobble at the ends of the menu's chips (owner,
  // 2026-09-25); a lone row, as on the order screen, never had it. The row
  // still stretches past its ends like any list - that bounce is the reader's.
  const touching = useRef(false);
  // This row's own entry in `sync.followers`, which a lead skips.
  const ownFollow = useRef<((x: number) => void) | null>(null);
  const revealChosen = (animated: boolean) => {
    const target = chipRevealOffset({ chip: chipBoxes.current.get(value), ...rowBox.current });
    if (target !== null) rowRef.current?.scrollTo({ x: target, animated });
  };
  const revealChosenRef = useRef(revealChosen);
  revealChosenRef.current = revealChosen;
  // The shared position, clamped to this row's own range.
  const followTo = (x: number) => {
    const { offset, viewport, content } = rowBox.current;
    if (!(viewport > 0) || !(content > 0)) return;
    const target = Math.min(Math.max(0, content - viewport), Math.max(0, x));
    if (Math.abs(target - offset) < 1) return;
    rowRef.current?.scrollTo({ x: target, animated: false });
  };
  const followToRef = useRef(followTo);
  followToRef.current = followTo;
  // Laid out, or its content or chosen chip measured: a row nobody has moved
  // yet shows its chosen chip; one laid out after the reader moved another
  // (the bar's, back after a search) takes that position instead of jumping
  // to its own choice.
  const settle = () => {
    if (sync?.placed) followToRef.current(sync.x);
    else revealChosenRef.current(false);
  };
  useEffect(() => {
    if (scroll) revealChosenRef.current(true);
  }, [scroll, value]);
  useEffect(() => {
    if (!scroll || !sync) return undefined;
    const follow = (x: number) => {
      touching.current = false;
      followToRef.current(x);
    };
    ownFollow.current = follow;
    sync.followers.add(follow);
    if (sync.placed) follow(sync.x);
    return () => {
      sync.followers.delete(follow);
      ownFollow.current = null;
    };
  }, [scroll, sync]);
  const lead = (x: number) => {
    if (!sync || !touching.current) return;
    // Past either end is this row's own stretch; the others hold their edge.
    const { viewport, content } = rowBox.current;
    const clamped = Math.min(Math.max(0, content - viewport), Math.max(0, x));
    sync.placed = true;
    if (Math.abs(sync.x - clamped) < 1) return;
    sync.x = clamped;
    sync.followers.forEach((follow) => {
      if (follow !== ownFollow.current) follow(clamped);
    });
  };

  const chips = options.map((option) => {
    const on = option.key === value;
    return (
      <Pressable
        key={String(option.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        onPress={() => onChange(option.key)}
        onLayout={scroll ? (event) => {
          const { x, width } = event.nativeEvent.layout;
          chipBoxes.current.set(option.key, { x, width });
          if (on) settle();
        } : undefined}
        hitSlop={4}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? palette.textStrong : palette.divider, backgroundColor: on ? palette.textStrong : palette.surface, opacity: pressed ? 0.7 : 1 })}
      >
        {option.icon ? <AppIcon name={option.icon} size={15} color={on ? '#fff' : option.tint?.ink ?? palette.muted} /> : null}
        <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#fff' : palette.muted }}>{option.label}</Text>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView
        ref={rowRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0, flexShrink: 0, maxWidth: '100%' }}
        contentContainerStyle={{ gap: 7 }}
        // Whichever of the row, its content and the chosen chip is measured
        // last settles the row (see `settle`); each call is a no-op until all
        // three are known. No `bounces={false}`: the stretch past either end is
        // what every scrolling list does (owner, 2026-09-25).
        onLayout={(event) => {
          rowBox.current = { ...rowBox.current, viewport: event.nativeEvent.layout.width };
          settle();
        }}
        onContentSizeChange={(contentWidth) => {
          rowBox.current = { ...rowBox.current, content: contentWidth };
          settle();
        }}
        onScrollBeginDrag={() => { touching.current = true; }}
        onMomentumScrollEnd={() => { touching.current = false; }}
        onScroll={(event) => {
          const x = event.nativeEvent.contentOffset.x;
          rowBox.current = { ...rowBox.current, offset: x };
          lead(x);
        }}
        scrollEventThrottle={16}
      >
        {chips}
      </ScrollView>
    );
  }
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>{chips}</View>;
}

/**
 * ChoiceChips for picking any number: each chip turns black on its own.
 *
 * With `limit`, a long list shows its first `limit` chips and a "+ อีก N"
 * chip that slides the rest open. A chosen chip from the hidden part is shown
 * with the first ones, so nothing chosen is ever out of sight. Which chips
 * those are is fixed when the list folds, not recomputed on every tap: a chip
 * never jumps between the parts under the finger.
 */
export function ToggleChips<T extends string | number>({ options, selected, onToggle, limit, moreLabel, lessLabel }: {
  options: { key: T; label: string; muted?: boolean }[];
  selected: readonly T[];
  onToggle: (key: T) => void;
  limit?: number;
  /** "+ อีก 12 หมวด", given how many are hidden. */
  moreLabel?: (hidden: number) => string;
  lessLabel?: string;
}) {
  const folds = limit !== undefined && options.length > limit + 2;
  const [open, setOpen] = useState(false);
  const pinnedFor = () => options.slice(limit ?? 0).filter((option) => selected.includes(option.key)).map((option) => option.key);
  const [pinned, setPinned] = useState<T[]>(pinnedFor);
  const pinnedForRef = useRef(pinnedFor);
  pinnedForRef.current = pinnedFor;
  // The list usually arrives after the first render (a screen loading its
  // categories): take the chosen ones once it does.
  useEffect(() => {
    setPinned(pinnedForRef.current());
  }, [options.length]);
  const chip = (option: { key: T; label: string; muted?: boolean }) => {
    const on = selected.includes(option.key);
    return (
      <Pressable
        key={String(option.key)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        onPress={() => onToggle(option.key)}
        hitSlop={4}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? palette.textStrong : palette.divider, backgroundColor: on ? palette.textStrong : palette.surface, opacity: pressed ? 0.7 : 1 })}
      >
        {on ? <AppIcon name="checkmark" size={14} color="#fff" /> : null}
        <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#fff' : option.muted ? palette.placeholder : palette.muted }}>{option.label}</Text>
      </Pressable>
    );
  };
  const wrap = { flexDirection: 'row', flexWrap: 'wrap', gap: 7 } as const;
  if (!folds) return <View style={wrap}>{options.map(chip)}</View>;

  const first = options.slice(0, limit).concat(options.slice(limit).filter((option) => pinned.includes(option.key)));
  const rest = options.slice(limit).filter((option) => !pinned.includes(option.key));
  const toggle = (
    <Pressable
      key="fold"
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => {
        // Folding again takes a fresh look at what is chosen down there.
        if (open) setPinned(pinnedFor());
        setOpen(!open);
      }}
      hitSlop={4}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: palette.surfaceSubtle, opacity: pressed ? 0.7 : 1 })}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: palette.primaryInk }}>{open ? lessLabel : moreLabel?.(rest.length)}</Text>
    </Pressable>
  );
  return (
    <View>
      <View style={wrap}>
        {first.map(chip)}
        {open ? null : toggle}
      </View>
      <FoldBody open={open}>
        <View style={[wrap, { paddingTop: 7 }]}>
          {rest.map(chip)}
          {open ? toggle : null}
        </View>
      </FoldBody>
    </View>
  );
}

/** A pill with one white thumb: the staff tabs, an invitation's lifetime, "ตามบทบาท | กำหนดเอง". */
export function PillTabs<T extends string | number>({ tabs, value, onChange, role = 'tablist' }: { tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void; role?: 'tablist' | 'radiogroup' }) {
  return (
    <View accessibilityRole={role} style={{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.divider }}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable
            key={String(tab.key)}
            accessibilityRole={role === 'tablist' ? 'tab' : 'radio'}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', height: 34, borderRadius: 999, backgroundColor: on ? palette.surface : 'transparent', opacity: pressed && !on ? 0.6 : 1, ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) })}
          >
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: on ? '700' : '600', color: on ? palette.textStrong : palette.muted }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A short explanation in a tinted box. */
export function Note({ icon = 'information-circle-outline', text, tone = 'accent' }: { icon?: AppIconName; text: string; tone?: 'accent' | 'info' | 'warning' | 'danger' | 'success' }) {
  const look = tone === 'info' ? { wash: '#E0F2FE', ink: '#0369A1', words: '#0C4A6E' }
    : tone === 'warning' ? { wash: palette.warningSoft, ink: palette.warning, words: '#78350F' }
      : tone === 'danger' ? { wash: palette.dangerSoft, ink: palette.danger, words: '#7F1D1D' }
        : tone === 'success' ? { wash: palette.successSoft, ink: palette.success, words: '#064E3B' }
          : { wash: palette.surfaceSubtle, ink: palette.primaryInk, words: palette.muted };
  return (
    <View accessible style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, borderCurve: 'continuous', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: look.wash }}>
      <View style={{ paddingTop: 1 }}><AppIcon name={icon} size={16} color={look.ink} /></View>
      <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: look.words }}>{text}</Text>
    </View>
  );
}

/**
 * The quiet red line at the foot of a page — hide this role, delete this
 * entry. A tap turns it into the question with two buttons; nothing happens
 * until the red one is tapped.
 */
export function DangerAction({ icon, label, confirmLabel, message, error, onConfirm, onCancel, cancelLabel, loading, open, onOpen, confirmVariant = 'danger', confirmIcon }: {
  icon: AppIconName;
  label: string;
  confirmLabel: string;
  message: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel: string;
  loading?: boolean;
  open: boolean;
  onOpen: () => void;
  /**
   * The confirm button's look. 'secondary' is for a question whose answer is
   * not the destructive act itself - a zone that still has tables leads on to
   * choosing them rather than deleting anything.
   */
  confirmVariant?: 'danger' | 'secondary';
  confirmIcon?: AppIconName;
}) {
  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={onOpen} hitSlop={8} style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
        <AppIcon name={icon} size={15} color={palette.danger} />
        <Text style={{ fontSize: 13.5, fontWeight: '600', color: palette.danger }}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <ReportCard style={{ borderColor: '#FECACA' }}>
      <View style={{ padding: 14, gap: 12 }}>
        <View accessible accessibilityLiveRegion={error ? 'assertive' : 'polite'} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ paddingTop: 1 }}><AppIcon name="alert-circle-outline" size={18} color={palette.danger} /></View>
          <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 19, color: error ? palette.danger : palette.text }}>{error || message}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button variant="secondary" label={cancelLabel} onPress={onCancel} disabled={loading} style={{ flex: 1 }} />
          <Button variant={confirmVariant} icon={confirmIcon ?? icon} label={confirmLabel} onPress={onConfirm} loading={loading} style={{ flex: 1 }} />
        </View>
      </View>
    </ReportCard>
  );
}

/** The one orange button pinned above the home bar. */
export function SaveDock({ label, icon = 'checkmark', onPress, loading, disabled, variant = 'primary' }: { label: string; icon?: AppIconName; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'danger' }) {
  return (
    <ActionDock separated={false}>
      <Button icon={icon} variant={variant} label={label} onPress={onPress} loading={loading} disabled={disabled} />
    </ActionDock>
  );
}

// ---------------------------------------------------------------- permissions

export type PermissionGroup = { title: string; rows: { key: string; label: string }[] };

/**
 * Every permission the shop knows, one card per group with a switch on each
 * row and "เลือกทั้งกลุ่ม" on the heading. Shared by the role editor and a
 * member's custom permissions, so both read the same. A row this person may
 * not grant is dimmed and locked.
 */
export function PermissionGroups({ groups, selected, grantable, onToggle, onToggleGroup, columns, language }: {
  groups: PermissionGroup[];
  selected: readonly string[];
  grantable: (key: string) => boolean;
  onToggle: (key: string) => void;
  onToggleGroup: (keys: string[], on: boolean) => void;
  /** Two columns on a tablet. */
  columns?: boolean;
  language: Language;
}) {
  const th = language === 'th';
  const cards = groups.map((group) => {
    const keys = group.rows.map((row) => row.key);
    const on = keys.filter((key) => selected.includes(key)).length;
    const all = on === keys.length;
    const canChangeAny = keys.some(grantable);
    return (
      <FormCard
        key={group.title}
        title={group.title}
        detail={th ? `${on} จาก ${keys.length}` : `${on} of ${keys.length}`}
        style={columns ? { flexBasis: '48%', flexGrow: 1, minWidth: 260 } : undefined}
        trailing={canChangeAny ? (
          <Pressable accessibilityRole="button" onPress={() => onToggleGroup(keys.filter(grantable), !all)} hitSlop={6} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.primaryInk }}>{all ? (th ? 'ยกเลือกทั้งกลุ่ม' : 'Clear group') : (th ? 'เลือกทั้งกลุ่ม' : 'Select group')}</Text>
          </Pressable>
        ) : undefined}
      >
        {group.rows.map((row, index) => (
          <SwitchRow key={row.key} first={index === 0} title={row.label} value={selected.includes(row.key)} onChange={() => onToggle(row.key)} disabled={!grantable(row.key)} />
        ))}
      </FormCard>
    );
  });
  if (columns) return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{cards}</View>;
  return <View style={{ gap: 12 }}>{cards}</View>;
}

// ---------------------------------------------------------------- one day

/**
 * Picking one day: the reports screen's calendar, one tap. Days after today
 * cannot be picked.
 */
export function DayPickerSheet({ open, onClose, value, today, onPick, language }: {
  open: boolean;
  onClose: () => void;
  value: string;
  today: string;
  onPick: (date: string) => void;
  language: Language;
}) {
  const th = language === 'th';
  const [month, setMonth] = useState(() => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }));
  useEffect(() => {
    if (!open) return;
    setMonth({ year: Number(value.slice(0, 4)) || Number(today.slice(0, 4)), month: Number(value.slice(5, 7)) || Number(today.slice(5, 7)) });
  }, [open, today, value]);
  const thisMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const atLatestMonth = month.year > thisMonth.year || (month.year === thisMonth.year && month.month >= thisMonth.month);
  const stepMonth = (delta: number) => setMonth((current) => {
    const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
  });
  const weekdays = th ? ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.62} label={th ? 'ปิด' : 'Close'} showClose>
      <SheetTitle title={th ? 'เลือกวัน' : 'Choose a day'} subtitle={th ? 'แตะวันที่ในปฏิทิน' : 'Tap a day on the calendar'} />
      <View style={{ paddingHorizontal: 16 }}>
        <ReportCard>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={th ? 'เดือนก่อน' : 'Previous month'} onPress={() => stepMonth(-1)} hitSlop={6} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <AppIcon name="chevron-back" size={20} color={palette.primaryInk} />
            </Pressable>
            <Text style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong }}>{monthTitle(month.year, month.month, language)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={th ? 'เดือนถัดไป' : 'Next month'} disabled={atLatestMonth} onPress={() => stepMonth(1)} hitSlop={6} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <AppIcon name="chevron-forward" size={20} color={atLatestMonth ? '#D6C3B6' : palette.primaryInk} />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6 }}>
            {weekdays.map((name) => <Text key={name} style={{ flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '600', color: palette.placeholder }}>{name}</Text>)}
          </View>
          <View style={{ paddingHorizontal: 8, paddingBottom: 10, paddingTop: 4, gap: 2 }}>
            {calendarWeeks(month.year, month.month).map((week, index) => (
              <View key={index} style={{ flexDirection: 'row' }}>
                {week.map((day, cellIndex) => {
                  if (!day) return <View key={`e${cellIndex}`} style={{ flex: 1, height: 42 }} />;
                  const future = day > today;
                  const on = day === value;
                  return (
                    <View key={day} style={{ flex: 1, height: 42, justifyContent: 'center' }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: on, disabled: future }}
                        disabled={future}
                        onPress={() => { onPick(day); onClose(); }}
                        style={({ pressed }) => ({ alignSelf: 'center', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? palette.primary : pressed ? palette.surfaceSubtle : 'transparent' })}
                      >
                        <Text style={{ fontSize: 14.5, fontWeight: on || day === today ? '700' : '500', color: future ? '#D6C3B6' : on ? '#fff' : day === today ? palette.primaryInk : palette.textStrong, fontVariant: ['tabular-nums'] }}>{Number(day.slice(8))}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ReportCard>
      </View>
    </BottomSheet>
  );
}
