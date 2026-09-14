import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { kitchenQueue, updateOrderItemStatus } from '@/src/api/order';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import {
  BoardHeading,
  CancelSheet,
  CompletedSheet,
  DonePanel,
  EmptyKitchen,
  KitchenTile,
  LiveChip,
  Ticket,
  TicketButton,
  TicketItem,
  type DoneRowProps,
} from '@/src/components/kitchen/parts';
import { usePrimaryTabSceneStatus } from '@/src/components/primary-tabs-runtime';
import { useKitchenOrderEvents } from '@/src/hooks/use-kitchen-order-events';
import { EmptyState, Feedback, StatusBadge } from '@/src/components/ui';
import { itemStatusLabel } from '@/src/lib/format';
import {
  dealIntoColumns,
  formatKitchenMinutes,
  kitchenBoardStats,
  latestFinishedAt,
  sortTickets,
  type KitchenSortMode,
} from '@/src/lib/kitchen-board';
import {
  createKitchenMutationGate,
  KitchenMutationError,
  kitchenFulfillmentContext,
  kitchenRoundDurationSeconds,
  kitchenRoundFinishedAt,
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
import { useToast, type ToastInput } from '@/src/providers/toast-provider';
import { spacing } from '@/src/theme';
import type { Order, OrderItem } from '@/src/types/order';

// The kitchen board, redrawn on 13 ก.ย. 2569 in the overview's language. The
// data path below is the one that has run since the board was written; only
// what is drawn from it changed. See src/components/kitchen/parts.tsx for the
// pieces and Agent_testing for the design rounds behind them.

const TABLET_WIDTH = 900;

type Copy = (th: string, en: string) => string;

/** "โต๊ะ F03", or the customer's name on a takeaway ticket. */
function ticketTitleOf(order: Order, copy: Copy) {
  const tableLabel = order.table?.display_label
    || order.table?.table_number
    || (order.table_id ? String(order.table_id) : '−');
  if (order.order_type === 'takeaway') {
    const customer = order.customer_name?.trim();
    return { title: customer || copy('ซื้อกลับบ้าน', 'Takeaway'), icon: 'bag-handle-outline' as const };
  }
  return { title: copy(`โต๊ะ ${tableLabel}`, `Table ${tableLabel}`), icon: undefined };
}

const styles = StyleSheet.create({
  tiles: {
    flexDirection: 'row',
    gap: 8,
  },
  board: {
    gap: 12,
  },
  tabletBoard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  tabletColumns: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  column: {
    flex: 1,
    gap: 12,
  },
  donePanel: {
    width: 300,
  },
});

export default function KitchenScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_WIDTH;
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
  // Only a failed queue load lives in the page: it is a state, true until the
  // next load succeeds. What a button did — done, cancelled, recalled, or
  // failed — is an event, and goes out as a toast (14 ก.ย.). The green bar that
  // used to sit above the tiles pushed the whole board down on every tap.
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  const [cancelTarget, setCancelTarget] = useState<{ order: Order; item: OrderItem } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  // The minute counters and the bars under the headers move on their own,
  // between the quiet reloads; a ticket at 4:59 must turn amber on time.
  const [clock, setClock] = useState(() => Date.now());
  const mutationGateRef = useRef(createKitchenMutationGate());
  const requestGenerationRef = useRef(createRequestGeneration());
  const foregroundRequestRef = useRef<number | null>(null);
  const pendingQuietRefreshRef = useRef(false);
  const adjacentWarmRequestedRef = useRef(false);
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;

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
    const tick = setInterval(() => { setClock(Date.now()); }, 20_000);
    setClock(Date.now());
    return () => {
      clearInterval(timer);
      clearInterval(tick);
      requestGenerationRef.current.invalidate();
      foregroundRequestRef.current = null;
      pendingQuietRefreshRef.current = false;
      setLoading(false);
    };
  }, [load]));

  const [sortMode, setSortMode] = useState<KitchenSortMode>('waiting');
  const cookingTickets = useMemo(
    () => sortTickets(
      orders.filter((order) => (order.items || []).some((item) => isCookingItem(item.status))),
      sortMode,
      clock,
    ),
    [clock, orders, sortMode],
  );
  const doneTickets = useMemo(
    () => sortKitchenRoundsByFinish(
      orders.filter((order) => (order.items || []).some((item) => isKitchenDoneItem(item.status))),
    ),
    [orders],
  );
  const stats = useMemo(() => kitchenBoardStats(cookingTickets, doneTickets, clock), [clock, cookingTickets, doneTickets]);

  function releaseMutationGate() {
    mutationGateRef.current.release();
    if (pendingQuietRefreshRef.current) {
      pendingQuietRefreshRef.current = false;
      void load(true);
    }
  }

  function failed(title: string, detail: string) {
    showToast({ tone: 'error', title, message: detail });
  }

  async function setItemStatus(
    orderId: number,
    item: OrderItem,
    status: 'cooking' | 'ready' | 'cancelled',
    reason?: string,
    success?: ToastInput,
  ) {
    if (!canUpdate || !mutationGateRef.current.tryAcquire()) return false;
    requestGenerationRef.current.invalidate();
    const actionKey = `${status}:${item.ID}`;
    setSubmittingKey(actionKey);
    try {
      await runKitchenMutation(
        () => updateOrderItemStatus(orderId, item.ID, status, reason),
        reconcileQueue,
      );
      if (success) showToast(success);
      return true;
    } catch (err) {
      failed(
        copy('อัปเดตสถานะอาหารไม่สำเร็จ', 'Could not update the item'),
        err instanceof Error ? err.message : copy('ลองอีกครั้ง', 'Try again'),
      );
      return false;
    } finally {
      setSubmittingKey(null);
      releaseMutationGate();
    }
  }

  function markItemDone(order: Order, item: OrderItem) {
    const where = ticketTitleOf(order, copy).title;
    void setItemStatus(order.ID, item, 'ready', undefined, {
      title: copy(`${item.menu_name} เสร็จแล้ว`, `${item.menu_name} done`),
      message: where,
      action: {
        label: copy('ดึงกลับ', 'Undo'),
        onPress: () => {
          void setItemStatus(order.ID, item, 'cooking', undefined, {
            tone: 'info',
            title: copy(`ดึง ${item.menu_name} กลับไปทำ`, `${item.menu_name} back to cooking`),
            message: where,
          });
        },
      },
    });
  }

  async function markAllDone(order: Order) {
    if (!canUpdate) return;
    const items = (order.items || []).filter((item) => isCookingItem(item.status));
    if (!items.length) return;
    if (!mutationGateRef.current.tryAcquire()) return;
    requestGenerationRef.current.invalidate();
    const ticketKey = kitchenTicketKey(order);
    const actionKey = `all:${ticketKey}`;
    let updatedCount = 0;
    setSubmittingKey(actionKey);
    try {
      await runKitchenMutation(async () => {
        for (const item of items) {
          await updateOrderItemStatus(order.ID, item.ID, 'ready');
          updatedCount += 1;
        }
      }, reconcileQueue);
      showToast({
        title: copy('ทำรอบนี้เสร็จแล้ว', 'Round done'),
        message: `${ticketTitleOf(order, copy).title} · ${copy(`${items.length} รายการ`, `${items.length} items`)}`,
        action: { label: copy('ดึงกลับ', 'Undo'), onPress: () => recallByKey(ticketKey) },
      });
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
        failed(copy('ทำทั้งรอบไม่ครบ', 'Round only partly done'), copy(
          `อัปเดตสำเร็จ ${updatedCount.toLocaleString('th-TH')} จาก ${items.length.toLocaleString('th-TH')} รายการ แต่ยังตรวจสอบคิวล่าสุดไม่ได้${mutationFailed ? ` · หยุดอัปเดตเพราะ: ${detail}` : ''} · โหลดคิวไม่สำเร็จ: ${reconciliationDetail}`,
          `Updated ${updatedCount.toLocaleString('en-US')} of ${items.length.toLocaleString('en-US')} items, but the latest queue could not be verified${mutationFailed ? ` · Update stopped: ${detail}` : ''} · Queue load failed: ${reconciliationDetail}`,
        ));
      } else {
        failed(copy('ทำทั้งรอบไม่สำเร็จ', 'Could not complete the round'), updatedCount > 0
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
    try {
      await runKitchenMutation(async () => {
        for (const item of items) {
          await updateOrderItemStatus(order.ID, item.ID, 'cooking');
          updatedCount += 1;
        }
      }, reconcileQueue);
      showToast({
        tone: 'info',
        title: copy('ดึงกลับไปกำลังทำแล้ว', 'Moved back to cooking'),
        message: ticketTitleOf(order, copy).title,
      });
    } catch (err) {
      const mutationError = err instanceof KitchenMutationError ? err.mutationError : err;
      const detail = mutationError instanceof Error
        ? mutationError.message
        : copy('ดึงรอบกลับไม่สำเร็จ', 'Could not move the round back');
      failed(copy('ดึงกลับไม่สำเร็จ', 'Could not move it back'), updatedCount > 0
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

  /**
   * The toast's undo. By the time it is pressed the queue has been reloaded, so
   * the order object the toast was raised with still lists its items as
   * cooking; the round is looked up again by its ticket key.
   */
  function recallByKey(ticketKey: string) {
    const round = ordersRef.current.find((order) => kitchenTicketKey(order) === ticketKey);
    if (!round || !(round.items || []).some((item) => isKitchenDoneItem(item.status))) {
      showToast({ tone: 'warning', title: copy('ดึงกลับไม่ได้', 'Cannot undo'), message: copy('รอบนี้เสิร์ฟหรือปิดบิลไปแล้ว', 'This round was already served or closed') });
      return;
    }
    void recallRound(round);
  }

  function startCancel(order: Order, item: OrderItem) {
    if (mutationGateRef.current.locked) return;
    setCancelTarget({ order, item });
    setCancelReason('');
    setCancelReasonError(null);
  }

  function keepItem() {
    setCancelTarget(null);
    setCancelReasonError(null);
  }

  async function confirmCancel() {
    if (!cancelTarget || !canUpdate || mutationGateRef.current.locked) return;
    const validation = validateKitchenCancelReason(cancelReason);
    if (validation.error) {
      setCancelReasonError(validation.error === 'required'
        ? copy('กรุณาระบุเหตุผลที่ยกเลิก', 'Enter a cancellation reason.')
        : copy('เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'The reason must be 500 characters or fewer.'));
      return;
    }
    const succeeded = await setItemStatus(
      cancelTarget.order.ID,
      cancelTarget.item,
      'cancelled',
      validation.reason,
      {
        tone: 'info',
        title: copy(`ยกเลิก ${cancelTarget.item.menu_name} แล้ว`, `${cancelTarget.item.menu_name} cancelled`),
        message: ticketTitleOf(cancelTarget.order, copy).title,
      },
    );
    if (succeeded) {
      setCancelTarget(null);
      setCancelReason('');
      setCancelReasonError(null);
    }
  }

  if (!canView) {
    return <AppScreen title={copy('ครัว', 'Kitchen')} topLevel><EmptyState title={copy('ไม่มีสิทธิ์ดูคิวครัว', 'No permission to view the kitchen queue')} detail={copy('ต้องมีสิทธิ์ view_kitchen', 'The view_kitchen permission is required.')} /></AppScreen>;
  }

  // ---------------------------------------------------------------- labels

  const ticketTitle = (order: Order) => ticketTitleOf(order, copy);
  const batchLabel = (order: Order) => (order.kitchen_batch
    ? copy(`รอบ ${order.kitchen_batch.toLocaleString('th-TH')}`, `Batch ${order.kitchen_batch.toLocaleString('en-US')}`)
    : copy('รอบครัว', 'Kitchen batch'));
  const itemsLabel = (count: number) => copy(
    `${count.toLocaleString('th-TH')} รายการ`,
    `${count.toLocaleString('en-US')} items`,
  );

  // ---------------------------------------------------------------- tickets

  const renderTicket = (order: Order) => {
    const ticketKey = kitchenTicketKey(order);
    const items = (order.items || []).filter((item) => isCookingItem(item.status));
    const { title, icon } = ticketTitle(order);
    const timing = kitchenTicketTiming({
      opened_at: order.opened_at,
      kitchen_sent_at: order.kitchen_sent_at,
      items,
    }, clock);
    const sentTimeLabel = kitchenTicketSentTimeLabel({
      opened_at: order.opened_at,
      kitchen_sent_at: order.kitchen_sent_at,
      items,
    }, language);
    const meta = [
      order.order_type === 'takeaway' ? copy('กลับบ้าน', 'Takeaway') : batchLabel(order),
      copy(`ส่งครัว ${sentTimeLabel}`, `Sent ${sentTimeLabel}`),
      itemsLabel(items.length),
    ].join(' · ');
    const urgencyLabel = timing.urgency === 'overdue'
      ? copy('เกินเวลา', 'Overdue')
      : timing.urgency === 'warning'
        ? copy('ใกล้เกินเวลา', 'Due soon')
        : null;
    const single = items.length === 1;
    const footer = canUpdate ? (
      single ? (
        <TicketButton
          icon="checkmark"
          label={copy('เสร็จ', 'Done')}
          onPress={() => markItemDone(order, items[0])}
          loading={submittingKey === `ready:${items[0].ID}`}
          disabled={submittingKey !== null}
        />
      ) : (
        <TicketButton
          icon="checkmark-done"
          label={copy(`ทำรอบนี้เสร็จ · ${itemsLabel(items.length)}`, `Complete this batch · ${itemsLabel(items.length)}`)}
          onPress={() => markAllDone(order)}
          loading={submittingKey === `all:${ticketKey}`}
          disabled={submittingKey !== null}
        />
      )
    ) : null;

    return (
      <Ticket
        key={ticketKey}
        title={title}
        titleIcon={icon}
        meta={meta}
        minutes={timing.minutes}
        urgency={timing.urgency}
        urgencyLabel={urgencyLabel}
        language={language}
        footer={footer}
      >
        {items.map((item, index) => {
          const fulfillment = kitchenFulfillmentContext(order.order_type, item.fulfillment_type);
          return (
            <TicketItem
              key={item.ID}
              first={index === 0}
              quantity={item.quantity}
              name={item.menu_name}
              note={item.note || undefined}
              options={item.selected_options?.length ? item.selected_options.map((option) => option.option_name).join(', ') : undefined}
              chip={fulfillment.differsFromOrder
                ? (fulfillment.fulfillment === 'takeaway' ? copy('กลับบ้าน', 'Takeaway') : copy('ทานที่ร้าน', 'Dine-in'))
                : undefined}
              badge={!canUpdate ? (
                <View style={{ alignSelf: 'flex-start', marginTop: 4 }}>
                  <StatusBadge label={itemStatusLabel(item.status, language)} tone="warning" />
                </View>
              ) : undefined}
              showDone={canUpdate && !single}
              onDone={() => markItemDone(order, item)}
              doneLoading={submittingKey === `ready:${item.ID}`}
              onCancel={canUpdate ? () => startCancel(order, item) : undefined}
              disabled={submittingKey !== null}
              language={language}
            />
          );
        })}
      </Ticket>
    );
  };

  const doneRows: DoneRowProps[] = doneTickets.map((order) => {
    const { title, icon } = ticketTitle(order);
    const doneItems = (order.items || []).filter((item) => isKitchenDoneItem(item.status));
    const key = kitchenTicketKey(order);
    return {
      key: `recall:${key}`,
      title,
      titleIcon: icon,
      meta: `${order.order_type === 'takeaway' ? copy('กลับบ้าน', 'Takeaway') : batchLabel(order)} · ${itemsLabel(doneItems.length)}`,
      finishedAt: kitchenRoundFinishedAt(order),
      durationSeconds: kitchenRoundDurationSeconds(order),
      onRecall: canUpdate ? () => recallRound(order) : undefined,
      recallLoading: submittingKey === `recall:${key}`,
      disabled: submittingKey !== null,
    };
  });

  const doneEmpty = (
    <EmptyState
      title={copy('ยังไม่มีรายการที่ครัวทำเสร็จ', 'No items finished yet')}
      detail={copy('รายการที่ทำเสร็จจะมาอยู่ตรงนี้', 'Rounds the kitchen has finished appear here.')}
    />
  );

  const emptyBoard = !loading && !cookingTickets.length
    ? <EmptyKitchen latestFinishedAt={latestFinishedAt(doneTickets)} language={language} />
    : null;

  const averageSuffix = stats.averageDoneSeconds !== null
    ? `· ${formatKitchenMinutes(stats.averageDoneSeconds, language)}`
    : (language === 'th' ? 'รอบ' : 'rounds');

  return (
    <AppScreen
      title={copy('ครัว', 'Kitchen')}
      topLevel
      action={<LiveChip live={realtimeStatus !== 'offline'} language={language} />}
      refreshControl={<AppRefreshControl onRefresh={() => load()} />}
      contentMaxWidth={1320}
      contentStyle={{ gap: spacing.md }}
    >
      {error ? <Feedback title={copy('คิวครัวมีปัญหา', 'Kitchen queue issue')} detail={error} tone="danger" /> : null}
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
          title={copy('ดูคิวอย่างเดียว', 'Kitchen view mode')}
          detail={copy('บัญชีนี้ดูสถานะได้ แต่ไม่มีสิทธิ์เปลี่ยนสถานะรายการอาหาร', 'This account can view the queue but cannot change item statuses.')}
          tone="info"
        />
      ) : null}

      <View style={styles.tiles}>
        <KitchenTile
          icon="flame-outline"
          label={copy('กำลังทำ', 'Cooking')}
          value={stats.cookingRounds.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
          suffix={copy('รอบ', 'rounds')}
          tone="brand"
        />
        <KitchenTile
          icon="timer-outline"
          label={copy('เกินเวลา', 'Overdue')}
          value={stats.overdueRounds.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
          suffix={copy('รอบ', 'rounds')}
          tone="danger"
        />
        <KitchenTile
          icon="checkmark-done"
          label={copy('เสร็จแล้ว', 'Finished')}
          value={stats.doneRounds.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
          suffix={averageSuffix}
          tone="success"
          onPress={isTablet ? undefined : () => setCompletedOpen(true)}
        />
      </View>

      <BoardHeading
        title={copy('กำลังทำ', 'Cooking')}
        sort={sortMode}
        onSort={setSortMode}
        showSort={cookingTickets.length > 1}
        language={language}
      />

      {isTablet ? (
        <View style={styles.tabletBoard}>
          <View style={styles.tabletColumns}>
            {emptyBoard ? <View style={styles.column}>{emptyBoard}</View> : dealIntoColumns(cookingTickets, 2).map((column, index) => (
              <View key={index} style={styles.column}>{column.map(renderTicket)}</View>
            ))}
          </View>
          <View style={styles.donePanel}>
            <DonePanel rows={doneRows} average={stats.averageDoneSeconds} language={language} empty={doneEmpty} />
          </View>
        </View>
      ) : (
        <View style={styles.board}>
          {emptyBoard ?? cookingTickets.map(renderTicket)}
        </View>
      )}

      <CancelSheet
        open={cancelTarget !== null}
        itemName={cancelTarget?.item.menu_name ?? ''}
        quantity={cancelTarget?.item.quantity ?? 0}
        ticketLabel={cancelTarget ? ticketTitle(cancelTarget.order).title : ''}
        ticketMeta={cancelTarget ? (() => {
          const timing = kitchenTicketTiming({
            opened_at: cancelTarget.order.opened_at,
            kitchen_sent_at: cancelTarget.order.kitchen_sent_at,
            items: (cancelTarget.order.items || []).filter((item) => isCookingItem(item.status)),
          }, clock);
          return `${batchLabel(cancelTarget.order)} · ${copy(`${timing.minutes} นาที`, `${timing.minutes} min`)}`;
        })() : ''}
        urgency={cancelTarget ? kitchenTicketTiming({
          opened_at: cancelTarget.order.opened_at,
          kitchen_sent_at: cancelTarget.order.kitchen_sent_at,
          items: (cancelTarget.order.items || []).filter((item) => isCookingItem(item.status)),
        }, clock).urgency : 'normal'}
        reason={cancelReason}
        error={cancelReasonError}
        onReason={(value) => {
          setCancelReason(value);
          setCancelReasonError(null);
        }}
        onKeep={keepItem}
        onConfirm={() => { void confirmCancel(); }}
        busy={cancelTarget !== null && submittingKey === `cancelled:${cancelTarget.item.ID}`}
        language={language}
      />

      {!isTablet ? (
        <CompletedSheet
          open={completedOpen}
          onClose={() => setCompletedOpen(false)}
          rows={doneRows}
          average={stats.averageDoneSeconds}
          slowest={stats.slowestDoneSeconds}
          language={language}
          empty={doneEmpty}
        />
      ) : null}
    </AppScreen>
  );
}
