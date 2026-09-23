import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Guards on the menu categories screen's call sites. Its ordering maths, error
// mapping and inline-edit outcomes are tested in category-order.test.mjs,
// category-error.test.mjs and category-inline.test.mjs; these read the screen's
// own source and fail when a line that carries a rule is reverted: a rename that
// sends is_active (it once un-hid a hidden category, 2ec5ec2), the server's
// English reaching the screen, a drag that lets the page scroll under it, a
// delete that skips the in-use refusal, a rail that rides off with the page, the
// no-dots rule. A bug at a call site is invisible to a test of the function it
// calls.
//
// Since 2026-09-24 there is no editor sheet: a row swipes left for a delete
// rail, a tap turns its name into a field (done saves, a tap elsewhere cancels),
// and the header '+' opens an empty row above the list. The assertions below
// name the contract - components, props, library calls - never the screen's
// private helper names or its line breaks.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');
const SCREEN = 'app/menu/categories.tsx';
const SECTION_DIR = 'src/components/menu-categories';
const LIST = `${SECTION_DIR}/category-drag-list.tsx`;
const ROW = `${SECTION_DIR}/category-row.tsx`;
const FIELD = `${SECTION_DIR}/category-name-field.tsx`;
const EDITOR = `${SECTION_DIR}/category-editor.tsx`;

async function sectionFiles() {
  const names = (await readdir(path.join(mobileRoot, SECTION_DIR))).filter((name) => name.endsWith('.tsx'));
  const files = [SCREEN, ...names.map((name) => `${SECTION_DIR}/${name}`)];
  return Promise.all(files.map(async (file) => [file, await read(file)]));
}

/** Every .ts/.tsx file under app/ and src/, as paths relative to the app root. */
async function appSources(relative = '') {
  if (relative === '') return [...await appSources('app'), ...await appSources('src')];
  const entries = await readdir(path.join(mobileRoot, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) return appSources(child);
    return /\.tsx?$/.test(entry.name) ? [child] : [];
  }));
  return nested.flat();
}

/** The source without comments, so a note about a rule never passes for, or fails, the rule itself. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The argument text of every call to `fn(` in `source`, parentheses balanced. */
function callArgs(source, fn) {
  const calls = [];
  const pattern = new RegExp(`\\b${fn}\\(`, 'g');
  let match;
  while ((match = pattern.exec(source))) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      index += 1;
    }
    calls.push(source.slice(start, index - 1));
  }
  return calls;
}

// ---------------------------------------------------------------- source scanning

/**
 * The index of the quote that closes the string opening at `start`. A template's
 * `${}` is skipped whole; a quote left open at the end of its line is a stray
 * apostrophe in JSX text, not a string, and stops there.
 */
function skipString(source, start) {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      index = closeOf(source, index + 1) - 1;
      continue;
    }
    if (char === quote) return index;
    if (char === '\n' && quote !== '`') return index;
  }
  return source.length - 1;
}

/** The index just past the bracket that closes the one at `open`, strings skipped. */
function closeOf(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      index = skipString(source, index);
      continue;
    }
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

/** The nearest `open` before `from` that is not closed before it, or -1. */
function unmatchedOpen(source, from, open, close) {
  let depth = 0;
  for (let index = from - 1; index >= 0; index -= 1) {
    const char = source[index];
    if (char === close) depth += 1;
    else if (char === open) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Where the statement opening on the line at `start` ends: before the next line
 * at its own indentation that is not its closing bracket, or before the first
 * line indented less (the block around it closed).
 */
function statementEnd(source, start, indent) {
  let cursor = source.indexOf('\n', start);
  while (cursor !== -1) {
    const next = source.indexOf('\n', cursor + 1);
    const line = source.slice(cursor + 1, next === -1 ? source.length : next);
    if (line.trim() !== '') {
      const lead = /^[ \t]*/.exec(line)[0].length;
      if (lead < indent) return cursor;
      if (lead === indent && !/^[)}\]]/.test(line.trim())) return cursor;
    }
    cursor = next;
  }
  return source.length;
}

/** The source of the declaration of `name`, or null when there is none. */
function findDeclaration(source, name) {
  const match = new RegExp(`^([ \\t]*)(?:export )?(?:default )?(?:async )?(?:function|const|let) ${name}\\b`, 'm').exec(source);
  if (!match) return null;
  return source.slice(match.index, statementEnd(source, match.index, match[1].length));
}

/** The source of the declaration of `name`: from its line to the end of its statement. */
function declaration(source, name) {
  const found = findDeclaration(source, name);
  assert.ok(found, `${name} is declared`);
  return found;
}

// A named function: `function name(`, or a const holding an arrow (optionally
// through useCallback) whose parameters and arrow sit on its first line.
const FUNCTION_START = /^([ \t]*)(?:export )?(?:default )?(?:(?:async )?function (\w+)|const (\w+)\b[^=\n]*= (?:useCallback\()?(?:async )?(?:\([^\n]*\)|\w+)(?:: [^\n]+?)? =>)/gm;

function functionRanges(source) {
  return [...source.matchAll(FUNCTION_START)].map((match) => ({
    name: match[2] ?? match[3],
    start: match.index,
    end: statementEnd(source, match.index, match[1].length),
  }));
}

/** The innermost named function around `index`. */
function functionAt(source, index) {
  const found = functionRanges(source)
    .filter((range) => range.start <= index && index < range.end)
    .sort((a, b) => b.start - a.start)[0];
  assert.ok(found, `a named function holds offset ${index}`);
  return { ...found, text: source.slice(found.start, found.end) };
}

/** The innermost named function around the first `needle`. */
function functionContaining(source, needle) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, `${needle} is called`);
  return functionAt(source, index);
}

/** The `if (...) { ... }` block around `index`, past any object literal braces, or null. */
function enclosingIf(source, index) {
  let cursor = index;
  while (cursor > 0) {
    const brace = unmatchedOpen(source, cursor, '{', '}');
    if (brace < 0) return null;
    const head = source.slice(0, brace).trimEnd();
    if (head.endsWith(')')) {
      const paren = unmatchedOpen(source, head.length - 1, '(', ')');
      if (paren >= 0 && /\bif\s*$/.test(source.slice(0, paren))) {
        const end = closeOf(source, brace);
        return { text: source.slice(brace, end), end };
      }
    }
    cursor = brace;
  }
  return null;
}

/**
 * `text` plus the declarations of every identifier it names, followed the same
 * way to `depth` levels: what a prop's handler actually runs.
 */
function reach(source, text, depth = 3, seen = new Set()) {
  let out = text;
  if (depth === 0) return out;
  for (const [, name] of text.matchAll(/(?<![\w.$])([A-Za-z_]\w*)\b/g)) {
    if (seen.has(name)) continue;
    seen.add(name);
    const found = findDeclaration(source, name);
    if (found) out += `\n${reach(source, found, depth - 1, seen)}`;
  }
  return out;
}

/** Every opening JSX tag `<Name ...>` or `<Name ... />`, props and all. */
function openTags(source, name) {
  const tags = [];
  const pattern = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  let match;
  while ((match = pattern.exec(source))) {
    let index = match.index + match[0].length;
    while (index < source.length) {
      const char = source[index];
      if (char === '"' || char === "'") {
        index = skipString(source, index) + 1;
        continue;
      }
      if (char === '{') {
        index = closeOf(source, index);
        continue;
      }
      index += 1;
      if (char === '>') break;
    }
    tags.push(source.slice(match.index, index));
  }
  return tags;
}

/** The children of every `<Name>...</Name>` in `source`. */
function childrenOf(source, name) {
  return openTags(source, name)
    .filter((tag) => !tag.endsWith('/>'))
    .map((tag) => {
      const start = source.indexOf(tag) + tag.length;
      return source.slice(start, source.indexOf(`</${name}>`, start));
    });
}

/** A tag's own props: name -> expression text, `"literal"`, or 'true' when bare. Spreads and nested tags' props excluded. */
function attributes(tag) {
  const found = new Map();
  let index = tag.search(/[\s/>]/);
  while (index >= 0 && index < tag.length) {
    const char = tag[index];
    if (char === '>') break;
    if (char === '{') {
      index = closeOf(tag, index);
      continue;
    }
    const name = /^[A-Za-z_][\w-]*/.exec(tag.slice(index));
    if (!name) {
      index += 1;
      continue;
    }
    index += name[0].length;
    if (tag[index] !== '=') {
      found.set(name[0], 'true');
      continue;
    }
    index += 1;
    if (tag[index] === '{') {
      const end = closeOf(tag, index);
      found.set(name[0], tag.slice(index + 1, end - 1).trim());
      index = end;
    } else if (tag[index] === '"' || tag[index] === "'") {
      const end = skipString(tag, index);
      found.set(name[0], tag.slice(index, end + 1));
      index = end + 1;
    }
  }
  return found;
}

/** The body of `export type Name = { ... }`. */
function typeBody(source, name) {
  const start = source.search(new RegExp(`export type ${name} =[^{]*\\{`));
  assert.ok(start >= 0, `${name} is declared`);
  const open = source.indexOf('{', start);
  return source.slice(open, closeOf(source, open));
}

/**
 * True when a name check runs before the request at `index`: earlier in the
 * same function, or in the function holding a check that then calls this one.
 * Only the innermost function around each check counts - the screen component
 * holds every check and every call, and would vouch for all of them.
 */
function checkedBefore(source, index, check) {
  const fn = functionAt(source, index);
  if (source.slice(fn.start, index).includes(check)) return true;
  const call = new RegExp(`\\b${fn.name}\\(`);
  for (let at = source.indexOf(check); at >= 0; at = source.indexOf(check, at + 1)) {
    const holder = functionAt(source, at);
    if (holder.start !== fn.start && call.test(source.slice(at, holder.end))) return true;
  }
  return false;
}

/** A step's failure goes through the mapping under its own action, from its catch. */
function assertFailureRoute(source, fn, action) {
  const caught = /\bcatch \((\w+)\)/.exec(fn);
  assert.ok(caught, `the ${action} step catches its failure`);
  const handler = fn.slice(caught.index);
  assert.match(handler, new RegExp(`\\(\\s*${caught[1]},\\s*'${action}'`), `the ${action} failure is reported as '${action}'`);
  assert.match(reach(source, handler), /\bcategoryFailure\(/, `the ${action} failure goes through categoryFailure`);
  return handler.slice(0, closeOf(handler, handler.indexOf('{')));
}

test('the helpers read calls, declarations, tags and blocks, not the rest of the file', () => {
  const source = [
    'const save = async () => {',
    '  await updateCategory(id, { name: pick(a), display_order: 2 });',
    '};',
    'const other = 1;',
    'createCategory({ is_active: true });',
    'const remove = (category) => {',
    '  if (count(category) > 0) {',
    "    showToast({ title: 'x', message: inUse(category) });",
    '    return;',
    '  }',
    '  void destroy(category);',
    '};',
    'const destroy = async (category) => {',
    '  try {',
    '    await deleteCategory(category.ID);',
    '  } catch (err) {',
    "    report(err, 'delete');",
    '  }',
    '};',
    'const report = (err, action) => categoryFailure(err, action, language);',
    '<List locked={inlineLocked(mode)} onDelete={remove} framed header={<Row a="b>" />} {...rest} label="x" />',
    '<Shell>',
    '  <Field value={`a ${b}`} />',
    '</Shell>',
  ].join('\n');
  assert.deepEqual(callArgs(source, 'updateCategory'), ['id, { name: pick(a), display_order: 2 }']);
  assert.deepEqual(callArgs(source, 'createCategory'), ['{ is_active: true }']);
  assert.equal(declaration(source, 'save').includes('other'), false);
  assert.equal(/is_active/.test(callArgs('updateCategory(id, { name, display_order, is_active: true })', 'updateCategory')[0]), true);
  assert.equal(code("a(); // overflow: 'hidden'\n/* selectable */ b();"), 'a(); \n b();');

  assert.equal(functionContaining(source, 'deleteCategory(').name, 'destroy');
  assert.equal(functionContaining(source, 'inUse(').name, 'remove');
  const refusal = enclosingIf(source, source.indexOf('inUse('));
  assert.ok(refusal);
  assert.match(refusal.text, /return;/);
  assert.equal(refusal.text.includes('destroy'), false);
  assert.match(reach(source, 'remove'), /deleteCategory\(/);
  assert.match(reach(source, 'remove'), /categoryFailure\(/);
  assert.equal(checkedBefore(source, source.indexOf('deleteCategory('), 'inUse('), true);
  assert.equal(checkedBefore(source, source.indexOf('updateCategory('), 'inUse('), false);
  assertFailureRoute(source, functionContaining(source, 'deleteCategory(').text, 'delete');
  // A component that holds a check in one handler and a call in another vouches for neither.
  const screen = [
    'function Screen() {',
    '  const add = () => { check(); };',
    '  const rename = async () => { await request(); };',
    '  const both = () => { check(); void rename(); };',
    '  return <Row onSubmit={() => rename()} />;',
    '}',
  ].join('\n');
  assert.equal(checkedBefore(screen, screen.indexOf('request('), 'check('), true);
  assert.equal(checkedBefore(screen.replace('check(); void rename();', 'void rename();'), screen.indexOf('request('), 'check('), false);

  const props = attributes(openTags(source, 'List')[0]);
  assert.equal(props.get('locked'), 'inlineLocked(mode)');
  assert.equal(props.get('onDelete'), 'remove');
  assert.equal(props.get('framed'), 'true');
  assert.equal(props.get('header'), '<Row a="b>" />');
  assert.equal(props.get('label'), '"x"');
  assert.equal(props.has('a'), false, 'a nested tag lends the outer one nothing');
  assert.match(childrenOf(source, 'Shell')[0], /<Field value=\{`a \$\{b\}`\} \/>/);
});

// ---------------------------------------------------------------- the API contract

test('a rename and a reorder never send is_active, so a hidden category stays hidden', async () => {
  const screen = code(await read(SCREEN));
  const updates = callArgs(screen, 'updateCategory');
  assert.ok(updates.length >= 2, 'the rename and the reorder both write through updateCategory');
  for (const args of updates) {
    assert.equal(/is_active/.test(args), false, `updateCategory(${args}) sends is_active`);
    assert.match(args, /\bname\b/, 'a PUT must carry the name the server re-checks');
    assert.match(args, /display_order/, 'a PUT must carry the place');
  }
});

test('a new category starts shown and goes after the highest display_order', async () => {
  const screen = code(await read(SCREEN));
  const creates = callArgs(screen, 'createCategory');
  assert.equal(creates.length, 1, 'one create, from the add row');
  assert.match(creates[0], /\bis_active: true\b/);
  const order = /\bdisplay_order(?::\s*([^,}]+))?/.exec(creates[0]);
  assert.ok(order, 'a new category carries its place');
  assert.match(reach(screen, order[1] ?? 'display_order'), /\bnextCategoryDisplayOrder\(/);
  assert.equal(/\b(?:categories|sorted)\.length \+ 1/.test(screen), false, 'length + 1 collides with gaps and repeats');
});

test('a reorder writes only the categories whose number changed, and reloads on failure instead of reverting', async () => {
  const screen = code(await read(SCREEN));
  const reorder = functionContaining(screen, 'renumberCategories(').text;
  assert.match(reorder, /renumberCategories\(\w+\)/);
  assert.match(reorder, /\bchanged\.map\(\(?\w+\)? => updateCategory\(/);
  const handler = assertFailureRoute(screen, reorder, 'reorder');
  assert.equal(/\bsetCategories\(/.test(handler), false, 'a failed reorder must not put the old order back: some writes may have landed');
  // A load already in flight carries the old order.
  assert.match(reorder, /requestRef\.current \+= 1/);
  // The mapping says what to reload; the screen has to do it.
  assert.match(functionContaining(screen, 'categoryFailure(').text, /\.reload === 'list'[\s\S]*?\bload\(/);
});

test('a name is checked on the phone before any request, and finishing a field follows category-inline', async () => {
  const screen = code(await read(SCREEN));
  for (const name of ['renameOutcome', 'addOutcome', 'inlineLocked']) {
    assert.match(screen, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '@/src/lib/category-inline'`), `${name} comes from category-inline`);
  }
  // Done: trimmed, unchanged closes, empty reverts or drops the add row - the
  // tested rules, not a second copy of them written into the screen.
  assert.match(screen, /\brenameOutcome\(/);
  assert.match(screen, /\baddOutcome\(/);

  const create = screen.indexOf('createCategory(');
  assert.equal(checkedBefore(screen, create, 'categoryNameProblem('), true, 'a new name is checked before createCategory');
  const renames = [...screen.matchAll(/\bupdateCategory\(/g)]
    .map((match) => match.index)
    .filter((index) => !functionAt(screen, index).text.includes('renumberCategories('));
  assert.equal(renames.length, 1, 'one rename write, outside the reorder');
  assert.equal(checkedBefore(screen, renames[0], 'categoryNameProblem('), true, 'a rename is checked before updateCategory');
  // A refused name is said in a toast: there is no line under the field.
  assert.match(functionContaining(screen, 'categoryNameMessage(').text, /\bshowToast\(/);

  // A failed save keeps the field open with the typed name in it.
  for (const [needle, action] of [['createCategory(', 'add'], [null, 'save']]) {
    const fn = needle ? functionContaining(screen, needle) : functionAt(screen, renames[0]);
    const handler = assertFailureRoute(screen, fn.text, action);
    assert.equal(/\bIDLE\b|kind: 'idle'/.test(handler), false, `a failed ${action} must not close the field`);
  }
});

test('a delete comes from the swiped rail, and a category with dishes is refused before any request', async () => {
  const screen = code(await read(SCREEN));
  assert.equal(callArgs(screen, 'deleteCategory').length, 1);
  const onDelete = attributes(openTags(screen, 'CategoryDragList')[0] ?? '').get('onDelete');
  assert.ok(onDelete, 'the list is handed onDelete');
  const path = reach(screen, onDelete);
  assert.match(path, /\bcategoryInUseMessage\(/, 'the rail\'s delete passes the in-use refusal');
  assert.match(path, /\bdeleteCategory\(/, 'the rail\'s delete sends the request');

  // Refused as the old screen refused it: a toast naming the step, no request,
  // and a quiet re-read so a count gone stale (dishes moved on the web) cannot
  // block the delete for good.
  const at = screen.indexOf('categoryInUseMessage(');
  const refusal = enclosingIf(screen, at);
  assert.ok(refusal, 'the in-use refusal is its own branch');
  assert.match(refusal.text, /\bshowToast\(/);
  assert.match(refusal.text, /\bcategoryActionTitle\('delete'/);
  assert.match(refusal.text, /\bload\(\{ quiet: true \}\)/);
  assert.match(refusal.text, /\breturn\b/);
  assert.equal(refusal.text.includes('deleteCategory('), false, 'a refused delete sends nothing');
  const handler = functionAt(screen, at);
  assert.match(reach(screen, screen.slice(refusal.end, handler.end)), /\bdeleteCategory\(/, 'past the refusal the same handler deletes');

  assertFailureRoute(screen, functionContaining(screen, 'deleteCategory(').text, 'delete');
});

test('nothing is loaded without manage_menu', async () => {
  const screen = code(await read(SCREEN));
  assert.match(screen, /const canManage = can\(activeMembership, 'manage_menu'\);/);
  const focus = screen.slice(screen.indexOf('useFocusEffect(useCallback('));
  const body = focus.slice(0, focus.indexOf('}, ['));
  const permission = body.indexOf('if (!canManage) return;');
  const held = body.search(/if \(liftedRef\.current \|\| reorderBusyRef\.current\) return;/);
  const loads = body.search(/\bvoid load\(/);
  assert.ok(permission >= 0 && held >= 0 && loads >= 0, 'the focus reload checks permission and the drag, then loads');
  assert.ok(permission < held && held < loads, 'no load before the permission and drag checks');
});

// ---------------------------------------------------------------- what the user sees

test('the server wording never reaches the screen; failures go through the mapping and a toast', async () => {
  for (const [file, source] of await sectionFiles()) {
    assert.equal(/\b(err|error|e)\.message\b/.test(source), false, `${file} reads an error message`);
    assert.equal(/<Feedback[^>]*detail=/.test(source), false, `${file} stacks a failure panel into the page`);
  }
  const screen = code(await read(SCREEN));
  assert.match(screen, /const \{ showToast \} = useToast\(\);/);
  const failures = callArgs(screen, 'categoryFailure');
  assert.ok(failures.length >= 1);
  for (const args of failures) assert.match(args, /,\s*language\s*$/, `categoryFailure(${args}) must speak the screen's language`);
  assert.match(functionContaining(screen, 'categoryFailure(').text, /\bshowToast\(/);
  // Every toast line is the app's own words: a mapped message, or the mapped
  // failure's. `(err as Error).message` slips past the pattern above.
  const mapped = new Set([...screen.matchAll(/\bconst (\w+) = categoryFailure\(/g)].map((match) => match[1]));
  for (const args of callArgs(screen, 'showToast')) {
    const message = /\bmessage:\s*([^,}]+)/.exec(args)?.[1].trim();
    if (message === undefined) continue;
    const owner = /^(\w+)\.message$/.exec(message)?.[1];
    assert.ok(/^category\w+Message\(/.test(message) || mapped.has(owner), `showToast(${args}) says something the mapping did not`);
  }
});

test('no dots, no explanatory subtitle, no refresh control', async () => {
  for (const [file, source] of await sectionFiles()) {
    assert.equal(source.includes(' · '), false, `${file} joins values with a middle dot`);
    assert.equal(source.includes('•'), false, `${file} draws a bullet`);
    assert.equal(/\bsubtitle=/.test(source), false, `${file} explains the screen in a subtitle`);
    assert.equal(/\bRefreshControl\b/.test(source), false, `${file} adds a refresh control`);
    assert.equal(/detail=\{copy\(/.test(source), false, `${file} adds a detail line to a state`);
  }
});

test('every branch is a pushed screen with its back control', async () => {
  const screen = code(await read(SCREEN));
  const opens = openTags(screen, 'AppScreen');
  assert.ok(opens.length >= 2);
  for (const open of opens) assert.equal(attributes(open).get('topLevel'), 'false');
  const menu = await read('app/menu.tsx');
  assert.match(menu, /router\.push\('\/menu\/categories'/);
});

test('no sheet and no side panel: the editor is gone and nothing opens a raw Modal', async () => {
  await assert.rejects(access(path.join(mobileRoot, EDITOR)), `${EDITOR} is still on disk`);
  for (const file of await appSources()) {
    const source = code(await read(file));
    assert.equal(/category-editor|\bCategoryEditor\b/.test(source), false, `${file} still uses the category editor`);
  }
  for (const [file, source] of await sectionFiles()) {
    assert.equal(source.includes('<Modal'), false, `${file} opens a raw Modal`);
  }
  const screen = code(await read(SCREEN));
  assert.equal(/\bBottomSheet\b/.test(screen), false, 'the screen still draws a sheet');
  // The tablet shows the same inline list as the phone, not a list beside a panel.
  assert.equal(openTags(screen, 'CategoryDragList').length, 1, 'one list for every width');
});

test('names are edited in the row: a tap renames in place, the + opens an empty row above the list', async () => {
  const screen = code(await read(SCREEN));
  assert.match(screen, /import \{[^}]*\bCategoryNameField\b[^}]*\} from '@\/src\/components\/menu-categories\/category-name-field'/);
  assert.match(screen, /import \{[^}]*\bCategoryInlineRow\b[^}]*\} from '@\/src\/components\/menu-categories\/category-row'/);
  for (const kind of ['idle', 'renaming', 'adding']) assert.match(screen, new RegExp(`kind: '${kind}'`), `the screen never enters ${kind}`);

  const list = attributes(openTags(screen, 'CategoryDragList')[0] ?? '');
  assert.match(reach(screen, list.get('onRename') ?? ''), /kind: 'renaming'/, 'a tap on a row opens its name for renaming');
  assert.match(reach(screen, list.get('renderEditor') ?? ''), /<CategoryNameField\b/, 'the renamed row draws the name field');
  // The add row is the list's header: inside its frame, above the first row.
  assert.match(reach(screen, list.get('header') ?? ''), /<CategoryInlineRow\b/, 'the add row goes in as the list header');
  const shells = childrenOf(screen, 'CategoryInlineRow');
  assert.equal(shells.length, 1, 'one inline add row');
  assert.match(reach(screen, shells[0]), /<CategoryNameField\b/, 'the add row holds the name field');

  // The header '+', repeated by the compact bar, opens the add row.
  const main = openTags(screen, 'AppScreen').map(attributes).find((props) => props.has('onScrollBlocked'));
  assert.ok(main, 'the list screen is the AppScreen with onScrollBlocked');
  assert.equal(main.get('centerTitle'), 'true');
  const plus = openTags(reach(screen, main.get('action') ?? ''), 'GlassButton').map(attributes).find((props) => props.get('icon') === '"add"');
  assert.ok(plus, "the header action is a glass '+'");
  assert.match(reach(screen, plus.get('onPress') ?? ''), /kind: 'adding'/, "the '+' opens the add row");
  if (main.has('compactAction')) assert.match(reach(screen, main.get('compactAction')), /kind: 'adding'/, "the compact bar's '+' opens the add row");
});

test('a tap elsewhere cancels: the rename puts the old name back and the add row goes, with no request', async () => {
  const screen = code(await read(SCREEN));
  const fields = openTags(screen, 'CategoryNameField').map(attributes);
  assert.equal(fields.length, 2, 'one field for the rename, one for the add row');
  for (const field of fields) {
    const onCancel = field.get('onCancel') ?? '';
    const cancel = reach(screen, onCancel);
    // Done is the only save. A blur that saved or created would turn every
    // stray tap into a request.
    assert.equal(/\b(?:create|update|delete)Category\(/.test(cancel), false, `onCancel={${onCancel}} sends a request`);
    assert.match(cancel, /kind: 'idle'/, `onCancel={${onCancel}} leaves the field open`);
  }
});

// ---------------------------------------------------------------- the rows

test('the list is handed the inline contract and nothing of the sheet', async () => {
  const screen = code(await read(SCREEN));
  const props = attributes(openTags(screen, 'CategoryDragList')[0] ?? '');
  const added = ['onRename', 'onDelete', 'openRailId', 'onRailChange', 'editingId', 'renderEditor', 'locked'];
  for (const name of [...added, 'onReorder', 'onLiftChange', 'scrollControlRef']) {
    assert.ok(props.has(name), `CategoryDragList is not given ${name}`);
  }
  for (const name of ['selectedId', 'onOpen']) assert.equal(props.has(name), false, `CategoryDragList is still given ${name}`);
  // Renaming or adding holds every row still.
  assert.match(reach(screen, props.get('locked')), /\binlineLocked\(/);
  assert.match(reach(screen, props.get('editingId')), /renaming/);
  assert.match(props.get('openRailId'), /\bopenRailId\b/);
  assert.match(reach(screen, props.get('onRailChange')), /\bsetOpenRailId\b/);

  const type = typeBody(code(await read(LIST)), 'CategoryDragListProps');
  for (const name of [...added, 'header']) assert.match(type, new RegExp(`\\b${name}\\??:`), `CategoryDragListProps has no ${name}`);
  for (const name of ['selectedId', 'onOpen']) assert.equal(new RegExp(`\\b${name}\\??:`).test(type), false, `CategoryDragListProps keeps ${name}`);
});

test('each row is a SwipeToDeleteRow: one rail open at a time, and only the rail deletes', async () => {
  const list = code(await read(LIST));
  assert.match(list, /import \{[^}]*\bSwipeToDeleteRow\b[^}]*\} from '@\/src\/components\/swipe-to-delete-row'/);
  const swipes = openTags(list, 'SwipeToDeleteRow');
  assert.equal(swipes.length, 1, 'every category row sits in one SwipeToDeleteRow');
  const swipe = attributes(swipes[0]);
  // The rail is controlled by one id, so opening one closes the rest.
  assert.match(reach(list, swipe.get('open') ?? ''), /\bopenRailId === \w+\.ID\b|\b\w+\.ID === openRailId\b/);
  for (const name of ['onOpen', 'onClose']) assert.match(reach(list, swipe.get(name) ?? ''), /\bonRailChange\(/, `the rail's ${name} reports to the screen`);
  assert.match(reach(list, swipe.get('onDelete') ?? ''), /\bonDelete\(/, 'the rail\'s ลบ deletes');
  assert.match(reach(list, swipe.get('locked') ?? ''), /\blocked\b/, 'nothing swipes while a name is open');

  const rows = openTags(list, 'CategoryRow');
  assert.equal(rows.length, 1);
  const onPress = attributes(rows[0]).get('onPress') ?? '';
  assert.match(reach(list, onPress), /\bonRename\(/, 'a tap on a row renames it');
  assert.equal(/\bonDelete\(/.test(onPress), false, 'a tap on a row never deletes');
});

test('under a name field no row lifts or takes a tap, and the renamed row draws the field', async () => {
  const list = code(await read(LIST));
  const row = attributes(openTags(list, 'CategoryRow')[0] ?? '');
  const disabledByLock = /\blocked\b/.test(reach(list, row.get('disabled') ?? ''));
  const liftRefused = disabledByLock
    || /\blocked\b/.test(findDeclaration(list, 'lift') ?? '')
    || /\blocked\b/.test(row.get('onLongPress') ?? '');
  assert.ok(liftRefused, 'a long press lifts a row while a name is open');
  const tapRefused = disabledByLock || /\blocked\b/.test(reach(list, row.get('onPress') ?? ''));
  assert.ok(tapRefused, 'a tap renames a second row while a name is open');
  const slot = reach(list, row.get('nameSlot') ?? '');
  assert.match(slot, /\brenderEditor\(/, 'the renamed row draws renderEditor in its name slot');
  assert.match(slot, /\beditingId\b/, 'only the row being renamed draws the field');
});

test('CategoryRow gains a name slot, and the inline row is a shell that neither presses nor drags', async () => {
  const row = code(await read(ROW));
  assert.match(typeBody(row, 'CategoryRowProps'), /\bnameSlot\?:/);
  const component = declaration(row, 'CategoryRow');
  assert.ok((component.match(/\bnameSlot\b/g) ?? []).length >= 2, 'CategoryRow takes nameSlot and draws it');
  const shell = declaration(row, 'CategoryInlineRow');
  assert.match(shell, /^export function CategoryInlineRow\b/);
  assert.equal(/\bPressable\b|\bonPress\b|\bonLongPress\b|\bpanHandlers\b/.test(shell), false, 'the inline row takes no press and no drag');
});

test('the name field saves on done and cancels on a tap elsewhere, never both', async () => {
  const field = code(await read(FIELD));
  assert.match(field, /export function CategoryNameField\b/);
  const inputs = openTags(field, 'AppTextInput');
  assert.equal(inputs.length, 1, 'the field is the app\'s text input, which scales and sets the font like the row\'s name');
  const input = attributes(inputs[0]);
  assert.equal(input.get('returnKeyType'), '"done"');
  for (const name of ['autoFocus', 'selectTextOnFocus']) assert.ok(input.has(name), `the field lacks ${name}`);
  // The Done bar's button dismisses without submitting - here that is cancel,
  // one tap away from the key that saves.
  assert.ok(input.has('omitKeyboardDoneBar'), 'a Done bar over the field would cancel the rename it seems to confirm');
  assert.match(reach(field, input.get('editable') ?? ''), /\bbusy\b/, 'a save in flight still takes typing');

  // Done submits and then blurs: the ref set on submit keeps that blur from cancelling.
  const submit = reach(field, input.get('onSubmitEditing') ?? '');
  assert.match(submit, /\bonSubmit\(/);
  const guard = /\b(\w+)\.current = true\b/.exec(submit);
  assert.ok(guard, 'done marks itself before the blur that follows it');
  const blur = reach(field, input.get('onBlur') ?? '');
  const checked = blur.indexOf(`${guard[1]}.current`);
  assert.ok(checked >= 0 && checked < blur.indexOf('onCancel('), 'a blur checks for a submit before it cancels');
  assert.match(field, new RegExp(`\\b${guard[1]}\\.current = false\\b`), 'the submit mark is cleared, or every later blur is swallowed');
});

// ---------------------------------------------------------------- the drag and the rail

test('while a row is lifted the page does not scroll, and a scroll puts an open rail away', async () => {
  const screen = code(await read(SCREEN));
  const main = openTags(screen, 'AppScreen').map(attributes).find((props) => props.has('onScrollBlocked'));
  assert.ok(main, 'the list screen blocks scrolling through AppScreen');
  const blocked = main.get('onScrollBlocked').replace(/\s+/g, ' ');
  const shape = /^lifted \? noop : openRailId !== null \? (.+) : undefined$/.exec(blocked)
    ?? /^lifted \? noop : openRailId === null \? undefined : (.+)$/.exec(blocked);
  assert.ok(shape, `onScrollBlocked={${blocked}}: a lift freezes the page, an open rail closes on a drag, otherwise it scrolls`);
  assert.match(reach(screen, shape[1]), /\bsetOpenRailId\(null\)/);
  // The back swipe is off while a row is lifted and while a rail is out: the
  // swipe that closes a rail travels right, as the bill's does.
  const gesture = /navigation\.setOptions\(\{ gestureEnabled: ([^}]+?) \}\)/.exec(screen);
  assert.ok(gesture, 'the screen switches the back swipe');
  assert.match(gesture[1], /^(?:!lifted && openRailId === null|openRailId === null && !lifted)$/);
  // The focus reload reads the lift from a ref, written in the same call as the state.
  const onLiftChange = attributes(openTags(screen, 'CategoryDragList')[0] ?? '').get('onLiftChange');
  assert.ok(onLiftChange, 'the list reports its lift');
  assert.match(reach(screen, onLiftChange), /\bliftedRef\.current = /);
});

test('only the list claims the touch, and only after a lift', async () => {
  const list = await read(LIST);
  assert.match(list, /onStartShouldSetPanResponder: \(\) => false/);
  assert.match(list, /onMoveShouldSetPanResponderCapture: \(\) => Boolean\(session\.current && !session\.current\.dropping\)/);
  assert.match(list, /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(list, /onShouldBlockNativeResponder: \(\) => true/);
  assert.match(list, /delayLongPress=\{LONG_PRESS_MS\}/);
  // The lifted row's scale and shadow would be cut off by a clipping parent.
  assert.equal(/overflow: 'hidden'/.test(code(list)), false);
});

test('the offsets are zeroed after the new order renders, not before', async () => {
  const list = await read(LIST);
  assert.match(list, /pendingReset\.current = true;\n\s+env\.current\.onReorder\(/);
  assert.match(list, /useLayoutEffect\(\(\) => \{\n\s+if \(!pendingReset\.current\) return;/);
  assert.equal(/LayoutAnimation/.test(list), false);
});

test('a row can be held without starting a text selection', async () => {
  for (const file of [ROW, LIST]) {
    const source = code(await read(file));
    assert.equal(/\bselectable\b/.test(source), false, `${file} has selectable text inside a long-press row`);
  }
  const row = await read(ROW);
  // A wrapper around Pressable forwards what it does not use, spread first.
  assert.match(row, /<Pressable\s+\{\.\.\.rest\}/);
});

test('the guard runs with the rest of the suite', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const name of ['menu-categories-guards', 'category-inline', 'category-name-field', 'category-list-swipe']) {
    assert.match(pkg.scripts.test, new RegExp(`src/lib/${name}\\.test\\.mjs`), `${name}.test.mjs is left out of npm test`);
  }
});
