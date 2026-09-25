import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Call-site guards for the reservation history (app/reservations.tsx) and its
// parts in src/components/reservations/. The pure helpers are covered by
// reservation-history.test.mjs and reservation-error.test.mjs; what those
// cannot see is which function a screen calls, so these read the source.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = (relative) => readFileSync(path.join(mobileRoot, relative), 'utf8');
/** The file without its comments, so a note naming what not to do is not the thing done. */
const code = (relative) => source(relative)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `could not find ${start} … ${end}`);
  return text.slice(from, to);
};

const screen = 'app/reservations.tsx';
const partsDir = path.join('src', 'components', 'reservations');
const partFiles = readdirSync(path.join(mobileRoot, partsDir))
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => path.join(partsDir, name));

// Review, 23 ก.ย. 2569: an action awaits its API call while the filter bar is
// still live. Reloading through the action's own closure fetched the filter it
// started under, won the request generation over the new filter's load, and
// left the new filter on its skeleton until the next pull.
test('an action reloads the filter on screen now, not the one it started under', () => {
  const body = code(screen);
  assert.match(body, /useEffect\(\(\) => \{\s*loadRef\.current = load;\s*\}, \[load\]\);/);
  assert.match(body, /const reload = useCallback\(\(\) => loadRef\.current\(\), \[\]\);/);

  const resolve = between(body, 'const resolve = useCallback(', 'const requestCancel = useCallback(');
  const seat = between(body, 'const seat = useCallback(', 'useFocusEffect(useCallback(');
  for (const [name, fn] of [['resolve', resolve], ['seat', seat]]) {
    assert.doesNotMatch(fn, /(?<![\w.])load\(\)/, `${name} must not call its own load()`);
    assert.doesNotMatch(fn, /\[[^\]]*\bload\b[^\]]*\]\);\s*$/, `${name} must not depend on load`);
  }
  assert.match(resolve, /await reload\(\);/);
  assert.match(resolve, /if \(failure\.reload\) void reload\(\);/);
  assert.match(seat, /if \(failure\.reload\) void reload\(\);/);
});

test('statuses are words on a tint, never a dot, and values never join with a middle dot', () => {
  for (const file of [screen, ...partFiles]) {
    const body = code(file);
    // StatusBadge draws a dot in front of its word by default.
    assert.doesNotMatch(body, /\bStatusBadge\b/, `${file} must not use StatusBadge`);
    assert.ok(!body.includes('•'), `${file} draws a bullet`);
    assert.ok(!body.includes(' · '), `${file} joins values with a middle dot`);
  }
});

test('the four filters sit in one row that fits, not a sideways scroller', () => {
  const bar = code(path.join(partsDir, 'reservation-filter-bar.tsx'));
  assert.doesNotMatch(bar, /ScrollView|scrollable/);
  assert.match(bar, /RESERVATION_FILTERS\.map\(/);
  assert.match(bar, /flex: 1,\s*minWidth: 0,/);
  assert.doesNotMatch(code(screen), /<ChipGroup\b/);
});

test('a failed step speaks the app\'s own words, never the server\'s', () => {
  const body = code(screen);
  // The only message that reaches a person is the mapped one.
  const messages = [...body.matchAll(/(\w+)\.message\b/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(messages)], ['failure']);
  assert.doesNotMatch(body, /<Feedback\b/);
  assert.equal((body.match(/reservationFailure\(/g) || []).length, 3, 'load more, resolve and seat each map their failure');
});
