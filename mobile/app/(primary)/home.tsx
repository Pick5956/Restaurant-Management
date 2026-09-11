import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { listExpenses } from '@/src/api/expense';

import { listIngredients } from '@/src/api/ingredient';
import { kitchenQueue, listOrders } from '@/src/api/order';
import { getManagerReport, getTopMenuItemsByMonth } from '@/src/api/report';
import { listTables } from '@/src/api/table';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { usePrimaryTabSceneStatus } from '@/src/components/primary-tabs-runtime';
import { AttentionRail, DayStrip, HomeHeading, MonthRow, SalesHero, StatTile, TableMap, type AttentionCardProps } from '@/src/components/home/parts';
import { EdgeRow, EdgeSection, EdgeSectionHeader, EmptyState, Feedback, Surface } from '@/src/components/ui';
import {
  bangkokHour,
  buildHomeAttention,
  clampDashboardDate,
  dashboardLoadFailurePolicy,
  homeDayStrip,
  homeRevenueCurve,
  homeTableCells,
  percentChange,
  resolveHomePriority,
  sameWeekdayRevenue,
  summarizeHomeOrders,
  summarizeInventory,
  summarizeKitchenQueue,
  shouldStartDashboardLoad,
  shouldReplaceOptionalDashboardSnapshot,
  topHomeMenuItems,
  waitingBillOrders,
  type HomePriority,
} from '@/src/lib/home-dashboard';
import { formatBangkokDate } from '@/src/lib/order-query';
import { can } from '@/src/lib/rbac';
import { getBangkokReportMonth } from '@/src/lib/report-query';
import { getWorkModeCopy } from '@/src/lib/work-mode';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, radius, spacing, statusTone, typeScale } from '@/src/theme';
import type { Ingredient } from '@/src/types/ingredient';
import type { Order, OrderStatus } from '@/src/types/order';
import type { ManagerReport, TopMenuItemsReport } from '@/src/types/report';
import type { RestaurantTable } from '@/src/types/table';

const activeStatuses = new Set(['open', 'sent_to_kitchen', 'cooking', 'ready', 'served']);
type Copy = (thai: string, english: string) => string;
type OptionalFailure = 'kitchen' | 'inventory';
type ReportFailure = 'trend' | 'top-menu';

function dashboardDateLabel(value: string, language: 'th' | 'en') {
  const date = new Date(`${value}T12:00:00+07:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatMoney(value: number | null | undefined, language: 'th' | 'en') {
  return `฿${Number(value || 0).toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    maximumFractionDigits: 0,
  })}`;
}

function formatSignedMoney(value: number, language: 'th' | 'en') {
  if (!value) return formatMoney(0, language);
  const sign = value > 0 ? '+' : '−';
  return `${sign}${formatMoney(Math.abs(value), language)}`;
}

function reportMonthLabel(report: TopMenuItemsReport, language: 'th' | 'en') {
  const date = new Date(Date.UTC(report.year, report.month - 1, 1, 12));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
    timeZone: 'Asia/Bangkok',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatBangkokTime(value: string | null | undefined, language: 'th' | 'en') {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function localizedOrderStatus(status: OrderStatus, copy: Copy) {
  const labels: Record<OrderStatus, [string, string]> = {
    open: ['เปิดอยู่', 'Open'],
    sent_to_kitchen: ['ส่งเข้าครัว', 'Sent to kitchen'],
    cooking: ['กำลังทำ', 'Cooking'],
    ready: ['ครัวทำเสร็จ', 'Ready'],
    served: ['ครัวทำเสร็จ', 'Ready'],
    completed: ['ปิดแล้ว', 'Completed'],
    cancelled: ['ยกเลิก', 'Cancelled'],
  };
  return copy(...labels[status]);
}

function localizedWorkMode(
  workMode: ReturnType<typeof getWorkModeCopy>,
  copy: Copy,
) {
  const titles: Record<string, string> = {
    โหมดครัว: 'Kitchen mode',
    โหมดหน้าร้าน: 'Front-of-house mode',
    โหมดแคชเชียร์: 'Cashier mode',
    โหมดเจ้าของร้าน: 'Owner mode',
    โหมดทำงาน: 'Work mode',
  };
  const title = copy(workMode.title, titles[workMode.title] || workMode.title);
  return {
    title,
    // The word "mode" is chrome; the role alone is what the person is.
    role: title.replace(/^โหมด/, '').replace(/\s+mode$/i, '').trim(),
  };
}

function attentionLabel(priority: HomePriority, copy: Copy) {
  switch (priority.key) {
    case 'kitchen-overdue':
      return copy('ครัวเกินเวลา', 'Kitchen overdue');
    case 'stock-out':
      return copy('วัตถุดิบหมด', 'Out of stock');
    case 'stock-low':
      return copy('วัตถุดิบใกล้หมด', 'Low stock');
    default:
      return '';
  }
}

function attentionIcon(priority: HomePriority): AppIconName {
  const icons: Record<HomePriority['key'], AppIconName> = {
    'kitchen-overdue': 'timer-outline',
    'stock-out': 'alert-circle-outline',
    'stock-low': 'cube-outline',
    'kitchen-active': 'flame-outline',
    'take-order': 'restaurant-outline',
    orders: 'receipt-outline',
    overview: 'checkmark-circle-outline',
  };
  return icons[priority.key];
}

function weekdayName(date: string, language: 'th' | 'en') {
  const parsed = new Date(`${date}T12:00:00+07:00`);
  if (!Number.isFinite(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-US', { timeZone: 'Asia/Bangkok', weekday: 'long' }).format(parsed);
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function orderStatusPresentation(status: OrderStatus) {
  if (status === 'completed' || status === 'ready' || status === 'served') return statusTone('success');
  if (status === 'sent_to_kitchen' || status === 'cooking') return statusTone('warning');
  if (status === 'cancelled') return statusTone('danger');
  return statusTone('info');
}

export default function HomeScreen() {
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { width } = useWindowDimensions();
  const requestIdRef = useRef(0);
  const foregroundRequestIdRef = useRef<number | null>(null);
  const adjacentWarmRequestedRef = useRef(false);
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();
  const [selectedDate, setSelectedDate] = useState(() => formatBangkokDate());
  const [loadedDate, setLoadedDate] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [managerReport, setManagerReport] = useState<ManagerReport | null>(null);
  const [topMenuReport, setTopMenuReport] = useState<TopMenuItemsReport | null>(null);
  // null = not known (no permission, or the request failed), so the profit tile
  // can stay silent instead of claiming a profit that ignores the day's costs.
  const [dayExpense, setDayExpense] = useState<number | null>(null);
  const [optionalFailures, setOptionalFailures] = useState<OptionalFailure[]>([]);
  const [reportFailures, setReportFailures] = useState<ReportFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workMode = localizedWorkMode(getWorkModeCopy(activeMembership), copy);
  // A shop that renamed the role sees its own name for it, not the stock one.
  const roleChip = activeMembership?.role?.display_name_override?.trim() || workMode.role;
  const canViewDashboard = can(activeMembership, 'view_dashboard');
  const canTakeOrder = can(activeMembership, 'take_order');
  const canViewOrders = can(activeMembership, 'view_orders');
  const canViewKitchen = can(activeMembership, 'view_kitchen');
  const canViewInventory = can(activeMembership, 'view_inventory') || can(activeMembership, 'manage_inventory');
  const canViewTables = canTakeOrder || can(activeMembership, 'view_tables') || can(activeMembership, 'manage_table');
  const canViewReports = can(activeMembership, 'view_reports');
  const today = formatBangkokDate();
  const isToday = selectedDate === today;

  const load = useCallback(async (quiet = false) => {
    if (!canViewDashboard) {
      foregroundRequestIdRef.current = null;
      setLoading(false);
      return;
    }

    if (!shouldStartDashboardLoad(quiet, foregroundRequestIdRef.current !== null)) return;

    const requestId = ++requestIdRef.current;
    if (!quiet) {
      foregroundRequestIdRef.current = requestId;
      setLoading(true);
      setError(null);
    }

    try {
      const shouldLoadReports = isToday && canViewReports && !quiet;
      const orderRequest = canViewOrders
        ? listOrders({ date: selectedDate, limit: 200 })
        : Promise.resolve({ orders: [] as Order[] });
      const tableRequest = isToday && canViewTables
        ? listTables()
        : Promise.resolve({ tables: [] as RestaurantTable[] });
      const kitchenRequest = isToday && canViewKitchen
        ? kitchenQueue()
          .then((response) => ({ response, failed: false }))
          .catch(() => ({ response: { orders: [] as Order[] }, failed: true }))
        : Promise.resolve({ response: { orders: [] as Order[] }, failed: false });
      const ingredientRequest = isToday && canViewInventory
        ? listIngredients()
          .then((response) => ({ response, failed: false }))
          .catch(() => ({ response: { ingredients: [] as Ingredient[] }, failed: true }))
        : Promise.resolve({ response: { ingredients: [] as Ingredient[] }, failed: false });
      const managerReportRequest = shouldLoadReports
        ? getManagerReport(14)
          .then((response) => ({ response, failed: false }))
          .catch(() => ({ response: null as ManagerReport | null, failed: true }))
        : Promise.resolve({ response: null as ManagerReport | null, failed: false });
      const topMenuRequest = shouldLoadReports
        ? getTopMenuItemsByMonth(getBangkokReportMonth())
          .then((response) => ({ response, failed: false }))
          .catch(() => ({ response: null as TopMenuItemsReport | null, failed: true }))
        : Promise.resolve({ response: null as TopMenuItemsReport | null, failed: false });
      // Costs for the selected day, whatever day it is: the profit figure is
      // takings minus these, and a day's takings mean little without them.
      const expenseRequest = canViewReports
        ? listExpenses({ from: selectedDate, until: selectedDate })
          .then((response) => Number(response.total) || 0)
          .catch(() => null as number | null)
        : Promise.resolve(null as number | null);

      const [
        orderResponse,
        tableResponse,
        kitchenResponse,
        ingredientResponse,
        managerReportResponse,
        topMenuResponse,
        expenseTotal,
      ] = await Promise.all([
        orderRequest,
        tableRequest,
        kitchenRequest,
        ingredientRequest,
        managerReportRequest,
        topMenuRequest,
        expenseRequest,
      ]);
      if (requestId !== requestIdRef.current) return;

      setError(null);
      setOrders(orderResponse.orders || []);
      setTables(tableResponse.tables || []);
      if (shouldReplaceOptionalDashboardSnapshot(quiet, kitchenResponse.failed)) {
        setKitchenOrders(kitchenResponse.response.orders || []);
      }
      if (shouldReplaceOptionalDashboardSnapshot(quiet, ingredientResponse.failed)) {
        setIngredients(ingredientResponse.response.ingredients || []);
      }
      setOptionalFailures([
        ...(isToday && canViewKitchen && kitchenResponse.failed ? ['kitchen' as const] : []),
        ...(isToday && canViewInventory && ingredientResponse.failed ? ['inventory' as const] : []),
      ]);
      if (!quiet) {
        setManagerReport(shouldLoadReports ? managerReportResponse.response : null);
        setTopMenuReport(shouldLoadReports ? topMenuResponse.response : null);
        setReportFailures(shouldLoadReports
          ? [
            ...(managerReportResponse.failed ? ['trend' as const] : []),
            ...(topMenuResponse.failed ? ['top-menu' as const] : []),
          ]
          : []);
      }
      setDayExpense(expenseTotal);
      setLoadedDate(selectedDate);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const failurePolicy = dashboardLoadFailurePolicy(quiet);
      if (!failurePolicy.preserveSnapshot) {
        setOrders([]);
        setTables([]);
        setKitchenOrders([]);
        setIngredients([]);
        setOptionalFailures([]);
        setManagerReport(null);
        setTopMenuReport(null);
        setReportFailures([]);
        setDayExpense(null);
        setLoadedDate(selectedDate);
      }
      if (failurePolicy.showError) {
        setError(
          err instanceof Error
            ? err.message
            : copy('โหลดภาพรวมร้านไม่สำเร็จ', 'Could not load the restaurant overview'),
        );
      }
    } finally {
      if (!quiet && foregroundRequestIdRef.current === requestId) {
        foregroundRequestIdRef.current = null;
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }
  }, [
    canViewDashboard,
    canViewInventory,
    canViewKitchen,
    canViewOrders,
    canViewReports,
    canViewTables,
    copy,
    isToday,
    selectedDate,
  ]);

  useEffect(() => {
    if (
      primaryTabSceneStatus !== 'adjacent' ||
      adjacentWarmRequestedRef.current
    ) return;
    adjacentWarmRequestedRef.current = true;
    void load();
  }, [load, primaryTabSceneStatus]);

  useFocusEffect(useCallback(() => {
    if (adjacentWarmRequestedRef.current) {
      adjacentWarmRequestedRef.current = false;
    } else {
      void load();
    }
    const timer = isToday ? setInterval(() => load(true), 15000) : null;
    return () => {
      if (timer) clearInterval(timer);
      requestIdRef.current += 1;
      foregroundRequestIdRef.current = null;
      setLoading(false);
    };
  }, [isToday, load]));

  const selectDate = useCallback((candidate: string) => {
    setSelectedDate((current) => clampDashboardDate(current, candidate, formatBangkokDate()));
  }, []);

  const validOrders = useMemo(() => orders.filter((order) => order.status !== 'cancelled'), [orders]);
  const activeOrders = useMemo(() => validOrders.filter((order) => activeStatuses.has(order.status)), [validOrders]);
  const orderSummary = useMemo(() => summarizeHomeOrders(orders), [orders]);
  const occupiedTableCount = useMemo(() => tables.filter((table) => table.status === 'occupied').length, [tables]);
  const freeTableCount = useMemo(() => tables.filter((table) => table.status === 'free').length, [tables]);
  const reservedTableCount = useMemo(() => tables.filter((table) => table.status === 'reserved').length, [tables]);
  const kitchenSummary = useMemo(() => summarizeKitchenQueue(kitchenOrders), [kitchenOrders]);
  const inventorySummary = useMemo(() => summarizeInventory(ingredients), [ingredients]);
  const tabletWorkspace = width >= 900;
  const counts = useMemo(() => ({
    ...kitchenSummary,
    ...inventorySummary,
    occupiedTables: occupiedTableCount,
  }), [inventorySummary, kitchenSummary, occupiedTableCount]);
  const access = useMemo(() => ({
    canViewKitchen,
    canViewInventory,
    canTakeOrder,
    canViewOrders,
  }), [canTakeOrder, canViewInventory, canViewKitchen, canViewOrders]);
  const priority = useMemo(() => resolveHomePriority(counts, access), [access, counts]);
  const attention = useMemo(() => buildHomeAttention(counts, access), [access, counts]);
  const topMenuItems = useMemo(
    () => topHomeMenuItems(topMenuReport?.items || [], 3),
    [topMenuReport],
  );
  const optionalFailureLabels = optionalFailures.map((failure) =>
    failure === 'kitchen'
      ? copy('คิวครัว', 'kitchen queue')
      : copy('คลังวัตถุดิบ', 'inventory'),
  );

  // ---- the new page's figures
  const salesDays = managerReport?.sales_days ?? null;
  const days = useMemo(() => homeDayStrip(today, selectedDate, salesDays), [salesDays, selectedDate, today]);
  const nowHour = isToday ? bangkokHour(new Date().toISOString()) : null;
  const curve = useMemo(() => homeRevenueCurve(orders, nowHour), [nowHour, orders]);
  const lastWeek = useMemo(() => sameWeekdayRevenue(salesDays, selectedDate), [salesDays, selectedDate]);
  const billOrders = useMemo(() => waitingBillOrders(validOrders), [validOrders]);
  const billTableIds = useMemo(() => new Set(billOrders.map((order) => order.table?.ID).filter((id): id is number => typeof id === 'number')), [billOrders]);
  const tableCells = useMemo(() => homeTableCells(tables, billTableIds), [billTableIds, tables]);
  const shortIngredients = useMemo(
    () => ingredients.filter((item) => Number(item.stock) <= Number(item.min_stock)).sort((a, b) => Number(a.stock) - Number(b.stock)),
    [ingredients],
  );
  const dayProfit = dayExpense === null ? null : orderSummary.paidRevenue - dayExpense;
  const weekday = weekdayName(selectedDate, language);
  const heroReference = lastWeek === null
    ? null
    : isToday
      ? copy(`${weekday}ที่แล้วทั้งวัน ${formatMoney(lastWeek, language)}`, `Last ${weekday}, whole day: ${formatMoney(lastWeek, language)}`)
      : (() => {
        const change = percentChange(orderSummary.paidRevenue, lastWeek);
        if (change === null) return null;
        const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '=';
        return copy(`${arrow} ${Math.abs(change)}% เทียบ${weekday}ก่อนหน้า`, `${arrow} ${Math.abs(change)}% vs the previous ${weekday}`);
      })();

  const attentionCards = useMemo<AttentionCardProps[]>(() => {
    if (!isToday) return [];
    const cards: AttentionCardProps[] = attention.map((item) => {
      const names = item.key === 'stock-out'
        ? shortIngredients.filter((ing) => Number(ing.stock) <= 0).map((ing) => ing.name)
        : item.key === 'stock-low'
          ? shortIngredients.filter((ing) => Number(ing.stock) > 0).map((ing) => ing.name)
          : [];
      const detail = item.key === 'kitchen-overdue'
        ? copy('รออย่างน้อย 10 นาที เปิดคิวครัว', 'Waited 10+ minutes. Open the kitchen queue')
        : names.length
          ? names.slice(0, 4).join(' · ') + (names.length > 4 ? ` +${names.length - 4}` : '')
          : copy('เปิดคลังเพื่อดูรายการ', 'Open inventory to see them');
      return {
        key: item.key,
        icon: attentionIcon(item),
        title: attentionLabel(item, copy),
        headline: copy(`${item.count} รายการ`, `${item.count} ${item.count === 1 ? 'item' : 'items'}`),
        detail,
        tone: item.tone === 'danger' ? 'danger' : 'warning',
        onPress: item.key === 'stock-out'
          ? () => router.push({ pathname: '/inventory' as never, params: { status: 'out' } } as never)
          : item.key === 'stock-low'
            ? () => router.push({ pathname: '/inventory' as never, params: { status: 'low' } } as never)
            : item.href
              ? () => router.push(item.href as never)
              : undefined,
      };
    });
    if (billOrders.length && canViewOrders) {
      const labels = billOrders.map((order) => order.table?.display_label || order.order_number);
      const owed = billOrders.reduce((sum, order) => sum + Number(order.grand_total || 0), 0);
      cards.push({
        key: 'waiting-bill',
        icon: 'receipt-outline',
        title: copy('รอเช็คบิล', 'Waiting to pay'),
        headline: copy(`${billOrders.length} โต๊ะ`, `${billOrders.length} ${billOrders.length === 1 ? 'table' : 'tables'}`),
        detail: `${labels.slice(0, 3).join(' · ')} · ${formatMoney(owed, language)}`,
        tone: 'info',
        // One table waiting: straight to its bill. Several: the orders list,
        // where each one is a row.
        onPress: billOrders.length === 1
          ? () => router.push({ pathname: '/order/[id]', params: { id: String(billOrders[0].ID) } })
          : () => router.push('/orders'),
      });
    }
    return cards;
  }, [attention, billOrders, canViewOrders, copy, isToday, language, shortIngredients]);

  // The same three doors the tables screen opens: the running order if the
  // table has one, the reservation if it is only booked, a fresh order if it is
  // free. Tapping a table on the overview should never just land on a list of
  // tables with the same one still to find.
  const openTable = useCallback((cell: { id: number; state: 'busy' | 'bill' | 'reserved' | 'free' }) => {
    const running = activeOrders.find((order) => order.table?.ID === cell.id);
    if (running) {
      router.push({ pathname: '/order/[id]', params: { id: String(running.ID) } });
      return;
    }
    if (cell.state === 'reserved') {
      router.push({ pathname: '/table-reservation' as never, params: { tableId: String(cell.id) } } as never);
      return;
    }
    router.push({ pathname: '/order/new' as never, params: { tableId: String(cell.id) } } as never);
  }, [activeOrders]);

  const tableLegend = {
    busy: copy('ใช้งาน', 'Seated'),
    bill: copy('รอบิล', 'Waiting to pay'),
    reserved: copy('จอง', 'Reserved'),
    free: copy('ว่าง', 'Free'),
  };
  const monthLabel = topMenuReport ? reportMonthLabel(topMenuReport, language) : '';
  const monthDetail = topMenuItems.length
    ? copy(`ขายดีสุด ${topMenuItems[0].menu_name} ${Number(topMenuItems[0].quantity).toLocaleString('th-TH')} จาน`, `Best seller ${topMenuItems[0].menu_name}, ${Number(topMenuItems[0].quantity).toLocaleString('en-US')} sold`)
    : reportFailures.includes('top-menu')
      ? copy('ยังโหลดอันดับเมนูไม่ได้ แตะเพื่อดูรายงาน', 'Top items unavailable. Tap for reports')
      : copy('ยังไม่มีข้อมูลการขายเดือนนี้', 'No sales recorded this month yet');
  const displayOrders = useMemo(
    () => isToday
      ? [...activeOrders, ...validOrders.filter((order) => !activeStatuses.has(order.status))]
      : validOrders,
    [activeOrders, isToday, validOrders],
  );
  const dateLoading = loading && loadedDate !== selectedDate;

  if (!canViewDashboard) {
    return (
      <AppScreen
        title={copy('ภาพรวมร้าน', 'Restaurant overview')}
        topLevel
      >
        <EmptyState
          title={copy('ไม่มีสิทธิ์ดูภาพรวมร้าน', 'You cannot view the restaurant overview')}
          detail={copy('ต้องมีสิทธิ์ view_dashboard', 'The view_dashboard permission is required')}
        />
      </AppScreen>
    );
  }

  const heroCaption = isToday
    ? copy('ยอดขายวันนี้', "Today's sales")
    : copy(`ยอดขาย${weekday} ${dashboardDateLabel(selectedDate, language)}`, `Sales on ${dashboardDateLabel(selectedDate, language)}`);
  const hero = canViewOrders ? (
    <SalesHero
      amount={formatMoney(orderSummary.paidRevenue, language)}
      caption={heroCaption}
      reference={heroReference}
      curve={curve}
      axisStart={curve ? hourLabel(curve.startHour) : '10:00'}
      axisNow={isToday && curve ? copy(`ตอนนี้ ${hourLabel(curve.endHour)}`, `now ${hourLabel(curve.endHour)}`) : null}
      axisEnd={curve && !isToday ? hourLabel(curve.endHour) : '23:00'}
      onPress={canViewReports ? () => router.push('/reports') : undefined}
    />
  ) : null;
  const stats = canViewOrders ? (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {dayExpense !== null ? (
        <StatTile icon="trending-down-outline" label={copy('รายจ่าย', 'Expenses')} value={formatMoney(dayExpense, language)} tone="danger" onPress={() => router.push('/expenses' as never)} />
      ) : (
        <StatTile icon="people-outline" label={copy('ลูกค้า', 'Guests')} value={String(orderSummary.guests)} />
      )}
      {dayProfit !== null ? (
        <StatTile icon="wallet-outline" label={copy('กำไร', 'Profit')} value={formatSignedMoney(dayProfit, language)} tone={dayProfit < 0 ? 'danger' : 'success'} />
      ) : (
        <StatTile icon="cash-outline" label={copy('เฉลี่ย/บิล', 'Avg bill')} value={formatMoney(orderSummary.averageBill, language)} />
      )}
      <StatTile icon="receipt-outline" label={copy('ออเดอร์', 'Orders')} value={String(orderSummary.totalOrders)} onPress={() => router.push('/orders')} />
    </View>
  ) : null;
  const month = isToday && canViewReports ? (
    <MonthRow
      title={copy(`สรุปเดือน${monthLabel ? monthLabel.replace(/\s*\d{4}$/, '') : 'นี้'}`, `${monthLabel || 'This month'} summary`)}
      detail={monthDetail}
      onPress={() => router.push('/reports')}
    />
  ) : null;
  const attentionBlock = attentionCards.length ? (
    <View style={{ gap: spacing.sm }}>
      <HomeHeading icon="alert-circle-outline" title={copy('ต้องจัดการตอนนี้', 'Needs attention now')} />
      <AttentionRail cards={attentionCards} stacked={tabletWorkspace} />
    </View>
  ) : null;
  const tablesBlock = isToday && canViewTables && tableCells.length ? (
    <View style={{ gap: spacing.sm }}>
      <HomeHeading
        icon="grid-outline"
        title={copy('โต๊ะ', 'Tables')}
        trailing={copy(`${occupiedTableCount} / ${tableCells.length} ใช้งาน`, `${occupiedTableCount} / ${tableCells.length} seated`)}
        onPress={canTakeOrder ? () => router.push('/tables') : undefined}
      />
      <TableMap
        cells={tableCells}
        columns={tabletWorkspace ? 4 : 5}
        legend={tableLegend}
        onPress={canTakeOrder ? openTable : undefined}
      />
    </View>
  ) : null;

  return (
    <AppScreen
      title={copy('ภาพรวมร้าน', 'Restaurant overview')}
      topLevel
      refreshControl={<AppRefreshControl onRefresh={() => load()} />}
      action={(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: palette.accentSoft, borderWidth: 1, borderColor: palette.accentMuted }}>
          <AppIcon name="person-circle-outline" size={14} color={palette.primaryInk} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: palette.primaryInk }}>{roleChip}</Text>
        </View>
      )}
    >
      <DayStrip days={days} language={language} onSelect={selectDate} />

      {error ? (
        <Feedback
          title={copy('อัปเดตข้อมูลไม่ได้', 'Could not update data')}
          detail={error}
          tone="danger"
        />
      ) : null}

      {dateLoading ? (
        <Surface>
          <Text selectable style={[typeScale.body, { color: palette.muted }]}>
            {copy('กำลังโหลดข้อมูลของวันที่เลือก...', 'Loading data for the selected date...')}
          </Text>
        </Surface>
      ) : tabletWorkspace ? (
        <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
          <View style={{ flex: 1.15, gap: spacing.md }}>
            {hero}
            {stats}
            {month}
          </View>
          <View style={{ flex: 0.85, gap: spacing.md }}>
            {attentionBlock}
            {isToday && optionalFailures.length ? (
              <Feedback
                title={copy('ข้อมูลบางส่วนยังไม่ครบ', 'Some live data is unavailable')}
                detail={copy(`ระบบยังอัปเดตไม่ได้: ${optionalFailureLabels.join(', ')} และจะลองใหม่อัตโนมัติ`, `Could not update: ${optionalFailureLabels.join(', ')}. The app will retry automatically.`)}
                tone="warning"
              />
            ) : null}
          </View>
          <View style={{ flex: 1, gap: spacing.md }}>
            {tablesBlock}
          </View>
        </View>
      ) : (
        <>
          {hero}
          {stats}
          {isToday && optionalFailures.length ? (
            <Feedback
              title={copy('ข้อมูลบางส่วนยังไม่ครบ', 'Some live data is unavailable')}
              detail={copy(`ระบบยังอัปเดตไม่ได้: ${optionalFailureLabels.join(', ')} และจะลองใหม่อัตโนมัติ`, `Could not update: ${optionalFailureLabels.join(', ')}. The app will retry automatically.`)}
              tone="warning"
            />
          ) : null}
          {attentionBlock}
          {tablesBlock}
          {month}
        </>
      )}

      {!dateLoading ? (
        <View style={{ gap: spacing.md }}>
          <EdgeSectionHeader
            title={
              isToday
                ? copy('ความเคลื่อนไหวล่าสุด', 'Recent activity')
                : copy('ออเดอร์ของวันที่เลือก', 'Orders for the selected date')
            }
            detail={
              isToday
                ? copy(
                  `${activeOrders.length} ออเดอร์ยังอยู่ระหว่างดำเนินการ`,
                  `${activeOrders.length} active ${activeOrders.length === 1 ? 'order' : 'orders'}`,
                )
                : dashboardDateLabel(selectedDate, language)
            }
          />
          {displayOrders.length ? (
            <EdgeSection>
              {displayOrders.slice(0, 6).map((order) => {
                const orderTone = orderStatusPresentation(order.status);
                const orderTime = formatBangkokTime(order.closed_at || order.opened_at, language);
                return (
                  <EdgeRow
                    accessibilityLabel={`${order.table?.display_label || order.order_number}, ${localizedOrderStatus(order.status, copy)}, ${formatMoney(order.grand_total, language)}`}
                    detail={`${order.order_number} · ${localizedOrderStatus(order.status, copy)}`}
                    key={order.ID}
                    leading={(
                      <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full, backgroundColor: orderTone.backgroundColor }}>
                        <AppIcon color={orderTone.color} name={order.payment_status === 'paid' ? 'checkmark' : 'receipt-outline'} size={18} />
                      </View>
                    )}
                    onPress={() => router.push({ pathname: '/order/[id]', params: { id: String(order.ID) } })}
                    title={order.table?.display_label || order.order_number}
                    trailing={(
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text selectable style={[typeScale.number, { fontSize: 16 }]}>{formatMoney(order.grand_total, language)}</Text>
                        {orderTime ? <Text selectable style={[typeScale.caption, { color: palette.muted, fontVariant: ['tabular-nums'] }]}>{orderTime}</Text> : null}
                      </View>
                    )}
                  />
                );
              })}
            </EdgeSection>
          ) : (
            <EmptyState
              title={
                canViewOrders
                  ? copy('ยังไม่มีออเดอร์ในวันที่เลือก', 'No orders for the selected date')
                  : copy('ไม่มีสิทธิ์ดูรายการออเดอร์', 'You cannot view order details')
              }
              detail={
                canViewOrders
                  ? copy('เมื่อมีออเดอร์ รายการของวันที่เลือกจะอยู่ตรงนี้', 'Orders for the selected date will appear here.')
                  : copy('สรุปส่วนที่เหลือจะแสดงตามสิทธิ์ของคุณ', 'The remaining summary is shown based on your access.')
              }
            />
          )}
        </View>
      ) : null}
    </AppScreen>
  );
}
