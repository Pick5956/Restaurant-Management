import { useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';

import { useReducedMotion } from '@/src/components/motion';

// The table tile's press: it shrinks a touch under the finger and springs back.
// Moved here from the hub's old layout A when that layout was deleted
// (2026-09-24); table management was its only other user.

const PRESS_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const PRESS_NATIVE_DRIVER = Platform.OS !== 'web';

export function usePressScale(to: number) {
  const reduced = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;
  const animate = (target: 0 | 1) => {
    press.stopAnimation();
    if (reduced) {
      press.setValue(target);
      return;
    }
    Animated.timing(press, { toValue: target, duration: 120, easing: PRESS_EASE, useNativeDriver: PRESS_NATIVE_DRIVER }).start();
  };
  return {
    scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, reduced ? 1 : to] }),
    pressIn: () => animate(1),
    pressOut: () => animate(0),
  };
}
