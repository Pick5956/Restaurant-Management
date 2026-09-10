import { useEffect, useState } from 'react';
import { Alert, useWindowDimensions, View } from 'react-native';

import { createIngredientCategory, deleteIngredientCategory, listIngredientCategories, updateIngredientCategory } from '@/src/api/ingredient';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { Button, Divider, EdgeSection, EdgeSectionHeader, EmptyState, Feedback, SectionHeader, Surface, TextField } from '@/src/components/ui';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';
import type { IngredientCategory } from '@/src/types/ingredient';

export default function IngredientCategoriesScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy } = useDisplayPreferences();
  const canManage = can(activeMembership, 'manage_inventory');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => listIngredientCategories()
    .then((response) => setCategories(response.categories || []))
    .catch((err) => setError(err instanceof Error ? err.message : copy('โหลดหมวดไม่สำเร็จ', 'Could not load ingredient categories')));

  useEffect(() => {
    if (canManage) void load();
  }, [canManage]);

  async function add() {
    if (!canManage || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createIngredientCategory({ name: name.trim(), display_order: categories.length + 1, is_active: true });
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('เพิ่มหมวดไม่สำเร็จ', 'Could not add the category'));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: IngredientCategory) {
    setEditingId(item.ID);
    setEditName(item.name);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
  }

  async function saveEdit(item: IngredientCategory) {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === item.name) { cancelEdit(); return; }
    setRowBusyId(item.ID);
    setError(null);
    try {
      await updateIngredientCategory(item.ID, { name: trimmed });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('แก้ชื่อหมวดไม่สำเร็จ', 'Could not rename the category'));
    } finally {
      setRowBusyId(null);
    }
  }

  async function runDelete(item: IngredientCategory) {
    setRowBusyId(item.ID);
    setError(null);
    try {
      await deleteIngredientCategory(item.ID);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('ลบหมวดไม่สำเร็จ (อาจมีวัตถุดิบอยู่ในหมวดนี้)', 'Could not delete the category (it may still contain ingredients).'));
    } finally {
      setRowBusyId(null);
    }
  }

  function confirmDelete(item: IngredientCategory) {
    Alert.alert(
      copy(`ลบหมวด "${item.name}"?`, `Delete category "${item.name}"?`),
      copy('วัตถุดิบในหมวดนี้จะไม่มีหมวด', 'Ingredients in this category will become uncategorized.'),
      [
        { text: copy('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: copy('ลบ', 'Delete'), style: 'destructive', onPress: () => { void runDelete(item); } },
      ],
    );
  }

  if (!canManage) {
    return (
      <AppScreen title={copy('หมวดวัตถุดิบ', 'Ingredient categories')} topLevel={false}>
        <Feedback
          title={copy('ไม่มีสิทธิ์จัดการคลังวัตถุดิบ', 'Inventory management access unavailable')}
          detail={copy('บัญชีนี้ต้องมีสิทธิ์จัดการคลังวัตถุดิบ', 'This account needs permission to manage inventory.')}
          tone="info"
        />
      </AppScreen>
    );
  }

  function renderRow(item: IngredientCategory, withDivider: boolean) {
    const editing = editingId === item.ID;
    const busy = rowBusyId === item.ID;
    return (
      <View key={item.ID}>
        {withDivider ? <Divider /> : null}
        <View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: tabletWorkspace ? 0 : spacing.lg, paddingVertical: spacing.sm }}>
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: palette.surfaceStrong }}>
            <AppIcon color={palette.muted} name="file-tray-stacked-outline" size={21} />
          </View>
          {editing ? (
            <View style={{ minWidth: 0, flex: 1 }}>
              <TextInput
                autoFocus
                value={editName}
                onChangeText={setEditName}
                onSubmitEditing={() => { void saveEdit(item); }}
                returnKeyType="done"
                placeholder={copy('ชื่อหมวด', 'Category name')}
                placeholderTextColor={palette.placeholder}
                style={{
                  minHeight: 44,
                  borderWidth: 1,
                  borderColor: palette.controlBorder,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.md,
                  color: palette.text,
                  fontSize: 16,
                  backgroundColor: palette.surface,
                }}
              />
            </View>
          ) : (
            <Text selectable numberOfLines={1} style={[typeScale.cardTitle, { minWidth: 0, flex: 1 }]}>{item.name}</Text>
          )}
          {editing ? (
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Button compact variant="secondary" icon="close-outline" label={copy('ยกเลิก', 'Cancel')} onPress={cancelEdit} />
              <Button compact icon="checkmark-outline" label={copy('บันทึก', 'Save')} onPress={() => { void saveEdit(item); }} loading={busy} disabled={!editName.trim()} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Button compact variant="secondary" icon="create-outline" label={copy('แก้ไข', 'Edit')} onPress={() => startEdit(item)} />
              <Button compact variant="danger" icon="trash-outline" label={copy('ลบ', 'Delete')} onPress={() => confirmDelete(item)} loading={busy} />
            </View>
          )}
        </View>
      </View>
    );
  }

  const emptyState = (
    <EmptyState title={copy('ยังไม่มีหมวดวัตถุดิบ', 'No ingredient categories yet')} detail={copy('เพิ่มหมวดแรกเพื่อจัดกลุ่มวัตถุดิบ', 'Add the first category to organize inventory.')} />
  );

  const formPanel = (
    <Surface style={{ flex: tabletWorkspace ? 0.8 : undefined }}>
      <SectionHeader title={copy('เพิ่มหมวด', 'Add category')} />
      <TextField icon="folder-outline" label={copy('ชื่อหมวด', 'Category name')} value={name} onChangeText={setName} />
      <Button
        icon="add-outline"
        label={copy('เพิ่มหมวดวัตถุดิบ', 'Add ingredient category')}
        onPress={add}
        loading={saving}
        disabled={!name.trim()}
      />
    </Surface>
  );

  const listPanel = tabletWorkspace ? (
    <Surface style={{ flex: 1.2 }}>
      <SectionHeader
        title={copy('หมวดที่ใช้งาน', 'Ingredient categories')}
        detail={copy(`${categories.length.toLocaleString('th-TH')} หมวด`, `${categories.length.toLocaleString('en-US')} categories`)}
      />
      {categories.map((item, index) => renderRow(item, Boolean(index)))}
      {!categories.length ? emptyState : null}
    </Surface>
  ) : (
    <View style={{ gap: spacing.sm }}>
      <EdgeSectionHeader
        title={copy('หมวดที่ใช้งาน', 'Ingredient categories')}
        detail={copy(`${categories.length.toLocaleString('th-TH')} หมวด`, `${categories.length.toLocaleString('en-US')} categories`)}
      />
      <EdgeSection>
        {categories.map((item, index) => renderRow(item, Boolean(index)))}
        {!categories.length ? <View style={{ paddingHorizontal: spacing.lg }}>{emptyState}</View> : null}
      </EdgeSection>
    </View>
  );

  return (
    <AppScreen
      title={copy('หมวดวัตถุดิบ', 'Ingredient categories')}
      subtitle={copy('จัดกลุ่มวัตถุดิบสำหรับคลังและรายงาน', 'Group ingredients for inventory and reports.')}
      topLevel={false}
    >
      {error ? <Feedback title={copy('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: tabletWorkspace ? 'flex-start' : 'stretch', gap: spacing.lg }}>
        {tabletWorkspace ? listPanel : formPanel}
        {tabletWorkspace ? formPanel : listPanel}
      </View>
    </AppScreen>
  );
}
