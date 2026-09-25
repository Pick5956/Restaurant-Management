import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampGuestCount,
  digitsOnly,
  GUEST_COUNT_MAX,
  GUEST_COUNT_MIN,
  parseGuestCount,
  QUICK_GUEST_COUNTS,
  seedGuestCount,
} from './guest-count.ts';

test('a field that is empty or unreadable counts as one guest', () => {
  assert.equal(parseGuestCount(''), 1);
  assert.equal(parseGuestCount(null), 1);
  assert.equal(parseGuestCount(undefined), 1);
  assert.equal(parseGuestCount('0'), 1);
  assert.equal(parseGuestCount('abc'), 1);
  assert.equal(parseGuestCount('-3'), 1);
});

test('a typed count is read as the whole number it starts with', () => {
  assert.equal(parseGuestCount('12'), 12);
  assert.equal(parseGuestCount('4'), 4);
  assert.equal(parseGuestCount('007'), 7);
  assert.equal(parseGuestCount('12abc'), 12);
});

test('the count never leaves the range the field and the API accept', () => {
  assert.equal(GUEST_COUNT_MIN, 1);
  assert.equal(GUEST_COUNT_MAX, 9999);
  assert.equal(clampGuestCount(0), 1);
  assert.equal(clampGuestCount(-5), 1);
  assert.equal(clampGuestCount(10000), 9999);
  assert.equal(clampGuestCount(9999), 9999);
  assert.equal(clampGuestCount(Number.NaN), 1);
  assert.equal(clampGuestCount(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampGuestCount(3.7), 3);
  assert.equal(parseGuestCount('99999'), 9999);
});

test('a table seeds the count from its seats, up to six', () => {
  assert.equal(seedGuestCount(0), 1);
  assert.equal(seedGuestCount(null), 1);
  assert.equal(seedGuestCount(undefined), 1);
  assert.equal(seedGuestCount(2), 2);
  assert.equal(seedGuestCount(6), 6);
  assert.equal(seedGuestCount(10), 6);
});

test('only digits survive in the count field', () => {
  assert.equal(digitsOnly('12'), '12');
  assert.equal(digitsOnly('1 2'), '12');
  assert.equal(digitsOnly('-3'), '3');
  assert.equal(digitsOnly('๑2a'), '2');
  assert.equal(digitsOnly(''), '');
});

test('the quick counts are the party sizes one to six, in order', () => {
  assert.deepEqual([...QUICK_GUEST_COUNTS], [1, 2, 3, 4, 5, 6]);
});
