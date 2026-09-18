import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';

import { listCategories, listMenuItems } from '@/src/api/menu';
import { getOrder } from '@/src/api/order';
import { AppScreen } from '@/src/components/app-shell';
import { OrderMenuFilterBar, OrderMenuGrid } from '@/src/components/order-menu-grid';
import { EmptyState, Feedback } from '@/src/components/ui';
import { addedQuantityByMenu, filterMenuCatalog, groupMenuByCategory } from '@/src/lib/menu-catalog';
import { can } from '@/src/lib/rbac';
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
 * chosen exactly as when taking an order.
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
  const [error, setError] = useState<string | null>(null);
  // The order's lines as they stood when this page first loaded. Anything
  // beyond them was added from here, which is what the tile badge counts.
  const baselineIdsRef = useRef<ReadonlySet<number> | null>(null);

  const load = useCallback(async () => {
    if (!canTakeOrder || !validOrderId) return;
    setError(null);
    try {
      const [orderResponse, menuResponse, categoryResponse] = await Promise.all([
        getOrder(orderId),
        listMenuItems(),
        listCategories(),
      ]);
      if (baselineIdsRef.current === null) {
        baselineIdsRef.current = new Set((orderResponse.items || []).map((item) => item.ID));
      }
      setOrder(orderResponse);
      setMenuItems(menuResponse.menu_items || []);
      setCategories(categoryResponse.categories || []);
    } catch (err) {
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

  return (
    <AppScreen
      title={title}
      subtitle={order
        ? [contextLabel, order.order_number].filter(Boolean).join(' · ')
        : copy('กำลังโหลดเมนู', 'Loading menu')}
      topLevel={false}
      stickyHeading
      stickyContent={editable ? (
        <OrderMenuFilterBar
          categories={categories}
          categoryId={categoryId}
          onCategoryChange={setCategoryId}
          search={search}
          onSearchChange={setSearch}
          searchOpen={searchOpen}
          onOpenSearch={() => setSearchOpen(true)}
        />
      ) : undefined}
      onTouchOutsideStickyContent={searchOpen ? closeSearch : undefined}
    >
      {error ? <Feedback title={copy('โหลดเมนูไม่สำเร็จ', 'Could not load the menu')} detail={error} tone="danger" /> : null}

      {order && !editable ? (
        <EmptyState
          title={copy('บิลนี้ปิดแล้ว', 'This bill is closed')}
          detail={copy('เพิ่มรายการในบิลที่ชำระแล้วไม่ได้', 'Items cannot be added to a settled bill.')}
        />
      ) : null}

      {editable ? (
        <OrderMenuGrid
          groups={menuGroups}
          countByMenu={addedByMenu}
          tabletWorkspace={width >= breakpoints.tabletWorkspace}
          onPressItem={(item) => router.push({
            pathname: '/order/item' as never,
            params: { id: String(orderId), menuId: String(item.ID), served: '1' },
          } as never)}
          accessibilityLabelFor={(item, added) => (added > 0
            ? copy(`เพิ่ม ${item.name} ลงในบิล เพิ่มแล้ว ${added}`, `Add ${item.name} to the bill, ${added} added`)
            : copy(`เพิ่ม ${item.name} ลงในบิล`, `Add ${item.name} to the bill`))}
        />
      ) : null}
    </AppScreen>
  );
}
