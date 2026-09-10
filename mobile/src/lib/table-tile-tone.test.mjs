import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  tableTileStatus,
  tableTileTones,
  tileIsMuted,
  tileToneFor,
} from './table-tile-tone.ts';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Relative luminance, WCAG 2.x. */
function luminance(hex) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Flatten an `rgba(r, g, b, a)` layer onto an opaque hex background. */
function composite(rgba, background) {
  const [r, g, b, alpha] = rgba.match(/[\d.]+/g).map(Number);
  const base = [1, 3, 5].map((offset) => parseInt(background.slice(offset, offset + 2), 16));
  const mixed = [r, g, b].map((value, index) =>
    Math.round(value * alpha + base[index] * (1 - alpha)),
  );
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

test('a table with an active order paints occupied whatever its own status says', () => {
  assert.equal(tableTileStatus('free', true), 'occupied');
  assert.equal(tableTileStatus('reserved', true), 'occupied');
  assert.equal(tableTileStatus('inactive', true), 'occupied');
});

test('without an order the table status is what paints', () => {
  assert.equal(tableTileStatus('free', false), 'free');
  assert.equal(tableTileStatus('reserved', false), 'reserved');
  assert.equal(tableTileStatus('inactive', false), 'inactive');
  // An unknown status from a newer backend reads as free rather than crashing
  // the grid: a wrong tint on one tile is recoverable, a blank floor map is not.
  assert.equal(tableTileStatus('something-new', false), 'free');
});

test('only the inactive tile is muted', () => {
  assert.equal(tileIsMuted('inactive'), true);
  for (const status of ['free', 'occupied', 'reserved']) {
    assert.equal(tileIsMuted(status), false);
  }
});

test('the booking chip never sits on the status line, where it truncates Thai', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // The status word is the long one - `กำลังใช้งาน` - and the table number is
  // two or three characters, so the slack is all on the top line. Beside the
  // status word the chip truncated any occupied table that also had a booking.
  // The chip must therefore render between the number and the status word:
  // sibling of the one, never sharing a row with the other.
  const label = source.indexOf('{label}');
  const chip = source.indexOf('{bookingTime}');
  const statusWord = source.indexOf('{statusLabel}');
  assert.ok(label > 0 && chip > 0 && statusWord > 0, 'all three fields must render');
  assert.ok(label < chip, 'the booking chip must follow the table number, not precede it');
  assert.ok(chip < statusWord, 'the booking chip must sit above the status word, not beside it');
});

test('the tile shows the clock alone, never the date', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // formatReservationClock prefixes a date once the booking is not today, and a
  // `3 ก.ย. 19:00` chip is wider than the tile can spare.
  assert.match(source, /reservationClock\(/);
  assert.doesNotMatch(source, /formatReservationClock/);
});

test('the three live states form a lightness ladder, not just three hues', () => {
  // This is the whole colour-blind story. Edge, fill and word all encode the
  // same hue, so under deuteranopia that redundancy collapses to nothing and
  // only lightness is left to separate the states. Flattening these fills into
  // one brightness would look tidy and silently delete the distinction.
  const free = luminance(tileToneFor('free').fill);
  const reserved = luminance(tileToneFor('reserved').fill);
  const occupied = luminance(tileToneFor('occupied').fill);

  assert.ok(free > reserved, `free ${free} must be lighter than reserved ${reserved}`);
  assert.ok(reserved > occupied, `reserved ${reserved} must be lighter than occupied ${occupied}`);
  assert.ok(free - reserved > 0.05, 'free and reserved are too close to tell apart in greyscale');
  assert.ok(reserved - occupied > 0.05, 'reserved and occupied are too close to tell apart in greyscale');
});

test('every status word clears AA against the fill it sits on', () => {
  for (const [status, tone] of Object.entries(tableTileTones)) {
    const ratio = contrast(tone.ink, tone.fill);
    assert.ok(ratio >= 4.5, `${status}: status word contrast ${ratio.toFixed(2)} is below AA`);
  }
});

test('every fill is separated from the canvas by lightness, not only by hue', () => {
  // This is what actually indicted the old green. #ECFDF5 sat at a luminance of
  // about 0.93 against the canvas's 0.94 - a hue rotation at the same lightness,
  // which the eye reads as a display colour cast rather than as a tint, and it
  // left the state to be carried entirely by the text. Any replacement has to
  // be a real step down in lightness, whatever hue it picks.
  const canvas = luminance('#FFF7ED');
  for (const [status, tone] of Object.entries(tableTileTones)) {
    const gap = canvas - luminance(tone.fill);
    assert.ok(gap > 0.05, `${status}: fill ${tone.fill} is only ${gap.toFixed(3)} off the canvas - a cast, not a tint`);
  }
});

test('the free tile is a warm green, since a cold one is what was rejected', () => {
  // Only the green carries this rule. Reserved is deliberately a cool porcelain
  // blue, which is a chosen hue rather than the accident #ECFDF5 was.
  const free = tileToneFor('free').fill;
  const green = parseInt(free.slice(3, 5), 16);
  const blue = parseInt(free.slice(5, 7), 16);
  assert.ok(green > blue, `free fill ${free} is a cold mint again`);
});

test('the glass tint and the fallback fill are the same colour', () => {
  // `tint` is what the glass is tinted with on iOS 26 and `fill` is what the
  // fallback paints, so they are one colour written twice. Letting them drift
  // means the tile is a different colour on an iPhone than on anything else,
  // and only one of the two would ever be looked at.
  for (const [status, tone] of Object.entries(tableTileTones)) {
    const [r, g, b] = tone.tint.match(/[\d.]+/g).map(Number);
    const fill = [1, 3, 5].map((offset) => parseInt(tone.fill.slice(offset, offset + 2), 16));
    assert.deepEqual(
      [r, g, b],
      fill,
      `${status}: glass tint ${tone.tint} and fallback fill ${tone.fill} are different colours`,
    );
  }
});

test('the booking chip lightens the tile rather than darkening it', () => {
  // A chip darker than the fill drags its own text down with it - the earlier
  // ink-at-15% version measured 3.96 on an occupied tile, under AA. Lightening
  // pushes every pair above 7. This asserts the composited result, not the
  // rgba string, so a future tweak to the alpha is checked too.
  for (const [status, tone] of Object.entries(tableTileTones)) {
    const chip = composite(tone.chip, tone.fill);
    assert.ok(
      luminance(chip) > luminance(tone.fill),
      `${status}: the chip is darker than the tile it sits on`,
    );
    const ratio = contrast(tone.ink, chip);
    assert.ok(ratio >= 4.5, `${status}: chip text contrast ${ratio.toFixed(2)} is below AA`);
  }
});

test('the tile carries no border, because a second shade was what made it a box', () => {
  for (const [status, tone] of Object.entries(tableTileTones)) {
    assert.ok(!('border' in tone), `${status}: a border shade came back`);
  }
});

test('the tile wears the assistant glass, on both paths', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // Real Liquid Glass on iOS 26 and the assistant's own fallback everywhere
  // else. Shipping only the GlassView would leave every Android tile - and
  // every older iPhone - with no background at all.
  assert.match(source, /LIQUID_GLASS \?/);
  assert.match(source, /<GlassView/);
  assert.match(source, /tintColor=\{tone\.tint\}/);
  assert.match(source, /backgroundColor: tone\.fill/);
});

test('the booking chip is a clock and a time, with no word', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  assert.match(source, /name="time-outline"/);
  // `จอง` on the chip as well as in the status word put the same word on one
  // 112pt tile twice.
  assert.doesNotMatch(source, /bookedLabel|'จอง'/);
});

test('a long table label shrinks instead of truncating', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // Zone prefixes produce real labels like `ZONE-11`. At a fixed size five of
  // those truncate to an identical `ZONE...`, which is a row of tables nobody
  // can tell apart - it shipped that way and was visible on the floor.
  assert.match(source, /adjustsFontSizeToFit/);
  assert.match(source, /minimumFontScale=/);
});

test('the compact tile drops the round status dot and the inert press', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // The dot the owner asked to remove was a small circle built from an equal
  // width and height. (radius.full is NOT forbidden - the booking chip is
  // legitimately a pill.)
  assert.doesNotMatch(source, /width:\s*([789]|1\d),\s*height:\s*\1\b/);
  // The dark accent bar down the leading edge replaced the dot for one round and
  // was then asked for removal in turn; the glass tint carries status now.
  assert.doesNotMatch(source, /EDGE_WIDTH/);
  // The one border left is the white hairline the non-glass fallback needs in
  // order to read as an object. Never a second shade of the status colour -
  // that is what made the tile read as a box.
  assert.doesNotMatch(source, /borderColor:\s*tone\./);

  // Pressing must actually answer. `opacity: 0.72` was the old feedback and read
  // as disabled rather than pressed, which is why it felt inert.
  assert.doesNotMatch(source, /opacity:\s*pressed \? 0\.72/);
  assert.match(source, /onPressIn=/);
  assert.match(source, /onPressOut=/);
});

test('the compact tile asks for no weight the app cannot draw', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // resolveAppFontFamily caps at Kanit_700Bold and ExtraBold is deliberately not
  // bundled, so a declared '800' silently renders as 700 and any hierarchy built
  // on that difference does not exist on the device.
  assert.doesNotMatch(source, /fontWeight:\s*'[89]00'/);
});

test('the compact tile can grow when the reader enlarges their text', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'compact-table-tile.tsx'),
    'utf8',
  );

  // AppText does not set allowFontScaling={false}, so the OS text size stacks on
  // top of APP_FONT_SCALE. A fixed height would crop Thai tone marks silently;
  // the height also has to be built from scaleFont or it drifts the moment that
  // constant is retuned.
  assert.match(source, /minHeight: TILE_MIN_HEIGHT/);
  assert.match(source, /const TILE_MIN_HEIGHT =[\s\S]*?scaleFont\(/);
  assert.doesNotMatch(source, /\n\s+height: TILE_MIN_HEIGHT/);
});

test('the compact branch of the table grid renders the tile component', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', '(primary)', 'tables.tsx'), 'utf8');

  // A call-site guard: the tone map and the component can both be perfect while
  // the grid quietly goes on drawing its own inline tile.
  assert.match(source, /if \(compactView\) \{[\s\S]*?<CompactTableTile/);
  assert.match(source, /status=\{tableTileStatus\(table\.status, Boolean\(order\)\)\}/);

  // The detailed card was explicitly out of scope for the redesign, so it must
  // still be the one and only reader of the shared statusTone token.
  assert.equal(source.match(/statusTone\(tone\)/g)?.length, 1);
});

test('a booked table announces the booking to a screen reader', async () => {
  const source = await readFile(path.join(mobileRoot, 'app', '(primary)', 'tables.tsx'), 'utf8');

  // The tag is visual only; without this the booking is announced nowhere.
  assert.match(source, /accessibilityLabel = copy\([\s\S]*?\$\{reminder \? `, \$\{reminder\}` : ''\}/);
});
