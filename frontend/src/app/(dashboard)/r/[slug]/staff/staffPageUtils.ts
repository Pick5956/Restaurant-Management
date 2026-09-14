import { can } from "@/src/lib/rbac";
import type { Membership } from "@/src/types/restaurant";
import type { Role } from "@/src/types/role";
import { ALL_PERMISSION_KEYS, PERMISSION_DEPENDENCIES, normalizePermissionDependencies, parsePermissions } from "./staffPageConfig";

type RoleDialogInteractionState = {
  renamingRole: boolean;
  permissionSaving: boolean;
  deletingRole: boolean;
  permissionClosing: boolean;
  editingRoleName: boolean;
  roleNameDirty: boolean;
};

export function getRoleDialogInteractionPolicy(state: RoleDialogInteractionState) {
  const busy = state.renamingRole
    || state.permissionSaving
    || state.deletingRole
    || state.permissionClosing;
  const unresolvedRoleName = state.editingRoleName && state.roleNameDirty;

  return {
    busy,
    canDismiss: !busy && !unresolvedRoleName,
    canDeleteRole: !busy && !state.editingRoleName,
    canEditRoleName: !busy,
    canSavePermissions: !busy && !state.editingRoleName,
  };
}

export function shouldRefreshMembershipsAfterRoleRename(
  membership: Membership | null | undefined,
  renamedRoleId: number,
) {
  return membership?.role_id === renamedRoleId;
}

export function getTeamCapabilities(membership: Membership | null | undefined) {
  const capabilities = {
    canManageInvites: can(membership, "manage_invites"),
    canManageMembers: can(membership, "manage_members"),
    canManageRoles: can(membership, "manage_roles"),
    canViewAuditLog: can(membership, "view_audit_log"),
  };
  return {
    canViewTeam: Object.values(capabilities).some(Boolean),
    ...capabilities,
  };
}

export function canManageTeam(membership: Membership | null | undefined) {
  return getTeamCapabilities(membership).canViewTeam;
}

export function grantablePermissionKeys(membership: Membership | null | undefined) {
  return ALL_PERMISSION_KEYS.filter((permission) =>
    can(membership, permission)
    && (PERMISSION_DEPENDENCIES[permission] ?? []).every((required) => can(membership, required)),
  );
}

export function grantableRoleOptions(membership: Membership | null | undefined, roles: Role[] = []) {
  const filteredRoles = allowedRoleOptions(membership?.role?.name, roles);
  if (can(membership, "*")) return filteredRoles;
  const grantable = new Set<string>(grantablePermissionKeys(membership));
  return filteredRoles.filter((role) =>
    normalizePermissionDependencies(parsePermissions(role.permissions, role.name))
      .every((permission) => grantable.has(permission)),
  );
}

export function canManageTarget(actorRole?: string, targetRole?: string, isSelf = false) {
  if (isSelf || !actorRole || !targetRole) return false;
  if (actorRole === "owner") return targetRole !== "owner";
  return targetRole !== "owner" && targetRole !== "manager";
}

export function allowedRoleOptions(actorRole?: string, roles: Role[] = []) {
  return roles.filter((role) => {
    if (role.name === "owner") return false;
    if (actorRole !== "owner" && role.name === "manager") return false;
    return true;
  });
}

export function statusTone(status: string) {
  if (status === "active") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300";
  if (status === "suspended") return "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300";
  return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

export function replaceMember(current: Membership[], nextMember: Membership) {
  return current.map((member) => (member.ID === nextMember.ID ? nextMember : member));
}
