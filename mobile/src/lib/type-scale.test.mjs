import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The app's type ceiling, set by the owner on 16 ก.ย. 2569 after a shop name
// and a row of dashboard figures were both drawn louder than the name of the
// page they sat on: nothing may be larger than a screen title, and nothing at
// that size may be heavier than one. `typeScale.hero` is that title.
const CEILING_SIZE = 20;
const CEILING_WEIGHT = 600;

async function screenSources() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        await walk(full);
        continue;
      }
      if (entry.name.endsWith('.tsx')) files.push(full);
    }
  }
  await walk(path.join(mobileRoot, 'app'));
  await walk(path.join(mobileRoot, 'src'));
  return Promise.all(files.map(async (file) => [path.relative(mobileRoot, file), await readFile(file, 'utf8')]));
}

test('the screen title is the largest type in the app', async () => {
  const oversized = [];
  for (const [name, source] of await screenSources()) {
    source.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/fontSize:\s*(\d+(?:\.\d+)?)/g)) {
        if (Number(match[1]) > CEILING_SIZE) oversized.push(`${name}:${index + 1} fontSize ${match[1]}`);
      }
    });
  }
  assert.deepEqual(oversized, [], `larger than the ${CEILING_SIZE}pt screen title:\n${oversized.join('\n')}`);
});

test('nothing set at title size is drawn heavier than the title', async () => {
  const tooHeavy = [];
  for (const [name, source] of await screenSources()) {
    source.split('\n').forEach((line, index) => {
      const atCeiling = /fontSize:\s*(19|20)\b/.test(line) || /typeScale\.hero/.test(line);
      if (!atCeiling) return;
      const weight = line.match(/fontWeight:\s*'(\d{3}|bold)'/);
      if (!weight) return;
      const value = weight[1] === 'bold' ? 700 : Number(weight[1]);
      if (value > CEILING_WEIGHT) tooHeavy.push(`${name}:${index + 1} fontWeight ${weight[1]}`);
    });
  }
  assert.deepEqual(tooHeavy, [], `heavier than the screen title at its own size:\n${tooHeavy.join('\n')}`);
});

test('the ceiling lives in the type scale, not in a screen', async () => {
  const theme = await readFile(path.join(mobileRoot, 'src', 'theme.ts'), 'utf8');
  const hero = theme.slice(theme.indexOf('  hero: {'), theme.indexOf('  title: {'));
  assert.match(hero, new RegExp(`fontSize: ${CEILING_SIZE},`));
  assert.match(hero, new RegExp(`fontWeight: '${CEILING_WEIGHT}',`));
  // Thai stacks tone marks above the line; 1.4x is the floor before the app's
  // own text component starts cropping them.
  const lineHeight = Number(hero.match(/lineHeight: (\d+),/)?.[1]);
  assert.ok(lineHeight >= CEILING_SIZE * 1.4, `hero lineHeight ${lineHeight} crops Thai tone marks`);
});
