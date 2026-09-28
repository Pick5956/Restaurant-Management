import type { Permission } from '@/src/types/auth';
import type { Membership } from '@/src/types/restaurant';

const fallbackRolePermissions: Record<string, Permission[]> = {
  owner: ['*'],
  manager: [
    'view_dashboard',
    'manage_menu',
    'view_tables',
    'manage_table',
    'manage_invites',
    'manage_members',
    'manage_roles',
    'view_audit_log',
    'manage_restaurant_settings',
    'view_inventory',
    'manage_inventory',
    'manage_expenses',
    'view_reports',
    'take_order',
    'take_payment',
    'view_orders',
    'view_kitchen',
    'update_order_status',
  ],
  cashier: ['view_dashboard', 'take_payment', 'view_orders', 'view_tables'],
  waiter: ['take_order', 'take_payment', 'view_orders'],
  chef: ['view_kitchen', 'update_order_status', 'view_inventory'],
};

const legacyManageStaffPermissions = new Set<Permission>([
  'manage_invites',
  'manage_members',
  'manage_roles',
  'view_audit_log',
  'manage_restaurant_settings',
]);

function listCan(
  permissions: readonly Permission[],
  permission: Permission,
  roleName: string,
): boolean {
  if (permissions.includes('*') || permissions.includes(permission)) return true;
  return (roleName === 'owner' || roleName === 'manager')
    && permissions.includes('manage_staff')
    && legacyManageStaffPermissions.has(permission);
}

export function can(membership: Membership | null | undefined, permission: Permission): boolean {
  const roleName = membership?.role?.name ?? '';
  const memberOverride = membership?.permissions_override;
  if (memberOverride != null) {
    try {
      const permissions = JSON.parse(memberOverride) as Permission[];
      return Array.isArray(permissions) && listCan(permissions, permission, roleName);
    } catch {
      return false;
    }
  }

  const rawPermissions = membership?.role?.permissions;
  if (rawPermissions) {
    try {
      const permissions = JSON.parse(rawPermissions) as Permission[];
      return Array.isArray(permissions) && listCan(permissions, permission, roleName);
    } catch {
      // Role fallback keeps the app usable if the backend sends legacy role data.
    }
  }

  const permissions = fallbackRolePermissions[roleName] ?? [];
  return listCan(permissions, permission, roleName);
}
