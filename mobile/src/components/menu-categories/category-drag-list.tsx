import * as Haptics from 'expo-haptics';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppScreenScrollControl } from '@/src/components/app-shell';
import { CategoryRow, CategoryRowFrame, LIFTED_ROW_RADIUS } from '@/src/components/menu-categories/category-row';
import { useReducedMotion } from '@/src/components/motion';
import { SwipeToDeleteRow } from '@/src/components/swipe-to-delete-row';
import {
  autoScrollStep,
  categoryDishLabel,
  clampScrollOffset,
  dragBounds,
  dragTargetIndex,
  moveCategory,
  moveCategoryBy,
  rowShift,
  slotOffset,
} from '@/src/lib/category-order';
import { palette, radius, spacing } from '@/src/theme';
import type { Category } from '@/src/types/menu';

// The category list, reordered by holding a row and dragging it.
//
// No gesture library: a row is a Pressable, and holding it (onLongPress) lifts
// it. From then on the LIST's PanResponder claims the next move in the capture
// phase - the Pressable gives the touch up, it is cancelable by default - and
// refuses to hand it back. The screen switches page scrolling and the stack's
// back swipe off for as long as a row is lifted (onLiftChange), because iOS
// scrolls natively and would ignore the JS responder altogether. The switch is
// a render away from the lift, so it can land in the middle of a page pan or a
// bounce and freeze the page past its end; AppScreen springs it back into range
// when scrolling is switched on again.
//
// Only the list-level responder, granted after a lift, blocks the native
// scroll view. A per-row responder granted on touch start would kill page
// scrolling for every touch that happens to begin on a row (Android).
//
// Each row also slides left to uncover a delete rail: the bill's
// SwipeToDeleteRow, wrapped around it. The two gestures never meet. The swipe
// claims a move in the bubble phase once it reads as horizontal and leftward;
// that ends the row's press, and the long-press timer with it, so a swipe
// cannot lift. After a lift the list claims every move in the capture phase,
// above the swipe, which is then never asked - so a lift cannot open a rail.
// The page holds which rail is open; one opening closes the other.
//
// A row being renamed drops the swipe wrapper altogether. Its Pressable is an
// accessibility element, and on iOS an element hides everything inside it: the
// name field would be out of VoiceOver's reach.

const LIFT_SCALE = 1.02;
const LONG_PRESS_MS = 280;
const SHIFT_MS = 150;
const SETTLE_MS = 170;
const ROW_FALLBACK_HEIGHT = 60;
/** AppScreen pads its content by this under the last child. */
const PAGE_BOTTOM_PADDING = spacing.xxxl;

const LIFTED_CARD: ViewStyle = {
  zIndex: 10,
  elevation: 6,
  borderRadius: LIFTED_ROW_RADIUS,
  borderCurve: 'continuous',
  backgroundColor: palette.surface,
  shadowColor: palette.textStrong,
  shadowOpacity: 0.16,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
};

function hapticSelect() {
  void Haptics.selectionAsync().catch(() => undefined);
}

const noop = () => {};

type DragSession = {
  id: number;
  from: number;
  target: number;
  /** The order at lift time: the screen holds reloads until the drop. */
  ordered: Category[];
  heights: number[];
  bounds: { min: number; max: number };
  liftPageY: number;
  fingerY: number;
  scrollStart: number;
  scroll: number;
  scrollMax: number;
  /** The list's responder took the touch: the Pressable's press-out that follows is not a drop. */
  granted: boolean;
  dropping: boolean;
};

export type CategoryDragListProps = {
  /** In the server's order. */
  categories: readonly Category[];
  /** Dishes per category; null while unknown, and then no count is shown. */
  counts: ReadonlyMap<number, number> | null;
  /** A bordered box (tablet) instead of rows flush to the phone's edges. */
  framed: boolean;
  /**
   * A save is running: no lift, no rename, no swipe, no move. The row whose
   * rail is out stays open, dimmed, while its delete runs.
   */
  disabled: boolean;
  /** The whole list in its new order. */
  onReorder: (ordered: Category[]) => void;
  onLiftChange: (lifted: boolean) => void;
  scrollControlRef?: MutableRefObject<AppScreenScrollControl | null>;
  copy: (thai: string, english: string) => string;
  language: 'th' | 'en';
  /** A tap on an idle row. */
  onRename: (category: Category) => void;
  /** The open rail's ลบ, or a screen reader's delete. */
  onDelete: (category: Category) => void;
  /** The one row whose delete rail is out. */
  openRailId: number | null;
  /** A swipe opened a rail, or a swipe or a tap put it away. */
  onRailChange: (id: number | null) => void;
  /** The row being renamed: it draws renderEditor in place of its name, and cannot swipe or lift. */
  editingId: number | null;
  renderEditor: (category: Category) => ReactNode;
  /** Above the first row, inside the same frame, never dragged: the row a new category is typed into. */
  header?: ReactNode;
  /**
   * Renaming or adding: nothing swipes or lifts, and a tap on another row only
   * puts the keyboard away - which, the field losing focus without done, is
   * its cancel.
   */
  locked: boolean;
};

export function CategoryDragList({
  categories,
  counts,
  framed,
  disabled,
  onReorder,
  onLiftChange,
  scrollControlRef,
  copy,
  language,
  onRename,
  onDelete,
  openRailId,
  onRailChange,
  editingId,
  renderEditor,
  header,
  locked,
}: CategoryDragListProps) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [liftedId, setLiftedId] = useState<number | null>(null);
  const drag = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const shifts = useRef(new Map<number, Animated.Value>()).current;
  const heights = useRef(new Map<number, number>()).current;
  const listRef = useRef<View>(null);
  const session = useRef<DragSession | null>(null);
  const pendingReset = useRef(false);
  const frame = useRef<number | null>(null);
  /** Whether a rail was out when the current row press began: see `press`. */
  const railOutAtPressIn = useRef(false);
  const env = useRef({
    categories, disabled, locked, editingId, openRailId, onRailChange, onReorder, onLiftChange, reducedMotion, insets, windowHeight, scrollControlRef, copy,
  });
  env.current = {
    categories, disabled, locked, editingId, openRailId, onRailChange, onReorder, onLiftChange, reducedMotion, insets, windowHeight, scrollControlRef, copy,
  };

  const drive = useMemo(() => {
    const shiftFor = (id: number) => {
      let value = shifts.get(id);
      if (!value) {
        value = new Animated.Value(0);
        shifts.set(id, value);
      }
      return value;
    };

    const resetAll = () => {
      drag.stopAnimation();
      drag.setValue(0);
      scale.stopAnimation();
      scale.setValue(1);
      shifts.forEach((value) => {
        value.stopAnimation();
        value.setValue(0);
      });
    };

    const announce = (name: string, place: number) => {
      AccessibilityInfo.announceForAccessibility(env.current.copy(`ย้าย ${name} ไปลำดับ ${place}`, `Moved ${name} to ${place}`));
    };

    /** Puts the lifted row under the finger and moves the others out of its way. */
    const follow = () => {
      const current = session.current;
      if (!current || current.dropping) return;
      const raw = current.fingerY - current.liftPageY + (current.scroll - current.scrollStart);
      const offset = Math.min(Math.max(raw, current.bounds.min), current.bounds.max);
      drag.setValue(offset);
      const target = dragTargetIndex({ fromIndex: current.from, offsetY: offset, heights: current.heights });
      if (target === current.target) return;
      current.target = target;
      hapticSelect();
      const liftedHeight = current.heights[current.from];
      current.ordered.forEach((category, index) => {
        if (index === current.from) return;
        const value = shiftFor(category.ID);
        const toValue = rowShift(index, current.from, target, liftedHeight);
        if (env.current.reducedMotion) {
          value.stopAnimation();
          value.setValue(toValue);
          return;
        }
        Animated.timing(value, { toValue, duration: SHIFT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
      });
    };

    /** One frame of scrolling while the finger sits near the top or bottom edge. */
    const tick = () => {
      frame.current = null;
      const current = session.current;
      const control = env.current.scrollControlRef?.current;
      if (!current || current.dropping || !current.granted || !control) return;
      const { insets: edges, windowHeight: height } = env.current;
      // The band starts under the compact header while it is up: a row dragged
      // toward the top would otherwise slide beneath the bar before the page
      // began to move.
      const top = edges.top + (control.getTopCover?.() ?? 0);
      const step = autoScrollStep(current.fingerY, top, height - edges.bottom);
      if (step === 0) return;
      const next = clampScrollOffset(current.scroll + step, 0, current.scrollMax);
      if (next === current.scroll) return;
      current.scroll = next;
      control.scrollTo(next, false);
      follow();
      frame.current = requestAnimationFrame(tick);
    };

    const startAutoScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(tick);
    };

    const lift = (category: Category, index: number, pageY: number) => {
      // Nothing lifts while a name is open, the row being renamed least of all.
      if (env.current.disabled || env.current.locked || env.current.editingId !== null || session.current) return;
      const ordered = [...env.current.categories];
      if (ordered[index]?.ID !== category.ID) return;
      const rowHeights = ordered.map((item) => heights.get(item.ID) ?? ROW_FALLBACK_HEIGHT);
      const control = env.current.scrollControlRef?.current;
      const scrollStart = control?.getOffset() ?? 0;
      // Where the page can really rest. A lift during a bounce starts from an
      // offset iOS will not keep, and that is not a bound to scroll up to.
      const restingMax = control?.getMaxOffset?.() ?? Number.POSITIVE_INFINITY;
      const scrollFloor = Math.min(scrollStart, restingMax);
      session.current = {
        id: category.ID,
        from: index,
        target: index,
        ordered,
        heights: rowHeights,
        bounds: dragBounds(index, rowHeights),
        liftPageY: pageY,
        fingerY: pageY,
        scrollStart,
        scroll: scrollStart,
        scrollMax: scrollFloor,
        granted: false,
        dropping: false,
      };
      resetAll();
      setLiftedId(category.ID);
      env.current.onLiftChange(true);
      // A rail left out would ride along with the rows the lifted one moves between.
      if (env.current.openRailId !== null) env.current.onRailChange(null);
      hapticSelect();
      if (env.current.reducedMotion) scale.setValue(LIFT_SCALE);
      else Animated.spring(scale, { toValue: LIFT_SCALE, damping: 18, stiffness: 320, mass: 0.8, useNativeDriver: false }).start();
      // How far autoscroll may go: until the list's end (and the page padding
      // under it) reaches the bottom of the screen. AppScreen's scrollTo only
      // clamps negative offsets, and iOS would otherwise scroll into bare
      // canvas. Never below where the page already legitimately rests, so a
      // drag toward the bottom cannot pull it up - but a start iOS left past
      // the end is not legitimate, and does not count.
      listRef.current?.measureInWindow((_x, y, _width, listHeight) => {
        const current = session.current;
        if (!current || current.id !== category.ID) return;
        const { insets: edges, windowHeight: height } = env.current;
        const overflow = y + listHeight + PAGE_BOTTOM_PADDING + edges.bottom - height;
        current.scrollMax = Math.max(scrollFloor, current.scrollStart + overflow);
      });
    };

    const drop = () => {
      const current = session.current;
      if (!current || current.dropping) return;
      current.dropping = true;
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      const finish = () => {
        if (session.current !== current) return;
        session.current = null;
        if (current.target !== current.from) {
          // The new order and the cleared lift land in one render; the
          // offsets are zeroed in the layout effect after it, never before,
          // or every moved row would flash back to its old place for a frame.
          pendingReset.current = true;
          env.current.onReorder(moveCategory(current.ordered, current.from, current.target));
          announce(current.ordered[current.from].name, current.target + 1);
        } else {
          resetAll();
        }
        setLiftedId(null);
        env.current.onLiftChange(false);
      };
      const settleTo = slotOffset(current.from, current.target, current.heights);
      if (env.current.reducedMotion) {
        drag.setValue(settleTo);
        scale.setValue(1);
        finish();
        return;
      }
      Animated.parallel([
        Animated.timing(drag, { toValue: settleTo, duration: SETTLE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(scale, { toValue: 1, duration: SETTLE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      ]).start(() => finish());
    };

    /** The screen reader's move up / move down: the same reorder, one step. */
    const moveBy = (category: Category, delta: -1 | 1) => {
      if (env.current.disabled || env.current.locked || session.current) return;
      const ordered = [...env.current.categories];
      const next = moveCategoryBy(ordered, category.ID, delta);
      if (next.every((item, index) => item.ID === ordered[index].ID)) return;
      env.current.onReorder(next);
      announce(category.name, next.findIndex((item) => item.ID === category.ID) + 1);
    };

    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // Only after a lift: take the touch from the row's Pressable on the
      // first move. The grant runs before the Pressable is told it lost the
      // touch, so `granted` tells that press-out apart from a release.
      onMoveShouldSetPanResponderCapture: () => Boolean(session.current && !session.current.dropping),
      onMoveShouldSetPanResponder: () => Boolean(session.current && !session.current.dropping),
      onPanResponderGrant: () => {
        if (session.current) session.current.granted = true;
      },
      onPanResponderMove: (event) => {
        const current = session.current;
        const pageY = event.nativeEvent.pageY;
        if (!current || current.dropping || !Number.isFinite(pageY)) return;
        // A long-press event without a position anchors on the first move instead.
        if (!Number.isFinite(current.liftPageY)) current.liftPageY = pageY;
        current.fingerY = pageY;
        follow();
        startAutoScroll();
      },
      onPanResponderRelease: drop,
      // Anything that takes the touch away (a native scroll that won the race,
      // an incoming call) drops the row where it is headed.
      onPanResponderTerminate: drop,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
    });

    return { shiftFor, resetAll, lift, drop, moveBy, responder };
  }, [drag, heights, scale, shifts]);

  useLayoutEffect(() => {
    if (!pendingReset.current) return;
    pendingReset.current = false;
    drive.resetAll();
  }, [categories, drive, liftedId]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (session.current) {
      session.current = null;
      env.current.onLiftChange(false);
    }
  }, []);

  /**
   * A tap on a row, or a screen reader's activate on it. `railOut`: a rail was
   * out when the touch began. While one is out the page does not scroll, and a
   * drag of 8pt closes the rail instead (AppScreen onScrollBlocked); that drag
   * still ends inside the row it started on, and the Pressable reads its
   * release as a tap - by then on a list with no rail out, so a thumb that
   * only meant to scroll would open a rename and the keyboard.
   */
  const press = (category: Category, railOut: boolean) => {
    // A held row's release is a drop, never a tap.
    if (session.current) return;
    // Inside the row being renamed a tap only missed the field: it stays open.
    if (editingId === category.ID) return;
    // Renaming or adding, any other row is "elsewhere". The page keeps the
    // keyboard up for taps a view answers (keyboardShouldPersistTaps
    // "handled"), so it has to be put away here; the field losing focus
    // without done is its cancel.
    if (locked) {
      Keyboard.dismiss();
      return;
    }
    if (disabled) return;
    // A tap while a rail is out puts it away; the next tap renames.
    if (railOut || openRailId !== null) {
      if (openRailId !== null) onRailChange(null);
      return;
    }
    onRename(category);
  };

  const last = categories.length - 1;
  const hasHeader = Boolean(header);
  const containerStyle: ViewStyle = framed
    ? { borderWidth: 1, borderColor: palette.border, borderRadius: radius.md, backgroundColor: palette.surface }
    : { marginHorizontal: -spacing.lg, backgroundColor: palette.surface };
  const renameLabel = copy('แก้ชื่อ', 'Rename');
  const deleteWord = copy('ลบ', 'Delete');

  return (
    // No overflow: 'hidden' here - it would clip the lifted row's scale and shadow.
    <View collapsable={false} ref={listRef} {...drive.responder.panHandlers} style={containerStyle}>
      {header}
      {categories.map((category, index) => {
        const lifted = liftedId === category.ID;
        const editing = editingId === category.ID;
        const railOpen = openRailId === category.ID;
        const detail = counts ? categoryDishLabel(counts.get(category.ID) ?? 0, language) : null;
        const hiddenWord = category.is_active ? null : copy('ซ่อนอยู่', 'hidden');
        const label = [category.name, detail, hiddenWord].filter(Boolean).join(', ');
        const roundTop = framed && index === 0 && !hasHeader;
        const roundBottom = framed && index === last;
        // No swipe while a name is open, nor during a save - except on the row
        // whose rail is out: that save is its delete, and the rail stays.
        const swipeLocked = locked || (disabled && !railOpen);
        const actions = locked ? [{ name: 'activate', label: renameLabel }] : [
          { name: 'activate', label: renameLabel },
          { name: 'delete', label: deleteWord },
          ...(index > 0 ? [{ name: 'moveUp', label: copy('เลื่อนขึ้น', 'Move up') }] : []),
          ...(index < last ? [{ name: 'moveDown', label: copy('เลื่อนลง', 'Move down') }] : []),
        ];
        const onAction = (event: AccessibilityActionEvent) => {
          const action = event.nativeEvent.actionName;
          if (action === 'activate') press(category, false);
          if (action === 'delete' && !disabled && !locked && !session.current) onDelete(category);
          if (action === 'moveUp') drive.moveBy(category, -1);
          if (action === 'moveDown') drive.moveBy(category, 1);
        };
        const row = (
          <CategoryRow
            // The frame around it speaks for the row. While it is renamed
            // nothing does, and the field inside is reachable on its own.
            accessible={false}
            delayLongPress={LONG_PRESS_MS}
            detail={detail}
            hidden={!category.is_active}
            lifted={lifted}
            name={category.name}
            nameSlot={editing ? renderEditor(category) : undefined}
            onLongPress={(event) => drive.lift(category, index, event.nativeEvent.pageY)}
            onPress={() => press(category, railOutAtPressIn.current)}
            onPressIn={() => {
              railOutAtPressIn.current = env.current.openRailId !== null;
            }}
            onPressOut={() => {
              // Held and let go without moving: the list never took the
              // touch, so the drop comes from here.
              const current = session.current;
              if (current && current.id === category.ID && !current.granted) drive.drop();
            }}
            quiet={disabled || locked}
            roundBottom={roundBottom}
            roundTop={roundTop}
          />
        );
        return (
          <Animated.View
            key={category.ID}
            onLayout={(event) => {
              heights.set(category.ID, event.nativeEvent.layout.height);
            }}
            style={[
              { transform: [{ translateY: lifted ? drag : drive.shiftFor(category.ID) }, { scale: lifted ? scale : 1 }] },
              lifted ? LIFTED_CARD : null,
            ]}
          >
            <CategoryRowFrame
              accessible={!editing}
              {...(editing ? {} : {
                accessibilityActions: actions,
                accessibilityLabel: label,
                accessibilityRole: 'button' as const,
                accessibilityState: { disabled },
                onAccessibilityAction: onAction,
              })}
              lifted={lifted}
              roundBottom={roundBottom}
              roundTop={roundTop}
            >
              {/* The swipe row's own element and its rail button are the
                  frame's to speak for; Android would stop on each of them. */}
              <View
                accessibilityElementsHidden={!editing}
                importantForAccessibility={editing ? 'auto' : 'no-hide-descendants'}
              >
                {editing ? row : (
                  <SwipeToDeleteRow
                    deleteAccessibilityLabel={copy(`ลบ ${category.name}`, `Delete ${category.name}`)}
                    deleteLabel={deleteWord}
                    // Dims the row, and its ลบ, while that delete runs.
                    disabled={disabled && railOpen}
                    editHint={renameLabel}
                    editLabel={label}
                    itemId={category.ID}
                    locked={swipeLocked}
                    onClose={() => {
                      if (openRailId === category.ID) onRailChange(null);
                    }}
                    onDelete={() => {
                      // A drag that started on ลบ closes the rail (the page's
                      // scroll block) and still releases on the button under
                      // the row sliding back: no delete once it is put away.
                      if (env.current.openRailId === category.ID) onDelete(category);
                    }}
                    onOpen={() => onRailChange(category.ID)}
                    onSwipeEnd={noop}
                    onSwipeStart={(id) => {
                      // One rail out at a time: another row starting to slide
                      // puts the open one away at once, not on release.
                      if (openRailId !== null && openRailId !== id) onRailChange(null);
                    }}
                    open={railOpen && !swipeLocked}
                  >
                    {row}
                  </SwipeToDeleteRow>
                )}
              </View>
            </CategoryRowFrame>
          </Animated.View>
        );
      })}
    </View>
  );
}
