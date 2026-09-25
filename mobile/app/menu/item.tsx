import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { listIngredients } from '@/src/api/ingredient';
import { createMenuItem, deleteMenuItem, listCategories, listMenuItems, previewMenuImageBackground, updateMenuItem, uploadMenuImage } from '@/src/api/menu';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { MenuImageCropper } from '@/src/components/menu-image-cropper';
import { ActionDock, Button, ChipGroup, Divider, EmptyState, Feedback, SectionHeader, Surface, TextField } from '@/src/components/ui';
import { apiFailureDetail } from '@/src/lib/api-failure';
import { toFloat, toInt } from '@/src/lib/forms';
import {
  initialMenuCategoryIds,
  menuIngredientDrafts,
  menuIngredientInputs,
  menuOptionGroupDrafts,
  menuOptionGroupInputs,
  selectableMenuCategories,
  validateMenuOptionGroups,
  type MenuIngredientDraft,
  type MenuOptionGroupDraft,
  type MenuOptionGroupIssueCode,
} from '@/src/lib/menu-editor';
import { menuImageUploadCanCommit, resolveCommittedMenuImageUrl, type MenuImageBackgroundOptions, type MenuImageUploadFile, type MenuImageUploadResult } from '@/src/lib/menu-image';
import { can } from '@/src/lib/rbac';
import { parsePositiveRouteId } from '@/src/lib/route-id';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';
import type { Ingredient } from '@/src/types/ingredient';
import type { Category } from '@/src/types/menu';

const emptyGroup = (index: number): MenuOptionGroupDraft => ({ name: '', required: false, min_select: 0, max_select: 1, display_order: index + 1, is_active: true, options: [] });

export default function MenuItemEditorScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const routeId = parsePositiveRouteId(id);
  const itemId = routeId.kind === 'valid' ? routeId.id : null;
  const editing = routeId.kind === 'valid';
  const invalidRoute = routeId.kind === 'invalid';
  const canManage = can(activeMembership, 'manage_menu');
  const canViewInventory = can(activeMembership, 'view_inventory') || can(activeMembership, 'manage_inventory');
  const [categories, setCategories] = useState<Category[]>([]); const [allIngredients, setAllIngredients] = useState<Ingredient[]>([]);
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [description, setDescription] = useState(''); const [imageUrl, setImageUrl] = useState(''); const [displayOrder, setDisplayOrder] = useState('1');
  const [available, setAvailable] = useState<'yes' | 'no'>('yes'); const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroupDraft[]>([]); const [ingredients, setIngredients] = useState<MenuIngredientDraft[]>([]); const [ingredientCandidate, setIngredientCandidate] = useState('none');
  // `error` is the step that failed, and the app's line under it when there is one.
  const [saving, setSaving] = useState(false); const [error, setError] = useState<{ title: string; detail?: string } | null>(null); const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageEditing, setImageEditing] = useState(false); const [uploadingImage, setUploadingImage] = useState(false); const [imageError, setImageError] = useState<string | null>(null);
  const [showOptionErrors, setShowOptionErrors] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [itemExists, setItemExists] = useState<boolean | null>(editing ? null : true);
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;

  useEffect(() => {
    if (!canManage || invalidRoute) {
      setLoading(false);
      setItemExists(null);
      return;
    }
    setLoading(true);
    setError(null);
    setItemExists(editing ? null : true);
    const ingredientRequest = canViewInventory
      ? listIngredients().catch(() => ({ ingredients: [] }))
      : Promise.resolve({ ingredients: [] as Ingredient[] });
    Promise.all([listCategories(), listMenuItems(), ingredientRequest]).then(([categoryResponse, menuResponse, ingredientResponse]) => {
      setCategories(categoryResponse.categories || []); setAllIngredients(ingredientResponse.ingredients || []);
      const item = menuResponse.menu_items.find((current) => current.ID === itemId);
      if (item) {
        setName(item.name); setPrice(String(item.price)); setDescription(item.description || ''); setImageUrl(item.image_url || ''); setDisplayOrder(String(item.display_order)); setAvailable(item.is_available ? 'yes' : 'no');
        setCategoryIds(initialMenuCategoryIds(item, categoryResponse.categories || []));
        // Option ingredient links are authored on the web only, but they are read
        // here and posted back untouched. A save replaces the whole option
        // aggregate, so dropping them on the way in deletes them on the way out.
        setOptionGroups(menuOptionGroupDrafts((item.option_groups || []).map((group) => ({ name: group.name, required: group.required, min_select: group.min_select, max_select: group.max_select, display_order: group.display_order, is_active: group.is_active, options: (group.options || []).map((option) => ({ name: option.name, price_delta: option.price_delta, is_default: option.is_default, display_order: option.display_order, is_active: option.is_active, ingredients: (option.ingredients || []).map((row) => ({ ingredient_id: row.ingredient_id, direction: row.direction, quantity: row.quantity, unit: row.unit })) })) }))));
        setIngredients(menuIngredientDrafts((item.ingredients || []).map((ingredient) => ({ ingredient_id: ingredient.ingredient_id, quantity: ingredient.quantity, unit: ingredient.unit, note: ingredient.note }))));
        setItemExists(true);
      } else if (!editing) {
        setCategoryIds(initialMenuCategoryIds(undefined, categoryResponse.categories || []));
        setItemExists(true);
      } else {
        setItemExists(false);
      }
    }).catch((err) => setError({ title: copy('โหลดข้อมูลเมนูไม่สำเร็จ', 'Could not load menu item data'), detail: apiFailureDetail(err, language) }))
      .finally(() => setLoading(false));
  }, [canManage, canViewInventory, copy, editing, invalidRoute, itemId, language]);

  const ingredientOptions = useMemo(() => [{ label: copy('เลือกวัตถุดิบ', 'Choose an ingredient'), value: 'none' }, ...allIngredients.filter((item) => !ingredients.some((row) => row.ingredient_id === item.ID)).map((item) => ({ label: item.name, value: String(item.ID) }))], [allIngredients, copy, ingredients]);
  const optionValidation = useMemo(() => validateMenuOptionGroups(menuOptionGroupInputs(optionGroups)), [optionGroups]);
  function toggleCategory(categoryId: number) { setCategoryIds((current) => current.includes(categoryId) ? current.filter((value) => value !== categoryId) : [...current, categoryId]); }
  function updateGroup(index: number, patch: Partial<MenuOptionGroupDraft>) { setOptionGroups((current) => current.map((group, currentIndex) => currentIndex === index ? { ...group, ...patch } : group)); }
  function updateOption(groupIndex: number, optionIndex: number, patch: Partial<MenuOptionGroupDraft['options'][number]>) { setOptionGroups((current) => current.map((group, currentGroupIndex) => currentGroupIndex === groupIndex ? { ...group, options: group.options.map((option, currentOptionIndex) => currentOptionIndex === optionIndex ? { ...option, ...patch } : option) } : group)); }
  function addOption(groupIndex: number) { setOptionGroups((current) => current.map((group, index) => index === groupIndex ? { ...group, options: [...group.options, { name: '', price_delta: '0', is_default: false, display_order: group.options.length + 1, is_active: true }] } : group)); }
  function addIngredient() { const candidate = Number(ingredientCandidate); if (!candidate) return; const item = allIngredients.find((current) => current.ID === candidate); setIngredients((current) => [...current, { ingredient_id: candidate, quantity: '1', unit: item?.unit || '', note: '' }]); setIngredientCandidate('none'); }

  function optionIssueMessage(code: MenuOptionGroupIssueCode) {
    switch (code) {
      case 'too_many_groups': return copy('เพิ่มกลุ่มตัวเลือกได้สูงสุด 20 กลุ่ม', 'You can add up to 20 option groups.');
      case 'group_name_required': return copy('กรอกชื่อกลุ่มตัวเลือก', 'Enter an option group name.');
      case 'group_name_too_long': return copy('ชื่อกลุ่มต้องไม่เกิน 120 ตัวอักษร', 'The group name must be 120 characters or fewer.');
      case 'group_name_duplicate': return copy('ชื่อกลุ่มตัวเลือกต้องไม่ซ้ำกัน', 'Option group names must be unique.');
      case 'too_many_options': return copy('เพิ่มตัวเลือกได้สูงสุด 50 รายการต่อกลุ่ม', 'You can add up to 50 options per group.');
      case 'option_required': return copy('เพิ่มตัวเลือกอย่างน้อย 1 รายการ', 'Add at least one option.');
      case 'option_name_required': return copy('กรอกชื่อตัวเลือก', 'Enter an option name.');
      case 'option_name_too_long': return copy('ชื่อตัวเลือกต้องไม่เกิน 120 ตัวอักษร', 'The option name must be 120 characters or fewer.');
      case 'option_name_duplicate': return copy('ชื่อตัวเลือกในกลุ่มนี้ต้องไม่ซ้ำกัน', 'Option names in this group must be unique.');
      case 'option_price_negative': return copy('ราคาเพิ่มต้องไม่ติดลบ', 'Additional price cannot be negative.');
      case 'option_price_too_large': return copy('ราคาเพิ่มสูงเกินขอบเขตที่รองรับ', 'Additional price exceeds the supported limit.');
      case 'max_below_min': return copy('จำนวนสูงสุดต้องไม่น้อยกว่าจำนวนขั้นต่ำ', 'Maximum selections cannot be below the minimum.');
      case 'max_too_large': return copy('เลือกได้สูงสุดไม่เกิน 50 รายการ', 'Maximum selections cannot exceed 50.');
      case 'min_exceeds_active_options': return copy('จำนวนขั้นต่ำมากกว่าตัวเลือกที่เปิดใช้งาน', 'Minimum selections exceed the active options.');
      case 'defaults_exceed_max': return copy('ตัวเลือกเริ่มต้นมีมากกว่าจำนวนที่เลือกได้สูงสุด', 'Default selections exceed the maximum.');
    }
  }

  function optionIssue(
    groupIndex: number,
    codes: MenuOptionGroupIssueCode[],
    optionIndex?: number,
  ) {
    if (!showOptionErrors) return undefined;
    return optionValidation.issues.find((issue) =>
      issue.groupIndex === groupIndex
      && issue.optionIndex === optionIndex
      && codes.includes(issue.code));
  }

  async function save() {
    if (!canManage || invalidRoute) return;
    if (editing && (itemId === null || itemExists !== true)) return;
    if (imageEditing || uploadingImage) return;
    setShowOptionErrors(true);
    if (!name.trim() || !price || !categoryIds.length) { setError({ title: copy('ทำรายการไม่ได้', 'Unable to complete the action'), detail: copy('กรอกชื่อ ราคา และเลือกอย่างน้อย 1 หมวด', 'Enter a name and price, then choose at least one category.') }); return; }
    if (optionValidation.issues.length) { setError(null); return; }
    setSaving(true); setError(null);
    try {
      const payload = { category_id: categoryIds[0], category_ids: categoryIds, name: name.trim(), price: toFloat(price, 0), image_url: imageUrl.trim(), description: description.trim(), is_available: available === 'yes', display_order: toInt(displayOrder, 0), option_groups: optionValidation.groups, ingredients: menuIngredientInputs(ingredients) };
      if (editing) {
        if (itemId === null) return;
        await updateMenuItem(itemId, payload);
      } else {
        await createMenuItem(payload);
      }
      router.back();
    } catch (err) { setError({ title: copy('บันทึกเมนูไม่สำเร็จ', 'Could not save the menu item'), detail: apiFailureDetail(err, language) }); }
    finally { setSaving(false); }
  }
  async function uploadImage(file: MenuImageUploadFile, options: MenuImageBackgroundOptions): Promise<MenuImageUploadResult> {
    setUploadingImage(true);
    setImageError(null);
    try {
      const response = await uploadMenuImage(file, options);
      const nextImageUrl = resolveCommittedMenuImageUrl(imageUrl, response.image_url);
      if (!response.image_url?.trim()) throw new Error('Menu image upload returned no URL.');
      const backgroundRemoved = response.background_removed === true;
      if (!menuImageUploadCanCommit(options, backgroundRemoved)) {
        return { uploaded: true, backgroundRemoved };
      }
      setImageUrl(nextImageUrl);
      return { uploaded: true, backgroundRemoved };
    } catch {
      if (!options.removeBackground) {
        setImageError(copy(
          'อัปโหลดรูปไม่สำเร็จ กรุณาใช้ไฟล์ jpg, png หรือ webp ขนาดไม่เกิน 5MB',
          'Could not upload image. Use jpg, png, or webp up to 5MB.',
        ));
      }
      return { uploaded: false, backgroundRemoved: false };
    } finally {
      setUploadingImage(false);
    }
  }
  async function remove() {
    if (!canManage || itemId === null || itemExists !== true) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSaving(true); setError(null);
    try { await deleteMenuItem(itemId); router.back(); }
    catch (err) { setError({ title: copy('ลบเมนูไม่สำเร็จ', 'Could not delete the menu item'), detail: apiFailureDetail(err, language) }); setSaving(false); }
  }

  if (invalidRoute) {
    return (
      <AppScreen title={copy('รายละเอียดเมนู', 'Menu item details')} topLevel={false}>
        <EmptyState
          title={copy('ไม่พบเมนู', 'Menu item not found')}
          detail={copy(
            'ลิงก์เมนูนี้ไม่ถูกต้อง กรุณากลับไปเลือกรายการจากหน้าเมนู',
            'This menu-item link is invalid. Go back and choose an item from the menu.',
          )}
          action={<Button variant="secondary" label={copy('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />}
        />
      </AppScreen>
    );
  }

  if (!canManage) {
    return (
      <AppScreen title={copy('จัดการเมนู', 'Manage menu')} subtitle={copy('เฉพาะผู้ที่ได้รับสิทธิ์จัดการเมนู', 'Available to team members with menu management access')} topLevel={false}>
        <Feedback title={copy('ไม่มีสิทธิ์จัดการเมนู', 'Menu management access unavailable')} detail={copy('กลับไปเลือกโหมดงานที่บัญชีนี้ได้รับอนุญาต', 'Return and choose a workspace your account is allowed to use.')} tone="info" />
      </AppScreen>
    );
  }

  if (editing && itemExists !== true) {
    const title = loading
      ? copy('กำลังโหลดเมนู', 'Loading menu item')
      : error
        ? copy('โหลดเมนูไม่สำเร็จ', 'Unable to load menu item')
        : copy('ไม่พบเมนู', 'Menu item not found');
    const detail = loading
      ? copy('กำลังตรวจสอบข้อมูลรายการนี้', 'Checking this item now.')
      : error ? error.detail : copy(
        'เมนูนี้อาจถูกลบไปแล้ว กรุณากลับไปเลือกรายการจากหน้าเมนู',
        'This menu item may have been deleted. Go back and choose an item from the menu.',
      );
    return (
      <AppScreen title={copy('รายละเอียดเมนู', 'Menu item details')} topLevel={false}>
        <EmptyState
          title={title}
          detail={detail}
          action={loading ? undefined : (
            <Button variant="secondary" label={copy('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />
          )}
        />
      </AppScreen>
    );
  }

  const detailsPanel = (
    <Surface>
      <SectionHeader title={copy('ข้อมูลเมนู', 'Menu details')} />
      <TextField icon="restaurant-outline" label={copy('ชื่อเมนู', 'Item name')} value={name} onChangeText={setName} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <TextField icon="cash-outline" label={copy('ราคา', 'Price')} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        </View>
      </View>
      <Divider />
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.text, fontSize: 13, fontWeight: '700' }}>
          {copy('รูปเมนู', 'Menu image')}
        </Text>
        <MenuImageCropper
          copy={copy}
          currentImageUrl={imageUrl}
          disabled={saving || uploadingImage}
          onEditingChange={setImageEditing}
          onError={(message) => setImageError(message || null)}
          onPreview={previewMenuImageBackground}
          onUpload={uploadImage}
        />
        {imageError ? (
          <Text accessibilityRole="alert" style={[typeScale.caption, { color: palette.danger, fontWeight: '600' }]}>
            {imageError}
          </Text>
        ) : null}
        {uploadingImage ? (
          <Text style={[typeScale.caption, { color: palette.muted }]}>
            {copy('กำลังอัปโหลดรูป...', 'Uploading image...')}
          </Text>
        ) : null}
      </View>
      <Divider />
      <TextField icon="document-text-outline" label={copy('คำอธิบาย', 'Description')} value={description} onChangeText={setDescription} multiline />
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.text, fontSize: 13, fontWeight: '700' }}>{copy('หมวดเมนู', 'Menu categories')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {selectableMenuCategories(categories, categoryIds).map((item) => {
            const selected = categoryIds.includes(item.ID);
            return (
              <Pressable
                accessibilityLabel={copy(`เลือกหมวด ${item.name}`, `Select category ${item.name}`)}
                accessibilityState={{ selected }}
                key={item.ID}
                onPress={() => toggleCategory(item.ID)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: selected ? palette.primary : palette.borderStrong,
                  borderRadius: radius.md,
                  backgroundColor: selected ? palette.primary : palette.surface,
                  paddingHorizontal: spacing.md,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ color: selected ? palette.primaryText : palette.text, fontSize: 13, fontWeight: '700' }}>
                  {item.name}{item.is_active ? '' : copy(' (ปิด)', ' (inactive)')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Surface>
  );

  const optionsPanel = (
    <Surface>
      <SectionHeader
        title={copy('ตัวเลือกเมนู', 'Item options')}
        detail={copy('ความเผ็ด ขนาด หรือท็อปปิง', 'Spice, size, or toppings')}
        action={<Button compact icon="add-outline" variant="secondary" label={copy('เพิ่มกลุ่ม', 'Add group')} onPress={() => setOptionGroups((current) => [...current, emptyGroup(current.length)])} />}
      />
      {showOptionErrors && optionValidation.issues.some((issue) => issue.code === 'too_many_groups')
        ? <Feedback title={optionIssueMessage('too_many_groups')} tone="danger" />
        : null}
      {optionGroups.map((group, groupIndex) => {
        const groupNameIssue = optionIssue(groupIndex, ['group_name_required', 'group_name_too_long', 'group_name_duplicate']);
        const groupIssue = optionIssue(groupIndex, ['option_required', 'too_many_options']);
        const minIssue = optionIssue(groupIndex, ['min_exceeds_active_options']);
        const maxIssue = optionIssue(groupIndex, ['max_below_min', 'max_too_large', 'defaults_exceed_max']);

        return (
          <View key={groupIndex} style={{ gap: spacing.md }}>
            {groupIndex ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={[typeScale.cardTitle, { flex: 1 }]}>
                {copy(`กลุ่ม ${(groupIndex + 1).toLocaleString('th-TH')}`, `Group ${(groupIndex + 1).toLocaleString('en-US')}`)}
              </Text>
              <Button compact icon="trash-outline" variant="ghost" label={copy('ลบกลุ่ม', 'Remove')} onPress={() => setOptionGroups((current) => current.filter((_, index) => index !== groupIndex))} />
            </View>
            <TextField icon="options-outline" label={copy('ชื่อกลุ่ม', 'Group name')} value={group.name} onChangeText={(value) => updateGroup(groupIndex, { name: value })} error={groupNameIssue ? optionIssueMessage(groupNameIssue.code) : undefined} />
            <ChipGroup
              label={copy('การเลือก', 'Selection rule')}
              value={group.required ? 'required' : 'optional'}
              onChange={(value) => updateGroup(groupIndex, {
                required: value === 'required',
                min_select: value === 'required' ? Math.max(1, group.min_select) : 0,
              })}
              options={[
                { label: copy('ไม่บังคับ', 'Optional'), value: 'optional' },
                { label: copy('ต้องเลือก', 'Required'), value: 'required' },
              ]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField label={copy('ขั้นต่ำ', 'Minimum')} value={String(group.min_select)} onChangeText={(value) => updateGroup(groupIndex, { min_select: toInt(value, 0) })} keyboardType="number-pad" error={minIssue ? optionIssueMessage(minIssue.code) : undefined} />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label={copy('สูงสุด', 'Maximum')} value={String(group.max_select)} onChangeText={(value) => updateGroup(groupIndex, { max_select: Math.max(1, toInt(value, 1)) })} keyboardType="number-pad" error={maxIssue ? optionIssueMessage(maxIssue.code) : undefined} />
              </View>
            </View>
            {groupIssue ? <Feedback title={optionIssueMessage(groupIssue.code)} tone="danger" /> : null}
            {group.options.map((option, optionIndex) => {
              const optionNameIssue = optionIssue(groupIndex, ['option_name_required', 'option_name_too_long', 'option_name_duplicate'], optionIndex);
              const optionPriceIssue = optionIssue(groupIndex, ['option_price_negative', 'option_price_too_large'], optionIndex);
              return (
                <View key={optionIndex} style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text style={[typeScale.caption, { flex: 1, fontWeight: '700' }]}>
                      {copy(`ตัวเลือก ${(optionIndex + 1).toLocaleString('th-TH')}`, `Option ${(optionIndex + 1).toLocaleString('en-US')}`)}
                    </Text>
                    <Button compact icon="close-outline" variant="ghost" label={copy('ลบ', 'Remove')} onPress={() => updateGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) })} />
                  </View>
                  <TextField label={copy('ชื่อ', 'Name')} value={option.name} onChangeText={(value) => updateOption(groupIndex, optionIndex, { name: value })} error={optionNameIssue ? optionIssueMessage(optionNameIssue.code) : undefined} />
                  <TextField label={copy('ราคาเพิ่ม', 'Additional price')} value={option.price_delta} onChangeText={(value) => updateOption(groupIndex, optionIndex, { price_delta: value })} keyboardType="decimal-pad" error={optionPriceIssue ? optionIssueMessage(optionPriceIssue.code) : undefined} />
                </View>
              );
            })}
            <Button icon="add-outline" variant="secondary" label={copy('เพิ่มตัวเลือก', 'Add option')} onPress={() => addOption(groupIndex)} />
          </View>
        );
      })}
      {!optionGroups.length ? <EmptyState title={copy('ยังไม่มีตัวเลือก', 'No item options')} detail={copy('เพิ่มเฉพาะเมนูที่ต้องเลือกรูปแบบก่อนสั่ง', 'Add options only when guests need to choose before ordering.')} /> : null}
    </Surface>
  );

  const recipePanel = (
    <Surface>
      <SectionHeader title={copy('สูตรวัตถุดิบ', 'Ingredient recipe')} detail={copy('ใช้คำนวณต้นทุนและตัดสต็อก', 'Used for costing and stock deduction')} />
      {ingredients.map((row, index) => {
        const item = allIngredients.find((current) => current.ID === row.ingredient_id);
        return (
          <View key={`${row.ingredient_id}-${index}`} style={{ gap: spacing.sm }}>
            {index ? <Divider /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={[typeScale.cardTitle, { flex: 1 }]}>{item?.name || copy(`วัตถุดิบ #${row.ingredient_id}`, `Ingredient #${row.ingredient_id}`)}</Text>
              <Button compact icon="close-outline" variant="ghost" label={copy('ลบ', 'Remove')} onPress={() => setIngredients((current) => current.filter((_, currentIndex) => currentIndex !== index))} />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField label={copy('จำนวนต่อจาน', 'Per serving')} value={row.quantity} onChangeText={(value) => setIngredients((current) => current.map((currentRow, currentIndex) => currentIndex === index ? { ...currentRow, quantity: value } : currentRow))} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label={copy('หน่วย', 'Unit')} value={row.unit || item?.unit || ''} onChangeText={(value) => setIngredients((current) => current.map((currentRow, currentIndex) => currentIndex === index ? { ...currentRow, unit: value } : currentRow))} />
              </View>
            </View>
          </View>
        );
      })}
      {ingredientOptions.length > 1 ? (
        <>
          <ChipGroup label={copy('เลือกวัตถุดิบ', 'Choose ingredient')} value={ingredientCandidate} onChange={setIngredientCandidate} options={ingredientOptions} />
          <Button icon="add-outline" variant="secondary" label={copy('เพิ่มในสูตร', 'Add to recipe')} onPress={addIngredient} disabled={ingredientCandidate === 'none'} />
        </>
      ) : null}
      {!ingredients.length && ingredientOptions.length <= 1 ? <EmptyState title={copy('ยังไม่มีสูตรวัตถุดิบ', 'No ingredient recipe')} /> : null}
    </Surface>
  );

  const deletePanel = editing ? (
    <Surface style={{ borderColor: confirmDelete ? palette.danger : palette.border }}>
      <SectionHeader
        title={copy('ลบเมนู', 'Delete menu item')}
        detail={confirmDelete
          ? copy('แตะยืนยันอีกครั้งเพื่อลบเมนูถาวร', 'Confirm again to permanently delete this item.')
          : copy('ถ้าหยุดขายชั่วคราว ให้ใช้สถานะปิดขาย', 'For a temporary pause, mark the item unavailable.')}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {confirmDelete ? <Button variant="secondary" label={copy('ยกเลิก', 'Cancel')} onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} /> : null}
        <Button icon="trash-outline" variant={confirmDelete ? 'danger' : 'secondary'} label={confirmDelete ? copy('ยืนยันลบเมนู', 'Confirm delete') : copy('ลบเมนู', 'Delete menu item')} onPress={remove} style={{ flex: 1 }} />
      </View>
    </Surface>
  ) : null;

  return (
    <AppScreen
      title={editing ? copy('แก้ไขเมนู', 'Edit menu item') : copy('เพิ่มเมนู', 'Add menu item')}
      subtitle={copy('ข้อมูลขาย ตัวเลือก และสูตรวัตถุดิบ', 'Sales details, options, and ingredient recipe')}
      topLevel={false}
      footer={(
        <ActionDock>
          <Button
            disabled={saving || imageEditing || uploadingImage}
            icon="save-outline"
            label={editing ? copy('บันทึกเมนู', 'Save menu item') : copy('เพิ่มเมนู', 'Add menu item')}
            loading={saving}
            onPress={save}
          />
        </ActionDock>
      )}
    >
      {error ? <Feedback title={error.title} detail={error.detail} tone="danger" /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ minWidth: 0, width: tabletWorkspace ? undefined : '100%', flex: tabletWorkspace ? 0.9 : undefined, gap: spacing.lg }}>
          {detailsPanel}
          {recipePanel}
          {deletePanel}
        </View>
        <View style={{ minWidth: 0, width: tabletWorkspace ? undefined : '100%', flex: tabletWorkspace ? 1.1 : undefined }}>
          {optionsPanel}
        </View>
      </View>
    </AppScreen>
  );
}
