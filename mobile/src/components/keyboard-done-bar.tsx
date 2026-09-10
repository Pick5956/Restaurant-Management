import { BlurView } from 'expo-blur';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';

/**
 * UIKit's own numbers for the bar above the keyboard, not ours.
 *
 * iOS has no Done bar to ask for above a text keyboard. `inputAccessoryView` is
 * nil by default, and `RCTTextInputComponentView.setDefaultInputAccessoryView`
 * has to build a `UIToolbar` itself — only ever for the four number-pad keyboard
 * types. Everything over a text keyboard is drawn by the app.
 *
 * `blurTint` is the part that cannot be faked with a colour: `UIToolbar` is
 * backed by `UIBlurEffectStyleSystemChromeMaterial`, and expo-blur's
 * `systemChromeMaterialLight` maps to exactly that
 * (`expo-blur/ios/TintStyle.swift`). `blurIntensity` 100 drives the animator's
 * `fractionComplete` to 1, which is the material at full strength rather than a
 * fraction of it — anything less is a dimmer approximation, not the same thing.
 *
 * The material rounds its own corners, and that is correct rather than something
 * to crop away: on iOS 26 the keyboard under it is rounded too. An app only gets
 * the square keyboard by having been linked against an older SDK, which is not a
 * thing a running app decides — and inside Expo Go it is that binary's call.
 *
 * These deliberately ignore the app's palette and type scale. Keyboard chrome
 * belongs to the platform, and a Kanit label in brand orange is exactly what gave
 * the first attempt away.
 */
const SYSTEM_BAR = {
  height: 44,
  blurTint: 'systemChromeMaterialLight',
  blurIntensity: 100,
  hairline: 'rgba(0, 0, 0, 0.3)',
  tint: '#007AFF',
  fontSize: 17,
  gutter: 16,
  // The keyboard under this bar is rounded at the top on iOS 26, and the bar is a
  // rectangle, so each bottom corner leaves a small wedge where neither is drawing
  // and the page shows through. These squares hang below the bar to fill it, in
  // the bar's own material rather than a colour picked to match — the material
  // samples the same backdrop, so they cannot drift apart.
  //
  // Corners only. A full-width strip would do the same job and then also cover the
  // top of the suggestion row, which sits inside these two.
  //
  // Sized past any radius UIKit is likely to use: too large only squares the
  // corner off, which is the shape the bar has anyway. Too small leaves a sliver.
  cornerFill: 22,
} as const;

/**
 * The Done bar over the keyboard, for one text field.
 *
 * `nativeID` MUST be unique per field instance, and that is not a style
 * preference — it is the fix for a React Native recycling bug. Fabric's
 * `RCTViewComponentView.prepareForRecycle` resets the event emitter, layout
 * metrics and subviews but never `_props`, while
 * `RCTTextInputComponentView.prepareForRecycle` explicitly nils the backing
 * field's `inputAccessoryViewID`. When the recycled view is reused, `updateProps`
 * only writes that property back `if (new != old)` — so a value shared between
 * screens compares equal, the write is skipped, and the field is left carrying no
 * id at all. The bar's one-shot `didMoveToWindow` lookup then finds nothing and
 * gives up for good: it works on the first screen and is silently missing on
 * every screen after. A per-instance id can never compare equal, so the write
 * always happens.
 *
 * Must also be mounted a commit AFTER the field it names — see AppTextInput.
 */
export function KeyboardDoneBar({ nativeID }: { nativeID: string }) {
  const { copy } = useDisplayPreferences();
  // InputAccessoryView warns and renders nothing off iOS, and Android dismisses
  // the keyboard with its own back gesture.
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={nativeID} style={{ height: SYSTEM_BAR.height }}>
      {/* The corner fills are siblings of the bar's material, not children of it:
          `ExpoBlurView` sets `clipsToBounds = true` on itself, so anything inside
          the bar is cut off at its edge. Neither RCTInputAccessoryComponentView
          nor its content view clips, which is what lets them hang below this box. */}
      <View style={{ height: SYSTEM_BAR.height }}>
        {/* No backgroundColor: a colour here would sit under the material and tint
            it, and the whole point is the untinted system one. */}
        <BlurView
          intensity={SYSTEM_BAR.blurIntensity}
          tint={SYSTEM_BAR.blurTint}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: SYSTEM_BAR.hairline,
          }}
        />
        {(['left', 'right'] as const).map((side) => (
          <BlurView
            intensity={SYSTEM_BAR.blurIntensity}
            key={side}
            tint={SYSTEM_BAR.blurTint}
            style={{
              position: 'absolute',
              top: SYSTEM_BAR.height,
              [side]: 0,
              width: SYSTEM_BAR.cornerFill,
              height: SYSTEM_BAR.cornerFill,
              pointerEvents: 'none',
            }}
          />
        ))}
        <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
          <Pressable
            accessibilityLabel={copy('ปิดแป้นพิมพ์', 'Dismiss keyboard')}
            accessibilityRole="button"
            onPress={() => Keyboard.dismiss()}
            style={({ pressed }) => ({
              height: SYSTEM_BAR.height,
              justifyContent: 'center',
              paddingHorizontal: SYSTEM_BAR.gutter,
              opacity: pressed ? 0.3 : 1,
            })}
          >
            {/* Not AppText: this one must be in the system font at the system
                size, like every other Done button on the device. */}
            <Text style={{ color: SYSTEM_BAR.tint, fontSize: SYSTEM_BAR.fontSize, fontWeight: '600' }}>
              {copy('เสร็จสิ้น', 'Done')}
            </Text>
          </Pressable>
        </View>
      </View>
    </InputAccessoryView>
  );
}
