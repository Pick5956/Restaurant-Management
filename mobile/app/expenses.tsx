import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { listExpenses } from '@/src/api/expense';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ExpenseBreakdown, ExpenseChips, ExpenseHero, ExpenseList } from '@/src/components/expenses/parts';
import { HeadingAction } from '@/src/components/heading-action';
import { CardHeading, PeriodButton, PeriodSheet, ReportCard } from '@/src/components/reports/parts';
import { Bone, ContentReveal, SkeletonReveal } from '@/src/components/skeleton';
import { EmptyState, Feedback } from '@/src/components/ui';
import { apiFailureDetail } from '@/src/lib/api-failure';
import { elapsedDays, expenseChipCategories, expenseShares, groupExpensesByDay } from '@/src/lib/expense-view';
import { money } from '@/src/lib/format';
import { formatBangkokDate } from '@/src/lib/order-query';
import { can } from '@/src/lib/rbac';
import { matchPreset, presetLabel, presetRange, reportRangeLabel, type ReportRange } from '@/src/lib/report-view';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import type { Expense, ExpenseCategory, ExpenseCategoryTotal, ExpenseDailyTotal } from '@/src/types/expense';

// The expenses screen, redrawn on 15 ก.ย. 2569 from the three-screens design.
// It had been a month stepper, two plain figures and a list whose every row
// began with its category's name. Now the page is locked like the reports
// screen: the period, one orange block with the total and each category's
// share, the category chips, and the entries grouped by day filling the rest.
// On a tablet the block and a per-category breakdown sit on the left and the
// list takes the right at full height.

type ExpenseData = {
  expenses: Expense[];
  categories: ExpenseCategoryTotal[];
  daily: ExpenseDailyTotal[];
  total: number;
  entries: number;
  hasMore: boolean;
};

export default function ExpensesScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const canEdit = can(activeMembership, 'manage_expenses');
  const canView = canEdit || can(activeMembership, 'view_reports');
  const tablet = width >= breakpoints.tabletWorkspace;

  const [today, setToday] = useState(() => formatBangkokDate());
  const [range, setRange] = useState<ReportRange>(() => presetRange('thisMonth', formatBangkokDate()));
  const [periodOpen, setPeriodOpen] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all');
  const [data, setData] = useState<ExpenseData | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed load: the panel's title names it, `detail` is the app's line under it when there is one.
  const [error, setError] = useState<{ detail?: string } | null>(null);
  const requestGenerationRef = useRef(createRequestGeneration());

  // The period and the category are both server-side filters, so changing one
  // can fire a request while the last is still out. The generation guard keeps
  // the slower answer from landing under the newer choice.
  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    const request = requestGenerationRef.current.begin();
    setLoading(true);
    setError(null);
    try {
      const response = await listExpenses({ from: range.from, until: range.to, category: category === 'all' ? undefined : category });
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setData({
        expenses: response.expenses || [],
        categories: response.categories || [],
        daily: response.daily || [],
        total: response.total || 0,
        entries: response.entries || 0,
        hasMore: Boolean(response.has_more),
      });
      setToday(formatBangkokDate());
    } catch (err) {
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setError({ detail: apiFailureDetail(err, language) });
    } finally {
      if (requestGenerationRef.current.isCurrent(request)) setLoading(false);
    }
  }, [canView, category, language, range.from, range.to]);

  // Reload on focus: coming back from adding or editing an entry.
  useFocusEffect(useCallback(() => {
    void load();
    const generation = requestGenerationRef.current;
    return () => generation.invalidate();
  }, [load]));

  const groups = useMemo(() => groupExpensesByDay(data?.expenses ?? [], data?.daily ?? []), [data]);
  const { total: periodTotal, entries: periodEntries, shares } = useMemo(() => expenseShares(data?.categories ?? []), [data]);
  const chipCategories = expenseChipCategories(shares, category);
  const counts = Object.fromEntries(shares.map((share) => [share.category, share.entries])) as Partial<Record<ExpenseCategory, number>>;
  const days = elapsedDays(range, today);
  const perDay = days > 1 ? periodTotal / days : 0;

  const preset = matchPreset(range, today);
  const rangeLabel = reportRangeLabel(range, language);
  const periodLabel = preset ? `${presetLabel(preset, language)} · ${rangeLabel}` : rangeLabel;

  if (!canView) {
    return (
      <AppScreen title={copy('ค่าใช้จ่าย', 'Expenses')} topLevel={false} centerTitle>
        <EmptyState title={copy('ไม่มีสิทธิ์ดูค่าใช้จ่าย', 'Expense access unavailable')} detail={copy('บัญชีนี้ต้องมีสิทธิ์จัดการค่าใช้จ่ายหรือดูรายงาน', 'This account needs permission to manage expenses or view reports.')} />
      </AppScreen>
    );
  }

  const addExpense = () => router.push('/expenses/item' as never);
  const openExpense = canEdit
    ? (item: Expense) => router.push({ pathname: '/expenses/item' as never, params: { id: String(item.ID), category: item.category, amount: String(item.amount), spent_at: item.spent_at, note: item.note ?? '', from_stock: item.ingredient_transaction_id ? '1' : '0' } } as never)
    : undefined;

  const empty = (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: spacing.xl }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
        <AppIcon name="receipt-outline" size={26} color={palette.primaryInk} />
      </View>
      <Text style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong, textAlign: 'center' }}>
        {category === 'all' ? copy('ยังไม่มีค่าใช้จ่ายในช่วงนี้', 'No expenses in this period') : copy('หมวดนี้ยังไม่มีรายการในช่วงนี้', 'Nothing in this category for this period')}
      </Text>
      {canEdit ? (
        <Pressable accessibilityRole="button" onPress={addExpense} hitSlop={6} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: palette.accentMuted, backgroundColor: palette.surface, opacity: pressed ? 0.7 : 1 })}>
          <AppIcon name="add" size={17} color={palette.primaryInk} />
          <Text style={{ fontSize: 13.5, fontWeight: '600', color: palette.primaryInk }}>{copy('เพิ่มค่าใช้จ่าย', 'Add expense')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const listedCount = data?.entries ?? 0;
  const listDetail = data?.hasMore
    ? copy(`แสดง ${data.expenses.length} จาก ${listedCount} รายการ · เลือกช่วงให้แคบลงเพื่อดูครบ`, `Showing ${data.expenses.length} of ${listedCount} · narrow the period to see all`)
    : copy(`${listedCount.toLocaleString('th-TH')} รายการ · ล่าสุดก่อน`, `${listedCount.toLocaleString('en-US')} entries · newest first`);
  const list = (
    <ExpenseList
      groups={groups}
      today={today}
      onOpen={openExpense}
      onRefresh={load}
      empty={empty}
      footer={tablet ? { label: category === 'all' ? copy(`รวม · ${listedCount} รายการ`, `Total · ${listedCount} entries`) : copy(`รวมหมวดนี้ · ${listedCount} รายการ`, `This category · ${listedCount} entries`), value: money(data?.total ?? 0, language) } : undefined}
      language={language}
    />
  );
  const hero = (
    <ExpenseHero
      label={copy(`รวม · ${preset ? presetLabel(preset, language) : rangeLabel}`, `Total · ${preset ? presetLabel(preset, language) : rangeLabel}`)}
      total={periodTotal}
      entries={periodEntries}
      perDay={perDay}
      shares={shares}
      language={language}
    />
  );
  const chips = <ExpenseChips categories={chipCategories} counts={counts} total={periodEntries} value={category} onChange={setCategory} language={language} />;
  const periodButton = <PeriodButton label={periodLabel} onPress={() => setPeriodOpen(true)} language={language} />;

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดค่าใช้จ่าย', 'Loading expenses')} style={{ flex: 1, gap: spacing.md }}>
      {tablet ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: spacing.md }}>
          <View style={{ width: 360, gap: spacing.md }}>
            <Bone height={132} radius={20} />
            <Bone height={260} radius={18} />
          </View>
          <View style={{ flex: 1 }}><Bone height={1} radius={18} style={{ flex: 1, height: undefined }} /></View>
        </View>
      ) : (
        <>
          <Bone height={120} radius={20} />
          <Bone width="70%" height={30} radius={999} />
          <View style={{ flex: 1 }}><Bone height={1} radius={18} style={{ flex: 1, height: undefined }} /></View>
        </>
      )}
    </SkeletonReveal>
  );

  const body = !data ? null : tablet ? (
    <View style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: spacing.md, opacity: loading ? 0.55 : 1 }}>
      <View style={{ width: 360, gap: spacing.md }}>
        {hero}
        {shares.length ? (
          <ReportCard style={{ flexShrink: 1 }}>
            <CardHeading title={copy('แยกตามหมวด', 'By category')} detail={copy('เทียบกับหมวดที่จ่ายมากสุด', 'Against the biggest category')} />
            <ExpenseBreakdown shares={shares} language={language} />
          </ReportCard>
        ) : null}
      </View>
      <ReportCard style={{ flex: 1 }}>
        <CardHeading title={copy('รายการค่าใช้จ่าย', 'Expense entries')} detail={listDetail} />
        {list}
      </ReportCard>
    </View>
  ) : (
    <View style={{ flex: 1, minHeight: 0, gap: spacing.md, opacity: loading ? 0.55 : 1 }}>
      {hero}
      {chips}
      {data.hasMore ? <Text style={{ fontSize: 12, color: palette.placeholder, textAlign: 'center' }}>{listDetail}</Text> : null}
      <ReportCard style={{ flex: 1 }}>{list}</ReportCard>
    </View>
  );

  return (
    <AppScreen
      title={copy('ค่าใช้จ่าย', 'Expenses')}
      topLevel={false}
      centerTitle
      scroll={false}
      contentMaxWidth={tablet ? 1180 : undefined}
      contentStyle={{ gap: spacing.sm }}
      action={canEdit && !tablet ? <HeadingAction compact icon="add" label={copy('เพิ่มค่าใช้จ่าย', 'Add expense')} onPress={addExpense} /> : undefined}
    >
      <View style={{ flex: 1, minHeight: 0, gap: spacing.md, paddingBottom: tablet ? spacing.lg : spacing.sm }}>
        {tablet ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {periodButton}
            <View style={{ flex: 1, minWidth: 0, alignItems: 'flex-end' }}>{data ? chips : null}</View>
            {canEdit ? <HeadingAction compact={false} icon="add" label={copy('เพิ่มค่าใช้จ่าย', 'Add expense')} onPress={addExpense} /> : null}
          </View>
        ) : periodButton}
        {error ? <Feedback title={copy('โหลดค่าใช้จ่ายไม่ได้', 'Could not load expenses')} detail={error.detail} tone="danger" /> : null}
        {loading && !data ? skeleton : body ? <ContentReveal style={{ flex: 1, minHeight: 0 }}>{body}</ContentReveal> : null}
      </View>
      <PeriodSheet open={periodOpen} onClose={() => setPeriodOpen(false)} range={range} today={today} onApply={setRange} language={language} />
    </AppScreen>
  );
}
