import type { Language } from "@/src/providers/LanguageProvider";
import type { Permission } from "@/src/types/auth";
import type { Invitation, Membership, RestaurantAuditLog } from "@/src/types/restaurant";
import type { Role } from "@/src/types/role";
import { SYSTEM_ROLE_LABELS as ROLE_LABELS, roleLabel } from "@/src/lib/roleLabels";

export { roleLabel };

export const STATUS_LABELS: Record<Language, Record<string, string>> = {
  th: {
    active: "ใช้งาน",
    suspended: "ระงับ",
    removed: "นำออกแล้ว",
    pending: "รอรับคำเชิญ",
  },
  en: {
    active: "Active",
    suspended: "Suspended",
    removed: "Removed",
    pending: "Pending invitation",
  },
};

type PermissionRow = {
  id: string;
  th: string;
  en: string;
  descriptionTh: string;
  descriptionEn: string;
  permissions: Permission[];
};

type PermissionSection = {
  id: string;
  th: string;
  en: string;
  rows: PermissionRow[];
};

export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    id: "service",
    th: "งานหน้าร้าน",
    en: "Service floor",
    rows: [
      {
        id: "order-taking",
        th: "รับออเดอร์",
        en: "Order taking",
        descriptionTh: "อนุญาตให้เปิดโต๊ะและเพิ่มรายการอาหาร โดยไม่รวมการรับชำระเงิน",
        descriptionEn: "Allow opening tables and adding food items, excluding payment collection.",
        permissions: ["take_order"],
      },
      {
        id: "payment",
        th: "รับชำระเงิน",
        en: "Take payments",
        descriptionTh: "อนุญาตให้ออกบิลและรับชำระเงิน พร้อมสิทธิ์ดูคลังออเดอร์",
        descriptionEn: "Allow billing and payment collection, including order archive access.",
        permissions: ["take_payment"],
      },
      {
        id: "kitchen-view",
        th: "ดูจอครัว",
        en: "View kitchen",
        descriptionTh: "อนุญาตให้เข้าดูรายการอาหารในครัวได้",
        descriptionEn: "Allow viewing kitchen food tickets.",
        permissions: ["view_kitchen"],
      },
      {
        id: "kitchen-manage",
        th: "จัดการครัว",
        en: "Manage kitchen",
        descriptionTh: "อนุญาตให้อัปเดตสถานะเมนูอาหารในครัว",
        descriptionEn: "Allow updating food item status in the kitchen.",
        permissions: ["update_order_status"],
      },
    ],
  },
  {
    id: "management",
    th: "จัดการร้าน",
    en: "Restaurant management",
    rows: [
      {
        id: "dashboard",
        th: "ดูภาพรวมร้าน",
        en: "View dashboard",
        descriptionTh: "อนุญาตให้ดูสถานะร้านและงานในกะปัจจุบัน",
        descriptionEn: "Allow viewing restaurant status and current shift activity.",
        permissions: ["view_dashboard"],
      },
      {
        id: "orders-view",
        th: "ดูคลังออเดอร์",
        en: "View order archive",
        descriptionTh: "อนุญาตให้ดูประวัติออเดอร์และรายละเอียดบิล",
        descriptionEn: "Allow viewing order history and bill details.",
        permissions: ["view_orders"],
      },
      {
        id: "tables-view",
        th: "ดูผังโต๊ะ",
        en: "View floor plan",
        descriptionTh: "อนุญาตให้ดูผังโต๊ะและสถานะโต๊ะ",
        descriptionEn: "Allow viewing table layout and table status.",
        permissions: ["view_tables"],
      },
      {
        id: "tables-manage",
        th: "จัดการโต๊ะ",
        en: "Manage tables",
        descriptionTh: "อนุญาตให้เพิ่ม แก้ไข หรือลบข้อมูลโต๊ะ",
        descriptionEn: "Allow creating, editing, or deleting table setup.",
        permissions: ["manage_table"],
      },
      {
        id: "menu-manage",
        th: "จัดการเมนูอาหาร",
        en: "Manage menu items",
        descriptionTh: "อนุญาตให้เพิ่ม แก้ไขราคา รูป และสถานะขายของเมนู",
        descriptionEn: "Allow creating and editing menu items, prices, images, and availability.",
        permissions: ["manage_menu"],
      },
      {
        id: "inventory-view",
        th: "ดูสต็อก",
        en: "View stock",
        descriptionTh: "อนุญาตให้ดูคลังวัตถุดิบและจำนวนคงเหลือ",
        descriptionEn: "Allow viewing ingredient stock and remaining quantities.",
        permissions: ["view_inventory"],
      },
      {
        id: "inventory-manage",
        th: "จัดการสต็อก",
        en: "Manage stock",
        descriptionTh: "อนุญาตให้จัดการรายการสต็อกและการเคลื่อนไหว",
        descriptionEn: "Allow managing inventory items and stock movements.",
        permissions: ["manage_inventory"],
      },
      {
        id: "expenses-manage",
        th: "บันทึกรายจ่าย",
        en: "Manage expenses",
        descriptionTh: "อนุญาตให้เพิ่ม แก้ไข และลบรายการเงินที่จ่ายออกจริง",
        descriptionEn: "Allow adding, editing, and deleting records of cash paid out.",
        permissions: ["manage_expenses"],
      },
      {
        id: "reports-view",
        th: "ดูรายงาน",
        en: "View reports",
        descriptionTh: "อนุญาตให้ดูยอดขาย ต้นทุน และรายงานผู้จัดการ",
        descriptionEn: "Allow viewing sales, cost, and manager reports.",
        permissions: ["view_reports"],
      },
      {
        id: "restaurant-settings",
        th: "ตั้งค่าร้านและการคิดเงิน",
        en: "Restaurant and billing settings",
        descriptionTh: "อนุญาตให้แก้ข้อมูลร้าน ภาษี ค่าบริการ และ PromptPay",
        descriptionEn: "Allow editing restaurant details, taxes, service charge, and PromptPay.",
        permissions: ["manage_restaurant_settings"],
      },
    ],
  },
  {
    id: "team",
    th: "ทีมและสิทธิ์",
    en: "Team and permissions",
    rows: [
      {
        id: "team-invites",
        th: "จัดการคำเชิญ",
        en: "Manage invitations",
        descriptionTh: "อนุญาตให้สร้าง ส่งต่อ และยกเลิกลิงก์เชิญ สำหรับบทบาทที่สิทธิ์ไม่เกินตนเอง",
        descriptionEn: "Allow creating, sharing, and revoking invitation links for roles within the actor's grant scope.",
        permissions: ["manage_invites"],
      },
      {
        id: "team-members",
        th: "จัดการสมาชิก",
        en: "Manage members",
        descriptionTh: "อนุญาตให้ระงับ นำออก หรือกู้คืนสมาชิกทั่วไป",
        descriptionEn: "Allow suspending, removing, or restoring ordinary staff members.",
        permissions: ["manage_members"],
      },
      {
        id: "team-roles",
        th: "จัดการบทบาทและสิทธิ์",
        en: "Manage roles and permissions",
        descriptionTh: "อนุญาตให้สร้างบทบาท เปลี่ยนบทบาท และกำหนดสิทธิ์ที่ตนเองมี",
        descriptionEn: "Allow creating roles, assigning roles, and granting permissions the actor holds.",
        permissions: ["manage_roles"],
      },
      {
        id: "team-audit",
        th: "ดูประวัติการเปลี่ยนแปลง",
        en: "View audit log",
        descriptionTh: "อนุญาตให้ดูว่าใครเปลี่ยนคำเชิญ สมาชิก บทบาท และสิทธิ์เมื่อใด",
        descriptionEn: "Allow viewing who changed invitations, members, roles, and permissions.",
        permissions: ["view_audit_log"],
      },
    ],
  },
];

const HIDDEN_PERMISSION_KEYS = new Set(["view_menu", "manage_staff"]);
export const ALL_PERMISSION_KEYS: Permission[] = PERMISSION_SECTIONS.flatMap((section) => section.rows.flatMap((row) => row.permissions));
const LEGACY_STAFF_CAPABILITIES: Permission[] = [
  "manage_invites",
  "manage_members",
  "manage_roles",
  "view_audit_log",
  "manage_restaurant_settings",
];

export const PERMISSION_DEPENDENCIES: Partial<Record<Permission, Permission[]>> = {
  update_order_status: ["view_kitchen"],
  take_payment: ["view_orders"],
  manage_table: ["view_tables"],
  manage_inventory: ["view_inventory"],
};

function uniquePermissions(permissions: string[]) {
  return permissions.filter((permission, index) => permission && permissions.indexOf(permission) === index);
}

export function applyPermissionDependencies(current: string[], permission: Permission, enabled: boolean) {
  const next = new Set(current);
  if (enabled) {
    const addWithDependencies = (key: Permission) => {
      next.add(key);
      (PERMISSION_DEPENDENCIES[key] ?? []).forEach(addWithDependencies);
    };
    addWithDependencies(permission);
  } else {
    const removeWithDependents = (key: Permission) => {
      next.delete(key);
      (Object.entries(PERMISSION_DEPENDENCIES) as Array<[Permission, Permission[]]>).forEach(([dependent, prerequisites]) => {
        if (prerequisites.includes(key)) removeWithDependents(dependent);
      });
    };
    removeWithDependents(permission);
  }
  return Array.from(next);
}

export function normalizePermissionDependencies(current: string[]) {
  let next = uniquePermissions(current);
  (Object.keys(PERMISSION_DEPENDENCIES) as Permission[]).forEach((permission) => {
    if (next.includes(permission)) next = applyPermissionDependencies(next, permission, true);
  });
  return next;
}

export function replaceGrantablePermissionSelection(current: string[], grantable: string[], enabled: boolean) {
  const grantableSet = new Set(grantable);
  if (!enabled) return current.filter((permission) => !grantableSet.has(permission));
  return uniquePermissions([...current, ...grantable]);
}

export type PermissionTarget =
  | { type: "role"; role: Role }
  | { type: "member"; member: Membership };

export function isCustomRole(role: Role) {
  return !role.is_system && role.restaurant_id != null;
}

export function permissionSummary(role: Role | null | undefined, language: Language) {
  if (!role) return language === "th" ? "พื้นฐาน" : "Basic";
  if (role.permissions === `["*"]`) return language === "th" ? "ทุกเมนู" : "All access";
  try {
    const permissions = parsePermissions(role.permissions, role.name);
    if (!permissions.length) return language === "th" ? "พื้นฐาน" : "Basic";
    return language === "th" ? `${permissions.length} สิทธิ์` : `${permissions.length} permissions`;
  } catch {
    return language === "th" ? "พื้นฐาน" : "Basic";
  }
}

export function parsePermissions(raw: string | null | undefined, legacyRoleName?: string) {
  if (!raw) return [] as string[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const permissions = parsed.filter((permission): permission is string => typeof permission === "string");
    if ((legacyRoleName === "owner" || legacyRoleName === "manager") && permissions.includes("manage_staff")) {
      permissions.push(...LEGACY_STAFF_CAPABILITIES);
    }
    return normalizePermissionDependencies(stripHiddenPermissions(permissions));
  } catch {
    return [];
  }
}

export function stripHiddenPermissions(permissions: string[]) {
  return uniquePermissions(permissions.filter((permission) => !HIDDEN_PERMISSION_KEYS.has(permission)));
}

export function effectiveMemberPermissions(member: Membership) {
  return parsePermissions(member.permissions_override ?? member.role?.permissions, member.role?.name);
}

export function memberPermissionSummary(member: Membership, language: Language) {
  if (member.permissions_override == null) {
    return language === "th" ? "ใช้สิทธิ์ตามบทบาท" : "Uses role permissions";
  }
  const permissions = parsePermissions(member.permissions_override, member.role?.name);
  return language === "th" ? `กำหนดเอง ${permissions.length} สิทธิ์` : `Custom ${permissions.length} permissions`;
}

export function displayUserName(member: Membership, language: Language) {
  const user = member.user;
  if (!user) return language === "th" ? "สมาชิก" : "Member";
  if (user.nickname?.trim()) return user.nickname.trim();
  const parts = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part) => part && part !== "-");
  return parts.length ? parts.join(" ") : user.email;
}

export function formatDate(value: string | null | undefined, language: Language) {
  const fallback = language === "th" ? "ไม่กำหนด" : "No expiry";
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(language === "th" ? "th-TH" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function inviteUrl(token: string) {
  if (typeof window === "undefined") return `/invitations/${token}`;
  return `${window.location.origin}/invitations/${token}`;
}

export function inviteMailto(invitation: Invitation, language: Language) {
  const restaurantName = invitation.restaurant?.name ?? "Dishy";
  const subject = language === "th"
    ? `คำเชิญเข้าร่วมร้าน ${restaurantName}`
    : `Invitation to join ${restaurantName}`;
  const body = language === "th"
    ? [
        `สวัสดี${invitation.email ? ` ${invitation.email}` : ""},`,
        "",
        `คุณได้รับคำเชิญเข้าร่วมร้าน ${restaurantName} ในบทบาท ${roleLabel(invitation.role, language)}`,
        `เปิดลิงก์นี้เพื่อดูรายละเอียดและรับคำเชิญ: ${inviteUrl(invitation.token)}`,
        "",
        "หากลิงก์หมดอายุ กรุณาติดต่อผู้จัดการร้านเพื่อขอลิงก์ใหม่",
      ].join("\n")
    : [
        `Hello${invitation.email ? ` ${invitation.email}` : ""},`,
        "",
        `You have been invited to join ${restaurantName} as ${roleLabel(invitation.role, language)}.`,
        `Open this link to review and accept the invitation: ${inviteUrl(invitation.token)}`,
        "",
        "If the link expires, ask the restaurant manager for a new invitation.",
      ].join("\n");

  return `mailto:${encodeURIComponent(invitation.email)}?${new URLSearchParams({ subject, body }).toString()}`;
}

function parseAuditDetails(details: string) {
  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function auditMessage(log: RestaurantAuditLog, language: Language) {
  const details = parseAuditDetails(log.details);
  const roleName = typeof details.role_name === "string" ? details.role_name : "";
  const email = typeof details.email === "string" ? details.email : "";
  const fromStatus = typeof details.from_status === "string" ? details.from_status : "";
  const toStatus = typeof details.to_status === "string" ? details.to_status : "";
  const fromRole = typeof details.from_role === "string" ? details.from_role : "";
  const toRole = typeof details.to_role === "string" ? details.to_role : "";
  const roleDisplayName = [details.display_name, details.role_name, details.name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
  const fromName = [details.from_name, details.from, details.from_display_name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
  const toName = [details.to_name, details.to, details.to_display_name]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? "";
  const auditPermissions = Array.isArray(details.to_permissions) ? details.to_permissions : details.permissions;
  const permissionCount = Array.isArray(auditPermissions)
    ? auditPermissions.filter((permission) => typeof permission === "string").length
    : null;

  if (log.action === "invitation_created") {
    return language === "th"
      ? `สร้างคำเชิญ ${roleLabel(roleName, language)}${email ? ` · ${email}` : ""}`
      : `Created invitation for ${roleLabel(roleName, language)}${email ? ` · ${email}` : ""}`;
  }
  if (log.action === "invitation_revoked") {
    return language === "th" ? `ยกเลิกคำเชิญ${email ? ` · ${email}` : ""}` : `Revoked invitation${email ? ` · ${email}` : ""}`;
  }
  if (log.action === "invitation_accepted") {
    return language === "th"
      ? `รับคำเชิญเข้าร่วมร้าน${roleName ? ` เป็น ${roleLabel(roleName, language)}` : ""}`
      : `Accepted invitation${roleName ? ` as ${roleLabel(roleName, language)}` : ""}`;
  }
  if (log.action === "member_status_changed") {
    return language === "th"
      ? `เปลี่ยนสถานะสมาชิก ${STATUS_LABELS.th[fromStatus] ?? fromStatus} -> ${STATUS_LABELS.th[toStatus] ?? toStatus}`
      : `Changed member status ${STATUS_LABELS.en[fromStatus] ?? fromStatus} -> ${STATUS_LABELS.en[toStatus] ?? toStatus}`;
  }
  if (log.action === "member_role_changed") {
    return language === "th"
      ? `เปลี่ยนบทบาท ${ROLE_LABELS.th[fromRole] ?? fromRole} -> ${ROLE_LABELS.th[toRole] ?? toRole}`
      : `Changed role ${ROLE_LABELS.en[fromRole] ?? fromRole} -> ${ROLE_LABELS.en[toRole] ?? toRole}`;
  }
  if (log.action === "member_permissions_changed") {
    const usesRolePermissions = details.use_role_permissions === true;
    return language === "th"
      ? usesRolePermissions ? "คืนสิทธิ์สมาชิกให้ใช้ตามบทบาท" : "เปลี่ยนสิทธิ์เฉพาะสมาชิก"
      : usesRolePermissions ? "Reset member permissions to role defaults" : "Changed member-specific permissions";
  }
  if (log.action === "role_created") {
    return language === "th"
      ? `สร้างบทบาท${roleDisplayName ? ` · ${roleDisplayName}` : ""}`
      : `Created role${roleDisplayName ? ` · ${roleDisplayName}` : ""}`;
  }
  if (log.action === "role_renamed") {
    return language === "th"
      ? `เปลี่ยนชื่อบทบาท${fromName || toName ? ` ${fromName || "-"} -> ${toName || "-"}` : ""}`
      : `Renamed role${fromName || toName ? ` ${fromName || "-"} -> ${toName || "-"}` : ""}`;
  }
  if (log.action === "role_deleted") {
    return language === "th"
      ? `ลบบทบาท${roleDisplayName ? ` · ${roleDisplayName}` : ""}`
      : `Deleted role${roleDisplayName ? ` · ${roleDisplayName}` : ""}`;
  }
  if (log.action === "role_permissions_changed") {
    return language === "th"
      ? `เปลี่ยนสิทธิ์บทบาท${roleDisplayName ? ` · ${roleDisplayName}` : ""}${permissionCount == null ? "" : ` · ${permissionCount} สิทธิ์`}`
      : `Changed role permissions${roleDisplayName ? ` · ${roleDisplayName}` : ""}${permissionCount == null ? "" : ` · ${permissionCount} permissions`}`;
  }
  return log.action;
}

export function actorName(log: RestaurantAuditLog, language: Language) {
  const user = log.actor_user;
  if (!user) return language === "th" ? "ระบบ" : "System";
  if (user.nickname?.trim()) return user.nickname.trim();
  const parts = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part) => part && part !== "-");
  return parts.length ? parts.join(" ") : user.email;
}
