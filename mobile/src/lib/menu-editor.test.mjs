import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  calculateCropFrame as calculateWebCropFrame,
  moveCropPosition as moveWebCropPosition,
} from '../../../frontend/src/lib/menuImageCrop.ts';
import {
  normalizeApiMediaUrls as normalizeWebApiMediaUrls,
  resolveBackendMediaUrl as resolveWebBackendMediaUrl,
} from '../../../frontend/src/lib/mediaUrl.ts';

import {
  categoryActiveToggleInput,
  initialMenuCategoryIds,
  menuIngredientDrafts,
  menuIngredientInputs,
  menuOptionGroupDrafts,
  menuOptionGroupInputs,
  validateMenuOptionGroups,
  selectableMenuCategories,
} from './menu-editor.ts';
import {
  MENU_IMAGE_MAX_FILE_BYTES,
  MENU_IMAGE_MAX_ZOOM,
  MENU_IMAGE_BACKGROUND_PROCESSING_MIME_TYPE,
  MENU_IMAGE_BACKGROUND_PROCESSING_QUALITY,
  MENU_IMAGE_BACKGROUND_PREVIEW_PATH,
  MENU_IMAGE_BACKGROUND_STRENGTH_DEFAULT,
  MENU_IMAGE_BACKGROUND_STRENGTH_MAX,
  MENU_IMAGE_BACKGROUND_STRENGTH_MIN,
  MENU_IMAGE_BACKGROUND_STRENGTH_STEP,
  MENU_IMAGE_MIN_ZOOM,
  MENU_IMAGE_MIME_TYPES,
  MENU_IMAGE_OUTPUT_HEIGHT,
  MENU_IMAGE_OUTPUT_MIME_TYPE,
  MENU_IMAGE_OUTPUT_QUALITY,
  MENU_IMAGE_OUTPUT_WIDTH,
  MENU_IMAGE_UPLOAD_FIELD,
  MENU_IMAGE_UPLOAD_PATH,
  MENU_IMAGE_ZOOM_STEP,
  appendMenuImageBackgroundPreview,
  appendMenuImageUpload,
  calculateMenuImageFrame,
  inferMenuImageMimeType,
  menuImageCaptureLogicalSize,
  menuImageOutputName,
  menuImageZoomFromTrackPosition,
  menuImageBackgroundStrengthFromTrackPosition,
  menuImageUploadCanCommit,
  moveMenuImagePosition,
  validateMenuImageAsset,
} from './menu-image.ts';
import {
  normalizeApiMediaUrls,
  resolveBackendMediaUrl,
} from './media-url.ts';

const categories = [
  { ID: 1, display_order: 1, is_active: false, name: 'หมวดเก่า' },
  { ID: 2, display_order: 2, is_active: true, name: 'อาหารจานหลัก' },
  { ID: 3, display_order: 3, is_active: true, name: 'เครื่องดื่ม' },
];

test('new menu items start in the first active category, never an inactive category', () => {
  assert.deepEqual(initialMenuCategoryIds(undefined, categories), [2]);
});

test('editing preserves every linked category and falls back to the legacy primary category', () => {
  assert.deepEqual(
    initialMenuCategoryIds(
      {
        category_id: 2,
        categories: [
          { category_id: 3 },
          { category_id: 1 },
          { category_id: 3 },
        ],
      },
      categories,
    ),
    [3, 1],
  );

  assert.deepEqual(
    initialMenuCategoryIds({ category_id: 2, categories: [] }, categories),
    [2],
  );
});

test('inactive linked categories remain visible while unrelated inactive categories stay hidden', () => {
  assert.deepEqual(
    selectableMenuCategories(categories, [1]).map((category) => category.ID),
    [1, 2, 3],
  );
  assert.deepEqual(
    selectableMenuCategories(categories, []).map((category) => category.ID),
    [2, 3],
  );
});

const option = (overrides = {}) => ({
  name: 'Regular',
  price_delta: 0,
  is_default: false,
  display_order: 1,
  is_active: true,
  ...overrides,
});

const optionGroup = (overrides = {}) => ({
  name: 'Size',
  required: false,
  min_select: 0,
  max_select: 1,
  display_order: 1,
  is_active: true,
  options: [option()],
  ...overrides,
});

test('normalizes option selection bounds and payload text without mutating the editor state', () => {
  const groups = [
    optionGroup({
      name: '  Size  ',
      required: true,
      min_select: -3,
      max_select: 0,
      display_order: 0,
      options: [
        option({
          name: '  Large  ',
          price_delta: Number.NaN,
          display_order: 0,
        }),
      ],
    }),
  ];

  const result = validateMenuOptionGroups(groups);

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.groups, [
    optionGroup({
      name: 'Size',
      required: true,
      min_select: 1,
      max_select: 1,
      display_order: 1,
      options: [option({ name: 'Large', price_delta: 0, display_order: 1 })],
    }),
  ]);
  assert.equal(groups[0].name, '  Size  ');
  assert.equal(groups[0].min_select, -3);
});

test('menu decimal drafts preserve intermediate typing until payload conversion', () => {
  const groupDrafts = menuOptionGroupDrafts([
    optionGroup({ options: [option({ price_delta: 12.5 })] }),
  ]);
  const ingredientDrafts = menuIngredientDrafts([
    { ingredient_id: 9, quantity: 1.25, unit: 'kg', note: '' },
  ]);

  groupDrafts[0].options[0].price_delta = '12.';
  ingredientDrafts[0].quantity = '0.';

  assert.equal(groupDrafts[0].options[0].price_delta, '12.');
  assert.equal(ingredientDrafts[0].quantity, '0.');
  assert.equal(menuOptionGroupInputs(groupDrafts)[0].options[0].price_delta, 12);
  assert.equal(menuIngredientInputs(ingredientDrafts)[0].quantity, 0);
  assert.equal(groupDrafts[0].options[0].price_delta, '12.');
  assert.equal(ingredientDrafts[0].quantity, '0.');
});

test('rejects invalid min, max, active-option, and default-option constraints', () => {
  const result = validateMenuOptionGroups([
    optionGroup({
      name: 'Minimum exceeds maximum',
      required: true,
      min_select: 2,
      max_select: 1,
      options: [option(), option({ name: 'Large', display_order: 2 })],
    }),
    optionGroup({
      name: 'Not enough active options',
      min_select: 2,
      max_select: 2,
      options: [
        option(),
        option({ name: 'Large', is_active: false, display_order: 2 }),
      ],
    }),
    optionGroup({
      name: 'Too many defaults',
      max_select: 1,
      options: [
        option({ name: 'Egg', is_default: true }),
        option({ name: 'Cheese', is_default: true, display_order: 2 }),
      ],
    }),
  ]);

  assert.deepEqual(
    result.issues.map(({ code, groupIndex }) => ({ code, groupIndex })),
    [
      { code: 'max_below_min', groupIndex: 0 },
      { code: 'min_exceeds_active_options', groupIndex: 1 },
      { code: 'defaults_exceed_max', groupIndex: 2 },
    ],
  );
});

test('rejects incomplete and duplicate option names plus negative prices', () => {
  const result = validateMenuOptionGroups([
    optionGroup({ name: '  ', options: [] }),
    optionGroup({
      name: 'Toppings',
      options: [
        option({ name: '  ' }),
        option({ name: 'Egg', price_delta: -1, display_order: 2 }),
        option({ name: ' egg ', display_order: 3 }),
      ],
    }),
    optionGroup({ name: ' toppings ', options: [option({ name: 'Cheese' })] }),
  ]);

  assert.deepEqual(
    result.issues.map(({ code, groupIndex, optionIndex }) => ({
      code,
      groupIndex,
      optionIndex,
    })),
    [
      { code: 'group_name_required', groupIndex: 0, optionIndex: undefined },
      { code: 'option_required', groupIndex: 0, optionIndex: undefined },
      { code: 'option_name_required', groupIndex: 1, optionIndex: 0 },
      { code: 'option_price_negative', groupIndex: 1, optionIndex: 1 },
      { code: 'option_name_duplicate', groupIndex: 1, optionIndex: 2 },
      { code: 'group_name_duplicate', groupIndex: 2, optionIndex: undefined },
    ],
  );
});

test('category active toggle preserves editable metadata and flips only the status', () => {
  assert.deepEqual(
    categoryActiveToggleInput({
      ID: 8,
      name: '  Drinks  ',
      display_order: 4,
      is_active: true,
    }),
    {
      name: 'Drinks',
      display_order: 4,
      is_active: false,
    },
  );
});

test('menu image validation matches the web upload contract', () => {
  assert.equal(MENU_IMAGE_OUTPUT_WIDTH, 1200);
  assert.equal(MENU_IMAGE_OUTPUT_HEIGHT, 900);
  assert.equal(MENU_IMAGE_OUTPUT_MIME_TYPE, 'image/webp');
  assert.equal(MENU_IMAGE_OUTPUT_QUALITY, 0.9);
  assert.equal(MENU_IMAGE_BACKGROUND_PROCESSING_MIME_TYPE, 'image/png');
  assert.equal(MENU_IMAGE_BACKGROUND_PROCESSING_QUALITY, 1);
  assert.equal(MENU_IMAGE_MIN_ZOOM, -100);
  assert.equal(MENU_IMAGE_MAX_ZOOM, 100);
  assert.equal(MENU_IMAGE_ZOOM_STEP, 5);
  assert.equal(MENU_IMAGE_MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.deepEqual(MENU_IMAGE_MIME_TYPES, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(validateMenuImageAsset({ mimeType: 'image/jpeg', fileSize: 1024 }), null);
  assert.equal(validateMenuImageAsset({ mimeType: 'image/png', fileSize: 1024 }), null);
  assert.equal(validateMenuImageAsset({ mimeType: 'image/webp', fileSize: 1024 }), null);
  assert.equal(validateMenuImageAsset({ mimeType: 'image/jpeg' }), null);
  assert.equal(validateMenuImageAsset({ mimeType: 'image/png', fileSize: MENU_IMAGE_MAX_FILE_BYTES }), null);
  assert.equal(validateMenuImageAsset({ mimeType: 'image/gif', fileSize: 1024 }), 'unsupported_type');
  assert.equal(validateMenuImageAsset({ mimeType: 'image/png', fileSize: MENU_IMAGE_MAX_FILE_BYTES + 1 }), 'too_large');
  assert.equal(validateMenuImageAsset({ mimeType: 'image/png', fileSize: 0 }), 'empty');
});

test('native picker metadata resolves to compact default and safe PNG processing names', () => {
  assert.equal(inferMenuImageMimeType('image/JPEG', 'camera.heic'), 'image/jpeg');
  assert.equal(inferMenuImageMimeType(null, 'food.photo.PNG?cache=1'), 'image/png');
  assert.equal(inferMenuImageMimeType(undefined, 'file:///menu.webp'), 'image/webp');
  assert.equal(inferMenuImageMimeType('image/heic', 'camera.heic'), 'image/heic');
  assert.equal(inferMenuImageMimeType('image/gif', 'misnamed.jpg'), 'image/gif');
  assert.equal(menuImageOutputName('my.menu.jpg'), 'my.menu-cropped.webp');
  assert.equal(menuImageOutputName('folder\\dish.png', true), 'dish-cropped.png');
  assert.equal(menuImageOutputName('', true), 'menu-image-cropped.png');
});

test('native capture and zoom helpers preserve the exact output contract', () => {
  assert.deepEqual(menuImageCaptureLogicalSize(3), { width: 400, height: 300 });
  assert.deepEqual(menuImageCaptureLogicalSize(0), { width: 1200, height: 900 });
  assert.equal(menuImageZoomFromTrackPosition(0, 200), -100);
  assert.equal(menuImageZoomFromTrackPosition(100, 200), 0);
  assert.equal(menuImageZoomFromTrackPosition(200, 200), 100);
  assert.equal(menuImageZoomFromTrackPosition(102, 200), 0);
  assert.equal(menuImageZoomFromTrackPosition(106, 200), 5);
  assert.equal(menuImageZoomFromTrackPosition(1, 0), null);
});

test('menu image upload uses the same endpoint and multipart field as the web', () => {
  const appended = [];
  const file = {
    uri: 'file:///menu.png',
    name: 'menu-cropped.png',
    type: 'image/png',
  };
  appendMenuImageUpload({
    append(field, value) {
      appended.push([field, value]);
    },
  }, file, { removeBackground: false, backgroundStrength: 50 });

  assert.equal(MENU_IMAGE_UPLOAD_PATH, '/api/v1/menu-items/upload-image');
  assert.equal(MENU_IMAGE_UPLOAD_FIELD, 'image');
  assert.deepEqual(appended, [
    ['image', file],
    ['remove_background', 'false'],
    ['background_strength', '50'],
  ]);
});

test('native background-removal preview and strength follow the multipart contract', () => {
  const appended = [];
  const file = { uri: 'file:///menu.png', name: 'menu.png', type: 'image/png' };

  appendMenuImageBackgroundPreview({
    append(field, value) { appended.push([field, value]); },
  }, file, 65);

  assert.equal(MENU_IMAGE_BACKGROUND_PREVIEW_PATH, '/api/v1/menu-items/preview-background');
  assert.equal(MENU_IMAGE_BACKGROUND_STRENGTH_MIN, 0);
  assert.equal(MENU_IMAGE_BACKGROUND_STRENGTH_MAX, 100);
  assert.equal(MENU_IMAGE_BACKGROUND_STRENGTH_DEFAULT, 50);
  assert.equal(MENU_IMAGE_BACKGROUND_STRENGTH_STEP, 5);
  assert.deepEqual(appended, [['image', file], ['background_strength', '65']]);
  assert.equal(menuImageBackgroundStrengthFromTrackPosition(0, 200), 0);
  assert.equal(menuImageBackgroundStrengthFromTrackPosition(100, 200), 50);
  assert.equal(menuImageBackgroundStrengthFromTrackPosition(200, 200), 100);
  assert.equal(menuImageUploadCanCommit({ removeBackground: false, backgroundStrength: 50 }, false), true);
  assert.equal(menuImageUploadCanCommit({ removeBackground: true, backgroundStrength: 50 }, true), true);
  assert.equal(menuImageUploadCanCommit({ removeBackground: true, backgroundStrength: 50 }, false), false);
});

test('menu image positioning uses the same 4:3 framing as the web editor', () => {
  assert.deepEqual(
    calculateMenuImageFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: 0,
      positionX: 0.5,
      positionY: 0.5,
    }),
    { width: 1600, height: 900, x: -200, y: 0 },
  );

  assert.deepEqual(
    calculateMenuImageFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: -100,
      positionX: 0.5,
      positionY: 0.5,
    }),
    { width: 600, height: 337.5, x: 300, y: 281.25 },
  );

  assert.deepEqual(
    calculateMenuImageFrame({
      naturalWidth: 1600,
      naturalHeight: 900,
      cropWidth: 1200,
      cropHeight: 900,
      zoomPercent: 100,
      positionX: 0.5,
      positionY: 0.5,
    }),
    { width: 3200, height: 1800, x: -1000, y: -450 },
  );
});

test('menu image drag keeps working above and below cover scale', () => {
  assert.deepEqual(
    moveMenuImagePosition({
      positionX: 0.5,
      positionY: 0.5,
      deltaX: 100,
      deltaY: 0,
      offsetRangeX: -133,
      offsetRangeY: 0,
    }),
    { positionX: 0, positionY: 0.5 },
  );
  assert.deepEqual(
    moveMenuImagePosition({
      positionX: 0.5,
      positionY: 0.5,
      deltaX: 100,
      deltaY: -100,
      offsetRangeX: 600,
      offsetRangeY: 562.5,
    }),
    { positionX: 0.5 + 100 / 600, positionY: 0.5 - 100 / 562.5 },
  );
});

test('mobile menu framing remains numerically identical to the web implementation', () => {
  const frames = [
    { naturalWidth: 1600, naturalHeight: 900, cropWidth: 400, cropHeight: 300, zoomPercent: -100, positionX: 0, positionY: 1 },
    { naturalWidth: 1600, naturalHeight: 900, cropWidth: 1200, cropHeight: 900, zoomPercent: -60, positionX: 0.2, positionY: 0.8 },
    { naturalWidth: 900, naturalHeight: 1600, cropWidth: 1200, cropHeight: 900, zoomPercent: 0, positionX: 0.5, positionY: 0.5 },
    { naturalWidth: 800, naturalHeight: 800, cropWidth: 1200, cropHeight: 900, zoomPercent: 100, positionX: 1, positionY: 0 },
    { naturalWidth: 800, naturalHeight: 800, cropWidth: 1200, cropHeight: 900, zoomPercent: Number.NaN, positionX: -2, positionY: 3 },
  ];
  for (const input of frames) {
    assert.deepEqual(calculateMenuImageFrame(input), calculateWebCropFrame(input));
  }

  const movements = [
    { positionX: 0.5, positionY: 0.5, deltaX: 100, deltaY: 0, offsetRangeX: -133, offsetRangeY: 0 },
    { positionX: 0.5, positionY: 0.5, deltaX: -100, deltaY: 70, offsetRangeX: 600, offsetRangeY: 562.5 },
  ];
  for (const input of movements) {
    assert.deepEqual(moveMenuImagePosition(input), moveWebCropPosition(input));
  }
});

test('the on-device 4:3 preview scales to the exported 1200 by 900 frame', () => {
  for (const zoomPercent of [-100, -55, 0, 35, 100]) {
    const input = {
      naturalWidth: 1600,
      naturalHeight: 900,
      zoomPercent,
      positionX: 0.23,
      positionY: 0.81,
    };
    const preview = calculateMenuImageFrame({ ...input, cropWidth: 400, cropHeight: 300 });
    const output = calculateMenuImageFrame({ ...input, cropWidth: 1200, cropHeight: 900 });
    for (const key of ['width', 'height', 'x', 'y']) {
      assert.ok(Math.abs(output[key] - preview[key] * 3) < 1e-9, `${key} at zoom ${zoomPercent}`);
    }
  }
});

test('backend menu media URLs normalize exactly like the web client', () => {
  const publicApiUrl = 'https://api.dishy.pro';
  assert.equal(
    resolveBackendMediaUrl('http://localhost:8080/uploads/menu/1/item.webp', publicApiUrl),
    'https://api.dishy.pro/uploads/menu/1/item.webp',
  );
  assert.equal(
    resolveBackendMediaUrl('http://192.168.1.8:8080/uploads/menu/item.webp?v=2#preview', publicApiUrl),
    'https://api.dishy.pro/uploads/menu/item.webp?v=2#preview',
  );
  assert.equal(
    resolveBackendMediaUrl('/uploads/menu/item.webp', publicApiUrl),
    'https://api.dishy.pro/uploads/menu/item.webp',
  );
  assert.equal(
    resolveBackendMediaUrl('https://images.example.com/menu/item.jpg', publicApiUrl),
    'https://images.example.com/menu/item.jpg',
  );

  assert.deepEqual(
    normalizeApiMediaUrls({
      menu_items: [{ image_url: 'http://127.0.0.1:8080/uploads/menu/1/item.webp' }],
      note: 'http://localhost:8080/uploads/leave-this-alone.webp',
    }, publicApiUrl),
    {
      menu_items: [{ image_url: 'https://api.dishy.pro/uploads/menu/1/item.webp' }],
      note: 'http://localhost:8080/uploads/leave-this-alone.webp',
    },
  );
});

test('mobile media URL resolution stays in lockstep with the web client', () => {
  const api = 'https://api.dishy.pro';
  const values = [
    '/uploads/menu/item.webp',
    'uploads/menu/item.webp',
    'http://localhost:8080/uploads/menu/item.webp',
    'http://10.4.8.2:8080/uploads/menu/item.webp?v=2#preview',
    'https://images.example.com/menu/item.jpg',
    'not a url',
  ];
  for (const value of values) {
    assert.equal(resolveBackendMediaUrl(value, api), resolveWebBackendMediaUrl(value, api));
  }

  const payload = {
    items: [{ image_url: '/uploads/menu/item.webp' }],
    restaurant: { logo: 'http://127.0.0.1:8080/uploads/logo.png' },
    note: 'http://localhost:8080/uploads/leave-alone.png',
  };
  assert.deepEqual(
    normalizeApiMediaUrls(payload, api),
    normalizeWebApiMediaUrls(payload, api),
  );
});

test('mobile ships the exact same menu placeholder bytes as the web', () => {
  const mobileAsset = readFileSync(new URL('../../assets/images/menu-placeholder-v2.webp', import.meta.url));
  const webAsset = readFileSync(new URL('../../../frontend/public/menu-placeholder-v2.webp', import.meta.url));
  assert.deepEqual(mobileAsset, webAsset);
});

test('the shared mobile image component owns web-parity fit and fallback policy', () => {
  const source = readFileSync(
    new URL('../components/menu-image.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /menu-placeholder-v2\.webp/);
  assert.match(source, /if \(!square\)/);
  assert.match(source, /resizeMode="cover"/);
  assert.match(source, /resizeMode="contain"/);
  assert.match(source, /aspectRatio:\s*4\s*\/\s*3/);
  assert.match(source, /failedUrl === resolvedUrl/);
  assert.doesNotMatch(source, /brand-logo\.png/);
});

test('landscape menu images render inside a bounded 4:3 frame instead of measuring from the image itself', () => {
  const source = readFileSync(
    new URL('../components/menu-image.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /\bView\b/);
  assert.match(
    source,
    /<View\b[\s\S]{0,500}<Image\b[\s\S]{0,500}<\/View>/,
    'card and hero variants must use a dedicated layout container around the native Image',
  );
  assert.match(
    source,
    /aspectRatio:\s*4\s*\/\s*3[\s\S]{0,240}overflow:\s*'hidden'|overflow:\s*'hidden'[\s\S]{0,240}aspectRatio:\s*4\s*\/\s*3/,
    'the container must own the 4:3 bounds and clip its image',
  );
  assert.match(
    source,
    /StyleSheet\.absoluteFill(?:Object)?|position:\s*'absolute'[\s\S]{0,240}(?:top:\s*0[\s\S]{0,240}bottom:\s*0|bottom:\s*0[\s\S]{0,240}top:\s*0)/,
    'the native Image must fill the already-sized frame absolutely',
  );
  assert.match(
    source,
    /landscapeImage:[\s\S]{0,320}width:\s*'100%'[\s\S]{0,160}height:\s*'100%'/,
    'the child must override the intrinsic 1200 by 900 dimensions injected for the static placeholder',
  );
});

test('every mobile menu and order surface consumes the shared image policy', () => {
  const cardFiles = [
    '../../app/menu.tsx',
    '../../app/order/[id].tsx',
    '../../app/order/item.tsx',
    '../../app/order/current-item.tsx',
  ];
  for (const relativePath of cardFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /<MenuImage\b/);
    assert.match(source, /variant="(?:card|hero)"/);
  }

  const rowFiles = [
    '../../app/order/[id].tsx',
    '../../app/order/current-round.tsx',
    '../../app/order/bill.tsx',
    // The kitchen ticket carries no menu photo - the web KDS shows none
    // either - so the KDS is not an image surface to police here.
  ];
  for (const relativePath of rowFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /<MenuImage\b/);
    assert.match(source, /variant="row"/);
    assert.doesNotMatch(source, /menuPlaceholder\s*=\s*require\([^)]*brand-logo\.png/);
  }
});

test('the bill add-item catalog uses the same 4:3 menu card image as web', () => {
  const source = readFileSync(new URL('../../app/order/bill.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /filteredMenu\.map[\s\S]{0,2400}<MenuImage[\s\S]{0,300}imageUrl=\{item\.image_url\}[\s\S]{0,300}variant="card"/,
  );
});

test('native menu uploads leave the multipart boundary to fetch', () => {
  const source = readFileSync(new URL('../api/menu.ts', import.meta.url), 'utf8');
  assert.match(source, /new FormData\(\)/);
  assert.match(source, /appendMenuImageBackgroundPreview\(formData, file, backgroundStrength\)/);
  assert.match(source, /appendMenuImageUpload\(formData, file, options\)/);
  assert.match(source, /method:\s*'POST'/);
  assert.doesNotMatch(source, /Content-Type/);
});

test('native menu image editing preserves the committed URL until an upload succeeds', async () => {
  const { resolveCommittedMenuImageUrl } = await import('./menu-image.ts');
  const committed = '/uploads/menu/original.webp';

  assert.equal(resolveCommittedMenuImageUrl(committed, null), committed);
  assert.equal(resolveCommittedMenuImageUrl(committed, undefined), committed);
  assert.equal(resolveCommittedMenuImageUrl(committed, ''), committed);
  assert.equal(resolveCommittedMenuImageUrl(committed, '   '), committed);
  assert.equal(
    resolveCommittedMenuImageUrl(committed, '/uploads/menu/reframed.webp'),
    '/uploads/menu/reframed.webp',
  );
});

test('menu item editor replaces the raw URL field with the native crop and upload workflow', () => {
  const source = readFileSync(new URL('../../app/menu/item.tsx', import.meta.url), 'utf8');

  assert.match(source, /import\s+\{[^}]*uploadMenuImage[^}]*\}\s+from\s+'@\/src\/api\/menu'/s);
  assert.match(source, /MenuImageCropper/);
  assert.match(source, /<MenuImageCropper\b/);
  assert.match(source, /onUpload=/);
  assert.match(source, /onEditingChange=/);
  assert.match(source, /saving\s*\|\|\s*imageEditing\s*\|\|\s*uploadingImage/);
  assert.doesNotMatch(source, /ลิงก์รูปเมนู/);
  assert.doesNotMatch(source, /Menu photo URL/);
  assert.doesNotMatch(source, /https:\/\/\.\.\.[^\n]*uploads/);
});

test('native cropper owns picker, exact framing export, and accessible zoom', () => {
  const source = readFileSync(
    new URL('../components/menu-image-cropper.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /expo-image-picker/);
  assert.doesNotMatch(source, /requestMediaLibraryPermissionsAsync/);
  assert.match(source, /launchImageLibraryAsync/);
  assert.match(source, /react-native-view-shot/);
  assert.match(source, /captureRef/);
  assert.match(source, /collapsable=\{false\}/);
  assert.match(source, /PixelRatio\.get\(\)/);
  assert.match(source, /expo-image-manipulator/);
  assert.match(source, /SaveFormat\.PNG/);
  assert.match(source, /SaveFormat\.WEBP/);
  assert.match(source, /MENU_IMAGE_OUTPUT_WIDTH/);
  assert.match(source, /MENU_IMAGE_OUTPUT_HEIGHT/);
  assert.match(source, /MENU_IMAGE_OUTPUT_QUALITY/);
  assert.match(source, /MENU_IMAGE_OUTPUT_MIME_TYPE/);
  assert.match(source, /accessibilityRole="adjustable"/);
  assert.match(source, /accessibilityActions=\{/);
  assert.match(source, /กำลังเตรียมรูป\.\.\./);
  assert.match(source, /จัดวางรูปเมนู/);
  assert.match(source, /คืนค่าตำแหน่ง/);
  assert.match(source, /ใช้รูปนี้/);
  assert.doesNotMatch(source, /ลบรูป|Remove image/);
});

test('native cropper renders an automatic race-safe cutout in the existing crop viewport', () => {
  const cropperSource = readFileSync(
    new URL('../components/menu-image-cropper.tsx', import.meta.url),
    'utf8',
  );
  const apiSource = readFileSync(new URL('../api/menu.ts', import.meta.url), 'utf8');
  const editorSource = readFileSync(new URL('../../app/menu/item.tsx', import.meta.url), 'utf8');

  assert.match(cropperSource, /useState\(false\)/);
  assert.match(cropperSource, /accessibilityRole="switch"/);
  assert.match(cropperSource, /accessibilityRole="adjustable"/);
  assert.match(cropperSource, /ตัดน้อยลง|Cut less/);
  assert.match(cropperSource, /ตัดมากขึ้น|Cut more/);
  assert.match(cropperSource, /previewGenerationRef/);
  assert.match(cropperSource, /AbortController/);
  assert.match(cropperSource, /BACKGROUND_PREVIEW_DEBOUNCE_MS/);
  assert.match(cropperSource, /BACKGROUND_PREVIEW_TIMEOUT_MS/);
  assert.match(cropperSource, /previewRevision/);
  assert.match(cropperSource, /if \(!removeBackground \|\| applying \|\| dragging\) return/);
  assert.match(cropperSource, /accessibilityState=\{\{\s*busy:/);
  assert.doesNotMatch(cropperSource, /sliderInteracting|previewInteractionActive/);
  assert.doesNotMatch(cropperSource, /onInteractionStart|onInteractionEnd/);
  assert.doesNotMatch(cropperSource, /ปล่อยนิ้วเพื่ออัปเดต|Release to update/);
  assert.ok((cropperSource.match(/nextValue !== valueRef\.current/g) ?? []).length >= 2);
  assert.match(cropperSource, /cancelBackgroundPreviewRequest/);
  assert.match(cropperSource, /invalidateBackgroundPreview/);
  assert.match(cropperSource, /preview_data_url/);
  assert.match(cropperSource, /backgroundPreviewOverlay/);
  assert.match(cropperSource, /กำลังอัปเดตภาพที่ตัด/);
  assert.match(cropperSource, /ตัดพื้นหลังแล้วประมาณ/);
  assert.doesNotMatch(cropperSource, /ดูตัวอย่างการตัดพื้นหลัง|Preview background removal/);
  assert.doesNotMatch(cropperSource, /backgroundPreviewCanvas/);
  assert.match(cropperSource, /removeBackground\s*&&\s*!approvedBackgroundPreview/);
  assert.match(cropperSource, /approvedBackgroundPreview!\.file/);
  assert.match(apiSource, /previewMenuImageBackground/);
  assert.match(apiSource, /MENU_IMAGE_BACKGROUND_PREVIEW_PATH/);
  assert.match(apiSource, /signal/);
  assert.match(editorSource, /background_removed/);
  assert.match(editorSource, /menuImageUploadCanCommit\(options, backgroundRemoved\)/);
});

test('Expo declares the native photo-library permission plugin used by the menu cropper', () => {
  const config = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8'));
  const pickerPlugin = config.expo.plugins.find((plugin) => (
    Array.isArray(plugin) ? plugin[0] === 'expo-image-picker' : plugin === 'expo-image-picker'
  ));

  assert.ok(Array.isArray(pickerPlugin), 'expo-image-picker must include permission configuration');
  assert.match(pickerPlugin[1].photosPermission, /Dishy/);
  assert.match(pickerPlugin[1].photosPermission, /รูป|photo/i);
  assert.equal(pickerPlugin[1].cameraPermission, false);
  assert.equal(pickerPlugin[1].microphonePermission, false);
});

test('native image workflow dependencies stay declared explicitly', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  // From SDK 57 the Expo packages track the SDK number rather than their own
  // major, so these read ~57 where they used to read ~17 and ~14. The point of
  // the test is unchanged: the cropper needs all three declared, and a major
  // move should be a deliberate edit here rather than a silent bump.
  assert.match(manifest.dependencies['expo-image-picker'], /^~57\./);
  assert.match(manifest.dependencies['expo-image-manipulator'], /^~57\./);
  assert.match(manifest.dependencies['react-native-view-shot'], /^5\./);
});
