import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, LayoutAnimation, Platform, ScrollView, UIManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { adjustStock, deleteIngredient, listIngredientCategories, listIngredients } from '@/src/api/ingredient';
import { BottomSheet, GlassMorphMenu, SwipeRow } from '@/src/components/ai/chrome';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  ChoiceChip,
  CountSheet,
  Dock,
  DockButton,
  FloatingHeader,
  HEADER_PAD_TOP,
  HeaderTextButton,
  IngredientCard,
  KeyValue,
  RestockSheet,
  SearchCapsule,
  Segmented,
  SheetAction,
  SheetButton,
  SheetFooter,
  SheetSection,
  SheetTitle,
  SquareButton,
  Stepper,
  TotalsCard,
  fmt,
  headerContentTop,
} from '@/src/components/inventory/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import {
  countPayload,
  filterIngredients,
  inventoryTotals,
  restockStep,
  sortIngredients,
  suggestedRestock,
  type SortKey,
  type StatusFilter,
} from '@/src/lib/inventory-list';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { Ingredient, IngredientCategory } from '@/src/types/ingredient';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Sheet =
  | { kind: 'none' }
  | { kind: 'row'; item: Ingredient }
  | { kind: 'restock'; item: Ingredient }
  | { kind: 'count'; item: Ingredient }
  | { kind: 'filter' }
  | { kind: 'batch'; mode: 'restock' | 'count' };

/**
 * The inventory, laid out for a phone held in front of the fridge: what is
 * missing first, one tap to restock, the rest behind sheets. The header is
 * the chat screen's glass band with the status rail pinned inside it; cards,
 * rail and dock are Liquid Glass on iOS 26 and cream everywhere else.
 */
export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canManage = can(activeMembership, 'manage_inventory');
  const canView = can(activeMembership, 'view_inventory') || canManage;

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('urgent');
  // The filter sheet edits a draft and applies on "ดูผลลัพธ์", so the list
  // behind it does not jump while the person is still choosing.
  const [draft, setDraft] = useState({ category: 'all', sort: 'urgent' as SortKey });

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!canView) { setLoading(false); return; }
    if (!quiet) setLoading(true);
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

  useFocusEffect(useCallback(() => { void load(ingredients.length > 0); }, [load])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(timer);
  }, [notice]);

  // A new filter is a new selection context; a stale pick must never be batch-restocked.
  useEffect(() => { setSelected(new Set()); }, [search, status, category]);

  const scoped = useMemo(() => filterIngredients(ingredients, { search, category, status: 'all' }), [ingredients, search, category]);
  const counts = useMemo(() => inventoryTotals(scoped), [scoped]);
  const totals = useMemo(() => inventoryTotals(ingredients), [ingredients]);
  const visible = useMemo(() => sortIngredients(filterIngredients(scoped, { search: '', category: 'all', status }), sort), [scoped, status, sort]);
  const draftCount = useMemo(() => filterIngredients(ingredients, { search, category: draft.category, status }).length, [ingredients, search, draft.category, status]);
  const filtersActive = category !== 'all' || sort !== 'urgent';

  const t = copy;
  const close = () => setSheet({ kind: 'none' });

  const openSwipe = useRef<{ id: string; close: () => void } | null>(null);
  const onRowWillOpen = (id: string, closeRow: () => void) => {
    if (openSwipe.current && openSwipe.current.id !== id) openSwipe.current.close();
    openSwipe.current = { id, close: closeRow };
  };

  const patchItem = (next: Ingredient) => {
    setIngredients((prev) => prev.map((row) => (row.ID === next.ID ? { ...row, ...next } : row)));
  };

  const restock = async (item: Ingredient, quantity: number) => {
    if (busy || quantity <= 0) return;
    setBusy(true);
    try {
      const next = await adjustStock(item.ID, { type: 'in', quantity });
      patchItem(next);
      close();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(t(`เติม ${item.name} +${fmt(quantity, locale)} ${item.unit} แล้ว`, `Restocked ${item.name} +${fmt(quantity, locale)} ${item.unit}`));
    } catch (err) {
      Alert.alert(t('เติมสต็อกไม่สำเร็จ', 'Could not restock'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const count = async (item: Ingredient, payload: ReturnType<typeof countPayload>) => {
    if (busy) return;
    if (!payload) { close(); return; }
    setBusy(true);
    try {
      const next = await adjustStock(item.ID, payload);
      patchItem(next);
      close();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(t(`บันทึกยอด ${item.name} = ${fmt(next.stock, locale)} ${item.unit}`, `${item.name} set to ${fmt(next.stock, locale)} ${item.unit}`));
    } catch (err) {
      Alert.alert(t('ปรับยอดไม่สำเร็จ', 'Could not save the count'), err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (item: Ingredient) => {
    Alert.alert(
      t(`ลบ ${item.name}?`, `Delete ${item.name}?`),
      t('ประวัติสต็อกของรายการนี้จะหายไปด้วย', 'Its stock history goes with it.'),
      [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        {
          text: t('ลบ', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteIngredient(item.ID);
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setIngredients((prev) => prev.filter((row) => row.ID !== item.ID));
              setNotice(t(`ลบ ${item.name} แล้ว`, `Deleted ${item.name}`));
            } catch (err) {
              Alert.alert(t('ลบไม่สำเร็จ', 'Could not delete'), err instanceof Error ? err.message : undefined);
            }
          },
        },
      ],
    );
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = visible.length > 0 && visible.every((row) => selected.has(row.ID));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((row) => row.ID)));
  const leaveSelect = () => { setSelecting(false); setSelected(new Set()); };
  const selectedRows = visible.filter((row) => selected.has(row.ID));

  if (!canView) {
    return (
      <AppScreen title={t('คลังวัตถุดิบ', 'Inventory')} topLevel={false}>
        <EmptyState title={t('ไม่มีสิทธิ์ดูคลังวัตถุดิบ', 'Inventory access unavailable')} detail={t('บัญชีนี้ต้องมีสิทธิ์ดูหรือจัดการคลังวัตถุดิบ', 'This account needs permission to view or manage inventory.')} />
      </AppScreen>
    );
  }

  const rail = (
    <Segmented
      value={status}
      onChange={setStatus}
      options={[
        { value: 'all', label: t('ทั้งหมด', 'All'), count: counts.all },
        { value: 'low', label: t('ใกล้หมด', 'Low'), count: counts.low },
        { value: 'out', label: t('หมด', 'Out'), count: counts.out },
      ]}
    />
  );

  const dockBottom = Math.max(insets.bottom, 12) + 6 + 54 + 22;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      {selecting ? (
        <FloatingHeader
          centered
          backIcon="close"
          backLabel={t('ออกจากการเลือก', 'Leave selection')}
          onBack={leaveSelect}
          title={selected.size ? t(`เลือก ${selected.size} รายการ`, `${selected.size} selected`) : t('เลือกรายการ', 'Select items')}
          trailing={<HeaderTextButton label={allSelected ? t('ไม่เลือก', 'None') : t('เลือกทั้งหมด', 'All')} onPress={toggleAll} />}
          rail={rail}
        />
      ) : (
        <FloatingHeader
          centered
          backLabel={t('ย้อนกลับ', 'Back')}
          onBack={() => router.back()}
          title={t('คลังวัตถุดิบ', 'Inventory')}
          rail={rail}
        />
      )}
      {canManage && !selecting ? (
        <GlassMorphMenu
          open={menuOpen}
          onOpen={() => setMenuOpen(true)}
          onClose={() => setMenuOpen(false)}
          icon="ellipsis-horizontal"
          label={t('จัดการคลัง', 'Manage inventory')}
          // The header row leaves a 46pt slot at its right; this sits in it.
          style={{ top: insets.top + HEADER_PAD_TOP, right: 12 }}
          items={[
            { key: 'bulk', icon: 'duplicate-outline', label: t('เพิ่มหลายรายการ', 'Add several at once'), onPress: () => router.push('/inventory/bulk-add' as never) },
            { key: 'select', icon: 'checkmark-circle-outline', label: t('เลือกหลายรายการ', 'Select several'), onPress: () => setSelecting(true) },
            { key: 'categories', icon: 'folder-open-outline', label: t('จัดการหมวดหมู่', 'Manage categories'), onPress: () => router.push('/inventory/categories' as never) },
          ]}
        />
      ) : null}

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: headerContentTop(insets.top, true), paddingHorizontal: 12, paddingBottom: dockBottom + 12, gap: 10 }}
      >
        {!selecting ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SearchCapsule value={search} onChangeText={setSearch} placeholder={t('ค้นหาชื่อ, SKU หรือหมวด', 'Search name, SKU or category')} clearLabel={t('ล้างคำค้นหา', 'Clear search')} />
            <View>
              <SquareButton size={50} icon="options-outline" label={t('ตัวกรองและการเรียง', 'Filter and sort')} onPress={() => { setDraft({ category, sort }); setSheet({ kind: 'filter' }); }} />
              {filtersActive ? <View pointerEvents="none" style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primary }} /> : null}
            </View>
          </View>
        ) : null}

        {error ? <Feedback title={t('โหลดคลังไม่ได้', 'Could not load inventory')} detail={error} tone="danger" /> : null}
        {notice ? <Feedback title={notice} tone="success" /> : null}

        {!selecting && !search && status === 'all' ? <TotalsCard value={totals.value} needsOrder={totals.needsOrder} language={language} /> : null}

        {loading && !ingredients.length ? (
          <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={palette.primary} /></View>
        ) : null}

        {visible.map((item) => {
          const card = (
            <IngredientCard
              item={item}
              language={language}
              locale={locale}
              selecting={selecting}
              selected={selected.has(item.ID)}
              canManage={canManage}
              onPress={() => (selecting ? toggle(item.ID) : router.push({ pathname: '/inventory/detail' as never, params: { id: String(item.ID) } } as never))}
              onRestock={() => setSheet({ kind: 'restock', item })}
              onMore={() => setSheet({ kind: 'row', item })}
            />
          );
          if (!canManage || selecting) return <View key={item.ID}>{card}</View>;
          return (
            <SwipeRow key={item.ID} id={String(item.ID)} background={palette.canvas} deleteLabel={t(`ลบ ${item.name}`, `Delete ${item.name}`)} onDelete={() => confirmDelete(item)} onWillOpen={onRowWillOpen}>
              {card}
            </SwipeRow>
          );
        })}

        {!loading && !visible.length ? (
          <EmptyState
            title={t('ไม่พบวัตถุดิบ', 'No ingredients found')}
            detail={ingredients.length ? t('ลองเปลี่ยนคำค้น สถานะ หรือหมวด', 'Try another search, status or category.') : t('เพิ่มวัตถุดิบรายการแรกเพื่อเริ่มติดตามสต็อก', 'Add your first ingredient to start tracking stock.')}
          />
        ) : null}
      </ScrollView>

      {canManage ? (
        <Dock>
          {selecting ? (
            <>
              <DockButton secondary label={t('ปรับยอด', 'Set count')} onPress={() => setSheet({ kind: 'batch', mode: 'count' })} disabled={!selected.size} />
              <DockButton label={selected.size ? t(`เติมสต็อก ${selected.size} รายการ`, `Restock ${selected.size}`) : t('เติมสต็อก', 'Restock')} onPress={() => setSheet({ kind: 'batch', mode: 'restock' })} disabled={!selected.size} />
            </>
          ) : (
            <DockButton icon="add" label={t('เพิ่มวัตถุดิบ', 'Add ingredient')} onPress={() => router.push('/inventory/item' as never)} />
          )}
        </Dock>
      ) : null}

      {/* ---- row menu ---- */}
      <BottomSheet open={sheet.kind === 'row'} onClose={close} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
        {sheet.kind === 'row' ? (
          <>
            <SheetTitle title={sheet.item.name} subtitle={t(`คงเหลือ ${fmt(sheet.item.stock, locale)} ${sheet.item.unit}`, `${fmt(sheet.item.stock, locale)} ${sheet.item.unit} on hand`)} />
            <SheetAction icon="document-text-outline" label={t('ดูรายละเอียดและประวัติ', 'Details and history')} onPress={() => { close(); router.push({ pathname: '/inventory/detail' as never, params: { id: String(sheet.item.ID) } } as never); }} />
            <SheetAction icon="add-circle-outline" label={t('เติมสต็อก', 'Restock')} onPress={() => setSheet({ kind: 'restock', item: sheet.item })} />
            <SheetAction icon="calculator-outline" label={t('ปรับยอด (นับจริง)', 'Set counted quantity')} onPress={() => setSheet({ kind: 'count', item: sheet.item })} />
            <SheetAction icon="create-outline" label={t('แก้ไขข้อมูลวัตถุดิบ', 'Edit ingredient')} onPress={() => { close(); router.push({ pathname: '/inventory/item' as never, params: { id: String(sheet.item.ID) } } as never); }} />
            <SheetAction icon="trash-outline" label={t('ลบวัตถุดิบ', 'Delete ingredient')} danger divided onPress={() => { const item = sheet.item; close(); setTimeout(() => confirmDelete(item), 380); }} />
          </>
        ) : null}
      </BottomSheet>

      <RestockSheet
        item={sheet.kind === 'restock' ? sheet.item : null}
        open={sheet.kind === 'restock'}
        onClose={close}
        onSubmit={(quantity) => { if (sheet.kind === 'restock') void restock(sheet.item, quantity); }}
        busy={busy}
        language={language}
        locale={locale}
      />
      <CountSheet
        item={sheet.kind === 'count' ? sheet.item : null}
        open={sheet.kind === 'count'}
        onClose={close}
        onSubmit={(payload) => { if (sheet.kind === 'count') void count(sheet.item, payload); }}
        busy={busy}
        language={language}
        locale={locale}
      />

      {/* ---- filter ---- */}
      <BottomSheet open={sheet.kind === 'filter'} onClose={close} heightFraction={0.66} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('ตัวกรอง', 'Filter')} />
        <SheetSection title={t('หมวดหมู่', 'Category')}>
          <ChoiceChip label={t('ทุกหมวด', 'All categories')} on={draft.category === 'all'} onPress={() => setDraft((d) => ({ ...d, category: 'all' }))} />
          {categories.filter((row) => row.is_active).map((row) => (
            <ChoiceChip key={row.ID} label={row.name} on={draft.category === String(row.ID)} onPress={() => setDraft((d) => ({ ...d, category: String(row.ID) }))} />
          ))}
          <ChoiceChip label={t('ไม่มีหมวด', 'Uncategorised')} on={draft.category === 'none'} onPress={() => setDraft((d) => ({ ...d, category: 'none' }))} />
        </SheetSection>
        <SheetSection title={t('เรียงตาม', 'Sort by')}>
          {([
            ['urgent', t('ด่วนก่อน', 'Urgent first')],
            ['recent', t('ล่าสุด', 'Recently moved')],
            ['name', t('ชื่อ ก-ฮ', 'Name A–Z')],
            ['value', t('มูลค่าสูงสุด', 'Highest value')],
          ] as Array<[SortKey, string]>).map(([key, label]) => (
            <ChoiceChip key={key} label={label} on={draft.sort === key} onPress={() => setDraft((d) => ({ ...d, sort: key }))} />
          ))}
        </SheetSection>
        <SheetFooter>
          <SheetButton secondary label={t('ล้างตัวกรอง', 'Clear')} onPress={() => setDraft({ category: 'all', sort: 'urgent' })} />
          <SheetButton label={t(`ดูผลลัพธ์ · ${draftCount}`, `Show ${draftCount}`)} onPress={() => { setCategory(draft.category); setSort(draft.sort); close(); }} />
        </SheetFooter>
      </BottomSheet>

      <BatchSheet
        mode={sheet.kind === 'batch' ? sheet.mode : null}
        rows={selectedRows}
        onClose={close}
        language={language}
        locale={locale}
        onDone={(patched, failed) => {
          patched.forEach(patchItem);
          close();
          if (failed.length) {
            Alert.alert(t('บันทึกไม่ครบ', 'Some rows failed'), failed.join('\n'));
          } else {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setNotice(t(`บันทึก ${patched.length} รายการแล้ว`, `Saved ${patched.length} rows`));
            leaveSelect();
          }
        }}
      />
    </View>
  );
}

/**
 * One number per selected row, then one save. Nothing is sent until the
 * person has seen every figure, because a restock also books an expense.
 */
function BatchSheet({
  mode,
  rows,
  onClose,
  onDone,
  language,
  locale,
}: {
  mode: 'restock' | 'count' | null;
  rows: Ingredient[];
  onClose: () => void;
  onDone: (patched: Ingredient[], failed: string[]) => void;
  language: 'th' | 'en';
  locale: string;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [amounts, setAmounts] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const open = mode !== null;

  useEffect(() => {
    if (!open) return;
    const next: Record<number, number> = {};
    for (const row of rows) {
      next[row.ID] = mode === 'restock' ? (suggestedRestock(row) || restockStep(row)) : Number(row.stock);
    }
    setAmounts(next);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!mode || busy) return;
    setBusy(true);
    const patched: Ingredient[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      const amount = amounts[row.ID] ?? 0;
      const payload = mode === 'restock'
        ? (amount > 0 ? { type: 'in' as const, quantity: amount } : null)
        : countPayload(row, amount);
      if (!payload) continue;
      try {
        patched.push(await adjustStock(row.ID, payload));
      } catch (err) {
        failed.push(`${row.name}: ${err instanceof Error ? err.message : t('ไม่สำเร็จ', 'failed')}`);
      }
    }
    setBusy(false);
    onDone(patched, failed);
  };

  const cost = mode === 'restock' ? rows.reduce((sum, row) => sum + Number(row.cost_per_unit) * (amounts[row.ID] ?? 0), 0) : 0;

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.8} label={t('ปิด', 'Close')} showClose>
      <SheetTitle
        title={mode === 'count' ? t('ปรับยอดหลายรายการ', 'Set several counts') : t('เติมสต็อกหลายรายการ', 'Restock several')}
        subtitle={mode === 'count' ? t('ใส่ยอดที่นับได้จริงทีละรายการ', 'Enter what you counted, row by row') : t('ปรับจำนวนได้ทีละรายการก่อนบันทึก', 'Adjust each amount before saving')}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {rows.map((row) => (
          <View key={row.ID} style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingHorizontal: 16, gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{row.name}</Text>
              <Text style={{ fontSize: 12, color: palette.muted, fontVariant: ['tabular-nums'] }}>{t(`ตอนนี้ ${fmt(row.stock, locale)} ${row.unit}`, `now ${fmt(row.stock, locale)} ${row.unit}`)}</Text>
            </View>
            <Stepper value={amounts[row.ID] ?? 0} step={restockStep(row)} unit={row.unit} onChange={(value) => setAmounts((prev) => ({ ...prev, [row.ID]: value }))} />
          </View>
        ))}
        {cost > 0 ? <KeyValue label={t('จะบันทึกรายจ่ายรวม', 'Total expense recorded')} value={`฿${fmt(cost, locale, 0)}`} /> : null}
      </ScrollView>
      <SheetFooter>
        <SheetButton label={busy ? t('กำลังบันทึก…', 'Saving…') : t(`บันทึก ${rows.length} รายการ`, `Save ${rows.length} rows`)} onPress={submit} disabled={busy || !rows.length} />
      </SheetFooter>
    </BottomSheet>
  );
}
