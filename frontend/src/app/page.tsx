"use client";

import { useAuth } from "@/src/providers/AuthProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import { useEffect, useRef, useState, type ReactNode } from "react";

// ── theme toggle ───────────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "สลับเป็น Light mode" : "สลับเป็น Dark mode"}
      className="w-9 h-9 flex items-center justify-center rounded-full border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-900/60 backdrop-blur hover:bg-white dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
        </svg>
      )}
    </button>
  );
}

// ── reveal-on-scroll helper ────────────────────────────────────────────────
function Reveal({
  children,
  delay = 0,
  className = "",
  from = "up",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  from?: "up" | "left" | "right" | "scale";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const hidden =
    from === "left" ? "-translate-x-8 opacity-0"
    : from === "right" ? "translate-x-8 opacity-0"
    : from === "scale" ? "scale-95 opacity-0"
    : "translate-y-8 opacity-0";

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out will-change-transform ${
        visible ? "translate-x-0 translate-y-0 scale-100 opacity-100" : hidden
      } ${className}`}
    >
      {children}
    </div>
  );
}

// ── animated counter ───────────────────────────────────────────────────────
function Counter({ target, suffix = "", prefix = "", duration = 1600 }: {
  target: number; suffix?: string; prefix?: string; duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      obs.disconnect();
      const start = performance.now();
      const step = (t: number) => {
        const p = Math.min((t - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setN(target * eased);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [target, duration]);

  const display = target >= 100 ? Math.floor(n).toLocaleString() : n.toFixed(1);
  return <span ref={ref}>{prefix}{display}{suffix}</span>;
}

// ── data ───────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    title: "จัดการออเดอร์",
    desc: "รับออเดอร์จากหน้าร้าน ส่งเข้าครัวอัตโนมัติ ติดตามสถานะแต่ละโต๊ะได้แบบ real-time",
    icon: <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 3h6a1 1 0 011 1v2a1 1 0 01-1 1H9a1 1 0 01-1-1V4a1 1 0 011-1zM9 12h6M9 16h4" />,
    color: "from-orange-500 to-red-500",
  },
  {
    title: "จัดการโต๊ะ & ที่นั่ง",
    desc: "ผังร้านแบบลาก-วาง ดูสถานะโต๊ะว่าง/จอง/ใช้งาน และจัดการการจองล่วงหน้า",
    icon: <path d="M3 3h18v4H3zM5 7v13M19 7v13M8 20h8" />,
    color: "from-blue-500 to-cyan-500",
  },
  {
    title: "เมนูอาหาร",
    desc: "สร้างเมนูพร้อมรูปภาพ หมวดหมู่ ตัวเลือกเสริม และเชื่อมกับสต็อกวัตถุดิบอัตโนมัติ",
    icon: <path d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" />,
    color: "from-amber-500 to-orange-500",
  },
  {
    title: "คลังวัตถุดิบ",
    desc: "ติดตามสต็อก แจ้งเตือน low-stock คำนวณต้นทุนต่อจาน และจัดการ supplier ครบวงจร",
    icon: <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />,
    color: "from-emerald-500 to-teal-500",
  },
  {
    title: "พนักงาน & สิทธิ์",
    desc: "จัดตารางเวร กำหนด role (เจ้าของ/ผู้จัดการ/เสิร์ฟ/ครัว) ติดตามประสิทธิภาพรายบุคคล",
    icon: <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />,
    color: "from-purple-500 to-pink-500",
  },
  {
    title: "รายงาน & วิเคราะห์",
    desc: "รายงานยอดขาย เมนูขายดี peak hour ต้นทุน-กำไร export เป็น PDF/Excel ได้ทันที",
    icon: <path d="M3 3v18h18M7 14l4-4 4 4 5-5" />,
    color: "from-indigo-500 to-purple-500",
  },
];

const STEPS = [
  { n: "01", title: "ตั้งค่าร้าน", desc: "สร้างบัญชีร้าน ตั้งโต๊ะ เมนู และเชิญพนักงาน ใช้เวลาไม่เกิน 15 นาที" },
  { n: "02", title: "เริ่มรับออเดอร์", desc: "พนักงานรับออเดอร์ผ่าน tablet ส่งเข้าครัวอัตโนมัติ ไม่ต้องใช้กระดาษ" },
  { n: "03", title: "ดูผลและปรับปรุง", desc: "ดูรายงาน real-time ปรับเมนู-ราคา-โปรโมชัน จากข้อมูลจริงของร้านคุณ" },
];

const TESTIMONIALS = [
  { name: "คุณสมชาย", role: "เจ้าของร้านอาหารไทย 3 สาขา", quote: "ลดเวลารวมรายงานยอดขายจาก 3 ชั่วโมงต่อวัน เหลือแค่เปิดแอปดู ทีมมีเวลาไปโฟกัสลูกค้ามากขึ้น" },
  { name: "คุณนภา", role: "ผู้จัดการร้าน Cafe", quote: "สต็อกไม่เคยขาดอีกเลย ระบบแจ้งเตือนก่อนหมดทำให้สั่งของได้ทัน ไม่ต้องลุ้นตอนลูกค้ามา" },
  { name: "คุณอาทิตย์", role: "เจ้าของร้านปิ้งย่าง", quote: "ตอนช่วง peak พนักงานไม่งงแล้ว ออเดอร์เข้าครัวชัดเจน ลูกค้ารอไม่นาน ยอดขายโตขึ้น 30%" },
];

// ── main page ──────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { openLoginModal } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 20);
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? (y / h) * 100 : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 overflow-x-hidden">

      {/* scroll progress bar */}
      <div
        className="fixed top-0 left-0 h-0.5 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 z-[60] transition-[width] duration-75"
        style={{ width: `${progress}%` }}
      />

      {/* ── sticky navbar ──────────────────────────────────────────────────── */}
      <header
        className={`fixed top-0 inset-x-0 z-50 h-16 border-b transition-[background-color,border-color,backdrop-filter] duration-300 ${
          scrolled
            ? "bg-white/80 dark:bg-gray-950/80 backdrop-blur-xl border-gray-200/70 dark:border-gray-800/70"
            : "bg-transparent border-transparent"
        }`}
      >
        <div className="w-full px-6 md:px-10 h-full flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-orange-500/30">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/>
                <path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M21 15v7"/>
              </svg>
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gray-400 leading-none">Restaurant</p>
              <p className="text-sm font-black tracking-tight leading-snug">HUB</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600 dark:text-gray-400">
            <a href="#features" className="hover:text-gray-900 dark:hover:text-white transition-colors">ฟีเจอร์</a>
            <a href="#workflow" className="hover:text-gray-900 dark:hover:text-white transition-colors">ขั้นตอน</a>
            <a href="#testimonial" className="hover:text-gray-900 dark:hover:text-white transition-colors">รีวิว</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              onClick={openLoginModal}
              className="px-5 py-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-sm font-semibold rounded-full hover:scale-105 transition-transform shadow-sm"
            >
              เข้าสู่ระบบ
            </button>
          </div>
        </div>
      </header>

      {/* ── hero ───────────────────────────────────────────────────────────── */}
      <section className="relative pt-32 md:pt-40 pb-24 overflow-hidden">
        {/* animated gradient blobs */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-10 -left-24 w-96 h-96 rounded-full bg-orange-400/30 dark:bg-orange-500/20 blur-3xl animate-[blob_18s_ease-in-out_infinite]" />
          <div className="absolute top-32 right-0 w-[28rem] h-[28rem] rounded-full bg-pink-400/20 dark:bg-pink-500/15 blur-3xl animate-[blob_22s_ease-in-out_infinite_2s]" />
          <div className="absolute bottom-0 left-1/3 w-80 h-80 rounded-full bg-amber-300/25 dark:bg-amber-500/15 blur-3xl animate-[blob_26s_ease-in-out_infinite_4s]" />
          {/* grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.04)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        </div>

        <div className="max-w-6xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center">
            <Reveal>
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full text-xs font-medium text-gray-600 dark:text-gray-400 shadow-sm">
                <span className="relative flex w-1.5 h-1.5">
                  <span className="absolute inset-0 rounded-full bg-orange-500 animate-ping opacity-75" />
                  <span className="relative w-1.5 h-1.5 rounded-full bg-orange-500" />
                </span>
                ใหม่ · AI วิเคราะห์ยอดขายให้อัตโนมัติ
              </div>
            </Reveal>

            <Reveal delay={120}>
              <h1 className="mt-6 text-5xl md:text-7xl font-black tracking-tight leading-[1.05]">
                บริหารร้านอาหาร<br />
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 bg-clip-text text-transparent">อย่างมืออาชีพ</span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path d="M2 9c40-6 80-6 120-3s80 3 176-2" stroke="url(#g)" strokeWidth="3" strokeLinecap="round"/>
                    <defs><linearGradient id="g" x1="0" x2="300"><stop stopColor="#f97316"/><stop offset="1" stopColor="#ec4899"/></linearGradient></defs>
                  </svg>
                </span>
              </h1>
            </Reveal>

            <Reveal delay={240}>
              <p className="mt-8 text-lg md:text-xl text-gray-500 dark:text-gray-400 leading-relaxed max-w-2xl mx-auto">
                ระบบ all-in-one สำหรับร้านอาหารที่ต้องการควบคุมทุกกระบวนการ
                ตั้งแต่รับออเดอร์ จัดการสต็อก ไปจนถึงวิเคราะห์ยอดขาย
              </p>
            </Reveal>

            <Reveal delay={360}>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={openLoginModal}
                  className="group px-7 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold rounded-full hover:scale-105 transition-all shadow-xl shadow-gray-900/20 dark:shadow-white/10 flex items-center gap-2"
                >
                  เริ่มต้นใช้งานฟรี
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4 group-hover:translate-x-1 transition-transform">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
                <a
                  href="#features"
                  className="px-7 py-3 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 font-semibold rounded-full hover:border-gray-400 dark:hover:border-gray-600 transition-colors"
                >
                  ดูฟีเจอร์ทั้งหมด
                </a>
              </div>
            </Reveal>

            <Reveal delay={480}>
              <p className="mt-6 text-xs text-gray-400">ไม่ต้องใช้บัตรเครดิต · ทดลองได้ทันที · ยกเลิกเมื่อไหร่ก็ได้</p>
            </Reveal>
          </div>

          {/* dashboard mockup preview */}
          <Reveal delay={600} from="scale" className="mt-20">
            <div className="relative mx-auto max-w-5xl">
              <div className="absolute -inset-4 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 rounded-3xl blur-2xl opacity-20 animate-pulse" />
              <div className="relative rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
                  <span className="w-3 h-3 rounded-full bg-red-400" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400" />
                  <span className="w-3 h-3 rounded-full bg-green-400" />
                  <span className="ml-4 text-xs text-gray-400">restaurant-hub.app/home</span>
                </div>
                <div className="p-6 grid grid-cols-4 gap-4 bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-950">
                  {["รายได้วันนี้", "ออเดอร์", "โต๊ะที่ใช้", "เมนูขายดี"].map((k, i) => (
                    <div key={i} className="p-4 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider">{k}</p>
                      <p className="mt-2 text-lg font-bold">{["฿48.2K", "127", "18/24", "ผัดไทย"][i]}</p>
                      <div className={`mt-2 h-1 rounded-full bg-gradient-to-r ${["from-orange-400 to-red-400", "from-blue-400 to-cyan-400", "from-emerald-400 to-teal-400", "from-purple-400 to-pink-400"][i]}`} />
                    </div>
                  ))}
                  <div className="col-span-4 p-5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-end gap-2 h-32">
                      {[40, 60, 35, 80, 55, 90, 70, 100, 75, 85, 60, 95].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-orange-500 to-orange-300 dark:from-orange-600 dark:to-orange-400" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── stats ──────────────────────────────────────────────────────────── */}
      <section className="py-20 border-y border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/30">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-10">
          {[
            { target: 500, suffix: "+", label: "ร้านที่ใช้งาน" },
            { target: 12000, suffix: "+", label: "ออเดอร์ต่อวัน" },
            { target: 99.9, suffix: "%", label: "Uptime" },
            { target: 30, suffix: "%", label: "ยอดขายเฉลี่ยเพิ่ม" },
          ].map((s, i) => (
            <Reveal key={i} delay={i * 100}>
              <div className="text-center">
                <p className="text-4xl md:text-5xl font-black bg-gradient-to-br from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
                  <Counter target={s.target} suffix={s.suffix} />
                </p>
                <p className="mt-2 text-sm text-gray-500">{s.label}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-28">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-orange-500 mb-3">Features</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight">
                ทุกอย่างที่ร้านคุณต้องการ<br />
                <span className="text-gray-400 dark:text-gray-600">ในระบบเดียว</span>
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={i} delay={(i % 3) * 100}>
                <div className="group relative h-full p-7 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 hover:-translate-y-1 hover:shadow-xl hover:shadow-gray-900/5 dark:hover:shadow-black/20 transition-all duration-300">
                  <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${f.color} opacity-0 group-hover:opacity-[0.03] dark:group-hover:opacity-[0.06] transition-opacity`} />
                  <div className={`relative w-11 h-11 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white shadow-lg mb-5 group-hover:scale-110 group-hover:rotate-3 transition-transform`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                      {f.icon}
                    </svg>
                  </div>
                  <h3 className="relative font-bold text-lg mb-2">{f.title}</h3>
                  <p className="relative text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── workflow ───────────────────────────────────────────────────────── */}
      <section id="workflow" className="py-28 bg-gray-50 dark:bg-gray-900/30 border-y border-gray-100 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-orange-500 mb-3">How it works</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight">เริ่มใช้งานใน 3 ขั้นตอน</h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-8 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-orange-300 to-transparent" />
            {STEPS.map((s, i) => (
              <Reveal key={i} delay={i * 150} from={i === 0 ? "left" : i === 2 ? "right" : "up"}>
                <div className="relative text-center">
                  <div className="relative mx-auto w-16 h-16 rounded-2xl bg-white dark:bg-gray-900 border-2 border-orange-500 flex items-center justify-center mb-6 shadow-lg shadow-orange-500/10">
                    <span className="text-sm font-black bg-gradient-to-br from-orange-500 to-red-500 bg-clip-text text-transparent">{s.n}</span>
                  </div>
                  <h3 className="font-bold text-xl mb-2">{s.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-xs mx-auto">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── testimonials ───────────────────────────────────────────────────── */}
      <section id="testimonial" className="py-28">
        <div className="max-w-6xl mx-auto px-6">
          <Reveal>
            <div className="text-center max-w-2xl mx-auto mb-16">
              <p className="text-xs font-bold tracking-[0.2em] uppercase text-orange-500 mb-3">Testimonials</p>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight">เจ้าของร้านพูดถึงเรา</h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={i} delay={i * 120}>
                <div className="h-full p-7 rounded-2xl bg-gradient-to-br from-gray-50 to-white dark:from-gray-900 dark:to-gray-950 border border-gray-200 dark:border-gray-800 hover:-translate-y-1 transition-transform">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-orange-500/20 mb-4">
                    <path d="M10 8v6a4 4 0 01-4 4H4v-4h2v-6h4zm10 0v6a4 4 0 01-4 4h-2v-4h2v-6h4z"/>
                  </svg>
                  <p className="text-gray-700 dark:text-gray-300 leading-relaxed mb-6">"{t.quote}"</p>
                  <div className="flex items-center gap-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center text-white font-bold text-sm">
                      {t.name.slice(-1)}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.role}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── cta ────────────────────────────────────────────────────────────── */}
      <section className="py-28">
        <div className="max-w-5xl mx-auto px-6">
          <Reveal from="scale">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-red-500 to-pink-600 p-12 md:p-16 text-center text-white">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_30%,white,transparent_40%),radial-gradient(circle_at_80%_70%,white,transparent_40%)]" />
              <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
              <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-black/10 blur-3xl" />

              <div className="relative">
                <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
                  พร้อมยกระดับร้านของคุณแล้วหรือยัง?
                </h2>
                <p className="text-lg text-white/80 mb-8 max-w-xl mx-auto">
                  เข้าสู่ระบบเพื่อเริ่มต้นบริหารร้านอาหารของคุณ แบบครบวงจร ง่ายกว่าที่คิด
                </p>
                <button
                  onClick={openLoginModal}
                  className="group inline-flex items-center gap-2 px-8 py-3.5 bg-white text-gray-900 font-bold rounded-full hover:scale-105 transition-transform shadow-xl"
                >
                  เข้าสู่ระบบเลย
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-4 h-4 group-hover:translate-x-1 transition-transform">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 dark:border-gray-800 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/>
                <path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M21 15v7"/>
              </svg>
            </div>
            <span className="text-sm font-semibold">Restaurant Hub</span>
          </div>
          <p className="text-xs text-gray-400">© 2025 Restaurant Hub. All rights reserved.</p>
          <div className="flex items-center gap-5 text-xs text-gray-400">
            <a href="#" className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors">นโยบาย</a>
            <a href="#" className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors">เงื่อนไข</a>
            <a href="#" className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors">ติดต่อ</a>
          </div>
        </div>
      </footer>

      {/* blob keyframes */}
      <style jsx global>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(40px, -30px) scale(1.1); }
          66% { transform: translate(-30px, 40px) scale(0.95); }
        }
      `}</style>
    </div>
  );
}
