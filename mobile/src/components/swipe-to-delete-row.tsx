import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { useReducedMotion } from '@/src/components/motion';
import {
  CURRENT_ROUND_REVEAL_WIDTH,
  clampCurrentRoundRowOffset,
  lockCurrentRoundRowSwipeAxis,
  resolveCurrentRoundRowDragOffset,
  resolveCurrentRoundRowInteraction,
  resolveCurrentRoundRowRelease,
  type CurrentRoundRowSwipeAxis,
} from '@/src/lib/order-detail-runtime';
import { palette } from '@/src/theme';

/**
 * A list row that slides left under the thumb to uncover a delete button on the
 * right. Lifted out of the retired current-round screen on 2026-09-11 so the
 * order summary could keep the gesture; the geometry helpers still carry the
 * `currentRound` prefix because they are the same numbers, measured once.
 *
 * `onEdit` is optional. On the summary only an unsent line can be opened for
 * editing - everything else is already on the kitchen's board - so a row
 * without it is a plain surface that closes the rail when tapped.
 */
export function SwipeToDeleteRow({
  itemId,
  open,
  disabled,
  locked,
  editLabel,
  editHint,
  deleteLabel,
  deleteAccessibilityLabel,
  onOpen,
  onClose,
  onEdit,
  onDelete,
  onSwipeStart,
  onSwipeEnd,
  children,
}: {
  itemId: number;
  open: boolean;
  disabled: boolean;
  /** No gesture and no rail, but the row still reads as an ordinary row. Not
   *  `disabled`, which also fades it: a line the kitchen already has is not
   *  unavailable, it is simply not removed by a swipe. */
  locked?: boolean;
  editLabel: string;
  editHint: string;
  deleteLabel: string;
  deleteAccessibilityLabel: string;
  onOpen: () => void;
  onClose: () => void;
  /** Omit on a row that cannot be edited. */
  onEdit?: () => void;
  onDelete: () => void;
  onSwipeStart: (itemId: number) => void;
  onSwipeEnd: (itemId: number) => void;
  children: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const translateX = useRef(new Animated.Value(open ? -CURRENT_ROUND_REVEAL_WIDTH : 0)).current;
  const offsetRef = useRef(open ? -CURRENT_ROUND_REVEAL_WIDTH : 0);
  const gestureStartRef = useRef(offsetRef.current);
  const activationDxRef = useRef(0);
  const axisRef = useRef<CurrentRoundRowSwipeAxis>('undecided');
  const didDragRef = useRef(false);
  const responderActiveRef = useRef(false);
  const settleAnimatingRef = useRef(false);
  const settleTargetRef = useRef<number | null>(offsetRef.current);
  const latestRef = useRef({
    open,
    disabled,
    locked,
    onOpen,
    onClose,
    onSwipeStart,
    onSwipeEnd,
  });
  latestRef.current = { open, disabled, locked, onOpen, onClose, onSwipeStart, onSwipeEnd };

  useEffect(() => {
    const listenerId = translateX.addListener(({ value }) => {
      offsetRef.current = clampCurrentRoundRowOffset(value);
    });
    return () => translateX.removeListener(listenerId);
  }, [translateX]);

  const settle = useCallback((nextOpen: boolean) => {
    const target = nextOpen ? -CURRENT_ROUND_REVEAL_WIDTH : 0;
    if (settleAnimatingRef.current && settleTargetRef.current === target) return;

    settleTargetRef.current = target;
    translateX.stopAnimation((value) => {
      const current = clampCurrentRoundRowOffset(value);
      offsetRef.current = current;
      if (reducedMotion || Math.abs(current - target) < 0.5) {
        settleAnimatingRef.current = false;
        offsetRef.current = target;
        translateX.setValue(target);
        return;
      }

      settleAnimatingRef.current = true;
      Animated.timing(translateX, {
        toValue: target,
        duration: 160,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && settleTargetRef.current === target) {
          settleAnimatingRef.current = false;
          offsetRef.current = target;
        }
      });
    });
  }, [reducedMotion, translateX]);

  useEffect(() => settle(open), [open, settle]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => {
      axisRef.current = 'undecided';
      activationDxRef.current = 0;
      didDragRef.current = false;
      return false;
    },
    onMoveShouldSetPanResponder: (_, gesture) => {
      const previousAxis = axisRef.current;
      const nextAxis = lockCurrentRoundRowSwipeAxis(previousAxis, {
        deltaX: gesture.dx,
        deltaY: gesture.dy,
      }, latestRef.current.open, latestRef.current.disabled || Boolean(latestRef.current.locked));
      axisRef.current = nextAxis;
      if (previousAxis !== 'horizontal' && nextAxis === 'horizontal') {
        activationDxRef.current = gesture.dx;
      }
      return nextAxis === 'horizontal';
    },
    onPanResponderGrant: () => {
      responderActiveRef.current = true;
      didDragRef.current = true;
      settleAnimatingRef.current = false;
      settleTargetRef.current = null;
      latestRef.current.onSwipeStart(itemId);
      translateX.stopAnimation((value) => {
        const current = clampCurrentRoundRowOffset(value);
        gestureStartRef.current = current;
        const activated = clampCurrentRoundRowOffset(current + activationDxRef.current);
        offsetRef.current = activated;
        translateX.setValue(activated);
      });
    },
    onPanResponderMove: (_, gesture) => {
      const nextOffset = resolveCurrentRoundRowDragOffset({
        startOffset: gestureStartRef.current,
        activationDeltaX: activationDxRef.current,
        responderDeltaX: gesture.dx,
      });
      offsetRef.current = nextOffset;
      translateX.setValue(nextOffset);
    },
    onPanResponderRelease: (_, gesture) => {
      responderActiveRef.current = false;
      latestRef.current.onSwipeEnd(itemId);
      const settlement = resolveCurrentRoundRowRelease({
        offset: offsetRef.current,
        velocityX: gesture.vx * 1000,
      });
      if (settlement === 'open') latestRef.current.onOpen();
      else latestRef.current.onClose();
      settle(settlement === 'open');
    },
    onPanResponderTerminate: () => {
      responderActiveRef.current = false;
      latestRef.current.onSwipeEnd(itemId);
      settle(latestRef.current.open);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [itemId, settle, translateX]);

  const handlePress = () => {
    const interaction = resolveCurrentRoundRowInteraction({
      wasHorizontalDrag: didDragRef.current,
      isOpen: open,
    });
    if (interaction === 'close') onClose();
    if (interaction === 'edit' && onEdit) onEdit();
  };

  return (
    <View style={{ overflow: 'hidden', backgroundColor: palette.danger }}>
      {locked ? null : (
      <View
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? 'yes' : 'no-hide-descendants'}
        pointerEvents={open ? 'auto' : 'none'}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: CURRENT_ROUND_REVEAL_WIDTH }}
      >
        <Pressable
          accessibilityLabel={deleteAccessibilityLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onDelete}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.danger,
            opacity: disabled ? 0.5 : pressed ? 0.78 : 1,
          })}
        >
          <Text style={{ color: palette.primaryText, fontSize: 15, lineHeight: 20, fontWeight: '700' }}>{deleteLabel}</Text>
        </Pressable>
      </View>
      )}
      <Animated.View
        {...responder.panHandlers}
        style={{ backgroundColor: palette.surface, transform: [{ translateX }] }}
      >
        <Pressable
          accessibilityActions={locked ? [] : onEdit ? [
            { name: 'activate', label: editLabel },
            { name: 'delete', label: deleteAccessibilityLabel },
          ] : [
            { name: 'delete', label: deleteAccessibilityLabel },
          ]}
          accessibilityHint={editHint}
          accessibilityLabel={editLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onAccessibilityAction={(event) => {
            if (disabled) return;
            if (event.nativeEvent.actionName === 'activate' && onEdit) onEdit();
            if (event.nativeEvent.actionName === 'delete') onDelete();
          }}
          onPress={handlePress}
          onPressIn={() => {
            if (!responderActiveRef.current) didDragRef.current = false;
          }}
          style={({ pressed }) => ({
            backgroundColor: pressed && !open ? palette.surfaceSubtle : palette.surface,
            opacity: disabled ? 0.55 : 1,
          })}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}
