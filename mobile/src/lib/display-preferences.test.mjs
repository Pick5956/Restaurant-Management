import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_DISPLAY_PREFERENCES,
  normalizeDisplayPreferences,
} from './display-preferences.ts';

test('normalizes supported display preferences', () => {
  assert.deepEqual(
    normalizeDisplayPreferences({ language: 'en', compactTables: true }),
    { language: 'en', compactTables: true },
  );
});

test('a store written before compactTables existed reads as the default', () => {
  // Not a broken read: every install that predates the field simply never had a
  // choice recorded, and the default is what they were already seeing.
  assert.deepEqual(
    normalizeDisplayPreferences({ language: 'en' }),
    { language: 'en', compactTables: false },
  );
  assert.deepEqual(
    normalizeDisplayPreferences({ language: 'en', compactTables: 'yes' }),
    { language: 'en', compactTables: false },
  );
});

test('falls back safely when persisted display preferences are malformed', () => {
  assert.deepEqual(
    normalizeDisplayPreferences({ language: 'jp' }),
    DEFAULT_DISPLAY_PREFERENCES,
  );
  assert.deepEqual(normalizeDisplayPreferences(null), DEFAULT_DISPLAY_PREFERENCES);
});

test('drops a persisted text size instead of carrying it forward', () => {
  // Older installs stored textSize. Normalizing must not resurrect the field,
  // or a stale value would travel through every future write.
  assert.deepEqual(
    normalizeDisplayPreferences({ language: 'en', textSize: 'extra-large' }),
    { language: 'en', compactTables: false },
  );
});
