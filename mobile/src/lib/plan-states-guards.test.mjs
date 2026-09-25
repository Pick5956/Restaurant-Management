import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The floor's state faces (PlanState, PlanFailed). One rule lives at a call
// site, so the guard reads the source: the line stretches to the row and
// centres its text, because Android measured a Thai line a fraction narrower
// than it drew it and clipped "ไม่พบเมนู" to "ไม่พบ" (Pixel 6 emulator,
// 24 ก.ย. 2569).

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');

/** The source without comments, so a note about a rule never passes for the rule. */
function code(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('the state line stretches to the row and centres its text, never a box cut to the text', async () => {
  const source = code(await read('src/components/table-plan/plan-states.tsx'));
  assert.match(source, /const LINE = \{ alignSelf: 'stretch', fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette\.textStrong, textAlign: 'center' \} as const;/);
  // Both faces draw the line from it, and nothing draws a shrink-wrapped line.
  assert.equal((source.match(/<Text style=\{LINE\}>\{line\}<\/Text>/g) || []).length, 2);
  assert.doesNotMatch(source, /<Text style=\{\{ fontSize: 15/);
});

test('the guard runs with the rest of the suite', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.test, /src\/lib\/plan-states-guards\.test\.mjs/);
});
