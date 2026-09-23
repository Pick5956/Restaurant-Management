import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COMPACT_BUTTON,
  COMPACT_HEADER_BAND,
  compactActionFit,
  compactHeaderProgress,
  compactHeaderRange,
  nextCompactShown,
} from './compact-header.ts';
import { restingMaxOffset, strandedScrollTarget } from './scroll-bounds.ts';

// The collapsing header (owner, 23 ก.ย. 2569: "the header does not come down
// with it ... look at Grab") and the categories drag that left the page resting
// past its end. The arithmetic is tested directly; the rest reads the shell's
// own source, because every rule here lives at a call site - which screens get
// the bar, what a hidden bar may still do, which scroll view the bill keeps.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');

/** The source without comments, so a note about a rule never passes for the rule. */
function code(source) {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** AppScreen's body: from its signature to the end of the file. */
async function appScreen() {
  const shell = code(await read('src/components/app-shell.tsx'));
  const start = shell.indexOf('export function AppScreen(');
  assert.ok(start >= 0, 'AppScreen must exist');
  return shell.slice(start);
}

// ---------------------------------------------------------------- the arithmetic

test('the bar comes in across the last band before the expanded heading has gone', () => {
  assert.equal(COMPACT_HEADER_BAND, 24);
  assert.deepEqual(compactHeaderRange(80), [56, 80]);
  assert.equal(compactHeaderProgress(0, 80), 0);
  assert.equal(compactHeaderProgress(56, 80), 0);
  assert.equal(compactHeaderProgress(68, 80), 0.5);
  assert.equal(compactHeaderProgress(80, 80), 1);
  assert.equal(compactHeaderProgress(400, 80), 1);
  // A rubber-band pull at the top never shows it.
  assert.equal(compactHeaderProgress(-60, 80), 0);
  assert.equal(compactHeaderProgress(Number.NaN, 80), 0);
  // A heading shorter than the band still gives a range that rises.
  const [start, end] = compactHeaderRange(10);
  assert.ok(start >= 0 && end > start);
});

test('touches follow the bar on two thresholds, so resting mid-band cannot flicker', () => {
  assert.equal(nextCompactShown(false, 0.5), false);
  assert.equal(nextCompactShown(false, 0.6), true);
  assert.equal(nextCompactShown(true, 0.5), true);
  assert.equal(nextCompactShown(true, 0.4), false);
  assert.equal(nextCompactShown(true, 1), true);
  assert.equal(nextCompactShown(false, 0), false);
});

test('a heading action taller than the bar is scaled to fit and kept on the trailing edge', () => {
  assert.equal(COMPACT_BUTTON, 40);
  assert.deepEqual(compactActionFit(null), { scale: 1, shiftX: 0 });
  assert.deepEqual(compactActionFit({ width: 28, height: 28 }), { scale: 1, shiftX: 0 });
  const round = compactActionFit({ width: 46, height: 46 });
  assert.ok(Math.abs(round.scale * 46 - 40) < 1e-9);
  assert.ok(Math.abs(round.shiftX - 3) < 1e-9);
  const pill = compactActionFit({ width: 120, height: 46 });
  assert.ok(Math.abs(120 - pill.shiftX - (120 * (1 + pill.scale)) / 2) < 1e-9, 'the trailing edge stays put');
});

test('a page rests between the top and its end, home-indicator inset included', () => {
  // flexGrow: 1 makes a short page exactly the viewport; iOS's inset is its range.
  assert.equal(restingMaxOffset({ contentHeight: 700, viewportHeight: 700 }), 0);
  assert.equal(restingMaxOffset({ contentHeight: 700, viewportHeight: 700, slack: 34 }), 34);
  assert.equal(restingMaxOffset({ contentHeight: 1500, viewportHeight: 700, slack: 34 }), 834);
  assert.equal(restingMaxOffset({ contentHeight: 300, viewportHeight: 700, slack: 34 }), 0);
  assert.equal(restingMaxOffset({ contentHeight: Number.NaN, viewportHeight: 700 }), 0);
});

test('only a stranded page is sent back, and to the nearest end of its range', () => {
  const short = { contentHeight: 700, viewportHeight: 700, slack: 34 };
  // The owner's screen: three categories, piled under the top.
  assert.equal(strandedScrollTarget({ ...short, offset: 180 }), 34);
  assert.equal(strandedScrollTarget({ ...short, offset: 34 }), null);
  assert.equal(strandedScrollTarget({ ...short, offset: 34.6 }), null, 'rounding is not stranding');
  assert.equal(strandedScrollTarget({ ...short, offset: 0 }), null);
  assert.equal(strandedScrollTarget({ ...short, offset: -40 }), 0);
  // A refresh in progress holds the offset negative on purpose.
  assert.equal(strandedScrollTarget({ ...short, offset: -60, clampTop: false }), null);
  assert.equal(strandedScrollTarget({ ...short, offset: Number.NaN }), null);
});

// ---------------------------------------------------------------- who gets the bar

test('the bar is on by default, off only where it was asked off or cannot apply', async () => {
  const screen = await appScreen();
  assert.match(screen, /\bcompactHeader = true,/);
  assert.match(screen, /const collapsing = scroll && !stickyHeading && !immersive && !hideTitle && compactHeader;/);
  // Rendered only for such a screen, and only once the heading has been measured.
  assert.match(screen, /\{collapsing && collapseAt !== null \? \(\s*<CompactHeader\b/);
  assert.equal((screen.match(/<CompactHeader\b/g) || []).length, 1);
});

test('a pinned heading keeps the scroll view it had', async () => {
  const screen = await appScreen();
  // The plain ScrollView, at the old event rate, with none of the new observers.
  assert.match(screen, /const ShellScrollView = collapsing \? Animated\.ScrollView : ScrollView;/);
  assert.match(screen, /scrollEventThrottle=\{collapsing \? 16 : 32\}/);
  assert.match(screen, /onScroll=\{collapsing \? nativeScroll : handleScroll\}/);
  assert.match(screen, /onLayout=\{stickyHeading \? undefined :/);
  assert.match(screen, /onContentSizeChange=\{stickyHeading \? undefined : handleContentSizeChange\}/);
  // The pinned block itself is untouched.
  assert.match(screen, /const headerOwnsTopInset = scroll && stickyHeading && !immersive;/);
  assert.match(screen, /const pinnedHeading = scroll && stickyHeading \? \(/);
  // No style on the scroll view: Android's Animated scroll view with a
  // refreshControl and a style clones the refresh control a second time.
  const open = screen.slice(screen.indexOf('<ShellScrollView'), screen.indexOf('</ShellScrollView>'));
  assert.equal(/^\s*style=/m.test(open.slice(0, open.indexOf('>\n'))), false);
});

test('the offset reaches the bar natively and every old bookkeeping step still runs', async () => {
  const screen = await appScreen();
  assert.match(screen, /Animated\.event\(\s*\[\{ nativeEvent: \{ contentOffset: \{ y: scrollY \} \} \}\],\s*\{\s*useNativeDriver: true,\s*listener:/);
  assert.match(screen, /const nativeScroll = useMemo\(/);
  const handler = screen.slice(screen.indexOf('const handleScroll ='), screen.indexOf('const handleScrollRef'));
  assert.match(handler, /contentOffsetRef\.current = event\.nativeEvent\.contentOffset\.y;/);
  assert.match(handler, /reportVerticalScrollNow\(\);/);
  assert.match(handler, /updateCompactShown\(/);
});

test('a swapped scroll view starts from the top, offset and all', async () => {
  const screen = await appScreen();
  // `collapsing` changing swaps the scroll view's type, so the new one is at 0.
  // A stale deep offset kept here would switch the bar on - invisible, taking
  // the heading's touches - as soon as the new heading is measured.
  const reset = screen.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[collapsing, scrollY\]\);/);
  assert.ok(reset, 'the reset effect is keyed on collapsing');
  assert.match(reset[1], /scrollY\.setValue\(0\);/);
  assert.match(reset[1], /contentOffsetRef\.current = 0;/);
  assert.match(reset[1], /compactShownRef\.current = false;/);
});

// ---------------------------------------------------------------- what a hidden bar may do

test('a hidden bar takes no touch and is not read; a shown one is not a second heading', async () => {
  const bar = code(await read('src/components/compact-header.tsx'));
  assert.match(bar, /pointerEvents=\{shown \? 'auto' : 'none'\}/);
  assert.match(bar, /accessibilityElementsHidden=\{!shown\}/);
  assert.match(bar, /importantForAccessibility=\{shown \? 'auto' : 'no-hide-descendants'\}/);
  assert.doesNotMatch(bar, /accessibilityRole="header"/);
  assert.match(bar, /<Text accessible=\{false\} importantForAccessibility="no" numberOfLines=\{1\}/);
  // Inside its parent's bounds from the top edge: Android drops touches outside.
  assert.match(bar, /style=\{\{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 \}\}/);
});

test('the bar draws the plain title and a safe action', async () => {
  const screen = await appScreen();
  const tag = screen.slice(screen.indexOf('<CompactHeader'), screen.indexOf('/>', screen.indexOf('<CompactHeader')));
  assert.match(tag, /title=\{title\}/);
  assert.doesNotMatch(tag, /titleContent/);
  assert.match(tag, /action=\{compactAction === undefined \? action : compactAction\}/);
  assert.match(tag, /showBack=\{!topLevel\}/);
  // The role's pencil edits a field that has scrolled away; it never repeats.
  const role = code(await read('app/staff/role.tsx'));
  const compact = role.slice(role.indexOf('compactAction='), role.indexOf('contentMaxWidth=', role.indexOf('compactAction=')));
  assert.ok(compact.length > 0, 'role.tsx gives the bar its own action');
  assert.doesNotMatch(compact, /nameAction/);
});

test('reduced motion is a plain switch on the same threshold as touches', async () => {
  const screen = await appScreen();
  assert.match(screen, /const reducedMotion = useReducedMotion\(\);/);
  assert.match(screen, /progress=\{reducedMotion \? \(compactShown \? 1 : 0\) : compactProgress\}/);
});

test('glass is never faded: it pops in on a scale', async () => {
  const bar = code(await read('src/components/compact-header.tsx'));
  const glassBranch = bar.slice(bar.indexOf('(LIQUID_GLASS'), bar.indexOf(': {', bar.indexOf('(LIQUID_GLASS')));
  assert.ok(glassBranch.length > 0);
  assert.doesNotMatch(glassBranch, /opacity/);
  assert.match(glassBranch, /\{ scale: pop \}/);
});

// ---------------------------------------------------------------- the drag

test('switching scrolling back on sends a stranded page back into range', async () => {
  const screen = await appScreen();
  // Keyed on whether it is blocked: the bill hands over a new closure every render.
  assert.match(screen, /const scrollBlocked = Boolean\(onScrollBlocked\);/);
  assert.match(screen, /useEffect\(\(\) => \{\s*const wasBlocked = wasScrollBlockedRef\.current;\s*wasScrollBlockedRef\.current = scrollBlocked;\s*if \(!wasBlocked \|\| scrollBlocked\) return;[\s\S]{0,200}?settleStrandedOffsetRef\.current\(true\);\s*\}, \[scrollBlocked\]\);/);
  const settle = screen.slice(screen.indexOf('const settleStrandedOffset ='), screen.indexOf('const settleStrandedOffsetRef'));
  assert.match(settle, /strandedScrollTarget\(\{/);
  assert.match(settle, /scrollRef\.current\?\.scrollTo\(\{ y: target, animated: true \}\);\s*\};\s*$/);
  // iOS only, never the bill's pinned heading, never under a keyboard.
  assert.match(settle, /if \(Platform\.OS !== 'ios' \|\| stickyHeading \|\| Keyboard\.isVisible\(\)\) return;/);
  // And when the page gets shorter under the reader.
  const resize = screen.slice(screen.indexOf('const handleContentSizeChange ='));
  assert.match(resize.slice(0, 500), /if \(collapsing && !onScrollBlocked && !draggingRef\.current && !momentumRef\.current\) \{\s*settleStrandedOffset\(false\);/);
});

test('a jump the screen asks for is the offset from then on', async () => {
  // A compact-row filter jumps to the top and changes the list in one tick.
  // Fabric lays the shorter list out during the commit and reports its size
  // before the jump's scroll event arrives; judged against the old deep
  // offset, the page looked stranded and was sent to the new list's end.
  const screen = await appScreen();
  const control = screen.slice(screen.indexOf('const scrollTo = (y: number, animated = true) => {'), screen.indexOf('scrollControlRef.current = {'));
  assert.ok(control.length > 0, 'the scroll control must exist');
  assert.match(control, /const target = Math\.max\(0, y\);\s*if \(!animated\) contentOffsetRef\.current = target;\s*scrollRef\.current\?\.scrollTo\(\{ y: target, animated \}\);/);
});

test('the drag list starts its top band under the bar and never adopts a stranded bound', async () => {
  const list = code(await read('src/components/menu-categories/category-drag-list.tsx'));
  assert.match(list, /const top = edges\.top \+ \(control\.getTopCover\?\.\(\) \?\? 0\);\s*const step = autoScrollStep\(current\.fingerY, top, height - edges\.bottom\);/);
  assert.match(list, /const scrollFloor = Math\.min\(scrollStart, restingMax\);/);
  assert.match(list, /scrollMax: scrollFloor,/);
  assert.match(list, /current\.scrollMax = Math\.max\(scrollFloor, current\.scrollStart \+ overflow\);/);
  // The shell hands out both.
  const screen = await appScreen();
  assert.match(screen, /getMaxOffset: \(\) =>/);
  assert.match(screen, /getTopCover: \(\) => \(collapsingRef\.current && compactShownRef\.current \? compactCoverRef\.current : 0\)/);
});

test('the guard runs with the rest of the suite', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.match(pkg.scripts.test, /src\/lib\/compact-header\.test\.mjs/);
});
