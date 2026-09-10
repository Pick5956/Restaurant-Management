export type DisplayLanguage = 'th' | 'en';

export interface DisplayPreferences {
  language: DisplayLanguage;
  /** Whether the table map draws its dense tiles. Remembered because the choice
   *  is about the reader's eyesight and their screen, not about the shift they
   *  happen to be on — re-picking it after every app start is a chore. */
  compactTables: boolean;
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  language: 'th',
  compactTables: false,
};

const LANGUAGE_VALUES = new Set<DisplayLanguage>(['th', 'en']);

export function normalizeDisplayPreferences(value: unknown): DisplayPreferences {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_DISPLAY_PREFERENCES };
  }

  const candidate = value as Partial<DisplayPreferences>;
  return {
    language: LANGUAGE_VALUES.has(candidate.language as DisplayLanguage)
      ? (candidate.language as DisplayLanguage)
      : DEFAULT_DISPLAY_PREFERENCES.language,
    // Anything that is not a real boolean means a store written before this
    // field existed, which is the default, not a broken read.
    compactTables: typeof candidate.compactTables === 'boolean'
      ? candidate.compactTables
      : DEFAULT_DISPLAY_PREFERENCES.compactTables,
  };
}
