import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';

import { listCategories, listMenuItems } from '@/src/api/menu';
import { getOrder } from '@/src/api/order';
import { AppScreen, ScreenHeading } from '@/src/components/app-shell';
import { OrderItemPanel } from '@/src/components/order-item-editor';
import { OrderMenuFilterBar, OrderMenuGrid } from '@/src/components/order-menu-grid';
import { OrderItemPanelPlaceholder, OrderMenuSplit } from '@/src/components/order-menu-split';
import { EmptyState, Feedback } from '@/src/components/ui';
import { addedQuantityByMenu, filterMenuCatalog, groupMenuByCategory } from '@/src/lib/menu-catalog';
import { can } from '@/src/lib/rbac';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';
import type { Order } from '@/src/types/order';

/**
 * Adds a dish that was already served straight onto the bill, skipping the
 * kitchen. Pushed from the bill's header menu, so it slides in from the right
 * and back out to the bill, and it is the order screen's own menu grid rather
 * than a second catalog unfolding under the bill's rows. A tile opens the
 * ordinary item screen in served mode, so options, note and quantity are
 * chosen exactly as when taking an order - on a tablet, in the same side
 * panel the order screen uses.
 */
export default function ServedItemScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const validOrderId = Number.isInteger(orderId) && orderId > 0;
  const { activeMembership } = useAuth();
  const { copy } = useDisplayPreferences();
  const canTakeOrder = can(activeMembership, 'take_order');
  const [order, setOrder] = useState<Order | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // The dish open in the tablet's side panel. Phones push the item screen.
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The order's lines as they stood when this page first loaded. Anything
  // beyond them was added from here, which is what the tile badge counts.
  const baselineIdsRef = useRef<ReadonlySet<number> | null>(null);
  // A load that began before the tablet panel's add must not land after it:
  // the older answer would take the new line off the badge. The add drops it.
  const loadGeneration = useRef(createRequestGeneration());

  const load = useCallback(async () => {
    if (!canTakeOrder || !validOrderId) return;
    const request = loadGeneration.current.begin();
    setError(null);
    try {
      const [orderResponse, menuResponse, categoryResponse] = await Promise.all([
        getOrder(orderId),
        listMenuItems(),
        listCategories(),
      ]);
      if (!loadGeneration.current.isCurrent(request)) return;
      if (baselineIdsRef.current === null) {
        baselineIdsRef.current = new Set((orderResponse.items || []).map((item) => item.ID));
      }
      setOrder(orderResponse);
      setMenuItems(menuResponse.menu_items || []);
      setCategories(categoryResponse.categories || []);
    } catch (err) {
      if (!loadGeneration.current.isCurrent(request)) return;
      setError(err instanceof Error ? err.message : copy('โหลดเมนูไม่สำเร็จ', 'Could not load the menu'));
    }
  }, [canTakeOrder, copy, orderId, validOrderId]);

  // Also runs on the way back from the item screen, which is how a new line
  // reaches the badge.
  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const menuGroups = useMemo(() => groupMenuByCategory(
    filterMenuCatalog(menuItems, { categoryId, search }),
    categories,
    copy('ไม่ระบุหมวด', 'Uncategorised'),
  ), [categories, categoryId, copy, menuItems, search]);

  const addedByMenu = useMemo(
    () => addedQuantityByMenu(order?.items, baselineIdsRef.current ?? new Set()),
    [order?.items],
  );

  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearch('');
    setSearchOpen(false);
  }, []);

  const editable = Boolean(order)
    && order?.payment_status !== 'paid'
    && order?.status !== 'completed'
    && order?.status !== 'cancelled';
  // Split from the first frame on a tablet, as the order screen is; only a
  // bill that turns out to be closed goes back to the single column.
  const sidePanel = width >= breakpoints.tablet && (!order || editable);
  const selectedMenu = useMemo(
    () => (selectedMenuId === null ? null : menuItems.find((item) => item.ID === selectedMenuId) ?? null),
    [menuItems, selectedMenuId],
  );

  // The keyboard goes, the keyword stays - see the order screen's pickDish.
  const pickDish = useCallback((item: MenuItem) => {
    Keyboard.dismiss();
    setSelectedMenuId(item.ID);
  }, []);

  // The new line reaches the badge from the answer itself. The panel empties
  // only if it still shows the dish that was added.
  const handleDishAdded = useCallback((next: Order, menuId: number) => {
    loadGeneration.current.invalidate();
    setOrder(next);
    setSelectedMenuId((current) => (current === menuId ? null : current));
  }, []);

  const title = copy('เพิ่มรายการที่เสิร์ฟแล้ว', 'Add served item');

  if (!canTakeOrder) {
    return (
      <AppScreen title={title} topLevel={false}>
        <EmptyState
          title={copy('ไม่มีสิทธิ์เพิ่มรายการ', 'No permission to add items')}
          detail={copy('ต้องมีสิทธิ์รับออเดอร์', 'The take_order permission is required.')}
        />
      </AppScreen>
    );
  }

  if (!validOrderId) {
    return (
      <AppScreen title={title} topLevel={false}>
        <EmptyState
          title={copy('ไม่พบออเดอร์นี้', 'Order not found')}
          detail={copy('รหัสออเดอร์ไม่ถูกต้อง กรุณากลับไปเลือกรายการใหม่', 'The order ID is invalid. Go back and choose an order again.')}
        />
      </AppScreen>
    );
  }

  const contextLabel = order?.table?.display_label
    || (order?.order_type === 'takeaway' ? copy('ซื้อกลับบ้าน', 'Takeaway') : '');

  const subtitle = order
    ? [contextLabel, order.order_number].filter(Boolean).join(', ')
    : copy('กำลังโหลดเมนู', 'Loading menu');
  const filterBar = editable ? (
    <OrderMenuFilterBar
      categories={categories}
      categoryId={categoryId}
      onCategoryChange={setCategoryId}
      search={search}
      onSearchChange={setSearch}
      searchOpen={searchOpen}
      onOpenSearch={() => setSearchOpen(true)}
      onCloseSearch={sidePanel ? closeSearch : undefined}
    />
  ) : undefined;
  const loadFailure = error ? <Feedback title={copy('โหลดเมนูไม่สำเร็จ', 'Could not load the menu')} detail={error} tone="danger" /> : null;
  const grid = editable ? (
    <OrderMenuGrid
      groups={menuGroups}
      countByMenu={addedByMenu}
      tabletWorkspace={sidePanel}
      onPressItem={(item) => (sidePanel
        ? pickDish(item)
        : router.push({
          pathname: '/order/item' as never,
          params: { id: String(orderId), menuId: String(item.ID), served: '1' },
        } as never))}
      accessibilityLabelFor={(item, added) => (added > 0
        ? copy(`เพิ่ม ${item.name} ลงในบิล เพิ่มแล้ว ${added}`, `Add ${item.name} to the bill, ${added} added`)
        : copy(`เพิ่ม ${item.name} ลงในบิล`, `Add ${item.name} to the bill`))}
    />
  ) : null;

  if (sidePanel) {
    const dishPanel = order && selectedMenu ? (
      <OrderItemPanel
        key={selectedMenu.ID}
        initial={{ order, menu: selectedMenu }}
        menuId={selectedMenu.ID}
        onClose={() => setSelectedMenuId(null)}
        onDone={(next) => handleDishAdded(next, selectedMenu.ID)}
        orderId={orderId}
        served
      />
    ) : <OrderItemPanelPlaceholder />;

    return (
      <AppScreen title={title} topLevel={false} scroll={false} hideTitle>
        <OrderMenuSplit
          header={<ScreenHeading showBack subtitle={subtitle} title={title} />}
          filterBar={filterBar}
          panel={dishPanel}
        >
          {loadFailure}
          {grid}
        </OrderMenuSplit>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={title}
      subtitle={subtitle}
      topLevel={false}
      stickyHeading
      stickyContent={filterBar}
      onTouchOutsideStickyContent={searchOpen ? closeSearch : undefined}
    >
      {loadFailure}

      {order && !editable ? (
        <EmptyState
          title={copy('บิลนี้ปิดแล้ว', 'This bill is closed')}
          detail={copy('เพิ่มรายการในบิลที่ชำระแล้วไม่ได้', 'Items cannot be added to a settled bill.')}
        />
      ) : null}

      {grid}
    </AppScreen>
  );
}
