import assert from 'node:assert/strict';
import test from 'node:test';

import {
  elapsedDays,
  expenseCategoryLabel,
  expenseChipCategories,
  expenseDay,
  expenseDayLabel,
  expenseShares,
  expenseTitle,
  groupExpensesByDay,
} from './expense-view.ts';

const row = (id, spentAt, amount, category = 'ingredient', note = '') => ({ ID: id, spent_at: spentAt, amount, category, note });

test('an expense spent after midnight Bangkok time belongs to that Bangkok day', () => {
  // 17:30 UTC on the 14th is 00:30 on the 15th in Bangkok.
  assert.equal(expenseDay('2026-09-14T17:30:00Z'), '2026-09-15');
  assert.equal(expenseDay('2026-09-15T10:00:00+07:00'), '2026-09-15');
  assert.equal(expenseDay('not a date'), '');
});

test('entries group by day, newest day first, and each day takes the server total', () => {
  const groups = groupExpensesByDay(
    [row(3, '2026-09-15T09:00:00+07:00', 815), row(2, '2026-09-14T12:00:00+07:00', 1956.86), row(1, '2026-09-14T08:00:00+07:00', 100)],
    [{ date: '2026-09-14', amount: 2500, entries: 3 }, { date: '2026-09-15', amount: 815, entries: 1 }],
  );
  assert.deepEqual(groups.map((group) => [group.date, group.amount, group.entries, group.items.map((item) => item.ID)]), [
    ['2026-09-15', 815, 1, [3]],
    ['2026-09-14', 2500, 3, [2, 1]],
  ]);
});

test('a day the server did not total is summed from its rows', () => {
  const [group] = groupExpensesByDay([row(1, '2026-09-10T08:00:00+07:00', 120.5), row(2, '2026-09-10T09:00:00+07:00', 79.5)]);
  assert.equal(group.amount, 200);
  assert.equal(group.entries, 2);
});

test('shares come biggest first with whole percents, and empty categories drop out', () => {
  const { total, entries, shares } = expenseShares([
    { category: 'utilities', amount: 3710, entries: 3 },
    { category: 'ingredient', amount: 35460, entries: 18 },
    { category: 'labor', amount: 0, entries: 0 },
    { category: 'equipment', amount: 1744, entries: 1 },
  ]);
  assert.equal(total, 40914);
  assert.equal(entries, 22);
  assert.deepEqual(shares.map((share) => [share.category, share.percent]), [['ingredient', 87], ['utilities', 9], ['equipment', 4]]);
});

test('the chips show categories that have entries, plus the chosen one', () => {
  const { shares } = expenseShares([{ category: 'ingredient', amount: 10, entries: 1 }]);
  assert.deepEqual(expenseChipCategories(shares, 'all'), ['ingredient']);
  assert.deepEqual(expenseChipCategories(shares, 'rent'), ['ingredient', 'rent']);
});

test('a month still running averages over the days so far', () => {
  assert.equal(elapsedDays({ from: '2026-09-01', to: '2026-09-30' }, '2026-09-15'), 15);
  assert.equal(elapsedDays({ from: '2026-08-01', to: '2026-08-31' }, '2026-09-15'), 31);
  assert.equal(elapsedDays({ from: '2026-10-01', to: '2026-10-31' }, '2026-09-15'), 0);
});

test('day headings name today and yesterday', () => {
  assert.equal(expenseDayLabel('2026-09-15', '2026-09-15', 'th'), 'วันนี้ · 15 ก.ย.');
  assert.equal(expenseDayLabel('2026-09-14', '2026-09-15', 'th'), 'เมื่อวาน · 14 ก.ย.');
  assert.equal(expenseDayLabel('2026-09-13', '2026-09-15', 'th'), 'อา. 13 ก.ย.');
  assert.equal(expenseDayLabel('2026-09-01', '2026-09-01', 'en'), 'Today · Sep 1');
});

test('a row without a note is titled by its category', () => {
  assert.equal(expenseTitle({ note: '  ', category: 'utilities' }, 'th'), 'สาธารณูปโภค');
  assert.equal(expenseTitle({ note: 'ซื้อพริกป่น', category: 'ingredient' }, 'th'), 'ซื้อพริกป่น');
  assert.equal(expenseCategoryLabel('mystery', 'en'), 'Other');
});
