import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createKitchenMutationGate,
  KitchenMutationError,
  kitchenFulfillmentContext,
  kitchenTicketSentTimeLabel,
  kitchenTicketStartedAt,
  kitchenTicketTiming,
  resolveKitchenImageUrl,
  runKitchenMutation,
} from './kitchen-workflow.ts';
import {
  isKitchenOrderChangeEvent,
  parseOrderChangeEvent,
  parseServerSentEvents,
} from './order-events.ts';
import {
  createRequestGeneration,
  shouldStartRequest,
} from './request-generation.ts';
import {
  activeOrderItems,
  billExitRoute,
  billPaymentStage,
  canCancelOrderFromDetail,
  canCancelOrderForRole,
  canCloseEmptyOrder,
  canOpenOrderBill,
  canReprintReceipt,
  canTakeOrderPayment,
  isKitchenComplete,
  isOptionSelectionBelowMinimum,
  kitchenTicketKey,
  paymentReceivedAmount,
  SERVED_REMOVAL_REASONS,
  undeliveredOrderItems,
  validateKitchenCancelReason,
} from './order-workflow.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('paid bill exits to an accessible workflow for waiter and cashier roles', () => {
  assert.equal(billExitRoute(true, false), '/tables');
  assert.equal(billExitRoute(false, true), '/orders');
  assert.equal(billExitRoute(false, false), '/home');
});

test('a recorded payment cannot be submitted again while the receipt reloads', () => {
  assert.equal(billPaymentStage('unpaid'), 'due');
  assert.equal(billPaymentStage('paid'), 'paid');
});

test('only an open empty order can use the mistake-recovery close action: a dine-in on its table, or a takeaway', () => {
  assert.equal(canCloseEmptyOrder({ order_type: 'dine_in', table_id: 7, status: 'open', items: [] }), true);
  assert.equal(canCloseEmptyOrder({ order_type: 'dine_in', table_id: null, status: 'open', items: [] }), false);
  assert.equal(canCloseEmptyOrder({ order_type: 'dine_in', table_id: 7, status: 'sent_to_kitchen', items: [] }), false);
  assert.equal(canCloseEmptyOrder({ order_type: 'dine_in', table_id: 7, status: 'open', items: [{ status: 'pending' }] }), false);
  assert.equal(canCloseEmptyOrder({ order_type: 'dine_in', table_id: 7, status: 'open', items: [{ status: 'cancelled' }] }), true);
  // A takeaway opened by mistake had no way out on the phone (owner, 2026-09-25);
  // the server's validateEmptyTableClose has taken it since 2026-09-23.
  assert.equal(canCloseEmptyOrder({ order_type: 'takeaway', table_id: null, status: 'open', items: [] }), true);
  assert.equal(canCloseEmptyOrder({ order_type: 'takeaway', table_id: null, status: 'open', items: [{ status: 'cancelled' }] }), true);
  assert.equal(canCloseEmptyOrder({ order_type: 'takeaway', table_id: null, status: 'open', items: [{ status: 'pending' }] }), false);
  assert.equal(canCloseEmptyOrder({ order_type: 'takeaway', table_id: null, status: 'cancelled', items: [] }), false);
  assert.equal(canCloseEmptyOrder(null), false);
});

test('waiters can cancel only before the order is sent while other take-order roles follow the backend rule', () => {
  assert.equal(canCancelOrderForRole('waiter', 'open'), true);
  assert.equal(canCancelOrderForRole('waiter', 'sent_to_kitchen'), false);
  assert.equal(canCancelOrderForRole('manager', 'sent_to_kitchen'), true);
  assert.equal(canCancelOrderForRole('manager', 'completed'), false);
});

test('an active takeaway can still be cancelled after every item was cancelled', () => {
  assert.equal(canCancelOrderFromDetail({
    order_type: 'takeaway',
    status: 'open',
    payment_status: 'unpaid',
    items: [{ status: 'cancelled' }],
  }, 'waiter'), true);
  assert.equal(canCancelOrderFromDetail({
    order_type: 'takeaway',
    status: 'open',
    payment_status: 'unpaid',
    items: [],
  }, 'manager'), true);
  assert.equal(canCancelOrderFromDetail({
    order_type: 'dine_in',
    status: 'open',
    payment_status: 'unpaid',
    items: [{ status: 'cancelled' }],
  }, 'manager'), false);
  assert.equal(canCancelOrderFromDetail({
    order_type: 'takeaway',
    status: 'cancelled',
    payment_status: 'unpaid',
    items: [{ status: 'cancelled' }],
  }, 'manager'), false);
});

test('an order becomes billable when every active item is done by the kitchen', () => {
  assert.equal(isKitchenComplete([
    { status: 'ready' },
    { status: 'served' },
    { status: 'cancelled' },
  ]), true);
});

test('an order is not billable while an active item is pending or cooking', () => {
  assert.equal(isKitchenComplete([
    { status: 'ready' },
    { status: 'cooking' },
  ]), false);
  assert.equal(isKitchenComplete([
    { status: 'pending' },
  ]), false);
});

test('an order with no active kitchen items is not billable', () => {
  assert.equal(isKitchenComplete([]), false);
  assert.equal(isKitchenComplete([{ status: 'cancelled' }]), false);
});

test('cancelled items are excluded from order counts, bill display, and fulfillment checks', () => {
  const items = [
    { ID: 1, status: 'ready' },
    { ID: 2, status: 'cancelled' },
    { ID: 3, status: 'served' },
  ];

  assert.deepEqual(activeOrderItems(items).map((item) => item.ID), [1, 3]);
  assert.deepEqual(undeliveredOrderItems(items), []);
});

test('a bill can open after every active item has been sent even while the kitchen is working', () => {
  assert.equal(canOpenOrderBill([{ status: 'cooking' }, { status: 'ready' }]), true);
  assert.equal(canOpenOrderBill([{ status: 'pending' }, { status: 'ready' }]), false);
  assert.equal(canOpenOrderBill([{ status: 'cancelled' }]), false);
});

test('payment stays blocked until every active bill item is ready or served', () => {
  assert.equal(canTakeOrderPayment([{ status: 'ready' }, { status: 'served' }, { status: 'cancelled' }]), true);
  assert.equal(canTakeOrderPayment([{ status: 'cooking' }, { status: 'served' }]), false);
  assert.equal(canTakeOrderPayment([{ status: 'pending' }]), false);
  assert.equal(canTakeOrderPayment([{ status: 'cancelled' }]), false);
});

test('kitchen tickets use the backend ticket id so separate rounds stay distinct', () => {
  assert.equal(kitchenTicketKey({
    ID: 42,
    kitchen_batch: 3,
    kitchen_ticket_id: '42:3',
  }), '42:3');
  assert.equal(kitchenTicketKey({ ID: 42, kitchen_batch: 4 }), '42:4');
});

test('mobile payment follows the web exact-payment workflow', () => {
  assert.equal(paymentReceivedAmount('cash', 287.5), 287.5);
  assert.equal(paymentReceivedAmount('promptpay_qr', 287.5), 287.5);
});

test('option groups enforce normalized min_select even when the group is marked optional', () => {
  assert.equal(isOptionSelectionBelowMinimum(1, 0), true);
  assert.equal(isOptionSelectionBelowMinimum(1, 1), false);
  assert.equal(isOptionSelectionBelowMinimum(0, 0), false);
  assert.equal(isOptionSelectionBelowMinimum(-2, 0), false);
});

test('kitchen cancellation requires a trimmed audit reason of at most 500 characters', () => {
  assert.deepEqual(validateKitchenCancelReason('   '), {
    reason: null,
    error: 'required',
  });
  assert.deepEqual(validateKitchenCancelReason(' ของหมด '), {
    reason: 'ของหมด',
    error: null,
  });
  assert.deepEqual(validateKitchenCancelReason('x'.repeat(501)), {
    reason: null,
    error: 'too_long',
  });
});

test('kitchen ticket timing uses the oldest sent item and web urgency thresholds', () => {
  const now = Date.parse('2026-07-30T05:10:00.000Z');
  assert.deepEqual(kitchenTicketTiming({
    opened_at: '2026-07-30T05:08:00.000Z',
    items: [
      { sent_at: '2026-07-30T05:00:00.000Z' },
      { sent_at: '2026-07-30T05:06:00.000Z' },
    ],
  }, now), {
    minutes: 10,
    urgency: 'overdue',
  });
  assert.equal(kitchenTicketTiming({
    opened_at: '2026-07-30T05:05:00.000Z',
    items: [],
  }, now).urgency, 'warning');
  assert.equal(kitchenTicketTiming({
    opened_at: '2026-07-30T05:06:00.000Z',
    items: [],
  }, now).urgency, 'normal');
});

test('kitchen ticket time uses the batch sent time and formats Bangkok time', () => {
  const ticket = {
    opened_at: '2026-07-30T01:00:00.000Z',
    kitchen_sent_at: '2026-07-30T02:55:00.000Z',
    items: [
      { sent_at: '2026-07-30T03:00:00.000Z' },
      { sent_at: '2026-07-30T03:01:00.000Z' },
    ],
  };

  assert.equal(kitchenTicketStartedAt(ticket), Date.parse(ticket.kitchen_sent_at));
  assert.equal(kitchenTicketSentTimeLabel(ticket, 'th'), '09:55 น.');
  assert.equal(kitchenTicketSentTimeLabel(ticket, 'en'), '09:55');
  assert.equal(kitchenTicketSentTimeLabel({}, 'th'), '−');
});

test('kitchen ticket time falls back to the oldest item before order open time', () => {
  assert.equal(kitchenTicketStartedAt({
    opened_at: '2026-07-30T05:08:00.000Z',
    items: [
      { sent_at: '2026-07-30T05:06:00.000Z' },
      { sent_at: '2026-07-30T05:02:00.000Z' },
    ],
  }), Date.parse('2026-07-30T05:02:00.000Z'));
  assert.equal(kitchenTicketStartedAt({
    opened_at: '2026-07-30T05:08:00.000Z',
    items: [{ sent_at: 'not-a-date' }],
  }), Date.parse('2026-07-30T05:08:00.000Z'));
});

test('mobile SSE parser preserves partial messages and ignores heartbeats', () => {
  const partial = parseServerSentEvents(
    '',
    'id: 7\nevent: orders.changed\ndata: {"order_id":',
  );
  assert.deepEqual(partial.messages, []);

  const complete = parseServerSentEvents(
    partial.buffer,
    '42}\n\n: keepalive\n\nevent: connected\ndata: {}\n\n',
  );
  assert.deepEqual(complete.messages, [
    { id: '7', event: 'orders.changed', data: '{"order_id":42}' },
    { id: undefined, event: 'connected', data: '{}' },
  ]);
  assert.equal(complete.buffer, '');
});

test('mobile kitchen SSE filter refreshes for newly sent orders only after valid parsing', () => {
  const sent = parseOrderChangeEvent({
    event: 'orders.changed',
    data: JSON.stringify({
      type: 'orders.changed',
      action: 'order.sent_to_kitchen',
      order_id: 42,
      occurred_at: '2026-07-30T05:10:00.000Z',
    }),
  });
  assert.ok(sent);
  assert.equal(isKitchenOrderChangeEvent(sent), true);

  const itemAdded = parseOrderChangeEvent({
    event: 'orders.changed',
    data: JSON.stringify({
      type: 'orders.changed',
      action: 'item.added',
      order_id: 42,
      occurred_at: '2026-07-30T05:10:00.000Z',
    }),
  });
  assert.ok(itemAdded);
  assert.equal(isKitchenOrderChangeEvent(itemAdded), false);
  assert.equal(parseOrderChangeEvent({ event: 'connected', data: '{}' }), null);
  assert.equal(parseOrderChangeEvent({ event: 'orders.changed', data: 'not-json' }), null);
});

test('kitchen fulfillment context inherits the order and flags mixed fulfillment', () => {
  assert.deepEqual(kitchenFulfillmentContext('dine_in'), {
    fulfillment: 'dine_in',
    differsFromOrder: false,
  });
  assert.deepEqual(kitchenFulfillmentContext('dine_in', 'takeaway'), {
    fulfillment: 'takeaway',
    differsFromOrder: true,
  });
});

test('kitchen image URLs support backend uploads and absolute media', () => {
  assert.equal(resolveKitchenImageUrl('', 'https://api.example.com'), '');
  assert.equal(
    resolveKitchenImageUrl('/uploads/menu/rice.webp', 'https://api.example.com/'),
    'https://api.example.com/uploads/menu/rice.webp',
  );
  assert.equal(
    resolveKitchenImageUrl('https://cdn.example.com/rice.webp', 'https://api.example.com'),
    'https://cdn.example.com/rice.webp',
  );
});

test('kitchen mutations always reconcile after a partial batch failure', async () => {
  const events = [];
  await assert.rejects(
    runKitchenMutation(
      async () => {
        events.push('updated:1');
        events.push('failed:2');
        throw new Error('second item failed');
      },
      async () => {
        events.push('reconciled');
      },
    ),
    /second item failed/,
  );
  assert.deepEqual(events, ['updated:1', 'failed:2', 'reconciled']);
});

test('kitchen mutations preserve both the partial-batch and queue-refresh failures', async () => {
  const mutationError = new Error('second item failed');
  const reconciliationError = new Error('queue refresh failed');
  let failure;

  try {
    await runKitchenMutation(
      async () => { throw mutationError; },
      async () => { throw reconciliationError; },
    );
  } catch (err) {
    failure = err;
  }

  assert.ok(failure instanceof KitchenMutationError);
  assert.equal(failure.mutationFailed, true);
  assert.equal(failure.reconciliationFailed, true);
  assert.equal(failure.mutationError, mutationError);
  assert.equal(failure.reconciliationError, reconciliationError);
});

test('kitchen mutation gate blocks competing actions until reconciliation releases it', () => {
  const gate = createKitchenMutationGate();
  assert.equal(gate.tryAcquire(), true);
  assert.equal(gate.tryAcquire(), false);
  assert.equal(gate.locked, true);
  gate.release();
  assert.equal(gate.locked, false);
  assert.equal(gate.tryAcquire(), true);
});

test('request generations reject stale list or poll responses after invalidation', () => {
  const requests = createRequestGeneration();
  const stalePoll = requests.begin();

  requests.invalidate();
  const mutationReconcile = requests.begin();

  assert.equal(requests.isCurrent(stalePoll), false);
  assert.equal(requests.isCurrent(mutationReconcile), true);
});

test('quiet polling never supersedes a foreground request', () => {
  assert.equal(shouldStartRequest(true, true), false);
  assert.equal(shouldStartRequest(true, false), true);
  assert.equal(shouldStartRequest(false, true), true);
});

test('a served line comes off the bill by picking a reason, never by typing one', async () => {
  // Each preset has to satisfy the reason the API demands, or the sheet offers
  // a choice that fails on tap.
  assert.ok(SERVED_REMOVAL_REASONS.length >= 3);
  for (const reason of SERVED_REMOVAL_REASONS) {
    assert.ok(reason.key && reason.th && reason.en, reason.key);
    for (const language of ['th', 'en']) {
      const validation = validateKitchenCancelReason(reason[language]);
      assert.equal(validation.error, null, `${reason.key}/${language}`);
      assert.equal(validation.reason, reason[language]);
    }
  }
  assert.equal(new Set(SERVED_REMOVAL_REASONS.map((reason) => reason.key)).size, SERVED_REMOVAL_REASONS.length);

  const bill = await readFile(path.join(mobileRoot, 'app', 'order', 'bill.tsx'), 'utf8');
  // No free-text box, and no full-width button parked under every served row.
  assert.doesNotMatch(bill, /cancelReason/);
  assert.doesNotMatch(bill, /<TextField/);
  assert.match(bill, /<ChoiceSheet/);
  assert.match(bill, /SERVED_REMOVAL_REASONS/);
});

test('a receipt is reprintable only once the order is completed and paid', () => {
  assert.equal(canReprintReceipt({ status: 'completed', payment_status: 'paid' }), true);
  assert.equal(canReprintReceipt({ status: 'completed', payment_status: 'unpaid' }), false);
  assert.equal(canReprintReceipt({ status: 'served', payment_status: 'paid' }), false);
  assert.equal(canReprintReceipt({ status: 'cancelled', payment_status: 'paid' }), false);
  assert.equal(canReprintReceipt({}), false);
  assert.equal(canReprintReceipt({ status: null, payment_status: null }), false);
});
