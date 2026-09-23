import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View, type TextInput } from 'react-native';

import { listCategories, listMenuItems, setMenuItemAvailability } from '@/src/api/menu';
import { GlassButton } from '@/src/components/ai/chrome';
import { AppRefreshControl, AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import { MenuImage } from '@/src/components/menu-image';
import { MenuCompactRow } from '@/src/components/menu-manage/menu-compact-row';
import { MenuFilterBar } from '@/src/components/menu-manage/menu-filter-bar';
import { MenuManageSkeleton } from '@/src/components/menu-manage/menu-manage-skeleton';
import { MenuManageTile } from '@/src/components/menu-manage/menu-manage-tile';
import { PlanFailed, PlanState } from '@/src/components/table-plan/plan-states';
import { filterMenuCatalog } from '@/src/lib/menu-catalog';
import {
  activeCategoryFilter,
  menuLoadFailureLine,
  menuManageFailure,
  menuManageView,
  mergeAvailabilityReply,
  withAvailability,
} from '@/src/lib/menu-manage';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, spacing } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';

export default function MenuScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const lang = language === 'en' ? 'en' : 'th';
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  // `loaded`: an answer has arrived at least once. `loadFailure`: the line a
  // failed load shows while there are no dishes to keep on screen.
  const [loaded, setLoaded] = useState(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  // One save at a time. A second tap on the same switch while its PATCH was in
  // flight sent a second request that raced the first, and the first one's
  // `finally` cleared the saving state while the second was still out.
  const savingRef = useRef(false);
  // Only the newest load may land: a slow focus load answering after a pull
  // would put the older list back.
  const loadSeq = useRef(0);
  const itemCount = useRef(0);
  // Read through a ref so a permission refresh never re-creates `load`, which
  // would re-run the focus effect and could loop on a lasting 403.
  const refreshMembershipsRef = useRef(refreshMemberships);
  // A focus load can answer after the screen was left for /menu/item; its
  // failure alert must not land over the editor, where it reads as the edit
  // failing. The list stays, and the next focus loads again.
  const focusedRef = useRef(false);
  // The compact header's row moves the page and the caret itself.
  const scrollControlRef = useRef<AppScreenScrollControl | null>(null);
  const searchRef = useRef<TextInput | null>(null);
  const canManage = can(activeMembership, 'manage_menu');
  const canView = canManage || can(activeMembership, 'view_menu');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;

  useEffect(() => {
    itemCount.current = items.length;
  }, [items]);
  useEffect(() => {
    refreshMembershipsRef.current = refreshMemberships;
  }, [refreshMemberships]);

  const load = useCallback(async () => {
    if (!canView) return;
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    try {
      const [categoryResponse, itemResponse] = await Promise.all([listCategories(), listMenuItems()]);
      if (seq !== loadSeq.current) return;
      setCategories(categoryResponse.categories || []);
      setItems(itemResponse.menu_items || []);
      setLoaded(true);
      setLoadFailure(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      const failure = menuManageFailure(err, 'load', lang);
      if (failure.reload === 'membership') void refreshMembershipsRef.current().catch(() => undefined);
      // With no dishes on screen the failed state names it, beside its own
      // ลองอีกครั้ง. Over a list already shown the list stays, and the failure
      // is raised, so stale dishes never pass for fresh ones.
      if (itemCount.current > 0) {
        if (focusedRef.current) showToast({ tone: 'error', title: failure.title, message: failure.message });
      } else {
        setLoadFailure(menuLoadFailureLine(err, lang));
      }
    }
  }, [canView, lang, showToast]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => {
      focusedRef.current = false;
    };
  }, []));
  // Every focus reloads, which is how edits made on /menu/item and
  // /menu/categories show up on the way back.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const retry = () => {
    setLoadFailure(null);
    setLoaded(false);
    void load();
  };

  // A category deleted or switched off on /menu/categories leaves the options on
  // the reload; its id must not stay behind as a blank picker over an empty list.
  useEffect(() => {
    const kept = activeCategoryFilter(category, categories);
    if (kept !== category) setCategory(kept);
  }, [categories, category]);

  const categoryOptions = useMemo(() => [
    { label: copy('ทุกหมวด', 'All categories'), value: 'all' },
    ...categories.filter((item) => item.is_active).map((item) => ({ label: item.name, value: String(item.ID) })),
  ], [categories, copy]);

  // The same rule as the order screen's picker: main or linked category, and a
  // trimmed, case-insensitive match on the name or the description.
  const filtered = useMemo(
    () => filterMenuCatalog(items, { categoryId: category, search }),
    [category, items, search],
  );
  const view = menuManageView({ loaded, failed: loadFailure !== null, total: items.length, shown: filtered.length });

  const clearFilters = () => {
    setCategory('all');
    setSearch('');
  };

  // The switch is controlled, so its thumb follows `is_available` - not the
  // finger. Flipping the row only after the server replied left a window where
  // Android had already slid the thumb across, the next render snapped it back
  // to the stale prop, and the reply slid it over again: a visible wobble on
  // every tap. Flip locally first and let the reply (or a failure) settle it.
  async function toggle(item: MenuItem) {
    if (!canManage || savingRef.current) return;
    const next = !item.is_available;
    savingRef.current = true;
    setSavingId(item.ID);
    setItems((current) => withAvailability(current, item.ID, next));
    try {
      const updated = await setMenuItemAvailability(item.ID, next);
      // Merged, not swapped in: the reply carries no stock count.
      setItems((current) => mergeAvailabilityReply(current, updated));
    } catch (err) {
      setItems((current) => withAvailability(current, item.ID, !next));
      const failure = menuManageFailure(err, 'toggle', lang);
      showToast({ tone: 'error', title: failure.title, message: failure.message });
      if (failure.reload === 'list') void load();
      if (failure.reload === 'membership') void refreshMembershipsRef.current().catch(() => undefined);
    } finally {
      savingRef.current = false;
      setSavingId(null);
    }
  }

  if (!canView) {
    return (
      <AppScreen title={copy('เมนูอาหาร', 'Menu')} topLevel={false}>
        <PlanState icon="lock-closed-outline" line={copy('ไม่มีสิทธิ์ดูเมนู', 'No access to the menu')} />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={copy('เมนูอาหาร', 'Menu')}
      topLevel={false}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      // Centred like every other management page (owner, 2026-09-23: the menu
      // was the one heading still hugging the left). The add button is a glass
      // disc the size of the back button, so the title sits on the real centre
      // line instead of being pushed left by a wide orange pill.
      centerTitle
      // The compact bar repeats this: a second push of the editor is harmless.
      action={canManage ? (
        <GlassButton icon="add" label={copy('เพิ่มเมนู', 'Add item')} onPress={() => router.push('/menu/item' as never)} />
      ) : undefined}
      scrollControlRef={scrollControlRef}
      // Only over dishes: a skeleton, a failed load or an empty menu has no
      // list to be read through.
      compactRow={view === 'list' || view === 'no_match' ? (
        <MenuCompactRow
          category={category}
          onCategory={setCategory}
          options={categoryOptions}
          scrollControlRef={scrollControlRef}
          searchRef={searchRef}
          t={copy}
        />
      ) : undefined}
    >
      <MenuFilterBar
        category={category}
        onCategory={setCategory}
        onManageCategories={canManage ? () => router.push('/menu/categories' as never) : undefined}
        onSearch={setSearch}
        searchRef={searchRef}
        options={categoryOptions}
        search={search}
        t={copy}
      />

      {view === 'skeleton' ? (
        <MenuManageSkeleton label={copy('กำลังโหลดเมนู', 'Loading the menu')} tabletWorkspace={tabletWorkspace} />
      ) : null}
      {view === 'failed' && loadFailure ? <PlanFailed line={loadFailure} onRetry={retry} /> : null}
      {view === 'empty' ? <PlanState icon="restaurant-outline" line={copy('ยังไม่มีเมนู', 'No menu items yet')} /> : null}
      {view === 'no_match' ? (
        <PlanState
          icon="search-outline"
          line={copy('ไม่พบเมนู', 'No menu items found')}
          action={{ label: copy('ล้างตัวกรอง', 'Clear filters'), onPress: clearFilters }}
        />
      ) : null}

      {view === 'list' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.md }}>
          {filtered.map((item) => (
            <MenuManageTile
              key={item.ID}
              item={item}
              canManage={canManage}
              tabletWorkspace={tabletWorkspace}
              switchDisabled={!canManage || (savingId !== null && savingId !== item.ID)}
              onOpen={() => router.push({ pathname: '/menu/item' as never, params: { id: String(item.ID) } } as never)}
              onToggle={() => void toggle(item)}
              image={(
                <MenuImage
                  accessibilityLabel={copy(`รูปเมนู ${item.name}`, `Photo of ${item.name}`)}
                  imageUrl={item.image_url}
                  variant="card"
                />
              )}
            />
          ))}
        </View>
      ) : null}
    </AppScreen>
  );
}
