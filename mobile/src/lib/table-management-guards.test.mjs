import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Guards on the table-management section's call sites. Its pure logic is
// tested in table-plan.test.mjs; these read the screen's own source and fail
// when a line that carries a rule is reverted - the lock (owner, 2026-09-23),
// the overlays' swipe cover, the Thai error mapping, the no-dots and
// no-blank-space rules. A bug at a call site is invisible to a test of the
// function it calls.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');
const SECTION_DIR = 'src/components/table-plan';

async function sectionFiles() {
  const names = (await readdir(path.join(mobileRoot, SECTION_DIR))).filter((name) => /\.tsx?$/.test(name));
  const files = [
    'app/table-management.tsx',
    'src/hooks/use-table-plan.ts',
    ...names.map((name) => `${SECTION_DIR}/${name}`),
  ];
  return Promise.all(files.map(async (file) => [file, await read(file)]));
}

/**
 * The source of the declaration of `name`: from its line up to the next
 * statement at the same indentation, so an assertion about it can never be
 * met by a line somewhere else in the file.
 */
function declaration(source, name) {
  const match = new RegExp(`^([ \\t]*)(?:export )?(?:async )?(?:function|const) ${name}\\b`, 'm').exec(source);
  assert.ok(match, `${name} is declared`);
  const rest = source.slice(match.index + match[0].length);
  const next = new RegExp(`\\n${match[1]}[A-Za-z]`).exec(rest);
  return source.slice(match.index, match.index + match[0].length + (next ? next.index : rest.length));
}

test('the guards read one declaration, not the rest of the file', () => {
  const source = [
    'function outer() {',
    '  const first = () => {',
    '    work();',
    '  };',
    '  const second = 2;',
    '}',
    'export function after() {}',
  ].join('\n');
  assert.equal(declaration(source, 'first'), '  const first = () => {\n    work();\n  };');
  assert.equal(declaration(source, 'outer').includes('const second'), true);
  assert.equal(declaration(source, 'outer').includes('after'), false);
});

// ---------------------------------------------------------------- the lock

test('a table in service is never selectable on the plan', async () => {
  const tile = await read(`${SECTION_DIR}/plan-tile.tsx`);
  // No check circle and no press for a locked tile in selection.
  assert.match(tile, /const checkable = selecting && !locked;/);
  assert.match(tile, /const inert = selecting && locked;/);
  assert.match(tile, /disabled=\{inert\}/);
  assert.match(tile, /\{checkable \? <CheckCircle checked=\{selected\} \/> : null\}/);

  const floor = await read(`${SECTION_DIR}/plan-floor.tsx`);
  // No long press into selection, and a room's check counts only free-to-edit tables.
  assert.match(floor, /onLongPress=\{canManage && !locked && !selecting \? \(\) => handlers\.onTileLongPress\(table\) : undefined\}/);
  assert.match(floor, /const eligible = room\.tables\.filter\(\(table\) => !tableLocked\(table, activeOrderIds\)\);/);

  const controller = await read(`${SECTION_DIR}/use-plan-controller.ts`);
  assert.match(declaration(controller, 'toggleTable'), /if \(tableLocked\(table, activeOrderIds\)\) return;/);
  assert.match(declaration(controller, 'toggleMany'), /pool\.filter\(\(table\) => !tableLocked\(table, activeOrderIds\)\)/);
  // A table that went into service after it was picked drops out of the selection.
  assert.match(controller, /const allowed = new Set\(selectableTableIds\(tables, activeOrderIds\)\);/);

  const screen = await read('app/table-management.tsx');
  assert.match(screen, /onTileLongPress: \(table\) => \{\s*\/\/[^\n]*\n\s*if \(tableLocked\(table, activeOrderIds\)\) return;/);
  // "เลือก" is offered for tables that can be picked, not for a floor in service.
  assert.match(screen, /const selectableCount = selectableTableIds\(tables, activeOrderIds\)\.length;/);
  assert.match(screen, /\(ctl\.selecting \|\| selectableCount >= 2\)/);
});

test('a table in service opens read only: no save, no delete, no stepper, no switch', async () => {
  const dispatcher = await read(`${SECTION_DIR}/table-body.tsx`);
  assert.match(dispatcher, /if \(tableLocked\(table, env\.activeOrderIds\)\) \{\s*return <LockedTableBody /);
  assert.ok(
    dispatcher.indexOf('<LockedTableBody') < dispatcher.indexOf('<TableEditorBody'),
    'the lock is decided before the editor can render',
  );

  const locked = await read(`${SECTION_DIR}/table-locked-body.tsx`);
  const code = locked.replace(/^\s*\/\/.*$/gm, '');
  for (const control of ['PlanButton', 'DangerAction', 'CompactStepper', 'SwitchRow', 'ZoneChips', 'RoundKey', 'KitField', 'footer=', 'env.api', 'saveTable', 'removeTable', 'regenerateQr', 'moveTable']) {
    assert.ok(!code.includes(control), `the read-only table sheet must not contain ${control}`);
  }
  assert.match(code, /canRegenerate=\{false\}/);
  assert.match(code, /canCreateQr=\{false\}/);
  // What it still does: the status, the link, the QR on paper.
  assert.match(code, /<StatusChip /);
  assert.match(code, /onShare=\{link\.share\}/);
  assert.match(code, /onPaper=\{\(mode\) => paper\.run\(\{[^}]*\}, mode\)\}/);

  // The screen reaches the editor only through the dispatcher.
  const screen = await read('app/table-management.tsx');
  assert.ok(!screen.includes('TableEditorBody'), 'the screen must open tables through TableBody');
  assert.match(screen, /<TableBody chrome=\{chrome\}/);
});

test('a room holding a table in service cannot be emptied, deleted or renumbered from here', async () => {
  const room = await read(`${SECTION_DIR}/room-editor-body.tsx`);
  assert.match(room, /const inService = roomTables\.filter\(\(table\) => tableLocked\(table, activeOrderIds\)\);/);
  assert.match(declaration(room, 'openDelete'), /if \(inService\.length > 0\) \{\s*Alert\.alert\(/);
  // The hand-off into selection never carries one.
  assert.match(room, /onHandoff\(zone, roomTables\.filter\(\(table\) => !tableLocked\(table, activeOrderIds\)\)/);
  // A prefix change with a table in service is blocked in the form.
  assert.match(room, /const prefixProblem = relabel\?\.locked\.length\s*\? inServiceWords/);
  assert.match(room, /const canSave = dirty && !prefixProblem;/);
});

test('only the manager long-presses a free or closed table on the floor into its setup', async () => {
  const floor = await read('app/tables.tsx');
  assert.match(floor, /const canManageTables = can\(activeMembership, 'manage_table'\);/);
  assert.match(floor, /const activeOrderIds = useMemo\(\(\) => new Set\(activeOrderByTable\.keys\(\)\), \[activeOrderByTable\]\);/);
  const shortcut = declaration(floor, 'managementShortcut');
  assert.match(shortcut, /canManageTables && !tableLocked\(table, activeOrderIds\)/);
  assert.match(shortcut, /router\.push\(\{ pathname: '\/table-management', params: \{ table: String\(table\.ID\) \} \}\)/);
  assert.match(shortcut, /: undefined/);
  // The compact tile and the detailed card, and nothing else - takeaways keep their press.
  assert.equal((floor.match(/onLongPress=\{managementShortcut\(table\)\}/g) || []).length, 2);
  assert.equal((floor.match(/onLongPress=/g) || []).length, 2);

  const tile = await read('src/components/compact-table-tile.tsx');
  assert.match(tile, /onLongPress=\{onLongPress\}/);
});

test('a quiet reload neither unlocks a table nor undoes a zone reorder', async () => {
  const hook = await read('src/hooks/use-table-plan.ts');
  const load = declaration(hook, 'load');
  // A failed orders call keeps the last set: only an answer loosens the lock.
  assert.match(load, /if \(orderResponse\) setActiveOrderIds\(activeOrderTableIds\(orderResponse\.orders \?\? \[\]\)\);\s*else if \(!canSeeOrders\) setActiveOrderIds\(null\);/);
  assert.ok(!/orderResponse \? activeOrderTableIds/.test(load), 'a failed orders call must not wipe the lock');
  // Zones from a load wait while a reorder is shown ahead of its save.
  assert.match(load, /if \(!zoneHoldRef\.current\) setZoneState\(zoneResponse\.zones \?\? \[\]\);/);
  // Leaving the screen drops a pending order-event reload.
  assert.match(hook, /return \(\) => \{\s*clearInterval\(timer\);[\s\S]*?if \(eventTimerRef\.current\) clearTimeout\(eventTimerRef\.current\);[\s\S]*?generationRef\.current\.invalidate\(\);\s*\};/);

  const controller = await read(`${SECTION_DIR}/use-plan-controller.ts`);
  assert.match(declaration(controller, 'reorderZone'), /holdZones\(true\);/);
  const commit = declaration(controller, 'commitReorder');
  // Saved as shown: a load that began before the saves answered is dropped.
  assert.match(commit, /setPlanZones\(\(current\) => current\);\s*syncZoneHold\(\);\s*\}/);
  assert.match(declaration(controller, 'syncZoneHold'), /holdZones\(reorderTimerRef\.current !== null \|\| reorderSavesRef\.current > 0\);/);
});

test('on a tablet, an unsaved inspector asks before selection replaces it', async () => {
  const screen = await read('app/table-management.tsx');
  assert.ok(!/if \(workspace\) ctl\.closeSheet\(\);/.test(screen), 'selection closes the inspector without asking');
  assert.equal((screen.match(/if \(workspace\) ctl\.closeGuarded\(/g) || []).length, 2);
  const controller = await read(`${SECTION_DIR}/use-plan-controller.ts`);
  assert.match(declaration(controller, 'closeGuarded'), /if \(!dirtyRef\.current \|\| !sheetOpen\) \{\s*leave\(\);\s*return;\s*\}\s*Alert\.alert\(/);
  // The add form counts as a draft once anything in it moved.
  const add = await read(`${SECTION_DIR}/add-tables-body.tsx`);
  assert.match(add, /useEffect\(\(\) => \{\s*setDirty\(dirty\);\s*\}, \[dirty, setDirty\]\);/);
});

// ---------------------------------------------------------------- overlays

test('every overlay in the section is the one sheet, which holds the tab swipe cover', async () => {
  for (const [file, source] of await sectionFiles()) {
    assert.ok(!source.includes('<Modal'), `${file} opens a raw Modal`);
    if (file !== `${SECTION_DIR}/sheet-kit.tsx`) assert.ok(!source.includes('<BottomSheet'), `${file} opens a BottomSheet of its own`);
  }
  const kit = await read(`${SECTION_DIR}/sheet-kit.tsx`);
  assert.match(declaration(kit, 'PlanSheet'), /<BottomSheet fit /);

  const chrome = await read('src/components/ai/chrome.tsx');
  const sheet = declaration(chrome, 'BottomSheet');
  assert.match(sheet, /useTabSwipeCover\(shown\);/);

  const screen = await read('app/table-management.tsx');
  assert.match(screen, /<PlanSheet\s/);
});

test('each open starts a fresh body, so an unsaved draft never lands on another table', async () => {
  const controller = await read(`${SECTION_DIR}/use-plan-controller.ts`);
  assert.match(declaration(controller, 'showSheet'), /setSheetSeq\(\(current\) => current \+ 1\);/);
  assert.match(controller, /sheetBodyKey: sheet \? `\$\{sheetKey\(sheet\)\}#\$\{sheetSeq\}` : null,/);
  const screen = await read('app/table-management.tsx');
  // The phone's sheet and the tablet's inspector body.
  assert.equal((screen.match(/key=\{ctl\.sheetBodyKey\}/g) || []).length, 2);
});

// ---------------------------------------------------------------- errors

test('every table-management mutation goes through tableFailure', async () => {
  const actions = await read(`${SECTION_DIR}/plan-actions.ts`);
  const imported = actions.match(/import \{([^}]+)\} from '@\/src\/api\/table';/);
  assert.ok(imported, 'plan-actions imports the table API');
  const names = imported[1].split(',').map((name) => name.trim()).filter(Boolean);
  assert.ok(names.length >= 8, `the mutations: ${names.join(', ')}`);
  const body = actions.slice(actions.indexOf("from '@/src/api/table';"));
  for (const name of names) {
    const lines = body.split('\n').filter((line) => line.includes(`${name}(`));
    assert.ok(lines.length > 0, `${name} is called`);
    for (const line of lines) assert.match(line, /attempt\('/, `${name} is called outside attempt: ${line.trim()}`);
  }
  assert.match(declaration(actions, 'attempt'), /catch \(error\) \{\s*return \{ ok: false, failure: tableFailure\(error, action, language\) \};/);

  // Nothing else in the section reaches a mutation, or reads an error's raw text.
  for (const [file, source] of await sectionFiles()) {
    if (file === `${SECTION_DIR}/plan-actions.ts`) continue;
    for (const name of names) assert.ok(!new RegExp(`\\b${name}\\b`).test(source), `${file} calls ${name} directly`);
    // `error?.message` too: optional chaining is the easy way to slip one in.
    assert.ok(!/\b(?:err|error|caught|reason)\??\.message\b/.test(source), `${file} reads an error's own message`);
    assert.ok(!/instanceof Error/.test(source), `${file} unwraps a raw error`);
  }
});

// ---------------------------------------------------------------- the owner's look rules

test('no round dots anywhere in the section: no middle dot, no swatch', async () => {
  for (const [file, source] of await sectionFiles()) {
    assert.ok(!source.includes('·'), `${file} joins with a middle dot`);
    for (const match of source.matchAll(/width: (\d+(?:\.\d+)?), height: \1, borderRadius: (\d+(?:\.\d+)?)/g)) {
      const size = Number(match[1]);
      const round = Number(match[2]) * 2 >= size;
      assert.ok(!(round && size <= 12), `${file} draws a ${size}pt dot`);
    }
  }
});

test('every sheet is as tall as its content, never a fixed share with a blank band', async () => {
  for (const [file, source] of await sectionFiles()) {
    assert.ok(!source.includes('heightFraction'), `${file} sizes a sheet by a fixed fraction`);
  }
  const kit = await read(`${SECTION_DIR}/sheet-kit.tsx`);
  const frame = declaration(kit, 'BodyFrame');
  assert.ok(!frame.includes('flex: 1'), 'the body frame fills the sheet instead of fitting its content');
  assert.match(frame, /style=\{\{ flexGrow: 0, flexShrink: 1 \}\}/);
  const chrome = await read('src/components/ai/chrome.tsx');
  assert.match(chrome, /height: fitted \? undefined : shownHeight,/);
  assert.match(chrome, /maxHeight: fitted \? tallHeight - navLift : undefined,/);
});

test('on Android a resting sheet sits on top of the navigation bar, not under it', async () => {
  // 2026-09-23: the three-button bar was drawn over the card and hid half of
  // its footer button (the cash confirm, "ลบหมวด"). iOS keeps the owner's equal gap.
  const chrome = await read('src/components/ai/chrome.tsx');
  assert.match(chrome, /const navLift = Platform\.OS === 'android' \? insets\.bottom : 0;/);
  assert.match(chrome, /const bottomInset = between\(CARD_INSET \+ navLift, 0\);/);
});

test('the section stays in files of a readable size', async () => {
  for (const [file, source] of await sectionFiles()) {
    const lines = source.split('\n').length;
    assert.ok(lines <= 520, `${file} is ${lines} lines`);
  }
});

test('the old editor pages are gone, with their routes', async () => {
  assert.ok(!existsSync(path.join(mobileRoot, 'app', 'table-management')), 'app/table-management/ still exists');
  const layout = await read('app/_layout.tsx');
  assert.match(layout, /<Stack\.Screen name="table-management" \/>/);
  assert.ok(!layout.includes('table-management/'), 'a Stack.Screen still names an old page');
});
