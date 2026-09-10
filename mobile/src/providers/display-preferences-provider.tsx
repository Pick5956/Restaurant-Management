import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  DEFAULT_DISPLAY_PREFERENCES,
  type DisplayLanguage,
  type DisplayPreferences,
} from '@/src/lib/display-preferences';
import {
  getDisplayPreferences,
  setDisplayPreferences,
} from '@/src/storage/display-preferences';

interface DisplayPreferencesContextValue extends DisplayPreferences {
  ready: boolean;
  persistenceStatus: 'loading' | 'saving' | 'saved' | 'memory-only';
  setLanguage: (language: DisplayLanguage) => void;
  setCompactTables: (compactTables: boolean) => void;
  copy: (thai: string, english: string) => string;
}

const DisplayPreferencesContext =
  createContext<DisplayPreferencesContextValue | null>(null);

export function DisplayPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preferences, setPreferences] = useState<DisplayPreferences>(
    DEFAULT_DISPLAY_PREFERENCES,
  );
  const [ready, setReady] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<
    DisplayPreferencesContextValue['persistenceStatus']
  >('loading');
  const saveSequence = useRef(0);

  useEffect(() => {
    let active = true;
    getDisplayPreferences()
      .then((stored) => {
        if (active) {
          setPreferences(stored);
          setPersistenceStatus('saved');
        }
      })
      .catch(() => {
        if (active) setPersistenceStatus('memory-only');
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((next: DisplayPreferences) => {
    const sequence = saveSequence.current + 1;
    saveSequence.current = sequence;
    setPreferences(next);
    setPersistenceStatus('saving');
    void setDisplayPreferences(next)
      .then(() => {
        if (saveSequence.current === sequence) setPersistenceStatus('saved');
      })
      .catch(() => {
        // The in-memory choice stays active even if device persistence is blocked.
        if (saveSequence.current === sequence) {
          setPersistenceStatus('memory-only');
        }
      });
  }, []);

  const setLanguage = useCallback(
    (language: DisplayLanguage) => {
      update({ ...preferences, language });
    },
    [preferences, update],
  );

  const setCompactTables = useCallback(
    (compactTables: boolean) => {
      update({ ...preferences, compactTables });
    },
    [preferences, update],
  );

  const value = useMemo<DisplayPreferencesContextValue>(
    () => ({
      ...preferences,
      ready,
      persistenceStatus,
      setLanguage,
      setCompactTables,
      copy: (thai, english) =>
        preferences.language === 'th' ? thai : english,
    }),
    [persistenceStatus, preferences, ready, setCompactTables, setLanguage],
  );

  return (
    <DisplayPreferencesContext.Provider value={value}>
      {children}
    </DisplayPreferencesContext.Provider>
  );
}

export function useDisplayPreferences() {
  const value = useContext(DisplayPreferencesContext);
  if (!value) {
    throw new Error(
      'useDisplayPreferences must be used inside DisplayPreferencesProvider',
    );
  }
  return value;
}
