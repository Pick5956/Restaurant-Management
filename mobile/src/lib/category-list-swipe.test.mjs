import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Guards on the categories list, where a swipe (the delete rail) and a long
// press (the drag) live on the same row. Every rule here is one line at a call
// site - which gesture may start when, what a renamed row is wrapped in, what a
// tap does while a name is open - so these read the source. The drag itself is
// guarded in menu-categories-guards.test.mjs and compact-header.test.mjs.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');
const LIST = 'src/components/menu-categories/category-drag-list.tsx';
const ROW = 'src/components/menu-categories/category-row.tsx';

/** The source without comments, so a note about a rule never passes for the rule. */
function code(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The source of the declaration of `name`: from its line up to the next statement at the same indentation. */
function declaration(source, name) {
  const match = new RegExp(`^([ \\t]*)(?:export )?(?:function|const) ${name}\\b`, 'm').exec(source);
  assert.ok(match, `${name} is declared`);
  const rest = source.slice(match.index + match[0].length);
  const next = new RegExp(`\\n${match[1]}[A-Za-z]`).exec(rest);
  return source.slice(match.index, match.index + match[0].length + (next ? next.index : rest.length));
}

/** The attributes of the first `<Tag` element in `source`, up to its closing `>` or `/>`. */
function element(source, tag) {
  const start = source.indexOf(`<${tag}\n`);
  assert.ok(start >= 0, `<${tag}> is drawn`);
  let depth = 0;
  for (let index = start + tag.length + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0 && char === '>') return source.slice(start, index + 1);
  }
  return source.slice(start);
}

test('the helpers cut at the right place', () => {
  const source = 'const a = () => {\n  one();\n};\nconst b = 2;\n';
  assert.equal(declaration(source, 'a').includes('const b'), false);
  assert.equal(element('<Row\n  x={() => 1 > 0}\n  y\n/>\n<Other />', 'Row'), '<Row\n  x={() => 1 > 0}\n  y\n/>');
  assert.equal(code('a(); // x\n{/* y */}b();'), 'a(); \nb();');
});

// ---------------------------------------------------------------- swipe against drag

test('each row is the bill\'s swipe row, with the rail held by the page', async () => {
  const list = code(await read(LIST));
  assert.match(list, /import \{ SwipeToDeleteRow \} from '@\/src\/components\/swipe-to-delete-row';/);
  const swipe = element(list, 'SwipeToDeleteRow');
  assert.match(list, /const railOpen = openRailId === category\.ID;/);
  assert.match(swipe, /open=\{railOpen && !swipeLocked\}/);
  assert.match(swipe, /onOpen=\{\(\) => onRailChange\(category\.ID\)\}/);
  assert.match(swipe, /locked=\{swipeLocked\}/);
  // ลบ deletes only while its rail is out: a drag that began on it closes the
  // rail through the page's scroll block and then releases on the button.
  assert.match(swipe, /onDelete=\{\(\) => \{\s*if \(env\.current\.openRailId === category\.ID\) onDelete\(category\);\s*\}\}/);
  // One rail out at a time, from the moment another row starts to slide.
  assert.match(swipe, /onSwipeStart=\{\(id\) => \{\s*if \(openRailId !== null && openRailId !== id\) onRailChange\(null\);/);
  // The old tablet-panel paths are gone.
  assert.equal(/\bselectedId\b|\bonOpen:/.test(list), false);
});

test('nothing swipes while a name is open or a save runs, except the rail whose delete it is', async () => {
  const list = code(await read(LIST));
  assert.match(list, /const swipeLocked = locked \|\| \(disabled && !railOpen\);/);
  assert.match(element(list, 'SwipeToDeleteRow'), /disabled=\{disabled && railOpen\}/);
});

test('nothing lifts while a name is open, and a lift puts an open rail away', async () => {
  const list = code(await read(LIST));
  const lift = declaration(list, 'lift');
  assert.match(lift, /if \(env\.current\.disabled \|\| env\.current\.locked \|\| env\.current\.editingId !== null \|\| session\.current\) return;/);
  assert.match(lift, /if \(env\.current\.openRailId !== null\) env\.current\.onRailChange\(null\);/);
  assert.match(declaration(list, 'moveBy'), /if \(env\.current\.disabled \|\| env\.current\.locked \|\| session\.current\) return;/);
});

test('a row never passes its touch on: refused taps are quiet, not disabled', async () => {
  const list = code(await read(LIST));
  const row = element(list, 'CategoryRow');
  // A disabled Pressable hands the touch to the swipe row (a press of its
  // own) and to the page (a tap elsewhere, which cancels the rename).
  assert.equal(/\bdisabled=/.test(row), false);
  assert.match(row, /quiet=\{disabled \|\| locked\}/);
  // Whether a rail was out is read when the touch begins, not when it ends.
  assert.match(row, /onPress=\{\(\) => press\(category, railOutAtPressIn\.current\)\}/);
  assert.match(row, /onPressIn=\{\(\) => \{\s*railOutAtPressIn\.current = env\.current\.openRailId !== null;\s*\}\}/);
});

test('a tap on another row while a name is open puts the keyboard away; one on the renamed row does not', async () => {
  const list = code(await read(LIST));
  const press = declaration(list, 'press');
  assert.match(press, /if \(session\.current\) return;\s*if \(editingId === category\.ID\) return;\s*if \(locked\) \{\s*Keyboard\.dismiss\(\);\s*return;\s*\}/);
  // An open rail spends the tap; only an idle row is renamed. So does one
  // that was out when the touch began: a scroll attempt closes it mid-touch
  // and its release would otherwise land here as a rename.
  assert.match(press, /if \(railOut \|\| openRailId !== null\) \{\s*if \(openRailId !== null\) onRailChange\(null\);\s*return;\s*\}\s*onRename\(category\);/);
});

test('the row being renamed leaves the swipe row, so its field is reachable by a screen reader', async () => {
  const list = code(await read(LIST));
  assert.match(list, /\{editing \? row : \(\s*<SwipeToDeleteRow/);
  assert.match(list, /nameSlot=\{editing \? renderEditor\(category\) : undefined\}/);
  // An idle row's frame speaks for it and hides the swipe row's own elements.
  const frame = element(list, 'CategoryRowFrame');
  assert.match(frame, /accessible=\{!editing\}/);
  assert.match(list, /importantForAccessibility=\{editing \? 'auto' : 'no-hide-descendants'\}/);
});

// ---------------------------------------------------------------- the row

test('the clip lives in the row frame, never on the list', async () => {
  const list = code(await read(LIST));
  const row = code(await read(ROW));
  assert.equal(/overflow: 'hidden'/.test(list), false, 'a clipping list would cut off the lifted row');
  assert.match(declaration(row, 'CategoryRowFrame'), /overflow: 'hidden'/);
  assert.match(list, /borderRadius: LIFTED_ROW_RADIUS,/);
});

test('the name field stands in for the name only, and the add row answers its own padding', async () => {
  const row = code(await read(ROW));
  assert.match(declaration(row, 'CategoryRow'), /\{hasSlot \? nameSlot : \(/);
  const inline = declaration(row, 'CategoryInlineRow');
  assert.match(inline, /onStartShouldSetResponder=\{\(\) => true\}/);
  assert.equal(/<Pressable/.test(inline), false, 'the add row is not pressable');
  // One box for both, so the add row cannot drift from the rows under it.
  assert.match(declaration(row, 'CategoryRow'), /\.\.\.rowShell\(hasDetail, roundTop, roundBottom\)/);
  assert.match(inline, /\.\.\.rowShell\(\w+, roundTop, roundBottom\)/);
  assert.match(inline, /<View style=\{leadSlot\(\w+\)\}>/);
});

test('the add row is drawn inside the list, above the first row, which then keeps its corners square', async () => {
  const list = code(await read(LIST));
  // The page hands the add row over as the header; a list that drops it
  // leaves the '+' doing nothing anyone can see.
  assert.match(list, /style=\{containerStyle\}>\s*\{header\}\s*\{categories\.map\(/);
  assert.match(list, /const hasHeader = Boolean\(header\);/);
  assert.match(list, /const roundTop = framed && index === 0 && !hasHeader;/);
});
