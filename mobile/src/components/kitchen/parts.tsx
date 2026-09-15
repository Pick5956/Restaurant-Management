import { useState, type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Pressable, ScrollView, View, type DimensionValue, type ViewStyle } from 'react-native';

import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { HomeCard } from '@/src/components/home/parts';
import { useTabSwipeExclusionHandlers } from '@/src/components/tab-swipe-context';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { SheetTitle } from '@/src/components/inventory/parts';
import { ChipGroup, TextField } from '@/src/components/ui';
import { formatKitchenMinutes, kitchenClockLabel, lanesOutOfSight, ticketProgress, type KitchenSortMode, type KitchenUrgency } from '@/src/lib/kitchen-board';
import { palette } from '@/src/theme';

// The kitchen board's pieces, in the overview's language: white canvas, a
// heading that is type rather than chrome, three tiles, cards with a hairline
// edge. The one thing the kitchen keeps that no other screen has is the
// coloured ticket header — the owner chose it (12 ก.ย.) over a side stripe
// because it can be read from across the kitchen.

const CARD_RADIUS = 20;
const CARD_EDGE = '#E4D8CD';

/** One ticket lane on the tablet board, and the space between two. */
export const LANE_WIDTH = 300;
export const LANE_GAP = 12;

/**
 * A ticket that has not reached five minutes. Not green: most tickets on the
 * board are in this state, and a wall of green would drown the amber and red
 * that matter. The same ink as the selected day on the overview's day strip,
 * so "the dark block is the one that is current" reads the same on both.
 */
const FRESH_HEADER = '#2B1A12';

function headerColor(urgency: KitchenUrgency) {
  return urgency === 'overdue' ? palette.danger : urgency === 'warning' ? palette.warning : FRESH_HEADER;
}

// ---------------------------------------------------------------- header chip

/** Green while the live feed is connected, red when it has dropped. */
export function LiveChip({ live, language }: { live: boolean; language: 'th' | 'en' }) {
  const ink = live ? palette.success : palette.danger;
  const wash = live ? palette.successSoft : palette.dangerSoft;
  return (
    <View
      accessibilityLabel={live ? (language === 'th' ? 'เชื่อมต่อสดอยู่' : 'Live updates connected') : (language === 'th' ? 'การเชื่อมต่อสดหลุด' : 'Live updates disconnected')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: wash, borderWidth: 1, borderColor: live ? '#A7F3D0' : '#FECACA' }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ink }} />
      <Text style={{ fontSize: 12, fontWeight: '600', color: ink }}>
        {live ? (language === 'th' ? 'สด' : 'Live') : (language === 'th' ? 'หลุด' : 'Offline')}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- board heading

/**
 * "กำลังทำ" with the order switch beside it. Two words, not "เรียงจาก…": the
 * heading already says what is being ordered, and the switch has to fit next
 * to it on a phone.
 */
export function BoardHeading({ title, sort, onSort, showSort, language }: {
  title: string;
  sort: KitchenSortMode;
  onSort: (mode: KitchenSortMode) => void;
  showSort: boolean;
  language: 'th' | 'en';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AppIcon name="flame-outline" size={16} color={palette.placeholder} />
        <Text accessibilityRole="header" style={{ fontSize: 14.5, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
      </View>
      {showSort ? <SortSwitch sort={sort} onSort={onSort} language={language} /> : null}
    </View>
  );
}

/** "รอนานสุด | ล่าสุด". On the tablet it sits on the heading row by itself. */
export function SortSwitch({ sort, onSort, language }: {
  sort: KitchenSortMode;
  onSort: (mode: KitchenSortMode) => void;
  language: 'th' | 'en';
}) {
  const options: { mode: KitchenSortMode; label: string }[] = [
    { mode: 'waiting', label: language === 'th' ? 'รอนานสุด' : 'Longest wait' },
    { mode: 'latest', label: language === 'th' ? 'ล่าสุด' : 'Latest' },
  ];
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={language === 'th' ? 'เรียงตั๋ว' : 'Sort tickets'}
      style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.divider }}
    >
      {options.map((option) => {
        const on = option.mode === sort;
        return (
          <Pressable
            key={option.mode}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onSort(option.mode)}
            hitSlop={4}
            style={({ pressed }) => ({
              paddingVertical: 5,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: on ? palette.surface : 'transparent',
              opacity: pressed && !on ? 0.6 : 1,
              ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}),
            })}
          >
            <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '600', color: on ? palette.textStrong : palette.muted }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- tiles

/**
 * One of the three tiles. Unlike the overview's, the tile itself is white:
 * the tickets below carry the colour, so the tiles only tint their icon and
 * number.
 */
export function KitchenTile({ icon, label, value, suffix, tone, onPress }: {
  icon: AppIconName;
  label: string;
  value: string;
  suffix?: string;
  tone: 'brand' | 'danger' | 'success';
  onPress?: () => void;
}) {
  const ink = tone === 'danger' ? palette.danger : tone === 'success' ? palette.success : palette.primaryInk;
  const wash = tone === 'danger' ? palette.dangerSoft : tone === 'success' ? palette.successSoft : palette.accentSoft;
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}>
      <HomeCard radius={16}>
        <View style={{ paddingVertical: 10, paddingHorizontal: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: wash }}>
              <AppIcon name={icon} size={15} color={ink} />
            </View>
            {onPress ? <AppIcon name="chevron-forward" size={14} color={palette.placeholder} /> : null}
          </View>
          <Text numberOfLines={1} style={{ fontSize: 10.5, color: palette.placeholder, lineHeight: 13, marginTop: 7 }}>{label}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', lineHeight: 22, color: ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
            {suffix ? <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: palette.placeholder }}>{suffix}</Text> : null}
          </View>
        </View>
      </HomeCard>
    </Pressable>
  );
}

// ---------------------------------------------------------------- count chips

/**
 * The tablet's three counts, as chips on the heading row. They replaced the
 * three tiles there (15 ก.ย. 2569): a tile 290pt wide held a 60pt number, and
 * the row they took cost the lanes 125pt of height.
 */
export function CountChip({ icon, label, value, suffix, tone, onPress }: {
  icon: AppIconName;
  label: string;
  value: string;
  suffix?: string;
  tone: 'brand' | 'danger' | 'success';
  onPress?: () => void;
}) {
  const ink = tone === 'danger' ? palette.danger : tone === 'success' ? palette.success : palette.primaryInk;
  const wash = tone === 'danger' ? palette.dangerSoft : tone === 'success' ? palette.successSoft : palette.surfaceSubtle;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label} ${value}${suffix ? ` ${suffix}` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 12, borderRadius: 999, backgroundColor: wash, opacity: pressed ? 0.7 : 1 })}
    >
      <AppIcon name={icon} size={16} color={ink} />
      <Text style={{ fontSize: 13, fontWeight: '600', color: palette.muted }}>{label}</Text>
      <Text style={{ fontSize: 18, lineHeight: 22, fontWeight: '700', color: ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      {suffix ? <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{suffix}</Text> : null}
      {onPress ? <AppIcon name="chevron-forward" size={14} color={palette.placeholder} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------- ticket

/**
 * One kitchen round. The header is the urgency: dark under five minutes,
 * amber to ten, red past it, with the minutes in a glass capsule and a thin
 * bar along the header's bottom edge that fills at ten. Items and the footer
 * sit on white beneath it.
 */
export function Ticket({ title, titleIcon, meta, minutes, urgency, urgencyLabel, language, children, footer, style, fill = false }: {
  title: string;
  titleIcon?: AppIconName;
  meta: string;
  minutes: number;
  urgency: KitchenUrgency;
  urgencyLabel: string | null;
  language: 'th' | 'en';
  children: ReactNode;
  footer?: ReactNode;
  style?: ViewStyle;
  /**
   * A lane on the tablet board: the ticket takes the lane's full height, the
   * dishes scroll inside it, and the footer stays on the bottom edge where the
   * same thumb finds it on every lane.
   */
  fill?: boolean;
}) {
  const color = headerColor(urgency);
  const overdue = urgency === 'overdue';
  return (
    <View
      style={[{
        borderRadius: CARD_RADIUS + 2,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: overdue ? '#FECACA' : urgency === 'warning' ? '#FDE68A' : CARD_EDGE,
        backgroundColor: palette.surface,
        overflow: 'hidden',
        shadowColor: overdue ? palette.danger : palette.shadow,
        shadowOpacity: overdue ? 0.16 : 0.06,
        shadowRadius: overdue ? 14 : 10,
        shadowOffset: { width: 0, height: 6 },
        elevation: overdue ? 4 : 2,
      }, fill ? { flexDirection: 'column' } : null, style]}
    >
      <View style={{ backgroundColor: color, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {titleIcon ? <AppIcon name={titleIcon} size={20} color="rgba(255,255,255,0.8)" /> : null}
            <Text selectable numberOfLines={1} style={{ fontSize: 24, lineHeight: 30, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'], flexShrink: 1 }}>{title}</Text>
          </View>
          <Text selectable numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, color: 'rgba(255,255,255,0.82)', marginTop: 3, fontVariant: ['tabular-nums'] }}>{meta}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <View
            accessible
            accessibilityLabel={language === 'th' ? `รอมา ${minutes} นาที` : `Waiting ${minutes} min`}
            style={{ height: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 18, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }}
          >
            {/* Kanit keeps room under its glyphs for Thai marks that digits never
                use, so a number centred by its line box sits high — "90" showed
                about 4pt above the capsule's middle (14 ก.ย.). The capsule has a
                fixed height, the row is centred in it, and the row is nudged down
                by the part of the box the digits leave empty. */}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3, transform: [{ translateY: 2.5 }] }}>
              <Text style={{ fontSize: 20, lineHeight: 24, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] }}>
                {minutes.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
              </Text>
              <Text style={{ fontSize: 11, lineHeight: 16, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>{language === 'th' ? 'นาที' : 'min'}</Text>
            </View>
          </View>
          {urgencyLabel ? <Text style={{ fontSize: 10.5, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}>{urgencyLabel}</Text> : null}
        </View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(0,0,0,0.18)' }}>
          <View style={{ width: `${Math.round(ticketProgress(minutes) * 100)}%`, height: 4, backgroundColor: 'rgba(255,255,255,0.75)' }} />
        </View>
      </View>
      {fill ? <LaneItems language={language}>{children}</LaneItems> : children}
      {footer ? <View style={{ borderTopWidth: 1, borderTopColor: palette.divider, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, paddingLeft: 14 }}>{footer}</View> : null}
    </View>
  );
}

/**
 * The dishes of a lane, scrolling inside the lane when there are more than fit.
 *
 * The list ends on a hairline. On the phone the footer's top border sat right
 * under the last dish and closed the list; in a lane the footer is pinned to
 * the bottom edge, so without its own line the last dish ran straight into
 * the empty space below it (the owner saw it under "ลาบหมู", 15 ก.ย. 2569).
 *
 * When dishes run past the bottom, a chip says so until the list is scrolled to
 * its end: a dish nobody scrolls to is a dish nobody cooks.
 */
function LaneItems({ children, language }: { children: ReactNode; language: 'th' | 'en' }) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const moreBelow = viewport > 0 && content - viewport - offset > 8;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onContentSizeChange={(_, height) => setContent(height)}
        onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
      >
        <View style={{ borderBottomWidth: 1, borderBottomColor: palette.divider }}>{children}</View>
      </ScrollView>
      {moreBelow ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 56, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8 }}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.96)']}
            locations={[0, 0.6]}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: palette.surfaceStrong }}>
            <AppIcon name="chevron-down" size={14} color={palette.primaryInk} />
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: palette.primaryInk }}>{language === 'th' ? 'เลื่อนดูรายการที่เหลือ' : 'More dishes below'}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** A dish on the ticket, with the customer's note as a badge nobody misses. */
export function TicketItem({ first, quantity, name, note, options, chip, badge, showDone, onDone, doneLoading, onCancel, disabled, language }: {
  first: boolean;
  quantity: number;
  name: string;
  note?: string;
  options?: string;
  /** "กลับบ้าน" on a dine-in ticket, or the other way round. */
  chip?: string;
  /** What a viewer without update rights sees in place of the buttons. */
  badge?: ReactNode;
  showDone: boolean;
  onDone?: () => void;
  doneLoading?: boolean;
  onCancel?: () => void;
  disabled?: boolean;
  language: 'th' | 'en';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingRight: 10, paddingLeft: 14, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <View
        accessible
        accessibilityLabel={language === 'th' ? `จำนวน ${quantity}` : `Quantity ${quantity}`}
        style={{ minWidth: 34, height: 30, paddingHorizontal: 8, borderRadius: 10, backgroundColor: palette.surfaceStrong, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: palette.primaryInk, fontVariant: ['tabular-nums'] }}>×{quantity.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Text selectable style={{ fontSize: 16, lineHeight: 21, fontWeight: '600', color: palette.textStrong, flexShrink: 1 }}>{name}</Text>
          {chip ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 1, paddingLeft: 5, paddingRight: 8, borderRadius: 999, backgroundColor: palette.infoSoft }}>
              <AppIcon name="bag-handle-outline" size={12} color={palette.info} />
              <Text style={{ fontSize: 11, fontWeight: '600', color: palette.info }}>{chip}</Text>
            </View>
          ) : null}
        </View>
        {note ? (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, paddingVertical: 2, paddingLeft: 6, paddingRight: 8, borderRadius: 8, backgroundColor: palette.warningSoft }}>
            <AppIcon name="document-text-outline" size={13} color={palette.warning} />
            <Text selectable style={{ fontSize: 12.5, fontWeight: '700', color: palette.warning, flexShrink: 1 }}>{note}</Text>
          </View>
        ) : null}
        {options ? <Text selectable style={{ fontSize: 12, lineHeight: 16, color: palette.placeholder, marginTop: 3 }}>{options}</Text> : null}
        {badge}
      </View>
      {showDone ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === 'th' ? `ทำ ${name} เสร็จ` : `Mark ${name} done`}
          accessibilityState={{ busy: Boolean(doneLoading), disabled: Boolean(disabled) }}
          disabled={disabled}
          onPress={onDone}
          style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? palette.success : palette.successSoft, borderWidth: 1.5, borderColor: '#A7F3D0', opacity: disabled && !doneLoading ? 0.45 : 1 })}
        >
          {({ pressed }) => doneLoading
            ? <ActivityIndicator color={palette.success} size="small" />
            : <AppIcon name="checkmark" size={26} color={pressed ? '#fff' : palette.success} />}
        </Pressable>
      ) : null}
      {onCancel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === 'th' ? `ยกเลิก ${name}` : `Cancel ${name}`}
          disabled={disabled}
          onPress={onCancel}
          hitSlop={6}
          style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? palette.dangerSoft : 'transparent', opacity: disabled ? 0.45 : 1 })}
        >
          <AppIcon name="close" size={20} color={palette.placeholder} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The green button along the bottom of a ticket: "เสร็จ" or "ทำรอบนี้เสร็จ". */
export function TicketButton({ label, icon, onPress, loading, disabled }: {
  label: string;
  icon: AppIconName;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(loading), disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ height: 46, borderRadius: 16, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.success, opacity: disabled && !loading ? 0.45 : pressed ? 0.85 : 1, shadowColor: palette.success, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 })}
    >
      {loading ? <ActivityIndicator color="#fff" size="small" /> : <AppIcon name={icon} size={20} color="#fff" />}
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- lanes

/**
 * The tablet board, chosen by the owner on 15 ก.ย. 2569: one lane per ticket,
 * the full height of the screen, in queue order from left to right. A lane that
 * does not fit is one swipe away, and the right edge says how many are waiting
 * there.
 *
 * The strip lives inside the tab pager, which also reads horizontal drags; the
 * exclusion handlers give a drag that starts on a lane to the lanes.
 */
export function TicketLanes({ count, children, language }: { count: number; children: (height: number) => ReactNode; language: 'th' | 'en' }) {
  const tabSwipeExclusionHandlers = useTabSwipeExclusionHandlers();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollX, setScrollX] = useState(0);
  const hidden = lanesOutOfSight(count, LANE_WIDTH, LANE_GAP, scrollX, size.width);
  // Room under the lanes for the tickets' shadow, which a clipped strip would cut off.
  const laneHeight = Math.max(0, size.height - 14);
  return (
    <View
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
    >
      {size.height > 0 ? (
        <ScrollView
          {...tabSwipeExclusionHandlers}
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          onScroll={(event) => setScrollX(event.nativeEvent.contentOffset.x)}
          contentContainerStyle={{ gap: LANE_GAP, paddingBottom: 14, paddingRight: hidden > 0 || scrollX > 0 ? 40 : 0 }}
        >
          {children(laneHeight)}
        </ScrollView>
      ) : null}
      {hidden > 0 ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 14, width: 96, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.94)']}
            locations={[0, 0.55]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <View
            accessible
            accessibilityLabel={language === 'th' ? `อีก ${hidden} ตั๋วทางขวา` : `${hidden} more tickets to the right`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginRight: 4, paddingVertical: 6, paddingLeft: 12, paddingRight: 8, borderRadius: 999, backgroundColor: palette.surfaceStrong }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: palette.primaryInk, fontVariant: ['tabular-nums'] }}>+{hidden}</Text>
            <AppIcon name="chevron-forward" size={16} color={palette.primaryInk} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- empty board

export function EmptyKitchen({ latestFinishedAt, language }: { latestFinishedAt: number | null; language: 'th' | 'en' }) {
  const detail = latestFinishedAt !== null
    ? (language === 'th' ? `ทุกโต๊ะได้อาหารครบแล้ว · รอบล่าสุดเสร็จ ${kitchenClockLabel(latestFinishedAt, language)}` : `Every table is served · last round finished ${kitchenClockLabel(latestFinishedAt, language)}`)
    : (language === 'th' ? 'ยังไม่มีรอบเข้าครัว' : 'No rounds have reached the kitchen yet');
  return (
    <View style={{ borderRadius: CARD_RADIUS + 2, borderCurve: 'continuous', borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border, backgroundColor: palette.surfaceSubtle, paddingVertical: 26, paddingHorizontal: 18, alignItems: 'center', gap: 4 }}>
      <AppIcon name="flame-outline" size={34} color={palette.primaryInk} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: palette.textStrong, marginTop: 4 }}>{language === 'th' ? 'ครัวว่าง' : 'Kitchen is clear'}</Text>
      <Text style={{ fontSize: 12.5, color: palette.muted, textAlign: 'center' }}>{detail}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- cancel sheet

const CANCEL_REASONS_TH = ['ของหมด', 'อุปกรณ์ขัดข้อง', 'เหตุสุดวิสัย'];
const CANCEL_REASONS_EN = ['Sold out', 'Equipment failure', 'Unavoidable issue'];

/**
 * The reason sheet. It used to unfold inside the ticket and push everything
 * below it down; a sheet leaves the board where it was. The badge at the top
 * carries the ticket's own colour and label so the cook can see which table
 * they are about to cancel from, not only which dish.
 */
export function CancelSheet({ open, itemName, quantity, ticketLabel, ticketMeta, urgency, reason, error, onReason, onKeep, onConfirm, busy, language }: {
  open: boolean;
  itemName: string;
  quantity: number;
  ticketLabel: string;
  ticketMeta: string;
  urgency: KitchenUrgency;
  reason: string;
  error: string | null;
  onReason: (value: string) => void;
  onKeep: () => void;
  onConfirm: () => void;
  busy: boolean;
  language: 'th' | 'en';
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const reasons = language === 'th' ? CANCEL_REASONS_TH : CANCEL_REASONS_EN;
  return (
    <BottomSheet open={open} onClose={onKeep} heightFraction={0.7} label={t('ปิด', 'Close')} showClose>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: headerColor(urgency) }}>
            <AppIcon name="timer-outline" size={13} color="#fff" />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#fff' }}>{ticketLabel} · {ticketMeta}</Text>
          </View>
        </View>
        <SheetTitle
          title={t(`ยกเลิก ${itemName} ×${quantity}`, `Cancel ${itemName} ×${quantity}`)}
          subtitle={t('ลูกค้าจะเห็นว่ารายการนี้ถูกยกเลิก · ต้องระบุเหตุผล', 'The customer will see this item cancelled · a reason is required')}
        />
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <ChipGroup
            value={reason}
            onChange={onReason}
            options={reasons.map((value) => ({ label: value, value }))}
          />
          <TextField
            label={t('เหตุผลที่ยกเลิก', 'Cancellation reason')}
            value={reason}
            onChangeText={onReason}
            placeholder={t('เช่น กุ้งหมดตั้งแต่ 17:30 แจ้งหน้าร้านแล้ว', 'For example, sold out or equipment failure')}
            multiline
            error={error}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onKeep} style={({ pressed }) => ({ flex: 1, height: 46, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.border, opacity: pressed ? 0.8 : 1 })}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: palette.textStrong }}>{t('เก็บรายการไว้', 'Keep item')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ busy }} disabled={busy} onPress={onConfirm} style={({ pressed }) => ({ flex: 1, height: 46, borderRadius: 16, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.danger, opacity: pressed ? 0.85 : 1 })}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : null}
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>{t('ยืนยันยกเลิก', 'Confirm cancellation')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- finished rounds

export type DoneRowProps = {
  key: string;
  title: string;
  titleIcon?: AppIconName;
  meta: string;
  finishedAt: number | null;
  durationSeconds: number | null;
  onRecall?: () => void;
  recallLoading?: boolean;
  disabled?: boolean;
};

export function DoneRow({ row, language, first }: { row: DoneRowProps; language: 'th' | 'en'; first: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {row.titleIcon ? <AppIcon name={row.titleIcon} size={15} color={palette.placeholder} /> : null}
          <Text selectable numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: palette.textStrong }}>{row.title}</Text>
        </View>
        <Text selectable numberOfLines={1} style={{ fontSize: 12, color: palette.muted }}>{row.meta}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
          {language === 'th' ? 'เสร็จ ' : 'Done '}{kitchenClockLabel(row.finishedAt, language)}
        </Text>
        <Text style={{ fontSize: 12, color: palette.muted, fontVariant: ['tabular-nums'] }}>
          {language === 'th' ? 'ใช้เวลา ' : 'Took '}{formatKitchenMinutes(row.durationSeconds, language)}
        </Text>
      </View>
      {row.onRecall ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={language === 'th' ? `ดึง ${row.title} กลับไปกำลังทำ` : `Move ${row.title} back to Cooking`}
          accessibilityState={{ busy: Boolean(row.recallLoading), disabled: Boolean(row.disabled) }}
          disabled={row.disabled}
          onPress={row.onRecall}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle, borderWidth: 1, borderColor: palette.border, opacity: row.disabled && !row.recallLoading ? 0.45 : 1 })}
        >
          {row.recallLoading ? <ActivityIndicator color={palette.muted} size="small" /> : <AppIcon name="arrow-undo-outline" size={20} color={palette.muted} />}
        </Pressable>
      ) : null}
    </View>
  );
}

/** The three small figures above the finished list. */
export function DoneSummary({ average, slowest, count, language }: { average: number | null; slowest: number | null; count: number; language: 'th' | 'en' }) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const cell = (label: string, value: string) => (
    <View key={label} style={{ flex: 1, borderRadius: 14, backgroundColor: palette.surfaceSubtle, paddingVertical: 8, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11.5, color: palette.placeholder }}>{label}</Text>
      <Text style={{ fontSize: 17, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {cell(t('เฉลี่ยต่อรอบ', 'Average'), formatKitchenMinutes(average, language))}
      {cell(t('ช้าสุด', 'Slowest'), formatKitchenMinutes(slowest, language))}
      {cell(t('รอเสิร์ฟอยู่', 'Waiting to serve'), t(`${count} รอบ`, `${count}`))}
    </View>
  );
}

/** Phone: the finished rounds in a sheet opened from the third tile. */
export function CompletedSheet({ open, onClose, rows, average, slowest, language, empty }: {
  open: boolean;
  onClose: () => void;
  rows: DoneRowProps[];
  average: number | null;
  slowest: number | null;
  language: 'th' | 'en';
  empty: ReactNode;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.86} label={t('ปิด', 'Close')} showClose>
      <SheetTitle
        title={t('เสร็จแล้ววันนี้', 'Finished today')}
        subtitle={t(`${rows.length} รอบ · ดึงกลับไปกำลังทำได้ถ้าเจอของผิด`, `${rows.length} rounds · move one back if something is wrong`)}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {rows.length ? (
          <>
            <DoneSummary average={average} slowest={slowest} count={rows.length} language={language} />
            <View style={{ marginTop: 6 }}>
              {rows.map((row, index) => <DoneRow key={row.key} row={row} language={language} first={index === 0} />)}
            </View>
          </>
        ) : empty}
      </ScrollView>
    </BottomSheet>
  );
}


// ---------------------------------------------------------------- skeleton

/**
 * The board before its first snapshot arrives: three tiles, the heading, and
 * tickets in the same outline as real ones — a dark header block with the
 * minutes capsule on the right, dish rows beneath. Only the first load draws
 * it; a refresh over a board already on screen keeps the tickets, because
 * swapping live tickets for grey shapes every time the tab is opened would
 * hide the thing the cook is looking at.
 */
export function KitchenSkeleton({ tablet, label }: { tablet: boolean; label: string }) {
  const tile = (key: string, labelWidth: DimensionValue) => (
    <HomeCard key={key} radius={16} style={{ flex: 1 }}>
      <View style={{ paddingVertical: 10, paddingHorizontal: 10, gap: 7 }}>
        <Bone width={26} height={26} radius={9} />
        <Bone width={labelWidth} height={8} />
        <Bone width="45%" height={16} radius={6} />
      </View>
    </HomeCard>
  );

  const ticket = (key: string, rows: number) => (
    <View key={key} style={{ borderRadius: CARD_RADIUS + 2, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }}>
      <View style={{ backgroundColor: palette.surfaceSubtle, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 8 }}>
          <Bone width={110} height={24} radius={8} />
          <Bone width={150} height={10} />
        </View>
        <Bone width={70} height={36} radius={18} />
      </View>
      {Array.from({ length: rows }, (_, index) => (
        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: palette.divider }}>
          <Bone width={28} height={28} radius={9} />
          <View style={{ flex: 1, gap: 6 }}>
            <Bone width={index % 2 ? '55%' : '70%'} height={13} />
            {index === 0 ? <Bone width="35%" height={9} /> : null}
          </View>
          <Bone width={64} height={34} radius={12} />
        </View>
      ))}
    </View>
  );

  const heading = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6 }}>
      <Bone width={16} height={16} radius={5} />
      <Bone width={58} height={12} />
    </View>
  );

  const tiles = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {tile('a', '60%')}
      {tile('b', '55%')}
      {tile('c', '65%')}
    </View>
  );

  return (
    <SkeletonReveal label={label} style={tablet ? { flex: 1 } : { gap: 12 }}>
      {tablet ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: LANE_GAP, overflow: 'hidden' }}>
          {[3, 2, 2, 1].map((rows, index) => (
            <View key={index} style={{ width: LANE_WIDTH }}>{ticket(String(index), rows)}</View>
          ))}
        </View>
      ) : (
        <>
          {tiles}
          {heading}
          <View style={{ gap: 12 }}>
            {ticket('a', 3)}
            {ticket('b', 2)}
          </View>
        </>
      )}
    </SkeletonReveal>
  );
}
