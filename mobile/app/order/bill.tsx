import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, useWindowDimensions, View } from 'react-native';

import { apiUrl } from '@/src/api/client';
import { listCategories, listMenuItems } from '@/src/api/menu';
import { addOrderItem, getBill, payOrder, updateOrderItemStatus } from '@/src/api/order';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { MenuImage } from '@/src/components/menu-image';
import { ActionDock, Button, Divider, EmptyState, Feedback, RadioGroup, SearchField, SectionHeader, Select, StatusBadge, TextField } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { selectOrderItemImage } from '@/src/lib/order-detail-runtime';
import {
  activeOrderItems,
  billExitRoute,
  billPaymentStage,
  isCookingItem,
  canTakeOrderPayment,
  paymentReceivedAmount,
  undeliveredOrderItems,
  validateKitchenCancelReason,
} from '@/src/lib/order-workflow';
import { resetRouteStack } from '@/src/lib/navigation-runtime';
import { can } from '@/src/lib/rbac';
import { describePrinterFailure } from '@/src/lib/printer';
import { ReceiptSlip } from '@/src/components/receipt-slip';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { usePrinter } from '@/src/providers/printer-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';
import type { Bill, OrderItem } from '@/src/types/order';

function resolveImage(value: string) {
  if (!value) return '';
  if (value.startsWith('http')) return value;
  return `${apiUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}

function hasRequiredOptions(item: MenuItem) {
  return (item.option_groups || []).some(
    (group) => group.is_active && Math.max(0, Number(group.min_select) || 0) > 0,
  );
}

/**
 * The bill screen groups without drawing boxes. A card border here costs the
 * item rows a chunk of width on both sides for no gain: a bill is one continuous
 * document, and its parts are already separated by their headings.
 */
function Panel({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: spacing.md }}>{children}</View>;
}

export default function BillScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Number(id);
  const validOrderId = Number.isInteger(orderId) && orderId > 0;
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const canTakeOrder = can(activeMembership, 'take_order');
  const canPay = can(activeMembership, 'take_payment');
  const canViewOrders = can(activeMembership, 'view_orders');
  const canAccessBill = canViewOrders || canTakeOrder || canPay;
  const [bill, setBill] = useState<Bill | null>(null);
  // Set when a post-mutation re-read fails, so the totals on screen are known to
  // be behind the server. `pay()` sends `bill.grand_total` as the amount received
  // for a cash payment, so paying from a stale bill records money that was never
  // taken and change that was never given.
  const [billStale, setBillStale] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<'cash' | 'promptpay_qr'>('cash');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OrderItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printNotice, setPrintNotice] = useState<string | null>(null);
  const slipRef = useRef<View>(null);
  const {
    printReceiptView,
    printing,
    selectedPrinter,
    supported: printerSupported,
  } = usePrinter();

  const load = useCallback(async (quiet = false) => {
    if (!canAccessBill || !validOrderId) {
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const nextBill = await getBill(orderId);
      setBill(nextBill);
      setMethod(nextBill.payments.at(-1)?.method || 'cash');
      if (nextBill.payment_status !== 'paid' && canTakeOrder) {
        const [menuResponse, categoryResponse] = await Promise.all([
          listMenuItems(),
          listCategories(),
        ]);
        setMenuItems(menuResponse.menu_items || []);
        setCategories(categoryResponse.categories || []);
        if (undeliveredOrderItems(nextBill.items).length > 0) setEditing(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('โหลดบิลไม่สำเร็จ', 'Could not load the bill'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canAccessBill, canTakeOrder, copy, orderId, validOrderId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const activeItems = useMemo(() => activeOrderItems(bill?.items), [bill?.items]);
  const itemCount = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.quantity, 0),
    [activeItems],
  );
  const undelivered = useMemo(() => undeliveredOrderItems(activeItems), [activeItems]);
  const menuImageById = useMemo(
    () => new Map(menuItems.map((item) => [item.ID, item.image_url])),
    [menuItems],
  );
  const paymentReady = canTakeOrderPayment(activeItems);
  const paymentStage = bill
    ? billPaymentStage(bill.payment_status)
    : 'due';
  const canEditBill = paymentStage === 'due' && canTakeOrder;
  const filteredMenu = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      const categoryMatch = categoryId === 'all'
        || item.category_id === Number(categoryId)
        || item.categories?.some((link) => link.category_id === Number(categoryId));
      const searchMatch = !keyword
        || [item.name, item.description].some(
          (value) => String(value || '').toLowerCase().includes(keyword),
        );
      return categoryMatch && searchMatch;
    });
  }, [categoryId, menuItems, search]);

  async function refreshBillAfterMutation(successMessage: string) {
    setMessage(successMessage);
    try {
      setBill(await getBill(orderId));
      setBillStale(false);
    } catch (err) {
      setBillStale(true);
      setError(err instanceof Error
        ? copy(`${successMessage} แต่โหลดบิลล่าสุดไม่สำเร็จ: ${err.message}`, `${successMessage}, but the latest bill could not be loaded: ${err.message}`)
        : copy(`${successMessage} แต่โหลดบิลล่าสุดไม่สำเร็จ`, `${successMessage}, but the latest bill could not be loaded`));
    }
  }

  async function addServedItem(item: MenuItem) {
    if (!bill || !canEditBill || saving || !item.is_available || hasRequiredOptions(item)) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await addOrderItem(orderId, {
        menu_id: item.ID,
        quantity: 1,
        serve_immediately: true,
        fulfillment_type: bill.order.order_type === 'takeaway' ? 'takeaway' : 'dine_in',
      });
      await refreshBillAfterMutation(copy('เพิ่มรายการที่เสิร์ฟแล้ว', 'Served item added'));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('เพิ่มรายการไม่สำเร็จ', 'Could not add the item'));
    } finally {
      setSaving(false);
    }
  }

  async function cancelBillItem() {
    if (!cancelTarget || !canEditBill || saving) return;
    const validation = validateKitchenCancelReason(cancelReason);
    if (validation.error === 'required') {
      setError(copy('กรอกเหตุผลที่นำรายการออกจากบิล', 'Enter a reason for removing the item from the bill.'));
      return;
    }
    if (validation.error === 'too_long') {
      setError(copy('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'The reason must be 500 characters or fewer.'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateOrderItemStatus(orderId, cancelTarget.ID, 'cancelled', validation.reason);
      setCancelTarget(null);
      setCancelReason('');
      await refreshBillAfterMutation(copy('นำรายการออกจากบิลแล้ว', 'Item removed from the bill'));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('นำรายการออกจากบิลไม่สำเร็จ', 'Could not remove the item from the bill'));
    } finally {
      setSaving(false);
    }
  }

  async function pay() {
    if (!bill || !canPay || !paymentReady) return;
    if (method === 'promptpay_qr' && !bill.promptpay_qr_image) {
      setError(copy(
        'ร้านยังไม่ได้ตั้งค่า QR PromptPay จึงยังรับเงินด้วยวิธีนี้ไม่ได้',
        'PromptPay QR is not configured, so this payment method is unavailable.',
      ));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await payOrder(orderId, {
        method,
        received_amount: paymentReceivedAmount(method, bill.grand_total),
      });
      // Match the web: once payment succeeds, leave the bill instead of
      // re-reading it. The web never refetches here - confirmPayment goes
      // straight to router.replace - which is why two states are enough for
      // it: a failed re-read can never strand a paid order on a screen that
      // still offers a Pay button. The receipt stays reachable from the order
      // archive, the same place the web sends people for a reprint.
      setEditing(false);
      setAdding(false);
      setCancelTarget(null);
      setCancelReason('');
      showToast({ title: copy('รับชำระเงินเรียบร้อย', 'Payment recorded') });
      resetRouteStack(router, billExitRoute(canTakeOrder, canViewOrders));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('บันทึกการชำระเงินไม่สำเร็จ', 'Could not record the payment'));
    } finally {
      setSaving(false);
    }
  }

  async function printReceipt() {
    if (!bill || !canAccessBill) return;
    setPrintNotice(null);
    setPrintError(null);

    if (!selectedPrinter) {
      setPrintError(describePrinterFailure('NO_PRINTER_SELECTED', language));
      return;
    }

    const result = await printReceiptView(slipRef.current);
    if (result.ok) {
      setPrintNotice(copy(
        `ส่งใบเสร็จไปที่ ${selectedPrinter.name} แล้ว`,
        `Receipt sent to ${selectedPrinter.name}.`,
      ));
      return;
    }
    setPrintError(describePrinterFailure(result.code, language, result.message));
  }

  if (!canAccessBill) {
    return (
      <AppScreen title={copy('สรุปคำสั่งซื้อ', 'Order summary')} topLevel={false}>
        <EmptyState
          title={copy('ไม่มีสิทธิ์ดูบิล', 'No permission to view bills')}
          detail={copy('ต้องมีสิทธิ์รับออเดอร์ ดูออเดอร์ หรือรับชำระเงิน', 'The take_order, view_orders, or take_payment permission is required.')}
        />
      </AppScreen>
    );
  }

  if (!validOrderId) {
    return (
      <AppScreen title={copy('สรุปคำสั่งซื้อ', 'Order summary')} topLevel={false}>
        <EmptyState
          title={copy('ไม่พบบิลนี้', 'Bill not found')}
          detail={copy('รหัสออเดอร์ไม่ถูกต้อง กรุณากลับไปเลือกรายการใหม่', 'The order ID is invalid. Go back and choose an order again.')}
        />
      </AppScreen>
    );
  }

  if (!bill) {
    return (
      <AppScreen
        title={copy('สรุปคำสั่งซื้อ', 'Order summary')}
        subtitle={loading ? copy('กำลังโหลดบิล', 'Loading bill') : copy('ไม่พบบิล', 'Bill unavailable')}
        topLevel={false}
      >
        {error ? (
          <Feedback title={copy('โหลดบิลไม่สำเร็จ', 'Could not load the bill')} detail={error} tone="danger" />
        ) : loading ? (
          <Panel>
            <EmptyState
              title={copy('กำลังเตรียมบิล', 'Preparing the bill')}
              detail={copy('ระบบกำลังตรวจรายการและยอดล่าสุด', 'Checking the latest items and totals.')}
            />
          </Panel>
        ) : (
          <EmptyState
            title={copy('ไม่พบบิลนี้', 'Bill not found')}
            detail={copy('ออเดอร์อาจถูกลบหรือไม่มีสิทธิ์เข้าถึง', 'The order may no longer exist or be unavailable.')}
          />
        )}
      </AppScreen>
    );
  }

  const splitWorkspace = width >= breakpoints.tabletWorkspace;
  const exitLabel = canTakeOrder
    ? copy('กลับไปหน้าโต๊ะ', 'Back to tables')
    : canViewOrders
      ? copy('กลับไปคลังออเดอร์', 'Back to orders')
      : copy('กลับหน้าหลัก', 'Back to home');
  const exitBill = () => resetRouteStack(
    router,
    billExitRoute(canTakeOrder, canViewOrders),
  );
  const summaryRows: Array<[string, string]> = [
    [copy('ยอดอาหาร', 'Food subtotal'), money(bill.subtotal, language)],
  ];
  if (bill.discount_amount) {
    summaryRows.push([copy('ส่วนลด', 'Discount'), `−${money(bill.discount_amount, language)}`]);
  }
  if (bill.service_charge_enabled) {
    summaryRows.push([
      copy(
        `ค่าบริการ ${bill.service_charge_rate.toLocaleString('th-TH')}%`,
        `Service charge ${bill.service_charge_rate.toLocaleString('en-US')}%`,
      ),
      money(bill.service_charge_amount, language),
    ]);
  }
  if (bill.vat_enabled) {
    summaryRows.push([
      `VAT ${bill.vat_rate.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}%`,
      money(bill.vat_amount, language),
    ]);
  }

  const confirmPaymentAction = (
    <Button
      icon={method === 'cash' ? 'cash-outline' : 'qr-code-outline'}
      label={copy('ยืนยันรับชำระเงิน', 'Confirm payment')}
      onPress={pay}
      loading={saving}
      disabled={!paymentReady || editing || billStale || (method === 'promptpay_qr' && !bill.promptpay_qr_image)}
    />
  );
  const exitAction = <Button icon="arrow-back" label={exitLabel} onPress={exitBill} />;

  const billItemsPanel = (
    <Panel>
      <SectionHeader
        title={bill.order.table?.display_label || (bill.order.order_type === 'takeaway' ? copy('ซื้อกลับบ้าน', 'Takeaway') : bill.order.order_number)}
        detail={copy(
          `${itemCount.toLocaleString('th-TH')} รายการในบิล`,
          `${itemCount.toLocaleString('en-US')} items on this bill`,
        )}
        action={canEditBill ? (
          <Button
            compact
            icon={editing ? 'checkmark' : 'create-outline'}
            variant="secondary"
            label={editing ? copy('เสร็จสิ้น', 'Done') : copy('แก้รายการ', 'Edit items')}
            onPress={() => {
              setEditing((value) => !value);
              setAdding(false);
              setCancelTarget(null);
              setCancelReason('');
            }}
          />
        ) : undefined}
      />

      {activeItems.map((item, index) => {
        const thumbnailSize = splitWorkspace ? 64 : 56;
        const imageUrl = selectOrderItemImage({
          menuId: item.menu_id,
          menuImageUrl: item.menu?.image_url,
        }, menuImageById);
        return (
          <View key={item.ID}>
            {index ? <Divider /> : null}
            <View style={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
              <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <MenuImage
                  accessibilityLabel={copy(`รูปเมนู ${item.menu_name}`, `Photo of ${item.menu_name}`)}
                  imageUrl={imageUrl}
                  size={thumbnailSize}
                  variant="row"
                />
                <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                  <Text selectable style={typeScale.cardTitle}>{item.menu_name}</Text>
                  <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                    {copy(
                      `จำนวน ${item.quantity.toLocaleString('th-TH')}`,
                      `Quantity ${item.quantity.toLocaleString('en-US')}`,
                    )}
                    {item.selected_options?.length ? ` · ${item.selected_options.map((option) => option.option_name).join(', ')}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                  <Text selectable style={typeScale.number}>{money(item.subtotal, language)}</Text>
                  {isCookingItem(item.status) ? (
                    <StatusBadge label={copy('ยังไม่เสิร์ฟ', 'Not served')} tone="warning" />
                  ) : null}
                </View>
              </View>

              {editing && canEditBill ? (
                cancelTarget?.ID === item.ID ? (
                  <View style={{ gap: spacing.sm }}>
                    <TextField
                      label={copy('เหตุผลที่นำออกจากบิล', 'Reason for removing this item')}
                      value={cancelReason}
                      onChangeText={setCancelReason}
                      multiline
                    />
                    <View style={{ flexDirection: width < 460 ? 'column' : 'row', gap: spacing.sm }}>
                      <Button
                        variant="secondary"
                        label={copy('เก็บรายการไว้', 'Keep item')}
                        onPress={() => {
                          setCancelTarget(null);
                          setCancelReason('');
                        }}
                        style={width < 460 ? { width: '100%' } : { flex: 1 }}
                      />
                      <Button
                        variant="danger"
                        label={copy('ยืนยันนำออก', 'Remove item')}
                        onPress={cancelBillItem}
                        loading={saving}
                        disabled={!cancelReason.trim()}
                        style={width < 460 ? { width: '100%' } : { flex: 1 }}
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    compact
                    icon="trash-outline"
                    variant="secondary"
                    label={copy('นำออกจากบิล', 'Remove from bill')}
                    onPress={() => {
                      setCancelTarget(item);
                      setCancelReason('');
                      setAdding(false);
                    }}
                  />
                )
              ) : null}
            </View>
          </View>
        );
      })}

      {!activeItems.length ? (
        <EmptyState
          title={copy('ไม่มีรายการที่เรียกเก็บเงิน', 'No billable items')}
          detail={copy('เพิ่มรายการที่เสิร์ฟแล้ว หรือกลับไปจัดการออเดอร์นี้', 'Add a served item or return to manage this order.')}
        />
      ) : null}

      {editing && canEditBill ? (
        <Button
          icon={adding ? 'arrow-back' : 'add-circle-outline'}
          variant="secondary"
          label={adding ? copy('กลับไปดูบิล', 'Back to bill') : copy('เพิ่มรายการที่เสิร์ฟแล้ว', 'Add served item')}
          onPress={() => {
            setAdding((value) => !value);
            setCancelTarget(null);
            setCancelReason('');
          }}
        />
      ) : null}
    </Panel>
  );

  const addServedItemPanel = adding && editing && canEditBill ? (
    <Panel>
      <SectionHeader
        title={copy('เพิ่มรายการที่เสิร์ฟแล้ว', 'Add a served item')}
        detail={copy('รายการนี้จะไม่ส่งเข้าครัวและจะพร้อมคิดเงินทันที', 'This item skips the kitchen and is immediately ready for payment.')}
      />
      <SearchField
        accessibilityLabel={copy('ค้นหาเมนู', 'Search menu')}
        clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
        value={search}
        onChangeText={setSearch}
        placeholder={copy('ค้นหาเมนู', 'Search menu')}
      />
      <Select
        label={copy('หมวดหมู่', 'Category')}
        value={categoryId}
        onChange={setCategoryId}
        options={[
          { label: copy('ทั้งหมด', 'All'), value: 'all' },
          ...categories
            .filter((category) => category.is_active)
            .map((category) => ({ label: category.name, value: String(category.ID) })),
        ]}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        {filteredMenu.map((item) => {
          const requiresOptions = hasRequiredOptions(item);
          const disabled = saving || !item.is_available || requiresOptions;
          return (
            <Pressable
              accessibilityLabel={copy(`เพิ่ม ${item.name} ลงในบิล`, `Add ${item.name} to the bill`)}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              key={item.ID}
              disabled={disabled}
              onPress={() => {
                void addServedItem(item);
              }}
              style={({ pressed }) => ({
                // Same two-column grid as the ordering screen: a grow factor
                // stretches a lone tile on the last row across the screen.
                minWidth: splitWorkspace ? 148 : 0,
                width: splitWorkspace ? undefined : '48%',
                flexGrow: 0,
                flexBasis: splitWorkspace ? 168 : 'auto',
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: radius.md,
                backgroundColor: palette.surface,
                opacity: disabled ? 0.46 : pressed ? 0.74 : 1,
                transform: [{ translateY: pressed ? 1 : 0 }],
              })}
            >
              <MenuImage
                accessible={false}
                imageUrl={item.image_url}
                style={{ borderRadius: 0 }}
                variant="card"
              />
              <View style={{ gap: 2, padding: spacing.sm }}>
                <Text selectable numberOfLines={1} style={[typeScale.cardTitle, { minWidth: 0 }]}>{item.name}</Text>
                <Text selectable style={{ color: palette.muted, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                  {money(item.price, language)}
                </Text>
                {!item.is_available ? <Text style={[typeScale.caption, { color: palette.danger }]}>{copy('หมด', 'Sold out')}</Text> : null}
                {requiresOptions ? <Text style={[typeScale.caption, { color: palette.warning }]}>{copy('มีตัวเลือกบังคับ', 'Requires options')}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {!filteredMenu.length ? (
        <EmptyState
          title={copy('ไม่พบเมนู', 'No menu items found')}
          detail={copy('ลองเปลี่ยนหมวดหรือคำค้น', 'Try another category or search.')}
        />
      ) : null}
    </Panel>
  ) : null;

  // Only worth a card when it breaks the total into parts. With no discount,
  // service charge or VAT the single row IS the total, and the footer already
  // states that — printing it twice is how the same figure ended up on screen
  // four times over.
  const billSummaryPanel = summaryRows.length > 1 ? (
    <Panel>
      <SectionHeader title={copy('สรุปยอด', 'Bill summary')} />
      {summaryRows.map(([label, value]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md }}>
          <Text selectable style={[typeScale.body, { flex: 1, color: palette.muted }]}>{label}</Text>
          <Text selectable style={typeScale.cardTitle}>{value}</Text>
        </View>
      ))}
    </Panel>
  ) : null;

  const paymentPanel = paymentStage === 'due' && canPay ? (
    <Panel>
      <SectionHeader title={copy('วิธีชำระเงิน', 'Payment method')} />
      {undelivered.length > 0 ? (
        <Feedback
          title={copy('ยังมีรายการที่ครัวทำไม่เสร็จ', 'Some items are still being prepared')}
          detail={copy('นำรายการที่ส่งมอบไม่ได้ออกจากบิล หรือรอให้ครัวทำเสร็จก่อนรับเงิน', 'Remove unfulfilled items from the bill or wait until the kitchen finishes before taking payment.')}
          tone="warning"
        />
      ) : null}
      <RadioGroup
        value={method}
        onChange={setMethod}
        options={[
          { label: copy('เงินสด', 'Cash'), value: 'cash' },
          // Says why it cannot be picked on the row itself. Previously the
          // option looked available and the reason only appeared after choosing
          // it, which is late: the restaurant has to go and set the QR up.
          bill.promptpay_qr_image
            ? { label: 'PromptPay QR', value: 'promptpay_qr' as const }
            : { label: copy('PromptPay QR — ไม่พร้อมใช้งาน', 'PromptPay QR — unavailable'), value: 'promptpay_qr' as const, disabled: true },
        ]}
      />
      {method === 'cash' ? null : (
        <View style={{ alignItems: 'center', gap: spacing.md }}>
          {bill.promptpay_qr_image ? (
            <Image
              accessibilityLabel={copy('คิวอาร์โค้ดพร้อมเพย์ของร้าน', 'Restaurant PromptPay QR code')}
              source={{ uri: resolveImage(bill.promptpay_qr_image) }}
              resizeMode="contain"
              style={{
                width: splitWorkspace ? 200 : Math.min(240, width - (spacing.lg * 4)),
                height: splitWorkspace ? 200 : Math.min(240, width - (spacing.lg * 4)),
                borderRadius: radius.md,
                backgroundColor: palette.surfaceSubtle,
              }}
            />
          ) : (
            <Feedback title={copy('ร้านยังไม่ได้ตั้งค่า QR PromptPay', 'PromptPay QR is not configured for this restaurant')} tone="warning" />
          )}
          <Text selectable style={typeScale.cardTitle}>{bill.promptpay_name || 'PromptPay'}</Text>
        </View>
      )}
      {splitWorkspace ? confirmPaymentAction : null}
    </Panel>
  ) : paymentStage === 'paid' ? (
    <Panel>
      <SectionHeader
        title={copy('ชำระเงินเรียบร้อย', 'Payment complete')}
        detail={copy('ออเดอร์ปิดแล้ว พิมพ์ใบเสร็จให้ลูกค้า หรือกลับไปทำรายการถัดไป', 'The order is closed. Print the receipt or continue to the next task.')}
        action={<StatusBadge label={copy('ชำระแล้ว', 'Paid')} tone="success" />}
      />
      {printError ? <Feedback title={copy('พิมพ์ใบเสร็จไม่สำเร็จ', 'Could not print')} detail={printError} tone="danger" /> : null}
      {printNotice ? <Feedback title={copy('ส่งไปเครื่องพิมพ์แล้ว', 'Sent to printer')} detail={printNotice} tone="success" /> : null}
      {printerSupported ? (
        <Button
          icon="print-outline"
          variant="secondary"
          label={printing
            ? copy('กำลังพิมพ์…', 'Printing…')
            : copy('พิมพ์ใบเสร็จ', 'Print receipt')}
          loading={printing}
          onPress={printReceipt}
        />
      ) : null}
      {splitWorkspace ? exitAction : null}
    </Panel>
  ) : (
    <Panel>
      <SectionHeader title={copy('สถานะการชำระเงิน', 'Payment status')} />
      <View style={{ gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: palette.border, paddingBottom: spacing.lg }}>
        <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{copy('ยอดคงเหลือ', 'Amount due')}</Text>
        <Text selectable style={[typeScale.number, { fontSize: 32, lineHeight: 40 }]}>{money(bill.grand_total, language)}</Text>
      </View>
      <Feedback
        title={copy('ดูบิลได้ แต่รับชำระเงินไม่ได้', 'You can view this bill but cannot take payment')}
        detail={copy('กรุณาให้แคชเชียร์หรือผู้จัดการดำเนินการต่อ', 'Ask a cashier or manager to continue.')}
        tone="info"
      />
    </Panel>
  );

  // The one place the total is stated on this screen, so it gets a line to
  // itself with the action full width beneath, rather than the two sharing a row.
  const phoneFooter = !splitWorkspace && paymentStage === 'due' && canPay && !editing ? (
    <View style={{ gap: spacing.md, borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md }}>
        <Text selectable style={[typeScale.body, { color: palette.text, fontWeight: '400' }]}>{copy('รวมทั้งหมด', 'Total')}</Text>
        <Text selectable style={[typeScale.number, { fontSize: 20, fontWeight: '700' }]}>{money(bill.grand_total, language)}</Text>
      </View>
      {confirmPaymentAction}
    </View>
  ) : !splitWorkspace && paymentStage === 'paid' ? (
    <ActionDock>{exitAction}</ActionDock>
  ) : undefined;

  return (
    <AppScreen
      title={copy('สรุปคำสั่งซื้อ', 'Order summary')}
      subtitle={bill.order.order_number}
      topLevel={false}
      contentMaxWidth={splitWorkspace ? 1240 : 720}
      contentStyle={{ gap: splitWorkspace ? spacing.lg : spacing.xl }}
      footer={phoneFooter}
      action={(
        <StatusBadge
          label={paymentStage === 'paid'
            ? copy('ชำระแล้ว', 'Paid')
            : copy('รอชำระ', 'Payment due')}
          tone={paymentStage === 'paid' ? 'success' : 'warning'}
        />
      )}
    >
      {error ? <Feedback title={copy('ทำรายการไม่สำเร็จ', 'Could not complete this action')} detail={error} tone="danger" /> : null}
      {message && paymentStage === 'due' ? <Feedback title={message} tone="success" /> : null}

      {/*
        The printable slip is laid out off-screen rather than conditionally
        mounted: view-shot can only capture a view the platform has actually
        measured, so it has to be in the tree and sized before the print button
        is pressed. It is pushed far to the left instead of hidden, because a
        display:none or zero-size view captures as blank on Android.
      */}
      {printerSupported ? (
        <View
          accessibilityElementsHidden
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: -10000 }}
        >
          <ReceiptSlip
            bill={bill}
            language={language}
            ref={slipRef}
            restaurant={activeMembership?.restaurant}
          />
        </View>
      ) : null}

      <View style={{ flexDirection: splitWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ width: splitWorkspace ? undefined : '100%', minWidth: 0, flex: splitWorkspace ? 1.45 : undefined, gap: spacing.lg }}>
          {billItemsPanel}
          {addServedItemPanel}
          {billSummaryPanel}
        </View>
        <View style={{ width: splitWorkspace ? undefined : '100%', minWidth: 0, flex: splitWorkspace ? 1 : undefined }}>
          {paymentPanel}
        </View>
      </View>
    </AppScreen>
  );
}
