import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { palette } from './theme-palette.ts';

// Owner, 2026-09-25, pointing at บัญชีของฉัน: every box a person types into
// takes that form's look - white, a hairline edge, no glow - in place of the
// cream fill, orange-brown edge and shadow TextField, SearchField, Select and
// the guest count used. The colours live in palette.fieldFill / fieldBorder so
// the next change is one line; these read the call sites, because a test of
// the palette cannot see a field that stops using it.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const code = (relative) => readFileSync(path.join(mobileRoot, relative), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

/** From `export function <name>(` to the next top-level export. */
function exported(source, name) {
  const start = source.search(new RegExp(`export (?:const|function) ${name}\\b`));
  assert.ok(start >= 0, `${name} not found`);
  const end = source.slice(start + 1).search(/\nexport /);
  return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end);
}

test('the field colours are the account form\'s: white, the divider hairline', () => {
  assert.equal(palette.fieldFill, '#FFFFFF');
  assert.equal(palette.fieldBorder, palette.divider);
});

test('TextField, SearchField and Select draw the flat form box', () => {
  const ui = code('src/components/ui.tsx');
  const text = exported(ui, 'TextField');
  assert.match(text, /borderColor: error \? palette\.danger : focused \? palette\.primary : palette\.fieldBorder,/);
  assert.match(text, /backgroundColor: palette\.fieldFill,/);
  assert.doesNotMatch(text, /controlShadow|surfaceSubtle|controlBorder/);

  const search = exported(ui, 'SearchField');
  assert.match(search, /borderColor: focused \? palette\.primary : palette\.fieldBorder,/);
  assert.match(search, /backgroundColor: onGlass \? 'transparent' : palette\.fieldFill,/);
  // The glass field keeps its lift; the plain one is flat.
  assert.match(search, /\.\.\.\(onGlass \? controlShadow : null\)/);
  assert.doesNotMatch(search, /surfaceSubtle|controlBorder/);

  const select = exported(ui, 'Select');
  assert.match(select, /borderColor: palette\.fieldBorder,\s*borderRadius: radius\.md,\s*backgroundColor: palette\.fieldFill,/);
  assert.doesNotMatch(select.slice(0, select.indexOf('<Modal')), /controlShadow|borderStrong/);
});

test('the form Field, the table-plan sheet field and the guest count use the same colours', () => {
  const form = code('src/components/form/parts.tsx');
  assert.match(form, /borderColor: focused \? palette\.primary : palette\.fieldBorder, backgroundColor: editable \? palette\.fieldFill : '#FAF7F4'/);
  const sheet = code('src/components/table-plan/sheet-kit.tsx');
  assert.match(sheet, /borderColor: error \? ERROR_INK : focused \? palette\.primary : palette\.fieldBorder, backgroundColor: palette\.fieldFill/);
  const guests = code('src/components/open-table/guest-count-picker.tsx');
  assert.match(guests, /borderColor: palette\.fieldBorder,\s*borderRadius: radius\.md,\s*backgroundColor: palette\.fieldFill,/);
  const box = guests.slice(guests.indexOf('<TextInput'), guests.indexOf('/>', guests.indexOf('<TextInput')));
  assert.doesNotMatch(box, /controlShadow|surfaceSubtle|controlBorder/);
  assert.doesNotMatch(guests, /borderRadius: radius\.md, \.\.\.controlShadow/);
});

// Owner, 2026-09-25: "เปลี่ยนเป็นแบบเดียวกันให้หมด". The list screens filter
// with one row - chips that scroll sideways, then the row's round buttons -
// where the order screen, the floor and the table plan had a dropdown. A
// dropdown inside a form (a reservation slot, a unit, a role) stays one.
test('every list filter is the one chip row, never a dropdown', () => {
  const row = code('src/components/filter-chip-row.tsx');
  assert.match(row, /<ChoiceChips scroll sync=\{sync\} options=\{\[\.\.\.options\]\} value=\{value\} onChange=\{onChange\} \/>/);
  const screens = {
    'src/components/order-menu-grid.tsx': "{ key: 'all', label: copy('ทุกหมวด', 'All categories') }",
    'app/tables.tsx': "{ key: 'all', label: copy('ทุกโซน', 'All zones') }",
    'src/components/table-plan/plan-bars.tsx': "{ key: 'all', label: t('ทุกโซน', 'All zones') }",
  };
  for (const [file, first] of Object.entries(screens)) {
    const source = code(file);
    assert.match(source, /import \{ FilterChipRow \} from '@\/src\/components\/filter-chip-row';/, file);
    assert.ok(source.includes(`<FilterChipRow`), `${file} lost the chip row`);
    assert.ok(source.includes(first), `${file} lost its "all" chip`);
    assert.doesNotMatch(source, /<Select\b/, `${file} filters with a dropdown again`);
  }
  // The menu manager's rows are where the pattern came from: the same chips.
  assert.match(code('src/components/menu-manage/menu-filter-bar.tsx'), /<ChoiceChips\s+scroll/);
  assert.match(code('src/components/menu-manage/menu-compact-row.tsx'), /<ChoiceChips\s+scroll/);
});

// Owner, 2026-09-25, pointing at the stock page's search: take its curve, and
// keep the box small. Every search box is a capsule 44 tall (40 in the compact
// bar's row), the stock page's included.
test('every search box is a 44pt capsule, the stock page\'s too', () => {
  const ui = code('src/components/ui.tsx');
  assert.match(ui, /const SEARCH_FIELD_HEIGHT = 44;/);
  const search = exported(ui, 'SearchField');
  assert.match(search, /minHeight: compact \? 40 : SEARCH_FIELD_HEIGHT,\s*height: compact \? 40 : SEARCH_FIELD_HEIGHT,\s*paddingVertical: 0,/);
  assert.equal((search.match(/borderRadius: radius\.full/g) || []).length, 3, 'the input, its wrapper and its glass layer share the capsule');
  assert.doesNotMatch(search, /borderRadius: radius\.md/);
  const stock = code('src/components/inventory/parts.tsx');
  assert.match(stock, /export const SEARCH_HEIGHT = 44;/);
  assert.match(stock, /<GlassPanel radius=\{SEARCH_HEIGHT \/ 2\} interactive=\{false\} style=\{\{ flex: 1, height: SEARCH_HEIGHT,/);
});
