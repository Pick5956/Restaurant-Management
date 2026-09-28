import type { DisplayLanguage } from '@/src/lib/display-preferences';

const permissionDefinitions = [
  {
    title: { th: 'หน้าร้านและการชำระเงิน', en: 'Front of house & payments' },
    rows: [
      { key: 'take_order', label: { th: 'รับออเดอร์', en: 'Take orders' } },
      { key: 'take_payment', label: { th: 'รับชำระเงิน', en: 'Take payments' } },
    ],
  },
  {
    title: { th: 'ครัวและการเสิร์ฟ', en: 'Kitchen & service' },
    rows: [
      { key: 'view_kitchen', label: { th: 'ดูคิวครัว', en: 'View kitchen queue' } },
      { key: 'update_order_status', label: { th: 'อัปเดตสถานะอาหาร', en: 'Update food status' } },
    ],
  },
  {
    title: { th: 'ข้อมูลร้าน', en: 'Restaurant data' },
    rows: [
      { key: 'view_dashboard', label: { th: 'ดูภาพรวมร้าน', en: 'View dashboard' } },
      { key: 'view_orders', label: { th: 'ดูออเดอร์', en: 'View orders' } },
      { key: 'view_tables', label: { th: 'ดูโต๊ะ', en: 'View tables' } },
      { key: 'manage_table', label: { th: 'จัดการโต๊ะ', en: 'Manage tables' } },
      { key: 'manage_menu', label: { th: 'จัดการเมนู', en: 'Manage menu' } },
      { key: 'view_inventory', label: { th: 'ดูคลังวัตถุดิบ', en: 'View inventory' } },
      { key: 'manage_inventory', label: { th: 'จัดการคลังวัตถุดิบ', en: 'Manage inventory' } },
      { key: 'manage_expenses', label: { th: 'จัดการค่าใช้จ่าย', en: 'Manage expenses' } },
      { key: 'view_reports', label: { th: 'ดูรายงาน', en: 'View reports' } },
      { key: 'manage_restaurant_settings', label: { th: 'ตั้งค่าร้านและการคิดเงิน', en: 'Manage restaurant & billing settings' } },
    ],
  },
  {
    title: { th: 'ทีมงานและสิทธิ์', en: 'Team & permissions' },
    rows: [
      { key: 'manage_invites', label: { th: 'สร้างและยกเลิกคำเชิญ', en: 'Manage invitations' } },
      { key: 'manage_members', label: { th: 'จัดการสถานะพนักงาน', en: 'Manage staff status' } },
      { key: 'manage_roles', label: { th: 'จัดการบทบาทและสิทธิ์', en: 'Manage roles & permissions' } },
      { key: 'view_audit_log', label: { th: 'ดูประวัติการจัดการทีม', en: 'View team audit log' } },
    ],
  },
] as const;

const permissionDependencies: Readonly<Record<string, readonly string[]>> = {
  update_order_status: ['view_kitchen'],
  take_payment: ['view_orders'],
  manage_table: ['view_tables'],
  manage_inventory: ['view_inventory'],
};

const legacyProtectedRolePermissions = [
  'manage_restaurant_settings',
  'manage_invites',
  'manage_members',
  'manage_roles',
  'view_audit_log',
] as const;

const hiddenDeprecatedPermissions = new Set(['manage_staff', 'view_menu']);

export function permissionGroupsFor(language: DisplayLanguage = 'th') {
  return permissionDefinitions.map((group) => ({
    title: group.title[language],
    rows: group.rows.map((row) => ({
      key: row.key,
      label: row.label[language],
    })),
  }));
}

export const allPermissions = permissionDefinitions.flatMap((group) => (
  group.rows.map((row) => row.key)
));

export function normalizePermissionSelection(permissions: readonly string[]): string[] {
  const selected = new Set(
    permissions.filter((permission): permission is string => (
      typeof permission === 'string' && permission.length > 0
    )),
  );

  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...selected]) {
      for (const dependency of permissionDependencies[permission] ?? []) {
        if (!selected.has(dependency)) {
          selected.add(dependency);
          changed = true;
        }
      }
    }
  }

  const known = (allPermissions as readonly string[])
    .filter((permission) => selected.has(permission));
  const unknown = permissions.filter((permission, index) => (
    !(allPermissions as readonly string[]).includes(permission)
    && permissions.indexOf(permission) === index
  ));
  return [...known, ...unknown];
}

export function togglePermissionSelection(
  permissions: readonly string[],
  permission: string,
): string[] {
  const selected = new Set(normalizePermissionSelection(permissions));
  if (!selected.has(permission)) {
    return normalizePermissionSelection([...selected, permission]);
  }

  selected.delete(permission);
  let changed = true;
  while (changed) {
    changed = false;
    for (const selectedPermission of [...selected]) {
      const missingDependency = (permissionDependencies[selectedPermission] ?? [])
        .some((dependency) => !selected.has(dependency));
      if (missingDependency) {
        selected.delete(selectedPermission);
        changed = true;
      }
    }
  }
  return normalizePermissionSelection([...selected]);
}

export function permissionCanBeGranted(
  permission: string,
  grantablePermissions: Iterable<string>,
): boolean {
  const grantable = new Set(grantablePermissions);
  return normalizePermissionSelection([permission])
    .every((requiredPermission) => grantable.has(requiredPermission));
}

export function shouldUpdateMemberPermissions(input: {
  roleChanged: boolean;
  previousUsesRolePermissions: boolean;
  useRolePermissions: boolean;
  previousPermissions: readonly string[];
  selectedPermissions: readonly string[];
}): boolean {
  if (input.roleChanged) return !input.useRolePermissions;
  if (input.previousUsesRolePermissions !== input.useRolePermissions) return true;
  if (input.useRolePermissions) return false;

  const previous = new Set(normalizePermissionSelection(input.previousPermissions));
  const selected = new Set(normalizePermissionSelection(input.selectedPermissions));
  return previous.size !== selected.size
    || [...previous].some((permission) => !selected.has(permission));
}

export function parsePermissions(value?: string | null) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item !== '*') : []; } catch { return []; } }

export function parsePermissionsForRole(
  value?: string | null,
  roleName?: string | null,
): string[] {
  const parsed = parsePermissions(value);
  if (
    (roleName === 'owner' || roleName === 'manager')
    && parsed.includes('manage_staff')
  ) {
    return normalizePermissionSelection([
      ...parsed.filter((permission) => !hiddenDeprecatedPermissions.has(permission)),
      ...legacyProtectedRolePermissions,
    ]);
  }
  return parsed.filter((permission) => !hiddenDeprecatedPermissions.has(permission));
}
