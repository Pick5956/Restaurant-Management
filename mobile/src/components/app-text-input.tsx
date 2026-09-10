import { forwardRef, useEffect, useId, useState } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextStyle,
} from 'react-native';

import { KeyboardDoneBar } from '@/src/components/keyboard-done-bar';
import { resolveAppFontFamily, scaleFont } from '@/src/lib/app-font';

export const AppTextInput = forwardRef<
  NativeTextInput,
  TextInputProps & {
    /** Leave this field without a Done bar. Two reasons earn it, and neither is
     *  taste:
     *  - the field already rides on the keyboard, so a bar would slide in
     *    UNDERNEATH it — two stacked bars, with the useful one pushed further from
     *    the thumb. A composer pinned to the bottom of a KeyboardAvoidingView, not
     *    a form field on a screen that merely lifts.
     *  - the keyboard's own return key already dismisses and says so. A search
     *    field's key reads Search; a Done bar above it is the same action twice. */
    omitKeyboardDoneBar?: boolean;
  }
>(
  function AppTextInput({ style, inputAccessoryViewID, omitKeyboardDoneBar, ...props }, ref) {
    const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
    // Mirrors AppText: typed text has to scale with the labels around it, or a
    // field would read a size smaller than everything else on the screen.
    const fontSize = scaleFont(
      typeof flattened?.fontSize === 'number' ? flattened.fontSize : 14,
    );
    const lineHeight =
      typeof flattened?.lineHeight === 'number'
        ? scaleFont(flattened.lineHeight)
        : undefined;

    // Every field in the app comes through here, so this is the one place a Done
    // bar has to be wired to reach all of them. A multiline field has no return
    // key to dismiss with - Return inserts a newline - and on the rest it is the
    // same affordance every other iOS app has above the keyboard.
    //
    // The id is per instance and must stay that way: `useId` is what stops two
    // screens sharing a value, which is the difference between the bar working
    // and silently never appearing again. KeyboardDoneBar carries the why.
    // Stripped to alphanumerics because React's ids are wrapped in guillemets.
    const generatedId = useId().replace(/[^A-Za-z0-9]/g, '');
    const accessoryId = inputAccessoryViewID ?? `dishy-done-${generatedId}`;
    // The bar has to mount a commit AFTER the field. RCTInputAccessoryComponentView
    // resolves `nativeID` exactly once, in `didMoveToWindow`, by walking the window
    // for a text input carrying it - and stores nil forever if it finds none. In
    // the same commit the field may not be mounted yet; an effect cannot run until
    // the commit that mounted it is done.
    const [barMounted, setBarMounted] = useState(false);
    useEffect(() => {
      setBarMounted(true);
    }, []);
    const ownsBar = Platform.OS === 'ios' && inputAccessoryViewID === undefined && !omitKeyboardDoneBar;

    return (
      <>
        <NativeTextInput
          {...props}
          inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
          ref={ref}
          style={[
            { includeFontPadding: false },
            style,
            {
              fontFamily: resolveAppFontFamily(flattened?.fontWeight),
              fontWeight: 'normal',
              fontSize,
              lineHeight,
            },
          ]}
        />
        {/* Laid out absolutely by InputAccessoryView itself, so it takes no space
            in whatever row or stack this field sits in. */}
        {ownsBar && barMounted ? <KeyboardDoneBar nativeID={accessoryId} /> : null}
      </>
    );
  },
);
