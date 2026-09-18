export type InventoryItemAccess = 'denied' | 'read' | 'edit';
export type OrderDetailResource = 'order' | 'menu' | 'categories';
export type OrderListAccess = 'denied' | 'archive';

export const orderRoutePermissions = ['view_orders', 'take_order'] as const;

type OrderListRequestInput = {
  search?: string;
  /** One Bangkok day, YYYY-MM-DD; null or absent for every day. */
  date?: string | null;
  page: number;
  limit: number;
};

/**
 * Either permission opens the same archive, matching the web. Order taking used
 * to get a narrowed live view here instead, but live tables belong on the floor
 * screen; the archive is a record of what was paid.
 */
export function orderListAccess(
  canViewOrders: boolean,
  canTakeOrder: boolean,
): OrderListAccess {
  return canViewOrders || canTakeOrder ? 'archive' : 'denied';
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
