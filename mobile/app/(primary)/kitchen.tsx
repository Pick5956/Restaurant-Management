import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { kitchenQueue, updateOrderItemStatus } from '@/src/api/order';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { usePrimaryTabSceneStatus } from '@/src/components/primary-tabs-runtime';
import { useKitchenOrderEvents } from '@/src/hooks/use-kitchen-order-events';
import {
  Button,
  ChipGroup,
  Divider,
  EmptyState,
  Feedback,
  StatusBadge,
  Surface,
  TextField,
} from '@/src/components/ui';
import { itemStatusLabel } from '@/src/lib/format';
import {
  createKitchenMutationGate,
  formatKitchenDuration,
  KitchenMutationError,
  kitchenFulfillmentContext,
  kitchenRoundDurationSeconds,
  kitchenRoundFinishedLabel,
  kitchenTicketSentTimeLabel,
  kitchenTicketTiming,
  runKitchenMutation,
  sortKitchenRoundsByFinish,
} from '@/src/lib/kitchen-workflow';
import { createRequestGeneration, shouldStartRequest } from '@/src/lib/request-generation';
import {
  isCookingItem,
  isKitchenDoneItem,
  kitchenTicketKey,
  validateKitchenCancelReason,
} from '@/src/lib/order-workflow';
import { kitchenAccess } from '@/src/lib/permission-parity';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, radius, spacing, typeScale } from '@/src/theme';
import type { Order, OrderItem } from '@/src/types/order';

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetBody: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  sheetRoundMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    backgroundColor: palette.surface,
    padding: spacing.md,
  },
  board: {
    alignItems: 'flex-start',
    gap: spacing.lg,
  },
  lane: {
    gap: spacing.md,
  },
  laneHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderStrong,
    paddingBottom: spacing.sm,
  },
  laneIdentity: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  laneDot: {
    width: 9,
    height: 9,
    borderRadius: radius.full,
  },
  laneTitle: {
    color: palette.textStrong,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: '700',
  },
  laneCount: {
    color: palette.muted,
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ticket: {
    gap: 0,
    overflow: 'hidden',
    padding: 0,
  },
  ticketHeader: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ticketIdentity: {
    minWidth: 0,
    flex: 1,
    gap: 2,
  },
  ticketTitle: {
    color: palette.surface,
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ticketMeta: {
    color: palette.surface,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    opacity: 0.88,
  },
  timer: {
    minWidth: 64,
    alignItems: 'flex-end',
    gap: 1,
  },
  timerLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  timerValue: {
    color: palette.surface,
    fontSize: 22,
    lineHeight: 33,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  timerUnit: {
    color: palette.surface,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '700',
    opacity: 0.9,
  },
  timerUrgency: {
    color: palette.surface,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    opacity: 0.9,
  },
  item: {
    gap: spacing.sm,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  itemMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  itemContent: {
    minWidth: 0,
    flex: 1,
    gap: spacing.xs,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  quantity: {
    minWidth: 30,
    minHeight: 24,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  quantityText: {
    color: palette.textStrong,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  itemTitle: {
    minWidth: 0,
    flex: 1,
    color: palette.textStrong,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
  },
  itemDetail: {
    color: palette.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  inlineFlow: {
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: spacing.md,
  },
  ticketFooter: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.surface,
    padding: spacing.md,
  },
});

function KitchenIconAction({
  label,
  icon,
  tone = 'neutral',
  onPress,
  disabled,
  loading,
  prominent = false,
}: {
  label: string;
  icon: AppIconName;
  tone?: 'success' | 'danger' | 'neutral';
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  prominent?: boolean;
}) {
  const color = tone === 'success'
    ? prominent ? palette.primaryText : palette.success
    : tone === 'danger'
      ? palette.danger
      : palette.text;
  const pressedBackground = tone === 'success'
    ? prominent ? palette.primary : palette.successSoft
    : tone === 'danger'
      ? palette.dangerSoft
      : palette.surfaceStrong;
  const restingBackground = tone === 'success' && prominent ? palette.primary : 'transparent';
  const inactive = Boolean(disabled || loading);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(loading), disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconAction,
        {
          backgroundColor: pressed ? pressedBackground : restingBackground,
          opacity: inactive ? 0.42 : pressed ? 0.72 : 1,
        },
      ]}
    >
      {loading ? <ActivityIndicator color={color} size="small" /> : <AppIcon color={color} name={icon} size={22} />}
    </Pressable>
  );
}

export default function KitchenScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const access = kitchenAccess(
    can(activeMembership, 'view_kitchen'),
    can(activeMembership, 'update_order_status'),
  );
  const canUpdate = access.canUpdate;
  const canView = access.canView;
  const [orders, setOrders] = useState<Order[]>([]);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const mutationGateRef = useRef(createKitchenMutationGate());
  const requestGenerationRef = useRef(createRequestGeneration());
  const foregroundRequestRef = useRef<number | null>(null);
  const pendingQuietRefreshRef = useRef(false);
  const adjacentWarmRequestedRef = useRef(false);
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();

  const requestQueueSnapshot = useCallback(async (request: number) => {
    try {
      const response = await kitchenQueue();
      if (requestGenerationRef.current.isCurrent(request)) {
        setOrders(response.orders || []);
      }
    } catch (err) {
      if (requestGenerationRef.current.isCurrent(request)) throw err;
    }
  }, []);

  const reconcileQueue = useCallback(async () => {
    const request = requestGenerationRef.current.begin();
    if (foregroundRequestRef.current !== null) {
      foregroundRequestRef.current = null;
      pendingQuietRefreshRef.current = false;
      setLoading(false);
    }
    await requestQueueSnapshot(request);
  }, [requestQueueSnapshot]);

  const load = useCallback(async (quiet = false) => {
    if (!canView) {
      setLoading(false);
      return;
    }
    if (mutationGateRef.current.locked) {
      if (quiet) pendingQuietRefreshRef.current = true;
      return;
    }
    if (!shouldStartRequest(quiet, foregroundRequestRef.current !== null)) {
      pendingQuietRefreshRef.current = true;
      return;
    }

    const request = requestGenerationRef.current.begin();
    if (!quiet) {
      foregroundRequestRef.current = request;
      setLoading(true);
    }
    setError(null);
    try {
      await requestQueueSnapshot(request);
    } catch (err) {
      if (!requestGenerationRef.current.isCurrent(request)) return;
      setError(err instanceof Error ? err.message : copy('โหลดคิวครัวไม่สำเร็จ', 'Could not load the kitchen queue'));
    } finally {
      if (!quiet && foregroundRequestRef.current === request) {
        foregroundRequestRef.current = null;
        setLoading(false);
        if (pendingQuietRefreshRef.current) {
          pendingQuietRefreshRef.current = false;
          void load(true);
        }
      }
    }
  }, [canView, copy, requestQueueSnapshot]);

  const realtimeStatus = useKitchenOrderEvents(
    () => load(true),
    {
      enabled: canView && (primaryTabSceneStatus === null || primaryTabSceneStatus === 'active'),
      restaurantId: activeMembership?.restaurant_id,
    },
  );

  useEffect(() => {
    if (
      primaryTabSceneStatus !== 'adjacent' ||
      adjacentWarmRequestedRef.current
    ) return;
    adjacentWarmRequestedRef.current = true;
    void load();
  }, [load, primaryTabSceneStatus]);

  useFocusEffect(useCallback(() => {
    if (adjacentWarmRequestedRef.current) {
      adjacentWarmRequestedRef.current = false;
    } else {
      void load();
    }
    const timer = setInterval(() => { void load(true); }, 60_000);
    return () => {
      clearInterval(timer);
      requestGenerationRef.current.invalidate();
      foregroundRequestRef.current = null;
      pendingQuietRefreshRef.current = false;
      setLoading(false);
    };
  }, [load]));

  const cookingTickets = useMemo(
    () => orders.filter((order) => (order.items || []).some((item) => isCookingItem(item.status))),
    [orders],
  );
  const doneTickets = useMemo(
    () => orders.filter((order) => (order.items || []).some((item) => isKitchenDoneItem(item.status))),
    [orders],
  );
  // The board shows only what the kitchen still has to cook, the way the web
  // does; finished rounds move into the completed sheet so the pass is not
  // reading past them all service.
  const cookingGroup = {
    title: copy('กำลังทำ', 'Cooking'),
    orders: cookingTickets,
    kind: 'cooking' as const,
  };
  const doneGroup = {
    title: copy('ครัวทำเสร็จ', 'Kitchen done'),
    orders: sortKitchenRoundsByFinish(doneTickets),
  };

  function releaseMutationGate() {
    mutationGateRef.current.release();
    if (pendingQuietRefreshRef.current) {
      pendingQuietRefreshRef.current = false;
      void load(true);
    }
  }

  async function setItemStatus(
    orderId: number,
    item: OrderItem,
    status: 'cooking' | 'ready' | 'cancelled',
    reason?: string,
    success?: string,
  ) {
    if (!canUpdate || !mutationGateRef.current.tryAcquire()) return false;
    requestGenerationRef.current.invalidate();
    const actionKey = `${status}:${item.ID}`;
    setSubmittingKey(actionKey);
    setError(null);
    setMessage(null);
    try {
      await runKitchenMutation(
        () => updateOrderItemStatus(orderId, item.ID, status, reason),
        reconcileQueue,
      );
      if (success) setMessage(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('อัปเดตสถานะอาหารไม่สำเร็จ', 'Could not update the item status'));
      return false;
    } finally {
      setSubmittingKey(null);
      releaseMutationGate();
    }
  }

  async function markAllDone(order: Order) {
    if (!canUpdate) return;
    const items = (order.items || []).filter((item) => isCookingItem(item.status));
    if (!items.length) return;
    if (!mutationGateRef.current.tryAcquire()) return;
    requestGenerationRef.current.invalidate();
    const actionKey = `all:${kitchenTicketKey(order)}`;
    let updatedCount = 0;
    setSubmittingKey(actionKey);
    setError(null);
    setMessage(null);
    try {
      await runKitchenMutation(async () => {
        for (const item of items) {
          await updateOrderItemStatus(order.ID, item.ID, 'ready');
          updatedCount += 1;
        }
      }, reconcileQueue);
      setMessage(copy('บันทึกว่าครัวทำเสร็จทั้งรอบแล้ว', 'Marked the entire kitchen batch as done'));
    } catch (err) {
      const mutationFailed = !(err instanceof KitchenMutationError) || err.mutationFailed;
      const mutationError = err instanceof KitchenMutationError ? err.mutationError : err;
      const reconciliationFailed = err instanceof KitchenMutationError && err.reconciliationFailed;
      const reconciliationError = err instanceof KitchenMutationError ? err.reconciliationError : null;
      const detail = mutationError instanceof Error
        ? mutationError.message
        : copy('อัปเดตทั้งรอบไม่สำเร็จ', 'Could not update the entire batch');
      if (updatedCount > 0 && reconciliationFailed) {
        const reconciliationDetail = reconciliationError instanceof Error
          ? reconciliationError.message
          : copy('โหลดคิวครัวล่าสุดไม่สำเร็จ', 'Could not load the latest kitchen queue');
        setError(copy(
          `อัปเดตสำเร็จ ${updatedCount.toLocaleString('th-TH')} จาก ${items.length.toLocaleString('th-TH')} รายการ แต่ยังตรวจสอบคิวล่าสุดไม่ได้${mutationFailed ? ` · หยุดอัปเดตเพราะ: ${detail}` : ''} · โหลดคิวไม่สำเร็จ: ${reconciliationDetail}`,
          `Updated ${updatedCount.toLocaleString('en-US')} of ${items.length.toLocaleString('en-US')} items, but the latest queue could not be verified${mutationFailed ? ` · Update stopped: ${detail}` : ''} · Queue load failed: ${reconciliationDetail}`,
        ));
      } else {
        setError(updatedCount > 0
          ? copy(
            `อัปเดตสำเร็จ ${updatedCount.toLocaleString('th-TH')} จาก ${items.length.toLocaleString('th-TH')} รายการ และตรวจคิวล่าสุดแล้ว · ${detail}`,
            `Updated ${updatedCount.toLocaleString('en-US')} of ${items.length.toLocaleString('en-US')} items and reconciled the latest queue · ${detail}`,
          )
          : detail);
      }
    } finally {
      setSubmittingKey(null);
      releaseMutationGate();
    }
  }

  /**
   * Pulls a finished round back to cooking in one go, the way the web's
   * completed sheet does, for when the pass spots something wrong after the
   * round was already called done.
   */
  async function recallRound(order: Order) {
    if (!canUpdate) return;
    const items = (order.items || []).filter((item) => isKitchenDoneItem(item.status));
    if (!items.length) return;
    if (!mutationGateRef.current.tryAcquire()) return;
    requestGenerationRef.current.invalidate();
    const actionKey = `recall:${kitchenTicketKey(order)}`;
    let updatedCount = 0;
    setSubmittingKey(actionKey);
    setError(null);
    setMessage(null);
    try {
      await runKitchenMutation(async () => {
        for (const item of items) {
          await updateOrderItemStatus(order.ID, item.ID, 'cooking');
          updatedCount += 1;
        }
      }, reconcileQueue);
      setMessage(copy('ดึงทั้งรอบกลับไปกำลังทำแล้ว', 'The whole round was moved back to Cooking'));
    } catch (err) {
      const mutationError = err instanceof KitchenMutationError ? err.mutationError : err;
      const detail = mutationError instanceof Error
        ? mutationError.message
        : copy('ดึงรอบกลับไม่สำเร็จ', 'Could not move the round back');
      setError(updatedCount > 0
        ? copy(
          `ย้ายกลับสำเร็จ ${updatedCount.toLocaleString('th-TH')} จาก ${items.length.toLocaleString('th-TH')} รายการ · ${detail}`,
          `Moved back ${updatedCount.toLocaleString('en-US')} of ${items.length.toLocaleString('en-US')} items · ${detail}`,
        )
        : detail);
    } finally {
      setSubmittingKey(null);
      releaseMutationGate();
    }
  }

  function startCancel(itemId: number) {
    if (mutationGateRef.current.locked) return;
    setCancelTargetId(itemId);
    setCancelReason('');
    setCancelReasonError(null);
  }

  async function confirmCancel(orderId: number, item: OrderItem) {
    if (!canUpdate || mutationGateRef.current.locked) return;
    const validation = validateKitchenCancelReason(cancelReason);
    if (validation.error) {
      setCancelReasonError(validation.error === 'required'
        ? copy('กรุณาระบุเหตุผลที่ยกเลิก', 'Enter a cancellation reason.')
        : copy('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'The reason must be 500 characters or fewer.'));
      return;
    }
    const succeeded = await setItemStatus(
      orderId,
      item,
      'cancelled',
      validation.reason,
      copy('ยกเลิกรายการอาหารแล้ว', 'Kitchen item cancelled'),
    );
    if (succeeded) {
      setCancelTargetId(null);
      setCancelReason('');
      setCancelReasonError(null);
    }
  }

  if (!canView) {
    return <AppScreen title={copy('จอครัว', 'Kitchen display')} topLevel><EmptyState title={copy('ไม่มีสิทธิ์ดูคิวครัว', 'No permission to view the kitchen queue')} detail={copy('ต้องมีสิทธิ์ view_kitchen', 'The view_kitchen permission is required.')} /></AppScreen>;
  }

  // One lane, rendered twice: the cooking board on screen, and the finished
  // rounds inside the completed sheet. A single renderer keeps the two from
  // drifting on how a ticket looks or which actions it offers.
  const renderKitchenLane = (group: {
    title: string;
    orders: Order[];
  }) => (
          <View
            key="cooking"
            style={[
              styles.lane,
              {
              width: width >= 820 ? undefined : '100%',
              flex: width >= 820 ? 1 : undefined,
              },
            ]}
          >
            {/* The heading names the zone on every width now that the lane switch is gone. */}
              <View style={styles.laneHeader}>
                <View style={styles.laneIdentity}>
                  <View
                    style={[
                      styles.laneDot,
                      { backgroundColor: palette.warning },
                    ]}
                  />
                  <Text accessibilityRole="header" selectable style={styles.laneTitle}>{group.title}</Text>
                </View>
                <Text selectable style={styles.laneCount}>
                  {copy(
                    `${group.orders.length.toLocaleString('th-TH')} รอบครัว`,
                    `${group.orders.length.toLocaleString('en-US')} kitchen batches`,
                  )}
                </Text>
              </View>

            {group.orders.map((order) => {
              const ticketKey = kitchenTicketKey(order);
              const items = (order.items || []).filter((item) => isCookingItem(item.status));
              const tableLabel = order.table?.display_label
                || order.table?.table_number
                || (order.table_id ? String(order.table_id) : '−');
              const ticketTitle = order.order_type === 'takeaway'
                ? copy('ซื้อกลับบ้าน', 'Takeaway')
                : copy(`โต๊ะ ${tableLabel}`, `Table ${tableLabel}`);
              const customerLabel = order.order_type === 'takeaway'
                ? order.customer_name?.trim() || ''
                : '';
              const batchLabel = order.kitchen_batch ? copy(`รอบ ${order.kitchen_batch.toLocaleString('th-TH')}`, `Batch ${order.kitchen_batch.toLocaleString('en-US')}`) : copy('รอบครัว', 'Kitchen batch');
              const sentTimeLabel = kitchenTicketSentTimeLabel({
                opened_at: order.opened_at,
                kitchen_sent_at: order.kitchen_sent_at,
                items,
              }, language);
              const timing = kitchenTicketTiming({
                opened_at: order.opened_at,
                kitchen_sent_at: order.kitchen_sent_at,
                items,
              });
              const ticketBorderColor = timing.urgency === 'overdue'
                ? palette.danger
                : palette.warning;
              const ticketHeaderBackground = ticketBorderColor;
              const urgencyLabel = timing.urgency === 'overdue'
                ? copy('เกินเวลา', 'Overdue')
                : timing.urgency === 'warning'
                  ? copy('ใกล้เกินเวลา', 'Due soon')
                  : null;
              return (
                <Surface
                  key={ticketKey}
                  style={[styles.ticket, { borderColor: ticketBorderColor }]}
                >
                  <View
                    style={[
                      styles.ticketHeader,
                      {
                        backgroundColor: ticketHeaderBackground,
                      },
                    ]}
                  >
                    <View style={styles.ticketIdentity}>
                      <Text selectable style={styles.ticketTitle}>{ticketTitle}</Text>
                      <Text selectable style={styles.ticketMeta}>
                        {[
                          customerLabel,
                          sentTimeLabel,
                          batchLabel,
                          copy(
                            `${items.length.toLocaleString('th-TH')} รายการ`,
                            `${items.length.toLocaleString('en-US')} items`,
                          ),
                        ].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <View style={styles.timer}>
                      <View style={styles.timerLine}>
                        <Text selectable style={styles.timerValue}>
                          {timing.minutes.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
                        </Text>
                        <Text selectable style={styles.timerUnit}>{copy('นาที', 'min')}</Text>
                      </View>
                      {urgencyLabel ? <Text selectable style={styles.timerUrgency}>{urgencyLabel}</Text> : null}
                    </View>
                </View>
                  {items.map((item, index) => {
                    const cancelling = cancelTargetId === item.ID;
                    const fulfillment = kitchenFulfillmentContext(order.order_type, item.fulfillment_type);
                    return (
                      <View key={item.ID}>
                        {index ? <Divider /> : null}
                        <View style={styles.item}>
                          <View style={styles.itemMain}>
                            <View style={styles.itemContent}>
                              <View style={styles.itemTitleRow}>
                                <View
                                  accessible
                                  accessibilityLabel={copy(
                                    `จำนวน ${item.quantity.toLocaleString('th-TH')}`,
                                    `Quantity ${item.quantity.toLocaleString('en-US')}`,
                                  )}
                                  style={styles.quantity}
                                >
                                  <Text selectable style={styles.quantityText}>
                                    ×{item.quantity.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
                                  </Text>
                                </View>
                                <Text selectable style={styles.itemTitle}>{item.menu_name}</Text>
                              </View>
                              {item.note ? (
                                <Text selectable style={[styles.itemDetail, { color: palette.text, fontWeight: '700' }]}>
                                  {item.note}
                                </Text>
                              ) : null}
                              {item.selected_options?.length ? (
                                <Text selectable style={styles.itemDetail}>
                                  {item.selected_options.map((option) => option.option_name).join(', ')}
                                </Text>
                              ) : null}
                              {fulfillment.differsFromOrder ? (
                                <Text
                                  selectable
                                  style={[typeScale.caption, { color: palette.info, fontWeight: '700' }]}
                                >
                                  {fulfillment.fulfillment === 'takeaway'
                                    ? copy('รายการนี้กลับบ้าน', 'This item: Takeaway')
                                    : copy('รายการนี้ทานที่ร้าน', 'This item: Dine-in')}
                                </Text>
                              ) : null}
                              {!canUpdate ? (
                                <StatusBadge
                                  label={itemStatusLabel(item.status, language)}
                                  tone="warning"
                                />
                              ) : null}
                            </View>
                            {canUpdate && !cancelling ? (
                              <View style={styles.itemActions}>
                                <KitchenIconAction
                                  label={copy(`ทำ ${item.menu_name} เสร็จ`, `Mark ${item.menu_name} done`)}
                                  icon="checkmark"
                                  tone="success"
                                  prominent={items.length === 1}
                                  onPress={() => setItemStatus(order.ID, item, 'ready', undefined, copy('ย้ายรายการไปโซนทำเสร็จแล้ว', 'Item moved to Kitchen done'))}
                                  loading={submittingKey === `ready:${item.ID}`}
                                  disabled={submittingKey !== null}
                                />
                                <KitchenIconAction
                                  label={copy(`ยกเลิก ${item.menu_name}`, `Cancel ${item.menu_name}`)}
                                  icon="close"
                                  tone="danger"
                                  onPress={() => startCancel(item.ID)}
                                  disabled={submittingKey !== null}
                                />
                              </View>
                            ) : null}
                          </View>

                          {canUpdate && cancelling ? (
                            <View style={styles.inlineFlow}>
                              <TextField
                                label={copy('เหตุผลที่ยกเลิก', 'Cancellation reason')}
                                value={cancelReason}
                                onChangeText={(value) => {
                                  setCancelReason(value);
                                  setCancelReasonError(null);
                                }}
                                placeholder={copy('เช่น ของหมด หรืออุปกรณ์ขัดข้อง', 'For example, sold out or equipment failure')}
                                multiline
                                error={cancelReasonError}
                              />
                              <ChipGroup
                                value={cancelReason}
                                onChange={(value) => {
                                  setCancelReason(value);
                                  setCancelReasonError(null);
                                }}
                                options={[
                                  { label: copy('ของหมด', 'Sold out'), value: copy('ของหมด', 'Sold out') },
                                  { label: copy('อุปกรณ์ขัดข้อง', 'Equipment failure'), value: copy('อุปกรณ์ขัดข้อง', 'Equipment failure') },
                                  { label: copy('เหตุสุดวิสัย', 'Unavoidable issue'), value: copy('เหตุสุดวิสัย', 'Unavoidable issue') },
                                ]}
                              />
                              <View style={[styles.itemActions, { flexDirection: width < 420 ? 'column' : 'row' }]}>
                                <Button
                                  compact
                                  variant="secondary"
                                  label={copy('เก็บรายการไว้', 'Keep item')}
                                  onPress={() => {
                                    setCancelTargetId(null);
                                    setCancelReasonError(null);
                                  }}
                                  disabled={submittingKey !== null}
                                  style={{ flex: 1 }}
                                />
                                <Button
                                  compact
                                  variant="danger"
                                  label={copy('ยืนยันยกเลิก', 'Confirm cancellation')}
                                  onPress={() => confirmCancel(order.ID, item)}
                                  loading={submittingKey === `cancelled:${item.ID}`}
                                  disabled={submittingKey !== null}
                                  style={{ flex: 1 }}
                                />
                              </View>
                            </View>
                          ) : null}

                        </View>
                      </View>
                    );
                  })}
                  {canUpdate && items.length > 1 ? (
                    <View style={styles.ticketFooter}>
                       <Button
                         variant="ghost"
                         label={copy('ทำรอบนี้เสร็จ', 'Complete this batch')}
                        onPress={() => markAllDone(order)}
                        loading={submittingKey === `all:${ticketKey}`}
                        disabled={submittingKey !== null}
                      />
                    </View>
                  ) : null}
                </Surface>
              );
            })}
            {!loading && !group.orders.length ? (
              <EmptyState
                title={copy('ไม่มีรายการกำลังทำ', 'No items cooking')}
              />
            ) : null}
          </View>
  );

  return (
    <AppScreen
      title={copy('ครัว', 'Kitchen')}
      topLevel
      action={(
        <Button
          compact
          icon="time-outline"
          variant="secondary"
        label={copy('รายการที่เสร็จสิ้น', 'Completed')}
          onPress={() => setCompletedOpen(true)}
        />
      )}
      refreshControl={<AppRefreshControl onRefresh={() => load()} />}
      contentMaxWidth={1320}
      contentStyle={{ gap: spacing.lg }}
    >
      {error ? <Feedback title={copy('คิวครัวมีปัญหา', 'Kitchen queue issue')} detail={error} tone="danger" /> : null}
      {message ? <Feedback title={message} tone="success" /> : null}
      {realtimeStatus === 'offline' ? (
        <Feedback
          tone="warning"
          title={copy('การเชื่อมต่อสดหลุด', 'Live updates disconnected')}
          detail={copy(
            'คิวจะไม่อัปเดตเองจนกว่าจะต่อกลับได้ ระบบกำลังลองใหม่ ระหว่างนี้ดึงหน้าจอลงเพื่อรีเฟรชได้',
            'The queue will not update on its own until the connection is back. Retrying now - pull down to refresh in the meantime.',
          )}
        />
      ) : null}
      {!canUpdate ? (
        <Feedback
          title={copy('โหมดดูคิวครัว', 'Kitchen view mode')}
          detail={copy('บัญชีนี้ดูสถานะได้ แต่ไม่มีสิทธิ์เปลี่ยนสถานะรายการอาหาร', 'This account can view the queue but cannot change item statuses.')}
          tone="info"
        />
      ) : null}
      <View style={styles.board}>
        {renderKitchenLane(cookingGroup)}
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setCompletedOpen(false)}
        presentationStyle="pageSheet"
        visible={completedOpen}
      >
        <View style={{ flex: 1, backgroundColor: palette.canvas }}>
          <View style={styles.sheetHeader}>
            <View style={{ minWidth: 0, flex: 1 }}>
              <Text style={typeScale.cardTitle}>{copy('รายการที่เสร็จสิ้น', 'Completed')}</Text>
            </View>
            <Button
              compact
              variant="secondary"
              icon="close"
              label={copy('ปิด', 'Close')}
              onPress={() => setCompletedOpen(false)}
            />
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            {doneGroup.orders.length ? doneGroup.orders.map((order) => {
              const tableLabel = order.table?.display_label
                || order.table?.table_number
                || (order.table_id ? String(order.table_id) : '−');
              const roundTitle = order.order_type === 'takeaway'
                ? copy('ซื้อกลับบ้าน', 'Takeaway')
                : copy(`โต๊ะ ${tableLabel}`, `Table ${tableLabel}`);
              const batchLabel = order.kitchen_batch
                ? copy(`รอบ ${order.kitchen_batch.toLocaleString('th-TH')}`, `Batch ${order.kitchen_batch.toLocaleString('en-US')}`)
                : copy('รอบครัว', 'Kitchen batch');
              return (
                <View key={`recall:${kitchenTicketKey(order)}`} style={styles.sheetRoundMeta}>
                  <View style={{ minWidth: 0, flex: 1 }}>
                    <Text selectable numberOfLines={1} style={typeScale.cardTitle}>{roundTitle}</Text>
                    <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{batchLabel}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text selectable style={[typeScale.caption, { color: palette.text }]}>
                      {copy('เสร็จเมื่อ', 'Finished')} {kitchenRoundFinishedLabel(order, language)}
                    </Text>
                    <Text selectable style={[typeScale.caption, { color: palette.muted }]}>
                      {copy('ใช้เวลา', 'Took')} {formatKitchenDuration(kitchenRoundDurationSeconds(order), language)}
                    </Text>
                  </View>
                  {canUpdate ? (
                    <KitchenIconAction
                      label={copy(`ดึง ${roundTitle} กลับไปกำลังทำ`, `Move ${roundTitle} back to Cooking`)}
                      icon="arrow-undo-outline"
                      onPress={() => recallRound(order)}
                      loading={submittingKey === `recall:${kitchenTicketKey(order)}`}
                      disabled={submittingKey !== null}
                    />
                  ) : null}
                </View>
              );
            }) : (
              <EmptyState
                title={copy('ยังไม่มีรายการที่ครัวทำเสร็จ', 'No items finished yet')}
                detail={copy(
                  'รายการที่ทำเสร็จจะมาอยู่ตรงนี้',
                  'Rounds the kitchen has finished appear here.',
                )}
              />
            )}
          </ScrollView>
        </View>
      </Modal>
    </AppScreen>
  );
}
