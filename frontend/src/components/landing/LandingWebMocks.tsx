// Drawn stand-ins for Dishy's web pages, shown on the landing page until real
// screenshots are dropped into public/landing/ (LandingDevices › WebShot picks
// the file when it exists). Each is laid out at 1280×800 and scaled to its
// frame. The figures on the overview and kitchen match the phone screenshots
// (฿7,332 · +฿6,282 · 2 tickets late); the ones on reports and the bill are
// made up for the picture. The shop is Thai, so the screens stay in Thai in
// either language, the way a real screenshot would.

import {
  BarChart3,
  BookOpen,
  ChefHat,
  ClipboardList,
  LayoutGrid,
  Package,
  QrCode,
  Receipt,
  Send,
  Settings,
  ShoppingCart,
  Sparkles,
  Table2,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";

const MOCK_NAV = [
  { icon: LayoutGrid, label: "ภาพรวม", key: "home" },
  { icon: Table2, label: "โต๊ะ", key: "tables" },
  { icon: ShoppingCart, label: "ขายหน้าร้าน", key: "pos" },
  { icon: ClipboardList, label: "ออเดอร์", key: "orders" },
  { icon: ChefHat, label: "ครัว", key: "kitchen" },
  { icon: BookOpen, label: "เมนู", key: "menu" },
  { icon: Package, label: "คลังวัตถุดิบ", key: "inventory" },
  { icon: Receipt, label: "ค่าใช้จ่าย", key: "expenses" },
  { icon: BarChart3, label: "รายงาน", key: "reports" },
  { icon: Sparkles, label: "Dishy AI", key: "ai" },
  { icon: Settings, label: "ตั้งค่า", key: "settings" },
];

function MockShell({ active, title, children }: { active: string; title: string; children: ReactNode }) {
  return (
    <div className="flex h-[800px] w-[1280px] bg-[#fbf7f2] text-[14px] text-[#2b1a10]">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-[#f0e4d6] bg-white px-3 py-5">
        <div className="flex items-center gap-2.5 px-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-orange-600 to-orange-800 text-[15px] font-bold text-white">แถ</span>
          <div>
            <p className="text-[15px] font-bold">แถวบ้าน</p>
            <p className="text-[11px] text-[#9a7b63]">สาขาหลัก · เจ้าของร้าน</p>
          </div>
        </div>
        <nav className="mt-6 space-y-0.5">
          {MOCK_NAV.map((item) => {
            const Icon = item.icon;
            const on = item.key === active;
            return (
              <div key={item.key} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium ${on ? "bg-orange-700 text-white" : "text-[#6b5241]"}`}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
                {item.label}
              </div>
            );
          })}
        </nav>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden px-8 py-6">
        <h1 className="text-[28px] font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

const MOCK_CARD = "rounded-2xl border border-[#f0e4d6] bg-white";

function Spark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 80" preserveAspectRatio="none" className={className}>
      <path d="M0 70 L90 70 L120 66 L150 62 L180 60 L210 52 L240 44 L270 26 L300 12" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M0 70 L90 70 L120 66 L150 62 L180 60 L210 52 L240 44 L270 26 L300 12 L300 80 L0 80Z" fill="white" opacity="0.15" />
    </svg>
  );
}

function MockHome() {
  const busy: Record<number, string> = { 3: "orange", 12: "orange", 14: "orange", 11: "sky" };
  return (
    <MockShell active="home" title="ภาพรวมร้าน">
      <div className="mt-4 flex gap-2">
        {[["ส", 19], ["อา", 20], ["จ", 21], ["อ", 22], ["พ", 23], ["พฤ", 24], ["ศ", 25]].map(([d, n], i) => (
          <div key={String(n)} className={`w-16 rounded-xl py-2 text-center ${i === 6 ? "bg-[#2b1a10] text-white" : "bg-[#fbeee0]"}`}>
            <p className="text-[11px]">{d}</p>
            <p className="text-[17px] font-bold">{n}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-4">
        <div className="rounded-2xl bg-gradient-to-br from-orange-700 to-orange-500 p-6 text-white">
          <p className="text-[15px] font-semibold">ยอดขายวันนี้</p>
          <p className="mt-1 text-[44px] font-bold leading-tight">฿7,332</p>
          <span className="mt-1 inline-block rounded-full bg-white/20 px-3 py-1 text-[12px]">วันศุกร์ที่แล้วทั้งวัน ฿7,335</span>
          <Spark className="mt-3 h-20 w-full" />
        </div>
        <div className="grid gap-3">
          {[["รายจ่าย", "฿1,050", "text-red-600"], ["กำไร", "+฿6,282", "text-emerald-600"], ["ออเดอร์", "31", ""]].map(([l, v, c]) => (
            <div key={l} className={`${MOCK_CARD} flex items-center justify-between px-5 py-3.5`}>
              <p className="text-[#9a7b63]">{l}</p>
              <p className={`text-[24px] font-bold ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-5 text-[17px] font-bold">จัดการตอนนี้</p>
      <div className="mt-2 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-3"><p className="text-[12px] font-semibold text-red-600">วัตถุดิบหมด</p><p className="text-[22px] font-bold text-red-700">1 รายการ</p><p className="text-[12px] text-[#9a7b63]">เห็ด</p></div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3"><p className="text-[12px] font-semibold text-amber-700">วัตถุดิบใกล้หมด</p><p className="text-[22px] font-bold text-amber-700">6 รายการ</p><p className="text-[12px] text-[#9a7b63]">กุ้งสด</p></div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3"><p className="text-[12px] font-semibold text-sky-700">รอเช็คบิล</p><p className="text-[22px] font-bold text-sky-700">1 โต๊ะ</p><p className="text-[12px] text-[#9a7b63]">T11</p></div>
      </div>
      <div className="mt-4 grid grid-cols-11 gap-2">
        {Array.from({ length: 22 }, (_, i) => i + 1).map((n) => (
          <div key={n} className={`rounded-xl py-2.5 text-center text-[13px] font-bold ${busy[n] === "orange" ? "border border-orange-300 bg-white text-orange-700" : busy[n] === "sky" ? "border border-sky-300 bg-white text-sky-700" : "bg-[#fbeee0] text-[#6b5241]"}`}>
            T{n}
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function MockKitchen() {
  const lanes = [
    { name: "รอทำ", tone: "bg-[#fbeee0] text-[#6b5241]", tickets: [{ t: "T3", n: "#032", d: ["ผัดกะเพราหมูสับ ×2", "ไข่ดาว ×2"], m: "1 นาที", late: false }] },
    { name: "กำลังทำ", tone: "bg-amber-100 text-amber-800", tickets: [
      { t: "T12", n: "#029", d: ["ต้มยำกุ้ง", "ข้าวสวย ×3"], m: "24 นาที", late: true },
      { t: "T14", n: "#030", d: ["ผัดไทยกุ้งสด", "ชาไทยเย็น"], m: "19 นาที", late: true },
    ] },
    { name: "เสร็จแล้ว", tone: "bg-emerald-100 text-emerald-800", tickets: [{ t: "T11", n: "#027", d: ["ข้าวผัดปู", "น้ำเปล่า ×2"], m: "เสิร์ฟแล้ว", late: false }] },
  ];
  return (
    <MockShell active="kitchen" title="ครัว">
      <p className="mt-1 text-[#9a7b63]">กำลังทำ 2 รอบ · เกินเวลา 2 · เสร็จแล้ว 1</p>
      <div className="mt-5 grid grid-cols-3 gap-4">
        {lanes.map((lane) => (
          <div key={lane.name} className={`${MOCK_CARD} h-[640px] overflow-hidden`}>
            <div className={`flex items-center justify-between px-5 py-3 text-[15px] font-bold ${lane.tone}`}>
              {lane.name}<span>{lane.tickets.length}</span>
            </div>
            <div className="space-y-3 p-4">
              {lane.tickets.map((tk) => (
                <div key={tk.n} className={`rounded-xl border p-4 ${tk.late ? "border-red-300 bg-red-50" : "border-[#f0e4d6]"}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[20px] font-bold">{tk.t}</p>
                    <p className="text-[12px] text-[#9a7b63]">{tk.n}</p>
                  </div>
                  <ul className="mt-2 space-y-1 text-[15px]">{tk.d.map((d) => <li key={d}>{d}</li>)}</ul>
                  <p className={`mt-3 text-[13px] font-semibold ${tk.late ? "text-red-600" : "text-[#9a7b63]"}`}>{tk.late ? `เกินเวลา · ${tk.m}` : tk.m}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

function MockPos() {
  const menu = [["ผัดกะเพราหมูสับ", 60], ["ผัดไทยกุ้งสด", 80], ["ต้มยำกุ้ง", 150], ["ข้าวผัดปู", 90], ["ไข่ดาว", 10], ["ข้าวสวย", 15], ["ชาไทยเย็น", 35], ["น้ำเปล่า", 10]] as const;
  const bill = [["ข้าวผัดปู", 1, 90], ["ผัดกะเพราหมูสับ", 2, 120], ["ไข่ดาว", 2, 20], ["น้ำเปล่า", 2, 20]] as const;
  return (
    <MockShell active="pos" title="ขายหน้าร้าน">
      <div className="mt-4 grid grid-cols-[1fr_380px] gap-5">
        <div className="grid grid-cols-4 content-start gap-3">
          {menu.map(([name, price]) => (
            <div key={name} className={`${MOCK_CARD} p-3`}>
              <div className="h-20 rounded-xl bg-gradient-to-br from-[#f7dcc0] to-[#f1c79c]" />
              <p className="mt-2 text-[14px] font-semibold">{name}</p>
              <p className="text-[13px] text-orange-700">฿{price}</p>
            </div>
          ))}
        </div>
        <div className={`${MOCK_CARD} p-5`}>
          <div className="flex items-center justify-between"><p className="text-[20px] font-bold">โต๊ะ T11</p><span className="rounded-full bg-sky-100 px-3 py-1 text-[12px] font-semibold text-sky-700">รอเช็คบิล</span></div>
          <div className="mt-4 space-y-2.5 border-b border-[#f0e4d6] pb-4">
            {bill.map(([n, q, t]) => (
              <div key={n} className="flex justify-between text-[15px]"><span>{n} ×{q}</span><span>฿{t}</span></div>
            ))}
          </div>
          <div className="mt-4 flex items-end justify-between"><span className="text-[#9a7b63]">รวม</span><span className="text-[34px] font-bold">฿250</span></div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="flex items-center justify-center gap-2 rounded-xl border border-[#f0e4d6] py-3 font-semibold"><Wallet className="h-5 w-5" />เงินสด</div>
            <div className="flex items-center justify-center gap-2 rounded-xl bg-orange-700 py-3 font-semibold text-white"><QrCode className="h-5 w-5" />PromptPay</div>
          </div>
          <div className="mx-auto mt-5 grid h-40 w-40 grid-cols-8 gap-0.5 rounded-xl border border-[#f0e4d6] p-3">
            {Array.from({ length: 64 }, (_, i) => (
              <span key={i} className={(i * 7 + (i >> 3) * 3) % 5 < 2 ? "bg-[#2b1a10]" : ""} />
            ))}
          </div>
        </div>
      </div>
    </MockShell>
  );
}

function MockReports() {
  const days = [["ส", 6480], ["อา", 8120], ["จ", 5310], ["อ", 5890], ["พ", 6240], ["พฤ", 6960], ["ศ", 7332]] as const;
  const top = [["ผัดกะเพราหมูสับ", 148], ["ผัดไทยกุ้งสด", 121], ["ข้าวผัดปู", 96], ["ต้มยำกุ้ง", 74]] as const;
  return (
    <MockShell active="reports" title="รายงาน">
      <div className="mt-4 grid grid-cols-3 gap-4">
        {[["ยอดขาย 7 วัน", "฿46,332", ""], ["ค่าใช้จ่าย", "฿8,940", "text-red-600"], ["กำไร", "+฿37,392", "text-emerald-600"]].map(([l, v, c]) => (
          <div key={l} className={`${MOCK_CARD} px-5 py-4`}><p className="text-[#9a7b63]">{l}</p><p className={`mt-1 text-[30px] font-bold ${c}`}>{v}</p></div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[1.5fr_1fr] gap-4">
        <div className={`${MOCK_CARD} p-5`}>
          <p className="text-[16px] font-bold">ยอดขายรายวัน</p>
          <div className="mt-4 flex h-[380px] items-end gap-4">
            {days.map(([d, v], i) => (
              <div key={d} className="flex flex-1 flex-col items-center gap-2">
                <p className="text-[12px] text-[#9a7b63]">{(v / 1000).toFixed(1)}k</p>
                <div className={`w-full rounded-t-lg ${i === 6 ? "bg-orange-600" : "bg-[#f3d2b0]"}`} style={{ height: `${(v / 8120) * 320}px` }} />
                <p className="text-[13px] font-semibold">{d}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={`${MOCK_CARD} p-5`}>
          <p className="text-[16px] font-bold">เมนูขายดี</p>
          <div className="mt-4 space-y-4">
            {top.map(([n, q], i) => (
              <div key={n}>
                <div className="flex justify-between text-[15px]"><span>{i + 1}. {n}</span><span className="font-semibold">{q} จาน</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-[#fbeee0]"><div className="h-2 rounded-full bg-orange-600" style={{ width: `${(q / 148) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockShell>
  );
}

function MockAi() {
  return (
    <MockShell active="ai" title="Dishy AI">
      <div className={`${MOCK_CARD} mt-4 flex h-[680px] flex-col p-6`}>
        <div className="flex-1 space-y-5">
          <p className="ml-auto w-fit max-w-[60%] rounded-2xl rounded-br-md bg-gradient-to-br from-orange-600 to-amber-500 px-5 py-3 text-[16px] text-white">
            วัตถุดิบอะไรใกล้หมดบ้าง ต้องสั่งอะไรก่อนพรุ่งนี้
          </p>
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-white"><Sparkles className="h-4 w-4" /></span>
            <div className="max-w-[70%] rounded-2xl rounded-tl-md bg-[#fbeee0] px-5 py-4 text-[16px] leading-7">
              <p>ตอนนี้เห็ดหมดแล้ว 1 รายการ และใกล้หมดอีก 6 รายการ ที่ควรสั่งก่อนคือ</p>
              <ul className="mt-2 list-disc pl-5">
                <li><b>กุ้งสด</b> — ใช้กับต้มยำกุ้งและผัดไทยกุ้งสด ซึ่งขายดีอันดับ 2</li>
                <li><b>เห็ด</b> — หมดแล้ว เมนูที่ใช้เห็ดขายไม่ได้จนกว่าจะเติม</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {["สรุปร้านวันนี้", "เมนูขายดี", "วัตถุดิบใกล้หมด", "กำไรสัปดาห์นี้"].map((q) => (
            <span key={q} className="rounded-full border border-[#f0e4d6] px-4 py-1.5 text-[13px] text-[#6b5241]">{q}</span>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[#f0e4d6] px-4 py-3">
          <span className="flex-1 text-[#b39a86]">ถามเกี่ยวกับร้านของคุณ</span>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-orange-700 text-white"><Send className="h-4 w-4" /></span>
        </div>
      </div>
    </MockShell>
  );
}

export const WEB_MOCKS: Record<string, () => ReactNode> = {
  "desktop-home.png": MockHome,
  "tablet-home.png": MockHome,
  "desktop-kitchen.png": MockKitchen,
  "desktop-pos.png": MockPos,
  "desktop-reports.png": MockReports,
  "desktop-ai.png": MockAi,
};
