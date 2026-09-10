import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { listIngredientCategories, listIngredients } from '@/src/api/ingredient';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { ActionDock, Button, ChipGroup, EdgeRow, EdgeSection, EdgeSectionHeader, EmptyState, Feedback, SearchField, SectionHeader, StatusBadge, Surface } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';
import type { Ingredient, IngredientCategory } from '@/src/types/ingredient';

type StockStatus = 'all' | 'ok' | 'low' | 'out';
type SortKey = 'priority' | 'name' | 'category' | 'stock' | 'price';

function itemStatus(item: Ingredient): Exclude<StockStatus, 'all'> {
  if (Number(item.stock) <= 0) return 'out';
  if (Number(item.min_stock) > 0 && Number(item.stock) <= Number(item.min_stock)) return 'low';
  return 'ok';
}

// Riskiest first when no explicit sort is chosen: out -> low -> ok.
const statusRank: Record<Exclude<StockStatus, 'all'>, number> = { out: 0, low: 1, ok: 2 };

function SelectBox({ checked }: { checked: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: checked ? palette.primary : palette.controlBorder,
        backgroundColor: checked ? palette.primary : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? <AppIcon color={palette.primaryText} name="checkmark" size={14} /> : null}
    </View>
  );
}

export default function InventoryScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [category, setCategory] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StockStatus>('all');
  const [sortKey, setSortKey] = useState<SortKey>('priority');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canManage = can(activeMembership, 'manage_inventory');
  const canView = can(activeMembership, 'view_inventory') || canManage;

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ingredientResponse, categoryResponse] = await Promise.all([listIngredients(), listIngredientCategories()]);
      setIngredients(ingredientResponse.ingredients || []);
      setCategories(categoryResponse.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('โหลดคลังวัตถุดิบไม่สำเร็จ', 'Could not load inventory.'));
    } finally {
      setLoading(false);
    }
  }, [canView, copy]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // A new filter context is a new selection context — drop the selection so a
  // stale pick can never be bulk-deleted after the visible rows change.
  useEffect(() => { setSelectedIds(new Set()); }, [category, search, statusFilter]);

  const baseFiltered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return ingredients.filter((item) => {
      const categoryMatch = category === 'all' || String(item.category_id || 'none') === category;
      const searchMatch = !keyword || [item.name, item.sku, item.category?.name].some((value) => String(value || '').toLowerCase().includes(keyword));
      return categoryMatch && searchMatch;
    });
  }, [category, ingredients, search]);

  const statusCounts = useMemo(() => {
    let ok = 0;
    let low = 0;
    let out = 0;
    for (const item of baseFiltered) {
      const status = itemStatus(item);
      if (status === 'ok') ok += 1;
      else if (status === 'low') low += 1;
      else out += 1;
    }
    return { all: baseFiltered.length, ok, low, out };
  }, [baseFiltered]);

  const filtered = useMemo(() => {
    const list = statusFilter === 'all' ? baseFiltered : baseFiltered.filter((item) => itemStatus(item) === statusFilter);
    return [...list].sort((a, b) => {
      if (sortKey === 'priority') {
        const cmp = statusRank[itemStatus(a)] - statusRank[itemStatus(b)];
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      }
      let cmp = 0;
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortKey === 'category') cmp = String(a.category?.name || '').localeCompare(String(b.category?.name || ''));
      else if (sortKey === 'stock') cmp = Number(a.stock) - Number(b.stock);
      else if (sortKey === 'price') cmp = Number(a.cost_per_unit) - Number(b.cost_per_unit);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [baseFiltered, statusFilter, sortKey, sortDir]);

  const low = statusCounts.low;
  const out = statusCounts.out;
  const value = ingredients.reduce((sum, item) => sum + Number(item.stock) * Number(item.cost_per_unit), 0);
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  const allSelected = filtered.length > 0 && filtered.every((item) => selectedIds.has(item.ID));

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((item) => item.ID))));
  }

  function exitSelect() {
    setSelecting(false);
    setSelectedIds(new Set());
  }

  if (!canView) {
    return (
      <AppScreen title={copy('คลังวัตถุดิบ', 'Inventory')} topLevel={false}>
        <EmptyState title={copy('ไม่มีสิทธิ์ดูคลังวัตถุดิบ', 'Inventory access unavailable')} detail={copy('บัญชีนี้ต้องมีสิทธิ์ดูหรือจัดการคลังวัตถุดิบ', 'This account needs permission to view or manage inventory.')} />
      </AppScreen>
    );
  }

  const summaryPanel = (
    <Surface style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
      <View style={{ flexDirection: tabletWorkspace ? 'column' : 'row' }}>
        {[
          { label: copy('มูลค่าคงคลัง', 'Inventory value'), value: money(value, language) },
          { label: copy('ใกล้หมด', 'Low stock'), value: low.toLocaleString(locale) },
          { label: copy('หมด', 'Out of stock'), value: out.toLocaleString(locale) },
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

  const statusOptions: Array<{ label: string; value: StockStatus }> = [
    { label: copy(`ทั้งหมด ${statusCounts.all}`, `All ${statusCounts.all}`), value: 'all' },
    { label: copy(`ปกติ ${statusCounts.ok}`, `In stock ${statusCounts.ok}`), value: 'ok' },
    { label: copy(`ใกล้หมด ${statusCounts.low}`, `Low ${statusCounts.low}`), value: 'low' },
    { label: copy(`หมด ${statusCounts.out}`, `Out ${statusCounts.out}`), value: 'out' },
  ];

  const sortOptions: Array<{ label: string; value: SortKey }> = [
    { label: copy('ความเสี่ยง', 'Priority'), value: 'priority' },
    { label: copy('ชื่อ', 'Name'), value: 'name' },
    { label: copy('หมวด', 'Category'), value: 'category' },
    { label: copy('คงเหลือ', 'Stock'), value: 'stock' },
    { label: copy('ต้นทุน', 'Cost'), value: 'price' },
  ];

  const filterPanel = (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ minWidth: 0, flex: 1, justifyContent: 'center' }}>
          <SearchField
            accessibilityLabel={copy('ค้นหาชื่อหรือ SKU', 'Search by name or SKU')}
            clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
            value={search}
            onChangeText={setSearch}
            placeholder={copy('ค้นหาวัตถุดิบ', 'Search inventory')}
          />
        </View>
        {canManage ? (
          selecting ? (
            <Button compact icon="close-outline" variant="secondary" label={copy('เสร็จ', 'Done')} onPress={exitSelect} />
          ) : (
            <Button compact icon="checkmark-circle-outline" variant="secondary" label={copy('เลือก', 'Select')} onPress={() => setSelecting(true)} />
          )
        ) : null}
        {canManage && !selecting ? (
          <Button
            compact
            icon="duplicate-outline"
            variant="secondary"
            label={copy('หลายรายการ', 'Bulk')}
            onPress={() => router.push('/inventory/bulk-add' as never)}
          />
        ) : null}
        {canManage && !selecting ? (
          <Button
            compact
            icon="folder-open-outline"
            variant="secondary"
            label={copy('หมวด', 'Categories')}
            onPress={() => router.push('/inventory/categories' as never)}
          />
        ) : null}
      </View>
      <ChipGroup scrollable value={category} onChange={setCategory} options={[{ label: copy('ทั้งหมด', 'All'), value: 'all' }, ...categories.filter((item) => item.is_active).map((item) => ({ label: item.name, value: String(item.ID) }))]} />
      <ChipGroup scrollable value={statusFilter} onChange={setStatusFilter} options={statusOptions} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <ChipGroup scrollable value={sortKey} onChange={setSortKey} options={sortOptions} />
        </View>
        <Button
          compact
          variant="secondary"
          icon={sortDir === 'asc' ? 'arrow-up' : 'arrow-down'}
          label={sortDir === 'asc' ? copy('น้อย→มาก', 'Asc') : copy('มาก→น้อย', 'Desc')}
          disabled={sortKey === 'priority'}
          onPress={() => setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
        />
      </View>
    </View>
  );

  const ingredientRows = filtered.map((item) => {
    const tone = Number(item.stock) <= 0 ? 'danger' : Number(item.stock) <= Number(item.min_stock) ? 'warning' : 'success';
    const label = tone === 'danger' ? copy('หมด', 'Out') : tone === 'warning' ? copy('ใกล้หมด', 'Low') : copy('ปกติ', 'In stock');
    const detail = `${item.category?.name || copy('ไม่มีหมวด', 'Uncategorized')}${item.sku ? ` · ${item.sku}` : ''}`;
    const selected = selectedIds.has(item.ID);
    const onPress = selecting ? () => toggleSelect(item.ID) : () => router.push({ pathname: '/inventory/item' as never, params: { id: String(item.ID) } } as never);
    const trailing = (
      <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
        <Text selectable numberOfLines={1} style={typeScale.number}>{Number(item.stock).toLocaleString(locale)} {item.unit}</Text>
        <StatusBadge label={label} tone={tone} />
      </View>
    );

    if (!tabletWorkspace) {
      return (
        <EdgeRow
          accessibilityLabel={selecting ? copy(`เลือกวัตถุดิบ ${item.name}`, `Select ingredient ${item.name}`) : copy(`ดูวัตถุดิบ ${item.name}`, `View ingredient ${item.name}`)}
          detail={detail}
          icon={selecting ? undefined : 'cube-outline'}
          iconColor={palette.muted}
          leading={selecting ? <SelectBox checked={selected} /> : undefined}
          showChevron={!selecting}
          key={item.ID}
          onPress={onPress}
          style={selected ? { backgroundColor: palette.accentSoft } : undefined}
          title={item.name}
          trailing={trailing}
        />
      );
    }

    return (
      <Pressable
        accessibilityLabel={selecting ? copy(`เลือกวัตถุดิบ ${item.name}`, `Select ingredient ${item.name}`) : copy(`ดูวัตถุดิบ ${item.name}`, `View ingredient ${item.name}`)}
        accessibilityRole="button"
        key={item.ID}
        onPress={onPress}
        style={({ pressed }) => ({
          minHeight: 72,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          backgroundColor: selected ? palette.accentSoft : pressed ? palette.surfaceSubtle : palette.surface,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          opacity: pressed ? 0.78 : 1,
        })}
      >
        {selecting ? (
          <SelectBox checked={selected} />
        ) : (
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: palette.surfaceStrong }}>
            <AppIcon color={palette.muted} name="cube-outline" size={21} />
          </View>
        )}
        <View style={{ minWidth: 0, flex: 1, gap: spacing.xs }}>
          <Text selectable numberOfLines={1} style={typeScale.cardTitle}>{item.name}</Text>
          <Text selectable numberOfLines={1} style={[typeScale.caption, { color: palette.muted }]}>{detail}</Text>
        </View>
        {trailing}
      </Pressable>
    );
  });

  const selectionBar = selecting ? (
    <Surface style={{ padding: 0, overflow: 'hidden' }}>
      <ActionDock
        separated={false}
        label={copy('เลือกแล้ว', 'Selected')}
        value={selectedIds.size.toLocaleString(locale)}
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button compact variant="secondary" icon="checkmark-done-outline" label={allSelected ? copy('ไม่เลือก', 'None') : copy('เลือกทั้งหมด', 'All')} onPress={toggleSelectAll} disabled={!filtered.length} />
          </View>
        </View>
      </ActionDock>
    </Surface>
  ) : null;

  const emptyIngredients = !loading && !filtered.length ? (
    <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
      <EmptyState
        title={copy('ไม่พบวัตถุดิบ', 'No ingredients found')}
        detail={ingredients.length ? copy('ลองเปลี่ยนคำค้น สถานะ หรือหมวดวัตถุดิบ', 'Try changing the search term, status, or category.') : copy('เพิ่มวัตถุดิบรายการแรกเพื่อเริ่มติดตามสต็อก', 'Add your first ingredient to start tracking stock.')}
      />
    </View>
  ) : null;

  const ingredientList = tabletWorkspace ? (
    <Surface style={{ width: '100%', gap: 0, padding: 0, overflow: 'hidden' }}>
      <View style={{ padding: spacing.lg }}>
        <SectionHeader title={copy('รายการวัตถุดิบ', 'Ingredients')} detail={copy(`${filtered.length.toLocaleString('th-TH')} รายการ`, `${filtered.length.toLocaleString('en-US')} items`)} />
      </View>
      <View>{ingredientRows}</View>
      {emptyIngredients}
    </Surface>
  ) : (
    <View style={{ width: '100%', gap: spacing.sm }}>
      <EdgeSectionHeader title={copy('รายการวัตถุดิบ', 'Ingredients')} detail={copy(`${filtered.length.toLocaleString('th-TH')} รายการ`, `${filtered.length.toLocaleString('en-US')} items`)} />
      <EdgeSection>
        {ingredientRows}
        {emptyIngredients}
      </EdgeSection>
    </View>
  );

  return (
    <AppScreen
      title={copy('คลังวัตถุดิบ', 'Inventory')}
      subtitle={copy(`${ingredients.length.toLocaleString('th-TH')} รายการ · ${(low + out).toLocaleString('th-TH')} รายการต้องตรวจสอบ`, `${ingredients.length.toLocaleString('en-US')} items · ${(low + out).toLocaleString('en-US')} need attention`)}
      topLevel={false}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      action={canManage && !selecting ? <Button compact icon="add-outline" label={copy('เพิ่มวัตถุดิบ', 'Add ingredient')} onPress={() => router.push('/inventory/item' as never)} /> : undefined}
    >
      {error ? <Feedback title={copy('โหลดคลังไม่ได้', 'Could not load inventory')} detail={error} tone="danger" /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1.65 : undefined, gap: spacing.lg }}>
          {!tabletWorkspace ? summaryPanel : null}
          {!tabletWorkspace ? filterPanel : null}
          {selectionBar}
          {ingredientList}
        </View>
        {tabletWorkspace ? (
          <View style={{ minWidth: 0, flex: 0.9, gap: spacing.lg }}>
            {summaryPanel}
            {filterPanel}
          </View>
        ) : null}
      </View>
    </AppScreen>
  );
}
