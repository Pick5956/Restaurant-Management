import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function sources(dir) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(full);
        continue;
      }
      if (entry.name.endsWith('.tsx')) files.push(full);
    }
  }
  await walk(path.join(mobileRoot, dir));
  return Promise.all(files.map(async (file) => [path.relative(mobileRoot, file), await readFile(file, 'utf8')]));
}

test('anything drawn over a screen stops the tab pager underneath it', async () => {
  // A modal is its own host view, so the pager's responder never sees the
  // touches land on the sheet - it saw a drag from nowhere and changed tabs
  // under the kitchen's open finished-rounds sheet (16 ก.ย. 2569). Every
  // overlay has to declare itself for as long as it is up.
  const missing = [];
  for (const [name, source] of [...await sources('src'), ...await sources('app')]) {
    if (!source.includes('<Modal')) continue;
    if (!source.includes('useTabSwipeCover(')) missing.push(name);
  }
  assert.deepEqual(missing, [], `these render a modal without useTabSwipeCover:\n${missing.join('\n')}`);
});

test('the cover is released when the overlay closes, and when its screen leaves', async () => {
  const runtime = await readFile(path.join(mobileRoot, 'src', 'components', 'primary-tabs-runtime.tsx'), 'utf8');
  const hook = runtime.slice(runtime.indexOf('export function usePrimaryTabSwipeCover'));
  const body = hook.slice(0, hook.indexOf('export function usePrimaryTabVerticalScrollActivityReporter'));

  assert.match(body, /if \(!covered\) return undefined;/);
  assert.match(body, /setNestedHorizontalGestureActive\(true\);/);
  // The cleanup is the half that matters: a screen closed with its sheet open
  // would otherwise leave the pager switched off for the rest of the session.
  assert.match(body, /return \(\) => setNestedHorizontalGestureActive\(false\);/);

});
