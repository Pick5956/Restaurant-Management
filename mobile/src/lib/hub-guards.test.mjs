import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Call-site guards for the hub's shared components. The hub is the root of the
// stack and never unmounts while a page is pushed over it, so anything that
// loops there without asking for focus keeps running under the kitchen for the
// whole session; and the Android traps (a shadow on a clipping view, a refresh
// control that is not forwarded) show nothing on iOS. The unit tests cannot see
// a native tree, so these read the source and assert on the lines that matter.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hubDir = path.join(mobileRoot, 'src', 'components', 'hub');
const source = (relative) => readFileSync(path.join(mobileRoot, relative), 'utf8');
/** The file without its comments, so a note naming what not to do is not the thing done. */
const code = (relative) => source(relative)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
const hubFiles = readdirSync(hubDir).filter((name) => /\.tsx?$/.test(name)).sort();
const hubCode = (name) => code(path.join('src', 'components', 'hub', name));

test('ToolRow unmounts its bone once the value lands, so no shimmer outlives the load', () => {
  // MotionCrossfade keeps its inactive layer mounted; a Bone left in it keeps
  // the shared shimmer loop running under every page pushed over the hub.
  const row = code('src/components/tool-row.tsx');
  assert.match(row, /<MotionCrossfade active=\{!detailLoading\} inactiveContent=\{detailLoading \? bone : null\}/);
  assert.doesNotMatch(row, /inactiveContent=\{bone\}/);
});

test('ToolRow keeps settings\' plain-string details at their regular weight', () => {
  const row = code('src/components/tool-row.tsx');
  assert.match(row, /plainWeight=\{typeof detail === 'string' \? '400' : '500'\}/);
});

test('every loop in the hub components waits for useLoopGate, and none of them starts a timer', () => {
  const looping = hubFiles.filter((name) => hubCode(name).includes('Animated.loop('));
  assert.deepEqual(looping, ['day-curve.tsx', 'service-tile.tsx']);
  for (const name of hubFiles) {
    assert.doesNotMatch(hubCode(name), /setInterval\(|setTimeout\(|requestAnimationFrame\(/, `${name} starts a timer`);
  }

  // The heartbeat ring starts its loop only while the gate is open.
  const tile = hubCode('service-tile.tsx');
  const ring = tile.slice(tile.indexOf('function HeartbeatRing'));
  assert.match(ring, /const running = useLoopGate\(true\);/);
  assert.match(ring, /useEffect\(\(\) => \{\s*if \(!running\) return undefined;[\s\S]*?Animated\.loop\(/);

  // The curve mounts its pulsing ring only while the gate is open.
  const curve = hubCode('day-curve.tsx');
  assert.match(curve, /const running = useLoopGate\(pulse\);/);
  assert.match(curve, /\{running && path\.end \? <PulseRing /);
  assert.equal(curve.split('<PulseRing ').length - 1, 1, 'PulseRing is mounted somewhere else too');

  // The gate itself: focus, foreground, reduced motion.
  const gate = hubCode('loop-gate.ts');
  assert.match(gate, /const focused = useIsFocused\(\);/);
  assert.match(gate, /return wanted && focused && appActive && !reduced;/);
});

test('Stage lights the status bar only while the hub is focused', () => {
  // The hub never unmounts: a bare light bar would put white icons on every pushed page.
  const stage = hubCode('hub-stage.tsx');
  assert.match(stage, /const focused = useIsFocused\(\);/);
  assert.match(stage, /\{focused \? <StatusBar style="light" \/> : null\}/);
  assert.equal(stage.split('<StatusBar').length - 1, 1);
});

test('the hub pulls to refresh through AppRefreshControl, never a bare RefreshControl', () => {
  // Android renders refreshControl as the outer element and clones the scroll
  // view into it; AppRefreshControl forwards what it is handed.
  assert.match(hubCode('hub-stage.tsx'), /refreshControl=\{<AppRefreshControl onRefresh=\{data\.refresh\}/);
  for (const name of hubFiles) assert.doesNotMatch(hubCode(name), /<RefreshControl\b/, name);
});

/**
 * The own text of every brace block - an object literal, a JSX expression, a
 * function body - with its nested blocks taken out, so a style object's keys
 * are read together and apart from the objects inside it.
 */
function braceBlocks(text) {
  const blocks = [];
  const open = [];
  for (const char of text) {
    if (char === '{') {
      open.push('');
    } else if (char === '}') {
      const own = open.pop();
      if (own !== undefined) blocks.push(own);
    } else if (open.length) {
      open[open.length - 1] += char;
    }
  }
  return blocks;
}

const SHADOW = /\bboxShadow\s*:|\bshadowColor\s*:|\belevation\s*:|\.\.\.\w*[sS]hadow\b/;
const CLIPS = /\boverflow\s*:\s*['"]hidden['"]/;

// ---------------------------------------------------------------- Stage call sites
// Stress test, 2026-09-23. Each Stage fix is a pure helper in
// hub-stage-layout.ts / hub-data.ts plus one line in a component that calls
// it. The helpers' own tests stay green when that line is reverted, so these
// read the line itself.

/** One function's text, from its declaration to the next top-level function. */
function fnText(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  const end = text.slice(start + 1).search(/\n(?:export )?function /);
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end);
}

test('Stage caps its floor cells and hands the strip its width for the first frame; layout A does neither', () => {
  const tiles = hubCode('stage-tiles.tsx');
  const floorTile = fnText(tiles, 'FloorTile');
  assert.match(floorTile, /<FloorStrip\b[^>]*\bmaxCellWidth=\{FLOOR_MAX_CELL\}/);
  assert.match(floorTile, /<FloorStrip\b[^>]*\binitialWidth=\{stripWidth\}/);
  const cap = Number(/const FLOOR_MAX_CELL = (\d+);/.exec(tiles)?.[1]);
  assert.ok(cap >= 20 && cap <= 24, `FLOOR_MAX_CELL is ${cap}`);
  // The strip spends the cap, measured or not.
  const row = fnText(hubCode('floor-strip.tsx'), 'CellRow');
  assert.match(row, /width: floorCellWidth\(columns, width, maxCell\)/);
  assert.match(row, /maxWidth: maxCell/);
});

test('the floor bar sizes its parts through floorBarWidths and clips none of their edges', () => {
  const bar = fnText(hubCode('floor-strip.tsx'), 'FloorBar');
  assert.match(bar, /floorBarWidths\(all\.map\(\(part\) => part\.share\), width\)/);
  assert.match(bar, /minWidth: FLOOR_BAR_MIN_PART/);
  assert.doesNotMatch(bar, /overflow/);
});

test('the Stage floor bone reads the count this device last saw, synchronously, and the landed floor writes it', () => {
  const stage = hubCode('hub-stage.tsx');
  assert.match(stage, /const boneTables = restaurantId !== null \? readLastFloorTables\(restaurantId\) : null;/);
  assert.match(stage, /writeLastFloorTables\(restaurantId, floorTables\)/);
  assert.match(stage, /<FloorTile\b[^>]*\bboneTables=\{boneTables\}/);
  assert.match(fnText(hubCode('stage-tiles.tsx'), 'FloorTile'), /<FloorStripBone tables=\{boneTables\} width=\{stripWidth\} \/>/);
  // A cold start's first frame already has the count: the read is not async.
  const store = code('src/storage/hub-floor-store.ts');
  assert.match(store, /raw = SecureStore\.getItem\(HUB_FLOOR_TABLES_KEY\);/);
  assert.doesNotMatch(store, /getItemAsync/);
  assert.match(store, /SecureStore\.setItemAsync\(HUB_FLOOR_TABLES_KEY, serializeRememberedFloors\(next\)\)/);
});

test('a long shop name has an 80% floor on both platforms', () => {
  const band = hubCode('stage-band.tsx');
  const name = fnText(band, 'ShopName');
  const split = name.indexOf('onLayout');
  const ios = name.slice(name.indexOf("if (Platform.OS === 'ios')"), split);
  const android = name.slice(split);
  assert.match(ios, /adjustsFontSizeToFit\s+minimumFontScale=\{NAME_MIN_SCALE\}/);
  // minimumFontScale is iOS-only: Android sizes the name itself.
  assert.doesNotMatch(android, /adjustsFontSizeToFit/);
  assert.match(android, /fontSize: fittedNameSize\(natural, available, heroSize\)/);
  assert.match(android, /onTextLayout=\{\(event\) => \{\s*const next = event\.nativeEvent\.lines\[0\]\?\.width \?\? 0;/);
  assert.match(fnText(band, 'StageIdentity'), /<ShopName name=\{shop\.name\} \/>/);
});

test('the band\'s capsules and rows grow with the OS text size instead of clipping it', () => {
  const band = hubCode('stage-band.tsx');
  const role = fnText(band, 'RoleCapsule');
  const swap = fnText(band, 'SwitchCapsule');
  const home = fnText(band, 'StageHomeRow');
  assert.match(role, /minHeight: 24/);
  assert.match(swap, /minHeight: 34/);
  assert.match(home, /minHeight: 44/);
  for (const [label, own] of [['RoleCapsule', role], ['SwitchCapsule', swap], ['StageHomeRow', home]]) {
    assert.doesNotMatch(own, /\bheight\s*:/, `${label} has a fixed height`);
  }
  assert.match(fnText(band, 'StageTakings'), /style=\{\(\{ pressed \}\) => \(\{ minHeight: 64,/);
});

test('Stage stacks kitchen and orders and lets their lines wrap by the OS text size, measured beside the rail', () => {
  const stage = hubCode('hub-stage.tsx');
  assert.match(stage, /const \{ width, fontScale \} = useWindowDimensions\(\);/);
  assert.match(stage, /const contentWidth = measuredWidth > 0 \? measuredWidth : stageContentWidth\(width, gutter, metrics\.contentMax, railGuess\);/);
  assert.match(stage, /const stackPair = pairStacks\(contentWidth, fontScale\);/);
  assert.match(stage, /const lines = valueLines\(fontScale\);/);
  assert.match(stage, /<KitchenTile [^>]*\blines=\{lines\}/);
  assert.match(stage, /<FloorTile\b[^>]*\blines=\{lines\}/);
  const tiles = hubCode('stage-tiles.tsx');
  assert.match(fnText(tiles, 'KitchenTile'), /<ValueLine lines=\{lines\} segments=\{kitchenSegments\(/);
  assert.match(fnText(tiles, 'FloorTile'), /<ValueLine lines=\{lines\} segments=\{floorSegments\(/);
  assert.match(hubCode('value-line.tsx'), /numberOfLines=\{lines\}/);
});

test('shelf chips say the navigation\'s short title on up to two lines, with a badge that stays small', () => {
  const shelf = hubCode('stage-shelf.tsx');
  assert.match(fnText(shelf, 'chipTitle'), /return language === 'th' \? nav\.label : nav\.labelEn;/);
  assert.match(shelf, /const title = chipTitle\(item, lang\);/);
  assert.match(shelf, /accessibilityLabel=\{words \? `\$\{title\}, \$\{words\}` : title\}/);
  assert.match(shelf, /\btitle=\{title\}/);
  assert.match(fnText(shelf, 'ShelfChip'), /<Text numberOfLines=\{2\}/);
  assert.match(fnText(shelf, 'ChipBadge'), /maxFontSizeMultiplier=\{BADGE_TEXT_MAX_SCALE\}/);
  const scale = Number(/const BADGE_TEXT_MAX_SCALE = ([\d.]+);/.exec(shelf)?.[1]);
  assert.ok(scale > 0 && scale <= 1.3, `BADGE_TEXT_MAX_SCALE is ${scale}`);
  assert.match(hubCode('hub-stage.tsx'), /const shelf = shelfLayout\(contentWidth, fontScale\);/);
  // The navigation's own label is the short one the chip needs.
  assert.match(code('src/components/app-shell.tsx'), /\{ key: 'menu', label: 'เมนูอาหาร', labelEn: 'Menu',/);
});

test('the now-dot beats only where stageHeartbeat puts the heartbeat', () => {
  const stage = hubCode('hub-stage.tsx');
  assert.match(stage, /const heartbeat = stageHeartbeat\(activity, takingsShown, data\.takings, rows\);/);
  assert.match(stage, /<StageTakings [^>]*\bpulse=\{heartbeat\.curve\}/);
  assert.match(fnText(hubCode('stage-band.tsx'), 'StageTakings'), /<DayCurve [^>]*\bpulse=\{pulse\}/);
});

test('a wide kitchen lane label loses its middle, never the end of its number', () => {
  assert.match(hubCode('kitchen-lanes.tsx'), /<Text numberOfLines=\{1\} ellipsizeMode="middle"/);
});

test('no hub style both casts a shadow and clips (Android drops the shadow)', () => {
  assert.ok(braceBlocks('const a = { boxShadow: X, overflow: \'hidden\', t: [{ s }] };').some((own) => SHADOW.test(own) && CLIPS.test(own)));
  for (const name of hubFiles) {
    for (const own of braceBlocks(hubCode(name))) {
      assert.ok(!(SHADOW.test(own) && CLIPS.test(own)), `${name}: {${own.trim().slice(0, 120)}}`);
    }
  }
});
