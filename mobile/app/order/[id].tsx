import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, useWindowDimensions, View } from 'react-native';

import { listCategories, listMenuItems } from '@/src/api/menu';
import { closeEmptyTable, deleteOrderItem, getOrder, updateOrderItem } from '@/src/api/order';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { MenuImage } from '@/src/components/menu-image';
import { OrderMenuFilterBar, OrderMenuGrid } from '@/src/components/order-menu-grid';
import { Button, Divider, EmptyState, Feedback, GlassLayer, SectionHeader, StatusBadge, Surface } from '@/src/components/ui';
import { itemStatusLabel, money, orderStatusLabel } from '@/src/lib/format';
import { filterMenuCatalog, groupMenuByCategory } from '@/src/lib/menu-catalog';
import {
  createOrderDetailRequestGuard,
  currentRoundPresentation,
  orderSummaryPresentation,
  pendingQuantityByMenu,
  selectOrderItemImage,
  shouldShowCurrentRoundBasket,
  summarizeCurrentRound,
} from '@/src/lib/order-detail-runtime';
import {
  activeOrderItems,
  canCloseEmptyOrder,
} from '@/src/lib/order-workflow';
import { orderDetailLoadResources } from '@/src/lib/permission-parity';
import { createRequestGeneration } from '@/src/lib/request-generation';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, controlShadow, palette, radius, spacing, typeScale } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';
import type { Order, OrderItem } from '@/src/types/order';

function itemTone(status: OrderItem['status']) {
  if (status === 'ready' || status === 'served') return 'success' as const;
  if (status === 'cooking' || status === 'pending') return 'warning' as const;
  if (status === 'cancelled') return 'danger' as const;
  return 'neutral' as const;
}

function QuantityAction({
  label,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  icon: 'add' | 'remove';
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: palette.borderStrong,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.surfaceStrong : palette.surface,
        opacity: disabled ? 0.42 : pressed ? 0.72 : 1,
      })}
    >
      <AppIcon color={palette.textStrong} name={icon} size={20} />
    </Pressable>
  );
}

function CurrentRoundBasket({
  label,
  value,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  label: string;
  value: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={{ backgroundColor: palette.surface, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xxl }}>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        // The same shape and material as every other primary action: radius.md
        // and the app's control lift, rather than this bar's own 8pt corner and
        // hand-rolled drop shadow. It was the last control still styled to its
        // own rules.
        style={({ pressed }) => ({
          borderRadius: radius.md,
          ...controlShadow,
          opacity: disabled ? 0.5 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.992 : 1 }],
        })}
      >
        <GlassLayer
          style={{
            height: 56,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: spacing.lg,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
          }}
          // The same pale wash and orange ink as the add-to-order button, so the
          // two primary actions in this flow are one thing. `primaryInk`, not
          // `primary`, because the brand orange as text on its own soft fill
          // measures 4.43:1 — under AA.
          tint={palette.primaryWash}
          fallback={palette.primaryWash}
          fallbackBorder={palette.controlBorder}
        >
        <View style={{ minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppIcon color={palette.primaryInk} name="basket-outline" size={20} />
          <Text numberOfLines={1} style={{ minWidth: 0, flex: 1, color: palette.primaryInk, fontSize: 14, fontWeight: '700' }}>
            {label}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ color: palette.primaryInk, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {value}
        </Text>
        </GlassLayer>
      </Pressable>
    </View>
  );
}

function OrderSummaryAction({
  count,
  label,
  accessibilityLabel,
  onPress,
}: {
  count: number;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.surfaceStrong : palette.surface,
        paddingHorizontal: spacing.md,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <AppIcon color={palette.muted} name="receipt-outline" size={17} />
      <Text numberOfLines={1} style={{ color: palette.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {count.toLocaleString()} {label}
      </Text>
    </Pressable>
  );
}

export default function OrderDetailScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const validOrderId = Number.isInteger(orderId) && orderId > 0;
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const [order, setOrder] = useState<Order | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `error` is the order failing to load; a tap's outcome is a toast (14 ก.ย.).
  const { showToast } = useToast();
  const [confirmEmptyClose, setConfirmEmptyClose] = useState(false);
  const requestGuardRef = useRef(createOrderDetailRequestGuard(createRequestGeneration()));
  const foregroundLoadRef = useRef<number | null>(null);
  const canTakeOrder = can(activeMembership, 'take_order');
  const canPay = can(activeMembership, 'take_payment');
  const canViewOrders = can(activeMembership, 'view_orders');
  const canAccessOrder = canViewOrders || canTakeOrder || canPay;

  const load = useCallback(async (quiet = false) => {
    if (!canAccessOrder || !validOrderId) {
      requestGuardRef.current.invalidateLoads();
      foregroundLoadRef.current = null;
      return;
    }
    if (quiet && foregroundLoadRef.current !== null) return;

    const request = requestGuardRef.current.beginLoad();
    if (request === null) return;

    if (!quiet) {
      foregroundLoadRef.current = request;
    }
    setError(null);
    try {
      const resources = orderDetailLoadResources(canTakeOrder);
      if (resources.includes('menu')) {
        const [orderResponse, menuResponse, categoryResponse] = await Promise.all([
          getOrder(orderId),
          listMenuItems(),
          listCategories(),
        ]);
        if (!requestGuardRef.current.canApplyLoad(request)) return;
        setOrder(orderResponse);
        setMenuItems(menuResponse.menu_items || []);
        setCategories(categoryResponse.categories || []);
      } else {
        const orderResponse = await getOrder(orderId);
        if (!requestGuardRef.current.canApplyLoad(request)) return;
        setOrder(orderResponse);
        setMenuItems([]);
        setCategories([]);
      }
    } catch (err) {
      if (requestGuardRef.current.canApplyLoad(request)) {
        setError(err instanceof Error ? err.message : copy('โหลดออเดอร์ไม่สำเร็จ', 'Could not load the order'));
      }
    } finally {
      if (!quiet && foregroundLoadRef.current === request) {
        foregroundLoadRef.current = null;
      }
    }
  }, [canAccessOrder, canTakeOrder, copy, orderId, validOrderId]);
  useFocusEffect(useCallback(() => {
    load();
    const timer = setInterval(() => load(true), 10000);
    return () => {
      clearInterval(timer);
      requestGuardRef.current.invalidateLoads();
      foregroundLoadRef.current = null;
    };
  }, [load]));

  const activeItems = useMemo(() => activeOrderItems(order?.items), [order?.items]);
  const pending = useMemo(() => activeItems.filter((item) => item.status === 'pending'), [activeItems]);
  const activeQuantity = useMemo(() => activeItems.reduce((sum, item) => sum + item.quantity, 0), [activeItems]);
  const pendingQuantity = useMemo(() => pending.reduce((sum, item) => sum + item.quantity, 0), [pending]);
  const menuImageById = useMemo(
    () => new Map(menuItems.map((item) => [item.ID, item.image_url])),
    [menuItems],
  );
  const currentRoundSummary = useMemo(() => summarizeCurrentRound(order?.items), [order?.items]);
  const pendingByMenu = useMemo(() => pendingQuantityByMenu(order?.items), [order?.items]);
  const currentRoundCopy = useMemo(() => currentRoundPresentation(currentRoundSummary, language), [currentRoundSummary, language]);
  const orderSummaryCopy = useMemo(() => orderSummaryPresentation(language), [language]);
  const menuGroups = useMemo(() => groupMenuByCategory(
    filterMenuCatalog(menuItems, { categoryId, search }),
    categories,
    copy('ไม่ระบุหมวด', 'Uncategorised'),
  ), [categories, categoryId, copy, menuItems, search]);
  const locked = order?.status === 'completed' || order?.status === 'cancelled';
  const canCloseEmpty = canTakeOrder && canCloseEmptyOrder(order);

  async function mutate(action: () => Promise<Order>, success?: string): Promise<boolean> {
    if (!requestGuardRef.current.beginMutation()) return false;

    if (foregroundLoadRef.current !== null) {
      foregroundLoadRef.current = null;
    }
    setSubmitting(true);
    try {
      setOrder(await action());
      if (success) showToast({ title: success });
      return true;
    } catch (err) {
      showToast({
        tone: 'error',
        title: copy('ทำรายการไม่สำเร็จ', 'Could not complete this action'),
        message: err instanceof Error ? err.message : undefined,
      });
      return false;
    }
    finally {
      requestGuardRef.current.finishMutation();
      setSubmitting(false);
    }
  }

  async function changeQuantity(item: OrderItem, delta: number) {
    const quantity = item.quantity + delta;
    if (quantity <= 0) { await mutate(() => deleteOrderItem(orderId, item.ID), copy('ลบรายการแล้ว', 'Item removed')); return; }
    await mutate(() => updateOrderItem(orderId, item.ID, { quantity, note: item.note }));
  }

  async function closeEmpty() {
    if (!canCloseEmpty) return;
    if (!confirmEmptyClose) { setConfirmEmptyClose(true); return; }
    const closed = await mutate(() => closeEmptyTable(orderId));
    if (closed) router.replace('/tables');
  }

  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  const showCurrentRoundBasket = shouldShowCurrentRoundBasket({
    canTakeOrder,
    orderStatus: order?.status,
    pendingQuantity: currentRoundSummary.quantity,
  });
  const refreshControl = <AppRefreshControl onRefresh={() => load()} />;
  const orderSummaryContent = order ? (
    <>
      <SectionHeader
        title={copy('สรุปออเดอร์', 'Order summary')}
        detail={copy(
          `${activeQuantity.toLocaleString('th-TH')} รายการในออเดอร์`,
          `${activeQuantity.toLocaleString('en-US')} items in this order`,
        )}
      />
      {activeItems.map((item, index) => {
        const imageUrl = selectOrderItemImage({
          menuId: item.menu_id,
          menuImageUrl: item.menu?.image_url,
        }, menuImageById);
        return (
          <View key={item.ID}>
            {index ? <Divider /> : null}
            <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <MenuImage
                  accessibilityLabel={copy(`รูปเมนู ${item.menu_name}`, `Photo of ${item.menu_name}`)}
                  imageUrl={imageUrl}
                  size={tabletWorkspace ? 64 : 56}
                  variant="row"
                />
                <View style={{ minWidth: 0, flex: 1, gap: 3 }}>
                  <Text selectable style={typeScale.cardTitle}>{item.menu_name}</Text>
                  {item.status !== 'pending' || !canTakeOrder ? (
                    <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                      {copy(`จำนวน ${item.quantity.toLocaleString('th-TH')}`, `Quantity ${item.quantity.toLocaleString('en-US')}`)}
                    </Text>
                  ) : null}
                  {item.selected_options?.length ? <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{item.selected_options.map((option) => `${option.group_name}: ${option.option_name}`).join(' · ')}</Text> : null}
                  {item.note ? <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('หมายเหตุ', 'Note')}: {item.note}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                  <Text selectable style={typeScale.number}>{money(item.subtotal, language)}</Text>
                  <StatusBadge label={itemStatusLabel(item.status, language)} tone={itemTone(item.status)} />
                </View>
              </View>
              {item.status === 'pending' && canTakeOrder ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm }}>
                  <QuantityAction
                    label={copy(`ลดจำนวน ${item.menu_name}`, `Decrease ${item.menu_name} quantity`)}
                    icon="remove"
                    onPress={() => changeQuantity(item, -1)}
                    disabled={submitting}
                  />
                  <Text selectable style={[typeScale.number, { minWidth: 34, textAlign: 'center' }]}>{item.quantity.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</Text>
                  <QuantityAction
                    label={copy(`เพิ่มจำนวน ${item.menu_name}`, `Increase ${item.menu_name} quantity`)}
                    icon="add"
                    onPress={() => changeQuantity(item, 1)}
                    disabled={submitting}
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      {!activeItems.length ? <EmptyState title={copy('ยังไม่มีรายการอาหาร', 'No items yet')} detail={copy('เลือกเมนูเพื่อเริ่มออเดอร์', 'Choose a menu item to start the order.')} /> : null}
      {/* Always shown now. This used to be hidden whenever the bottom bar was
          carrying the total; that bar is gone, so nothing else states it here. */}
      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.xs }}>
        <Text selectable style={[typeScale.body, { color: palette.muted }]}>{copy('ยอดรวมออเดอร์', 'Order total')}</Text>
        <Text selectable style={[typeScale.number, { fontSize: 20, fontWeight: '600' }]}>{money(order.grand_total, language)}</Text>
      </View>
    </>
  ) : null;

  // Opening the search takes the filter row over: the category picker is gone
  // until this runs. `Keyboard.dismiss()` is not redundant with unmounting the
  // field - unmounting blurs it, and blur puts the keyboard away a frame later,
  // which reads as the row snapping back and the keyboard trailing after it.
  const closeSearch = useCallback(() => {
    Keyboard.dismiss();
    setSearch('');
    setSearchOpen(false);
  }, []);

  // Pinned with the heading rather than scrolled with the grid: a filter that
  // has scrolled off screen cannot be changed without scrolling back for it.
  // One row, not two — the category picker and a magnifier share it, and the
  // search field takes the picker's place only while it is being used.
  const menuFilterBar = order && !locked && canTakeOrder ? (
    <OrderMenuFilterBar
      categories={categories}
      categoryId={categoryId}
      onCategoryChange={setCategoryId}
      search={search}
      onSearchChange={setSearch}
      searchOpen={searchOpen}
      onOpenSearch={() => setSearchOpen(true)}
    />
  ) : null;

  // The badge counts only what is still in this round, as the web POS tile does.
  const menuWorkspace = order && !locked && canTakeOrder ? (
    <OrderMenuGrid
      groups={menuGroups}
      countByMenu={pendingByMenu}
      tabletWorkspace={tabletWorkspace}
      onPressItem={(item) => router.push({ pathname: '/order/item' as never, params: { id: String(orderId), menuId: String(item.ID) } } as never)}
      accessibilityLabelFor={(item, inRound) => (inRound > 0
        ? copy(`เพิ่มเมนู ${item.name} ในตะกร้า ${inRound}`, `Add ${item.name}, ${inRound} in cart`)
        : copy(`เพิ่มเมนู ${item.name}`, `Add ${item.name}`))}
    />
  ) : null;

  function renderDestructiveActions() {
    const stackActions = width < 520;
    const actionStyle = stackActions ? { width: '100%' as const } : { flex: 1 };
    // No heading and no explanation: the control only exists while the order is
    // empty, which is exactly the moment "I opened the wrong table" happens, and
    // the confirm step says what it does by changing its own label.
    if (!canCloseEmpty) return null;
    return (
      <View style={{ flexDirection: stackActions ? 'column' : 'row', gap: spacing.sm }}>
        {confirmEmptyClose ? <Button variant="glass" label={copy('ยกเลิก', 'Cancel')} onPress={() => setConfirmEmptyClose(false)} style={actionStyle} /> : null}
        <Button variant={confirmEmptyClose ? 'danger' : 'glass'} label={confirmEmptyClose ? copy('ยืนยันปิดโต๊ะ', 'Confirm table close') : copy('ปิดโต๊ะว่าง', 'Close empty table')} onPress={closeEmpty} loading={submitting} style={actionStyle} />
      </View>
    );
  }

  if (!canAccessOrder) {
    return <AppScreen title={copy('รายละเอียดออเดอร์', 'Order details')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์ดูออเดอร์', 'No permission to view orders')} detail={copy('ต้องมีสิทธิ์รับออเดอร์ ดูออเดอร์ หรือรับชำระเงิน', 'The take_order, view_orders, or take_payment permission is required.')} /></AppScreen>;
  }

  if (!validOrderId) {
    return <AppScreen title={copy('รายละเอียดออเดอร์', 'Order details')} topLevel={false}><EmptyState title={copy('ไม่พบออเดอร์นี้', 'Order not found')} detail={copy('รหัสออเดอร์ไม่ถูกต้อง กรุณากลับไปเลือกรายการใหม่', 'The order ID is invalid. Go back and choose an order again.')} /></AppScreen>;
  }

  // No billing bar across the bottom. It sat over the menu grid permanently for
  // an action taken once per order, and it belongs with the order it settles:
  // the item count in the header opens the summary, and the bill button is there.
  const openOrderSummary = useCallback(() => {
    router.push({ pathname: '/order/bill' as never, params: { id: String(orderId) } } as never);
  }, [orderId]);

  // The basket and the `รายการ` chip in the header lead to the SAME screen -
  // the order summary. They used to fork: the chip opened the summary and the
  // basket opened a separate current-round screen that listed the same unsent
  // items again, so a waiter checking the order saw two different answers to
  // "what is on this table" depending on which control they reached for. The
  // summary carries the round now, including `ส่งเข้าครัว`.
  const currentRoundBasket = showCurrentRoundBasket ? (
    <CurrentRoundBasket
      accessibilityLabel={currentRoundCopy.openLabel}
      disabled={submitting}
      label={currentRoundCopy.basketLabel}
      value={money(currentRoundSummary.subtotal, language)}
      onPress={openOrderSummary}
    />
  ) : null;

  return (
    <AppScreen
      title={order?.table?.display_label || (order?.order_type === 'takeaway' ? copy('ซื้อกลับบ้าน', 'Takeaway') : copy(`ออเดอร์ #${orderId}`, `Order #${orderId}`))}
      subtitle={order ? `${order.order_number} · ${orderStatusLabel(order.status, language)}` : copy('กำลังโหลดออเดอร์', 'Loading order')}
      topLevel={false}
      refreshControl={refreshControl}
      // The menu grid runs long; without pinning, which table you are ordering
      // for and the item count both scroll out of sight.
      stickyHeading
      stickyContent={menuFilterBar}
      // The open search field is a stage, not a control sitting alongside the
      // others: while it is up, the first touch anywhere else - a dish card, the
      // header, the basket, the dock - is spent closing it and putting the
      // keyboard away, and reaches nothing underneath. Tapping a dish straight
      // through a live keyboard was opening the item sheet with the keyboard
      // still climbing over it.
      //
      // Any typed keyword goes with it, so the grid can never stay filtered by
      // a search box that is no longer on screen.
      onTouchOutsideStickyContent={searchOpen ? closeSearch : undefined}
      footer={currentRoundBasket}
      action={order ? (
        <OrderSummaryAction
          accessibilityLabel={orderSummaryCopy.title}
          count={activeQuantity}
          label={copy('รายการ', 'Items')}
          onPress={openOrderSummary}
        />
      ) : undefined}
    >
      {error ? <Feedback title={copy('โหลดออเดอร์ล่าสุดไม่สำเร็จ', 'Could not load the latest order')} detail={error} tone="danger" /> : null}

      {order ? (
        <>
          {!canTakeOrder || locked ? <Surface>{orderSummaryContent}</Surface> : null}

          {/* Above the menu, not below it: an order opened by mistake is closed
              straight away, and burying the control under the whole grid meant
              scrolling past every dish to undo a two-second error. */}
          {renderDestructiveActions()}
          {menuWorkspace}
        </>
      ) : null}
    </AppScreen>
  );
}
