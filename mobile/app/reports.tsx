import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { getManagerReportRange, getSalesByHour } from '@/src/api/report';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  BarTable,
  CardHeading,
  MarginInfoSheet,
  MenuProfitCard,
  PeriodButton,
  PeriodSheet,
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
  averagePerFinishedBar,
  bestBar,
  dayBars,
  hourBars,
  matchPreset,
  presetLabel,
  presetRange,
  rangeDayCount,
  reportRangeLabel,
  sortStockRisks,
  type ReportRange,
  type ReportTab,
} from '@/src/lib/report-view';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import type { ManagerReport, SalesByHourReport } from '@/src/types/report';

// The reports screen, redrawn on 15 ก.ย. 2569 (design B): the five figures on
// top, the rest behind three tabs — sales, menu, stock — so each fits a screen.
// The same day the period became the owner's to choose: a preset, one day (the
// chart then runs hour by hour), or any range up to 93 days, and every figure,
// the best sellers included, follows it. Stock is the shelf as it is now.

function bangkokHour(value = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(value)) % 24;
}

export default function ReportsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canView = can(activeMembership, 'view_reports');
  const tablet = width >= breakpoints.tabletWorkspace;

  const [today, setToday] = useState(() => formatBangkokDate());
  const [range, setRange] = useState<ReportRange>(() => presetRange('last14', formatBangkokDate()));
  const [periodOpen, setPeriodOpen] = useState(false);
  const [marginInfoOpen, setMarginInfoOpen] = useState(false);
  const [tab, setTab] = useState<ReportTab>('sales');
  const [report, setReport] = useState<ManagerReport | null>(null);
  const [hours, setHours] = useState<SalesByHourReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(createRequestGeneration());
  const singleDay = range.from === range.to;

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const generation = request.current.begin();
    setLoading(true);
    setError(null);
    const result = await loadFilteredReplacement(() => Promise.all([
      getManagerReportRange(range.from, range.to),
      singleDay ? getSalesByHour(range.from) : Promise.resolve(null),
    ]));
    if (!request.current.isCurrent(generation)) return;
    if (result.ok) {
      setReport(result.data[0]);
      setHours(result.data[1]);
      setToday(formatBangkokDate());
    } else {
      setError(result.error instanceof Error ? result.error.message : copy('โหลดรายงานไม่สำเร็จ', 'Could not load reports.'));
    }
    setLoading(false);
  }, [canView, copy, range.from, range.to, singleDay]);

  useEffect(() => {
    void load();
    const generation = request.current;
    return () => generation.invalidate();
  }, [load]);

  const bars = useMemo(() => {
    if (!report) return [];
    if (singleDay) return hourBars(hours?.hours ?? [], range.from, today, bangkokHour());
    return dayBars(report.sales_days, range, today, language);
  }, [hours, language, range, report, singleDay, today]);
  const best = useMemo(() => bestBar(bars), [bars]);
  const average = useMemo(() => averagePerFinishedBar(bars), [bars]);
  const stock = useMemo(() => sortStockRisks(report?.stock_risks ?? []), [report]);

  const preset = matchPreset(range, today);
  const rangeLabel = reportRangeLabel(range, language);
  const periodLabel = preset ? `${presetLabel(preset, language)} · ${rangeLabel}` : rangeLabel;
  const dayCount = rangeDayCount(range);

  if (!canView) {
    return (
      <AppScreen title={copy('รายงานร้าน', 'Reports')} topLevel={false} centerTitle>
        <Feedback title={copy('ไม่มีสิทธิ์ดูรายงาน', 'Report access unavailable')} detail={copy('หน้านี้ต้องใช้สิทธิ์ดูรายงานของร้าน', 'This page requires permission to view restaurant reports.')} tone="info" />
      </AppScreen>
    );
  }

  const discount = Number(report?.summary.discount ?? 0);
  const grossRevenue = Number(report?.summary.gross_revenue ?? report?.summary.revenue ?? 0);
  const figures: ReportFigure[] = report ? [
    {
      // "รายได้รวม" (15 ก.ย. 2569): the bills before their discounts. Sales,
      // next to it, is the same bills after them.
      key: 'gross',
      label: copy('รายได้รวม', 'Gross revenue'),
      value: money(grossRevenue, language),
      note: discount > 0 ? copy(`ส่วนลด −${money(discount, language)}`, `Discounts −${money(discount, language)}`) : copy('ก่อนหักส่วนลด', 'Before discounts'),
    },
    {
      key: 'revenue',
      label: copy('ยอดขาย', 'Sales'),
      value: money(report.summary.revenue, language),
      note: !singleDay && average > 0 ? copy(`เฉลี่ยวันละ ${money(average, language)}`, `${money(average, language)} a day`) : undefined,
      tone: 'hero',
    },
    { key: 'orders', label: copy('ออเดอร์', 'Orders'), value: report.summary.orders.toLocaleString(locale), note: report.summary.orders > 0 ? copy(`เฉลี่ยบิลละ ${money(report.summary.revenue / report.summary.orders, language)}`, `${money(report.summary.revenue / report.summary.orders, language)} a bill`) : undefined },
    { key: 'cost', label: copy('ต้นทุนวัตถุดิบ', 'Ingredient cost'), value: money(report.summary.cost, language) },
    { key: 'profit', label: copy('กำไรขั้นต้น', 'Gross profit'), value: money(report.summary.profit, language), tone: report.summary.profit >= 0 ? 'good' : undefined },
    {
      key: 'margin',
      label: copy('มาร์จิน', 'Margin'),
      value: `${Number(report.summary.margin).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
      onInfo: () => setMarginInfoOpen(true),
      infoLabel: copy('มาร์จินคืออะไร', 'What is margin?'),
    },
  ] : [];

  const salesTab = (
    <View style={{ flexDirection: tablet ? 'row' : 'column', alignItems: tablet ? 'flex-start' : 'stretch', gap: spacing.md }}>
      <ReportCard style={tablet ? { flex: 1.35 } : undefined}>
        <CardHeading
          title={singleDay ? copy('ยอดขายรายชั่วโมง', 'Sales by hour') : copy('ยอดขายรายวัน', 'Daily sales')}
          detail={copy('แตะแท่งเพื่อดูตัวเลข', 'Tap a bar for its figures')}
        />
        <SalesChart bars={bars} best={best} average={average} height={tablet ? 300 : 170} hourly={singleDay} language={language} />
      </ReportCard>
      <ReportCard style={tablet ? { flex: 1 } : undefined}>
        <BarTable bars={bars} best={best} hourly={singleDay} language={language} />
      </ReportCard>
    </View>
  );

  const menuTab = (
    <View style={{ flexDirection: tablet ? 'row' : 'column', alignItems: tablet ? 'flex-start' : 'stretch', gap: spacing.md }}>
      <View style={tablet ? { flex: 1 } : undefined}>
        <TopSellersCard items={report?.top_menu_items ?? []} periodLabel={rangeLabel} language={language} />
      </View>
      <View style={tablet ? { flex: 1 } : undefined}>
        <MenuProfitCard items={report?.menu_margins ?? []} periodLabel={rangeLabel} language={language} />
      </View>
    </View>
  );

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดรายงาน', 'Loading reports')} style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {(tablet ? [0, 1, 2, 3, 4, 5] : [0, 1, 2]).map((index) => <Bone key={index} height={tablet ? 78 : 66} radius={18} style={{ flex: 1 }} />)}
      </View>
      <Bone width={tablet ? 340 : '100%'} height={34} radius={999} />
      <View style={{ flexDirection: tablet ? 'row' : 'column', gap: spacing.md }}>
        <Bone height={tablet ? 380 : 240} radius={20} style={tablet ? { flex: 1.35 } : undefined} />
        <Bone height={tablet ? 380 : 300} radius={20} style={tablet ? { flex: 1 } : undefined} />
      </View>
    </SkeletonReveal>
  );

  return (
    <AppScreen
      title={copy('รายงานร้าน', 'Reports')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? 1180 : undefined}
      contentStyle={{ gap: spacing.md }}
      refreshControl={<AppRefreshControl onRefresh={load} />}
    >
      <PeriodButton label={periodLabel} onPress={() => setPeriodOpen(true)} language={language} />
      {error ? <Feedback title={copy('โหลดรายงานไม่ได้', 'Could not load reports')} detail={error} tone="danger" /> : null}
      {loading && !report ? skeleton : report ? (
        <View style={{ gap: spacing.md, opacity: loading ? 0.55 : 1 }}>
          <ReportFigures figures={figures} tablet={tablet} />
          <ReportTabs tab={tab} onTab={setTab} stockCount={stock.out.length + stock.low.length} language={language} tablet={tablet} />
          {tab === 'sales' ? (
            bars.some((bar) => bar.revenue > 0) ? salesTab : (
              <EmptyState
                title={singleDay ? (range.from === today ? copy('วันนี้ยังไม่มียอดขาย', 'No sales yet today') : copy('วันนั้นไม่มียอดขาย', 'No sales on this day')) : copy('ยังไม่มียอดขายในช่วงนี้', 'No sales in this period')}
                detail={copy('ลองเลือกช่วงเวลาอื่นจากปุ่มด้านบน', 'Try another period from the button above.')}
              />
            )
          ) : tab === 'menu' ? menuTab : (
            <StockRisksView out={stock.out} low={stock.low} language={language} columns={tablet} onOpenInventory={() => router.push('/inventory' as never)} />
          )}
          {tab !== 'stock' ? (
            <Text style={{ fontSize: 12, color: palette.placeholder, textAlign: 'center' }}>
              {copy(
                `ยอดขายนับเฉพาะบิลที่ชำระแล้ว · ${singleDay ? rangeLabel : `${dayCount} วัน`}${range.to === today ? ' · วันนี้ยังไม่จบวัน' : ''}`,
                `Sales count paid bills only · ${singleDay ? rangeLabel : `${dayCount} days`}${range.to === today ? ' · today is still open' : ''}`,
              )}
            </Text>
          ) : null}
        </View>
      ) : null}

      {report ? (
        <MarginInfoSheet
          open={marginInfoOpen}
          onClose={() => setMarginInfoOpen(false)}
          revenue={report.summary.revenue}
          cost={report.summary.cost}
          profit={report.summary.profit}
          margin={report.summary.margin}
          language={language}
        />
      ) : null}

      <PeriodSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        range={range}
        today={today}
        onApply={setRange}
        language={language}
      />
    </AppScreen>
  );
}
