import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditKind,
  memberInitials,
  allowedRoleOptions,
  auditAttribution,
  auditMessage,
  canAccessTeam,
  canManageInvitations,
  canManageMembers,
  canManageRoles,
  canViewTeamAudit,
  canManageTarget,
  canManageTeam,
  canGrantRole,
  canFinishRoleNameEdit,
  DEFAULT_INVITATION_EXPIRY_DAYS,
  invitationEmailMismatch,
  INVITATION_EXPIRY_DAY_OPTIONS,
  invitationExpiryLabel,
  isInvitationUsableAt,
  invitationTokenFrom,
  roleEditorHeading,
  roleLabel,
  roleListMeta,
  roleSaveFailureMessage,
  resolvePermissionGroupTransition,
  staffCountSubtitle,
  staffStatusLabel,
  teamActivityCopy,
  userDisplayName,
} from './staff-workflow.ts';
import { permissionGroupsFor } from './permissions.ts';

function generatedInvitationToken() {
  return Array.from(
    { length: 32 },
    (_, index) => String.fromCodePoint(65 + (index % 26)),
  ).join('');
}

const role = (name, permissions = '[]', id = 1) => ({
  ID: id,
  name,
  display_name: '',
  permissions,
  is_system: true,
});

const membership = (name, permissions, override) => ({
  ID: 1,
  user_id: 10,
  restaurant_id: 20,
  role_id: 1,
  status: 'active',
  joined_at: '2026-07-29T00:00:00Z',
  permissions_override: override,
  role: role(name, permissions),
});

test('staff invitation expiry uses the same safe default and choices as web', () => {
  assert.equal(DEFAULT_INVITATION_EXPIRY_DAYS, 7);
  // staff/page.tsx:1183-1189 offers 1, 3, 7, 14 and no-expiry. There is no
  // 30-day choice on the web and there never was one.
  assert.deepEqual([...INVITATION_EXPIRY_DAY_OPTIONS], [1, 3, 7, 14, 0]);
});

test('team capabilities are independent while legacy manage_staff remains owner-manager compatible', () => {
  const owner = membership('owner', '["*"]');
  assert.equal(canManageInvitations(owner), true);
  assert.equal(canManageMembers(owner), true);
  assert.equal(canManageRoles(owner), true);
  assert.equal(canViewTeamAudit(owner), true);

  const inviteManager = membership('manager', '["manage_invites"]');
  assert.equal(canAccessTeam(inviteManager), true);
  assert.equal(canManageTeam(inviteManager), true);
  assert.equal(canManageInvitations(inviteManager), true);
  assert.equal(canManageMembers(inviteManager), false);
  assert.equal(canManageRoles(inviteManager), false);
  assert.equal(canViewTeamAudit(inviteManager), false);

  const legacyManager = membership('manager', '["manage_staff"]');
  assert.equal(canManageInvitations(legacyManager), true);
  assert.equal(canManageMembers(legacyManager), true);
  assert.equal(canManageRoles(legacyManager), true);
  assert.equal(canViewTeamAudit(legacyManager), true);

  assert.equal(canAccessTeam(membership('shift_lead', '["manage_members"]')), true);
  assert.equal(canManageMembers(membership('shift_lead', '["manage_members"]')), true);
  assert.equal(canAccessTeam(membership('waiter', '["manage_staff"]')), false);
  assert.equal(canAccessTeam(membership('manager', '["manage_invites"]', '[]')), false);
  assert.equal(canAccessTeam({ ...inviteManager, status: 'suspended' }), false);
  assert.equal(canAccessTeam(null), false);
});

test('member hierarchy prevents self-management and upward management', () => {
  assert.equal(canManageTarget('owner', 'manager', false), true);
  assert.equal(canManageTarget('owner', 'owner', false), false);
  assert.equal(canManageTarget('manager', 'waiter', false), true);
  assert.equal(canManageTarget('manager', 'manager', false), false);
  assert.equal(canManageTarget('manager', 'waiter', true), false);
  assert.equal(canManageTarget('waiter', 'chef', false), false);
  assert.equal(canManageTarget('shift_lead', 'chef', false, true), true);
  assert.equal(canManageTarget('shift_lead', 'manager', false, true), false);
  assert.equal(canManageTarget(undefined, 'chef', false), false);
});

test('assignable roles follow the same hierarchy as the backend', () => {
  const roles = [
    role('owner', '["*"]', 1),
    role('manager', '["manage_staff"]', 2),
    role('waiter', '["take_order"]', 3),
    { ...role('custom_1_shift_lead', '["take_order"]', 4), display_name: 'หัวหน้ากะ', is_system: false },
  ];

  assert.deepEqual(allowedRoleOptions('owner', roles).map((item) => item.name), [
    'manager',
    'waiter',
    'custom_1_shift_lead',
  ]);
  assert.deepEqual(allowedRoleOptions('manager', roles).map((item) => item.name), [
    'waiter',
    'custom_1_shift_lead',
  ]);
  assert.deepEqual(allowedRoleOptions('waiter', roles), []);
  assert.deepEqual(
    allowedRoleOptions('custom_1_shift_lead', roles, true).map((item) => item.name),
    ['waiter', 'custom_1_shift_lead'],
  );
});

test('delegated admins can assign only roles whose effective access they also possess', () => {
  const actor = membership(
    'custom_1_shift_lead',
    '["manage_invites","take_order","view_orders"]',
  );

  assert.equal(canGrantRole(actor, role('waiter', '["take_order"]')), true);
  assert.equal(canGrantRole(actor, role('cashier', '["take_payment"]')), false);
  assert.equal(canGrantRole(actor, role('viewer', '["view_orders"]')), true);
  assert.equal(
    canGrantRole(
      membership('custom_1_cash_lead', '["manage_invites","take_payment"]'),
      role('cashier', '["take_payment"]'),
    ),
    false,
  );
  assert.equal(canGrantRole(membership('owner', '["*"]'), role('manager', '["manage_staff"]')), true);
});

test('invitation token parsing accepts Dishy links and rejects malformed values', () => {
  const token = generatedInvitationToken();
  assert.equal(token.length, 32);
  assert.equal(invitationTokenFrom(token), token);
  assert.equal(invitationTokenFrom(`https://app.example.com/invitations/${token}/`), token);
  assert.equal(invitationTokenFrom(`dishy://invite/${token}?source=share`), token);
  assert.equal(invitationTokenFrom('https://app.example.com/invitations/not-a-token'), '');
  assert.equal(invitationTokenFrom('%E0%A4%A'), '');
  assert.equal(invitationTokenFrom(''), '');
});

test('email mismatch is case-insensitive and masked public previews stay non-blocking', () => {
  assert.equal(invitationEmailMismatch('staff@example.com', 'STAFF@example.com'), false);
  assert.equal(invitationEmailMismatch('staff@example.com', 'other@example.com'), true);
  assert.equal(invitationEmailMismatch('s***@e***.com', 'other@example.com'), false);
  assert.equal(invitationEmailMismatch('', 'other@example.com'), false);
  assert.equal(invitationEmailMismatch('staff@example.com', ''), false);
});

test('pending invitation links stop being shareable after their expiry time', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  assert.equal(isInvitationUsableAt({ status: 'pending', expires_at: null }, now), true);
  assert.equal(
    isInvitationUsableAt({ status: 'pending', expires_at: '2026-07-29T12:00:01Z' }, now),
    true,
  );
  assert.equal(
    isInvitationUsableAt({ status: 'pending', expires_at: '2026-07-29T12:00:00Z' }, now),
    false,
  );
  assert.equal(
    isInvitationUsableAt({ status: 'accepted', expires_at: '2026-07-30T12:00:00Z' }, now),
    false,
  );
  assert.equal(
    isInvitationUsableAt({ status: 'pending', expires_at: 'not-a-date' }, now),
    false,
  );
});

test('role and audit copy use restaurant language instead of internal role keys', () => {
  assert.equal(roleLabel('waiter'), 'พนักงานเสิร์ฟ');
  assert.equal(roleLabel({ ...role('custom_1_shift_lead'), display_name: 'หัวหน้ากะ' }), 'หัวหน้ากะ');
  assert.equal(roleLabel({ ...role('custom_1_runner'), display_name: '' }), 'custom_1_runner');
  assert.equal(roleLabel(null), 'พนักงาน');
  assert.equal(
    auditMessage({
      ID: 1,
      restaurant_id: 20,
      action: 'member_role_changed',
      details: '{"from_role":"waiter","to_role":"manager"}',
    }),
    'เปลี่ยนบทบาท พนักงานเสิร์ฟ → ผู้จัดการ',
  );
  assert.equal(
    auditMessage({
      ID: 2,
      restaurant_id: 20,
      action: 'invitation_created',
      details: '{"role_name":"chef","email":"cook@example.com"}',
    }),
    'สร้างคำเชิญ ครัว · cook@example.com',
  );
  assert.equal(
    auditMessage({
      ID: 3,
      restaurant_id: 20,
      action: 'invitation_revoked',
      details: '{"email":"cook@example.com"}',
    }),
    'ยกเลิกคำเชิญ · cook@example.com',
  );
  assert.equal(
    auditMessage({
      ID: 4,
      restaurant_id: 20,
      action: 'invitation_accepted',
      details: '{"role_name":"chef"}',
    }),
    'รับคำเชิญเข้าร่วมร้าน เป็น ครัว',
  );
  assert.equal(
    auditMessage({
      ID: 5,
      restaurant_id: 20,
      action: 'member_status_changed',
      details: '{"from_status":"active","to_status":"suspended"}',
    }),
    'เปลี่ยนสถานะสมาชิก ใช้งาน → ระงับ',
  );
  assert.equal(
    auditMessage({
      ID: 6,
      restaurant_id: 20,
      action: 'member_permissions_changed',
      details: '{}',
    }),
    'ปรับสิทธิ์เฉพาะพนักงาน',
  );
  assert.equal(
    auditMessage({
      ID: 7,
      restaurant_id: 20,
      action: 'role_created',
      details: '{"role_name":"หัวหน้ากะ"}',
    }),
    'สร้างบทบาท หัวหน้ากะ',
  );
  assert.equal(
    auditMessage({
      ID: 8,
      restaurant_id: 20,
      action: 'role_renamed',
      details: '{"from_name":"หัวหน้ากะ","to_name":"หัวหน้ารอบค่ำ"}',
    }),
    'เปลี่ยนชื่อบทบาท หัวหน้ากะ → หัวหน้ารอบค่ำ',
  );
  assert.equal(
    auditMessage({
      ID: 9,
      restaurant_id: 20,
      action: 'role_permissions_changed',
      details: '{"role_name":"หัวหน้ารอบค่ำ"}',
    }),
    'ปรับสิทธิ์บทบาท หัวหน้ารอบค่ำ',
  );
  assert.equal(
    auditMessage({
      ID: 10,
      restaurant_id: 20,
      action: 'role_deleted',
      details: '{"role_name":"หัวหน้ารอบค่ำ"}',
    }),
    'ลบบทบาท หัวหน้ารอบค่ำ',
  );
  assert.equal(
    auditMessage({
      ID: 11,
      restaurant_id: 20,
      action: 'unknown_action',
      details: 'not-json',
    }),
    'unknown_action',
  );
});

test('staff presentation copy stays concise and avoids repeating the activity section name', () => {
  assert.deepEqual(teamActivityCopy('th'), {
    sectionTitle: 'กิจกรรมล่าสุด',
    emptyTitle: 'ยังไม่มีกิจกรรม',
    emptyDetail: 'รายการเชิญและการแก้ไขทีมจะอยู่ที่นี่',
  });
  assert.deepEqual(teamActivityCopy('en'), {
    sectionTitle: 'Recent activity',
    emptyTitle: 'No activity yet',
    emptyDetail: 'Invites and team changes will appear here.',
  });
});

test('staff count subtitle hides loading and zero-invitation noise', () => {
  assert.equal(staffCountSubtitle(0, 0, true, true, 'th'), undefined);
  assert.equal(staffCountSubtitle(2, 0, true, true, 'th'), '2 คนในทีม');
  assert.equal(staffCountSubtitle(1, 0, true, false, 'th'), '1 คนในทีม');
  assert.equal(staffCountSubtitle(3, 2, true, false, 'th'), '3 คน · 2 คำเชิญ');
  assert.equal(staffCountSubtitle(3, 2, false, false, 'en'), '3 staff members');
});

test('role list metadata separates role type from permission count', () => {
  assert.deepEqual(roleListMeta(role('manager', '["view_orders","take_payment"]'), 'th'), {
    typeLabel: 'มาตรฐาน',
    permissionLabel: '2 สิทธิ์',
  });
  assert.deepEqual(roleListMeta({
    ...role('custom_1_shift_lead', '["take_order"]'),
    is_system: false,
  }, 'en'), {
    typeLabel: 'Custom',
    permissionLabel: '1 permission',
  });
  assert.deepEqual(roleListMeta(role('owner', '["*"]'), 'en'), {
    typeLabel: 'Standard',
    permissionLabel: 'All permissions',
  });
});

test('role editor heading leads with the role identity while editing', () => {
  assert.deepEqual(roleEditorHeading(false, null, 'th'), {
    title: 'เพิ่มบทบาท',
    subtitle: 'ตั้งชื่อและเลือกสิทธิ์',
  });
  assert.deepEqual(roleEditorHeading(true, role('manager'), 'th'), {
    title: 'ผู้จัดการ',
    subtitle: 'บทบาทมาตรฐาน · แก้ไขชื่อและสิทธิ์',
  });
  assert.deepEqual(roleEditorHeading(true, {
    ...role('custom_1_shift_lead'),
    display_name: 'หัวหน้ากะ',
    is_system: false,
  }, 'en'), {
    title: 'หัวหน้ากะ',
    subtitle: 'Custom role · Edit name and permissions',
  });
  assert.deepEqual(roleEditorHeading(true, null, 'en'), {
    title: 'Edit role',
    subtitle: undefined,
  });
});

test('restaurant role-name override wins without changing localized system defaults', () => {
  assert.equal(roleLabel({
    ...role('manager'),
    display_name: 'Manager',
  }, 'th'), 'ผู้จัดการ');
  assert.equal(roleLabel({
    ...role('manager'),
    display_name: 'Manager',
    display_name_override: 'หัวหน้าร้าน',
  }, 'th'), 'หัวหน้าร้าน');
  assert.equal(roleLabel({
    ...role('manager'),
    display_name: 'Manager',
    display_name_override: '  Floor lead  ',
  }, 'en'), 'Floor lead');
  assert.equal(roleLabel({
    ...role('custom_1_shift_lead'),
    display_name: 'หัวหน้ากะ',
    is_system: false,
  }, 'th'), 'หัวหน้ากะ');
});

test('role-name editing cannot finish with an empty draft', () => {
  assert.equal(canFinishRoleNameEdit(''), false);
  assert.equal(canFinishRoleNameEdit('   '), false);
  assert.equal(canFinishRoleNameEdit('  หัวหน้ากะ  '), true);
});

test('role save errors disclose when only the name was already saved', () => {
  assert.equal(
    roleSaveFailureMessage(false, 'permission denied', 'th'),
    'permission denied',
  );
  assert.equal(
    roleSaveFailureMessage(true, 'permission denied', 'th'),
    'บันทึกชื่อบทบาทแล้ว แต่บันทึกสิทธิ์ไม่สำเร็จ: permission denied',
  );
  assert.equal(
    roleSaveFailureMessage(true, '', 'en'),
    'Role name saved, but permissions could not be saved: Unable to save role',
  );
});

test('permission accordion keeps one group open and rapid taps resolve from current state', () => {
  assert.equal(resolvePermissionGroupTransition(0, 2), 2);
  assert.equal(resolvePermissionGroupTransition(2, 1), 1);
  assert.equal(resolvePermissionGroupTransition(1, 1), -1);

  const finalGroup = [1, 2, 2].reduce(resolvePermissionGroupTransition, 0);
  assert.equal(finalGroup, -1);
});

test('role, status, invitation expiry, permission, and audit labels support English', () => {
  assert.equal(roleLabel('waiter', 'en'), 'Waiter');
  assert.equal(roleLabel(null, 'en'), 'Staff');
  assert.equal(staffStatusLabel('suspended', 'en'), 'Suspended');
  assert.equal(invitationExpiryLabel(0, 'en'), 'Never expires');
  assert.equal(invitationExpiryLabel(14, 'en'), '14 days');
  assert.deepEqual(
    permissionGroupsFor('en').map((group) => group.title),
    ['Front of house & payments', 'Kitchen & service', 'Restaurant data', 'Team & permissions'],
  );
  assert.equal(
    permissionGroupsFor('en')[0].rows[0].label,
    'Take orders',
  );
  assert.equal(
    auditMessage({
      ID: 1,
      restaurant_id: 20,
      action: 'member_role_changed',
      details: '{"from_role":"waiter","to_role":"manager"}',
    }, 'en'),
    'Changed role Waiter → Manager',
  );
  assert.equal(
    auditMessage({
      ID: 2,
      restaurant_id: 20,
      action: 'member_status_changed',
      details: '{"from_status":"active","to_status":"suspended"}',
    }, 'en'),
    'Changed member status Active → Suspended',
  );
});

test('audit actor names prefer nickname, then full name, email, and system fallback', () => {
  assert.equal(userDisplayName({ nickname: 'โม', first_name: '', last_name: '', email: 'm@example.com' }), 'โม');
  assert.equal(userDisplayName({ nickname: '', first_name: 'Mali', last_name: 'Dee', email: 'm@example.com' }), 'Mali Dee');
  assert.equal(userDisplayName({ nickname: '', first_name: '', last_name: '', email: 'm@example.com' }), 'm@example.com');
  assert.equal(userDisplayName(undefined), 'ระบบ');
  assert.equal(userDisplayName(undefined, 'en'), 'System');
});

test('audit attribution names the affected member without repeating the actor', () => {
  const actor = {
    ID: 10,
    nickname: 'มะลิ',
    first_name: '',
    last_name: '',
    email: 'manager@example.com',
  };
  const target = {
    ID: 20,
    nickname: '',
    first_name: 'สมชาย',
    last_name: 'ใจดี',
    email: 'staff@example.com',
  };

  assert.equal(
    auditAttribution({
      actor_user_id: actor.ID,
      target_user_id: target.ID,
      actor_user: actor,
      target_user: target,
    }),
    'มะลิ · เป้าหมาย สมชาย ใจดี',
  );
  assert.equal(
    auditAttribution({
      actor_user_id: actor.ID,
      target_user_id: actor.ID,
      actor_user: actor,
      target_user: actor,
    }),
    'มะลิ',
  );
  assert.equal(
    auditAttribution({
      actor_user_id: actor.ID,
      actor_user: actor,
    }),
    'มะลิ',
  );
  assert.equal(
    auditAttribution({
      actor_user_id: actor.ID,
      target_user_id: target.ID,
      actor_user: actor,
      target_user: target,
    }, 'en'),
    'มะลิ · Target: สมชาย ใจดี',
  );
});

test('the assistant switching a menu reads as a sentence, not the raw action key', () => {
  const log = (isAvailable) => ({
    ID: 9,
    restaurant_id: 20,
    action: 'ai_set_menu_availability',
    details: JSON.stringify({ target_menu_item_name: 'ต้มยำกุ้งน้ำข้น', previous_availability: !isAvailable, is_available: isAvailable }),
  });
  assert.equal(auditMessage(log(false)), 'AI ปิดขายเมนู "ต้มยำกุ้งน้ำข้น"');
  assert.equal(auditMessage(log(true)), 'AI เปิดขายเมนู "ต้มยำกุ้งน้ำข้น"');
  assert.equal(auditMessage(log(true), 'en'), 'AI turned on "ต้มยำกุ้งน้ำข้น"');
  assert.equal(auditKind('ai_set_menu_availability'), 'ai');
  assert.equal(auditKind('role_renamed'), 'role');
  assert.equal(auditKind('something_new'), 'other');
});

test('member circles take the first letter of the first and last names', () => {
  assert.equal(memberInitials('กรกุล สุนทร'), 'กส');
  assert.equal(memberInitials('Test Owner'), 'TO');
  assert.equal(memberInitials('เอก'), 'อ');
  assert.equal(memberInitials('  mali  '), 'M');
  assert.equal(memberInitials(''), '?');
});
