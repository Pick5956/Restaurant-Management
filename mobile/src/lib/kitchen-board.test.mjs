import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dealIntoColumns,
  formatKitchenMinutes,
  kitchenBoardStats,
  kitchenClockLabel,
  latestFinishedAt,
  sortTicketsByWait,
  ticketProgress,
} from './kitchen-board.ts';

const NOW = Date.parse('2026-09-12T10:42:00Z');
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();
const ticket = (sentMinutesAgo, items = [{ status: 'cooking' }]) => ({
  kitchen_sent_at: minutesAgo(sentMinutesAgo),
  items,
});

test('the ticket that has waited longest comes first', () => {
  const sorted = sortTicketsByWait([ticket(2), ticket(18), ticket(7)], NOW);
  assert.deepEqual(sorted.map((t) => t.kitchen_sent_at), [minutesAgo(18), minutesAgo(7), minutesAgo(2)]);
});

test('equal waits keep the queue order and the input is not mutated', () => {
  const a = { ...ticket(5), tag: 'a' };
  const b = { ...ticket(5), tag: 'b' };
  const input = [b, a];
  const sorted = sortTicketsByWait(input, NOW);
  assert.deepEqual(sorted.map((t) => t.tag), ['b', 'a']);
  assert.deepEqual(input.map((t) => t.tag), ['b', 'a']);
});

test('the bar fills over ten minutes and stops there', () => {
  assert.equal(ticketProgress(0), 0);
  assert.equal(ticketProgress(5), 0.5);
  assert.equal(ticketProgress(10), 1);
  assert.equal(ticketProgress(18), 1);
  assert.equal(ticketProgress(Number.NaN), 0);
});

test('the tiles count rounds, cooking items and overdue rounds', () => {
  const cooking = [
    ticket(18, [{ status: 'cooking' }, { status: 'cooking' }, { status: 'ready' }]),
    ticket(7, [{ status: 'cooking' }]),
    ticket(2, [{ status: 'cooking' }]),
  ];
  const done = [
    { kitchen_sent_at: minutesAgo(20), items: [{ status: 'ready', ready_at: minutesAgo(11) }] }, // 9 min
    { kitchen_sent_at: minutesAgo(30), items: [{ status: 'ready', ready_at: minutesAgo(11) }] }, // 19 min
    { kitchen_sent_at: null, items: [{ status: 'ready', ready_at: minutesAgo(1) }] },            // unknown
  ];
  const stats = kitchenBoardStats(cooking, done, NOW);
  assert.equal(stats.cookingRounds, 3);
  assert.equal(stats.cookingItems, 4);
  assert.equal(stats.overdueRounds, 1);
  assert.equal(stats.doneRounds, 3);
  assert.equal(stats.averageDoneSeconds, 14 * 60);
  assert.equal(stats.slowestDoneSeconds, 19 * 60);
});

test('an empty board has no average rather than a zero one', () => {
  const stats = kitchenBoardStats([], [], NOW);
  assert.equal(stats.cookingRounds, 0);
  assert.equal(stats.averageDoneSeconds, null);
  assert.equal(stats.slowestDoneSeconds, null);
});

test('minutes read whole, and a round under a minute says so', () => {
  assert.equal(formatKitchenMinutes(9 * 60 + 12, 'th'), '9 นาที');
  assert.equal(formatKitchenMinutes(9 * 60 + 40, 'en'), '10 min');
  assert.equal(formatKitchenMinutes(20, 'th'), 'ไม่ถึงนาที');
  assert.equal(formatKitchenMinutes(null, 'th'), '−');
});

test('the clock label is the shop time without seconds', () => {
  assert.equal(kitchenClockLabel(Date.parse('2026-09-12T10:39:05Z'), 'en'), '17:39');
  assert.equal(kitchenClockLabel(null, 'th'), '−');
});

test('the latest finished round is the newest ready stamp across rounds', () => {
  const done = [
    { kitchen_sent_at: minutesAgo(20), items: [{ status: 'ready', ready_at: minutesAgo(11) }] },
    { kitchen_sent_at: minutesAgo(9), items: [{ status: 'ready', ready_at: minutesAgo(1) }, { status: 'cooking' }] },
  ];
  assert.equal(latestFinishedAt(done), NOW - 60000);
  assert.equal(latestFinishedAt([]), null);
});

test('tickets are dealt across the columns in order', () => {
  assert.deepEqual(dealIntoColumns([1, 2, 3, 4, 5], 2), [[1, 3, 5], [2, 4]]);
  assert.deepEqual(dealIntoColumns([], 2), [[], []]);
  assert.deepEqual(dealIntoColumns([1, 2], 0), [[1, 2]]);
});
