import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createIngredient, deleteIngredient, listIngredientCategories, listIngredients, updateIngredient } from '@/src/api/ingredient';
import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { ChoiceChip, Dock, DockButton, FloatingHeader, FormField, FormGroup, FormPickRow, FormRow, SheetSection, SheetTitle, headerContentTop } from '@/src/components/inventory/parts';
import { Button, EmptyState, Feedback } from '@/src/components/ui';
import {
  buildIngredientCreateInput,
  buildIngredientMetadataInput,
  ingredientToFormValues,
  ingredientUnitOptions,
} from '@/src/lib/inventory-form';
import { inventoryItemAccess } from '@/src/lib/permission-parity';
import { can } from '@/src/lib/rbac';
import { parsePositiveRouteId } from '@/src/lib/route-id';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { Ingredient, IngredientCategory } from '@/src/types/ingredient';

/**
 * The ingredient's own facts — name, category, unit, cost, reorder level,
 * storage — and nothing else. Stock moves and history live on the detail
 * screen; this one is a form, laid out the way iOS lays out a form: grouped
 * rows, the label on the left, what you type on the right.
 */
export default function InventoryItemScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy: t } = useDisplayPreferences();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const routeId = parsePositiveRouteId(id);
  const itemId = routeId.kind === 'valid' ? routeId.id : null;
  const editing = routeId.kind === 'valid';
  const invalidRoute = routeId.kind === 'invalid';
  const canView = can(activeMembership, 'view_inventory');
  const canManage = can(activeMembership, 'manage_inventory');
  const access = inventoryItemAccess(editing, canView, canManage);
  const readOnly = access === 'read';

  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [name, setName] = useState('');
  // SKU, image and yield have no rows any more — the owner dropped them — but
  // the API still carries them, so whatever the record had goes back as it was.
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('none');
  const [imageUrl, setImageUrl] = useState('');
  const [unit, setUnit] = useState('กก.');
  const [stock, setStock] = useState('0');
  const [minStock, setMinStock] = useState('0');
  const [cost, setCost] = useState('0');
  const [yieldPercent, setYieldPercent] = useState('100');
  const [storageType, setStorageType] = useState('room_temp');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(editing);
  const [itemExists, setItemExists] = useState<boolean | null>(editing ? null : true);
  const [picker, setPicker] = useState<'none' | 'category' | 'unit' | 'storage'>('none');

  const title = editing
    ? readOnly ? t('รายละเอียดวัตถุดิบ', 'Ingredient details') : t('แก้ไขวัตถุดิบ', 'Edit ingredient')
    : t('เพิ่มวัตถุดิบ', 'Add ingredient');

  useEffect(() => {
    if (invalidRoute || access === 'denied') {
      setLoading(false);
      setItemExists(null);
      return;
    }
    setLoading(true);
    setError(null);
    setItemExists(editing ? null : true);
    Promise.all([listIngredientCategories(), listIngredients()])
      .then(([categoryResponse, ingredientResponse]) => {
        setCategories(categoryResponse.categories || []);
        const item = ingredientResponse.ingredients.find((current) => current.ID === itemId);
        if (editing && !item) {
          setItemExists(false);
          return;
        }
        if (item) fill(item);
        setItemExists(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('โหลดข้อมูลวัตถุดิบไม่สำเร็จ', 'Could not load ingredient data.')))
      .finally(() => setLoading(false));
  }, [access, t, editing, invalidRoute, itemId]);

  function fill(item: Ingredient) {
    const values = ingredientToFormValues(item);
    setName(values.name); setSku(values.sku); setCategoryId(values.categoryId); setImageUrl(values.imageUrl);
    setUnit(values.unit); setStock(values.stock); setMinStock(values.minStock);
    setCost(values.cost); setYieldPercent(values.yieldPercent); setStorageType(values.storageType);
  }

  const categoryOptions = useMemo(
    () => [{ label: t('ไม่มีหมวด', 'Uncategorised'), value: 'none' }, ...categories.filter((row) => row.is_active).map((row) => ({ label: row.name, value: String(row.ID) }))],
    [categories, t],
  );
  const unitOptions = useMemo(() => ingredientUnitOptions(unit), [unit]);
  const storageOptions = [
    { label: t('อุณหภูมิห้อง', 'Room temperature'), value: 'room_temp' },
    { label: t('แห้ง', 'Dry'), value: 'dry' },
    { label: t('แช่เย็น', 'Chilled'), value: 'chilled' },
    { label: t('แช่แข็ง', 'Frozen'), value: 'frozen' },
  ];
  const categoryName = categoryOptions.find((row) => row.value === categoryId)?.label ?? t('ไม่มีหมวด', 'Uncategorised');
  const storageName = storageOptions.find((row) => row.value === storageType)?.label ?? storageOptions[0].label;

  async function save() {
    if (!canManage || invalidRoute || saving) return;
    if (editing && (itemId === null || itemExists !== true)) return;
    if (!name.trim() || !unit.trim()) { setError(t('กรอกชื่อและหน่วยให้ครบ', 'Enter both an ingredient name and unit.')); return; }
    setSaving(true); setError(null);
    try {
      const values = { name, sku, categoryId, imageUrl, unit, stock, minStock, cost, yieldPercent, storageType };
      if (editing) await updateIngredient(itemId!, buildIngredientMetadataInput(values));
      else await createIngredient(buildIngredientCreateInput(values));
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('บันทึกวัตถุดิบไม่สำเร็จ', 'Could not save the ingredient.'));
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!canManage || itemId === null || itemExists !== true) return;
    Alert.alert(
      t(`ลบ ${name}?`, `Delete ${name}?`),
      t('ประวัติสต็อกของรายการนี้จะหายไปด้วย', 'Its stock history goes with it.'),
      [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        {
          text: t('ลบ', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await deleteIngredient(itemId);
              // Straight back to the list: the detail screen underneath is for
              // an ingredient that no longer exists.
              router.dismissTo('/inventory' as never);
            } catch (err) {
              setError(err instanceof Error ? err.message : t('ลบวัตถุดิบไม่สำเร็จ', 'Could not delete the ingredient.'));
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  if (invalidRoute || access === 'denied' || (editing && itemExists === false) || (editing && !loading && error && itemExists !== true)) {
    const heading = invalidRoute || itemExists === false
      ? t('ไม่พบวัตถุดิบ', 'Ingredient not found')
      : access === 'denied'
        ? (editing ? t('ไม่มีสิทธิ์ดูวัตถุดิบ', 'Ingredient access unavailable') : t('ไม่มีสิทธิ์เพิ่มวัตถุดิบ', 'Ingredient creation unavailable'))
        : t('โหลดวัตถุดิบไม่สำเร็จ', 'Unable to load ingredient');
    const detail = invalidRoute
      ? t('ลิงก์นี้ไม่ชี้ไปที่วัตถุดิบรายการใด', 'This link does not point at an ingredient.')
      : itemExists === false
        ? t('อาจถูกลบไปแล้ว', 'It may have been deleted.')
        : access === 'denied'
          ? t('บัญชีนี้ต้องมีสิทธิ์จัดการคลังวัตถุดิบ', 'This account needs permission to manage inventory.')
          : error ?? undefined;
    return (
      <AppScreen title={title} topLevel={false}>
        <EmptyState title={heading} detail={detail} action={<Button variant="secondary" label={t('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />} />
      </AppScreen>
    );
  }

  const dockBottom = canManage ? Math.max(insets.bottom, 12) + 6 + 54 + 22 : insets.bottom;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <FloatingHeader
        centered
        title={title}
        backLabel={t('ย้อนกลับ', 'Back')}
        onBack={() => router.back()}
        trailing={editing && canManage && !loading ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ลบวัตถุดิบ', 'Delete ingredient')}
            disabled={saving}
            onPress={remove}
            hitSlop={6}
            style={({ pressed }) => ({ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.danger, opacity: pressed ? 0.85 : 1, shadowColor: '#3d2b1f', shadowOpacity: 0.24, shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 3 })}
          >
            <AppIcon name="trash-outline" size={21} color="#ffffff" />
          </Pressable>
        ) : undefined}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingTop: headerContentTop(insets.top, false), paddingHorizontal: 12, paddingBottom: dockBottom + 16 }}
        >
          {error ? <View style={{ marginBottom: 12 }}><Feedback title={t('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /></View> : null}
          {loading ? <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={palette.primary} /></View> : null}

          {!loading ? (
            <>
              <FormGroup>
                <FormRow label={t('ชื่อ', 'Name')} first>
                  <FormField value={name} onChangeText={setName} placeholder={t('เช่น กะเพรา', 'e.g. Holy basil')} readOnly={readOnly} />
                </FormRow>
              </FormGroup>

              <FormGroup title={t('หมวดและหน่วย', 'Category and unit')}>
                <FormPickRow label={t('หมวด', 'Category')} value={categoryName} first onPress={readOnly ? undefined : () => setPicker('category')} />
                <FormPickRow label={t('หน่วยสต็อก', 'Stock unit')} value={unit} onPress={readOnly ? undefined : () => setPicker('unit')} />
              </FormGroup>

              <FormGroup
                title={t('ต้นทุนและสต็อก', 'Cost and stock')}
                footer={t('ต่ำกว่านี้จะขึ้น "ใกล้หมด" ในหน้าคลัง และเป็นขีดกลางหลอดของรายการนี้', 'Below the reorder level the item shows as "Low" and the bar\'s midpoint marks it.')}
              >
                <FormRow label={t('ต้นทุนต่อหน่วย', 'Cost per unit')} first>
                  <FormField value={cost} onChangeText={setCost} numeric prefix="฿" suffix={`/ ${unit}`} readOnly={readOnly} />
                </FormRow>
                {!editing ? (
                  <FormRow label={t('สต็อกเริ่มต้น', 'Opening stock')}>
                    <FormField value={stock} onChangeText={setStock} numeric suffix={unit} readOnly={readOnly} />
                  </FormRow>
                ) : null}
                <FormRow label={t('เตือนเมื่อต่ำกว่า', 'Warn below')}>
                  <FormField value={minStock} onChangeText={setMinStock} numeric suffix={unit} readOnly={readOnly} />
                </FormRow>
              </FormGroup>

              <FormGroup title={t('การจัดเก็บ', 'Storage')}>
                <FormPickRow label={t('วิธีเก็บ', 'Kept')} value={storageName} first onPress={readOnly ? undefined : () => setPicker('storage')} />
              </FormGroup>

            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {canManage && !loading ? (
        <Dock>
          <DockButton label={saving ? t('กำลังบันทึก…', 'Saving…') : editing ? t('บันทึกการแก้ไข', 'Save changes') : t('เพิ่มวัตถุดิบ', 'Add ingredient')} onPress={save} disabled={saving} />
        </Dock>
      ) : null}

      <BottomSheet open={picker === 'category'} onClose={() => setPicker('none')} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('หมวด', 'Category')} />
        <SheetSection title={t('เลือกหนึ่งหมวด', 'Pick one')}>
          {categoryOptions.map((option) => (
            <ChoiceChip key={option.value} label={option.label} on={option.value === categoryId} onPress={() => { setCategoryId(option.value); setPicker('none'); }} />
          ))}
        </SheetSection>
      </BottomSheet>
      <BottomSheet open={picker === 'unit'} onClose={() => setPicker('none')} heightFraction={0.5} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('หน่วยสต็อก', 'Stock unit')} subtitle={t('หน่วยที่ใช้นับในคลังและในสูตร', 'What the shelf and the recipes count in')} />
        <SheetSection title={t('เลือกหนึ่งหน่วย', 'Pick one')}>
          {unitOptions.map((option) => (
            <ChoiceChip key={option} label={option} on={option === unit} onPress={() => { setUnit(option); setPicker('none'); }} />
          ))}
        </SheetSection>
      </BottomSheet>
      <BottomSheet open={picker === 'storage'} onClose={() => setPicker('none')} heightFraction={0.4} label={t('ปิด', 'Close')} showClose>
        <SheetTitle title={t('การจัดเก็บ', 'Storage')} />
        <SheetSection title={t('เก็บแบบไหน', 'Kept how')}>
          {storageOptions.map((option) => (
            <ChoiceChip key={option.value} label={option.label} on={option.value === storageType} onPress={() => { setStorageType(option.value); setPicker('none'); }} />
          ))}
        </SheetSection>
      </BottomSheet>
    </View>
  );
}
