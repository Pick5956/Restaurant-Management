import { Redirect, router, useNavigationContainerRef, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { BrandMark } from '@/src/components/brand-mark';
import { CompactHeader } from '@/src/components/compact-header';
import { MotionReveal, useReducedMotion } from '@/src/components/motion';
import {
  useIsPrimaryTabsHost,
  usePrimaryTabSceneStatus,
  usePublishPrimaryTabStage,
} from '@/src/components/primary-tabs-runtime';
import {
  TabSwipeGestureProvider,
  useTabSwipeVerticalScrollActivityReporter,
} from '@/src/components/tab-swipe-context';
import { canUseAIAssistant } from '@/src/lib/ai-actions';
import {
  runManualRefresh,
  shouldShowTabletWorkspaceRail,
} from '@/src/lib/app-shell-runtime';
import {
  COMPACT_HEADER_BAND,
  COMPACT_ROW_BAND,
  compactHeaderProgress,
  compactHeaderRange,
  compactRowHandoff,
  compactRowProgress,
  compactRowRange,
  nextCompactShown,
} from '@/src/lib/compact-header';
import { goBackOr, leaveForWorkspaceRoute, rootStackRouteNames } from '@/src/lib/navigation-runtime';
import { orderRoutePermissions } from '@/src/lib/permission-parity';
import { can } from '@/src/lib/rbac';
import { restingMaxOffset, strandedScrollTarget } from '@/src/lib/scroll-bounds';
import { WORKSPACE_HUB_ROUTE } from '@/src/lib/workspace-route';
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
  { key: 'kitchen', label: 'ครัว', labelEn: 'Kitchen', shortLabel: 'ครัว', shortLabelEn: 'Kitchen', href: '/kitchen', icon: 'chef-hat', activeIcon: 'chef-hat', permission: 'view_kitchen' },
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
  /** The furthest the page can legitimately rest, with no keyboard up. For a
   *  caller driving the scroll itself, so it never takes an offset iOS left
   *  past the end for a real bound. Optional because a panel that scrolls
   *  itself hands out a control of the same shape. */
  getMaxOffset?: () => number;
  /** How much of the scroll view's top edge the compact header covers right
   *  now, in points below the status bar; 0 while it is hidden. Anything that
   *  scrolls when a finger nears the top edge has to start that far down. */
  getTopCover?: () => number;
  /** Scroll to the compact row's hand-off: the bar and its row fully in, the
   *  page's own controls just under them, and the content starting right
   *  below. For a control in the bar's row that replaces the list - a search
   *  typed from deep in it - so the new list is read from its top without the
   *  page going back to its heading. A no-op until the hand-off is measured. */
  scrollToCompactRow?: (animated?: boolean) => void;
};

/**
 * Where a page's own copy of its compact-row controls is, for the bar to hand
 * off at. The content view the position is measured against, and the shell's
 * setters, handed down to `CompactRowAnchor` inside the content.
 */
type CompactRowAnchorHost = {
  contentRef: React.RefObject<View | null>;
  /** Registers the anchor's own measure, for the shell to run again when the
   *  content changes size; returns the detach, which clears the anchor. */
  attach: (measure: () => void) => () => void;
  report: (box: { y: number; height: number } | null) => void;
};

const CompactRowAnchorContext = createContext<CompactRowAnchorHost | null>(null);

/**
 * Wraps the page's own copy of the controls its `compactRow` carries. The
 * shell measures where it is and hands the compact row over exactly as this
 * reaches the bar's row slot, so the controls are never drawn twice. Outside
 * a collapsing AppScreen it is a plain View.
 */
export function CompactRowAnchor({ children, onLayout, ...rest }: ViewProps) {
  const host = useContext(CompactRowAnchorContext);
  const ref = useRef<View>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  const measure = useCallback(() => {
    const current = hostRef.current;
    const node = ref.current;
    const content = current?.contentRef.current;
    if (!current || !node || !content) return;
    // Against the content view, not the window: a window measurement would
    // have to be paired with the offset at the same instant, and the page
    // moves under the keyboard.
    node.measureLayout(content, (_x, y, _width, height) => current.report({ y, height }), () => undefined);
  }, []);
  useEffect(() => {
    if (!host) return undefined;
    return host.attach(measure);
  }, [host, measure]);
  return (
    // A wrapper around a primitive forwards what it does not use; the one
    // prop it shares, onLayout, runs the caller's and then its own.
    <View
      {...rest}
      onLayout={(event) => {
        onLayout?.(event);
        if (host) measure();
      }}
      ref={ref}
    >
      {children}
    </View>
  );
}

type NavigationMode = 'rail' | 'expanded';

function NavigationButton({
  item,
  mode,
}: {
  item: NavItem;
  mode: NavigationMode;
}) {
  const pathname = usePathname();
  const navigationRef = useNavigationContainerRef();
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
      // A rail item is a switch between workspace screens, each standing on
      // the hub: a replace from the hub dropped the hub (the wide rail has no
      // hub item to get it back), and a push from one screen to the next grew
      // the stack without end. The one already open is popped back to.
      onPress={() => leaveForWorkspaceRoute(
        router,
        rootStackRouteNames(navigationRef.getRootState()),
        item.href as never,
      )}
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

export function PrimaryTabletRail({ expanded }: { expanded: boolean }) {
  const { activeMembership } = useAuth();
  const primary = primaryNavigation.filter((item) => (!expanded || item.key !== 'more') && isAllowed(item, activeMembership));
  const management = managementNavigation.filter((item) => item.key !== 'settings' && item.key !== 'staff' && isAllowed(item, activeMembership));

  return (
    <SafeAreaView edges={['top', 'bottom', 'left']} style={{ width: expanded ? 232 : 92, borderRightWidth: 1, borderRightColor: palette.navigationBorder, backgroundColor: palette.navigationSurface, paddingHorizontal: expanded ? spacing.md : spacing.sm }}>
      <BrandBlock expanded={expanded} />
      <ScrollView contentContainerStyle={{ gap: spacing.xs, paddingVertical: spacing.sm }} showsVerticalScrollIndicator={false}>
        {primary.map((item) => (
          <NavigationButton item={item} key={item.key} mode={expanded ? 'expanded' : 'rail'} />
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
        <PrimaryTabletRail expanded={width >= breakpoints.expandedRail} />
      ) : null}
      <View key="workspace-content" style={{ minWidth: 0, flex: 1 }}>
        {children}
      </View>
    </View>
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

// Exported for a screen that has to place its own heading - the iPad order
// split draws it over the grid's column so the dish panel can run to the top.
export function ScreenHeading({
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
    // The text block centres on the back button whether or not there is a
    // subtitle. Top-aligning the two-line version left the chevron sitting
    // against the title with the order number hanging below it, so the pair
    // read as two separate things rather than one heading.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      {/* The assistant's round glass back button on every screen (15 ก.ย. 2569):
          real Liquid Glass on iOS 26, a white disc with a hairline elsewhere. */}
      {showBack ? (
        <GlassButton icon="chevron-back" label={copy('ย้อนกลับ', 'Go back')} onPress={() => goBackOr(router, WORKSPACE_HUB_ROUTE)} />
      ) : null}
      {/* A single-line title against 44pt action buttons has to centre on them.
          Top-aligning it leaves the text sitting in the corner while the buttons
          sit in the middle of the row, which reads as the heading having floated
          up and drifted out to the left. With a subtitle the text block is the
          taller of the two and top alignment is correct again. */}
      <View style={{ minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {/* No gap: the two lines belong to each other, and the leading built
            into each line already separates them. */}
        <View style={{ minWidth: 0, flex: 1 }}>
          {/* typeScale.hero is 20/600 and it is the app's ceiling: a screen
              title is already the largest thing on its page, and nothing else
              in the app may be drawn larger or heavier than this. */}
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
      {centerTitle && showBack && !action ? <View style={{ width: 46 }} /> : null}
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
  tightHeading = false,
  hideTitle = false,
  stickyContent,
  onScrollStart,
  onScrollBlocked,
  onTouchOutsideStickyContent,
  centerTitle = false,
  immersive = false,
  floatingLeading,
  floatingTrailing,
  scrollControlRef,
  compactHeader = true,
  compactRow,
  compactAction,
  pinCompactRow = false,
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
  /** Sit the pinned heading flush under the status bar instead of a spacing.lg
   *  below it, and bring `floatingTrailing` up with it. The two are one line and
   *  have to move together; a screen whose header carries a control on the
   *  trailing side reads as broken the moment they part company. */
  tightHeading?: boolean;
  /** Drop the heading row while keeping `title` as the screen's name for screen
   *  readers. For a screen whose content carries its own headings and whose
   *  title only repeated the tab that opened it. */
  hideTitle?: boolean;
  /** Controls that stay pinned under the heading — filters a long list is read
   *  through, which are useless once they have scrolled away. Needs
   *  `stickyHeading`, since it renders inside that same pinned block. */
  stickyContent?: React.ReactNode;
  /** Fires when the reader starts dragging the content. Deliberately the drag,
   *  not every scroll event: focusing a field can scroll the view on its own,
   *  and a screen that reacts to that would undo what the reader just opened. */
  onScrollStart?: () => void;
  /** When set, the page does NOT scroll and a vertical drag calls this instead.
   *  For a screen holding something a scroll would strand - an open swipe rail,
   *  say: the drag that would have moved the page is spent putting it away, and
   *  the next one scrolls. Undefined leaves scrolling alone. */
  onScrollBlocked?: () => void;
  /** Turns the pinned sticky content into a stage: while this is set, a
   *  transparent catcher covers everything below the pinned header, and the
   *  first touch anywhere on it spends itself calling this instead of reaching
   *  the control underneath. For a control that takes the screen over until it
   *  is dismissed - the table map's search field, which replaces the zone
   *  picker - where a tap outside means cancel, not act.
   *
   *  Pass `undefined` while the stage is closed; the catcher is only mounted
   *  when there is something to dismiss. */
  onTouchOutsideStickyContent?: () => void;
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
  /** The mirror of `floatingLeading` on the trailing side, aligned with the top
   *  of the header row rather than the screen. For a control that has to sit in
   *  the header but draw OUTSIDE it - a menu that opens downward over the
   *  content - which an `action` cannot do without being clipped by the header
   *  it lives in. Pair it with a spacer in `action` so the title keeps its
   *  place. */
  floatingTrailing?: React.ReactNode;
  /** Sit the title on the screen's centre line instead of hard left. Opt-in:
   *  a left-aligned title is the app's default and reads faster in a stack of
   *  content, so this is for screens that are a single self-contained record. */
  centerTitle?: boolean;
  /** Filled with a handle on the scroll view so the screen can move it itself.
   *  See AppScreenScrollControl for the one thing that needs this. */
  scrollControlRef?: React.MutableRefObject<AppScreenScrollControl | null>;
  /** The collapsing header: once the heading has scrolled away, a compact bar
   *  pinned at the top carries the back button, the title on one line and the
   *  action. On by default for every screen that scrolls and has a heading and
   *  is neither `stickyHeading` nor `immersive`. Pass `false` only with the
   *  reason beside it. */
  compactHeader?: boolean;
  /** ONE row of controls shown under the compact title, only while the compact
   *  bar is up - the filters a long list is read through (Grab's filter row).
   *  The page keeps its own full controls in the content. It fades in with the
   *  bar, so it must not hold Liquid Glass (GlassButton, GlassPanel): glass
   *  under a fading parent renders flat. A control here that filters the list
   *  scrolls it back to the top itself (`scrollControlRef`). */
  compactRow?: React.ReactNode;
  /** What the compact bar shows in place of `action`; `null` shows nothing.
   *  Left undefined, the bar repeats `action`, which is only safe when a second
   *  press of it is harmless - a push, an idempotent open, a plain chip. */
  compactAction?: React.ReactNode;
  /** Keep the bar and its row pinned even when the page is shorter than the
   *  hand-off needs: the content is given the height that lets the page rest
   *  there. For a stage run from the bar's row - a search typed into it -
   *  whose results may be a few rows, or none; without it a short answer would
   *  pull the heading back and take the field being typed into with it. */
  pinCompactRow?: boolean;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { status, user, activeMembership } = useAuth();
  const embeddedInPrimaryTabs = useIsPrimaryTabsHost();
  const primaryTabSceneStatus = usePrimaryTabSceneStatus();
  const reportParentVerticalScrollActivity = useTabSwipeVerticalScrollActivityReporter();
  const isTablet = width >= breakpoints.tablet;
  const screenBackground = isTablet ? palette.canvas : palette.surface;
  const horizontalPadding = isTablet ? spacing.xxl : spacing.lg;
  const maxWidth = contentMaxWidth || (isTablet ? 1180 : 720);
  // Lets the dock go inert too - it is mounted a level up, beside the pager.
  usePublishPrimaryTabStage(onTouchOutsideStickyContent ?? null);
  const scrollRef = useRef<ScrollView>(null);
  const blockedTouchStart = useRef<number | null>(null);
  // Read back by `scrollBy`. RN offers no way to ask a ScrollView where it is,
  // and every alternative for "move this field up by exactly its overlap" needs
  // the number anyway.
  const contentOffsetRef = useRef(0);
  const nestedHorizontalGestureActive = useRef(false);
  // What a page's resting range is measured from. Filled from the scroll
  // view's own layout and content size; 0 means not measured yet.
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const draggingRef = useRef(false);
  const momentumRef = useRef(false);
  // A scroll view that runs to the bottom of the display is inset by the home
  // indicator on iOS (contentInsetAdjustmentBehavior "automatic"), and a page
  // may rest in that inset. With a footer the scroll view stops above it.
  const restingSlack = Platform.OS === 'ios' && !footer ? insets.bottom : 0;
  const restingSlackRef = useRef(restingSlack);
  restingSlackRef.current = restingSlack;

  // The collapsing header. Default on; a pinned heading, an immersive screen, a
  // screen with no heading or no scroll keep exactly what they had.
  const collapsing = scroll && !stickyHeading && !immersive && !hideTitle && compactHeader;
  const collapsingRef = useRef(collapsing);
  collapsingRef.current = collapsing;
  const reducedMotion = useReducedMotion();
  // One scroll value, fed on the native thread, drives everything the bar
  // does with the offset.
  const scrollY = useRef(new Animated.Value(0)).current;
  // The content offset at which the expanded heading's bottom edge reaches the
  // top of the scroll view: its title has gone. Measured, because a subtitle
  // or `beforeHeading` changes it; MotionReveal's slide does not.
  const [collapseAt, setCollapseAt] = useState<number | null>(null);
  const collapseAtRef = useRef<number | null>(null);
  const contentTopRef = useRef(0);
  const headingBoxRef = useRef<{ y: number; height: number } | null>(null);
  // Touches and the accessibility tree cannot follow a native animation, so the
  // bar is switched on and off from JS as the offset crosses the band.
  const [compactShown, setCompactShown] = useState(false);
  const compactShownRef = useRef(false);
  const compactCoverRef = useRef(0);
  // The bar's row hands off from the page's own row (`CompactRowAnchor`): the
  // offset at which the two meet, from the anchor's box, the slot's box and
  // the title's own collapse point. Null until all three are measured, when
  // the row simply comes in with the title.
  const [rowHandoffAt, setRowHandoffAt] = useState<number | null>(null);
  const rowHandoffAtRef = useRef<number | null>(null);
  const rowAnchorRef = useRef<{ y: number; height: number } | null>(null);
  const rowSlotRef = useRef<{ y: number; height: number } | null>(null);
  const rowMeasureRef = useRef<(() => void) | null>(null);
  const [compactRowShown, setCompactRowShown] = useState(false);
  const compactRowShownRef = useRef(false);
  // The scroll view's own height, for the content a pinned row needs. While
  // the row is pinned it only ever grows: on Android the window shrinks
  // under the keyboard, and a content height cut to the shrunken viewport
  // could no longer hold the hand-off offset the moment the keyboard went
  // away - the page snapped back to its heading with the field still open.
  const [viewportHeight, setViewportHeight] = useState(0);
  const pinCompactRowRef = useRef(pinCompactRow);
  pinCompactRowRef.current = pinCompactRow;

  useEffect(() => {
    if (!scrollControlRef) return undefined;
    const scrollTo = (y: number, animated = true) => {
      const target = Math.max(0, y);
      // A jump is where the page is from here on. Its scroll event reaches JS
      // only after the main thread has run it, but a list changed in the same
      // tick (a compact-row filter) lays out during the commit and reports its
      // new size first; judged against the old deep offset, the shorter list
      // would look stranded and be sent to its end instead of its top.
      if (!animated) contentOffsetRef.current = target;
      scrollRef.current?.scrollTo({ y: target, animated });
    };
    scrollControlRef.current = {
      scrollTo,
      getOffset: () => contentOffsetRef.current,
      // Unmeasured is "no known bound", not 0: a caller must not pull a page
      // it cannot see the end of back to the top.
      getMaxOffset: () => (contentHeightRef.current > 0 && viewportHeightRef.current > 0
        ? restingMaxOffset({ contentHeight: contentHeightRef.current, viewportHeight: viewportHeightRef.current, slack: restingSlackRef.current })
        : Number.POSITIVE_INFINITY),
      getTopCover: () => (collapsingRef.current && compactShownRef.current ? compactCoverRef.current : 0),
      scrollToCompactRow: (animated = false) => {
        const at = rowHandoffAtRef.current;
        if (!collapsingRef.current || at === null) return;
        scrollTo(at, animated);
      },
    };
    return () => {
      scrollControlRef.current = null;
    };
  }, [scrollControlRef]);

  const setNestedHorizontalGestureActive = useCallback((active: boolean) => {
    nestedHorizontalGestureActive.current = active;
  }, []);

  const reportVerticalScrollActivity = useCallback((activityTimeMs: number) => {
    if (primaryTabSceneStatus === null || primaryTabSceneStatus === 'active') {
      reportParentVerticalScrollActivity(activityTimeMs);
    }
  }, [primaryTabSceneStatus, reportParentVerticalScrollActivity]);

  const reportVerticalScrollNow = useCallback(() => {
    reportVerticalScrollActivity(Date.now());
  }, [reportVerticalScrollActivity]);

  const updateCompactShown = useCallback((offset: number) => {
    const at = collapseAtRef.current;
    if (!collapsingRef.current || at === null) return;
    const next = nextCompactShown(compactShownRef.current, compactHeaderProgress(offset, at));
    if (next !== compactShownRef.current) {
      compactShownRef.current = next;
      setCompactShown(next);
    }
    // The row's switch, on the same two thresholds. With no hand-off measured
    // the row is up whenever the bar is.
    const handoff = rowHandoffAtRef.current;
    const nextRow = handoff === null ? next : nextCompactShown(compactRowShownRef.current, compactRowProgress(offset, handoff));
    if (nextRow !== compactRowShownRef.current) {
      compactRowShownRef.current = nextRow;
      setCompactRowShown(nextRow);
    }
  }, []);

  const measureHandoff = useCallback(() => {
    const anchor = rowAnchorRef.current;
    const slot = rowSlotRef.current;
    const collapse = collapseAtRef.current;
    const next = anchor && slot && collapse !== null
      ? compactRowHandoff({ contentTop: contentTopRef.current, anchor, slot, collapseAt: collapse })
      : null;
    if (next === rowHandoffAtRef.current) return;
    rowHandoffAtRef.current = next;
    setRowHandoffAt(next);
    updateCompactShown(contentOffsetRef.current);
  }, [updateCompactShown]);

  const measureCollapse = useCallback(() => {
    const box = headingBoxRef.current;
    if (!box) return;
    const next = Math.round(contentTopRef.current + box.y + box.height);
    if (next === collapseAtRef.current) return;
    collapseAtRef.current = next;
    setCollapseAt(next);
    updateCompactShown(contentOffsetRef.current);
    measureHandoff();
  }, [measureHandoff, updateCompactShown]);

  const contentRef = useRef<View>(null);
  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    contentTopRef.current = event.nativeEvent.layout.y;
    measureCollapse();
    measureHandoff();
  }, [measureCollapse, measureHandoff]);

  // Created once: the anchor attaches in an effect, and a new host object each
  // render would detach and re-attach it every time the screen re-rendered.
  const rowAnchorHost = useMemo<CompactRowAnchorHost>(() => ({
    contentRef,
    attach: (measure) => {
      rowMeasureRef.current = measure;
      return () => {
        if (rowMeasureRef.current === measure) rowMeasureRef.current = null;
        rowAnchorRef.current = null;
        measureHandoff();
      };
    },
    report: (box) => {
      const current = rowAnchorRef.current;
      if (box && current && current.y === box.y && current.height === box.height) return;
      rowAnchorRef.current = box;
      measureHandoff();
    },
  }), [measureHandoff]);

  const onRowSlotLayout = useCallback((slot: { y: number; height: number }) => {
    const current = rowSlotRef.current;
    if (current && current.y === slot.y && current.height === slot.height) return;
    rowSlotRef.current = slot;
    measureHandoff();
  }, [measureHandoff]);

  const onHeadingLayout = useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    headingBoxRef.current = { y, height };
    measureCollapse();
  }, [measureCollapse]);

  // A new scroll view starts at the top. The value the last one left behind
  // would otherwise hold the bar up until the first scroll event. The offset
  // too: `collapsing` only changes when the scroll view is swapped (or goes),
  // and a stale deep offset would switch the bar on, invisible and taking the
  // heading's touches, the moment the new heading is measured.
  useEffect(() => {
    scrollY.setValue(0);
    contentOffsetRef.current = 0;
    compactShownRef.current = false;
    setCompactShown(false);
    compactRowShownRef.current = false;
    setCompactRowShown(false);
    draggingRef.current = false;
    momentumRef.current = false;
  }, [collapsing, scrollY]);

  // A pinned row that hands back - the reader dragged the page down past the
  // hand-off - takes its controls out of sight and out of reach, but a field
  // in it would keep the keyboard, and the next key would throw the page back
  // down. The keyboard goes with the row; the stage itself stays as it is.
  useEffect(() => {
    if (pinCompactRow && !compactRowShown) Keyboard.dismiss();
  }, [compactRowShown, pinCompactRow]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    contentOffsetRef.current = event.nativeEvent.contentOffset.y;
    reportVerticalScrollNow();
    updateCompactShown(event.nativeEvent.contentOffset.y);
  };
  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;
  // Created once: a new event object every render would detach and re-attach
  // the native listener each time the screen re-rendered. The JS listener keeps
  // every bookkeeping step the plain handler has.
  const nativeScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: true,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => handleScrollRef.current(event),
    },
  ), [scrollY]);

  const compactProgress = useMemo(() => {
    if (collapseAt === null) return 0;
    return scrollY.interpolate({
      inputRange: compactHeaderRange(collapseAt, COMPACT_HEADER_BAND),
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });
  }, [collapseAt, scrollY]);
  // The row's own: a short step at the hand-off, or the bar's progress while
  // there is no hand-off to wait for.
  const compactRowProgressValue = useMemo(() => {
    if (rowHandoffAt === null) return compactProgress;
    return scrollY.interpolate({
      inputRange: compactRowRange(rowHandoffAt, COMPACT_ROW_BAND),
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });
  }, [compactProgress, rowHandoffAt, scrollY]);

  // UIScrollView springs an out-of-range offset back only while a drag or a
  // bounce is running. Switching scrolling off in the middle of one (a lifted
  // category row does) freezes the page where it is, and switching it back on
  // does not re-clamp: the page rests past its end, heading gone, until it is
  // touched. The same happens when the content gets shorter under the reader.
  // This is the spring-back UIKit skipped, and a no-op unless the offset really
  // is outside the range. Android clamps both itself and has no rubber band.
  // Never on a pinned heading: the bill's rail uses onScrollBlocked, and the
  // bill stays exactly as it is.
  const settleStrandedOffset = (clampTop: boolean) => {
    if (Platform.OS !== 'ios' || stickyHeading || Keyboard.isVisible()) return;
    const contentHeight = contentHeightRef.current;
    const viewportHeight = viewportHeightRef.current;
    if (!(contentHeight > 0) || !(viewportHeight > 0)) return;
    const target = strandedScrollTarget({
      offset: contentOffsetRef.current,
      contentHeight,
      viewportHeight,
      slack: restingSlack,
      // A refresh in progress holds the offset negative to show its spinner.
      clampTop: clampTop && !refreshControl,
    });
    if (target === null) return;
    contentOffsetRef.current = target;
    scrollRef.current?.scrollTo({ y: target, animated: true });
  };
  const settleStrandedOffsetRef = useRef(settleStrandedOffset);
  settleStrandedOffsetRef.current = settleStrandedOffset;

  // Keyed on whether it is blocked, not on the function: the bill hands over a
  // new closure every render.
  const scrollBlocked = Boolean(onScrollBlocked);
  const wasScrollBlockedRef = useRef(scrollBlocked);
  useEffect(() => {
    const wasBlocked = wasScrollBlockedRef.current;
    wasScrollBlockedRef.current = scrollBlocked;
    if (!wasBlocked || scrollBlocked) return;
    // A pan cancelled by the block may never have reported its end.
    draggingRef.current = false;
    momentumRef.current = false;
    settleStrandedOffsetRef.current(true);
  }, [scrollBlocked]);

  const handleContentSizeChange = (_width: number, height: number) => {
    contentHeightRef.current = height;
    // Something above the page's row may have grown or gone; the anchor's own
    // layout only fires when its box changes against its parent.
    rowMeasureRef.current?.();
    // A filter in the compact row, a deleted row: the page got shorter under
    // the reader. Only the bottom - a shrink never strands the top.
    if (collapsing && !onScrollBlocked && !draggingRef.current && !momentumRef.current) {
      settleStrandedOffset(false);
    }
  };

  // The content a pinned row needs: enough that the page can rest at the
  // hand-off with the row's controls in and the results under them, however
  // few. Spelled out from the same paddings the scroll content carries.
  const contentPaddingTop = immersive ? 0 : spacing.lg;
  const contentPaddingBottom = spacing.xxxl + (footer ? 0 : insets.bottom);
  const pinnedMinHeight = collapsing && pinCompactRow && rowHandoffAt !== null && viewportHeight > 0
    ? Math.max(0, viewportHeight + rowHandoffAt - contentPaddingTop - contentPaddingBottom)
    : null;

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: screenBackground }} />;
  if (!user) return <Redirect href="/login" />;
  if (!activeMembership) return <Redirect href="/restaurants" />;

  const heading = hideTitle && !beforeHeading ? null : (
    <MotionReveal style={{ gap: spacing.xl }}>
      {beforeHeading}
      {hideTitle ? null : <ScreenHeading
        action={action}
        centerTitle={centerTitle}
        showBack={!topLevel}
        subtitle={subtitle}
        title={title}
        titleContent={titleContent}
      />}
    </MotionReveal>
  );
  // A pinned header pays for its own top inset instead of letting the shell
  // stack a separate SafeAreaView spacer above it. Two views in the same colour
  // still meet at a seam, and the hairline that shows through it is exactly
  // what a header separator is meant to be, drawn in the wrong place. Reaching
  // the top of the display deletes the join outright.
  const headerOwnsTopInset = scroll && stickyHeading && !immersive;
  // The one number the pinned heading and the trailing control both sit on, so
  // they cannot drift apart.
  const headingTopGap = tightHeading ? 0 : spacing.lg;
  const pinnedHeading = scroll && stickyHeading ? (
    <View
      style={{
        alignItems: 'center',
        paddingHorizontal: horizontalPadding,
        paddingTop: (headerOwnsTopInset ? insets.top : 0) + headingTopGap,
        paddingBottom: spacing.md,
        backgroundColor: screenBackground,
        // Above the touch catcher below, so the sticky content stays live while
        // everything under it is being intercepted.
        zIndex: 2,
      }}
    >
      <View style={{ width: '100%', maxWidth, gap: spacing.md }}>
        {/* The title row has to be swallowed too, and it cannot be done with the
            catcher below: that one is a sibling of this whole block, and a
            child's zIndex only orders it against its own siblings - nothing
            inside here can be lifted over something outside here. Reaching the
            catcher up between these two rows would mean laying it outside its
            parent's bounds, which is the Android touch bug all over again, or
            splitting the header into two stacked blocks, which puts back the
            seam that started this.

            `box-only` is the way out: this view takes the touch and its children
            never see it, so the action buttons are inert while the stage is up
            and the tap that hit them closes it instead. */}
        <Pressable
          accessibilityElementsHidden={Boolean(onTouchOutsideStickyContent)}
          accessible={false}
          disabled={!onTouchOutsideStickyContent}
          importantForAccessibility={onTouchOutsideStickyContent ? 'no-hide-descendants' : 'auto'}
          onPressIn={onTouchOutsideStickyContent}
          pointerEvents={onTouchOutsideStickyContent ? 'box-only' : 'auto'}
        >
          {heading}
        </Pressable>
        {stickyContent}
      </View>
    </View>
  ) : null;
  // The collapsing header reads the offset on the native thread, which only an
  // Animated scroll view can feed. Every other screen keeps the plain one it
  // had, props and all; the type only changes when `collapsing` does, and then
  // the scroll view is new anyway. No `style` on either: on Android an Animated
  // scroll view with a refreshControl and a style takes the path that clones
  // the refresh control around itself a second time.
  const ShellScrollView = collapsing ? Animated.ScrollView : ScrollView;
  const main = scroll ? (
    <ShellScrollView
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
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingHorizontal: horizontalPadding, paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      // No scroll bar. It is drawn OVER the content at the right edge, which is
      // exactly where a swipe-to-delete rail opens, and a grey stripe down a red
      // rail is the bar winning an argument with the screen. Every list long
      // enough to need one already says where it is by what is in it.
      showsVerticalScrollIndicator={false}
      onMomentumScrollBegin={() => {
        momentumRef.current = true;
        reportVerticalScrollNow();
      }}
      onMomentumScrollEnd={() => {
        momentumRef.current = false;
        reportVerticalScrollNow();
      }}
      onScroll={collapsing ? nativeScroll : handleScroll}
      onScrollBeginDrag={() => {
        draggingRef.current = true;
        reportVerticalScrollNow();
        onScrollStart?.();
      }}
      onScrollEndDrag={() => {
        draggingRef.current = false;
        reportVerticalScrollNow();
      }}
      // What a stranded offset is measured against. Not on a pinned heading,
      // which keeps the scroll view it had.
      onLayout={stickyHeading ? undefined : (event: LayoutChangeEvent) => {
        const { height } = event.nativeEvent.layout;
        viewportHeightRef.current = height;
        setViewportHeight((current) => (pinCompactRowRef.current ? Math.max(current, height) : height));
      }}
      onContentSizeChange={stickyHeading ? undefined : handleContentSizeChange}
      ref={scrollRef}
      refreshControl={refreshControl}
      scrollEnabled={!onScrollBlocked}
      // Where the finger landed, kept so a DRAG can be told from a press. A
      // touchmove fires for the pixel or two a finger travels while tapping a
      // button, and treating that as a scroll attempt would close the rail out
      // from under the very button being pressed.
      onTouchStart={onScrollBlocked ? (event) => {
        blockedTouchStart.current = event.nativeEvent.pageY;
      } : undefined}
      onTouchMove={onScrollBlocked ? (event) => {
        const start = blockedTouchStart.current;
        if (start === null || Math.abs(event.nativeEvent.pageY - start) < 8) return;
        blockedTouchStart.current = null;
        onScrollBlocked();
      } : undefined}
      // iOS sends the native-animation scroll event through the same throttle
      // gate as onScroll: at 32 the bar would step at about 30fps.
      scrollEventThrottle={collapsing ? 16 : 32}
    >
      <View onLayout={collapsing ? onContentLayout : undefined} ref={contentRef} style={[{ width: '100%', maxWidth, gap: spacing.xl }, contentStyle, pinnedMinHeight !== null ? { minHeight: pinnedMinHeight } : null]}>
        {stickyHeading || immersive ? null : collapsing ? (
          <View onLayout={onHeadingLayout}>{heading}</View>
        ) : heading}
        {collapsing ? (
          <CompactRowAnchorContext.Provider value={rowAnchorHost}>{children}</CompactRowAnchorContext.Provider>
        ) : children}
      </View>
    </ShellScrollView>
  ) : (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: horizontalPadding, paddingTop: spacing.lg, paddingBottom: 0 }}>
      <View style={[{ width: '100%', maxWidth, flex: 1, gap: spacing.lg }, contentStyle]}>
        {heading}
        <View style={{ minHeight: 0, flex: 1 }}>{children}</View>
      </View>
    </View>
  );

  const animatedContent = (
    <View
      style={{
        minHeight: 0,
        flex: 1,
        backgroundColor: screenBackground,
      }}
    >
      {immersive || headerOwnsTopInset ? null : (
        <SafeAreaView
          edges={isTablet ? ['top', 'right'] : ['top', 'left', 'right']}
          style={{ backgroundColor: screenBackground }}
        />
      )}
      {pinnedHeading}
      {main}
      {collapsing && collapseAt !== null ? (
        // Laid out inside this view's bounds from its top edge, never above it:
        // a view outside its parent's bounds stops receiving touches on Android.
        <CompactHeader
          action={compactAction === undefined ? action : compactAction}
          background={screenBackground}
          centerTitle={centerTitle}
          horizontalPadding={horizontalPadding}
          maxWidth={maxWidth}
          onLayout={(event) => {
            compactCoverRef.current = Math.max(0, event.nativeEvent.layout.height - insets.top);
          }}
          // Reduced motion is a plain switch, on the same JS threshold that
          // decides touches, so what shows and what is live never disagree.
          progress={reducedMotion ? (compactShown ? 1 : 0) : compactProgress}
          row={compactRow}
          rowProgress={reducedMotion ? (compactRowShown ? 1 : 0) : compactRowProgressValue}
          rowShown={compactRowShown}
          onRowLayout={onRowSlotLayout}
          showBack={!topLevel}
          shown={compactShown}
          // The plain string: `titleContent` can be a field (a role's name edited
          // in place) or a whole strip (the tablet home's days).
          title={title}
          topInset={insets.top}
        />
      ) : null}
      {onTouchOutsideStickyContent ? (
        // A sibling covering the whole shell rather than a child of the header
        // reaching past its own edges: a view laid out outside its parent's
        // bounds stops receiving touches on Android while still receiving them
        // on iOS, which is the exact shape of bug this app has shipped before.
        //
        // `zIndex` rather than tree order, so it stays over the footer too
        // without being moved below it. The pinned header sits at 2 and is the
        // one thing left reachable.
        //
        // `onPressIn`, not `onPress`: a release-fired handler is cancelled by
        // the drag of an attempted scroll, which would leave the stage open
        // after the reader had already tried to move on.
        <Pressable
          accessible={false}
          onPressIn={onTouchOutsideStickyContent}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 }}
        />
      ) : null}
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
      {floatingTrailing ? (
        <View
          pointerEvents="box-none"
          // `spacing.lg` more than the leading slot when the header owns the top
          // inset: that is the header's own top padding, so this lands on the
          // first line of the heading instead of above it.
          style={{
            position: 'absolute',
            top: insets.top + (headerOwnsTopInset ? headingTopGap : 0),
            right: horizontalPadding,
            zIndex: 10,
          }}
        >
          {floatingTrailing}
        </View>
      ) : null}
    </View>
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
