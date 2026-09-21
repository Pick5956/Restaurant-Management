import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import {
  ORDER_PANEL_MAX_WIDTH,
  OrderItemAddButton,
  OrderItemEditorBody,
  OrderItemPanel,
  OrderPanelFrame,
  useNoteKeyboardAlignment,
  useOrderItemEditor,
} from '@/src/components/order-item-editor';
import { ActionDock, EmptyState, IconButton } from '@/src/components/ui';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, spacing } from '@/src/theme';


export default function AddOrderItemScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy } = useDisplayPreferences();
  const canTakeOrder = can(activeMembership, 'take_order');
  const params = useLocalSearchParams<{ id: string; menuId: string; itemId?: string; served?: string }>();
  const orderId = Number(params.id); const menuId = Number(params.menuId);
  // With `itemId` this screen is editing a line that is already on the order
  // rather than adding one - see useOrderItemEditor for why it is one screen.
  const itemId = Number(params.itemId);
  const editing = Number.isInteger(itemId) && itemId > 0;
  // Opened from the bill's served-item page: the dish is already on the table,
  // so the line goes onto the bill as served and never reaches the kitchen.
  const served = !editing && params.served === '1';
  const validParams = Number.isInteger(orderId) && orderId > 0 && Number.isInteger(menuId) && menuId > 0;
  if (!canTakeOrder) return <AppScreen title={copy('เลือกเมนู', 'Choose menu item')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์รับออเดอร์', 'No order-taking permission')} /></AppScreen>;
  if (!validParams) return <AppScreen title={copy('เลือกเมนู', 'Choose menu item')} topLevel={false}><EmptyState title={copy('ไม่พบรายการนี้', 'Item not found')} detail={copy('รหัสออเดอร์หรือเมนูไม่ถูกต้อง กรุณากลับไปเลือกใหม่', 'The order or menu ID is invalid. Go back and choose again.')} /></AppScreen>;

  // Not the phone's full-screen editor on a tablet: its photo alone filled an
  // iPad (owner, 2026-09-19). The same editor at a phone's width instead, the
  // panel the order screen opens dishes in. The order screen and the served
  // page no longer come here on a tablet; editing a line from the bill does.
  if (width >= breakpoints.tablet) {
    return (
      <AppScreen
        title={editing
          ? copy('แก้ไขรายการ', 'Edit item')
          : served ? copy('เพิ่มรายการที่เสิร์ฟแล้ว', 'Add served item') : copy('เลือกเมนู', 'Choose menu item')}
        topLevel={false}
        scroll={false}
        contentMaxWidth={ORDER_PANEL_MAX_WIDTH}
      >
        <View style={{ minHeight: 0, flex: 1, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
          <OrderPanelFrame>
            <OrderItemPanel
              itemId={itemId}
              menuId={menuId}
              onDone={() => router.back()}
              orderId={orderId}
              served={served}
            />
          </OrderPanelFrame>
        </View>
      </AppScreen>
    );
  }

  return <PhoneOrderItemScreen itemId={itemId} menuId={menuId} orderId={orderId} served={served} />;
}

function PhoneOrderItemScreen({ orderId, menuId, itemId, served }: { orderId: number; menuId: number; itemId: number; served: boolean }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { copy } = useDisplayPreferences();
  const scrollControl = useRef<AppScreenScrollControl | null>(null);
  const editor = useOrderItemEditor({ orderId, menuId, itemId, served, onDone: () => router.back() });
  const noteKeyboard = useNoteKeyboardAlignment(scrollControl);
  // The image and the rules between sections run the full width of the screen,
  // so they have to escape the padding AppScreen puts on its content. Same
  // measure AppScreen uses, mirrored.
  const gutter = width >= breakpoints.tablet ? spacing.xxl : spacing.lg;

  return (
    <AppScreen
      title={editor.menu?.name || copy('เลือกเมนู', 'Choose menu item')}
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
      footer={editor.menu ? (
        <ActionDock>
          <OrderItemAddButton editor={editor} />
        </ActionDock>
      ) : undefined}
    >
      <OrderItemEditorBody
        editor={editor}
        gutter={gutter}
        // No menu means nothing has reserved the status bar, and the back
        // control is pinned over this same area, so the banner clears its
        // height too.
        missingTopInset={insets.top + 52}
        noteKeyboard={noteKeyboard}
      />
    </AppScreen>
  );
}
