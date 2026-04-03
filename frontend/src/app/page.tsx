"use client";

import { useAuth } from "@/src/providers/AuthProvider";

const FEATURES = [
  {
    title: "ภาพรวมยอดขาย",
    desc: "ติดตามรายได้ ออเดอร์ และประสิทธิภาพร้านแบบ real-time พร้อม dashboard ที่อ่านง่าย",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: "จัดการออเดอร์",
    desc: "รับออเดอร์ ส่งครัว และติดตามสถานะแต่ละโต๊ะได้ครบในที่เดียว ลดความผิดพลาด",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
        <rect x="9" y="3" width="6" height="4" rx="1" />
        <path d="M9 12h6M9 16h4" />
      </svg>
    ),
  },
  {
    title: "จัดการโต๊ะ",
    desc: "ดูสถานะโต๊ะทั้งหมดในร้าน ว่าง ใช้งานอยู่ หรือจอง ได้ในมุมมองเดียว",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <rect x="3" y="3" width="18" height="4" rx="1" />
        <path d="M5 7v13M19 7v13M8 20h8" />
      </svg>
    ),
  },
  {
    title: "คลังวัตถุดิบ",
    desc: "ติดตามสต็อกวัตถุดิบ แจ้งเตือนเมื่อใกล้หมด และวิเคราะห์ต้นทุนได้แม่นยำ",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    title: "จัดการพนักงาน",
    desc: "บริหารตารางงาน ติดตามประสิทธิภาพ และจัดการสิทธิ์การเข้าถึงระบบ",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
      </svg>
    ),
  },
  {
    title: "รายงานเชิงลึก",
    desc: "วิเคราะห์ยอดขาย เมนูขายดี ชั่วโมง peak และแนวโน้มรายได้ด้วยกราฟที่อ่านง่าย",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
];

const STATS = [
  { value: "20+", label: "โต๊ะรองรับได้" },
  { value: "500+", label: "ออเดอร์ต่อวัน" },
  { value: "99.9%", label: "uptime" },
  { value: "< 1s", label: "response time" },
];

export default function LandingPage() {
  const { openLoginModal } = useAuth();

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex flex-col">

      {/* ── navbar ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-100 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-orange-500 flex items-center justify-center text-white text-xs font-bold">R</div>
            <span className="font-semibold text-gray-900 dark:text-white text-sm">Restaurant Hub</span>
          </div>
          <button
            onClick={openLoginModal}
            className="px-4 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            เข้าสู่ระบบ
          </button>
        </div>
      </header>

      {/* ── hero ───────────────────────────────────────────────────────────── */}
      <section className="flex-1 flex items-center">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28 w-full">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800 rounded-full text-xs text-orange-600 dark:text-orange-400 font-medium mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              ระบบจัดการร้านอาหารครบวงจร
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white leading-tight tracking-tight">
              บริหารร้านอาหาร<br />
              <span className="text-orange-500">อย่างมืออาชีพ</span>
            </h1>
            <p className="mt-5 text-lg text-gray-500 dark:text-gray-400 leading-relaxed max-w-lg">
              ระบบ all-in-one สำหรับร้านอาหารที่ต้องการควบคุมทุกกระบวนการ
              ตั้งแต่รับออเดอร์ จัดการโต๊ะ ไปจนถึงวิเคราะห์ยอดขาย
            </p>
            <div className="mt-8 flex items-center gap-3">
              <button
                onClick={openLoginModal}
                className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors"
              >
                เริ่มต้นใช้งาน
              </button>
              <a
                href="#features"
                className="px-6 py-2.5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 transition-colors"
              >
                ดูฟีเจอร์
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── stats ──────────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-6xl mx-auto px-6 py-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map((s, i) => (
              <div key={i} className="text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{s.value}</p>
                <p className="text-sm text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-20">
        <div className="max-w-6xl mx-auto px-6">
          <div className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">ฟีเจอร์ทั้งหมด</h2>
            <p className="text-gray-400 mt-1.5">ทุกอย่างที่ร้านอาหารต้องการในระบบเดียว</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <div
                key={i}
                className="p-6 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-orange-200 dark:hover:border-orange-800 hover:bg-orange-50/40 dark:hover:bg-orange-900/10 transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 group-hover:bg-orange-100 dark:group-hover:bg-orange-900/30 flex items-center justify-center text-gray-400 group-hover:text-orange-500 transition-colors mb-4">
                  {f.icon}
                </div>
                <p className="font-semibold text-gray-900 dark:text-white mb-1.5">{f.title}</p>
                <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── cta ────────────────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 py-16">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">พร้อมเริ่มต้นแล้วหรือยัง?</h2>
          <p className="text-gray-400 mb-6">เข้าสู่ระบบเพื่อจัดการร้านอาหารของคุณได้เลย</p>
          <button
            onClick={openLoginModal}
            className="px-8 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-xl transition-colors"
          >
            เข้าสู่ระบบ
          </button>
        </div>
      </section>

      {/* ── footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 dark:border-gray-800 py-6">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-orange-500 flex items-center justify-center text-white text-[10px] font-bold">R</div>
            <span className="text-sm text-gray-400">Restaurant Hub</span>
          </div>
          <p className="text-xs text-gray-300 dark:text-gray-600">© 2025 Restaurant Hub. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
