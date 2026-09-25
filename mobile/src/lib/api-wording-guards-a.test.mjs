import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { roleSaveFailureMessage, staffFailureDetail } from './staff-workflow.ts';

// The rule: never show the API's own wording to a user. The kitchen, the
// floor, the overview, the booking screen and the staff screens printed
// err.message - "missing update_order_status permission", "role is still
// assigned to staff", "Request failed (530)" - straight under their red
// headings and in their toasts. Each display now goes through the screen's
// own mapper (open-table-error, reservation-error, table-error) or
// apiFailureDetail / staffFailureDetail, under the step's own title.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');

// What src/api/client.ts throws: an Error carrying the HTTP status and the raw body.
const apiError = (message, status, body) => Object.assign(new Error(message), {
  name: 'ApiError',
  status,
  ...(body === undefined ? {} : { details: JSON.stringify(body) }),
});

const SCREENS = [
  'app/kitchen.tsx',
  'app/tables.tsx',
  'app/home.tsx',
  'app/reservations.tsx',
  'app/table-reservation.tsx',
  'app/orders.tsx',
  'app/staff.tsx',
  'app/staff/invite.tsx',
  'app/staff/member.tsx',
  'app/staff/role.tsx',
  'app/staff/roles.tsx',
  'src/components/table-plan/add-tables-body.tsx',
  'src/components/table-plan/room-editor-body.tsx',
  'src/components/table-plan/table-editor-body.tsx',
];

// err.message, err?.message, error.message, mutationError.message, e.message,
// (err as Error).message, String(err) ... A mapper's own `failure.message` is
// the app's copy and does not match.
const FAILURE_NAME = String.raw`(?:\w*(?:err|error|Error)|e)`;
const RAW_MESSAGE = new RegExp([
  String.raw`\b${FAILURE_NAME}\??\.message\b`,
  String.raw`\(\s*${FAILURE_NAME}\s+as\s[^)]*\)\??\.message\b`,
  String.raw`\bString\(\s*${FAILURE_NAME}\b`,
].join('|'));

test('the raw-message pattern catches every spelling of a failure\'s own words', () => {
  for (const line of [
    'setError(err.message);',
    "setError(err?.message ?? '');",
    'mutationError.message',
    'reconciliationError?.message',
    'setError((err as Error).message);',
    'setError((error as ApiError)?.message);',
    'showToast({ title: e.message });',
    'setError(String(err));',
    "setError(String(error ?? ''));",
    'setError(String( e ));',
  ]) assert.match(line, RAW_MESSAGE, line);
  for (const line of [
    'detail: failure.message',
    'message: toast.message',
    'String(event.id)',
    'String(errorCount)',
    'item.message',
  ]) assert.doesNotMatch(line, RAW_MESSAGE, line);
});

test('no screen in this group shows a request failure\'s own message', async () => {
  for (const file of SCREENS) {
    const source = await read(file);
    const hit = source.split(/\r?\n/).find((line) => RAW_MESSAGE.test(line));
    assert.equal(hit, undefined, `${file} still shows the server's wording: ${hit?.trim()}`);
  }
});

test('staff-workflow reads the server\'s message only to classify it', async () => {
  const source = await read('src/lib/staff-workflow.ts');
  const start = source.indexOf('function staffRefusal(');
  const end = source.indexOf('\n}', start);
  assert.ok(start > 0 && end > start, 'staffRefusal not found');
  const outside = source.slice(0, start) + source.slice(end);
  assert.doesNotMatch(outside, RAW_MESSAGE);
});

// ---------------------------------------------------------------- call sites

test('the kitchen says the app\'s words for a failed load, tap, round and recall', async () => {
  const kitchen = await read('app/kitchen.tsx');
  assert.match(kitchen, /setError\(\{ detail: apiFailureDetail\(err, language\) \}\)/);
  assert.match(kitchen, /detail=\{error\.detail\}/);
  // A tap's failure arrives wrapped in a KitchenMutationError with no status;
  // the words come from the request failure inside it.
  assert.match(kitchen, /copy\('อัปเดตสถานะอาหารไม่สำเร็จ', 'Could not update the item'\),\s*apiFailureDetail\(kitchenFailureCause\(err\), language\)/);
  assert.match(kitchen, /const detail = mutationFailed \? apiFailureDetail\(mutationError, language\) : undefined;/);
  assert.match(kitchen, /apiFailureDetail\(reconciliationError, language\)/);
  assert.match(kitchen, /const detail = apiFailureDetail\(kitchenFailureCause\(err\), language\);/);
  // Values in one line take a comma, not a middle dot.
  assert.doesNotMatch(kitchen, / · \$\{detail\}| · หยุดอัปเดตเพราะ| · Update stopped/);
});

test('the floor and the overview put the app\'s line under their load title', async () => {
  for (const file of ['app/tables.tsx', 'app/home.tsx']) {
    const source = await read(file);
    assert.match(source, /setError\(\{ detail: apiFailureDetail\(err, language\) \}\)/, file);
    assert.match(source, /detail=\{error\.detail\}/, file);
  }
});

test('the booking screen goes through the open-table and reservation mappers', async () => {
  const screen = await read('app/table-reservation.tsx');
  assert.match(screen, /openTableFailure\(err, 'load', language\)/);
  assert.match(screen, /openTableFailure\(err, 'reserve', language\)/);
  assert.match(screen, /reservationFailure\(err, 'seat_hold', language\)/);
  assert.match(screen, /reservationFailure\(err, 'cancel', language\)/);
});

// The rule: a field's problem under its field, an action's outcome in a toast.
// The booking screen stacked every refusal into a panel on the page and never
// used the mapper's `field` or `stale`; only a failed load stays on the page now.
test('the booking screen puts the phone under the phone, the rest in a toast, and reloads a stale table', async () => {
  const screen = await read('app/table-reservation.tsx');
  // The one panel left is the failed load.
  assert.equal((screen.match(/<Feedback\b/g) || []).length, 1);
  assert.match(screen, /setLoadError\(\{ title: failure\.title, detail: failure\.message \}\)/);
  assert.match(screen, /title=\{loadError\.title\}\s*detail=\{loadError\.detail\}/);
  assert.doesNotMatch(screen, /\bsetError\(/);
  // The phone: the screen's own 9-digit floor and the server's refusal both
  // land on the field.
  assert.match(screen, /<TextField\s+error=\{phoneError\}\s+icon="call-outline"/);
  assert.match(screen, /setPhoneError\(copy\('กรอกเบอร์โทรอย่างน้อย 9 หลัก', 'Enter a phone number with at least 9 digits\.'\)\)/);
  assert.match(screen, /if \(failure\.field === 'phone'\) setPhoneError\(failure\.message \?\? failure\.title\);\s*else showToast\(\{ tone: 'error', title: failure\.title, message: failure\.message \}\);/);
  // Reserve (when not the phone), seat and cancel each raise a toast.
  assert.equal((screen.match(/showToast\(\{ tone: 'error', title: failure\.title, message: failure\.message \}\)/g) || []).length, 3);
  // A table that changed underneath is let go and the floor read again.
  assert.match(screen, /if \(failure\.stale\) \{\s*setTableId\(0\);\s*reloadTables\(\);\s*\}/);
  assert.equal((screen.match(/if \(failure\.reload\)/g) || []).length, 2);
  assert.match(screen, /const reloadTables = \(\) => setReloadKey\(\(key\) => key \+ 1\);/);
  assert.match(screen, /\}, \[canTakeOrder, language, rawId, reloadKey\]\);/);
});

// Item: waiter A types a name, waiter B books the same table first, A's reserve
// is refused as stale and the floor reloads. The table was still chosen, so the
// screen turned into B's booking - showing A's typed name, and seating it sent
// A's name for the order. The booking card and the seat request read the table
// row only, and a stale refusal lets the table go so A picks another.
test('a booked table is shown and seated under its own booking, never the words typed here', async () => {
  const screen = (await read('app/table-reservation.tsx')).replace(/\r\n/g, '\n');
  const start = screen.indexOf('{isReserved ? (');
  const end = screen.indexOf('\n        ) : (', start);
  assert.ok(start > 0 && end > start, 'the booking card was not found');
  const card = screen.slice(start, end);
  assert.match(card, /\{selected\?\.reservation_name \|\| copy\('ไม่ระบุชื่อ', 'No guest name'\)\}/);
  assert.match(card, /\{selected\?\.reservation_phone \|\| copy\('ไม่มีเบอร์โทร', 'No phone'\)\}/);
  // Neither the typed name nor the typed phone reaches the card.
  assert.doesNotMatch(card, /(?:\{|\|\|)\s*(?:name|phone)\s*(?:\}|\|\|)/);
  assert.match(screen, /customerName: selected\.reservation_name,\s*customerPhone: selected\.reservation_phone,/);
});

// The first load seeds the form from the table the floor sent us to. A reload -
// the one a stale refusal triggers - must not, or it puts back the table the
// refusal let go and overwrites the typed name with the other booking's.
test('the booking screen seeds its form from the floor once, never on a reload', async () => {
  const screen = (await read('app/table-reservation.tsx')).replace(/\r\n/g, '\n');
  // null, not undefined: arriving with no table still counts as the one seed.
  assert.match(screen, /const seededFor = useRef<string \| undefined \| null>\(null\);/);
  const load = screen.indexOf('listTables()');
  const head = '.then((response) => {';
  const open = screen.indexOf(head, load);
  const close = screen.indexOf('\n      })\n      .catch(', open);
  assert.ok(load > 0 && open > load && close > open, 'the table load was not found');
  const onLoad = new Function(
    'active', 'setTables', 'setLoadError', 'seededFor', 'rawId', 'setTableId', 'setName', 'setPhone', 'setGuestCount', 'defaultGuestCount', 'response',
    screen.slice(open + head.length, close),
  );
  const seededFor = { current: null };
  const load7 = (tables) => {
    const calls = [];
    const record = (name) => (value) => calls.push([name, value]);
    onLoad(true, record('tables'), record('loadError'), seededFor, '7', record('tableId'), record('name'), record('phone'), record('guestCount'), () => '2', { tables });
    return calls;
  };
  const free = [{ ID: 7, status: 'free', reservation_name: '', reservation_phone: '' }];
  assert.deepEqual(load7(free), [
    ['tables', free], ['loadError', null], ['tableId', 7], ['guestCount', '2'],
  ]);
  // Another waiter booked T7 first: the rows are read again, the form is not.
  const booked = [{ ID: 7, status: 'reserved', reservation_name: 'คุณบี', reservation_phone: '0899999999' }];
  assert.deepEqual(load7(booked), [['tables', booked], ['loadError', null]]);
  // Arriving at a booked table never copies its guest into the typing fields:
  // the card reads the table row, and the fields are for a new booking only.
  seededFor.current = null;
  assert.deepEqual(load7(booked), [
    ['tables', booked], ['loadError', null], ['tableId', 7], ['guestCount', '2'],
  ]);
});

// A stale refusal lets the table go so the waiter picks another "with the name
// and phone still typed in". Picking one used to reset both to that table's
// booking - blank for a free table - so the words were lost on the next tap.
test('picking another table keeps the name and phone the waiter typed', async () => {
  const screen = (await read('app/table-reservation.tsx')).replace(/\r\n/g, '\n');
  const head = '  function choose(id: number) {\n';
  const open = screen.indexOf(head);
  const close = screen.indexOf('\n  }\n', open);
  assert.ok(open > 0 && close > open, 'choose() was not found');
  const choose = new Function(
    'tables', 'setTableId', 'setName', 'setPhone', 'setGuestCount', 'defaultGuestCount', 'setConfirmCancel', 'setPhoneError', 'id',
    screen.slice(open + head.length, close),
  );
  const calls = [];
  const record = (name) => (value) => calls.push([name, value]);
  const tables = [{ ID: 3, status: 'free', reservation_name: '', reservation_phone: '' }];
  choose(tables, record('tableId'), record('name'), record('phone'), record('guestCount'), () => '4', record('confirmCancel'), record('phoneError'), 3);
  assert.deepEqual(calls, [['tableId', 3], ['guestCount', '4'], ['confirmCancel', false], ['phoneError', null]]);
});

// A missing role name is the name field's problem: it sits under that field and
// goes when the owner types, never in the page's panel under "ทำรายการไม่ได้".
test('the role editor says an empty name under the name field', async () => {
  const role = (await read('app/staff/role.tsx')).replace(/\r\n/g, '\n');
  const start = role.indexOf('function finishNameEditing(');
  const finish = role.slice(start, role.indexOf('\n  }\n', start));
  assert.ok(start > 0 && finish.length > 0, 'finishNameEditing was not found');
  assert.match(finish, /setNameError\(copy\('กรอกชื่อบทบาทก่อน', 'Enter a role name first\.'\)\);/);
  assert.doesNotMatch(finish, /setError\(/);
  assert.doesNotMatch(role, /ทำรายการไม่ได้|Unable to complete action/);
  // Under the field it is about, drawn the way TextField draws a field's problem.
  assert.match(role, /value=\{name\}\s*\/>\s*\{nameError \? <Text selectable style=\{\[typeScale\.caption, \{ color: palette\.danger, textAlign: 'center' \}\]\}>\{nameError\}<\/Text> : null\}/);
  // Typing in any of the name's fields clears it.
  const edits = role.match(/onChangeText=\{\(value\) => \{ setName\(value\);[^}]*\}\}/g) || [];
  assert.equal(edits.length, 3);
  for (const edit of edits) assert.match(edit, /setNameError\(null\)/, edit);
});

test('the staff screens go through staffFailureDetail at every failure', async () => {
  const expected = {
    'app/staff.tsx': [/staffFailureDetail\(err, 'load', language\)/, /staffFailureDetail\(err, 'revoke_invitation', language\)/],
    'app/staff/invite.tsx': [/staffFailureDetail\(err, 'load', language\)/, /staffFailureDetail\(err, 'create_invitation', language\)/],
    'app/staff/roles.tsx': [/setError\(\{ detail: staffFailureDetail\(err, 'load', language\) \}\)/],
    'app/staff/role.tsx': [
      /staffFailureDetail\(err, 'load', language\)/,
      // The step's own title, not "ทำรายการไม่ได้".
      /title: editing\s*\? copy\('บันทึกบทบาทไม่สำเร็จ', 'Unable to save role'\)\s*: copy\('เพิ่มบทบาทไม่สำเร็จ', 'Unable to add role'\),\s*detail: roleSaveFailureMessage\(\s*nameSaved,\s*staffFailureDetail\(err, 'save_role', language\),/,
      /setDeleteError\(staffFailureDetail\(err, 'delete_role', language\)/,
    ],
    'app/staff/member.tsx': [/setError\(\{ detail: staffFailureDetail\(err, 'load', language\) \}\)/],
  };
  for (const [file, patterns] of Object.entries(expected)) {
    const source = await read(file);
    for (const pattern of patterns) assert.match(source, pattern, `${file}: ${pattern}`);
  }
});

// Item: restoring a removed member whose role was deleted since. The step has
// to be known at the call, because the same words from a role change mean
// something else.
test('the member screen names the restore step when it brings a removed member back', async () => {
  const member = await read('app/staff/member.tsx');
  assert.match(member, /let step: StaffFailureStep = 'save_member';/);
  assert.match(member, /if \(updated\.status === 'removed'\) step = 'restore_member';\s*updated = \(await updateMemberStatus\(/);
  assert.match(member, /actionFailed\(copy\('บันทึกพนักงานไม่สำเร็จ', 'Unable to save staff details'\), staffFailureDetail\(err, step, language\)\)/);
});

// ---------------------------------------------------------------- the words

test('a removed member whose role was deleted is sent back through an invitation', () => {
  const byCode = apiError('role is not available for this restaurant', 400, { error: 'role is not available for this restaurant', code: 'role_unavailable' });
  assert.equal(staffFailureDetail(byCode, 'restore_member', 'th'), 'บทบาทเดิมของพนักงานคนนี้ถูกลบไปแล้ว ให้เชิญเข้าร้านใหม่');
  assert.equal(staffFailureDetail(byCode, 'restore_member', 'en'), 'Their old role has been deleted. Invite them again.');
  // A backend that has not shipped the code yet still says the words.
  const byMessage = apiError('role is not available for this restaurant', 400, { error: 'role is not available for this restaurant', code: 'bad_request' });
  assert.equal(staffFailureDetail(byMessage, 'restore_member', 'th'), 'บทบาทเดิมของพนักงานคนนี้ถูกลบไปแล้ว ให้เชิญเข้าร้านใหม่');
  // The same words from a role change are not about an invitation.
  assert.equal(staffFailureDetail(byMessage, 'save_member', 'th'), undefined);
});

test('the staff refusals an owner can act on get the app\'s words', () => {
  assert.equal(staffFailureDetail(apiError('role is still assigned to staff', 400), 'delete_role', 'th'), 'ยังมีพนักงานใช้บทบาทนี้อยู่');
  assert.equal(staffFailureDetail(apiError('role is used by pending invitations', 400), 'delete_role', 'th'), 'ยังมีคำเชิญที่ใช้บทบาทนี้อยู่');
  assert.equal(staffFailureDetail(apiError('invalid invitation email', 400), 'create_invitation', 'th'), 'อีเมลไม่ถูกต้อง');
  assert.equal(staffFailureDetail(apiError('only pending invitations can be revoked', 400), 'revoke_invitation', 'th'), 'คำเชิญนี้ถูกใช้หรือยกเลิกไปแล้ว');
});

test('the failures every screen shares fall through to apiFailureDetail, and anything else says nothing', () => {
  assert.equal(staffFailureDetail(apiError('missing manage_members permission', 403), 'save_member', 'th'), 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  assert.equal(staffFailureDetail(new Error('Network request failed'), 'load', 'en'), 'Cannot reach the server. Check the connection and try again.');
  assert.equal(staffFailureDetail(apiError('Request failed (530)', 530), 'load', 'th'), 'ระบบขัดข้องชั่วคราว');
  for (const raw of ['pq: deadlock detected', 'cannot grant permissions you do not possess', 'role name is required']) {
    const detail = staffFailureDetail(apiError(raw, 400), 'save_role', 'th');
    assert.equal(detail, undefined, raw);
  }
  assert.equal(staffFailureDetail(undefined, 'load', 'th'), undefined);
});

// The title is already "บันทึกบทบาทไม่สำเร็จ": the line under it never says it
// again, and says nothing at all when the app has nothing to add.
test('a failed role save never carries the server\'s words, nor its own title twice', () => {
  const unmapped = staffFailureDetail(apiError('pq: deadlock detected', 400), 'save_role', 'th');
  assert.equal(roleSaveFailureMessage(false, unmapped, 'th'), undefined);
  assert.equal(roleSaveFailureMessage(true, unmapped, 'th'), 'บันทึกชื่อบทบาทแล้ว แต่บันทึกสิทธิ์ไม่สำเร็จ');
  assert.equal(roleSaveFailureMessage(true, unmapped, 'en'), 'Role name saved, but permissions could not be saved');
  const denied = staffFailureDetail(apiError('missing manage_roles permission', 403), 'save_role', 'th');
  assert.equal(roleSaveFailureMessage(false, denied, 'th'), 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  assert.equal(
    roleSaveFailureMessage(true, denied, 'th'),
    'บันทึกชื่อบทบาทแล้ว แต่บันทึกสิทธิ์ไม่สำเร็จ: บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
  );
  for (const nameSaved of [false, true]) {
    assert.doesNotMatch(roleSaveFailureMessage(nameSaved, unmapped, 'th') ?? '', /บันทึกบทบาทไม่สำเร็จ/);
  }
});

test('the guard runs with the rest of the suite', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.test, /src\/lib\/api-wording-guards-a\.test\.mjs/);
});

// The role screen's subtitle says which kind of role it is and nothing else:
// "แตะดินสอเพื่อเปลี่ยนชื่อ" explained the pencil beside it, and a new role
// was captioned with how to fill the form in.
test('the role screen subtitle is the role kind, never a hint', async () => {
  const role = (await read('app/staff/role.tsx')).replace(/\r\n/g, '\n');
  assert.match(role, /subtitle=\{editing \? \(role\?\.is_system \? copy\('บทบาทมาตรฐาน', 'Standard role'\) : copy\('บทบาทที่ร้านสร้าง', 'Custom role'\)\) : undefined\}/);
  assert.doesNotMatch(role, /แตะดินสอ|tap the pencil|ตั้งชื่อแล้วเปิดสิทธิ์/);
});
