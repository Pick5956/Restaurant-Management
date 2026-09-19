import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  resolveHomeRestaurantIdentity,
  runManualRefresh,
  shouldShowTabletWorkspaceRail,
} from './app-shell-runtime.ts';
import { palette } from './theme-palette.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function tsxFilesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(target);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [target] : [];
  }));
  return files.flat();
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    ));

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

test('mobile surfaces and primary navigation use an accessible orange-forward palette', () => {
  assert.deepEqual({
    canvas: palette.canvas,
    surface: palette.surface,
    surfaceSubtle: palette.surfaceSubtle,
    surfaceStrong: palette.surfaceStrong,
    border: palette.border,
    controlBorder: palette.controlBorder,
    primary: palette.primary,
    accent: palette.accent,
    navigationSurface: palette.navigationSurface,
    navigationActive: palette.navigationActive,
  }, {
    canvas: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceSubtle: '#FFF4E8',
    surfaceStrong: '#FFEDD5',
    border: '#FED7AA',
    controlBorder: '#C77948',
    primary: '#C2410C',
    accent: '#C2410C',
    navigationSurface: '#9A3412',
    navigationActive: '#FFEDD5',
  });

  assert.ok(contrastRatio(palette.primaryText, palette.primary) >= 4.5);
  assert.ok(contrastRatio(palette.text, palette.canvas) >= 4.5);
  assert.ok(contrastRatio(palette.muted, palette.surfaceStrong) >= 4.5);
  assert.ok(contrastRatio(palette.placeholder, palette.surfaceSubtle) >= 4.5);
  assert.ok(contrastRatio(palette.controlBorder, palette.surfaceSubtle) >= 3);
  assert.ok(contrastRatio(palette.navigationActiveText, palette.navigationActive) >= 4.5);
  assert.ok(contrastRatio(palette.navigationMuted, palette.navigationSurface) >= 3);
  // The phone dock is its own surface - dark glass, white glyphs - so its ink is
  // measured against its own non-glass fill, which is the darkest it ever gets.
  assert.ok(contrastRatio(palette.navigationDockIcon, palette.navigationDockSurface) >= 4.5);

  assert.deepEqual({
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    info: palette.info,
    neutral: palette.neutral,
  }, {
    success: '#047857',
    warning: '#B45309',
    danger: '#B91C1C',
    info: '#0369A1',
    neutral: '#475569',
  });
});

test('mobile chrome does not retain dark neutral background islands', async () => {
  const [appShellSource, authScreenSource, orderDetailSource, cropperSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'auth-screen.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'menu-image-cropper.tsx'), 'utf8'),
  ]);

  const retiredDarkNeutrals = /#(?:17191D|292C31|34383F|3A3E45|AEB6C2|0F172A|2F333A|3A3E46|464B54|202329|444851|000000)|rgba\(17\s*,\s*19\s*,\s*24/i;

  assert.doesNotMatch(appShellSource, retiredDarkNeutrals);
  assert.doesNotMatch(authScreenSource, retiredDarkNeutrals);
  assert.doesNotMatch(orderDetailSource, retiredDarkNeutrals);
  assert.doesNotMatch(cropperSource, retiredDarkNeutrals);
  assert.match(appShellSource, /backgroundColor:\s*palette\.navigationSurface/);
  // The dock's selection capsule is translucent glass now, not the rail's cream.
  assert.match(appShellSource, /backgroundColor:\s*palette\.navigationDockIndicator/);
  assert.match(cropperSource, /aspectBadge:[\s\S]{0,260}backgroundColor:\s*palette\.navigationBorder/);
});

test('the held dock capsule compresses its real height and radius, not a scale', async () => {
  // A scaleY on a pill keeps the corner's full horizontal radius while it
  // loses height, so the ends bulge into ellipses; the reference's ends stay
  // round and its top and bottom run straight. That needs the HEIGHT and the
  // RADIUS to animate, which the pager's native-driven value cannot do - so
  // the shape is an inner view driven on the JS side off mirrored values.
  const source = await readFile(path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'), 'utf8');
  assert.match(source, /const PHONE_ACTIVE_INDICATOR_HELD_HEIGHT = 0\.8[0-9]/);
  assert.match(source, /const PHONE_ACTIVE_INDICATOR_HELD_WIDTH = 1\.0[0-9]/);
  assert.match(source, /height:\s*capsuleShape\.height/);
  assert.match(source, /width:\s*capsuleShape\.width/);
  assert.match(source, /borderRadius:\s*capsuleShape\.radius/);
  assert.match(source, /\[markerPosition, mirror\.marker\]/);
  assert.match(source, /source\.addListener\(/);
  // Only the settled travel is a transform; the held pose is no longer a scale.
  assert.doesNotMatch(source, /squash: u\.interpolate/);
  assert.doesNotMatch(source, /stretch: u\.interpolate/);
});

test('mobile form controls use orange boundaries at rest and focus', async () => {
  // theme.ts used to carry a second `inputStyles` copy of this rule that no
  // screen ever rendered; it was removed, so the guarantee is asserted on the
  // components that actually paint a field.
  // The assistant screen is the one exception: it wears the web AI page's own
  // cream-and-orange palette (src/components/ai/theme.ts), not the app's.
  const uiSource = await readFile(path.join(mobileRoot, 'src', 'components', 'ui.tsx'), 'utf8');

  assert.doesNotMatch(uiSource, /focused\s*\?\s*palette\.textStrong\s*:\s*palette\.border/);
  assert.match(uiSource, /focused\s*\?\s*palette\.primary\s*:\s*palette\.controlBorder/);
  assert.match(uiSource, /borderColor:\s*error \? palette\.danger : focused \? palette\.primary : palette\.controlBorder/);
});

test('staff warnings are announced and only describe a real custom-access reset', async () => {
  const [uiSource, memberSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'components', 'ui.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'staff', 'member.tsx'), 'utf8'),
  ]);

  assert.match(
    uiSource,
    /accessibilityLiveRegion=\{tone === 'danger' \? 'assertive' : tone === 'neutral' \? 'none' : 'polite'\}/,
  );
  // The warning sits under the role chips (15 ก.ย. 2569) and still fires only
  // when the role really changed for a member who had custom access.
  assert.match(memberSource, /const roleChanged = Boolean\(canEditMemberRole && member && roleId !== member\.role_id\)/);
  assert.match(memberSource, /roleChanged && member\.permissions_override != null/);
});

// The role editor was redrawn on 15 ก.ย. 2569: every permission group is an
// open card of switches shared with the member page, deleting is a quiet red
// line that expands into its question, and the name still edits in the title.
test('role editor uses the shared permission cards and the quiet delete line', async () => {
  const [roleSource, formSource, memberSource, shellSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'staff', 'role.tsx'), 'utf8')
      .then((source) => source.replace(/\r\n/g, '\n')),
    readFile(path.join(mobileRoot, 'src', 'components', 'form', 'parts.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'staff', 'member.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'), 'utf8'),
  ]);

  // One implementation of the permission groups for both screens.
  assert.match(formSource, /export function PermissionGroups\(/);
  assert.match(formSource, /<SwitchRow key=\{row\.key\}/);
  assert.match(roleSource, /<PermissionGroups/);
  assert.match(memberSource, /<PermissionGroups/);
  assert.doesNotMatch(roleSource, /expandedPermissionGroup/);
  assert.doesNotMatch(memberSource, /expandedPermissionGroup/);
  // Turning a permission off still drops what depended on it.
  assert.match(roleSource, /togglePermissionSelection\(selection, key\)/);

  // Deleting: the red line, then the question with two buttons, never a box
  // stacked on a box. The failure message replaces the question in place.
  assert.match(formSource, /export function DangerAction\(/);
  assert.match(roleSource, /<DangerAction/);
  assert.match(roleSource, /error=\{deleteError\}/);
  assert.match(roleSource, /setDeleteError\(err instanceof Error/);
  assert.doesNotMatch(roleSource, /<Feedback[^>]*confirmDelete/);
  assert.match(roleSource, /if \(editing && loading\) \{/);
  assert.match(roleSource, /<SkeletonReveal/);

  // The name edits in the centred title; the glass pencil becomes a tick.
  assert.match(shellSource, /titleContent\?: React\.ReactNode/);
  assert.match(shellSource, /titleContent \?\? \(/);
  assert.match(roleSource, /titleContent=\{titleContent\}/);
  const titleStart = roleSource.indexOf('const titleContent =');
  const titleEnd = roleSource.indexOf('const nameAction =', titleStart);
  assert.ok(titleStart >= 0 && titleEnd > titleStart);
  const titleBlock = roleSource.slice(titleStart, titleEnd);
  assert.match(titleBlock, /<TextInput/);
  assert.match(titleBlock, /typeScale\.hero/);
  assert.match(titleBlock, /minHeight: 44/);
  assert.match(titleBlock, /numberOfLines=\{1\}/);
  assert.match(roleSource, /accessibilityLabel=\{copy\('ชื่อบทบาท', 'Role name'\)\}/);
  assert.match(roleSource, /icon=\{editingName \? 'checkmark' : 'create-outline'\}/);
  assert.doesNotMatch(roleSource, /!role\?\.is_system/);
  assert.match(roleSource, /function finishNameEditing\(\): boolean/);
  assert.match(roleSource, /if \(!canFinishRoleNameEdit\(name\)\)/);
  assert.match(roleSource, /setEditingName\(true\)[\s\S]{0,160}nameInputRef\.current\?\.focus\(\)/);
  assert.match(roleSource, /onSubmitEditing=\{finishNameEditing\}/);
  assert.match(roleSource, /submitBehavior="submit"/);
  assert.match(roleSource, /let nameSaved = false/);
  assert.match(roleSource, /nameSaved = true/);
  assert.match(roleSource, /roleSaveFailureMessage\(\s*nameSaved,/);
  assert.match(roleSource, /roleId === activeMembership\?\.role_id/);
  assert.match(roleSource, /await refreshMemberships\(\)\.catch\(\(\) => undefined\)/);
});

test('manual refresh owns the native refreshing lifecycle on success and failure', async () => {
  const successfulStates = [];
  await runManualRefresh(async () => {}, (refreshing) => successfulStates.push(refreshing));
  assert.deepEqual(successfulStates, [true, false]);

  const failedStates = [];
  await assert.rejects(
    runManualRefresh(async () => {
      throw new Error('offline');
    }, (refreshing) => failedStates.push(refreshing)),
    /offline/,
  );
  assert.deepEqual(failedStates, [true, false]);
});

test('home restaurant identity uses stable name, branch, role, and user fallbacks', () => {
  assert.deepEqual(resolveHomeRestaurantIdentity({
    restaurantName: 'ครัวบ้าน',
    branchName: 'สาขาหลัก',
    roleDisplayName: 'เจ้าของร้าน',
    nickname: 'Beam',
  }), {
    restaurantName: 'ครัวบ้าน',
    detail: 'สาขาหลัก',
    userInitial: 'B',
  });

  assert.deepEqual(resolveHomeRestaurantIdentity({
    roleName: 'manager',
    email: 'owner@example.test',
  }), {
    restaurantName: 'Dishy',
    detail: 'manager',
    userInitial: 'O',
  });

  assert.deepEqual(resolveHomeRestaurantIdentity({
    restaurantName: 'ครัวบ้าน',
    roleDisplayNameOverride: 'หัวหน้าร้าน',
    roleDisplayName: 'Manager',
    roleName: 'manager',
    nickname: 'โม',
  }), {
    restaurantName: 'ครัวบ้าน',
    detail: 'หัวหน้าร้าน',
    userInitial: 'โ',
  });
});

test('mobile role-name surfaces consume the restaurant override contract', async () => {
  const [typesSource, restaurantsSource, invitationSource, homeSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'types', 'restaurant.ts'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'restaurants.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'invite', '[token].tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', '(primary)', 'home.tsx'), 'utf8'),
  ]);

  assert.match(typesSource, /display_name_override\?: string/);
  assert.match(restaurantsSource, /roleLabel\(membership\.role, language\)/);
  assert.match(invitationSource, /return roleLabel\(role, language\)/);
  // Since 2026-09-11 Home shows the role as a chip at the top right instead of
  // the restaurant row; the override still has to be what that chip reads.
  assert.match(homeSource, /activeMembership\?\.role\?\.display_name_override/);
});

test('restaurant identity is rendered only on Home while detail headings retain Back', async () => {
  const appShellSource = await readFile(
    path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'),
    'utf8',
  );
  const appFiles = await tsxFilesUnder(path.join(mobileRoot, 'app'));
  const identityConsumers = [];

  for (const file of appFiles) {
    const source = await readFile(file, 'utf8');
    if (source.includes('<HomeRestaurantIdentity')) {
      identityConsumers.push(path.relative(mobileRoot, file).replaceAll('\\', '/'));
    }
  }

  assert.doesNotMatch(appShellSource, /function RestaurantBar\b|<RestaurantBar\b/);
  assert.match(appShellSource, /showBack=\{!topLevel\}/);
  assert.match(appShellSource, /router\.back\(\)/);
  // The restaurant row came off Home on 2026-09-11 at the owner's request: the
  // shop is chosen from the settings screen now, and no heading draws it.
  assert.deepEqual(identityConsumers, []);
});

test('the primary tab navigator is the sole owner of the phone bottom dock', async () => {
  const [appShellSource, primaryLayoutSource] = await Promise.all([
    readFile(
      path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'),
      'utf8',
    ),
    readFile(path.join(mobileRoot, 'app', '(primary)', '_layout.tsx'), 'utf8'),
  ]);

  assert.equal(
    (appShellSource.match(/<PrimaryPhoneNavigation\b/g) || []).length,
    0,
    'standalone AppScreen routes must never render the primary phone dock',
  );
  assert.equal(
    (primaryLayoutSource.match(/<PrimaryPhoneNavigation\b/g) || []).length,
    1,
    'the primary tab layout must keep exactly one phone dock',
  );
  assert.doesNotMatch(
    appShellSource,
    /tabSwipeResponder\.panHandlers/,
    'standalone AppScreen routes must leave horizontal navigation gestures to the native stack',
  );
  assert.match(
    primaryLayoutSource,
    /onSelect=\{jumpToTab\}/,
    'bottom dock presses must use the direct, non-animated tab path',
  );
  const jumpStart = primaryLayoutSource.indexOf('const jumpToTab = useCallback');
  const gestureStart = primaryLayoutSource.indexOf('const finishGesture = useCallback');
  assert.ok(jumpStart >= 0 && gestureStart > jumpStart);
  const jumpSource = primaryLayoutSource.slice(jumpStart, gestureStart);
  assert.match(jumpSource, /writePagerPosition\(plan\.position\)/);
  assert.doesNotMatch(
    jumpSource,
    /animatePagerTo|Animated\.timing/,
    'direct dock selection must never enter a pager timing animation',
  );
  assert.doesNotMatch(
    primaryLayoutSource,
    /isTablet\s*\|\|\s*transitionActiveRef\.current\s*\|\|/,
    'the 500ms visual settle must not block the next swipe',
  );
  assert.doesNotMatch(
    primaryLayoutSource,
    /isTablet\s*\|\|\s*pendingRouteIndexRef\.current !== null\s*\|\|/,
    'route acknowledgement must not block the next swipe either',
  );
  assert.match(
    primaryLayoutSource,
    /resolvePagerGestureStartPlan\(/,
    'a consecutive swipe must start from the latest pending tab target',
  );
  assert.match(
    primaryLayoutSource,
    /if \(!settlement\.completed\) \{\s*restoreCommittedPager\(transitionId\);\s*return;/,
    'an owned native cancellation must clear pending route state before late reconciliation',
  );
  assert.match(
    primaryLayoutSource,
    /routeSyncTimer\.current = setTimeout\(\(\) => \{\s*if \(pagerGestureActiveRef\.current\) return;\s*restoreCommittedPager\(transitionId\);/,
    'the route watchdog must not reset the pager while a deliberate drag is still held',
  );
});

test('the tablet rail stays outside native stack screen transitions', async () => {
  const [rootLayoutSource, appShellSource, primaryLayoutSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', '_layout.tsx'), 'utf8'),
    readFile(
      path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'),
      'utf8',
    ),
    readFile(path.join(mobileRoot, 'app', '(primary)', '_layout.tsx'), 'utf8'),
  ]);

  const stackLayoutStart = rootLayoutSource.indexOf('function TabletWorkspaceStackLayout(');
  const stackLayoutEnd = rootLayoutSource.indexOf('function AppNavigator(', stackLayoutStart);
  assert.ok(
    stackLayoutStart >= 0 && stackLayoutEnd > stackLayoutStart,
    'the native Stack must have a stable tablet workspace layout',
  );
  const stackLayoutSource = rootLayoutSource.slice(stackLayoutStart, stackLayoutEnd);
  assert.match(stackLayoutSource, /<TabletWorkspaceFrame>/);
  assert.match(stackLayoutSource, /\{children\}/);
  assert.match(stackLayoutSource, /<\/TabletWorkspaceFrame>/);

  const rootStackStart = rootLayoutSource.indexOf('<Stack');
  const rootStackEnd = rootLayoutSource.indexOf('</Stack>', rootStackStart);
  assert.ok(rootStackStart >= 0 && rootStackEnd > rootStackStart, 'root Stack must exist');
  const rootStackSource = rootLayoutSource.slice(rootStackStart, rootStackEnd);
  assert.match(
    rootStackSource,
    /\blayout=\{TabletWorkspaceStackLayout\}/,
    'the tablet workspace frame must wrap navigator children, not individual screens',
  );
  assert.match(
    rootStackSource,
    /screenOptions=\{\{[\s\S]*?animation:\s*'slide_from_right'/,
    'pushed workflow content must retain the native slide transition',
  );

  const frameStart = appShellSource.indexOf('export function TabletWorkspaceFrame(');
  const frameEnd = appShellSource.indexOf('const PHONE_DOCK_HEIGHT', frameStart);
  assert.ok(frameStart >= 0 && frameEnd > frameStart, 'TabletWorkspaceFrame must exist');
  const frameSource = appShellSource.slice(frameStart, frameEnd);
  assert.equal(
    (frameSource.match(/<PrimaryTabletRail\b/g) || []).length,
    1,
    'the persistent tablet frame must render exactly one rail',
  );
  assert.match(frameSource, /shouldShowTabletWorkspaceRail\(/);
  assert.match(frameSource, /tabletBreakpoint:\s*breakpoints\.tablet/);
  assert.match(
    frameSource,
    /\{showRail\s*\?\s*\(\s*<PrimaryTabletRail\b/,
    'the shared visibility decision must gate the rendered tablet rail',
  );
  assert.match(frameSource, /const isOnPrimaryRoot = primaryNavigation\.some\(/);
  assert.match(frameSource, /router\.navigate\(item\.href as never\)/);
  assert.match(
    frameSource,
    /onSelectPrimary=\{isOnPrimaryRoot \? navigateToPrimaryRoot : undefined\}/,
    'primary rail presses must dispatch tab-compatible navigation while inside the tab host',
  );

  const appScreenStart = appShellSource.indexOf('export function AppScreen(');
  assert.ok(appScreenStart >= 0, 'AppScreen must exist');
  assert.doesNotMatch(
    appShellSource.slice(appScreenStart),
    /<PrimaryTabletRail\b/,
    'individual stack screens must not recreate the tablet rail',
  );
  assert.doesNotMatch(
    primaryLayoutSource,
    /<PrimaryTabletRail\b/,
    'the primary tab host must use the same persistent tablet rail',
  );
});

test('the persistent tablet rail is limited to authenticated workspace routes', () => {
  const baseInput = {
    activeMembership: true,
    authStatus: 'ready',
    tabletBreakpoint: 768,
    user: true,
    width: 1024,
  };

  for (const pathname of ['/home', '/order/new', '/menu/item', '/settings/display']) {
    assert.equal(
      shouldShowTabletWorkspaceRail({ ...baseInput, pathname }),
      true,
      `${pathname} must retain the persistent tablet rail`,
    );
  }

  for (const pathname of ['/', '/login', '/register', '/restaurants', '/invite/manual']) {
    assert.equal(
      shouldShowTabletWorkspaceRail({ ...baseInput, pathname }),
      false,
      `${pathname} must remain outside the workspace shell`,
    );
  }

  assert.equal(
    shouldShowTabletWorkspaceRail({ ...baseInput, pathname: '/home', width: 767 }),
    false,
  );
  assert.equal(
    shouldShowTabletWorkspaceRail({ ...baseInput, pathname: '/home', width: 768 }),
    true,
  );
  assert.equal(
    shouldShowTabletWorkspaceRail({ ...baseInput, authStatus: 'loading', pathname: '/home' }),
    false,
  );
  assert.equal(
    shouldShowTabletWorkspaceRail({ ...baseInput, activeMembership: false, pathname: '/home' }),
    false,
  );
});

test('every destination opened from More is a detail screen without primary chrome', async () => {
  const moreDestinationFiles = [
    'menu.tsx',
    'inventory.tsx',
    'table-management.tsx',
    'reservations.tsx',
    'staff.tsx',
    'reports.tsx',
    'ai-assistant.tsx',
    'settings.tsx',
  ];

  for (const relativeFile of moreDestinationFiles) {
    const source = await readFile(path.join(mobileRoot, 'app', relativeFile), 'utf8');
    const screenCount = (source.match(/<AppScreen\b/g) || []).length;
    const detailScreenCount = (source.match(/\btopLevel=\{false\}/g) || []).length;

    assert.ok(screenCount > 0, `${relativeFile} must render AppScreen`);
    assert.equal(
      detailScreenCount,
      screenCount,
      `${relativeFile} must keep every loading, error, and content branch out of the primary tab zone`,
    );
  }
});

test('primary tab-zone screens stay top-level and do not add a back control', async () => {
  const primaryScreenFiles = [
    'home.tsx',
    'tables.tsx',
    'kitchen.tsx',
    'orders.tsx',
    'more.tsx',
  ];

  for (const relativeFile of primaryScreenFiles) {
    const source = await readFile(
      path.join(mobileRoot, 'app', '(primary)', relativeFile),
      'utf8',
    );
    const screenCount = (source.match(/<AppScreen\b/g) || []).length;
    const topLevelScreenCount = (
      source.match(/\btopLevel(?=\s|>)/g) || []
    ).length + (source.match(/\btopLevel=\{true\}/g) || []).length;

    assert.ok(screenCount > 0, `${relativeFile} must render AppScreen`);
    assert.equal(
      topLevelScreenCount,
      screenCount,
      `${relativeFile} belongs to the bottom-dock zone and must not show Back`,
    );
  }
});

test('native stack keeps edge-swipe Back on pushed screens but disables it for the tab host', async () => {
  const rootLayoutSource = await readFile(
    path.join(mobileRoot, 'app', '_layout.tsx'),
    'utf8',
  );

  assert.match(rootLayoutSource, /screenOptions=\{\{[\s\S]{0,280}gestureEnabled:\s*true/);
  assert.match(
    rootLayoutSource,
    /const topLevelScreenOptions\s*=\s*\{[\s\S]{0,160}gestureEnabled:\s*false/,
  );
  assert.doesNotMatch(rootLayoutSource, /fullScreenGestureEnabled/);

  // 2026-09-11: the two inventory screens used to switch the gesture off because
  // their rows swipe to delete, which left no way back out of them. The rows
  // keep every drag that starts off the edge; the edge stays iOS's.
  assert.doesNotMatch(rootLayoutSource, /name="inventory(\/categories)?"\s+options=\{\{[^}]*gestureEnabled:\s*false/);
});

// Both Back buttons were bare chevrons until 15 ก.ย. 2569, when the owner asked
// for the assistant screen's round glass button on every screen.
test('detail heading Back is the round glass button from the assistant screen', async () => {
  const appShellSource = await readFile(
    path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'),
    'utf8',
  );
  const headingStart = appShellSource.indexOf('function ScreenHeading(');
  const headingEnd = appShellSource.indexOf('export function AppScreen(', headingStart);

  assert.ok(headingStart >= 0 && headingEnd > headingStart, 'ScreenHeading must exist');
  const headingSource = appShellSource.slice(headingStart, headingEnd);

  assert.match(headingSource, /<GlassButton icon="chevron-back" label=\{copy\('ย้อนกลับ', 'Go back'\)\}/);
  assert.doesNotMatch(headingSource, /name="chevron-back-outline"/);
  assert.doesNotMatch(headingSource, /name="arrow-back"/);
  // The spacer that keeps a centred title centred matches the button's 46pt.
  assert.match(headingSource, /width: 46/);
});

test('auth flow Back uses the same glass button', async () => {
  const authScreenSource = await readFile(
    path.join(mobileRoot, 'src', 'components', 'auth-screen.tsx'),
    'utf8',
  );
  const backStart = authScreenSource.indexOf('function BackButton()');
  const backEnd = authScreenSource.indexOf('function AuthArtwork()', backStart);

  assert.ok(backStart >= 0 && backEnd > backStart, 'Auth BackButton must exist');
  const backSource = authScreenSource.slice(backStart, backEnd);

  assert.match(backSource, /<GlassButton icon="chevron-back" label=\{copy\('ย้อนกลับ', 'Go back'\)\}/);
  assert.doesNotMatch(backSource, /name="chevron-back-outline"/);
});

test('app routes use the manual refresh control instead of binding native refresh to loading', async () => {
  const appShellSource = await readFile(
    path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'),
    'utf8',
  );
  const appFiles = await tsxFilesUnder(path.join(mobileRoot, 'app'));
  const directNativeConsumers = [];

  for (const file of appFiles) {
    const source = await readFile(file, 'utf8');
    if (/\bRefreshControl\b/.test(source)) {
      directNativeConsumers.push(path.relative(mobileRoot, file).replaceAll('\\', '/'));
    }
  }

  assert.deepEqual(directNativeConsumers, []);
  assert.match(appShellSource, /export function AppRefreshControl\b/);
  assert.match(appShellSource, /refreshing=\{refreshing\}/);
  assert.doesNotMatch(appShellSource, /refreshing=\{loading\}/);
});

test('warm primary scenes clear busy state when focus cleanup invalidates a foreground load', async () => {
  const [homeSource, tablesSource, ordersSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', '(primary)', 'home.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', '(primary)', 'tables.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', '(primary)', 'orders.tsx'), 'utf8'),
  ]);

  assert.match(
    homeSource,
    /requestIdRef\.current \+= 1;\s+foregroundRequestIdRef\.current = null;\s+setLoading\(false\);/,
  );
  assert.match(
    tablesSource,
    /requestGenerationRef\.current\.invalidate\(\);\s+foregroundRequestRef\.current = null;\s+setLoading\(false\);/,
  );
  assert.match(
    ordersSource,
    /requestIdRef\.current \+= 1;\s+setLoading\(false\);\s+setLoadingMore\(false\);/,
  );
});

test('every text field gets a Done bar, on an id that cannot be shared', async () => {
  const [inputSource, barSource, itemSource, editorSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'components', 'app-text-input.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'keyboard-done-bar.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-item-editor.tsx'), 'utf8'),
  ]);

  // Fabric recycles component views. RCTViewComponentView.prepareForRecycle resets
  // the event emitter, layout metrics and subviews but never `_props`, while
  // RCTTextInputComponentView.prepareForRecycle explicitly nils the backing
  // field's inputAccessoryViewID. updateProps then writes it back only
  // `if (new != old)` - so an id shared between screens compares equal, the write
  // is skipped, and the field carries no id at all. The bar's one-shot
  // didMoveToWindow lookup finds nothing and gives up for good: it worked on the
  // first screen and was silently gone on every screen after. A per-instance id
  // can never compare equal.
  assert.match(inputSource, /useId\(\)\.replace\(/);
  assert.match(inputSource, /const accessoryId = inputAccessoryViewID \?\? `dishy-done-\$\{generatedId\}`/);
  assert.doesNotMatch(inputSource, /const [A-Z_]+ = '[a-z-]*accessory[a-z-]*'/);

  // And it has to mount a commit AFTER the field, for the same one-shot lookup:
  // in the same commit the field may not be in the window yet. An effect cannot
  // run until the commit that mounted it is done.
  assert.match(inputSource, /useEffect\(\(\) => \{\s*\r?\n?\s*setBarMounted\(true\);\s*\r?\n?\s*\}, \[\]\);/);
  const fieldAt = inputSource.indexOf('<NativeTextInput');
  const barAt = inputSource.indexOf('<KeyboardDoneBar');
  assert.ok(fieldAt > 0 && barAt > fieldAt, 'the bar must render after the field it names');
  assert.match(inputSource, /ownsBar && barMounted \? <KeyboardDoneBar/);

  // One bar, wired at the single chokepoint every field in the app goes through.
  // No screen may keep a private copy - that is what left it on one screen only.
  assert.doesNotMatch(itemSource, /InputAccessoryView/);
  assert.doesNotMatch(editorSource, /InputAccessoryView/);

  // Two kinds of field opt out, and both have to stay opted out.
  //
  // The assistant composer is pinned to the bottom of a KeyboardAvoidingView, so
  // it already rides on the keyboard with its own send button - a Done bar slides
  // in UNDER it, two stacked bars with the useful one pushed further away.
  //
  // A search field's return key already reads Search and dismisses on its own, so
  // a Done bar over it offers the same action twice. Every search input in the app
  // is one of these two files; the assertion below is what keeps that true.
  assert.match(inputSource, /&& !omitKeyboardDoneBar;/);
  const [composerSource, uiSource, chatListSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'src', 'components', 'ai', 'composer.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'ui.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'ai', 'chat-list-sheet.tsx'), 'utf8'),
  ]);
  assert.match(composerSource, /^\s*omitKeyboardDoneBar$/m);
  for (const [name, src] of [['ui.tsx', uiSource], ['chat-list-sheet.tsx', chatListSource]]) {
    for (const match of src.matchAll(/returnKeyType="search"/g)) {
      const before = src.slice(Math.max(0, match.index - 400), match.index);
      assert.match(before, /omitKeyboardDoneBar/, `search input in ${name} still carries a Done bar`);
    }
  }

  // Keyboard chrome, not app chrome. The first attempt drew this in Kanit on a
  // brand surface, which is what gave it away as hand-built. Comments are stripped
  // so the prose naming these does not satisfy the assertions itself.
  const bar = barSource.replaceAll(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
  assert.doesNotMatch(bar, /palette\.|AppText/);
  assert.match(bar, /<Text style=\{\{ color: SYSTEM_BAR\.tint/);

  // UIToolbar is backed by UIBlurEffectStyleSystemChromeMaterial, and a flat rgba
  // stand-in is the one difference a person can still see. Nothing opaque may sit
  // under it either - a fill tints it.
  assert.match(bar, /<BlurView/);
  assert.match(bar, /blurTint: 'systemChromeMaterialLight'/);
  assert.match(bar, /blurIntensity: 100/);
  assert.doesNotMatch(bar.slice(bar.indexOf('export function')), /backgroundColor/);

  // The keyboard below is rounded and the bar is not, so each bottom corner leaves
  // a wedge the page shows through. It is filled with the bar's own material by
  // two squares hanging below it - which must be SIBLINGS of that material:
  // ExpoBlurView sets clipsToBounds on itself, so a child is cut off at the edge
  // and fills nothing.
  assert.match(bar, /\[side\]: 0/);
  assert.match(bar, /top: SYSTEM_BAR\.height,/);
  assert.match(bar, /cornerFill: \d+/);
  const materialAt = bar.indexOf('<BlurView');
  const fillAt = bar.indexOf('<BlurView', materialAt + 1);
  const closeAt = bar.indexOf('</BlurView>');
  assert.ok(fillAt > 0, 'the corner fills must exist');
  assert.ok(closeAt === -1 || closeAt > fillAt, 'the corner fills must not be nested in the bar material');
});

test('the shell leaves the keyboard inset to iOS and reveals a covered field by measuring it', async () => {
  const source = await readFile(path.join(mobileRoot, 'src', 'components', 'app-shell.tsx'), 'utf8');
  const itemSource = await readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8');
  // The note's keyboard handling lives with the editor, which the phone's item
  // screen and the tablet's dish panel share.
  const editorSource = await readFile(path.join(mobileRoot, 'src', 'components', 'order-item-editor.tsx'), 'utf8');

  // RCTScrollViewComponentView._keyboardWillChangeFrame already adds the keyboard
  // as contentInset.bottom. Adding it a second time as content padding gave the
  // page two keyboards of slack, and it could be dragged up into a screenful of
  // empty canvas.
  assert.match(source, /automaticallyAdjustKeyboardInsets/);
  assert.doesNotMatch(source, /paddingBottom:[^\n]*[Kk]eyboard/);

  // What that inset does NOT do is clear the field: it clears the caret, which on
  // a multiline box sits on the first line and is already visible. The screen
  // measures its own overlap instead.
  assert.match(source, /getOffset: \(\) => contentOffsetRef\.current/);
  assert.match(itemSource, /scrollControlRef=\{scrollControl\}/);
  assert.match(itemSource, /useNoteKeyboardAlignment\(scrollControl\)/);
  assert.match(editorSource, /measureInWindow\(/);
  assert.match(editorSource, /scrollControl\.current\?\.scrollTo\(target\)/);
  // The tablet panel scrolls itself, so it hands the same hook a control over
  // its own scroll view, with the same contract as AppScreen's.
  assert.match(editorSource, /getOffset: \(\) => offsetRef\.current/);
  assert.match(editorSource, /const noteKeyboard = useNoteKeyboardAlignment\(scrollControl\);/);

  // One movement, not two. On `didShow` this ran only after the keyboard had
  // finished animating, so iOS's own partial scroll played out first and this
  // followed it as a visibly separate second nudge. And the destination is
  // absolute, taken from an anchor measured at focus: a measurement taken while
  // the keyboard is animating races iOS's scroll, and pairing it with the current
  // offset double-counts however far iOS has already moved.
  assert.match(editorSource, /'keyboardWillChangeFrame' : 'keyboardDidShow'/);
  assert.doesNotMatch(editorSource, /addListener\('keyboardDidShow'/);
  assert.doesNotMatch(itemSource, /addListener\('keyboardDidShow'/);
  assert.match(editorSource, /const target = anchor\.offset \+ anchor\.bottom \+ spacing\.lg - top;/);

  // Neither half may be set up by the focus render. The listener used to be
  // added by an effect that runs AFTER the render focus triggers, while the
  // anchor arrived from an async measure - so on the FIRST tap iOS had the
  // keyboard up before either existed and the page never moved; it took a
  // scroll, a dismiss and a second tap, which is what the owner reported on
  // 16 ก.ย. 2569. The listener is mounted for the screen, and whichever of the
  // two lands last does the scrolling.
  assert.match(editorSource, /const show = Keyboard\.addListener\(showEvent[\s\S]{0,320}alignNoteAboveKeyboard\(\);/);
  assert.match(editorSource, /\}, \[alignNoteAboveKeyboard\]\);/);
  assert.doesNotMatch(editorSource, /if \(!noteFocused\) return undefined;/);
  assert.match(editorSource, /measureInWindow\(\([\s\S]{0,260}alignNoteAboveKeyboard\(\);/);
});

test('the overview keeps its fourteen-day report when an earlier day is picked', async () => {
  const home = await readFile(path.join(mobileRoot, 'app', '(primary)', 'home.tsx'), 'utf8');

  // Clearing it on a past day took the sales dots off every day in the strip
  // and the "vs last week" line off the sales card, until today was tapped
  // again (reported 14 ก.ย. 2569). The window ends today whatever is selected.
  assert.doesNotMatch(home, /setManagerReport\(shouldLoadReports \?/);
  assert.match(home, /if \(shouldLoadReports\) \{\s*setManagerReport\(managerReportResponse\.response\)/);
});

test('loading shows the shape of the screen, not a one-line loading box', async () => {
  const [home, chat, skeleton] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', '(primary)', 'home.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'ai-assistant.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'skeleton.tsx'), 'utf8'),
  ]);

  // 14 ก.ย. 2569: the overview grew from a 60pt "กำลังโหลด..." box into a full
  // page the moment data landed, and an old chat opened as one lonely bubble.
  assert.match(home, /\{dateLoading \? \(\s*<HomeSkeleton/);
  assert.doesNotMatch(home, /กำลังโหลดข้อมูลของวันที่เลือก\.\.\./);
  assert.match(chat, /\{threadLoading \? \(\s*<ThreadSkeleton/);

  // One sweep for every bone, stopped under reduced motion, and a short hold so
  // a fast load never flashes a skeleton for a frame.
  assert.match(skeleton, /let sharedLoop/);
  assert.match(skeleton, /useSharedShimmer\(!reducedMotion\)/);
  assert.match(skeleton, /delay: 120/);
});
