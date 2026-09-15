import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { money } from '@/src/lib/format';
import { readableAmount, reportDayLabel, type ReportDay, type ReportTab } from '@/src/lib/report-view';
import { palette } from '@/src/theme';
import type { ManagerReport, ReportTopMenuItem } from '@/src/types/report';

// The reports screen's pieces, in the overview's language: white cards with a
// warm hairline, the one orange block for sales, figures in tabular digits.

type Language = 'th' | 'en';
const CARD_EDGE = '#E4D8CD';
const BAR = '#E8743A';
const BAR_BEST = '#B93A0D';
const BAR_TODAY = '#F6C9AD';

export function ReportCard({ children, style }: { children: ReactNode; style?: object }) {
  return (
    <View style={[{ borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }, style]}>
      {children}
    </View>
  );
}

export function CardHeading({ title, detail, trailing }: { title: string; detail?: string; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" style={{ fontSize: 15.5, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
        {detail ? <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>{detail}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

// ---------------------------------------------------------------- figures

export type ReportFigure = { key: string; label: string; value: string; note?: string; tone?: 'hero' | 'good' };

/**
 * The five figures. A row of five on a tablet; on a phone they scroll sideways
 * as one strip, so the tabs below stay in the first screenful.
 */
export function ReportFigures({ figures, tablet }: { figures: ReportFigure[]; tablet: boolean }) {
  const card = (figure: ReportFigure) => {
    const hero = figure.tone === 'hero';
    const body = (
      <>
        <Text numberOfLines={1} style={{ fontSize: 12, color: hero ? 'rgba(255,255,255,0.88)' : palette.placeholder }}>{figure.label}</Text>
        <Text numberOfLines={1} style={{ fontSize: tablet ? 23 : 19, lineHeight: tablet ? 29 : 24, fontWeight: '700', color: hero ? '#fff' : figure.tone === 'good' ? palette.success : palette.textStrong, fontVariant: ['tabular-nums'] }}>{figure.value}</Text>
        {figure.note ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: hero ? 'rgba(255,255,255,0.88)' : palette.placeholder }}>{figure.note}</Text> : null}
      </>
    );
    const frame = { borderRadius: 18, borderCurve: 'continuous' as const, paddingVertical: tablet ? 12 : 9, paddingHorizontal: tablet ? 14 : 12, ...(tablet ? { flex: 1 } : { minWidth: 118 }) };
    return hero ? (
      <LinearGradient key={figure.key} colors={['#B93A0D', '#D9581F', '#EF7A35']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={frame}>{body}</LinearGradient>
    ) : (
      <View key={figure.key} style={[frame, { borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface }]}>{body}</View>
    );
  };
  if (tablet) return <View style={{ flexDirection: 'row', gap: 10 }}>{figures.map(card)}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16 }}>
      <View style={{ width: 8 }} />
      {figures.map(card)}
      <View style={{ width: 8 }} />
    </ScrollView>
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
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', alignSelf: tablet ? 'flex-start' : 'stretch', width: tablet ? 440 : undefined, padding: 4, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.divider }}>
      {options.map((option) => {
        const on = option.key === tab;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onTab(option.key)}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999, backgroundColor: on ? palette.surface : 'transparent', opacity: pressed && !on ? 0.6 : 1, ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) })}
          >
            <Text style={{ fontSize: 14.5, fontWeight: on ? '700' : '600', color: on ? palette.textStrong : palette.muted }}>{option.label}</Text>
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
 * Daily sales as bars. The best day is the dark bar, today (still selling) the
 * pale one, a day with no sales a dashed outline. Tapping a bar puts that day's
 * figures above the chart; it opens on the best day.
 */
export function SalesChart({ days, best, average, height, language }: { days: ReportDay[]; best: ReportDay | null; average: number; height: number; language: Language }) {
  const th = language === 'th';
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((day) => day.date === picked) ?? best ?? days.at(-1) ?? null;
  const max = niceMax(Math.max(...days.map((day) => day.revenue), 0));
  const padLeft = 38;
  const padBottom = 20;
  const padTop = 8;
  const gap = days.length > 20 ? 3 : width < 500 ? 5 : 9;
  const barWidth = width > 0 ? Math.max(4, (width - padLeft - gap * (days.length - 1)) / days.length) : 0;
  const plot = height - padTop - padBottom;
  const y = (value: number) => padTop + plot * (1 - value / max);
  const labelEvery = barWidth < 22 ? 2 : 1;

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
      {selected ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: palette.muted }}>
            {reportDayLabel(selected.date, language)}{selected.today ? (th ? ' · วันนี้ ยังไม่จบวัน' : ' · today, still open') : selected === best ? (th ? ' · ขายดีสุด' : ' · best day') : ''}
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{selected.revenue > 0 ? money(selected.revenue, language) : (th ? 'ไม่มีขาย' : 'No sales')}</Text>
          {selected.orders > 0 ? <Text style={{ fontSize: 13, color: palette.placeholder }}>{th ? `${selected.orders} ออเดอร์` : `${selected.orders} orders`}</Text> : null}
        </View>
      ) : null}
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {[0, max / 2, max].map((tick) => (
              <Line key={tick} x1={padLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke="#F1E8DF" strokeWidth={1} />
            ))}
            {[0, max / 2, max].map((tick) => (
              <SvgText key={`t${tick}`} x={padLeft - 6} y={y(tick) + 4} fontSize={10.5} fill="#8B6F5F" textAnchor="end">{tick >= 1000 ? `${Math.round(tick / 100) / 10}k` : String(tick)}</SvgText>
            ))}
            {days.map((day, index) => {
              const x = padLeft + index * (barWidth + gap);
              const isBest = best?.date === day.date;
              const on = selected?.date === day.date;
              const label = index % labelEvery === 0 || on ? (
                <SvgText x={x + barWidth / 2} y={height - 5} fontSize={10.5} fontWeight={on ? '700' : '400'} fill={on ? palette.textStrong : '#8B6F5F'} textAnchor="middle">{Number(day.date.slice(8))}</SvgText>
              ) : null;
              if (day.revenue <= 0) {
                const stub = Math.min(plot, 18);
                return (
                  <G key={day.date}>
                    <Rect x={x + 0.5} y={y(0) - stub} width={Math.max(1, barWidth - 1)} height={stub} rx={3} fill="none" stroke="#D6C3B6" strokeDasharray="3 3" />
                    {label}
                  </G>
                );
              }
              return (
                <G key={day.date}>
                  <Rect x={x} y={y(day.revenue)} width={barWidth} height={y(0) - y(day.revenue)} rx={Math.min(5, barWidth / 3)} fill={day.today ? BAR_TODAY : isBest ? BAR_BEST : BAR} opacity={on || !picked ? 1 : 0.75} />
                  {label}
                </G>
              );
            })}
            {average > 0 ? <Line x1={padLeft} x2={width} y1={y(average)} y2={y(average)} stroke={palette.textStrong} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.5} /> : null}
          </Svg>
        ) : null}
        {width > 0 ? (
          <View style={{ position: 'absolute', left: padLeft, top: 0, right: 0, bottom: 0, flexDirection: 'row', gap }}>
            {days.map((day) => (
              <Pressable
                key={day.date}
                accessibilityRole="button"
                accessibilityLabel={`${reportDayLabel(day.date, language)} ${day.revenue > 0 ? money(day.revenue, language) : (th ? 'ไม่มีขาย' : 'no sales')}`}
                onPress={() => setPicked(day.date)}
                style={{ width: barWidth, height: '100%' }}
              />
            ))}
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, paddingHorizontal: 4 }}>
        <Legend swatch={<View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: BAR_BEST }} />} label={th ? 'ขายดีสุด' : 'Best day'} />
        <Legend swatch={<View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: BAR_TODAY }} />} label={th ? 'วันนี้ ยังไม่จบวัน' : 'Today, still open'} />
        <Legend swatch={<View style={{ width: 9, height: 9, borderRadius: 3, borderWidth: 1, borderStyle: 'dashed', borderColor: '#B49A8A' }} />} label={th ? 'ไม่มีขาย' : 'No sales'} />
        {average > 0 ? <Legend swatch={<View style={{ width: 14, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: palette.muted }} />} label={th ? `เฉลี่ย ${money(average, language)}` : `Average ${money(average, language)}`} /> : null}
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

// ---------------------------------------------------------------- day table

/** Newest day first, the best day tinted. */
export function DayTable({ days, best, language, showAverage }: { days: ReportDay[]; best: ReportDay | null; language: Language; showAverage: boolean }) {
  const th = language === 'th';
  const cell = { fontSize: 13.5, color: palette.textStrong, fontVariant: ['tabular-nums' as const], textAlign: 'right' as const };
  const head = { fontSize: 12, fontWeight: '600' as const, color: palette.placeholder, textAlign: 'right' as const };
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.divider }}>
        <Text style={[head, { flex: 1.2, textAlign: 'left' }]}>{th ? 'วันที่' : 'Date'}</Text>
        <Text style={[head, { flex: 0.8 }]}>{th ? 'ออเดอร์' : 'Orders'}</Text>
        <Text style={[head, { flex: 1 }]}>{th ? 'ยอดขาย' : 'Sales'}</Text>
        {showAverage ? <Text style={[head, { flex: 0.9 }]}>{th ? 'เฉลี่ย/บิล' : 'Per bill'}</Text> : null}
      </View>
      {[...days].reverse().map((day) => {
        const isBest = best?.date === day.date;
        return (
          <View key={day.date} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 38, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3EDE7', backgroundColor: isBest ? palette.accentSoft : 'transparent' }}>
            <Text style={[cell, { flex: 1.2, textAlign: 'left', fontWeight: isBest ? '700' : '500' }]}>
              {reportDayLabel(day.date, language)}
              {day.today ? <Text style={{ fontSize: 11, color: palette.warning }}>{th ? '  ยังไม่จบวัน' : '  open'}</Text> : null}
            </Text>
            <Text style={[cell, { flex: 0.8, color: palette.muted }]}>{day.orders || '—'}</Text>
            <Text style={[cell, { flex: 1, fontWeight: isBest ? '700' : '600', color: day.revenue > 0 ? palette.textStrong : palette.placeholder }]}>{day.revenue > 0 ? money(day.revenue, language) : (th ? 'ไม่มีขาย' : 'No sales')}</Text>
            {showAverage ? <Text style={[cell, { flex: 0.9, color: palette.muted }]}>{day.orders > 0 ? money(day.revenue / day.orders, language) : '—'}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- menu

function MonthStepper({ label, onPrev, onNext, canPrev, canNext, loading, language }: { label: string; onPrev: () => void; onNext: () => void; canPrev: boolean; canNext: boolean; loading: boolean; language: Language }) {
  const step = (icon: AppIconName, onPress: () => void, enabled: boolean, name: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      disabled={!enabled || loading}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: enabled ? palette.accentMuted : palette.divider, opacity: pressed ? 0.6 : 1 })}
    >
      <AppIcon name={icon} size={16} color={enabled ? palette.primaryInk : '#D6C3B6'} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {step('chevron-back', onPrev, canPrev, language === 'th' ? 'เดือนก่อน' : 'Previous month')}
      <View style={{ minWidth: 76, alignItems: 'center' }}>
        {loading ? <ActivityIndicator size="small" color={palette.primary} /> : <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{label}</Text>}
      </View>
      {step('chevron-forward', onNext, canNext, language === 'th' ? 'เดือนถัดไป' : 'Next month')}
    </View>
  );
}

export function TopSellersCard({ items, monthLabel, shortMonthLabel, onPrev, onNext, canPrev, canNext, loading, language }: {
  items: ReportTopMenuItem[];
  monthLabel: string;
  shortMonthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  loading: boolean;
  language: Language;
}) {
  const th = language === 'th';
  const top = items.slice(0, 10);
  const most = top[0]?.quantity || 1;
  return (
    <ReportCard>
      <CardHeading
        title={th ? 'เมนูขายดี' : 'Top sellers'}
        detail={th ? `ทั้งเดือน ${monthLabel}` : `All of ${monthLabel}`}
        trailing={<MonthStepper label={shortMonthLabel} onPrev={onPrev} onNext={onNext} canPrev={canPrev} canNext={canNext} loading={loading} language={language} />}
      />
      {top.length ? top.map((item, index) => (
        <View key={`${item.menu_id}-${item.menu_name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: palette.divider }}>
          <Text style={{ width: 24, fontSize: 13, fontWeight: '600', color: index < 3 ? palette.primaryInk : palette.placeholder, fontVariant: ['tabular-nums'] }}>{index + 1}</Text>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{item.menu_name}</Text>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: '#FDE2CF', overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(4, Math.round((item.quantity / most) * 100))}%`, height: 5, borderRadius: 3, backgroundColor: BAR }} />
            </View>
          </View>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{th ? `${item.quantity.toLocaleString('th-TH')} จาน` : `${item.quantity.toLocaleString('en-US')} sold`}</Text>
        </View>
      )) : (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>{th ? 'ยังไม่มีเมนูขายในเดือนนี้' : 'No menu sales this month yet'}</Text>
      )}
    </ReportCard>
  );
}

export function MenuProfitCard({ items, periodLabel, language }: { items: ManagerReport['menu_margins']; periodLabel: string; language: Language }) {
  const th = language === 'th';
  const locale = th ? 'th-TH' : 'en-US';
  return (
    <ReportCard>
      <CardHeading title={th ? 'กำไรต่อเมนู' : 'Menu profit'} detail={th ? `${periodLabel} · เรียงจากกำไรสูงสุด` : `${periodLabel} · highest profit first`} />
      {items.length ? items.map((item) => (
        <View key={item.menu_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: 1, borderTopColor: palette.divider }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{item.menu_name}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>
              {th
                ? `${item.quantity.toLocaleString(locale)} จาน · รายได้ ${money(item.revenue, language)} · มาร์จิน ${Number(item.margin).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                : `${item.quantity.toLocaleString(locale)} sold · revenue ${money(item.revenue, language)} · margin ${Number(item.margin).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
            </Text>
          </View>
          <Text style={{ fontSize: 15, fontWeight: '700', color: item.profit < 0 ? palette.danger : palette.textStrong, fontVariant: ['tabular-nums'] }}>{money(item.profit, language)}</Text>
        </View>
      )) : (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>{th ? 'ยังคำนวณกำไรไม่ได้ · เพิ่มสูตรวัตถุดิบในเมนูเพื่อคำนวณต้นทุน' : 'Profit cannot be calculated yet · add recipes to the menu to cost it'}</Text>
      )}
    </ReportCard>
  );
}

// ---------------------------------------------------------------- stock

type StockRisk = ManagerReport['stock_risks'][number];

function StockRow({ risk, language, first }: { risk: StockRisk; language: Language; first: boolean }) {
  const th = language === 'th';
  const out = risk.status === 'out';
  const ink = out ? palette.danger : palette.warning;
  const locale = th ? 'th-TH' : 'en-US';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16, paddingVertical: 6, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: ink }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{risk.name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>{risk.category || (th ? 'ไม่มีหมวด' : 'Uncategorized')}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 13.5, fontWeight: '700', color: palette.textStrong }}>{th ? `เติมราว ${readableAmount(Number(risk.restock_estimate), risk.unit, language)}` : `Buy about ${readableAmount(Number(risk.restock_estimate), risk.unit, language)}`}</Text>
        <Text style={{ fontSize: 11.5, color: ink, fontVariant: ['tabular-nums'] }}>
          {out ? (th ? 'หมดแล้ว' : 'Out') : (th ? `เหลือ ${Number(risk.stock).toLocaleString(locale, { maximumFractionDigits: 1 })} ${risk.unit}` : `${Number(risk.stock).toLocaleString(locale, { maximumFractionDigits: 1 })} ${risk.unit} left`)}
        </Text>
      </View>
    </View>
  );
}

/**
 * Out of stock, then running low, each in its own card. On a tablet the rows of
 * a long card run in two columns so twenty items are not twenty screen-widths.
 */
export function StockRisksView({ out, low, language, columns, onOpenInventory }: { out: StockRisk[]; low: StockRisk[]; language: Language; columns: boolean; onOpenInventory: () => void }) {
  const th = language === 'th';
  if (!out.length && !low.length) {
    return (
      <ReportCard>
        <Text style={{ paddingHorizontal: 16, paddingVertical: 22, fontSize: 14, color: palette.placeholder, textAlign: 'center' }}>{th ? 'ไม่มีวัตถุดิบที่หมดหรือใกล้หมด' : 'Nothing is out or running low'}</Text>
      </ReportCard>
    );
  }
  const section = (key: string, title: string, tone: string, list: StockRisk[]) => {
    if (!list.length) return null;
    const half = columns && list.length > 4 ? Math.ceil(list.length / 2) : list.length;
    const groups = columns && list.length > 4 ? [list.slice(0, half), list.slice(half)] : [list];
    return (
      <ReportCard key={key}>
        <CardHeading
          title={title}
          trailing={<Text style={{ fontSize: 13, fontWeight: '700', color: tone, fontVariant: ['tabular-nums'] }}>{th ? `${list.length} รายการ` : `${list.length} items`}</Text>}
        />
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: palette.divider }}>
          {groups.map((group, index) => (
            <View key={index} style={{ flex: 1, minWidth: 0, borderLeftWidth: index ? 1 : 0, borderLeftColor: palette.divider }}>
              {group.map((risk, row) => <StockRow key={risk.id} risk={risk} language={language} first={row === 0} />)}
            </View>
          ))}
        </View>
      </ReportCard>
    );
  };
  return (
    <View style={{ gap: 12 }}>
      {section('out', th ? 'หมดแล้ว' : 'Out of stock', palette.danger, out)}
      {section('low', th ? 'ใกล้หมด' : 'Running low', palette.warning, low)}
      <Pressable accessibilityRole="button" onPress={onOpenInventory} style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: palette.surfaceSubtle, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ fontSize: 13.5, fontWeight: '600', color: palette.primaryInk }}>{th ? 'ไปที่คลังวัตถุดิบ' : 'Open inventory'}</Text>
        <AppIcon name="chevron-forward" size={15} color={palette.primaryInk} />
      </Pressable>
    </View>
  );
}
