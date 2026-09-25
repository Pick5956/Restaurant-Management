import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseAIAssistant,
  getGuidedAIActions,
  getUnclearAIActions,
  resolveAIClarificationRequest,
  resolveAINavigationRequest,
} from './ai-actions.ts';
import {
  describeAIActionPreview,
  formatAIActionConfirmationMessage,
  getAIActionCancellationErrorMessage,
  isTerminalAIActionCancellationError,
} from './ai-action-preview.ts';

const permissions = (...allowed) => (permission) => allowed.includes(permission);

test('AI assistant access follows the backend owner-only contract', () => {
  assert.equal(canUseAIAssistant('owner'), true);
  assert.equal(canUseAIAssistant('manager'), false);
  assert.equal(canUseAIAssistant(undefined), false);

  assert.equal(
    resolveAINavigationRequest(
      'open ai assistant',
      permissions('view_reports', 'manage_inventory'),
      '/home',
      'en',
      false,
    ),
    null,
  );
  assert.equal(
    resolveAINavigationRequest(
      'open ai assistant',
      permissions('view_reports', 'manage_inventory'),
      '/home',
      'en',
      true,
    )?.href,
    '/ai-assistant',
  );
});

test('navigation requests stay client-side and respect route permissions', () => {
  const allowed = permissions('view_reports', 'view_inventory');
  assert.deepEqual(
    resolveAINavigationRequest('เปิดหน้ารายงาน', allowed, '/ai-assistant', 'th', true),
    {
      kind: 'navigate',
      href: '/reports',
      label: 'รายงาน',
      alreadyThere: false,
      message: 'พาไปหน้ารายงานให้แล้วครับ',
    },
  );
  assert.equal(resolveAINavigationRequest('เปิดหน้าครัว', allowed, '/ai-assistant', 'th', true), null);
  assert.equal(resolveAINavigationRequest('เมนูไหนขายดี', allowed, '/ai-assistant', 'th', true), null);
});

// The archive (/orders) is paid orders and needs view_orders, the gate its tab
// uses (orderRoutePermissions); the backend lets take_order read the active
// list only. The live orders are on the floor, so that is where "active orders"
// goes.
test('active orders lead to the floor, and take_order alone never opens the archive', () => {
  for (const request of ['open active orders', 'เปิดหน้าออเดอร์ที่กำลังทำ']) {
    const resolution = resolveAINavigationRequest(request, permissions('take_order'), '/home', 'en', true);
    assert.equal(resolution?.kind, 'navigate', request);
    assert.equal(resolution?.href, '/tables', request);
    assert.equal(resolution?.label, 'Order taking', request);
  }
  for (const request of ['open orders', 'open order archive', 'เปิดหน้าคลังออเดอร์']) {
    const resolution = resolveAINavigationRequest(request, permissions('take_order'), '/tables', 'en', true);
    assert.notEqual(resolution?.kind === 'navigate' ? resolution.href : null, '/orders', request);
    assert.ok(!(resolution?.kind === 'suggest' && resolution.options.some((option) => option.href === '/orders')), request);
  }
  assert.equal(
    resolveAINavigationRequest('open reports', permissions('take_order'), '/tables', 'en', true),
    null,
  );
});

// An owner can open both pages, so "orders" inside "active orders" used to score
// the archive close enough to turn a clear request into a two-way question.
test('for an owner with every permission, the longer alias decides between the floor and the archive', () => {
  const everything = () => true;
  for (const request of ['open active orders', 'เปิดหน้าออเดอร์ที่กำลังทำ']) {
    const resolution = resolveAINavigationRequest(request, everything, '/home', 'en', true);
    assert.equal(resolution?.kind, 'navigate', request);
    assert.equal(resolution?.href, '/tables', request);
  }
  // A short alias with no longer one around it still counts.
  for (const request of ['open orders', 'open order archive', 'เปิดหน้าคลังออเดอร์']) {
    const resolution = resolveAINavigationRequest(request, everything, '/home', 'en', true);
    assert.equal(resolution?.kind, 'navigate', request);
    assert.equal(resolution?.href, '/orders', request);
  }
});

test('view_orders opens the archive', () => {
  for (const request of ['open orders', 'open order archive', 'เปิดหน้าคลังออเดอร์']) {
    const resolution = resolveAINavigationRequest(request, permissions('view_orders'), '/home', 'en', true);
    assert.equal(resolution?.kind, 'navigate', request);
    assert.equal(resolution?.href, '/orders', request);
  }
});

test('the archive entry is gated by the tab\'s own permission list, not a copy of it', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./ai-actions.ts', import.meta.url), 'utf8');
  const entry = source.split(/\r?\n/).find((line) => line.includes("href: '/orders'")) ?? '';
  assert.match(entry, /permissions: orderRoutePermissions\b/);
  assert.doesNotMatch(entry, /'take_order'/);
});

test('short ambiguous topics offer clarification actions before calling the model', () => {
  const clarification = resolveAIClarificationRequest(
    'คลัง',
    permissions('view_inventory', 'view_reports'),
    'th',
    true,
  );
  assert.equal(clarification?.message, 'ต้องการเปิดคลัง หรือให้ช่วยตรวจวัตถุดิบที่เสี่ยงหมดครับ?');
  assert.deepEqual(clarification?.actions.map((action) => action.id), [
    'inventory-page',
    'inventory-risk',
  ]);
});

test('analysis replies expose permission-safe review actions with confirmation', () => {
  const actions = getGuidedAIActions(
    'ควรเติม stock อะไร',
    'วัตถุดิบใกล้หมด',
    permissions('view_inventory', 'view_reports'),
    'th',
    true,
  );
  assert.deepEqual(actions.map((action) => action.id), ['review-inventory', 'open-report']);
  assert.equal(actions[0].requiresConfirmation, true);
});

test('unclear requests offer bounded useful follow-ups', () => {
  const actions = getUnclearAIActions(permissions('view_reports', 'manage_menu'), 'th', true);
  assert.deepEqual(actions.map((action) => action.id), [
    'unclear-stock-risk',
    'unclear-sales-summary',
    'unclear-menu-page',
  ]);
});

test('non-owners never receive AI prompt actions even with report and inventory permissions', () => {
  const managerPermissions = permissions(
    'view_reports',
    'manage_inventory',
    'view_inventory',
    'manage_menu',
  );

  const clarification = resolveAIClarificationRequest(
    'คลัง',
    managerPermissions,
    'th',
    false,
  );
  assert.equal(clarification, null);
  assert.deepEqual(
    getGuidedAIActions('stock', 'วัตถุดิบใกล้หมด', managerPermissions, 'th', false),
    [],
  );
  assert.deepEqual(getUnclearAIActions(managerPermissions, 'th', false), []);
});

test('action preview presentation shows reviewed details without exposing its confirmation token', () => {
  const preview = {
    id: 'preview-1',
    action_type: 'set_menu_availability',
    status: 'pending',
    expires_at: '2026-08-03T12:30:00Z',
    confirmation_token: 'must-not-appear-in-presentation',
    summary: 'ข้อความสรุปจากเซิร์ฟเวอร์ที่ไม่ควรแสดง',
    target: { menu_item_id: 42, name: 'Pad Thai' },
    current: { is_available: true },
    requested: { is_available: false },
    warnings: ['คำเตือนจากเซิร์ฟเวอร์ที่ไม่ควรแสดง'],
  };

  const presentation = describeAIActionPreview(preview, 'en');
  assert.equal(presentation.title, 'Review before AI takes action');
  assert.equal(presentation.menuName, 'Pad Thai');
  assert.equal(presentation.currentValue, 'Available');
  assert.equal(presentation.requestedValue, 'Unavailable');
  assert.equal(presentation.summary, 'Change “Pad Thai” from available to unavailable.');
  assert.deepEqual(presentation.warnings, ['Customers cannot order it after confirmation.']);
  assert.equal(JSON.stringify(presentation).includes(preview.summary), false);
  assert.equal(JSON.stringify(presentation).includes(preview.warnings[0]), false);
  assert.equal(presentation.confirmLabel, 'Confirm change');
  assert.equal(JSON.stringify(presentation).includes(preview.confirmation_token), false);
});

test('confirmed canary actions produce a localized assistant result', () => {
  const confirmation = {
    action_id: 'preview-1',
    status: 'executed',
    replayed: true,
    executed_at: '2026-08-03T12:00:00Z',
    message: 'executed',
    result: { menu_item_id: 42, name: 'ผัดไทย', is_available: false },
  };

  assert.match(formatAIActionConfirmationMessage(confirmation, 'th'), /ปิดขาย/);
  assert.match(formatAIActionConfirmationMessage(confirmation, 'en'), /not run twice/);
});

test('action cancellation failures do not claim an unknown server-side state', () => {
  assert.equal(
    getAIActionCancellationErrorMessage('en'),
    'The server could not confirm cancellation. Check the preview status and try again.',
  );
  assert.equal(isTerminalAIActionCancellationError({ status: 404 }), true);
  assert.equal(isTerminalAIActionCancellationError({ status: 409 }), true);
  assert.equal(isTerminalAIActionCancellationError({ status: 410 }), true);
  assert.equal(isTerminalAIActionCancellationError({ status: 500 }), false);
});
