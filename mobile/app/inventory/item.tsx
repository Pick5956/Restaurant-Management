import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createIngredient, deleteIngredient, listIngredientCategories, listIngredients, updateIngredient } from '@/src/api/ingredient';
import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { ChoiceChip, Dock, DockButton, FloatingHeader, SheetSection, SheetTitle, headerContentTop } from '@/src/components/inventory/parts';
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
      <FloatingHeader centered title={title} backLabel={t('ย้อนกลับ', 'Back')} onBack={() => router.back()} />
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
              <Group>
                <FieldRow label={t('ชื่อ', 'Name')} first>
                  <Field value={name} onChangeText={setName} placeholder={t('เช่น กะเพรา', 'e.g. Holy basil')} readOnly={readOnly} />
                </FieldRow>
                <FieldRow label="SKU">
                  <Field value={sku} onChangeText={setSku} placeholder={t('ไม่บังคับ', 'Optional')} readOnly={readOnly} autoCapitalize="characters" />
                </FieldRow>
              </Group>

              <Group title={t('หมวดและหน่วย', 'Category and unit')}>
                <PickRow label={t('หมวด', 'Category')} value={categoryName} first onPress={readOnly ? undefined : () => setPicker('category')} />
                <PickRow label={t('หน่วยสต็อก', 'Stock unit')} value={unit} onPress={readOnly ? undefined : () => setPicker('unit')} />
              </Group>

              <Group
                title={t('ต้นทุนและสต็อก', 'Cost and stock')}
                footer={t('ต่ำกว่าจุดเตือนจะขึ้น "ใกล้หมด" ในหน้าคลัง และเป็นขีดกลางหลอดของรายการนี้', 'Below the reorder level the item shows as "Low" and the bar\'s midpoint marks it.')}
              >
                <FieldRow label={t('ต้นทุนต่อหน่วย', 'Cost per unit')} first>
                  <Field value={cost} onChangeText={setCost} numeric prefix="฿" suffix={`/ ${unit}`} readOnly={readOnly} />
                </FieldRow>
                {!editing ? (
                  <FieldRow label={t('สต็อกเริ่มต้น', 'Opening stock')}>
                    <Field value={stock} onChangeText={setStock} numeric suffix={unit} readOnly={readOnly} />
                  </FieldRow>
                ) : null}
                <FieldRow label={t('จุดเตือนขั้นต่ำ', 'Reorder level')}>
                  <Field value={minStock} onChangeText={setMinStock} numeric suffix={unit} readOnly={readOnly} />
                </FieldRow>
                <FieldRow label={t('ผลได้หลังเตรียม', 'Yield')}>
                  <Field value={yieldPercent} onChangeText={setYieldPercent} numeric suffix="%" readOnly={readOnly} />
                </FieldRow>
              </Group>

              <Group title={t('การจัดเก็บ', 'Storage')}>
                <PickRow label={t('วิธีเก็บ', 'Kept')} value={storageName} first onPress={readOnly ? undefined : () => setPicker('storage')} />
              </Group>

              <Group title={t('รูปภาพ', 'Image')}>
                <FieldRow label="URL" first>
                  <Field value={imageUrl} onChangeText={setImageUrl} placeholder={t('ไม่บังคับ', 'Optional')} readOnly={readOnly} autoCapitalize="none" keyboardType="url" />
                </FieldRow>
              </Group>

              {editing && canManage ? (
                <Group>
                  <Pressable accessibilityRole="button" disabled={saving} onPress={remove} style={({ pressed }) => ({ minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? palette.dangerSoft : 'transparent' })}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: palette.danger }}>{t('ลบวัตถุดิบ', 'Delete ingredient')}</Text>
                  </Pressable>
                </Group>
              ) : null}
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

// ------------------------------------------------ the grouped form

/** A section: a small caption, a white card of rows, an optional note under it. */
function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      {title ? <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted, marginLeft: 16, marginBottom: 7 }}>{title}</Text> : null}
      <View style={{ backgroundColor: palette.surface, borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: palette.border, overflow: 'hidden' }}>
        {children}
      </View>
      {footer ? <Text style={{ fontSize: 12, color: palette.placeholder, marginHorizontal: 16, marginTop: 7, lineHeight: 17 }}>{footer}</Text> : null}
    </View>
  );
}

/** A row with the label on the left and whatever is typed on the right. */
function FieldRow({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 16, paddingRight: 16, gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <Text style={{ fontSize: 15.5, color: palette.text, minWidth: 96 }}>{label}</Text>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>{children}</View>
    </View>
  );
}

function Field({
  value,
  onChangeText,
  placeholder,
  numeric,
  prefix,
  suffix,
  readOnly,
  autoCapitalize,
  keyboardType,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
  prefix?: string;
  suffix?: string;
  readOnly?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'words' | 'sentences';
  keyboardType?: 'url';
}) {
  if (readOnly) {
    return (
      <Text numberOfLines={1} style={{ fontSize: 15.5, color: palette.muted, textAlign: 'right', fontVariant: numeric ? ['tabular-nums'] : undefined }}>
        {prefix ? `${prefix} ` : ''}{value || '—'}{suffix ? ` ${suffix}` : ''}
      </Text>
    );
  }
  return (
    <>
      {prefix ? <Text style={{ fontSize: 15.5, color: palette.placeholder }}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        keyboardType={numeric ? 'decimal-pad' : keyboardType}
        autoCapitalize={autoCapitalize ?? (numeric ? 'none' : 'sentences')}
        selectTextOnFocus={numeric}
        style={{ flex: 1, minWidth: 0, textAlign: 'right', fontSize: 15.5, color: palette.textStrong, paddingVertical: 0, fontVariant: numeric ? ['tabular-nums'] : undefined }}
      />
      {suffix ? <Text style={{ fontSize: 13.5, color: palette.placeholder }}>{suffix}</Text> : null}
    </>
  );
}

/** A row that opens a picker: the chosen value on the right, a chevron after it. */
function PickRow({ label, value, first, onPress }: { label: string; value: string; first?: boolean; onPress?: () => void }) {
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 16, paddingRight: onPress ? 10 : 16, gap: 12, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <Text style={{ fontSize: 15.5, color: palette.text, minWidth: 96 }}>{label}</Text>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontSize: 15.5, color: onPress ? palette.textStrong : palette.muted }}>{value}</Text>
      {onPress ? <AppIcon name="chevron-forward" size={17} color={palette.placeholder} /> : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? palette.surfaceSubtle : 'transparent' })}>
      {inner}
    </Pressable>
  );
}
