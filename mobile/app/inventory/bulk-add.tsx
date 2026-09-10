import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createIngredient, listIngredientCategories } from '@/src/api/ingredient';
import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChip, Dock, DockButton, FloatingHeader, FormField, FormGroup, FormPickRow, FormRow, SheetSection, SheetTitle, fmt, headerContentTop } from '@/src/components/inventory/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import { buildIngredientCreateInput, ingredientUnitOptions } from '@/src/lib/inventory-form';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { IngredientCategory } from '@/src/types/ingredient';

interface Draft {
  name: string;
  categoryId: string;
  unit: string;
  cost: string;
  stock: string;
  minStock: string;
  storageType: string;
}

interface Queued extends Draft {
  key: string;
}

const blank = (): Draft => ({ name: '', categoryId: 'none', unit: 'กก.', cost: '0', stock: '0', minStock: '0', storageType: 'room_temp' });

/**
 * Several ingredients in one visit, entered one at a time: the same form as
 * the single-ingredient screen, and under it the ones already filled in,
 * waiting. "เพิ่มวัตถุดิบ" moves the form into the queue and clears it;
 * the dock saves the queue in one go.
 */
export default function BulkAddIngredientsScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy: t, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canManage = can(activeMembership, 'manage_inventory');

  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [draft, setDraft] = useState<Draft>(blank());
  const [queue, setQueue] = useState<Queued[]>([]);
  const [picker, setPicker] = useState<'none' | 'category' | 'unit' | 'storage'>('none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (!canManage) return;
    listIngredientCategories()
      .then((response) => setCategories(response.categories || []))
      .catch((err) => setError(err instanceof Error ? err.message : t('โหลดหมวดไม่สำเร็จ', 'Could not load categories.')));
  }, [canManage, t]);

  const categoryOptions = useMemo(
    () => [{ label: t('ไม่มีหมวด', 'Uncategorised'), value: 'none' }, ...categories.filter((row) => row.is_active).map((row) => ({ label: row.name, value: String(row.ID) }))],
    [categories, t],
  );
  const unitOptions = useMemo(() => ingredientUnitOptions(draft.unit), [draft.unit]);
  const storageOptions = [
    { label: t('อุณหภูมิห้อง', 'Room temperature'), value: 'room_temp' },
    { label: t('แห้ง', 'Dry'), value: 'dry' },
    { label: t('แช่เย็น', 'Chilled'), value: 'chilled' },
    { label: t('แช่แข็ง', 'Frozen'), value: 'frozen' },
  ];
  const labelOf = (options: Array<{ label: string; value: string }>, value: string) => options.find((row) => row.value === value)?.label ?? options[0].label;
  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const draftReady = draft.name.trim().length > 0;

  // The form becomes a queued row; the form is fresh again, keeping the unit
  // and storage — the next ingredient off the same delivery is usually kept the
  // same way and counted in the same unit.
  const enqueue = () => {
    if (!draftReady) { setError(t('กรอกชื่อวัตถุดิบก่อน', 'Enter the ingredient name first.')); return; }
    setError(null);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setQueue((prev) => [...prev, { ...draft, name: draft.name.trim(), key: `${Date.now()}-${prev.length}` }]);
    setDraft({ ...blank(), unit: draft.unit, storageType: draft.storageType, categoryId: draft.categoryId });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const dequeue = (key: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setQueue((prev) => prev.filter((row) => row.key !== key));
  };

  // What the dock saves: the queue, plus the form if a name has been typed
  // into it — nobody should lose the one they were in the middle of.
  const pending = draftReady ? [...queue, { ...draft, key: 'draft' }] : queue;

  async function saveAll() {
    if (!canManage || saving || !pending.length) return;
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        pending.map((row) => createIngredient(buildIngredientCreateInput({
          name: row.name,
          sku: '',
          categoryId: row.categoryId,
          imageUrl: '',
          unit: row.unit,
          stock: row.stock,
          minStock: row.minStock,
          cost: row.cost,
          yieldPercent: '100',
          storageType: row.storageType,
        }))),
      );
      const failedRows = pending.filter((_, index) => results[index].status === 'rejected');
      if (failedRows.length) {
        // Only what failed stays on the screen, ready to try again.
        setQueue(failedRows.filter((row) => row.key !== 'draft'));
        if (!failedRows.some((row) => row.key === 'draft')) setDraft(blank());
        setError(t(`บันทึกได้ ${pending.length - failedRows.length} รายการ ล้มเหลว ${failedRows.length} รายการ — ที่เหลือคือรายการที่ยังไม่ได้บันทึก`, `Saved ${pending.length - failedRows.length}, ${failedRows.length} failed — what is left is what did not save.`));
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('บันทึกวัตถุดิบไม่สำเร็จ', 'Could not save ingredients.'));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <AppScreen title={t('เพิ่มหลายรายการ', 'Add several')} topLevel={false}>
        <EmptyState title={t('ไม่มีสิทธิ์เพิ่มวัตถุดิบ', 'Ingredient creation unavailable')} detail={t('บัญชีนี้ต้องมีสิทธิ์จัดการคลังวัตถุดิบ', 'This account needs permission to manage inventory.')} />
      </AppScreen>
    );
  }

  const dockBottom = Math.max(insets.bottom, 12) + 6 + 54 + 22;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <FloatingHeader centered title={t('เพิ่มหลายรายการ', 'Add several')} backLabel={t('ย้อนกลับ', 'Back')} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingTop: headerContentTop(insets.top, false), paddingHorizontal: 12, paddingBottom: dockBottom + 16 }}
        >
          {error ? <View style={{ marginBottom: 12 }}><Feedback title={t('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /></View> : null}

          <FormGroup>
            <FormRow label={t('ชื่อ', 'Name')} first>
              <FormField value={draft.name} onChangeText={(name) => set({ name })} placeholder={t('เช่น กะเพรา', 'e.g. Holy basil')} />
            </FormRow>
          </FormGroup>

          <FormGroup title={t('หมวดและหน่วย', 'Category and unit')}>
            <FormPickRow label={t('หมวด', 'Category')} value={labelOf(categoryOptions, draft.categoryId)} first onPress={() => setPicker('category')} />
            <FormPickRow label={t('หน่วยสต็อก', 'Stock unit')} value={draft.unit} onPress={() => setPicker('unit')} />
          </FormGroup>

          <FormGroup title={t('ต้นทุนและสต็อก', 'Cost and stock')}>
            <FormRow label={t('ต้นทุนต่อหน่วย', 'Cost per unit')} first>
              <FormField value={draft.cost} onChangeText={(cost) => set({ cost })} numeric prefix="฿" suffix={`/ ${draft.unit}`} />
            </FormRow>
            <FormRow label={t('สต็อกเริ่มต้น', 'Opening stock')}>
              <FormField value={draft.stock} onChangeText={(stock) => set({ stock })} numeric suffix={draft.unit} />
            </FormRow>
            <FormRow label={t('เตือนเมื่อต่ำกว่า', 'Warn below')}>
              <FormField value={draft.minStock} onChangeText={(minStock) => set({ minStock })} numeric suffix={draft.unit} />
            </FormRow>
          </FormGroup>

          <FormGroup title={t('การจัดเก็บ', 'Storage')}>
            <FormPickRow label={t('วิธีเก็บ', 'Kept')} value={labelOf(storageOptions, draft.storageType)} first onPress={() => setPicker('storage')} />
          </FormGroup>

          {/* Into the queue. Secondary, because the dock's save is the act
              that matters; this one only sets the next form up. */}
          <Pressable
            accessibilityRole="button"
            onPress={enqueue}
            style={({ pressed }) => ({ height: 50, borderRadius: 25, borderWidth: 1.5, borderColor: palette.primary, backgroundColor: pressed ? palette.surfaceStrong : palette.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 26, opacity: draftReady ? 1 : 0.55 })}
          >
            <AppIcon name="add" size={20} color={palette.primaryInk} />
            <Text style={{ fontSize: 15.5, fontWeight: '600', color: palette.primaryInk }}>{t('เพิ่มวัตถุดิบ', 'Add ingredient')}</Text>
          </Pressable>

          <FormGroup
            title={queue.length ? t(`รอบันทึก · ${queue.length} รายการ`, `Waiting to save · ${queue.length}`) : t('รอบันทึก', 'Waiting to save')}
            footer={queue.length ? undefined : t('กรอกด้านบนแล้วกด "เพิ่มวัตถุดิบ" รายการจะมาต่อแถวที่นี่ แล้วค่อยบันทึกทีเดียว', 'Fill the form and tap "Add ingredient"; it queues here, then everything saves at once.')}
          >
            {queue.length ? queue.map((row, index) => (
              <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingLeft: 16, paddingRight: 8, gap: 10, borderTopWidth: index ? 1 : 0, borderTopColor: palette.divider }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '600', color: palette.textStrong }}>{row.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted, marginTop: 1 }}>
                    {labelOf(categoryOptions, row.categoryId)} · {fmt(row.stock, locale)} {row.unit} · ฿{fmt(row.cost, locale)}/{row.unit}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t(`เอา ${row.name} ออก`, `Remove ${row.name}`)} onPress={() => dequeue(row.key)} hitSlop={8} style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                  <AppIcon name="close-circle" size={22} color={palette.placeholder} />
                </Pressable>
              </View>
            )) : (
              <View style={{ minHeight: 54, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, color: palette.placeholder }}>{t('ยังไม่มีรายการ', 'Nothing queued yet')}</Text>
              </View>
            )}
          </FormGroup>
        </ScrollView>
      </KeyboardAvoidingView>

      <Dock>
        <DockButton
          label={saving ? t('กำลังบันทึก…', 'Saving…') : pending.length ? t(`บันทึก ${pending.length} รายการ`, `Save ${pending.length}`) : t('บันทึก', 'Save')}
          onPress={saveAll}
          disabled={saving || !pending.length}
        />
      </Dock>

      <BottomSheet open={picker === 'category'} onClose={() => setPicker('none')} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('หมวด', 'Category')} />
        <SheetSection title={t('เลือกหนึ่งหมวด', 'Pick one')}>
          {categoryOptions.map((option) => (
            <ChoiceChip key={option.value} label={option.label} on={option.value === draft.categoryId} onPress={() => { set({ categoryId: option.value }); setPicker('none'); }} />
          ))}
        </SheetSection>
      </BottomSheet>
      <BottomSheet open={picker === 'unit'} onClose={() => setPicker('none')} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('หน่วยสต็อก', 'Stock unit')} />
        <SheetSection title={t('เลือกหนึ่งหน่วย', 'Pick one')}>
          {unitOptions.map((option) => (
            <ChoiceChip key={option} label={option} on={option === draft.unit} onPress={() => { set({ unit: option }); setPicker('none'); }} />
          ))}
        </SheetSection>
      </BottomSheet>
      <BottomSheet open={picker === 'storage'} onClose={() => setPicker('none')} heightFraction={0.4} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('การจัดเก็บ', 'Storage')} />
        <SheetSection title={t('เก็บแบบไหน', 'Kept how')}>
          {storageOptions.map((option) => (
            <ChoiceChip key={option.value} label={option.label} on={option.value === draft.storageType} onPress={() => { set({ storageType: option.value }); setPicker('none'); }} />
          ))}
        </SheetSection>
      </BottomSheet>
    </View>
  );
}
