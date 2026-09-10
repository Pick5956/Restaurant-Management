import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, LayoutAnimation, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createIngredientCategory, deleteIngredientCategory, listIngredientCategories, updateIngredientCategory } from '@/src/api/ingredient';
import { SwipeRow } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { Dock, DockButton, FloatingHeader, FormGroup, headerContentTop } from '@/src/components/inventory/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { IngredientCategory } from '@/src/types/ingredient';

/**
 * The ingredient categories: a list of names and nothing else, so the screen is
 * the list. A name is edited where it sits, a new one is a row that appears at
 * the end already focused, and a swipe uncovers the bin — the same three moves
 * the inventory list itself uses.
 */
export default function IngredientCategoriesScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy: t, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canManage = can(activeMembership, 'manage_inventory');

  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  // The row at the end that is not a category yet. Null when there is none.
  const [draft, setDraft] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);

  const load = async () => {
    try {
      const response = await listIngredientCategories();
      setCategories(response.categories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('โหลดหมวดไม่สำเร็จ', 'Could not load ingredient categories'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) { setLoading(false); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const openSwipe = useRef<{ id: string; close: () => void } | null>(null);
  const onRowWillOpen = (id: string, close: () => void) => {
    if (openSwipe.current && openSwipe.current.id !== id) openSwipe.current.close();
    openSwipe.current = { id, close };
  };

  const startEdit = (item: IngredientCategory) => {
    setDraft(null);
    setEditingId(item.ID);
    setEditName(item.name);
    setError(null);
  };

  const commitEdit = async (item: IngredientCategory) => {
    const next = editName.trim();
    setEditingId(null);
    if (!next || next === item.name) return;
    setBusyId(item.ID);
    setError(null);
    try {
      await updateIngredientCategory(item.ID, { name: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('แก้ชื่อหมวดไม่สำเร็จ', 'Could not rename the category'));
    } finally {
      setBusyId(null);
    }
  };

  const startDraft = () => {
    setEditingId(null);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDraft('');
    setError(null);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  };

  // Saves and leaves another empty row behind it: adding categories is
  // something people do in a run of five, not one at a time.
  const commitDraft = async () => {
    const name = (draft ?? '').trim();
    if (!name) { setDraft(null); return; }
    setSaving(true);
    setError(null);
    try {
      await createIngredientCategory({ name, display_order: categories.length + 1, is_active: true });
      setDraft('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('เพิ่มหมวดไม่สำเร็จ', 'Could not add the category'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (item: IngredientCategory) => {
    Alert.alert(
      t(`ลบหมวด "${item.name}"?`, `Delete "${item.name}"?`),
      t('วัตถุดิบในหมวดนี้จะกลายเป็นไม่มีหมวด', 'Ingredients in it become uncategorised.'),
      [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        {
          text: t('ลบ', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            setBusyId(item.ID);
            setError(null);
            try {
              await deleteIngredientCategory(item.ID);
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setCategories((prev) => prev.filter((row) => row.ID !== item.ID));
            } catch (err) {
              setError(err instanceof Error ? err.message : t('ลบหมวดไม่สำเร็จ อาจยังมีวัตถุดิบอยู่ในหมวดนี้', 'Could not delete it — it may still hold ingredients.'));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  if (!canManage) {
    return (
      <AppScreen title={t('หมวดวัตถุดิบ', 'Ingredient categories')} topLevel={false}>
        <EmptyState title={t('ไม่มีสิทธิ์จัดการคลังวัตถุดิบ', 'Inventory management unavailable')} detail={t('บัญชีนี้ต้องมีสิทธิ์จัดการคลังวัตถุดิบ', 'This account needs permission to manage inventory.')} />
      </AppScreen>
    );
  }

  const dockBottom = Math.max(insets.bottom, 12) + 6 + 54 + 22;

  const icon = (
    <View style={{ width: 34, height: 34, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceStrong }}>
      <AppIcon name="file-tray-stacked-outline" size={18} color={palette.muted} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <FloatingHeader centered title={t('หมวดวัตถุดิบ', 'Categories')} backLabel={t('ย้อนกลับ', 'Back')} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingTop: headerContentTop(insets.top, false), paddingHorizontal: 12, paddingBottom: dockBottom + 16 }}
        >
          {error ? <View style={{ marginBottom: 12 }}><Feedback title={t('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /></View> : null}
          {loading ? <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={palette.primary} /></View> : null}

          {!loading ? (
            <FormGroup
              title={t(`หมวดที่ใช้งาน · ${categories.length.toLocaleString(locale)}`, `In use · ${categories.length.toLocaleString(locale)}`)}
              footer={t('แตะเพื่อเปลี่ยนชื่อ · ปัดซ้ายเพื่อลบ', 'Tap to rename · swipe left to delete')}
            >
              {categories.map((item, index) => {
                const editing = editingId === item.ID;
                const row = (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(`เปลี่ยนชื่อ ${item.name}`, `Rename ${item.name}`)}
                    onPress={() => startEdit(item)}
                    disabled={editing}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      minHeight: 56,
                      paddingLeft: 14,
                      paddingRight: 12,
                      gap: 12,
                      borderTopWidth: index ? 1 : 0,
                      borderTopColor: palette.divider,
                      backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
                    })}
                  >
                    {icon}
                    {editing ? (
                      <TextInput
                        autoFocus
                        value={editName}
                        onChangeText={setEditName}
                        onSubmitEditing={() => { void commitEdit(item); }}
                        onBlur={() => { void commitEdit(item); }}
                        returnKeyType="done"
                        selectTextOnFocus
                        accessibilityLabel={t('ชื่อหมวด', 'Category name')}
                        style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', color: palette.textStrong, paddingVertical: 0 }}
                      />
                    ) : (
                      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', color: palette.textStrong }}>{item.name}</Text>
                    )}
                    {busyId === item.ID ? (
                      <ActivityIndicator color={palette.primary} />
                    ) : editing ? (
                      <Text style={{ fontSize: 14, fontWeight: '600', color: palette.primaryInk }}>{t('เสร็จ', 'Done')}</Text>
                    ) : (
                      <AppIcon name="create-outline" size={18} color={palette.placeholder} />
                    )}
                  </Pressable>
                );
                // An open row must not be renamed by the tap that closes it, so
                // the swipe wraps the row rather than the other way round.
                return (
                  <SwipeRow
                    key={item.ID}
                    id={String(item.ID)}
                    background={palette.surface}
                    deleteLabel={t(`ลบหมวด ${item.name}`, `Delete ${item.name}`)}
                    onDelete={() => confirmDelete(item)}
                    onWillOpen={onRowWillOpen}
                  >
                    {row}
                  </SwipeRow>
                );
              })}

              {draft !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingLeft: 14, paddingRight: 12, gap: 12, borderTopWidth: categories.length ? 1 : 0, borderTopColor: palette.divider, backgroundColor: palette.surface }}>
                  {icon}
                  <TextInput
                    autoFocus
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={() => { void commitDraft(); }}
                    onBlur={() => { void commitDraft(); }}
                    returnKeyType="done"
                    placeholder={t('ชื่อหมวดใหม่', 'New category name')}
                    placeholderTextColor={palette.placeholder}
                    accessibilityLabel={t('ชื่อหมวดใหม่', 'New category name')}
                    style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: '600', color: palette.textStrong, paddingVertical: 0 }}
                  />
                  {saving ? <ActivityIndicator color={palette.primary} /> : (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('ยกเลิก', 'Cancel')} onPress={() => setDraft(null)} hitSlop={8}>
                      <AppIcon name="close-circle" size={20} color={palette.placeholder} />
                    </Pressable>
                  )}
                </View>
              ) : null}

              {!categories.length && draft === null ? (
                <View style={{ minHeight: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}>
                  <Text style={{ fontSize: 14, color: palette.placeholder, textAlign: 'center' }}>{t('ยังไม่มีหมวด กด "เพิ่มหมวด" ด้านล่าง', 'No categories yet — tap "Add category" below.')}</Text>
                </View>
              ) : null}
            </FormGroup>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Dock>
        <DockButton icon="add" label={t('เพิ่มหมวด', 'Add category')} onPress={startDraft} disabled={saving} />
      </Dock>
    </View>
  );
}
