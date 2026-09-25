import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The rule: never show the API's own wording to a user. These screens used to
// print `err.message` under their red heading - the server's English ("stock
// must be zero or greater", "internal server error") or React Native's
// "Network request failed" - most often as
//
//   setError(err instanceof Error ? err.message : copy('...ไม่สำเร็จ', '...'))
//
// which also made the Thai fallback dead code, since ApiError extends Error.
// Each screen now says the step's own title, with api-failure.ts's line under
// it when there is one. The unit tests of that helper cannot see a screen that
// stops calling it, so this reads the call sites themselves.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFile(path.join(mobileRoot, ...file.split('/')), 'utf8');

const SCREENS = [
  'app/expenses.tsx',
  'app/expenses/item.tsx',
  'app/inventory.tsx',
  'app/inventory/bulk-add.tsx',
  'app/inventory/categories.tsx',
  'app/inventory/detail.tsx',
  'app/inventory/history.tsx',
  'app/inventory/item.tsx',
  'app/menu/categories.tsx',
  'app/menu/item.tsx',
  'app/reports.tsx',
  'app/settings/account.tsx',
  'app/settings/restaurant.tsx',
  'app/create-restaurant.tsx',
  'app/ai-assistant.tsx',
  'src/components/ai/confirm-card.tsx',
  'app/login.tsx',
  'app/register.tsx',
  'app/forgot-password.tsx',
];

// The screens that printed the message and now go through api-failure.ts.
const FIXED = [
  'app/expenses.tsx',
  'app/expenses/item.tsx',
  'app/inventory.tsx',
  'app/inventory/bulk-add.tsx',
  'app/inventory/categories.tsx',
  'app/inventory/detail.tsx',
  'app/inventory/history.tsx',
  'app/inventory/item.tsx',
  'app/menu/item.tsx',
  'app/reports.tsx',
  'app/settings/account.tsx',
  'app/settings/restaurant.tsx',
  'app/ai-assistant.tsx',
  'src/components/ai/confirm-card.tsx',
];

// Functions that turn a failure into the app's own words. Handing them the
// server's text to classify is the point of them; printing it is not.
const MAPPERS = [
  'authFailureToast',
  'restaurantSetupFailureCode',
  'restaurantSetupFailureToast',
  'categoryFailure',
  'categoryFailureCode',
  'apiFailureDetail',
  'apiFailureKind',
];

// An error's own message, however it is reached: err.message, err?.message,
// loadError.message, result.error.message, (err as Error).message, e.message,
// and String(err), which is the message behind "Error: ".
const ERROR_NAME = String.raw`(?:\w*(?:err|Err|error|Error)|e|ex|exception|reason|caught|cause)`;
const ERROR_MESSAGE = new RegExp(
  [
    String.raw`\b(?:${ERROR_NAME}|[A-Za-z_$][\w$]*\.error)\??\.message\b`,
    String.raw`\(\s*${ERROR_NAME}\s+as\s+[\w.<>]+\s*\)\??\.message\b`,
    String.raw`\bString\(\s*${ERROR_NAME}\s*\)`,
  ].join('|'),
  'g',
);

/** True when `index` on `line` sits inside the argument list of a mapper call. */
function insideMapperCall(line, index) {
  return MAPPERS.some((name) => {
    const call = new RegExp(`\\b${name}\\(`, 'g');
    let open = -1;
    for (const match of line.matchAll(call)) {
      if (match.index < index) open = match.index + match[0].length - 1;
    }
    if (open < 0) return false;
    let depth = 0;
    for (const char of line.slice(open, index)) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
    }
    return depth > 0;
  });
}

const isComment = (line) => /^\s*(?:\/\/|\/\*|\*)/.test(line);

// `const raw = err instanceof Error ? err.message : '';` is allowed only when
// every later use of `raw` is an argument to a mapper: classified, never shown.
const CLASSIFIED = /^\s*const (\w+) = (err|error) instanceof Error \? \2\.message : '';\s*$/;

function onlyClassified(lines, declaredAt, name) {
  const use = new RegExp(`\\b${name}\\b`, 'g');
  let used = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (index === declaredAt || isComment(lines[index])) continue;
    for (const match of lines[index].matchAll(use)) {
      used = true;
      if (!insideMapperCall(lines[index], match.index)) return false;
    }
  }
  return used;
}

/** Every line that reads an error's own message for anything but a mapper. */
function displayedErrorMessages(source) {
  const lines = source.split(/\r?\n/);
  const found = [];
  lines.forEach((line, index) => {
    if (isComment(line)) return;
    const classified = line.match(CLASSIFIED);
    if (classified && onlyClassified(lines, index, classified[1])) return;
    for (const match of line.matchAll(ERROR_MESSAGE)) {
      if (!insideMapperCall(line, match.index)) found.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return found;
}

test('the detector catches every way these screens used to print the server wording', () => {
  const printed = [
    "      setError(err instanceof Error ? err.message : copy('โหลดค่าใช้จ่ายไม่สำเร็จ', 'Could not load expenses.'));",
    "      Alert.alert(t('ลบไม่สำเร็จ', 'Could not delete'), err instanceof Error ? err.message : undefined);",
    '        ? err.message',
    "      setError(result.error instanceof Error ? result.error.message : copy('โหลดรายงานไม่สำเร็จ', 'Could not load reports.'));",
    "        text: error instanceof Error && error.message ? error.message : copy('ผู้ช่วยตอบไม่ได้ในขณะนี้', 'The assistant could not answer'),",
    "        failed.push(`${row.name}: ${err instanceof Error ? err.message : t('ไม่สำเร็จ', 'failed')}`);",
    "      .catch((err) => setError(err instanceof Error ? err.message : t('โหลดหมวดไม่สำเร็จ', 'Could not load categories.')));",
    // The same leak, reached the other ways a screen can reach it.
    "      setError(err?.message ?? t('ไม่สำเร็จ', 'Failed'));",
    "      setError((err as Error).message);",
    "      showToast({ title, message: (error as ApiError)?.message });",
    '      } catch (e) { setError(e.message); }',
    "      setError(loadError.message);",
    "      setError(String(err));",
    '      Alert.alert(title, String(error));',
  ];
  for (const line of printed) {
    assert.notDeepEqual(displayedErrorMessages(line), [], line);
  }
  // A message kept aside and then shown is still shown.
  const kept = "      const raw = err instanceof Error ? err.message : '';\n      setError(raw);";
  assert.notDeepEqual(displayedErrorMessages(kept), []);
});

test('the detector lets a mapper read the message', () => {
  const classified = [
    "      showToast({ tone: 'error', ...authFailureToast(err instanceof Error ? err.message : '', 'sign_in', language) });",
    "        ...authFailureToast(result.error instanceof Error ? result.error.message : '', 'register', language),",
    "      const raw = err instanceof Error ? err.message : '';\n      showProblems(restaurantSetupFailureCode(raw));\n      showToast({ tone: 'error', ...restaurantSetupFailureToast(raw, language, 'create') });",
    "    showToast({ tone: 'error', title: failure.title, message: failure.message });",
    '      // setError(err.message) was how the server wording reached the screen.',
    // A value that is not an error, and a classifier that answers yes or no.
    "      setNotice({ text: String(count) });",
    "      if (status === 410 && apiFailureSays(error, 'cancelled')) return line;",
  ];
  for (const source of classified) {
    assert.deepEqual(displayedErrorMessages(source), [], source);
  }
});

test('no screen in this group prints an error its own message', async () => {
  for (const file of SCREENS) {
    const source = await read(file);
    assert.deepEqual(displayedErrorMessages(source), [], `${file} shows the server's wording`);
  }
});

test('the screens that printed it now say the step and the shared line under it', async () => {
  for (const file of FIXED) {
    const source = await read(file);
    assert.match(source, /import \{[^}]*\bapiFailureDetail\b[^}]*\} from '@\/src\/lib\/api-failure';/, `${file} imports apiFailureDetail`);
    assert.match(source, /apiFailureDetail\((?:err|error|result\.error), language\)/, `${file} maps its failure in the current language`);
    // The fallback that repeated the title under itself is gone with the ternary.
    assert.doesNotMatch(source, /instanceof Error \?/, `${file} still branches on instanceof Error`);
  }
});

test('a load failure with nothing more to say shows its title alone', async () => {
  const panels = {
    'app/expenses.tsx': /<Feedback title=\{copy\('โหลดค่าใช้จ่ายไม่ได้', 'Could not load expenses'\)\} detail=\{error\.detail\}/,
    'app/inventory.tsx': /<Feedback title=\{t\('โหลดคลังไม่ได้', 'Could not load inventory'\)\} detail=\{error\.detail\}/,
    'app/inventory/detail.tsx': /<Feedback title=\{t\('โหลดข้อมูลไม่ได้', 'Could not load'\)\} detail=\{error\.detail\}/,
    'app/inventory/history.tsx': /<Feedback title=\{t\('โหลดประวัติไม่ได้', 'Could not load'\)\} detail=\{error\.detail\}/,
    'app/reports.tsx': /<Feedback title=\{copy\('โหลดรายงานไม่ได้', 'Could not load reports'\)\} detail=\{error\.detail\}/,
    'app/settings/restaurant.tsx': /<Feedback title=\{copy\('โหลดข้อมูลร้านไม่สำเร็จ', 'Could not load restaurant information'\)\} detail=\{error\.detail\}/,
  };
  for (const [file, panel] of Object.entries(panels)) {
    assert.match(await read(file), panel, file);
  }
  // Screens with several steps name the one that failed.
  for (const file of ['app/expenses/item.tsx', 'app/inventory/bulk-add.tsx', 'app/inventory/categories.tsx', 'app/inventory/item.tsx', 'app/menu/item.tsx']) {
    const source = await read(file);
    assert.match(source, /<Feedback title=\{error\.title\} detail=\{error\.detail\}/, file);
    assert.doesNotMatch(source, /detail=\{error\}/, file);
  }
});

test('a delete refused because the thing is still in use says so in the app words', async () => {
  // The ingredient and category deletes answer every refusal with 409 (the
  // ingredient delete a row another phone already deleted too), so the in-use
  // line goes by the refusal's own wording and never by the status.
  const recipe = ["used by a menu recipe", "t('ยังมีเมนูที่ใช้วัตถุดิบนี้', 'A menu recipe still uses it.')"];
  const inUse = {
    'app/inventory.tsx': recipe,
    'app/inventory/detail.tsx': recipe,
    'app/inventory/item.tsx': recipe,
    'app/inventory/categories.tsx': ['in use by ingredients', "t('ยังมีวัตถุดิบในหมวดนี้', 'Ingredients are still in it.')"],
  };
  for (const [file, [refusal, words]] of Object.entries(inUse)) {
    const source = await read(file);
    assert.ok(source.includes(`apiFailureSays(err, '${refusal}') ? ${words} : apiFailureDetail(err, language)`), file);
    assert.ok(!source.includes(`=== 409 ? ${words}`), `${file} still says "in use" for any 409`);
  }

  // The wording those lines go by is the backend's, on the 409 they share.
  const service = await readFile(path.join(mobileRoot, '..', 'backend', 'internal', 'service', 'ingredient_service.go'), 'utf8');
  assert.ok(service.includes('errors.New("ingredient is used by a menu recipe")'));
  assert.ok(service.includes('errors.New("category is in use by ingredients")'));
  assert.ok(service.includes('errors.New("ingredient not found")'));
  const controller = await readFile(path.join(mobileRoot, '..', 'backend', 'internal', 'controller', 'ingredient.go'), 'utf8');
  for (const call of ['ctrl.svc.Delete(restaurantID, ingredientID)', 'ctrl.svc.DeleteCategory(restaurantID, categoryID)']) {
    assert.match(controller, new RegExp(`${call.replace(/[.()]/g, '\\$&')}; err != nil \\{\\s*respondAPIError\\(c, http\\.StatusConflict, err\\)`), call);
  }
});

test('a taken ingredient category name is said under the field it was typed into', async () => {
  const categories = await read('app/inventory/categories.tsx');
  // A 409 "resource already exists" on rename and on add, each under its own row.
  assert.match(categories, /if \(apiFailureStatus\(err\) === 409\) setNameProblem\(\{ at: item\.ID, line: t\('มีหมวดชื่อนี้แล้ว', 'That name is taken\.'\) \}\);/);
  assert.match(categories, /if \(apiFailureStatus\(err\) === 409\) setNameProblem\(\{ at: 'draft', line: t\('มีหมวดชื่อนี้แล้ว', 'That name is taken\.'\) \}\);/);
  assert.match(categories, /<\/SwipeRow>\s*\{nameProblem\?\.at === item\.ID \? <NameProblem line=\{nameProblem\.line\} \/> : null\}/);
  assert.match(categories, /\{draft !== null && nameProblem\?\.at === 'draft' \? <NameProblem line=\{nameProblem\.line\} \/> : null\}/);
  // Not in the panel above the list any more.
  assert.doesNotMatch(categories, /detail: [^\n]*มีหมวดชื่อนี้แล้ว/);
  // Return submits and then blurs: both commit, and the second copy of the
  // same name came back as taken over a category that had just been added.
  assert.match(categories, /const commitDraft = async \(\) => \{\s*if \(addingRef\.current\) return;/);
  assert.match(categories, /\} finally \{\s*addingRef\.current = false;/);
  // Both name fields stop where the server does.
  assert.match(categories, /const NAME_MAX_LENGTH = 120;/);
  assert.equal(categories.split('maxLength={NAME_MAX_LENGTH}').length - 1, 2);
});

test('a stock unit a menu recipe still uses is said under the unit field', async () => {
  const item = await read('app/inventory/item.tsx');
  assert.match(
    item,
    /return apiFailureCode\(err\) === 'ingredient_unit_locked'\s*\|\| apiFailureSays\(err, 'cannot change stock units while ingredient is used by a menu recipe'\);/,
  );
  assert.match(item, /if \(unitLocked\(err\)\) setUnitProblem\(t\('ยังมีเมนูที่ใช้หน่วยนี้อยู่', 'A menu recipe still uses this unit\.'\)\);/);
  assert.match(
    item,
    /<FormPickRow label=\{t\('หน่วยสต็อก', 'Stock unit'\)\}[^\n]*\/>\s*\{unitProblem \? \(\s*<Text [^\n]*>\{unitProblem\}<\/Text>/,
  );
});

test('an expense the stock intake wrote is shown, with no save or delete the server refuses', async () => {
  const source = await read('app/expenses/item.tsx');
  // ensureExpenseEditable refuses both for an entry with an ingredient transaction.
  assert.match(source, /footer=\{!fromStock && !confirmDelete \? <SaveDock /);
  assert.match(source, /\{editing && !fromStock \? \(\s*<View style=\{\{ paddingTop: spacing\.sm \}\}>\s*<DangerAction/);
  assert.match(source, /async function save\(\) \{\s*if \(fromStock\) return;/);
  assert.match(source, /if \(!editing \|\| editingId === null \|\| fromStock\) return;/);
  // Its values as rows, not as chips and a field that would not save.
  assert.match(source, /\{fromStock \? \(\s*<FormCard>\s*<ActionRow first /);
  // Nothing promises it can be deleted, or changed in inventory.
  assert.doesNotMatch(source, /ของในคลังยังอยู่เท่าเดิม|the stock itself stays/);
  assert.doesNotMatch(source, /แก้ได้ที่คลังวัตถุดิบ|change it in inventory/);
  assert.doesNotMatch(source, /const title =\S/);
});

test('the account and restaurant settings toasts carry the shared line, not the server text', async () => {
  const account = await read('app/settings/account.tsx');
  assert.match(account, /const setError = \(detail\?: string\) => showToast\(/);
  assert.match(account, /setError\(apiFailureDetail\(err, language\)\);/);

  const restaurant = await read('app/settings/restaurant.tsx');
  assert.match(restaurant, /title: copy\('บันทึกร้านไม่สำเร็จ', 'Could not save restaurant information'\), message: apiFailureDetail\(err, language\)/);
  assert.match(restaurant, /title: copy\('ลบร้านไม่สำเร็จ', 'Could not delete the restaurant'\), message: apiFailureDetail\(err, language\)/);
});

/** A top-level `function name(...) {...}` of `source`, braces matched. */
function functionSource(source, head) {
  const start = source.indexOf(head);
  assert.ok(start >= 0, `${head} not found`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${head} never closes`);
}

/**
 * The plan helpers exactly as ai-assistant.tsx has them, run for real: the
 * screen cannot be imported here (React Native), so their source is lifted
 * into a module that imports the same helpers the screen does.
 */
async function loadPlanHelpers() {
  const screen = await read('app/ai-assistant.tsx');
  const lib = (file) => pathToFileURL(path.join(mobileRoot, 'src', 'lib', file)).href;
  const module = [
    `import { apiFailureSays, apiFailureStatus } from '${lib('api-failure.ts')}';`,
    `import { getAIActionErrorMessage } from '${lib('ai-action-preview.ts')}';`,
    functionSource(screen, 'function planConfirmRefusal('),
    functionSource(screen, 'function planItemReason('),
    functionSource(screen, 'function planOutcomeLine('),
    'export { planConfirmRefusal, planItemReason, planOutcomeLine };',
  ].join('\n\n');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dishy-plan-helpers-'));
  try {
    const file = path.join(dir, 'plan-helpers.ts');
    await writeFile(file, module, 'utf8');
    return await import(pathToFileURL(file).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const planError = (message, status) => Object.assign(new Error(message), {
  name: 'ApiError',
  status,
  details: JSON.stringify({ error: message, code: status === 409 ? 'conflict' : 'request_failed' }),
});

test('a plan refused mid-save says it is being saved, not to ask again', async () => {
  const { planConfirmRefusal } = await loadPlanHelpers();
  // ErrAIActionPlanInProgress: claimed, still running for up to two minutes.
  // "Ask for a new list" here could have the owner book the expense twice.
  const running = planError('AI action plan is already being executed', 409);
  assert.equal(planConfirmRefusal(running, 'th'), 'รายการนี้กำลังบันทึกอยู่');
  assert.equal(planConfirmRefusal(running, 'en'), 'This is already being saved.');
  // 410 is expired or cancelled; a cancelled plan does not read as expired.
  assert.equal(planConfirmRefusal(planError('AI action plan was cancelled', 410), 'th'), 'รายการนี้ถูกยกเลิกแล้ว ไม่มีการแก้ข้อมูล');
  assert.equal(planConfirmRefusal(planError('AI action plan was cancelled', 410), 'en'), 'This was cancelled, nothing changed.');
  assert.match(planConfirmRefusal(planError('AI action plan has expired', 410), 'th'), /หมดอายุ/);
  // Anything else is the shared confirm line, never the server's text.
  for (const failure of [planError('AI action plan confirmation token is invalid', 403), new TypeError('Network request failed')]) {
    const line = planConfirmRefusal(failure, 'en');
    assert.ok(line.length > 0 && !line.includes(failure.message), line);
  }
});

test('a plan\'s outcome is said on the phone from its counts, with why each item failed', async () => {
  const { planOutcomeLine } = await loadPlanHelpers();
  const server = 'SERVER COMPOSED';
  const outcome = (succeeded, failed, items, replayed = false) => ({ plan_id: 'p', status: 'x', replayed, message: server, succeeded, failed, items });
  const saved = { title: 'หมูสับ', succeeded: true };
  // item.error is aiActionFailureLine's: Thai the server wrote for the owner.
  const refused = { title: 'ไข่ไก่', succeeded: false, error: 'สต๊อกไม่พอสำหรับตัดออก' };
  const moved = { title: 'ตัดสต๊อก หมูสับ', succeeded: false, error: 'ข้อมูลเปลี่ยนไประหว่างรอยืนยัน: สต๊อก หมูสับ 10 → 8 ยังไม่ได้แก้ ขอให้สั่งใหม่อีกครั้ง' };
  // A reason the phone has no words for, a server older than that line, or
  // aiActionFailureFallback, which says nothing the head does not.
  const raw = { title: 'น้ำปลา', succeeded: false, error: 'insufficient stock for ingredient' };
  const vague = { title: 'น้ำตาล', succeeded: false, error: 'บันทึกไม่สำเร็จ' };
  const bare = { title: 'เกลือ', succeeded: false };

  assert.equal(planOutcomeLine(outcome(1, 0, [saved]), 'th'), 'บันทึกแล้ว');
  assert.equal(planOutcomeLine(outcome(3, 0, [saved, saved, saved]), 'th'), 'บันทึกแล้ว 3 รายการ');
  assert.equal(planOutcomeLine(outcome(1, 0, [saved], true), 'th'), 'บันทึกไว้แล้ว ไม่ได้ทำซ้ำ');

  // Partly saved: every failed item by name, with its reason when there is one.
  assert.equal(planOutcomeLine(outcome(1, 1, [saved, refused]), 'th'), 'บันทึกแล้ว 1 รายการ, ไม่สำเร็จ 1 รายการ\nไข่ไก่: สต๊อกไม่พอสำหรับตัดออก');
  assert.equal(planOutcomeLine(outcome(1, 1, [saved, refused]), 'en'), 'Saved 1, 1 failed.\nไข่ไก่: Not enough stock to take out');
  assert.equal(
    planOutcomeLine(outcome(1, 3, [saved, moved, raw, bare]), 'th'),
    `บันทึกแล้ว 1 รายการ, ไม่สำเร็จ 3 รายการ\nตัดสต๊อก หมูสับ: ${moved.error}\nน้ำปลา\nเกลือ`,
  );
  assert.equal(
    planOutcomeLine(outcome(1, 2, [saved, moved, vague]), 'en'),
    'Saved 1, 2 failed.\nตัดสต๊อก หมูสับ: Changed while waiting to be confirmed, ask again\nน้ำตาล',
  );
  // Nothing saved: the card already lists every item, so only a reason adds one.
  assert.equal(planOutcomeLine(outcome(0, 1, [refused]), 'th'), 'บันทึกไม่สำเร็จ ข้อมูลไม่ถูกเปลี่ยน\nไข่ไก่: สต๊อกไม่พอสำหรับตัดออก');
  assert.equal(planOutcomeLine(outcome(0, 1, [refused]), 'en'), 'Nothing was saved.\nไข่ไก่: Not enough stock to take out');
  assert.equal(planOutcomeLine(outcome(0, 2, [raw, bare]), 'th'), 'บันทึกไม่สำเร็จ ข้อมูลไม่ถูกเปลี่ยน');
  // Go sends a nil slice as null.
  assert.equal(planOutcomeLine(outcome(1, 1, null), 'th'), 'บันทึกแล้ว 1 รายการ, ไม่สำเร็จ 1 รายการ');
  assert.equal(planOutcomeLine(outcome(0, 1, null), 'th'), 'บันทึกไม่สำเร็จ ข้อมูลไม่ถูกเปลี่ยน');

  for (const language of ['th', 'en']) {
    const lines = [
      planOutcomeLine(outcome(0, 1, [refused]), language),
      planOutcomeLine(outcome(1, 1, [saved, refused]), language),
      planOutcomeLine(outcome(1, 3, [saved, moved, raw, vague]), language),
    ];
    for (const line of lines) {
      assert.ok(!line.includes(server), line);
      assert.ok(!line.includes(raw.error), line);
      assert.ok(!line.includes(' · '), line);
    }
  }
  // English never carries the server's Thai sentence, only the restaurant's own names.
  assert.ok(!planOutcomeLine(outcome(1, 1, [saved, refused]), 'en').includes(refused.error));
  assert.ok(!planOutcomeLine(outcome(1, 1, [saved, moved]), 'en').includes('ขอให้สั่งใหม่'));
});

test('every reason the backend gives a failed plan item has the phone\'s words', async () => {
  const { planItemReason } = await loadPlanHelpers();
  const service = path.join(mobileRoot, '..', 'backend', 'internal', 'service');
  const command = await readFile(path.join(service, 'ai_joyboy_command.go'), 'utf8');
  const plan = await readFile(path.join(service, 'ai_action_plan.go'), 'utf8');
  const named = new Map([...plan.matchAll(/(\w+)\s*=\s*errors\.New\("([^"]+)"\)/g)].map((m) => [m[1], m[2]]));
  const resolve = (name) => {
    assert.ok(named.has(name), `${name} is no longer an errors.New in ai_action_plan.go`);
    return named.get(name);
  };

  const table = command.slice(command.indexOf('var aiActionKnownFailures = map[string]string{'));
  const known = table.slice(0, table.indexOf('\n}'));
  const line = functionSource(command, 'func aiActionFailureLine(');
  const reasons = new Set([
    ...[...known.matchAll(/:\s*"([^"]+)",/g)].map((m) => m[1]),
    ...[...known.matchAll(/:\s*(\w+)\.Error\(\),/g)].map((m) => resolve(m[1])),
    ...[...line.matchAll(/(?:return|text ==) "([^"]+)"/g)].map((m) => m[1]),
    ...[...line.matchAll(/text == (\w+)\.Error\(\)/g)].map((m) => resolve(m[1])),
    resolve(/strings\.HasPrefix\(text, (\w+)\.Error\(\)\)/.exec(line)[1]),
  ]);
  assert.ok(reasons.size >= 15, `only ${reasons.size} reasons read from the backend`);

  const fallback = /const aiActionFailureFallback = "([^"]+)"/.exec(command)[1];
  assert.equal(planItemReason(fallback, 'th'), undefined);
  assert.equal(planItemReason(fallback, 'en'), undefined);
  reasons.delete(fallback);
  for (const reason of reasons) {
    assert.equal(planItemReason(reason, 'th'), reason, reason);
    const english = planItemReason(reason, 'en');
    assert.ok(english && !/[฀-๿]/.test(english), `${reason} has no English`);
  }

  // The two that carry a restaurant's own values.
  assert.match(line, /strings\.HasPrefix\(text, "มีเมนู “"\) && strings\.HasSuffix\(text, "” อยู่แล้ว"\)/);
  assert.equal(planItemReason('มีเมนู “ต้มยำกุ้ง” อยู่แล้ว', 'th'), 'มีเมนู “ต้มยำกุ้ง” อยู่แล้ว');
  assert.equal(planItemReason('มีเมนู “ต้มยำกุ้ง” อยู่แล้ว', 'en'), '“ต้มยำกุ้ง” is already on the menu');
  const changed = `${resolve('ErrAIActionChangedMeanwhile')}: ราคา ข้าวผัด 50 → 60 ยังไม่ได้แก้ ขอให้สั่งใหม่อีกครั้ง`;
  assert.equal(planItemReason(changed, 'th'), changed);
  assert.equal(planItemReason(changed, 'en'), 'Changed while waiting to be confirmed, ask again');
  // Anything else is not shown at all.
  for (const other of ['insufficient stock for ingredient', 'record not found', '', undefined]) {
    assert.equal(planItemReason(other, 'th'), undefined, String(other));
    assert.equal(planItemReason(other, 'en'), undefined, String(other));
  }
});

test('the AI confirm card prints only a line the phone built', async () => {
  const card = await read('src/components/ai/confirm-card.tsx');
  assert.match(card, /export class ConfirmRefusal extends Error \{/);
  assert.match(
    card,
    /setError\(err instanceof ConfirmRefusal \? err\.line : apiFailureDetail\(err, language\) \?\? \(th \? 'ยืนยันไม่สำเร็จ ลองอีกครั้ง' : 'Could not confirm, try again'\)\);/,
  );
  // The comment says what the card really draws: the plan text is the server's.
  assert.match(card, /The card does draw text the server composed: the plan itself/);

  const screen = await read('app/ai-assistant.tsx');
  const plan = screen.slice(screen.indexOf('const confirmPlan = useCallback('), screen.indexOf('const confirmPreview = useCallback('));
  const preview = screen.slice(screen.indexOf('const confirmPreview = useCallback('), screen.indexOf('const reissue = useCallback('));
  assert.ok(plan.length > 0 && preview.length > 0, 'both confirm callbacks exist');
  // A failed plan request is worded by the plan's own mapper: its 409 is not the preview's.
  assert.match(plan, /try \{\s*result = await confirmAIActionPlan\(plan\.id, plan\.confirmation_token\);\s*\} catch \(error\) \{\s*throw new ConfirmRefusal\(planConfirmRefusal\(error, language\)\);\s*\}/);
  assert.match(preview, /throw new ConfirmRefusal\(getAIActionErrorMessage\(error, language\)\);/);
  assert.doesNotMatch(plan + preview, /throw new Error\(/);
  // The outcome in the bubble and on the card is the phone's line, not result.message.
  assert.match(plan, /const line = planOutcomeLine\(result, language\);/);
  assert.match(plan, /outcome: \{ tone: result\.failed > 0 \? 'bad' : 'good', text: line \}/);
  assert.match(plan, /if \(result\.succeeded === 0 && result\.failed > 0\) throw new ConfirmRefusal\(line\);/);
  assert.doesNotMatch(plan, /result\.message/);
  // An item's error reaches the line only through planItemReason's fixed set.
  const outcomeLine = functionSource(screen, 'function planOutcomeLine(');
  assert.doesNotMatch(outcomeLine, /\.message\b/);
  assert.doesNotMatch(outcomeLine.replaceAll('planItemReason(item.error, language)', ''), /\.error\b/);
  assert.match(outcomeLine, /planItemReason\(item\.error, language\)/);
  // A question that fails says the shared line, or the step's own.
  assert.match(screen, /text: apiFailureDetail\(error, language\) \?\? copy\('ผู้ช่วยตอบไม่ได้ในขณะนี้', 'The assistant could not answer'\),/);
});

test('the screens that already mapped their failures still hand the error to the mapper', async () => {
  const login = await read('app/login.tsx');
  assert.match(login, /authFailureToast\(err instanceof Error \? err\.message : '', 'sign_in', language\)/);
  assert.match(login, /authFailureToast\(err instanceof Error \? err\.message : '', 'google', language\)/);
  assert.match(await read('app/register.tsx'), /authFailureToast\(result\.error instanceof Error \? result\.error\.message : '', 'register', language\)/);
  assert.match(await read('app/forgot-password.tsx'), /authFailureToast\(err instanceof Error \? err\.message : '', 'reset', language\)/);
  const create = await read('app/create-restaurant.tsx');
  assert.match(create, /restaurantSetupFailureCode\(raw\)/);
  assert.match(create, /restaurantSetupFailureToast\(raw, language, created \? 'open' : 'create'\)/);
  assert.match(await read('app/menu/categories.tsx'), /const failure = categoryFailure\(err, action, language\);/);
});

// Two phones on the same ingredient: A deletes it, then B taps delete. B used
// to get "ลบไม่สำเร็จ, ไม่พบรายการนี้แล้ว" and keep the row, or the open detail
// page, of something that no longer exists. What B asked for is done.
test('deleting an ingredient another phone already deleted finishes the delete', async () => {
  const list = (await read('app/inventory.tsx')).replace(/\r\n/g, '\n');
  assert.match(list, /try \{\s*await deleteIngredient\(item\.ID\);\s*removed\(\);\s*\} catch \(err\) \{[^]*?if \(apiFailureKind\(err\) === 'not_found'\) \{\s*removed\(\);\s*return;\s*\}/);
  assert.match(list, /const removed = \(\) => \{\s*LayoutAnimation\.configureNext\(LayoutAnimation\.Presets\.easeInEaseOut\);\s*setIngredients\(\(prev\) => prev\.filter\(\(row\) => row\.ID !== item\.ID\)\);/);
  const detail = (await read('app/inventory/detail.tsx')).replace(/\r\n/g, '\n');
  assert.match(detail, /try \{ await deleteIngredient\(item\.ID\); router\.back\(\); \}\s*catch \(err\) \{[^]*?if \(apiFailureKind\(err\) === 'not_found'\) \{ router\.back\(\); return; \}/);
});

// The server's menu margins group by menu id AND the name the dish was sold
// under, so a renamed dish is two rows with one id. The profit table keyed by
// the id alone and React reported a repeated key ".$12" (owner, 2026-09-25);
// the best-seller table beside it already used both.
test('the report tables key a menu row by its id and the name it was sold under', async () => {
  const reports = (await read('app/reports.tsx')).replace(/\r\n/g, '\n');
  assert.match(reports, /const profitRows: TableRow\[\] = margins\.map\(\(item\) => \(\{\n    key: `\$\{item\.menu_id\}-\$\{item\.menu_name\}`,/);
  assert.match(reports, /const topRows: TableRow\[\] = topItems\.map\(\(item, index\) => \(\{\n    key: `\$\{item\.menu_id\}-\$\{item\.menu_name\}`,/);
  assert.doesNotMatch(reports, /key: String\(item\.menu_id\)/);
});
