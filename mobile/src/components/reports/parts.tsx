import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { BottomSheet } from '@/src/components/ai/chrome';
import { AppRefreshControl } from '@/src/components/app-shell';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { SheetTitle } from '@/src/components/inventory/parts';
import { getSalesByHour, getSalesDetail } from '@/src/api/report';
import { Bone } from '@/src/components/skeleton';
import { money } from '@/src/lib/format';
import {
  calendarWeeks,
  draftToRange,
  hourBars,
  monthTitle,
  presetLabel,
  presetRange,
  rangeDayCount,
  REPORT_MAX_DAYS,
  REPORT_PRESETS,
  reportRangeLabel,
  tapRangeDay,
  type RangeDraft,
  type ReportBar,
  type ReportPreset,
  type ReportRange,
  type ReportTab,
} from '@/src/lib/report-view';
import { palette } from '@/src/theme';
import type { SalesDetailReport } from '@/src/types/report';

// The reports screen's pieces, in the overview's language: white cards with a
// warm hairline, the one orange block for sales, figures in tabular digits.

type Language = 'th' | 'en';
const CARD_EDGE = '#E4D8CD';
const BAR = '#E8743A';
const BAR_BEST = '#B93A0D';
const BAR_OPEN = '#F6C9AD';

export function ReportCard({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View style={[{ borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

export function CardHeading({ title, detail, trailing }: { title: string; detail?: string; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
        {detail ? <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>{detail}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

// ---------------------------------------------------------------- figures

export type ReportFigure = {
  key: string;
  label: string;
  value: string;
  note?: string;
  tone?: 'hero' | 'good' | 'bad';
  /** Puts an ⓘ beside the label that explains the figure. */
  onInfo?: () => void;
  infoLabel?: string;
};

/**
 * The five figures. A row of five on a tablet; on a phone they scroll sideways
 * as one strip, so the tabs below stay in the first screenful.
 */
export function ReportFigures({ figures, tablet }: { figures: ReportFigure[]; tablet: boolean }) {
  const card = (figure: ReportFigure) => {
    const hero = figure.tone === 'hero';
    const body = (
      <>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, color: hero ? 'rgba(255,255,255,0.88)' : palette.placeholder }}>{figure.label}</Text>
          {figure.onInfo ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={figure.infoLabel ?? figure.label}
              onPress={figure.onInfo}
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <AppIcon name="information-circle-outline" size={16} color={hero ? '#fff' : palette.primaryInk} />
            </Pressable>
          ) : null}
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: tablet ? 20 : 17, lineHeight: tablet ? 26 : 22, fontWeight: '700', color: hero ? '#fff' : figure.tone === 'good' ? palette.success : figure.tone === 'bad' ? palette.danger : palette.textStrong, fontVariant: ['tabular-nums'] }}>{figure.value}</Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: hero ? 'rgba(255,255,255,0.88)' : palette.placeholder }}>{figure.note ?? ' '}</Text>
      </>
    );
    const frame = { borderRadius: 16, borderCurve: 'continuous' as const, paddingVertical: tablet ? 9 : 7, paddingHorizontal: tablet ? 12 : 11, ...(tablet ? { flex: 1, minWidth: 0 } : { minWidth: 112 }) };
    return hero ? (
      <LinearGradient key={figure.key} colors={['#B93A0D', '#D9581F', '#EF7A35']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={frame}>{body}</LinearGradient>
    ) : (
      <View key={figure.key} style={[frame, { borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface }]}>{body}</View>
    );
  };
  if (tablet) return <View style={{ flexDirection: 'row', gap: 8 }}>{figures.map(card)}</View>;
  return <FigureStrip>{figures.map(card)}</FigureStrip>;
}

/**
 * The phone's figures, one strip that scrolls sideways. While cards are still
 * off the right edge, that edge fades and shows an arrow (asked for on
 * 15 ก.ย. 2569) — a card cut in half at the edge was the only hint before.
 */
function FigureStrip({ children }: { children: ReactNode }) {
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const [offset, setOffset] = useState(0);
  const more = viewport > 0 && content - viewport - offset > 6;
  return (
    <View style={{ marginHorizontal: -16 }}>
      {/* flexGrow 0: a ScrollView grows to fill its column by default, and on
          the locked page that column is the whole screen — the cards stretched
          down past the tabs on an iPad held upright (15 ก.ย. 2569). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
        onContentSizeChange={(width) => setContent(width)}
        onScroll={(event) => setOffset(event.nativeEvent.contentOffset.x)}
        scrollEventThrottle={32}
        contentContainerStyle={{ gap: 8, alignItems: 'flex-start' }}
        style={{ flexGrow: 0, flexShrink: 0 }}
      >
        <View style={{ width: 8 }} />
        {children}
        <View style={{ width: 8 }} />
      </ScrollView>
      {more ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 56, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 6 }}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.95)']}
            locations={[0, 0.6]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider, shadowColor: '#21130C', shadowOpacity: 0.12, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
            <AppIcon name="chevron-forward" size={15} color={palette.primaryInk} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * What the margin is, worked through with the period's own numbers rather than
 * a textbook line: the owner asked for an ⓘ on the figure (15 ก.ย. 2569).
 */
export function MarginInfoSheet({ open, onClose, revenue, cost, profit, margin, language }: {
  open: boolean;
  onClose: () => void;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  language: Language;
}) {
  const th = language === 'th';
  const locale = th ? 'th-TH' : 'en-US';
  const percent = `${Number(margin).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const perHundred = Number(margin).toLocaleString(locale, { maximumFractionDigits: 1 });
  const line = (label: string, value: string, strong = false) => (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.divider }}>
      <Text style={{ flex: 1, fontSize: 14, color: strong ? palette.textStrong : palette.muted, fontWeight: strong ? '700' : '500' }}>{label}</Text>
      <Text style={{ fontSize: strong ? 17 : 15, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.62} label={th ? 'ปิด' : 'Close'} showClose>
      <SheetTitle title={th ? 'มาร์จินคืออะไร' : 'What is margin?'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 14 }}>
        <Text style={{ fontSize: 15, lineHeight: 23, color: palette.text }}>
          {th
            ? `มาร์จินคือส่วนที่เหลือเป็นกำไร เมื่อเทียบกับรายได้ · ช่วงนี้ได้รายได้ทุก 100 บาท เหลือกำไรหลังหักค่าวัตถุดิบ ${perHundred} บาท`
            : `Margin is the share of sales left as profit. In this period, every 100 baht of sales left ${perHundred} baht after ingredients.`}
        </Text>
        <ReportCard>
          <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 }}>
            <View style={{ paddingVertical: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: palette.placeholder }}>{th ? 'คิดจากตัวเลขของช่วงนี้' : 'Worked out from this period'}</Text>
            </View>
            {line(th ? 'รายได้ (หลังหักส่วนลด)' : 'Revenue (after discounts)', money(revenue, language))}
            {line(th ? 'ต้นทุนวัตถุดิบ' : 'Ingredient cost', `− ${money(cost, language)}`)}
            {line(th ? 'กำไรขั้นต้น' : 'Gross profit', money(profit, language))}
            {line(th ? `มาร์จิน = กำไรขั้นต้น ÷ รายได้ × 100` : 'Margin = gross profit ÷ revenue × 100', percent, true)}
          </View>
        </ReportCard>
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 13.5, lineHeight: 20, color: palette.muted }}>
            {th
              ? '• ยังไม่ได้หักค่าแรง ค่าเช่า ค่าน้ำไฟ และรายจ่ายอื่นในหน้ารายจ่าย กำไรจริงของร้านจะน้อยกว่านี้'
              : '• Wages, rent, utilities and other expenses are not taken off yet, so the shop keeps less than this.'}
          </Text>
          <Text style={{ fontSize: 13.5, lineHeight: 20, color: palette.muted }}>
            {th
              ? '• ต้นทุนคิดจากสูตรวัตถุดิบของเมนู เมนูที่ยังไม่มีสูตรนับต้นทุนเป็น 0 ทำให้มาร์จินสูงกว่าความจริง'
              : '• Cost comes from menu recipes. A menu with no recipe counts as zero cost and pushes the margin up.'}
          </Text>
          <Text style={{ fontSize: 13.5, lineHeight: 20, color: palette.muted }}>
            {th
              ? '• รายได้ในสูตรคือเงินที่ลูกค้าจ่ายจริง หลังหักส่วนลดแล้ว'
              : '• Revenue here is what customers actually paid, after discounts.'}
          </Text>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- tabs

export function ReportTabs({ tab, onTab, stockCount, language, tablet }: { tab: ReportTab; onTab: (tab: ReportTab) => void; stockCount: number; language: Language; tablet: boolean }) {
  const th = language === 'th';
  const options: { key: ReportTab; label: string }[] = [
    { key: 'sales', label: th ? 'ยอดขาย' : 'Sales' },
    { key: 'menu', label: th ? 'เมนู' : 'Menu' },
    { key: 'stock', label: `${th ? 'สต๊อก' : 'Stock'}${stockCount ? ` ${stockCount}` : ''}` },
  ];
  return (
    // Sized down on 15 ก.ย. 2569: at 44pt tall with 14.5pt words the switch
    // weighed more than the figures above it.
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignSelf: tablet ? 'flex-start' : 'stretch', width: tablet ? 340 : undefined, padding: 3, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.divider }}>
      {options.map((option) => {
        const on = option.key === tab;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onTab(option.key)}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 999, backgroundColor: on ? palette.surface : 'transparent', opacity: pressed && !on ? 0.6 : 1, ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) })}
          >
            <Text style={{ fontSize: 13, fontWeight: on ? '700' : '600', color: on ? palette.textStrong : palette.muted }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- sales chart

function niceMax(value: number) {
  if (value <= 0) return 1000;
  const step = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / step) * step;
}

/**
 * Sales as bars — one per day over a range, one per hour for a single day. The
 * best bar is dark, the one still selling pale, a bar with no sales a dashed
 * outline. Tapping a bar puts its figures above the chart; it opens on the best.
 */
export function SalesChart({ bars, best, average, height: fixedHeight, hourly, language }: {
  bars: ReportBar[];
  best: ReportBar | null;
  average: number;
  /** Leave out to fill the space the card gives it. */
  height?: number;
  hourly: boolean;
  language: Language;
}) {
  const th = language === 'th';
  const [width, setWidth] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const height = fixedHeight ?? measuredHeight;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { setPicked(null); }, [bars]);
  const selected = bars.find((bar) => bar.key === picked) ?? best ?? bars.at(-1) ?? null;
  const max = niceMax(Math.max(...bars.map((bar) => bar.revenue), 0));
  const padLeft = 38;
  const padBottom = 20;
  const padTop = 8;
  const gap = bars.length > 40 ? 2 : bars.length > 20 ? 3 : width < 500 ? 5 : 9;
  const barWidth = width > 0 ? Math.max(3, (width - padLeft - gap * (bars.length - 1)) / bars.length) : 0;
  const plot = height - padTop - padBottom;
  const y = (value: number) => padTop + plot * (1 - value / max);
  const labelEvery = Math.max(1, Math.ceil(24 / Math.max(1, barWidth + gap)));
  const openWord = hourly ? (th ? 'ชั่วโมงนี้ ยังไม่จบ' : 'this hour, still open') : (th ? 'วันนี้ ยังไม่จบวัน' : 'today, still open');
  const bestWord = hourly ? (th ? 'ชั่วโมงขายดีสุด' : 'best hour') : (th ? 'ขายดีสุด' : 'best day');

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8, ...(fixedHeight === undefined ? { flex: 1, minHeight: 0 } : null) }}>
      {selected ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: palette.muted }}>
            {selected.label}{selected.open ? ` · ${openWord}` : selected.key === best?.key ? ` · ${bestWord}` : ''}
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{selected.revenue > 0 ? money(selected.revenue, language) : (th ? 'ไม่มีขาย' : 'No sales')}</Text>
          {selected.orders > 0 ? <Text style={{ fontSize: 13, color: palette.placeholder }}>{th ? `${selected.orders} ออเดอร์` : `${selected.orders} orders`}</Text> : null}
        </View>
      ) : null}
      <View
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
          if (fixedHeight === undefined) setMeasuredHeight(event.nativeEvent.layout.height);
        }}
        style={fixedHeight === undefined ? { flex: 1, minHeight: 60 } : { height: fixedHeight }}
      >
        {width > 0 && height > 40 ? (
          <Svg width={width} height={height}>
            {[0, max / 2, max].map((tick) => (
              <Line key={tick} x1={padLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke="#F1E8DF" strokeWidth={1} />
            ))}
            {[0, max / 2, max].map((tick) => (
              <SvgText key={`t${tick}`} x={padLeft - 6} y={y(tick) + 4} fontSize={10.5} fill="#8B6F5F" textAnchor="end">{tick >= 1000 ? `${Math.round(tick / 100) / 10}k` : String(tick)}</SvgText>
            ))}
            {bars.map((bar, index) => {
              const x = padLeft + index * (barWidth + gap);
              const isBest = best?.key === bar.key;
              const on = selected?.key === bar.key;
              const label = index % labelEvery === 0 || on ? (
                <SvgText x={x + barWidth / 2} y={height - 5} fontSize={10.5} fontWeight={on ? '700' : '400'} fill={on ? palette.textStrong : '#8B6F5F'} textAnchor="middle">{bar.axis}</SvgText>
              ) : null;
              if (bar.revenue <= 0) {
                const stub = Math.min(plot, 18);
                return (
                  <G key={bar.key}>
                    <Rect x={x + 0.5} y={y(0) - stub} width={Math.max(1, barWidth - 1)} height={stub} rx={3} fill="none" stroke="#D6C3B6" strokeDasharray="3 3" />
                    {label}
                  </G>
                );
              }
              return (
                <G key={bar.key}>
                  <Rect x={x} y={y(bar.revenue)} width={barWidth} height={y(0) - y(bar.revenue)} rx={Math.min(5, barWidth / 3)} fill={bar.open ? BAR_OPEN : isBest ? BAR_BEST : BAR} opacity={on || !picked ? 1 : 0.75} />
                  {label}
                </G>
              );
            })}
            {average > 0 ? <Line x1={padLeft} x2={width} y1={y(average)} y2={y(average)} stroke={palette.textStrong} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.5} /> : null}
          </Svg>
        ) : null}
        {width > 0 && height > 40 ? (
          <View style={{ position: 'absolute', left: padLeft, top: 0, right: 0, bottom: 0, flexDirection: 'row', gap }}>
            {bars.map((bar) => (
              <Pressable
                key={bar.key}
                accessibilityRole="button"
                accessibilityLabel={`${bar.label} ${bar.revenue > 0 ? money(bar.revenue, language) : (th ? 'ไม่มีขาย' : 'no sales')}`}
                onPress={() => setPicked(bar.key)}
                style={{ width: barWidth, height: '100%' }}
              />
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, paddingHorizontal: 4 }}>
        <Legend swatch={<View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: BAR_BEST }} />} label={bestWord} />
        {bars.some((bar) => bar.open) ? <Legend swatch={<View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: BAR_OPEN }} />} label={openWord} /> : null}
        <Legend swatch={<View style={{ width: 9, height: 9, borderRadius: 3, borderWidth: 1, borderStyle: 'dashed', borderColor: '#B49A8A' }} />} label={th ? 'ไม่มีขาย' : 'No sales'} />
        {average > 0 ? <Legend swatch={<View style={{ width: 14, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: palette.muted }} />} label={th ? `เฉลี่ย${hourly ? 'ชั่วโมงละ' : 'วันละ'} ${money(average, language)}` : `Average ${money(average, language)} ${hourly ? 'an hour' : 'a day'}`} /> : null}
      </View>
    </View>
  );
}

function Legend({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {swatch}
      <Text style={{ fontSize: 11.5, color: palette.placeholder }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- table

export type TableColumn = { key: string; label: string; flex?: number; width?: number; align?: 'left' | 'right' };
export type TableRow = { key: string; cells: ReactNode[]; highlight?: boolean; onPress?: () => void; label?: string };

/**
 * Every table on the reports screen (15 ก.ย. 2569): the column names stay put
 * and only the rows scroll, inside whatever height the card is given — the
 * page itself no longer scrolls. When rows run past the bottom, the edge fades
 * and says how many are left, until the last one is on screen.
 */
export function ReportTable({ columns, rows, empty, onRefresh, footer, bottomInset = 0, language }: {
  columns: TableColumn[];
  rows: TableRow[];
  empty: string;
  onRefresh?: () => void | Promise<void>;
  /** A totals row pinned under the scrolling rows, one cell per column. */
  footer?: ReactNode[];
  /** Room after the last row, for a table that runs to a screen's bottom edge. */
  bottomInset?: number;
  language: Language;
}) {
  const [viewport, setViewport] = useState(0);
  const [offset, setOffset] = useState(0);
  const [bottoms, setBottoms] = useState<Record<string, number>>({});
  const pressable = rows.some((row) => row.onPress);
  const hidden = viewport > 0 ? rows.filter((row) => (bottoms[row.key] ?? 0) > offset + viewport + 2).length : 0;
  const cellStyle = (column: TableColumn) => ({
    ...(column.width ? { width: column.width } : { flex: column.flex ?? 1 }),
    minWidth: 0,
    alignItems: column.align === 'right' ? ('flex-end' as const) : ('flex-start' as const),
  });

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        accessibilityRole="header"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingHorizontal: 14, backgroundColor: palette.accentSoft, borderTopWidth: 1, borderTopColor: palette.divider, borderBottomWidth: 1, borderBottomColor: '#EFD9C6', zIndex: 2, shadowColor: '#7C2D12', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}
      >
        {columns.map((column) => (
          <View key={column.key} style={cellStyle(column)}>
            <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '600', color: '#8B5E44' }}>{column.label}</Text>
          </View>
        ))}
        {pressable ? <View style={{ width: 14 }} /> : null}
      </View>
      {rows.length ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView
            style={{ flex: 1, backgroundColor: palette.surface }}
            contentContainerStyle={bottomInset ? { paddingBottom: bottomInset } : undefined}
            onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
            onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
            scrollEventThrottle={32}
            refreshControl={onRefresh ? <AppRefreshControl onRefresh={onRefresh} /> : undefined}
          >
            {rows.map((row) => (
              <Pressable
                key={row.key}
                accessibilityRole={row.onPress ? 'button' : undefined}
                accessibilityLabel={row.label}
                disabled={!row.onPress}
                onPress={row.onPress}
                onLayout={(event) => {
                  const bottom = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
                  setBottoms((current) => (current[row.key] === bottom ? current : { ...current, [row.key]: bottom }));
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingVertical: 5, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#F3EDE7', backgroundColor: pressed ? palette.surfaceSubtle : row.highlight ? palette.accentSoft : palette.surface })}
              >
                {row.cells.map((cell, index) => (
                  <View key={columns[index]?.key ?? index} style={cellStyle(columns[index] ?? { key: String(index) })}>
                    {typeof cell === 'string' || typeof cell === 'number' ? <Cell align={columns[index]?.align}>{cell}</Cell> : cell}
                  </View>
                ))}
                {pressable ? (
                  <View style={{ width: 14, alignItems: 'flex-end' }}>
                    {row.onPress ? <AppIcon name="chevron-forward" size={14} color={palette.placeholder} /> : null}
                  </View>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          {hidden > 0 ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: bottomInset, height: 52, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 7 }}>
              <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.96)']} locations={[0, 0.7]} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 10, borderRadius: 999, backgroundColor: palette.surfaceStrong }}>
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: palette.primaryInk }}>{language === 'th' ? `อีก ${hidden} แถว` : `${hidden} more`}</Text>
                <AppIcon name="chevron-down" size={12} color={palette.primaryInk} />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>{empty}</Text>
      )}
      {footer && rows.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42, paddingHorizontal: 14, backgroundColor: palette.textStrong }}>
          {footer.map((cell, index) => (
            <View key={columns[index]?.key ?? index} style={cellStyle(columns[index] ?? { key: String(index) })}>
              {typeof cell === 'string' || typeof cell === 'number' ? <Cell align={columns[index]?.align} strong color="#fff">{cell}</Cell> : cell}
            </View>
          ))}
          {pressable ? <View style={{ width: 14 }} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Two icons that switch one card between views — on a phone the sales card is
 * either the chart or the table, each at the card's full height (the owner
 * chose this on 15 ก.ย. 2569, with icons rather than words).
 */
export function IconToggle<T extends string>({ options, value, onChange }: { options: { key: T; icon: AppIconName; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.divider }}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.key)}
            hitSlop={4}
            style={({ pressed }) => ({ width: 38, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? palette.surface : 'transparent', opacity: pressed && !on ? 0.6 : 1, ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) })}
          >
            <AppIcon name={option.icon} size={18} color={on ? palette.primaryInk : palette.placeholder} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** A table cell's words: one line, or a second smaller line under it. */
export function Cell({ children, sub, align, strong, muted, color }: {
  children: ReactNode;
  sub?: string;
  align?: 'left' | 'right';
  strong?: boolean;
  muted?: boolean;
  color?: string;
}) {
  return (
    <View style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start', maxWidth: '100%' }}>
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: strong ? '700' : '500', color: color ?? (muted ? palette.muted : palette.textStrong), fontVariant: ['tabular-nums'], textAlign: align === 'right' ? 'right' : 'left' }}>{children}</Text>
      {sub ? <Text numberOfLines={1} style={{ fontSize: 11, color: palette.placeholder, fontVariant: ['tabular-nums'], textAlign: align === 'right' ? 'right' : 'left' }}>{sub}</Text> : null}
    </View>
  );
}

/** A thin bar under a menu name, measured against the first row. */
export function ShareBar({ value }: { value: number }) {
  return (
    <View style={{ alignSelf: 'stretch', height: 5, borderRadius: 3, backgroundColor: '#FDE2CF', overflow: 'hidden', marginTop: 4 }}>
      <View style={{ width: `${Math.max(3, Math.min(100, Math.round(value * 100)))}%`, height: 5, borderRadius: 3, backgroundColor: BAR }} />
    </View>
  );
}

/** Small switch chips in a card heading: "ขายดี | กำไร", "ทั้งหมด · หมด · ใกล้หมด". */
export function HeadingChips<T extends string>({ options, value, onChange }: { options: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.key)}
            hitSlop={4}
            style={({ pressed }) => ({ paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: on ? palette.textStrong : palette.divider, backgroundColor: on ? palette.textStrong : palette.surface, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: on ? '#fff' : palette.muted }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- one day

const WEEKDAY_TH = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * One day, opened by tapping its row (15 ก.ย. 2569, from design A): the day's
 * sales, cost and profit, the hours it sold in, and every bill with its time
 * and amount. Tapping a bill opens the order. The sheet loads its own data so
 * the table stays as it was underneath.
 */
export function DaySheet({ date, today, best, onClose, onOpenOrder, language }: {
  date: string | null;
  today: string;
  best: boolean;
  onClose: () => void;
  onOpenOrder: (orderId: number) => void;
  language: Language;
}) {
  const th = language === 'th';
  const [detail, setDetail] = useState<SalesDetailReport | null>(null);
  const [hours, setHours] = useState<ReportBar[]>([]);
  const [failed, setFailed] = useState(false);
  const [shownDate, setShownDate] = useState<string | null>(date);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setShownDate(date);
    setDetail(null);
    setHours([]);
    setFailed(false);
    Promise.all([getSalesDetail(date), getSalesByHour(date)])
      .then(([sales, byHour]) => {
        if (cancelled) return;
        setDetail(sales);
        setHours(hourBars(byHour.hours ?? [], date, today, Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(new Date())) % 24));
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [date, today]);

  const day = shownDate;
  const weekday = day ? new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12)).getUTCDay() : 0;
  const title = day ? `${th ? WEEKDAY_TH[weekday] : WEEKDAY_EN[weekday]} ${reportRangeLabel({ from: day, to: day }, language)}` : '';
  const bills = [...(detail?.orders ?? [])].sort((a, b) => (a.completed_at < b.completed_at ? 1 : -1));
  const peak = Math.max(1, ...hours.map((bar) => bar.revenue));
  const clock = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  const stat = (label: string, value: string, color?: string) => (
    <View style={{ flex: 1, borderRadius: 12, backgroundColor: palette.accentSoft, paddingVertical: 6, paddingHorizontal: 10 }}>
      <Text style={{ fontSize: 11, color: palette.placeholder }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 15.5, fontWeight: '700', color: color ?? palette.textStrong, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );

  return (
    <BottomSheet open={date !== null} onClose={onClose} heightFraction={0.9} label={th ? 'ปิด' : 'Close'} showClose flushBottom>
      <SheetTitle
        title={title}
        subtitle={detail
          ? `${th ? `${bills.length.toLocaleString('th-TH')} บิล` : `${bills.length} bills`}${best ? (th ? ' · ขายดีสุดของช่วงนี้' : ' · best day of the period') : ''}${day === today ? (th ? ' · ยังไม่จบวัน' : ' · still open') : ''}`
          : (th ? 'กำลังโหลด' : 'Loading')}
      />
      {failed ? (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 20, fontSize: 14, color: palette.danger }}>{th ? 'โหลดข้อมูลของวันนี้ไม่ได้ ปิดแล้วลองใหม่' : 'Could not load this day. Close and try again.'}</Text>
      ) : !detail ? (
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>{[0, 1, 2].map((index) => <Bone key={index} height={48} radius={12} style={{ flex: 1 }} />)}</View>
          <Bone height={70} radius={10} />
          {[0, 1, 2, 3, 4].map((index) => <Bone key={index} height={40} radius={8} />)}
        </View>
      ) : (
        <View style={{ flex: 1, minHeight: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
            {stat(th ? 'ยอดขาย' : 'Sales', money(detail.summary.revenue, language))}
            {stat(th ? 'ต้นทุนวัตถุดิบ' : 'Ingredients', money(detail.summary.cost, language))}
            {stat(th ? 'กำไรขั้นต้น' : 'Gross profit', money(detail.summary.profit, language), detail.summary.profit >= 0 ? palette.success : palette.danger)}
          </View>
          {hours.length ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
              <Text style={{ fontSize: 11.5, color: palette.placeholder, marginBottom: 4 }}>{th ? `รายชั่วโมง ${hours[0].label}–${hours[hours.length - 1].label}` : `By hour ${hours[0].label}–${hours[hours.length - 1].label}`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 64 }}>
                {hours.map((bar) => (
                  <View key={bar.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    {bar.revenue > 0 ? (
                      <View style={{ width: '100%', height: Math.max(3, Math.round((bar.revenue / peak) * 54)), borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: bar.open ? BAR_OPEN : bar.revenue === peak ? BAR_BEST : BAR }} />
                    ) : (
                      <View style={{ width: '100%', height: 6, borderRadius: 2, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D6C3B6' }} />
                    )}
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                {hours.map((bar, index) => (
                  <Text key={bar.key} style={{ flex: 1, textAlign: 'center', fontSize: 9.5, color: '#8B6F5F' }}>{index % 2 === 0 ? bar.axis : ''}</Text>
                ))}
              </View>
            </View>
          ) : null}
          <ReportTable
            columns={[
              { key: 'time', label: th ? 'เวลา' : 'Time', width: 50 },
              { key: 'bill', label: th ? 'บิล' : 'Bill', flex: 1 },
              { key: 'amount', label: th ? 'ยอด' : 'Amount', width: 84, align: 'right' },
            ]}
            rows={bills.map((bill) => ({
              key: String(bill.order_id),
              label: `${clock(bill.completed_at)} ${bill.table_label || bill.customer_name} ${money(bill.revenue, language)}`,
              onPress: () => onOpenOrder(bill.order_id),
              cells: [
                <Cell key="time" muted>{clock(bill.completed_at)}</Cell>,
                <Cell
                  key="bill"
                  strong
                  sub={bill.order_number}
                >
                  {bill.table_label ? (th ? `โต๊ะ ${bill.table_label}` : `Table ${bill.table_label}`) : (bill.customer_name || (th ? 'ซื้อกลับบ้าน' : 'Takeaway'))}
                </Cell>,
                <Cell key="amount" align="right" strong>{money(bill.revenue, language)}</Cell>,
              ],
            }))}
            empty={th ? 'วันนี้ไม่มีบิลที่ชำระแล้ว' : 'No paid bills on this day'}
            bottomInset={insets.bottom + 16}
            language={language}
          />
          {detail.has_more ? (
            <Text style={{ paddingHorizontal: 16, paddingVertical: 8, fontSize: 12, color: palette.placeholder, textAlign: 'center' }}>{th ? 'แสดง 300 บิลแรกของวัน' : 'Showing the first 300 bills of the day'}</Text>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- period

/** The period under the title; opens the picker. */
export function PeriodButton({ label, onPress, language }: { label: string; onPress: () => void; language: Language }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={language === 'th' ? `ช่วงเวลา ${label} แตะเพื่อเปลี่ยน` : `Period ${label}, tap to change`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.accentMuted, opacity: pressed ? 0.7 : 1 })}
    >
      <AppIcon name="calendar-outline" size={16} color={palette.primaryInk} />
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: palette.primaryInk }}>{label}</Text>
      <AppIcon name="chevron-down" size={14} color={palette.primaryInk} />
    </Pressable>
  );
}

const WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/**
 * Choosing the period: a preset in one tap, or days on the calendar — tap one
 * day for that day alone, tap a second for the range between. Days after today
 * cannot be picked, and a range longer than the server takes says so instead
 * of being cut short without a word.
 */
export function PeriodSheet({ open, onClose, range, today, onApply, language }: {
  open: boolean;
  onClose: () => void;
  range: ReportRange;
  today: string;
  onApply: (range: ReportRange) => void;
  language: Language;
}) {
  const th = language === 'th';
  const [draft, setDraft] = useState<RangeDraft>({ from: range.from, to: range.to });
  const [month, setMonth] = useState(() => ({ year: Number(range.to.slice(0, 4)), month: Number(range.to.slice(5, 7)) }));
  useEffect(() => {
    if (!open) return;
    setDraft({ from: range.from, to: range.to });
    setMonth({ year: Number(range.to.slice(0, 4)), month: Number(range.to.slice(5, 7)) });
  }, [open, range.from, range.to]);

  const picked = draftToRange(draft);
  const tooLong = picked ? rangeDayCount(picked) > REPORT_MAX_DAYS : false;
  const thisMonth = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const atLatestMonth = month.year > thisMonth.year || (month.year === thisMonth.year && month.month >= thisMonth.month);
  const stepMonth = (delta: number) => setMonth((current) => {
    const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
    return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
  });

  const choosePreset = (preset: ReportPreset) => {
    onApply(presetRange(preset, today));
    onClose();
  };

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.9} label={th ? 'ปิด' : 'Close'} showClose>
      <SheetTitle title={th ? 'เลือกช่วงเวลา' : 'Choose a period'} subtitle={th ? 'แตะวันเดียวเพื่อดูวันนั้น หรือแตะวันที่สองเพื่อเลือกช่วง' : 'Tap one day for that day, or a second day for a range'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 16 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {REPORT_PRESETS.map((preset) => {
            const candidate = presetRange(preset, today);
            const on = candidate.from === range.from && candidate.to === range.to;
            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => choosePreset(preset)}
                style={({ pressed }) => ({ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: on ? palette.primary : palette.accentMuted, backgroundColor: on ? palette.primary : palette.surface, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontSize: 13.5, fontWeight: '600', color: on ? '#fff' : palette.primaryInk }}>{presetLabel(preset, language)}</Text>
              </Pressable>
            );
          })}
        </View>

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
            {(th ? WEEKDAYS_TH : WEEKDAYS_EN).map((name) => (
              <Text key={name} style={{ flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '600', color: palette.placeholder }}>{name}</Text>
            ))}
          </View>
          <View style={{ paddingHorizontal: 8, paddingBottom: 10, paddingTop: 4, gap: 2 }}>
            {calendarWeeks(month.year, month.month).map((week, index) => (
              <View key={index} style={{ flexDirection: 'row' }}>
                {week.map((day, cellIndex) => {
                  if (!day) return <View key={`e${cellIndex}`} style={{ flex: 1, height: 42 }} />;
                  const future = day > today;
                  const from = picked?.from;
                  const to = picked?.to;
                  const inside = Boolean(from && to && day >= from && day <= to);
                  const edge = day === from || day === to;
                  return (
                    <View key={day} style={{ flex: 1, height: 42, justifyContent: 'center', backgroundColor: inside && from !== to ? palette.surfaceStrong : 'transparent', borderTopLeftRadius: day === from ? 21 : 0, borderBottomLeftRadius: day === from ? 21 : 0, borderTopRightRadius: day === to ? 21 : 0, borderBottomRightRadius: day === to ? 21 : 0 }}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: edge, disabled: future }}
                        disabled={future}
                        onPress={() => setDraft((current) => tapRangeDay(current, day))}
                        style={({ pressed }) => ({ alignSelf: 'center', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: edge ? palette.primary : pressed ? palette.surfaceSubtle : 'transparent' })}
                      >
                        <Text style={{ fontSize: 14.5, fontWeight: edge || day === today ? '700' : '500', color: future ? '#D6C3B6' : edge ? '#fff' : day === today ? palette.primaryInk : palette.textStrong, fontVariant: ['tabular-nums'] }}>{Number(day.slice(8))}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </ReportCard>

        {tooLong ? (
          <Text style={{ fontSize: 13, color: palette.danger, textAlign: 'center' }}>{th ? `เลือกได้ไม่เกิน ${REPORT_MAX_DAYS} วัน` : `Choose ${REPORT_MAX_DAYS} days or fewer`}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!picked || tooLong}
          onPress={() => { if (picked) { onApply(picked); onClose(); } }}
          style={({ pressed }) => ({ height: 48, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.primary, opacity: !picked || tooLong ? 0.4 : pressed ? 0.85 : 1 })}
        >
          <Text style={{ fontSize: 15.5, fontWeight: '700', color: '#fff' }}>
            {picked
              ? (th ? `ดู ${reportRangeLabel(picked, language)}${picked.from !== picked.to ? ` · ${rangeDayCount(picked)} วัน` : ''}` : `Show ${reportRangeLabel(picked, language)}`)
              : (th ? 'แตะวันที่ในปฏิทิน' : 'Tap a day on the calendar')}
          </Text>
        </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}
