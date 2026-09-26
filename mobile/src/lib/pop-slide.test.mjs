import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...segments) => readFile(path.join(mobileRoot, ...segments), 'utf8');

// On Android the native exit animation lost the closing page's content and slid
// out a blank white sheet (owner, 2026-09-26). The close is now played by
// src/components/pop-slide.tsx as the same motion - the page going right, the
// page underneath coming in from the left, at the old speed - with a picture of
// the leaving page. These pin the wiring and the parts that went wrong on the
// way there.

test('the root stack closes Android pages through the picture slide', async () => {
  const layout = await read('app', '_layout.tsx');
  assert.match(layout, /screenListeners=\{popSlideListeners\}/);
  // The page underneath is moved only on Android; iOS keeps its view tree.
  assert.match(layout, /screenLayout=\{Platform\.OS === 'android' \? androidScreenLayout : undefined\}/);
  assert.match(layout, /<PopEnterLayer>\{children\}<\/PopEnterLayer>/);
  assert.match(layout, /<\/Stack>\s*<PopSlideOverlay \/>/);
});

test('the close is the native slide_from_right pop: 400 ms, accelerate-decelerate', async () => {
  const source = await read('src', 'components', 'pop-slide.tsx');
  // config_mediumAnimTime, and AccelerateDecelerateInterpolator = (1 - cos(pi t)) / 2.
  assert.match(source, /const POP_MS = 400;/);
  assert.match(source, /const POP_EASING = Easing\.inOut\(Easing\.sin\);/);
  // The picture and the page underneath move on one value, side by side.
  assert.match(source, /translateX: Animated\.add\(enterX, width\)/);
});

test('every page stays bound to the one resting value', async () => {
  const source = await read('src', 'components', 'pop-slide.tsx');
  // Switching a page between an animated value and a plain 0 left it one
  // screen to the left after the first close, and the app white.
  assert.match(source, /transform: \[\{ translateX: enterX \}\]/);
  assert.doesNotMatch(source, /translateX: entering \?/);
  // The pages move only once the picture has painted over them.
  assert.ok(
    source.indexOf("setSlide({ uri, onReady") < source.indexOf('enterX.setValue(-Dimensions.get'),
    'the pages moved before the picture was on screen',
  );
});

test('the picture slide is Android only, respects reduced motion and only takes pops', async () => {
  const source = await read('src', 'components', 'pop-slide.tsx');
  assert.match(source, /Platform\.OS !== 'android' \|\| reducedMotion/);
  assert.match(source, /new Set\(\['GO_BACK', 'POP', 'POP_TO', 'POP_TO_TOP'\]\)/);
  // The navigator must not play its own contentless close as well.
  assert.match(source, /navigation\.setOptions\(\{ animation: 'none' \}\)/);
  assert.match(source, /releaseCapture\(uri\)/);
  assert.doesNotMatch(source, /console\./);
});
