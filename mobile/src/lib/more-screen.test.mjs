import assert from 'node:assert/strict';
import test from 'node:test';

import { MORE_GROUPS, MORE_TITLES, groupMoreItems, restaurantMark } from './more-screen.ts';

const ALL = ['home', 'pos', 'kitchen', 'orders', 'menu', 'inventory', 'tables-manage', 'staff', 'reports', 'expenses', 'ai', 'settings'].map((key) => ({ key }));

// The four screens the phone dock used to hold lead the hub (owner,
// 2026-09-23): the dock is gone and this is the screen every session opens on.
test('an owner sees the service screens, then the shop group, then insights and account', () => {
  const groups = groupMoreItems(ALL);
  assert.deepEqual(groups.map((group) => group.key), ['work', 'shop', 'team']);
  assert.deepEqual(groups[0].items.map((item) => item.key), ['home', 'pos', 'kitchen', 'orders']);
  assert.deepEqual(groups[1].items.map((item) => item.key), ['menu', 'inventory', 'tables-manage', 'expenses']);
  assert.deepEqual(groups[2].items.map((item) => item.key), ['reports', 'ai', 'settings']);
});

test('a chef who may only see the kitchen gets the kitchen at the top of the hub', () => {
  const chef = groupMoreItems([{ key: 'kitchen' }, { key: 'settings' }]);
  assert.deepEqual(chef.map((group) => [group.key, group.items.map((item) => item.key)]), [['work', ['kitchen']], ['team', ['settings']]]);
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

test('a row is named for the job, and every override has both languages', () => {
  // The rail calls it "เมนูอาหาร"; a row someone taps to go and edit prices says so.
  assert.deepEqual(MORE_TITLES.menu, { th: 'จัดการเมนูอาหาร', en: 'Manage menu' });
  for (const [key, title] of Object.entries(MORE_TITLES)) {
    assert.ok(title.th && title.en, key);
    assert.ok(MORE_GROUPS.some((group) => group.itemKeys.includes(key)), `${key} is not on this screen`);
  }
});

test('the shop mark keeps a leading Thai vowel with its consonant', () => {
  assert.equal(restaurantMark('บ้านกูเอง'), 'บ');
  assert.equal(restaurantMark('เจ๊หมวย'), 'เจ');
  assert.equal(restaurantMark('  noodle bar'), 'N');
  assert.equal(restaurantMark(''), '?');
});

// Stress test, 2026-09-23: the mark took the first code point, so a flag gave
// a lone regional indicator ('T' in a box), a ZWJ emoji lost its tail and
// '@Home' gave '@'.
test('the shop mark skips a leading flag, emoji or symbol to the first letter', () => {
  assert.equal(restaurantMark('\u{1F1F9}\u{1F1ED} ครัวไทยแท้'), 'ค');
  assert.equal(restaurantMark('\u{1F468}‍\u{1F373} ครัวพ่อ'), 'ค');
  assert.equal(restaurantMark('@Home Café'), 'H');
  assert.equal(restaurantMark('\u{1F35C} เจ๊หมวย'), 'เจ');
  assert.equal(restaurantMark('"7 Spoons"'), '7');
});

test('a name with no letter or digit is marked with its first emoji whole, or a question mark', () => {
  assert.equal(restaurantMark('\u{1F35C}'), '\u{1F35C}');
  assert.equal(restaurantMark(' \u{1F1F9}\u{1F1ED} '), '\u{1F1F9}\u{1F1ED}');
  assert.equal(restaurantMark('\u{1F468}‍\u{1F373}\u{1F35C}'), '\u{1F468}‍\u{1F373}');
  assert.equal(restaurantMark('\u{1F44D}\u{1F3FD}!'), '\u{1F44D}\u{1F3FD}');
  assert.equal(restaurantMark('❤️'), '❤️');
  assert.equal(restaurantMark('!!!'), '?');
  assert.equal(restaurantMark('   '), '?');
});
