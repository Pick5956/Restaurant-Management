import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_ROUND_BAR_COLORS,
  CURRENT_ROUND_REVEAL_WIDTH,
  clampCurrentRoundRowOffset,
  createOrderDetailRequestGuard,
  currentRoundPresentation,
  findPendingOrderItem,
  lockCurrentRoundRowSwipeAxis,
  nextOpenCurrentRoundItemId,
  orderSummaryPresentation,
  resolveCurrentRoundRowDragOffset,
  resolveCurrentRoundRowInteraction,
  resolveCurrentRoundRowRelease,
  selectOrderItemImage,
  shouldStartCurrentRoundRowSwipe,
  shouldShowCurrentRoundBasket,
  summarizeCurrentRound,
} from './order-detail-runtime.ts';
import { createRequestGeneration } from './request-generation.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('an order mutation keeps its snapshot when an older detail poll finishes later', () => {
  const requests = createOrderDetailRequestGuard(createRequestGeneration());
  const stalePoll = requests.beginLoad();
  let visibleQuantity = 2;

  assert.notEqual(stalePoll, null);
  assert.equal(requests.beginMutation(), true);

  visibleQuantity = 3;
  requests.finishMutation();

  if (requests.canApplyLoad(stalePoll)) {
    visibleQuantity = 2;
  }

  assert.equal(visibleQuantity, 3);
  assert.equal(visibleQuantity + 1, 4);
});

test('detail loads are blocked during mutation and invalidated on focus cleanup', () => {
  const requests = createOrderDetailRequestGuard(createRequestGeneration());

  assert.equal(requests.beginMutation(), true);
  assert.equal(requests.beginMutation(), false);
  assert.equal(requests.beginLoad(), null);

  requests.finishMutation();
  const pendingFocusLoad = requests.beginLoad();
  assert.notEqual(pendingFocusLoad, null);
  assert.equal(requests.canApplyLoad(pendingFocusLoad), true);

  requests.invalidateLoads();

  assert.equal(requests.canApplyLoad(pendingFocusLoad), false);
});

test('the current round totals only pending items', () => {
  assert.deepEqual(summarizeCurrentRound([
    { status: 'pending', quantity: 2, subtotal: 158 },
    { status: 'pending', quantity: 1, subtotal: 65 },
    { status: 'cooking', quantity: 4, subtotal: 200 },
    { status: 'cancelled', quantity: 9, subtotal: 900 },
  ]), {
    quantity: 3,
    subtotal: 223,
  });
});

test('the current round uses the same Thai and English wording as web POS', () => {
  assert.deepEqual(currentRoundPresentation({ quantity: 3, subtotal: 223 }, 'th'), {
    basketLabel: 'ตะกร้า · 3 รายการ',
    openLabel: 'ดูรายการรอบนี้',
    title: 'รายการรอบนี้',
    empty: 'ยังไม่มีรายการรอส่งเข้าครัว',
    totalLabel: 'ยอดรวม',
    sendLabel: 'ส่งเข้าครัว',
    sentMessage: 'ส่งเข้าครัวแล้ว',
  });

  assert.deepEqual(currentRoundPresentation({ quantity: 3, subtotal: 223 }, 'en'), {
    basketLabel: 'Cart · 3 Items',
    openLabel: 'Review current round',
    title: 'Current round',
    empty: 'No items are waiting to be sent to the kitchen.',
    totalLabel: 'Total',
    sendLabel: 'Send to Kitchen',
    sentMessage: 'Sent to kitchen',
  });
});

test('the read-only order summary uses the same title and empty copy as web POS', () => {
  assert.deepEqual(orderSummaryPresentation('th'), {
    title: 'สรุปคำสั่งซื้อ',
    empty: 'ยังไม่มีรายการในคำสั่งซื้อนี้',
    totalLabel: 'ยอดรวม',
  });
  assert.deepEqual(orderSummaryPresentation('en'), {
    title: 'Order summary',
    empty: 'There are no items in this order.',
    totalLabel: 'Total',
  });
});

test('the current-round basket is available only for an editable pending round', () => {
  assert.equal(shouldShowCurrentRoundBasket({ canTakeOrder: true, orderStatus: 'open', pendingQuantity: 1 }), true);
  assert.equal(shouldShowCurrentRoundBasket({ canTakeOrder: true, orderStatus: 'sent_to_kitchen', pendingQuantity: 2 }), true);
  assert.equal(shouldShowCurrentRoundBasket({ canTakeOrder: true, orderStatus: 'open', pendingQuantity: 0 }), false);
  assert.equal(shouldShowCurrentRoundBasket({ canTakeOrder: false, orderStatus: 'open', pendingQuantity: 2 }), false);
  assert.equal(shouldShowCurrentRoundBasket({ canTakeOrder: true, orderStatus: 'completed', pendingQuantity: 2 }), false);
  assert.equal(shouldShowCurrentRoundBasket({ canTakeOrder: true, orderStatus: 'cancelled', pendingQuantity: 2 }), false);
});

test('the native basket colors match the current Tailwind web POS colors', () => {
  assert.deepEqual(CURRENT_ROUND_BAR_COLORS, {
    backgroundColor: '#CA3500',
    borderColor: '#9F2D00',
    foregroundColor: '#FFFFFF',
  });
});

test('current-round swipe locks the first intentional axis for the whole touch', () => {
  let verticalAxis = lockCurrentRoundRowSwipeAxis('undecided', { deltaX: -2, deltaY: 7 }, false, false);
  assert.equal(verticalAxis, 'vertical');
  verticalAxis = lockCurrentRoundRowSwipeAxis(verticalAxis, { deltaX: -40, deltaY: 8 }, false, false);
  assert.equal(verticalAxis, 'vertical');

  let horizontalAxis = lockCurrentRoundRowSwipeAxis('undecided', { deltaX: -9, deltaY: 2 }, false, false);
  assert.equal(horizontalAxis, 'horizontal');
  horizontalAxis = lockCurrentRoundRowSwipeAxis(horizontalAxis, { deltaX: -9, deltaY: 24 }, false, false);
  assert.equal(horizontalAxis, 'horizontal');
});

test('current-round swipe keeps ambiguous, reverse, invalid, and disabled touches out of the row', () => {
  assert.equal(lockCurrentRoundRowSwipeAxis('undecided', { deltaX: -5, deltaY: 5 }, false, false), 'undecided');
  assert.equal(lockCurrentRoundRowSwipeAxis('undecided', { deltaX: 9, deltaY: 2 }, false, false), 'vertical');
  assert.equal(lockCurrentRoundRowSwipeAxis('undecided', { deltaX: 9, deltaY: 2 }, true, false), 'horizontal');
  assert.equal(lockCurrentRoundRowSwipeAxis('undecided', { deltaX: Number.NaN, deltaY: 0 }, false, false), 'vertical');
  assert.equal(lockCurrentRoundRowSwipeAxis('undecided', { deltaX: -20, deltaY: 0 }, false, true), 'vertical');
  assert.equal(shouldStartCurrentRoundRowSwipe({ deltaX: -9, deltaY: 2 }, false, false), true);
});

test('current-round row translation stays inside the delete rail', () => {
  assert.equal(CURRENT_ROUND_REVEAL_WIDTH, 80);
  assert.equal(clampCurrentRoundRowOffset(-20), -20);
  assert.equal(clampCurrentRoundRowOffset(-120), -80);
  assert.equal(clampCurrentRoundRowOffset(20), 0);
  assert.equal(clampCurrentRoundRowOffset(-80 + 24), -56);
  assert.equal(clampCurrentRoundRowOffset(Number.NaN), 0);
});

test('current-round row keeps the activation distance when PanResponder resets dx on grant', () => {
  assert.equal(resolveCurrentRoundRowDragOffset({
    startOffset: 0,
    activationDeltaX: -9,
    responderDeltaX: -1,
  }), -10);
  assert.equal(resolveCurrentRoundRowDragOffset({
    startOffset: -80,
    activationDeltaX: 9,
    responderDeltaX: 1,
  }), -70);
});

test('current-round rows reveal by distance or left flick and close by right flick', () => {
  assert.equal(resolveCurrentRoundRowRelease({ offset: -39.99, velocityX: 0 }), 'closed');
  assert.equal(resolveCurrentRoundRowRelease({ offset: -40, velocityX: 0 }), 'open');
  assert.equal(resolveCurrentRoundRowRelease({ offset: -9, velocityX: -450 }), 'open');
  assert.equal(resolveCurrentRoundRowRelease({ offset: -70, velocityX: 450 }), 'closed');
  assert.equal(resolveCurrentRoundRowRelease({ offset: Number.NaN, velocityX: Number.NaN }), 'closed');
});

test('tap and swipe outcomes never open edit after a horizontal drag', () => {
  assert.equal(resolveCurrentRoundRowInteraction({ wasHorizontalDrag: true, isOpen: false }), 'none');
  assert.equal(resolveCurrentRoundRowInteraction({ wasHorizontalDrag: false, isOpen: true }), 'close');
  assert.equal(resolveCurrentRoundRowInteraction({ wasHorizontalDrag: false, isOpen: false }), 'edit');
});

test('only one current-round delete rail stays open', () => {
  assert.equal(nextOpenCurrentRoundItemId(1, { type: 'open', itemId: 2 }), 2);
  assert.equal(nextOpenCurrentRoundItemId(2, { type: 'close', itemId: 1 }), 2);
  assert.equal(nextOpenCurrentRoundItemId(2, { type: 'close', itemId: 2 }), null);
  assert.equal(nextOpenCurrentRoundItemId(2, { type: 'deleted', itemId: 2 }), null);
  assert.equal(nextOpenCurrentRoundItemId(2, { type: 'deleted', itemId: 3 }), 2);
});

test('current-round images prefer embedded menu media, then the fetched catalog', () => {
  const catalog = new Map([[8, '/uploads/catalog.webp']]);
  assert.equal(selectOrderItemImage({ menuId: 8, menuImageUrl: '/uploads/embedded.webp' }, catalog), '/uploads/embedded.webp');
  assert.equal(selectOrderItemImage({ menuId: 8 }, catalog), '/uploads/catalog.webp');
  assert.equal(selectOrderItemImage({ menuId: 9 }, catalog), null);
});

test('only the requested pending line can open the quantity editor', () => {
  const pending = { ID: 11, status: 'pending', quantity: 1 };
  const cooking = { ID: 12, status: 'cooking', quantity: 1 };
  assert.equal(findPendingOrderItem([pending, cooking], 11), pending);
  assert.equal(findPendingOrderItem([pending, cooking], 12), null);
  assert.equal(findPendingOrderItem([pending, cooking], Number.NaN), null);
});

test('the basket and the header chip open the same summary, and the summary can send the round', async () => {
  const [detailSource, billSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'bill.tsx'), 'utf8'),
  ]);

  // Both controls on the order screen lead to the summary. This is a call-site
  // fact - the routes are strings - so nothing but reading the source catches a
  // fork, and a fork is what this replaced: the chip opened the summary while
  // the basket opened a separate screen listing the same unsent items.
  const basket = detailSource.slice(detailSource.indexOf('<CurrentRoundBasket'));
  assert.match(basket.slice(0, basket.indexOf('/>')), /onPress=\{openOrderSummary\}/);
  const chip = detailSource.slice(detailSource.indexOf('<OrderSummaryAction'));
  assert.match(chip.slice(0, chip.indexOf('/>')), /onPress=\{openOrderSummary\}/);
  assert.match(detailSource, /const openOrderSummary[\s\S]{0,200}pathname: '\/order\/bill'/);

  // Everything the retired basket screen owned has to exist on the summary, or
  // repointing the basket takes a round of orders off the kitchen board:
  // sending it, editing an unsent line, and dropping one without a
  // cancellation reason.
  assert.match(billSource, /sendOrderToKitchen\(orderId\)/);
  assert.match(billSource, /pathname: '\/order\/item'[\s\S]{0,160}itemId: String\(item\.ID\)/);
  assert.match(billSource, /deleteOrderItem\(orderId, item\.ID\)/);
});

test('the swipe-to-delete row keeps its gesture contract, and the summary uses it', async () => {
  const [rowSource, billSource, editorSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'components', 'swipe-to-delete-row.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'bill.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8'),
  ]);

  // The four lines that make the gesture survive a scrolling parent. Lifted
  // out of the retired current-round screen on 2026-09-11; the row is now the
  // only copy, so this is the only place they are guarded.
  assert.match(rowSource, /export function SwipeToDeleteRow\b/);
  assert.match(rowSource, /accessibilityActions=/);
  assert.match(rowSource, /onPanResponderTerminationRequest:\s*\(\)\s*=>\s*false/);
  assert.match(rowSource, /onShouldBlockNativeResponder:\s*\(\)\s*=>\s*true/);
  assert.match(rowSource, /translateX\.stopAnimation\(\(value\)/);

  // Removal on the summary is the swipe and nothing else - no edit mode, no
  // per-row buttons, no inline steppers.
  assert.match(billSource, /<SwipeToDeleteRow\b/);
  assert.doesNotMatch(billSource, /setEditing|\[editing,/);
  assert.doesNotMatch(billSource, /'Edit items'/);

  // The stack's back gesture has to stand down while a rail is open, or the
  // swipe that closes the rail pops the screen instead. Native recogniser, so
  // no amount of responder negotiation in the row can win it.
  assert.match(billSource, /gestureEnabled: openRowId === null/);
  assert.doesNotMatch(billSource, /function QuantityAction\b|<QuantityAction\b/);
  // One item screen for both jobs: it adds a dish and it edits a line already
  // on the order, and an edit has to be able to change the OPTIONS - the
  // quantity-only editor it replaced could not, so a wrong option meant
  // deleting the line and starting again.
  assert.match(editorSource, /const editing = Number\.isInteger\(itemId\)/);
  assert.match(editorSource, /updateOrderItem\(orderId, itemId, \{ quantity, note: note\.trim\(\), selected_option_ids: selectedOptionIds \}\)/);
  assert.match(editorSource, /addOrderItem\(/);
});

test('editable order taking uses routed review surfaces at every width', async () => {
  const detailSource = await readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8');

  assert.doesNotMatch(detailSource, /\bsplitWorkspace\b/);
  assert.doesNotMatch(detailSource, /width:\s*'40%'/);
  // Both review controls open the bill, which is the order summary: the
  // separate /order/summary screen was removed rather than kept as a stop on
  // the way to the same information, and the current-round screen went the
  // same way once the basket started landing on the summary. Which control
  // routes where is asserted in the test above.
  assert.doesNotMatch(detailSource, /\/order\/summary/);
  assert.doesNotMatch(detailSource, /pathname: '\/order\/current-round'/);
  // The footer carries the current-round basket and nothing else. The billing
  // dock that used to sit beside it moved to the bill screen, so a reappearance
  // of `actionDock` here means the bottom bar has crept back over the menu grid.
  assert.match(detailSource, /footer=\{currentRoundBasket\}/);
  assert.doesNotMatch(detailSource, /\bactionDock\b/);
});
