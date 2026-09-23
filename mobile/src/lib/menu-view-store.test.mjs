import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The order screen's menu layout is one value per device, shared by the view
// button and the menu through src/storage/menu-view-store.ts. The first half
// reads the store's source and asserts on the lines that make it one value,
// read once, written on change and never loud about storage. The second half
// runs the store itself with expo-secure-store and React's
// useSyncExternalStore replaced by fakes, so the same promises hold in motion.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE_FILE = path.join('src', 'storage', 'menu-view-store.ts');
const STORE_KEY = 'dishy_menu_view_mode';

const source = (relative) => readFileSync(path.join(mobileRoot, relative), 'utf8');
/** The file without its comments, so a note naming what not to do is not the thing done. */
const code = (relative) => source(relative)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
/** One top-level function of `text`, from its declaration to its closing brace at column 0. */
const fnText = (text, name) => {
  const start = text.search(new RegExp(`(?:^|\\n)(?:export )?function ${name}\\(`));
  assert.ok(start >= 0, `function ${name} not found`);
  const end = text.indexOf('\n}\n', start);
  return text.slice(start, end + 2);
};
const count = (text, pattern) => (text.match(pattern) ?? []).length;

const store = code(STORE_FILE);

test('every caller shares one value through useSyncExternalStore, with a setter that keeps its identity', () => {
  assert.match(store, /import \{ useSyncExternalStore \} from 'react';/);
  const hook = fnText(store, 'useMenuViewMode');
  assert.match(hook, /^\nexport function useMenuViewMode\(\): readonly \[MenuViewMode, \(next: MenuViewMode\) => void\] \{/);
  assert.match(hook, /const mode = useSyncExternalStore\(subscribe, getSnapshot\);/);
  assert.match(hook, /return \[mode, setMenuViewMode\] as const;/);
  // A per-component copy would let the button and the menu drift apart.
  assert.doesNotMatch(store, /\buse(State|Reducer|Effect|LayoutEffect)\b/);
  // The hook is the store's only way in.
  assert.deepEqual(store.match(/^export .*$/gm), [
    'export function useMenuViewMode(): readonly [MenuViewMode, (next: MenuViewMode) => void] {',
  ]);
});

test('the saved mode is read once per session, synchronously, and starts at the default until then', () => {
  assert.match(store, /^let current: MenuViewMode = DEFAULT_MENU_VIEW_MODE;$/m);
  assert.match(store, /^let loaded = false;$/m);
  const load = fnText(store, 'load');
  // The flag is set before the read, so a read that throws is not retried on every render.
  assert.match(load, /if \(loaded\) return;\s*loaded = true;\s*let raw: string \| null = null;\s*try \{\s*raw = SecureStore\.getItem\(MENU_VIEW_MODE_KEY\);\s*\} catch \{\s*raw = null;\s*\}\s*current = parseMenuViewMode\(raw\);/);
  // Synchronous, so an order screen's first frame is already in the saved layout.
  assert.equal(count(store, /SecureStore\.getItem\(/g), 1);
  assert.doesNotMatch(store, /getItemAsync/);
  assert.match(fnText(store, 'getSnapshot'), /load\(\);\s*return current;/);
});

test('a change notifies every subscriber and is written, and the same mode again is neither', () => {
  const set = fnText(store, 'setMenuViewMode');
  assert.match(set, /load\(\);\s*const mode = parseMenuViewMode\(next\);\s*if \(mode === current\) return;\s*current = mode;\s*for \(const listener of \[\.\.\.listeners\]\) listener\(\);\s*persist\(\);/);
  // Only persist writes, and it writes the value it read, not whatever was passed in.
  assert.equal(count(store, /SecureStore\.setItemAsync\(/g), 1);
  assert.match(fnText(store, 'persist'), /const value = current;\s*SecureStore\.setItemAsync\(MENU_VIEW_MODE_KEY, value\)/);
  assert.match(fnText(store, 'persist'), /\.finally\(\(\) => \{\s*persisting = false;\s*if \(current !== value\) persist\(\);\s*\}\);/);
});

test('storage errors are swallowed on both the read and the write', () => {
  assert.match(fnText(store, 'persist'), /SecureStore\.setItemAsync\(MENU_VIEW_MODE_KEY, value\)\s*\.catch\(\(\) => \{\s*\}\)/);
  assert.doesNotMatch(store, /\bthrow\b/);
  assert.doesNotMatch(store, /\bconsole\./);
});

test('the storage key belongs to this store alone', () => {
  const owners = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, 'utf8').includes(STORE_KEY)) {
        owners.push(path.relative(mobileRoot, full));
      }
    }
  };
  walk(path.join(mobileRoot, 'src'));
  walk(path.join(mobileRoot, 'app'));
  assert.deepEqual(owners, [STORE_FILE]);
  assert.match(store, new RegExp(`^const MENU_VIEW_MODE_KEY = '${STORE_KEY}';$`, 'm'));
});

// ── The store in motion ────────────────────────────────────────────────────
//
// node --test gives this file its own process, so these hooks reach nothing
// else. They answer only the store's own imports: expo-secure-store and react
// become fakes that call into `globalThis.__menuViewStore`, and the '@/' alias
// points at the real file, so the store parses with the real parseMenuViewMode.

const storeUrl = pathToFileURL(path.join(mobileRoot, STORE_FILE)).href;
const moduleOf = (text) => `data:text/javascript,${encodeURIComponent(text)}`;
const FAKES = {
  'expo-secure-store': moduleOf([
    'export const getItem = (key) => globalThis.__menuViewStore.getItem(key);',
    'export const setItemAsync = (key, value) => globalThis.__menuViewStore.setItemAsync(key, value);',
  ].join('\n')),
  react: moduleOf(
    'export const useSyncExternalStore = (subscribe, getSnapshot) => globalThis.__menuViewStore.useSyncExternalStore(subscribe, getSnapshot);',
  ),
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromStore = context.parentURL?.split('?')[0] === storeUrl;
    if (fromStore && Object.hasOwn(FAKES, specifier)) return { url: FAKES[specifier], shortCircuit: true };
    if (fromStore && specifier.startsWith('@/')) {
      return { url: pathToFileURL(path.join(mobileRoot, `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

let instance = 0;

/**
 * A fresh copy of the store over a fake device. `saved` is what the device
 * already holds; `readFails` makes the keychain throw; writes stay pending
 * until the test settles them, the way a slow native write would.
 */
async function freshStore({ saved = null, readFails = false } = {}) {
  const disk = new Map(saved === null ? [] : [[STORE_KEY, saved]]);
  const device = { reads: 0, writes: [], pending: [], subscribe: null };
  globalThis.__menuViewStore = {
    getItem(key) {
      device.reads += 1;
      if (readFails) throw new Error('keychain unavailable');
      return disk.get(key) ?? null;
    },
    setItemAsync(key, value) {
      device.writes.push(value);
      return new Promise((resolve, reject) => {
        device.pending.push({
          succeed: () => { disk.set(key, value); resolve(); },
          fail: () => reject(new Error('keychain unavailable')),
        });
      });
    },
    // React reads the snapshot during render and subscribes once mounted.
    useSyncExternalStore(subscribe, getSnapshot) {
      device.subscribe = subscribe;
      return getSnapshot();
    },
  };
  instance += 1;
  const module = await import(`${storeUrl}?instance=${instance}`);
  const settleNext = async (outcome) => {
    device.pending.shift()[outcome]();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { useMenuViewMode: module.useMenuViewMode, device, disk, settleNext };
}

test('the first read picks up the saved mode, and storage is never read again', async () => {
  const { useMenuViewMode, device } = await freshStore({ saved: 'list' });
  assert.equal(useMenuViewMode()[0], 'list');
  useMenuViewMode();
  useMenuViewMode();
  assert.equal(device.reads, 1);
});

test('nothing saved, a mode this build does not know, or an unreadable keychain all start at the photo grid', async () => {
  assert.equal((await freshStore()).useMenuViewMode()[0], 'grid');
  assert.equal((await freshStore({ saved: 'mosaic' })).useMenuViewMode()[0], 'grid');

  const locked = await freshStore({ readFails: true });
  assert.equal(locked.useMenuViewMode()[0], 'grid');
  locked.useMenuViewMode();
  // A throwing keychain is asked once, not on every render.
  assert.equal(locked.device.reads, 1);
});

test('a change reaches every subscriber and is saved once, and the same mode again does nothing', async () => {
  const { useMenuViewMode, device, disk, settleNext } = await freshStore();
  const [, setMode] = useMenuViewMode();
  const heard = { button: 0, menu: 0 };
  device.subscribe(() => { heard.button += 1; });
  const unsubscribeMenu = device.subscribe(() => { heard.menu += 1; });

  setMode('compact');
  assert.deepEqual(heard, { button: 1, menu: 1 });
  assert.equal(useMenuViewMode()[0], 'compact');
  assert.deepEqual(device.writes, ['compact']);
  await settleNext('succeed');
  assert.equal(disk.get(STORE_KEY), 'compact');

  setMode('compact');
  assert.deepEqual(heard, { button: 1, menu: 1 });
  assert.deepEqual(device.writes, ['compact']);

  unsubscribeMenu();
  setMode('list');
  assert.deepEqual(heard, { button: 2, menu: 1 });
});

test('the setter is the same function on every render', async () => {
  const { useMenuViewMode } = await freshStore();
  assert.equal(useMenuViewMode()[1], useMenuViewMode()[1]);
});

test('quick taps are written one at a time, and the newest choice is what stays on the device', async () => {
  const { useMenuViewMode, device, disk, settleNext } = await freshStore();
  const [, setMode] = useMenuViewMode();

  setMode('list');
  setMode('compact');
  // The second tap waits for the first write instead of racing it.
  assert.deepEqual(device.writes, ['list']);
  await settleNext('succeed');
  assert.deepEqual(device.writes, ['list', 'compact']);
  await settleNext('succeed');
  assert.equal(disk.get(STORE_KEY), 'compact');
  assert.equal(device.pending.length, 0);

  // Tapping back to the mode already on its way to disk needs no second write.
  setMode('grid');
  setMode('list');
  setMode('grid');
  await settleNext('succeed');
  assert.deepEqual(device.writes, ['list', 'compact', 'grid']);
  assert.equal(disk.get(STORE_KEY), 'grid');
});

test('a failed write is swallowed, and the choice holds for the rest of the session', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { useMenuViewMode, device, disk, settleNext } = await freshStore({ saved: 'list' });
    const [, setMode] = useMenuViewMode();
    setMode('compact');
    await settleNext('fail');
    assert.equal(useMenuViewMode()[0], 'compact');
    assert.equal(disk.get(STORE_KEY), 'list');

    // The next change still gets its own write.
    setMode('grid');
    assert.deepEqual(device.writes, ['compact', 'grid']);
    await settleNext('succeed');
    assert.equal(disk.get(STORE_KEY), 'grid');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});
