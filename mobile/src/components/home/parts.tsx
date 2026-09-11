import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';

import { GlassPanel } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import type { HomeDay, HomeRevenueCurve, HomeTableCell } from '@/src/lib/home-dashboard';
import { palette } from '@/src/theme';

// The overview's own pieces. The page is the web dashboard's three subjects —
// what needs doing, the floor, the money — drawn without the boxes: headings
// sit on the canvas, cards hold only content, and the canvas is plain white
// (the palette's canvas since 2026-09-11), so warmth lives in tints and one
// orange mass, the sales card.

const CARD_RADIUS = 20;

/** A white card with a hairline. Glass on iOS 26, which on white mostly shows as the same card. */
export function HomeCard({ children, style, radius = CARD_RADIUS }: { children: ReactNode; style?: ViewStyle; radius?: number }) {
  return (
    <GlassPanel radius={radius} style={style} interactive={false} tint="rgba(255,255,255,0.72)" fallback={palette.surface} fallbackBorder={palette.divider}>
      {children}
    </GlassPanel>
  );
}

/** A heading on the canvas, with an optional link on the right. */
export function HomeHeading({ icon, title, trailing, onPress }: { icon: AppIconName; title: string; trailing?: string; onPress?: () => void }) {
  const right = trailing ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: 12, fontWeight: '600', color: onPress ? palette.primaryInk : palette.placeholder }}>{trailing}</Text>
      {onPress ? <AppIcon name="chevron-forward" size={14} color={palette.primaryInk} /> : null}
    </View>
  ) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AppIcon name={icon} size={16} color={palette.placeholder} />
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
      </View>
      {onPress && right ? (
        <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{right}</Pressable>
      ) : right}
    </View>
  );
}

// ---------------------------------------------------------------- day strip

const WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Seven days, today at the right, the selected one in ink. A dot under a day
 * means it sold something; no dots at all means the history is not known.
 */
export function DayStrip({ days, language, onSelect }: { days: HomeDay[]; language: 'th' | 'en'; onSelect: (date: string) => void }) {
  const names = language === 'th' ? WEEKDAYS_TH : WEEKDAYS_EN;
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {days.map((day) => (
        <Pressable
          key={day.date}
          accessibilityRole="button"
          accessibilityState={{ selected: day.selected }}
          accessibilityLabel={day.date}
          onPress={() => onSelect(day.date)}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: 'center',
            paddingTop: 5,
            paddingBottom: 4,
            borderRadius: 13,
            backgroundColor: day.selected ? palette.textStrong : palette.surfaceSubtle,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text allowFontScaling={false} style={{ fontSize: 10, fontWeight: '600', color: day.selected ? 'rgba(255,255,255,0.7)' : palette.muted }}>{names[day.weekday]}</Text>
          <Text allowFontScaling={false} style={{ fontSize: 14, fontWeight: '700', lineHeight: 18, color: day.selected ? '#ffffff' : palette.textStrong, fontVariant: ['tabular-nums'] }}>{day.dayOfMonth}</Text>
          <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: day.hasSales ? (day.selected ? palette.accentMuted : palette.primary) : 'transparent' }} />
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- sales hero

function curvePath(values: number[], width: number, height: number, pad: number) {
  if (values.length < 2) return { line: '', area: '', end: null as null | { x: number; y: number } };
  const max = Math.max(...values, 1);
  const stepX = (width - pad * 2) / (values.length - 1);
  const points = values.map((value, index) => ({
    x: pad + index * stepX,
    y: pad + (height - pad * 2) * (1 - value / max),
  }));
  // Straight runs between points with the corners softened: a smooth-looking
  // line without a curve-fitting library, and it never overshoots a value.
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

/**
 * The one coloured mass on the page: today's takings, big, with the day's
 * accumulation drawn underneath so the shape of the day is read before the
 * number is.
 */
export function SalesHero({
  amount,
  caption,
  reference,
  curve,
  axisStart,
  axisNow,
  axisEnd,
  onPress,
}: {
  amount: string;
  caption: string;
  /** The comparison line under the number, already worded. */
  reference?: string | null;
  curve: HomeRevenueCurve | null;
  axisStart: string;
  axisNow?: string | null;
  axisEnd: string;
  onPress?: () => void;
}) {
  const W = 320;
  const H = 42;
  const path = curve ? curvePath(curve.cumulative, W, H, 4) : null;
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}>
      <LinearGradient
        colors={['#b93a0d', '#d9581f', '#ef7a35']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: 22,
          borderCurve: 'continuous',
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 10,
          shadowColor: '#b93a0d',
          shadowOpacity: 0.28,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 6,
        }}
      >
        <Text style={{ fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.82)', letterSpacing: 0.3 }}>{caption}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 32, fontWeight: '700', color: '#ffffff', lineHeight: 38, marginTop: 1, fontVariant: ['tabular-nums'] }}>{amount}</Text>
        {reference ? (
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#ffffff' }}>{reference}</Text>
          </View>
        ) : null}
        {path && path.line ? (
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ marginTop: 6 }}>
            <Defs>
              <SvgGradient id="homeHeroFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
                <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </SvgGradient>
            </Defs>
            <Path d={path.area} fill="url(#homeHeroFill)" />
            <Path d={path.line} fill="none" stroke="#ffffff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            {path.end ? <Circle cx={path.end.x} cy={path.end.y} r={4} fill="#ffffff" /> : null}
          </Svg>
        ) : (
          <View style={{ height: H, marginTop: 6, justifyContent: 'flex-end' }}>
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>—</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
          <Text style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] }}>{axisStart}</Text>
          {axisNow ? <Text style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] }}>{axisNow}</Text> : null}
          <Text style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.85)', fontVariant: ['tabular-nums'] }}>{axisEnd}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

// ---------------------------------------------------------------- stat tiles

export function StatTile({ icon, label, value, tone = 'neutral', onPress }: {
  icon: AppIconName;
  label: string;
  value: string;
  tone?: 'danger' | 'success' | 'neutral';
  onPress?: () => void;
}) {
  const ink = tone === 'danger' ? palette.danger : tone === 'success' ? palette.success : palette.textStrong;
  const wash = tone === 'danger' ? palette.dangerSoft : tone === 'success' ? palette.successSoft : palette.surfaceStrong;
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 10 }}>
      <View style={{ width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: wash }}>
        <AppIcon name={icon} size={15} color={ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 10.5, color: palette.placeholder, lineHeight: 13 }}>{label}</Text>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 15, fontWeight: '700', lineHeight: 19, color: ink, fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
    </View>
  );
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}>
      <HomeCard radius={16}>{inner}</HomeCard>
    </Pressable>
  );
}

// ---------------------------------------------------------------- attention rail

export type AttentionCardProps = {
  key: string;
  icon: AppIconName;
  title: string;
  headline: string;
  detail: string;
  tone: 'danger' | 'warning' | 'info';
  onPress?: () => void;
};

/**
 * One card per thing that needs a person, side by side and scrolling. When
 * nothing needs anyone, the caller renders nothing and the page gets shorter —
 * an empty rail would only say "nothing" with a box.
 */
export function AttentionRail({ cards, stacked }: { cards: AttentionCardProps[]; stacked?: boolean }) {
  const items = cards.map((card) => {
    const colours = card.tone === 'danger'
      ? { ink: palette.danger, bg: palette.dangerSoft, border: '#FECACA' }
      : card.tone === 'warning'
        ? { ink: palette.warning, bg: palette.warningSoft, border: '#FDE68A' }
        : { ink: palette.info, bg: palette.infoSoft, border: '#BAE6FD' };
    return (
      <Pressable
        key={card.key}
        accessibilityRole={card.onPress ? 'button' : undefined}
        accessibilityLabel={`${card.title} ${card.headline} ${card.detail}`}
        disabled={!card.onPress}
        onPress={card.onPress}
        style={({ pressed }) => ({
          width: stacked ? undefined : 164,
          alignSelf: stacked ? 'stretch' : undefined,
          borderRadius: 18,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: colours.border,
          backgroundColor: colours.bg,
          paddingVertical: 10,
          paddingHorizontal: 12,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppIcon name={card.icon} size={13} color={colours.ink} />
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '600', color: colours.ink }}>{card.title}</Text>
        </View>
        <Text numberOfLines={1} style={{ fontSize: 18, fontWeight: '700', lineHeight: 22, color: colours.ink, marginTop: 2, fontVariant: ['tabular-nums'] }}>{card.headline}</Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: palette.muted, marginTop: 1 }}>{card.detail}</Text>
      </Pressable>
    );
  });
  if (stacked) return <View style={{ gap: 8 }}>{items}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingBottom: 2 }} style={{ marginHorizontal: -2 }}>
      {items}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- table map

const cellLook: Record<HomeTableCell['state'], { bg: string; ink: string; dot: string; border: string }> = {
  busy: { bg: palette.surface, ink: palette.primaryInk, dot: palette.primary, border: palette.accentMuted },
  bill: { bg: palette.surface, ink: palette.info, dot: palette.info, border: '#BAE6FD' },
  reserved: { bg: palette.surface, ink: palette.warning, dot: palette.warning, border: '#FDE68A' },
  free: { bg: palette.surfaceSubtle, ink: palette.placeholder, dot: '#D6CFC8', border: 'transparent' },
};

/**
 * The floor. Empty tables recede to a tint; a table with people on it is white
 * and lifted, and its dot says which kind of attention it wants.
 */
export function TableMap({ cells, columns, legend, onPress }: {
  cells: HomeTableCell[];
  columns: number;
  legend: { busy: string; bill: string; reserved: string; free: string };
  onPress?: (cell: HomeTableCell) => void;
}) {
  const hasReserved = cells.some((cell) => cell.state === 'reserved');
  // Rows are laid out by hand: React Native has no calc(), so a percentage
  // width cannot take the gap into account, but a row of flex:1 cells can.
  const rows: Array<Array<HomeTableCell | null>> = [];
  for (let start = 0; start < cells.length; start += columns) {
    const row: Array<HomeTableCell | null> = cells.slice(start, start + columns);
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return (
    <HomeCard>
      <View style={{ padding: 11, paddingBottom: 10, gap: 6 }}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: 'row', gap: 6 }}>
            {row.map((cell, index) => {
              if (!cell) return <View key={`pad-${index}`} style={{ flex: 1 }} />;
              const look = cellLook[cell.state];
              return (
                <Pressable
                  key={cell.id}
                  accessibilityRole={onPress ? 'button' : undefined}
                  accessibilityLabel={`${cell.label} ${legend[cell.state]}`}
                  disabled={!onPress}
                  onPress={() => onPress?.(cell)}
                  style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}
                >
                  <View style={{ aspectRatio: 1.5, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: look.bg, borderWidth: 1, borderColor: look.border, shadowColor: '#7C2D12', shadowOpacity: cell.state === 'free' ? 0 : 0.10, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: cell.state === 'free' ? 0 : 2 }}>
                    <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: look.ink }}>{cell.label}</Text>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: look.dot }} />
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          {([['busy', cellLook.busy.dot], ['bill', cellLook.bill.dot], ...(hasReserved ? [['reserved', cellLook.reserved.dot] as const] : []), ['free', cellLook.free.dot]] as Array<[HomeTableCell['state'], string]>).map(([state, dot]) => (
            <View key={state} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
              <Text style={{ fontSize: 11, color: palette.muted }}>{legend[state]}</Text>
            </View>
          ))}
        </View>
      </View>
    </HomeCard>
  );
}

// ---------------------------------------------------------------- month row

/** One line that opens the month: what it took, and the thing that sold best. */
export function MonthRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <HomeCard>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 }}>
          <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accentSoft }}>
            <AppIcon name="calendar-outline" size={18} color={palette.primaryInk} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 11.5, color: palette.placeholder }}>{detail}</Text>
          </View>
          <AppIcon name="chevron-forward" size={18} color={palette.placeholder} />
        </View>
      </HomeCard>
    </Pressable>
  );
}
