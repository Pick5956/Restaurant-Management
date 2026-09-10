import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_FONT_FAMILIES,
  resolveAppFontFamily,
  resolveAppFontWeight,
} from './app-font.ts';

const cases = [
  [undefined, APP_FONT_FAMILIES.regular],
  ['normal', APP_FONT_FAMILIES.regular],
  ['100', APP_FONT_FAMILIES.regular],
  ['ultralight', APP_FONT_FAMILIES.regular],
  ['thin', APP_FONT_FAMILIES.regular],
  ['light', APP_FONT_FAMILIES.regular],
  ['regular', APP_FONT_FAMILIES.regular],
  ['condensed', APP_FONT_FAMILIES.regular],
  ['400', APP_FONT_FAMILIES.regular],
  [400, APP_FONT_FAMILIES.regular],
  ['medium', APP_FONT_FAMILIES.medium],
  ['500', APP_FONT_FAMILIES.medium],
  [500, APP_FONT_FAMILIES.medium],
  ['semibold', APP_FONT_FAMILIES.semiBold],
  ['600', APP_FONT_FAMILIES.semiBold],
  [600, APP_FONT_FAMILIES.semiBold],
  ['bold', APP_FONT_FAMILIES.bold],
  ['condensedBold', APP_FONT_FAMILIES.bold],
  ['700', APP_FONT_FAMILIES.bold],
  [700, APP_FONT_FAMILIES.bold],
  // Bold is the ceiling: anything heavier is clamped rather than honoured, so a
  // style asking for 800 renders the same as one asking for 700.
  ['heavy', APP_FONT_FAMILIES.bold],
  ['black', APP_FONT_FAMILIES.bold],
  ['800', APP_FONT_FAMILIES.bold],
  [800, APP_FONT_FAMILIES.bold],
  ['900', APP_FONT_FAMILIES.bold],
  [900, APP_FONT_FAMILIES.bold],
];

test('no text in the app can render heavier than bold', () => {
  // The cap is the point: without it 17 call sites already reached past bold,
  // and every style written after this one could too.
  for (const weight of ['800', 800, '900', 900, 'heavy', 'black', '1000']) {
    assert.equal(resolveAppFontFamily(weight), APP_FONT_FAMILIES.bold);
  }
});

test('no face heavier than bold is even available to select', () => {
  // Guards the catalogue as well as the resolver: re-adding an ExtraBold entry
  // here is how the cap above would quietly stop meaning anything.
  const heavier = Object.values(APP_FONT_FAMILIES).filter((family) =>
    /extrabold|black|_[89]00/i.test(family),
  );

  assert.deepEqual(heavier, []);
});

for (const [weight, expectedFamily] of cases) {
  test(`maps ${String(weight)} to ${expectedFamily}`, () => {
    assert.equal(resolveAppFontFamily(weight), expectedFamily);
  });
}

test('nested text inherits its parent weight when no weight is set', () => {
  assert.equal(resolveAppFontWeight(undefined, '700'), '700');
});

test('an explicit nested weight overrides its parent weight', () => {
  assert.equal(resolveAppFontWeight('800', '700'), '800');
});

test('top-level text defaults to normal weight', () => {
  assert.equal(resolveAppFontWeight(undefined), 'normal');
});
