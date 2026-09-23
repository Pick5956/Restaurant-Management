import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { AppText as Text } from '@/src/components/app-text';
import { APP_FONT_FAMILIES } from '@/src/lib/app-font';
import type { AIChartData } from '@/src/types/ai';

import { ai } from './theme';

// A port of the web's AIChart (Recharts) to react-native-svg. Same rules: the
// backend chose the kind and the emphasis; this only draws. One scale places
// bars, ticks and labels; the legend is explicit, never colour-only.

const FADED = 0.42;
const MUTED = 0.28;
const FONT = APP_FONT_FAMILIES.regular;

const numberFormat = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 });

function fmt(value: number): string {
  return Math.abs(value) < 10 && !Number.isInteger(value) ? oneDecimal.format(value) : numberFormat.format(value);
}

function kNum(value: number): string {
  if (Math.abs(value) >= 1000) return `${oneDecimal.format(value / 1000)}k`;
  return fmt(value);
}

function truncate(label: string, max: number): string {
  const runes = Array.from(label);
  return runes.length > max ? `${runes.slice(0, max - 1).join('')}…` : label;
}

/** The colour a category's bar takes, following the web's fillFor/opacityFor. */
function cellStyle(data: AIChartData, index: number, seriesIndex: number): { fill: string; opacity: number } {
  const series = data.series[seriesIndex];
  const status = data.status?.[index];
  if (status) return { fill: ai.status[status], opacity: 1 };
  const base = series?.tone ? ai.cat[(series.tone - 1) % ai.cat.length] : ai.cat[seriesIndex % ai.cat.length];
  if (data.muted?.includes(index)) return { fill: base, opacity: MUTED };
  if (data.highlight && data.highlight.length > 0) {
    return { fill: base, opacity: data.highlight.includes(index) ? 1 : FADED };
  }
  return { fill: base, opacity: 1 };
}

function drawnSeries(data: AIChartData) {
  return data.series
    .map((series, index) => ({ series, index }))
    .filter(({ series }) => series.role !== 'tooltip' && series.values.length > 0);
}

/** Nice axis ticks: 0..max in 3 or 4 steps, on round numbers. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0];
  const rough = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 2.5, 5, 10].map((step) => step * magnitude);
  const step = candidates.find((candidate) => candidate >= rough) ?? candidates[candidates.length - 1];
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function statusLabel(key: 'critical' | 'warning' | 'good'): string {
  return { critical: 'หมด', warning: 'ต่ำกว่าขั้นต่ำ', good: 'พอ' }[key];
}

// ---------------------------------------------------------------- pieces

function VerticalBars({ data, width, height }: { data: AIChartData; width: number; height: number }) {
  const drawn = drawnSeries(data);
  const hasNotes = Boolean(data.notes?.some(Boolean));
  const margin = { top: 18, right: 8, bottom: hasNotes ? 30 : 20, left: 34 };
  const plotW = Math.max(1, width - margin.left - margin.right);
  const plotH = Math.max(1, height - margin.top - margin.bottom);
  const n = data.categories.length;
  const stacked = Boolean(data.stacked) && drawn.length > 1;
  const totals = data.categories.map((_, index) => (
    stacked
      ? drawn.reduce((sum, { series }) => sum + (series.values[index] ?? 0), 0)
      : Math.max(...drawn.map(({ series }) => series.values[index] ?? 0), 0)
  ));
  const max = Math.max(...totals, data.reference?.value ?? 0, 0);
  const ticks = ticksFor(max);
  const top = ticks[ticks.length - 1] || 1;
  const y = (value: number) => margin.top + plotH - (value / top) * plotH;
  const slot = plotW / Math.max(n, 1);
  const gap = slot * (stacked ? 0.22 : 0.18);
  const groupW = slot - gap;
  const perBar = stacked ? groupW : groupW / Math.max(drawn.length, 1);
  const barW = Math.min(perBar, data.compare ? 72 : 28);

  return (
    <Svg width={width} height={height}>
      {ticks.map((tick) => (
        <G key={`tick-${tick}`}>
          <Line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={ai.chartGrid} strokeOpacity={0.7} strokeWidth={1} />
          <SvgText x={margin.left - 4} y={y(tick) + 3.5} fontSize={10} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="end">{kNum(tick)}</SvgText>
        </G>
      ))}
      {data.categories.map((category, index) => {
        const groupX = margin.left + slot * index + gap / 2 + (groupW - (stacked ? barW : barW * drawn.length)) / 2;
        let stackBase = 0;
        return (
          <G key={`cat-${index}`}>
            {drawn.map(({ series, index: seriesIndex }, drawIndex) => {
              const value = series.values[index] ?? 0;
              const style = stacked
                ? { fill: series.tone ? ai.cat[(series.tone - 1) % ai.cat.length] : ai.cat[drawIndex % ai.cat.length], opacity: 1 }
                : cellStyle(data, index, seriesIndex);
              const x = stacked ? groupX : groupX + barW * drawIndex;
              const yTop = stacked ? y(stackBase + value) : y(value);
              const h = Math.max(0, (stacked ? y(stackBase) : y(0)) - yTop);
              const isTopOfStack = !stacked || drawIndex === drawn.length - 1;
              if (stacked) stackBase += value;
              return (
                <G key={`bar-${seriesIndex}`}>
                  <Path
                    d={roundedTop(x, yTop, barW, h, isTopOfStack ? 4 : 0)}
                    fill={style.fill}
                    fillOpacity={style.opacity}
                    stroke={stacked ? ai.surface : undefined}
                    strokeWidth={stacked ? 1 : 0}
                  />
                  {!stacked && value > 0 ? (
                    <SvgText x={x + barW / 2} y={yTop - 4} fontSize={10} fontFamily={FONT} fill={ai.chartInk} textAnchor="middle">{fmt(value)}</SvgText>
                  ) : null}
                </G>
              );
            })}
            {stacked && totals[index] > 0 ? (
              <SvgText x={groupX + barW / 2} y={y(totals[index]) - 4} fontSize={10} fontFamily={FONT} fill={ai.chartInk} textAnchor="middle">{fmt(totals[index])}</SvgText>
            ) : null}
            <SvgText x={margin.left + slot * index + slot / 2} y={margin.top + plotH + 13} fontSize={10.5} fontFamily={FONT} fill={ai.chartInk} textAnchor="middle">
              {truncate(category, Math.max(4, Math.floor(slot / 7)))}
            </SvgText>
            {data.notes?.[index] ? (
              <SvgText x={margin.left + slot * index + slot / 2} y={margin.top + plotH + 24} fontSize={9} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="middle">
                {truncate(data.notes[index], Math.max(4, Math.floor(slot / 6)))}
              </SvgText>
            ) : null}
          </G>
        );
      })}
      {data.reference ? (
        <G>
          <Line x1={margin.left} x2={width - margin.right} y1={y(data.reference.value)} y2={y(data.reference.value)} stroke={ai.chartInkSoft} strokeDasharray="3 3" strokeWidth={1} />
          <SvgText x={width - margin.right} y={y(data.reference.value) - 3} fontSize={9} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="end">{data.reference.label}</SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0 || w <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  if (radius <= 0) return `M${x} ${y} h${w} v${h} h${-w} Z`;
  return `M${x} ${y + radius} a${radius} ${radius} 0 0 1 ${radius} ${-radius} h${w - 2 * radius} a${radius} ${radius} 0 0 1 ${radius} ${radius} v${h - radius} h${-w} Z`;
}

function HorizontalBars({ data, width, height }: { data: AIChartData; width: number; height: number }) {
  const drawn = drawnSeries(data);
  const series = drawn[0];
  if (!series) return null;
  const labelW = 112;
  const margin = { top: 4, right: 68, bottom: data.reference ? 30 : 6, left: labelW };
  const plotW = Math.max(1, width - margin.left - margin.right);
  const rowH = 26;
  const values = data.categories.map((_, index) => series.series.values[index] ?? 0);
  const rawMax = Math.max(...values, 0);
  const max = data.reference ? Math.max(rawMax, data.reference.value * 1.15) : rawMax;
  const x = (value: number) => margin.left + (max > 0 ? (value / max) * plotW : 0);

  return (
    <Svg width={width} height={height}>
      {data.categories.map((category, index) => {
        const style = cellStyle(data, index, series.index);
        const yTop = margin.top + rowH * index + (rowH - 14) / 2;
        const value = values[index];
        return (
          <G key={`row-${index}`}>
            <SvgText x={labelW - 8} y={yTop + 11} fontSize={10.5} fontFamily={FONT} fill={ai.chartInk} textAnchor="end">{truncate(category, 14)}</SvgText>
            <Rect x={margin.left} y={yTop} width={Math.max(0, x(value) - margin.left)} height={14} rx={3} fill={style.fill} fillOpacity={style.opacity} />
            <SvgText x={x(value) + 6} y={yTop + 11} fontSize={10.5} fontFamily={FONT} fill={ai.chartInk}>
              {fmt(value)}{data.notes?.[index] ? `  ${data.notes[index]}` : ''}
            </SvgText>
          </G>
        );
      })}
      {data.reference ? (
        <G>
          <Line x1={x(data.reference.value)} x2={x(data.reference.value)} y1={margin.top} y2={margin.top + rowH * data.categories.length} stroke={ai.chartInkSoft} strokeDasharray="3 3" strokeWidth={1} />
          <SvgText x={x(data.reference.value)} y={margin.top + rowH * data.categories.length + 16} fontSize={9} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="middle">{data.reference.label}</SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

function LineChart({ data, width, height }: { data: AIChartData; width: number; height: number }) {
  const drawn = drawnSeries(data);
  const hasNotes = Boolean(data.notes?.some(Boolean));
  const margin = { top: 14, right: 10, bottom: hasNotes ? 30 : 20, left: 40 };
  const plotW = Math.max(1, width - margin.left - margin.right);
  const plotH = Math.max(1, height - margin.top - margin.bottom);
  const all = drawn.flatMap(({ series }) => series.values).concat(data.reference ? [data.reference.value] : []);
  const rawMax = Math.max(...all, 0);
  const rawMin = Math.min(...all, 0);
  const ticks = ticksFor(rawMax);
  const top = ticks[ticks.length - 1] || 1;
  const bottom = rawMin < 0 ? rawMin : 0;
  const y = (value: number) => margin.top + plotH - ((value - bottom) / (top - bottom || 1)) * plotH;
  const n = data.categories.length;
  const x = (index: number) => margin.left + (n > 1 ? (index / (n - 1)) * plotW : plotW / 2);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 48))));

  return (
    <Svg width={width} height={height}>
      {ticks.map((tick) => (
        <G key={`tick-${tick}`}>
          <Line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} stroke={ai.chartGrid} strokeOpacity={0.7} strokeWidth={1} />
          <SvgText x={margin.left - 5} y={y(tick) + 3.5} fontSize={10} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="end">{kNum(tick)}</SvgText>
        </G>
      ))}
      {drawn.map(({ series }, drawIndex) => {
        const colour = series.tone ? ai.cat[(series.tone - 1) % ai.cat.length] : ai.cat[drawIndex % ai.cat.length];
        const points = series.values.map((value, index) => ({ x: x(index), y: y(value), value }));
        const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
        return (
          <G key={`line-${drawIndex}`}>
            <Path d={path} stroke={colour} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((point, index) => {
              const emphasised = data.highlight?.includes(index);
              return (
                <Circle
                  key={`dot-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={emphasised ? 4.5 : 3.5}
                  fill={colour}
                  stroke={ai.surface}
                  strokeWidth={2}
                />
              );
            })}
          </G>
        );
      })}
      {data.categories.map((category, index) => (
        index % labelEvery === 0 || index === n - 1 ? (
          <G key={`x-${index}`}>
            <SvgText x={x(index)} y={margin.top + plotH + 13} fontSize={10} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="middle">{truncate(category, 8)}</SvgText>
            {data.notes?.[index] ? (
              <SvgText x={x(index)} y={margin.top + plotH + 24} fontSize={9} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="middle">{truncate(data.notes[index], 10)}</SvgText>
            ) : null}
          </G>
        ) : null
      ))}
      {data.reference ? (
        <G>
          <Line x1={margin.left} x2={width - margin.right} y1={y(data.reference.value)} y2={y(data.reference.value)} stroke={ai.chartInkSoft} strokeDasharray="3 3" strokeWidth={1} />
          <SvgText x={width - margin.right} y={y(data.reference.value) - 3} fontSize={9} fontFamily={FONT} fill={ai.chartInkSoft} textAnchor="end">{data.reference.label}</SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

function PieChart({ data, width, height }: { data: AIChartData; width: number; height: number }) {
  const series = drawnSeries(data)[0];
  if (!series) return null;
  const values = data.categories.map((_, index) => Math.max(0, series.series.values[index] ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = width / 2;
  const cy = height / 2;
  const r = 62;
  let angle = -Math.PI / 2;
  return (
    <Svg width={width} height={height}>
      {values.map((value, index) => {
        if (total <= 0 || value <= 0) return null;
        const sweep = (value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const large = sweep > Math.PI ? 1 : 0;
        const x1 = cx + r * Math.cos(start);
        const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);
        const y2 = cy + r * Math.sin(end);
        const d = sweep >= Math.PI * 2 - 0.0001
          ? `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`
          : `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
        const mid = start + sweep / 2;
        const lx = cx + (r + 18) * Math.cos(mid);
        const ly = cy + (r + 18) * Math.sin(mid);
        const pct = Math.round((value / total) * 100);
        return (
          <G key={`slice-${index}`}>
            <Path d={d} fill={ai.cat[index % ai.cat.length]} stroke={ai.surface} strokeWidth={2} />
            <SvgText x={lx} y={ly + 3.5} fontSize={11} fontFamily={FONT} fill={ai.chartInk} textAnchor={Math.cos(mid) < -0.1 ? 'end' : Math.cos(mid) > 0.1 ? 'start' : 'middle'}>
              {`${truncate(data.categories[index], 10)} ${pct}%`}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ---------------------------------------------------------------- card

function legendEntries(data: AIChartData): { colour: string; opacity: number; label: string }[] {
  const drawn = drawnSeries(data);
  const statuses = new Set((data.status ?? []).filter((status): status is 'critical' | 'warning' | 'good' => Boolean(status)));
  if (statuses.size > 0) {
    return (['critical', 'warning', 'good'] as const)
      .filter((key) => statuses.has(key))
      .map((key) => ({ colour: ai.status[key], opacity: 1, label: statusLabel(key) }));
  }
  if (data.muted && data.muted.length > 0 && data.muted_label) {
    const base = ai.cat[0];
    return [
      { colour: base, opacity: 1, label: drawn[0]?.series.name || data.title },
      { colour: base, opacity: MUTED, label: data.muted_label },
    ];
  }
  if (drawn.length > 1 && drawn.every(({ series }) => series.name)) {
    return drawn.map(({ series }, index) => ({
      colour: series.tone ? ai.cat[(series.tone - 1) % ai.cat.length] : ai.cat[index % ai.cat.length],
      opacity: 1,
      label: series.name ?? '',
    }));
  }
  return [];
}

// What is running low, as the web draws it since 22 ก.ย. 2569: how many ran
// out, how many are close, and the names as chips. The backend sends kind
// "stocklist" with one unit per row; drawn as bars it was three same-coloured
// bars per ingredient on one axis mixing มล. and กรัม (found 23 ก.ย. 2569).
function StockList({ data }: { data: AIChartData }) {
  const rows = data.categories.map((name, index) => ({ name, status: data.status?.[index] ?? '' }));
  const out = rows.filter((row) => row.status === 'critical');
  const low = rows.filter((row) => row.status === 'warning');
  const listed = [...out, ...low];
  if (listed.length === 0) return null;
  const count = (label: string, n: number, tone: string) => (
    <View>
      <Text style={{ fontSize: 11, color: ai.faint }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700', color: tone, lineHeight: 22 }}>
        {n} <Text style={{ fontSize: 12.5, fontWeight: '600', color: ai.faint }}>อย่าง</Text>
      </Text>
    </View>
  );
  return (
    <View style={{ marginTop: 8, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, backgroundColor: ai.surface, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
        {out.length > 0 ? count('หมดแล้ว', out.length, ai.status.critical) : null}
        {low.length > 0 ? (
          <View style={out.length > 0 ? { borderLeftWidth: 1, borderLeftColor: '#e5e7eb', paddingLeft: 12 } : undefined}>
            {count('ใกล้หมด', low.length, ai.status.warning)}
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {listed.map((row, index) => {
          const tone = row.status === 'critical' ? ai.status.critical : ai.status.warning;
          return (
            <View key={`${row.name}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: tone + '1f' }}>
              <Text style={{ fontSize: 12.5, fontWeight: '500', color: tone }}>{row.name}</Text>
              <Text style={{ fontSize: 11, color: tone, opacity: 0.7 }}>{row.status === 'critical' ? 'หมด' : 'ใกล้หมด'}</Text>
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 11, color: ai.faint }}>ดูจำนวนที่ต้องสั่งได้ในหน้าคลังวัตถุดิบ</Text>
    </View>
  );
}

export function AIChart({ data }: { data: AIChartData }) {
  const [width, setWidth] = useState(0);
  if (data.kind === 'stocklist') return <StockList data={data} />;
  const drawn = drawnSeries(data);
  if (drawn.length === 0 || data.categories.length === 0) return null;
  const horizontal = data.kind === 'bar' && data.layout === 'horizontal';
  const height = data.kind === 'pie'
    ? 190
    : horizontal
      ? data.categories.length * 26 + (data.reference ? 34 : 12)
      : 190;
  const legend = legendEntries(data);

  return (
    <View
      style={{
        marginTop: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 8,
        backgroundColor: ai.surface,
        padding: 10,
        gap: 6,
      }}
      onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width) - 20)}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontSize: 11.5, color: ai.faint, fontWeight: '500', flexShrink: 1 }}>{data.title}</Text>
        {data.unit ? <Text style={{ fontSize: 11, color: ai.faded }}>{data.unit}</Text> : null}
      </View>
      {width > 0 ? (
        data.kind === 'pie' ? <PieChart data={data} width={width} height={height} />
          : data.kind === 'line' ? <LineChart data={data} width={width} height={height} />
            : horizontal ? <HorizontalBars data={data} width={width} height={height} />
              : <VerticalBars data={data} width={width} height={height} />
      ) : (
        <View style={{ height }} />
      )}
      {legend.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 }}>
          {legend.map((entry) => (
            <View key={entry.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: entry.colour, opacity: entry.opacity }} />
              <Text style={{ fontSize: 11, color: ai.faint }}>{entry.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
