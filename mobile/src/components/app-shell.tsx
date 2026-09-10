import { Redirect, router, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { BrandMark } from '@/src/components/brand-mark';
import { MotionReveal, useReducedMotion } from '@/src/components/motion';
import {
  useIsPrimaryTabsHost,
  usePrimaryTabSceneStatus,
} from '@/src/components/primary-tabs-runtime';
import {
  TabSwipeGestureProvider,
  useTabSwipeVerticalScrollActivityReporter,
} from '@/src/components/tab-swipe-context';
import { canUseAIAssistant } from '@/src/lib/ai-actions';
import {
  getAdjacentNavigationTarget,
  isPagerSwipeCooldownActive,
  notePagerVerticalScrollActivity,
  resolvePhoneNavigationIndicatorMetrics,
  resolvePagerSwipeSettlement,
  shouldStartPagerHorizontalSwipe,
} from '@/src/lib/navigation-runtime';
import {
  runManualRefresh,
  shouldShowTabletWorkspaceRail,
} from '@/src/lib/app-shell-runtime';
import { orderRoutePermissions } from '@/src/lib/permission-parity';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, radius, spacing, typeScale } from '@/src/theme';

export type NavItem = {
  key: string;
  label: string;
  labelEn: string;
  shortLabel: string;
  shortLabelEn: string;
  href: string;
  icon: AppIconName;
  activeIcon: AppIconName;
  permission?: string;
  fallbackPermission?: string;
  permissions?: readonly string[];
  roles?: string[];
  ownerOnly?: boolean;
};

export const primaryNavigation: NavItem[] = [
  { key: 'home', label: 'ภาพรวม', labelEn: 'Overview', shortLabel: 'ภาพรวม', shortLabelEn: 'Home', href: '/home', icon: 'home-outline', activeIcon: 'home', permission: 'view_dashboard' },
  { key: 'pos', label: 'รับออเดอร์', labelEn: 'Take orders', shortLabel: 'รับออเดอร์', shortLabelEn: 'Take order', href: '/tables', icon: 'restaurant-outline', activeIcon: 'restaurant', permission: 'take_order' },
  { key: 'kitchen', label: 'ครัว', labelEn: 'Kitchen', shortLabel: 'ครัว', shortLabelEn: 'Kitchen', href: '/kitchen', icon: 'flame-outline', activeIcon: 'flame', permission: 'view_kitchen' },
  { key: 'orders', label: 'ออเดอร์', labelEn: 'Orders', shortLabel: 'ออเดอร์', shortLabelEn: 'Orders', href: '/orders', icon: 'receipt-outline', activeIcon: 'receipt', permissions: orderRoutePermissions },
  { key: 'more', label: 'ระบบทั้งหมด', labelEn: 'All tools', shortLabel: 'เพิ่มเติม', shortLabelEn: 'More', href: '/more', icon: 'ellipsis-horizontal-circle-outline', activeIcon: 'ellipsis-horizontal-circle' },
];

const managementNavigation: NavItem[] = [
  { key: 'menu', label: 'เมนูอาหาร', labelEn: 'Menu', shortLabel: 'เมนู', shortLabelEn: 'Menu', href: '/menu', icon: 'book-outline', activeIcon: 'book', permission: 'view_menu', fallbackPermission: 'manage_menu' },
  { key: 'inventory', label: 'คลังวัตถุดิบ', labelEn: 'Inventory', shortLabel: 'คลัง', shortLabelEn: 'Stock', href: '/inventory', icon: 'cube-outline', activeIcon: 'cube', permission: 'view_inventory', fallbackPermission: 'manage_inventory' },
  { key: 'tables-manage', label: 'จัดการโต๊ะ', labelEn: 'Table management', shortLabel: 'โต๊ะ', shortLabelEn: 'Tables', href: '/table-management', icon: 'grid-outline', activeIcon: 'grid', permission: 'view_tables', fallbackPermission: 'manage_table' },
  { key: 'staff', label: 'พนักงาน', labelEn: 'Staff', shortLabel: 'ทีม', shortLabelEn: 'Team', href: '/staff', icon: 'people-outline', activeIcon: 'people', permissions: ['manage_invites', 'manage_members', 'manage_roles', 'view_audit_log'] },
  { key: 'reports', label: 'รายงาน', labelEn: 'Reports', shortLabel: 'รายงาน', shortLabelEn: 'Reports', href: '/reports', icon: 'bar-chart-outline', activeIcon: 'bar-chart', permission: 'view_reports' },
  { key: 'expenses', label: 'ค่าใช้จ่าย', labelEn: 'Expenses', shortLabel: 'ค่าใช้จ่าย', shortLabelEn: 'Expenses', href: '/expenses', icon: 'cash-outline', activeIcon: 'cash', permissions: ['manage_expenses', 'view_reports'] },
  { key: 'ai', label: 'Dishy AI', labelEn: 'Dishy AI', shortLabel: 'AI', shortLabelEn: 'AI', href: '/ai-assistant', icon: 'sparkles-outline', activeIcon: 'sparkles', ownerOnly: true },
  { key: 'settings', label: 'ตั้งค่า', labelEn: 'Settings', shortLabel: 'ตั้งค่า', shortLabelEn: 'Settings', href: '/settings', icon: 'settings-outline', activeIcon: 'settings' },
];

export function isAllowed(item: NavItem, membership: ReturnType<typeof useAuth>['activeMembership']) {
  if (item.ownerOnly && !canUseAIAssistant(membership?.role?.name)) return false;
  if (item.roles && !item.roles.includes(membership?.role?.name || '')) return false;
  if (item.permissions?.length) return item.permissions.some((permission) => can(membership, permission));
  if (!item.permission) return true;
  return can(membership, item.permission) || Boolean(item.fallbackPermission && can(membership, item.fallbackPermission));
}

export function isActivePath(pathname: string, href: string) {
  if (href === '/home') return pathname === '/home';
  if (href === '/tables') return pathname === '/tables' || pathname.startsWith('/order/');
  if (href === '/more') {
    return pathname === '/more' || managementNavigation.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A handle on AppScreen's scroll view, for the rare screen that has to move it
 * itself.
 *
 * `automaticallyAdjustKeyboardInsets` only promises the *caret* clears the
 * keyboard: iOS measures the selection rect, not the field
 * (`RCTTextInputComponentView.reactUpdateResponderOffsetForScrollView`). On a
 * single-line input those are the same thing. On a three-line note box the caret
 * sits on the first line, so iOS is satisfied while two thirds of the box — and
 * whatever follows it — stay behind the keyboard.
 *
 * Handed out through a ref prop rather than context, because the screen that
 * needs it renders `<AppScreen>` — it is the shell's PARENT, so a provider
 * inside the shell is invisible to it and every read comes back null.
 */
export type AppScreenScrollControl = {
  /** Scroll to an absolute content offset. Negative values clamp to the top. */
  scrollTo: (y: number, animated?: boolean) => void;
  /** Where the view is right now, so a caller can turn a measurement taken in
   *  window space into an absolute destination. Deliberately not a `scrollBy`:
   *  a delta is resolved against the offset at the moment it is APPLIED, and the
   *  keyboard moves this view underneath us — pairing a stale measurement with a
   *  fresh offset overshoots. Reading both at the same instant and sending an
   *  absolute target cannot drift, whatever else is scrolling at the time. */
  getOffset: () => number;
};

type NavigationMode = 'rail' | 'expanded';

function NavigationButton({
  item,
  mode,
  onSelect,
}: {
  item: NavItem;
  mode: NavigationMode;
  onSelect?: () => void;
}) {
  const pathname = usePathname();
  const { language } = useDisplayPreferences();
  const active = isActivePath(pathname, item.href);
  const label = language === 'th' ? item.label : item.labelEn;
  const shortLabel = language === 'th' ? item.shortLabel : item.shortLabelEn;
  const expanded = mode === 'expanded';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={() => {
        if (onSelect) {
          onSelect();
          return;
        }
        if (pathname !== item.href) router.replace(item.href as never);
      }}
      style={({ pressed }) => ({
        position: 'relative',
        minHeight: expanded ? 44 : 58,
        flexDirection: !expanded ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: !expanded ? 'center' : 'flex-start',
        gap: expanded ? spacing.md : 3,
        borderWidth: active ? 1 : 0,
        borderColor: active ? palette.navigationMuted : 'transparent',
        borderRadius: radius.md,
        backgroundColor: active ? palette.navigationActive : 'transparent',
        paddingHorizontal: expanded ? spacing.md : spacing.xs,
        opacity: pressed ? 0.68 : 1,
      })}
    >
      <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: active ? palette.accentMuted : 'transparent' }}>
        <AppIcon
          color={active ? palette.navigationActiveText : palette.navigationMuted}
          name={active ? item.activeIcon : item.icon}
          size={20}
        />
      </View>
      <Text numberOfLines={expanded ? 1 : 2} style={{ flex: expanded ? 1 : undefined, color: active ? palette.navigationActiveText : palette.navigationMuted, fontSize: expanded ? 13 : 10, lineHeight: expanded ? 18 : 13, textAlign: !expanded ? 'center' : 'left', fontWeight: active ? '700' : '600' }}>
        {expanded ? label : shortLabel}
      </Text>
    </Pressable>
  );
}

function BrandBlock({ expanded }: { expanded: boolean }) {
  return (
    <View style={{ minHeight: 64, flexDirection: expanded ? 'row' : 'column', alignItems: 'center', justifyContent: expanded ? 'flex-start' : 'center', gap: spacing.sm, paddingHorizontal: expanded ? spacing.sm : 0 }}>
      <BrandMark inverse showName={expanded} size={36} />
    </View>
  );
}

export function PrimaryTabletRail({
  expanded,
  onSelectPrimary,
}: {
  expanded: boolean;
  onSelectPrimary?: (item: NavItem) => void;
}) {
  const { activeMembership } = useAuth();
  const primary = primaryNavigation.filter((item) => (!expanded || item.key !== 'more') && isAllowed(item, activeMembership));
  const management = managementNavigation.filter((item) => item.key !== 'settings' && isAllowed(item, activeMembership));

  return (
    <SafeAreaView edges={['top', 'bottom', 'left']} style={{ width: expanded ? 232 : 92, borderRightWidth: 1, borderRightColor: palette.navigationBorder, backgroundColor: palette.navigationSurface, paddingHorizontal: expanded ? spacing.md : spacing.sm }}>
      <BrandBlock expanded={expanded} />
      <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.sm }} showsVerticalScrollIndicator={false}>
        {primary.map((item) => (
          <NavigationButton
            item={item}
            key={item.key}
            mode={expanded ? 'expanded' : 'rail'}
            onSelect={onSelectPrimary ? () => onSelectPrimary(item) : undefined}
          />
        ))}
        {expanded ? (
          <>
            <View style={{ height: 1, backgroundColor: palette.navigationMuted, marginVertical: spacing.sm }} />
            {management.map((item) => <NavigationButton item={item} key={item.key} mode="expanded" />)}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export function TabletWorkspaceFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { activeMembership, status, user } = useAuth();
  const isOnPrimaryRoot = primaryNavigation.some((item) => pathname === item.href);
  const navigateToPrimaryRoot = useCallback((item: NavItem) => {
    if (pathname !== item.href) router.navigate(item.href as never);
  }, [pathname]);
  const showRail = shouldShowTabletWorkspaceRail({
    activeMembership: Boolean(activeMembership),
    authStatus: status,
    pathname,
    tabletBreakpoint: breakpoints.tablet,
    user: Boolean(user),
    width,
  });

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        backgroundColor: showRail ? palette.canvas : palette.surface,
      }}
    >
      {showRail ? (
        <PrimaryTabletRail
          expanded={width >= breakpoints.expandedRail}
          onSelectPrimary={isOnPrimaryRoot ? navigateToPrimaryRoot : undefined}
        />
      ) : null}
      <View key="workspace-content" style={{ minWidth: 0, flex: 1 }}>
        {children}
      </View>
    </View>
  );
}

const PHONE_DOCK_HEIGHT = 53;
const PHONE_DOCK_RADIUS = PHONE_DOCK_HEIGHT / 2;
const PHONE_ACTIVE_INDICATOR_INSET = 4;
const PHONE_ACTIVE_INDICATOR_RADIUS = (
  PHONE_DOCK_HEIGHT - PHONE_ACTIVE_INDICATOR_INSET * 2
) / 2;
const PHONE_DOCK_TOP_GUTTER = 22;
const PHONE_DOCK_BOTTOM_GAP_SCALE = 0.8;
const PHONE_DOCK_ADDITIONAL_DROP = 10;
const TAB_MOTION_EASING = Easing.bezier(0.16, 1, 0.3, 1);

function phoneDockBottomGap(bottomInset: number) {
  return Math.max(
    0,
    Math.round((spacing.sm + bottomInset) * PHONE_DOCK_BOTTOM_GAP_SCALE)
      - PHONE_DOCK_ADDITIONAL_DROP,
  );
}

export function PrimaryPhoneNavigation({
  accessibilitySelectedIndex,
  items,
  selectedIndex,
  markerPosition,
  onSelect,
}: {
  accessibilitySelectedIndex?: number;
  items: NavItem[];
  selectedIndex: number;
  markerPosition: Animated.Value;
  onSelect: (index: number) => void;
}) {
  const { copy, language } = useDisplayPreferences();
  const insets = useSafeAreaInsets();
  const [dockWidth, setDockWidth] = useState(0);
  const indicatorMetrics = resolvePhoneNavigationIndicatorMetrics(
    dockWidth,
    items.length,
    PHONE_ACTIVE_INDICATOR_INSET,
  );
  const slotWidth = indicatorMetrics?.slotWidth ?? 0;
  const markerTranslate = Animated.multiply(markerPosition, slotWidth);
  const onDockLayout = useCallback((event: LayoutChangeEvent) => {
    setDockWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <SafeAreaView
      edges={['left', 'right']}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 20,
        backgroundColor: 'transparent',
      }}
    >
      <View
        pointerEvents="box-none"
        style={{
          paddingTop: PHONE_DOCK_TOP_GUTTER,
          paddingBottom: phoneDockBottomGap(insets.bottom),
        }}
      >
        <View
          style={{
            height: PHONE_DOCK_HEIGHT,
            marginHorizontal: spacing.lg,
            borderRadius: PHONE_DOCK_RADIUS,
            backgroundColor: palette.navigationSurface,
            shadowColor: palette.shadow,
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.2,
            shadowRadius: 16,
            elevation: 12,
          }}
        >
          <View
            accessibilityLabel={copy('แถบนำทางหลัก ปัดหน้าจอซ้ายหรือขวาเพื่อเปลี่ยนแท็บ', 'Main navigation. Swipe the screen left or right to change tabs.')}
            accessibilityRole="tablist"
            onLayout={onDockLayout}
            style={{
              height: PHONE_DOCK_HEIGHT,
              flexDirection: 'row',
              overflow: 'hidden',
              borderRadius: PHONE_DOCK_RADIUS,
              backgroundColor: palette.navigationSurface,
            }}
          >
            {indicatorMetrics && selectedIndex >= 0 && selectedIndex < items.length ? (
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: indicatorMetrics.indicatorInset,
                  bottom: indicatorMetrics.indicatorInset,
                  left: indicatorMetrics.indicatorInset,
                  width: indicatorMetrics.indicatorWidth,
                  borderRadius: PHONE_ACTIVE_INDICATOR_RADIUS,
                  backgroundColor: palette.navigationActive,
                  transform: [{ translateX: markerTranslate }],
                  zIndex: 0,
                }}
              />
            ) : null}
            {items.map((item, index) => {
              const active = index === selectedIndex;
              const accessibilitySelected = index === (
                accessibilitySelectedIndex ?? selectedIndex
              );
              const label = language === 'th' ? item.label : item.labelEn;
              return (
                <Pressable
                  accessibilityLabel={label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: accessibilitySelected }}
                  aria-selected={accessibilitySelected}
                  key={item.key}
                  onPress={() => onSelect(index)}
                  style={({ pressed }) => ({
                    minWidth: 48,
                    minHeight: PHONE_DOCK_HEIGHT,
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 2,
                    opacity: pressed ? 0.68 : 1,
                    zIndex: 1,
                  })}
                >
                  <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                    <AppIcon
                      color={active ? palette.navigationActiveText : palette.navigationMuted}
                      name={active ? item.activeIcon : item.icon}
                      size={27}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

// Android renders a scroll view's refreshControl as the OUTER element, cloning it
// with the scroll view injected as children:
//   cloneElement(refreshControl, { style }, <ScrollView>...</ScrollView>)
// So this wrapper has to pass whatever it is handed straight through - dropping
// `children` drops the entire screen, which is what left every tab that pulls to
// refresh blank on Android while /more (the one screen with no refreshControl)
// still rendered. iOS puts the control inside the scroll view instead, so it
// never needed the forwarding and never showed the bug.
export function AppRefreshControl({
  onRefresh,
  ...rest
}: {
  onRefresh: () => void | Promise<void>;
} & Omit<React.ComponentProps<typeof RefreshControl>, 'onRefresh' | 'refreshing'>) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    void runManualRefresh(onRefresh, (nextRefreshing) => {
      refreshingRef.current = nextRefreshing;
      if (mountedRef.current) setRefreshing(nextRefreshing);
    }).catch(() => undefined);
  }, [onRefresh]);

  return (
    <RefreshControl
      {...rest}
      colors={[palette.accent]}
      onRefresh={refresh}
      progressBackgroundColor={palette.surface}
      refreshing={refreshing}
      tintColor={palette.accent}
    />
  );
}

function ScreenHeading({
  title,
  titleContent,
  subtitle,
  action,
  showBack = false,
  centerTitle = false,
}: {
  title: string;
  titleContent?: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  showBack?: boolean;
  centerTitle?: boolean;
}) {
  const { copy } = useDisplayPreferences();
  return (
    // With a subtitle the text block is tall enough that top-alignment reads
    // correctly. Without one it is a single line against a 44px back button,
    // and top-aligning leaves the chevron sitting 8px below the title.
    <View style={{ flexDirection: 'row', alignItems: subtitle ? 'flex-start' : 'center', gap: spacing.md }}>
      {showBack ? (
        <Pressable
          accessibilityLabel={copy('ย้อนกลับ', 'Go back')}
          accessibilityRole="button"
          hitSlop={4}
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <AppIcon color={palette.textStrong} name="chevron-back-outline" size={30} />
        </Pressable>
      ) : null}
      {/* A single-line title against 44pt action buttons has to centre on them.
          Top-aligning it leaves the text sitting in the corner while the buttons
          sit in the middle of the row, which reads as the heading having floated
          up and drifted out to the left. With a subtitle the text block is the
          taller of the two and top alignment is correct again. */}
      <View style={{ minWidth: 0, flex: 1, flexDirection: 'row', alignItems: subtitle ? 'flex-start' : 'center', gap: spacing.md }}>
        {/* No gap: the two lines belong to each other, and the leading built
            into each line already separates them. */}
        <View style={{ minWidth: 0, flex: 1 }}>
          {titleContent ?? (
            <Text accessibilityRole="header" selectable style={[typeScale.hero, centerTitle ? { textAlign: 'center' } : null]}>{title}</Text>
          )}
          {subtitle ? <Text selectable style={[typeScale.body, { color: palette.muted }, centerTitle ? { textAlign: 'center' } : null]}>{subtitle}</Text> : null}
        </View>
        {action ? <View style={subtitle ? { paddingTop: 1 } : undefined}>{action}</View> : null}
      </View>
      {/* Centring text inside a row that starts with a 44px back control leaves
          the title 44px right of the screen's centre line. This mirrors that
          width on the trailing side so the centre is the real one. An `action`
          already balances the row, so it takes the place of the spacer. */}
      {centerTitle && showBack && !action ? <View style={{ width: 44 }} /> : null}
    </View>
  );
}

export function AppScreen({
  title,
  titleContent,
  subtitle,
  children,
  topLevel = false,
  action,
  beforeHeading,
  refreshControl,
  scroll = true,
  footer,
  contentStyle,
  contentMaxWidth,
  stickyHeading = false,
  stickyContent,
  onScrollStart,
  centerTitle = false,
  immersive = false,
  floatingLeading,
  scrollControlRef,
}: {
  title: string;
  titleContent?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  topLevel?: boolean;
  action?: React.ReactNode;
  beforeHeading?: React.ReactNode;
  refreshControl?: React.ReactElement<React.ComponentProps<typeof RefreshControl>>;
  scroll?: boolean;
  footer?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  contentMaxWidth?: number;
  /** Keep the title, back control and header action pinned while the content
   *  scrolls under them. Opt-in: it costs permanent vertical space, which is
   *  only worth paying on a screen long enough to lose your place in. */
  stickyHeading?: boolean;
  /** Controls that stay pinned under the heading — filters a long list is read
   *  through, which are useless once they have scrolled away. Needs
   *  `stickyHeading`, since it renders inside that same pinned block. */
  stickyContent?: React.ReactNode;
  /** Fires when the reader starts dragging the content. Deliberately the drag,
   *  not every scroll event: focusing a field can scroll the view on its own,
   *  and a screen that reacts to that would undo what the reader just opened. */
  onScrollStart?: () => void;
  /** Give the whole screen to the content: no heading row, and nothing reserved
   *  for the status bar, so the first thing in `children` starts at the very top
   *  edge of the display. For a screen led by a full-bleed image, which then has
   *  to supply its own back control positioned over it — there is no header row
   *  left to put one in. */
  immersive?: boolean;
  /** A control pinned to the screen's top-left corner, above everything and
   *  outside the scroll view, so it stays put while the content moves under it.
   *  For an `immersive` screen, which has no header row to hold a back button —
   *  putting one inside the content instead would scroll away with the image and
   *  leave no way out of the screen. */
  floatingLeading?: React.ReactNode;
  /** Sit the title on the screen's centre line instead of hard left. Opt-in:
   *  a left-aligned title is the app's default and reads faster in a stack of
   *  content, so this is for screens that are a single self-contained record. */
  centerTitle?: boolean;
  /** Filled with a handle on the scroll view so the screen can move it itself.
   *  See AppScreenScrollControl for the one thing that needs this. */
  scrollControlRef?: React.MutableRefObject<AppScreenScrollControl | null>;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { status, user, activeMembership } = useAuth();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const embeddedInPrimaryTabs = useIsPrimaryTabsHost();
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();
  const reportParentVerticalScrollActivity = useTabSwipeVerticalScrollActivityReporter();
  const isTablet = width >= breakpoints.tablet;
  const screenBackground = isTablet ? palette.canvas : palette.surface;
  const horizontalPadding = isTablet ? spacing.xxl : spacing.lg;
  const maxWidth = contentMaxWidth || (isTablet ? 1180 : 720);
  const phoneDockClearance = PHONE_DOCK_HEIGHT
    + PHONE_DOCK_TOP_GUTTER
    + phoneDockBottomGap(insets.bottom)
    + spacing.lg;
  const scrollRef = useRef<ScrollView>(null);
  // Read back by `scrollBy`. RN offers no way to ask a ScrollView where it is,
  // and every alternative for "move this field up by exactly its overlap" needs
  // the number anyway.
  const contentOffsetRef = useRef(0);
  const phoneNavigationItems = useMemo(
    () => primaryNavigation.filter((item) => isAllowed(item, activeMembership)),
    [activeMembership],
  );
  const activeTabIndex = phoneNavigationItems.findIndex((item) =>
    isActivePath(pathname, item.href),
  );
  const markerPosition = useRef(
    new Animated.Value(Math.max(activeTabIndex, 0)),
  ).current;
  const contentTranslateX = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const navigationLocked = useRef(false);
  const nestedHorizontalGestureActive = useRef(false);
  const pagerSwipeBlockedUntilRef = useRef(0);
  const pagerSwipeTouchBlockedRef = useRef(false);
  const navigationFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedTabIndex, setSelectedTabIndex] = useState(activeTabIndex);
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    if (navigationFallbackTimer.current) {
      clearTimeout(navigationFallbackTimer.current);
      navigationFallbackTimer.current = null;
    }
    navigationLocked.current = false;
    nestedHorizontalGestureActive.current = false;
    pagerSwipeBlockedUntilRef.current = 0;
    pagerSwipeTouchBlockedRef.current = false;
    contentTranslateX.setValue(0);
    contentOpacity.setValue(1);
    setSelectedTabIndex(activeTabIndex);
    if (activeTabIndex >= 0) markerPosition.setValue(activeTabIndex);
  }, [activeTabIndex, contentOpacity, contentTranslateX, markerPosition, pathname]);

  useEffect(
    () => () => {
      if (navigationFallbackTimer.current) {
        clearTimeout(navigationFallbackTimer.current);
        navigationFallbackTimer.current = null;
      }
      markerPosition.stopAnimation();
      contentTranslateX.stopAnimation();
      contentOpacity.stopAnimation();
    },
    [contentOpacity, contentTranslateX, markerPosition],
  );

  const resetTabDrag = useCallback(() => {
    if (navigationFallbackTimer.current) {
      clearTimeout(navigationFallbackTimer.current);
      navigationFallbackTimer.current = null;
    }
    setSelectedTabIndex(activeTabIndex);
    if (reducedMotion) {
      contentTranslateX.setValue(0);
      contentOpacity.setValue(1);
      if (activeTabIndex >= 0) markerPosition.setValue(activeTabIndex);
      navigationLocked.current = false;
      return;
    }

    Animated.parallel([
      Animated.timing(contentTranslateX, {
        toValue: 0,
        duration: 170,
        easing: TAB_MOTION_EASING,
        useNativeDriver,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 140,
        easing: TAB_MOTION_EASING,
        useNativeDriver,
      }),
      ...(activeTabIndex >= 0
        ? [Animated.timing(markerPosition, {
          toValue: activeTabIndex,
          duration: 170,
          easing: TAB_MOTION_EASING,
          useNativeDriver,
        })]
        : []),
    ]).start(() => {
      navigationLocked.current = false;
    });
  }, [activeTabIndex, contentOpacity, contentTranslateX, markerPosition, reducedMotion, useNativeDriver]);

  useEffect(() => {
    if (!scrollControlRef) return undefined;
    const scrollTo = (y: number, animated = true) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y), animated });
    };
    scrollControlRef.current = {
      scrollTo,
      getOffset: () => contentOffsetRef.current,
    };
    return () => {
      scrollControlRef.current = null;
    };
  }, [scrollControlRef]);

  const setNestedHorizontalGestureActive = useCallback((active: boolean) => {
    nestedHorizontalGestureActive.current = active;
  }, []);

  const reportVerticalScrollActivity = useCallback((activityTimeMs: number) => {
    pagerSwipeBlockedUntilRef.current = notePagerVerticalScrollActivity(
      pagerSwipeBlockedUntilRef.current,
      activityTimeMs,
    );
    if (primaryTabSceneStatus === null || primaryTabSceneStatus === 'active') {
      reportParentVerticalScrollActivity(activityTimeMs);
    }
  }, [primaryTabSceneStatus, reportParentVerticalScrollActivity]);

  const reportVerticalScrollNow = useCallback(() => {
    reportVerticalScrollActivity(Date.now());
  }, [reportVerticalScrollActivity]);

  const navigateToTab = useCallback((targetIndex: number, fromSwipe = false) => {
    const target = phoneNavigationItems[targetIndex];
    if (!target || navigationLocked.current) return;

    if (targetIndex === activeTabIndex) {
      if (pathname !== target.href) router.replace(target.href as never);
      return;
    }

    if (activeTabIndex < 0 || reducedMotion) {
      setSelectedTabIndex(targetIndex);
      markerPosition.setValue(targetIndex);
      contentTranslateX.setValue(0);
      contentOpacity.setValue(1);
      router.replace(target.href as never);
      return;
    }

    navigationLocked.current = true;
    setSelectedTabIndex(targetIndex);
    const direction = targetIndex > activeTabIndex ? 1 : -1;
    const exitDistance = fromSwipe ? width * 0.5 : Math.min(width * 0.42, 168);

    Animated.parallel([
      Animated.timing(markerPosition, {
        toValue: targetIndex,
        duration: 220,
        easing: TAB_MOTION_EASING,
        useNativeDriver,
      }),
      Animated.timing(contentTranslateX, {
        toValue: -direction * exitDistance,
        duration: 200,
        easing: TAB_MOTION_EASING,
        useNativeDriver,
      }),
      Animated.timing(contentOpacity, {
        toValue: 0.92,
        duration: 160,
        easing: TAB_MOTION_EASING,
        useNativeDriver,
      }),
    ]).start(({ finished }) => {
      if (!finished) {
        resetTabDrag();
        return;
      }
      navigationFallbackTimer.current = setTimeout(() => {
        navigationFallbackTimer.current = null;
        resetTabDrag();
      }, 450);
      router.replace(target.href as never);
    });
  }, [activeTabIndex, contentOpacity, contentTranslateX, markerPosition, pathname, phoneNavigationItems, reducedMotion, resetTabDrag, useNativeDriver, width]);

  const tabSwipeResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      pagerSwipeTouchBlockedRef.current = isPagerSwipeCooldownActive(
        pagerSwipeBlockedUntilRef.current,
        Date.now(),
      );
      return false;
    },
    onMoveShouldSetPanResponder: (_, gesture) => {
      if (isPagerSwipeCooldownActive(
        pagerSwipeBlockedUntilRef.current,
        Date.now(),
      )) {
        pagerSwipeTouchBlockedRef.current = true;
      }
      if (
        embeddedInPrimaryTabs ||
        !topLevel ||
        isTablet ||
        navigationLocked.current ||
        nestedHorizontalGestureActive.current ||
        activeTabIndex < 0 ||
        phoneNavigationItems.length < 2 ||
        gesture.numberActiveTouches !== 1
      ) {
        return false;
      }
      return shouldStartPagerHorizontalSwipe({
        deltaX: gesture.dx,
        deltaY: gesture.dy,
      }, pagerSwipeTouchBlockedRef.current);
    },
    onPanResponderGrant: () => {
      contentTranslateX.stopAnimation();
      contentOpacity.stopAnimation();
      markerPosition.stopAnimation();
    },
    onPanResponderMove: (_, gesture) => {
      if (reducedMotion || activeTabIndex < 0) return;
      const direction = gesture.dx < 0 ? 1 : -1;
      const adjacent = getAdjacentNavigationTarget(
        phoneNavigationItems,
        activeTabIndex,
        direction,
      );
      const resistance = adjacent ? 1 : 0.18;
      const maxDrag = width * 0.5;
      const resistedDrag = gesture.dx * resistance;
      const drag = Math.max(-maxDrag, Math.min(maxDrag, resistedDrag));
      const markerProgress = activeTabIndex - drag / Math.max(width, 1);
      const boundedMarker = Math.max(
        0,
        Math.min(phoneNavigationItems.length - 1, markerProgress),
      );

      contentTranslateX.setValue(drag);
      contentOpacity.setValue(1 - Math.min(Math.abs(drag) / Math.max(width * 8, 1), 0.05));
      markerPosition.setValue(boundedMarker);
    },
    onPanResponderRelease: (_, gesture) => {
      const settlement = resolvePagerSwipeSettlement(
        phoneNavigationItems,
        activeTabIndex,
        {
          deltaX: gesture.dx,
          deltaY: gesture.dy,
          velocityX: gesture.vx * 1000,
        },
        width,
      );

      if (!settlement?.shouldNavigate) {
        resetTabDrag();
        return;
      }
      navigateToTab(settlement.targetIndex, true);
    },
    onPanResponderTerminate: resetTabDrag,
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => false,
  }), [activeTabIndex, contentOpacity, contentTranslateX, embeddedInPrimaryTabs, isTablet, markerPosition, navigateToTab, phoneNavigationItems, reducedMotion, resetTabDrag, topLevel, width]);

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: screenBackground }} />;
  if (!user) return <Redirect href="/login" />;
  if (!activeMembership) return <Redirect href="/restaurants" />;

  const heading = (
    <MotionReveal style={{ gap: spacing.xl }}>
      {beforeHeading}
      <ScreenHeading
        action={action}
        centerTitle={centerTitle}
        showBack={!topLevel}
        subtitle={subtitle}
        title={title}
        titleContent={titleContent}
      />
    </MotionReveal>
  );
  const pinnedHeading = scroll && stickyHeading ? (
    <View
      style={{
        alignItems: 'center',
        paddingHorizontal: horizontalPadding,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        backgroundColor: screenBackground,
      }}
    >
      <View style={{ width: '100%', maxWidth, gap: spacing.md }}>
        {heading}
        {stickyContent}
      </View>
    </View>
  ) : null;
  const main = scroll ? (
    <ScrollView
      // `automatic` lets iOS inset the scroll content by the safe area on its
      // own — which is right everywhere else, and is exactly what leaves a band
      // of empty canvas above an immersive screen's first element. The whole
      // point of immersive is that the content starts at the top of the display,
      // so here the shell owns the inset and iOS must keep its hands off.
      contentInsetAdjustmentBehavior={immersive ? 'never' : 'automatic'}
      // Every form in this app lives inside AppScreen, and the shell handled the
      // keyboard nowhere: focus a field low on the page and the keyboard covered
      // the very box being typed into. Only the auth and assistant screens ever
      // dealt with it, each with its own KeyboardAvoidingView.
      //
      // This is the whole of it. An earlier version also padded the content by
      // the keyboard's height, which double-counts: iOS is already adding that
      // same height as a bottom contentInset here, so the page gained two
      // keyboards' worth of slack and could be dragged up into a screenful of
      // empty canvas. A field that needs more than the caret visible asks for it
      // through `scrollControlRef`.
      automaticallyAdjustKeyboardInsets
      // An immersive screen is led by an image flush to the top of the display,
      // and the rubber band drags it away to show a band of bare canvas. This is
      // a real hard stop rather than a clamp: an earlier version left `bounces`
      // on and snapped a negative offset back to 0 in `onScroll`, which is a
      // frame late by construction — the page visibly jumped every time it was
      // pulled, and read as exactly what it was.
      //
      // It costs the rubber band in both directions, which on a page shorter than
      // the display is all the movement the screen has. That is now the intended
      // feel: the page is solid, and the one case that genuinely needed to move —
      // clearing the keyboard — is driven from `scrollControlRef` instead of left
      // to the reader's thumb.
      bounces={!immersive}
      overScrollMode={immersive ? 'never' : 'auto'}
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingHorizontal: horizontalPadding, paddingTop: immersive ? 0 : spacing.lg, paddingBottom: topLevel && !isTablet ? phoneDockClearance : spacing.xxxl }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onMomentumScrollBegin={reportVerticalScrollNow}
      onMomentumScrollEnd={reportVerticalScrollNow}
      onScroll={(event) => {
        contentOffsetRef.current = event.nativeEvent.contentOffset.y;
        reportVerticalScrollNow();
      }}
      onScrollBeginDrag={() => {
        reportVerticalScrollNow();
        onScrollStart?.();
      }}
      onScrollEndDrag={reportVerticalScrollNow}
      ref={scrollRef}
      refreshControl={refreshControl}
      scrollEventThrottle={32}
    >
      <View style={[{ width: '100%', maxWidth, gap: spacing.xl }, contentStyle]}>
        {stickyHeading || immersive ? null : heading}
        {children}
      </View>
    </ScrollView>
  ) : (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: horizontalPadding, paddingTop: spacing.lg, paddingBottom: topLevel && !isTablet ? phoneDockClearance : 0 }}>
      <View style={[{ width: '100%', maxWidth, flex: 1, gap: spacing.lg }, contentStyle]}>
        {heading}
        <View style={{ minHeight: 0, flex: 1 }}>{children}</View>
      </View>
    </View>
  );

  const animatedContent = (
    <Animated.View
      style={{
        minHeight: 0,
        flex: 1,
        backgroundColor: screenBackground,
        opacity: contentOpacity,
        transform: [{ translateX: contentTranslateX }],
      }}
    >
      {immersive ? null : (
        <SafeAreaView
          edges={isTablet ? ['top', 'right'] : ['top', 'left', 'right']}
          style={{ backgroundColor: screenBackground }}
        />
      )}
      {pinnedHeading}
      {main}
      {footer ? <SafeAreaView edges={isTablet ? ['right', 'bottom'] : ['left', 'right', 'bottom']} style={{ backgroundColor: palette.surface }}>{footer}</SafeAreaView> : null}
      {/* Outside the scroll view AND outside the keyboard avoider: the content
          moves under it and it stays where it is. Inside the scroll view it
          would scroll off with the first screenful and take the only way back
          with it; inside the avoider it would shift when a keyboard opened. */}
      {floatingLeading ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', top: insets.top, left: horizontalPadding, zIndex: 10 }}
        >
          {floatingLeading}
        </View>
      ) : null}
    </Animated.View>
  );

  const content = (
    <View style={{ flex: 1, backgroundColor: screenBackground }}>
      {embeddedInPrimaryTabs ? animatedContent : (
        <TabSwipeGestureProvider
          reportVerticalScrollActivity={reportVerticalScrollActivity}
          setNestedHorizontalGestureActive={setNestedHorizontalGestureActive}
        >
          {animatedContent}
        </TabSwipeGestureProvider>
      )}
    </View>
  );

  return content;
}

export const appNavigation = { primaryNavigation, managementNavigation, isAllowed };
