import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, View, type TextInput as NativeTextInput } from 'react-native';

import { AppTextInput } from '@/src/components/app-text-input';
import { scaleFont } from '@/src/lib/app-font';
import { CATEGORY_NAME_MAX } from '@/src/lib/category-order';
import { palette, spacing } from '@/src/theme';

// CategoryRow's name, authored at the same sizes it is: AppText and AppTextInput
// both scale these by the app-wide text scale, so equal authored values render
// equal. category-name-field.test.mjs compares them with the row's own style.
const NAME_FONT_SIZE = 16;
const NAME_LINE_HEIGHT = 22;
const NAME_FONT_WEIGHT = '600';

/** The height the name line takes in the row, after the app-wide text scale. */
const LINE = scaleFont(NAME_LINE_HEIGHT);

/**
 * Room above and below the line for the glyphs. Kanit's line is 1.5em, taller
 * than the 24pt line the row draws it in, and while editing iOS draws the text
 * inside a field editor that clips to the field's bounds - a field exactly one
 * line tall crops Thai tone marks. The input is this much taller at each edge
 * and absolutely placed, so the row still lays out one name line and does not
 * jump when the name turns into the field.
 */
const GLYPH_BLEED = 8;

const UNDERLINE_HEIGHT = 1.5;
/** Below the line box, clear of Thai vowels that hang under the baseline. */
const UNDERLINE_GAP = 2;

// Android paints the selection highlight in the selection colour itself, at
// full strength, which buries dark text under solid orange; iOS derives a pale
// highlight from the same tint. So Android gets the brand orange as a wash for
// the highlight, and the caret and handles are set back to the full colour.
const SELECTION_COLOR = Platform.OS === 'android' ? `${palette.primary}47` : palette.primary;

export type CategoryNameFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  /** The keyboard's done key. */
  onSubmit: () => void;
  /** Focus left without done: a tap elsewhere. */
  onCancel: () => void;
  /** A save is in flight: the text cannot change and a spinner closes the line. */
  busy?: boolean;
  accessibilityLabel: string;
  placeholder?: string;
};

/**
 * A category's name, editable in place. It sits in the row where the name was
 * and looks like it - same size, weight and line - with a thin orange line
 * under it as the only sign it is a field. There is no box and no save button:
 * done on the keyboard is the save, and leaving the field is the cancel.
 *
 * Done submits and then blurs (`blurAndSubmit`), so a save runs with the
 * keyboard down and a field that closes leaves nothing focused behind it. If
 * the page keeps the field - a name it refused before sending, a save that
 * failed - the field takes focus back, so the caret, the keyboard and "tap
 * elsewhere to cancel" all return with it. The page must answer inside
 * onSubmit, before any await: close the field, or set busy.
 */
export function CategoryNameField({
  value,
  onChangeText,
  onSubmit,
  onCancel,
  busy = false,
  accessibilityLabel,
  placeholder,
}: CategoryNameFieldProps) {
  const inputRef = useRef<NativeTextInput>(null);
  // The blur that follows done belongs to the submit, not to a tap elsewhere;
  // without this every save would also fire a cancel.
  const submittedRef = useRef(false);
  // Set by the blur that follows done, read after the commit that carries the
  // page's answer to it. The submit and blur events can reach JS in one batch,
  // before that commit, so the blur handler cannot decide on its own: its
  // `busy` may still be the value from before done was pressed.
  const answerPendingRef = useRef(false);
  const [submitBlurs, setSubmitBlurs] = useState(0);

  // Android's back key puts the keyboard away but leaves the field focused, so
  // the rename stayed open and the list stayed locked with nothing on screen to
  // say why. There, the keyboard going away while this still has focus is the
  // same as leaving the field: blur it, and handleBlur cancels (or, mid-save,
  // leaves it to the page). The keyboard that done dismisses is not this case:
  // done blurs first, so the field is no longer focused when it hides.
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      if (inputRef.current?.isFocused()) inputRef.current.blur();
    });
    return () => hidden.remove();
  }, []);

  useEffect(() => {
    // Unmounted: the page closed the field (saved, unchanged) and this never
    // runs. Busy: a save is in flight; this runs again when it settles.
    if (busy || !answerPendingRef.current) return;
    answerPendingRef.current = false;
    inputRef.current?.focus();
  }, [busy, submitBlurs]);

  const handleSubmit = () => {
    submittedRef.current = true;
    onSubmit();
  };

  const handleBlur = () => {
    if (submittedRef.current) {
      submittedRef.current = false;
      answerPendingRef.current = true;
      setSubmitBlurs((count) => count + 1);
      return;
    }
    // A save in flight is the page's to finish; losing focus does not undo it.
    if (busy) return;
    onCancel();
  };

  const handleFocus = () => {
    submittedRef.current = false;
    // Fabric on iOS applies selectTextOnFocus only inside the JS focus()
    // command (RCTTextInputComponentView `focus`), not when autoFocus or a tap
    // makes the field first responder - so the name would open with a bare
    // caret. Android selects on every focus by itself.
    if (Platform.OS === 'ios') inputRef.current?.setSelection(0, value.length);
  };

  return (
    <View style={{ minWidth: 0, height: LINE, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ minWidth: 0, flex: 1, height: LINE }}>
        <AppTextInput
          ref={inputRef}
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ busy, disabled: busy }}
          autoFocus
          cursorColor={palette.primary}
          // A landscape Android tablet otherwise swaps the row for the IME's own
          // full-screen editor, and the name leaves the list it is being edited in.
          disableFullscreenUI
          editable={!busy}
          keyboardAppearance="light"
          maxLength={CATEGORY_NAME_MAX}
          onBlur={handleBlur}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onSubmitEditing={handleSubmit}
          // The return key reads done and is the save. The Done bar's button
          // would dismiss without submitting, which here means cancel.
          omitKeyboardDoneBar
          placeholder={placeholder}
          placeholderTextColor={palette.placeholder}
          returnKeyType="done"
          selectTextOnFocus
          selectionColor={SELECTION_COLOR}
          selectionHandleColor={palette.primary}
          submitBehavior="blurAndSubmit"
          // Android's own EditText line would be a second underline under ours.
          underlineColorAndroid="transparent"
          style={{
            position: 'absolute',
            top: -GLYPH_BLEED,
            bottom: -GLYPH_BLEED,
            left: 0,
            right: 0,
            margin: 0,
            padding: 0,
            backgroundColor: 'transparent',
            color: palette.textStrong,
            fontSize: NAME_FONT_SIZE,
            fontWeight: NAME_FONT_WEIGHT,
            textAlignVertical: 'center',
          }}
          value={value}
        />
        <View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: -(UNDERLINE_GAP + UNDERLINE_HEIGHT),
            height: UNDERLINE_HEIGHT,
            backgroundColor: busy ? palette.border : palette.primary,
          }}
        />
      </View>
      {busy ? <ActivityIndicator color={palette.muted} size="small" /> : null}
    </View>
  );
}
