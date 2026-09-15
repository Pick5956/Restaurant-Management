type RequestGeneration = {
  begin(): number;
  invalidate(): void;
  isCurrent(request: number): boolean;
};

type CurrentRoundItem = {
  status?: string;
  quantity?: number;
  subtotal?: number;
};

export type CurrentRoundSummary = {
  quantity: number;
  subtotal: number;
};

export const CURRENT_ROUND_BAR_COLORS = {
  backgroundColor: '#CA3500',
  borderColor: '#9F2D00',
  foregroundColor: '#FFFFFF',
} as const;

export const CURRENT_ROUND_REVEAL_WIDTH = 80;

export type CurrentRoundRowSwipeAxis = 'undecided' | 'horizontal' | 'vertical';

export function lockCurrentRoundRowSwipeAxis(
  axis: CurrentRoundRowSwipeAxis,
  sample: { deltaX: number; deltaY: number },
  isOpen: boolean,
  disabled: boolean,
): CurrentRoundRowSwipeAxis {
  if (axis !== 'undecided') return axis;
  if (disabled || !Number.isFinite(sample.deltaX) || !Number.isFinite(sample.deltaY)) return 'vertical';

  const horizontalDistance = Math.abs(sample.deltaX);
  const verticalDistance = Math.abs(sample.deltaY);
  if (horizontalDistance < 6 && verticalDistance < 6) return 'undecided';
  if (verticalDistance >= 6 && verticalDistance >= horizontalDistance) return 'vertical';

  if (horizontalDistance >= 8 && horizontalDistance > verticalDistance * 1.2) {
    return isOpen || sample.deltaX < 0 ? 'horizontal' : 'vertical';
  }
  return 'undecided';
}

export function shouldStartCurrentRoundRowSwipe(
  sample: { deltaX: number; deltaY: number },
  isOpen: boolean,
  disabled: boolean,
) {
  return lockCurrentRoundRowSwipeAxis('undecided', sample, isOpen, disabled) === 'horizontal';
}

export function clampCurrentRoundRowOffset(
  offset: number,
  revealWidth = CURRENT_ROUND_REVEAL_WIDTH,
) {
  if (!Number.isFinite(offset)) return 0;
  const width = Number.isFinite(revealWidth) && revealWidth > 0
    ? revealWidth
    : CURRENT_ROUND_REVEAL_WIDTH;
  return Math.max(-width, Math.min(0, offset));
}

export function resolveCurrentRoundRowDragOffset({
  startOffset,
  activationDeltaX,
  responderDeltaX,
}: {
  startOffset: number;
  activationDeltaX: number;
  responderDeltaX: number;
}) {
  return clampCurrentRoundRowOffset(startOffset + activationDeltaX + responderDeltaX);
}

export function resolveCurrentRoundRowRelease(
  sample: { offset: number; velocityX: number },
  revealWidth = CURRENT_ROUND_REVEAL_WIDTH,
) {
  const width = Number.isFinite(revealWidth) && revealWidth > 0
    ? revealWidth
    : CURRENT_ROUND_REVEAL_WIDTH;
  const velocityX = Number.isFinite(sample.velocityX) ? sample.velocityX : 0;
  if (velocityX >= 450) return 'closed' as const;
  if (velocityX <= -450) return 'open' as const;
  const offset = clampCurrentRoundRowOffset(sample.offset, width);
  return offset <= -width / 2 ? 'open' as const : 'closed' as const;
}

export function resolveCurrentRoundRowInteraction({
  wasHorizontalDrag,
  isOpen,
}: {
  wasHorizontalDrag: boolean;
  isOpen: boolean;
}) {
  if (wasHorizontalDrag) return 'none' as const;
  return isOpen ? 'close' as const : 'edit' as const;
}

type CurrentRoundOpenEvent = {
  type: 'open' | 'close' | 'deleted';
  itemId: number;
};

export function nextOpenCurrentRoundItemId(
  currentId: number | null,
  event: CurrentRoundOpenEvent,
) {
  if (event.type === 'open') return event.itemId;
  return currentId === event.itemId ? null : currentId;
}

export function selectOrderItemImage(
  item: { menuId: number; menuImageUrl?: string | null },
  catalog: ReadonlyMap<number, string>,
) {
  const embedded = item.menuImageUrl?.trim();
  if (embedded) return embedded;
  const catalogImage = catalog.get(item.menuId)?.trim();
  return catalogImage || null;
}

export function findPendingOrderItem<T extends { ID: number; status?: string }>(
  items: readonly T[] | null | undefined,
  itemId: number,
) {
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  return (items ?? []).find((item) => item.ID === itemId && item.status === 'pending') ?? null;
}

export function summarizeCurrentRound(items: readonly CurrentRoundItem[] | null | undefined): CurrentRoundSummary {
  return (items ?? []).reduce<CurrentRoundSummary>((summary, item) => {
    if (item.status !== 'pending') return summary;

    const quantity = Number(item.quantity);
    const subtotal = Number(item.subtotal);
    return {
      quantity: summary.quantity + (Number.isFinite(quantity) ? quantity : 0),
      subtotal: summary.subtotal + (Number.isFinite(subtotal) ? subtotal : 0),
    };
  }, { quantity: 0, subtotal: 0 });
}

/**
 * How many of each dish sit in the current round, keyed by menu id: the number a
 * menu tile carries, so a waiter sees what is already in the basket without
 * opening it. Pending lines only, like the basket and the web POS tile badge - a
 * dish already with the kitchen is not part of this round.
 */
export function pendingQuantityByMenu(
  items: readonly { menu_id?: number; status?: string; quantity?: number }[] | null | undefined,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const item of items ?? []) {
    if (item.status !== 'pending') continue;
    const menuId = Number(item.menu_id);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(menuId) || menuId <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;
    counts.set(menuId, (counts.get(menuId) ?? 0) + quantity);
  }
  return counts;
}

export function currentRoundPresentation(summary: CurrentRoundSummary, language: 'th' | 'en') {
  const quantity = summary.quantity.toLocaleString(language === 'th' ? 'th-TH' : 'en-US');

  if (language === 'th') {
    return {
      basketLabel: `ตะกร้า · ${quantity} รายการ`,
      openLabel: 'ดูรายการรอบนี้',
      title: 'รายการรอบนี้',
      empty: 'ยังไม่มีรายการรอส่งเข้าครัว',
      totalLabel: 'ยอดรวม',
      sendLabel: 'ส่งเข้าครัว',
      sentMessage: 'ส่งเข้าครัวแล้ว',
    } as const;
  }

  return {
    basketLabel: `Cart · ${quantity} Items`,
    openLabel: 'Review current round',
    title: 'Current round',
    empty: 'No items are waiting to be sent to the kitchen.',
    totalLabel: 'Total',
    sendLabel: 'Send to Kitchen',
    sentMessage: 'Sent to kitchen',
  } as const;
}

export function orderSummaryPresentation(language: 'th' | 'en') {
  return language === 'th'
    ? {
        title: 'สรุปคำสั่งซื้อ',
        empty: 'ยังไม่มีรายการในคำสั่งซื้อนี้',
        totalLabel: 'ยอดรวม',
      } as const
    : {
        title: 'Order summary',
        empty: 'There are no items in this order.',
        totalLabel: 'Total',
      } as const;
}

export function shouldShowCurrentRoundBasket({
  canTakeOrder,
  orderStatus,
  pendingQuantity,
}: {
  canTakeOrder: boolean;
  orderStatus?: string | null;
  pendingQuantity: number;
}) {
  return canTakeOrder
    && Number.isFinite(pendingQuantity)
    && pendingQuantity > 0
    && orderStatus !== 'completed'
    && orderStatus !== 'cancelled';
}

export function createOrderDetailRequestGuard(requests: RequestGeneration) {
  let mutationInFlight = false;

  return {
    beginLoad() {
      return mutationInFlight ? null : requests.begin();
    },
    canApplyLoad(request: number | null) {
      return request !== null
        && !mutationInFlight
        && requests.isCurrent(request);
    },
    beginMutation() {
      if (mutationInFlight) return false;

      mutationInFlight = true;
      requests.invalidate();
      return true;
    },
    finishMutation() {
      requests.invalidate();
      mutationInFlight = false;
    },
    invalidateLoads() {
      requests.invalidate();
    },
  };
}
