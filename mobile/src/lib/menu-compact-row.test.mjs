import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The menu's row in the compact header (owner, 2026-09-23: "the list piled
// under the top, and the header does not come down with it ... look at Grab").
// Every rule here lives at a call site - which state the row reads, when the
// page goes back to the top, which field gets the caret - so the guard reads
// the source files themselves.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');

/** The source without comments, so a note about a rule never passes for the rule. */
async function code(relative) {
  return (await read(relative))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The body of the named arrow handler, up to its closing `};`. */
function handler(source, name) {
  const start = source.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} must exist`);
  const end = source.indexOf('\n  };', start);
  assert.ok(end > start, `${name} must close`);
  return source.slice(start, end);
}

test('the menu screen hands the compact header its row and a handle on the scroll', async () => {
  const screen = await code('app/menu.tsx');
  assert.match(screen, /scrollControlRef=\{scrollControlRef\}/);
  assert.match(screen, /compactRow=\{[\s\S]{0,120}<MenuCompactRow\b/);
  assert.doesNotMatch(screen, /compactHeader=\{false\}/, 'the menu keeps the collapsing header');
});

test('the compact row reads the page state, not a copy of it', async () => {
  const screen = await code('app/menu.tsx');
  const row = screen.slice(screen.indexOf('<MenuCompactRow'), screen.indexOf('/>', screen.indexOf('<MenuCompactRow')));
  assert.match(row, /category=\{category\}/);
  assert.match(row, /onCategory=\{setCategory\}/);
  assert.match(row, /options=\{categoryOptions\}/, 'the same options as the full bar');
  const bar = screen.slice(screen.indexOf('<MenuFilterBar'), screen.indexOf('/>', screen.indexOf('<MenuFilterBar')));
  assert.match(bar, /options=\{categoryOptions\}/);
  assert.match(bar, /category=\{category\}/);

  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.match(source, /<ChoiceChips\s+scroll\b[\s\S]{0,200}value=\{category\}/);
  assert.doesNotMatch(source, /useState\(/, 'the row holds no state of its own');
});

test('a filter picked in the compact row starts the list again from the top', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  const pick = handler(source, 'pick');
  const jump = pick.indexOf('scrollControlRef.current?.scrollTo(0, false)');
  const filter = pick.indexOf('onCategory(value)');
  assert.ok(jump >= 0, 'the page jumps to the top, unanimated');
  assert.ok(filter > jump, 'the jump comes before the list changes');
  assert.match(source, /onChange=\{pick\}/);
});

test('the round search button goes back to the top and puts the caret in the full search field', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  const search = handler(source, 'search');
  const jump = search.indexOf('scrollControlRef.current?.scrollTo(0, false)');
  const focus = search.search(/requestAnimationFrame\(\(\) => searchRef\.current\?\.focus\(\)\)/);
  assert.ok(jump >= 0, 'unanimated: the keyboard cuts an animated scroll short');
  assert.ok(focus > jump, 'the caret goes in a frame after the page is back at the top');
  assert.match(source, /icon="search-outline"[\s\S]{0,60}onPress=\{search\}/);

  const screen = await code('app/menu.tsx');
  const bar = screen.slice(screen.indexOf('<MenuFilterBar'), screen.indexOf('/>', screen.indexOf('<MenuFilterBar')));
  assert.match(bar, /searchRef=\{searchRef\}/);
  const filterBar = await code('src/components/menu-manage/menu-filter-bar.tsx');
  assert.match(filterBar, /<SearchField[\s\S]{0,200}inputRef=\{searchRef\}/);
});

test('the compact row fades in, so it holds no Liquid Glass and no way off the list', async () => {
  const source = await code('src/components/menu-manage/menu-compact-row.tsx');
  assert.doesNotMatch(source, /\bGlass[A-Z]\w*/, 'glass under a fading parent renders flat');
  assert.doesNotMatch(source, /variant="glass"|\bglass\b/);
  assert.doesNotMatch(source, /จัดหมวด|\/menu\/categories/, 'managing categories stays in the full bar');
});
