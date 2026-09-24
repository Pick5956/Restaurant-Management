export type InventoryItemAccess = 'denied' | 'read' | 'edit';
export type OrderDetailResource = 'order' | 'menu' | 'categories';
export type OrderListAccess = 'denied' | 'archive';

/**
 * The archive needs view_orders. The server's requireOrderListAccess
 * (backend/internal/controller/order.go) lets take_order read the active list
 * only, and the archive asks for paid orders, so a take_order-only member was
 * offered a screen that could only fail. The orders tab and the assistant's
 * /orders entry read this list; the hub counts paid orders on view_orders too.
 */
export const orderRoutePermissions = ['view_orders'] as const;

type OrderListRequestInput = {
  search?: string;
  /** One Bangkok day, YYYY-MM-DD; null or absent for every day. */
  date?: string | null;
  page: number;
  limit: number;
};

/**
 * The archive is a record of what was paid, opened by view_orders alone (see
 * orderRoutePermissions). Live tables belong on the floor screen, which is
 * where take_order works.
 */
export function orderListAccess(canViewOrders: boolean): OrderListAccess {
  return canViewOrders ? 'archive' : 'denied';
}

type Words = { th: string; en: string };

const ARCHIVE_FORBIDDEN: Words = { th: 'บัญชีนี้ไม่มีสิทธิ์ดูคลังออเดอร์', en: 'This account cannot view the order archive.' };
const ARCHIVE_OFFLINE: Words = { th: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่', en: 'Cannot reach the server. Check the connection and try again.' };
const ARCHIVE_SERVER_BUSY: Words = { th: 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง', en: 'The service is having trouble. Try again.' };

/**
 * The line under "โหลดคลังออเดอร์ไม่ได้" when the archive fails to load: the
 * app's words for the failures a person can act on, or nothing, so the title
 * stands alone. Never the server's own message.
 */
export function orderArchiveFailureDetail(err: unknown, language: 'th' | 'en'): string | undefined {
  const source = err && typeof err === 'object' ? err as { message?: unknown; status?: unknown } : {};
  const status = typeof source.status === 'number' && Number.isFinite(source.status) ? source.status : null;
  const message = typeof source.message === 'string' ? source.message.trim().toLowerCase() : '';
  let words: Words | null = null;
  if (status === 403) words = ARCHIVE_FORBIDDEN;
  else if (status !== null && status >= 500) words = ARCHIVE_SERVER_BUSY;
  // React Native's fetch says "Network request failed" and carries no status.
  else if (status === null && (message.includes('network request failed') || message.includes('failed to fetch') || message.includes('network error'))) {
    words = ARCHIVE_OFFLINE;
  }
  return words ? words[language] : undefined;
}

export function orderListRequest(
  access: OrderListAccess,
  input: OrderListRequestInput,
) {
  if (access === 'denied') return null;
  // Paid orders only - a transaction history, not a work queue.
  return {
    payment_status: 'paid' as const,
    search: input.search?.trim() || '',
    ...(input.date ? { date: input.date } : {}),
    page: input.page,
    limit: input.limit,
  };
}

export function orderDetailLoadResources(canTakeOrder: boolean): readonly OrderDetailResource[] {
  return canTakeOrder
    ? ['order', 'menu', 'categories'] as const
    : ['order'] as const;
}

export function tableManagementAccess(canViewTables: boolean, canManageTable: boolean) {
  return {
    canView: canViewTables || canManageTable,
    canMutate: canManageTable,
  };
}

export function inventoryItemAccess(
  editing: boolean,
  canViewInventory: boolean,
  canManageInventory: boolean,
): InventoryItemAccess {
  if (canManageInventory) return 'edit';
  if (editing && canViewInventory) return 'read';
  return 'denied';
}

export function kitchenAccess(canViewKitchen: boolean, canUpdateOrderStatus: boolean) {
  return {
    canView: canViewKitchen,
    canUpdate: canUpdateOrderStatus,
  };
}
