import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { ORDER_PANEL_MAX_WIDTH, ORDER_PANEL_MIN_WIDTH, OrderPanelFrame } from '@/src/components/order-item-editor';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { radius, spacing, statusTone, typeScale } from '@/src/theme';

/**
 * The order screen on a tablet: the dish grid on one side and, beside it, a
 * phone-width panel the chosen dish opens in. On an iPad the item screen used
 * to take the whole display, its photo alone filling it (owner, 2026-09-19).
 * The split is there before anything is chosen, holding a grey placeholder.
 *
 * The grid gets 65 parts of the width and the panel 35, the owner's starting
 * guess, with the panel held to a phone's width either way: a portrait iPad
 * cannot spare 35% for a panel anyone could read, and a 13-inch one would
 * stretch it.
 *
 * The screen's own AppScreen does not scroll in this layout; each side scrolls
 * by itself, so choosing options never moves the grid and browsing the grid
 * never moves the dish.
 *
 * The screen's heading belongs to the grid's column, not across both: the
 * panel runs from the top of the screen, and the heading's own action - the
 * order's item count - sits at the top right of the grid (owner, 2026-09-19).
 */
export function OrderMenuSplit({
  header,
  filterBar,
  footer,
  panel,
  refreshControl,
  children,
}: {
  /** The screen's heading, drawn over the grid's column only. The screen
   *  passes `hideTitle` to AppScreen so it is not drawn twice. */
  header?: React.ReactNode;
  /** Pinned over the grid, not scrolled with it. */
  filterBar?: React.ReactNode;
  /** Under the grid, in the grid's column: the round's basket. */
  footer?: React.ReactNode;
  panel: React.ReactNode;
  refreshControl?: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ minHeight: 0, flex: 1, flexDirection: 'row', gap: spacing.xxl, paddingBottom: Math.max(insets.bottom, spacing.lg) }}>
      <View style={{ minWidth: 0, flexGrow: 65, flexShrink: 1, flexBasis: 0, gap: spacing.md }}>
        {/* spacing.lg under the heading in all, the same space AppScreen puts
            between a heading and the content below it. */}
        {header ? <View style={{ paddingBottom: spacing.xs }}>{header}</View> : null}
        {filterBar}
        <ScrollView
          style={{ minHeight: 0, flex: 1 }}
          // No `automaticallyAdjustKeyboardInsets`. With it, focusing the dish
          // panel's note - a field outside this scroll view that carries the
          // Done bar - made React Native scroll the whole grid by the keyboard's
          // height (RCTScrollViewComponentView treats an outside field with an
          // accessory view as if the field rode on the keyboard). A drag puts
          // the search keyboard away instead.
          contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
          // A search result is what gets tapped here, so a tap with the keyboard
          // up has to reach the tile instead of only putting the keyboard away.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {/* Lifted by the panel's border and its dock's padding, so the basket
            and the add button beside it end on the same line. */}
        {footer ? <View style={{ paddingBottom: spacing.md + 1 }}>{footer}</View> : null}
      </View>
      <View style={{ minWidth: ORDER_PANEL_MIN_WIDTH, maxWidth: ORDER_PANEL_MAX_WIDTH, flexGrow: 35, flexShrink: 1, flexBasis: 0 }}>
        <OrderPanelFrame>{panel}</OrderPanelFrame>
      </View>
    </View>
  );
}

/**
 * The panel before a dish is chosen. Grey, one icon and the plain fact that
 * nothing is chosen yet - the owner asked for it empty rather than explained.
 */
export function OrderItemPanelPlaceholder() {
  const { copy } = useDisplayPreferences();
  const tone = statusTone('muted');
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xxl }}>
      <View
        style={{
          width: 72,
          height: 72,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.full,
          backgroundColor: tone.backgroundColor,
        }}
      >
        <AppIcon color={tone.color} name="restaurant-outline" size={32} />
      </View>
      <Text selectable style={[typeScale.body, { color: tone.color, fontWeight: '500', textAlign: 'center' }]}>
        {copy('ยังไม่ได้เลือกเมนู', 'No dish chosen')}
      </Text>
    </View>
  );
}
