import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { SheetTitle } from '@/src/components/inventory/parts';
import { money } from '@/src/lib/format';
import {
  calendarWeeks,
  draftToRange,
  monthTitle,
  presetLabel,
  presetRange,
  rangeDayCount,
  readableAmount,
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
import type { ManagerReport, ReportTopMenuItem } from '@/src/types/report';

// The reports screen's pieces, in the overview's language: white cards with a
// warm hairline, the one orange block for sales, figures in tabular digits.

type Language = 'th' | 'en';
const CARD_EDGE = '#E4D8CD';
const BAR = '#E8743A';
const BAR_BEST = '#B93A0D';
const BAR_OPEN = '#F6C9AD';

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
export function SalesChart({ bars, best, average, height, hourly, language }: { bars: ReportBar[]; best: ReportBar | null; average: number; height: number; hourly: boolean; language: Language }) {
  const th = language === 'th';
  const [width, setWidth] = useState(0);
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
    <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
      {selected ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: palette.muted }}>
            {selected.label}{selected.open ? ` · ${openWord}` : selected.key === best?.key ? ` · ${bestWord}` : ''}
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
        {width > 0 ? (
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

/** Newest first, the best bar tinted. A single day lists only hours that sold. */
export function BarTable({ bars, best, hourly, language }: { bars: ReportBar[]; best: ReportBar | null; hourly: boolean; language: Language }) {
  const th = language === 'th';
  const cell = { fontSize: 13.5, color: palette.textStrong, fontVariant: ['tabular-nums' as const], textAlign: 'right' as const };
  const head = { fontSize: 12, fontWeight: '600' as const, color: palette.placeholder, textAlign: 'right' as const };
  const rows = hourly ? bars.filter((bar) => bar.revenue > 0 || bar.open) : bars;
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.divider }}>
        <Text style={[head, { flex: 1.2, textAlign: 'left' }]}>{hourly ? (th ? 'เวลา' : 'Hour') : (th ? 'วันที่' : 'Date')}</Text>
        <Text style={[head, { flex: 0.8 }]}>{th ? 'ออเดอร์' : 'Orders'}</Text>
        <Text style={[head, { flex: 1 }]}>{th ? 'ยอดขาย' : 'Sales'}</Text>
        <Text style={[head, { flex: 0.9 }]}>{th ? 'เฉลี่ย/บิล' : 'Per bill'}</Text>
      </View>
      {rows.length ? [...rows].reverse().map((bar) => {
        const isBest = best?.key === bar.key;
        return (
          <View key={bar.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 38, paddingHorizontal: 16, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#F3EDE7', backgroundColor: isBest ? palette.accentSoft : 'transparent' }}>
            <View style={{ flex: 1.2 }}>
              <Text style={[cell, { textAlign: 'left', fontWeight: isBest ? '700' : '500' }]}>{bar.label}</Text>
              {bar.open ? <Text style={{ fontSize: 11, color: palette.warning }}>{hourly ? (th ? 'ยังไม่จบชั่วโมง' : 'still open') : (th ? 'ยังไม่จบวัน' : 'still open')}</Text> : null}
            </View>
            <Text style={[cell, { flex: 0.8, color: palette.muted }]}>{bar.orders || '—'}</Text>
            <Text style={[cell, { flex: 1, fontWeight: isBest ? '700' : '600', color: bar.revenue > 0 ? palette.textStrong : palette.placeholder }]}>{bar.revenue > 0 ? money(bar.revenue, language) : (th ? 'ไม่มีขาย' : 'No sales')}</Text>
            <Text style={[cell, { flex: 0.9, color: palette.muted }]}>{bar.orders > 0 ? money(bar.revenue / bar.orders, language) : '—'}</Text>
          </View>
        );
      }) : (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>{th ? 'ยังไม่มียอดขาย' : 'No sales yet'}</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- menu

export function TopSellersCard({ items, periodLabel, language }: { items: ReportTopMenuItem[]; periodLabel: string; language: Language }) {
  const th = language === 'th';
  const top = items.slice(0, 10);
  const most = top[0]?.quantity || 1;
  return (
    <ReportCard>
      <CardHeading title={th ? 'เมนูขายดี' : 'Top sellers'} detail={periodLabel} />
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
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>{th ? 'ยังไม่มีเมนูขายในช่วงนี้' : 'No menu sales in this period'}</Text>
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
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>{th ? 'ยังคำนวณกำไรไม่ได้ในช่วงนี้ · เมนูที่มีสูตรวัตถุดิบเท่านั้นที่คิดต้นทุนได้' : 'No profit to show for this period · only menus with recipes can be costed'}</Text>
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
 * Stock is what is on the shelf now; the chosen period does not change it.
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
    const split = columns && list.length > 4;
    const half = Math.ceil(list.length / 2);
    const groups = split ? [list.slice(0, half), list.slice(half)] : [list];
    return (
      <ReportCard key={key}>
        <CardHeading
          title={title}
          detail={th ? 'สต๊อกตอนนี้ ไม่ขึ้นกับช่วงเวลาที่เลือก' : 'Stock right now, whatever period is chosen'}
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
