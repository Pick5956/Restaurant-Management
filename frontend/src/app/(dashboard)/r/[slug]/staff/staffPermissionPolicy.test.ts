import { describe, expect, it } from "vitest";
import type { Membership } from "@/src/types/restaurant";
import { can } from "@/src/lib/rbac";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_SECTIONS,
  applyPermissionDependencies,
  auditMessage,
  replaceGrantablePermissionSelection,
  stripHiddenPermissions,
} from "./staffPageConfig";
import {
  getRoleDialogInteractionPolicy,
  getTeamCapabilities,
  grantablePermissionKeys,
  grantableRoleOptions,
  shouldRefreshMembershipsAfterRoleRename,
} from "./staffPageUtils";

function membership(roleName: string, permissions: string[]): Membership {
  return {
    ID: 1,
    user_id: 1,
    restaurant_id: 1,
    role_id: 1,
    status: "active",
    joined_at: "2026-01-01T00:00:00Z",
    role: {
      ID: 1,
      name: roleName,
      display_name: roleName,
      permissions: JSON.stringify(permissions),
      is_system: roleName === "owner" || roleName === "manager",
    },
  };
}

describe("staff permission catalog", () => {
  it("keeps order taking and payment as separate choices", () => {
    const rows = PERMISSION_SECTIONS.flatMap((section) => section.rows);

    expect(rows.find((row) => row.id === "order-taking")?.permissions).toEqual(["take_order"]);
    expect(rows.find((row) => row.id === "payment")?.permissions).toEqual(["take_payment"]);
  });

  it("exposes the five team capabilities and hides legacy manage_staff", () => {
    expect(ALL_PERMISSION_KEYS).toEqual(expect.arrayContaining([
      "manage_invites",
      "manage_members",
      "manage_roles",
      "view_audit_log",
      "manage_restaurant_settings",
    ]));
    expect(ALL_PERMISSION_KEYS).not.toContain("manage_staff");
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });
});

describe("permission dependency policy", () => {
  it.each([
    ["update_order_status", "view_kitchen"],
    ["take_payment", "view_orders"],
    ["manage_table", "view_tables"],
    ["manage_inventory", "view_inventory"],
  ] as const)("adds %s prerequisite %s", (permission, prerequisite) => {
    expect(applyPermissionDependencies([], permission, true)).toEqual(expect.arrayContaining([permission, prerequisite]));
  });

  it("removes dependent permissions when their prerequisite is denied", () => {
    expect(applyPermissionDependencies(
      ["view_kitchen", "update_order_status", "future_backend_permission"],
      "view_kitchen",
      false,
    )).toEqual(["future_backend_permission"]);
  });
});

describe("legacy and capability compatibility", () => {
  it("maps legacy manage_staff to the new capabilities only for owner or manager roles", () => {
    const legacyManager = membership("manager", ["manage_staff"]);
    const legacyCustomRole = membership("shift_lead", ["manage_staff"]);

    for (const permission of [
      "manage_invites",
      "manage_members",
      "manage_roles",
      "view_audit_log",
      "manage_restaurant_settings",
    ] as const) {
      expect(can(legacyManager, permission)).toBe(true);
      expect(can(legacyCustomRole, permission)).toBe(false);
    }
  });

  it("opens the staff surface for any team capability without over-granting actions", () => {
    const inviteManager = membership("shift_lead", ["manage_invites"]);

    expect(getTeamCapabilities(inviteManager)).toEqual({
      canViewTeam: true,
      canManageInvites: true,
      canManageMembers: false,
      canManageRoles: false,
      canViewAuditLog: false,
    });
  });

  it("limits grantable keys to the current actor's effective permissions", () => {
    const actor = membership("manager", ["manage_roles", "view_orders", "take_payment"]);

    expect(grantablePermissionKeys(actor)).toEqual(["take_payment", "view_orders", "manage_roles"]);
    expect(grantablePermissionKeys(membership("owner", ["*"]))).toEqual(ALL_PERMISSION_KEYS);
  });

  it("does not expose a dependent key when the actor lacks its prerequisite", () => {
    const actor = membership("shift_lead", ["manage_roles", "take_payment"]);

    expect(grantablePermissionKeys(actor)).toEqual(["manage_roles"]);
  });

  it("does not offer roles containing permissions the actor cannot grant", () => {
    const actor = membership("manager", ["manage_roles", "take_order"]);
    const roles = [
      { ID: 2, name: "waiter", display_name: "Waiter", permissions: JSON.stringify(["take_order"]), is_system: true },
      { ID: 3, name: "cashier", display_name: "Cashier", permissions: JSON.stringify(["take_payment", "view_orders"]), is_system: true },
    ];

    expect(grantableRoleOptions(actor, roles).map((role) => role.name)).toEqual(["waiter"]);
  });

  it("applies role dependencies before checking the actor's grant ceiling", () => {
    const actor = membership("shift_lead", ["manage_roles", "take_payment"]);
    const legacyRole = {
      ID: 4,
      name: "legacy_cashier",
      display_name: "Legacy cashier",
      permissions: JSON.stringify(["take_payment"]),
      is_system: false,
    };

    expect(grantableRoleOptions(actor, [legacyRole])).toEqual([]);
  });
});

describe("permission payload preservation", () => {
  it("does not silently remove permission keys unknown to this frontend", () => {
    expect(stripHiddenPermissions([
      "take_order",
      "future_backend_permission",
      "manage_staff",
      "view_menu",
    ])).toEqual(["take_order", "future_backend_permission"]);
  });

  it("keeps unknown and non-grantable permissions while select-all or clear edits grantable keys", () => {
    const current = ["future_backend_permission", "view_reports", "take_order"];
    const grantable = ["take_order", "view_orders"];

    expect(replaceGrantablePermissionSelection(current, grantable, true)).toEqual([
      "future_backend_permission",
      "view_reports",
      "take_order",
      "view_orders",
    ]);
    expect(replaceGrantablePermissionSelection(current, grantable, false)).toEqual([
      "future_backend_permission",
      "view_reports",
    ]);
  });
});

describe("role dialog interaction policy", () => {
  it.each([
    { renamingRole: true, permissionSaving: false, deletingRole: false, permissionClosing: false },
    { renamingRole: false, permissionSaving: true, deletingRole: false, permissionClosing: false },
    { renamingRole: false, permissionSaving: false, deletingRole: true, permissionClosing: false },
    { renamingRole: false, permissionSaving: false, deletingRole: false, permissionClosing: true },
  ])("locks every competing role action while a mutation is active", (busyState) => {
    expect(getRoleDialogInteractionPolicy({
      ...busyState,
      editingRoleName: false,
      roleNameDirty: false,
    })).toEqual({
      busy: true,
      canDismiss: false,
      canDeleteRole: false,
      canEditRoleName: false,
      canSavePermissions: false,
    });
  });

  it("keeps a dirty inline role name open until it is saved or cancelled", () => {
    expect(getRoleDialogInteractionPolicy({
      renamingRole: false,
      permissionSaving: false,
      deletingRole: false,
      permissionClosing: false,
      editingRoleName: true,
      roleNameDirty: true,
    })).toEqual({
      busy: false,
      canDismiss: false,
      canDeleteRole: false,
      canEditRoleName: true,
      canSavePermissions: false,
    });
  });

  it("allows dismissing an unchanged editor but still requires resolving it before other actions", () => {
    expect(getRoleDialogInteractionPolicy({
      renamingRole: false,
      permissionSaving: false,
      deletingRole: false,
      permissionClosing: false,
      editingRoleName: true,
      roleNameDirty: false,
    })).toEqual({
      busy: false,
      canDismiss: true,
      canDeleteRole: false,
      canEditRoleName: true,
      canSavePermissions: false,
    });
  });
});

describe("role rename membership synchronization", () => {
  it("refreshes shared memberships only when the renamed role is active", () => {
    const activeMembership = membership("shift_lead", ["manage_roles"]);
    activeMembership.role_id = 42;

    expect(shouldRefreshMembershipsAfterRoleRename(activeMembership, 42)).toBe(true);
    expect(shouldRefreshMembershipsAfterRoleRename(activeMembership, 7)).toBe(false);
    expect(shouldRefreshMembershipsAfterRoleRename(null, 42)).toBe(false);
  });
});

describe("permission audit labels", () => {
  it("localizes role renames using the backend from_name and to_name contract", () => {
    const log = {
      ID: 1,
      restaurant_id: 1,
      action: "role_renamed",
      details: JSON.stringify({ from_name: "พนักงานเก่า", to_name: "หัวหน้ากะ" }),
    };

    expect(auditMessage(log, "th")).toBe("เปลี่ยนชื่อบทบาท พนักงานเก่า -> หัวหน้ากะ");
    expect(auditMessage(log, "en")).toBe("Renamed role พนักงานเก่า -> หัวหน้ากะ");
  });

  it("localizes role permission changes with the affected role name", () => {
    const log = {
      ID: 2,
      restaurant_id: 1,
      action: "role_permissions_changed",
      details: JSON.stringify({ role_name: "หัวหน้ากะ", from_permissions: [], to_permissions: ["take_order", "view_orders"] }),
    };

    expect(auditMessage(log, "th")).toBe("เปลี่ยนสิทธิ์บทบาท · หัวหน้ากะ · 2 สิทธิ์");
  });
});
