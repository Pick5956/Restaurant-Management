import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Pressable, useWindowDimensions, View } from 'react-native';

import { apiUrl } from '@/src/api/client';
import { listMenuItems } from '@/src/api/menu';
import { deleteOrderItem, getBill, payOrder, sendOrderToKitchen, updateOrderItemStatus } from '@/src/api/order';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { GlassMorphMenu } from '@/src/components/ai/chrome';
import { MenuImage } from '@/src/components/menu-image';
import { PaymentBlockLine } from '@/src/components/payment/payment-block-line';
import { PaymentForm, type PaymentFormProps } from '@/src/components/payment/payment-form';
import { PaymentSheet } from '@/src/components/payment/payment-sheet';
import { Bone, ContentReveal, SkeletonReveal } from '@/src/components/skeleton';
import { SwipeToDeleteRow } from '@/src/components/swipe-to-delete-row';
import { ActionDock, Button, ChoiceSheet, EmptyState, Feedback, SectionHeader, StatusBadge } from '@/src/components/ui';
import { useOrderEvents } from '@/src/hooks/use-order-events';
import { billDiscountLines } from '@/src/lib/bill-promotions';
import { cashReceivedToSend, formatTender, paidPaymentLine, repricedPaymentLine } from '@/src/lib/cash-tender';
import {
  currentRoundPresentation,
  selectOrderItemImage,
  summarizeCurrentRound,
} from '@/src/lib/order-detail-runtime';
import {
  activeOrderItems,
  billExitRoute,
  billPaymentStage,
  canTakeOrderPayment,
  SERVED_REMOVAL_REASONS,
  undeliveredOrderItems,
  validateKitchenCancelReason,
} from '@/src/lib/order-workflow';
import { leaveForWorkspaceRoute } from '@/src/lib/navigation-runtime';
import { billActionFailureCode, billActionFailureMessage, type BillActionFailureCode } from '@/src/lib/bill-failure';
import { paymentBlock, paymentBlockText, paymentFailureCode, paymentFailureMessage } from '@/src/lib/payment-failure';
import { can } from '@/src/lib/rbac';
import { describePrinterFailure, printerFailureReason } from '@/src/lib/printer';
import { createRequestGeneration, shouldStartRequest } from '@/src/lib/request-generation';
import { ReceiptSlip } from '@/src/components/receipt-slip';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { usePrinter } from '@/src/providers/printer-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';
import type { Bill, OrderItem } from '@/src/types/order';

/** How far the item-status chip drops to sit on the item name's optical line. */
const ROW_CHIP_OPTICAL_DROP = 4;
/** The stream's greeting asks for a reload; skipped this soon after the focus load. */
const STREAM_CONNECTED_SKIP_MS = 2_000;
/** A quiet reload while the bill is followed, for when a reload the stream asked for failed. */
const BILL_RECOVERY_POLL_MS = 30_000;
/**
 * Refusals that mean the server has moved on from the bill on screen: another
 * phone sent the round, took the line off, or closed the order. The rows they
 * refused are outdated, so the bill is read again at once rather than at the
 * next event or the recovery reload.
 */
const SERVER_MOVED_FAILURES: ReadonlySet<BillActionFailureCode> = new Set<BillActionFailureCode>([
  'nothing_to_send',
  'already_sent',
  'order_closed',
  'gone',
]);

function resolveImage(value: string) {
  if (!value) return '';
  if (value.startsWith('http')) return value;
  return `${apiUrl}${value.startsWith('/') ? '' : '/'}${value}`;
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
  // be behind the server. The payment sheet's amount due, its `พอดี` and the
  // change it works out all come from `bill.grand_total`, so paying from a stale
  // bill records money that was never taken and change that was never given.
  const [billStale, setBillStale] = useState(false);
  // Only for the row photos, when an order line carries no image of its own.
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [method, setMethod] = useState<'cash' | 'promptpay_qr'>('cash');
  // Seeded from the bill once; after that the cashier's pick stands. load()
  // runs on every focus, and re-seeding there put a chosen PromptPay back to
  // cash after a trip to add a served item (audit, 2026-09-23). A paid bill
  // still shows the method it was paid with.
  const methodSeededRef = useRef(false);
  // The phone's payment sheet. The footer button only opens it; nothing is
  // recorded until the cashier has seen the method and, for cash, said what
  // was handed over (2026-09-23: one tap on the footer paid a whole bill in cash).
  const [paymentOpen, setPaymentOpen] = useState(false);
  // `saving` is state, so two taps inside one frame both read it as false.
  const payingRef = useRef(false);
  // No edit MODE. The screen used to hide removal behind a `แก้รายการ` toggle
  // and then switch the toggle on by itself whenever the order had undelivered
  // items - which, since the basket started landing here, is every arrival
  // mid-service. A row is removed by swiping it left and tapping the rail that
  // appears, the same gesture the retired basket screen used, so nothing about
  // the list changes state to allow it.
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Reveals the take-it-off-the-bill control on lines the kitchen has already
  // made. Those are removed with a written reason rather than deleted, so they
  // get a deliberate control rather than the swipe an unsent line answers to.
  const [editingServed, setEditingServed] = useState(false);
  // The line waiting on a reason. Picking one from the sheet removes it; there
  // is no reason to type any more.
  const [cancelTarget, setCancelTarget] = useState<OrderItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `error` is the bill failing to load. A button that failed, succeeded or
  // printed says so in a toast (14 ก.ย.): the bar it used to be pushed the
  // whole bill down to report one tap.
  const actionFailed = (detail: string) => showToast({
    tone: 'error',
    title: copy('ทำรายการไม่สำเร็จ', 'Could not complete this action'),
    message: detail,
  });
  const slipRef = useRef<View>(null);
  // `printing` is state, and the header menu's print entry stays tappable
  // while it is true: a second tap sent the slip to the printer again.
  const printStartedRef = useRef(false);
  const {
    printReceiptView,
    printing,
    selectedPrinter,
    supported: printerSupported,
  } = usePrinter();

  // The menu is read for the rows' photos only; nothing an order event changes.
  const menuLoadedRef = useRef(false);
  // Every read of the bill takes a number and only the newest may write it. The
  // stream reloads on every restaurant event, so a reload that left before a
  // change could land after the change's own re-read and put back a bill the
  // server no longer has - with payment live again. A change's answer is newer
  // than whatever a load in flight will bring.
  const requestGenerationRef = useRef(createRequestGeneration());
  // The load the spinner is for. Until a bill has loaded, a quiet reload does
  // not cut in on it: it would take that load's outcome over, and a stream
  // reload fails silently, so a bill that never loaded would read as `ไม่พบบิล
  // นี้` instead of the failure.
  const foregroundRequestRef = useRef<number | null>(null);
  // A quiet reload asked for while the spinner's load was out; it runs after.
  const pendingQuietReloadRef = useRef(false);
  // A bill has been on screen. From then on the focus load is not waited for:
  // getBill has no timeout on Android, and a focus load that never answers
  // held back the stream, the recovery reload and the stale-bill retry with it
  // - the very recovery a flaky network needs.
  const billShownRef = useRef(false);
  // A read has brought a bill since the screen last came into focus. Until one
  // has, the bill on screen is the one from before the screen was left, and any
  // read that fails - a stream or poll read too, however quiet - is the latest
  // bill not arriving. The duty cannot ride on a single read: a quiet read over
  // that bill drops the focus load's answer, and is dropped in turn by the next
  // quiet read while it hangs (getBill has no timeout on Android).
  const landedSinceFocusRef = useRef(false);
  // A change has landed and no read begun after it has come back yet. If the
  // read that owns the bill fails, the totals on screen are behind the server,
  // however quiet the failure.
  const rereadOwedRef = useRef(false);
  // `fromStream`: a reload the order stream asked for. Once a read has brought
  // a bill since focus it fails silently - the bill already on screen stays, the next event, the recovery reload or the
  // next focus tries again - because a red panel over a bill that is still
  // current read as the bill being wrong, and resuming the phone with the
  // network still waking up raised exactly that.
  const load = useCallback(async (quiet = false, fromStream = false) => {
    if (!canAccessBill || !validOrderId) {
      setLoading(false);
      return;
    }
    const heldForFirstBill = foregroundRequestRef.current !== null && !billShownRef.current;
    if (!shouldStartRequest(quiet, heldForFirstBill)) {
      pendingQuietReloadRef.current = true;
      return;
    }
    const request = requestGenerationRef.current.begin();
    if (!quiet) {
      foregroundRequestRef.current = request;
      setLoading(true);
    }
    if (!fromStream) setError(null);
    try {
      const nextBill = await getBill(orderId);
      if (!requestGenerationRef.current.isCurrent(request)) return;
      rereadOwedRef.current = false;
      setBill(nextBill);
      setBillStale(false);
      setError(null);
      billShownRef.current = true;
      landedSinceFocusRef.current = true;
      if (nextBill.payment_status === 'paid' || !methodSeededRef.current) {
        setMethod(nextBill.payments.at(-1)?.method || 'cash');
        methodSeededRef.current = true;
      }
      if (nextBill.payment_status !== 'paid' && canTakeOrder && (!quiet || !menuLoadedRef.current)) {
        // Photos only: a failed menu read leaves the rows without pictures,
        // never the bill with an error. Not held to the request number for
        // the same reason: a photo can never put back an old bill.
        const menuResponse = await listMenuItems().catch(() => null);
        if (menuResponse) {
          setMenuItems(menuResponse.menu_items || []);
          menuLoadedRef.current = true;
        }
      }
    } catch (err) {
      if (!requestGenerationRef.current.isCurrent(request)) return;
      if (rereadOwedRef.current) setBillStale(true);
      // Silent only over a bill some read has brought since focus. Before that,
      // a stream or poll read that failed here left the bill from before the
      // screen was left on show as if the focus load had brought it, with
      // payment live on its old total and nothing saying the latest bill never
      // arrived - even when an earlier read had dropped the focus load's answer
      // and then been dropped itself.
      if (fromStream && landedSinceFocusRef.current) return;
      // The panel's title names the failure; the detail is only a reason staff
      // can act on, never the server's wording, and empty when there is none.
      setError(billActionFailureMessage(err, language) ?? '');
    } finally {
      // Even when a change has overtaken it: the change's re-read is quiet, so
      // nothing else would take the spinner down.
      if (foregroundRequestRef.current === request) {
        foregroundRequestRef.current = null;
        setLoading(false);
        if (pendingQuietReloadRef.current) {
          pendingQuietReloadRef.current = false;
          void load(true, true);
        }
      }
    }
  }, [canAccessBill, canTakeOrder, copy, language, orderId, validOrderId]);

  // Leaving the screen lets go of what its loads were holding, the way the
  // tables and kitchen screens do, so a focus load that never answered cannot
  // hold anything back after the next focus. The spinner is left as it is: the
  // next focus starts a load that owns it, and taking it down here would show
  // `ไม่พบบิลนี้` on the way back to a bill that never loaded.
  useFocusEffect(useCallback(() => {
    landedSinceFocusRef.current = false;
    void load();
    return () => {
      requestGenerationRef.current.invalidate();
      foregroundRequestRef.current = null;
      pendingQuietReloadRef.current = false;
    };
  }, [load]));

  // The bill loaded on focus and then sat still: a cashier held at `ครัวยัง
  // ทำไม่เสร็จ` stayed held until they left and came back, however long ago
  // the kitchen had finished. The order stream reloads it quietly while the
  // screen is up and the bill unpaid; a paid bill no longer changes.
  //
  // Every event counts, not only this order's: the server keeps one queued
  // event per phone and drops the rest ("one queued invalidation is enough"),
  // so this order's change can arrive as another order's event - a promotion
  // or VAT change reprices every open order in one burst.
  const isFocused = useIsFocused();
  const followingBill = isFocused && canAccessBill && validOrderId && bill?.payment_status !== 'paid';
  useOrderEvents(() => load(true, true), {
    enabled: followingBill,
    restaurantId: activeMembership?.restaurant_id,
    skipConnectedRefreshWithinMs: STREAM_CONNECTED_SKIP_MS,
  });

  // Nothing asks again after a stream reload fails. Resuming the phone, the
  // resync can fail while the network wakes, and the stream's greeting a moment
  // later is skipped as too soon after it - so the bill sat at `ครัวยังทำไม่
  // เสร็จ` until the next event, however long ago the kitchen finished. A slow
  // quiet reload while the bill is followed, and only with the app in front.
  useEffect(() => {
    if (!followingBill) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void load(true, true);
    }, BILL_RECOVERY_POLL_MS);
    return () => clearInterval(timer);
  }, [followingBill, load]);

  // The swipe that CLOSES a delete rail travels right - the same direction as
  // the stack's back gesture. That gesture is a native recogniser and takes no
  // part in the JS responder negotiation the row wins against the scroll view,
  // so closing a rail was popping the whole screen instead. It is switched off
  // for exactly as long as a rail is open; the row is the only thing a swipe
  // can mean then.
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: openRowId === null });
  }, [navigation, openRowId]);

  // Out of a paid bill, onto the floor (or the archive, or the overview) with
  // the hub beneath it. Clearing the stack down to that one screen left its
  // back button with nowhere to go: the owner took a payment and was stuck on
  // the floor until the app was killed (2026-09-25).
  const leaveBill = () => leaveForWorkspaceRoute(
    router,
    navigation.getState()?.routes.map((route) => route.name) ?? [],
    billExitRoute(canTakeOrder, canViewOrders),
  );

  const activeItems = useMemo(() => activeOrderItems(bill?.items), [bill?.items]);
  const itemCount = useMemo(
    () => activeItems.reduce((sum, item) => sum + item.quantity, 0),
    [activeItems],
  );
  const undelivered = useMemo(() => undeliveredOrderItems(activeItems), [activeItems]);
  // Unsent lines lead. They are the round being built - the thing the screen's
  // own action acts on - and burying them under rounds that already went out
  // put the only editable part of the bill wherever the kitchen happened to
  // leave it. Stable within each group, so each keeps the order it was added in.
  const listedItems = useMemo(
    () => [...activeItems].sort(
      (left, right) => (left.status === 'pending' ? 0 : 1) - (right.status === 'pending' ? 0 : 1),
    ),
    [activeItems],
  );
  const billContextLabel = bill?.order.table?.display_label
    || (bill?.order.order_type === 'takeaway' ? copy('ซื้อกลับบ้าน', 'Takeaway') : '');
  const menuImageById = useMemo(
    () => new Map(menuItems.map((item) => [item.ID, item.image_url])),
    [menuItems],
  );
  const paymentReady = canTakeOrderPayment(activeItems);
  // The unsent round, on the summary screen because this is where the basket
  // lands now. `pending` is the only status that has not reached the kitchen,
  // so it is the only one that can still be edited freely or dropped without a
  // cancellation reason - and the only one `ส่งเข้าครัว` acts on.
  const roundSummary = useMemo(() => summarizeCurrentRound(activeItems), [activeItems]);
  const roundCopy = useMemo(() => currentRoundPresentation(roundSummary, language), [language, roundSummary]);
  const paymentStage = bill
    ? billPaymentStage(bill.payment_status)
    : 'due';
  const canEditBill = paymentStage === 'due' && canTakeOrder;
  const canSendRound = canEditBill && roundSummary.quantity > 0;

  // `null` for work that speaks for itself: deleting a row makes the row
  // disappear, and a green banner announcing it pushes the whole list down to
  // report something the eye has already seen.
  async function refreshBillAfterMutation(successMessage: string | null) {
    if (successMessage) showToast({ title: successMessage });
    // The change has landed, so the bill on screen is behind it until a read
    // begun from here comes back; begin() drops every read that left earlier.
    // That is the only place a change drops them. Dropping them as the change
    // STARTS threw away the read that could explain a refusal - another phone
    // already sent the round, `ไม่มีรายการรอส่งครัว` - and nothing replaced it.
    rereadOwedRef.current = true;
    const request = requestGenerationRef.current.begin();
    try {
      const nextBill = await getBill(orderId);
      if (!requestGenerationRef.current.isCurrent(request)) return;
      rereadOwedRef.current = false;
      setBill(nextBill);
      setBillStale(false);
      billShownRef.current = true;
      landedSinceFocusRef.current = true;
    } catch (err) {
      // A later read owns the bill now, and marks it behind if it fails too.
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setBillStale(true);
      const done = successMessage ?? copy('ทำรายการแล้ว', 'Done');
      const reason = billActionFailureMessage(err, language);
      const base = copy(`${done} แต่โหลดบิลล่าสุดไม่สำเร็จ`, `${done}, but the latest bill could not be loaded`);
      actionFailed(reason ? `${base}, ${reason}` : base);
    }
  }

  // A refused change that means the server has moved on reads the bill again,
  // quietly: the toast has already said what was refused, and the outdated
  // rows go now instead of up to 30 s later.
  function rereadIfServerMoved(err: unknown) {
    if (SERVER_MOVED_FAILURES.has(billActionFailureCode(err))) void load(true, true);
  }

  // Sending is the whole reason the basket can land here. It leaves the screen
  // open rather than popping back the way the basket screen did: the same list
  // stays on screen and the rows it just sent turn from unsent to `ยังไม่เสิร์ฟ`,
  // which is the confirmation.
  async function sendRoundToKitchen() {
    if (!bill || !canSendRound || saving) return;
    setSaving(true);
    setError(null);
    try {
      await sendOrderToKitchen(orderId);
      // Back to the menu, with no banner. The round has left: there is nothing
      // on this screen to come back to and read, and a green bar announcing it
      // only pushed the list down on the way out. The spinner on the action is
      // the whole confirmation, and the screen sliding away is the rest of it.
      // The order screen reloads on focus, so its basket is empty on arrival.
      router.back();
    } catch (err) {
      // Pick's go-back on success (14 ก.ย. merge) with this branch's toast on
      // failure. `saving` is released only here: on success the screen leaves.
      actionFailed(billActionFailureMessage(err, language) ?? copy('ส่งเข้าครัวไม่สำเร็จ', 'Could not send to the kitchen'));
      rereadIfServerMoved(err);
      setSaving(false);
    }
  }

  // The delete rail behind a row. What it does depends on where the line has
  // got to: an unsent one is deleted outright, because the kitchen has never
  // seen it and there is nothing to explain to anyone; anything already cooking
  // or served opens the reason field instead, which is what the kitchen and the
  // day's cancellation record need.
  function removeBillItem(item: OrderItem) {
    if (!canEditBill || saving) return;
    setOpenRowId(null);
    if (item.status !== 'pending') {
      setCancelTarget(item);
      return;
    }
    void deletePendingItem(item);
  }

  async function deletePendingItem(item: OrderItem) {
    setSaving(true);
    setError(null);
    try {
      await deleteOrderItem(orderId, item.ID);
      await refreshBillAfterMutation(null);
      // Silent on screen, not silent to VoiceOver: a row vanishing is obvious
      // to the eye and invisible to a screen reader.
      AccessibilityInfo.announceForAccessibility(
        copy(`ลบ ${item.menu_name} แล้ว`, `${item.menu_name} deleted`),
      );
    } catch (err) {
      actionFailed(billActionFailureMessage(err, language) ?? copy('ลบรายการไม่สำเร็จ', 'Could not delete the item'));
      rereadIfServerMoved(err);
    } finally {
      setSaving(false);
    }
  }

  async function cancelBillItem(reason: string) {
    const item = cancelTarget;
    if (!item || !canEditBill || saving) return;
    // The presets are known good; this stays as the guard between the list and
    // the API, which will not take an empty or overlong reason.
    const validation = validateKitchenCancelReason(reason);
    if (validation.error) {
      actionFailed(copy('เลือกเหตุผลที่นำรายการออกจากบิล', 'Choose a reason for removing the item from the bill.'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateOrderItemStatus(orderId, item.ID, 'cancelled', validation.reason);
      setCancelTarget(null);
      await refreshBillAfterMutation(copy('นำรายการออกจากบิลแล้ว', 'Item removed from the bill'));
    } catch (err) {
      actionFailed(billActionFailureMessage(err, language) ?? copy('นำรายการออกจากบิลไม่สำเร็จ', 'Could not remove the item from the bill'));
      rereadIfServerMoved(err);
    } finally {
      setSaving(false);
    }
  }

  // Opens the payment step; it never pays. An open delete rail is closed first
  // so the stack's back gesture comes back and nothing is left open under the
  // sheet.
  function openPayment() {
    if (!paymentReady || billStale) return;
    setOpenRowId(null);
    setMenuOpen(false);
    setPaymentOpen(true);
  }

  // `received` is the cash handed over, from the payment step; null for
  // PromptPay. Cash sends it as the received amount, so the server records the
  // real change instead of 0 on every payment.
  async function pay(received: number | null = null) {
    if (!bill || !canPay || !paymentReady || saving || billStale || payingRef.current) return;
    if (method === 'promptpay_qr' && !bill.promptpay_qr_image) {
      actionFailed(copy(
        'ร้านยังไม่ได้ตั้งค่า QR PromptPay จึงยังรับเงินด้วยวิธีนี้ไม่ได้',
        'PromptPay QR is not configured, so this payment method is unavailable.',
      ));
      return;
    }
    payingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const paid = await payOrder(orderId, {
        method,
        received_amount: cashReceivedToSend(method, bill.grand_total, received),
      });
      // Match the web: once payment succeeds, leave the bill instead of
      // re-reading it. The web never refetches here - confirmPayment goes
      // straight to router.replace - which is why two states are enough for
      // it: a failed re-read can never strand a paid order on a screen that
      // still offers a Pay button. The receipt stays reachable from the order
      // archive, the same place the web sends people for a reprint.
      setCancelTarget(null);
      // A success toast is only spoken; the haptic is what the hand feels as
      // the screen leaves.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // The server prices the order once more as it records the payment. When
      // that lands on another total, the change the sheet worked out is wrong,
      // so the cashier is shown what was actually recorded - as a warning,
      // because a success toast is only spoken and never drawn.
      const repriced = repricedPaymentLine(bill.grand_total, paid?.payments?.at(-1), language);
      showToast(repriced
        ? { tone: 'warning', title: copy('รับชำระเงินเรียบร้อย', 'Payment recorded'), message: repriced }
        : { title: copy('รับชำระเงินเรียบร้อย', 'Payment recorded') });
      leaveBill();
    } catch (err) {
      // Released only on failure: after a success the screen is leaving, and a
      // tap on the still-mounted sheet must not send the payment again.
      payingRef.current = false;
      // The server's own English never reaches the cashier: it is mapped onto
      // the outcomes they can act on.
      const code = paymentFailureCode(err instanceof Error ? err.message : '');
      showToast({
        tone: 'error',
        title: copy('รับเงินไม่สำเร็จ', 'Could not take payment'),
        message: paymentFailureMessage(code, language) ?? undefined,
      });
      // The kitchen is not done after all: close the sheet so the reason shows
      // at the footer. A re-priced total: re-read it, and the sheet starts over
      // on the new figure.
      if (code === 'kitchen_not_done') setPaymentOpen(false);
      if (code === 'kitchen_not_done' || code === 'total_changed') void load(true);
    } finally {
      setSaving(false);
    }
  }

  async function printReceipt() {
    if (!bill || !canAccessBill || printStartedRef.current) return;
    // No detail line when there is no reason staff can act on: the title
    // already says the print failed, and the native module's own message is
    // the library's English, never the app's words.
    const printFailed = (detail: string | null) => showToast({
      tone: 'error',
      title: copy('พิมพ์ใบเสร็จไม่สำเร็จ', 'Could not print'),
      ...(detail ? { message: detail } : {}),
    });

    if (!selectedPrinter) {
      printFailed(describePrinterFailure('NO_PRINTER_SELECTED', language));
      return;
    }

    printStartedRef.current = true;
    try {
      const result = await printReceiptView(slipRef.current);
      if (result.ok) {
        showToast({
          title: copy('ส่งไปเครื่องพิมพ์แล้ว', 'Sent to printer'),
          message: selectedPrinter.name,
        });
        return;
      }
      printFailed(printerFailureReason(result.code, language));
    } finally {
      printStartedRef.current = false;
    }
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
        {error !== null ? (
          <Feedback title={copy('โหลดบิลไม่สำเร็จ', 'Could not load the bill')} detail={error || undefined} tone="danger" />
        ) : loading ? (
          // The bill's own shape - its lines, then the totals - while it loads.
          <SkeletonReveal label={copy('กำลังเตรียมบิล', 'Preparing the bill')} style={{ gap: spacing.lg }}>
            <Panel>
              <View style={{ gap: 14 }}>
                {[0.62, 0.48, 0.7, 0.55].map((share, index) => (
                  <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Bone width={`${Math.round(share * 100)}%`} height={15} />
                      <Bone width="30%" height={11} />
                    </View>
                    <Bone width={64} height={16} />
                  </View>
                ))}
              </View>
            </Panel>
            <Panel>
              <View style={{ gap: 10 }}>
                <Bone width="45%" height={13} />
                <Bone width="60%" height={13} />
                <Bone width="35%" height={20} radius={6} />
              </View>
            </Panel>
          </SkeletonReveal>
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
  // The delete rail behind a row has to reach the screen edge; a rail that
  // stops at the page gutter reads as a half-finished gesture. Only the row
  // bleeds - its content is padded back to the page's own margin - and only on
  // phones, where the page gutter IS the screen edge.
  const rowBleed = width < breakpoints.tablet ? spacing.lg : 0;
  const exitLabel = canTakeOrder
    ? copy('กลับไปหน้าโต๊ะ', 'Back to tables')
    : canViewOrders
      ? copy('กลับไปคลังออเดอร์', 'Back to orders')
      : copy('กลับหน้าหลัก', 'Back to home');
  // Every amount on the bill is written as the total is, satang included:
  // rows rounded to the baht under a total that keeps its satang read out to a
  // different sum from the one the customer is asked to pay.
  const summaryRows: Array<[string, string]> = [
    [copy('ยอดอาหาร', 'Food subtotal'), formatTender(bill.subtotal, language)],
  ];
  // One row per promotion the server applied, so the staff can tell a
  // customer exactly what took the price down.
  for (const line of billDiscountLines(bill, copy('ส่วนลด', 'Discount'))) {
    summaryRows.push([line.label, `−${formatTender(line.amount, language)}`]);
  }
  if (bill.service_charge_enabled) {
    summaryRows.push([
      copy(
        `ค่าบริการ ${bill.service_charge_rate.toLocaleString('th-TH')}%`,
        `Service charge ${bill.service_charge_rate.toLocaleString('en-US')}%`,
      ),
      formatTender(bill.service_charge_amount, language),
    ]);
  }
  if (bill.vat_enabled) {
    summaryRows.push([
      `VAT ${bill.vat_rate.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}%`,
      formatTender(bill.vat_amount, language),
    ]);
  }

  // Opens the payment step and nothing else. It used to be the confirm itself,
  // live with `cash` preselected, so one tap recorded a payment whose method
  // nobody had seen.
  const payAction = (
    <Button
      icon="wallet-outline"
      label={copy('รับเงิน', 'Take payment')}
      onPress={openPayment}
      loading={saving}
      disabled={!paymentReady || billStale}
    />
  );
  // What is holding payment back, said where the action is rather than in a
  // panel under every dish.
  const block = paymentBlock(undelivered, billStale);
  const paymentBlockLine = block ? (
    <PaymentBlockLine
      text={paymentBlockText(block, language)}
      onRetry={block.kind === 'stale' ? () => load(true) : undefined}
    />
  ) : null;
  const paymentFormProps: PaymentFormProps = {
    total: bill.grand_total,
    method,
    // The seed rule lives in load(); a pick here stands until the bill is paid.
    onMethodChange: setMethod,
    qrUri: bill.promptpay_qr_image ? resolveImage(bill.promptpay_qr_image) : '',
    promptpayName: bill.promptpay_name,
    ready: paymentReady && !billStale,
    notice: paymentBlockLine,
    saving,
    onConfirm: (received) => { void pay(received); },
  };
  const paidLine = paymentStage === 'paid' ? paidPaymentLine(bill.payments.at(-1), language) : null;
  const exitAction = <Button icon="arrow-back" label={exitLabel} onPress={leaveBill} />;
  const sendRoundAction = canSendRound ? (
    <Button
      icon="flame-outline"
      label={roundCopy.sendLabel}
      onPress={sendRoundToKitchen}
      loading={saving}
      disabled={billStale}
    />
  ) : null;

  const billItemsPanel = (
    <Panel>
      {/* The rows carry their own vertical padding, so the panel's gap would
          be a second helping of space between every pair of dishes. */}
      <View>
      {listedItems.map((item, index) => {
        // Big enough to actually see the dish, the way a delivery app's order
        // summary shows it. 56 was a favicon of a photo next to two lines of
        // bold text, and the eye had nothing to land on.
        const thumbnailSize = splitWorkspace ? 88 : 76;
        const imageUrl = selectOrderItemImage({
          menuId: item.menu_id,
          menuImageUrl: item.menu?.image_url,
        }, menuImageById);
        return (
          <View key={item.ID}>
            <View style={{ marginHorizontal: -rowBleed }}>
            <SwipeToDeleteRow
              deleteAccessibilityLabel={copy(`นำ ${item.menu_name} ออกจากบิล`, `Remove ${item.menu_name} from the bill`)}
              deleteLabel={copy('ลบ', 'Delete')}
              disabled={saving || !canEditBill}
              // A line the kitchen already has is not removed by a swipe: it
              // comes off the bill through `แก้ไขรายการเสิร์ฟ`, with a written
              // reason. Locked rather than disabled so it still reads as an
              // ordinary row.
              locked={item.status !== 'pending'}
              editHint={item.status === 'pending'
                ? copy('แตะเพื่อแก้ไข ปัดไปทางซ้ายเพื่อลบ', 'Tap to edit, swipe left to delete')
                : copy('ส่งเข้าครัวแล้ว', 'Already sent to the kitchen')}
              editLabel={copy(
                `${item.menu_name} จำนวน ${item.quantity.toLocaleString('th-TH')}`,
                `${item.menu_name}, quantity ${item.quantity.toLocaleString('en-US')}`,
              )}
              itemId={item.ID}
              open={openRowId === item.ID}
              onClose={() => setOpenRowId((current) => (current === item.ID ? null : current))}
              // Only an unsent line can be opened for editing; everything else
              // is already on the kitchen's board. It opens the SAME screen the
              // dish was chosen on, with options, note and quantity filled back
              // in - the quantity-only editor it replaced could not undo a
              // wrong option at all.
              onEdit={item.status === 'pending' && canEditBill ? () => router.push({
                pathname: '/order/item' as never,
                params: { id: String(orderId), menuId: String(item.menu_id), itemId: String(item.ID) },
              } as never) : undefined}
              onDelete={() => removeBillItem(item)}
              onOpen={() => setOpenRowId(item.ID)}
              onSwipeEnd={() => undefined}
              onSwipeStart={() => undefined}
            >
              <View style={{ gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: rowBleed }}>
                <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                  <MenuImage
                    accessibilityLabel={copy(`รูปเมนู ${item.menu_name}`, `Photo of ${item.menu_name}`)}
                    imageUrl={imageUrl}
                    size={thumbnailSize}
                    variant="row"
                  />
                  <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
                    {/* The status leads the name rather than sitting out on the
                        right: it is the first thing to know about a line, and
                        since the basket lands here a bill holds unsent and sent
                        lines at once. A sent line says WHICH ROUND it went out
                        in - the one fact that separates two identical dishes on
                        the same bill - and nothing about the kitchen's progress,
                        which the kitchen screen owns and this screen was only
                        repeating. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      {/* Nudged down by ROW_CHIP_OPTICAL_DROP. Thai glyphs sit
                          LOW inside their line box - the space above them is
                          reserved for tone marks that most words never use - so
                          the visual line of a word is below the box's centre.
                          A chip centred on the box therefore floats above the
                          word, and `alignItems: 'baseline'` made it worse, not
                          better: Yoga takes a View child's baseline from its
                          bottom edge, which lifted the chip further. Optical
                          alignment against a font's own metrics is a measured
                          offset; there is no layout rule that produces it. */}
                      {item.status === 'pending' ? (
                        <View style={{ marginTop: ROW_CHIP_OPTICAL_DROP }}>
                          <StatusBadge emphasis="strong" label={copy('รอส่ง', 'Not sent')} tone="info" />
                        </View>
                      ) : item.kitchen_batch ? (
                        <View style={{ marginTop: ROW_CHIP_OPTICAL_DROP }}>
                          <StatusBadge
                            emphasis="strong"
                            label={copy(`รอบ ${item.kitchen_batch}`, `Round ${item.kitchen_batch}`)}
                            tone="muted"
                          />
                        </View>
                      ) : null}
                      {/* Medium, not bold. With the photo carrying the row, a
                          700 name, an 800 price and a 700 count made three
                          things shout at once. */}
                      <Text numberOfLines={2} selectable style={[typeScale.cardTitle, { minWidth: 0, flex: 1, color: palette.textStrong, fontWeight: '500' }]}>{item.menu_name}</Text>
                    </View>
                    {/* One line per option, not a comma-joined string. Four
                        add-ons ran into a wrapped grey sentence nobody could
                        read back to a customer; a stack reads as a list of what
                        was actually ordered, which is why the name is pinned to
                        the top of the row rather than centred on the photo. */}
                    {item.selected_options?.length ? (
                      <View>
                        {item.selected_options.map((option) => (
                          <Text
                            key={option.ID}
                            selectable
                            // 12/18 rather than the caption's 13/20, and no gap
                            // between the lines. 1.5x is the floor the type
                            // scale sets - tighter than that and React Native
                            // crops the Thai tone marks off the top, silently -
                            // so the size comes down instead of the ratio.
                            style={[typeScale.caption, { color: palette.textStrong, fontSize: 12, lineHeight: 18 }]}
                          >
                            {option.option_name}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                    {/* Under the options and quieter than them: it is the last
                        thing about the dish and the least structured. */}
                    {item.note ? (
                      <Text selectable style={[typeScale.caption, { color: palette.placeholder, fontSize: 12, lineHeight: 18 }]}>
                        {item.note}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                    {/* The same 23pt line box the name uses (typeScale.cardTitle),
                        so the price and the name - and the chip centred on the
                        name - all start on one level. `number` carries no line
                        height of its own, so the price sat a couple of points
                        low against a taller natural line box. */}
                    <Text selectable style={[typeScale.number, { fontSize: 17, fontWeight: '600', lineHeight: 23 }]}>{formatTender(item.subtotal, language)}</Text>
                    {/* The count, where the status chip used to be. `x2` in a
                        disc says quantity without spending a line on the word,
                        which is what `จำนวน 2` under the name was doing.
                        While served lines are being edited this same disc is
                        the control that takes one off: one slot, no reflow, and
                        no full-width button parked under every dish. */}
                    {editingServed && canEditBill && item.status !== 'pending' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={copy(`นำ ${item.menu_name} ออกจากบิล`, `Remove ${item.menu_name} from the bill`)}
                        disabled={saving}
                        hitSlop={8}
                        onPress={() => setCancelTarget(item)}
                        style={({ pressed }) => ({
                          width: 36,
                          height: 36,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: radius.full,
                          borderWidth: 1,
                          borderColor: '#FECACA',
                          backgroundColor: palette.dangerSoft,
                          opacity: saving ? 0.5 : pressed ? 0.7 : 1,
                        })}
                      >
                        <AppIcon color={palette.danger} name="trash-outline" size={18} />
                      </Pressable>
                    ) : (
                      <View
                        style={{
                          minWidth: 32,
                          height: 32,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: radius.full,
                          backgroundColor: palette.neutralSoft,
                          paddingHorizontal: 7,
                        }}
                      >
                        <Text
                          selectable
                          style={{ color: palette.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}
                        >
                          {`x${item.quantity.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </SwipeToDeleteRow>
            </View>
          </View>
        );
      })}

      </View>

      {!activeItems.length ? (
        <EmptyState
          title={copy('ไม่มีรายการที่เรียกเก็บเงิน', 'No billable items')}
          detail={copy('เพิ่มรายการที่เสิร์ฟแล้ว หรือกลับไปจัดการออเดอร์นี้', 'Add a served item or return to manage this order.')}
        />
      ) : null}

      {splitWorkspace ? sendRoundAction : null}
    </Panel>
  );

  // Only worth a card when it breaks the total into parts. With no discount,
  // service charge or VAT the single row IS the total, and the footer already
  // states that — printing it twice is how the same figure ended up on screen
  // four times over.
  const billSummaryPanel = summaryRows.length > 1 ? (
    <Panel>
      <SectionHeader title={copy('สรุปยอด', 'Bill summary')} />
      {summaryRows.map(([label, value], index) => (
        <View key={`${index}-${label}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.md }}>
          <Text selectable style={[typeScale.body, { flex: 1, color: palette.muted }]}>{label}</Text>
          <Text selectable style={typeScale.cardTitle}>{value}</Text>
        </View>
      ))}
    </Panel>
  ) : null;

  // On a phone the payment step is a sheet over the bill (PaymentSheet below),
  // opened from the footer: under an 18-dish bill the method and the QR sat
  // where nobody scrolled to. The tablet has the room to keep it beside the
  // items, so the same form sits inline there, amount due included.
  const paymentPanel = paymentStage === 'due' && canPay ? (
    splitWorkspace ? (
      <Panel>
        <SectionHeader title={copy('รับเงิน', 'Take payment')} />
        <PaymentForm key={String(bill.grand_total)} layout="inline" {...paymentFormProps} />
      </Panel>
    ) : null
  ) : paymentStage === 'paid' ? (
    <Panel>
      <SectionHeader
        title={copy('ชำระเงินเรียบร้อย', 'Payment complete')}
        action={<StatusBadge emphasis="strong" label={copy('ชำระแล้ว', 'Paid')} tone="success" />}
      />
      {paidLine ? (
        <Text selectable style={[typeScale.body, { color: palette.textStrong, fontVariant: ['tabular-nums'] }]}>{paidLine}</Text>
      ) : null}
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
        <Text selectable style={[typeScale.number, { fontSize: 20, lineHeight: 28, fontWeight: '600' }]}>{formatTender(bill.grand_total, language)}</Text>
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
  // The header's overflow menu. Everything here is occasional: the add-served
  // catalog, taking a made dish off the bill, and the receipt. None of them
  // belong under the dishes, which is where they each used to sit.
  const billMenuItems = [
    canEditBill ? {
      key: 'add-served',
      icon: 'add-circle-outline' as const,
      label: copy('เพิ่มรายการที่เสิร์ฟแล้ว', 'Add served item'),
      // Its own screen, pushed so it slides in from the right like every other
      // step forward. The bill reloads on focus when it comes back.
      onPress: () => {
        setCancelTarget(null);
        router.push({ pathname: '/order/served' as never, params: { id: String(orderId) } } as never);
      },
    } : null,
    canEditBill ? {
      key: 'edit-served',
      icon: editingServed ? ('checkmark' as const) : ('create-outline' as const),
      label: editingServed
        ? copy('เสร็จสิ้นการแก้ไข', 'Done editing')
        : copy('แก้ไขรายการเสิร์ฟ', 'Edit served items'),
      detail: editingServed ? undefined : copy('นำรายการที่ครัวทำแล้วออกจากบิล', 'Take a made dish off the bill'),
      onPress: () => {
        setEditingServed((value) => !value);
        setCancelTarget(null);
      },
    } : null,
    printerSupported ? {
      key: 'print',
      icon: 'print-outline' as const,
      label: printing ? copy('กำลังพิมพ์…', 'Printing…') : copy('พิมพ์ใบเสร็จ', 'Print receipt'),
      onPress: () => { void printReceipt(); },
    } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  // While a round is unsent, sending it IS the primary action of the screen -
  // payment cannot complete until the kitchen has the items anyway, and two
  // full-width actions in one dock is the duplicate-CTA trap.
  //
  // Whichever primary action the order is up to, it gets the SAME footer: the
  // bill total on its own line, the action full width beneath it. Sending used
  // to sit in an ActionDock instead - figure left, button right - which put two
  // different bottom bars on one screen depending on the stage. `รวมทั้งหมด`
  // stays the whole bill in both states, so the number does not change meaning
  // the moment the round is sent.
  const footerPrimaryAction = sendRoundAction
    ?? (paymentStage === 'due' && canPay ? payAction : null);
  // The reason sits between the total and the button it holds back. Only while
  // payment is the footer's action: the send-round footer stays as it was.
  const footerBlockLine = !sendRoundAction && paymentStage === 'due' && canPay ? paymentBlockLine : null;
  const phoneFooter = !splitWorkspace && footerPrimaryAction ? (
    <View style={{ gap: spacing.md, backgroundColor: palette.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md }}>
        <Text selectable style={[typeScale.body, { color: palette.text, fontWeight: '400' }]}>{copy('รวมทั้งหมด', 'Total')}</Text>
        {/* formatTender, not money(): a total with satang has to read the same
            here as in the payment sheet, not rounded to the baht. */}
        <Text selectable style={[typeScale.number, { fontSize: 20, fontWeight: '600' }]}>{formatTender(bill.grand_total, language)}</Text>
      </View>
      {footerBlockLine}
      {footerPrimaryAction}
    </View>
  ) : !splitWorkspace && paymentStage === 'paid' ? (
    <ActionDock>{exitAction}</ActionDock>
  ) : undefined;

  return (
    <AppScreen
      // Which table this is belongs in the title. It used to head the item
      // list instead, in a section header that also carried the count and the
      // edit toggle; with the toggle gone that header was a heading for a list
      // that starts right underneath it anyway.
      title={billContextLabel
        ? `${copy('สรุปคำสั่งซื้อ', 'Order summary')} - ${billContextLabel}`
        : copy('สรุปคำสั่งซื้อ', 'Order summary')}
      subtitle={copy(
        `${bill.order.order_number} · ${itemCount.toLocaleString('th-TH')} รายการ`,
        `${bill.order.order_number} · ${itemCount.toLocaleString('en-US')} items`,
      )}
      topLevel={false}
      // Pinned and flush to the top. The heading used to scroll away while the
      // menu button beside it stayed put - two halves of one line coming apart
      // - and it sat a gap lower than the button besides.
      stickyHeading
      tightHeading
      contentMaxWidth={splitWorkspace ? 1240 : 720}
      contentStyle={{ gap: splitWorkspace ? spacing.lg : spacing.xl }}
      footer={phoneFooter}
      // An open delete rail does not scroll away. The page would carry it off
      // screen still open, and the next tap anywhere would land on whatever had
      // moved under the finger. The drag closes it and stops there; the one
      // after that scrolls.
      onScrollBlocked={openRowId === null ? undefined : () => setOpenRowId(null)}
      // A spacer, not the button: the button itself is the GlassMorphMenu
      // below, drawn at this exact spot, because it and the menu it opens are
      // one piece of glass and the menu has to hang OUTSIDE the header.
      action={billMenuItems.length ? <View style={{ width: 46, height: 46 }} /> : undefined}
      floatingTrailing={billMenuItems.length ? (
        <GlassMorphMenu
          open={menuOpen}
          onOpen={() => setMenuOpen(true)}
          onClose={() => setMenuOpen(false)}
          icon="ellipsis-horizontal"
          items={billMenuItems}
          label={copy('จัดการบิล', 'Manage bill')}
          // 4 centres the 46pt button on the two-line heading beside it; the
          // slot itself is already at the header's top-right.
          style={{ top: 4, right: 0 }}
        />
      ) : undefined}
    >
      {error !== null ? <Feedback title={copy('โหลดบิลล่าสุดไม่สำเร็จ', 'Could not load the latest bill')} detail={error || undefined} tone="danger" /> : null}

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

      <ContentReveal style={{ flexDirection: splitWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ width: splitWorkspace ? undefined : '100%', minWidth: 0, flex: splitWorkspace ? 1.45 : undefined, gap: spacing.lg }}>
          {billItemsPanel}
          {billSummaryPanel}
        </View>
        {/* Only when there is a panel: an empty column still took the row's
            gap, a blank band under the summary on a phone. */}
        {paymentPanel ? (
          <View style={{ width: splitWorkspace ? undefined : '100%', minWidth: 0, flex: splitWorkspace ? 1 : undefined }}>
            {paymentPanel}
          </View>
        ) : null}
      </ContentReveal>

      <PaymentSheet
        open={paymentOpen && !splitWorkspace && paymentStage === 'due' && canPay}
        onClose={() => setPaymentOpen(false)}
        {...paymentFormProps}
      />

      {/* Taking a made dish off the bill asks one question, and the answer is
          the whole action: the reason goes on the day's cancellation record,
          and picking it removes the line. */}
      <ChoiceSheet
        open={cancelTarget !== null}
        busy={saving}
        title={copy('นำออกจากบิลเพราะอะไร', 'Why is this coming off the bill?')}
        detail={cancelTarget?.menu_name}
        options={SERVED_REMOVAL_REASONS.map((reason) => ({
          label: copy(reason.th, reason.en),
          value: copy(reason.th, reason.en),
        }))}
        cancelLabel={copy('เก็บรายการไว้', 'Keep item')}
        onChoose={(reason) => { void cancelBillItem(reason); }}
        onClose={() => setCancelTarget(null)}
      />
    </AppScreen>
  );
}
