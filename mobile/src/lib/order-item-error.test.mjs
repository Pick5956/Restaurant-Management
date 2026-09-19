import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { stockFailure, stockFailureMessage } from './order-item-error.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the two stock refusals the order API sends are recognised', () => {
  assert.deepEqual(stockFailure('ข้าวผัดกุ้ง is sold out'), { kind: 'sold_out', name: 'ข้าวผัดกุ้ง' });
  assert.deepEqual(stockFailure('only 2 left for ต้มยำกุ้ง'), { kind: 'only_left', name: 'ต้มยำกุ้ง', left: 2 });
  assert.equal(stockFailure('cannot send a closed order to kitchen'), null);
  assert.equal(stockFailure(''), null);
  assert.equal(stockFailure(undefined), null);
});

test('a stock refusal is said in the app’s own words, the way the web POS says it', () => {
  assert.equal(stockFailureMessage({ kind: 'sold_out', name: 'ชาเย็น' }, 'th'), 'ชาเย็น หมดแล้ว');
  assert.equal(stockFailureMessage({ kind: 'only_left', name: 'ชาเย็น', left: 3 }, 'th'), 'ชาเย็น เหลืออีก 3 ที่');
  assert.equal(stockFailureMessage({ kind: 'sold_out', name: 'Thai tea' }, 'en'), 'Thai tea is sold out');
  assert.equal(stockFailureMessage({ kind: 'only_left', name: 'Thai tea', left: 3 }, 'en'), 'Only 3 left of Thai tea');
});

test('adding a dish never puts the API’s wording on screen', async () => {
  const [itemSource, editorSource, detailSource] = await Promise.all([
    readFile(path.join(mobileRoot, 'app', 'order', 'item.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'src', 'components', 'order-item-editor.tsx'), 'utf8'),
    readFile(path.join(mobileRoot, 'app', 'order', '[id].tsx'), 'utf8'),
  ]);
  // "X is sold out" reached the screen through these two: the item editor's
  // add failure and the order screen's quantity change. The editor is shared
  // by the phone's item screen and the tablet's dish panel.
  assert.doesNotMatch(itemSource, /setError\(err instanceof Error \? err\.message/);
  assert.doesNotMatch(editorSource, /setError\(err instanceof Error \? err\.message/);
  assert.match(editorSource, /stockFailure\(/);
  assert.doesNotMatch(detailSource, /message: err instanceof Error \? err\.message/);
  assert.match(detailSource, /stockFailure\(/);
});
