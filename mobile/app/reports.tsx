import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { getManagerReportRange, getSalesByHour } from '@/src/api/report';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  CardHeading,
  Cell,
  HeadingChips,
  IconToggle,
  MarginInfoSheet,
  PeriodButton,
  PeriodSheet,
  ReportCard,
  ReportFigures,
  ReportTable,
  ReportTabs,
  SalesChart,
  ShareBar,
  type ReportFigure,
  type TableColumn,
  type TableRow,
} from '@/src/components/reports/parts';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { Feedback } from '@/src/components/ui';
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
  readableAmount,
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

// The reports screen, redrawn on 15 ก.ย. 2569 (design B): the figures on top,
// the rest behind three tabs. The same day the period became the owner's to
// choose (a preset, one day hour by hour, or any range up to 93 days), and then
// the page was locked: it no longer scrolls. The title, period, figures and
// tabs stay where they are, each tab gives its tables the rest of the screen,
// and a table scrolls its rows under a column header that stays put.

function bangkokHour(value = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).format(value)) % 24;
}

type MenuView = 'top' | 'profit';
type SalesView = 'chart' | 'table';
type StockFilter = 'all' | 'out' | 'low';

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
  const [menuView, setMenuView] = useState<MenuView>('top');
  const [salesView, setSalesView] = useState<SalesView>('chart');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
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

  if (!canView) {
    return (
      <AppScreen title={copy('รายงานร้าน', 'Reports')} topLevel={false} centerTitle>
        <Feedback title={copy('ไม่มีสิทธิ์ดูรายงาน', 'Report access unavailable')} detail={copy('หน้านี้ต้องใช้สิทธิ์ดูรายงานของร้าน', 'This page requires permission to view restaurant reports.')} tone="info" />
      </AppScreen>
    );
  }

  const summary = report?.summary;
  const discount = Number(summary?.discount ?? 0);
  const figures: ReportFigure[] = summary ? [
    {
      // One card since 15 ก.ย. 2569: "ยอดขาย" beside "รายได้รวม" showed the same
      // figure twice whenever no bill had a discount, which is every bill so far.
      // A discount, when there is one, is the line under the figure.
      key: 'gross',
      label: copy('รายได้รวม', 'Gross revenue'),
      value: money(summary.gross_revenue ?? summary.revenue, language),
      note: discount > 0
        ? copy(`ส่วนลด −${money(discount, language)} · รับจริง ${money(summary.revenue, language)}`, `Discounts −${money(discount, language)} · took ${money(summary.revenue, language)}`)
        : !singleDay && average > 0 ? copy(`เฉลี่ยวันละ ${money(average, language)}`, `${money(average, language)} a day`) : undefined,
      tone: 'hero',
    },
    {
      // Asked for on 15 ก.ย. 2569 in the place "ยอดขาย" left. Everything the
      // expense ledger holds for these days, restocks included.
      key: 'expenses',
      label: copy('รายจ่ายรวม', 'Total expenses'),
      value: money(summary.expenses ?? 0, language),
      note: copy(`${(summary.expense_count ?? 0).toLocaleString(locale)} รายการ`, `${(summary.expense_count ?? 0).toLocaleString(locale)} entries`),
      tone: 'bad',
    },
    { key: 'orders', label: copy('ออเดอร์', 'Orders'), value: summary.orders.toLocaleString(locale), note: summary.orders > 0 ? copy(`เฉลี่ยบิลละ ${money(summary.revenue / summary.orders, language)}`, `${money(summary.revenue / summary.orders, language)} a bill`) : undefined },
    { key: 'cost', label: copy('ต้นทุนวัตถุดิบ', 'Ingredient cost'), value: money(summary.cost, language) },
    { key: 'profit', label: copy('กำไรขั้นต้น', 'Gross profit'), value: money(summary.profit, language), note: copy('หักค่าวัตถุดิบแล้ว', 'After ingredients'), tone: summary.profit >= 0 ? 'good' : undefined },
    {
      // Gross profit less every expense that is not an ingredient purchase
      // (15 ก.ย. 2569). It is only as right as the expense ledger is complete.
      key: 'net',
      label: copy('กำไรสุทธิ', 'Net profit'),
      value: money(summary.net_profit ?? summary.profit, language),
      note: copy(`หักรายจ่ายอื่น ${money(summary.operating_expenses ?? 0, language)}`, `After other costs ${money(summary.operating_expenses ?? 0, language)}`),
      tone: (summary.net_profit ?? summary.profit) >= 0 ? 'good' : 'bad',
    },
    {
      key: 'margin',
      label: copy('มาร์จิน', 'Margin'),
      value: `${Number(summary.margin).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`,
      onInfo: () => setMarginInfoOpen(true),
      infoLabel: copy('มาร์จินคืออะไร', 'What is margin?'),
    },
  ] : [];

  // ---------------------------------------------------------------- sales

  const salesColumns: TableColumn[] = [
    { key: 'when', label: singleDay ? copy('เวลา', 'Hour') : copy('วันที่', 'Date'), flex: 1.2 },
    { key: 'orders', label: copy('ออเดอร์', 'Orders'), flex: 0.7, align: 'right' },
    { key: 'sales', label: copy('ยอดขาย', 'Sales'), flex: 1, align: 'right' },
    ...(tablet ? [{ key: 'bill', label: copy('เฉลี่ย/บิล', 'Per bill'), flex: 0.9, align: 'right' as const }] : []),
  ];
  const salesRows: TableRow[] = [...(singleDay ? bars.filter((bar) => bar.revenue > 0 || bar.open) : bars)].reverse().map((bar) => ({
    key: bar.key,
    highlight: bar.key === best?.key,
    cells: [
      <Cell key="when" strong={bar.key === best?.key} sub={bar.open ? (singleDay ? copy('ยังไม่จบชั่วโมง', 'still open') : copy('ยังไม่จบวัน', 'still open')) : undefined}>{bar.label}</Cell>,
      <Cell key="orders" align="right" muted>{bar.orders || '—'}</Cell>,
      <Cell key="sales" align="right" strong={bar.key === best?.key} color={bar.revenue > 0 ? undefined : palette.placeholder}>{bar.revenue > 0 ? money(bar.revenue, language) : copy('ไม่มีขาย', 'No sales')}</Cell>,
      ...(tablet ? [<Cell key="bill" align="right" muted>{bar.orders > 0 ? money(bar.revenue / bar.orders, language) : '—'}</Cell>] : []),
    ],
  }));

  // ---------------------------------------------------------------- menu

  const topItems = report?.top_menu_items ?? [];
  const mostSold = topItems[0]?.quantity || 1;
  const soldInList = topItems.reduce((sum, item) => sum + item.quantity, 0) || 1;
  const topColumns: TableColumn[] = [
    { key: 'rank', label: '#', width: 24 },
    { key: 'menu', label: copy('เมนู', 'Menu'), flex: 1 },
    { key: 'qty', label: copy('จาน', 'Sold'), width: 52, align: 'right' },
    { key: 'share', label: copy('สัดส่วน', 'Share'), width: 56, align: 'right' },
  ];
  const topRows: TableRow[] = topItems.map((item, index) => ({
    key: `${item.menu_id}-${item.menu_name}`,
    cells: [
      <Cell key="rank" muted color={index < 3 ? palette.primaryInk : undefined}>{index + 1}</Cell>,
      <View key="menu" style={{ alignSelf: 'stretch' }}>
        <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: palette.textStrong }}>{item.menu_name}</Text>
        <ShareBar value={item.quantity / mostSold} />
      </View>,
      <Cell key="qty" align="right" strong>{item.quantity.toLocaleString(locale)}</Cell>,
      <Cell key="share" align="right" muted>{`${Math.round((item.quantity / soldInList) * 100)}%`}</Cell>,
    ],
  }));
  const margins = report?.menu_margins ?? [];
  const percent = (value: number) => `${Number(value).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const profitColumns: TableColumn[] = tablet
    ? [
        { key: 'menu', label: copy('เมนู', 'Menu'), flex: 1.4 },
        { key: 'qty', label: copy('จาน', 'Sold'), flex: 0.5, align: 'right' },
        { key: 'revenue', label: copy('รายได้', 'Revenue'), flex: 0.9, align: 'right' },
        { key: 'cost', label: copy('ต้นทุน', 'Cost'), flex: 0.9, align: 'right' },
        { key: 'profit', label: copy('กำไร', 'Profit'), flex: 0.9, align: 'right' },
        { key: 'margin', label: copy('มาร์จิน', 'Margin'), flex: 0.7, align: 'right' },
      ]
    : [
        { key: 'menu', label: copy('เมนู', 'Menu'), flex: 1.5 },
        { key: 'qty', label: copy('จาน', 'Sold'), flex: 0.45, align: 'right' },
        { key: 'profit', label: copy('กำไร', 'Profit'), flex: 0.85, align: 'right' },
        { key: 'margin', label: copy('มาร์จิน', 'Margin'), flex: 0.6, align: 'right' },
      ];
  const profitRows: TableRow[] = margins.map((item) => ({
    key: String(item.menu_id),
    cells: tablet
      ? [
          <Cell key="menu" strong>{item.menu_name}</Cell>,
          <Cell key="qty" align="right" muted>{item.quantity.toLocaleString(locale)}</Cell>,
          <Cell key="revenue" align="right">{money(item.revenue, language)}</Cell>,
          <Cell key="cost" align="right" muted>{money(item.cost, language)}</Cell>,
          <Cell key="profit" align="right" strong color={item.profit < 0 ? palette.danger : undefined}>{money(item.profit, language)}</Cell>,
          <Cell key="margin" align="right" muted>{percent(item.margin)}</Cell>,
        ]
      : [
          <Cell key="menu" strong sub={copy(`รายได้ ${money(item.revenue, language)} · ต้นทุน ${money(item.cost, language)}`, `Revenue ${money(item.revenue, language)} · cost ${money(item.cost, language)}`)}>{item.menu_name}</Cell>,
          <Cell key="qty" align="right" muted>{item.quantity.toLocaleString(locale)}</Cell>,
          <Cell key="profit" align="right" strong color={item.profit < 0 ? palette.danger : undefined}>{money(item.profit, language)}</Cell>,
          <Cell key="margin" align="right" muted>{percent(item.margin)}</Cell>,
        ],
  }));
  const topTable = <ReportTable columns={topColumns} rows={topRows} empty={copy('ยังไม่มีเมนูขายในช่วงนี้', 'No menu sales in this period')} onRefresh={load} language={language} />;
  const profitTable = <ReportTable columns={profitColumns} rows={profitRows} empty={copy('ยังคำนวณกำไรไม่ได้ในช่วงนี้ · เมนูที่มีสูตรวัตถุดิบเท่านั้นที่คิดต้นทุนได้', 'No profit to show · only menus with recipes can be costed')} onRefresh={load} language={language} />;

  // ---------------------------------------------------------------- stock

  const stockList = stockFilter === 'out' ? stock.out : stockFilter === 'low' ? stock.low : [...stock.out, ...stock.low];
  const stockColumns: TableColumn[] = tablet
    ? [
        { key: 'name', label: copy('วัตถุดิบ', 'Ingredient'), flex: 1.2 },
        { key: 'category', label: copy('หมวด', 'Category'), flex: 1.3 },
        { key: 'stock', label: copy('คงเหลือ', 'In stock'), flex: 0.8, align: 'right' },
        { key: 'min', label: copy('ขั้นต่ำ', 'Minimum'), flex: 0.8, align: 'right' },
        { key: 'buy', label: copy('ควรเติม', 'To buy'), flex: 0.9, align: 'right' },
        { key: 'status', label: copy('สถานะ', 'Status'), flex: 0.7 },
      ]
    : [
        { key: 'name', label: copy('วัตถุดิบ', 'Ingredient'), flex: 1.25 },
        { key: 'stock', label: copy('คงเหลือ', 'In stock'), flex: 1, align: 'right' },
        { key: 'buy', label: copy('ควรเติม', 'To buy'), flex: 0.9, align: 'right' },
      ];
  const stockRows: TableRow[] = stockList.map((risk) => {
    const out = risk.status === 'out';
    const ink = out ? palette.danger : palette.warning;
    const amount = (value: number) => readableAmount(Number(value), risk.unit, language);
    const min = Number(risk.min_stock) > 0 ? amount(risk.min_stock) : '—';
    const category = risk.category || copy('ไม่มีหมวด', 'Uncategorized');
    const dot = <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: ink }} />;
    return {
      key: String(risk.id),
      cells: tablet
        ? [
            <View key="name" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{dot}<Cell strong>{risk.name}</Cell></View>,
            <Cell key="category" muted>{category}</Cell>,
            <Cell key="stock" align="right">{amount(risk.stock)}</Cell>,
            <Cell key="min" align="right" muted>{min}</Cell>,
            <Cell key="buy" align="right" strong>{amount(risk.restock_estimate)}</Cell>,
            <Cell key="status" color={ink} strong>{out ? copy('หมด', 'Out') : copy('ใกล้หมด', 'Low')}</Cell>,
          ]
        : [
            <View key="name" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>{dot}<Cell strong sub={category}>{risk.name}</Cell></View>,
            <Cell key="stock" align="right" sub={copy(`ขั้นต่ำ ${min}`, `min ${min}`)}>{amount(risk.stock)}</Cell>,
            <Cell key="buy" align="right" strong>{amount(risk.restock_estimate)}</Cell>,
          ],
    };
  });
  const stockChips = (
    <HeadingChips<StockFilter>
      options={[
        { key: 'all', label: copy(`ทั้งหมด ${stock.out.length + stock.low.length}`, `All ${stock.out.length + stock.low.length}`) },
        { key: 'out', label: copy(`หมด ${stock.out.length}`, `Out ${stock.out.length}`) },
        { key: 'low', label: copy(`ใกล้หมด ${stock.low.length}`, `Low ${stock.low.length}`) },
      ]}
      value={stockFilter}
      onChange={setStockFilter}
    />
  );

  // ---------------------------------------------------------------- layout

  const salesTitle = singleDay ? copy('ยอดขายรายชั่วโมง', 'Sales by hour') : copy('ยอดขายรายวัน', 'Daily sales');
  const salesFooter = [
    singleDay ? copy('รวมทั้งวัน', 'Whole day') : copy(`รวม ${bars.length} วัน`, `${bars.length} days`),
    summary ? summary.orders.toLocaleString(locale) : '',
    summary ? money(summary.revenue, language) : '',
    ...(tablet ? [summary && summary.orders > 0 ? money(summary.revenue / summary.orders, language) : '—'] : []),
  ];
  const salesTable = <ReportTable columns={salesColumns} rows={salesRows} footer={salesFooter} empty={copy('ยังไม่มียอดขายในช่วงนี้', 'No sales in this period')} onRefresh={load} language={language} />;

  const body = !report ? null : tab === 'sales' ? (
    tablet ? (
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md }}>
        <ReportCard style={{ flex: 1.35 }}>
          <CardHeading title={salesTitle} detail={copy('แตะแท่งเพื่อดูตัวเลข', 'Tap a bar for its figures')} />
          <SalesChart bars={bars} best={best} average={average} hourly={singleDay} language={language} />
        </ReportCard>
        <ReportCard style={{ flex: 1 }}>
          <CardHeading title={singleDay ? copy('รายชั่วโมง', 'By hour') : copy('รายวัน', 'By day')} detail={copy('ล่าสุดก่อน', 'Newest first')} />
          {salesTable}
        </ReportCard>
      </View>
    ) : (
      // Phone: one card, chart or table at its full height (design B, 15 ก.ย. 2569).
      <ReportCard style={{ flex: 1 }}>
        <CardHeading
          title={salesTitle}
          detail={salesView === 'chart' ? copy('แตะแท่งเพื่อดูตัวเลข', 'Tap a bar for its figures') : copy('ล่าสุดก่อน', 'Newest first')}
          trailing={(
            <IconToggle<SalesView>
              options={[
                { key: 'chart', icon: 'bar-chart-outline', label: copy('ดูเป็นกราฟ', 'Show chart') },
                { key: 'table', icon: 'list-outline', label: copy('ดูเป็นตาราง', 'Show table') },
              ]}
              value={salesView}
              onChange={setSalesView}
            />
          )}
        />
        {salesView === 'chart'
          ? <SalesChart bars={bars} best={best} average={average} hourly={singleDay} language={language} />
          : salesTable}
      </ReportCard>
    )
  ) : tab === 'menu' ? (
    tablet ? (
      <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md }}>
        <ReportCard style={{ flex: 0.85 }}>
          <CardHeading title={copy('เมนูขายดี', 'Top sellers')} detail={copy(`${rangeLabel} · สัดส่วนเทียบ ${topItems.length} อันดับ`, `${rangeLabel} · share of the top ${topItems.length}`)} />
          {topTable}
        </ReportCard>
        <ReportCard style={{ flex: 1.15 }}>
          <CardHeading title={copy('กำไรต่อเมนู', 'Menu profit')} detail={copy(`${rangeLabel} · เรียงจากกำไรสูงสุด`, `${rangeLabel} · highest profit first`)} />
          {profitTable}
        </ReportCard>
      </View>
    ) : (
      <ReportCard style={{ flex: 1 }}>
        <CardHeading
          title={menuView === 'top' ? copy('เมนูขายดี', 'Top sellers') : copy('กำไรต่อเมนู', 'Menu profit')}
          trailing={<HeadingChips<MenuView> options={[{ key: 'top', label: copy('ขายดี', 'Top') }, { key: 'profit', label: copy('กำไร', 'Profit') }]} value={menuView} onChange={setMenuView} />}
        />
        {menuView === 'top' ? topTable : profitTable}
      </ReportCard>
    )
  ) : (
    <ReportCard style={{ flex: 1 }}>
      <CardHeading
        title={copy('สต๊อกต้องดู', 'Stock to watch')}
        detail={copy('สต๊อกตอนนี้ ไม่ขึ้นกับช่วงเวลาที่เลือก', 'Stock right now, whatever the period')}
        trailing={tablet ? stockChips : undefined}
      />
      {tablet ? null : <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>{stockChips}</View>}
      <ReportTable columns={stockColumns} rows={stockRows} empty={copy('ไม่มีวัตถุดิบที่หมดหรือใกล้หมด', 'Nothing is out or running low')} onRefresh={load} language={language} />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/inventory' as never)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderTopWidth: 1, borderTopColor: palette.divider, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ fontSize: 13, fontWeight: '600', color: palette.primaryInk }}>{copy('ไปที่คลังวัตถุดิบ', 'Open inventory')}</Text>
        <AppIcon name="chevron-forward" size={14} color={palette.primaryInk} />
      </Pressable>
    </ReportCard>
  );

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดรายงาน', 'Loading reports')} style={{ flex: 1, gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(tablet ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2]).map((index) => <Bone key={index} height={tablet ? 70 : 60} radius={16} style={{ flex: 1 }} />)}
      </View>
      <Bone width={tablet ? 340 : '100%'} height={30} radius={999} />
      <View style={{ flex: 1, flexDirection: tablet ? 'row' : 'column', gap: spacing.md }}>
        <View style={{ flex: tablet ? 1.35 : 0.45 }}><Bone height={1} radius={18} style={{ flex: 1, height: undefined }} /></View>
        <View style={{ flex: 1 }}><Bone height={1} radius={18} style={{ flex: 1, height: undefined }} /></View>
      </View>
    </SkeletonReveal>
  );

  const tabs = <ReportTabs tab={tab} onTab={setTab} stockCount={stock.out.length + stock.low.length} language={language} tablet={tablet} />;
  const periodButton = <PeriodButton label={periodLabel} onPress={() => setPeriodOpen(true)} language={language} />;

  return (
    <AppScreen
      title={copy('รายงานร้าน', 'Reports')}
      topLevel={false}
      centerTitle
      scroll={false}
      contentMaxWidth={tablet ? 1180 : undefined}
      contentStyle={{ gap: spacing.sm }}
    >
      <View style={{ flex: 1, minHeight: 0, gap: spacing.md, paddingBottom: tablet ? spacing.lg : spacing.sm }}>
        {tablet ? null : periodButton}
        {error ? <Feedback title={copy('โหลดรายงานไม่ได้', 'Could not load reports')} detail={error} tone="danger" /> : null}
        {loading && !report ? skeleton : report ? (
          <View style={{ flex: 1, minHeight: 0, gap: spacing.md, opacity: loading ? 0.55 : 1 }}>
            <ReportFigures figures={figures} tablet={tablet} />
            {tablet ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                {tabs}
                <View style={{ flex: 1 }} />
                {periodButton}
              </View>
            ) : tabs}
            {body}
          </View>
        ) : null}
      </View>

      {summary ? (
        <MarginInfoSheet
          open={marginInfoOpen}
          onClose={() => setMarginInfoOpen(false)}
          revenue={summary.revenue}
          cost={summary.cost}
          profit={summary.profit}
          margin={summary.margin}
          language={language}
        />
      ) : null}
      <PeriodSheet open={periodOpen} onClose={() => setPeriodOpen(false)} range={range} today={today} onApply={setRange} language={language} />
    </AppScreen>
  );
}
