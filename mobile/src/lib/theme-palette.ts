export const palette = {
  canvas: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceSubtle: '#FFF4E8',
  surfaceStrong: '#FFEDD5',
  border: '#FED7AA',
  // A hairline between rows of a list, where `border` is far too loud: that one
  // is a real orange and turns a plain list into a set of boxes. This is the
  // canvas warmth desaturated until it only separates.
  divider: '#EFE7DF',
  borderStrong: '#B96E3F',
  controlBorder: '#C77948',
  text: '#3F2A20',
  textStrong: '#21130C',
  muted: '#6B4636',
  placeholder: '#76503D',
  primary: '#C2410C',
  primaryText: '#FFFFFF',
  // The brand orange as TEXT on a pale tint of itself. `primary` is tuned to
  // carry white on top of it, and at that lightness it only reaches 4.43:1 as
  // ink on its own soft fill — just under AA. This is the same hue one step
  // down, which measures 5.34:1 there and is near-indistinguishable beside it.
  primaryInk: '#AC3A0B',
  // The pale wash of the brand orange used as a glass button's fill.
  primaryWash: 'rgba(253, 232, 217, 0.92)',
  accent: '#C2410C',
  accentSoft: '#FFF7ED',
  accentMuted: '#FED7AA',
  navigationSurface: '#9A3412',
  navigationActive: '#FFEDD5',
  navigationActiveText: '#7C2D12',
  navigationMuted: '#FED7AA',
  navigationBorder: '#7C2D12',
  // The phone dock alone. It is the iOS 26 tab bar rebuilt - dark translucent
  // glass, white glyphs, a paler glass capsule for the selection - and stopped
  // sharing the rail's burnt orange on 2026-09-10. The rail keeps the tokens above.
  //
  // `navigationDockSurface` is the fill where there is no material to blur
  // (every Android, iOS below 26): the tint composited over dark content, so
  // those devices land near what iOS 26 shows rather than on an unrelated colour.
  navigationDockSurface: '#1C1C1E',
  navigationDockIcon: '#FFFFFF',
  navigationDockIndicator: 'rgba(255, 255, 255, 0.22)',
  // 0.38, walked up from 0.12 and 0.22: the reference bar carries a visibly
  // lit edge, and the rim is a large part of what reads as gloss on a dark
  // surface. Asked for "a lot more" and this is the lit-edge half of it.
  navigationDockRim: 'rgba(255, 255, 255, 0.55)',
  // The top lip only. An edge light is never even all the way round - the face
  // turns over into the edge at the top and that is where it burns brightest.
  navigationDockRimLit: 'rgba(255, 255, 255, 0.85)',
  shadow: '#7C2D12',
  success: '#047857',
  successSoft: '#ECFDF5',
  warning: '#B45309',
  // One step deeper than the -50 tints these started on. On a cream canvas a
  // -50 tint is barely a tint at all: an occupied table read as off-white, and
  // the status had to be carried entirely by its text.
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  info: '#0369A1',
  infoSoft: '#E0F2FE',
  neutral: '#475569',
  neutralSoft: '#F1F5F9',
} as const;
