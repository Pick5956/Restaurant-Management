"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { createRole, deleteRole, getRoles, updateRole, updateRolePermissions } from "@/src/lib/auth";
import { createInvitation, listAllInvitations, revokeInvitation } from "@/src/lib/invitation";
import InvitationLinks from "./InvitationLinks";
import AuditHistoryDialog from "./AuditTimeline";
import { listAuditLogs, listMembers, updateMemberPermissions, updateMemberRole, updateMemberStatus } from "@/src/lib/restaurant";
import { apiFailureText } from "@/src/lib/apiFailure";
import { memberRoleUnavailable } from "@/src/lib/knownApiErrors";
import type { Invitation, Membership, MembershipStatus, RestaurantAuditLog } from "@/src/types/restaurant";
import type { Role } from "@/src/types/role";
import type { Permission } from "@/src/types/auth";
import { RestaurantCardSkeleton } from "@/src/components/shared/Skeleton";
import { createSingleFlight } from "@/src/lib/singleFlight";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import { useConfirm, useToast } from "@/src/components/shared/FeedbackProvider";
import UserAvatar from "@/src/components/shared/UserAvatar";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { ChevronRight, History, Pencil, Plus, RotateCcw, X } from "lucide-react";
import {
  PERMISSION_DEPENDENCIES,
  PERMISSION_SECTIONS,
  applyPermissionDependencies,
  STATUS_LABELS,
  displayUserName,
  effectiveMemberPermissions,
  formatDate,
  inviteMailto,
  inviteUrl,
  memberPermissionSummary,
  parsePermissions,
  permissionSummary,
  roleLabel,
  replaceGrantablePermissionSelection,
  stripHiddenPermissions,
  type PermissionTarget,
} from "./staffPageConfig";
import {
  canManageTarget,
  getRoleDialogInteractionPolicy,
  getTeamCapabilities,
  grantablePermissionKeys,
  grantableRoleOptions,
  replaceMember,
  shouldRefreshMembershipsAfterRoleRename,
  statusTone,
} from "./staffPageUtils";

const AUDIT_PAGE_SIZE = 20;

export default function StaffPage() {
  const { activeMembership, refreshMemberships, user } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const restaurantId = activeMembership?.restaurant_id;
  const activeRole = activeMembership?.role?.name;
  const {
    canViewTeam: allowed,
    canManageInvites,
    canManageMembers,
    canManageRoles,
    canViewAuditLog,
  } = getTeamCapabilities(activeMembership);
  const grantablePermissions = useMemo(() => grantablePermissionKeys(activeMembership), [activeMembership]);
  const grantablePermissionSet = useMemo(() => new Set<string>(grantablePermissions), [grantablePermissions]);
  const visiblePermissionSections = useMemo(() => PERMISSION_SECTIONS
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => row.permissions.every((permission) =>
        grantablePermissionSet.has(permission)
        && (PERMISSION_DEPENDENCIES[permission] ?? []).every((required) => grantablePermissionSet.has(required)),
      )),
    }))
    .filter((section) => section.rows.length > 0), [grantablePermissionSet]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [auditLogs, setAuditLogs] = useState<RestaurantAuditLog[]>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditLoadingMore, setAuditLoadingMore] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState<number | "">("");
  const [newRoleName, setNewRoleName] = useState("");
  const [roleActionIds, setRoleActionIds] = useState<number[]>([]);
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleRenameDraft, setRoleRenameDraft] = useState("");
  const [roleRenameError, setRoleRenameError] = useState("");
  const [renamingRole, setRenamingRole] = useState(false);
  const [editingRoleName, setEditingRoleName] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState("");
  const [error, setError] = useState("");
  const createOnceRef = useRef(createSingleFlight());
  const revokeLocksRef = useRef<Set<number>>(new Set());
  const memberLocksRef = useRef<Set<number>>(new Set());
  const [revokingIds, setRevokingIds] = useState<number[]>([]);
  const [updatingMemberIds, setUpdatingMemberIds] = useState<number[]>([]);
  const [permissionTarget, setPermissionTarget] = useState<PermissionTarget | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<string[]>([]);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [useRolePermissions, setUseRolePermissions] = useState(false);
  const [permissionClosing, setPermissionClosing] = useState(false);
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [roleManagerClosing, setRoleManagerClosing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyClosing, setHistoryClosing] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteModalClosing, setInviteModalClosing] = useState(false);

  const copy = language === "th"
    ? {
        eyebrow: "Team management",
        title: "พนักงานและคำเชิญ",
        subtitle: "จัดการสมาชิกในร้าน สร้างคำเชิญ และดูประวัติการเปลี่ยนแปลงของทีม",
        loadError: "โหลดข้อมูลทีมไม่สำเร็จ",
        createError: "สร้างคำเชิญไม่สำเร็จ",
        copyError: "คัดลอกลิงก์ไม่ได้",
        revokeError: "ยกเลิกคำเชิญไม่สำเร็จ",
        memberError: "อัปเดตข้อมูลสมาชิกไม่สำเร็จ",
        roleUnavailable: "บทบาทเดิมของพนักงานคนนี้ถูกลบแล้ว เชิญเข้าร้านใหม่อีกครั้ง",
        inviteCreated: "สร้างลิงก์เชิญแล้ว",
        inviteCopied: "คัดลอกลิงก์ไปยังคลิปบอร์ดแล้ว",
        inviteRevoked: "ยกเลิกคำเชิญแล้ว",
        memberUpdated: "อัปเดตข้อมูลพนักงานแล้ว",
        roleCreated: "สร้างบทบาทแล้ว",
        roleUpdated: "อัปเดตบทบาทแล้ว",
        roleDeleted: "ลบบทบาทแล้ว",
        roleError: "จัดการบทบาทไม่สำเร็จ",
        roleRequired: "กรอกชื่อบทบาทก่อน",
        rolePanelTitle: "บทบาทที่จัดการได้",
        roleManagerTitle: "จัดการบทบาทและสิทธิ์",
        roleManagerHint: "เพิ่มบทบาท แก้ชื่อบทบาทที่ร้านใช้ และกำหนดชุดสิทธิ์ให้แต่ละบทบาท",
        customRoleTitle: "สร้างบทบาทใหม่",
        roleNameLabel: "ชื่อบทบาท",
        roleNamePlaceholder: "เช่น หัวหน้ากะ",
        editRoleName: "แก้ชื่อบทบาท",
        createRole: "เพิ่มบทบาท",
        creatingRole: "กำลังเพิ่ม...",
        editPermissions: "สิทธิ์",
        deleteRole: "ลบ",
        customRoleBadge: "ปรับแต่ง",
        systemRoleBadge: "ระบบ",
        confirmRoleDeleteTitle: "ลบบทบาทนี้?",
        confirmRoleDeleteBody: "ลบได้เฉพาะบทบาทที่ไม่มีพนักงานหรือคำเชิญรอรับใช้งานอยู่ บทบาทที่ลบแล้วจะหายจากร้านนี้ด้วย",
        confirmRevokeTitle: "ยกเลิกคำเชิญนี้?",
        confirmRevokeBody: "ลิงก์นี้จะใช้งานไม่ได้ทันที และพนักงานต้องขอลิงก์ใหม่หากยังต้องเข้าร่วมร้าน",
        confirmMemberTitle: "ยืนยันการเปลี่ยนแปลงพนักงาน?",
        confirmMemberBody: "การเปลี่ยนบทบาทหรือสถานะจะมีผลกับสิทธิ์การใช้งานของพนักงานทันที",
        confirmRoleChangeBody: "การเปลี่ยนบทบาทจะล้างสิทธิ์ที่กำหนดเฉพาะคน แล้วกลับไปใช้สิทธิ์ของบทบาทใหม่ทันที",
        confirmAction: "ยืนยัน",
        cancelAction: "กลับไปก่อน",
        cancelRevokeAction: "ไม่ยกเลิก",
        noPermissionTitle: "บัญชีนี้ไม่มีสิทธิ์เข้าถึงการจัดการทีม",
        noPermissionBody: "ผู้ดูแลที่มีสิทธิ์สูงกว่าสามารถเปิดสิทธิ์คำเชิญ สมาชิก บทบาท หรือประวัติการเปลี่ยนแปลงให้บัญชีนี้ได้",
        membersTitle: "สมาชิกในร้าน",
        memberCount: (n: number) => `${n} คน`,
        manageRoles: "จัดการบทบาท",
        history: "ประวัติทีม",
        name: "ชื่อ",
        role: "บทบาท",
        permission: "สิทธิ์",
        joined: "เข้าร่วม",
        status: "สถานะ",
        actions: "จัดการ",
        restore: "กู้คืน",
        suspend: "ระงับ",
        remove: "นำออก",
        yourAccount: "บัญชีของคุณ",
        noMembers: "ยังไม่มีสมาชิกในร้านนี้",
        pendingTitle: "คำเชิญที่รอรับ",
        copy: "คัดลอก",
        revoke: "ยกเลิก",
        auditDenied: "บัญชีนี้ยังไม่มีสิทธิ์ดูประวัติการเปลี่ยนแปลงทีม",
        inviteTitle: "เพิ่มพนักงาน",
        expiry: "วันหมดอายุ",
        day: "วัน",
        noExpiry: "ไม่หมดอายุ",
        creating: "กำลังสร้างคำเชิญ...",
        createLink: "สร้างลิงก์เชิญ",
      }
    : {
        eyebrow: "Team management",
        title: "Staff and invitations",
        subtitle: "Manage restaurant members, create invitations, and review team activity history.",
        loadError: "Could not load team data.",
        createError: "Could not create invitation.",
        copyError: "Could not copy invitation link.",
        revokeError: "Could not revoke invitation.",
        memberError: "Could not update member details.",
        roleUnavailable: "This member's role has been deleted. Invite them to the restaurant again.",
        inviteCreated: "Invitation link created",
        inviteCopied: "Invitation link copied to clipboard",
        inviteRevoked: "Invitation revoked",
        memberUpdated: "Staff details updated",
        roleCreated: "Role created",
        roleUpdated: "Role updated",
        roleDeleted: "Role deleted",
        roleError: "Could not manage role.",
        roleRequired: "Enter a role name first.",
        rolePanelTitle: "Roles you can manage",
        roleManagerTitle: "Manage roles and permissions",
        roleManagerHint: "Add roles, rename the roles used by this restaurant, and set each role's default permissions.",
        customRoleTitle: "Create new role",
        roleNameLabel: "Role name",
        roleNamePlaceholder: "e.g. Shift lead",
        editRoleName: "Edit role name",
        createRole: "Add role",
        creatingRole: "Adding...",
        editPermissions: "Permissions",
        deleteRole: "Delete",
        customRoleBadge: "Editable",
        systemRoleBadge: "Default",
        confirmRoleDeleteTitle: "Delete this role?",
        confirmRoleDeleteBody: "Only roles with no assigned staff or pending invitations can be deleted. Default roles will also be removed from this restaurant.",
        confirmRevokeTitle: "Revoke this invitation?",
        confirmRevokeBody: "This link will stop working immediately. The staff member will need a new link to join.",
        confirmMemberTitle: "Confirm staff change?",
        confirmMemberBody: "Role or status changes apply to this staff member's access immediately.",
        confirmRoleChangeBody: "Changing the role clears this staff member's custom permissions and immediately applies the new role defaults.",
        confirmAction: "Confirm",
        cancelAction: "Cancel",
        cancelRevokeAction: "Keep invitation",
        noPermissionTitle: "This account cannot access team management.",
        noPermissionBody: "A higher-privileged administrator can grant invitation, member, role, or audit-log access to this account.",
        membersTitle: "Restaurant members",
        memberCount: (n: number) => `${n} ${n === 1 ? "person" : "people"}`,
        manageRoles: "Manage roles",
        history: "Team history",
        name: "Name",
        role: "Role",
        permission: "Permissions",
        joined: "Joined",
        status: "Status",
        actions: "Actions",
        restore: "Restore",
        suspend: "Suspend",
        remove: "Remove",
        yourAccount: "Your account",
        noMembers: "No members in this restaurant yet.",
        pendingTitle: "Pending invitations",
        copy: "Copy",
        revoke: "Revoke",
        auditDenied: "This account does not have permission to view the team audit log.",
        inviteTitle: "Invite staff",
        expiry: "Expiry",
        day: "day",
        noExpiry: "No expiry",
        creating: "Creating invitation...",
        createLink: "Create invitation link",
      };

  const manageableRoles = useMemo(() => grantableRoleOptions(activeMembership, roles), [activeMembership, roles]);
  const inviteRoles = manageableRoles;
  const roleNameDirty = permissionTarget?.type === "role"
    && editingRoleName
    && roleRenameDraft.trim() !== roleLabel(permissionTarget.role, language);
  const deletingPermissionRole = permissionTarget?.type === "role"
    && roleActionIds.includes(permissionTarget.role.ID);
  const roleDialogPolicy = getRoleDialogInteractionPolicy({
    renamingRole,
    permissionSaving,
    deletingRole: deletingPermissionRole,
    permissionClosing,
    editingRoleName: permissionTarget?.type === "role" && editingRoleName,
    roleNameDirty,
  });
  const roleRenameErrorId = permissionTarget?.type === "role"
    ? `role-name-error-${permissionTarget.role.ID}`
    : undefined;

  useEffect(() => {
    if (!canManageInvites) return;
    if (roleId && inviteRoles.some((role) => role.ID === roleId)) return;
    const nextDefault = inviteRoles.find((role) => role.name === "waiter") ?? inviteRoles[0];
    setRoleId(nextDefault?.ID ?? "");
  }, [canManageInvites, inviteRoles, roleId]);

  const refresh = async () => {
    if (!restaurantId) return;
    setLoading(true);
    setError("");
    if (!allowed) {
      setMembers([]);
      setRoles([]);
      setInvitations([]);
      setAuditLogs([]);
      setAuditHasMore(false);
      setLoading(false);
      return;
    }
    try {
      const [membersRes, rolesRes, invitationsRes, logsRes] = await Promise.all([
        listMembers(restaurantId),
        getRoles(),
        canManageInvites ? listAllInvitations(restaurantId) : Promise.resolve({ data: { invitations: [] } }),
        canViewAuditLog ? listAuditLogs(restaurantId, AUDIT_PAGE_SIZE) : Promise.resolve({ data: { logs: [], has_more: false } }),
      ]);

      const roleList = (rolesRes?.data?.data ?? []) as Role[];
      const nextInviteRoles = grantableRoleOptions(activeMembership, roleList);
      setMembers(membersRes.data.members ?? []);
      setInvitations(invitationsRes.data.invitations ?? []);
      setAuditLogs(logsRes.data.logs ?? []);
      setAuditHasMore(Boolean(logsRes.data.has_more));
      setRoles(roleList);
      if (canManageInvites && !roleId) {
        const nextDefault = nextInviteRoles.find((role) => role.name === "waiter") ?? nextInviteRoles[0];
        if (nextDefault) setRoleId(nextDefault.ID);
      }
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(loadTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, allowed, canManageInvites, canViewAuditLog, language]);

  const loadMoreAuditLogs = async () => {
    if (!restaurantId || !canViewAuditLog || auditLoadingMore || !auditHasMore) return false;
    setAuditLoadingMore(true);
    setError("");
    try {
      const res = await listAuditLogs(restaurantId, AUDIT_PAGE_SIZE, auditLogs.length);
      const nextLogs = res.data.logs ?? [];
      setAuditLogs((current) => {
        const seen = new Set(current.map((log) => log.ID));
        return [...current, ...nextLogs.filter((log) => !seen.has(log.ID))];
      });
      setAuditHasMore(Boolean(res.data.has_more));
      return nextLogs.length > 0;
    } catch {
      setError(copy.loadError);
      return false;
    } finally {
      setAuditLoadingMore(false);
    }
  };

  const openHistory = () => {
    setHistoryClosing(false);
    setHistoryOpen(true);
  };

  const closeHistory = () => {
    if (historyClosing) return;
    setHistoryClosing(true);
    window.setTimeout(() => {
      setHistoryOpen(false);
      setHistoryClosing(false);
    }, 180);
  };

  const openInviteModal = () => {
    if (!canManageInvites) return;
    setInviteModalClosing(false);
    setInviteModalOpen(true);
  };

  const closeInviteModal = (force = false) => {
    if (!force && (inviteModalClosing || submitting)) return;
    setInviteModalClosing(true);
    window.setTimeout(() => {
      setInviteModalOpen(false);
      setInviteModalClosing(false);
    }, 180);
  };

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!restaurantId || !canManageInvites || !roleId) return;

    // Invitations are plain links now: the owner took the staff email field out
    // (29 ก.ย. 2569), so a link is never tied to one account from here.
    await createOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      try {
        const days = Number.parseInt(expiresInDays, 10);
        const res = await createInvitation(restaurantId, {
          role_id: Number(roleId),
          expires_in_days: Number.isFinite(days) ? days : 0,
        });
        const createdInvitation = res.data;
        setInvitations((current) => [createdInvitation, ...current]);
        try {
          await navigator.clipboard.writeText(inviteUrl(createdInvitation.token));
          setCopiedToken(createdInvitation.token);
          showToast({ title: copy.inviteCopied });
        } catch {
          setCopiedToken("");
          setError(copy.copyError);
          showToast({ title: copy.inviteCreated });
        }
        closeInviteModal(true);
        await refresh();
      } catch {
        showToast({ title: copy.createError });
      } finally {
        setSubmitting(false);
      }
    });
  };

  const copyInvite = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopiedToken(token);
      showToast({ title: copy.inviteCopied });
    } catch {
      setError(copy.copyError);
    }
  };

  const sendInviteEmail = (invitation: Invitation) => {
    if (!invitation.email) return;
    window.location.href = inviteMailto(invitation, language);
  };

  const revokeInvite = async (invitationId: number) => {
    if (!restaurantId || !canManageInvites || revokeLocksRef.current.has(invitationId)) return;
    const confirmed = await confirm({
      title: copy.confirmRevokeTitle,
      message: copy.confirmRevokeBody,
      confirmLabel: copy.revoke,
      cancelLabel: copy.cancelRevokeAction,
      tone: "danger",
    });
    if (!confirmed) return;
    revokeLocksRef.current.add(invitationId);
    setRevokingIds((current) => [...current, invitationId]);
    setError("");
    try {
      await revokeInvitation(restaurantId, invitationId);
      // The link stays in the list, marked revoked, until the refresh below.
      setInvitations((current) => current.map((item) => item.ID === invitationId ? { ...item, status: "revoked" } : item));
      showToast({ title: copy.inviteRevoked });
      await refresh();
    } catch {
      setError(copy.revokeError);
    } finally {
      revokeLocksRef.current.delete(invitationId);
      setRevokingIds((current) => current.filter((id) => id !== invitationId));
    }
  };

  const memberFailureText = (err: unknown) => apiFailureText(err, language, copy.memberError);

  const withMemberLock = async (
    memberId: number,
    action: () => Promise<void>,
    failureText: (err: unknown) => string = memberFailureText,
  ) => {
    if (memberLocksRef.current.has(memberId)) return;
    memberLocksRef.current.add(memberId);
    setUpdatingMemberIds((current) => [...current, memberId]);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(failureText(err));
    } finally {
      memberLocksRef.current.delete(memberId);
      setUpdatingMemberIds((current) => current.filter((id) => id !== memberId));
    }
  };

  const withRoleAction = async (roleKey: number, action: () => Promise<void>) => {
    if (roleActionIds.includes(roleKey)) return;
    setRoleActionIds((current) => [...current, roleKey]);
    setError("");
    try {
      await action();
    } catch {
      setError(copy.roleError);
    } finally {
      setRoleActionIds((current) => current.filter((id) => id !== roleKey));
    }
  };

  const createCustomRole = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageRoles || creatingRole) return;
    const displayName = newRoleName.trim();
    if (!displayName) {
      setError(copy.roleRequired);
      return;
    }
    setCreatingRole(true);
    setError("");
    try {
      const res = await createRole({ display_name: displayName, permissions: [] });
      const nextRole = res.data.role;
      setRoles((current) => [...current, nextRole]);
      setRoleId(nextRole.ID);
      setNewRoleName("");
      showToast({ title: copy.roleCreated });
      openRolePermissions(nextRole);
      await refresh();
    } catch {
      setError(copy.roleError);
    } finally {
      setCreatingRole(false);
    }
  };

  const removeRole = async (role: Role) => {
    if (!canManageRoles || !roleDialogPolicy.canDeleteRole) return;
    const confirmed = await confirm({
      title: copy.confirmRoleDeleteTitle,
      message: copy.confirmRoleDeleteBody,
      confirmLabel: copy.deleteRole,
      cancelLabel: copy.cancelAction,
      tone: "danger",
    });
    if (!confirmed) return;
    await withRoleAction(role.ID, async () => {
      await deleteRole(role.ID);
      setRoles((current) => current.filter((item) => item.ID !== role.ID));
      setPermissionTarget((current) => current?.type === "role" && current.role.ID === role.ID ? null : current);
      if (roleId === role.ID) {
        const nextRole = inviteRoles.find((item) => item.ID !== role.ID);
        setRoleId(nextRole?.ID ?? "");
      }
      if (permissionTarget?.type === "role" && permissionTarget.role.ID === role.ID) {
        closePermissionModal(true);
      }
      showToast({ title: copy.roleDeleted });
      await refresh();
    });
  };

  const renameRole = async () => {
    if (
      !canManageRoles
      || permissionTarget?.type !== "role"
      || !editingRoleName
      || !roleDialogPolicy.canEditRoleName
    ) return;
    const displayName = roleRenameDraft.trim();
    if (!displayName) {
      setRoleRenameError(copy.roleRequired);
      return;
    }
    if (displayName === roleLabel(permissionTarget.role, language)) {
      setRoleRenameError("");
      setEditingRoleName(false);
      return;
    }
    setRenamingRole(true);
    setRoleRenameError("");
    try {
      const res = await updateRole(permissionTarget.role.ID, { display_name: displayName });
      const nextRole = res.data.role;
      setRoles((current) => current.map((role) => role.ID === nextRole.ID ? nextRole : role));
      setMembers((current) => current.map((member) => member.role_id === nextRole.ID ? { ...member, role: nextRole } : member));
      setPermissionTarget({ type: "role", role: nextRole });
      setRoleRenameDraft(roleLabel(nextRole, language));
      setRoleRenameError("");
      setEditingRoleName(false);
      showToast({ title: copy.roleUpdated });
      if (shouldRefreshMembershipsAfterRoleRename(activeMembership, nextRole.ID)) {
        void refreshMemberships();
      }
      await refresh();
    } catch {
      setRoleRenameError(copy.roleError);
    } finally {
      setRenamingRole(false);
    }
  };

  const changeMemberStatus = async (memberId: number, status: MembershipStatus) => {
    if (!restaurantId || !canManageMembers) return;
    const confirmed = await confirm({
      title: copy.confirmMemberTitle,
      message: copy.confirmMemberBody,
      confirmLabel: copy.confirmAction,
      cancelLabel: copy.cancelAction,
      tone: status === "removed" ? "danger" : "warning",
    });
    if (!confirmed) return;
    await withMemberLock(memberId, async () => {
      const res = await updateMemberStatus(restaurantId, memberId, status);
      setMembers((current) => replaceMember(current, res.data.member));
      showToast({ title: copy.memberUpdated });
      await refresh();
    }, (err) => (
      // A removed member whose role was deleted meanwhile rejoins through a
      // new invitation, which gives them a role the restaurant still has.
      memberRoleUnavailable(err) ? copy.roleUnavailable : memberFailureText(err)
    ));
  };

  const changeMemberRole = async (memberId: number, nextRoleId: string) => {
    if (!restaurantId || !canManageRoles) return;
    const parsed = Number.parseInt(nextRoleId, 10);
    if (!Number.isFinite(parsed)) return;
    const confirmed = await confirm({
      title: copy.confirmMemberTitle,
      message: copy.confirmRoleChangeBody,
      confirmLabel: copy.confirmAction,
      cancelLabel: copy.cancelAction,
      tone: "warning",
    });
    if (!confirmed) return;
    await withMemberLock(memberId, async () => {
      const res = await updateMemberRole(restaurantId, memberId, parsed);
      setMembers((current) => replaceMember(current, res.data.member));
      showToast({ title: copy.memberUpdated });
      await refresh();
    });
  };

  const openRolePermissions = (role: Role) => {
    if (!canManageRoles) return;
    setPermissionClosing(false);
    setPermissionTarget({ type: "role", role });
    setPermissionDraft(parsePermissions(role.permissions, role.name));
    setRoleRenameDraft(roleLabel(role, language));
    setRoleRenameError("");
    setEditingRoleName(false);
    setUseRolePermissions(false);
  };

  const openMemberPermissions = (member: Membership) => {
    if (!canManageRoles) return;
    setPermissionClosing(false);
    setPermissionTarget({ type: "member", member });
    setPermissionDraft(effectiveMemberPermissions(member));
    setUseRolePermissions(member.permissions_override == null);
    setRoleRenameError("");
    setEditingRoleName(false);
  };

  const closePermissionModal = (force = false) => {
    if (!force && !roleDialogPolicy.canDismiss) return;
    setPermissionClosing(true);
    window.setTimeout(() => {
      setPermissionTarget(null);
      setPermissionClosing(false);
      setRoleRenameError("");
      setEditingRoleName(false);
    }, 180);
  };

  const openRoleManager = () => {
    if (!canManageRoles) return;
    setRoleManagerClosing(false);
    setRoleManagerOpen(true);
  };

  const closeRoleManager = (force = false) => {
    if (!force && (roleManagerClosing || creatingRole)) return;
    setRoleManagerClosing(true);
    window.setTimeout(() => {
      setRoleManagerOpen(false);
      setRoleManagerClosing(false);
    }, 180);
  };

  const setPermissionRow = (permissions: Permission[], enabled: boolean) => {
    // Any edit makes a member's permissions their own, even right after a reset.
    setUseRolePermissions(false);
    setPermissionDraft((current) => {
      let next = current;
      permissions.forEach((permission) => {
        next = applyPermissionDependencies(next, permission, enabled);
      });
      return next;
    });
  };

  const savePermissions = async () => {
    if (
      !permissionTarget
      || !restaurantId
      || !canManageRoles
      || permissionSaving
      || permissionClosing
      || (permissionTarget.type === "role" && !roleDialogPolicy.canSavePermissions)
    ) return;
    const hasOutOfScopePermissions = permissionDraft.some((permission) => !grantablePermissionSet.has(permission));
    if (hasOutOfScopePermissions && !(permissionTarget.type === "member" && useRolePermissions)) {
      setError(language === "th"
        ? "บันทึกไม่ได้ เพราะรายการนี้มีสิทธิ์ที่บัญชีของคุณมอบไม่ได้ ต้องให้ผู้มีสิทธิ์สูงกว่าเป็นผู้แก้ไข"
        : "This item contains permissions outside your grant scope. Ask a higher-privileged account to edit it.");
      return;
    }
    setPermissionSaving(true);
    setError("");
    try {
      const permissionsPayload = stripHiddenPermissions(permissionDraft);
      if (permissionTarget.type === "role") {
        const res = await updateRolePermissions(permissionTarget.role.ID, permissionsPayload);
        setRoles((current) => current.map((role) => role.ID === res.data.role.ID ? res.data.role : role));
        setMembers((current) => current.map((member) => member.role_id === res.data.role.ID ? { ...member, role: res.data.role } : member));
      } else {
        const payload = useRolePermissions ? null : permissionsPayload;
        const res = await updateMemberPermissions(restaurantId, permissionTarget.member.ID, payload);
        setMembers((current) => replaceMember(current, res.data.member));
      }
      closePermissionModal(true);
      showToast({ title: language === "th" ? "บันทึกสิทธิ์แล้ว" : "Permissions saved" });
      await refresh();
    } catch {
      setError(copy.memberError);
    } finally {
      setPermissionSaving(false);
    }
  };

  const preservedPermissionCount = permissionDraft.filter((permission) => !grantablePermissionSet.has(permission)).length;
  const permissionEditBlocked = preservedPermissionCount > 0 && !(permissionTarget?.type === "member" && useRolePermissions);
  const permissionBackdrop = useBackdropClose(closePermissionModal);
  const roleManagerBackdrop = useBackdropClose(closeRoleManager);
  const inviteModalBackdrop = useBackdropClose(closeInviteModal);

  if (!restaurantId) return null;

  return (
    <div className="min-h-dvh bg-slate-100 px-4 py-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100 sm:px-6 lg:px-8 lg:py-6">
      <h1 className="sr-only">{copy.title}</h1>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      {!allowed && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/15">
          <p className="text-[14px] font-semibold text-amber-900 dark:text-amber-200">{copy.noPermissionTitle}</p>
          <p className="mt-1 text-[13px] text-amber-800/80 dark:text-amber-300/80">{copy.noPermissionBody}</p>
        </div>
      )}

      <div className="space-y-4">
        <section className="space-y-4">
          {/* The page's two actions, and nothing else: the old header card
              explained the page and counted roles (owner, 28 ก.ย. 2569). */}
          {(canManageInvites || canManageRoles || canViewAuditLog) && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {canViewAuditLog && (
                <button
                  type="button"
                  onClick={openHistory}
                  aria-label={copy.history}
                  title={copy.history}
                  className="ui-press grid h-10 w-10 place-items-center rounded-xl border border-gray-200 bg-white text-gray-700 shadow-(--dashboard-control-shadow) transition-colors hover:bg-gray-50 hover:text-gray-950 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-white"
                >
                  <History className="h-5 w-5" aria-hidden="true" />
                </button>
              )}
              {canManageRoles && (
                <button
                  type="button"
                  onClick={openRoleManager}
                  className="ui-press h-10 rounded-xl border border-gray-200 bg-white px-4 text-[14px] font-semibold text-gray-800 shadow-(--dashboard-control-shadow) transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  {copy.manageRoles}
                </button>
              )}
              {canManageInvites && (
                <button
                  type="button"
                  onClick={openInviteModal}
                  className="ui-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-orange-700 px-4 text-[14px] font-semibold text-white shadow-(--dashboard-control-shadow) transition-colors hover:bg-orange-800 dark:bg-orange-700 dark:text-white"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {copy.createLink}
                </button>
              )}
            </div>
          )}

          <div className="rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 className="text-[16px] font-semibold text-gray-900 dark:text-white">{copy.membersTitle}</h2>
              {!loading && members.length ? (
                <span className="text-[14px] tabular-nums text-gray-500 dark:text-gray-400">{copy.memberCount(members.length)}</span>
              ) : null}
            </div>
            <div className="p-4">
              {loading ? (
                <div className="space-y-3">
                  <RestaurantCardSkeleton />
                  <RestaurantCardSkeleton />
                </div>
              ) : members.length ? (
                <div className="space-y-2">
                  <div className="hidden grid-cols-[minmax(170px,1.35fr)_minmax(150px,1fr)_minmax(76px,0.55fr)_minmax(112px,0.75fr)_minmax(104px,0.85fr)] gap-3 border-b border-gray-100 pb-2 text-[13px] font-semibold text-gray-500 dark:border-gray-800 lg:grid">
                    <span>{copy.name}</span>
                    <span>{copy.role}</span>
                    <span>{copy.status}</span>
                    <span>{copy.joined}</span>
                    <span className="text-right">{copy.actions}</span>
                  </div>
                  {members.map((member) => {
                    const targetManageable = canManageTarget(activeRole, member.role?.name, member.user_id === user?.ID);
                    const canEditMemberRole = canManageRoles && targetManageable && manageableRoles.some((role) => role.ID === member.role_id);
                    const canEditMemberStatus = canManageMembers && targetManageable;
                    const hasMemberActions = canEditMemberRole || canEditMemberStatus;
                    const roleOptions = manageableRoles;
                    const busy = updatingMemberIds.includes(member.ID);

                    return (
                      <div key={member.ID} className="relative grid gap-3 rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 lg:grid-cols-[minmax(170px,1.35fr)_minmax(150px,1fr)_minmax(76px,0.55fr)_minmax(112px,0.75fr)_minmax(104px,0.85fr)] lg:items-center lg:gap-3 lg:border-0 lg:border-b lg:bg-transparent lg:px-0 lg:py-3 lg:last:border-b-0 lg:dark:bg-transparent">
                        <div className="flex min-w-0 items-center gap-3">
                          <UserAvatar src={member.user?.profile_image} name={displayUserName(member, language)} size={40} className="h-10 w-10 text-[13px]" />
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-semibold text-gray-900 dark:text-white">{displayUserName(member, language)}</p>
                            <p className="truncate text-[13px] text-gray-500 dark:text-gray-400">{member.user?.email}</p>
                          </div>
                        </div>

                        <div className="min-w-0">
                          <p className="mb-1 text-[13px] font-semibold text-gray-500 lg:hidden">{copy.role}</p>
                          {canEditMemberRole ? (
                            <div>
                              <ThemedSelect
                                aria-label={copy.role}
                                className="max-w-full lg:w-full xl:w-[220px]"
                                value={String(member.role_id)}
                                onChange={(next) => void changeMemberRole(member.ID, next)}
                                disabled={busy}
                                options={roleOptions.map((role) => ({
                                  value: String(role.ID),
                                  label: roleLabel(role, language),
                                }))}
                              />
                              {/* Said only when it differs from the role: "uses
                                  the role's permissions" under every row was noise. */}
                              {member.permissions_override != null ? (
                                <p className="mt-1 text-[13px] font-medium text-orange-700 dark:text-orange-400">{memberPermissionSummary(member, language)}</p>
                              ) : null}
                            </div>
                          ) : (
                            <div>
                              <p className="text-[14px] font-medium text-gray-800 dark:text-gray-200">{roleLabel(member.role, language)}</p>
                              {member.permissions_override != null ? (
                                <p className="mt-0.5 text-[13px] font-medium text-orange-700 dark:text-orange-400">{memberPermissionSummary(member, language)}</p>
                              ) : null}
                            </div>
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="mb-1 text-[13px] font-semibold text-gray-500 lg:hidden">{copy.status}</p>
                          <span className={`inline-flex rounded-md px-2 py-1 text-[13px] font-medium ${statusTone(member.status)}`}>
                            {STATUS_LABELS[language][member.status] ?? member.status}
                          </span>
                        </div>

                        <div className="min-w-0">
                          <p className="mb-1 text-[13px] font-semibold text-gray-500 lg:hidden">{copy.joined}</p>
                          <p className="text-[14px] leading-5 text-gray-600 dark:text-gray-400">{formatDate(member.joined_at, language)}</p>
                        </div>

                        <div className="min-w-0">
                          {hasMemberActions ? (
                            <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2">
                              {canEditMemberRole && (
                                <button type="button" onClick={() => openMemberPermissions(member)} disabled={busy} className="h-9 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800 xl:col-span-2">
                                  {language === "th" ? "สิทธิ์" : "Permissions"}
                                </button>
                              )}
                              {canEditMemberStatus && (
                                <>
                                  {member.status !== "active" ? (
                                    <button type="button" onClick={() => void changeMemberStatus(member.ID, "active")} disabled={busy} className="h-9 min-w-0 rounded-md border border-emerald-200 bg-white px-2 text-[13px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/50 dark:bg-gray-900 dark:text-emerald-300 dark:hover:bg-emerald-900/20">
                                      {copy.restore}
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => void changeMemberStatus(member.ID, "suspended")} disabled={busy} className="h-9 min-w-0 rounded-md border border-amber-200 bg-white px-2 text-[13px] font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900/50 dark:bg-gray-900 dark:text-amber-300 dark:hover:bg-amber-900/20">
                                      {copy.suspend}
                                    </button>
                                  )}
                                  <button type="button" onClick={() => void changeMemberStatus(member.ID, "removed")} disabled={busy || member.status === "removed"} className="h-9 min-w-0 rounded-md border border-red-200 bg-white px-2 text-[13px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-900/20">
                                    {copy.remove}
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <p className="text-[13px] text-gray-500 dark:text-gray-500 lg:text-right">
                              {member.user_id === user?.ID ? copy.yourAccount : "-"}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-8 text-center text-[14px] text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400">
                  {copy.noMembers}
                </div>
              )}
            </div>
          </div>

          {canManageInvites && (
            <InvitationLinks
              invitations={invitations}
              members={members}
              loading={loading}
              language={language}
              copiedToken={copiedToken}
              revokingIds={revokingIds}
              onCopy={(token) => void copyInvite(token)}
              onEmail={sendInviteEmail}
              onRevoke={(invitationId) => void revokeInvite(invitationId)}
            />
          )}

          {historyOpen && canViewAuditLog && (
            <AuditHistoryDialog
              logs={auditLogs}
              loading={loading}
              hasMore={auditHasMore}
              loadingMore={auditLoadingMore}
              language={language}
              closing={historyClosing}
              onLoadMore={() => void loadMoreAuditLogs()}
              onClose={closeHistory}
            />
          )}
        </section>
      </div>

      {inviteModalOpen && canManageInvites && (
        <div
          {...inviteModalBackdrop}
          className={`${inviteModalClosing ? "motion-overlay-exit" : "motion-overlay"} fixed left-0 top-0 z-50 flex h-dvh w-dvw items-center justify-center overflow-y-auto bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4`}
        >
          <form
            onSubmit={createInvite}
            className={`${inviteModalClosing ? "motion-dialog-exit" : "motion-dialog"} flex max-h-[calc(100dvh-1.5rem)] w-[calc(100dvw-1.5rem)] max-w-lg flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-gray-900 dark:text-white">{copy.inviteTitle}</h2>
              </div>
              <button type="button" onClick={() => closeInviteModal()} className="h-8 w-8 shrink-0 rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-[14px] font-medium text-gray-900 dark:text-white">{copy.role}</span>
                  <ThemedSelect
                    aria-label={copy.role}
                    value={String(roleId || inviteRoles[0]?.ID || "")}
                    onChange={(next) => setRoleId(Number(next))}
                    disabled={!canManageInvites}
                    options={inviteRoles.map((role) => ({
                      value: String(role.ID),
                      label: roleLabel(role, language),
                    }))}
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[14px] font-medium text-gray-900 dark:text-white">{copy.expiry}</span>
                  <ThemedSelect
                    aria-label={copy.expiry}
                    value={expiresInDays}
                    onChange={setExpiresInDays}
                    disabled={!canManageInvites}
                    options={[
                      { value: "1", label: `1 ${copy.day}` },
                      { value: "3", label: `3 ${copy.day}` },
                      { value: "7", label: `7 ${copy.day}` },
                      { value: "14", label: `14 ${copy.day}` },
                      { value: "0", label: copy.noExpiry },
                    ]}
                  />
                </label>
              </div>

            </div>

            <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
              <button
                type="button"
                onClick={() => closeInviteModal()}
                disabled={submitting}
                className="h-10 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {copy.cancelAction}
              </button>
              <button type="submit" disabled={!canManageInvites || !roleId || submitting} className="h-10 rounded-md bg-orange-700 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-700 dark:text-white">
                {submitting ? copy.creating : copy.createLink}
              </button>
            </div>
          </form>
        </div>
      )}

      {roleManagerOpen && canManageRoles && (
        <>
          <button
            type="button"
            aria-label={copy.cancelAction}
            {...roleManagerBackdrop}
            className={`${roleManagerClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-40 cursor-default bg-gray-950/45 backdrop-blur-sm`}
          />
          <aside className={`${roleManagerClosing ? "motion-drawer-exit" : "motion-drawer"} fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{copy.rolePanelTitle}</p>
                <h2 className="mt-0.5 text-[15px] font-semibold text-gray-900 dark:text-white">{copy.roleManagerTitle}</h2>
                <p className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{copy.roleManagerHint}</p>
              </div>
              <button type="button" onClick={() => closeRoleManager()} className="h-8 w-8 shrink-0 rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <form onSubmit={(event) => void createCustomRole(event)} className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <p className="text-[12px] font-semibold text-gray-900 dark:text-white">{copy.customRoleTitle}</p>
                <label className="mt-3 block">
                  <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.roleNameLabel}</span>
                  <input
                    type="text"
                    value={newRoleName}
                    onChange={(event) => setNewRoleName(event.target.value)}
                    placeholder={copy.roleNamePlaceholder}
                    disabled={!canManageRoles || creatingRole}
                    className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] outline-none transition-colors focus:border-orange-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!canManageRoles || creatingRole}
                  className="mt-3 h-10 w-full rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-700 dark:text-white"
                >
                  {creatingRole ? copy.creatingRole : copy.createRole}
                </button>
              </form>

              <div className="mt-4 space-y-2">
                {manageableRoles.map((role) => {
                  const busy = roleActionIds.includes(role.ID);
                  const roleCardDisabled = !canManageRoles || busy;

                  return (
                    <div
                      key={role.ID}
                      role="button"
                      tabIndex={roleCardDisabled ? -1 : 0}
                      aria-label={`${copy.editPermissions}: ${roleLabel(role, language)}`}
                      onClick={() => {
                        if (!roleCardDisabled) openRolePermissions(role);
                      }}
                      onKeyDown={(event) => {
                        if (!roleCardDisabled && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          openRolePermissions(role);
                        }
                      }}
                      className={`group/card rounded-md border border-gray-200 bg-white p-2.5 outline-none transition-colors dark:border-gray-800 dark:bg-gray-900 ${
                        roleCardDisabled
                          ? "cursor-not-allowed opacity-70"
                          : "cursor-pointer hover:border-gray-300 hover:bg-gray-50 focus:border-orange-500 dark:hover:border-gray-700 dark:hover:bg-gray-800"
                      }`}
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-2">
                        <div className="min-w-0">
                          <span className="inline-flex max-w-full min-w-0 items-center">
                            <span className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{roleLabel(role, language)}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-gray-500 dark:text-gray-400">{permissionSummary(role, language)}</span>
                        </div>
                        <div className="flex shrink-0 items-center justify-center">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors group-hover/card:bg-gray-100 group-hover/card:text-gray-700 dark:group-hover/card:bg-gray-800 dark:group-hover/card:text-gray-200">
                            <ChevronRight className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </>
      )}

      {permissionTarget && canManageRoles && (
        <div {...permissionBackdrop} className={`${permissionClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-stretch justify-center bg-gray-950/45 p-2 backdrop-blur-sm sm:p-4 lg:p-6`}>
          <div className={`${permissionClosing ? "motion-dialog-exit" : "motion-dialog"} flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-1.5 dark:border-gray-800 sm:px-6">
              <div className="min-w-0 flex-1">
                {permissionTarget.type === "role" ? (
                  <>
                    {editingRoleName ? (
                      <form
                        className="min-w-0"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void renameRole();
                        }}
                      >
                        {/* Enter or leaving the field saves, Escape puts the old
                            name back. No save/cancel buttons: the owner asked for
                            them gone (29 ก.ย. 2569). */}
                        <label className="sr-only" htmlFor={`role-name-${permissionTarget.role.ID}`}>{copy.roleNameLabel}</label>
                        <input
                          autoFocus
                          id={`role-name-${permissionTarget.role.ID}`}
                          type="text"
                          value={roleRenameDraft}
                          onChange={(event) => {
                            setRoleRenameDraft(event.target.value);
                            setRoleRenameError("");
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Escape") return;
                            event.preventDefault();
                            event.stopPropagation();
                            setRoleRenameDraft(roleLabel(permissionTarget.role, language));
                            setRoleRenameError("");
                            setEditingRoleName(false);
                          }}
                          onBlur={() => {
                            if (roleDialogPolicy.busy) return;
                            if (!roleRenameDraft.trim()) {
                              setRoleRenameDraft(roleLabel(permissionTarget.role, language));
                              setRoleRenameError("");
                              setEditingRoleName(false);
                              return;
                            }
                            void renameRole();
                          }}
                          aria-invalid={Boolean(roleRenameError)}
                          aria-describedby={roleRenameError ? roleRenameErrorId : undefined}
                          disabled={roleDialogPolicy.busy}
                          className="h-9 w-full max-w-xs rounded-md border border-gray-300 bg-white px-2.5 text-[16px] font-semibold text-gray-900 outline-none transition-colors focus:border-orange-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                        {roleRenameError && (
                          <p
                            id={roleRenameErrorId}
                            aria-live="polite"
                            aria-atomic="true"
                            className="mt-1.5 text-[11px] font-medium text-red-600 dark:text-red-300"
                          >
                            {roleRenameError}
                          </p>
                        )}
                      </form>
                    ) : (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <h2 className="truncate text-[16px] font-semibold text-gray-900 dark:text-white">
                          {roleLabel(permissionTarget.role, language)}
                        </h2>
                        <button
                          type="button"
                          aria-label={copy.editRoleName}
                          title={copy.editRoleName}
                          disabled={!roleDialogPolicy.canEditRoleName}
                          onClick={() => {
                            setRoleRenameDraft(roleLabel(permissionTarget.role, language));
                            setRoleRenameError("");
                            setEditingRoleName(true);
                          }}
                          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="truncate text-[16px] font-semibold text-gray-900 dark:text-white">
                      {language === "th" ? "สิทธิ์พนักงาน" : "Staff permissions"} · {displayUserName(permissionTarget.member, language)}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                      {memberPermissionSummary(permissionTarget.member, language)}
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                aria-label={copy.cancelAction}
                disabled={!roleDialogPolicy.canDismiss}
                onClick={() => closePermissionModal()}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <X className="h-4.5 w-4.5" strokeWidth={2.1} aria-hidden="true" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {preservedPermissionCount > 0 && (
                <div className="mb-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] leading-5 text-sky-800 dark:border-sky-900/50 dark:bg-sky-900/15 dark:text-sky-200">
                  {language === "th"
                    ? `มี ${preservedPermissionCount} สิทธิ์ที่บัญชีนี้มอบไม่ได้ ระบบจะเก็บค่าเดิมไว้ แต่ต้องให้ผู้มีสิทธิ์สูงกว่าเป็นผู้บันทึกการแก้ไข`
                    : `${preservedPermissionCount} permission${preservedPermissionCount === 1 ? " is" : "s are"} outside this account's grant scope. The existing value is preserved; a higher-privileged account must save changes.`}
                </div>
              )}
              {/* One row of bulk actions. For a member, "back to default" sits at
                  the far end: it replaces the old "use this role's permissions"
                  checkbox, which locked every switch while it was ticked
                  (owner, 28 ก.ย. 2569). Now the switches always work; touching
                  one after a reset makes the member's permissions their own again. */}
              <div className="mb-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUseRolePermissions(false);
                    setPermissionDraft((current) => replaceGrantablePermissionSelection(current, grantablePermissions, true));
                  }}
                  className="ui-press h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {language === "th" ? "เลือกทั้งหมด" : "Select all"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUseRolePermissions(false);
                    setPermissionDraft((current) => replaceGrantablePermissionSelection(current, grantablePermissions, false));
                  }}
                  className="ui-press h-9 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  {language === "th" ? "เอาที่เลือกออกทั้งหมด" : "Clear selected"}
                </button>
                {permissionTarget.type === "member" && (
                  <button
                    type="button"
                    disabled={useRolePermissions}
                    onClick={() => {
                      setUseRolePermissions(true);
                      setPermissionDraft(parsePermissions(permissionTarget.member.role?.permissions, permissionTarget.member.role?.name));
                    }}
                    className="ui-press ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-orange-700 transition-colors enabled:hover:bg-orange-50 disabled:cursor-default disabled:text-gray-500 dark:text-orange-400 dark:enabled:hover:bg-orange-500/10 dark:disabled:text-gray-400"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    {language === "th" ? "คืนค่าเริ่มต้น" : "Reset to default"}
                  </button>
                )}
              </div>
              <div className="space-y-5">
                {visiblePermissionSections.map((section) => (
                  <section key={section.id} className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                    <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/70">
                      <h3 className="text-[15px] font-semibold text-gray-950 dark:text-white">{language === "th" ? section.th : section.en}</h3>
                    </div>
                    <div>
                      {section.rows.map((row) => {
                        const prerequisites = row.permissions.flatMap((permission) => PERMISSION_DEPENDENCIES[permission] ?? []);
                        const prerequisiteLabels = prerequisites.map((permission) => {
                          const requiredRow = PERMISSION_SECTIONS.flatMap((item) => item.rows)
                            .find((item) => item.permissions.includes(permission));
                          return requiredRow ? (language === "th" ? requiredRow.th : requiredRow.en) : permission;
                        });
                        return (
                          <div key={row.id} className="grid gap-4 border-b border-dashed border-gray-200 px-4 py-4 last:border-b-0 dark:border-gray-800 md:grid-cols-[minmax(0,1fr)_minmax(260px,auto)] md:items-center">
                            <div className="grid gap-1 sm:grid-cols-[190px_minmax(0,1fr)] sm:gap-5">
                              <p className="text-[15px] font-semibold text-gray-900 dark:text-white">{language === "th" ? row.th : row.en}</p>
                              <div>
                                <p className="text-[14px] leading-6 text-gray-900 dark:text-gray-100">{language === "th" ? row.descriptionTh : row.descriptionEn}</p>
                                {prerequisiteLabels.length > 0 && (
                                  <p className="mt-1 text-[13px] text-gray-900 dark:text-gray-100">
                                    {language === "th" ? "เปิดพร้อม: " : "Also enables: "}{prerequisiteLabels.join(", ")}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex md:justify-end">
                              {(() => {
                                const checked = row.permissions.every((permission) => permissionDraft.includes(permission));
                                return (
                                  <div className="inline-flex overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                                    <button
                                      type="button"
                                      aria-pressed={!checked}
                                      aria-label={language === "th" ? "ไม่อนุญาต" : "Deny"}
                                      onClick={() => setPermissionRow(row.permissions, false)}
                                      className={`flex h-8 w-9 items-center justify-center text-[15px] font-semibold transition-colors ${
                                        checked
                                          ? "text-red-600 hover:bg-red-50 hover:text-red-700 disabled:hover:bg-transparent disabled:hover:text-red-600 dark:text-red-300 dark:hover:bg-red-950/25 dark:hover:text-red-200"
                                          : "bg-red-600 text-white dark:bg-red-500 dark:text-white"
                                      } disabled:cursor-not-allowed`}
                                    >
                                      ×
                                    </button>
                                    <button
                                      type="button"
                                      aria-pressed={checked}
                                      aria-label={language === "th" ? "อนุญาต" : "Allow"}
                                      onClick={() => setPermissionRow(row.permissions, true)}
                                      className={`flex h-8 w-9 items-center justify-center border-l border-gray-200 text-[14px] font-semibold transition-colors dark:border-gray-800 ${
                                        checked
                                          ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white"
                                          : "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 disabled:hover:bg-transparent disabled:hover:text-emerald-600 dark:text-emerald-300 dark:hover:bg-emerald-950/25 dark:hover:text-emerald-200"
                                      } disabled:cursor-not-allowed`}
                                    >
                                      ✓
                                    </button>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                {permissionTarget.type === "role" && (
                  <button
                    type="button"
                    onClick={() => void removeRole(permissionTarget.role)}
                    disabled={!roleDialogPolicy.canDeleteRole}
                    className="h-9 rounded-md border border-red-200 bg-white px-3 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-900/20"
                  >
                    {copy.deleteRole}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => void savePermissions()} disabled={!roleDialogPolicy.canSavePermissions || permissionEditBlocked} className="h-9 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white">
                {permissionSaving ? (language === "th" ? "กำลังบันทึก..." : "Saving...") : (language === "th" ? "บันทึกสิทธิ์" : "Save permissions")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
