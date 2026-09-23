import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useReducedMotion } from '@/src/components/motion';

// The hub is the root of the stack and never unmounts while pages are pushed
// over it. A loop that is not tied to focus keeps animating under the kitchen
// screen for the whole session. Every continuous animation in
// src/components/hub/ asks this hook whether it may run.

function isActive(state: AppStateStatus | null) {
  return state === null || state === 'active';
}

/**
 * True only while the caller wants the loop, the screen is focused, the app is
 * in the foreground and reduced motion is off. Start a loop when this turns
 * true and stop it in the cleanup when it turns false.
 */
export function useLoopGate(wanted: boolean): boolean {
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const [appActive, setAppActive] = useState(() => isActive(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(isActive(state)));
    return () => subscription.remove();
  }, []);

  return wanted && focused && appActive && !reduced;
}
