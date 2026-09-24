import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(mobileRoot, '..');
const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

/** A top-level function's source, from `start` to the `}` on its own line that closes it. */
function fn(source, start) {
  const from = source.indexOf(start);
  assert.ok(from !== -1, `${start} not found`);
  const close = /\r?\n\}\r?\n/g;
  close.lastIndex = from;
  const end = close.exec(source);
  assert.ok(end, `${start} never closes`);
  return source.slice(from, end.index + end[0].length);
}

// The backend answers a restock question with kind "stocklist" and one unit
// per row. The app's type stopped at pie, so the card fell through to vertical
// bars - of things that ran out every bar is 0, an empty frame with names.
test('the chart payload names the kinds the backend sends', async () => {
  const [types, backend] = await Promise.all([
    read('src', 'types', 'ai.ts'),
    readFile(path.join(repoRoot, 'backend', 'internal', 'service', 'ai_chart.go'), 'utf8'),
  ]);
  assert.match(backend, /AIChartStockList AIChartKind = "stocklist"/);
  assert.match(backend, /Units \[\]string `json:"units,omitempty"`/);
  assert.match(types, /kind: 'bar' \| 'line' \| 'pie' \| 'stocklist';/);
  assert.match(types, /units\?: string\[\];/);
});

test('a stocklist is drawn as a list, before any bar can be picked', async () => {
  const chart = await read('src', 'components', 'ai', 'chart.tsx');
  assert.match(chart, /^function StockList\(\{ data \}: \{ data: AIChartData \}\)/m);
  const card = fn(chart, 'export function AIChart(');
  assert.match(card, /if \(data\.kind === 'stocklist'\) return <StockList data=\{data\} \/>;/);
  assert.ok(
    card.indexOf("data.kind === 'stocklist'") < card.indexOf('<VerticalBars'),
    'the bars are chosen before the stocklist is looked at',
  );
});

test('the list keeps to the web\'s shape and the app\'s words', async () => {
  const chart = await read('src', 'components', 'ai', 'chart.tsx');
  const list = fn(chart, 'function StockList(');
  // Out of stock first, then running low, as the web lists them.
  assert.match(list, /const listed = \[\.\.\.out, \.\.\.low\];/);
  assert.match(list, /label="หมดแล้ว"/);
  assert.match(list, /label="ใกล้หมด"/);
  // No dots between values, and no line telling the reader where else to look.
  assert.doesNotMatch(list, / · /);
  assert.doesNotMatch(list, /•/);
  assert.doesNotMatch(list, /หน้าคลังวัตถุดิบ|stock page/);
});
