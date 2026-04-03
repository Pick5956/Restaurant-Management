"use client";

import { useAuth } from "@/src/providers/AuthProvider";
import {
  AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useState, useRef, useEffect } from "react";

// ─── chart config ─────────────────────────────────────────────────────────────
const TICK = { fontSize: 11, fill: "#94a3b8" } as const;

// ─── date helpers ─────────────────────────────────────────────────────────────
const toDateStr = (d: Date) => d.toISOString().split("T")[0];
function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function diffDays(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

function genRevenueTrend(from: Date, to: Date) {
  const days = diffDays(from, to);
  const buckets = days <= 14 ? days : days <= 60 ? Math.ceil(days / 3) : days <= 180 ? Math.ceil(days / 7) : Math.ceil(days / 14);
  const step = days / buckets;
  const seed = from.getTime();
  const rand = (i: number, base: number, amp: number) => {
    const x = Math.sin(seed / 1e9 + i * 1.3) * 10000;
    return Math.round(base + (x - Math.floor(x)) * amp);
  };
  return Array.from({ length: buckets }, (_, i) => {
    const d = addDays(from, Math.round(i * step));
    const label = days <= 60
      ? d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })
      : days <= 370
      ? d.toLocaleDateString("th-TH", { month: "short" })
      : d.toLocaleDateString("th-TH", { month: "short", year: "2-digit" });
    return { day: label, revenue: rand(i, 8000, 16000) };
  });
}

// ─── static data ─────────────────────────────────────────────────────────────
const hourlyOrders = [
  { hour: "09", orders: 5 },  { hour: "10", orders: 12 },
  { hour: "11", orders: 24 }, { hour: "12", orders: 48 },
  { hour: "13", orders: 42 }, { hour: "14", orders: 18 },
  { hour: "15", orders: 11 }, { hour: "16", orders: 14 },
  { hour: "17", orders: 22 }, { hour: "18", orders: 51 },
  { hour: "19", orders: 63 }, { hour: "20", orders: 55 },
  { hour: "21", orders: 38 }, { hour: "22", orders: 17 },
];

const topItems = [
  { name: "ผัดไทย",           sales: 142, revenue: 28400, growth: 8 },
  { name: "ต้มยำกุ้ง",        sales: 118, revenue: 35400, growth: 12 },
  { name: "ข้าวมันไก่",       sales: 104, revenue: 15600, growth: -3 },
  { name: "ข้าวผัดกุ้ง",      sales: 89,  revenue: 17800, growth: 5 },
  { name: "สเต็กหมู",         sales: 76,  revenue: 30400, growth: 18 },
  { name: "แกงมัสมั่น",       sales: 65,  revenue: 19500, growth: -1 },
];

const categoryRevenue = [
  { name: "อาหารจานหลัก",      value: 48, color: "#f97316" },
  { name: "เครื่องดื่ม",       value: 22, color: "#e2e8f0" },
  { name: "ของหวาน",           value: 15, color: "#cbd5e1" },
  { name: "อาหารเรียกน้ำย่อย", value: 10, color: "#94a3b8" },
  { name: "อื่น ๆ",            value: 5,  color: "#f1f5f9" },
];

const paymentMethods = [
  { name: "โอนเงิน",      value: 45, amount: 8370 },
  { name: "เงินสด",       value: 38, amount: 7083 },
  { name: "บัตรเครดิต",   value: 17, amount: 3169 },
];

// ─── preset ranges ────────────────────────────────────────────────────────────
type Preset = { label: string; days: number | null };
const PRESETS: Preset[] = [
  { label: "วันนี้",         days: 0 },
  { label: "เมื่อวาน",      days: 1 },
  { label: "7 วันล่าสุด",   days: 7 },
  { label: "30 วันล่าสุด",  days: 30 },
  { label: "2 เดือนล่าสุด", days: 60 },
  { label: "6 เดือนล่าสุด", days: 180 },
  { label: "1 ปีล่าสุด",    days: 365 },
  { label: "กำหนดเอง",      days: null },
];

function presetRange(p: Preset, today: Date): { from: Date; to: Date } {
  if (p.days === 0) return { from: today, to: today };
  if (p.days === 1) { const y = addDays(today, -1); return { from: y, to: y }; }
  if (p.days !== null) return { from: addDays(today, -(p.days - 1)), to: today };
  return { from: addDays(today, -29), to: today };
}

// ─── components ──────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, trend, icon }: {
  label: string; value: string; sub: string; trend: number; icon: React.ReactNode;
}) {
  const up = trend >= 0;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="w-8 h-8 rounded-lg bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400">
          {icon}
        </div>
        <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${
          up
            ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
            : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
        }`}>
          {up ? "↑" : "↓"}{Math.abs(trend)}%
        </span>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-[22px] font-bold text-gray-900 dark:text-white mt-0.5 leading-tight tracking-tight">{value}</p>
      <p className="text-xs text-gray-400 mt-1.5">{sub}</p>
    </div>
  );
}

function Card({ title, sub, children, action }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{title}</p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="p-6 flex-1">{children}</div>
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: { color: string; name: string; value: number }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg px-3 py-2.5 text-xs">
      <p className="text-gray-400 mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-5">
          <span className="flex items-center gap-1.5 text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {p.name.includes("฿") || p.name.includes("รายได้") || p.name.includes("ยอด")
              ? `฿${p.value.toLocaleString()}`
              : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// ─── Date Range Picker ────────────────────────────────────────────────────────
function DateRangePicker({ from, to, onChange }: {
  from: Date; to: Date;
  onChange: (from: Date, to: Date, label: string) => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [open, setOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("7 วันล่าสุด");
  const [customFrom, setCustomFrom] = useState(toDateStr(from));
  const [customTo, setCustomTo] = useState(toDateStr(to));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectPreset = (p: Preset) => {
    if (p.days === null) { setActivePreset(p.label); return; }
    setActivePreset(p.label);
    const { from: f, to: t } = presetRange(p, today);
    setCustomFrom(toDateStr(f));
    setCustomTo(toDateStr(t));
    onChange(f, t, p.label);
    setOpen(false);
  };

  const applyCustom = () => {
    const f = new Date(customFrom); const t = new Date(customTo);
    if (isNaN(f.getTime()) || isNaN(t.getTime()) || f > t) return;
    setActivePreset("กำหนดเอง");
    onChange(f, t, `${customFrom} ถึง ${customTo}`);
    setOpen(false);
  };

  const fmt = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  const label = from.getTime() === to.getTime() ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:border-orange-400 hover:text-orange-500 transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="whitespace-nowrap">{label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-4 min-w-[256px]">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">ช่วงเวลา</p>
          <div className="grid grid-cols-2 gap-1 mb-3">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => selectPreset(p)}
                className={`px-3 py-1.5 rounded-lg text-xs text-left transition-colors ${
                  activePreset === p.label
                    ? "bg-orange-500 text-white font-medium"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className={`space-y-2 transition-opacity ${activePreset === "กำหนดเอง" ? "opacity-100" : "opacity-30 pointer-events-none"}`}>
            <div className="h-px bg-gray-100 dark:bg-gray-800" />
            <div className="flex items-end gap-2 pt-1">
              <div className="flex-1">
                <p className="text-[10px] text-gray-400 mb-1">จากวันที่</p>
                <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400" />
              </div>
              <span className="text-gray-300 pb-1.5">—</span>
              <div className="flex-1">
                <p className="text-[10px] text-gray-400 mb-1">ถึงวันที่</p>
                <input type="date" value={customTo} min={customFrom} max={toDateStr(today)} onChange={e => setCustomTo(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-orange-400" />
              </div>
            </div>
            <button onClick={applyCustom}
              className="w-full py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg transition-colors">
              ดูข้อมูล
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const { user } = useAuth();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const [dateFrom, setDateFrom] = useState(() => addDays(today, -6));
  const [dateTo, setDateTo] = useState(today);
  const [rangeLabel, setRangeLabel] = useState("7 วันล่าสุด");

  const trendData = genRevenueTrend(dateFrom, dateTo);
  const days = diffDays(dateFrom, dateTo);

  const handleRange = (f: Date, t: Date, label: string) => {
    setDateFrom(f); setDateTo(t); setRangeLabel(label);
  };

  const totalRevenue = 18640 * Math.max(1, days / 7);
  const totalOrders = Math.round(87 * Math.max(1, days / 7));

  return (
    <div className="min-h-screen bg-[#f8f9fb] dark:bg-gray-950">

      {/* ── header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
        <div className="px-6 md:px-8 h-14 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-semibold text-gray-900 dark:text-white text-[15px]">ภาพรวมยอดขาย</h1>
            <p className="text-xs text-gray-400 leading-none mt-0.5">
              {rangeLabel}{user ? ` · ${user.first_name}` : ""}
            </p>
          </div>
          <DateRangePicker from={dateFrom} to={dateTo} onChange={handleRange} />
        </div>
      </div>

      <div className="px-6 md:px-8 py-6 max-w-screen-2xl mx-auto space-y-5">

        {/* ── KPI row ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <KpiCard
            label="รายได้รวม"
            value={`฿${totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            sub={`ช่วง ${days} วัน`}
            trend={12.4}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
              </svg>
            }
          />
          <KpiCard
            label="ออเดอร์ทั้งหมด"
            value={`${totalOrders.toLocaleString()} รายการ`}
            sub={`เฉลี่ย ฿214 / ออเดอร์`}
            trend={8.2}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6M9 16h4" />
              </svg>
            }
          />
          <KpiCard
            label="โต๊ะที่ใช้บริการ"
            value="14 / 20 โต๊ะ"
            sub="อัตราการใช้งาน 70%"
            trend={5.0}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <rect x="3" y="3" width="18" height="4" rx="1" /><path d="M5 7v13M19 7v13M8 20h8" />
              </svg>
            }
          />
          <KpiCard
            label="ลูกค้าทั้งหมด"
            value={`${Math.round(203 * Math.max(1, days / 7)).toLocaleString()} คน`}
            sub="เพิ่มขึ้นจากช่วงก่อน"
            trend={-3.1}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
              </svg>
            }
          />
        </div>

        {/* ── Revenue + Live status ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

          {/* revenue area chart */}
          <div className="xl:col-span-2">
            <Card title="แนวโน้มยอดขาย" sub={rangeLabel}>
              <ResponsiveContainer width="100%" height={268}>
                <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f97316" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="day" tick={TICK} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => `฿${(v / 1000).toFixed(0)}k`} width={44} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={12000} stroke="#e2e8f0" strokeDasharray="4 3" label={{ value: "เป้าหมาย", fill: "#cbd5e1", fontSize: 10, position: "right" }} />
                  <Area
                    type="monotone" dataKey="revenue" name="ยอดขาย (฿)"
                    stroke="#f97316" strokeWidth={2}
                    fill="url(#revGrad)"
                    dot={false}
                    activeDot={{ r: 4, fill: "#f97316", stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* live status */}
          <div>
            <Card title="สถานะร้านตอนนี้" sub="ข้อมูล ณ ปัจจุบัน" action={
              <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                สด
              </span>
            }>
              <div className="space-y-1 h-full">
                {[
                  {
                    label: "โต๊ะว่าง",
                    value: "6 โต๊ะ",
                    sub: "จาก 20 โต๊ะทั้งหมด",
                    icon: (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <rect x="3" y="3" width="18" height="4" rx="1" /><path d="M5 7v13M19 7v13M8 20h8" />
                      </svg>
                    ),
                  },
                  {
                    label: "ออเดอร์กำลังทำ",
                    value: "8 รายการ",
                    sub: "รอส่งถึงโต๊ะ 3 รายการ",
                    icon: (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                        <rect x="9" y="3" width="6" height="4" rx="1" />
                      </svg>
                    ),
                  },
                  {
                    label: "เวลารอเฉลี่ย",
                    value: "18 นาที",
                    sub: "ดีกว่าเป้า 20 นาที",
                    icon: (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                      </svg>
                    ),
                  },
                  {
                    label: "พนักงานออนดิวตี้",
                    value: "12 คน",
                    sub: "เชฟ 4 · เสิร์ฟ 8",
                    icon: (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                      </svg>
                    ),
                  },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center text-orange-500 shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-400">{item.label}</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.value}</p>
                    </div>
                    <p className="text-[11px] text-gray-400 text-right shrink-0 max-w-[90px] leading-snug">{item.sub}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* ── Top items + Hourly ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* top menu items */}
          <Card title="เมนูขายดี" sub="เรียงตามจำนวนออเดอร์">
            <div className="space-y-0.5">
              {/* header row */}
              <div className="grid grid-cols-12 gap-2 px-3 pb-2 text-[11px] text-gray-400 border-b border-gray-100 dark:border-gray-800">
                <span className="col-span-1">#</span>
                <span className="col-span-4">เมนู</span>
                <span className="col-span-2 text-right">จำนวน</span>
                <span className="col-span-3 text-right">รายได้</span>
                <span className="col-span-2 text-right">เทียบก่อน</span>
              </div>
              {topItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <span className={`col-span-1 text-xs font-bold ${i < 3 ? "text-orange-500" : "text-gray-300 dark:text-gray-600"}`}>
                    {i + 1}
                  </span>
                  <span className="col-span-4 text-sm text-gray-800 dark:text-gray-200 truncate">{item.name}</span>
                  <span className="col-span-2 text-right text-sm font-medium text-gray-700 dark:text-gray-300">{item.sales}</span>
                  <span className="col-span-3 text-right text-sm text-gray-500 dark:text-gray-400">
                    ฿{item.revenue.toLocaleString()}
                  </span>
                  <span className={`col-span-2 text-right text-xs font-medium ${
                    item.growth >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"
                  }`}>
                    {item.growth >= 0 ? "+" : ""}{item.growth}%
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* hourly bar chart */}
          <Card title="ออเดอร์รายชั่วโมง" sub="ชั่วโมง peak ของวัน">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hourlyOrders} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="hour" tick={TICK} axisLine={false} tickLine={false} tickFormatter={v => `${v}`} />
                <YAxis tick={TICK} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="orders" name="ออเดอร์" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {hourlyOrders.map((e, i) => (
                    <Cell
                      key={i}
                      fill={e.orders >= 50 ? "#f97316" : e.orders >= 25 ? "#fdba74" : "#fef3e2"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* ── Category + Payment ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* donut */}
          <Card title="สัดส่วนรายได้" sub="แบ่งตามหมวดหมู่">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <ResponsiveContainer width={160} height={160}>
                  <PieChart>
                    <Pie
                      data={categoryRevenue} cx="50%" cy="50%"
                      innerRadius={52} outerRadius={72}
                      dataKey="value" paddingAngle={2} stroke="none"
                      startAngle={90} endAngle={-270}
                    >
                      {categoryRevenue.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={v => [`${v}%`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <p className="text-xl font-bold text-gray-900 dark:text-white">48%</p>
                  <p className="text-[10px] text-gray-400">จานหลัก</p>
                </div>
              </div>
              <div className="w-full space-y-2">
                {categoryRevenue.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <span className="font-medium text-gray-700 dark:text-gray-300">{c.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* payment methods */}
          <div className="lg:col-span-2">
            <Card title="ช่องทางชำระเงิน" sub="สัดส่วนและยอดรวม">
              <div className="space-y-5">
                {paymentMethods.map((p, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700 dark:text-gray-300">{p.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">฿{p.amount.toLocaleString()}</span>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white w-8 text-right">{p.value}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-orange-500 transition-all duration-700"
                        style={{ width: `${p.value}%`, opacity: 1 - i * 0.2 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* summary stats */}
          <div className="lg:col-span-2">
            <Card title="สรุปช่วงเวลา" sub={rangeLabel}>
              <div className="space-y-0">
                {[
                  { label: "รายได้เฉลี่ย / วัน",    value: `฿${(totalRevenue / days).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                  { label: "ออเดอร์เฉลี่ย / วัน",   value: `${Math.round(totalOrders / days)} รายการ` },
                  { label: "มูลค่าเฉลี่ย / โต๊ะ",   value: "฿1,331" },
                  { label: "อัตราหมุนเวียนโต๊ะ",    value: "3.2 รอบ / วัน" },
                  { label: "กำไรขั้นต้น (est.)",      value: "~62%" },
                  { label: "ชั่วโมง peak",             value: "19:00 – 20:00 น." },
                ].map((row, i) => (
                  <div key={i} className={`flex items-center justify-between py-2.5 text-sm ${
                    i !== 0 ? "border-t border-gray-50 dark:border-gray-800" : ""
                  }`}>
                    <span className="text-gray-500 dark:text-gray-400">{row.label}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{row.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>

      </div>
    </div>
  );
}
