import type { Permission } from "../types/auth";
import type { Membership } from "../types/restaurant";

export const TEAM_MANAGEMENT_PERMISSIONS = [
  "manage_invites",
  "manage_members",
  "manage_roles",
  "view_audit_log",
] as const satisfies readonly Permission[];

const fallbackRolePermissions: Record<string, Permission[]> = {
  owner: ["*"],
  manager: [
    "view_dashboard",
    "manage_menu",
    "manage_promotions",
    "view_tables",
    "manage_table",
    "take_order",
    "view_orders",
    "take_payment",
    "view_kitchen",
    "update_order_status",
    "view_inventory",
    "manage_inventory",
    "manage_expenses",
    "view_reports",
    "manage_invites",
    "manage_members",
    "manage_roles",
    "view_audit_log",
    "manage_restaurant_settings",
  ],
  cashier: ["take_order", "take_payment", "view_orders", "view_dashboard", "view_kitchen", "view_inventory"],
  waiter: ["take_order", "take_payment", "view_orders", "view_dashboard", "view_kitchen", "view_inventory"],
  chef: ["view_kitchen", "update_order_status", "view_inventory"],
};

const deprecatedPermissions = new Set<Permission>(["view_menu"]);
const legacyStaffCapabilities = new Set<Permission>([
  "manage_invites",
  "manage_members",
  "manage_roles",
  "view_audit_log",
  "manage_restaurant_settings",
]);

function permissionListAllows(permissions: Permission[], roleName: string, permission: Permission) {
  if (permissions.includes("*") || permissions.includes(permission)) return true;
  return (roleName === "owner" || roleName === "manager")
    && permissions.includes("manage_staff")
    && legacyStaffCapabilities.has(permission);
}

export function can(membership: Membership | null | undefined, permission: Permission): boolean {
  if (deprecatedPermissions.has(permission)) {
    return false;
  }

  const memberOverride = membership?.permissions_override;
  if (memberOverride) {
    try {
      const permissions = JSON.parse(memberOverride) as Permission[];
      return permissionListAllows(permissions, membership?.role?.name ?? "", permission);
    } catch {
      return false;
    }
  }

  const rawPermissions = membership?.role?.permissions;
  if (rawPermissions) {
    try {
      const permissions = JSON.parse(rawPermissions) as Permission[];
      return permissionListAllows(permissions, membership?.role?.name ?? "", permission);
    } catch {
      // Fall through to role-name defaults.
    }
  }

  const roleName = membership?.role?.name ?? "";
  const permissions = fallbackRolePermissions[roleName] ?? [];
  return permissionListAllows(permissions, roleName, permission);
}
