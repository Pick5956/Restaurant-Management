import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createIngredient, listIngredientCategories } from '@/src/api/ingredient';
import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChip, Dock, DockButton, FloatingHeader, FormField, FormGroup, FormPickRow, FormRow, HeaderTextButton, SheetSection, SheetTitle, fmt, headerContentTop } from '@/src/components/inventory/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import { buildIngredientCreateInput, ingredientUnitOptions } from '@/src/lib/inventory-form';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { IngredientCategory } from '@/src/types/ingredient';

interface Row {
  key: string;
  name: string;
  categoryId: string;
  unit: string;
  cost: string;
  stock: string;
  minStock: string;
  storageType: string;
}

/**
 * Several ingredients in one visit. The screen is a list of the ones drafted
 * so far — empty, it is one button in the middle of the page — and tapping
 * "เพิ่มวัตถุดิบ" makes a new one and opens it; tapping a row opens that one.
 * The form is the single-ingredient form. The dock saves every row at once.
 */
export default function BulkAddIngredientsScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy: t, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canManage = can(activeMembership, 'manage_inventory');

  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  // The row open in the form, or none: the list.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<'none' | 'category' | 'unit' | 'storage'>('none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const storageOptions = [
    { label: t('อุณหภูมิห้อง', 'Room temperature'), value: 'room_temp' },
    { label: t('แห้ง', 'Dry'), value: 'dry' },
    { label: t('แช่เย็น', 'Chilled'), value: 'chilled' },
    { label: t('แช่แข็ง', 'Frozen'), value: 'frozen' },
  ];
  const labelOf = (options: Array<{ label: string; value: string }>, value: string) => options.find((row) => row.value === value)?.label ?? options[0].label;

  const open = openKey ? rows.find((row) => row.key === openKey) ?? null : null;
  const unitOptions = useMemo(() => ingredientUnitOptions(open?.unit ?? 'กิโลกรัม'), [open?.unit]);
  const set = (patch: Partial<Row>) => {
    if (!openKey) return;
    setRows((prev) => prev.map((row) => (row.key === openKey ? { ...row, ...patch } : row)));
  };

  // A new row starts the way the last one was kept and counted — the next
  // ingredient off the same delivery usually is — and opens at once.
  const add = () => {
    const last = rows[rows.length - 1];
    const row: Row = {
      key: `${Date.now()}-${rows.length}`,
      name: '',
      categoryId: last?.categoryId ?? 'none',
      unit: last?.unit ?? 'กิโลกรัม',
      cost: '0',
      stock: '0',
      minStock: '0',
      storageType: last?.storageType ?? 'room_temp',
    };
    setRows((prev) => [...prev, row]);
    setOpenKey(row.key);
    setError(null);
  };

  // Back to the list. A row left without a name was never an ingredient, so
  // it goes rather than sitting in the list as a blank line.
  const closeForm = () => {
    Keyboard.dismiss();
    setPicker('none');
    setRows((prev) => prev.map((row) => ({ ...row, name: row.name.trim() })).filter((row) => row.name.length > 0));
    setOpenKey(null);
  };

  // Everything back to blank. To drop the row, clear it and go back: a row
  // with no name does not survive the trip to the list.
  const clearForm = () => {
    Keyboard.dismiss();
    set({ name: '', categoryId: 'none', unit: 'กิโลกรัม', cost: '0', stock: '0', minStock: '0', storageType: 'room_temp' });
  };

  async function saveAll() {
    const ready = rows.filter((row) => row.name.trim());
    if (!canManage || saving || !ready.length) return;
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        ready.map((row) => createIngredient(buildIngredientCreateInput({
          name: row.name.trim(),
          sku: '',
          categoryId: row.categoryId,
          imageUrl: '',
          unit: row.unit,
          stock: row.stock,
          minStock: row.minStock,
          // A shelf with no history has no maximum to take a share of, so a new
          // ingredient is always given a quantity here.
          minPercent: '0',
          cost: row.cost,
          yieldPercent: '100',
          storageType: row.storageType,
        }))),
      );
      const failed = ready.filter((_, index) => results[index].status === 'rejected');
      if (failed.length) {
        // Only what failed stays, ready to try again — nothing to retype.
        setRows(failed);
        setError(t(`บันทึกได้ ${ready.length - failed.length} รายการ ล้มเหลว ${failed.length} รายการ — ที่เหลือคือรายการที่ยังไม่ได้บันทึก`, `Saved ${ready.length - failed.length}, ${failed.length} failed — what is left is what did not save.`));
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
  const contentTop = headerContentTop(insets.top, false);
  const addButton = (
    <Pressable
      accessibilityRole="button"
      onPress={add}
      style={({ pressed }) => ({ height: 54, paddingHorizontal: 26, borderRadius: 27, backgroundColor: palette.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: pressed ? 0.88 : 1, shadowColor: palette.primary, shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 })}
    >
      <AppIcon name="add" size={22} color="#ffffff" />
      <Text style={{ fontSize: 16, fontWeight: '600', color: '#ffffff' }}>{t('เพิ่มวัตถุดิบ', 'Add ingredient')}</Text>
    </Pressable>
  );

  // ---------------------------------------------------------------- the form
  if (open) {
    const index = rows.findIndex((row) => row.key === open.key) + 1;
    return (
      <View style={{ flex: 1, backgroundColor: palette.canvas }}>
        <FloatingHeader
          centered
          title={open.name.trim() || t(`รายการที่ ${index}`, `Item ${index}`)}
          backLabel={t('กลับไปรายการ', 'Back to the list')}
          onBack={closeForm}
          trailing={<HeaderTextButton label={t('ล้าง', 'Clear')} onPress={clearForm} />}
        />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingTop: contentTop, paddingHorizontal: 12, paddingBottom: dockBottom + 16 }}>
            <FormGroup>
              <FormRow label={t('ชื่อ', 'Name')} first>
                <FormField value={open.name} onChangeText={(name) => set({ name })} placeholder={t('เช่น กะเพรา', 'e.g. Holy basil')} />
              </FormRow>
            </FormGroup>
            <FormGroup title={t('หมวดและหน่วย', 'Category and unit')}>
              <FormPickRow label={t('หมวด', 'Category')} value={labelOf(categoryOptions, open.categoryId)} first onPress={() => setPicker('category')} />
              <FormPickRow label={t('หน่วยสต็อก', 'Stock unit')} value={open.unit} onPress={() => setPicker('unit')} />
            </FormGroup>
            <FormGroup title={t('ต้นทุนและสต็อก', 'Cost and stock')}>
              <FormRow label={t('ต้นทุนต่อหน่วย', 'Cost per unit')} first>
                <FormField value={open.cost} onChangeText={(cost) => set({ cost })} numeric prefix="฿" suffix={`/ ${open.unit}`} />
              </FormRow>
              <FormRow label={t('สต็อกเริ่มต้น', 'Opening stock')}>
                <FormField value={open.stock} onChangeText={(stock) => set({ stock })} numeric suffix={open.unit} />
              </FormRow>
              <FormRow label={t('เตือนเมื่อต่ำกว่า', 'Warn below')}>
                <FormField value={open.minStock} onChangeText={(minStock) => set({ minStock })} numeric suffix={open.unit} />
              </FormRow>
            </FormGroup>
            <FormGroup title={t('การจัดเก็บ', 'Storage')}>
              <FormPickRow label={t('วิธีเก็บ', 'Kept')} value={labelOf(storageOptions, open.storageType)} first onPress={() => setPicker('storage')} />
            </FormGroup>
          </ScrollView>
        </KeyboardAvoidingView>
        <Dock>
          <DockButton icon="checkmark" label={t('เสร็จ', 'Done')} onPress={closeForm} />
        </Dock>

        <BottomSheet open={picker === 'category'} onClose={() => setPicker('none')} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
          <SheetTitle title={t('หมวด', 'Category')} />
          <SheetSection title={t('เลือกหนึ่งหมวด', 'Pick one')}>
            {categoryOptions.map((option) => (
              <ChoiceChip key={option.value} label={option.label} on={option.value === open.categoryId} onPress={() => { set({ categoryId: option.value }); setPicker('none'); }} />
            ))}
          </SheetSection>
        </BottomSheet>
        <BottomSheet open={picker === 'unit'} onClose={() => setPicker('none')} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
          <SheetTitle title={t('หน่วยสต็อก', 'Stock unit')} />
          <SheetSection title={t('เลือกหนึ่งหน่วย', 'Pick one')}>
            {unitOptions.map((option) => (
              <ChoiceChip key={option} label={option} on={option === open.unit} onPress={() => { set({ unit: option }); setPicker('none'); }} />
            ))}
          </SheetSection>
        </BottomSheet>
        <BottomSheet open={picker === 'storage'} onClose={() => setPicker('none')} heightFraction={0.4} label={t('ปิด', 'Close')} showClose>
          <SheetTitle title={t('การจัดเก็บ', 'Storage')} />
          <SheetSection title={t('เก็บแบบไหน', 'Kept how')}>
            {storageOptions.map((option) => (
              <ChoiceChip key={option.value} label={option.label} on={option.value === open.storageType} onPress={() => { set({ storageType: option.value }); setPicker('none'); }} />
            ))}
          </SheetSection>
        </BottomSheet>
      </View>
    );
  }

  // ---------------------------------------------------------------- the list
  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <FloatingHeader centered title={t('เพิ่มหลายรายการ', 'Add several')} backLabel={t('ย้อนกลับ', 'Back')} onBack={() => router.back()} />
      {rows.length === 0 ? (
        // One button, in the middle of an empty page.
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, paddingTop: contentTop, paddingBottom: dockBottom, paddingHorizontal: 32 }}>
          {error ? <Feedback title={t('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /> : null}
          <AppIcon name="cube-outline" size={44} color={palette.border} />
          <Text style={{ fontSize: 14.5, color: palette.muted, textAlign: 'center', lineHeight: 21 }}>{t('ยังไม่มีรายการ\nเพิ่มทีละรายการ แล้วบันทึกทั้งหมดทีเดียว', 'Nothing yet.\nAdd them one at a time, then save all at once.')}</Text>
          {addButton}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingTop: contentTop, paddingHorizontal: 12, paddingBottom: dockBottom + 16 }}>
          {error ? <View style={{ marginBottom: 12 }}><Feedback title={t('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /></View> : null}
          <FormGroup title={t(`รายการ · ${rows.length}`, `Items · ${rows.length}`)}>
            {rows.map((row, index) => (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={t(`แก้ไข ${row.name}`, `Edit ${row.name}`)}
                onPress={() => setOpenKey(row.key)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingLeft: 16, paddingRight: 10, gap: 10, borderTopWidth: index ? 1 : 0, borderTopColor: palette.divider, backgroundColor: pressed ? palette.surfaceSubtle : 'transparent' })}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '600', color: palette.textStrong }}>{row.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted, marginTop: 1 }}>
                    {labelOf(categoryOptions, row.categoryId)} · {fmt(row.stock, locale)} {row.unit} · ฿{fmt(row.cost, locale)}/{row.unit}
                  </Text>
                </View>
                <AppIcon name="chevron-forward" size={17} color={palette.placeholder} />
              </Pressable>
            ))}
          </FormGroup>
          <View style={{ alignItems: 'center' }}>{addButton}</View>
        </ScrollView>
      )}
      <Dock>
        <DockButton
          label={saving ? t('กำลังบันทึก…', 'Saving…') : rows.length ? t(`บันทึกทุกรายการ · ${rows.length}`, `Save all · ${rows.length}`) : t('บันทึกทุกรายการ', 'Save all')}
          onPress={saveAll}
          disabled={saving || !rows.length}
        />
      </Dock>
    </View>
  );
}
