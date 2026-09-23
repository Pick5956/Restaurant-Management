import assert from 'node:assert/strict';
import test from 'node:test';

import { addOutcome, inlineLocked, renameOutcome } from './category-inline.ts';

test('a rename to a new name saves the name', () => {
  assert.deepEqual(renameOutcome('ของหวาน', 'ของทานเล่น'), { kind: 'save', name: 'ของทานเล่น' });
});

test('a rename saves the trimmed name, never the spaces around it', () => {
  assert.deepEqual(renameOutcome('Drinks', '  Beverages  '), { kind: 'save', name: 'Beverages' });
  assert.deepEqual(renameOutcome('ของหวาน', '\tเครื่องดื่ม\n'), { kind: 'save', name: 'เครื่องดื่ม' });
});

test('a rename keeps the spaces inside a name', () => {
  assert.deepEqual(renameOutcome('ต้ม', ' ต้ม ยำ '), { kind: 'save', name: 'ต้ม ยำ' });
  assert.deepEqual(renameOutcome('Main', 'Main  course'), { kind: 'save', name: 'Main  course' });
});

test('an unchanged name closes the field without a request', () => {
  assert.deepEqual(renameOutcome('ของหวาน', 'ของหวาน'), { kind: 'close' });
  assert.deepEqual(renameOutcome('Drinks', 'Drinks'), { kind: 'close' });
});

test('a name that only differs by the spaces around it counts as unchanged', () => {
  assert.deepEqual(renameOutcome('ของหวาน', '  ของหวาน  '), { kind: 'close' });
  assert.deepEqual(renameOutcome(' Drinks ', 'Drinks'), { kind: 'close' });
  assert.deepEqual(renameOutcome('Drinks', ' Drinks　'), { kind: 'close' });
});

test('a change of case is a real rename and saves', () => {
  assert.deepEqual(renameOutcome('drinks', 'Drinks'), { kind: 'save', name: 'Drinks' });
  assert.deepEqual(renameOutcome('DRINKS', 'drinks'), { kind: 'save', name: 'drinks' });
});

test('a change inside a Thai name is a real rename and saves', () => {
  // Same letters, one tone mark different: not the same name.
  assert.deepEqual(renameOutcome('ข้าว', 'ข้าา'), { kind: 'save', name: 'ข้าา' });
  assert.deepEqual(renameOutcome('ยำ', 'ยํา'), { kind: 'save', name: 'ยํา' });
});

test('an emptied field reverts to the old name', () => {
  assert.deepEqual(renameOutcome('ของหวาน', ''), { kind: 'revert' });
});

test('a field left holding only spaces reverts to the old name', () => {
  assert.deepEqual(renameOutcome('ของหวาน', '   '), { kind: 'revert' });
  assert.deepEqual(renameOutcome('ของหวาน', '\t\n '), { kind: 'revert' });
  assert.deepEqual(renameOutcome('Drinks', ' 　'), { kind: 'revert' });
});

test('an empty draft reverts even when the original name was empty', () => {
  assert.deepEqual(renameOutcome('', ''), { kind: 'revert' });
  assert.deepEqual(renameOutcome('   ', ' '), { kind: 'revert' });
});

test('a mixed Thai and English name saves as typed, trimmed', () => {
  assert.deepEqual(renameOutcome('Set', ' Set อาหารกลางวัน 2 '), { kind: 'save', name: 'Set อาหารกลางวัน 2' });
});

test('the add row creates the typed name', () => {
  assert.deepEqual(addOutcome('ของทานเล่น'), { kind: 'create', name: 'ของทานเล่น' });
  assert.deepEqual(addOutcome('Drinks'), { kind: 'create', name: 'Drinks' });
});

test('the add row creates the trimmed name and keeps the spaces inside it', () => {
  assert.deepEqual(addOutcome('  ต้ม ยำ  '), { kind: 'create', name: 'ต้ม ยำ' });
  assert.deepEqual(addOutcome('\nMain course\t'), { kind: 'create', name: 'Main course' });
});

test('the add row keeps the case it was typed in', () => {
  assert.deepEqual(addOutcome('DRINKS'), { kind: 'create', name: 'DRINKS' });
});

test('an empty add row is discarded without a request', () => {
  assert.deepEqual(addOutcome(''), { kind: 'discard' });
});

test('an add row holding only spaces is discarded', () => {
  assert.deepEqual(addOutcome('   '), { kind: 'discard' });
  assert.deepEqual(addOutcome('\t\n'), { kind: 'discard' });
  assert.deepEqual(addOutcome(' 　'), { kind: 'discard' });
});

test('outcomes are plain values: a saved name carries no extra fields', () => {
  const saved = renameOutcome('a', 'b');
  assert.deepEqual(Object.keys(saved).sort(), ['kind', 'name']);
  assert.deepEqual(Object.keys(renameOutcome('a', 'a')), ['kind']);
  assert.deepEqual(Object.keys(renameOutcome('a', '')), ['kind']);
  assert.deepEqual(Object.keys(addOutcome('')), ['kind']);
  assert.deepEqual(Object.keys(addOutcome('x')).sort(), ['kind', 'name']);
});

test('the list is free only while no field is open', () => {
  assert.equal(inlineLocked({ kind: 'idle' }), false);
});

test('renaming locks the list, whatever the draft holds', () => {
  assert.equal(inlineLocked({ kind: 'renaming', id: 7, draft: 'ของหวาน' }), true);
  assert.equal(inlineLocked({ kind: 'renaming', id: 7, draft: '' }), true);
  assert.equal(inlineLocked({ kind: 'renaming', id: 0, draft: '   ' }), true);
});

test('adding locks the list, whatever the draft holds', () => {
  assert.equal(inlineLocked({ kind: 'adding', draft: '' }), true);
  assert.equal(inlineLocked({ kind: 'adding', draft: 'เครื่องดื่ม' }), true);
});

test('checking the lock never changes the mode it was given', () => {
  const mode = Object.freeze({ kind: 'renaming', id: 3, draft: 'x' });
  assert.equal(inlineLocked(mode), true);
  assert.deepEqual(mode, { kind: 'renaming', id: 3, draft: 'x' });
});
