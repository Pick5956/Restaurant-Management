import assert from 'node:assert/strict';
import test from 'node:test';

import { runLimited } from './bulk-run.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('runLimited keeps the results in the order the items came in', async () => {
  const results = await runLimited([30, 10, 20], 4, async (value) => {
    await new Promise((resolve) => setTimeout(resolve, value));
    return value * 2;
  });
  assert.deepEqual(results, [60, 20, 40]);
});

test('runLimited never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  await runLimited(Array.from({ length: 11 }, (_, index) => index), 4, async () => {
    running += 1;
    peak = Math.max(peak, running);
    await tick();
    await tick();
    running -= 1;
    return null;
  });
  assert.equal(peak, 4);
});

test('a limit of 1 runs one after another, in order', async () => {
  const started = [];
  let running = 0;
  let peak = 0;
  await runLimited(['T1', 'T2', 'T3'], 1, async (label) => {
    started.push(label);
    running += 1;
    peak = Math.max(peak, running);
    await tick();
    running -= 1;
    return label;
  });
  assert.equal(peak, 1);
  assert.deepEqual(started, ['T1', 'T2', 'T3']);
});

test('a limit below 1 or not a number still runs everything, one at a time', async () => {
  for (const limit of [0, -3, Number.NaN]) {
    let peak = 0;
    let running = 0;
    const results = await runLimited([1, 2, 3], limit, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return value;
    });
    assert.deepEqual(results, [1, 2, 3]);
    assert.equal(peak, 1);
  }
});

test('progress is reported once per finished item, counting up to the total', async () => {
  const seen = [];
  await runLimited([1, 2, 3, 4, 5], 2, async (value) => value, (done, total) => seen.push(`${done}/${total}`));
  assert.deepEqual(seen, ['1/5', '2/5', '3/5', '4/5', '5/5']);
});

test('the index of each item is passed to the task', async () => {
  const results = await runLimited(['a', 'b', 'c'], 2, async (value, index) => `${index}${value}`);
  assert.deepEqual(results, ['0a', '1b', '2c']);
});

test('nothing to run gives an empty result without calling the task', async () => {
  let called = false;
  const results = await runLimited([], 4, async () => {
    called = true;
    return 1;
  });
  assert.deepEqual(results, []);
  assert.equal(called, false);
});

test('a task that throws is kept as a rejection and the others still finish', async () => {
  const finished = [];
  await assert.rejects(
    runLimited([1, 2, 3], 2, async (value) => {
      await tick();
      if (value === 2) throw new Error('boom');
      finished.push(value);
      return value;
    }),
    /boom/,
  );
  assert.deepEqual(finished.sort(), [1, 3]);
});
