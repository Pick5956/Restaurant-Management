import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The order archive's compact header row (owner, 23 ก.ย. 2569: the Grab
// reference - once the heading has gone, only the controls a long list is read
// through come down with the reader). Every rule here lives at a call site in
// app/orders.tsx or in the row's own markup, so the guard reads the source.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');

/** The source without comments, so a note about a rule never passes for the rule. */
function code(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** From `export function <name>(` to the next top-level export or the end. */
function exported(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

test('the archive hands the shell a compact row and a handle on its scroll view', async () => {
  const screen = code(await read('app/orders.tsx'));
  const main = screen.slice(screen.indexOf('return (\n    <AppScreen'));
  assert.ok(main.length < screen.length, 'the main AppScreen must exist');
  const tag = main.slice(0, main.indexOf('\n    >\n'));
  assert.match(tag, /scrollControlRef=\{scrollControlRef\}/);
  assert.match(tag, /compactRow=\{\(\s*<ArchiveCompactRow\b/);
  // The shell's default is on; turning it off here would drop the row with it.
  assert.doesNotMatch(screen, /compactHeader=\{false\}/);
  // The denied screen is a short notice with nothing to filter.
  const denied = screen.slice(screen.indexOf("if (access === 'denied')"), screen.indexOf('return (\n    <AppScreen'));
  assert.doesNotMatch(denied, /compactRow/);
});

test('the compact row drives the page\'s own controls, never a copy of their state', async () => {
  const screen = code(await read('app/orders.tsx'));
  // One day sheet, opened by both day controls, showing one label.
  assert.equal(screen.match(/<ArchiveDaySheet\b/g)?.length, 1);
  assert.equal(screen.match(/onPress=\{\(\) => setDayOpen\(true\)\}/g)?.length, 1, 'the full day control opens the sheet');
  assert.match(screen, /onDayPress=\{\(\) => setDayOpen\(true\)\}/);
  assert.match(screen, /<ArchiveDayButton\s+label=\{dayLabel\}\s+accessibilityLabel=\{dayAccessibilityLabel\}/);
  assert.match(screen, /dayLabel=\{dayLabel\}\s+dayAccessibilityLabel=\{dayAccessibilityLabel\}/);
  // Search goes back to the one field on the page.
  assert.match(screen, /<SearchField[\s\S]*?inputRef=\{searchInputRef\}[\s\S]*?\/>/);
  assert.match(screen, /onSearchPress=\{searchFromTop\}/);
});

test('search jumps to the top before the caret goes in; a new day starts the list from its top', async () => {
  const screen = code(await read('app/orders.tsx'));
  assert.match(
    screen,
    /const searchFromTop = \(\) => \{\s*scrollControlRef\.current\?\.scrollTo\(0, false\);\s*requestAnimationFrame\(\(\) => searchInputRef\.current\?\.focus\(\)\);\s*\};/,
  );
  assert.match(
    screen,
    // A jump, not an animation: a new day answering mid-animation with a
    // shorter list would be caught by the shell's spring-back and sent to its end.
    /const applyDay = \(next: string \| null\) => \{\s*if \(next !== date\) scrollControlRef\.current\?\.scrollTo\(0, false\);\s*setDate\(next\);\s*\};/,
  );
  assert.match(screen, /onApply=\{applyDay\}/);
  assert.doesNotMatch(screen, /onApply=\{setDate\}/);
});

test('the row holds no glass: it fades in with the bar, and glass under a fade renders flat', async () => {
  const archive = code(await read('src/components/order-archive.tsx'));
  const row = exported(archive, 'ArchiveCompactRow');
  assert.doesNotMatch(row, /Glass|variant="glass"|\bglass\b/);
  assert.match(row, /<ArchiveDayButton compact\b/);
  assert.match(row, /<IconButton icon="search-outline"[^>]*size=\{COMPACT_BUTTON\}/);

  // The compact day control paints the glass's own fallback instead of glass.
  const day = exported(archive, 'ArchiveDayButton');
  const flat = day.slice(day.indexOf('{compact ? ('), day.indexOf(') : ('));
  assert.ok(flat.length > 0, 'the compact branch must exist');
  assert.doesNotMatch(flat, /Glass/);
  assert.match(flat, /borderColor: palette\.controlBorder, backgroundColor: palette\.primaryWash/);
  assert.match(day, /height: compact \? COMPACT_BUTTON : 52/);
  // A wrapper forwards what it does not use, before the props it owns.
  assert.match(day, /compact = false, \.\.\.rest \}/);
  assert.match(day, /<Pressable\s+\{\.\.\.rest\}\s+accessibilityRole="button"/);
});
