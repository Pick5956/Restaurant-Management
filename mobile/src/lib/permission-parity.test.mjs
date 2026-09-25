import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  inventoryItemAccess,
  kitchenAccess,
  orderArchiveFailureDetail,
  orderDetailLoadResources,
  orderListAccess,
  orderListRequest,
  orderRoutePermissions,
  tableManagementAccess,
} from './permission-parity.ts';
import {
  allPermissions,
  normalizePermissionSelection,
  parsePermissionsForRole,
  permissionCanBeGranted,
  permissionGroupsFor,
  shouldUpdateMemberPermissions,
  togglePermissionSelection,
} from './permissions.ts';
import { can } from './rbac.ts';
import { parsePositiveRouteId } from './route-id.ts';

test('cashier order detail loads only the order while order takers also load menu resources', () => {
  assert.deepEqual(orderDetailLoadResources(false), ['order']);
  assert.deepEqual(orderDetailLoadResources(true), ['order', 'menu', 'categories']);
});

test('table viewers can open the management list without receiving mutation access', () => {
  assert.deepEqual(tableManagementAccess(true, false), {
    canView: true,
    canMutate: false,
  });
  assert.deepEqual(tableManagementAccess(false, true), {
    canView: true,
    canMutate: true,
  });
});

test('inventory viewers can open existing items read-only but cannot create new items', () => {
  assert.equal(inventoryItemAccess(true, true, false), 'read');
  assert.equal(inventoryItemAccess(false, true, false), 'denied');
  assert.equal(inventoryItemAccess(true, false, true), 'edit');
  assert.equal(inventoryItemAccess(false, false, true), 'edit');
});

test('kitchen queue visibility never falls back to update permission', () => {
  assert.deepEqual(kitchenAccess(false, true), {
    canView: false,
    canUpdate: true,
  });
  assert.deepEqual(kitchenAccess(true, false), {
    canView: true,
    canUpdate: false,
  });
});

test('legacy view_menu permission remains valid for a read-only menu catalog', () => {
  const membership = {
    status: 'active',
    role: {
      name: 'legacy_menu_viewer',
      permissions: '["view_menu"]',
    },
  };

  assert.equal(can(membership, 'view_menu'), true);
  assert.equal(can(membership, 'manage_menu'), false);
  assert.equal(can(membership, 'take_order'), false);
});

test('expense management stays in the editable mobile permission registry', () => {
  assert.equal(allPermissions.includes('manage_expenses'), true);
  assert.equal(
    permissionGroupsFor('en')
      .flatMap((group) => group.rows)
      .some((row) => row.key === 'manage_expenses' && row.label === 'Manage expenses'),
    true,
  );
  assert.equal(
    permissionGroupsFor('en')
      .flatMap((group) => group.rows)
      .find((row) => row.key === 'view_reports')?.label,
    'View reports',
  );
});

test('promotion management stays in the editable mobile permission registry', () => {
  assert.equal(allPermissions.includes('manage_promotions'), true);
  assert.equal(
    permissionGroupsFor('th')
      .flatMap((group) => group.rows)
      .find((row) => row.key === 'manage_promotions')?.label,
    'จัดการโปรโมชัน',
  );
});

test('team and restaurant administration use granular editable permissions', () => {
  const rows = permissionGroupsFor('en').flatMap((group) => group.rows);
  for (const key of [
    'manage_invites',
    'manage_members',
    'manage_roles',
    'view_audit_log',
    'manage_restaurant_settings',
  ]) {
    assert.equal(allPermissions.includes(key), true, `${key} should be editable`);
    assert.equal(rows.some((row) => row.key === key), true, `${key} should have a label`);
  }
  assert.equal(allPermissions.includes('manage_staff'), false);
});

test('permission dependencies are added before a role or member override is saved', () => {
  assert.deepEqual(
    normalizePermissionSelection([
      'update_order_status',
      'take_payment',
      'manage_table',
      'manage_inventory',
    ]),
    [
      'take_payment',
      'view_kitchen',
      'update_order_status',
      'view_orders',
      'view_tables',
      'manage_table',
      'view_inventory',
      'manage_inventory',
    ],
  );
});

test('unchecking a prerequisite also removes permissions that depend on it', () => {
  for (const [prerequisite, dependent] of [
    ['view_kitchen', 'update_order_status'],
    ['view_orders', 'take_payment'],
    ['view_tables', 'manage_table'],
    ['view_inventory', 'manage_inventory'],
  ]) {
    assert.deepEqual(
      togglePermissionSelection([prerequisite, dependent], prerequisite),
      [],
      `${dependent} should be removed with ${prerequisite}`,
    );
    assert.deepEqual(
      togglePermissionSelection([prerequisite, dependent], dependent),
      [prerequisite],
      `${prerequisite} should remain when ${dependent} is removed`,
    );
  }
  assert.deepEqual(
    togglePermissionSelection(['future_permission'], 'take_payment'),
    ['take_payment', 'view_orders', 'future_permission'],
  );
});

test('a delegated editor cannot select a permission when it lacks a required prerequisite', () => {
  assert.equal(
    permissionCanBeGranted('take_payment', ['take_payment']),
    false,
  );
  assert.equal(
    permissionCanBeGranted('take_payment', ['take_payment', 'view_orders']),
    true,
  );
});

test('status-only saves do not rewrite unchanged member access or race a role reset', () => {
  const unchanged = {
    roleChanged: false,
    previousUsesRolePermissions: false,
    useRolePermissions: false,
    previousPermissions: ['future_permission'],
    selectedPermissions: ['future_permission'],
  };
  assert.equal(shouldUpdateMemberPermissions(unchanged), false);
  assert.equal(shouldUpdateMemberPermissions({
    ...unchanged,
    useRolePermissions: true,
  }), true);
  assert.equal(shouldUpdateMemberPermissions({
    ...unchanged,
    roleChanged: true,
    useRolePermissions: true,
  }), false);
  assert.equal(shouldUpdateMemberPermissions({
    ...unchanged,
    roleChanged: true,
    useRolePermissions: false,
  }), true);
});

test('legacy manage_staff does not become delegated administration for operational roles', () => {
  const legacyManager = {
    status: 'active',
    role: { name: 'manager', permissions: '["manage_staff"]' },
  };
  const legacyShiftLead = {
    status: 'active',
    role: { name: 'custom_shift_lead', permissions: '["manage_staff"]' },
  };

  assert.equal(can(legacyManager, 'manage_roles'), true);
  assert.equal(can(legacyManager, 'manage_restaurant_settings'), true);
  assert.equal(can(legacyShiftLead, 'manage_roles'), false);
  assert.equal(can(legacyShiftLead, 'manage_restaurant_settings'), false);
});

test('legacy manager permission data is expanded only when editing protected manager defaults', () => {
  assert.deepEqual(
    parsePermissionsForRole('["manage_staff","view_orders"]', 'manager'),
    [
      'view_orders',
      'manage_restaurant_settings',
      'manage_invites',
      'manage_members',
      'manage_roles',
      'view_audit_log',
    ],
  );
  assert.deepEqual(
    parsePermissionsForRole('["manage_staff","view_orders"]', 'custom_shift_lead'),
    ['view_orders'],
  );
});

test('legacy manager fallback includes the backend expense permission', () => {
  const membership = {
    status: 'active',
    role: {
      name: 'manager',
      permissions: '',
    },
  };

  assert.equal(can(membership, 'manage_expenses'), true);
});

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(mobileRoot, '..');
const orderController = path.join(repoRoot, 'backend', 'internal', 'controller', 'order.go');

// 2026-09-24: a member with take_order but not view_orders was offered the
// archive (the nav row and the screen both accepted either permission), the
// server refused its paid-orders query, and the screen printed the server's
// English 403 under its heading.
test('the archive is offered only with view_orders, the one permission the server answers it for', () => {
  assert.deepEqual(orderRoutePermissions, ['view_orders']);
  assert.equal(orderListAccess(true), 'archive');
  assert.equal(orderListAccess(false), 'denied');
});

test('the server still refuses take_order anything but the active list', { skip: !existsSync(orderController) && 'backend not checked out' }, () => {
  // If this starts failing, the server may have opened the paid list to
  // take_order: reopen the archive to it here rather than keep it hidden.
  const order = readFileSync(orderController, 'utf8');
  const listAccess = order.slice(order.indexOf('func requireOrderListAccess'), order.indexOf('func requireOrderReadAccess'));
  assert.match(listAccess, /if memberCan\(c, "view_orders"\) \{\s*return true\s*\}/);
  assert.match(listAccess, /memberCan\(c, "take_order"\) &&\s*normalizedOrderListStatus\(c\) == "active"/);
});

test('the archive screen gates on view_orders alone and never prints the server\'s words', () => {
  const screen = readFileSync(path.join(mobileRoot, 'app', 'orders.tsx'), 'utf8');
  assert.match(screen, /const access = orderListAccess\(canViewOrders\);/);
  assert.doesNotMatch(screen, /canTakeOrder/);
  assert.doesNotMatch(screen, /err\.message/);
  assert.match(screen, /setFailure\(\{ detail: orderArchiveFailureDetail\(err, language\) \}\);/);
  assert.match(screen, /detail=\{failure\.detail\}/);
});

test('a failed archive load says the app\'s words, or nothing after its title', () => {
  const apiError = (message, status) => Object.assign(new Error(message), { name: 'ApiError', status });
  assert.equal(
    orderArchiveFailureDetail(apiError('missing view_orders permission or operational take_order query', 403), 'th'),
    'บัญชีนี้ไม่มีสิทธิ์ดูคลังออเดอร์',
  );
  assert.equal(
    orderArchiveFailureDetail(apiError('missing view_orders permission or operational take_order query', 403), 'en'),
    'This account cannot view the order archive.',
  );
  assert.equal(orderArchiveFailureDetail(apiError('Request failed (530)', 530), 'th'), 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง');
  assert.equal(orderArchiveFailureDetail(new TypeError('Network request failed'), 'th'), 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  assert.equal(orderArchiveFailureDetail(new TypeError('Network request failed'), 'en'), 'Cannot reach the server. Check the connection and try again.');
  // Anything else: the title "โหลดคลังออเดอร์ไม่ได้" stands alone.
  assert.equal(orderArchiveFailureDetail(apiError('invalid date', 400), 'th'), undefined);
  assert.equal(orderArchiveFailureDetail(undefined, 'th'), undefined);
});

test('the archive asks for paid orders only, never a status filter', () => {
  assert.deepEqual(
    orderListRequest('archive', {
      search: ' OR-42 ',
      page: 3,
      limit: 25,
    }),
    {
      payment_status: 'paid',
      search: 'OR-42',
      page: 3,
      limit: 25,
    },
  );
});

test('an empty search is sent as an empty string rather than a stray filter', () => {
  assert.deepEqual(
    orderListRequest('archive', { page: 1, limit: 25 }),
    { payment_status: 'paid', search: '', page: 1, limit: 25 },
  );
  assert.deepEqual(
    orderListRequest('archive', { search: '   ', page: 1, limit: 25 }),
    { payment_status: 'paid', search: '', page: 1, limit: 25 },
  );
});

test('a chosen day travels as the date filter and an unchosen one sends nothing', () => {
  assert.deepEqual(
    orderListRequest('archive', { date: '2026-09-16', page: 1, limit: 25 }),
    { payment_status: 'paid', search: '', date: '2026-09-16', page: 1, limit: 25 },
  );
  assert.deepEqual(
    orderListRequest('archive', { date: null, page: 1, limit: 25 }),
    { payment_status: 'paid', search: '', page: 1, limit: 25 },
  );
});

test('no permission means no request at all', () => {
  assert.equal(orderListRequest('denied', { page: 1, limit: 25 }), null);
});

test('positive route IDs distinguish an omitted create-mode ID from a malformed ID', () => {
  assert.deepEqual(parsePositiveRouteId(undefined), { kind: 'missing' });
  assert.deepEqual(parsePositiveRouteId(null), { kind: 'missing' });

  assert.deepEqual(parsePositiveRouteId('1'), { kind: 'valid', id: 1 });
  assert.deepEqual(parsePositiveRouteId(' 42 '), { kind: 'valid', id: 42 });
  assert.deepEqual(parsePositiveRouteId(7), { kind: 'valid', id: 7 });

  for (const value of [
    '',
    ' ',
    '0',
    '-1',
    '1.5',
    '1e2',
    '12abc',
    'NaN',
    0,
    -2,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    ['3'],
    true,
  ]) {
    assert.deepEqual(parsePositiveRouteId(value), { kind: 'invalid' });
  }
});
