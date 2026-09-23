import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFile(path.join(mobileRoot, ...parts), 'utf8');

// type-scale.test.mjs reads `fontSize: <number>` and nothing else, so a title
// set at `fontSize: tablet ? 31 : 29` passed it for months on every sign-in
// screen. This reads every number in the expression.
function oversizedFonts(source, ceiling = 20) {
  const found = [];
  source.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
      for (const number of match[1].matchAll(/\d+(?:\.\d+)?/g)) {
        if (Number(number[0]) > ceiling) found.push(`${index + 1}: ${match[0].trim()}`);
      }
    }
  });
  return found;
}

test('the sign-in shell draws its title in the app title and nothing larger', async () => {
  const source = await read('src', 'components', 'auth-screen.tsx');
  assert.deepEqual(oversizedFonts(source), []);
  const heading = source.slice(source.indexOf('const heading = ('), source.indexOf('const form = ('));
  assert.ok(heading.length > 0, 'the heading block must exist');
  assert.match(heading, /accessibilityRole="header"[^\n]*style=\{typeScale\.hero\}/);
  // The weight comes from typeScale.hero; writing one beside it is how 800 got in.
  assert.doesNotMatch(heading, /fontWeight/);
  assert.match(heading, /\[typeScale\.body, \{ color: palette\.muted \}\]/);
});

test('the sign-in shell keeps its props and its header controls', async () => {
  const source = await read('src', 'components', 'auth-screen.tsx');
  assert.match(source, /export function AuthScreen\(\{\s*title,\s*subtitle,\s*children,\s*showBack = false,\s*\}/);
  assert.match(source, /title: string;\s*subtitle\?: string;\s*children: React\.ReactNode;\s*showBack\?: boolean;/);
  assert.match(source, /<BackButton \/>/);
  assert.match(source, /<BrandMark size=\{40\} \/>/);
  assert.equal(source.match(/<LanguageControl \/>/g)?.length, 2, 'the language switch is on both header shapes');
  assert.match(source, /onPress=\{\(\) => setLanguage\(nextLanguage\)\}/);
});

test('the tablet artwork carries no round dot and no pager for a carousel that does not exist', async () => {
  const source = await read('src', 'components', 'auth-screen.tsx');
  const artwork = source.slice(source.indexOf('function AuthArtwork()'), source.indexOf('export function AuthScreen('));
  assert.ok(artwork.length > 0, 'AuthArtwork must exist');
  const smallRounds = [...artwork.matchAll(/width: (\d+),\s*height: (\d+),[\s\S]{0,80}?borderRadius: radius\.full/g)]
    .filter((match) => Number(match[1]) <= 16 || Number(match[2]) <= 16);
  assert.deepEqual(smallRounds.map((match) => match[0]), []);
  assert.doesNotMatch(artwork, /navigationActive/);
});

test('joining by link is one field and one button, with no card and no caption', async () => {
  const source = await read('app', 'invite', 'manual.tsx');
  assert.deepEqual(oversizedFonts(source), []);
  assert.doesNotMatch(source, /subtitle=/);
  assert.doesNotMatch(source, /<Surface\b/);
  assert.doesNotMatch(source, /<Feedback\b/);
  assert.doesNotMatch(source, /\bmultiline\b/);
  assert.doesNotMatch(source, /\bautoFocus\b/, 'focus waits for the push to finish');
  // Tokens are case-sensitive; a capitalised first letter broke a typed one.
  assert.match(source, /autoCapitalize="none"/);
  assert.match(source, /onSubmitEditing=\{submit\}/);
  // "token" is the API's word, not a restaurant's.
  assert.doesNotMatch(source, /copy\('[^']*token/i);
  assert.equal(source.match(/<Button\b/g)?.length, 1, 'one action');
});

test('joining by link still reads the link the same way and pushes the invitation', async () => {
  const source = await read('app', 'invite', 'manual.tsx');
  assert.match(source, /const token = invitationTokenFrom\(value\);/);
  assert.match(source, /router\.push\(\{ pathname: '\/invite\/\[token\]', params: \{ token \} \} as never\);/);
  assert.doesNotMatch(source, /router\.replace/);
  assert.match(source, /<AuthScreen [^>]*showBack/);
});

test('creating a shop never shows the server wording or a panel stacked into the form', async () => {
  const source = await read('app', 'create-restaurant.tsx');
  assert.deepEqual(oversizedFonts(source), []);
  const messageLines = source.split('\n').filter((line) => line.includes('.message'));
  assert.deepEqual(messageLines.map((line) => line.trim()), ["const raw = err instanceof Error ? err.message : '';"]);
  const rawUses = source.split('\n').filter((line) => /\braw\b/.test(line) && !line.includes('const raw ='));
  for (const line of rawUses) {
    assert.match(line, /restaurantSetupFailure(Code|Toast)\(raw/, `raw reaches something else: ${line.trim()}`);
  }
  assert.match(source, /showToast\(\{ tone: 'error', \.\.\.restaurantSetupFailureToast\(/);
  assert.doesNotMatch(source, /<Feedback\b/);
  assert.doesNotMatch(source, /SectionHeader/);
  assert.doesNotMatch(source, /ไม่บังคับ|'Optional'/);
  assert.doesNotMatch(source, / · /);
  assert.doesNotMatch(source, /\bscrollable\b/, 'the type chips wrap instead of hiding off the edge');
});

test('creating a shop sends the same request and lands on the hub', async () => {
  const source = await read('app', 'create-restaurant.tsx');
  for (const call of [
    'createRestaurant(',
    'setActiveRestaurantFromMembership(',
    'refreshMemberships()',
    'getDefaultWorkspaceRoute(',
    'restaurantTypeOptions(language)',
    'setupFieldProblems(',
  ]) {
    assert.ok(source.includes(call), `${call} is missing`);
  }
  for (const key of [
    'name: name.trim(),',
    "branch_name: branch.trim() || copy('สำนักงานใหญ่', 'Head office'),",
    'restaurant_type: type,',
    'phone: phone.trim(),',
    'address: address.trim(),',
    'open_time: timeOrDefault(',
    'close_time: timeOrDefault(',
    'table_count: toInt(tables, 0),',
    "split_zones: splitZones === 'yes',",
  ]) {
    assert.ok(source.includes(key), `payload lost ${key}`);
  }
  // 2026-09-23: a new shop opens on the hub, not on /home.
  assert.doesNotMatch(source, /router\.replace\('\/home'\)/);
  assert.match(source, /router\.replace\(getDefaultWorkspaceRoute\(/);
  // Signed out goes to sign-in before anything is checked.
  assert.ok(source.indexOf("router.replace('/login')") < source.indexOf('setupFieldProblems('));
  assert.match(source, /loading=\{saving\}/);
  // The server makes 12 tables from 0; the field says what it will make.
  assert.doesNotMatch(source, /useState\('0'\)/);
  assert.match(source, /useState\(String\(DEFAULT_TABLE_COUNT\)\)/);
});

test('the contact row forwards the props it does not use', async () => {
  const source = await read('src', 'components', 'restaurant-setup', 'contact-disclosure.tsx');
  assert.match(source, /\.\.\.rest\s*\}/);
  assert.match(source, /<Pressable\s+\{\.\.\.rest\}/);
  assert.match(source, /accessibilityState=\{\{ expanded: open \}\}/);
});
