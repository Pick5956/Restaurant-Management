import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View } from 'react-native';

import { listMenuItems } from '@/src/api/menu';
import { addOrderItem, getOrder, updateOrderItem } from '@/src/api/order';
import { AppIcon } from '@/src/components/app-icon';
import type { AppScreenScrollControl } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { MenuImage } from '@/src/components/menu-image';
import { ActionDock, Button, ChipGroup, Feedback, IconButton, TextField } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { findPendingOrderItem, orderItemEditorDefaults } from '@/src/lib/order-detail-runtime';
import { stockFailure, stockFailureMessage } from '@/src/lib/order-item-error';
import { isOptionSelectionBelowMinimum } from '@/src/lib/order-workflow';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { palette, radius, spacing, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';
import type { Order } from '@/src/types/order';

/** The dish panel's width on a tablet: a phone's, whatever the iPad. */
export const ORDER_PANEL_MIN_WIDTH = 340;
export const ORDER_PANEL_MAX_WIDTH = 420;
const PANEL_GUTTER = spacing.lg;

export type OrderItemEditorOptions = {
  orderId: number;
  menuId: number;
  /** A line already on the order: the editor changes it instead of adding one. */
  itemId?: number;
  /** The dish is already on the table, so the line goes onto the bill as served
   *  and never reaches the kitchen. Ignored while editing. */
  served?: boolean;
  /** The order and the dish the caller already holds. The tablet panel passes
   *  them so a tap shows the dish at once instead of fetching both again. */
  initial?: { order: Order; menu: MenuItem } | null;
  /** Called with the order as the server returned it, once the line is saved. */
  onDone: (order: Order) => void;
  /** The screen's own lock on writes to this order, when it has one. Beside the
   *  grid the add is on screen at the same time as the screen's other writes,
   *  so it takes the same lock instead of racing them - and a load that is in
   *  flight is dropped rather than allowed to land after it. */
  mutationGuard?: { begin: () => boolean; finish: () => void } | null;
};

/**
 * Everything the item editor knows and does, shared by the phone's item screen
 * and the tablet's dish panel so the two cannot drift apart.
 */
export function useOrderItemEditor({
  orderId,
  menuId,
  itemId = 0,
  served: servedOption = false,
  initial = null,
  onDone,
  mutationGuard = null,
}: OrderItemEditorOptions) {
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const canTakeOrder = can(activeMembership, 'take_order');
  // With `itemId` this is editing a line that is already on the order rather
  // than adding one. Same editor on purpose: a waiter fixing an option is doing
  // the same job they did when they chose it, and the quantity-only editor this
  // replaced could not undo a wrong option at all - it told them to delete the
  // line and start again.
  const editing = Number.isInteger(itemId) && itemId > 0;
  // Opened from the bill's served-item page: the dish is already on the table,
  // so the line goes onto the bill as served and never reaches the kitchen.
  // Everything else - options, note, quantity - is chosen the same way.
  const served = !editing && servedOption;
  // Seeded once, from whatever the caller handed over. Without it the effect
  // below fetches the order and the menu and seeds from those instead.
  const [seed] = useState(() => (initial ? orderItemEditorDefaults(initial.order, initial.menu, itemId) : null));
  const preloaded = seed !== null;
  const [order, setOrder] = useState<Order | null>(initial?.order ?? null);
  const [menu, setMenu] = useState<MenuItem | null>(initial?.menu ?? null);
  const [quantity, setQuantity] = useState(seed?.quantity ?? 1);
  const [note, setNote] = useState(seed?.note ?? '');
  const [fulfillment, setFulfillment] = useState<'dine_in' | 'takeaway'>(seed?.fulfillment ?? 'dine_in');
  const [selectedOptionIds, setSelectedOptionIds] = useState<number[]>(seed?.selectedOptionIds ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preloaded || !canTakeOrder || !(orderId > 0) || !(menuId > 0)) return;
    Promise.all([getOrder(orderId), listMenuItems()]).then(([nextOrder, response]) => {
      const nextMenu = response.menu_items.find((item) => item.ID === menuId) || null;
      const next = orderItemEditorDefaults(nextOrder, nextMenu, itemId);
      setOrder(nextOrder);
      setMenu(nextMenu);
      setFulfillment(next.fulfillment);
      setQuantity(next.quantity);
      setNote(next.note);
      setSelectedOptionIds(next.selectedOptionIds);
      if (!nextMenu) setError(copy('ไม่พบเมนูนี้', 'Menu item not found'));
      else if (editing && !findPendingOrderItem(nextOrder.items, itemId)) setError(copy('รายการนี้ส่งเข้าครัวแล้ว แก้ไขไม่ได้', 'This item is already with the kitchen and can no longer be edited'));
    }).catch(() => setError(copy('โหลดเมนูไม่สำเร็จ', 'Could not load this menu item')));
  }, [canTakeOrder, copy, editing, itemId, menuId, orderId, preloaded]);

  const optionTotal = useMemo(() => (menu?.option_groups || []).flatMap((group) => group.options || []).filter((option) => selectedOptionIds.includes(option.ID)).reduce((sum, option) => sum + Number(option.price_delta), 0), [menu, selectedOptionIds]);
  const total = (Number(menu?.price || 0) + optionTotal) * quantity;
  const missingRequired = Boolean(menu?.option_groups?.some((group) => (
    group.is_active
    && isOptionSelectionBelowMinimum(
      group.min_select,
      (group.options || []).filter(
        (option) => option.is_active && selectedOptionIds.includes(option.ID),
      ).length,
    )
  )));

  function toggle(groupIds: number[], optionId: number, max: number) {
    setSelectedOptionIds((current) => {
      const outside = current.filter((id) => !groupIds.includes(id)); const inside = current.filter((id) => groupIds.includes(id));
      if (inside.includes(optionId)) return [...outside, ...inside.filter((id) => id !== optionId)];
      if (max <= 1) return [...outside, optionId];
      if (inside.length >= max) return current;
      return [...outside, ...inside, optionId];
    });
  }

  async function add() {
    // A sold-out menu still has to be SAVEABLE while editing: the line is
    // already on the order, and refusing would strand whoever opened it to fix
    // an option. Only adding a new one is blocked.
    if (!canTakeOrder || missingRequired || !menu || (!editing && !menu.is_available)) return;
    if (mutationGuard && !mutationGuard.begin()) return;
    setSaving(true); setError(null);
    try {
      const saved = editing
        ? await updateOrderItem(orderId, itemId, { quantity, note: note.trim(), selected_option_ids: selectedOptionIds })
        : await addOrderItem(orderId, { menu_id: menu.ID, quantity, note: note.trim(), selected_option_ids: selectedOptionIds, fulfillment_type: fulfillment, serve_immediately: served });
      onDone(saved);
    }
    catch (err) {
      // The stock ran out while the order screen sat open (it does not poll):
      // the server refuses, and the refusal is a toast in the app's own words.
      // The editor itself is left as it was.
      const failure = stockFailure(err instanceof Error ? err.message : '');
      showToast({
        tone: 'error',
        title: editing ? copy('บันทึกรายการไม่สำเร็จ', 'Could not save this item') : copy('เพิ่มเมนูไม่สำเร็จ', 'Could not add this item'),
        ...(failure ? { message: stockFailureMessage(failure, language) } : {}),
      });
    }
    finally {
      mutationGuard?.finish();
      setSaving(false);
    }
  }

  return {
    order,
    menu,
    editing,
    served,
    quantity,
    setQuantity,
    note,
    setNote,
    fulfillment,
    setFulfillment,
    selectedOptionIds,
    toggle,
    total,
    missingRequired,
    saving,
    error,
    add,
  };
}

export type OrderItemEditor = ReturnType<typeof useOrderItemEditor>;

/**
 * Keeps the whole note box above the keyboard, not just its caret.
 *
 * iOS scrolls the CARET clear of the keyboard and stops there - see
 * AppScreenScrollControl. On a three-line box the caret is on line one, so that
 * leaves the rest of the box and the stepper under it covered, and the scroll
 * view has to be moved the rest of the way. `scrollControl` is whichever scroll
 * view the note sits in: AppScreen's on a phone, the panel's own on a tablet.
 */
export function useNoteKeyboardAlignment(scrollControl: React.MutableRefObject<AppScreenScrollControl | null>) {
  const noteRef = useRef<View>(null);
  // Where the note block sat, and where the page sat, at the moment the field
  // took focus - read together so they describe the same instant.
  const noteAnchor = useRef<{ bottom: number; offset: number } | null>(null);
  // The top of the keyboard, kept by a listener that is mounted for the whole
  // screen rather than switched on when the field takes focus.
  const keyboardTop = useRef<number | null>(null);
  const noteFocused = useRef(false);

  // The destination is absolute, computed from the anchor taken at focus rather
  // than from a fresh measurement. A measurement taken now would be racing
  // iOS's scroll - sometimes before it, sometimes after - and pairing it with
  // the current offset would overshoot by however far iOS had already moved.
  const alignNoteAboveKeyboard = useCallback(() => {
    const anchor = noteAnchor.current;
    const top = keyboardTop.current;
    if (!noteFocused.current || !anchor || top === null) return;
    // `screenY` is the top of the keyboard including its accessory bar, so this
    // is the exact deficit and nothing more. Running it again with the same
    // anchor asks for the same absolute place, so a second call cannot drift.
    const target = anchor.offset + anchor.bottom + spacing.lg - top;
    if (target > 0) scrollControl.current?.scrollTo(target);
  }, [scrollControl]);

  // Subscribed for the life of the screen, not for the life of the focus. The
  // listener used to be added by an effect that ran AFTER the render that
  // focus triggered, and `measureInWindow` answered on its own schedule too -
  // so on the first tap iOS had already raised the keyboard before either was
  // ready and nothing moved the page. It took a scroll, a dismiss and a second
  // tap to land, because by then the previous focus had left an anchor behind.
  // Now whichever of the two arrives last does the scrolling.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvent, (event) => {
      const top = event?.endCoordinates?.screenY;
      if (typeof top !== 'number') return;
      keyboardTop.current = top;
      alignNoteAboveKeyboard();
    });
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTop.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [alignNoteAboveKeyboard]);

  const onNoteFocus = useCallback(() => {
    noteFocused.current = true;
    // Measured here rather than when the keyboard arrives: nothing has
    // scrolled yet, so the position and the offset agree.
    noteRef.current?.measureInWindow((_x, y, _width, height) => {
      noteAnchor.current = {
        bottom: y + height,
        offset: scrollControl.current?.getOffset() ?? 0,
      };
      alignNoteAboveKeyboard();
    });
  }, [alignNoteAboveKeyboard, scrollControl]);

  const onNoteBlur = useCallback(() => {
    noteFocused.current = false;
    noteAnchor.current = null;
  }, []);

  // For a scroll view that makes room for the keyboard itself: the scroll that
  // arrives with the keyboard is clamped to the old content end, so it is asked
  // again once the extra room has been laid out.
  return { noteRef, onNoteFocus, onNoteBlur, realign: alignNoteAboveKeyboard };
}

export type NoteKeyboardAlignment = ReturnType<typeof useNoteKeyboardAlignment>;

/** A section heading: name on the left, its rule badge on the right. */
function SectionHead({ title, badge }: { title: string; badge?: { label: string; tone: 'required' | 'optional' } }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <Text selectable style={[typeScale.title, { minWidth: 0, flex: 1 }]}>{title}</Text>
      {badge ? (
        <Text
          selectable
          style={{
            flexShrink: 0,
            overflow: 'hidden',
            borderRadius: 999,
            paddingHorizontal: 9,
            paddingVertical: 2,
            fontSize: 11,
            lineHeight: 17,
            fontWeight: '700',
            color: badge.tone === 'required' ? '#7A3B0B' : '#275C3B',
            backgroundColor: badge.tone === 'required' ? '#FEF3C7' : '#DCEBD2',
          }}
        >
          {badge.label}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The dish itself: its photo edge to edge, name and price, dine-in or takeaway,
 * every option group, the note and the quantity. The container around it - the
 * phone's full screen or the tablet's panel - supplies the scroll view, the add
 * button and the way out.
 */
export function OrderItemEditorBody({
  editor,
  gutter,
  noteKeyboard,
  missingTopInset,
}: {
  editor: OrderItemEditor;
  /** The horizontal padding the body sits in. The photo and the rules between
   *  sections run edge to edge, so they reach back out through it. */
  gutter: number;
  noteKeyboard: NoteKeyboardAlignment;
  /** Where to start when there is no dish to lead with, so the error clears
   *  the control floating over the top corner. */
  missingTopInset: number;
}) {
  const { copy, language } = useDisplayPreferences();
  const { menu, order, editing, served, fulfillment, setFulfillment, selectedOptionIds, toggle, note, setNote, quantity, setQuantity, missingRequired, error } = editor;
  const fullBleed = { marginHorizontal: -gutter };
  const rule = <View style={[fullBleed, { height: 1, backgroundColor: palette.divider }]} />;

  if (!menu) {
    // No menu means it never loaded, so there is no image to sit under and
    // nothing has reserved the top edge.
    return (
      <View style={{ paddingTop: missingTopInset, paddingBottom: spacing.lg }}>
        {error ? (
          <Feedback title={copy('เปิดเมนูนี้ไม่ได้', 'Could not open this item')} detail={error} tone="danger" />
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <View style={fullBleed}>
        <MenuImage
          accessibilityLabel={copy(`รูปเมนู ${menu.name}`, `Photo of ${menu.name}`)}
          imageUrl={menu.image_url}
          // Square corners: the frame's own radius is for an image inset from
          // the page, and once it runs edge to edge a rounded corner bites a
          // notch out of the screen instead of softening a card.
          style={{ borderRadius: 0 }}
          variant="hero"
        />
      </View>

      {/* Name and price share the first line, the price hard right. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md, paddingTop: spacing.md }}>
        <Text accessibilityRole="header" selectable style={[typeScale.hero, { minWidth: 0, flex: 1 }]}>{menu.name}</Text>
        <Text selectable style={[typeScale.hero, { flexShrink: 0 }]}>{money(menu.price, language)}</Text>
      </View>
      {menu.description ? (
        <Text selectable style={[typeScale.body, { color: palette.muted, paddingTop: spacing.xs, paddingBottom: spacing.md }]}>{menu.description}</Text>
      ) : <View style={{ height: spacing.md }} />}

      {!menu.is_available ? (
        <View style={{ paddingBottom: spacing.md }}>
          <Feedback title={copy('เมนูนี้หมดชั่วคราว', 'This menu item is sold out')} detail={copy('กลับไปเลือกเมนูอื่น', 'Choose another menu item.')} tone="warning" />
        </View>
      ) : null}

      {/* Not offered while editing: the update endpoint takes quantity, note
          and options, and a line's dine-in/takeaway is settled when it is
          added. A control that silently does nothing is worse than no control. */}
      {!editing && order?.order_type !== 'takeaway' ? (
        <>
          {rule}
          <View style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
            <SectionHead title={copy('รูปแบบ', 'Fulfillment')} />
            <ChipGroup glass value={fulfillment} onChange={setFulfillment} options={[{ label: copy('ทานที่ร้าน', 'Dine-in'), value: 'dine_in' }, { label: copy('ซื้อกลับบ้าน', 'Takeaway'), value: 'takeaway' }]} />
          </View>
        </>
      ) : null}

      {/* Always open, never an accordion. Every group is a decision the kitchen
          needs, and a collapsed one hides that it is still waiting. */}
      {(menu.option_groups || []).filter((group) => group.is_active).map((group) => {
        const options = (group.options || []).filter((option) => option.is_active);
        const ids = options.map((option) => option.ID);
        const minSelect = Math.max(0, Number(group.min_select) || 0);
        const maxSelect = Math.max(1, Number(group.max_select) || 1);
        const single = maxSelect <= 1;
        // Round means "you have to pick one of these", square means "take it or
        // leave it". The shape used to follow max_select - one choice drew a
        // radio - but whether a group can be SKIPPED is the thing a person needs
        // to know before touching it, and it is the thing that stops the add
        // button working. The accessibility role still follows the real
        // behaviour: a screen reader must hear checkbox for a group that takes
        // several answers, whatever the icon is.
        const required = minSelect > 0;
        return (
          <View key={group.ID}>
            {rule}
            <View style={{ gap: spacing.xs, paddingVertical: spacing.lg }}>
              <SectionHead
                title={group.name}
                badge={minSelect > 0
                  ? { label: copy(`ต้องเลือก ${minSelect}`, `Choose ${minSelect}`), tone: 'required' }
                  : { label: copy(`เลือกได้ ${maxSelect}`, `Up to ${maxSelect}`), tone: 'optional' }}
              />
              {options.map((option) => {
                const active = selectedOptionIds.includes(option.ID);
                return (
                  <Pressable
                    accessibilityRole={single ? 'radio' : 'checkbox'}
                    accessibilityState={{ checked: active }}
                    key={option.ID}
                    onPress={() => toggle(ids, option.ID, maxSelect)}
                    style={({ pressed }) => ({ minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.md, opacity: pressed ? 0.7 : 1 })}
                  >
                    <AppIcon
                      color={active ? palette.primary : palette.placeholder}
                      name={required
                        ? (active ? 'radio-button-on' : 'radio-button-off')
                        : (active ? 'checkbox' : 'square-outline')}
                      size={23}
                    />
                    <Text selectable style={{ minWidth: 0, flex: 1, color: palette.text, fontSize: 15, lineHeight: 23, fontWeight: '500' }}>{option.name}</Text>
                    {option.price_delta ? <Text selectable style={{ flexShrink: 0, color: palette.muted, fontSize: 13, fontWeight: '700' }}>+{money(option.price_delta, language)}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}

      {rule}
      {/* Measured on focus to work out how much of it the keyboard covers, so it
          has to wrap everything that must end up visible. */}
      <View ref={noteKeyboard.noteRef} style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
        <SectionHead
          title={served ? copy('หมายเหตุ', 'Note') : copy('หมายเหตุถึงครัว', 'Kitchen note')}
          badge={{ label: copy('ไม่จำเป็นต้องระบุ', 'Optional'), tone: 'optional' }}
        />
        <TextField
          value={note}
          onChangeText={setNote}
          multiline
          onFocus={noteKeyboard.onNoteFocus}
          onBlur={noteKeyboard.onNoteBlur}
        />
      </View>

      {/* No heading. Two matching circles either side of the number, centred
          and sitting under the note - the shape says what it does, so a word
          above it would only be describing the obvious. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingBottom: spacing.lg }}>
        <IconButton
          accessibilityLabel={copy('ลดจำนวน', 'Decrease quantity')}
          disabled={quantity <= 1}
          icon="remove"
          onPress={() => setQuantity((value) => Math.max(1, value - 1))}
          variant="glass"
        />
        <Text selectable style={[typeScale.number, { minWidth: 40, textAlign: 'center' }]}>{quantity.toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}</Text>
        <IconButton
          accessibilityLabel={copy('เพิ่มจำนวน', 'Increase quantity')}
          disabled={quantity >= 100}
          icon="add"
          onPress={() => setQuantity((value) => Math.min(100, value + 1))}
          variant="glass"
        />
      </View>

      {missingRequired ? (
        <View style={{ paddingBottom: spacing.lg }}>
          <Feedback title={copy('เลือกตัวเลือกที่จำเป็นให้ครบ', 'Complete the required selections')} tone="warning" />
        </View>
      ) : null}
      {/* A state that stops this line being edited (it reached the kitchen while
          the editor was open). A failed press of the button is a toast, not
          this: an action's outcome never stacks into the page. */}
      {error ? (
        <View style={{ paddingBottom: spacing.lg }}>
          <Feedback title={copy('เพิ่มเมนูไม่ได้', 'Could not add this item')} detail={error} tone="danger" />
        </View>
      ) : null}
    </View>
  );
}

/** The editor's one action, carrying the line's total. */
export function OrderItemAddButton({ editor }: { editor: OrderItemEditor }) {
  const { copy, language } = useDisplayPreferences();
  const { menu, editing, served, total, saving, missingRequired, add } = editor;
  if (!menu) return null;
  return (
    <Button
      icon={editing ? 'checkmark' : 'add'}
      label={editing
        ? copy(`บันทึกรายการ · ${money(total, language)}`, `Save item · ${money(total, language)}`)
        : served
          ? copy(`เพิ่มเข้าบิล · ${money(total, language)}`, `Add to bill · ${money(total, language)}`)
          : copy(`เพิ่มเข้าออเดอร์ · ${money(total, language)}`, `Add to order · ${money(total, language)}`)}
      onPress={add}
      loading={saving}
      disabled={missingRequired || (!editing && !menu.is_available)}
      pill
      variant="glass"
    />
  );
}

/**
 * The tablet's frame for the dish panel: one hairline and one radius, so the
 * phone-width editor inside reads as a single object beside the grid. Nothing
 * inside it may draw a card of its own.
 */
export function OrderPanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        minHeight: 0,
        flex: 1,
        overflow: 'hidden',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.divider,
        backgroundColor: palette.surface,
      }}
    >
      {children}
    </View>
  );
}

/**
 * The item editor at a phone's width, for a tablet: its own scroll view, the
 * add button docked under it, and an optional close control over the photo.
 * The phone's item screen is the same editor filling the display.
 */
export function OrderItemPanel({ onClose, ...options }: OrderItemEditorOptions & { onClose?: () => void }) {
  const { copy } = useDisplayPreferences();
  const editor = useOrderItemEditor(options);
  const scrollBoxRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const scrollControl = useRef<AppScreenScrollControl | null>(null);
  // How far the keyboard reaches up into the scroll view, as room added under
  // the content so its last rows can still rise above the keyboard.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    scrollControl.current = {
      scrollTo: (y, animated = true) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y), animated });
      },
      getOffset: () => offsetRef.current,
    };
    return () => {
      scrollControl.current = null;
    };
  }, []);
  const noteKeyboard = useNoteKeyboardAlignment(scrollControl);

  // The panel makes that room itself instead of leaving it to
  // `automaticallyAdjustKeyboardInsets`. On the owner's iPad (2026-09-19) the
  // prop added no inset to this scroll view at all: the panel stopped at its
  // own content end and the note stayed under the keyboard. Measured against
  // the keyboard's top, the same way the note is, so the two agree.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvent, (event) => {
      const top = event?.endCoordinates?.screenY;
      if (typeof top !== 'number') return;
      scrollBoxRef.current?.measureInWindow((_x, y, _width, height) => {
        setKeyboardInset(Math.max(0, Math.round(y + height - top)));
      });
    });
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return (
    <View style={{ minHeight: 0, flex: 1 }}>
      {/* Measured rather than the scroll view itself: its frame is the scroll
          view's frame, and a plain view answers measureInWindow on every
          platform. */}
      <View ref={scrollBoxRef} style={{ minHeight: 0, flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          // The photo is flush with the top of the panel, and a rubber band would
          // drag it down to show bare panel above it.
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={{ paddingHorizontal: PANEL_GUTTER, paddingBottom: keyboardInset }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          // The scroll the keyboard asked for was clamped to the content end as
          // it stood before the room above was added; ask again now it exists.
          onContentSizeChange={noteKeyboard.realign}
          onScroll={(event) => {
            offsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={false}
        >
          <OrderItemEditorBody
            editor={editor}
            gutter={PANEL_GUTTER}
            missingTopInset={onClose ? spacing.md + 44 + spacing.md : spacing.lg}
            noteKeyboard={noteKeyboard}
          />
        </ScrollView>
      </View>
      {editor.menu ? (
        <ActionDock>
          <OrderItemAddButton editor={editor} />
        </ActionDock>
      ) : null}
      {/* Over the photo and outside the scroll view, so it stays put while the
          dish scrolls under it - the phone's back control, in the panel's
          corner. It closes the dish rather than going back: nothing is behind
          a panel. */}
      {onClose ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', top: spacing.md, left: spacing.md }}>
          <IconButton accessibilityLabel={copy('ปิดเมนูนี้', 'Close this dish')} icon="close" onPress={onClose} variant="glass" />
        </View>
      ) : null}
    </View>
  );
}
