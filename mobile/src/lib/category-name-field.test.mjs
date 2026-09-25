import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Guards on the inline category name field (the categories page's rename and
// add). It is a React Native component and cannot render under node, so these
// read its source and fail when a line that carries a rule is reverted: the
// field opening without its name selected (Fabric iOS ignores
// selectTextOnFocus on autoFocus), a save that also fires a cancel through the
// blur that follows done, a box drawn around what should read as the row's
// own name, a busy field that still takes typing.

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFile(path.join(mobileRoot, relative), 'utf8');
const FIELD = 'src/components/menu-categories/category-name-field.tsx';
const ROW = 'src/components/menu-categories/category-row.tsx';

/** The source without comments, so a note about a rule never passes for, or fails, the rule itself. */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** From `open` (an index at a `{`) to its matching `}`, inclusive. */
function balanced(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`unbalanced braces from ${open}`);
}

/** The body of `const name = (...) => { ... }`. */
function handler(source, name) {
  const match = new RegExp(`const ${name} = \\([^)]*\\) => \\{`).exec(source);
  assert.ok(match, `${name} is declared as an arrow function`);
  return balanced(source, match.index + match[0].length - 1);
}

/** The props text of the first `<Tag ...>` or `<Tag .../>`. */
function jsxOpen(source, tag) {
  const start = source.indexOf(`<${tag}`);
  assert.ok(start >= 0, `<${tag}> is rendered`);
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (char === '>' && depth === 0 && source[index - 1] !== '=') return source.slice(start, index + 1);
  }
  throw new Error(`<${tag}> never closes`);
}

function numberConst(source, name) {
  const match = new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`).exec(source);
  assert.ok(match, `${name} is a literal constant`);
  return Number(match[1]);
}

/**
 * CategoryRow's name style: the style on the Text that renders `{name}`,
 * either inline or through a named constant.
 */
function rowNameStyle(rowSource) {
  const source = code(rowSource);
  const nameAt = source.search(/>\s*\{name\}\s*</);
  assert.ok(nameAt > 0, 'CategoryRow still renders {name} in a Text');
  const textAt = Math.max(source.lastIndexOf('<Text', nameAt), source.lastIndexOf('<AppText', nameAt));
  let style = source.slice(textAt, nameAt);
  const named = /style=\{([A-Za-z_$][\w$]*)\}/.exec(style);
  if (named) {
    const declared = new RegExp(`\\b${named[1]}\\b[^=]*=\\s*\\{`).exec(source);
    assert.ok(declared, `the name style ${named[1]} is declared in the row`);
    style = balanced(source, declared.index + declared[0].length - 1);
  }
  const pick = (key, pattern) => {
    const match = new RegExp(`${key}:\\s*${pattern}`).exec(style);
    assert.ok(match, `the row's name style sets ${key} as a literal`);
    return match[1];
  };
  return {
    fontSize: Number(pick('fontSize', '(\\d+)')),
    lineHeight: Number(pick('lineHeight', '(\\d+)')),
    fontWeight: pick('fontWeight', "'(\\d{3})'"),
  };
}

test('the helpers find handlers, tags and the row style, not the rest of the file', () => {
  const source = [
    'const handleSubmit = () => {',
    '  if (a) { b(); }',
    '  onSubmit();',
    '};',
    'const other = 1;',
    '<Input value={x > 1 ? a : b} style={{ top: 0 }} />',
  ].join('\n');
  assert.equal(handler(source, 'handleSubmit'), '{\n  if (a) { b(); }\n  onSubmit();\n}');
  assert.equal(jsxOpen(source, 'Input'), '<Input value={x > 1 ? a : b} style={{ top: 0 }} />');
  assert.deepEqual(
    rowNameStyle("<Text numberOfLines={1} style={{ fontSize: 16, lineHeight: 22, fontWeight: '600' }}>\n{name}\n</Text>"),
    { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  );
  assert.deepEqual(
    rowNameStyle("const NAME = { fontSize: 15, lineHeight: 21, fontWeight: '500' };\n<AppText style={NAME}>{name}</AppText>"),
    { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  );
  assert.equal(code("a(); // border: 1\n/* borderWidth */ b();"), 'a(); \n b();');
});

// ---------------------------------------------------------------- looks like the name

test('the field is set in the row name\'s own type, through the app\'s text input', async () => {
  const field = code(await read(FIELD));
  const row = rowNameStyle(await read(ROW));
  assert.equal(numberConst(field, 'NAME_FONT_SIZE'), row.fontSize, 'font size differs from the row name');
  assert.equal(numberConst(field, 'NAME_LINE_HEIGHT'), row.lineHeight, 'line height differs from the row name');
  assert.match(field, new RegExp(`const NAME_FONT_WEIGHT = '${row.fontWeight}';`), 'weight differs from the row name');

  // AppTextInput scales size and maps weight to the Kanit face exactly as
  // AppText does for the name; React Native's own TextInput would draw the
  // system font at the unscaled size.
  assert.match(field, /import \{ AppTextInput \} from '@\/src\/components\/app-text-input';/);
  assert.equal(/import \{[^}]*(?<!type )\bTextInput\b[^}]*\} from 'react-native'/.test(field), false, 'the raw TextInput is imported as a value');
  const input = jsxOpen(field, 'AppTextInput');
  assert.match(input, /fontSize: NAME_FONT_SIZE,/);
  assert.match(input, /fontWeight: NAME_FONT_WEIGHT,/);
  assert.match(input, /color: palette\.textStrong,/);
});

test('the row does not jump: the field takes one name line, the glyphs bleed past it', async () => {
  const field = code(await read(FIELD));
  assert.match(field, /const LINE = scaleFont\(NAME_LINE_HEIGHT\);/);
  // Every box the field lays out is the name line's height; the input itself
  // hangs past it on both edges without adding to it.
  assert.match(field, /<View style=\{\{ minWidth: 0, height: LINE, flexDirection: 'row'/);
  assert.match(field, /<View style=\{\{ minWidth: 0, flex: 1, height: LINE \}\}>/);
  const input = jsxOpen(field, 'AppTextInput');
  assert.match(input, /position: 'absolute',\s+top: -GLYPH_BLEED,\s+bottom: -GLYPH_BLEED,/);
  assert.ok(numberConst(field, 'GLYPH_BLEED') > 0);
  assert.match(input, /padding: 0,/);
  assert.equal(/\blineHeight\b/.test(input), false, 'a line height on the input moves its baseline off the row name');
});

test('no border box: one thin orange line under the name, and nothing else drawn', async () => {
  const field = code(await read(FIELD));
  assert.equal(/\bborder[A-Za-z]*(Width|Color|Style)\b/.test(field), false, 'the field draws a border');
  assert.equal(/\bborderRadius\b/.test(field), false, 'the field rounds a box');
  assert.equal(/\bcontrolShadow\b|\bboxShadow\b|\bshadow[A-Z]/.test(field), false, 'the field lifts off the row like a form control');
  const input = jsxOpen(field, 'AppTextInput');
  assert.match(input, /backgroundColor: 'transparent',/);
  // Android's EditText draws its own line unless told not to.
  assert.match(input, /underlineColorAndroid="transparent"/);

  const underline = field.slice(field.indexOf('bottom: -(UNDERLINE_GAP + UNDERLINE_HEIGHT)') - 200);
  assert.match(underline, /height: UNDERLINE_HEIGHT,\s+backgroundColor: busy \? palette\.border : palette\.primary,/);
  assert.ok(numberConst(field, 'UNDERLINE_HEIGHT') <= 2, 'the underline is thin');
});

test('the field says nothing of its own', async () => {
  const source = await read(FIELD);
  const field = code(source);
  assert.equal(/<(App)?Text\b/.test(field), false, 'the field renders its own text');
  assert.equal(/\bcopy\(/.test(field), false, 'the field carries its own copy');
  assert.equal(source.includes(' · '), false);
  assert.equal(source.includes('<Modal'), false);
});

// ---------------------------------------------------------------- opens ready to type

test('the field opens focused with the name selected, on iOS as well as Android', async () => {
  const field = code(await read(FIELD));
  const input = jsxOpen(field, 'AppTextInput');
  assert.match(input, /\n\s+autoFocus\n/);
  assert.match(input, /\n\s+selectTextOnFocus\n/);
  assert.match(input, /onFocus=\{handleFocus\}/);
  // Fabric's iOS text input applies selectTextOnFocus only inside the JS focus()
  // command, never on autoFocus, so the name is selected by hand there.
  assert.match(handler(field, 'handleFocus'), /if \(Platform\.OS === 'ios'\) inputRef\.current\?\.setSelection\(0, value\.length\);/);
  assert.match(input, /ref=\{inputRef\}/);
});

test('done is the save: the return key submits, and no Done bar offers a second way out', async () => {
  const field = code(await read(FIELD));
  const input = jsxOpen(field, 'AppTextInput');
  assert.match(input, /returnKeyType="done"/);
  assert.match(input, /submitBehavior="blurAndSubmit"/);
  assert.match(input, /onSubmitEditing=\{handleSubmit\}/);
  // The Done bar's button blurs without submitting, which here is a cancel.
  assert.match(input, /\n\s+omitKeyboardDoneBar\n/);
  assert.match(input, /maxLength=\{CATEGORY_NAME_MAX\}/);
});

// ---------------------------------------------------------------- submit, blur, cancel

test('the blur that follows done never cancels the save it follows', async () => {
  const field = code(await read(FIELD));
  const submit = handler(field, 'handleSubmit');
  assert.match(submit, /submittedRef\.current = true;\s+onSubmit\(\);/, 'the flag is set before the page hears the submit');

  const blur = handler(field, 'handleBlur');
  const guardAt = blur.indexOf('if (submittedRef.current) {');
  const cancelAt = blur.indexOf('onCancel()');
  assert.ok(guardAt >= 0, 'the blur checks for a submit first');
  assert.ok(cancelAt > guardAt, 'onCancel runs only past the submit guard');
  const guard = balanced(blur, guardAt + 'if (submittedRef.current) '.length);
  assert.match(guard, /submittedRef\.current = false;/, 'the guard is spent by the one blur it covers');
  assert.match(guard, /return;/);
  assert.equal(guard.includes('onCancel'), false);
  // Only a tap elsewhere cancels: nothing else in the file calls it.
  assert.equal(field.match(/\bonCancel\(\)/g)?.length, 1);
  // A new focus starts a fresh edit, so a submit whose blur never came cannot
  // swallow the next real cancel.
  assert.match(handler(field, 'handleFocus'), /submittedRef\.current = false;/);
});

test('a name the page keeps takes focus back once its answer has rendered', async () => {
  const field = code(await read(FIELD));
  const blur = handler(field, 'handleBlur');
  // The submit and its blur can reach JS in one batch, before the page's answer
  // commits, so the blur only records it; an effect decides afterwards.
  assert.equal(/\.focus\(\)/.test(blur), false, 'the blur refocuses before the page has answered');
  assert.match(blur, /answerPendingRef\.current = true;\s+setSubmitBlurs\(/);
  assert.match(field, /useEffect\(\(\) => \{\s+if \(busy \|\| !answerPendingRef\.current\) return;\s+answerPendingRef\.current = false;\s+inputRef\.current\?\.focus\(\);\s+\}, \[busy, submitBlurs\]\);/);
});

// ---------------------------------------------------------------- busy

test('a busy field takes no typing, shows a spinner, and a blur does not undo the save', async () => {
  const field = code(await read(FIELD));
  const input = jsxOpen(field, 'AppTextInput');
  assert.match(input, /editable=\{!busy\}/);
  assert.match(input, /accessibilityState=\{\{ busy, disabled: busy \}\}/);
  assert.match(field, /\{busy \? <ActivityIndicator color=\{palette\.muted\} size="small" \/> : null\}/);
  assert.match(field, /busy = false,/);
  const blur = handler(field, 'handleBlur');
  assert.ok(blur.indexOf('if (busy) return;') >= 0 && blur.indexOf('if (busy) return;') < blur.indexOf('onCancel()'));
});

// ---------------------------------------------------------------- the count under the field

test('while the name is a field, the count moves clear of its orange line and the name stays put', async () => {
  const field = code(await read(FIELD));
  const row = code(await read(ROW));
  const underlineBottom = numberConst(field, 'UNDERLINE_GAP') + numberConst(field, 'UNDERLINE_HEIGHT');
  const gap = /justifyContent: 'center', gap: (\d+(?:\.\d+)?) \}/.exec(row);
  assert.ok(gap, 'the name and the count sit in one column with a fixed gap');
  const drop = numberConst(row, 'SLOT_DETAIL_DROP');
  assert.ok(Number(gap[1]) + drop >= underlineBottom, 'the underline runs into the count while a name is renamed');
  // A translate moves the count alone; a margin would re-centre the column and move the name too.
  assert.match(row, /transform: hasSlot \? \[\{ translateY: SLOT_DETAIL_DROP \}\] : undefined,/);
});

test('on Android the back key that hides the keyboard also leaves the field, so the rename cannot stay stranded', async () => {
  const field = await read(FIELD);
  assert.match(field, /if \(Platform\.OS !== 'android'\) return undefined;/);
  assert.match(field, /Keyboard\.addListener\('keyboardDidHide', \(\) => \{\s*if \(inputRef\.current\?\.isFocused\(\)\) inputRef\.current\.blur\(\);/);
  assert.match(field, /return \(\) => hidden\.remove\(\);/);
});
