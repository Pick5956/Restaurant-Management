import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { getManagerReport, getTopMenuItemsByMonth } from '@/src/api/report';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  CardHeading,
  DayTable,
  MenuProfitCard,
  ReportCard,
  ReportFigures,
  ReportTabs,
  SalesChart,
  StockRisksView,
  TopSellersCard,
  type ReportFigure,
} from '@/src/components/reports/parts';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { EmptyState, Feedback } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { loadFilteredReplacement } from '@/src/lib/filter-reload';
import { formatBangkokDate } from '@/src/lib/order-query';
import { can } from '@/src/lib/rbac';
import {
  averagePerFinishedDay,
  bestReportDay,
  fillReportDays,
  reportPeriodLabel,
  sortStockRisks,
  type ReportTab,
} from '@/src/lib/report-view';
import { getBangkokReportMonth, shiftReportMonth } from '@/src/lib/report-query';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import type { ManagerReport, TopMenuItemsReport } from '@/src/types/report';

// The reports screen, redrawn on 15 ก.ย. 2569 (the owner chose design B from
// two): the five figures stay on top, and the rest sits behind three tabs —
// sales, menu, stock — so each fits a screen instead of the page running four
// screens long. The 14-day report and the month's best sellers load apart, so
// stepping to another month redraws that one card and leaves the rest standing.

// Fixed window, matching the web reports page. There is no period picker.
const REPORT_DAYS = 14;

export default function ReportsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canView = can(activeMembership, 'view_reports');
  const tablet = width >= breakpoints.tabletWorkspace;
  const currentMonth = useMemo(() => getBangkokReportMonth(), []);

  const [tab, setTab] = useState<ReportTab>('sales');
  const [topMenuMonth, setTopMenuMonth] = useState(currentMonth);
  const [report, setReport] = useState<ManagerReport | null>(null);
  const [topMenus, setTopMenus] = useState<TopMenuItemsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [menusLoading, setMenusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState(() => formatBangkokDate());
  const reportRequest = useRef(createRequestGeneration());
  const menuRequest = useRef(createRequestGeneration());

  const loadReport = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const request = reportRequest.current.begin();
    setLoading(true);
    setError(null);
    const result = await loadFilteredReplacement(() => getManagerReport(REPORT_DAYS));
    if (!reportRequest.current.isCurrent(request)) return;
    if (result.ok) {
      setReport(result.data);
      setToday(formatBangkokDate());
    } else {
      setError(result.error instanceof Error ? result.error.message : copy('โหลดรายงานไม่สำเร็จ', 'Could not load reports.'));
    }
    setLoading(false);
  }, [canView, copy]);

  const loadMenus = useCallback(async () => {
    if (!canView) {
      setMenusLoading(false);
      return;
    }
    const request = menuRequest.current.begin();
    setMenusLoading(true);
    const result = await loadFilteredReplacement(() => getTopMenuItemsByMonth(topMenuMonth));
    if (!menuRequest.current.isCurrent(request)) return;
    setTopMenus(result.ok ? result.data : null);
    setMenusLoading(false);
  }, [canView, topMenuMonth]);

  useEffect(() => {
    void loadReport();
    const generation = reportRequest.current;
    return () => generation.invalidate();
  }, [loadReport]);
  useEffect(() => {
    void loadMenus();
    const generation = menuRequest.current;
    return () => generation.invalidate();
  }, [loadMenus]);

  const days = useMemo(() => (report ? fillReportDays(report.sales_days, REPORT_DAYS, today) : []), [report, today]);
  const best = useMemo(() => bestReportDay(days), [days]);
  const average = useMemo(() => averagePerFinishedDay(days), [days]);
  const periodLabel = days.length ? reportPeriodLabel(days[0].date, days[days.length - 1].date, language) : '';
  const stock = useMemo(() => sortStockRisks(report?.stock_risks ?? []), [report]);

  const canGoPreviousMonth = topMenuMonth.year > 2000 || topMenuMonth.month > 1;
  const canGoNextMonth = topMenuMonth.year < currentMonth.year
    || (topMenuMonth.year === currentMonth.year && topMenuMonth.month < currentMonth.month);
  const monthDate = new Date(Date.UTC(topMenuMonth.year, topMenuMonth.month - 1, 1, 12));
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(monthDate);
  const shortMonthLabel = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(monthDate);

  if (!canView) {
    return (
      <AppScreen title={copy('รายงานร้าน', 'Reports')} topLevel={false}>
        <Feedback title={copy('ไม่มีสิทธิ์ดูรายงาน', 'Report access unavailable')} detail={copy('หน้านี้ต้องใช้สิทธิ์ดูรายงานของร้าน', 'This page requires permission to view restaurant reports.')} tone="info" />
      </AppScreen>
    );
  }

  const figures: ReportFigure[] = report ? [
    { key: 'revenue', label: copy('ยอดขาย', 'Sales'), value: money(report.summary.revenue, language), note: average > 0 ? copy(`เฉลี่ยวันละ ${money(average, language)}`, `${money(average, language)} a day`) : undefined, tone: 'hero' },
    { key: 'orders', label: copy('ออเดอร์', 'Orders'), value: report.summary.orders.toLocaleString(locale), note: report.summary.orders > 0 ? copy(`เฉลี่ยบิลละ ${money(report.summary.revenue / report.summary.orders, language)}`, `${money(report.summary.revenue / report.summary.orders, language)} a bill`) : undefined },
    { key: 'cost', label: copy('ต้นทุนวัตถุดิบ', 'Ingredient cost'), value: money(report.summary.cost, language) },
    { key: 'profit', label: copy('กำไรขั้นต้น', 'Gross profit'), value: money(report.summary.profit, language), tone: report.summary.profit >= 0 ? 'good' : undefined },
    { key: 'margin', label: copy('มาร์จิน', 'Margin'), value: `${Number(report.summary.margin).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` },
  ] : [];

  const salesTab = (
    <View style={{ flexDirection: tablet ? 'row' : 'column', alignItems: tablet ? 'flex-start' : 'stretch', gap: spacing.md }}>
      <ReportCard style={tablet ? { flex: 1.35 } : undefined}>
        <CardHeading title={copy('ยอดขายรายวัน', 'Daily sales')} detail={copy('แตะแท่งเพื่อดูตัวเลขของวันนั้น', 'Tap a bar for that day')} />
        <SalesChart days={days} best={best} average={average} height={tablet ? 300 : 170} language={language} />
      </ReportCard>
      <ReportCard style={tablet ? { flex: 1 } : undefined}>
        <DayTable days={days} best={best} language={language} showAverage />
      </ReportCard>
    </View>
  );

  const menuTab = (
    <View style={{ flexDirection: tablet ? 'row' : 'column', alignItems: tablet ? 'flex-start' : 'stretch', gap: spacing.md }}>
      <View style={tablet ? { flex: 1 } : undefined}>
        <TopSellersCard
          items={topMenus?.items ?? []}
          monthLabel={monthLabel}
          shortMonthLabel={shortMonthLabel}
          onPrev={() => setTopMenuMonth((current) => shiftReportMonth(current, -1))}
          onNext={() => setTopMenuMonth((current) => shiftReportMonth(current, 1))}
          canPrev={canGoPreviousMonth}
          canNext={canGoNextMonth}
          loading={menusLoading}
          language={language}
        />
      </View>
      <View style={tablet ? { flex: 1 } : undefined}>
        <MenuProfitCard items={report?.menu_margins ?? []} periodLabel={copy(`${REPORT_DAYS} วัน`, `${REPORT_DAYS} days`)} language={language} />
      </View>
    </View>
  );

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดรายงาน', 'Loading reports')} style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {(tablet ? [0, 1, 2, 3, 4] : [0, 1, 2]).map((index) => <Bone key={index} height={tablet ? 78 : 66} radius={18} style={{ flex: 1 }} />)}
      </View>
      <Bone width={tablet ? 440 : '100%'} height={44} radius={999} />
      <View style={{ flexDirection: tablet ? 'row' : 'column', gap: spacing.md }}>
        <Bone height={tablet ? 380 : 240} radius={20} style={tablet ? { flex: 1.35 } : undefined} />
        <Bone height={tablet ? 380 : 300} radius={20} style={tablet ? { flex: 1 } : undefined} />
      </View>
    </SkeletonReveal>
  );

  return (
    <AppScreen
      title={copy('รายงานร้าน', 'Reports')}
      subtitle={periodLabel ? copy(`${REPORT_DAYS} วัน · ${periodLabel}`, `${REPORT_DAYS} days · ${periodLabel}`) : copy('ยอดขาย กำไร และสต๊อก', 'Sales, profit and stock')}
      topLevel={false}
      contentMaxWidth={tablet ? 1180 : undefined}
      contentStyle={{ gap: spacing.md }}
      refreshControl={<AppRefreshControl onRefresh={async () => { await Promise.all([loadReport(), loadMenus()]); }} />}
    >
      {error ? <Feedback title={copy('โหลดรายงานไม่ได้', 'Could not load reports')} detail={error} tone="danger" /> : null}
      {loading && !report ? skeleton : report ? (
        <>
          <ReportFigures figures={figures} tablet={tablet} />
          <ReportTabs tab={tab} onTab={setTab} stockCount={stock.out.length + stock.low.length} language={language} tablet={tablet} />
          {tab === 'sales' ? (
            days.some((day) => day.revenue > 0) ? salesTab : <EmptyState title={copy('ยังไม่มียอดขายในช่วงนี้', 'No sales in this period yet')} />
          ) : tab === 'menu' ? menuTab : (
            <StockRisksView out={stock.out} low={stock.low} language={language} columns={tablet} onOpenInventory={() => router.push('/inventory' as never)} />
          )}
          {tab !== 'stock' ? (
            <Text style={{ fontSize: 12, color: palette.placeholder, textAlign: 'center' }}>
              {copy('ยอดขายนับเฉพาะบิลที่ชำระแล้ว · วันนี้ยังไม่จบวัน', 'Sales count paid bills only · today is still open')}
            </Text>
          ) : null}
        </>
      ) : null}
    </AppScreen>
  );
}
