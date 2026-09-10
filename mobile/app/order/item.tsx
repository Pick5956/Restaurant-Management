import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listMenuItems } from '@/src/api/menu';
import { addOrderItem, getOrder } from '@/src/api/order';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import { MenuImage } from '@/src/components/menu-image';
import { ActionDock, Button, ChipGroup, EmptyState, Feedback, IconButton, TextField } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { isOptionSelectionBelowMinimum } from '@/src/lib/order-workflow';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type { MenuItem } from '@/src/types/menu';
import type { Order } from '@/src/types/order';


export default function AddOrderItemScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const canTakeOrder = can(activeMembership, 'take_order');
  const params = useLocalSearchParams<{ id: string; menuId: string }>();
  const orderId = Number(params.id); const menuId = Number(params.menuId);
  const validParams = Number.isInteger(orderId) && orderId > 0 && Number.isInteger(menuId) && menuId > 0;
  const [order, setOrder] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [fulfillment, setFulfillment] = useState<'dine_in' | 'takeaway'>('dine_in');
  const [selectedOptionIds, setSelectedOptionIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  const scrollControl = useRef<AppScreenScrollControl | null>(null);
  const noteRef = useRef<View>(null);
  // Where the note block sat, and where the page sat, at the moment the field
  // took focus — read together so they describe the same instant.
  const noteAnchor = useRef<{ bottom: number; offset: number } | null>(null);
  useEffect(() => {
    if (!noteFocused) return undefined;
    // iOS scrolls the CARET clear of the keyboard and stops there — see
    // AppScreenScrollControl. On a three-line box the caret is on line one, so
    // that leaves the rest of the box and the stepper under it covered, and the
    // page has to be moved the rest of the way.
    //
    // On `willChangeFrame`, not `didShow`. `didShow` lands after the keyboard has
    // finished animating, so iOS's own partial scroll played out first and this
    // one followed it as a separate, visibly late second movement. Both now start
    // in the same frame and read as one.
    //
    // The destination is absolute, computed from the anchor taken at focus rather
    // than from a fresh measurement. A measurement taken now would be racing
    // iOS's scroll — sometimes before it, sometimes after — and pairing it with
    // the current offset would overshoot by however far iOS had already moved.
    const listener = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const change = Keyboard.addListener(listener, (event) => {
      const anchor = noteAnchor.current;
      const keyboardTop = event?.endCoordinates?.screenY;
      if (!anchor || typeof keyboardTop !== 'number') return;
      // `screenY` is the top of the keyboard including its accessory bar, so this
      // is the exact deficit and nothing more. Fires again if the keyboard
      // resizes; the same target then means no movement. Negative on hide.
      const target = anchor.offset + anchor.bottom + spacing.lg - keyboardTop;
      if (target > 0) scrollControl.current?.scrollTo(target);
    });
    return () => change.remove();
  }, [noteFocused]);
  useEffect(() => { if (!canTakeOrder || !validParams) return; Promise.all([getOrder(orderId), listMenuItems()]).then(([nextOrder, response]) => { const nextMenu = response.menu_items.find((item) => item.ID === menuId) || null; setOrder(nextOrder); setMenu(nextMenu); setFulfillment(nextOrder.order_type || 'dine_in'); setSelectedOptionIds((nextMenu?.option_groups || []).flatMap((group) => (group.options || []).filter((option) => option.is_active && option.is_default).map((option) => option.ID))); if (!nextMenu) setError(copy('ไม่พบเมนูนี้', 'Menu item not found')); }).catch((err) => setError(err instanceof Error ? err.message : copy('โหลดเมนูไม่สำเร็จ', 'Could not load this menu item'))); }, [canTakeOrder, copy, menuId, orderId, validParams]);
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
    if (!canTakeOrder || !menu?.is_available || missingRequired) return;
    setSaving(true); setError(null);
    try { await addOrderItem(orderId, { menu_id: menu.ID, quantity, note: note.trim(), selected_option_ids: selectedOptionIds, fulfillment_type: fulfillment }); router.back(); }
    catch (err) { setError(err instanceof Error ? err.message : copy('เพิ่มเมนูไม่สำเร็จ', 'Could not add this item')); }
    finally { setSaving(false); }
  }
  if (!canTakeOrder) return <AppScreen title={copy('เลือกเมนู', 'Choose menu item')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')} /></AppScreen>;
  if (!validParams) return <AppScreen title={copy('เลือกเมนู', 'Choose menu item')} topLevel={false}><EmptyState title={copy('ไม่พบรายการนี้', 'Item not found')} detail={copy('รหัสออเดอร์หรือเมนูไม่ถูกต้อง กรุณากลับไปเลือกใหม่', 'The order or menu ID is invalid. Go back and choose again.')} /></AppScreen>;
  // The image and the rules between sections run the full width of the screen,
  // so they have to escape the padding AppScreen puts on its content. Same
  // measure AppScreen uses, mirrored.
  const gutter = width >= breakpoints.tablet ? spacing.xxl : spacing.lg;
  const fullBleed = { marginHorizontal: -gutter };
  const rule = <View style={[fullBleed, { height: 1, backgroundColor: palette.divider }]} />;

  /** A section heading: name on the left, its rule badge on the right. */
  function sectionHead(title: string, badge?: { label: string; tone: 'required' | 'optional' }) {
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

  return (
    <AppScreen
      title={menu?.name || copy('เลือกเมนู', 'Choose menu item')}
      // No header row at all: the image runs to the very top edge of the display.
      // A heading here would have cost a band of empty screen above the photo and
      // repeated the name, which the row under the image already carries.
      immersive
      // Pinned to the corner rather than sitting in the content, so it stays put
      // while the page scrolls under it. With no header row it is the only way
      // out of this screen, so it must not be able to scroll away — nor be
      // conditional on the menu having loaded.
      floatingLeading={(
        <IconButton
          accessibilityLabel={copy('ย้อนกลับ', 'Go back')}
          icon="chevron-back"
          onPress={() => router.back()}
          variant="glass"
        />
      )}
      topLevel={false}
      contentStyle={{ gap: 0 }}
      scrollControlRef={scrollControl}
      footer={menu ? (
        <ActionDock>
          <Button
            icon="add"
            label={copy(`เพิ่มเข้าออเดอร์ · ${money(total, language)}`, `Add to order · ${money(total, language)}`)}
            onPress={add}
            loading={saving}
            disabled={missingRequired || !menu.is_available}
            variant="glass"
          />
        </ActionDock>
      ) : undefined}
    >
      {menu ? (
        <View>
          <View style={fullBleed}>
            <MenuImage
              accessibilityLabel={copy(`รูปเมนู ${menu.name}`, `Photo of ${menu.name}`)}
              imageUrl={menu.image_url}
              // Square corners: the frame's own radius is for an image inset
              // from the page, and once it runs edge to edge a rounded corner
              // bites a notch out of the screen instead of softening a card.
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

          {order?.order_type !== 'takeaway' ? (
            <>
              {rule}
              <View style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
                {sectionHead(copy('รูปแบบ', 'Fulfillment'))}
                <ChipGroup glass value={fulfillment} onChange={setFulfillment} options={[{ label: copy('ทานที่ร้าน', 'Dine-in'), value: 'dine_in' }, { label: copy('ซื้อกลับบ้าน', 'Takeaway'), value: 'takeaway' }]} />
              </View>
            </>
          ) : null}

          {/* Always open, never an accordion. Every group is a decision the
              kitchen needs, and a collapsed one hides that it is still waiting. */}
          {(menu.option_groups || []).filter((group) => group.is_active).map((group) => {
            const options = (group.options || []).filter((option) => option.is_active);
            const ids = options.map((option) => option.ID);
            const minSelect = Math.max(0, Number(group.min_select) || 0);
            const maxSelect = Math.max(1, Number(group.max_select) || 1);
            // One choice is a radio, several are checkboxes. The control has to
            // say which it is before it is touched, not after.
            const single = maxSelect <= 1;
            return (
              <View key={group.ID}>
                {rule}
                <View style={{ gap: spacing.xs, paddingVertical: spacing.lg }}>
                  {sectionHead(group.name, minSelect > 0
                    ? { label: copy(`ต้องเลือก ${minSelect}`, `Choose ${minSelect}`), tone: 'required' }
                    : { label: copy(`เลือกได้ ${maxSelect}`, `Up to ${maxSelect}`), tone: 'optional' })}
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
                          name={single
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
          {/* Measured on focus to work out how much of it the keyboard covers, so
              it has to wrap everything that must end up visible. */}
          <View ref={noteRef} style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
            {sectionHead(copy('หมายเหตุถึงครัว', 'Kitchen note'), { label: copy('ไม่จำเป็นต้องระบุ', 'Optional'), tone: 'optional' })}
            <TextField
              value={note}
              onChangeText={setNote}
              multiline
              onFocus={() => {
                // Measured here rather than when the keyboard arrives: nothing has
                // scrolled yet, so the position and the offset agree.
                noteRef.current?.measureInWindow((_x, y, _width, height) => {
                  noteAnchor.current = {
                    bottom: y + height,
                    offset: scrollControl.current?.getOffset() ?? 0,
                  };
                });
                setNoteFocused(true);
              }}
              onBlur={() => setNoteFocused(false)}
            />
          </View>

          {/* No heading. Two matching circles either side of the number, centred
              on the screen and sitting under the note — the shape says what it
              does, so a word above it would only be describing the obvious. */}
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
          {/* Directly above the button that raises it. This error only ever comes
              from pressing "add to order", which is at the bottom of a screen
              long enough to scroll — reporting it at the top would put it out of
              sight of the person who just caused it, and in immersive mode
              underneath the status bar as well. */}
          {error ? (
            <View style={{ paddingBottom: spacing.lg }}>
              <Feedback title={copy('เพิ่มเมนูไม่ได้', 'Could not add this item')} detail={error} tone="danger" />
            </View>
          ) : null}
        </View>
      ) : (
        // No menu means it never loaded, so there is no image to sit under and
        // nothing has reserved the status bar. The back control is pinned over
        // this same area, so the banner clears its height too.
        <View style={{ paddingTop: insets.top + 52, paddingBottom: spacing.lg }}>
          {error ? (
            <Feedback title={copy('เปิดเมนูนี้ไม่ได้', 'Could not open this item')} detail={error} tone="danger" />
          ) : null}
        </View>
      )}
    </AppScreen>
  );
}
