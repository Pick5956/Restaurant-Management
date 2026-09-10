import { StyleSheet } from 'react-native';

import { palette } from '@/src/lib/theme-palette';

export { palette };

// Compatibility alias for existing screens while they move onto the new shared shell.
export const colors = palette;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const breakpoints = {
  tablet: 768,
  tabletWorkspace: 900,
  expandedRail: 1240,
} as const;

export const radius = {
  sm: 4,
  // 12 to match `rounded-xl` on the web POS header, which is the reference for
  // how controls are shaped across both platforms.
  md: 12,
  full: 999,
} as const;

/**
 * The lift under an interactive control. Same shape as the web POS header —
 * two layers at zero offset, so it reads as a soft glow rather than a shadow
 * cast downward — but NOT the same values, and that difference is deliberate.
 *
 * The web draws `rgba(15,23,42,.04/.06)` (cool slate) over a `slate-100` page
 * with pale borders. Here the canvas is warm cream `#FFF7ED` and controls carry
 * a solid `#C77948` border. At those opacities the shadow lands within ~13/255
 * of the canvas while the border sits ~126/255 away from it: the border is an
 * order of magnitude louder and the shadow is simply not perceptible.
 *
 * So the colour is the warm dark this app already uses for shadows elsewhere,
 * and the opacity is lifted. At its darkest the wide layer now lands ~22/255
 * from the canvas: the web's value read ~12 and was invisible, ~33 read as
 * heavy. Tune here and nowhere else; a small y-offset is the next dial if more
 * lift is wanted without more weight.
 *
 * `boxShadow` needs React Native 0.76+; this app is on 0.86.
 */
export const controlShadow = {
  boxShadow:
    '0 0 2px rgba(61, 43, 31, 0.07), 0 0 16px rgba(61, 43, 31, 0.11)',
} as const;

// Line heights are sized for Thai, not Latin. Thai stacks tone marks above the
// consonant and sara below it, so a ratio that looks generous in English clips
// the marks here: React Native crops whatever falls outside the line box, and
// the loss is silent. 1.5-1.6x is the floor; anything tighter ate the tone mark
// on words like "น้ำมะนาวโซดา".
export const typeScale = StyleSheet.create({
  hero: {
    color: palette.textStrong,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  title: {
    color: palette.textStrong,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 28,
  },
  cardTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 23,
  },
  body: {
    color: palette.text,
    fontSize: 14,
    lineHeight: 22,
  },
  caption: {
    color: palette.text,
    fontSize: 13,
    lineHeight: 20,
  },
  number: {
    color: palette.textStrong,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
});

export const layout = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xxl,
    backgroundColor: palette.canvas,
  },
});

export function statusTone(tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral') {
  switch (tone) {
    case 'success':
      return { color: palette.success, backgroundColor: palette.successSoft, borderColor: '#A7F3D0' };
    case 'warning':
      return { color: palette.warning, backgroundColor: palette.warningSoft, borderColor: '#FDE68A' };
    case 'danger':
      return { color: palette.danger, backgroundColor: palette.dangerSoft, borderColor: '#FECACA' };
    case 'info':
      return { color: palette.info, backgroundColor: palette.infoSoft, borderColor: '#BAE6FD' };
    default:
      return { color: palette.neutral, backgroundColor: palette.neutralSoft, borderColor: palette.border };
  }
}
