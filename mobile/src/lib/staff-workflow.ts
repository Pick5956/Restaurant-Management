import type {
  InvitationRoleSummary,
  Membership,
  RestaurantAuditLog,
  Role,
} from '@/src/types/restaurant';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { can } from './rbac.ts';
import { normalizePermissionSelection, parsePermissionsForRole } from './permissions.ts';

const ROLE_LABELS: Record<string, Record<DisplayLanguage, string>> = {
  owner: { th: 'เจ้าของร้าน', en: 'Owner' },
  manager: { th: 'ผู้จัดการ', en: 'Manager' },
  cashier: { th: 'แคชเชียร์', en: 'Cashier' },
  waiter: { th: 'พนักงานเสิร์ฟ', en: 'Waiter' },
  chef: { th: 'ครัว', en: 'Kitchen' },
};

const STATUS_LABELS: Record<string, Record<DisplayLanguage, string>> = {
  active: { th: 'ใช้งาน', en: 'Active' },
  suspended: { th: 'ระงับ', en: 'Suspended' },
  removed: { th: 'นำออกแล้ว', en: 'Removed' },
  pending: { th: 'รอรับคำเชิญ', en: 'Invitation pending' },
};

export const DEFAULT_INVITATION_EXPIRY_DAYS = 7;
export const INVITATION_EXPIRY_DAY_OPTIONS = [1, 3, 7, 14, 0] as const;

export function invitationExpiryLabel(
  days: number,
  language: DisplayLanguage = 'th',
): string {
  if (days === 0) return language === 'th' ? 'ไม่หมดอายุ' : 'Never expires';
  return language === 'th' ? `${days} วัน` : `${days} ${days === 1 ? 'day' : 'days'}`;
}

function activeCan(
  membership: Membership | null | undefined,
  permission: string,
): boolean {
  if (!membership || membership.status !== 'active') return false;
  return can(membership, permission);
}

export function canManageInvitations(membership: Membership | null | undefined): boolean {
  return activeCan(membership, 'manage_invites');
}

export function canManageMembers(membership: Membership | null | undefined): boolean {
  return activeCan(membership, 'manage_members');
}

export function canManageRoles(membership: Membership | null | undefined): boolean {
  return activeCan(membership, 'manage_roles');
}

export function canViewTeamAudit(membership: Membership | null | undefined): boolean {
  return activeCan(membership, 'view_audit_log');
}

export function canAccessTeam(membership: Membership | null | undefined): boolean {
  return canManageInvitations(membership)
    || canManageMembers(membership)
    || canManageRoles(membership)
    || canViewTeamAudit(membership);
}

// Compatibility alias for screens that only need to know whether the team
// workspace is reachable. Mutation controls must use the granular helpers.
export function canManageTeam(membership: Membership | null | undefined): boolean {
  return canAccessTeam(membership);
}

export function canManageTarget(
  actorRole?: string,
  targetRole?: string,
  isSelf = false,
  hasOperationalAuthority = false,
): boolean {
  if (isSelf || !actorRole || !targetRole) return false;
  if (actorRole === 'owner') return targetRole !== 'owner';
  if (actorRole === 'manager') return targetRole !== 'owner' && targetRole !== 'manager';
  return hasOperationalAuthority && targetRole !== 'owner' && targetRole !== 'manager';
}

export function allowedRoleOptions(
  actorRole: string | undefined,
  roles: Role[],
  hasOperationalAuthority = actorRole === 'owner' || actorRole === 'manager',
): Role[] {
  if (!hasOperationalAuthority) return [];
  return roles.filter((role) => {
    if (role.name === 'owner') return false;
    if (actorRole !== 'owner' && role.name === 'manager') return false;
    return true;
  });
}

export function canGrantRole(
  membership: Membership | null | undefined,
  role: Role,
): boolean {
  if (!membership || membership.status !== 'active') return false;
  return normalizePermissionSelection(parsePermissionsForRole(role.permissions, role.name))
    .every((permission) => can(membership, permission));
}

export function invitationTokenFrom(value: string): string {
  const normalized = value.trim();
  if (!normalized) return '';

  let candidate = normalized;
  try {
    const parsed = new URL(normalized);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    candidate = pathParts.at(-1) || parsed.hostname;
  } catch {
    const pathParts = normalized.split(/[/?#]/).filter(Boolean);
    candidate = pathParts.at(-1) || '';
  }

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return '';
  }
  return /^[A-Za-z0-9_-]{32}$/.test(candidate) ? candidate : '';
}

export function invitationEmailMismatch(
  invitationEmail?: string,
  currentUserEmail?: string,
): boolean {
  const invited = invitationEmail?.trim().toLowerCase() ?? '';
  const current = currentUserEmail?.trim().toLowerCase() ?? '';
  if (!invited || !current || invited.includes('*')) return false;
  return invited !== current;
}

export function isInvitationUsableAt(
  invitation: { status: string; expires_at?: string | null },
  now = new Date(),
): boolean {
  if (invitation.status !== 'pending') return false;
  if (!invitation.expires_at) return true;
  const expiresAt = new Date(invitation.expires_at);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

export function roleLabel(
  role: Role | InvitationRoleSummary | string | null | undefined,
  language: DisplayLanguage = 'th',
): string {
  const roleName = typeof role === 'string' ? role : role?.name;
  if (!roleName) return language === 'th' ? 'พนักงาน' : 'Staff';
  const override = typeof role === 'string'
    ? ''
    : role?.display_name_override?.trim();
  const displayName = typeof role === 'string' ? '' : role?.display_name?.trim();
  if (override) return override;
  if (typeof role === 'string' || role?.is_system) {
    const localizedSystemName = ROLE_LABELS[roleName]?.[language];
    if (localizedSystemName) return localizedSystemName;
  }
  return displayName || roleName;
}

export function canFinishRoleNameEdit(value: string): boolean {
  return value.trim().length > 0;
}

export function roleSaveFailureMessage(
  nameSaved: boolean,
  failure: string,
  language: DisplayLanguage = 'th',
): string {
  const detail = failure.trim() || (language === 'th'
    ? 'บันทึกบทบาทไม่สำเร็จ'
    : 'Unable to save role');
  if (!nameSaved) return detail;
  return language === 'th'
    ? `บันทึกชื่อบทบาทแล้ว แต่บันทึกสิทธิ์ไม่สำเร็จ: ${detail}`
    : `Role name saved, but permissions could not be saved: ${detail}`;
}

export function teamActivityCopy(language: DisplayLanguage = 'th') {
  return language === 'th'
    ? {
      sectionTitle: 'กิจกรรมล่าสุด',
      emptyTitle: 'ยังไม่มีกิจกรรม',
      emptyDetail: 'รายการเชิญและการแก้ไขทีมจะอยู่ที่นี่',
    }
    : {
      sectionTitle: 'Recent activity',
      emptyTitle: 'No activity yet',
      emptyDetail: 'Invites and team changes will appear here.',
    };
}

export function staffCountSubtitle(
  memberCount: number,
  invitationCount: number,
  canViewInvitations: boolean,
  loading: boolean,
  language: DisplayLanguage = 'th',
): string | undefined {
  if (loading && memberCount === 0 && invitationCount === 0) return undefined;

  const localizedMembers = memberCount.toLocaleString(language === 'th' ? 'th-TH' : 'en-US');
  if (canViewInvitations && invitationCount > 0) {
    const localizedInvitations = invitationCount.toLocaleString(language === 'th' ? 'th-TH' : 'en-US');
    return language === 'th'
      ? `${localizedMembers} คน · ${localizedInvitations} คำเชิญ`
      : `${localizedMembers} staff · ${localizedInvitations} ${invitationCount === 1 ? 'invite' : 'invites'}`;
  }

  return language === 'th'
    ? `${localizedMembers} คนในทีม`
    : `${localizedMembers} staff ${memberCount === 1 ? 'member' : 'members'}`;
}

export function roleListMeta(
  role: Pick<Role, 'is_system' | 'name' | 'permissions'>,
  language: DisplayLanguage = 'th',
) {
  let hasAllPermissions = false;
  try {
    const parsed = JSON.parse(role.permissions || '[]') as unknown;
    hasAllPermissions = Array.isArray(parsed) && parsed.includes('*');
  } catch {
    hasAllPermissions = false;
  }

  const permissionCount = parsePermissionsForRole(role.permissions, role.name).length;
  const permissionLabel = hasAllPermissions
    ? language === 'th' ? 'ทุกสิทธิ์' : 'All permissions'
    : language === 'th'
      ? `${permissionCount.toLocaleString('th-TH')} สิทธิ์`
      : `${permissionCount.toLocaleString('en-US')} ${permissionCount === 1 ? 'permission' : 'permissions'}`;

  return {
    typeLabel: role.is_system
      ? language === 'th' ? 'มาตรฐาน' : 'Standard'
      : language === 'th' ? 'กำหนดเอง' : 'Custom',
    permissionLabel,
  };
}

export function roleEditorHeading(
  editing: boolean,
  role: Role | null | undefined,
  language: DisplayLanguage = 'th',
): { title: string; subtitle?: string } {
  if (!editing) {
    return language === 'th'
      ? { title: 'เพิ่มบทบาท', subtitle: 'ตั้งชื่อและเลือกสิทธิ์' }
      : { title: 'Add role', subtitle: 'Name the role and choose permissions' };
  }
  if (!role) {
    return {
      title: language === 'th' ? 'แก้ไขบทบาท' : 'Edit role',
      subtitle: undefined,
    };
  }
  return {
    title: roleLabel(role, language),
    subtitle: role.is_system
      ? language === 'th'
        ? 'บทบาทมาตรฐาน · แก้ไขชื่อและสิทธิ์'
        : 'Standard role · Edit name and permissions'
      : language === 'th'
        ? 'บทบาทกำหนดเอง · แก้ไขชื่อและสิทธิ์'
        : 'Custom role · Edit name and permissions',
  };
}

export function resolvePermissionGroupTransition(
  currentGroupIndex: number,
  pressedGroupIndex: number,
): number {
  return currentGroupIndex === pressedGroupIndex ? -1 : pressedGroupIndex;
}

export function staffStatusLabel(
  status: string,
  language: DisplayLanguage = 'th',
): string {
  return STATUS_LABELS[status]?.[language] ?? status;
}

function auditDetails(details: string): Record<string, unknown> {
  try {
    const value = JSON.parse(details) as unknown;
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function auditMessage(
  log: Pick<RestaurantAuditLog, 'action' | 'details'>,
  language: DisplayLanguage = 'th',
): string {
  const details = auditDetails(log.details);
  const roleName = typeof details.role_name === 'string' ? details.role_name : '';
  const email = typeof details.email === 'string' ? details.email : '';
  const fromStatus = typeof details.from_status === 'string' ? details.from_status : '';
  const toStatus = typeof details.to_status === 'string' ? details.to_status : '';
  const fromRole = typeof details.from_role === 'string' ? details.from_role : '';
  const toRole = typeof details.to_role === 'string' ? details.to_role : '';
  const fromName = typeof details.from_name === 'string' ? details.from_name : '';
  const toName = typeof details.to_name === 'string' ? details.to_name : '';

  if (log.action === 'invitation_created') {
    return language === 'th'
      ? `สร้างคำเชิญ ${roleLabel(roleName, language)}${email ? ` · ${email}` : ''}`
      : `Created invitation for ${roleLabel(roleName, language)}${email ? ` · ${email}` : ''}`;
  }
  if (log.action === 'invitation_revoked') {
    return language === 'th'
      ? `ยกเลิกคำเชิญ${email ? ` · ${email}` : ''}`
      : `Revoked invitation${email ? ` · ${email}` : ''}`;
  }
  if (log.action === 'invitation_accepted') {
    if (language === 'th') {
      return `รับคำเชิญเข้าร่วมร้าน${roleName ? ` เป็น ${roleLabel(roleName, language)}` : ''}`;
    }
    return `Accepted restaurant invitation${roleName ? ` as ${roleLabel(roleName, language)}` : ''}`;
  }
  if (log.action === 'member_status_changed') {
    return language === 'th'
      ? `เปลี่ยนสถานะสมาชิก ${staffStatusLabel(fromStatus, language)} → ${staffStatusLabel(toStatus, language)}`
      : `Changed member status ${staffStatusLabel(fromStatus, language)} → ${staffStatusLabel(toStatus, language)}`;
  }
  if (log.action === 'member_role_changed') {
    return language === 'th'
      ? `เปลี่ยนบทบาท ${roleLabel(fromRole, language)} → ${roleLabel(toRole, language)}`
      : `Changed role ${roleLabel(fromRole, language)} → ${roleLabel(toRole, language)}`;
  }
  if (log.action === 'member_permissions_changed') {
    return language === 'th'
      ? 'ปรับสิทธิ์เฉพาะพนักงาน'
      : 'Changed member-specific permissions';
  }
  if (log.action === 'role_created') {
    return language === 'th'
      ? `สร้างบทบาท${roleName ? ` ${roleLabel(roleName, language)}` : ''}`
      : `Created role${roleName ? ` ${roleLabel(roleName, language)}` : ''}`;
  }
  if (log.action === 'role_renamed') {
    return language === 'th'
      ? `เปลี่ยนชื่อบทบาท ${fromName || '-'} → ${toName || '-'}`
      : `Renamed role ${fromName || '-'} → ${toName || '-'}`;
  }
  if (log.action === 'role_permissions_changed') {
    return language === 'th'
      ? `ปรับสิทธิ์บทบาท${roleName ? ` ${roleLabel(roleName, language)}` : ''}`
      : `Changed role permissions${roleName ? ` for ${roleLabel(roleName, language)}` : ''}`;
  }
  if (log.action === 'role_deleted') {
    return language === 'th'
      ? `ลบบทบาท${roleName ? ` ${roleLabel(roleName, language)}` : ''}`
      : `Deleted role${roleName ? ` ${roleLabel(roleName, language)}` : ''}`;
  }
  if (log.action === 'ai_set_menu_availability') {
    // Written when the owner confirms the assistant's switch. It showed as the
    // raw key "ai_set_menu_availability" until 15 ก.ย. 2569.
    const menuName = typeof details.target_menu_item_name === 'string' ? details.target_menu_item_name.trim() : '';
    const on = details.is_available === true;
    if (language === 'th') return `AI ${on ? 'เปิดขาย' : 'ปิดขาย'}เมนู${menuName ? ` "${menuName}"` : ''}`;
    return `AI ${on ? 'turned on' : 'turned off'} ${menuName ? `"${menuName}"` : 'a menu item'}`;
  }
  if (log.action === 'ai_action_plan_item') {
    // One confirmed change from an assistant plan (since 24 ก.ย. 2569).
    const title = typeof details.title === 'string' ? details.title.trim() : '';
    const change = typeof details.change === 'string' ? details.change.trim() : '';
    const what = [title, change].filter(Boolean).join(' · ');
    return language === 'th' ? `AI แก้ตามคำสั่ง${what ? ` · ${what}` : ''}` : `AI change${what ? ` · ${what}` : ''}`;
  }
  return log.action;
}

export type AuditKind = 'ai' | 'invitation' | 'member' | 'role' | 'other';

/** Which icon an activity row gets. */
export function auditKind(action: string): AuditKind {
  if (action.startsWith('ai_')) return 'ai';
  if (action.startsWith('invitation_')) return 'invitation';
  if (action.startsWith('member_')) return 'member';
  if (action.startsWith('role_')) return 'role';
  return 'other';
}

const LEADING_VOWELS = new Set(['เ', 'แ', 'โ', 'ใ', 'ไ']);

function firstLetter(word: string): string {
  const letters = Array.from(word);
  if (!letters.length) return '';
  if (LEADING_VOWELS.has(letters[0]) && letters.length > 1) return letters[1];
  return letters[0].toLocaleUpperCase();
}

/**
 * The letters in a member's circle: the first of the first and last words,
 * "กรกุล สุนทร" → "กส", "Test Owner" → "TO". A Thai vowel written before its
 * consonant is skipped, so "เอก" gives "อ".
 */
export function memberInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return firstLetter(words[0]);
  return firstLetter(words[0]) + firstLetter(words[words.length - 1]);
}

export function userDisplayName(
  user:
    | Membership['user']
    | RestaurantAuditLog['actor_user']
    | RestaurantAuditLog['target_user']
    | null
    | undefined,
  language: DisplayLanguage = 'th',
): string {
  if (!user) return language === 'th' ? 'ระบบ' : 'System';
  if (user.nickname?.trim()) return user.nickname.trim();
  const fullName = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user.email || (language === 'th' ? 'สมาชิก' : 'Member');
}

export function auditAttribution(
  log: Pick<
    RestaurantAuditLog,
    'actor_user_id' | 'target_user_id' | 'actor_user' | 'target_user'
  >,
  language: DisplayLanguage = 'th',
): string {
  const actorName = userDisplayName(log.actor_user, language);
  if (!log.target_user) return actorName;

  const actorId = log.actor_user_id ?? log.actor_user?.ID;
  const targetId = log.target_user_id ?? log.target_user.ID;
  const sameUser = actorId != null && targetId != null && actorId === targetId;
  if (sameUser) return actorName;

  return language === 'th'
    ? `${actorName} · เป้าหมาย ${userDisplayName(log.target_user, language)}`
    : `${actorName} · Target: ${userDisplayName(log.target_user, language)}`;
}

export type TeamRoleGroup = { role: Role; members: Membership[] };

const ROLE_ORDER = ['owner', 'manager', 'chef', 'cashier', 'waiter'];

/**
 * Who holds each role, for the "บทบาทในร้าน" card (15 ก.ย. 2569, design B):
 * every role the shop has — empty ones too, which is the point, since "เชฟ ·
 * ยังไม่มีใคร" is what the owner needs to see — owner first, the standard roles
 * in the order a shop is staffed, then the shop's own. A member whose role the
 * role list did not include still gets a row, and removed members are not counted.
 */
export function teamRoleGroups(roles: readonly Role[], members: readonly Membership[]): TeamRoleGroup[] {
  const byId = new Map<number, TeamRoleGroup>();
  for (const role of roles) byId.set(role.ID, { role, members: [] });
  for (const member of members) {
    if (member.status === 'removed') continue;
    const roleId = member.role?.ID ?? member.role_id;
    let group = byId.get(roleId);
    if (!group && member.role) {
      group = { role: member.role, members: [] };
      byId.set(roleId, group);
    }
    group?.members.push(member);
  }
  const rank = (role: Role) => {
    const index = ROLE_ORDER.indexOf(role.name);
    return index >= 0 ? index : role.is_system ? ROLE_ORDER.length : ROLE_ORDER.length + 1;
  };
  return [...byId.values()].sort((a, b) => rank(a.role) - rank(b.role) || a.role.ID - b.role.ID);
}
