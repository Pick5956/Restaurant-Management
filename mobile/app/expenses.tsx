import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { listExpenses } from '@/src/api/expense';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { Button, ChipGroup, EdgeRow, EdgeSection, EdgeSectionHeader, EmptyState, Feedback, SectionHeader, Surface } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { can } from '@/src/lib/rbac';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import { expenseCategories, type ExpenseCategory, type ExpenseCategoryTotal, type Expense } from '@/src/types/expense';

function categoryLabel(category: string, copy: (th: string, en: string) => string) {
  switch (category) {
    case 'ingredient': return copy('วัตถุดิบ', 'Ingredients');
    case 'labor': return copy('ค่าแรง', 'Labor');
    case 'rent': return copy('ค่าเช่า', 'Rent');
    case 'utilities': return copy('สาธารณูปโภค', 'Utilities');
    case 'equipment': return copy('อุปกรณ์', 'Equipment');
    default: return copy('อื่นๆ', 'Other');
  }
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ExpensesScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canEdit = can(activeMembership, 'manage_expenses');
  const canView = canEdit || can(activeMembership, 'view_reports');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;

  const [monthOffset, setMonthOffset] = useState(0);
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all');
  const requestGenerationRef = useRef(createRequestGeneration());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totals, setTotals] = useState<ExpenseCategoryTotal[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [entries, setEntries] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  }, [monthOffset]);
  const monthLabel = monthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const range = useMemo(() => ({
    from: iso(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)),
    until: iso(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1)),
  }), [monthDate]);

  // The month and the category are both server-side filters, so changing either
  // fires a new request while the previous one may still be in flight. Without a
  // generation guard the slower answer wins whichever order they were asked in,
  // and the screen shows one month's expenses under another month's heading.
  const load = useCallback(async () => {
    if (!canView) { setLoading(false); return; }
    const request = requestGenerationRef.current.begin();
    setLoading(true);
    setError(null);
    try {
      const response = await listExpenses({ from: range.from, until: range.until, category: category === 'all' ? undefined : category });
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setExpenses(response.expenses || []);
      setTotals(response.categories || []);
      setGrandTotal(response.total || 0);
      setEntries(response.entries || 0);
      setHasMore(Boolean(response.has_more));
    } catch (err) {
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setError(err instanceof Error ? err.message : copy('โหลดค่าใช้จ่ายไม่สำเร็จ', 'Could not load expenses.'));
    } finally {
      if (requestGenerationRef.current.isCurrent(request)) setLoading(false);
    }
  }, [canView, category, copy, range.from, range.until]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      requestGenerationRef.current.invalidate();
    };
  }, [load]));

  if (!canView) {
    return (
      <AppScreen title={copy('ค่าใช้จ่าย', 'Expenses')} topLevel={false}>
        <EmptyState title={copy('ไม่มีสิทธิ์ดูค่าใช้จ่าย', 'Expense access unavailable')} detail={copy('บัญชีนี้ต้องมีสิทธิ์จัดการค่าใช้จ่ายหรือดูรายงาน', 'This account needs permission to manage expenses or view reports.')} />
      </AppScreen>
    );
  }

  const categoryOptions: Array<{ label: string; value: ExpenseCategory | 'all' }> = [
    { label: copy('ทั้งหมด', 'All'), value: 'all' },
    ...expenseCategories.map((value) => ({ label: categoryLabel(value, copy), value })),
  ];

  const summaryPanel = (
    <Surface style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
      <View style={{ flexDirection: tabletWorkspace ? 'column' : 'row' }}>
        {[
          { label: copy('รวมเดือนนี้', 'Month total'), value: money(grandTotal, language) },
          { label: copy('จำนวนรายการ', 'Entries'), value: entries.toLocaleString(locale) },
        ].map((stat, index) => (
          <View
            key={stat.label}
            style={{
              minWidth: 0,
              flex: 1,
              gap: 3,
              borderLeftWidth: !tabletWorkspace && index ? 1 : 0,
              borderTopWidth: tabletWorkspace && index ? 1 : 0,
              borderColor: palette.border,
              padding: spacing.md,
            }}
          >
            <Text adjustsFontSizeToFit minimumFontScale={0.76} numberOfLines={1} selectable style={typeScale.number}>{stat.value}</Text>
            <Text selectable numberOfLines={2} style={[typeScale.caption, { color: palette.muted }]}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </Surface>
  );

  const monthBar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Button compact variant="secondary" icon="chevron-back" label={copy('ก่อนหน้า', 'Prev')} onPress={() => setMonthOffset((prev) => prev - 1)} />
      <View style={{ minWidth: 0, flex: 1, alignItems: 'center' }}>
        <Text numberOfLines={1} style={typeScale.cardTitle}>{monthLabel}</Text>
      </View>
      <Button compact variant="secondary" icon="chevron-forward" label={copy('ถัดไป', 'Next')} disabled={monthOffset >= 0} onPress={() => setMonthOffset((prev) => Math.min(0, prev + 1))} />
    </View>
  );

  const totalsPanel = totals.length ? (
    <Surface>
      <SectionHeader title={copy('แยกตามหมวด', 'By category')} detail={monthLabel} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {totals.map((total) => (
          <View
            key={total.category}
            style={{
              minWidth: 0,
              flexGrow: 1,
              flexBasis: tabletWorkspace ? '31%' : '47%',
              gap: 2,
              borderWidth: 1,
              borderColor: palette.border,
              borderRadius: 12,
              backgroundColor: palette.surfaceSubtle,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
            }}
          >
            <Text numberOfLines={1} style={[typeScale.caption, { color: palette.muted }]}>{categoryLabel(total.category, copy)}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={typeScale.number}>{money(total.amount, language)}</Text>
            <Text numberOfLines={1} style={[typeScale.caption, { color: palette.muted }]}>{copy(`${total.entries.toLocaleString('th-TH')} รายการ`, `${total.entries.toLocaleString('en-US')} entries`)}</Text>
          </View>
        ))}
      </View>
    </Surface>
  ) : null;

  const rows = expenses.map((item) => {
    const dateLabel = item.spent_at ? new Date(item.spent_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) : '—';
    const detail = `${dateLabel} · ${item.note?.trim() || copy('ไม่มีหมายเหตุ', 'No note')}`;
    const auto = item.ingredient_transaction_id ? copy(' · จากสต็อก', ' · from stock') : '';
    return (
      <EdgeRow
        key={item.ID}
        icon="cash-outline"
        iconColor={palette.muted}
        title={`${categoryLabel(item.category, copy)}${auto}`}
        detail={detail}
        onPress={canEdit ? () => router.push({ pathname: '/expenses/item' as never, params: { id: String(item.ID), category: item.category, amount: String(item.amount), spent_at: item.spent_at, note: item.note ?? '' } } as never) : undefined}
        showChevron={canEdit}
        trailing={<Text selectable numberOfLines={1} style={typeScale.number}>{money(item.amount, language)}</Text>}
      />
    );
  });

  const emptyRows = !loading && !expenses.length ? (
    <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
      <EmptyState
        title={copy('ยังไม่มีค่าใช้จ่ายเดือนนี้', 'No expenses this month')}
        detail={canEdit ? copy('เพิ่มรายการค่าใช้จ่ายรายการแรก', 'Add the first expense entry.') : copy('ยังไม่มีข้อมูลในช่วงที่เลือก', 'Nothing recorded for this period yet.')}
      />
    </View>
  ) : null;

  const listPanel = (
    <View style={{ width: '100%', gap: spacing.sm }}>
      <EdgeSectionHeader
        title={copy('รายการค่าใช้จ่าย', 'Expense entries')}
        detail={hasMore ? copy('แสดงบางส่วน — แคบช่วงเวลาเพื่อดูครบ', 'Showing a subset — narrow the range to see all.') : copy(`${expenses.length.toLocaleString('th-TH')} รายการ`, `${expenses.length.toLocaleString('en-US')} entries`)}
      />
      <EdgeSection>
        {rows}
        {emptyRows}
      </EdgeSection>
    </View>
  );

  return (
    <AppScreen
      title={copy('ค่าใช้จ่าย', 'Expenses')}
      subtitle={copy('บันทึกและติดตามค่าใช้จ่ายของร้าน', 'Record and track restaurant spending.')}
      topLevel={false}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      action={canEdit ? <Button compact icon="add-outline" label={copy('เพิ่มค่าใช้จ่าย', 'Add expense')} onPress={() => router.push('/expenses/item' as never)} /> : undefined}
    >
      {error ? <Feedback title={copy('โหลดค่าใช้จ่ายไม่ได้', 'Could not load expenses')} detail={error} tone="danger" /> : null}
      <View style={{ gap: spacing.lg }}>
        {monthBar}
        <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
          <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1.6 : undefined, gap: spacing.lg }}>
            {!tabletWorkspace ? summaryPanel : null}
            <ChipGroup scrollable value={category} onChange={setCategory} options={categoryOptions} />
            {listPanel}
          </View>
          <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 0.95 : undefined, gap: spacing.lg }}>
            {tabletWorkspace ? summaryPanel : null}
            {totalsPanel}
          </View>
        </View>
      </View>
    </AppScreen>
  );
}
