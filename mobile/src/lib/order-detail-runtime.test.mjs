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

test('current-round source uses tap-to-edit and explicit swipe delete without inline steppers', async () => {
  const [roundSource, editorSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', 'current-round.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'current-item.tsx'), 'utf8'),
  ]);

  assert.doesNotMatch(roundSource, /function QuantityAction\b|<QuantityAction\b/);
  assert.doesNotMatch(roundSource, /<Surface\b/);
  assert.match(roundSource, /<FlatList\b/);
  assert.match(roundSource, /directionalLockEnabled/);
  assert.match(roundSource, /function SwipeToDeleteRow\b/);
  assert.match(roundSource, /accessibilityActions=/);
  assert.match(roundSource, /onPanResponderTerminationRequest:\s*\(\)\s*=>\s*false/);
  assert.match(roundSource, /onShouldBlockNativeResponder:\s*\(\)\s*=>\s*true/);
  assert.match(roundSource, /translateX\.stopAnimation\(\(value\)/);
  assert.match(roundSource, /\/order\/current-item/);
  assert.match(editorSource, /updateOrderItem\(/);
  assert.doesNotMatch(editorSource, /addOrderItem\(/);
});

test('current-round list leaves unused tablet space on the app canvas while keeping focused surfaces', async () => {
  const roundSource = await readFile(path.join(mobileRoot, 'app', 'order', 'current-round.tsx'), 'utf8')
    .then((source) => source.replace(/\r\n/g, '\n'));
  const listSectionStart = roundSource.indexOf('<EdgeSection');
  const listSectionEnd = roundSource.indexOf('</EdgeSection>', listSectionStart);
  const rowStart = roundSource.indexOf('function SwipeToDeleteRow(');
  const rowEnd = roundSource.indexOf('function SendCurrentRoundAction(', rowStart);
  const footerStart = roundSource.indexOf('const footer =');
  const footerEnd = roundSource.indexOf('\n  return (', footerStart);

  assert.ok(listSectionStart >= 0 && listSectionEnd > listSectionStart);
  const listSection = roundSource.slice(listSectionStart, listSectionEnd);
  assert.match(listSection, /backgroundColor:\s*'transparent'/);
  assert.match(listSection, /<FlatList\b/);

  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  assert.match(roundSource.slice(rowStart, rowEnd), /backgroundColor:\s*palette\.surface/);
  assert.ok(footerStart >= 0 && footerEnd > footerStart);
  assert.match(roundSource.slice(footerStart, footerEnd), /<ActionDock\b/);
  assert.match(roundSource, /footer=\{footer\}/);
});

test('editable order taking uses routed review surfaces at every width', async () => {
  const detailSource = await readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8');

  assert.doesNotMatch(detailSource, /\bsplitWorkspace\b/);
  assert.doesNotMatch(detailSource, /width:\s*'40%'/);
  // The item count opens the bill, which is now the order summary too: the
  // separate /order/summary screen was removed rather than kept as a stop on
  // the way to the same information.
  assert.match(detailSource, /<OrderSummaryAction\b[\s\S]*?\/order\/bill/);
  assert.doesNotMatch(detailSource, /\/order\/summary/);
  assert.match(detailSource, /<CurrentRoundBasket\b[\s\S]*?\/order\/current-round/);
  // The footer carries the current-round basket and nothing else. The billing
  // dock that used to sit beside it moved to the bill screen, so a reappearance
  // of `actionDock` here means the bottom bar has crept back over the menu grid.
  assert.match(detailSource, /footer=\{currentRoundBasket\}/);
  assert.doesNotMatch(detailSource, /\bactionDock\b/);
});
