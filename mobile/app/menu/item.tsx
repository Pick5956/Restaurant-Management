import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { listIngredients } from '@/src/api/ingredient';
import { createMenuItem, deleteMenuItem, listCategories, listMenuItems, previewMenuImageBackground, updateMenuItem, uploadMenuImage } from '@/src/api/menu';
import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { DangerAction, Field, FieldRow, FoldBody, FoldChevron, FORM_MAX_WIDTH, FormBody, FormCard, PillTabs, SaveDock, SwitchRow, ToggleChips } from '@/src/components/form/parts';
import { SheetTitle } from '@/src/components/inventory/parts';
import { MenuImageCropper } from '@/src/components/menu-image-cropper';
import { StateMessage } from '@/src/components/mobile-screen';
import { Button, EmptyState, Feedback, SearchField } from '@/src/components/ui';
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
import { breakpoints, palette, spacing } from '@/src/theme';
import type { Ingredient } from '@/src/types/ingredient';
import type { Category } from '@/src/types/menu';

// Adding or editing one dish, redrawn on 25 ก.ย. 2569 on the form pieces the
// settings, staff and expense editors already use. The photo leads the page,
// then one card each for the dish, its categories, its option groups and its
// recipe, with deleting as the quiet red line at the foot. Being on sale is a
// switch here now; the old screen carried the value but had no control for it.

const PRICE_WIDTH = 116;
// About three rows of chips on a phone before the rest fold behind "+ อีก N หมวด".
const CATEGORY_CHIPS_SHOWN = 9;

type FoldableCard = 'details' | 'categories' | 'options' | 'recipe';

const emptyGroup = (index: number): MenuOptionGroupDraft => ({ name: '', required: false, min_select: 0, max_select: 1, display_order: index + 1, is_active: true, options: [] });

/** A round tap target for removing a row. */
function RemoveTap({ label, onPress, icon = 'close' }: { label: string; onPress: () => void; icon?: AppIconName }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? palette.surfaceSubtle : 'transparent' })}
    >
      <AppIcon name={icon} size={18} color={palette.placeholder} />
    </Pressable>
  );
}

/** "+ เพิ่ม…" in orange ink: a card heading's action, or the line under a list. */
function AddLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
    >
      <AppIcon name="add" size={17} color={palette.primaryInk} />
      <Text style={{ fontSize: 13.5, fontWeight: '600', color: palette.primaryInk }}>{label}</Text>
    </Pressable>
  );
}

/** The quiet line a list shows when it has nothing in it. */
function NoneLine({ text }: { text: string }) {
  return <Text style={{ fontSize: 13.5, color: palette.placeholder }}>{text}</Text>;
}

function ErrorLine({ text }: { text: string }) {
  return <Text accessibilityRole="alert" style={{ fontSize: 12, lineHeight: 17, fontWeight: '600', color: palette.danger }}>{text}</Text>;
}

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
  const tablet = width >= breakpoints.tabletWorkspace;

  const [categories, setCategories] = useState<Category[]>([]);
  const [allIngredients, setAllIngredients] = useState<Ingredient[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [displayOrder, setDisplayOrder] = useState('1');
  const [available, setAvailable] = useState(true);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [optionGroups, setOptionGroups] = useState<MenuOptionGroupDraft[]>([]);
  // Which option groups are unfolded, index for index with `optionGroups`. A
  // dish with many groups would be pages of fields: saved groups load folded to
  // one line each, a new one opens, and a save with a problem opens its group.
  const [groupOpen, setGroupOpen] = useState<boolean[]>([]);
  const [foldedCards, setFoldedCards] = useState<FoldableCard[]>([]);
  const [ingredients, setIngredients] = useState<MenuIngredientDraft[]>([]);
  const [pickingIngredient, setPickingIngredient] = useState(false);
  const [ingredientQuery, setIngredientQuery] = useState('');
  // `error` is the step that failed, and the app's line under it when there is one.
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageEditing, setImageEditing] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  // Set by the first save: from then on an empty name, price or category, and
  // every option problem, is marked under its own field.
  const [showProblems, setShowProblems] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [itemExists, setItemExists] = useState<boolean | null>(editing ? null : true);

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
        setName(item.name); setPrice(String(item.price)); setDescription(item.description || ''); setImageUrl(item.image_url || ''); setDisplayOrder(String(item.display_order)); setAvailable(item.is_available);
        setCategoryIds(initialMenuCategoryIds(item, categoryResponse.categories || []));
        // Option ingredient links are authored on the web only, but they are read
        // here and posted back untouched. A save replaces the whole option
        // aggregate, so dropping them on the way in deletes them on the way out.
        setOptionGroups(menuOptionGroupDrafts((item.option_groups || []).map((group) => ({ name: group.name, required: group.required, min_select: group.min_select, max_select: group.max_select, display_order: group.display_order, is_active: group.is_active, options: (group.options || []).map((option) => ({ name: option.name, price_delta: option.price_delta, is_default: option.is_default, display_order: option.display_order, is_active: option.is_active, ingredients: (option.ingredients || []).map((row) => ({ ingredient_id: row.ingredient_id, direction: row.direction, quantity: row.quantity, unit: row.unit })) })) }))));
        setGroupOpen((item.option_groups || []).map(() => false));
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

  const pickableIngredients = useMemo(() => {
    const query = ingredientQuery.trim().toLowerCase();
    return allIngredients
      .filter((item) => !ingredients.some((row) => row.ingredient_id === item.ID))
      .filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [allIngredients, ingredientQuery, ingredients]);
  const canAddIngredient = allIngredients.some((item) => !ingredients.some((row) => row.ingredient_id === item.ID));
  const optionValidation = useMemo(() => validateMenuOptionGroups(menuOptionGroupInputs(optionGroups)), [optionGroups]);

  function addGroup() {
    setOptionGroups((current) => [...current, emptyGroup(current.length)]);
    setGroupOpen((current) => [...current, true]);
    setFoldedCards((current) => current.filter((card) => card !== 'options'));
  }
  function removeGroup(groupIndex: number) {
    setOptionGroups((current) => current.filter((_, index) => index !== groupIndex));
    setGroupOpen((current) => current.filter((_, index) => index !== groupIndex));
  }
  function toggleGroup(groupIndex: number) { setGroupOpen((current) => optionGroups.map((_, index) => index === groupIndex ? !current[index] : Boolean(current[index]))); }
  function folded(card: FoldableCard) { return foldedCards.includes(card); }
  function toggleCard(card: FoldableCard) { setFoldedCards((current) => current.includes(card) ? current.filter((value) => value !== card) : [...current, card]); }
  function toggleCategory(categoryId: number) { setCategoryIds((current) => current.includes(categoryId) ? current.filter((value) => value !== categoryId) : [...current, categoryId]); }
  function updateGroup(index: number, patch: Partial<MenuOptionGroupDraft>) { setOptionGroups((current) => current.map((group, currentIndex) => currentIndex === index ? { ...group, ...patch } : group)); }
  function updateOption(groupIndex: number, optionIndex: number, patch: Partial<MenuOptionGroupDraft['options'][number]>) { setOptionGroups((current) => current.map((group, currentGroupIndex) => currentGroupIndex === groupIndex ? { ...group, options: group.options.map((option, currentOptionIndex) => currentOptionIndex === optionIndex ? { ...option, ...patch } : option) } : group)); }
  function addOption(groupIndex: number) { setOptionGroups((current) => current.map((group, index) => index === groupIndex ? { ...group, options: [...group.options, { name: '', price_delta: '0', is_default: false, display_order: group.options.length + 1, is_active: true }] } : group)); }
  function removeOption(groupIndex: number, optionIndex: number) { setOptionGroups((current) => current.map((group, index) => index === groupIndex ? { ...group, options: group.options.filter((_, currentIndex) => currentIndex !== optionIndex) } : group)); }
  function addIngredient(item: Ingredient) {
    setIngredients((current) => [...current, { ingredient_id: item.ID, quantity: '1', unit: item.unit || '', note: '' }]);
    setPickingIngredient(false);
    setIngredientQuery('');
  }

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

  function optionIssue(groupIndex: number, codes: MenuOptionGroupIssueCode[], optionIndex?: number) {
    if (!showProblems) return undefined;
    const issue = optionValidation.issues.find((current) =>
      current.groupIndex === groupIndex
      && current.optionIndex === optionIndex
      && codes.includes(current.code));
    return issue ? optionIssueMessage(issue.code) : undefined;
  }

  async function save() {
    if (!canManage || invalidRoute) return;
    if (editing && (itemId === null || itemExists !== true)) return;
    if (imageEditing || uploadingImage) return;
    setShowProblems(true);
    setError(null);
    // A problem inside a folded card or group would be marked where nobody can
    // see it, so every place that has one opens.
    const broken = new Set(optionValidation.issues.map((issue) => issue.groupIndex));
    const reopen: FoldableCard[] = [
      ...(!name.trim() || !price ? ['details' as const] : []),
      ...(!categoryIds.length ? ['categories' as const] : []),
      ...(optionValidation.issues.length ? ['options' as const] : []),
    ];
    if (reopen.length) setFoldedCards((current) => current.filter((card) => !reopen.includes(card)));
    if (broken.size) setGroupOpen((current) => optionGroups.map((_, index) => broken.has(index) || Boolean(current[index])));
    if (!name.trim() || !price || !categoryIds.length) return;
    if (optionValidation.issues.length) return;
    setSaving(true);
    try {
      const payload = { category_id: categoryIds[0], category_ids: categoryIds, name: name.trim(), price: toFloat(price, 0), image_url: imageUrl.trim(), description: description.trim(), is_available: available, display_order: toInt(displayOrder, 0), option_groups: optionValidation.groups, ingredients: menuIngredientInputs(ingredients) };
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
    setSaving(true); setError(null);
    try { await deleteMenuItem(itemId); router.back(); }
    catch (err) { setError({ title: copy('ลบเมนูไม่สำเร็จ', 'Could not delete the menu item'), detail: apiFailureDetail(err, language) }); setSaving(false); }
  }

  const title = editing ? copy('แก้ไขเมนู', 'Edit menu item') : copy('เพิ่มเมนู', 'Add menu item');

  if (invalidRoute) {
    return (
      <AppScreen title={copy('รายละเอียดเมนู', 'Menu item details')} topLevel={false} centerTitle>
        <EmptyState
          title={copy('ไม่พบเมนู', 'Menu item not found')}
          action={<Button variant="secondary" label={copy('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />}
        />
      </AppScreen>
    );
  }

  if (!canManage) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <StateMessage
          title={copy('ไม่มีสิทธิ์จัดการเมนู', 'Menu management unavailable')}
          detail={copy('บัญชีนี้ต้องมีสิทธิ์จัดการเมนู', 'This account needs permission to manage the menu.')}
        />
      </AppScreen>
    );
  }

  if (editing && itemExists !== true) {
    const stateTitle = loading
      ? copy('กำลังโหลดเมนู', 'Loading menu item')
      : error
        ? copy('โหลดเมนูไม่สำเร็จ', 'Unable to load menu item')
        : copy('ไม่พบเมนู', 'Menu item not found');
    return (
      <AppScreen title={copy('รายละเอียดเมนู', 'Menu item details')} topLevel={false} centerTitle>
        <EmptyState
          title={stateTitle}
          detail={loading ? undefined : error?.detail}
          action={loading ? undefined : (
            <Button variant="secondary" label={copy('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />
          )}
        />
      </AppScreen>
    );
  }

  const tooManyGroups = showProblems && optionValidation.issues.some((issue) => issue.code === 'too_many_groups');
  const categoryOptions = selectableMenuCategories(categories, categoryIds).map((item) => ({
    key: item.ID,
    label: item.is_active ? item.name : copy(`${item.name} (ปิด)`, `${item.name} (inactive)`),
    muted: !item.is_active,
  }));

  return (
    <AppScreen
      title={title}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
      footer={confirmDelete ? undefined : (
        <SaveDock
          disabled={saving || imageEditing || uploadingImage}
          icon="checkmark"
          label={editing ? copy('บันทึกเมนู', 'Save menu item') : copy('เพิ่มเมนู', 'Add menu item')}
          loading={saving}
          onPress={save}
        />
      )}
    >
      {error ? <Feedback title={error.title} detail={error.detail} tone="danger" /> : null}
      <View style={{ gap: spacing.md }}>
        {/* The same element whether the photo is shown or being framed, so
            opening the framer never remounts it and loses the picked photo. */}
        <View style={imageEditing ? { borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: palette.divider, backgroundColor: palette.surface, padding: 14 } : { paddingVertical: spacing.sm }}>
          <MenuImageCropper
            copy={copy}
            currentImageUrl={imageUrl}
            disabled={saving || uploadingImage}
            onEditingChange={setImageEditing}
            onError={(message) => setImageError(message || null)}
            onPreview={previewMenuImageBackground}
            onUpload={uploadImage}
          />
          {imageError ? <View style={{ paddingTop: spacing.sm, alignItems: imageEditing ? 'flex-start' : 'center' }}><ErrorLine text={imageError} /></View> : null}
          {uploadingImage ? (
            <Text style={{ paddingTop: spacing.sm, textAlign: imageEditing ? 'left' : 'center', fontSize: 12.5, color: palette.muted }}>
              {copy('กำลังอัปโหลดรูป...', 'Uploading image...')}
            </Text>
          ) : null}
        </View>

        <FormCard
          icon="restaurant-outline"
          title={copy('ข้อมูลเมนู', 'Menu details')}
          collapsed={folded('details')}
          onToggle={() => toggleCard('details')}
          detail={folded('details') ? [name.trim() || copy('ไม่มีชื่อ', 'No name'), price ? copy(`${price} บาท`, `${price} THB`) : copy('ไม่มีราคา', 'No price'), available ? copy('เปิดขาย', 'On sale') : copy('ปิดขาย', 'Off sale')].join(', ') : undefined}
        >
          <FormBody>
            <Field
              label={copy('ชื่อเมนู', 'Item name')}
              value={name}
              onChangeText={setName}
              maxLength={120}
              error={showProblems && !name.trim() ? copy('กรอกชื่อเมนู', 'Enter the item name') : undefined}
            />
            <Field
              label={copy('ราคา', 'Price')}
              value={price}
              onChangeText={(value) => setPrice(value.replace(/[^\d.]/g, ''))}
              keyboardType="decimal-pad"
              unit={copy('บาท', 'THB')}
              placeholder="0"
              error={showProblems && !price ? copy('กรอกราคา', 'Enter the price') : undefined}
            />
            <Field
              label={copy('คำอธิบาย', 'Description')}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />
          </FormBody>
          <SwitchRow title={copy('เปิดขาย', 'On sale')} value={available} onChange={setAvailable} />
        </FormCard>

        <FormCard
          icon="pricetags-outline"
          title={copy('หมวดเมนู', 'Menu categories')}
          collapsed={folded('categories')}
          onToggle={() => toggleCard('categories')}
          detail={folded('categories') ? (categories.filter((item) => categoryIds.includes(item.ID)).map((item) => item.name).join(', ') || copy('ไม่มีหมวด', 'No category')) : undefined}
        >
          <FormBody>
            {categoryOptions.length ? (
              <ToggleChips
                options={categoryOptions}
                selected={categoryIds}
                onToggle={toggleCategory}
                limit={CATEGORY_CHIPS_SHOWN}
                moreLabel={(hidden) => copy(`+ อีก ${hidden} หมวด`, `+ ${hidden} more`)}
                lessLabel={copy('แสดงน้อยลง', 'Show fewer')}
              />
            ) : (
              <NoneLine text={copy('ยังไม่มีหมวดเมนู', 'No menu categories yet')} />
            )}
            {showProblems && !categoryIds.length ? <ErrorLine text={copy('เลือกอย่างน้อย 1 หมวด', 'Choose at least one category')} /> : null}
          </FormBody>
        </FormCard>

        <FormCard
          icon="options-outline"
          title={copy('ตัวเลือกเมนู', 'Item options')}
          collapsed={folded('options')}
          onToggle={() => toggleCard('options')}
          detail={folded('options') ? (optionGroups.length ? copy(`${optionGroups.length} กลุ่ม`, `${optionGroups.length} groups`) : copy('ไม่มีตัวเลือก', 'No options')) : undefined}
          trailing={<AddLink label={copy('เพิ่มกลุ่ม', 'Add group')} onPress={addGroup} />}
        >
          {!optionGroups.length ? (
            <FormBody><NoneLine text={copy('ไม่มีตัวเลือก', 'No options')} /></FormBody>
          ) : null}
          {tooManyGroups ? <FormBody><ErrorLine text={optionIssueMessage('too_many_groups')} /></FormBody> : null}
          {optionGroups.map((group, groupIndex) => {
            const groupProblem = optionIssue(groupIndex, ['option_required', 'too_many_options']);
            const groupName = group.name.trim() || copy('ไม่มีชื่อกลุ่ม', 'Unnamed group');
            const open = Boolean(groupOpen[groupIndex]);
            const rule = group.required ? copy('ต้องเลือก', 'Required') : copy('ไม่บังคับ', 'Optional');
            const count = group.options.length
              ? copy(`${group.options.length} ตัวเลือก`, `${group.options.length} options`)
              : copy('ไม่มีตัวเลือก', 'No options');
            return (
              <View key={groupIndex} style={{ borderTopWidth: 1, borderTopColor: palette.divider }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${groupName}, ${rule}, ${count}`}
                  accessibilityState={{ expanded: open }}
                  onPress={() => toggleGroup(groupIndex)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58, paddingHorizontal: 14, paddingVertical: 8 }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: group.name.trim() ? palette.textStrong : palette.placeholder }}>{groupName}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>{`${rule}, ${count}`}</Text>
                  </View>
                  <FoldChevron open={open} />
                </Pressable>
                <FoldBody open={open}>
                <FormBody>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 2 }}>
                    <Field
                      grow
                      accessibilityLabel={copy('ชื่อกลุ่ม', 'Group name')}
                      value={group.name}
                      onChangeText={(value) => updateGroup(groupIndex, { name: value })}
                      placeholder={copy('ชื่อกลุ่ม เช่น ระดับความเผ็ด', 'Group name, e.g. Spice level')}
                      maxLength={120}
                      error={optionIssue(groupIndex, ['group_name_required', 'group_name_too_long', 'group_name_duplicate'])}
                    />
                    <View style={{ paddingTop: 4 }}>
                      <RemoveTap
                        icon="trash-outline"
                        label={copy(`ลบกลุ่ม ${groupName}`, `Remove group ${groupName}`)}
                        onPress={() => removeGroup(groupIndex)}
                      />
                    </View>
                  </View>
                  <PillTabs
                    role="radiogroup"
                    tabs={[
                      { key: 'optional', label: copy('ไม่บังคับ', 'Optional') },
                      { key: 'required', label: copy('ต้องเลือก', 'Required') },
                    ]}
                    value={group.required ? 'required' : 'optional'}
                    onChange={(value) => updateGroup(groupIndex, {
                      required: value === 'required',
                      min_select: value === 'required' ? Math.max(1, group.min_select) : 0,
                    })}
                  />
                  <FieldRow>
                    <Field
                      grow
                      label={copy('เลือกอย่างน้อย', 'At least')}
                      value={String(group.min_select)}
                      onChangeText={(value) => updateGroup(groupIndex, { min_select: toInt(value, 0) })}
                      keyboardType="number-pad"
                      unit={copy('รายการ', 'items')}
                      error={optionIssue(groupIndex, ['min_exceeds_active_options'])}
                    />
                    <Field
                      grow
                      label={copy('เลือกได้สูงสุด', 'At most')}
                      value={String(group.max_select)}
                      onChangeText={(value) => updateGroup(groupIndex, { max_select: Math.max(1, toInt(value, 1)) })}
                      keyboardType="number-pad"
                      unit={copy('รายการ', 'items')}
                      error={optionIssue(groupIndex, ['max_below_min', 'max_too_large', 'defaults_exceed_max'])}
                    />
                  </FieldRow>
                  {group.options.length ? (
                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', gap: 8, paddingRight: 42 }}>
                        <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{copy('ตัวเลือก', 'Option')}</Text>
                        <Text style={{ width: PRICE_WIDTH, fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{copy('ราคาเพิ่ม', 'Extra price')}</Text>
                      </View>
                      {group.options.map((option, optionIndex) => (
                        <View key={optionIndex} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                          <Field
                            grow
                            accessibilityLabel={copy(`ชื่อตัวเลือก ${optionIndex + 1}`, `Option ${optionIndex + 1} name`)}
                            value={option.name}
                            onChangeText={(value) => updateOption(groupIndex, optionIndex, { name: value })}
                            maxLength={120}
                            error={optionIssue(groupIndex, ['option_name_required', 'option_name_too_long', 'option_name_duplicate'], optionIndex)}
                          />
                          <Field
                            width={PRICE_WIDTH}
                            accessibilityLabel={copy(`ราคาเพิ่มของตัวเลือก ${optionIndex + 1}`, `Option ${optionIndex + 1} extra price`)}
                            value={option.price_delta}
                            onChangeText={(value) => updateOption(groupIndex, optionIndex, { price_delta: value })}
                            keyboardType="decimal-pad"
                            unit="฿"
                            error={optionIssue(groupIndex, ['option_price_negative', 'option_price_too_large'], optionIndex)}
                          />
                          <View style={{ paddingTop: 4 }}>
                            <RemoveTap label={copy(`ลบตัวเลือก ${optionIndex + 1}`, `Remove option ${optionIndex + 1}`)} onPress={() => removeOption(groupIndex, optionIndex)} />
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {groupProblem ? <ErrorLine text={groupProblem} /> : null}
                  <AddLink label={copy('เพิ่มตัวเลือก', 'Add option')} onPress={() => addOption(groupIndex)} />
                </FormBody>
                </FoldBody>
              </View>
            );
          })}
        </FormCard>

        {canViewInventory || ingredients.length ? (
          <FormCard
            icon="basket-outline"
            title={copy('สูตรวัตถุดิบ', 'Ingredient recipe')}
            collapsed={folded('recipe')}
            onToggle={() => toggleCard('recipe')}
            detail={folded('recipe') ? (ingredients.length ? copy(`${ingredients.length} วัตถุดิบ`, `${ingredients.length} ingredients`) : copy('ไม่มีสูตร', 'No recipe')) : undefined}
            trailing={canAddIngredient ? <AddLink label={copy('เพิ่ม', 'Add')} onPress={() => setPickingIngredient(true)} /> : undefined}
          >
            <FormBody>
              {!ingredients.length ? <NoneLine text={copy('ไม่มีสูตรวัตถุดิบ', 'No ingredient recipe')} /> : null}
              {ingredients.map((row, index) => {
                const item = allIngredients.find((current) => current.ID === row.ingredient_id);
                const ingredientName = item?.name || copy(`วัตถุดิบ #${row.ingredient_id}`, `Ingredient #${row.ingredient_id}`);
                return (
                  <View key={`${row.ingredient_id}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{ingredientName}</Text>
                    <Field
                      width={PRICE_WIDTH + 12}
                      accessibilityLabel={copy(`${ingredientName} ต่อจาน`, `${ingredientName} per serving`)}
                      value={row.quantity}
                      onChangeText={(value) => setIngredients((current) => current.map((currentRow, currentIndex) => currentIndex === index ? { ...currentRow, quantity: value } : currentRow))}
                      keyboardType="decimal-pad"
                      unit={row.unit || item?.unit || undefined}
                    />
                    <RemoveTap label={copy(`เอา ${ingredientName} ออกจากสูตร`, `Remove ${ingredientName} from the recipe`)} onPress={() => setIngredients((current) => current.filter((_, currentIndex) => currentIndex !== index))} />
                  </View>
                );
              })}
            </FormBody>
          </FormCard>
        ) : null}

        {editing ? (
          <View style={{ paddingTop: spacing.sm }}>
            <DangerAction
              icon="trash-outline"
              label={copy('ลบเมนูนี้', 'Delete this item')}
              confirmLabel={copy('ยืนยันลบ', 'Confirm delete')}
              cancelLabel={copy('เก็บไว้', 'Keep it')}
              message={copy('ลบแล้วเอากลับไม่ได้ ถ้าแค่หยุดขายชั่วคราว ให้ปิดเปิดขายแทน', 'This cannot be undone. To pause it for now, turn off On sale instead.')}
              open={confirmDelete}
              onOpen={() => setConfirmDelete(true)}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={remove}
              loading={saving}
            />
          </View>
        ) : null}
      </View>

      <BottomSheet open={pickingIngredient} onClose={() => { setPickingIngredient(false); setIngredientQuery(''); }} heightFraction={0.72} keyboardLift label={copy('ปิด', 'Close')} showClose>
        <SheetTitle title={copy('เลือกวัตถุดิบ', 'Choose an ingredient')} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <SearchField
            value={ingredientQuery}
            onChangeText={setIngredientQuery}
            placeholder={copy('ค้นหาวัตถุดิบ', 'Search ingredients')}
            accessibilityLabel={copy('ค้นหาวัตถุดิบ', 'Search ingredients')}
            clearLabel={copy('ล้างคำค้น', 'Clear search')}
          />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {pickableIngredients.map((item, index) => (
            <Pressable
              key={item.ID}
              accessibilityRole="button"
              onPress={() => addIngredient(item)}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, borderTopWidth: index ? 1 : 0, borderTopColor: '#F3EDE7', backgroundColor: pressed ? palette.surfaceSubtle : 'transparent' })}
            >
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '500', color: palette.textStrong }}>{item.name}</Text>
              <Text style={{ fontSize: 13, color: palette.placeholder }}>{item.unit || copy('ไม่มีหน่วย', 'no unit')}</Text>
            </Pressable>
          ))}
          {!pickableIngredients.length ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <NoneLine text={copy('ไม่พบวัตถุดิบ', 'No ingredients found')} />
            </View>
          ) : null}
        </ScrollView>
      </BottomSheet>
    </AppScreen>
  );
}
