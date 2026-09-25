import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { createCategory, deleteCategory, listCategories, listMenuItems, updateCategory } from '@/src/api/menu';
import { GlassButton } from '@/src/components/ai/chrome';
import { AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import { FORM_MAX_WIDTH } from '@/src/components/form/parts';
import { RetryPill } from '@/src/components/hub/stage-tiles';
import { CategoryDragList } from '@/src/components/menu-categories/category-drag-list';
import { CategoryListSkeleton } from '@/src/components/menu-categories/category-list-skeleton';
import { CategoryNameField } from '@/src/components/menu-categories/category-name-field';
import { CategoryInlineRow } from '@/src/components/menu-categories/category-row';
import { EmptyState, Feedback } from '@/src/components/ui';
import {
  categoryActionTitle,
  categoryFailure,
  categoryInUseMessage,
  categoryLoadLine,
  categoryNameMessage,
  type CategoryAction,
} from '@/src/lib/category-error';
import { addOutcome, inlineLocked, renameOutcome, type InlineMode } from '@/src/lib/category-inline';
import {
  categoryDishCounts,
  categoryNameProblem,
  nextCategoryDisplayOrder,
  renumberCategories,
  sortCategories,
  type CategoryNameProblem,
} from '@/src/lib/category-order';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints } from '@/src/theme';
import type { Category } from '@/src/types/menu';

// Menu categories: the list in the order order-taking shows them. Held and
// dragged to reorder, swiped left for a delete rail, tapped to rename in place,
// and the header '+' opens an empty row above the list to add one. No sheet and
// no side panel: the owner found the editor sheet and its save button far too
// much for changing one name (2026-09-24).
//
// A category's place is its display_order, written through the same PUT as a
// rename - there is no reorder endpoint. Every PUT here leaves is_active out:
// the API keeps the stored value when it is omitted, and sending it back is
// what once un-hid a hidden category on rename (2ec5ec2).

type LoadStatus = 'loading' | 'ready' | 'failed';

const IDLE: InlineMode = { kind: 'idle' };

const noop = () => {};

function hapticSuccess() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** The saved category from a create/update response, put in its place in the list. */
function withSaved(list: Category[], saved: Category | undefined): Category[] {
  if (!saved || typeof saved.ID !== 'number') return list;
  return list.some((item) => item.ID === saved.ID)
    ? list.map((item) => (item.ID === saved.ID ? { ...item, ...saved } : item))
    : [...list, saved];
}

export default function MenuCategoriesScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const canManage = can(activeMembership, 'manage_menu');
  const framed = width >= breakpoints.tablet;

  const [categories, setCategories] = useState<Category[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<number, number> | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [mode, setMode] = useState<InlineMode>(IDLE);
  const [openRailId, setOpenRailId] = useState<number | null>(null);
  // Bumped to mount the open name field afresh: autoFocus brings the keyboard
  // back with the text selected after a refused or failed save.
  const [fieldKey, setFieldKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  const [lifted, setLifted] = useState(false);

  const scrollControlRef = useRef<AppScreenScrollControl | null>(null);
  const requestRef = useRef(0);
  const statusRef = useRef<LoadStatus>(status);
  statusRef.current = status;
  const busyRef = useRef(false);
  const reorderBusyRef = useRef(false);
  const liftedRef = useRef(false);
  // The field's handlers run between renders (typing then done in one breath),
  // so the mode they read is this one, written together with the state.
  const modeRef = useRef<InlineMode>(mode);

  const sorted = useMemo(() => sortCategories(categories), [categories]);

  const switchMode = useCallback((next: InlineMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  /**
   * Categories (required) and the dishes (only for the counts), side by side.
   * A quiet load keeps what is on screen if it fails; a dish list that fails
   * drops the counts rather than showing a false "ไม่มีเมนู".
   */
  const load = useCallback(async (options: { quiet?: boolean } = {}) => {
    const request = ++requestRef.current;
    if (!options.quiet) setStatus('loading');
    const [categoryResult, itemResult] = await Promise.allSettled([listCategories(), listMenuItems()]);
    // A newer load, a reorder or a row under the finger owns the list now.
    if (request !== requestRef.current || liftedRef.current) return;
    if (categoryResult.status === 'rejected') {
      if (options.quiet && statusRef.current === 'ready') return;
      setLoadError(categoryResult.reason);
      setStatus('failed');
      return;
    }
    const list = categoryResult.value?.categories || [];
    setCategories(list);
    setCounts((previous) => {
      if (itemResult.status === 'fulfilled') return categoryDishCounts(list, itemResult.value?.menu_items || []);
      return options.quiet ? previous : null;
    });
    setLoadError(null);
    setStatus('ready');
  }, []);

  // On arrival and on every return to the screen, so a change made on the web
  // or another phone shows up without a refresh control. Held while a row is
  // lifted or a new order is being written.
  useFocusEffect(useCallback(() => {
    if (!canManage) return;
    if (liftedRef.current || reorderBusyRef.current) return;
    void load({ quiet: statusRef.current === 'ready' });
  }, [canManage, load]));

  // A lifted row may be dragged sideways near the left edge, and the swipe that
  // closes a delete rail travels right: the stack's back swipe is a native
  // recogniser, takes no part in the rows' responder negotiation, and would pop
  // the screen out from under either. Off for exactly as long as one is going.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !lifted && openRailId === null });
  }, [lifted, navigation, openRailId]);

  const handleLiftChange = useCallback((value: boolean) => {
    liftedRef.current = value;
    setLifted(value);
    // A row picked up is the only thing in hand; a rail left open elsewhere
    // would ride along with the rows it moves between.
    if (value) setOpenRailId(null);
  }, []);

  // Deleted on another device while it was being renamed or had its rail out:
  // there is nothing left to edit.
  useEffect(() => {
    if (status !== 'ready' || busyRef.current) return;
    const current = modeRef.current;
    if (current.kind === 'renaming' && !categories.some((item) => item.ID === current.id)) switchMode(IDLE);
    if (openRailId !== null && !categories.some((item) => item.ID === openRailId)) setOpenRailId(null);
  }, [categories, openRailId, status, switchMode]);

  /**
   * The step's title and the mapped reason, as a toast, and what to reload.
   * Never the server's words. Resolves once a list reload it started has landed.
   */
  const reportFailure = (err: unknown, action: CategoryAction): Promise<void> => {
    const failure = categoryFailure(err, action, language);
    showToast({ tone: 'error', title: failure.title, message: failure.message });
    // Renamed under a category that no longer exists: close the field on it.
    if (failure.code === 'not_found' && modeRef.current.kind === 'renaming') switchMode(IDLE);
    if (failure.reload === 'membership') void refreshMemberships().catch(() => undefined);
    return failure.reload === 'list' ? load({ quiet: true }) : Promise.resolve();
  };

  /** A name the server would refuse, caught before any request. */
  const refuseName = (action: CategoryAction, problem: CategoryNameProblem) => {
    showToast({ tone: 'error', title: categoryActionTitle(action, language), message: categoryNameMessage(problem, language) });
  };

  /** Keeps the open field and hands the keyboard back to it. */
  const reopenField = () => {
    if (modeRef.current.kind !== 'idle') setFieldKey((key) => key + 1);
  };

  const changeDraft = (text: string) => {
    const current = modeRef.current;
    if (current.kind === 'idle') return;
    switchMode({ ...current, draft: text });
  };

  // ------------------------------------------------------------ rename

  const startRename = (category: Category) => {
    if (busyRef.current || reorderBusyRef.current || liftedRef.current) return;
    // A tap while a rail is out puts the rail away; the next tap renames.
    if (openRailId !== null) {
      setOpenRailId(null);
      return;
    }
    if (inlineLocked(modeRef.current)) return;
    switchMode({ kind: 'renaming', id: category.ID, draft: category.name });
  };

  /** A blur that did not follow done: the old name comes back. Ignored mid-save. */
  const cancelRename = (id: number) => {
    if (busyRef.current) return;
    const current = modeRef.current;
    if (current.kind === 'renaming' && current.id === id) switchMode(IDLE);
  };

  const save = async (id: number) => {
    const draft = modeRef.current;
    if (draft.kind !== 'renaming' || draft.id !== id) return;
    if (busyRef.current || reorderBusyRef.current) return;
    const current = categories.find((item) => item.ID === id) ?? null;
    if (!current) {
      void reportFailure({ status: 404 }, 'save');
      return;
    }
    const outcome = renameOutcome(current.name, draft.draft);
    if (outcome.kind !== 'save') {
      // Unchanged closes; emptied puts the old name back.
      switchMode(IDLE);
      return;
    }
    const problem = categoryNameProblem(categories, outcome.name, id);
    if (problem) {
      refuseName('save', problem);
      reopenField();
      return;
    }
    busyRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      // A rename keeps the category's place and never sends is_active.
      const response = await updateCategory(current.ID, { name: outcome.name, display_order: current.display_order });
      saved = true;
      hapticSuccess();
      setCategories((list) => withSaved(list, response ?? { ...current, name: outcome.name }));
      const after = modeRef.current;
      if (after.kind === 'renaming' && after.id === id) switchMode(IDLE);
    } catch (err) {
      void reportFailure(err, 'save');
      reopenField();
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
    if (saved) await load({ quiet: true });
  };

  // ------------------------------------------------------------ add

  const startAdd = () => {
    if (busyRef.current || reorderBusyRef.current || liftedRef.current) return;
    setOpenRailId(null);
    // A rename left open is dropped, as a tap anywhere else would drop it. A
    // second press keeps the open row and what is typed in it.
    if (modeRef.current.kind !== 'adding') switchMode({ kind: 'adding', draft: '' });
    // The row sits above the list, just under the heading. The compact bar
    // only shows once the heading has scrolled away, so from there the row -
    // new or already open - is under the bar or off screen: bring it back.
    scrollControlRef.current?.scrollTo(0, true);
  };

  /** A blur that did not follow done: the empty row goes, with no request. Ignored mid-save. */
  const cancelAdd = () => {
    if (busyRef.current) return;
    if (modeRef.current.kind === 'adding') switchMode(IDLE);
  };

  const create = async () => {
    const draft = modeRef.current;
    if (draft.kind !== 'adding') return;
    if (busyRef.current || reorderBusyRef.current) return;
    const outcome = addOutcome(draft.draft);
    if (outcome.kind === 'discard') {
      switchMode(IDLE);
      return;
    }
    const problem = categoryNameProblem(categories, outcome.name);
    if (problem) {
      refuseName('add', problem);
      reopenField();
      return;
    }
    busyRef.current = true;
    setSaving(true);
    let saved = false;
    try {
      // A new category goes last and starts shown.
      const response = await createCategory({ name: outcome.name, display_order: nextCategoryDisplayOrder(categories), is_active: true });
      saved = true;
      hapticSuccess();
      setCategories((list) => withSaved(list, response));
      if (modeRef.current.kind === 'adding') switchMode(IDLE);
      // It lands at the end of the list, often below the fold.
      showToast({ title: copy('เพิ่มหมวดแล้ว', 'Category added') });
    } catch (err) {
      void reportFailure(err, 'add');
      reopenField();
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
    if (saved) await load({ quiet: true });
  };

  // ------------------------------------------------------------ delete

  const handleRailChange = (id: number | null) => {
    if (id !== null && (busyRef.current || reorderBusyRef.current || liftedRef.current || inlineLocked(modeRef.current))) return;
    setOpenRailId(id);
  };

  /** The rail's ลบ: the swipe was the first step, this tap is the second. */
  const confirmDelete = async (category: Category) => {
    const id = category.ID;
    // The server refuses a category that still holds dishes; when the count
    // is known, say so now instead of sending a request that cannot succeed.
    const dishes = counts?.get(id) ?? 0;
    if (dishes > 0) {
      setOpenRailId(null);
      showToast({ tone: 'error', title: categoryActionTitle('delete', language), message: categoryInUseMessage(dishes, language) });
      // The count is from the last load: dishes moved on the web since then
      // must not keep the delete refused until the screen is left. The next
      // swipe reads a fresh count. Not while a new order is being written - a
      // load then would put the server's half-written order on screen.
      if (!reorderBusyRef.current) void load({ quiet: true });
      return;
    }
    if (busyRef.current || reorderBusyRef.current || inlineLocked(modeRef.current)) return;
    busyRef.current = true;
    setDeleting(true);
    let removed = false;
    try {
      await deleteCategory(id);
      removed = true;
      hapticSuccess();
      setCategories((list) => list.filter((item) => item.ID !== id));
      showToast({ title: copy('ลบหมวดแล้ว', 'Category deleted') });
    } catch (err) {
      void reportFailure(err, 'delete');
    } finally {
      busyRef.current = false;
      setDeleting(false);
      setOpenRailId((open) => (open === id ? null : open));
    }
    if (removed) await load({ quiet: true });
  };

  // ------------------------------------------------------------ reorder

  /**
   * A drop (or a screen reader's move) hands over the whole list in its new
   * order. It shows at once; the categories whose number changed are written
   * one PUT each, name and display_order only. A failure reloads from the
   * server rather than reverting: some of the writes may already have landed.
   */
  const reorder = (ordered: Category[]) => {
    if (busyRef.current || reorderBusyRef.current) return;
    const { categories: next, changed } = renumberCategories(ordered);
    if (changed.length === 0) return;
    reorderBusyRef.current = true;
    // A load already in flight carries the old order; it must not land on top.
    requestRef.current += 1;
    setCategories(next);
    setReorderSaving(true);
    void (async () => {
      try {
        await Promise.all(changed.map((item) => updateCategory(item.ID, { name: item.name, display_order: item.display_order })));
      } catch (err) {
        // The list stays locked until the server's order is back on screen.
        await reportFailure(err, 'reorder');
      } finally {
        reorderBusyRef.current = false;
        setReorderSaving(false);
      }
    })();
  };

  const title = copy('หมวดเมนู', 'Menu categories');

  if (!canManage) {
    return (
      <AppScreen title={title} centerTitle topLevel={false}>
        <Feedback title={copy('ไม่มีสิทธิ์จัดการหมวดเมนู', 'Menu category access unavailable')} tone="info" />
      </AppScreen>
    );
  }

  const fieldLabel = copy('ชื่อหมวด', 'Category name');
  const adding = mode.kind === 'adding';

  const renderEditor = (category: Category): ReactNode => (mode.kind === 'renaming' && mode.id === category.ID ? (
    <CategoryNameField
      key={`rename-${category.ID}-${fieldKey}`}
      accessibilityLabel={fieldLabel}
      busy={saving}
      onCancel={() => cancelRename(category.ID)}
      onChangeText={changeDraft}
      onSubmit={() => { void save(category.ID); }}
      value={mode.draft}
    />
  ) : null);

  const addRow = mode.kind === 'adding' ? (
    <CategoryInlineRow roundBottom={framed && sorted.length === 0} roundTop={framed}>
      <CategoryNameField
        key={`add-${fieldKey}`}
        accessibilityLabel={copy('ชื่อหมวดใหม่', 'New category name')}
        busy={saving}
        onCancel={cancelAdd}
        onChangeText={changeDraft}
        onSubmit={() => { void create(); }}
        placeholder={fieldLabel}
        value={mode.draft}
      />
    </CategoryInlineRow>
  ) : undefined;

  let list: ReactNode;
  if (status === 'loading') {
    list = <CategoryListSkeleton framed={framed} label={copy('กำลังโหลดหมวดเมนู', 'Loading categories')} />;
  } else if (status === 'failed') {
    list = <EmptyState title={categoryLoadLine(loadError, language)} action={<RetryPill onPress={() => { void load(); }} />} />;
  } else if (sorted.length === 0 && !adding) {
    list = <EmptyState title={copy('ยังไม่มีหมวดเมนู', 'No categories yet')} />;
  } else {
    list = (
      <CategoryDragList
        categories={sorted}
        copy={copy}
        counts={counts}
        disabled={saving || deleting || reorderSaving}
        editingId={mode.kind === 'renaming' ? mode.id : null}
        framed={framed}
        header={addRow}
        language={language}
        locked={inlineLocked(mode)}
        onDelete={(category) => { void confirmDelete(category); }}
        onLiftChange={handleLiftChange}
        onRailChange={handleRailChange}
        onRename={startRename}
        onReorder={reorder}
        openRailId={openRailId}
        renderEditor={renderEditor}
        scrollControlRef={scrollControlRef}
      />
    );
  }

  return (
    <AppScreen
      title={title}
      // Centred with a back-button-sized glass "+", as on the menu page it
      // opens from (owner, 2026-09-23).
      centerTitle
      topLevel={false}
      // The tablet draws the same list as the phone, at the settings pages' width.
      contentMaxWidth={framed ? FORM_MAX_WIDTH : undefined}
      // The compact bar repeats it: a second press while the row is open only
      // scrolls back to it.
      action={status === 'ready' ? (
        <GlassButton icon="add" label={copy('เพิ่มหมวด', 'Add category')} onPress={startAdd} />
      ) : undefined}
      // While a row is lifted the page must not scroll under it: iOS scrolls
      // natively and would take the drag. An open delete rail does not scroll
      // away either - the page would carry it off screen still open - so the
      // drag closes it and stops there; the one after that scrolls.
      onScrollBlocked={lifted ? noop : openRailId !== null ? () => setOpenRailId(null) : undefined}
      scrollControlRef={scrollControlRef}
    >
      {list}
    </AppScreen>
  );
}
