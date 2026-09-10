import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getPngInfo } from '@expo/image-utils';
import Jimp from 'jimp-compact';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(mobileRoot, '..');
const imagesRoot = path.join(mobileRoot, 'assets', 'images');

test('Expo branding uses the Dishy launcher, adaptive, splash, and favicon assets', async () => {
  const config = JSON.parse(await readFile(path.join(mobileRoot, 'app.json'), 'utf8'));
  const adaptiveIcon = config.expo.android.adaptiveIcon;
  const splashPlugin = config.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  );

  assert.equal(config.expo.icon, './assets/images/icon.png');
  assert.equal(config.expo.backgroundColor, '#FFF7ED');
  assert.deepEqual(adaptiveIcon, {
    backgroundColor: '#FFFFFF',
    backgroundImage: './assets/images/android-icon-background.png',
    foregroundImage: './assets/images/android-icon-foreground.png',
    monochromeImage: './assets/images/android-icon-monochrome.png',
  });
  // No favicon is asserted because there is no web target: `platforms` is
  // ios/android only and the `web` config block is gone, so the app is reachable
  // from Expo Go and a build, never from a browser. A favicon reappearing here
  // means web was switched back on.
  assert.deepEqual(config.expo.platforms, ['ios', 'android']);
  assert.equal(config.expo.web, undefined);
  assert.equal(splashPlugin[1].image, './assets/images/splash-icon.png');
  assert.equal(splashPlugin[1].imageWidth, 220);
  assert.equal(splashPlugin[1].backgroundColor, '#FFF7ED');
});

test('the in-app mobile brand asset is byte-identical to the canonical web logo', async () => {
  const [webLogo, mobileLogo] = await Promise.all([
    readFile(path.join(repoRoot, 'frontend', 'public', 'web-logo.png')),
    readFile(path.join(imagesRoot, 'brand-logo.png')),
  ]);

  assert.deepEqual(mobileLogo, webLogo);
});

test('the mobile wordmark is a byte-identical transparent derivative of the web wordmark', async () => {
  const [webWordmark, mobileWordmark] = await Promise.all([
    readFile(path.join(repoRoot, 'frontend', 'public', 'dishy-wordmark.png')),
    readFile(path.join(imagesRoot, 'dishy-wordmark.png')),
  ]);

  assert.deepEqual(mobileWordmark, webWordmark);

  const info = await getPngInfo(path.join(imagesRoot, 'dishy-wordmark.png'));
  assert.equal(info.width, 520);
  assert.equal(info.height, 190);

  const image = await Jimp.read(path.join(imagesRoot, 'dishy-wordmark.png'));
  let transparentPixels = 0;
  let visiblePixels = 0;
  let visibleEdgePixels = 0;
  const visibleColors = new Set();

  image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, index) => {
    const alpha = image.bitmap.data[index + 3];
    if (alpha === 0) transparentPixels += 1;
    if (alpha > 0) {
      visiblePixels += 1;
      visibleColors.add([
        image.bitmap.data[index],
        image.bitmap.data[index + 1],
        image.bitmap.data[index + 2],
      ].join(','));
      if (
        x === 0 ||
        y === 0 ||
        x === image.bitmap.width - 1 ||
        y === image.bitmap.height - 1
      ) visibleEdgePixels += 1;
    }
  });

  assert.ok(transparentPixels > 0);
  assert.ok(visiblePixels > 0);
  assert.equal(visibleEdgePixels, 0);
  assert.deepEqual([...visibleColors], ['255,255,255']);
});

test('the mobile BrandMark uses the tintable wordmark instead of plain Dishy text', async () => {
  const source = await readFile(
    path.join(mobileRoot, 'src', 'components', 'brand-mark.tsx'),
    'utf8',
  );

  assert.match(source, /require\(['"]\.\.\/\.\.\/assets\/images\/dishy-wordmark\.png['"]\)/);
  assert.match(source, /resizeMode=["']contain["']/);
  assert.match(source, /tintColor/);
  assert.doesNotMatch(source, />\s*Dishy\s*</);
});

test('generated mobile brand images have platform-safe square dimensions', async () => {
  const expectedSizes = new Map([
    ['icon.png', 1024],
    ['android-icon-background.png', 1024],
    ['android-icon-foreground.png', 1024],
    ['android-icon-monochrome.png', 1024],
    ['splash-icon.png', 1024],
    ['favicon.png', 48],
  ]);

  for (const [filename, size] of expectedSizes) {
    const image = await getPngInfo(path.join(imagesRoot, filename));
    assert.equal(image.width, size, `${filename} width`);
    assert.equal(image.height, size, `${filename} height`);
  }
});

test('the iOS launcher icon is fully opaque and has no alpha channel', async () => {
  const iconBuffer = await readFile(path.join(imagesRoot, 'icon.png'));
  assert.equal(iconBuffer.toString('ascii', 12, 16), 'IHDR');
  assert.equal(iconBuffer[25], 2);

  const icon = await Jimp.read(path.join(imagesRoot, 'icon.png'));
  const logo = await Jimp.read(path.join(imagesRoot, 'brand-logo.png'));
  const expectedIcon = new Jimp(1024, 1024, 0xffffffff);
  expectedIcon.composite(logo.resize(820, 820), 102, 102);
  let minimumAlpha = 255;
  let mismatchedColorChannels = 0;

  icon.scan(0, 0, icon.bitmap.width, icon.bitmap.height, (_x, _y, index) => {
    minimumAlpha = Math.min(minimumAlpha, icon.bitmap.data[index + 3]);
    for (let channel = 0; channel < 3; channel += 1) {
      if (icon.bitmap.data[index + channel] !== expectedIcon.bitmap.data[index + channel]) {
        mismatchedColorChannels += 1;
      }
    }
  });

  assert.equal(minimumAlpha, 255);
  assert.equal(mismatchedColorChannels, 0);
});

test('Android adaptive artwork stays inside the centered safe-zone circle', async () => {
  const foreground = await Jimp.read(
    path.join(imagesRoot, 'android-icon-foreground.png'),
  );
  const center = (foreground.bitmap.width - 1) / 2;
  const safeRadius = foreground.bitmap.width * (33 / 108);
  let furthestVisiblePixel = 0;

  foreground.scan(
    0,
    0,
    foreground.bitmap.width,
    foreground.bitmap.height,
    (x, y, index) => {
      if (foreground.bitmap.data[index + 3] === 0) return;
      furthestVisiblePixel = Math.max(
        furthestVisiblePixel,
        Math.hypot(x - center, y - center),
      );
    },
  );

  assert.ok(furthestVisiblePixel <= safeRadius);
});
