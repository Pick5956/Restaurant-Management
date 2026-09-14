import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassPanel, LIQUID_GLASS } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, spacing } from '@/src/theme';

// The app's toast: a glass capsule that drops from the top edge, says what just
// happened, and leaves on its own. The owner picked this look on 14 ก.ย. 2569
// (design "B") over a white card and a solid colour bar: the same material as
// the dock, so the two floating things on the screen read as one family.
//
// What stays from the web's toast (frontend/src/components/shared/FeedbackProvider.tsx):
// 3.6 s on screen, at most four stacked, the card neutral and only the title
// taking the hue on an error.
//
// What differs, and why:
//   - It sits at the TOP. The app's bottom edge belongs to the tab dock and the
//     action docks above it, so a toast there lands on the button that raised it.
//   - It can carry one action ("ดึงกลับ"). Marking a kitchen round done is the
//     commonest tap in the kitchen and the easiest to get wrong; the undo belongs
//     next to the message that says it happened, not in a sheet two taps away.
//   - It has no close button. Tap it or flick it up. The capsule is 48 pt tall;
//     a 28 pt × beside an action pill left the text too little room.
//   - Errors stay longer (6 s) and may wrap to two lines: an error is read, a
//     success is glanced at.
//   - It moves, it never fades. The first build faded the capsule in by
//     animating its parent's opacity, and on iOS 26 the glass never appeared:
//     the text floated over the page with nothing behind it (reported 14 ก.ย.).
//     A glass view mounted under a fading parent loses its material — the
//     settings sheet learned the same thing. So it slides down from above the
//     screen and back up, at full opacity the whole way.
//   - No drop shadow under real glass. A shadow sits behind the layer and shows
//     through translucent material as a dark band (the dock's notes, app-shell).
//     The opaque stand-in keeps one, since it has no material to separate it.
//
// Messages that describe a STATE — the live feed dropping, a view-only
// account, a page that failed to load — are not toasts. They must stay on
// screen for as long as they are true, so the screens keep those inline.

type ToastTone = 'success' | 'error' | 'warning' | 'info';

export type ToastAction = {
  label: string;
  onPress: () => void;
};

export type ToastInput = {
  title: string;
  message?: string;
  tone?: ToastTone;
  duration?: number;
  action?: ToastAction;
};

type Toast = ToastInput & { id: number; tone: ToastTone; leaving: boolean };

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 4;
const DEFAULT_DURATION = 3600;
const ERROR_DURATION = 6000;
const ACTION_DURATION = 5000;
const CAPSULE_RADIUS = 24;
// The card edge the rest of the app uses. Only painted where there is no glass
// (Android, iOS below 26) — real glass draws its own rim.
const CAPSULE_EDGE = '#E4D8CD';

const toneIcon: Record<ToastTone, AppIconName> = {
  success: 'checkmark',
  error: 'alert',
  warning: 'warning',
  info: 'information',
};

const toneColor: Record<ToastTone, string> = {
  success: palette.success,
  error: palette.danger,
  warning: palette.warning,
  info: palette.info,
};

function durationFor(input: ToastInput, tone: ToastTone) {
  if (input.duration) return input.duration;
  if (tone === 'error') return ERROR_DURATION;
  if (input.action) return ACTION_DURATION;
  return DEFAULT_DURATION;
}

function ToastCard({ toast, offscreen, onGone, onHold, onRelease, onRequestDismiss }: {
  toast: Toast;
  /** How far up the capsule starts and leaves to: clear of the status bar. */
  offscreen: number;
  /** Called once the exit animation has finished. */
  onGone: () => void;
  /** A finger is on the toast: stop its clock. */
  onHold: () => void;
  onRelease: () => void;
  onRequestDismiss: () => void;
}) {
  const { copy } = useDisplayPreferences();
  const reducedMotion = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const urgent = toast.tone === 'error' || toast.tone === 'warning';

  useEffect(() => {
    if (reducedMotion) {
      enter.setValue(1);
    } else {
      Animated.spring(enter, { toValue: 1, damping: 20, stiffness: 240, mass: 0.8, useNativeDriver: true }).start();
    }
    // liveRegion is Android's; VoiceOver needs the announcement spelled out.
    AccessibilityInfo.announceForAccessibility(toast.message ? `${toast.title}. ${toast.message}` : toast.title);
  }, [enter, reducedMotion, toast.message, toast.title]);

  useEffect(() => {
    if (!toast.leaving) return;
    Animated.timing(enter, {
      toValue: 0,
      duration: reducedMotion ? 0 : 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished) onGone(); });
  }, [enter, onGone, reducedMotion, toast.leaving]);

  // Flick it up to put it away. Dragging down only gives a little, the way a
  // notification banner resists being pulled the wrong way.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => onHold(),
    onPanResponderMove: (_, g) => drag.setValue(g.dy < 0 ? g.dy : g.dy * 0.2),
    onPanResponderRelease: (_, g) => {
      if (g.dy < -24 || g.vy < -0.4) {
        onRequestDismiss();
        return;
      }
      Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
      onRelease();
    },
    onPanResponderTerminate: () => {
      Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      onRelease();
    },
  }), [drag, onHold, onRelease, onRequestDismiss]);

  const color = toneColor[toast.tone];

  return (
    <Animated.View
      {...pan.panHandlers}
      accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
      style={{
        width: '100%',
        maxWidth: 520,
        transform: [
          { translateY: Animated.add(enter.interpolate({ inputRange: [0, 1], outputRange: [-offscreen, 0] }), drag) },
          { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
        ],
        borderRadius: CAPSULE_RADIUS,
        ...(LIQUID_GLASS ? {} : {
          shadowColor: '#21130C',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.16,
          shadowRadius: 22,
          elevation: 10,
        }),
      }}
    >
      <GlassPanel
        radius={CAPSULE_RADIUS}
        // Frosted: the owner asked for it cloudier (14 ก.ย.) after 0.5 read too
        // clear — a red ticket header showed straight through behind the text.
        // Still the regular glass underneath, so the edge keeps its refraction.
        tint="rgba(255,255,255,0.8)"
        fallback="#FFFFFF"
        fallbackBorder={CAPSULE_EDGE}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 7, paddingLeft: 8, paddingRight: toast.action ? 8 : 16 }}>
          <Pressable
            accessibilityRole={urgent ? 'alert' : 'text'}
            accessibilityHint={copy('แตะเพื่อปิด', 'Tap to dismiss')}
            onPress={onRequestDismiss}
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color }}>
              <AppIcon name={toneIcon[toast.tone]} size={19} color="#FFFFFF" />
            </View>
            <Text
              numberOfLines={urgent ? 2 : 1}
              style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '700', color: toast.tone === 'error' ? palette.danger : palette.textStrong }}
            >
              {toast.title}
              {toast.message ? (
                <Text style={{ fontWeight: '500', color: palette.muted }}>{` · ${toast.message}`}</Text>
              ) : null}
            </Text>
          </Pressable>
          {toast.action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              hitSlop={6}
              onPress={() => {
                toast.action?.onPress();
                onRequestDismiss();
              }}
              style={({ pressed }) => ({
                paddingVertical: 7,
                paddingHorizontal: 13,
                borderRadius: 999,
                backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
                borderWidth: 1,
                borderColor: palette.border,
              })}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: palette.primaryInk }}>{toast.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      </GlassPanel>
    </Animated.View>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const durationsRef = useRef(new Map<number, number>());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  /** Start the exit animation; the card removes itself when it has played. */
  const dismissToast = useCallback((id: number) => {
    clearTimer(id);
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
  }, [clearTimer]);

  const removeToast = useCallback((id: number) => {
    clearTimer(id);
    durationsRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, [clearTimer]);

  const startTimer = useCallback((id: number, duration: number) => {
    clearTimer(id);
    timersRef.current.set(id, setTimeout(() => dismissToast(id), duration));
  }, [clearTimer, dismissToast]);

  const showToast = useCallback((input: ToastInput) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    const tone = input.tone ?? 'success';
    const toast: Toast = { ...input, id, tone, leaving: false };
    const duration = durationFor(input, tone);
    setToasts((current) => {
      const next = [...current, toast];
      // Anything trimmed here never gets dismissed by its own timer, so clear
      // it now instead of leaving a callback pointing at a vanished toast.
      next.slice(0, Math.max(0, next.length - MAX_VISIBLE)).forEach((dropped) => {
        clearTimer(dropped.id);
        durationsRef.current.delete(dropped.id);
      });
      return next.slice(-MAX_VISIBLE);
    });
    durationsRef.current.set(id, duration);
    startTimer(id, duration);
  }, [clearTimer, startTimer]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {toasts.length ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: insets.top + spacing.lg,
              left: 0,
              right: 0,
              alignItems: 'center',
              gap: spacing.sm,
              paddingHorizontal: spacing.lg,
            }}
          >
            {/* Newest nearest the edge it entered from. */}
            {[...toasts].reverse().map((toast) => (
              <ToastCard
                key={toast.id}
                toast={toast}
                offscreen={insets.top + spacing.lg + 72}
                onGone={() => removeToast(toast.id)}
                onHold={() => clearTimer(toast.id)}
                onRelease={() => startTimer(toast.id, Math.min(2000, durationsRef.current.get(toast.id) ?? DEFAULT_DURATION))}
                onRequestDismiss={() => dismissToast(toast.id)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return value;
}
