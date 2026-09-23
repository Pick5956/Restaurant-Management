import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ghostSpan,
  gridMetrics,
  PLAN_TILE_GAP,
  planDeepLink,
  planDeepLinkKey,
  spanWidth,
} from './table-plan-screen.ts';

test('a phone grid is three tiles that reach the right edge', () => {
  const metrics = gridMetrics(358, false);
  assert.equal(metrics.columns, 3);
  const row = spanWidth(metrics, 3);
  // Rounded down to a half point: never wider than the grid, never more than a point short.
  assert.ok(row <= 358, `row ${row} overflows 358`);
  assert.ok(358 - row < 1.5, `row ${row} stops short of 358`);
  assert.equal(metrics.labelRoom, metrics.tileWidth - 22);
});

test('a tablet grid fits as many ~116pt tiles as it can, and they fill the row', () => {
  for (const width of [640, 700, 777, 1000]) {
    const metrics = gridMetrics(width, true);
    assert.equal(metrics.columns, Math.max(3, Math.floor((width + PLAN_TILE_GAP) / (116 + PLAN_TILE_GAP))));
    const row = spanWidth(metrics, metrics.columns);
    assert.ok(row <= width && width - row < 1.5 * metrics.columns, `${width}: row ${row}`);
    assert.ok(metrics.tileWidth >= 116 && metrics.tileWidth < 160, `${width}: tile ${metrics.tileWidth}`);
  }
});

test('before the grid is measured there is no width to divide', () => {
  assert.deepEqual(gridMetrics(0, false), { columns: 3, tileWidth: 0, labelRoom: 0 });
  assert.deepEqual(gridMetrics(Number.NaN, true), { columns: 3, tileWidth: 0, labelRoom: 0 });
});

test('the ghost tile takes the rest of the last row, so no room ends in a hole', () => {
  // 17 tables: the last row is T16, T17 and the ghost.
  assert.equal(ghostSpan(17, 3), 1);
  // 16 tables: T16 alone, and the ghost runs the other two columns.
  assert.equal(ghostSpan(16, 3), 2);
  // 18 tables fill their rows: the ghost is a full row of its own.
  assert.equal(ghostSpan(18, 3), 3);
  // An empty room is one full-width bar.
  assert.equal(ghostSpan(0, 3), 3);
  assert.equal(ghostSpan(7, 5), 3);
  for (let count = 0; count < 40; count += 1) {
    for (const columns of [3, 4, 5, 7]) {
      assert.equal((count + ghostSpan(count, columns)) % columns, 0, `${count} tables in ${columns} columns`);
    }
  }
});

test('a spanning tile covers its columns and the gaps between them', () => {
  const metrics = gridMetrics(358, false);
  assert.equal(spanWidth(metrics, 1), metrics.tileWidth);
  assert.equal(spanWidth(metrics, 2), metrics.tileWidth * 2 + PLAN_TILE_GAP);
});

test('?table=<id> opens that table, ?add=1 the add sheet, anything else nothing', () => {
  assert.deepEqual(planDeepLink({ table: '42' }), { kind: 'table', id: 42 });
  assert.deepEqual(planDeepLink({ table: ['7', '8'] }), { kind: 'table', id: 7 });
  assert.deepEqual(planDeepLink({ add: '1' }), { kind: 'add' });
  // A table wins over add when both are given.
  assert.deepEqual(planDeepLink({ table: '5', add: '1' }), { kind: 'table', id: 5 });
  for (const bad of [{}, { table: '0' }, { table: '-3' }, { table: 'T5' }, { table: '1.5' }, { add: '0' }, { add: 'yes' }]) {
    assert.equal(planDeepLink(bad), null, JSON.stringify(bad));
  }
});

test('a link is acted on once, by its key', () => {
  assert.equal(planDeepLinkKey({ kind: 'table', id: 3 }), 'table:3');
  assert.equal(planDeepLinkKey({ kind: 'add' }), 'add');
  assert.equal(planDeepLinkKey(null), null);
});
