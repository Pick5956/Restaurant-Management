import assert from 'node:assert/strict';
import test from 'node:test';

import { MORE_DETAILS, MORE_GROUPS, groupMoreItems, restaurantMark } from './more-screen.ts';

const ALL = ['menu', 'inventory', 'tables-manage', 'staff', 'reports', 'expenses', 'ai', 'settings'].map((key) => ({ key }));

test('an owner sees the shop group then insights and account, in the chosen order', () => {
  const groups = groupMoreItems(ALL);
  assert.deepEqual(groups.map((group) => group.key), ['shop', 'team']);
  assert.deepEqual(groups[0].items.map((item) => item.key), ['menu', 'inventory', 'tables-manage', 'expenses']);
  assert.deepEqual(groups[1].items.map((item) => item.key), ['reports', 'ai', 'settings']);
});

test('staff is not listed: it opens from settings only', () => {
  const keys = groupMoreItems(ALL).flatMap((group) => group.items.map((item) => item.key));
  assert.equal(keys.includes('staff'), false);
});

test('items a person may not open are left out, and an empty group disappears', () => {
  const chef = groupMoreItems([{ key: 'inventory' }, { key: 'settings' }]);
  assert.deepEqual(chef.map((group) => [group.key, group.items.map((item) => item.key)]), [['shop', ['inventory']], ['team', ['settings']]]);
  const onlySettings = groupMoreItems([{ key: 'settings' }]);
  assert.deepEqual(onlySettings.map((group) => group.key), ['team']);
});

test('every listed item has a line in both languages', () => {
  for (const group of MORE_GROUPS) {
    for (const key of group.itemKeys) {
      assert.ok(MORE_DETAILS[key]?.th && MORE_DETAILS[key]?.en, key);
    }
  }
});

test('the shop mark keeps a leading Thai vowel with its consonant', () => {
  assert.equal(restaurantMark('บ้านกูเอง'), 'บ');
  assert.equal(restaurantMark('เจ๊หมวย'), 'เจ');
  assert.equal(restaurantMark('  noodle bar'), 'N');
  assert.equal(restaurantMark(''), '?');
});
