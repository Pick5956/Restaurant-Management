import type { TextStyle } from 'react-native';

/**
 * Every weight the app can render. Bold is the heaviest on purpose — see
 * resolveAppFontFamily — so ExtraBold is not listed and is not bundled: a face
 * nothing can select is 174 KB of download and one more file the app waits on
 * before it will draw anything.
 */
export const APP_FONT_FAMILIES = {
  regular: 'Kanit_400Regular',
  medium: 'Kanit_500Medium',
  semiBold: 'Kanit_600SemiBold',
  bold: 'Kanit_700Bold',
} as const;

/**
 * Every text size in the app is authored at its original value and multiplied
 * here, so the whole app is tuned from this one number instead of editing the
 * 170-odd hardcoded `fontSize` values spread across the screens.
 *
 * 1.08 was chosen because it lifts the 12-15 range the app lives in by exactly
 * 1pt, which is the gap against the delivery apps this is measured against.
 * Raise or lower this constant to retune; nothing else needs to change.
 */
export const APP_FONT_SCALE = 1.08;

/** Scale a text size or line height. Rounds to whole pixels so glyphs stay crisp. */
export function scaleFont(size: number): number {
  return Math.round(size * APP_FONT_SCALE);
}

const NAMED_FONT_WEIGHTS: Record<string, number> = {
  normal: 400,
  ultralight: 400,
  thin: 400,
  light: 400,
  regular: 400,
  condensed: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  condensedBold: 700,
  heavy: 800,
  black: 800,
};

export function resolveAppFontWeight(
  fontWeight?: TextStyle['fontWeight'],
  inheritedFontWeight: TextStyle['fontWeight'] = 'normal',
) {
  return fontWeight ?? inheritedFontWeight ?? 'normal';
}

export function resolveAppFontFamily(
  fontWeight?: TextStyle['fontWeight'],
) {
  const weightLabel = fontWeight === undefined ? 'normal' : String(fontWeight);
  const numericWeight =
    NAMED_FONT_WEIGHTS[weightLabel] ?? Number.parseInt(weightLabel, 10);

  // Bold is the ceiling. Nothing in this app renders heavier, whatever weight a
  // style asks for: ExtraBold was loud enough that a guest count in a form read
  // as the most important thing on the screen, and 17 call sites had reached for
  // it. Capping here holds for the styles written after this line too, which
  // editing those 17 by hand would not.
  if (numericWeight >= 700) return APP_FONT_FAMILIES.bold;
  if (numericWeight >= 600) return APP_FONT_FAMILIES.semiBold;
  if (numericWeight >= 500) return APP_FONT_FAMILIES.medium;
  return APP_FONT_FAMILIES.regular;
}
