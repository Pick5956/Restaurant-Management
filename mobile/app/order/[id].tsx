import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, useWindowDimensions, View } from 'react-native';

import { listCategories, listMenuItems } from '@/src/api/menu';
import { closeEmptyTable, deleteOrderItem, getOrder, updateOrderItem } from '@/src/api/order';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen, ScreenHeading } from '@/src/components/app-shell';
import { MenuImage } from '@/src/components/menu-image';
import { OrderItemPanel } from '@/src/components/order-item-editor';
import { OrderMenuFilterBar, OrderMenuGrid } from '@/src/components/order-menu-grid';
import { OrderItemPanelPlaceholder, OrderMenuSplit } from '@/src/components/order-menu-split';
import { Divider, EmptyState, Feedback, GlassLayer, SectionHeader, StatusBadge, Surface } from '@/src/components/ui';
import { apiFailureDetail } from '@/src/lib/api-failure';
import { billActionFailureMessage } from '@/src/lib/bill-failure';
import { formatTender } from '@/src/lib/cash-tender';
import { itemStatusLabel, orderStatusLabel } from '@/src/lib/format';
import { filterMenuCatalog, groupMenuByCategory, isMenuSoldOut } from '@/src/lib/menu-catalog';
import { leaveForWorkspaceRoute } from '@/src/lib/navigation-runtime';
import { stockFailure, stockFailureMessage } from '@/src/lib/order-item-error';
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
  inline = false,
}: {
  label: string;
  value: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  /** At the foot of the grid's column on a tablet, which already keeps clear
   *  of the home indicator, rather than as the screen's footer. */
  inline?: boolean;
}) {
  const button = (
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
  );
  if (inline) return button;
  return (
    <View style={{ backgroundColor: palette.surface, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xxl }}>
      {button}
    </View>
  );
}

const HEADER_CHIP_ICON = 17;
/** ActivityIndicator's "small" size, in points, on iOS and Android alike. */
const SMALL_SPINNER = 20;

/** A chip at the heading's right end: an icon and a short label, or the icon
 *  alone in a 44pt square of the same material. */
function HeaderChip({
  icon,
  label,
  accessibilityLabel,
  onPress,
  busy = false,
}: {
  icon: AppIconName;
  label?: string;
  accessibilityLabel: string;
  onPress: () => void;
  /** Spinner in the icon's place, and no taps, while its write is in flight. */
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.xs,
        borderWidth: 1,
        borderColor: palette.border,
        borderRadius: radius.md,
        backgroundColor: pressed ? palette.surfaceStrong : palette.surface,
        ...(label ? { paddingHorizontal: spacing.md } : { width: 44 }),
        opacity: pressed ? 0.76 : 1,
      })}
    >
      {busy ? (
        // Scaled into the icon's box, so the chip keeps its width while it turns.
        <View style={{ width: HEADER_CHIP_ICON, height: HEADER_CHIP_ICON, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={palette.muted} size="small" style={{ transform: [{ scale: HEADER_CHIP_ICON / SMALL_SPINNER }] }} />
        </View>
      ) : <AppIcon color={palette.muted} name={icon} size={HEADER_CHIP_ICON} />}
      {label ? (
        <Text numberOfLines={1} style={{ color: palette.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
          {label}
        </Text>
      ) : null}
    </Pressable>
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
    <HeaderChip
      accessibilityLabel={accessibilityLabel}
      icon="receipt-outline"
      label={`${count.toLocaleString()} ${label}`}
      onPress={onPress}
    />
  );
}

function CloseTableAction({
  accessibilityLabel,
  busy,
  onPress,
}: {
  accessibilityLabel: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <HeaderChip
      accessibilityLabel={accessibilityLabel}
      busy={busy}
      icon="close-circle-outline"
      onPress={onPress}
    />
  );
}

export default function OrderDetailScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
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
  // The dish open in the tablet's side panel. Phones push the item screen.
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `error` is the order failing to load; a tap's outcome is a toast (14 ก.ย.).
  const { showToast } = useToast();
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
        // The panel's title names the failure; the detail is a reason staff can
        // act on in the app's words, never the server's, and empty when there
        // is none.
        setError(apiFailureDetail(err, language) ?? '');
      }
    } finally {
      if (!quiet && foregroundLoadRef.current === request) {
        foregroundLoadRef.current = null;
      }
    }
  }, [canAccessOrder, canTakeOrder, language, orderId, validOrderId]);
  // Loaded when the screen opens or comes back into view, and then left alone:
  // no timer. The owner, 2026-09-19: an order screen is not the kitchen board,
  // and a dish that sells out while it sits open is caught by the add itself,
  // which answers with a toast.
  useFocusEffect(useCallback(() => {
    load();
    return () => {
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
  // Dishes that cannot take one more portion, so a line's + stops there the
  // same way the grid greys the tile out.
  const soldOutMenuIds = useMemo(
    () => new Set(menuItems.filter((item) => isMenuSoldOut(item)).map((item) => item.ID)),
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
  // "T4 ริมน้ำ": the table and its zone as one value, so the confirmation names
  // the table it closes. A missing zone is said, "T4 ไม่มีโซน", never dropped
  // (owner, 2026-09-17); no table on the answer, ''.
  const closeTableLabel = order?.table?.display_label?.trim() || order?.table?.table_number?.trim() || '';
  const closeTableZone = order?.table?.table_zone?.name?.trim() || order?.table?.zone?.trim() || copy('ไม่มีโซน', 'No zone');
  const closeTablePlace = closeTableLabel ? `${closeTableLabel} ${closeTableZone}` : '';
  // A takeaway holds no table, so the same close reads as discarding the order,
  // named for the customer when there is one.
  const closingTakeaway = order?.order_type === 'takeaway';
  const takeawayName = order?.customer_name?.trim() || '';
  // On a tablet a dish opens in a panel beside the grid instead of taking the
  // whole screen. Only while there is a grid to pick from: a closed order, or
  // someone who cannot take orders, gets the summary alone at every width.
  const sidePanel = width >= breakpoints.tablet && canTakeOrder && !locked;
  const selectedMenu = useMemo(
    () => (selectedMenuId === null ? null : menuItems.find((item) => item.ID === selectedMenuId) ?? null),
    [menuItems, selectedMenuId],
  );

  // The keyboard goes - a search may have it up - but the keyword stays: the
  // field is still on screen over the grid it filters, and the next dish is
  // often picked from the same search.
  const pickDish = useCallback((item: MenuItem) => {
    Keyboard.dismiss();
    setSelectedMenuId(item.ID);
  }, []);

  // The panel's add is a write to this same order, and beside the grid it is on
  // screen together with the screen's own writes (closing an empty table)
  // rather than behind a pushed screen, so it takes the same lock they do. The
  // lock also drops any load in flight, so none can land after the add and
  // paint the order as it stood before it.
  const panelMutationGuard = useMemo(() => ({
    begin: () => requestGuardRef.current.beginMutation(),
    finish: () => requestGuardRef.current.finishMutation(),
  }), []);

  // The line is on the order: the badge and the basket take it straight from
  // the answer. The panel empties only if it still shows the dish that was
  // added - a waiter who tapped the next dish while this one saved keeps that one.
  const handleDishAdded = useCallback((next: Order, menuId: number) => {
    setOrder(next);
    setSelectedMenuId((current) => (current === menuId ? null : current));
  }, []);

  // No billing bar across the bottom. It sat over the menu grid permanently for
  // an action taken once per order, and it belongs with the order it settles:
  // the item count in the header opens the summary, and the bill button is there.
  const openOrderSummary = useCallback(() => {
    router.push({ pathname: '/order/bill' as never, params: { id: String(orderId) } } as never);
  }, [orderId]);

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
      // The stock refusal first, then the refusals the bill shares with this
      // screen (a line already sent, a closed order), then the ones every
      // screen shares, all in the app's words; anything else keeps the title
      // and nothing vague after it.
      const failure = stockFailure(err instanceof Error ? err.message : '');
      const reason = failure
        ? stockFailureMessage(failure, language)
        : billActionFailureMessage(err, language) ?? apiFailureDetail(err, language);
      showToast({
        tone: 'error',
        title: copy('ทำรายการไม่สำเร็จ', 'Could not complete this action'),
        ...(reason ? { message: reason } : {}),
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

  // The native alert is the confirmation, named for the table it closes: a
  // waiter holding the wrong table's screen finds out before anything happens.
  function confirmCloseEmpty() {
    if (!canCloseEmpty || submitting) return;
    if (closingTakeaway) {
      Alert.alert(
        takeawayName
          ? copy(`ยกเลิกออเดอร์กลับบ้านของ ${takeawayName}?`, `Discard ${takeawayName}'s takeaway order?`)
          : copy('ยกเลิกออเดอร์กลับบ้านนี้?', 'Discard this takeaway order?'),
        undefined,
        [
          { text: copy('เปิดออเดอร์ไว้', 'Keep order'), style: 'cancel' },
          { text: copy('ยกเลิกออเดอร์', 'Discard order'), style: 'destructive', onPress: () => { void closeEmpty(); } },
        ],
      );
      return;
    }
    Alert.alert(
      closeTablePlace
        ? copy(`ปิดโต๊ะ ${closeTablePlace}?`, `Close table ${closeTablePlace}?`)
        : copy('ปิดโต๊ะนี้?', 'Close this table?'),
      undefined,
      [
        { text: copy('ยกเลิก', 'Cancel'), style: 'cancel' },
        { text: copy('ปิดโต๊ะ', 'Close table'), style: 'destructive', onPress: () => { void closeEmpty(); } },
      ],
    );
  }

  async function closeEmpty() {
    if (!canCloseEmpty) return;
    const closed = await mutate(() => closeEmptyTable(orderId));
    // Onto the floor with the hub beneath it. A bare dismissTo('/tables') from
    // an order opened on the overview replaced only this screen, and left the
    // overview under a floor the waiter never opened.
    if (closed) leaveForWorkspaceRoute(router, navigation.getState()?.routes.map((route) => route.name) ?? [], '/tables');
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
                  {item.selected_options?.length ? <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{item.selected_options.map((option) => `${option.group_name}: ${option.option_name}`).join(', ')}</Text> : null}
                  {item.note ? <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('หมายเหตุ', 'Note')}: {item.note}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                  <Text selectable style={typeScale.number}>{formatTender(item.subtotal, language)}</Text>
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
                    disabled={submitting || soldOutMenuIds.has(item.menu_id)}
                  />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      {!activeItems.length ? <EmptyState title={copy('ยังไม่มีรายการอาหาร', 'No items yet')} detail={copy('เลือกเมนูเพื่อเริ่มออเดอร์', 'Choose a menu item to start the order.')} /> : null}
      {/* Always shown now. This used to be hidden whenever the bottom bar was
          carrying the total; that bar is gone, so nothing else states it here.
          Satang kept, as the bill writes it: rounded to the baht, the same
          order read ฿108 here and ฿107.54 on its bill. */}
      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.xs }}>
        <Text selectable style={[typeScale.body, { color: palette.muted }]}>{copy('ยอดรวมออเดอร์', 'Order total')}</Text>
        <Text selectable style={[typeScale.number, { fontSize: 20, fontWeight: '600' }]}>{formatTender(order.grand_total, language)}</Text>
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
  // One row, not two — the category picker, the layout button and a magnifier
  // share it, and the search field takes the row only while it is being used.
  const menuFilterBar = order && !locked && canTakeOrder ? (
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
  ) : null;

  // The badge counts only what is still in this round, as the web POS tile does.
  const menuWorkspace = order && !locked && canTakeOrder ? (
    <OrderMenuGrid
      groups={menuGroups}
      countByMenu={pendingByMenu}
      tabletWorkspace={sidePanel}
      onPressItem={(item) => (sidePanel
        ? pickDish(item)
        : router.push({ pathname: '/order/item' as never, params: { id: String(orderId), menuId: String(item.ID) } } as never))}
      accessibilityLabelFor={(item, inRound) => (inRound > 0
        ? copy(`เพิ่มเมนู ${item.name} ในตะกร้า ${inRound}`, `Add ${item.name}, ${inRound} in cart`)
        : copy(`เพิ่มเมนู ${item.name}`, `Add ${item.name}`))}
    />
  ) : null;

  if (!canAccessOrder) {
    return <AppScreen title={copy('รายละเอียดออเดอร์', 'Order details')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์ดูออเดอร์', 'No permission to view orders')} detail={copy('ต้องมีสิทธิ์รับออเดอร์ ดูออเดอร์ หรือรับชำระเงิน', 'The take_order, view_orders, or take_payment permission is required.')} /></AppScreen>;
  }

  if (!validOrderId) {
    return <AppScreen title={copy('รายละเอียดออเดอร์', 'Order details')} topLevel={false}><EmptyState title={copy('ไม่พบออเดอร์นี้', 'Order not found')} detail={copy('รหัสออเดอร์ไม่ถูกต้อง กรุณากลับไปเลือกรายการใหม่', 'The order ID is invalid. Go back and choose an order again.')} /></AppScreen>;
  }

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
      inline={sidePanel}
      label={currentRoundCopy.basketLabel}
      value={formatTender(currentRoundSummary.subtotal, language)}
      onPress={openOrderSummary}
    />
  ) : null;

  const title = order?.table?.display_label || (order?.order_type === 'takeaway' ? copy('ซื้อกลับบ้าน', 'Takeaway') : copy(`ออเดอร์ #${orderId}`, `Order #${orderId}`));
  const subtitle = order ? `${order.order_number}, ${orderStatusLabel(order.status, language)}` : copy('กำลังโหลดออเดอร์', 'Loading order');
  // The count is the only way into the bill of an open order, and an empty
  // table's bill is where a served item is added, so it stays even at "0".
  const orderSummaryChip = (
    <OrderSummaryAction
      accessibilityLabel={orderSummaryCopy.title}
      count={activeQuantity}
      label={copy('รายการ', 'Items')}
      onPress={openOrderSummary}
    />
  );
  // While the order is empty, the way out of a table opened by mistake is an
  // icon in the heading beside the count, reached at once, not a full-width
  // row pushing the menu down (owner, 2026-09-24). The first dish removes it.
  const summaryAction = !order ? undefined : canCloseEmpty ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <CloseTableAction
        accessibilityLabel={closingTakeaway
          ? copy('ยกเลิกออเดอร์กลับบ้าน', 'Discard takeaway order')
          : closeTablePlace ? copy(`ปิดโต๊ะ ${closeTablePlace}`, `Close table ${closeTablePlace}`) : copy('ปิดโต๊ะ', 'Close table')}
        busy={submitting}
        onPress={confirmCloseEmpty}
      />
      {orderSummaryChip}
    </View>
  ) : orderSummaryChip;

  if (sidePanel) {
    // Keyed by the dish, so a new tap starts the editor over instead of
    // carrying the last dish's options and note into this one.
    const dishPanel = order && selectedMenu ? (
      <OrderItemPanel
        key={selectedMenu.ID}
        initial={{ order, menu: selectedMenu }}
        menuId={selectedMenu.ID}
        mutationGuard={panelMutationGuard}
        onClose={() => setSelectedMenuId(null)}
        onDone={(next) => handleDishAdded(next, selectedMenu.ID)}
        orderId={orderId}
      />
    ) : <OrderItemPanelPlaceholder />;

    return (
      <AppScreen
        title={title}
        topLevel={false}
        // Nothing on this screen scrolls as a whole: the grid and the panel
        // each scroll by themselves, and the heading stays where it is.
        scroll={false}
        // Drawn over the grid's column instead, so the dish panel can run to
        // the top of the screen and the item count sits over the grid.
        hideTitle
      >
        <OrderMenuSplit
          header={<ScreenHeading action={summaryAction} showBack subtitle={subtitle} title={title} />}
          filterBar={menuFilterBar}
          footer={currentRoundBasket}
          panel={dishPanel}
          refreshControl={refreshControl}
        >
          {error !== null ? <Feedback title={copy('โหลดออเดอร์ล่าสุดไม่สำเร็จ', 'Could not load the latest order')} detail={error || undefined} tone="danger" /> : null}
          {menuWorkspace}
        </OrderMenuSplit>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={title}
      subtitle={subtitle}
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
      action={summaryAction}
    >
      {error !== null ? <Feedback title={copy('โหลดออเดอร์ล่าสุดไม่สำเร็จ', 'Could not load the latest order')} detail={error || undefined} tone="danger" /> : null}

      {order ? (
        <>
          {!canTakeOrder || locked ? <Surface>{orderSummaryContent}</Surface> : null}
          {menuWorkspace}
        </>
      ) : null}
    </AppScreen>
  );
}
