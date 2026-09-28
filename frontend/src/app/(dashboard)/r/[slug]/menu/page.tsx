"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Plus, Search, X } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { formatCurrency } from "@/src/lib/format";
import { createCategory, createMenuItem, deleteCategory, deleteMenuItem, listCategories, listMenuItems, updateCategory, updateMenuItem, updateMenuItemAvailability, uploadMenuImage } from "@/src/lib/menu";
import { listIngredients } from "@/src/lib/ingredient";
import { LOW_STOCK_THRESHOLD, MENU_CARD_GRID_CLASS, MENU_CARD_SHELL_CLASS, menuStockBadgeClass } from "@/src/lib/menuGrid";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { apiErrorCode } from "@/src/lib/apiErrors";
import type { Category, MenuIngredientInput, MenuItem, MenuItemInput, MenuOptionGroupInput, MenuOptionIngredientInput } from "@/src/types/menu";
import type { Ingredient } from "@/src/types/ingredient";
import { RestaurantCardSkeleton } from "@/src/components/shared/Skeleton";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import SolidPencilIcon from "@/src/components/shared/SolidPencilIcon";
import ThemedMultiSelect from "@/src/components/shared/ThemedMultiSelect";
import { useDragReorder } from "@/src/hooks/useDragReorder";
import MenuImageCropper, { type MenuImageCropperHandle } from "@/src/components/menu/MenuImageCropper";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import WarmConfirmDialog from "@/src/components/shared/WarmConfirmDialog";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import NumberInput from "@/src/components/shared/NumberInput";
import { SEALED_UNITS } from "../inventory/inventoryPageUtils";
import {
  AvailabilitySwitch,
  CountStepper,
  SettingSwitch,
  emptyItem,
  emptyOptionGroup,
  emptyOptionIngredient,
  emptyRecipeComponent,
  menuCategoryIds,
  menuItemToInput,
  recipeCost,
  stockUnitsPer,
} from "./menuPageUtils";

type DeleteTarget =
  | { type: "category"; id: number; name: string }
  | { type: "item"; id: number; name: string };
type ItemEditorTab = "basic" | "options" | "recipe";

// The menu page keeps the white bordered boxes (owner, 2026-09-22): the flat
// tinted settings look was tried here and dropped.
// Typed text is set to the same black as the field labels (owner, 27 ก.ย. 2569):
// left to inherit, it came out a different shade from the label above it.
const WHITE_FIELD = "border border-gray-200 bg-white text-gray-900 outline-none transition-colors focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white";
const WHITE_FIELD_ERROR = "border border-red-300 bg-white text-gray-900 outline-none transition-colors focus:border-orange-500 dark:border-red-900/60 dark:bg-gray-800 dark:text-white";
const fieldLook = (invalid = false) => (invalid ? WHITE_FIELD_ERROR : WHITE_FIELD);

export default function MenuPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const canManage = can(activeMembership, "manage_menu");
  const canView = canManage || can(activeMembership, "view_menu");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [recipeIngredients, setRecipeIngredients] = useState<Ingredient[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [inlineCategoryName, setInlineCategoryName] = useState("");
  const [inlineCategorySaving, setInlineCategorySaving] = useState(false);
  const [inlineCategoryError, setInlineCategoryError] = useState("");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [itemForm, setItemForm] = useState<MenuItemInput>(emptyItem);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [filterCategory, setFilterCategory] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [availabilitySubmittingId, setAvailabilitySubmittingId] = useState<number | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageEditorRef = useRef<MenuImageCropperHandle>(null);
  const [error, setError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [itemErrors, setItemErrors] = useState<{ category?: string; name?: string; submit?: string; image?: string; options?: string }>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [itemEditorTab, setItemEditorTab] = useState<ItemEditorTab>("basic");
  // Only one option set is expanded at a time, so the tab stays a list you can
  // scan rather than a column of open forms.
  const [openOptionGroup, setOpenOptionGroup] = useState<number | null>(null);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const [categoryModalClosing, setCategoryModalClosing] = useState(false);
  const [deleteClosing, setDeleteClosing] = useState(false);
  const saveCategoryOnceRef = useRef(createSingleFlight());
  const saveItemOnceRef = useRef(createSingleFlight());
  const deleteCategoryOnceRef = useRef(createSingleFlight());
  const deleteItemOnceRef = useRef(createSingleFlight());
  // The toolbar is a fixed bar under the mobile top bar; this reserves the exact
  // space it takes so the grid doesn't slide underneath it. On lg the bar is a
  // sticky element in normal flow (see [data-shell-sticky] in globals.css), so the
  // spacer is hidden there and no measurement is needed.
  const stickyToolbarRef = useRef<HTMLDivElement>(null);
  const [stickyToolbarHeight, setStickyToolbarHeight] = useState(0);

  const copy = language === "th"
    ? {
        permissionDenied: "ไม่มีสิทธิ์ดูเมนู",
        title: "เมนูอาหาร",
        loadError: "โหลดข้อมูลเมนูไม่สำเร็จ",
        categoryRequired: "กรุณากรอกชื่อหมวดหมู่",
        categorySaveError: "บันทึกหมวดหมู่ไม่สำเร็จ",
        categoryDuplicate: "มีหมวดหมู่ชื่อนี้อยู่แล้ว",
        itemCategoryRequired: "เลือกหมวดหมู่ก่อนเพิ่มเมนู",
        itemNameRequired: "กรอกชื่อเมนูที่ลูกค้าและพนักงานจำได้",
        itemSaveError: "บันทึกเมนูไม่สำเร็จ",
        categoryDeleteError: "ลบหมวดหมู่ไม่สำเร็จ",
        itemDeleteError: "ลบเมนูไม่สำเร็จ",
        categoryCreated: "เพิ่มหมวดหมู่แล้ว",
        categoryUpdated: "อัปเดตหมวดหมู่แล้ว",
        itemCreated: "เพิ่มเมนูแล้ว",
        itemUpdated: "อัปเดตเมนูแล้ว",
        categoryDeleted: "ลบหมวดหมู่แล้ว",
        itemDeleted: "ลบเมนูแล้ว",
        confirmDeleteTitle: "ยืนยันการลบ",
        confirmDeleteBody: "ต้องการลบรายการนี้ใช่ไหม? การทำงานนี้ย้อนกลับไม่ได้",
        confirmDelete: "ยืนยันลบ",
        cancel: "ยกเลิก",
        imageTypeError: "กรุณาเลือกไฟล์รูปภาพ",
        imageUploadError: "อัปโหลดรูปไม่สำเร็จ กรุณาใช้ไฟล์ jpg, png หรือ webp ขนาดไม่เกิน 5MB",
        allCategories: "ทุกหมวดหมู่",
        menuSummary: "เมนูทั้งหมด",
        categoryManager: "จัดหมวดหมู่",
        searchPlaceholder: "ค้นหาเมนู",
        available: "พร้อมขาย",
        unavailable: "ปิดขาย",
        delete: "ลบ",
        noMenuTitle: "ยังไม่มีเมนู",
        noMenuManage: "สร้างหมวดหมู่และเพิ่มเมนูแรกจากแผงด้านขวา",
        noMenuView: "เจ้าของร้านยังไม่ได้เปิดเมนูให้ดู",
        noCategories: "ยังไม่มีหมวดหมู่",
        editCategory: "แก้หมวดหมู่",
        addCategory: "เพิ่มหมวดหมู่",
        categoryPlaceholder: "เช่น อาหารจานเดียว / เครื่องดื่ม",
        saveCategory: "บันทึกหมวดหมู่",
        createCategory: "เพิ่มหมวดหมู่",
        addItem: "เพิ่มเมนู",
        itemCategories: "หมวดหมู่เมนู",
        inlineCategoryPlaceholder: "ชื่อหมวดใหม่",
        noCategory: "ไม่มีหมวด",
        createCategoryFirst: "สร้างหมวดหมู่ก่อนเพิ่มเมนู",
        noCategoryPicked: "เมนูนี้ยังไม่ได้อยู่หมวดไหน",
        moreCategories: (count: number) => `+${count} หมวด`,
        itemName: "ชื่อเมนู",
        itemNamePlaceholder: "เช่น ข้าวกะเพราหมูสับ",
        price: "ราคาเมนู (บาท)",
        pricePlaceholder: "เช่น 65",
        image: "รูปเมนู",
        chooseImage: "เลือกรูป",
        changeImage: "เปลี่ยนรูป",
        removeImage: "ลบรูป",
        rotateImage: "หมุนรูป",
        adjustImage: "ปรับตำแหน่งรูป",
        cropAria: "พื้นที่จัดวางรูป ใช้เมาส์ลากหรือปุ่มลูกศรเพื่อเลื่อนรูป",
        zoom: "Zoom",
        resetImage: "คืนค่าตำแหน่ง",
        useImage: "ใช้รูปนี้",
        preparingImage: "กำลังเตรียมรูป...",
        imageLoadError: "เปิดรูปเพื่อจัดวางไม่สำเร็จ กรุณาเลือกรูปใหม่",
        imageCropError: "จัดวางรูปไม่สำเร็จ กรุณาเลือกรูปใหม่",
        uploading: "กำลังอัปโหลดรูป...",
        imageHelp: "รองรับ jpg, png, webp ไม่เกิน 5MB",
        description: "รายละเอียดเมนู",
        descriptionPlaceholder: "เช่น เผ็ดน้อยได้ เพิ่มไข่ดาวได้",
        saveItem: "บันทึกเมนู",
        createItem: "เพิ่มเมนู",
        imageAlt: "รูปเมนู",
        optionsTitle: "ตัวเลือกที่ลูกค้าเลือกได้",
        optionsEmptyTitle: "เมนูนี้ยังไม่มีตัวเลือก",
        groupNameLabel: "ชื่อชุด",
        noChoicesYet: "ยังไม่มีตัวเลือก",
        stockHead: "วัตถุดิบ",
        addOptionIngredient: "ผูกวัตถุดิบกับตัวเลือกนี้",
        countLabel: "เลือกได้มากสุด",
        minLabel: "ต้องเลือกอย่างน้อย",
        pickCountLabel: "จำนวนที่เลือก",
        rangeTo: "ถึง",
        answerRequired: "ต้องเลือก",
        optionNameHead: "ชื่อตัวเลือก",
        optionPriceHead: "บวกเพิ่ม ฿",
        addOptionGroup: "เพิ่มชุดตัวเลือก",
        optionGroupPlaceholder: "เช่น ระดับความสุก",
        optionNamePlaceholder: "เช่น สุกปานกลาง",
        addOption: "เพิ่มตัวเลือก",
        removeOptionGroup: "ลบชุด",
        removeOption: "ลบ",
        optionError: "กรอกชื่อชุดตัวเลือกและอย่างน้อย 1 ตัวเลือก หรือปล่อยว่างทั้งชุด",
        recipeTitle: "สูตรวัตถุดิบ",
        addRecipeComponent: "เพิ่มวัตถุดิบ",
        noRecipe: "ไม่มีสูตรวัตถุดิบ",
        ingredient: "วัตถุดิบ",
        quantity: "จำนวน",
        unit: "หน่วย",
        note: "หมายเหตุ",
        removeComponent: "ลบ",
        recipeCost: "ต้นทุน",
        stockLeft: (n: number) => `เหลือ ${n}`,
        noStockLimit: "ไม่จำกัด",
        recipeCostUnset: "ไม่ระบุ",
        noIngredients: "เพิ่มวัตถุดิบในหน้า Inventory ก่อน",
      }
    : {
        permissionDenied: "You do not have permission to view the menu.",
        title: "Food menu",
        loadError: "Could not load menu data.",
        categoryRequired: "Please enter a category name.",
        categorySaveError: "Could not save category.",
        categoryDuplicate: "A category with this name already exists.",
        itemCategoryRequired: "Choose a category before adding a menu item.",
        itemNameRequired: "Enter a menu item name your team can recognize.",
        itemSaveError: "Could not save menu item.",
        categoryDeleteError: "Could not delete category.",
        itemDeleteError: "Could not delete menu item.",
        categoryCreated: "Category added",
        categoryUpdated: "Category updated",
        itemCreated: "Menu item added",
        itemUpdated: "Menu item updated",
        categoryDeleted: "Category deleted",
        itemDeleted: "Menu item deleted",
        confirmDeleteTitle: "Confirm delete",
        confirmDeleteBody: "Delete this item? This action cannot be undone.",
        confirmDelete: "Delete",
        cancel: "Cancel",
        imageTypeError: "Please choose an image file.",
        imageUploadError: "Could not upload image. Use jpg, png, or webp up to 5MB.",
        allCategories: "All categories",
        menuSummary: "Total items",
        categoryManager: "Manage categories",
        searchPlaceholder: "Search menu",
        available: "Available",
        unavailable: "Unavailable",
        delete: "Delete",
        noMenuTitle: "No menu items yet",
        noMenuManage: "Create a category and add the first menu item from the right panel.",
        noMenuView: "The owner has not made menu items visible yet.",
        noCategories: "No categories yet",
        editCategory: "Edit category",
        addCategory: "Add category",
        categoryPlaceholder: "For example, Main dishes / Drinks",
        saveCategory: "Save category",
        createCategory: "Add category",
        addItem: "Add menu item",
        itemCategories: "Menu categories",
        inlineCategoryPlaceholder: "New category name",
        noCategory: "No category",
        createCategoryFirst: "Create a category before adding a menu item",
        noCategoryPicked: "This dish is not in any category yet",
        moreCategories: (count: number) => `+${count} more`,
        itemName: "Menu item name",
        itemNamePlaceholder: "For example, Basil pork with rice",
        price: "Price (THB)",
        pricePlaceholder: "For example, 65",
        image: "Menu image",
        chooseImage: "Choose image",
        changeImage: "Change photo",
        removeImage: "Remove photo",
        rotateImage: "Rotate photo",
        adjustImage: "Adjust image",
        cropAria: "Image positioning area. Drag or use the arrow keys to move the image.",
        zoom: "Zoom",
        resetImage: "Reset position",
        useImage: "Use this image",
        preparingImage: "Preparing image...",
        imageLoadError: "Could not open this image for positioning. Choose a new image.",
        imageCropError: "Could not position this image. Choose a new image.",
        uploading: "Uploading image...",
        imageHelp: "Supports jpg, png, webp up to 5MB",
        description: "Menu description",
        descriptionPlaceholder: "For example, mild spice available, add fried egg",
        saveItem: "Save menu item",
        createItem: "Add menu item",
        imageAlt: "Menu image",
        optionsTitle: "Choices the customer can pick",
        optionsEmptyTitle: "This dish has no choices yet",
        groupNameLabel: "Set name",
        noChoicesYet: "No choices yet",
        stockHead: "Stock",
        addOptionIngredient: "Link an ingredient to this choice",
        countLabel: "Most that can be picked",
        minLabel: "Fewest that must be picked",
        pickCountLabel: "Picks",
        rangeTo: "to",
        answerRequired: "Must pick",
        optionNameHead: "Choice name",
        optionPriceHead: "Adds ฿",
        addOptionGroup: "Add option group",
        optionGroupPlaceholder: "For example, Doneness",
        optionNamePlaceholder: "For example, Medium",
        addOption: "Add option",
        removeOptionGroup: "Remove group",
        removeOption: "Remove",
        optionError: "Enter an option group name and at least 1 option, or leave the group empty.",
        recipeTitle: "Recipe ingredients",
        addRecipeComponent: "Add ingredient",
        noRecipe: "No ingredient recipe",
        ingredient: "Ingredient",
        quantity: "Quantity",
        unit: "Unit",
        note: "Note",
        removeComponent: "Remove",
        recipeCost: "Cost",
        stockLeft: (n: number) => `${n} left`,
        noStockLimit: "No limit",
        recipeCostUnset: "not set",
        noIngredients: "Add ingredients in Inventory first.",
      };

  const handleImageEditorError = useCallback((message: string) => {
    setItemErrors((current) => ({ ...current, image: message || undefined }));
  }, []);

  const refresh = async () => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const [catRes, itemRes, ingredientRes] = await Promise.all([listCategories(), listMenuItems(), listIngredients()]);
      const nextCategories = catRes.data.categories ?? [];
      setCategories(nextCategories);
      setItems(itemRes.data.menu_items ?? []);
      setRecipeIngredients(ingredientRes.data.ingredients ?? []);
      setItemForm((current) => {
        if (current.category_id || current.category_ids?.length) return current;
        const firstID = nextCategories[0]?.ID ?? 0;
        return { ...current, category_id: firstID, category_ids: firstID ? [firstID] : [] };
      });
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(loadTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, language]);

  // Track the fixed toolbar's height so the mobile spacer matches it exactly,
  // even as the toolbar wraps to a different number of rows across breakpoints.
  useEffect(() => {
    const node = stickyToolbarRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setStickyToolbarHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [canView, canManage]);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const categoryMatch = !filterCategory || menuCategoryIds(item).includes(filterCategory);
      const searchMatch = !keyword || item.name.toLowerCase().includes(keyword) || item.description.toLowerCase().includes(keyword);
      return categoryMatch && searchMatch;
    });
  }, [filterCategory, items, search]);

  const categoryCounts = useMemo(() => {
    return categories.reduce<Record<number, number>>((acc, category) => {
      acc[category.ID] = items.filter((item) => menuCategoryIds(item).includes(category.ID)).length;
      return acc;
    }, {});
  }, [categories, items]);
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => (a.display_order - b.display_order) || (a.ID - b.ID)),
    [categories],
  );
  const categoryFilterOptions = useMemo(() => [
    { value: "0", label: `${copy.allCategories} (${items.length})` },
    ...sortedCategories.map((category) => ({ value: String(category.ID), label: `${category.name} (${categoryCounts[category.ID] ?? 0})` })),
  ], [categoryCounts, copy.allCategories, items.length, sortedCategories]);

  // min_select used to be overwritten with `required ? 1 : 0` on every save.
  // The editor loads the real value (menuPageUtils hydrates it) and the backend
  // accepts up to 50, so a group configured as "pick at least 2" silently
  // collapsed to 1 the next time anyone touched that menu item. Keep the stored
  // minimum, and only enforce the invariants the backend actually requires:
  // a required group needs at least 1, an optional one has no floor, and the
  // minimum can never exceed the maximum.
  const normalizeOptionGroups = (groups: MenuOptionGroupInput[]) =>
    groups
      .map((group, groupIndex) => {
        const maxSelect = Math.max(1, Number(group.max_select) || 1);
        const storedMin = Math.max(0, Math.floor(Number(group.min_select) || 0));
        return {
        ...group,
        name: group.name.trim(),
        min_select: group.required ? Math.min(Math.max(storedMin, 1), maxSelect) : 0,
        max_select: maxSelect,
        display_order: Number(group.display_order) || groupIndex,
        options: group.options
          .map((option, optionIndex) => ({
            ...option,
            name: option.name.trim(),
            price_delta: Number(option.price_delta) || 0,
            display_order: Number(option.display_order) || optionIndex,
            // A row the owner opened but never filled in must not reach the API:
            // the backend rejects a zero ingredient id, which would fail the whole
            // save over a blank line nobody meant to add.
            ingredients: (option.ingredients ?? []).filter((row) => row.ingredient_id && Number(row.quantity) > 0),
          }))
          .filter((option) => option.name),
        };
      })
      .filter((group) => group.name || group.options.length);

  const validateOptionGroups = (groups: MenuOptionGroupInput[]) => {
    return normalizeOptionGroups(groups).every((group) => group.name && group.options.length && group.max_select >= group.min_select);
  };

  const normalizeRecipeComponents = (components: MenuIngredientInput[] = []) =>
    components
      .map((component) => {
        const ingredient = recipeIngredients.find((item) => item.ID === component.ingredient_id);
        return {
          ingredient_id: Number(component.ingredient_id) || 0,
          quantity: Number(component.quantity) || 0,
          unit: (component.unit || ingredient?.unit || "").trim(),
          note: (component.note || "").trim(),
        };
      })
      .filter((component) => component.ingredient_id && component.quantity > 0);

  const selectedCategoryIds = itemForm.category_ids?.length
    ? itemForm.category_ids
    : itemForm.category_id
      ? [itemForm.category_id]
      : [];

  const setSelectedCategoryIds = (ids: number[]) => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    setItemForm((current) => ({ ...current, category_id: unique[0] ?? 0, category_ids: unique }));
    setItemErrors((current) => ({ ...current, category: undefined, submit: undefined }));
  };

  const updateRecipeComponents = (updater: (components: MenuIngredientInput[]) => MenuIngredientInput[]) => {
    setItemForm((current) => ({ ...current, ingredients: updater(current.ingredients ?? []) }));
    setItemErrors((current) => ({ ...current, submit: undefined }));
  };
  // What the recipe's add list offers: every ingredient not in the recipe yet.
  const pickableRecipeIngredients = recipeIngredients.filter(
    (ingredient) => !(itemForm.ingredients ?? []).some((component) => component.ingredient_id === ingredient.ID),
  );

  const createInlineCategory = async () => {
    const name = inlineCategoryName.trim();
    if (!name) {
      setInlineCategoryError(copy.categoryRequired);
      return;
    }
    setInlineCategorySaving(true);
    setInlineCategoryError("");
    try {
      const res = await createCategory({
        name,
        display_order: Math.max(0, ...categories.map((category) => category.display_order || 0)) + 1,
        is_active: true,
      });
      setCategories((current) => [...current, res.data]);
      setSelectedCategoryIds([...selectedCategoryIds, res.data.ID]);
      setInlineCategoryName("");
      showToast({ title: copy.categoryCreated });
    } catch (err) {
      setInlineCategoryError(apiErrorCode(err) === "CATEGORY_NAME_EXISTS" ? copy.categoryDuplicate : copy.categorySaveError);
    } finally {
      setInlineCategorySaving(false);
    }
  };

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    const name = categoryName.trim();
    if (!name) {
      setCategoryError(copy.categoryRequired);
      return;
    }
    await saveCategoryOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      setCategoryError("");
      try {
        const nextDisplayOrder = editingCategory
          ? editingCategory.display_order
          : Math.max(0, ...categories.map((category) => category.display_order || 0)) + 1;
        // is_active is a *bool on the API: omitting it leaves the stored value
        // alone. Sending true on a rename or a reorder silently un-hid any
        // category that had been switched off.
        const payload = { name, display_order: nextDisplayOrder };
        if (editingCategory) {
          const res = await updateCategory(editingCategory.ID, payload);
          setCategories((current) => current.map((cat) => cat.ID === res.data.ID ? res.data : cat));
          showToast({ title: copy.categoryUpdated });
        } else {
          const res = await createCategory({ ...payload, is_active: true });
          setCategories((current) => [...current, res.data]);
          if (!itemForm.category_id && !itemForm.category_ids?.length) setItemForm((current) => ({ ...current, category_id: res.data.ID, category_ids: [res.data.ID] }));
          showToast({ title: copy.categoryCreated });
        }
        setCategoryName("");
        setEditingCategory(null);
      } catch (err) {
        setCategoryError(apiErrorCode(err) === "CATEGORY_NAME_EXISTS" ? copy.categoryDuplicate : copy.categorySaveError);
      } finally {
        setSubmitting(false);
      }
    });
  };

  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    const nextItemErrors = {
      category: selectedCategoryIds.length ? undefined : copy.itemCategoryRequired,
      name: itemForm.name.trim() ? undefined : copy.itemNameRequired,
      options: validateOptionGroups(itemForm.option_groups ?? []) ? undefined : copy.optionError,
    };
    if (nextItemErrors.category || nextItemErrors.name || nextItemErrors.options) {
      setItemErrors(nextItemErrors);
      setItemEditorTab(nextItemErrors.options ? "options" : "basic");
      return;
    }
    await saveItemOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      setItemErrors({});
      let imageUrl = itemForm.image_url ?? "";
      // The whole photo and where it sat in the frame go with the dish, so the
      // next adjust reopens the photo rather than the square cut from it.
      let framing = {
        image_original_url: itemForm.image_original_url ?? "",
        image_crop_zoom: itemForm.image_crop_zoom ?? 0,
        image_crop_x: itemForm.image_crop_x ?? 0.5,
        image_crop_y: itemForm.image_crop_y ?? 0.5,
      };
      try {
        const changes = await imageEditorRef.current?.exportChanges();
        if (changes) {
          // A photo picked or rotated here is new and goes up whole; otherwise
          // the photo framed is the one already kept - its original, or for a
          // dish saved before originals were kept, the square itself.
          let originalUrl: string | null = framing.image_original_url || imageUrl;
          if (changes.original) originalUrl = await uploadCroppedImage(changes.original);
          const uploaded = originalUrl ? await uploadCroppedImage(changes.file) : null;
          if (!originalUrl || !uploaded) {
            setItemEditorTab("basic");
            return;
          }
          imageUrl = uploaded;
          framing = {
            image_original_url: originalUrl,
            image_crop_zoom: changes.placement.zoom,
            image_crop_x: changes.placement.positionX,
            image_crop_y: changes.placement.positionY,
          };
        }
      } catch {
        setItemErrors({ image: copy.imageCropError });
        setItemEditorTab("basic");
        setSubmitting(false);
        return;
      }
      try {
        const payload = {
          ...itemForm,
          image_url: imageUrl,
          ...(imageUrl ? framing : { image_original_url: "", image_crop_zoom: 0, image_crop_x: 0.5, image_crop_y: 0.5 }),
          name: itemForm.name.trim(),
          category_id: selectedCategoryIds[0],
          category_ids: selectedCategoryIds,
          price: Number(itemForm.price) || 0,
          display_order: Number(itemForm.display_order) || 0,
          option_groups: normalizeOptionGroups(itemForm.option_groups ?? []),
          ingredients: normalizeRecipeComponents(itemForm.ingredients ?? []),
        };
        if (editingItem) {
          const res = await updateMenuItem(editingItem.ID, payload);
          setItems((current) => current.map((item) => item.ID === res.data.ID ? res.data : item));
          showToast({ title: copy.itemUpdated });
        } else {
          const res = await createMenuItem(payload);
          setItems((current) => [...current, res.data]);
          showToast({ title: copy.itemCreated });
        }
        setEditingItem(null);
        const firstID = sortedCategories[0]?.ID ?? 0;
        setItemForm({ ...emptyItem, category_id: firstID, category_ids: firstID ? [firstID] : [] });
        closeItemDrawer();
      } catch {
        setItemErrors({ submit: copy.itemSaveError });
      } finally {
        setSubmitting(false);
      }
    });
  };

  const editCategory = (category: Category) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setCategoryError("");
  };

  const toggleCategoryEdit = (category: Category) => {
    if (editingCategory?.ID === category.ID) {
      setEditingCategory(null);
      setCategoryName("");
      setCategoryError("");
      return;
    }
    editCategory(category);
  };

  // A drag is its own confirmation: the rows already sit in their new order, so
  // no toast follows a successful save. Only a failure is reported.
  const persistCategoryOrder = async (reordered: Category[]) => {
    const normalized = reordered.map((category, index) => ({ ...category, display_order: index + 1 }));
    const previousCategories = categories;

    setSubmitting(true);
    setCategoryError("");
    setCategories(normalized);
    if (editingCategory) {
      const currentEditingCategory = normalized.find((category) => category.ID === editingCategory.ID);
      if (currentEditingCategory) {
        setEditingCategory(currentEditingCategory);
      }
    }

    try {
      await Promise.all(normalized.map((category) => updateCategory(category.ID, {
        name: category.name,
        display_order: category.display_order,
      })));
    } catch {
      setCategories(previousCategories);
      setCategoryError(copy.categorySaveError);
    } finally {
      setSubmitting(false);
    }
  };

  const categoryDrag = useDragReorder(sortedCategories, (category) => category.ID, (next) => void persistCategoryOrder(next), submitting);

  const editItem = (item: MenuItem) => {
    setEditingItem(item);
    setItemErrors({});
    setItemForm(menuItemToInput(item));
    setItemEditorTab("basic");
    setDrawerOpen(true);
  };

  const toggleItemAvailability = async (item: MenuItem, nextAvailable: boolean) => {
    if (!canManage || availabilitySubmittingId === item.ID) return;
    setAvailabilitySubmittingId(item.ID);
    setItems((current) => current.map((currentItem) => currentItem.ID === item.ID ? { ...currentItem, is_available: nextAvailable } : currentItem));
    if (editingItem?.ID === item.ID) {
      setEditingItem((current) => current ? { ...current, is_available: nextAvailable } : current);
      setItemForm((current) => ({ ...current, is_available: nextAvailable }));
    }
    try {
      const res = await updateMenuItemAvailability(item.ID, nextAvailable);
      setItems((current) => current.map((currentItem) => currentItem.ID === res.data.ID ? res.data : currentItem));
      if (editingItem?.ID === item.ID) {
        setEditingItem(res.data);
        setItemForm((current) => ({ ...current, is_available: res.data.is_available }));
      }
    } catch {
      setItems((current) => current.map((currentItem) => currentItem.ID === item.ID ? { ...currentItem, is_available: item.is_available } : currentItem));
      if (editingItem?.ID === item.ID) {
        setEditingItem(item);
        setItemForm((current) => ({ ...current, is_available: item.is_available }));
      }
      showToast({ title: copy.itemSaveError, tone: "error" });
    } finally {
      setAvailabilitySubmittingId(null);
    }
  };

  const startCreateItem = () => {
    setEditingItem(null);
    setItemErrors({});
    const firstID = filterCategory || sortedCategories[0]?.ID || 0;
    setItemForm({ ...emptyItem, category_id: firstID, category_ids: firstID ? [firstID] : [] });
    setInlineCategoryName("");
    setInlineCategoryError("");
    setItemEditorTab("basic");
    setDrawerClosing(false);
    setDrawerOpen(true);
  };

  const closeItemDrawer = () => {
    if (drawerClosing) return;
    setDrawerClosing(true);
    window.setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
      setEditingItem(null);
      setItemErrors({});
    }, 180);
  };

  const closeCategoryModal = () => {
    if (categoryModalClosing) return;
    setCategoryModalClosing(true);
    window.setTimeout(() => {
      setCategoryModalOpen(false);
      setCategoryModalClosing(false);
    }, 180);
  };

  const closeDeleteModal = (force = false) => {
    if (!force && (submitting || deleteClosing)) return;
    setDeleteClosing(true);
    window.setTimeout(() => {
      setDeleteTarget(null);
      setDeleteClosing(false);
    }, 180);
  };
  const categoryBackdrop = useBackdropClose(closeCategoryModal);
  const itemDrawerBackdrop = useBackdropClose(closeItemDrawer);

  if (!canView) return <PermissionDenied title={copy.permissionDenied} />;

  const updateOptionGroups = (updater: (groups: MenuOptionGroupInput[]) => MenuOptionGroupInput[]) => {
    setItemForm((current) => ({ ...current, option_groups: updater(current.option_groups ?? []) }));
    setItemErrors((current) => ({ ...current, options: undefined, submit: undefined }));
  };

  const updateOptionGroup = (groupIndex: number, patch: Partial<MenuOptionGroupInput>) => {
    updateOptionGroups((groups) => groups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group));
  };

  const updateOptionIngredients = (
    groupIndex: number,
    optionIndex: number,
    updater: (rows: MenuOptionIngredientInput[]) => MenuOptionIngredientInput[],
  ) => {
    updateOptionGroups((groups) => groups.map((group, index) => {
      if (index !== groupIndex) return group;
      return {
        ...group,
        options: group.options.map((option, currentOptionIndex) => currentOptionIndex === optionIndex
          ? { ...option, ingredients: updater(option.ingredients ?? []) }
          : option),
      };
    }));
  };

  const updateOption = (groupIndex: number, optionIndex: number, patch: Partial<MenuOptionGroupInput["options"][number]>) => {
    updateOptionGroups((groups) => groups.map((group, index) => {
      if (index !== groupIndex) return group;
      return {
        ...group,
        options: group.options.map((option, currentOptionIndex) => currentOptionIndex === optionIndex ? { ...option, ...patch } : option),
      };
    }));
  };

  const removeCategory = async (categoryId: number) => {
    if (!canManage) return;
    await deleteCategoryOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      try {
        await deleteCategory(categoryId);
        await refresh();
        showToast({ title: copy.categoryDeleted });
      } catch {
        setError(copy.categoryDeleteError);
      } finally {
        setSubmitting(false);
        closeDeleteModal(true);
      }
    });
  };

  const removeItem = async (itemId: number) => {
    if (!canManage) return;
    await deleteItemOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      try {
        await deleteMenuItem(itemId);
        setItems((current) => current.filter((menuItem) => menuItem.ID !== itemId));
        if (editingItem?.ID === itemId) {
          closeItemDrawer();
        }
        showToast({ title: copy.itemDeleted });
      } catch {
        setError(copy.itemDeleteError);
      } finally {
        setSubmitting(false);
        closeDeleteModal(true);
      }
    });
  };

  // The photo is cropped and uploaded as part of the save (there is no "use
  // this image" step any more); a failure stops the save and says why under
  // the photo.
  const uploadCroppedImage = async (file: File): Promise<string | null> => {
    setUploadingImage(true);
    try {
      const res = await uploadMenuImage(file);
      return res.data.image_url;
    } catch {
      setItemErrors((current) => ({ ...current, image: copy.imageUploadError }));
      return null;
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <>
      <div
        data-shell-sticky=""
        ref={stickyToolbarRef}
        className="fixed inset-x-0 top-0 z-20 bg-white/82 backdrop-blur-md dark:bg-[#0f0f0f]/82 transition-[left] duration-300 ease-in-out tablet:max-lg:left-[68px] lg:inset-auto"
      >
        <h1 className="sr-only">{copy.title}</h1>
        <div className="px-4 py-2 sm:px-6 lg:px-8 lg:pb-2 lg:pt-4">
          {/* Phone: search with an icon-only add button after it, the category
              filter and its pencil on a full line under them. sm up: the
              filters on the left, the labelled add button alone at the right. */}
          <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex-nowrap sm:gap-3">
                  <label className="relative order-1 block min-w-0 flex-1 sm:w-72 sm:flex-none">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder={copy.searchPlaceholder}
                      aria-label={copy.searchPlaceholder}
                      className={`h-10 w-full min-w-0 rounded-xl pl-7 shadow-(--dashboard-control-shadow) pr-3 text-[15px] placeholder:text-[15px] ${fieldLook()}`}
                    />
                  </label>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={startCreateItem}
                      aria-label={copy.createItem}
                      title={copy.createItem}
                      className="ui-press order-2 inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-xl bg-orange-700 text-[13px] font-semibold text-white shadow-(--dashboard-control-shadow) hover:bg-orange-800 dark:bg-orange-700 dark:text-white sm:order-3 sm:ml-auto sm:w-auto sm:px-3"
                    >
                      <Plus className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">{copy.createItem}</span>
                    </button>
                  ) : null}
                <div className="order-3 flex w-full min-w-0 items-center gap-1 sm:order-2 sm:w-auto">
                  <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
                    <ThemedSelect
                      triggerClassName="rounded-xl shadow-(--dashboard-control-shadow)"
                      aria-label={copy.allCategories}
                      value={String(filterCategory)}
                      onChange={(next) => setFilterCategory(Number(next))}
                      options={categoryFilterOptions}
                    />
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => { setCategoryModalClosing(false); setCategoryModalOpen(true); }}
                      aria-label={copy.categoryManager}
                      title={copy.categoryManager}
                      className="ui-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-700 hover:text-orange-700 dark:text-gray-300 dark:hover:text-orange-400"
                    >
                      <SolidPencilIcon className="h-5 w-5" />
                    </button>
                  ) : null}
                </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="lg:hidden" style={{ height: stickyToolbarHeight }} />
      <div className="min-h-dvh bg-slate-100 px-4 py-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100 sm:px-6 lg:px-8 lg:py-6">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">{error}</div>}
        <div>
          <section className="space-y-4">
              {loading ? (
                <div className={MENU_CARD_GRID_CLASS}>
                  <RestaurantCardSkeleton />
                  <RestaurantCardSkeleton />
                  <RestaurantCardSkeleton />
                </div>
              ) : filteredItems.length ? (
                <div className={MENU_CARD_GRID_CLASS}>
                  {filteredItems.map((item) => {
                    const remaining = typeof item.remaining_servings === "number" ? item.remaining_servings : null;
                    const stockBadgeClass = menuStockBadgeClass(remaining !== null && remaining <= LOW_STOCK_THRESHOLD);
                    const stockBadgeText = remaining !== null ? copy.stockLeft(remaining) : copy.noStockLimit;
                    const availabilityBadgeClassName = item.is_available
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400";

                    return (
                    <article
                      key={item.ID}
                      role={canManage ? "button" : undefined}
                      tabIndex={canManage ? 0 : undefined}
                      onClick={canManage ? () => editItem(item) : undefined}
                      onKeyDown={canManage ? (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        editItem(item);
                      } : undefined}
                      className={`group ${MENU_CARD_SHELL_CLASS} focus-visible:outline-none ${canManage ? "cursor-pointer active:scale-[0.99] sm:hover:-translate-y-0.5" : ""} ${!item.is_available ? "opacity-60" : ""}`}
                    >
                      {!item.is_available ? (
                        <span className="absolute left-2 top-2 z-10 rounded-md bg-gray-900/85 px-2 py-1 text-[11px] font-semibold text-white shadow-md dark:bg-gray-100/90 dark:text-gray-900">
                          {copy.unavailable}
                        </span>
                      ) : null}
                      <div
                        className="relative aspect-square w-full shrink-0 bg-transparent bg-cover bg-center"
                        style={{ backgroundImage: `url(${item.image_url || "/menu-placeholder-v2.webp"})` }}
                        aria-label={item.image_url ? `${copy.imageAlt} ${item.name}` : undefined}
                      >
                        {/* Phone: the card is too narrow for the badge beside the
                            price, so it sits on the photo's bottom-right corner. */}
                        <span className={`absolute bottom-1.5 right-1.5 shadow-sm sm:hidden ${stockBadgeClass}`}>{stockBadgeText}</span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col p-3">
                        <h3 className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{item.name}</h3>
                        {/* Same "N left" badge as POS order taking, in the same place. */}
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <p className="font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white">฿{item.price.toLocaleString()}</p>
                          <span className={`max-sm:hidden ${stockBadgeClass}`}>{stockBadgeText}</span>
                        </div>
                        {/* Always drawn from `sm`, so every card is the same height: a
                            dish with no recipe says so instead of dropping the line.
                            Left off phones, where the card has no room for it. */}
                        <p className="mt-0.5 truncate text-[13px] text-gray-700 max-sm:hidden dark:text-gray-300">
                          {copy.recipeCost}:{" "}
                          {item.ingredients?.length ? (
                            <span className="font-mono tabular-nums">{formatCurrency(recipeCost(item.ingredients.map((component) => ({ ingredient_id: component.ingredient_id, quantity: component.quantity, unit: component.unit })), recipeIngredients), language, 2)}</span>
                          ) : (
                            copy.recipeCostUnset
                          )}
                        </p>
                        <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-500 dark:text-gray-400">
                            {menuCategoryIds(item)
                              .map((categoryId) => categories.find((cat) => cat.ID === categoryId)?.name)
                              .filter(Boolean)
                              .join(", ") || copy.noCategory}
                          </span>
                          {canManage ? (
                            <AvailabilitySwitch
                              checked={item.is_available}
                              disabled={availabilitySubmittingId === item.ID}
                              label={item.is_available ? copy.available : copy.unavailable}
                              onChange={() => void toggleItemAvailability(item, !item.is_available)}
                            />
                          ) : (
                            <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${availabilityBadgeClassName}`}>
                              {item.is_available ? copy.available : copy.unavailable}
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 bg-white px-4 py-10 text-center dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{copy.noMenuTitle}</p>
                  <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{canManage ? copy.noMenuManage : copy.noMenuView}</p>
                </div>
              )}
        </section>

      </div>

      {categoryModalOpen && canManage && (
        <div {...categoryBackdrop} className={`${categoryModalClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0`}>
          <div className={`${categoryModalClosing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} flex max-h-[86vh] w-full max-w-sm flex-col rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">{copy.categoryManager}</h2>
              <button type="button" onClick={closeCategoryModal} className="h-8 w-8 rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">×</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-1">
                {sortedCategories.map((category) => (
                  <div
                    key={category.ID}
                    ref={categoryDrag.rowRef(category.ID)}
                    style={categoryDrag.rowStyle(category.ID)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={editingCategory?.ID === category.ID}
                    onClick={() => toggleCategoryEdit(category)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      toggleCategoryEdit(category);
                    }}
                    className={`grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border py-2 pl-1 pr-3 outline-none transition-[background-color,border-color,box-shadow] ${
                      categoryDrag.draggingKey === category.ID
                        ? "border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
                        : editingCategory?.ID === category.ID
                        ? "border-gray-950 bg-orange-50/70 shadow-[inset_3px_0_0_#f97316] dark:border-white/80 dark:bg-orange-950/20"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/60"
                    }`}
                  >
                    <span
                      {...categoryDrag.handleProps(category.ID)}
                      role="button"
                      tabIndex={0}
                      aria-label={language === "th" ? `ลากเพื่อย้าย ${category.name}` : `Drag to move ${category.name}`}
                      className={`grid h-8 w-7 touch-none place-items-center rounded-md text-gray-400 outline-none hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-orange-500 dark:text-gray-500 dark:hover:text-gray-200 ${
                        submitting ? "cursor-not-allowed opacity-50" : categoryDrag.draggingKey === category.ID ? "cursor-grabbing" : "cursor-grab"
                      }`}
                    >
                      <GripVertical className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className={`truncate text-[13px] font-medium ${!category.is_active ? "text-gray-500 line-through" : "text-gray-900 dark:text-white"}`}>{category.name}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">{categoryCounts[category.ID] ?? 0} {copy.menuSummary}</p>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" disabled={submitting} onClick={(event) => { event.stopPropagation(); setDeleteTarget({ type: "category", id: category.ID, name: category.name }); }} className="h-8 rounded-md px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-900/20">{copy.delete}</button>
                    </div>
                  </div>
                ))}
                {!sortedCategories.length && <p className="rounded-md border border-gray-200 px-3 py-6 text-center text-[12px] text-gray-500 dark:border-gray-800">{copy.noCategories}</p>}
              </div>
            </div>
            <form onSubmit={saveCategory} className="border-t border-gray-200 p-4 dark:border-gray-800">
              <h3 className="text-[13px] font-semibold">{editingCategory ? copy.editCategory : copy.addCategory}</h3>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <input
                  value={categoryName}
                  onChange={(event) => {
                    setCategoryName(event.target.value);
                    setCategoryError("");
                  }}
                  placeholder={copy.categoryPlaceholder}
                  aria-invalid={Boolean(categoryError)}
                  className={`h-10 w-full rounded-md px-3 text-[13px] ${fieldLook(Boolean(categoryError))}`}
                />
                <button disabled={submitting} className="ui-press h-10 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white disabled:opacity-60 dark:bg-orange-700 dark:text-white">
                  {editingCategory ? copy.saveCategory : copy.createCategory}
                </button>
                {categoryError ? (
                  <p className="text-[11px] font-medium text-red-600 dark:text-red-300">{categoryError}</p>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      )}

      {drawerOpen && canManage && (
        <>
          <button type="button" aria-label={copy.cancel} {...itemDrawerBackdrop} className={`${drawerClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-30 cursor-default bg-gray-950/45 backdrop-blur-sm`} />
          {/* Slides in from the right, the same drawer the staff, table and
              inventory editors use. It is a long form with three tabs, so it
              belongs beside the list it edits rather than on top of it. */}
          <form onSubmit={saveItem} className={`${drawerClosing ? "motion-drawer-exit" : "motion-drawer"} fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col overflow-hidden border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              {/* Centred, not top-aligned: the 32px close button stood 4px lower
                  than the name beside it (owner, 28 ก.ย. 2569). */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-semibold text-gray-900 dark:text-white">{editingItem ? editingItem.name : copy.addItem}</h2>
                </div>
                <button
                  type="button"
                  onClick={closeItemDrawer}
                  aria-label={copy.cancel}
                  className="ui-press grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {/* A segmented control, not three bordered pills: the tabs used to
                  wear the same orange chip styling as the category selector two
                  rows below, so navigation and data looked like the same thing. */}
              <div className="mt-3 inline-flex w-full items-center gap-1 overflow-x-auto rounded-md bg-gray-100 p-1 dark:bg-gray-950/60 sm:w-auto">
                {([
                  { id: "basic", label: language === "th" ? "ข้อมูลหลัก" : "Basic info" },
                  { id: "options", label: language === "th" ? "ตัวเลือก" : "Options" },
                  { id: "recipe", label: language === "th" ? "สูตร/สต็อก" : "Recipe/stock" },
                ] as { id: ItemEditorTab; label: string }[]).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={itemEditorTab === tab.id}
                    onClick={() => setItemEditorTab(tab.id)}
                    className={`ui-press h-9 flex-1 whitespace-nowrap rounded-md px-3.5 text-[14px] font-semibold transition-colors sm:flex-none ${
                      itemEditorTab === tab.id
                        ? "bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white"
                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {/* Kept mounted while hidden: the photo being framed lives in it
                  and would be lost on a switch to another tab before saving. */}
                <div hidden={itemEditorTab !== "basic"}>
                  <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-start">
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-medium text-gray-900 dark:text-white">{copy.itemName}</span>
                    <input value={itemForm.name} onChange={(event) => { setItemForm({ ...itemForm, name: event.target.value }); setItemErrors((current) => ({ ...current, name: undefined, submit: undefined })); }} placeholder={copy.itemNamePlaceholder} className={`h-11 w-full rounded-md px-3 text-[14px] ${fieldLook(Boolean(itemErrors.name))}`} />
                    {itemErrors.name && <p className="mt-1.5 text-[13px] font-medium text-red-600 dark:text-red-300">{itemErrors.name}</p>}
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[14px] font-medium text-gray-900 dark:text-white">{copy.price}</span>
                    <NumberInput value={itemForm.price} blankWhenZero onValue={(value) => setItemForm({ ...itemForm, price: value })} placeholder={copy.pricePlaceholder} min={0} className={`h-11 w-full rounded-md px-3 text-[14px] ${fieldLook()}`} />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-[14px] font-medium text-gray-900 dark:text-white">{copy.description}</span>
                  <textarea value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} placeholder={copy.descriptionPlaceholder} className={`h-24 w-full resize-none rounded-md px-3 py-2 text-[14px] ${fieldLook()}`} />
                </label>
                <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
                  <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{copy.itemCategories}</p>
                  <div className="mt-3 space-y-3">
                    {sortedCategories.length ? (
                      // Picked the way the owner's reference picks several: the
                      // chosen categories as chips inside the field, and a list
                      // that ticks each one and stays open (2026-09-21).
                      <ThemedMultiSelect
                        aria-label={copy.itemCategories}
                        placeholder={copy.noCategoryPicked}
                        moreLabel={copy.moreCategories}
                        values={selectedCategoryIds.map(String)}
                        onChange={(ids) => setSelectedCategoryIds(ids.map(Number))}
                        options={sortedCategories.map((category) => ({ value: String(category.ID), label: category.name }))}
                      />
                    ) : (
                      <p className="text-[13px] text-gray-500 dark:text-gray-400">{copy.createCategoryFirst}</p>
                    )}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <input
                        value={inlineCategoryName}
                        onChange={(event) => {
                          setInlineCategoryName(event.target.value);
                          setInlineCategoryError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void createInlineCategory();
                          }
                        }}
                        placeholder={copy.inlineCategoryPlaceholder}
                        className={`h-10 min-w-0 rounded-md px-3 text-[14px] ${fieldLook()}`}
                      />
                      <button
                        type="button"
                        disabled={inlineCategorySaving || !inlineCategoryName.trim()}
                        onClick={createInlineCategory}
                        className="h-10 rounded-md border border-gray-200 bg-white px-3 text-[14px] font-semibold text-gray-800 hover:border-orange-300 hover:text-orange-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-orange-700 dark:hover:text-orange-200"
                      >
                        {inlineCategorySaving ? "..." : copy.createCategory}
                      </button>
                    </div>
                    {(itemErrors.category || inlineCategoryError) && (
                      <p className="text-[13px] font-medium text-red-600 dark:text-red-300">{itemErrors.category || inlineCategoryError}</p>
                    )}
                  </div>
                </section>
                <section className="border-t border-gray-200 pt-4 dark:border-gray-800">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-[14px] font-semibold text-gray-900 dark:text-white">
                    {copy.image}
                    <span className="text-[13px] font-normal text-gray-500 dark:text-gray-400">
                      <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span> {copy.imageHelp}
                    </span>
                  </p>
                  <div className="mt-3 space-y-2">
                    <MenuImageCropper
                      ref={imageEditorRef}
                      currentImageUrl={itemForm.image_url ?? ""}
                      originalImageUrl={itemForm.image_original_url ?? ""}
                      savedPlacement={{
                        zoom: itemForm.image_crop_zoom ?? 0,
                        positionX: itemForm.image_crop_x ?? 0.5,
                        positionY: itemForm.image_crop_y ?? 0.5,
                      }}
                      disabled={uploadingImage || submitting}
                      copy={{
                        chooseImage: copy.chooseImage,
                        changeImage: copy.changeImage,
                        removeImage: copy.removeImage,
                        rotateImage: copy.rotateImage,
                        cropAria: copy.cropAria,
                        zoom: copy.zoom,
                        loading: copy.preparingImage,
                        invalidFile: copy.imageUploadError,
                        loadError: copy.imageLoadError,
                      }}
                      onRemove={() => setItemForm((current) => ({ ...current, image_url: "", image_original_url: "", image_crop_zoom: 0, image_crop_x: 0.5, image_crop_y: 0.5 }))}
                      onError={handleImageEditorError}
                    />
                    {itemErrors.image || uploadingImage ? (
                      <p className={`text-[13px] ${itemErrors.image ? "font-medium text-red-600 dark:text-red-300" : "text-gray-500 dark:text-gray-500"}`}>{itemErrors.image || copy.uploading}</p>
                    ) : null}
                  </div>
                </section>
                  </div>
                </div>
              {itemEditorTab === "options" && (
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-medium text-gray-900 dark:text-white">{copy.optionsTitle}</p>
                    <button
                      type="button"
                      onClick={() => {
                        // Open the set that was just created. Adding one and being
                        // left staring at an unchanged list reads as a broken button.
                        setOpenOptionGroup((itemForm.option_groups ?? []).length);
                        updateOptionGroups((groups) => [...groups, emptyOptionGroup()]);
                      }}
                      className="ui-press h-10 shrink-0 rounded-md border border-gray-200 bg-white px-3 text-[14px] font-semibold text-gray-800 transition-colors hover:border-orange-300 hover:text-orange-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-orange-700 dark:hover:text-orange-200"
                    >
                      {copy.addOptionGroup}
                    </button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {/* No option sets is the normal case for most dishes, so say so
                        instead of leaving the tab looking unfinished. */}
                    {(itemForm.option_groups ?? []).length === 0 ? (
                      <div className="rounded-md border border-dashed border-gray-200 px-4 py-8 text-center dark:border-gray-800">
                        <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{copy.optionsEmptyTitle}</p>
                      </div>
                    ) : null}
                    {(itemForm.option_groups ?? []).map((group, groupIndex) => {
                      // A set is a scannable summary line until it is opened. The
                      // rules are shown as one derived sentence rather than as the
                      // three numbers behind them, so the owner reads back what they
                      // built instead of re-reading the controls they set.
                      const open = openOptionGroup === groupIndex;
                      const maxSelect = group.max_select || 1;
                      const minSelect = group.min_select || 1;
                      const named = group.options.filter((option) => option.name.trim());
                      const setMax = (next: number) => {
                        const capped = Math.max(1, Math.min(next, 50));
                        updateOptionGroup(groupIndex, {
                          max_select: capped,
                          // A minimum can never outrun the maximum above it.
                          min_select: group.required ? Math.min(Math.max(minSelect, 1), capped) : 0,
                        });
                      };
                      // Raising the minimum past the maximum carries the maximum up
                      // with it, rather than refusing the tap.
                      const setMin = (next: number) => {
                        const capped = Math.max(1, Math.min(next, 50));
                        updateOptionGroup(groupIndex, { min_select: capped, max_select: Math.max(maxSelect, capped) });
                      };
                      const microLabel = "text-[14px] font-medium text-gray-900 dark:text-white";
                      const inputClass =
                        `h-10 min-w-0 rounded-md px-3 text-[14px] ${fieldLook()}`;
                      // Every row in the panel spans the panel and ends on the same
                      // right edge. Capping fields individually is what made the card
                      // look ragged - the fix is a shared grid, not smaller boxes.
                      const optionGrid = "grid grid-cols-[minmax(0,1fr)_4.75rem_2.25rem_2.25rem] gap-2";
                      return (
                        <div key={groupIndex} className="rounded-md border border-gray-200 dark:border-gray-800">
                          <div className="flex items-start gap-2 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              {/* Edited in place. A separate "set name" field inside
                                  the panel showed the same word twice and made you
                                  open the set just to rename it. */}
                              <input
                                value={group.name}
                                onChange={(event) => updateOptionGroup(groupIndex, { name: event.target.value })}
                                placeholder={copy.optionGroupPlaceholder}
                                aria-label={copy.groupNameLabel}
                                className={`h-9 w-full rounded-md px-2.5 text-[14px] font-semibold text-gray-900 placeholder:font-normal placeholder:text-gray-400 dark:text-white dark:placeholder:text-gray-500 ${fieldLook()}`}
                              />
                              <button
                                type="button"
                                aria-expanded={open}
                                onClick={() => setOpenOptionGroup(open ? null : groupIndex)}
                                className="ui-press block w-full text-left"
                              >
                              {open ? null : (
                                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-gray-600 dark:text-gray-300">
                                  {named.length === 0 ? (
                                    <span className="text-gray-400 dark:text-gray-500">{copy.noChoicesYet}</span>
                                  ) : (
                                    <>
                                      {named.slice(0, 4).map((option, previewIndex) => {
                                        // The same arrows the inventory history uses for
                                        // stock in and out, so a choice that moves stock is
                                        // visible without opening the set.
                                        const movesStock = (option.ingredients ?? []).some((row) => row.ingredient_id && Number(row.quantity) > 0);
                                        return (
                                          <span key={previewIndex} className="inline-flex max-w-[9rem] items-center gap-1 truncate">
                                            {movesStock ? <ChevronUp className="h-3 w-3 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden /> : null}
                                            <span className="truncate">{option.name.trim()}</span>
                                            {option.price_delta ? <span className="tabular-nums text-gray-500 dark:text-gray-400">+{option.price_delta}</span> : null}
                                          </span>
                                        );
                                      })}
                                      {named.length > 4 ? <span className="text-gray-400 dark:text-gray-500">+{named.length - 4}</span> : null}
                                    </>
                                  )}
                                </span>
                              )}
                              </button>
                            </div>
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={copy.groupNameLabel}
                              onClick={() => setOpenOptionGroup(open ? null : groupIndex)}
                              className="ui-press mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                            </button>
                          </div>

                          {open ? (
                            <div className="ai-reveal-down border-t border-gray-100 px-3 pb-3 pt-3 dark:border-gray-800">
                              {/* A rule line per row. With the control pinned to the
                                  right edge the label sat a long way from what it
                                  names; the divider carries the eye across. */}
                              {/* Two rows (owner, 28 ก.ย. 2569): a switch for "must
                                  pick", then the count. Required, the count is a
                                  range read as one line - "1 ถึง 3" - so the
                                  minimum shows whenever picking is required, not
                                  only when more than one can be picked. */}
                              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                <div className="flex min-h-12 items-center justify-between gap-3 py-1.5 text-[14px] text-gray-900 dark:text-white">
                                  <span>{copy.answerRequired}</span>
                                  <SettingSwitch
                                    checked={Boolean(group.required)}
                                    label={copy.answerRequired}
                                    onChange={(required) => required
                                      ? updateOptionGroup(groupIndex, { required: true, min_select: Math.min(Math.max(minSelect, 1), maxSelect) })
                                      : updateOptionGroup(groupIndex, { required: false, min_select: 0 })}
                                  />
                                </div>
                                <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 py-1.5 text-[14px] text-gray-900 dark:text-white">
                                  <span>{group.required ? copy.pickCountLabel : copy.countLabel}</span>
                                  <div className="flex items-center gap-2">
                                    {group.required ? (
                                      <>
                                        <CountStepper
                                          value={minSelect}
                                          min={1}
                                          max={50}
                                          label={copy.minLabel}
                                          decreaseLabel={`${copy.minLabel} -1`}
                                          increaseLabel={`${copy.minLabel} +1`}
                                          onChange={setMin}
                                        />
                                        <span className="text-gray-500 dark:text-gray-400">{copy.rangeTo}</span>
                                      </>
                                    ) : null}
                                    <CountStepper
                                      value={maxSelect}
                                      min={1}
                                      max={50}
                                      label={copy.countLabel}
                                      decreaseLabel={`${copy.countLabel} -1`}
                                      increaseLabel={`${copy.countLabel} +1`}
                                      onChange={setMax}
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Column heads stay put instead of living in placeholders
                                  that vanish the moment you type - and they are what
                                  makes the bare stock square below self-explanatory. */}
                              <div className={`mt-4 ${optionGrid}`}>
                                <span className={microLabel}>{copy.optionNameHead}</span>
                                <span className={microLabel}>{copy.optionPriceHead}</span>
                                <span className={`${microLabel} text-center`}>{copy.stockHead}</span>
                                <span />
                              </div>
                              <div className="mt-1.5 space-y-2">
                                {group.options.map((option, optionIndex) => {
                                  const rows = option.ingredients ?? [];
                                  return (
                                    <div key={optionIndex}>
                                      <div className={`${optionGrid} items-center`}>
                                        <input
                                          value={option.name}
                                          onChange={(event) => updateOption(groupIndex, optionIndex, { name: event.target.value })}
                                          placeholder={copy.optionNamePlaceholder}
                                          className={inputClass}
                                        />
                                        <NumberInput
                                          min={0}
                                          blankWhenZero
                                          value={option.price_delta}
                                          onValue={(value) => updateOption(groupIndex, optionIndex, { price_delta: value })}
                                          placeholder="0"
                                          className={`${inputClass} w-full px-2 tabular-nums`}
                                        />
                                        <button
                                          type="button"
                                          aria-label={copy.addOptionIngredient}
                                          disabled={!recipeIngredients.length}
                                          onClick={() => updateOptionIngredients(groupIndex, optionIndex, (current) => [...current, emptyOptionIngredient()])}
                                          className={`ui-press grid h-10 w-9 place-items-center rounded-md text-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                            rows.length
                                              ? "border border-gray-300 bg-gray-50 text-gray-900 hover:border-orange-300 hover:text-orange-700 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:hover:border-orange-700 dark:hover:text-orange-200"
                                              : "border border-dashed border-gray-300 text-gray-400 hover:border-orange-300 hover:text-orange-700 dark:border-gray-700 dark:text-gray-500 dark:hover:border-orange-700 dark:hover:text-orange-200"
                                          }`}
                                        >
                                          <Plus className="h-4 w-4" aria-hidden />
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={copy.removeOption}
                                          onClick={() => updateOptionGroups((groups) => groups.map((currentGroup, currentGroupIndex) => currentGroupIndex === groupIndex ? { ...currentGroup, options: currentGroup.options.filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex) } : currentGroup))}
                                          className="ui-press grid h-10 w-9 place-items-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                                        >
                                          <X className="h-4 w-4" aria-hidden />
                                        </button>
                                      </div>
                                      {rows.length ? (
                                        <div className="ai-reveal-down mt-2 space-y-2 border-t border-gray-100 pl-3 pt-2 dark:border-gray-800">
                                          {rows.map((row, rowIndex) => {
                                            const ingredient = recipeIngredients.find((entry) => entry.ID === row.ingredient_id);
                                            const chosenUnit = row.unit || ingredient?.unit || "";
                                            const perUnit = stockUnitsPer(ingredient, chosenUnit);
                                            const patchRow = (patch: Partial<MenuOptionIngredientInput>) =>
                                              updateOptionIngredients(groupIndex, optionIndex, (current) => current.map((entry, index) => index === rowIndex ? { ...entry, ...patch } : entry));
                                            return (
                                              <div key={rowIndex} className="space-y-2">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  {/* Every control in the row stands 40px, the height of
                                                      the amount box; the compact selects were 36px. */}
                                                  <div className="min-w-0 flex-1">
                                                    <ThemedSelect triggerClassName="!h-10 !text-[14px]"
                                                      aria-label={copy.ingredient}
                                                      compact
                                                      value={String(row.ingredient_id || 0)}
                                                      onChange={(next) => {
                                                        const picked = recipeIngredients.find((entry) => entry.ID === Number(next));
                                                        patchRow({ ingredient_id: Number(next), unit: picked?.unit ?? "" });
                                                      }}
                                                      options={[{ value: "0", label: copy.ingredient }, ...recipeIngredients.map((entry) => ({ value: String(entry.ID), label: `${entry.name} (${entry.unit})` }))]}
                                                    />
                                                  </div>
                                                  <NumberInput
                                                    min={0}
                                                    step="0.01"
                                                    blankWhenZero
                                                    value={row.quantity}
                                                    onValue={(value) => patchRow({ quantity: value })}
                                                    placeholder={copy.quantity}
                                                    className={`h-10 w-16 shrink-0 rounded-md px-2 text-[14px] tabular-nums sm:w-20 sm:px-3 ${fieldLook()}`}
                                                  />
                                                  <div className="w-[4.75rem] shrink-0 sm:w-24">
                                                    {/* No ingredient yet, no unit to pick: the box is
                                                        shut and says what goes in it. */}
                                                    <ThemedSelect triggerClassName="!h-10 !text-[14px]"
                                                      aria-label={copy.unit}
                                                      compact
                                                      disabled={!ingredient}
                                                      value={ingredient ? chosenUnit : ""}
                                                      onChange={(next) => patchRow({ unit: next })}
                                                      options={ingredient ? (ingredient.unit_family ?? [{ unit: chosenUnit, stock_per_unit: 1 }]).map((entry) => ({ value: entry.unit, label: entry.unit })) : []}
                                                      placeholder={copy.unit}
                                                    />
                                                  </div>
                                                  <button
                                                    type="button"
                                                    aria-label={copy.removeComponent}
                                                    onClick={() => updateOptionIngredients(groupIndex, optionIndex, (current) => current.filter((_, index) => index !== rowIndex))}
                                                    className="ui-press grid h-10 w-9 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                                                  >
                                                    <X className="h-4 w-4" aria-hidden />
                                                  </button>
                                                </div>
                                                {ingredient && chosenUnit && chosenUnit !== ingredient.unit && row.quantity ? (
                                                  <p className="text-[14px] text-gray-500 dark:text-gray-400">
                                                    = <span className="font-mono tabular-nums">{(row.quantity * perUnit).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span> {ingredient.unit}
                                                  </p>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="mt-3 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => updateOptionGroups((groups) => groups.map((currentGroup, currentGroupIndex) => currentGroupIndex === groupIndex ? { ...currentGroup, options: [...currentGroup.options, { name: "", price_delta: 0, is_default: false, display_order: currentGroup.options.length, is_active: true }] } : currentGroup))}
                                  className="ui-press h-10 rounded-md border border-gray-200 bg-white px-3 text-[14px] font-semibold text-gray-800 transition-colors hover:border-orange-300 hover:text-orange-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-orange-700 dark:hover:text-orange-200"
                                >
                                  + {copy.addOption}
                                </button>
                                {/* Destructive action lives here, out of the scanning
                                    path, so a mis-tap while browsing cannot delete a set. */}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenOptionGroup(null);
                                    updateOptionGroups((groups) => groups.filter((_, index) => index !== groupIndex));
                                  }}
                                  className="ui-press h-9 rounded-md px-2 text-[14px] font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                                >
                                  {copy.removeOptionGroup}
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {itemErrors.options && <p className="text-[14px] font-medium text-red-600 dark:text-red-300">{itemErrors.options}</p>}
                  </div>
                </div>
              )}
              {itemEditorTab === "recipe" && (
                // Laid out the way the phone app does it (owner, 27 ก.ย. 2569): one
                // line per ingredient - its name, how much goes in one dish, and a
                // remove button - and new ones picked from what is not in the
                // recipe yet. The note field was dropped from the form; a note
                // already saved stays on its row untouched.
                <div>
                  <p className="text-[14px] font-medium text-gray-900 dark:text-white">{copy.recipeTitle}</p>
                  {!recipeIngredients.length ? (
                    <p className="mt-3 text-[14px] text-gray-500 dark:text-gray-400">{copy.noIngredients}</p>
                  ) : null}
                  <div className="mt-3 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                    {(itemForm.ingredients ?? []).length === 0 ? (
                      <p className="px-3 py-3 text-[14px] text-gray-500 dark:text-gray-400">{copy.noRecipe}</p>
                    ) : (
                      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                        {(itemForm.ingredients ?? []).map((component, componentIndex) => {
                          const selectedIngredient = recipeIngredients.find((ingredient) => ingredient.ID === component.ingredient_id);
                          const chosenUnit = component.unit || selectedIngredient?.unit || "";
                          const unitChoices = selectedIngredient?.unit_family ?? [{ unit: chosenUnit, stock_per_unit: 1 }];
                          const perUnit = unitChoices.find((entry) => entry.unit === chosenUnit)?.stock_per_unit ?? 1;
                          const inStockUnit = component.quantity * perUnit;
                          const patchComponent = (patch: Partial<MenuIngredientInput>) =>
                            updateRecipeComponents((components) => components.map((current, index) => index === componentIndex ? { ...current, ...patch } : current));
                          const name = selectedIngredient?.name ?? `${copy.ingredient} #${component.ingredient_id}`;
                          // A sealed container is used whole. "0.2 ขวด" means the
                          // thing is really poured, and the ingredient should be
                          // kept in millilitres with the bottle as its packaging.
                          const partSealed = Boolean(
                            selectedIngredient
                            && SEALED_UNITS.has(selectedIngredient.unit)
                            && component.quantity
                            && Math.abs(inStockUnit - Math.round(inStockUnit)) >= 1e-9,
                          );
                          return (
                            <li key={`${component.ingredient_id}-${componentIndex}`} className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <p className="min-w-0 flex-1 truncate text-[14px] text-gray-900 dark:text-white" title={name}>{name}</p>
                                {/* The amount and its unit read as one field, the way
                                    the phone app shows "15 กรัม". A unit that can be
                                    swapped (กรัม / กก.) gets a small picker instead. */}
                                <div className={`flex h-10 ${unitChoices.length > 1 ? "w-16" : "w-24"} shrink-0 items-center rounded-md border border-gray-200 bg-white transition-colors focus-within:border-orange-500 dark:border-gray-700 dark:bg-gray-800`}>
                                  <NumberInput
                                    min={0}
                                    step="0.01"
                                    blankWhenZero
                                    value={component.quantity}
                                    onValue={(value) => patchComponent({ quantity: value })}
                                    placeholder="0"
                                    aria-label={`${name} ${copy.quantity}`}
                                    className="h-full min-w-0 flex-1 bg-transparent px-2 text-right text-[14px] tabular-nums text-gray-900 outline-none placeholder:text-gray-400 dark:text-white"
                                  />
                                  {unitChoices.length <= 1 ? (
                                    <span className="shrink-0 pr-2 text-[14px] text-gray-500 dark:text-gray-400">{chosenUnit}</span>
                                  ) : null}
                                </div>
                                {unitChoices.length > 1 ? (
                                  <div className="w-20 shrink-0">
                                    <ThemedSelect
                                      triggerClassName="!h-10 !text-[14px]"
                                      aria-label={copy.unit}
                                      compact
                                      value={chosenUnit}
                                      onChange={(next) => patchComponent({ unit: next })}
                                      options={unitChoices.map((option) => ({ value: option.unit, label: option.unit }))}
                                    />
                                  </div>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label={`${copy.removeComponent} ${name}`}
                                  onClick={() => updateRecipeComponents((components) => components.filter((_, index) => index !== componentIndex))}
                                  className="ui-press grid h-10 w-8 shrink-0 place-items-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-300"
                                >
                                  <X className="h-4 w-4" aria-hidden />
                                </button>
                              </div>
                              {/* Only worth saying when the two units differ -
                                  otherwise it just repeats the number above. */}
                              {selectedIngredient && chosenUnit && chosenUnit !== selectedIngredient.unit && component.quantity ? (
                                <p className="mt-1 text-right text-[14px] text-gray-500 dark:text-gray-400">
                                  = <span className="font-mono tabular-nums">{inStockUnit.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span> {selectedIngredient.unit}
                                </p>
                              ) : null}
                              {partSealed && selectedIngredient ? (
                                <p className="mt-1 text-[14px] font-medium text-red-600 dark:text-red-300">
                                  {language === "th"
                                    ? `${selectedIngredient.name} ใช้ทั้ง${selectedIngredient.unit} ใส่เป็นจำนวนเต็ม ถ้าเทแบ่งใช้ ให้แก้วัตถุดิบเป็นมิลลิลิตรแล้วตั้ง "บรรจุใน" เป็น${selectedIngredient.unit}`
                                    : `${selectedIngredient.name} is used a whole ${selectedIngredient.unit} at a time. If it is poured, keep it in millilitres with the ${selectedIngredient.unit} as its packaging.`}
                                </p>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {pickableRecipeIngredients.length ? (
                      // Picking one adds its line at once, in its own stock unit;
                      // the list offers only what the recipe does not have yet.
                      <div className="border-t border-gray-100 px-3 py-2.5 dark:border-gray-800">
                        <ThemedSelect
                          triggerClassName="!text-[14px]"
                          aria-label={copy.addRecipeComponent}
                          placeholder={`+ ${copy.addRecipeComponent}`}
                          value=""
                          onChange={(next) => {
                            const picked = recipeIngredients.find((entry) => entry.ID === Number(next));
                            if (!picked) return;
                            updateRecipeComponents((components) => [...components, { ...emptyRecipeComponent(), ingredient_id: picked.ID, unit: picked.unit }]);
                          }}
                          options={pickableRecipeIngredients.map((ingredient) => ({ value: String(ingredient.ID), label: `${ingredient.name} (${ingredient.unit})` }))}
                        />
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2.5 text-[14px] dark:border-gray-800 dark:bg-gray-800/60">
                      <span className="font-medium text-gray-600 dark:text-gray-300">{copy.recipeCost}</span>
                      <span className="font-mono font-semibold tabular-nums text-gray-900 dark:text-white">
                        {formatCurrency(recipeCost(itemForm.ingredients ?? [], recipeIngredients), language, 2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* The submit error was the third child of a two-column grid, so it
                landed in a column instead of across the footer. It is lifted out
                and the two buttons keep the grid to themselves. */}
            <div className="border-t border-gray-200 p-4 dark:border-gray-800">
              {itemErrors.submit && <p className="mb-2 text-[11px] font-medium leading-5 text-red-600 dark:text-red-300">{itemErrors.submit}</p>}
              <div className={`grid gap-2 ${editingItem ? "sm:grid-cols-[auto_minmax(0,1fr)]" : ""}`}>
                {editingItem ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setDeleteTarget({ type: "item", id: editingItem.ID, name: editingItem.name })}
                    className="ui-press h-10 rounded-md border border-red-200 bg-white px-4 text-[13px] font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-900/20"
                  >
                    {copy.delete}
                  </button>
                ) : null}
                <button disabled={submitting || uploadingImage || !categories.length} className="ui-press h-10 rounded-md bg-orange-700 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800">
                  {editingItem ? copy.saveItem : copy.createItem}
                </button>
              </div>
            </div>
          </form>
        </>
      )}

      <WarmConfirmDialog
        open={deleteTarget !== null && !deleteClosing}
        title={copy.confirmDeleteTitle}
        description={deleteTarget ? `“${deleteTarget.name}” — ${copy.confirmDeleteBody}` : ""}
        confirmLabel={copy.confirmDelete}
        cancelLabel={copy.cancel}
        onConfirm={() => {
          if (!deleteTarget) return;
          void (deleteTarget.type === "category" ? removeCategory(deleteTarget.id) : removeItem(deleteTarget.id));
        }}
        onCancel={() => closeDeleteModal()}
        busy={submitting}
      />
    </div>
    </>
  );
}
