"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AIChartData, AIChartSeries } from "@/src/types/ai";

// AIChart draws a chart payload the backend computed. The numbers come from Go
// — this only draws them — so the picture always matches the answer text.
//
// One visual language for every shape:
//   · one series = one colour; emphasis is opacity, not a second hue
//   · a two-way comparison gets two colours, by role (subject / baseline)
//   · stacked parts and status colours carry meaning, so they are named in a
//     legend or a label — never colour alone
//   · rankings run left→right with the name on the left, so a Thai menu name
//     is never sliced or tilted under a bar
// Colours are CSS variables (globals.css) so both themes resolve them.

const PALETTE = ["var(--ai-cat-1)", "var(--ai-cat-2)", "var(--ai-cat-3)", "var(--ai-cat-4)"];
const STATUS: Record<string, string> = {
  critical: "var(--ai-critical)",
  warning: "var(--ai-warning)",
  good: "var(--ai-good)",
};
const INK = "var(--ai-chart-ink)";
const INK_SOFT = "var(--ai-chart-ink-soft)";
const GRID = "var(--ai-chart-grid)";
const SURFACE = "var(--ai-chart-surface)";
const FADED = 0.42;
const MUTED = 0.28;

function fmtNum(v: number) {
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(v);
}
function kNum(v: number) {
  return Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`;
}
function toneColor(series: AIChartSeries, index: number) {
  const slot = series.tone && series.tone >= 1 ? series.tone - 1 : index;
  return PALETTE[slot % PALETTE.length];
}
function statusLabel(status: string | undefined, language: "th" | "en") {
  switch (status) {
    case "critical":
      return language === "th" ? "หมด" : "out";
    case "warning":
      return language === "th" ? "ต่ำกว่าขั้นต่ำ" : "below minimum";
    case "good":
      return language === "th" ? "พอ" : "ok";
    default:
      return "";
  }
}

// Kept for the home dashboard, which draws its own charts with these. The
// assistant's charts no longer colour bars by position (see PALETTE).
export const BAR_COLORS = ["#ea580c", "#64748b", "#0ea5e9", "#16a34a", "#a855f7"];

type LegacyTooltipEntry = { name?: string; value?: number; payload?: { name?: string } };
export function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: ReadonlyArray<LegacyTooltipEntry>;
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  const heading = label ?? payload[0]?.name ?? payload[0]?.payload?.name ?? "";
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] shadow-sm dark:border-gray-700 dark:bg-gray-900">
      {heading ? <div className="font-medium text-gray-700 dark:text-gray-200">{heading}</div> : null}
      {payload.map((p, i) => (
        <div key={i} className="text-gray-500 dark:text-gray-400">
          {fmtNum(p.value ?? 0)}
          {unit ? ` ${unit}` : ""}
        </div>
      ))}
    </div>
  );
}

// One row per category: the drawn series as s0..sN, the ride-along ones as
// x0..xN, plus the hints the marks and the hover read back.
type Row = { name: string; note: string; status: string; index: number; share?: number } & Record<string, number | string | undefined>;

// Everything the small render pieces need, built once per render and handed to
// them as a prop. Recharts clones the element with its own props (active,
// payload, x, y…) on top, which is why they are module-level components rather
// than closures created during render.
type ChartContext = {
  data: AIChartData;
  rows: Row[];
  drawn: AIChartSeries[];
  extra: AIChartSeries[];
  language: "th" | "en";
  highlight: Set<number>;
  muted: Set<number>;
  horizontal: boolean;
  labelFor: (i: number) => boolean;
  valueText: (i: number) => string;
};

type TooltipEntry = { payload?: unknown };
function ChartHover({ active, payload, ctx }: { active?: boolean; payload?: ReadonlyArray<TooltipEntry>; ctx?: ChartContext }) {
  if (!ctx || !active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row || typeof row.index !== "number") return null;
  const { data, drawn, extra, language } = ctx;
  const unit = data.unit ?? "";
  const i = row.index;
  const muted = ctx.muted.has(i);
  const status = data.status?.[i];
  return (
    <div className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] leading-[1.55] text-gray-800 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
      <div className="font-medium">
        {row.name}
        {row.note ? <span className="ml-1 text-gray-400">· {row.note}</span> : null}
      </div>
      {drawn.map((s, k) => (
        <div key={k} className="tabular-nums text-gray-600 dark:text-gray-300">
          {drawn.length > 1 && s.name ? `${s.name} ` : ""}
          <span className="font-medium text-gray-800 dark:text-gray-100">{fmtNum(Number(row[`s${k}`] ?? 0))}</span>
          {unit ? ` ${unit}` : ""}
          {data.share && k === 0 && typeof row.share === "number" ? ` · ${row.share}%` : ""}
        </div>
      ))}
      {extra.map((s, k) => (
        <div key={`x${k}`} className="tabular-nums text-gray-500 dark:text-gray-400">
          {s.name} {fmtNum(Number(row[`x${k}`] ?? 0))}
          {unit ? ` ${unit}` : ""}
        </div>
      ))}
      {status ? <div className="text-gray-500 dark:text-gray-400">{statusLabel(status, language)}</div> : null}
      {muted && data.muted_label ? <div className="text-gray-500 dark:text-gray-400">{data.muted_label}</div> : null}
    </div>
  );
}

// A category label with its note underneath ("ก.ย." / "ถึงวันนี้").
function NotedTick({ x = 0, y = 0, payload, ctx }: { x?: number; y?: number; payload?: { value?: string; index?: number }; ctx?: ChartContext }) {
  const i = payload?.index ?? -1;
  const note = ctx?.rows[i]?.note;
  const strong = Boolean(ctx?.highlight.has(i)) || Boolean(note);
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={10} textAnchor="middle" fontSize={10} fill={strong ? INK : INK_SOFT}>
        {payload?.value}
      </text>
      {note ? (
        <text dy={21} textAnchor="middle" fontSize={8.5} fill={INK_SOFT}>
          {note}
        </text>
      ) : null}
    </g>
  );
}

// The figure beside (horizontal) or above (vertical) the bars the reader is
// meant to compare — never on every bar of a long series.
function ValueLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number; ctx?: ChartContext }) {
  const { ctx } = props;
  const index = props.index ?? -1;
  if (!ctx || index < 0 || !ctx.labelFor(index)) return null;
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const width = Number(props.width ?? 0);
  const height = Number(props.height ?? 0);
  const strong = ctx.highlight.has(index) || Boolean(ctx.data.compare);
  if (ctx.horizontal) {
    return (
      <text x={x + width + 6} y={y + height / 2} dy={4} fontSize={10.5} fontWeight={strong ? 600 : 400} fill={INK}>
        {ctx.valueText(index)}
      </text>
    );
  }
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={INK}>
      {ctx.valueText(index)}
    </text>
  );
}

// The marked point on a line: the last day, the one still running.
function MarkedDot({ cx, cy, index, ctx }: { cx?: number; cy?: number; index?: number; ctx?: ChartContext }) {
  if (!ctx || index === undefined || !ctx.highlight.has(index)) return <g />;
  return <circle cx={cx} cy={cy} r={3.5} fill={PALETTE[0]} stroke={SURFACE} strokeWidth={2} />;
}

// What is running low, as a list rather than a chart. Of ingredients that ran
// out every bar is zero, so the bar chart this replaced drew an empty frame
// with a column of names (เจ้าของทัก 20 ก.ย. 2569). A row carries the three
// numbers that decide anything: what is left, the minimum it is under, and how
// much to buy — laid out like a stock card, which is where the owner reads the
// same thing elsewhere in the app.
function StockList({ data, language }: { data: AIChartData; language: "th" | "en" }) {
  const th = language === "th";
  const stock = data.series[0]?.values ?? [];
  const minimum = data.series[1]?.values ?? [];
  const restock = data.series[2]?.values ?? [];
  const num = (v: number) => new Intl.NumberFormat(th ? "th-TH" : "en-US", { maximumFractionDigits: 2 }).format(v);

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{data.title}</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {th ? `${data.categories.length} รายการ` : `${data.categories.length} items`}
        </p>
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {data.categories.map((name, i) => {
          const left = stock[i] ?? 0;
          const min = minimum[i] ?? 0;
          const buy = restock[i] ?? 0;
          const unit = data.units?.[i] ?? data.unit ?? "";
          const status = data.status?.[i] ?? "";
          const out = status === "critical";
          const share = min > 0 ? Math.min(100, Math.max(0, (left / min) * 100)) : 0;
          const tone = out ? "var(--ai-critical)" : status === "warning" ? "var(--ai-warning)" : "var(--ai-good)";
          return (
            <li key={`${name}-${i}`} className="px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900 dark:text-white">{name}</p>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)` }}
                >
                  {statusLabel(status, language) || (th ? "พอ" : "ok")}
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-[15px] font-bold tabular-nums" style={{ color: out ? tone : undefined }}>
                  {num(left)}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{unit}</span>
                <span className="ml-auto text-[11px] text-gray-500 dark:text-gray-400">
                  {th ? "ขั้นต่ำ" : "minimum"} {num(min)} {unit}
                </span>
              </div>
              {/* The one drawn thing left: how full the shelf is against its own
                  minimum. Empty track when it ran out, which reads as empty. */}
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: tone }} />
              </div>
              {buy > 0 ? (
                <p className="mt-1.5 text-[11px] text-gray-600 dark:text-gray-300">
                  {th ? "ควรสั่งเพิ่ม" : "order"} <span className="font-semibold tabular-nums">{num(buy)}</span> {unit}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AIChart({ data, language = "th" }: { data: AIChartData; language?: "th" | "en" }) {
  if (!data || !data.categories?.length || !data.series?.length) return null;
  if (data.kind === "stocklist") return <StockList data={data} language={language} />;

  const drawn = data.series.filter((s) => s.role !== "tooltip");
  const extra = data.series.filter((s) => s.role === "tooltip");
  if (drawn.length === 0) return null;
  const primary = drawn[0];
  const total = primary.values.reduce((a, v) => a + (v > 0 ? v : 0), 0);

  const rows: Row[] = data.categories.map((name, i) => {
    const row: Row = { name, note: data.notes?.[i] ?? "", status: data.status?.[i] ?? "", index: i };
    drawn.forEach((s, k) => {
      row[`s${k}`] = s.values[i] ?? 0;
    });
    extra.forEach((s, k) => {
      row[`x${k}`] = s.values[i] ?? 0;
    });
    if (data.share && total > 0) row.share = Math.round(((primary.values[i] ?? 0) / total) * 100);
    return row;
  });

  const isLine = data.kind === "line";
  const isPie = data.kind === "pie";
  const horizontal = data.layout === "horizontal";
  const highlight = new Set(data.highlight ?? []);
  const muted = new Set(data.muted ?? []);

  // Opacity carries emphasis inside one colour: full for the marked entries,
  // faded for the rest, fainter still for the ones whose figure is not the
  // same kind (a month with no ledger).
  const opacityFor = (i: number) => {
    if (muted.has(i)) return MUTED;
    if (highlight.size === 0) return 1;
    return highlight.has(i) ? 1 : FADED;
  };
  const fillFor = (i: number) => {
    const status = data.status?.[i];
    if (status && STATUS[status]) return STATUS[status];
    if (data.compare && data.categories.length === 2) return PALETTE[i === 0 ? 0 : 1];
    return PALETTE[0];
  };
  // Value labels go on the entries the reader is meant to compare: both bars
  // of a comparison, every share, every row of a ranking, otherwise only the
  // highlighted ones.
  const labelFor = (i: number) => {
    if (data.compare || data.share || horizontal) return true;
    return highlight.has(i);
  };
  const valueText = (i: number) => {
    const v = primary.values[i] ?? 0;
    if (data.status?.[i] === "critical" && v <= 0) return language === "th" ? "หมด" : "out";
    const base = data.unit === "% ของขั้นต่ำ" ? `${Math.round(v)}%` : fmtNum(v);
    return data.share && typeof rows[i].share === "number" ? `${rows[i].share}% · ${base}` : base;
  };

  const ctx: ChartContext = { data, rows, drawn, extra, language, highlight, muted, horizontal, labelFor, valueText };

  const legend: { swatch: string; opacity?: number; text: string }[] = [];
  if (data.stacked || drawn.length > 1) {
    drawn.forEach((s, k) => legend.push({ swatch: toneColor(s, k), text: s.name ?? `#${k + 1}` }));
  }
  if (muted.size > 0 && data.muted_label) {
    legend.push({ swatch: PALETTE[0], text: language === "th" ? "หักรายจ่ายแล้ว" : "after expenses" });
    legend.push({ swatch: PALETTE[0], opacity: MUTED, text: data.muted_label });
  }
  if (data.status?.some(Boolean)) {
    for (const key of ["critical", "warning", "good"] as const) {
      if (data.status.includes(key)) legend.push({ swatch: STATUS[key], text: statusLabel(key, language) });
    }
  }

  const rowHeight = 26;
  const hasNotes = Boolean(data.notes?.some(Boolean));
  const height = isPie ? 190 : horizontal ? rows.length * rowHeight + (data.reference ? 34 : 18) : 190;
  const shortLabel = (value: string) => {
    const runes = Array.from(String(value ?? ""));
    return runes.length > 14 ? runes.slice(0, 13).join("") + "…" : runes.join("");
  };
  const referenceMax = data.reference ? data.reference.value * 1.15 : 0;

  return (
    <div className="ai-chart mt-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{data.title}</span>
        {data.unit && <span className="text-[11px] tabular-nums text-gray-400">{data.unit}</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        {isPie ? (
          <PieChart>
            <Tooltip content={<ChartHover ctx={ctx} />} />
            <Pie
              data={rows}
              dataKey="s0"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={62}
              stroke={SURFACE}
              strokeWidth={2}
              isAnimationActive={false}
              label={({ name, percent }: { name?: string; percent?: number }) =>
                typeof percent === "number" ? `${name ?? ""} ${Math.round(percent * 100)}%` : ""
              }
              labelLine={false}
              fontSize={11}
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : isLine ? (
          <LineChart data={rows} margin={{ top: 8, right: data.reference ? 48 : 10, bottom: 0, left: -14 }}>
            <CartesianGrid stroke={GRID} strokeOpacity={0.7} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: INK_SOFT }} tickLine={false} axisLine={false} minTickGap={18} />
            <YAxis tickFormatter={kNum} tick={{ fontSize: 10, fill: INK_SOFT }} tickLine={false} axisLine={false} width={40} domain={["auto", "auto"]} />
            <Tooltip content={<ChartHover ctx={ctx} />} />
            {data.reference ? (
              <ReferenceLine
                y={data.reference.value}
                stroke={INK_SOFT}
                strokeDasharray="3 3"
                label={{ value: data.reference.label, position: "right", fontSize: 9, fill: INK_SOFT }}
              />
            ) : null}
            <Line
              dataKey="s0"
              stroke={PALETTE[0]}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
              dot={<MarkedDot ctx={ctx} />}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </LineChart>
        ) : horizontal ? (
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 68, bottom: data.reference ? 16 : 0, left: 0 }} barCategoryGap={6}>
            <XAxis type="number" hide domain={[0, (dataMax: number) => Math.max(dataMax, referenceMax)]} />
            <YAxis
              type="category"
              dataKey="name"
              width={112}
              tick={{ fontSize: 10.5, fill: INK }}
              tickLine={false}
              axisLine={false}
              tickFormatter={shortLabel}
              interval={0}
            />
            <Tooltip cursor={{ fill: PALETTE[0], fillOpacity: 0.06 }} content={<ChartHover ctx={ctx} />} />
            {data.reference ? (
              <ReferenceLine
                x={data.reference.value}
                stroke={INK_SOFT}
                strokeDasharray="3 3"
                label={{ value: data.reference.label, position: "insideBottom", fontSize: 9, fill: INK_SOFT, dy: 14 }}
              />
            ) : null}
            <Bar dataKey="s0" radius={[3, 3, 3, 3]} isAnimationActive={false} barSize={14}>
              {rows.map((_, i) => (
                <Cell key={i} fill={fillFor(i)} fillOpacity={opacityFor(i)} />
              ))}
              <LabelList dataKey="s0" content={<ValueLabel ctx={ctx} />} />
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={rows} margin={{ top: 18, right: 8, bottom: hasNotes ? 12 : 0, left: -14 }} barCategoryGap={data.stacked ? "22%" : "18%"}>
            <CartesianGrid stroke={GRID} strokeOpacity={0.7} vertical={false} />
            <XAxis dataKey="name" tick={<NotedTick ctx={ctx} />} tickLine={false} axisLine={false} interval={0} height={hasNotes ? 30 : 20} />
            <YAxis tickFormatter={kNum} tick={{ fontSize: 10, fill: INK_SOFT }} tickLine={false} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: PALETTE[0], fillOpacity: 0.06 }} content={<ChartHover ctx={ctx} />} />
            {data.stacked ? (
              drawn.map((s, k) => (
                <Bar
                  key={k}
                  dataKey={`s${k}`}
                  stackId="stack"
                  fill={toneColor(s, k)}
                  stroke={SURFACE}
                  strokeWidth={1}
                  radius={k === drawn.length - 1 ? [3, 3, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))
            ) : (
              <Bar dataKey="s0" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={data.compare ? 72 : 28}>
                {rows.map((_, i) => (
                  <Cell key={i} fill={fillFor(i)} fillOpacity={opacityFor(i)} />
                ))}
                <LabelList dataKey="s0" content={<ValueLabel ctx={ctx} />} />
              </Bar>
            )}
          </BarChart>
        )}
      </ResponsiveContainer>
      {legend.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-0.5">
          {legend.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.swatch, opacity: item.opacity ?? 1 }} aria-hidden="true" />
              {item.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
