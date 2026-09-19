"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import Link from "next/link";
import { useRestaurantNav, useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Download,
  LayoutGrid,
  Loader2,
  ReceiptText,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { BAR_COLORS, ChartTooltip } from "@/src/components/shared/AIChart";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { formatCurrency, formatNumber } from "@/src/lib/format";
import { can } from "@/src/lib/rbac";
import {
  activeOrderStatuses,
  dailyExpenseTotalsByDate,
  hasPartialDailyExpenseRows,
  shiftDashboardDate,
  toDashboardDate,
  kitchenTicketKey,
  toDashboardFloorTables,
  totalDailyExpensesForMonth,
  uniqueKitchenTickets,
  uniqueOrdersById,
  type DashboardFloorTable,
} from "@/src/lib/homeDashboard";
import { listExpenses, type Expense, type ExpenseCategory, type ExpenseDailyTotal } from "@/src/lib/expense";
import { listIngredients } from "@/src/lib/ingredient";
import { getOrderBill, kitchenQueue, listOrders } from "@/src/lib/order";
import { orderPosHref } from "@/src/lib/orderNavigation";
import {
  getManagerReport,
  getSalesByHour,
  getSalesDetail,
  getTopMenuItemsByMonth,
} from "@/src/lib/report";
import { listTables } from "@/src/lib/table";
import { printA4 } from "@/src/lib/thermalReceiptPrint";
import { loadSarabun } from "@/src/lib/sarabunFont";
import type { Ingredient } from "@/src/types/ingredient";
import type {
  ReportSalesDay,
  ReportSalesHour,
  ReportStockRisk,
  ReportTopMenuItem,
  SalesDetailReport,
} from "@/src/types/report";
import PaidReceiptDialog from "@/src/components/orders/PaidReceiptDialog";
import RealtimeConnectionNotice from "@/src/components/shared/RealtimeConnectionNotice";
import { useOrderEvents } from "@/src/hooks/useOrderEvents";
import { useVisiblePolling } from "@/src/hooks/useVisiblePolling";
import type { Bill, Order, OrderItem, OrderStatus } from "@/src/types/order";
import { smoothScroll } from "@/src/hooks/smoothScroll";

type LaneStatus = "delayed" | "cooking" | "ready";
type KitchenTicket = {
  // The queue's ticket id ("<order>:<round>"), so two rounds off one table
  // stay two tickets. The order it belongs to is kept beside it — that is what
  // the POS screen is addressed by.
  id: string;
  orderId: number;
  orderNumber: string;
  table: string;
  // Each dish and whether the kitchen has finished it — a ready item is one
  // less thing to cook, and reads that way.
  items: { label: string; done: boolean }[];
  waited: number;
  total: number;
  status: LaneStatus;
};
type ChartPoint = { key: string; label: string; value: number | null };
type ChartMode = "month" | "year";
type ChartMetric = "revenue" | "cost" | "profit";
type ExpenseLedgerState = {
  restaurantId: number | null;
  expenses: Expense[];
  daily: ExpenseDailyTotal[];
};
type Copy = ReturnType<typeof buildCopy>;

const EMPTY_EXPENSE_LEDGER: ExpenseLedgerState = {
  restaurantId: null,
  expenses: [],
  daily: [],
};

// Collapsed cards always sit left-to-right in this order — opening or closing
// one never reshuffles the rest, it only drops the open one below them.
const defaultCardOrder = ["liveWork", "floorStatus", "sales", "monthReview"];
const expandedCardStorageKey = "home:expandedCard";
// Shared by both halves of the swipe: the page springing back under the
// pointer, and the newly picked day sliding in.
const swipeSettle: KeyframeAnimationOptions = { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" };

function minutesSince(value: string | null | undefined, now: Date) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / 60_000));
}

function orderLocationLabel(order: Order, language: "th" | "en") {
  if (order.order_type === "takeaway") {
    const base = language === "th" ? "กลับบ้าน" : "Takeaway";
    return order.customer_name?.trim() ? `${base} · ${order.customer_name.trim()}` : base;
  }
  return order.table?.display_label || order.table?.table_number || (order.table_id ? String(order.table_id) : "-");
}

function itemSummaryLabel(item: OrderItem, language: "th" | "en") {
  const suffix = item.fulfillment_type === "takeaway" ? (language === "th" ? " กลับบ้าน" : " takeaway") : "";
  return `${item.quantity}× ${item.menu_name}${suffix}`;
}

// Kept out of buildCopy: every value there must stay a plain string, since the
// order-status label looks itself up by indexing the whole copy object.
const expenseCategoryLabels: Record<"th" | "en", Record<ExpenseCategory, string>> = {
  th: { ingredient: "วัตถุดิบ", labor: "ค่าแรง", rent: "ค่าเช่า", utilities: "ค่าน้ำ/ไฟ", equipment: "อุปกรณ์", other: "อื่นๆ" },
  en: { ingredient: "Supplies", labor: "Wages", rent: "Rent", utilities: "Utilities", equipment: "Equipment", other: "Other" },
};

function buildCopy(language: "th" | "en") {
  return language === "th"
    ? {
        title: "ภาพรวมร้าน",
        today: "วันนี้",
        previousDay: "วันก่อน",
        nextDay: "วันถัดไป",
        chooseDate: "เลือกวันที่",
        loading: "กำลังโหลด",
        updated: "อัปเดต",
        ordersTotal: "ออเดอร์",
        paidRevenue: "รับเงินแล้ว",
        activeOrders: "กำลังดำเนินการ",
        liveWork: "งานที่ต้องจัดการตอนนี้",
        lateKitchen: "ครัวเกินเวลา",
        readyToServe: "พร้อมเสิร์ฟ",
        occupiedTables: "โต๊ะใช้งาน",
        lowStock: "ควรเติมสต็อก",
        stockRisks: "วัตถุดิบที่ต้องดู",
        noStockRisks: "ไม่มีวัตถุดิบที่ต้องดู",
        nothingHere: "ไม่มีรายการ",
        restock: "ควรเติม",
        viewInventory: "ดูคลัง",
        kitchenQueue: "คิวครัว",
        viewKitchen: "เปิดหน้าครัว",
        delayed: "เกินเวลา",
        cooking: "กำลังทำ",
        ready: "เสร็จแล้ว",
        tickets: "ใบ",
        minutes: "นาที",
        noKitchen: "ครัวว่าง",
        salesOverview: "ยอดขาย",
        metricRevenue: "ยอดขาย",
        metricCost: "รายจ่าย",
        metricProfit: "กำไร",
        // Wrapped on purpose: the tile sizes its type to the longest line, so
        // breaking a long label lets the whole tile read bigger.
        thisMonth: "ทั้งเดือน",
        thisDay: "ทั้งวัน",
        expenseCategory: "ประเภท",
        expenseNote: "รายละเอียด",
        thisYear: "ทั้งปี",
        drillHint: "กดแท่งกราฟเพื่อดูบิล",
        drillTitle: "บิล",
        drillClose: "ปิด",
        drillEmpty: "ไม่มีข้อมูล",
        drillCapped: "แสดงบางส่วน",
        ingredients: "รายการ",
        cost: "ต้นทุน",
        profit: "กำไร",
        revenue: "รายได้",
        topItems: "เมนูขายดีประจำเดือน",
        otherItems: "อื่นๆ",
        noSales: "ยังไม่มียอดขาย",
        noSalesMonth: "ยังไม่มียอดขาย",
        peakHours: "ช่วงเวลาที่ขายดีที่สุด",
        peakHoursEmpty: "ยังไม่มียอดขาย",
        bills: "บิล",
        exportPdf: "บันทึกเป็น PDF",
        exportError: "สร้างไฟล์ PDF ไม่สำเร็จ",
        monthReview: "สรุปเดือนนี้",
        keyFigures: "ตัวเลขสำคัญ",
        avgTicket: "เฉลี่ยต่อบิล",
        profitMargin: "อัตรากำไร",
        bestDay: "วันที่ขายดีที่สุด",
        tradingDays: "จำนวนวันที่ขาย",
        slowestDay: "วันที่ขายน้อยที่สุด",
        expenseByCategory: "รายจ่ายตามประเภท",
        generatedAt: "ออกรายงานเมื่อ",
        share: "สัดส่วน",
        grandTotal: "รวมทั้งสิ้น",
        dishes: "จาน",
        dailyOrders: "รายการออเดอร์",
        viewAllOrders: "ดูออเดอร์ทั้งหมด",
        noOrders: "ไม่มีออเดอร์",
        floorStatus: "สถานะโต๊ะ",
        openOrderTaking: "รับออเดอร์",
        occupied: "ใช้งาน",
        available: "ว่าง",
        reserved: "จอง",
        inactive: "ปิดใช้",
        people: "คน",
        historyNotice: "ข้อมูลย้อนหลัง — สถานะครัวและโต๊ะมีเฉพาะวันนี้",
        loadError: "โหลดข้อมูลภาพรวมไม่สำเร็จ",
        order: "ออเดอร์",
        location: "โต๊ะ",
        status: "สถานะ",
        total: "ยอดรวม",
        time: "เวลา",
        open: "เปิดอยู่",
        sent_to_kitchen: "ส่งครัวแล้ว",
        served: "เสร็จแล้ว",
        completed: "ชำระแล้ว",
        cancelled: "ยกเลิก",
      }
    : {
        title: "Restaurant overview",
        today: "Today",
        previousDay: "Previous day",
        nextDay: "Next day",
        chooseDate: "Choose date",
        loading: "Loading",
        updated: "Updated",
        ordersTotal: "Orders",
        paidRevenue: "Paid",
        activeOrders: "Active",
        liveWork: "Needs attention now",
        lateKitchen: "Late in kitchen",
        readyToServe: "Ready to serve",
        occupiedTables: "Occupied tables",
        lowStock: "Low stock",
        stockRisks: "Stock risks",
        noStockRisks: "No stock risks",
        nothingHere: "Nothing here",
        restock: "Top up",
        viewInventory: "View inventory",
        kitchenQueue: "Kitchen queue",
        viewKitchen: "Open kitchen",
        delayed: "Overdue",
        cooking: "Cooking",
        ready: "Done",
        tickets: "tickets",
        minutes: "mins",
        noKitchen: "Kitchen is clear",
        salesOverview: "Sales",
        metricRevenue: "Sales",
        metricCost: "Spent",
        metricProfit: "Profit",
        thisMonth: "This month",
        thisDay: "This day",
        expenseCategory: "Category",
        expenseNote: "Details",
        thisYear: "This year",
        drillHint: "Click a bar to see its bills",
        drillTitle: "Bills",
        drillClose: "Close",
        drillEmpty: "Nothing recorded",
        drillCapped: "Partial list",
        ingredients: "items",
        cost: "Cost",
        profit: "Profit",
        revenue: "Revenue",
        topItems: "Top items this month",
        otherItems: "Others",
        noSales: "No sales yet",
        noSalesMonth: "No sales yet",
        peakHours: "Busiest hours",
        peakHoursEmpty: "No sales yet",
        bills: "bills",
        exportPdf: "Export PDF",
        exportError: "Could not create the PDF",
        monthReview: "Month summary",
        keyFigures: "Key figures",
        avgTicket: "Average ticket",
        profitMargin: "Profit margin",
        bestDay: "Best day",
        tradingDays: "Trading days",
        slowestDay: "Slowest day",
        expenseByCategory: "Expenses by category",
        generatedAt: "Generated",
        share: "Share",
        grandTotal: "Grand total",
        dishes: "items",
        dailyOrders: "Orders",
        viewAllOrders: "View all orders",
        noOrders: "No orders",
        floorStatus: "Floor status",
        openOrderTaking: "Take orders",
        occupied: "Occupied",
        available: "Available",
        reserved: "Reserved",
        inactive: "Inactive",
        people: "people",
        historyNotice: "Past date — live kitchen and floor are today only",
        loadError: "Could not load the overview",
        order: "Order",
        location: "Table",
        status: "Status",
        total: "Total",
        time: "Time",
        open: "Open",
        sent_to_kitchen: "Sent",
        served: "Done",
        completed: "Paid",
        cancelled: "Cancelled",
      };
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function ChartBox({
  data,
  title,
  language,
  lossColoring,
  selectedKey,
  onSelect,
}: {
  data: ChartPoint[];
  title: string;
  language: "th" | "en";
  lossColoring?: boolean;
  selectedKey?: string | null;
  onSelect?: (point: ChartPoint) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="h-56 min-h-56 min-w-0 overflow-hidden">
      {size.width > 0 && size.height > 0 ? (
        <BarChart width={size.width} height={size.height} data={data} margin={{ top: 12, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#9ca3af" }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(value) => formatCurrency(Number(value), language)} width={64} />
          <Tooltip
            cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
            formatter={(value) => [formatCurrency(Number(value), language), title]}
            labelFormatter={(label) => String(label)}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            cursor={onSelect ? "pointer" : undefined}
            onClick={(_entry, index) => {
              const point = data[index];
              if (point && onSelect) onSelect(point);
            }}
          >
            {data.map((point) => (
              <Cell
                key={point.key}
                fill={
                  lossColoring && (point.value ?? 0) < 0
                    ? "#dc2626"
                    : selectedKey === point.key
                    ? "#0ea5e9"
                    : "#475569"
                }
                // Dim the unpicked bars so the drilled-into one reads as the
                // source of the table below.
                fillOpacity={selectedKey && selectedKey !== point.key ? 0.35 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      ) : null}
    </div>
  );
}

type CardTone = "revenue" | "profit" | "cost";
// Keyed by the tile's own `key`, so both the day and the month grid pick
// their icons up without either array carrying one.
const metricIcon: Record<string, LucideIcon> = {
  revenue: Banknote,
  cost: TrendingDown,
  profit: Wallet,
  orders: ReceiptText,
};

type CardSummaryItem = { key: string; label: string; value: string; valueClass?: string; helper?: string; tone?: CardTone; href?: string };
// A collapsed-face detail row. `heading` turns it into the lane title above
// the rows it covers, with its count on the right, and `tint` paints the
// partition it opens in that lane's colour.
// A pip: the thing itself, and a smaller footnote under it — a table and the
// tail of the order sitting on it.
type CardChip = { text: string; note?: string; tone?: string };
type CardRow = CardSummaryItem & { heading?: boolean; tint?: string; chips?: CardChip[] };

// One width for every pip in a row, set by the longest line any of them
// carries — a row of mixed widths reads as a ragged list, not as a set. `ch`
// is exact here: the pips are monospaced. The addend is the horizontal padding.
// A two-line die (table + order number, table + state) is never narrower than
// the floor card's table dice, so the order dice in the work card and the table
// dice beside it come out one size — "F02 / 029" had been 3ch wide against
// "F01 / ใช้งาน" at 6ch.
const DIE_MIN_CH = 6;
const chipWidth = (chips: CardChip[] = []) =>
  chips.length
    ? `calc(${Math.max(
        chips.some((chip) => chip.note) ? DIE_MIN_CH : 0,
        ...chips.map((chip) => Math.max(chip.text.length, chip.note?.length ?? 0)),
      )}ch + 0.75rem)`
    : undefined;

// Border and wash for a topic's partition, keyed by what the topic means:
// late is red, in progress amber, finished green, stock orange, booked blue.
const rowTint = {
  red: "border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30",
  amber: "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
  emerald: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
  orange: "border-orange-200 bg-orange-50 dark:border-orange-900/60 dark:bg-orange-950/30",
  sky: "border-sky-200 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/30",
};

// Money tiles are colour-coded so the three read as a set at a glance. Each
// tone sets the surface, the border and the *inherited* text colour, so labels
// pick the hue up on their own — the kitchen board's convention. The value
// keeps an explicit colour of its own so it stays the loudest thing in the tile.
const cardToneTile: Record<CardTone, string> = {
  revenue: "border-sky-400 bg-sky-200 text-sky-900 dark:border-sky-600 dark:bg-sky-900/70 dark:text-sky-100",
  profit: "border-emerald-400 bg-emerald-200 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/70 dark:text-emerald-100",
  cost: "border-red-400 bg-red-200 text-red-900 dark:border-red-600 dark:bg-red-900/70 dark:text-red-100",
};
const cardToneRow = cardToneTile;
const cardToneNeutral = "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400";

// Money out is red, money in is green — a loss is money out. Same rule in the
// day pane and the month pane, so the two never disagree about a colour.
const costValueClass = "text-red-600 dark:text-red-400";
const profitValueClass = (value: number) => (value < 0 ? costValueClass : "text-emerald-600 dark:text-emerald-400");

// Folder tab: sized to its own title so several sit side by side in one strip,
// rounded on top only, square along the bottom where the open card's body meets it.
// On a phone the four tabs share the width as equal segments of one bar —
// wrapped tabs of mixed widths read as debris, not as a selector. From `sm`
// they go back to sitting at their natural width.
const cardTabShape =
  "ui-press inline-flex max-w-full items-center rounded-t-lg border text-left max-sm:min-w-0 max-sm:flex-1 max-sm:justify-center max-sm:gap-1 max-sm:px-2 sm:gap-2.5 sm:px-4 py-2";

// Font size for a collapsed-tile line, so the whole string fits on one line
// instead of truncating: cap it relative to the tile (`cqi` = 1% of the tile's
// content width), then shrink further for long strings. `perChar` is the glyph
// width as a fraction of the font size — ~0.6em for the mono figures, a touch
// more for the bold uppercase labels with their letter-spacing.
const fitTileText = (text: string, capCqi: number, perChar: number) =>
  `min(${capCqi}cqi, ${(100 / Math.max(text.length * perChar, 1)).toFixed(2)}cqi)`;

// Detail-row type, sized against its own tile like the figures above — same
// `cqi` scale, capped so a wide tile does not blow the rows up. The topic
// line is the second voice on the tile: clearly louder than the detail under
// it, and just short of the card title above it.
const rowTopicText = "min(20px, 5.6cqi)";
const rowText = "min(16px, 5.2cqi)";
const rowSmallText = "min(13px, 4.4cqi)";

// A topic row opens a partition; the rows after it are its detail, until the
// next topic. Flat in, grouped out — the callers keep building one list.
const groupCardRows = (rows: CardRow[]) => {
  const blocks = rows.reduce<{ head: CardRow; items: CardRow[] }[]>((grouped, row) => {
    if (row.heading || !grouped.length) grouped.push({ head: row, items: [] });
    else grouped[grouped.length - 1].items.push(row);
    return grouped;
  }, []);
  return blocks;
};

function CollapsibleCard({
  title,
  // Stands in for the title on a phone, where four titles cannot share one
  // strip without truncating to nonsense.
  icon: Icon,
  // Extra classes for the grid tile only — a card whose face needs more room
  // than the rest asks for it here.
  faceClass,
  subtitle,
  summary,
  // Named rows for the collapsed face, in place of the count tiles: a card
  // whose whole point is *what* needs doing says so on its cover. Reuses
  // `CardSummaryItem` — label is the row, `helper` the middle column, `value`
  // the right one. Collapsed face only; the open card has the real lists.
  rows,
  // Off when the expanded body already shows the same figures in a section of
  // its own — the collapsed tile and row still need `summary` either way.
  showSummaryWhenExpanded = true,
  // Pointing at a topic's heading gives that topic the face's room and folds
  // the rest down to their headings; it stays until another heading is
  // pointed at. For a face with more rows than it can show at once.
  focusOnHover = false,
  expanded,
  dimmed,
  collapsedRank,
  onToggle,
  children,
}: {
  title: string;
  icon: LucideIcon;
  faceClass?: string;
  subtitle?: string;
  summary?: CardSummaryItem[];
  rows?: CardRow[];
  showSummaryWhenExpanded?: boolean;
  focusOnHover?: boolean;
  expanded: boolean;
  dimmed?: boolean;
  collapsedRank: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  // A face with figures on it needs its title marked off as a header band; a
  // face that is only a name does not — the name is the whole tile.
  const { href: restaurantPageHref } = useRestaurantNav();
  const hasFaceTable = Boolean(rows?.length || summary?.length);
  // The topic whose heading was pointed at last; null until one is.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const faceRowsRef = useRef<HTMLDivElement>(null);

  // Heights are set in pixels and animated with a CSS transition. Flex sizes
  // and hiding the rows cannot be animated — the topics snapped open and shut.
  // Each block starts from the height it has now (measured, so the first
  // switch away from the shared layout slides too): the focused one takes all
  // the room the others' heading bars leave, the others close to the bar.
  useLayoutEffect(() => {
    const box = faceRowsRef.current;
    if (!focusOnHover || !box) return;
    const place = (animate: boolean) => {
      const blocks = [...box.children] as HTMLElement[];
      if (!blocks.length) return;
      // A phone face has no fixed height (the tile is only square from
      // `sm`), so there is no "room" to share out: every topic starts folded
      // to its bar, and the one tapped opens to its own rows, at most half
      // the screen, scrolling past that.
      const phone = !window.matchMedia("(min-width: 640px)").matches;
      if (focusKey === null && !phone) {
        for (const block of blocks) {
          block.style.flex = "";
          block.style.height = "";
        }
        return;
      }
      // Every read before any write. Writing one block's size and then
      // reading the next made the browser lay the next one out at its full
      // natural height (855px for a 23-row stock list), and the slide started
      // from that instead of from what was on screen.
      const gap = parseFloat(getComputedStyle(box).rowGap) || 0;
      const room = box.clientHeight;
      const bars = blocks.map((block) => (block.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0);
      // offsetHeight, not getBoundingClientRect: the card tilts and scales up
      // 5% while hovered, and a scaled reading would start every slide 5% big.
      const starts = blocks.map((block) => block.offsetHeight);
      const rest = blocks.reduce((sum, block, i) => (block.dataset.key === focusKey ? sum : sum + bars[i]), 0) + gap * (blocks.length - 1);
      const targets = blocks.map((block, i) => {
        if (block.dataset.key !== focusKey) return bars[i];
        if (phone) {
          const rows = (block.lastElementChild as HTMLElement | null)?.scrollHeight ?? 0;
          return bars[i] + Math.min(rows, window.innerHeight * 0.5);
        }
        return Math.max(bars[i], room - rest);
      });
      if (animate) {
        blocks.forEach((block, i) => {
          block.style.flex = "none";
          block.style.height = `${starts[i]}px`;
        });
        void box.offsetHeight; // commit the start heights before the targets
      }
      // All targets in the same frame, one duration and easing: the growing
      // block and the shrinking ones move in step and always add up.
      blocks.forEach((block, i) => {
        block.style.flex = "none";
        block.style.height = `${targets[i]}px`;
      });
    };
    // The first placement on a phone (all folded) is not a slide.
    place(focusKey !== null);
    const onResize = () => place(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [focusKey, focusOnHover]);
  // Opening, closing and switching cards all happen in one render — no fades,
  // no deferred unmount, no FLIP on the tabs that shuffle around them. Every
  // tab keeps its fixed slot via `collapsedRank`; only the open card's body
  // drops below the strip, on its own full-width line (order 100).
  if (!expanded) {
    // A sibling card is open — this one becomes a closed folder's tab, sitting
    // in the same strip as the open card's own tab, in its fixed slot.
    if (dimmed) {
      return (
        <button
          type="button"
          onClick={onToggle}
          aria-label={title}
          className={`${cardTabShape} translate-y-px border-gray-200 bg-slate-300 text-gray-600 hover:bg-white dark:border-gray-800 dark:bg-black dark:text-gray-300 dark:hover:bg-gray-900`}
          style={{ order: collapsedRank }}
        >
          <Icon className="h-4 w-4 shrink-0 sm:hidden" aria-hidden="true" />
          <span className="truncate text-[12px] font-semibold max-sm:hidden">{title}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60 max-sm:hidden" aria-hidden="true" />
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onToggle}
        style={{ order: collapsedRank }}
        className={`ui-press group relative flex w-full flex-col items-stretch justify-between gap-3 rounded-xl border border-gray-200 bg-slate-50 p-6 text-left hover:border-2 hover:border-orange-700/60 dark:border-gray-800 sm:aspect-[3/4] !transition-all !duration-300 !ease-out motion-reduce:!transition-none hover:z-10 hover:-rotate-1 hover:scale-[1.05] motion-reduce:hover:rotate-0 motion-reduce:hover:scale-100 hover:shadow-lg dark:bg-gray-900 ${faceClass ?? ""}`}
      >
        {/* The card's own name is the loudest thing on it: bigger than
            anything below and on a tinted band of its own, so the tile reads
            title-first and everything under it is detail. With nothing below —
            a card that is only worth opening — the name takes the middle of
            the tile instead of sitting on top of empty space. */}
        <div className={`text-center ${hasFaceTable ? "" : "my-auto"}`}>
          <h2 className={`text-[24px] font-bold leading-tight text-gray-950 dark:text-white ${hasFaceTable ? "rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800" : ""}`}>{title}</h2>
          {subtitle ? <p className="mt-1 text-[13px] text-gray-500 dark:text-gray-500">{subtitle}</p> : null}
        </div>
        {rows?.length ? (
          // Partitioned like the money card's tiles: one little table per
          // topic, two to a line, a lone last one taking the whole line rather
          // than leaving a hole. Each is drawn as a table — ruled header, ruled
          // rows — so blank lines still read as an empty table and not as a
          // gap. `min-h-0` + `overflow-hidden` stop a long list from stretching
          // the tile past its neighbours.
          <div
            ref={faceRowsRef}
            style={{ containerType: "inline-size" }}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden"
          >
            {groupCardRows(rows).map((block) => {
              // A block whose head is not a heading (e.g. the floor-status card,
              // which shows every table as one grid) renders its head as content
              // and skips the topic bar entirely.
              const contentRows = block.head.heading ? block.items : [block.head, ...block.items];
              return (
              <div
                key={block.head.key}
                data-key={block.head.key}
                // `flex-auto`: the lane's own rows set its starting height and
                // the tile's spare space is split from there — a lane with
                // nothing in it is a strip, a full one takes the room. Past
                // that it scrolls inside itself.
                // Height is animated when a topic is focused (see the layout
                // effect above); until then the blocks share the room. Kept
                // even under "reduce motion": it is a short resize the owner
                // asked for, not a decorative flourish, and without it the
                // switch read as a jump.
                className="flex min-h-0 min-w-0 flex-auto flex-col overflow-hidden rounded-lg bg-white transition-[height] duration-300 ease-out dark:bg-gray-800"
              >
                {block.head.heading ? (
                <div
                  onMouseEnter={
                    focusOnHover
                      ? () => {
                          // A tap sends a fake mouseenter first; on a touch
                          // screen the tap itself decides, below.
                          if (window.matchMedia("(hover: none)").matches) return;
                          setFocusKey(block.head.key);
                        }
                      : undefined
                  }
                  // Touch: the first tap on a topic opens it instead of the
                  // card. A tap inside the open topic falls through to the
                  // card's own click and opens the card.
                  onClick={
                    focusOnHover
                      ? (event) => {
                          if (!window.matchMedia("(hover: none)").matches || focusKey === block.head.key) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setFocusKey(block.head.key);
                        }
                      : undefined
                  }
                  style={{ fontSize: rowTopicText }}
                  // On a touch screen the bar is what gets tapped to open the
                  // topic, so it is a full 44px target there; a mouse keeps
                  // the slim bar.
                  className={`flex items-baseline gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-0.5 leading-tight dark:border-gray-800 dark:bg-gray-700 ${
                    focusOnHover ? "[@media(hover:none)]:min-h-11 [@media(hover:none)]:items-center [@media(hover:none)]:px-3 [@media(hover:none)]:py-2" : ""
                  } ${block.head.valueClass ?? "text-gray-500 dark:text-gray-400"}`}
                >
                  <span className="truncate font-bold uppercase tracking-wide">{block.head.label}</span>
                  <span className="ml-auto shrink-0 font-mono font-bold tabular-nums">{block.head.value}</span>
                </div>
                ) : null}
                {/* The lane's own scroller: a state with a dozen free tables
                    lists them all, and the block stays the height of its
                    neighbours instead of clipping the tail off. */}
                <div
                  ref={smoothScroll}
                  className="scroll-minimal min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto overflow-x-hidden dark:divide-gray-800"
                >
                  {contentRows.map((item) => item.chips ? (
                    // A lane whose tables carry no clock shows them as pips
                    // rather than one line each: the whole set fits the block,
                    // and the count above it is something you can eyeball.
                    <div
                      key={item.key}
                      style={{ fontSize: `calc(${rowText} * 1.2)` }}
                      // Each pip is as wide as what it says and they wrap when
                      // the line runs out, rather than every pip being stamped
                      // to one column width.
                      className="flex flex-wrap gap-1.5 px-2 py-1.5 leading-none"
                    >
                      {item.chips.map((chip, index) => (
                        <span
                          // Two rounds off one table are two pips reading the same thing, so
                          // the position is what tells them apart.
                          key={`${chip.text}-${chip.note ?? ""}-${index}`}
                          style={{ minWidth: item.key.endsWith("-none") ? `calc(2ch + 0.75rem)` : chipWidth(item.chips) }}
                          className={`inline-flex max-w-full flex-col items-center justify-center gap-0.5 rounded-md border-2 border-current/30 bg-current/10 px-1.5 py-1 font-mono ${item.key.endsWith("-none") ? "aspect-square" : ""} ${chip.tone ?? item.valueClass ?? "text-gray-500 dark:text-gray-400"}`}
                        >
                          <span className="max-w-full truncate">{chip.text}</span>
                          {chip.note ? <span className="max-w-full truncate text-[0.68em] opacity-70">{chip.note}</span> : null}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div key={item.key} style={{ fontSize: rowText }} className="flex items-baseline gap-1.5 px-2 py-0.5 leading-tight">
                      {/* A row with no figure is not data, it is the "nothing
                          here" line — muted so it never reads as an entry. */}
                      <span className={`truncate ${item.value ? "text-gray-600 dark:text-gray-300" : "text-gray-500"}`}>
                        {item.label}
                        {item.helper ? <span style={{ fontSize: rowSmallText }} className="ml-1 font-mono text-gray-500">{item.helper}</span> : null}
                      </span>
                      <span className={`ml-auto shrink-0 font-mono tabular-nums ${item.valueClass ?? "text-gray-500 dark:text-gray-400"}`}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        ) : summary?.length ? (
          // Two by two filling whatever height is left, the same way the
          // partitioned cards do it — a square tile would set its own height
          // and leave this card taller than the ones beside it.
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
            {summary.map((item) => {
              // Label and figure share one size, set by whichever is longer.
              // The icon rides on the label line, so it counts as a glyph or
              // two of its own.
              const longest = [item.label + "  ", item.value].reduce((a, b) => (a.length >= b.length ? a : b));
              const textSize = fitTileText(longest, 15, 0.66);
              const TileIcon = metricIcon[item.key];
              return (
                <div
                  key={item.key}
                  // Container query context so the two lines below can size
                  // themselves against this tile rather than the viewport.
                  style={{ containerType: "inline-size" }}
                  className={`flex min-h-0 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center ${item.tone ? cardToneTile[item.tone] : cardToneNeutral}`}
                >
                  <p style={{ fontSize: textSize }} className="flex min-w-0 items-center gap-1 font-bold uppercase tracking-wide leading-tight">
                    {TileIcon ? <TileIcon style={{ width: textSize, height: textSize }} className="shrink-0 opacity-80" aria-hidden="true" /> : null}
                    <span className="truncate">{item.label}</span>
                  </p>
                  <p style={{ fontSize: textSize }} className={`truncate font-mono font-bold leading-tight tabular-nums ${item.valueClass ?? "text-gray-950 dark:text-white"}`}>{item.value}</p>
                </div>
              );
            })}
          </div>
        ) : null}
        <ChevronDown className="mx-auto hidden h-5 w-5 shrink-0 text-gray-300 transition-transform group-hover:translate-y-0.5 dark:text-gray-700 sm:block" aria-hidden="true" />
      </button>
    );
  }
  return (
    // Tab and body are siblings, not nested: that puts the open card's tab in
    // the same flex line as the closed cards' tabs, with the body on the line
    // below spanning the full width. The tab keeps its own slot in that strip,
    // has no bottom border, and is pulled a pixel down over the body's top
    // edge, so the two read as one folder rather than a header on a box.
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label={title}
        style={{ order: collapsedRank }}
        className={`${cardTabShape} relative z-10 -mb-px border-b-0 border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800`}
      >
        <Icon className="h-4 w-4 shrink-0 text-gray-950 dark:text-white sm:hidden" aria-hidden="true" />
        {/* The subtitle rides beside the name, not under it: a two-line tab
            would stand taller than the folded ones and lift the whole strip. */}
        <span className="flex min-w-0 items-baseline gap-1.5 max-sm:hidden">
          <span className="truncate text-[13px] font-semibold text-gray-950 dark:text-white">{title}</span>
          {subtitle ? <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-500">{subtitle}</span> : null}
        </span>
        <ChevronUp className="h-4 w-4 shrink-0 text-gray-500 max-sm:hidden" aria-hidden="true" />
      </button>
      {/* The top-left corner stays square whichever card is open: a tab is
          always sitting on it — this card's own when it is leftmost, the first
          folded one otherwise — and a round corner under a flush tab reads as
          a gap. On a phone the tabs share the full width, so the top right is
          under one too and stays square there. */}
      {/* Seven tenths of the screen it opens on, never more: the page keeps its
          own scroll for the strip above, and everything the card holds is
          reached inside the card — the lists below have their own scrollers. */}
      <section
        ref={smoothScroll}
        style={{ order: 100 }}
        className="scroll-minimal col-span-full max-h-[70dvh] w-full overflow-y-auto overflow-x-hidden rounded-b-xl border sm:rounded-tr-xl border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      >
        {summary?.length && showSummaryWhenExpanded ? (
          // Sits flush in the body's top corners, so it has to match them.
          <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 sm:rounded-tr-xl lg:grid-cols-4">
            {summary.map((item) => {
              // A tile with an `href` drills into its own page.
              const className = `px-4 py-3.5 ${item.tone ? cardToneRow[item.tone] : "bg-white text-gray-500 dark:bg-gray-900 dark:text-gray-400"} ${item.href ? "cursor-pointer hover:brightness-95 dark:hover:brightness-125" : ""}`;
              const content = (
                <>
                  <p className="text-[13px] font-bold uppercase tracking-wide">{item.label}</p>
                  <p className={`mt-1 truncate font-mono text-[24px] font-bold tabular-nums sm:text-[28px] ${item.valueClass ?? "text-gray-950 dark:text-white"}`}>{item.value}</p>
                  {item.helper ? <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-500">{item.helper}</p> : null}
                </>
              );
              return item.href ? (
                <Link key={item.key} href={restaurantPageHref(item.href)} className={className}>{content}</Link>
              ) : (
                <div key={item.key} className={className}>{content}</div>
              );
            })}
          </div>
        ) : null}
        {children}
      </section>
    </>
  );
}

function orderStatusLabel(status: OrderStatus, copy: Copy) {
  return copy[status as keyof Copy] || status;
}

function orderStatusClass(status: OrderStatus) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
  if (status === "cancelled") return "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300";
  if (status === "cooking" || status === "sent_to_kitchen") return "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
  if (status === "ready") return "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300";
  return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
}

export default function Home() {
  const router = useRestaurantRouter();
  const { href: restaurantPageHref } = useRestaurantNav();
  const { activeMembership } = useAuth();
  const restaurantId = activeMembership?.restaurant_id ?? null;
  const canViewExpenses = can(activeMembership, "manage_expenses") || can(activeMembership, "view_reports");
  const canViewReports = can(activeMembership, "view_reports");
  const { language } = useLanguage();
  const copy = useMemo(() => buildCopy(language), [language]);
  const now = useNow();
  const today = toDashboardDate(now);
  const [selectedDate, setSelectedDate] = useState(() => toDashboardDate(new Date()));
  const isToday = selectedDate === today;
  const requestIdRef = useRef(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<DashboardFloorTable[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loadedDate, setLoadedDate] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Bumped by background refreshes (realtime order events, the 60s poll) so the
  // server-side report views reload with them. Without it they would only
  // refetch when the mode or date changed, and a bill paid while the page sat
  // open would never reach the chart. Only background refreshes bump it — the
  // first load already fetches them once on its own.
  const [refreshTick, setRefreshTick] = useState(0);
  // Only one card open at a time. Switching goes straight from one to the
  // other in a single render — no close-then-open sequencing.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Leaving for /reports or /expenses unmounts this page, so the open card is
  // remembered for the tab and reopened on the way back. Restored after mount
  // rather than as the initial state, which would not match the server render.
  useEffect(() => {
    const saved = sessionStorage.getItem(expandedCardStorageKey);
    if (saved) setExpandedKey(saved);
  }, []);

  // Which half of the sales card is open. The other one stays on screen, just
  // narrow enough to read its headline figures.
  const [salesPane, setSalesPane] = useState<"day" | "month">("day");
  const toggleCard = (key: string) => {
    const next = expandedKey === key ? null : key;
    // Remembered so the open card survives navigating away to a monthly page
    // and back.
    if (next) sessionStorage.setItem(expandedCardStorageKey, next);
    else sessionStorage.removeItem(expandedCardStorageKey);
    setExpandedKey(next);
  };
  const [chartMode, setChartMode] = useState<ChartMode>("month");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  // The total-orders tile opens the day's full order sheet under the tiles.
  const [dayOrdersOpen, setDayOrdersOpen] = useState(false);
  // Picking a row in that sheet opens the order's bill over the dashboard.
  const [orderBill, setOrderBill] = useState<Bill | null>(null);
  const [orderBillLoadingId, setOrderBillLoadingId] = useState<number | null>(null);
  const [orderBillError, setOrderBillError] = useState("");

  const openOrderBill = async (orderId: number) => {
    setOrderBillLoadingId(orderId);
    setOrderBillError("");
    try {
      const res = await getOrderBill(orderId);
      setOrderBill(res.data);
    } catch {
      setOrderBillError(copy.loadError);
    } finally {
      setOrderBillLoadingId(null);
    }
  };
  const [salesDays, setSalesDays] = useState<ReportSalesDay[]>([]);
  const [stockRisks, setStockRisks] = useState<ReportStockRisk[]>([]);
  const [monthPdfError, setMonthPdfError] = useState("");
  // The dishes on the ticket under the cursor, and where to draw them. Fixed
  // to the viewport rather than absolute inside the row: the lane is a
  // scroller, and anything absolute in it is cut off at the lane's edge.
  // `capped` marks a panel a tap opened: that one stops at six lines and
  // scrolls, because a phone has no room for a long one. A hover panel is
  // as tall as its list — the cursor is already somewhere else in a moment.
  const [ticketTip, setTicketTip] = useState<{ x: number; y: number; capped: boolean; table: string; orderNumber: string; items: KitchenTicket["items"] } | null>(null);
  const ticketTipRef = useRef<HTMLDivElement>(null);
  // The panel is fixed to the viewport, so the moment anything moves under it
  // it is pointing at nothing. Scroll or resize closes it and puts the ticket
  // back to unclicked, rather than leaving it hanging in mid-air. Scrolling
  // the panel's own list is not that — it stays open.
  useEffect(() => {
    if (!ticketTip) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && ticketTipRef.current?.contains(event.target)) return;
      setTicketTip(null);
      setOpenTicket(null);
    };
    // Capture phase: the lane, the card body and the page each scroll on their
    // own, and a scroll on any of them moves the row out from under the panel.
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [ticketTip]);
  // Where there is no cursor there is no hover, so the first tap on a ticket
  // raises the same panel a cursor would and the second one goes to the order —
  // the two things a mouse does at once, split across two taps.
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [salesDaysLoading, setSalesDaysLoading] = useState(false);
  const salesDaysLoadedRef = useRef(false);
  const [salesHours, setSalesHours] = useState<ReportSalesHour[]>([]);
  const [salesHoursLoading, setSalesHoursLoading] = useState(false);
  // A failed request must not render as "no sales today" — that reads as a real
  // zero and hides an outage (a stale backend missing the route 404s here).
  const [salesHoursFailed, setSalesHoursFailed] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  // Cash that actually left the till, keyed by Bangkok calendar day. This is the
  // expense ledger (a supplier payment, rent, a new fridge) — deliberately not
  // the recipe cost of food sold, which is what ReportSalesDay.cost carries.
  const [expenseLedger, setExpenseLedger] = useState<ExpenseLedgerState>(EMPTY_EXPENSE_LEDGER);
  const expenseScopeMatches = canViewExpenses && expenseLedger.restaurantId === restaurantId;
  const expenses = expenseScopeMatches ? expenseLedger.expenses : EMPTY_EXPENSE_LEDGER.expenses;
  const expenseDaily = expenseScopeMatches ? expenseLedger.daily : EMPTY_EXPENSE_LEDGER.daily;
  const [expensesLoading, setExpensesLoading] = useState(false);
  // Revenue and profit share the bills table; only cost gets the ledger one.
  const visibleChartMetric: ChartMetric = chartMetric === "cost" && !canViewExpenses ? "revenue" : chartMetric;
  const detailKind: "sales" | "cost" = visibleChartMetric === "cost" ? "cost" : "sales";
  // Which bar the user drilled into, and the bills behind it. One table covers
  // every metric — it carries revenue, cost and profit columns together.
  const [detailBar, setDetailBar] = useState<ChartPoint | null>(null);
  // Tagged with the bar AND the kind it belongs to, so neither a different bar
  // nor a switch between the bills and ingredients tables can render stale rows
  // under the new heading while the next request is in flight.
  const [detail, setDetail] = useState<{ key: string; kind: "sales"; data: SalesDetailReport } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [topItemsData, setTopItemsData] = useState<ReportTopMenuItem[]>([]);
  const [topItemsLoading, setTopItemsLoading] = useState(false);
  // The donut follows the selected day's month, same as the rest of that pane.
  const topItemsMonth = selectedDate.slice(0, 7);

  useEffect(() => {
    if (!activeMembership?.restaurant_id) return;
    let cancelled = false;
    const loadingFrame = requestAnimationFrame(() => {
      if (!cancelled) setTopItemsLoading(true);
    });
    getTopMenuItemsByMonth(Number(topItemsMonth.slice(0, 4)), Number(topItemsMonth.slice(5, 7)))
      .then((res) => {
        if (!cancelled) setTopItemsData(res.data.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setTopItemsData([]);
      })
      .finally(() => {
        if (!cancelled) setTopItemsLoading(false);
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(loadingFrame);
    };
  }, [topItemsMonth, activeMembership?.restaurant_id]);

  // Loaded on mount, not on first day/month chart view: the month section reads
  // its revenue and profit off this, and that shows while the card is collapsed.
  useEffect(() => {
    if (salesDaysLoadedRef.current || !activeMembership?.restaurant_id) return;
    salesDaysLoadedRef.current = true;
    setSalesDaysLoading(true);
    getManagerReport(365)
      .then((res) => {
        setSalesDays(res.data.sales_days ?? []);
        // Same response the reports page used to draw its stock-risk grid
        // from — the risks live on the live-work card now, so they ride along
        // on this call rather than earning one of their own.
        setStockRisks(res.data.stock_risks ?? []);
      })
      .catch(() => {
        salesDaysLoadedRef.current = false;
      })
      .finally(() => setSalesDaysLoading(false));
  }, [chartMode, activeMembership?.restaurant_id]);

  // Unlike the 90-day manager report, the hourly breakdown is per-date, so it
  // refetches whenever the selected day changes rather than loading once. It is
  // fetched regardless of the chart mode because the summary tiles read the
  // day's cost off it, and those show even while the card is collapsed.
  useEffect(() => {
    if (!activeMembership?.restaurant_id) return;
    let cancelled = false;
    setSalesHoursLoading(true);
    getSalesByHour(selectedDate)
      .then((res) => {
        if (cancelled) return;
        setSalesHours(res.data.hours ?? []);
        setSalesHoursFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSalesHours([]);
        setSalesHoursFailed(true);
      })
      .finally(() => {
        if (!cancelled) setSalesHoursLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate, activeMembership?.restaurant_id, refreshTick]);

  // The ledger for the calendar month around the selected date, with a week of
  // slack either side so the Mon–Sun week view can straddle a month boundary.
  // One fetch feeds the expense tile, the cost bars and their drill-down.
  const expenseMonth = selectedDate.slice(0, 7);
  useEffect(() => {
    let cancelled = false;
    if (restaurantId === null || !canViewExpenses) {
      const resetFrame = requestAnimationFrame(() => {
        if (cancelled) return;
        setExpenseLedger(EMPTY_EXPENSE_LEDGER);
        setExpensesLoading(false);
        setChartMetric((current) => (current === "cost" ? "revenue" : current));
        setDetailBar(null);
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(resetFrame);
      };
    }
    const anchor = new Date(`${expenseMonth}-01T12:00:00`);
    const from = chartMode === "year"
      ? new Date(anchor.getFullYear(), 0, 1, 12)
      : new Date(anchor.getFullYear(), anchor.getMonth(), -6, 12);
    const until = chartMode === "year"
      ? new Date(anchor.getFullYear(), 11, 31, 12)
      : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 7, 12);
    const requestedRestaurantId = restaurantId;
    setExpenseLedger((current) => (current.restaurantId === restaurantId ? current : EMPTY_EXPENSE_LEDGER));
    setExpensesLoading(true);
    listExpenses({ from: toDashboardDate(from), until: toDashboardDate(until) })
      .then((res) => {
        if (cancelled) return;
        setExpenseLedger({
          restaurantId: requestedRestaurantId,
          expenses: res.data.expenses ?? [],
          daily: res.data.daily ?? [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        setExpenseLedger(EMPTY_EXPENSE_LEDGER);
      })
      .finally(() => {
        if (!cancelled) setExpensesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expenseMonth, restaurantId, canViewExpenses, refreshTick, chartMode]);

  // Both views plot days, so a bar's key is the YYYY-MM-DD it stands for.
  useEffect(() => {
    // A cost bar drills into the ledger rows already in `expenses` — no request.
    if (!detailBar || detailKind !== "sales" || !activeMembership?.restaurant_id) return;
    let cancelled = false;
    setDetailLoading(true);
    getSalesDetail(detailBar.key)
      .then((res) => ({ key: detailBar.key, kind: "sales" as const, data: res.data }))
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setDetailFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
        setDetailFailed(true);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailBar, detailKind, activeMembership?.restaurant_id, refreshTick]);


  const loadOperations = useCallback(async (background = false) => {
    if (!activeMembership?.restaurant_id) return;
    const requestId = ++requestIdRef.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const [orderRes, liveData] = await Promise.all([
        listOrders({ date: selectedDate, limit: 200 }),
        isToday
          ? Promise.all([
              listTables(),
              kitchenQueue(),
              listIngredients().catch(() => ({ data: { ingredients: [] as Ingredient[] } })),
            ])
          : Promise.resolve(null),
      ]);
      if (requestId !== requestIdRef.current) return;

      const nextOrders = uniqueOrdersById(orderRes.data.orders ?? []);
      setOrders(nextOrders);
      if (liveData) {
        const [tableRes, kitchenRes, ingredientRes] = liveData;
        // Deduped by ticket, not by order: the queue sends one ticket per
        // round, so a table's second round shares its order's ID and would be
        // dropped by `uniqueOrdersById`.
        setKitchenOrders(uniqueKitchenTickets(kitchenRes.data.orders ?? []));
        setTables(toDashboardFloorTables(tableRes.data.tables ?? [], nextOrders, new Date()));
        setIngredients(ingredientRes.data.ingredients ?? []);
      } else {
        setKitchenOrders([]);
        setTables([]);
        setIngredients([]);
      }
      setLoadedDate(selectedDate);
      setLastUpdated(new Date());
      if (background) setRefreshTick((tick) => tick + 1);
    } catch {
      if (requestId === requestIdRef.current) setError(copy.loadError);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeMembership?.restaurant_id, copy.loadError, isToday, selectedDate]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void loadOperations(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [loadOperations]);
  const realtimeStatus = useOrderEvents(() => loadOperations(true), {
    enabled: isToday && Boolean(activeMembership?.restaurant_id),
    restaurantId: activeMembership?.restaurant_id,
  });
  useVisiblePolling(() => loadOperations(true), {
    enabled: isToday && Boolean(activeMembership?.restaurant_id),
    intervalMs: 60_000,
    runImmediately: false,
  });

  const selectDate = (nextDate: string) => {
    if (!nextDate || nextDate > today || nextDate === selectedDate) return;
    setSelectedDate(nextDate);
  };

  // Kitchen and floor are live-only. The month summary is not — it reads a
  // whole month off the reports, so it stands on a past date next to sales.
  const visibleCards = isToday ? defaultCardOrder : ["sales", "monthReview"];
  // What's actually on screen: a card remembered from today (or from before
  // the page was left) is treated as closed on a date that doesn't show it.
  const openCard = expandedKey && visibleCards.includes(expandedKey) ? expandedKey : null;

  // Swipe steps through the folder tabs first — left for the next one, right
  // for the previous — and changes the day only once there's no tab left that
  // way, or when no card is open at all. `selectDate` already refuses anything
  // past today, so swiping forward on today does nothing.
  // Pointer events rather than touch ones, so a mouse drag works the same as a
  // finger; the content is moved by writing to its node directly, since a
  // state update per pointermove would re-render the whole dashboard.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  // One step forward (+1) or back (-1), whatever gesture asked for it.
  const swipeStep = (step: 1 | -1) => {
    const nextCard = openCard ? visibleCards[visibleCards.indexOf(openCard) + step] : undefined;
    if (nextCard) toggleCard(nextCard);
    else selectDate(shiftDashboardDate(selectedDate, step));
  };

  // True when the pointer is over something that scrolls in its own right —
  // an order sheet, a drill-down list. Those own the gesture: scrolling one
  // shouldn't also step the day out from under it.
  const overScroller = (target: EventTarget | null) => {
    for (let node = target as HTMLElement | null; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return true;
      if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
    }
    return false;
  };

  const startSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Controls that own the horizontal drag themselves — the chart, native
    // inputs — keep it. Buttons and links don't: a swipe may start on one,
    // and a plain tap still clicks through.
    if ((event.target as HTMLElement).closest(".recharts-wrapper, input, select, textarea")) return;
    if (overScroller(event.target)) return;
    swipeRef.current = { x: event.clientX, y: event.clientY, dragging: false };
  };

  const moveSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (!start.dragging) {
      // Mostly-horizontal and past a small deadzone before this counts as a
      // swipe at all — anything else is a scroll or a click that wobbled.
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(event.clientY - start.y) * 2) return;
      start.dragging = true;
      // A mouse drag across the page would otherwise select every label it crosses.
      document.body.style.userSelect = "none";
    }
    // Damped and capped: the page hints at the swipe, it doesn't ride away with it.
    if (contentRef.current) contentRef.current.style.translate = `${Math.sign(dx) * Math.min(Math.abs(dx) * 0.35, 56)}px`;
  };

  const endSwipe = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    document.body.style.userSelect = "";
    const node = contentRef.current;
    if (!start || !node) return;
    const held = node.style.translate;
    node.style.translate = "";
    if (start.dragging) node.animate([{ translate: held }, { translate: "0px" }], swipeSettle);
    const dx = event.clientX - start.x;
    if (!commit || !start.dragging || Math.abs(dx) < 60) return;
    swipeStep(dx < 0 ? 1 : -1);
  };

  // Same step from the wheel. Sideways (a trackpad's two-finger swipe, or
  // shift+wheel — Chrome reports that as deltaY, Firefox as deltaX) counts
  // anywhere. A plain scroll still scrolls the page and only steps once
  // there's nothing left to scroll that way, which on a page that doesn't
  // scroll at all is every tick.
  const wheelRef = useRef({ total: 0, locked: false, timer: 0 });
  const wheelSwipe = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (overScroller(event.target)) return;
    const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
    const atEdge =
      event.deltaY > 0
        ? window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
        : window.scrollY <= 0;
    // Firefox reports ticks in lines (deltaMode 1) or pages (2) rather than
    // pixels, so the threshold below has to compare like with like.
    const delta = (sideways || (atEdge ? event.deltaY : 0)) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
    if (!delta) return;
    const wheel = wheelRef.current;
    // A trackpad flick keeps sending deltas as it coasts, and one gesture
    // should move one step — so once it fires, stay locked until the wheel
    // has been quiet for a moment.
    window.clearTimeout(wheel.timer);
    wheel.timer = window.setTimeout(() => {
      wheel.total = 0;
      wheel.locked = false;
    }, 250);
    if (wheel.locked) return;
    wheel.total += delta;
    if (Math.abs(wheel.total) < 90) return;
    wheel.locked = true;
    swipeStep(wheel.total > 0 ? 1 : -1);
  };

  // The new day slides in from the side it came from, however the date was
  // changed — swipe, arrows or the picker.
  const prevDateRef = useRef(selectedDate);
  useEffect(() => {
    const previous = prevDateRef.current;
    prevDateRef.current = selectedDate;
    if (previous === selectedDate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    contentRef.current?.animate(
      [{ opacity: 0, translate: `${selectedDate > previous ? 28 : -28}px` }, { opacity: 1, translate: "0px" }],
      swipeSettle,
    );
  }, [selectedDate]);

  const tickets = useMemo<KitchenTicket[]>(() => kitchenOrders.map((order) => {
    const key = kitchenTicketKey(order);
    const oldestSent = order.items?.reduce<string | null>((oldest, item) => {
      if (!item.sent_at) return oldest;
      if (!oldest || new Date(item.sent_at) < new Date(oldest)) return item.sent_at;
      return oldest;
    }, null);
    const waited = minutesSince(oldestSent ?? order.opened_at, now);
    const hasCooking = order.items?.some((item) => item.status === "cooking") ?? false;
    const hasReady = order.items?.some((item) => item.status === "ready") ?? false;
    return {
      id: key,
      orderId: order.ID,
      orderNumber: order.order_number,
      table: orderLocationLabel(order, language),
      // Still cooking first, done underneath: the top of the list is what the
      // kitchen still owes the table.
      items: (order.items ?? [])
        .map((item) => ({ label: itemSummaryLabel(item, language), done: item.status === "ready" }))
        .sort((a, b) => Number(a.done) - Number(b.done)),
      waited,
      total: order.grand_total || order.total_amount,
      status: hasReady && !hasCooking ? "ready" : waited >= 10 ? "delayed" : "cooking",
    };
  }), [kitchenOrders, language, now]);

  const delayed = tickets.filter((ticket) => ticket.status === "delayed");
  const cooking = tickets.filter((ticket) => ticket.status === "cooking");
  const ready = tickets.filter((ticket) => ticket.status === "ready");
  const occupied = tables.filter((table) => table.status === "occupied");
  const validOrders = orders.filter((order) => order.status !== "cancelled");
  const paidOrders = validOrders.filter((order) => order.payment_status === "paid" || order.status === "completed");
  const paidRevenue = paidOrders.reduce((sum, order) => sum + (order.grand_total || order.total_amount), 0);
  // Daily totals come from an uncapped server aggregate. The ledger rows below
  // remain useful for drill-down, but must not be used to calculate chart bars.
  const expenseByDate = useMemo(() => dailyExpenseTotalsByDate(expenseDaily), [expenseDaily]);
  // The month containing the selected day. Expenses are whole-month by nature —
  // one rent transfer lands on one date — so revenue is summed the same way.
  const monthExpense = totalDailyExpensesForMonth(expenseDaily, expenseMonth);
  const monthSales = salesDays.filter((day) => day.order_date.startsWith(expenseMonth));
  const monthRevenue = monthSales.reduce((sum, day) => sum + day.revenue, 0);
  const monthProfit = monthSales.reduce((sum, day) => sum + day.profit, 0);
  const dayProfit = salesHours.reduce((sum, hour) => sum + hour.profit, 0);
  const activeOrders = validOrders.filter((order) => activeOrderStatuses.has(order.status)).length;

  const sortedItems = topItemsData
    .map((item) => ({ name: item.menu_name, sold: item.quantity }))
    .sort((first, second) => second.sold - first.sold || first.name.localeCompare(second.name));

  const topItemColors = BAR_COLORS;
  const topItems = sortedItems.slice(0, 4);
  const otherItemsSold = sortedItems.slice(4).reduce((sum, item) => sum + item.sold, 0);
  const topItemsPie = otherItemsSold > 0 ? [...topItems, { name: copy.otherItems, sold: otherItemsSold }] : topItems;
  const totalItemsSold = sortedItems.reduce((sum, item) => sum + item.sold, 0);

  const selectedDateAtNoon = new Date(`${selectedDate}T12:00:00`);

  // The hours of the selected day that took the most money, best first. Hours
  // with no sales are dropped rather than ranked last — a quiet hour is not a
  // "busiest hour" no matter how short the list gets.
  const peakHours = salesHours
    .filter((entry) => entry.revenue > 0)
    .sort((first, second) => second.revenue - first.revenue || first.hour - second.hour)
    .slice(0, 3);
  const peakHourTop = peakHours[0]?.revenue ?? 0;
  const hourRangeLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00 - ${String((hour + 1) % 24).padStart(2, "0")}:00`;

  const salesByDate = new Map(salesDays.map((day) => [day.order_date, day]));
  const valueForDate = (date: Date) => {
    const key = toDashboardDate(date);
    if (visibleChartMetric === "cost") return expenseByDate.get(key)?.amount ?? 0;
    const day = salesByDate.get(key);
    return day ? day[visibleChartMetric] : 0;
  };

  // Year view: one bar per month of the calendar year the selected date falls
  // in. Keys are `YYYY-MM`, which no daily key can match — that is what stops a
  // stale drill-down from surviving a switch between the two windows.
  const monthLabels = language === "th"
    ? ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const yearlyPoints: ChartPoint[] = Array.from({ length: 12 }, (_, index) => {
    const key = `${selectedDateAtNoon.getFullYear()}-${String(index + 1).padStart(2, "0")}`;
    if (visibleChartMetric === "cost") {
      const spent = expenseDaily.filter((entry) => entry.date.startsWith(key));
      return { key, label: monthLabels[index], value: spent.length ? totalDailyExpensesForMonth(expenseDaily, key) : null };
    }
    const metric = visibleChartMetric;
    const traded = salesDays.filter((day) => day.order_date.startsWith(key));
    return {
      key,
      label: monthLabels[index],
      value: traded.length ? traded.reduce((sum, day) => sum + day[metric], 0) : null,
    };
  });

  // Month view: every day of the calendar month containing the selected date.
  const daysInMonth = new Date(selectedDateAtNoon.getFullYear(), selectedDateAtNoon.getMonth() + 1, 0).getDate();
  const monthlyPoints: ChartPoint[] = Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = new Date(selectedDateAtNoon.getFullYear(), selectedDateAtNoon.getMonth(), dayNumber, 12);
    return { key: toDashboardDate(date), label: String(dayNumber), value: valueForDate(date) };
  });

  const metricOptions: { key: ChartMetric; label: string }[] = [
    { key: "revenue", label: copy.metricRevenue },
    ...(canViewExpenses ? [{ key: "cost" as const, label: copy.metricCost }] : []),
    { key: "profit", label: copy.metricProfit },
  ];
  const chartModeOptions: { key: ChartMode; label: string }[] = [
    { key: "month", label: copy.thisMonth },
    { key: "year", label: copy.thisYear },
  ];
  // Only the tooltip needs this now: the two toggles above the chart already
  // name the metric and the window, so a heading would just repeat them.
  const activeChartTitle = metricOptions.find((option) => option.key === visibleChartMetric)?.label ?? "";
  const activeChartData = chartMode === "month" ? monthlyPoints : yearlyPoints;
  // Only block on the very first load. A background refresh keeps the current
  // bars on screen instead of blinking the chart to a spinner every minute —
  // the header already shows that a refresh is in flight.
  const activeChartLoading =
    visibleChartMetric === "cost" ? expensesLoading && expenseDaily.length === 0 : salesDaysLoading;
  const activeChartHasData =
    visibleChartMetric === "cost"
      ? activeChartData.some((point) => (point.value ?? 0) > 0)
      : chartMode === "year"
      ? activeChartData.some((point) => point.value !== null)
      : activeChartData.some((point) => salesByDate.has(point.key));
  // Switching view keeps the drilled-into bar when the same date is plotted in
  // both. Switching metric keeps it too, which is right — the table already
  // carries revenue, cost and profit columns.
  const activeDetailBar = detailBar && activeChartData.some((point) => point.key === detailBar.key) ? detailBar : null;
  const matchedDetail = activeDetailBar && detail?.key === activeDetailBar.key ? detail : null;
  const shownSales = detailKind === "sales" ? (matchedDetail?.data ?? null) : null;
  // The ledger rows behind a cost bar are already loaded, so they are filtered
  // out of the same list the bar was summed from and can never disagree with it.
  const shownExpenses =
    detailKind === "cost" && activeDetailBar
      ? expenses.filter((item) => item.spent_at.slice(0, 10) === activeDetailBar.key)
      : [];
  const shownExpenseAggregate = activeDetailBar ? expenseByDate.get(activeDetailBar.key) : undefined;
  const shownExpensesTotal = shownExpenseAggregate?.amount ?? 0;
  const shownExpensesEntries = shownExpenseAggregate?.entries ?? 0;
  const shownExpensesHaveMore = hasPartialDailyExpenseRows(shownExpenses.length, shownExpensesEntries);

  // The bar's own label is an axis tick ("จ", "3", "13") and never states which
  // day it is. Spell the window out instead, from the same key the request used.
  const detailWindowLabel = (() => {
    if (!activeDetailBar) return "";
    return new Date(`${activeDetailBar.key}T12:00:00`).toLocaleDateString(language === "th" ? "th-TH" : "en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  })();

  // Thinnest first — how far under its own minimum an ingredient is, not how
  // few units are left, so a spice at 40g outranks a sack of rice at 5kg.
  const lowStockItems = ingredients
    .filter((item) => item.min_stock > 0 && item.stock <= item.min_stock * 1.5)
    .sort((a, b) => a.stock / a.min_stock - b.stock / b.min_stock);
  const lowStockCount = lowStockItems.length;

  const selectedMonthLabel = selectedDateAtNoon.toLocaleDateString(language === "th" ? "th-TH" : "en-US", { month: "long", year: "numeric" });
  const selectedDateLabel = selectedDateAtNoon.toLocaleDateString(language === "th" ? "th-TH" : "en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const lanes = [
    { key: "delayed" as const, icon: AlertTriangle, title: copy.delayed, items: delayed, color: "text-red-600 dark:text-red-300", tint: rowTint.red },
    { key: "cooking" as const, icon: ChefHat, title: copy.cooking, items: cooking, color: "text-amber-600 dark:text-amber-300", tint: rowTint.amber },
    { key: "ready" as const, icon: CheckCircle2, title: copy.ready, items: ready, color: "text-emerald-600 dark:text-emerald-300", tint: rowTint.emerald },
  ];

  const dayOrdersTotal = validOrders.reduce((sum, order) => sum + (order.grand_total || order.total_amount), 0);

  // Revenue, expenses, profit, then order count — the same running order as the
  // month tiles. Every figure here is the selected day's except expenses, which
  // is the month's, so its label says so. The collapsed card is the only place
  // this renders: opening the card shows the month pane, which carries the same
  // monthly expense figure, and a second copy of it in the day pane would only
  // invite reading it as that day's spend.
  const summary = [
    { key: "revenue", label: copy.paidRevenue, value: formatCurrency(paidRevenue, language), helper: `${paidOrders.length} ${copy.order}`, tone: "revenue" as const },
    ...(canViewExpenses
      ? [{ key: "cost", label: copy.metricCost, value: formatCurrency(-monthExpense, language), valueClass: costValueClass, tone: "cost" as CardTone }]
      : []),
    // A loss on a green tile would read as good news, so it borrows the cost
    // tone, and the signed figure is coloured to match.
    {
      key: "profit",
      label: copy.metricProfit,
      value: formatCurrency(dayProfit, language, 0, "exceptZero"),
      valueClass: profitValueClass(dayProfit),
      tone: (dayProfit < 0 ? "cost" : "profit") as CardTone,
    },
    { key: "orders", label: copy.ordersTotal, value: validOrders.length.toLocaleString(), helper: `${copy.activeOrders} ${activeOrders}` },
  ];

  // The closed card is the whole kitchen at a glance: every lane, always, with
  // its ticket count — a clear kitchen is two zeroes and the day's order
  // count, which says more than the words "kitchen is clear". Under each lane
  // its tickets sit as pips, longest wait first, each one the table and the
  // tail of its order number — enough to walk to it, and the whole lane fits
  // where two written-out rows used to.
  // An empty lane says so in words: a table of blank lines leaves you
  // wondering whether it is empty or still loading.
  const emptyRow = (key: string): CardRow => ({ key: `${key}-none`, label: copy.nothingHere, value: "", valueClass: "text-gray-300 dark:text-gray-700", chips: [{ text: "+" }] });
  const attentionRows: CardRow[] = [
    // Done needs no attention, so it stays off the cover — the open card still
    // lists it.
    ...lanes.filter((lane) => lane.key !== "ready").flatMap((lane) => [
      { key: `${lane.key}-head`, label: lane.title, value: lane.items.length.toLocaleString(), valueClass: lane.color, tint: lane.tint, heading: true },
      ...(lane.items.length
        ? [{
            key: `${lane.key}-chips`,
            label: "",
            value: "",
            valueClass: lane.color,
            chips: [...lane.items]
              .sort((a, b) => b.waited - a.waited)
              // The day's number, "015" of "20260919-015" — also when a seeded
              // bill carries " (Test)" after it, where the last three
              // characters would read "st)".
              .map((ticket) => ({ text: ticket.table, note: ticket.orderNumber.match(/-(\d+)/)?.[1] ?? ticket.orderNumber.slice(-3) })),
          }]
        : [emptyRow(lane.key)]),
    ]),
    // The fourth cell is the store cupboard: what is running out and how much
    // of it is left, since that is the other thing that stops a kitchen.
    { key: "stock", label: copy.lowStock, value: lowStockCount.toLocaleString(), valueClass: "text-orange-600 dark:text-orange-300", tint: rowTint.orange, heading: true },
    ...(lowStockItems.length
      ? [{
          key: "stock-chips",
          label: "",
          value: "",
          valueClass: "text-orange-600 dark:text-orange-300",
          // The name alone: how much is left is what the open card is for, and
          // a lane of pips reads as a shopping list at a glance.
          chips: lowStockItems.map((item) => ({ text: item.name })),
        }]
      : [emptyRow("stock")]),
  ];

  const monthOrders = monthSales.reduce((sum, day) => sum + day.orders, 0);

  // Everything the month summary card and its printed sheet need, off figures
  // this page already holds: the sales report for revenue/profit/orders, the
  // expense ledger for what was spent and on what.
  const monthMargin = monthRevenue ? (monthProfit / monthRevenue) * 100 : 0;
  const monthAvgTicket = monthOrders ? monthRevenue / monthOrders : 0;
  const monthDaysTraded = monthSales.filter((day) => day.orders > 0).length;
  const monthBestDay = monthSales.reduce<ReportSalesDay | null>((best, day) => (!best || day.revenue > best.revenue ? day : best), null);
  const monthSlowestDay = monthSales.reduce<ReportSalesDay | null>(
    (worst, day) => (day.orders > 0 && (!worst || day.revenue < worst.revenue) ? day : worst),
    null,
  );
  // The ledger rows are already scoped to this month by the fetch above.
  const monthExpenseByCategory = Object.entries(
    expenses.reduce<Record<string, number>>((totals, item) => {
      totals[item.category] = (totals[item.category] ?? 0) + item.amount;
      return totals;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const monthTopItems = topItemsData;
  const shortDayLabel = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString(language === "th" ? "th-TH" : "en-US", { day: "numeric", month: "short" });
  // Read twice — once by the sheet's table, once by the PDF — so the file can
  // never drift from what the card showed.
  const monthKeyFigures = [
    { key: "revenue", label: copy.metricRevenue, value: formatCurrency(monthRevenue, language) },
    ...(canViewExpenses ? [{ key: "cost", label: copy.metricCost, value: formatCurrency(-monthExpense, language), valueClass: costValueClass }] : []),
    { key: "profit", label: copy.metricProfit, value: formatCurrency(monthProfit, language, 0, "exceptZero"), valueClass: profitValueClass(monthProfit) },
    { key: "margin", label: copy.profitMargin, value: `${formatNumber(monthMargin, language, 1)}%` },
    { key: "orders", label: copy.ordersTotal, value: monthOrders.toLocaleString() },
    { key: "avg", label: copy.avgTicket, value: formatCurrency(monthAvgTicket, language) },
    { key: "days", label: copy.tradingDays, value: monthDaysTraded.toLocaleString() },
    { key: "best", label: copy.bestDay, value: monthBestDay ? `${shortDayLabel(monthBestDay.order_date)} · ${formatCurrency(monthBestDay.revenue, language)}` : "-" },
    { key: "slow", label: copy.slowestDay, value: monthSlowestDay ? `${shortDayLabel(monthSlowestDay.order_date)} · ${formatCurrency(monthSlowestDay.revenue, language)}` : "-" },
  ];

  // A real file, the same way the expenses page makes one: jsPDF with the Thai
  // face embedded, one table per section of the sheet.
  const exportMonthPdf = async () => {
    setMonthPdfError("");
    try {
      const [font, { jsPDF }, autoTable] = await Promise.all([
        loadSarabun(),
        import("jspdf"),
        import("jspdf-autotable").then((module) => module.default),
      ]);
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      doc.addFileToVFS("Sarabun.ttf", font);
      doc.addFont("Sarabun.ttf", "Sarabun", "normal");
      doc.setFont("Sarabun");
      doc.setFontSize(14);
      doc.text(`${copy.monthReview} ${selectedMonthLabel}`, 10, 14);
      doc.setFontSize(9);
      doc.text(`${copy.generatedAt} ${new Date().toLocaleString(language === "th" ? "th-TH" : "en-US")}`, 10, 19);

      // Only the regular weight is embedded, so every cell asks for "normal";
      // a bold request would silently fall back to Helvetica and drop the Thai.
      const cell = { font: "Sarabun", fontStyle: "normal" as const };
      let startY = 24;
      const section = (head: string[], body: string[][]) => {
        if (!body.length) return;
        autoTable(doc, {
          startY,
          margin: { left: 10, right: 10 },
          head: [head],
          body,
          styles: { ...cell, fontSize: 9, cellPadding: 1.5, lineColor: 0, lineWidth: 0.1, textColor: 0 },
          headStyles: { ...cell, fillColor: [223, 227, 230] },
        });
        startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
      };

      section([copy.keyFigures, ""], monthKeyFigures.map((row) => [row.label, row.value]));
      if (canViewExpenses) {
        section(
          [copy.expenseCategory, copy.metricCost, copy.share],
          monthExpenseByCategory.map(([category, amount]) => [
            expenseCategoryLabels[language][category as ExpenseCategory] ?? category,
            formatCurrency(amount, language),
            `${monthExpense ? formatNumber((amount / monthExpense) * 100, language, 0) : 0}%`,
          ]),
        );
      }
      section(
        ["#", copy.topItems, copy.dishes],
        monthTopItems.slice(0, 8).map((item, index) => [String(index + 1), item.menu_name, formatNumber(item.quantity, language, 0)]),
      );
      section(
        [copy.stockRisks, "", copy.restock],
        stockRisks.slice(0, 8).map((risk) => [
          risk.name,
          `${formatNumber(risk.stock, language)} / ${formatNumber(risk.min_stock, language)} ${risk.unit}`,
          formatNumber(risk.restock_estimate, language),
        ]),
      );

      doc.save(`month-summary-${expenseMonth}.pdf`);
    } catch {
      setMonthPdfError(copy.exportError);
    }
  };

  const availableTables = tables.filter((table) => table.status === "available");
  const reservedTables = tables.filter((table) => table.status === "reserved");
  const floorStatusSummary: CardSummaryItem[] = [
    { key: "occupied", label: copy.occupiedTables, value: occupied.length.toLocaleString() },
    { key: "available", label: copy.available, value: availableTables.length.toLocaleString() },
    { key: "reserved", label: copy.reserved, value: reservedTables.length.toLocaleString() },
  ];

  // One grid, not three: every table (bar the inactive ones) as a pip in table
  // order, each carrying its status word and coloured by it — amber occupied,
  // sky reserved, emerald free — so the border reads the state at a glance. No
  // per-status headings; the card title already says this is the floor.
  const tableTone = (status: DashboardFloorTable["status"]) =>
    status === "occupied" ? "text-amber-600 dark:text-amber-300"
      : status === "reserved" ? "text-sky-600 dark:text-sky-300"
        : status === "available" ? "text-emerald-600 dark:text-emerald-300"
          : "text-gray-500 dark:text-gray-400";
  const floorTables = tables.filter((table) => table.status !== "inactive");
  const floorRows: CardRow[] = floorTables.length
    ? [{
        key: "floor-all",
        label: "",
        value: "",
        chips: floorTables.map((table) => ({
          text: table.label,
          note: copy[table.status],
          tone: tableTone(table.status),
        })),
      }]
    : [emptyRow("floor")];

  // While a card is open, every other card shrinks from a full tile down to
  // just its folder tab.
  const isCardDimmed = (key: string) => openCard !== null && openCard !== key;

  // Position among the collapsed cards — fixed, never reshuffled.
  const collapsedRank = (key: string) => defaultCardOrder.indexOf(key);

  const dateLoading = loading && loadedDate !== selectedDate;

  return (
    <div
      // `touch-pan-y` is what makes the gesture usable on a phone: it hands
      // vertical scrolling to the browser and keeps the horizontal axis for
      // us, so a sideways drag isn't taken over as a scroll and cancelled
      // halfway through. Anything inside that needs to pan sideways itself
      // has to opt back out with `touch-none`.
      // Tall enough to carry the page background to the bottom on mobile, but no
      // taller: MobileTopBar sits above <main> (pt-14), so a flat min-h-dvh would
      // push an empty dashboard past the viewport. On lg the shell sheet owns the
      // height, so no viewport min-height is set at all.
      className="min-h-[calc(100dvh-3.5rem)] touch-pan-y bg-slate-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100"
      onWheel={wheelSwipe}
      onPointerDown={startSwipe}
      onPointerMove={moveSwipe}
      onPointerUp={(event) => endSwipe(event, true)}
      // Cancel fires when the browser takes the gesture over (a touch that
      // turned into a scroll); leaving the page mid-drag is a miss too.
      onPointerCancel={(event) => endSwipe(event, false)}
      onPointerLeave={(event) => endSwipe(event, false)}
    >
      <header className="sticky top-14 z-20 border-b border-gray-200 bg-slate-100/95 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95 sm:px-6 lg:top-0 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl min-w-0 items-center gap-2">
          <h1 className="text-[28px] font-bold tracking-tight text-gray-950 dark:text-white sm:text-[34px]">{copy.title}</h1>
          {refreshing ? <Loader2 className="h-5 w-5 animate-spin text-gray-500" aria-label={copy.loading} /> : null}
        </div>
      </header>

      {/* The swiped surface, the date control included: changing the day moves
          the control and the cards it filters as one. */}
      <div ref={contentRef} className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {/* The date sits in the same stack as the cards it filters, and rides
            the same swipe: change the day and control and content move as one. */}
        <div className="flex items-center gap-2">
          <div className="inline-flex min-w-0 flex-1 overflow-hidden rounded-md border border-gray-200 bg-white sm:flex-initial dark:border-gray-800 dark:bg-gray-900">
            <button type="button" onClick={() => selectDate(shiftDashboardDate(selectedDate, -1))} aria-label={copy.previousDay} title={copy.previousDay} className="ui-press inline-flex h-10 w-10 items-center justify-center border-r border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            {/* The native input drives the value but renders the browser's own
                numeric format, so it sits transparent on top and the readable
                weekday/date is drawn underneath it. */}
            <label className="relative inline-flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 sm:flex-initial hover:bg-gray-50 dark:hover:bg-gray-800">
              <CalendarDays className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              <span className="sr-only">{copy.chooseDate}</span>
              {/* Fixed width: the label is a long weekday and month name, so
                  letting it size to its content shifts the arrows either side
                  of it every time the day changes. */}
              <span aria-hidden="true" className="w-full min-w-0 truncate text-center text-[13px] font-semibold text-gray-800 sm:w-56 dark:text-gray-100">
                {selectedDateLabel}
              </span>
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(event) => selectDate(event.target.value)}
                onClick={(event) => event.currentTarget.showPicker?.()}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <button type="button" disabled={selectedDate >= today} onClick={() => selectDate(shiftDashboardDate(selectedDate, 1))} aria-label={copy.nextDay} title={copy.nextDay} className="ui-press inline-flex h-10 w-10 items-center justify-center border-l border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {!isToday ? <button type="button" onClick={() => selectDate(today)} className="ui-press h-10 shrink-0 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">{copy.today}</button> : null}
        </div>
        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{error}</div> : null}
        <RealtimeConnectionNotice language={language} status={realtimeStatus} />

        {dateLoading ? (
          <div className="flex min-h-72 items-center justify-center rounded-xl border border-gray-200 bg-white text-[13px] text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {copy.loading}
          </div>
        ) : (
          <>
            {/* Closed: a grid of tiles, wrapping onto more rows on narrow
                screens rather than being squeezed into one — a legible tile
                beats a complete row. Open: a folder rack, every tab side by
                side on one line (no row gap, so the open card's body below
                meets its tab) and wrapping only when the line runs out. */}
            {/* Rows size themselves: the cards that carry a face table all
                share `aspect-[3/4]` and so match without being forced to, and
                the month card — a name and nothing else — is free to take a
                short full-width row of its own instead of a card-tall one.
                Narrow cards read better than fat ones, but the column count
                has to count the sidebar too: it turns permanent at `lg` and
                takes 264px, so a tablet in landscape leaves about 744px for
                the cards — two columns' worth. Three from `xl`. */}
            <div className={openCard !== null ? "flex flex-wrap items-end gap-x-1.5 max-sm:gap-x-0" : "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
            <CollapsibleCard
              title={copy.salesOverview}
              icon={ReceiptText}
              summary={summary}
              showSummaryWhenExpanded={false}
              expanded={openCard === "sales"}
              dimmed={isCardDimmed("sales")}
              collapsedRank={collapsedRank("sales")}
              onToggle={() => toggleCard("sales")}
            >
              <div className="overflow-visible">
                {/* Both titles sit together as tabs, so switching panes is one
                    click without hunting for the other end of the card. */}
                <div className="flex items-end gap-4 px-4 pt-4">
                  <button
                    type="button"
                    aria-pressed={salesPane === "day"}
                    onClick={() => setSalesPane("day")}
                    className={`ui-press border-b-2 pb-1.5 text-[17px] font-bold uppercase tracking-wide ${
                      salesPane === "day"
                        ? "border-orange-500 text-orange-600 dark:border-orange-400 dark:text-orange-400"
                        : "border-transparent text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    }`}
                  >
                    {copy.thisDay}
                  </button>
                  <button
                    type="button"
                    aria-pressed={salesPane === "month"}
                    onClick={() => setSalesPane("month")}
                    className={`ui-press flex flex-wrap items-baseline gap-x-2 border-b-2 pb-1.5 text-[17px] font-bold uppercase tracking-wide ${
                      salesPane === "month"
                        ? "border-orange-500 text-orange-600 dark:border-orange-400 dark:text-orange-400"
                        : "border-transparent text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    }`}
                  >
                    {copy.thisMonth}
                    <span className="text-[12px] font-medium text-gray-500 dark:text-gray-400">{selectedMonthLabel}</span>
                  </button>
                </div>
                <div className={`min-w-0 p-4 ${salesPane === "day" ? "" : "hidden"}`}>
                  <div className="mb-3 mt-3 grid grid-cols-3 gap-2">
                    {summary.filter((item) => item.key !== "cost").map((item) => {
                      const tileClass = `rounded-lg border px-3 py-2 text-left ${item.tone ? cardToneTile[item.tone] : cardToneNeutral}`;
                      const Icon = metricIcon[item.key];
                      // Only the orders tile does anything, so only it gets the
                      // chevron — an affordance on a dead tile is a worse lie
                      // than no affordance at all.
                      const body = (interactive: boolean) => (
                        <>
                          <p className="flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide">
                            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" /> : null}
                            <span className="truncate">{item.label}</span>
                            {interactive ? (
                              <span className="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/15">
                                <ChevronDown className={`h-3 w-3 transition-transform ${dayOrdersOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                              </span>
                            ) : null}
                          </p>
                          <p className={`mt-0.5 truncate font-mono text-[19px] font-bold tabular-nums sm:text-[22px] ${item.valueClass ?? "text-gray-950 dark:text-white"}`}>{item.value}</p>
                        </>
                      );
                      return item.key === "orders" ? (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setDayOrdersOpen((open) => !open)}
                          aria-expanded={dayOrdersOpen}
                          className={`ui-press w-full cursor-pointer shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:brightness-105 dark:hover:brightness-125 ${tileClass} ${dayOrdersOpen ? "ring-2 ring-gray-900 dark:ring-white" : ""}`}
                        >
                          {body(true)}
                        </button>
                      ) : (
                        <div key={item.key} className={tileClass}>{body(false)}</div>
                      );
                    })}
                  </div>

                  {dayOrdersOpen ? (
                    <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-800">
                      <div id="day-orders-sheet">
                        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
                          <div className="min-w-0">
                            <h4 className="text-[12px] font-semibold text-gray-950 dark:text-white">{copy.dailyOrders}</h4>
                            {/* The count is on the tile that opened this, but
                                the date is not — and the sheet prints. */}
                            <p className="mt-0.5 font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{selectedDateLabel}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => printA4("day-orders-sheet")}
                            disabled={!validOrders.length}
                            className="ui-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 print:hidden"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            {copy.exportPdf}
                          </button>
                        </div>
                        {orderBillError ? <p className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 print:hidden">{orderBillError}</p> : null}
                        {validOrders.length ? (
                          // Clipped on X because the rows tilt on hover
                          // (`.ui-row-lift`): a rotated row and its shadow poke
                          // a pixel or two past the sheet, and with the other
                          // axis scrolling that was enough to flash a
                          // horizontal scrollbar under the cursor.
                          <div className="max-h-72 overflow-x-clip overflow-y-auto print:max-h-none print:overflow-visible">
                            {/* border-separate so the rows can cast a shadow on
                                hover — a collapsed table never paints one. The
                                row dividers move onto the cells to suit. */}
                            {/* `table-fixed` so the columns size to the sheet
                                instead of to their longest cell — an auto
                                table grows past the container and, since the
                                wrapper scrolls on Y, that turns into a
                                horizontal scrollbar. */}
                            <table className="w-full table-fixed border-separate border-spacing-0 text-left text-[11px] [&_tbody_td]:border-b [&_tbody_td]:border-gray-100 dark:[&_tbody_td]:border-gray-800">
                              <thead className="bg-gray-50 text-[10px] font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                                <tr>
                                  <th className="px-3 py-1.5 font-medium">{copy.order}</th>
                                  <th className="px-3 py-1.5 font-medium">{copy.location}</th>
                                  <th className="px-3 py-1.5 font-medium">{copy.status}</th>
                                  <th className="px-3 py-1.5 text-right font-medium">{copy.time}</th>
                                  <th className="px-3 py-1.5 text-right font-medium">{copy.total}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {validOrders.map((order) => (
                                  <tr
                                    key={order.ID}
                                    onClick={() => void openOrderBill(order.ID)}
                                    aria-haspopup="dialog"
                                    aria-busy={orderBillLoadingId === order.ID}
                                    className={`ui-row-lift cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${orderBillLoadingId === order.ID ? "opacity-50" : ""}`}
                                  >
                                    <td className="px-3 py-1.5 font-mono font-semibold text-gray-950 dark:text-white">#{order.order_number}</td>
                                    <td className="px-3 py-1.5 truncate text-gray-600 dark:text-gray-300">{orderLocationLabel(order, language)}</td>
                                    <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{orderStatusLabel(order.status, copy)}</td>
                                    <td className="px-3 py-1.5 text-right font-mono text-gray-500">
                                      {new Date(order.opened_at).toLocaleTimeString(language === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-gray-950 dark:text-white">
                                      {formatCurrency(order.grand_total || order.total_amount, language)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="border-t-2 border-gray-300 dark:border-gray-700">
                                <tr>
                                  <td colSpan={4} className="px-3 py-2 text-[11px] font-semibold text-gray-950 dark:text-white">{copy.grandTotal}</td>
                                  <td className="px-3 py-2 text-right font-mono text-[12px] font-bold tabular-nums text-gray-950 dark:text-white">{formatCurrency(dayOrdersTotal, language)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        ) : (
                          <p className="px-3 py-8 text-center text-[12px] text-gray-500">{copy.noOrders}</p>
                        )}
                      </div>
                    </div>
                  ) : null}

                  <h3 className="mt-4 border-t border-gray-200 pt-4 text-[12px] font-medium text-gray-600 dark:border-gray-800 dark:text-gray-300">{copy.peakHours}</h3>
                  {salesHoursLoading && !salesHours.length ? (
                    <div className="flex h-20 items-center justify-center text-[12px] text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    </div>
                  ) : peakHours.length ? (
                    <ol className="mt-2 space-y-1.5">
                      {peakHours.map((entry) => (
                        <li key={entry.hour} className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono text-[12px] font-semibold text-gray-950 dark:text-white">
                              {hourRangeLabel(entry.hour)}
                            </span>
                            <span className="font-mono text-[13px] font-bold tabular-nums text-gray-950 dark:text-white">{formatCurrency(entry.revenue, language)}</span>
                          </div>
                          {/* Bar is read against the best hour, so the top row is
                              always full and the rest read as "share of peak". */}
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                              <div className="h-full rounded-full bg-orange-500" style={{ width: `${peakHourTop > 0 ? (entry.revenue / peakHourTop) * 100 : 0}%` }} />
                            </div>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">{entry.orders.toLocaleString()} {copy.bills}</span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className={`py-6 text-center text-[12px] ${salesHoursFailed ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>
                      {salesHoursFailed ? copy.loadError : copy.peakHoursEmpty}
                    </p>
                  )}
                </div>
                {/* The month the selected day falls in. The revenue and expense
                    figures are themselves the links to their full monthly pages. */}
                <div className={`min-w-0 bg-slate-100/70 p-4 dark:bg-gray-800/50 ${
                  salesPane === "month" ? "" : "hidden"
                }`}>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      { key: "revenue", label: copy.metricRevenue, value: formatCurrency(monthRevenue, language), tone: "revenue" as CardTone, href: canViewReports ? "/reports" : undefined },
                      ...(canViewExpenses ? [{ key: "cost", label: copy.metricCost, value: formatCurrency(-monthExpense, language), valueClass: costValueClass, tone: "cost" as CardTone, href: "/expenses" }] : []),
                      { key: "profit", label: copy.metricProfit, value: formatCurrency(monthProfit, language, 0, "exceptZero"), tone: (monthProfit < 0 ? "cost" : "profit") as CardTone, valueClass: profitValueClass(monthProfit) },
                      { key: "orders", label: copy.ordersTotal, value: monthOrders.toLocaleString() },
                    ].map((stat) => {
                      const tileClass = `block rounded-lg border px-3 py-2 ${stat.tone ? cardToneTile[stat.tone] : cardToneNeutral} ${
                        stat.href ? "ui-press cursor-pointer shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:brightness-105 dark:hover:brightness-125" : ""
                      }`;
                      const Icon = metricIcon[stat.key];
                      const body = (
                        <>
                          <p className="flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide">
                            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" /> : null}
                            <span className="truncate">{stat.label}</span>
                            {stat.href ? (
                              <span className="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/15">
                                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                              </span>
                            ) : null}
                          </p>
                          <p className={`mt-0.5 truncate font-mono text-[22px] font-bold tabular-nums sm:text-[26px] ${stat.valueClass ?? "text-gray-950 dark:text-white"}`}>
                            {salesDaysLoading && !salesDays.length ? "—" : stat.value}
                          </p>
                        </>
                      );
                      return stat.href ? (
                        <Link key={stat.key} href={restaurantPageHref(stat.href)} className={tileClass}>{body}</Link>
                      ) : (
                        <div key={stat.key} className={tileClass}>{body}</div>
                      );
                    })}
                  </div>

                  <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800 xl:flex xl:items-start xl:gap-5">
                    <div className="min-w-0 xl:flex-1">
                      <h3 className="text-[12px] font-medium text-gray-600 dark:text-gray-300">{copy.topItems}</h3>

                      <div className="mt-2 flex justify-center">
                        {topItemsLoading ? (
                          <div className="flex h-36 w-36 items-center justify-center text-[12px] text-gray-500">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          </div>
                        ) : topItemsPie.length ? (
                          <div className="relative h-36 w-36 shrink-0">
                            <PieChart width={144} height={144}>
                              <Pie data={topItemsPie} dataKey="sold" nameKey="name" innerRadius={46} outerRadius={68} paddingAngle={2} stroke="none">
                                {topItemsPie.map((entry, index) => (
                                  <Cell key={entry.name} fill={topItemColors[index % topItemColors.length]} />
                                ))}
                              </Pie>
                              <Tooltip wrapperStyle={{ zIndex: 20 }} content={<ChartTooltip unit={copy.dishes} />} />
                            </PieChart>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                              <span className="font-mono text-[16px] font-semibold tabular-nums text-gray-950 dark:text-white">{totalItemsSold.toLocaleString()}</span>
                              <span className="text-[9px] text-gray-500">{copy.dishes}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-36 items-center justify-center text-[12px] text-gray-500">{copy.noSalesMonth}</div>
                        )}
                      </div>

                      {topItemsPie.length ? (
                        <ul className="mt-3 w-full min-w-0 space-y-1.5">
                          {topItemsPie.map((item, index) => (
                            <li key={item.name} className="flex items-center gap-2 text-[12px]">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: topItemColors[index % topItemColors.length] }} aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate font-medium text-gray-700 dark:text-gray-300">{item.name}</span>
                              <span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">{item.sold} {copy.dishes}</span>
                              <span className="w-9 shrink-0 text-right font-mono text-[10px] text-gray-500">{totalItemsSold ? Math.round((item.sold / totalItemsSold) * 100) : 0}%</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 max-xl:mt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                          {metricOptions.map(({ key: metric, label }) => (
                            <button
                              key={metric}
                              type="button"
                              onClick={() => setChartMetric(metric)}
                              className={`ui-press px-2.5 py-1 text-[11px] font-semibold ${
                                visibleChartMetric === metric
                                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                                  : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="inline-flex overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                          {chartModeOptions.map((option) => (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => setChartMode(option.key)}
                              className={`ui-press px-2.5 py-1 text-[11px] font-semibold ${
                                chartMode === option.key
                                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                                  : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="mt-2">
                      {activeChartLoading ? (
                        <div className="flex h-56 items-center justify-center text-[12px] text-gray-500">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {copy.loading}
                        </div>
                      ) : activeChartHasData ? (
                        <ChartBox
                          data={activeChartData}
                          title={activeChartTitle}
                          language={language}
                          lossColoring={visibleChartMetric === "profit"}
                          selectedKey={activeDetailBar?.key ?? null}
                          onSelect={chartMode === "month" ? (point) => setDetailBar((current) => (current?.key === point.key ? null : point)) : undefined}
                        />
                      ) : (
                        <div className="flex h-56 items-center justify-center px-3 text-center text-[12px] text-gray-500">
                          {copy.noSales}
                        </div>
                      )}
                      </div>

                      {activeDetailBar ? (
                        <div className="mt-3 rounded-lg border border-gray-200 dark:border-gray-800">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3 py-2 dark:border-gray-800">
                            <div className="min-w-0">
                              <h4 className="text-[12px] font-semibold text-gray-950 dark:text-white">
                                {detailKind === "cost" ? copy.metricCost : copy.drillTitle} · {detailWindowLabel}
                              </h4>
                              {shownSales ? (
                                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                  {copy.revenue} {formatCurrency(shownSales.summary.revenue, language)} · {copy.cost}{" "}
                                  {formatCurrency(shownSales.summary.cost, language)} · {copy.profit}{" "}
                                  {formatCurrency(shownSales.summary.profit, language)}
                                </p>
                              ) : detailKind === "cost" ? (
                                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                  {copy.metricCost} {formatCurrency(shownExpensesTotal, language)} · {shownExpensesEntries}{" "}
                                  {copy.ingredients}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => setDetailBar(null)}
                              className="ui-press shrink-0 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                              {copy.drillClose}
                            </button>
                          </div>

                          {detailLoading && !matchedDetail ? (
                            <div className="flex items-center justify-center px-3 py-8 text-[12px] text-gray-500">
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {copy.loading}
                            </div>
                          ) : shownExpenses.length ? (
                            <div className="max-h-64 overflow-y-auto">
                              <div className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.6fr)] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[10px] font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                                <span>{copy.expenseCategory}</span>
                                <span>{copy.expenseNote}</span>
                                <span className="text-right">{copy.metricCost}</span>
                              </div>
                              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {shownExpenses.map((item) => (
                                  <div key={item.ID} className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,0.6fr)] items-center gap-2 px-3 py-2">
                                    <span className="truncate text-[11px] text-gray-700 dark:text-gray-200">{expenseCategoryLabels[language][item.category] ?? item.category}</span>
                                    <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">{item.note || "-"}</span>
                                    <span className="text-right font-mono text-[11px] font-semibold tabular-nums text-gray-950 dark:text-white">{formatCurrency(item.amount, language)}</span>
                                  </div>
                                ))}
                              </div>
                              {shownExpensesHaveMore ? (
                                <p className="border-t border-gray-100 px-3 py-1.5 text-center text-[10px] text-gray-500 dark:border-gray-800">{copy.drillCapped}</p>
                              ) : null}
                            </div>
                          ) : shownSales?.orders.length ? (
                            <div className="max-h-64 overflow-y-auto">
                              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_60px_repeat(3,minmax(0,0.7fr))] gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-[10px] font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                                <span>{copy.order}</span>
                                <span>{copy.location}</span>
                                <span className="text-right">{copy.time}</span>
                                <span className="text-right">{copy.revenue}</span>
                                <span className="text-right">{copy.cost}</span>
                                <span className="text-right">{copy.profit}</span>
                              </div>
                              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {shownSales.orders.map((row) => (
                                  <button
                                    key={row.order_id}
                                    type="button"
                                    onClick={() => router.push(orderPosHref({ ID: row.order_id, order_number: row.order_number }))}
                                    className="ui-press grid w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_60px_repeat(3,minmax(0,0.7fr))] items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                                  >
                                    <span className="font-mono text-[11px] font-semibold text-gray-950 dark:text-white">#{row.order_number}</span>
                                    <span className="truncate text-[11px] text-gray-600 dark:text-gray-300">
                                      {row.table_label || row.customer_name || (row.order_type === "takeaway" ? (language === "th" ? "กลับบ้าน" : "Takeaway") : "-")}
                                    </span>
                                    <span className="text-right font-mono text-[10px] text-gray-500">
                                      {new Date(row.completed_at).toLocaleTimeString(language === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                    <span className="text-right font-mono text-[11px] tabular-nums text-gray-700 dark:text-gray-200">{formatCurrency(row.revenue, language)}</span>
                                    <span className="text-right font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">{formatCurrency(row.cost, language)}</span>
                                    <span className={`text-right font-mono text-[11px] font-semibold tabular-nums ${row.profit < 0 ? "text-red-600 dark:text-red-400" : "text-gray-950 dark:text-white"}`}>
                                      {formatCurrency(row.profit, language)}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              {shownSales.has_more ? (
                                <p className="border-t border-gray-100 px-3 py-1.5 text-center text-[10px] text-gray-500 dark:border-gray-800">{copy.drillCapped}</p>
                              ) : null}
                            </div>
                          ) : detailKind === "cost" && shownExpensesEntries > 0 && shownExpensesHaveMore ? (
                            <p className="px-3 py-8 text-center text-[12px] text-gray-500">{copy.drillCapped}</p>
                          ) : (
                            <p className={`px-3 py-8 text-center text-[12px] ${detailFailed && detailKind === "sales" ? "text-red-600 dark:text-red-400" : "text-gray-500"}`}>
                              {detailFailed && detailKind === "sales" ? copy.loadError : copy.drillEmpty}
                            </p>
                          )}
                        </div>
                      ) : activeChartHasData ? (
                        <p className="mt-2 text-center text-[10px] text-gray-500 dark:text-gray-500">{copy.drillHint}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleCard>

            {/* The manager's month, and the one card built to leave the screen:
                its Export PDF builds the file from the same figures the sheet
                renders, rather than photographing the DOM or keeping a hidden
                second copy that could drift from it. */}
            <CollapsibleCard
              title={copy.monthReview}
              icon={CalendarRange}
              // Only worth a banner row when there are live cards above it to
              // fill the grid; on a past date it is one of two cards and takes
              // a normal tile.
              faceClass={isToday ? "sm:col-span-full sm:h-40" : undefined}
              subtitle={selectedMonthLabel}
              expanded={openCard === "monthReview"}
              dimmed={isCardDimmed("monthReview")}
              collapsedRank={collapsedRank("monthReview")}
              onToggle={() => toggleCard("monthReview")}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-3 border-b border-gray-200 pb-3 dark:border-gray-800">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-gray-950 dark:text-white">{copy.monthReview} · {selectedMonthLabel}</h3>
                    <p className="mt-0.5 font-mono text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                      {copy.generatedAt} {new Date().toLocaleString(language === "th" ? "th-TH" : "en-US")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { void exportMonthPdf(); }}
                    className="ui-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 print:hidden"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {copy.exportPdf}
                  </button>
                </div>
                {monthPdfError ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{monthPdfError}</p>
                ) : null}

                <div className="grid gap-4 pt-3 lg:grid-cols-2">
                  <section>
                    <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{copy.keyFigures}</h4>
                    <table className="w-full text-left text-[12px]">
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {monthKeyFigures.map((row) => (
                          <tr key={row.key}>
                            <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-300">{row.label}</td>
                            <td className={`py-1.5 text-right font-mono font-semibold tabular-nums ${row.valueClass ?? "text-gray-950 dark:text-white"}`}>{row.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {canViewExpenses ? (
                  <section>
                    <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{copy.expenseByCategory}</h4>
                    {monthExpenseByCategory.length ? (
                      <table className="w-full text-left text-[12px]">
                        <thead className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                          <tr>
                            <th className="pb-1 font-medium">{copy.expenseCategory}</th>
                            <th className="pb-1 text-right font-medium">{copy.metricCost}</th>
                            <th className="pb-1 text-right font-medium">{copy.share}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {monthExpenseByCategory.map(([category, amount]) => (
                            <tr key={category}>
                              <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-300">{expenseCategoryLabels[language][category as ExpenseCategory] ?? category}</td>
                              <td className="py-1.5 text-right font-mono font-semibold tabular-nums text-gray-950 dark:text-white">{formatCurrency(amount, language)}</td>
                              <td className="py-1.5 pl-3 text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                                {monthExpense ? formatNumber((amount / monthExpense) * 100, language, 0) : 0}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="py-6 text-center text-[12px] text-gray-500">{copy.noSalesMonth}</p>}
                  </section>
                  ) : null}

                  {monthTopItems.length ? (
                    <section>
                      <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{copy.topItems}</h4>
                      <table className="w-full text-left text-[12px]">
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {monthTopItems.slice(0, 8).map((item, index) => (
                            <tr key={item.menu_id}>
                              <td className="py-1.5 pr-3 font-mono text-gray-500">{index + 1}</td>
                              <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-300">{item.menu_name}</td>
                              <td className="py-1.5 pl-3 text-right font-mono font-semibold tabular-nums text-gray-950 dark:text-white">{formatNumber(item.quantity, language, 0)} {copy.dishes}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ) : null}

                  {stockRisks.length ? (
                    <section>
                      <h4 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{copy.stockRisks}</h4>
                      <table className="w-full text-left text-[12px]">
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                          {stockRisks.slice(0, 8).map((risk) => (
                            <tr key={risk.id}>
                              <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-300">{risk.name}</td>
                              <td className="py-1.5 text-right font-mono tabular-nums text-gray-500 dark:text-gray-400">
                                {formatNumber(risk.stock, language)} / {formatNumber(risk.min_stock, language)} {risk.unit}
                              </td>
                              <td className="py-1.5 pl-3 text-right font-mono font-semibold tabular-nums text-orange-600 dark:text-orange-300">
                                {copy.restock} {formatNumber(risk.restock_estimate, language)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ) : null}
                </div>
              </div>
            </CollapsibleCard>

            {/* Why the live cards are missing, said where they would have been:
                beside the sales tab (or its tile), rather than as a banner at
                the bottom of the page. `order` puts it straight after sales.
                It takes the shape of whatever its neighbours are wearing — a
                closed folder's tab while a card is open, a full tile in the
                grid — so the row never looks like it lost two cards. It stays
                a plain div: nothing to click, so no tab press or tile hover. */}
            {!isToday ? (
              <div
                style={{ order: collapsedRank("sales") }}
                className={
                  openCard !== null
                    ? `${cardTabShape} translate-y-px border-gray-200 bg-slate-300 text-[12px] text-gray-600 dark:border-gray-800 dark:bg-black dark:text-gray-300`
                    : "flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white p-6 text-center text-[13px] text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
                }
              >
                <CalendarDays
                  className={`shrink-0 text-gray-500 ${openCard !== null ? "h-3.5 w-3.5" : "h-8 w-8 text-gray-300 dark:text-gray-700"}`}
                  aria-hidden="true"
                />
                <span className={openCard !== null ? "truncate max-sm:hidden" : ""}>{copy.historyNotice}</span>
              </div>
            ) : null}

              {/* Kitchen queue and floor are live-only, so both cards are
                  today-only — on a past date neither has anything to say. */}
              {isToday ? (
              <CollapsibleCard
                title={copy.liveWork}
                icon={AlertTriangle}
                rows={attentionRows}
                focusOnHover
                expanded={openCard === "liveWork"}
                dimmed={isCardDimmed("liveWork")}
                collapsedRank={collapsedRank("liveWork")}
                onToggle={() => toggleCard("liveWork")}
              >
                  <div className="border-b border-gray-200 dark:border-gray-800">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div>
                        <h3 className="text-[13px] font-semibold text-gray-950 dark:text-white">{copy.kitchenQueue}</h3>
                        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{tickets.length} {copy.tickets}</p>
                      </div>
                      <button type="button" onClick={() => router.push("/kitchen")} className="ui-press inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">{copy.viewKitchen}<ArrowRight className="h-3.5 w-3.5" /></button>
                    </div>
                    {/* Stacked, a lane keeps a ticket's width rather than the
                        card's: a table number and an order number stretched
                        across a desktop card read as two lonely ends of a line.
                        Three across from `lg`, each in its own column. */}
                    {tickets.length ? (
                      <div className="grid max-w-md gap-px bg-gray-200 dark:bg-gray-800 lg:max-w-none lg:grid-cols-3">
                        {lanes.map((lane) => {
                          const Icon = lane.icon;
                          return (
                            <div key={lane.key} className="bg-white dark:bg-gray-900">
                              {/* Each lane's header wears the lane's colour, so
                                  a glance down the open card tells overdue from
                                  cooking from done without reading a word. */}
                              <div className={`flex items-center justify-between border-b px-4 py-2.5 ${lane.tint}`}>
                                <div className={`flex items-center gap-2 ${lane.color}`}>
                                  <Icon className="h-4 w-4" aria-hidden="true" />
                                  <h4 className="text-[12px] font-semibold">{lane.title}</h4>
                                </div>
                                <span className={`font-mono text-[11px] font-semibold ${lane.color}`}>{lane.items.length}</span>
                              </div>
                              {/* The whole lane, scrolled: a busy service is
                                  exactly when you need the tickets under the
                                  fifth one, and the three lanes stay level. */}
                              <div ref={smoothScroll} className="max-h-64 divide-y divide-gray-100 overflow-y-auto overflow-x-hidden dark:divide-gray-800">
                                {lane.items.length ? lane.items.map((ticket) => (
                                  <button key={`${lane.key}-${ticket.id}`} type="button" onClick={(event) => {
                                      if (openTicket !== ticket.id && ticket.items.length && window.matchMedia("(hover: none)").matches) {
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setOpenTicket(ticket.id);
                                        setTicketTip({ x: Math.min(rect.left, window.innerWidth - 260), y: rect.bottom + 6, capped: true, table: ticket.table, orderNumber: ticket.orderNumber, items: ticket.items });
                                        return;
                                      }
                                      setTicketTip(null);
                                      router.push(orderPosHref({ ID: ticket.orderId, order_number: ticket.orderNumber }));
                                    }} onMouseEnter={(event) => {
                                      if (!ticket.items.length) return;
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      setTicketTip({ x: Math.min(rect.left, window.innerWidth - 260), y: rect.bottom + 6, capped: false, table: ticket.table, orderNumber: ticket.orderNumber, items: ticket.items });
                                    }}
                                    onMouseLeave={() => setTicketTip(null)}
                                    className="ui-press block w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{ticket.table}</span>
                                      <span className="font-mono text-[11px] text-gray-500">#{ticket.orderNumber}</span>
                                    </div>
                                    {/* One clipped line, until a tap opens it out.
                                        With a cursor the row never opens — the
                                        floating panel does that job on hover. */}
                                    <p className="mt-1 line-clamp-2 text-[11px] text-gray-500 sm:line-clamp-none sm:truncate dark:text-gray-400">{ticket.items.map((item) => item.label).join(" · ")}</p>
                                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                                      <span className={`inline-flex items-center gap-1 ${lane.color}`}><Clock className="h-3 w-3" />{ticket.waited} {copy.minutes}</span>
                                      <span className="font-mono text-gray-500 dark:text-gray-400">{formatCurrency(ticket.total, language)}</span>
                                    </div>
                                  </button>
                                )) : <p className="px-4 py-8 text-center text-[12px] text-gray-500">{copy.noKitchen}</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="px-4 py-10 text-center text-[12px] text-gray-500">{copy.noKitchen}</p>}
                  </div>

                {/* The lists in this card glide like the time wheel: the mouse
                    wheel eases to a stop instead of jumping (smoothScroll). */}
                {/* Orders and stock risks sit side by side on a wide screen —
                    two things to work through, not one list after another.
                    `xl`, not `lg`: on a tablet the orders pane would be about
                    530px and the order row needs every bit of that, so the two
                    stack instead of squeezing. */}
                <div className="xl:flex xl:items-stretch">
                <div className="min-w-0 xl:flex-1 xl:border-r xl:border-gray-200 xl:dark:border-gray-800">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <h3 className="text-[13px] font-semibold text-gray-950 dark:text-white">{copy.dailyOrders}</h3>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{validOrders.length} {copy.order}</p>
                    </div>
                    <button type="button" onClick={() => router.push("/orders")} className="ui-press inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">{copy.viewAllOrders}<ArrowRight className="h-3.5 w-3.5" /></button>
                  </div>
                  {orders.length ? (
                    <div ref={smoothScroll} className="max-h-56 divide-y divide-gray-100 overflow-y-auto overflow-x-hidden dark:divide-gray-800">
                      {/* Five columns need ~580px including gaps. That is more
                          than a phone-width card has at `sm`, so the row only
                          becomes a table from `md` and stacks below it. */}
                      <div className="hidden grid-cols-[minmax(100px,0.65fr)_minmax(140px,1fr)_minmax(110px,0.7fr)_110px_70px] gap-3 bg-gray-50 px-4 py-2 text-[10px] font-medium text-gray-500 dark:bg-gray-800/50 dark:text-gray-400 md:grid">
                        <span>{copy.order}</span><span>{copy.location}</span><span>{copy.status}</span><span className="text-right">{copy.total}</span><span className="text-right">{copy.time}</span>
                      </div>
                      {orders.map((order) => (
                        <button key={order.ID} type="button" onClick={() => router.push(orderPosHref(order))} className="ui-press grid w-full gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 md:grid-cols-[minmax(100px,0.65fr)_minmax(140px,1fr)_minmax(110px,0.7fr)_110px_70px] md:items-center md:gap-3">
                          <span className="font-mono text-[12px] font-semibold text-gray-950 dark:text-white">#{order.order_number}</span>
                          <span className="truncate text-[12px] text-gray-600 dark:text-gray-300">{orderLocationLabel(order, language)}</span>
                          <span><span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-semibold ${orderStatusClass(order.status)}`}>{orderStatusLabel(order.status, copy)}</span></span>
                          <span className="font-mono text-[12px] font-semibold tabular-nums text-gray-950 dark:text-white md:text-right">{formatCurrency(order.grand_total || order.total_amount, language)}</span>
                          <span className="font-mono text-[11px] text-gray-500 md:text-right">{new Date(order.opened_at).toLocaleTimeString(language === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                        </button>
                      ))}
                    </div>
                  ) : <div className="flex flex-col items-center justify-center px-4 py-12 text-center"><ReceiptText className="h-5 w-5 text-gray-300" /><p className="mt-2 text-[12px] text-gray-500">{copy.noOrders}</p></div>}
                </div>

                {/* Moved off the reports page: an ingredient about to run out
                    is something to act on now, not something to read about in
                    a monthly report. Same figures, same restock estimate — and
                    each card now opens that ingredient's adjust dialog, so the
                    fix is one click from the warning. */}
                <div className="border-t border-gray-200 dark:border-gray-800 xl:w-2/5 xl:border-t-0">
                  <div className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${rowTint.orange}`}>
                    <div className="text-orange-700 dark:text-orange-300">
                      <h3 className="text-[13px] font-semibold">{copy.stockRisks}</h3>
                      <p className="mt-0.5 text-[11px] opacity-80">{stockRisks.length} {copy.ingredients}</p>
                    </div>
                    <button type="button" onClick={() => router.push("/inventory")} className="ui-press inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">{copy.viewInventory}<ArrowRight className="h-3.5 w-3.5" /></button>
                  </div>
                  {stockRisks.length ? (
                    <div ref={smoothScroll} className="grid max-h-56 gap-2 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-3 sm:grid-cols-2 xl:grid-cols-1">
                      {stockRisks.map((risk) => (
                        <button
                          key={risk.id}
                          type="button"
                          onClick={() => router.push(`/inventory?adjust=${risk.id}`)}
                          className="ui-press w-full rounded-md border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-gray-950 dark:text-white">{risk.name}</p>
                              <p className="mt-0.5 text-[11px] text-gray-500">{risk.category || "-"}</p>
                            </div>
                            <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold ${risk.status === "out" ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}>
                              {risk.status}
                            </span>
                          </div>
                          <p className="mt-2 font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                            {formatNumber(risk.stock, language)} / {formatNumber(risk.min_stock, language)} {risk.unit} · {copy.restock} {formatNumber(risk.restock_estimate, language)} {risk.unit}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : <p className="px-4 pb-10 pt-2 text-center text-[12px] text-gray-500">{copy.noStockRisks}</p>}
                </div>
                </div>
              </CollapsibleCard>
              ) : null}

              {isToday ? (
                <CollapsibleCard
                  title={copy.floorStatus}
                  icon={LayoutGrid}
                  summary={floorStatusSummary}
                  rows={floorRows}
                  expanded={openCard === "floorStatus"}
                  dimmed={isCardDimmed("floorStatus")}
                  collapsedRank={collapsedRank("floorStatus")}
                  onToggle={() => toggleCard("floorStatus")}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{copy.occupied} {occupied.length} · {copy.available} {availableTables.length} · {copy.reserved} {reservedTables.length}</p>
                    <button type="button" onClick={() => router.push("/pos/tables")} className="ui-press inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">{copy.openOrderTaking}<ArrowRight className="h-3.5 w-3.5" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-px bg-gray-200 dark:bg-gray-800 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {tables.map((table) => (
                      <button key={table.key} type="button" onClick={() => router.push("/pos/tables")} className="ui-press min-h-24 bg-white p-3 text-left hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-semibold text-gray-950 dark:text-white">{table.label}</span>
                          <span className={`text-[10px] font-semibold ${table.status === "occupied" ? "text-amber-600" : table.status === "available" ? "text-emerald-600" : table.status === "reserved" ? "text-sky-600" : "text-gray-500"}`}>{copy[table.status]}</span>
                        </div>
                        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">{table.guests ? `${table.guests} ${copy.people}` : table.zone || ""}</p>
                        {table.minutes !== undefined ? <p className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-gray-500"><Clock className="h-3 w-3" />{table.minutes} {copy.minutes}</p> : null}
                      </button>
                    ))}
                  </div>
                </CollapsibleCard>
              ) : null}
            </div>

          </>
        )}

        {lastUpdated ? <p className="pb-1 text-right text-[10px] text-gray-500 dark:text-gray-500">{copy.updated} {lastUpdated.toLocaleTimeString(language === "th" ? "th-TH" : "en-US", { hour: "2-digit", minute: "2-digit" })}</p> : null}
      </div>

      {orderBill ? (
        <PaidReceiptDialog
          bill={orderBill}
          language={language === "th" ? "th" : "en"}
          locationLabel={orderLocationLabel(orderBill.order, language)}
          restaurant={activeMembership?.restaurant}
          paper="a4"
          onClose={() => setOrderBill(null)}
        />
      ) : null}

      {/* Drawn once, at the top of the page, wherever the hovered row is —
          the same trick the chart tooltip uses to sit above everything. */}
      {ticketTip ? (
        <div
          ref={ticketTipRef}
          style={{ left: ticketTip.x, top: ticketTip.y }}
          className="fixed z-50 max-w-[15rem] overflow-hidden rounded-md border border-gray-200 bg-white text-[13px] leading-snug text-gray-700 shadow-lg dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200"
        >
          <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-800/60">
            <span className="truncate font-semibold text-gray-950 dark:text-white">{ticketTip.table}</span>
            <span className="shrink-0 font-mono text-[11px] text-gray-500 dark:text-gray-400">#{ticketTip.orderNumber}</span>
          </div>
          <div className={`px-3 py-2 ${ticketTip.capped ? "max-h-[min(calc(8.25em+1rem),45dvh)] overflow-y-auto overflow-x-hidden overscroll-contain" : ""}`}>
            {ticketTip.items.map((item, index) => (
              <p key={`${item.label}-${index}`} className={`truncate ${item.done ? "text-gray-400 line-through dark:text-gray-500" : ""}`}>{item.label}</p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
