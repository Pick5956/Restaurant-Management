import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Image, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { captureScreen, releaseCapture } from 'react-native-view-shot';

import { useReducedMotion } from '@/src/components/motion';

// Closing a page on Android slid out a blank white sheet (owner, 2026-09-26).
// react-native-screens keeps a leaving page's views alive for its exit
// animation by starting a view transition on them once it learns the screen is
// being removed - but it learns that from a callback posted to the UI thread,
// and on this RN the mount that deletes the page's content runs first. What is
// left to animate is the screen's empty background. iOS is unaffected: it
// animates a snapshot of the page.
//
// So on Android the close is played here instead, as the very same motion
// (owner: the old slide, at the old speed, only with the page still on it).
// react-native-screens' slide_from_right pop is the leaving page going
// 0 -> +100% (rns_slide_out_to_right) while the page underneath comes in from
// -100% -> 0 (rns_slide_in_from_left), side by side, over
// config_mediumAnimTime (400 ms) on Android's default accelerate-decelerate
// curve. The leaving page is a picture of itself; the page underneath is the
// real one, moved by `PopEnterLayer`. Both run on one animated value, so they
// cannot drift apart and open a gap.

const POP_MS = 400;
// AccelerateDecelerateInterpolator: (1 - cos(pi * t)) / 2.
const POP_EASING = Easing.inOut(Easing.sin);
// How long to wait for the picture to paint before closing anyway.
const READY_TIMEOUT_MS = 400;
// Pops that uncover the page underneath. A replace or a reset lands on a new
// page and keeps the navigator's own animation.
const POP_ACTIONS = new Set(['GO_BACK', 'POP', 'POP_TO', 'POP_TO_TOP']);

type Slide = {
  uri: string;
  onReady: () => void;
};

let slide: Slide | null = null;
const subscribers = new Set<() => void>();
const readSlide = () => slide;
function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
function setSlide(next: Slide | null) {
  slide = next;
  subscribers.forEach((listener) => listener());
}

// Where every page of the stack sits sideways: 0 at rest. A close parks it at
// minus one screen width and brings it back to 0. Every page stays bound to
// this one value the whole time; switching a page between an animated value
// and a plain 0 left it where the native driver last put it, one screen off
// to the left, and the app white.
const enterX = new Animated.Value(0);
let overlayMounted = false;
let reducedMotion = false;
// Routes whose removal this module has already let through, so the dispatch
// it makes itself does not land back in its own listener.
const passing = new Set<string>();

type RemoveEvent = { preventDefault: () => void; data: { action: { type: string } } };
type ScreenNavigation = {
  dispatch: (action: { type: string }) => void;
  setOptions: (options: { animation: 'none' }) => void;
};

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * `screenListeners` for the root Stack. The picture slide is Android only;
 * anywhere else, with reduced motion, or before the overlay is mounted it lets
 * the pop through untouched.
 */
export function popSlideListeners({ navigation, route }: { navigation: ScreenNavigation; route: { key: string } }) {
  return {
    beforeRemove: (event: RemoveEvent) => {
      if (Platform.OS !== 'android' || reducedMotion || !overlayMounted) return;
      if (!POP_ACTIONS.has(event.data.action.type)) return;
      if (passing.has(route.key)) {
        passing.delete(route.key);
        return;
      }
      // Back tapped again while a close is still playing: that one keeps the
      // navigator's own animation rather than photographing the picture.
      if (slide) return;
      event.preventDefault();
      const action = event.data.action;
      const pop = () => {
        passing.add(route.key);
        navigation.dispatch(action);
      };
      void (async () => {
        let uri: string;
        try {
          uri = await captureScreen({ format: 'jpg', quality: 0.9, result: 'tmpfile' });
        } catch {
          pop();
          return;
        }
        // The navigator must not play its own (contentless) close as well.
        navigation.setOptions({ animation: 'none' });
        // The picture mounts one screen to the right, off screen, and loads
        // there. Then one step of the shared value puts it over the page and
        // every page one screen to the left in the same frame: moving the pages
        // before the picture had painted showed three white frames.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, READY_TIMEOUT_MS);
          setSlide({ uri, onReady: () => { clearTimeout(timer); resolve(); } });
        });
        enterX.setValue(-Dimensions.get('window').width);
        await nextFrame();
        pop();
        // Two frames after the dispatch the close has been rendered and
        // committed: the page underneath is on screen, off to the left.
        await nextFrame();
        await nextFrame();
        await new Promise<void>((resolve) => {
          Animated.timing(enterX, { toValue: 0, duration: POP_MS, easing: POP_EASING, useNativeDriver: true }).start(() => resolve());
        });
        setSlide(null);
        releaseCapture(uri);
      })();
    },
  };
}

/**
 * Wraps every page of the root Stack on Android (`screenLayout`). While another
 * page closes over this one, it comes in from the left in step with the
 * picture going right.
 */
export function PopEnterLayer({ children }: { children: ReactNode }) {
  return (
    <Animated.View collapsable={false} style={{ flex: 1, transform: [{ translateX: enterX }] }}>
      {children}
    </Animated.View>
  );
}

/** The picture of the closing page, mounted once above the navigator. */
export function PopSlideOverlay() {
  const current = useSyncExternalStore(subscribe, readSlide, readSlide);
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();

  useEffect(() => { reducedMotion = reduced; }, [reduced]);
  useEffect(() => {
    overlayMounted = true;
    return () => { overlayMounted = false; };
  }, []);

  if (!current) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000, transform: [{ translateX: Animated.add(enterX, width) }] }]}
    >
      <Image fadeDuration={0} onLoad={current.onReady} source={{ uri: current.uri }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}
