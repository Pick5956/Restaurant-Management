import { Redirect, router, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { LIQUID_GLASS } from '@/src/lib/liquid-glass';
import { AppText as Text } from '@/src/components/app-text';
import { BrandMark } from '@/src/components/brand-mark';
import { MotionReveal, useReducedMotion } from '@/src/components/motion';
import {
  useIsPrimaryTabsHost,
  usePrimaryTabSceneStatus,
  usePrimaryTabStageDismiss,
  usePublishPrimaryTabStage,
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
  resolvePagerSwipeSettlement,
  resolvePhoneNavigationIndicatorMetrics,
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

/**
 * The phone dock is the iOS 26 tab bar, rebuilt: clear dark glass with a
 * hairline rim, white glyphs, and a pale
 * translucent capsule for the selection. Copied from a screen recording and
 * a run of screenshots of that bar on 2026-09-10, at the owner's request.
 *
 * Layers, bottom to top, all iOS-only: a dim (`DOCK_DIM`) that darkens what is
 * behind the bar, and Liquid Glass (`clear`, dark scheme, untinted) that bends
 * it. No sheen: see the note where it used to be. There is no blur: a
 * real `UIBlurEffect` layer was tried at 100, 45, 25 and 12 and the owner asked
 * for none - the bar shows what is behind it sharp, tinted, glinting.
 *
 * Nothing is painted on the glass itself. Every tinted version of the material
 * read as "a bar that has a colour"; the colour lives in the dim beneath it.
 */
// The translucent stack - dim, lens - is iOS-only. Android keeps the
// opaque fill it has today: a translucent plate over a list with no material
// behind it reads as a bug there, and the app has never been run on Android.
const DOCK_GLASS_STACK = Platform.OS === 'ios';
// The darkness, and the ONLY thing between the page and the glass: a blur layer
// sat under this and was removed at the owner's "no blur", so what is behind
// the bar shows through sharp, tinted by this and nothing else.
//
// 0.68. Darkness is not the opposite of transparency here: a black overlay at
// 0.68 still passes a third of the light, so shapes and even text behind the
// bar stay readable - the reference shows a date legible through its bar - it
// is only dimmer. 0.35 left the bar too bright over a white page for white
// glyphs to stand out; the reference over a pale green poster reads roughly
// two-thirds darkened, estimated by eye because that screenshot was never
// written to disk. The lens sits ABOVE this, so raising it costs no gloss.
// Move this alone for darkness.
const DOCK_DIM = 'rgba(0, 0, 0, 0.68)';
// There is NO sheen. A white-to-nothing gradient down the top of the pill
// (0.30 at the edge, 0.10 at mid-height) was the gloss for a day, and over a
// busy page it read as light on glass. Over the plain white tables page it was
// a lighter top half fading into a darker bottom half - reported as "white
// showing at the top" and as a bug, and it survived a slope change, a corner
// fix, the shadow removal and a lens-scheme change because it was the sheen
// itself, not its shape. The bar is one flat tone now; the gloss is the lens's
// refraction and the rim, which is also all the reference bar has.

/**
 * How far the selection capsule stretches at the midpoint between two slots.
 * Read off the recording: mid-travel it spans roughly 1.7 slot widths, then
 * snaps back to one. It scales about its own centre, and the centre moves
 * linearly, so at the halfway point the stretched body covers both glyphs -
 * which is the frame that reads as a drop.
 */
// 1.02. Measured on a mid-swipe screenshot the reference capsule is 1.01
// slots wide, and at 1.06 it was still reported as stretching far too much
// and as "leaping" to the next slot the moment a swipe starts - a scaleX about
// the centre pushes the leading edge ahead of the travel. This is close enough
// to nothing that the capsule reads as sliding, not stretching.
const PHONE_ACTIVE_INDICATOR_STRETCH = 1.02;

// Every other dimension of the dock derives from this one - the pill radius, the
// active indicator's radius, each tab's minimum height, and the clearance
// `AppScreen` leaves at the bottom of a scrolling page - so this is the only
// number to change to resize the bar.
// Measured off the owner's Instagram screenshots at 3.28 px/pt: the reference
// bar is ~55pt tall with ~20pt side margins and ~20pt to the screen bottom.
// Ours was 53 / 16 / 23.5. Height rounds to 56 so the capsule radius stays an
// integer.
// 60. Against the reference at the same crop scale ours measured ~6% shorter at
// 56 and was reported as visibly smaller; 60 closes that.
const PHONE_DOCK_HEIGHT = 60;
const PHONE_DOCK_RADIUS = PHONE_DOCK_HEIGHT / 2;
const PHONE_DOCK_SIDE_MARGIN = spacing.xl;
// The capsule fills its slot sideways - the reference measures 1.02 slots wide,
// ours 0.90 with the old 4pt inset - and keeps a 5pt breath top and bottom, so
// the two insets are separate numbers. The metrics helper takes the horizontal
// one, because that is the one that sets width and travel.
const PHONE_ACTIVE_INDICATOR_INSET = 0;
const PHONE_ACTIVE_INDICATOR_VERTICAL_INSET = 4;
// The bar's own end padding, and the fix for the capsule sinking into the left
// end on the first tab. On the reference the capsule sits ~8pt in from the
// bar's end, because the slots do not start at the edge: the row is padded and
// five slots divide what is left. The measured width handed to the metrics
// helper subtracts this on both sides, so slot width, capsule width and capsule
// travel all agree with where the glyphs actually are.
//
// The capsule's `left` adds this padding EXPLICITLY. An earlier version assumed
// Yoga offsets an absolutely positioned child by its parent's padding and set
// `left: inset`; on device the capsule sat 8pt left of every glyph. It does
// not - like CSS, `left` is measured from the parent's border edge.
const PHONE_DOCK_END_PADDING = 8;
const PHONE_ACTIVE_INDICATOR_RADIUS = (
  PHONE_DOCK_HEIGHT - PHONE_ACTIVE_INDICATOR_VERTICAL_INSET * 2
) / 2;
const PHONE_DOCK_TOP_GUTTER = 22;
const PHONE_DOCK_BOTTOM_GAP_SCALE = 0.8;
// 13, up from 10: three more points of drop brings the measured 23.5pt bottom
// gap to the reference's ~20.
const PHONE_DOCK_ADDITIONAL_DROP = 13;
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
  // A sawtooth over the marker: 1 at every integer slot, STRETCH at every
  // half-integer between them. The pager drives `markerPosition` continuously
  // through a swipe, so this is what makes the capsule elongate toward the
  // destination and contract on arrival, with no second animation to keep in
  // step - it cannot lag the travel because it IS the travel.
  const markerStretch = useMemo(() => {
    const count = items.length;
    if (count < 2) return 1;
    const inputRange: number[] = [];
    const outputRange: number[] = [];
    for (let index = 0; index < count; index += 1) {
      inputRange.push(index);
      outputRange.push(1);
      if (index < count - 1) {
        inputRange.push(index + 0.5);
        outputRange.push(PHONE_ACTIVE_INDICATOR_STRETCH);
      }
    }
    return markerPosition.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
  }, [items.length, markerPosition]);
  const onDockLayout = useCallback((event: LayoutChangeEvent) => {
    setDockWidth(event.nativeEvent.layout.width - PHONE_DOCK_END_PADDING * 2);
  }, []);
  // Press feedback belongs to the WHOLE plate, not to the glyph under the
  // thumb. Dimming one icon reads as that icon being a different colour from
  // its four neighbours - it was reported exactly that way - and the material
  // is a property of the sheet, so the sheet is what should answer a touch.
  //
  // It rides on the outer wrapper deliberately: the pill below it carries
  // `overflow: hidden`, so a scale applied inside would be clipped back to the
  // bar's own bounds and nothing would appear to move at all.
  const reducedMotion = useReducedMotion();
  const pressLift = useRef(new Animated.Value(0)).current;
  // The compact table tile's press curve, copied because it is the one in this
  // app that is actually visible - see its comment at compact-table-tile.tsx:103.
  //
  // The release is the whole trick and it is not obvious: springing straight
  // back from a pressed scale overshoots by well under one percent, which reads
  // as nothing happening at all. Several rounds here were spent raising the
  // scale - 1.035, then 1.06 - when the problem was never the size, it was the
  // curve. Dipping to a small NEGATIVE first sends the return through a value
  // past rest, and that is what the eye catches.
  //
  // An earlier comment here claimed `onPressIn` cannot fire inside an
  // interactive glass and drove this from `onPress` instead. That was wrong: it
  // rested on a log line that never appeared, from a build never confirmed to be
  // on the device. `compact-table-tile.tsx:234` ships Pressable -> GlassView
  // (isInteractive) -> content with a working `onPressIn`, and
  // RCTSurfaceTouchHandler sets `delaysTouchesBegan = NO` with its recogniser on
  // the surface root, so touch-begin arrives whatever the hit view is.
  const animateDock = useCallback((toValue: number) => {
    if (reducedMotion) {
      pressLift.setValue(toValue);
      return;
    }
    if (toValue === 1) {
      Animated.spring(pressLift, {
        toValue: 1,
        damping: 18,
        stiffness: 320,
        mass: 0.7,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
      return;
    }
    Animated.sequence([
      Animated.timing(pressLift, {
        toValue: -0.4,
        duration: 90,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.spring(pressLift, {
        toValue: 0,
        damping: 14,
        stiffness: 260,
        mass: 0.7,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [pressLift, reducedMotion]);
  const stageDismiss = usePrimaryTabStageDismiss();

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
        <Animated.View
          style={{
            height: PHONE_DOCK_HEIGHT,
            marginHorizontal: PHONE_DOCK_SIDE_MARGIN,
            borderRadius: PHONE_DOCK_RADIUS,
            // Transparent under the material, or the glass refracts a solid
            // plate and nothing behind the dock is ever visible. Android keeps
            // the fill: there is no material there, so the fill IS the dock, and
            // `elevation` needs a background to draw a shadow against at all.
            backgroundColor: DOCK_GLASS_STACK ? 'transparent' : palette.navigationDockSurface,
            // No drop shadow under the translucent stack. UIKit paints a layer's
            // shadow BEHIND its content, and this plate's content is a 0.68 dim
            // that passes a third of the light - so the shadow, offset 10pt down
            // and blurred 16, showed THROUGH the bar: the bottom of the pill sat
            // on its own shadow and read darker, the top 10-20pt had no shadow
            // behind it and read lighter, and the hairline rim along the bottom
            // edge lit up against the darkened interior. Over a white page, with
            // nothing behind the bar to break it up, that was a hard light band
            // across the top and a bright line along the bottom - reported as a
            // bug twice, and untouched by the sheen and corner fixes because it
            // was never those layers. The opaque plate never showed it because an
            // opaque layer hides its own shadow. Android keeps `elevation`: the
            // fill there is opaque, so the shadow stays underneath it.
            ...(DOCK_GLASS_STACK ? {} : {
              shadowColor: palette.shadow,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.2,
              shadowRadius: 16,
              elevation: 12,
            }),
            // Three points, not two, because the release runs to -0.4 and that
            // leg is the one that can be seen: on the way back the plate passes
            // through a slight squish at 0.994 before it settles. Two points
            // would clamp that leg away and take the whole rebound with it.
            //
            // 1.02 held, down from 1.05. A dock is 350pt wide, so a percent of
            // scale is 3.5pt at each end - the same number that is nearly
            // invisible on a 100pt tile is loud here, and 1.05 was reported as
            // too much. The rebound does the work; the held state only needs to
            // be felt.
            transform: [{
              scale: pressLift.interpolate({
                inputRange: [-0.4, 0, 1],
                outputRange: [0.994, 1, 1.02],
              }),
            }],
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
              paddingHorizontal: PHONE_DOCK_END_PADDING,
              backgroundColor: DOCK_GLASS_STACK ? 'transparent' : palette.navigationDockSurface,
              // The hairline rim the reference bar carries: a lighter edge that
              // is what separates dark glass from the dark content behind it.
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: palette.navigationDockRim,
            }}
          >
            {/* The dim. See DOCK_DIM.

                Every fill layer in here bleeds 1pt past the pill and carries NO
                radius of its own; the pill's `overflow: hidden` is the one and
                only curve. The pill has a hairline border, and RN lays an
                absolute child INSIDE that border, so a layer that fills exactly
                to 0 with its own radius-30 corner is 0.33pt smaller than the
                clip and its arc no longer coincides with the clip's - a sliver
                of the white page showed at all four corners. Overshooting and
                letting the clip cut removes the second curve entirely. */}
            {DOCK_GLASS_STACK ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: -1,
                  right: -1,
                  bottom: -1,
                  left: -1,
                  backgroundColor: DOCK_DIM,
                  zIndex: 0,
                }}
              />
            ) : null}
            {/* The lens, untinted, on top. `clear`, NOT `regular` - regular is
                a frost, and it turned the bar into a flat grey slab.
                `clear` bends light and glints and frosts nothing.

                DARK scheme. The light scheme was tried first for its louder
                glint, and its highlight is the "white band" that survived
                three fixes aimed at other layers: the light scheme paints a
                pronounced white specular strip along the inside of the top
                edge and a bright line along the bottom, with a hard edge, and
                over a plain white page - nothing behind the bar to break it
                up - that read as a bug, not gloss. Smoothing the sheen, fixing
                the corner clip and removing the plate shadow each changed
                nothing, which is what isolated it: this is the one layer that
                draws a highlight of its own. The dark scheme's highlights are
                grey and faint; the gloss lives in the rim, the glint in
                `isInteractive`. It adds no frost in `clear`, so the darkness
                still comes only from the dim beneath.
                No tint, because a wash on top is what "a bar that has a colour"
                looked like. `isInteractive` is what makes
                it render as glass at all - without it the surface goes flat -
                and it does not interfere with the tabs: RN's touch handler is a
                recogniser on the surface root with `delaysTouchesBegan = NO`,
                so the tabs above still get press-in and press-out
                (compact-table-tile.tsx ships the same arrangement). Its own
                `borderRadius`, because a GlassView draws its own shape and a
                square one reads as a slab inside the pill. */}
            {LIQUID_GLASS ? (
              <GlassView
                colorScheme="dark"
                glassEffectStyle="clear"
                isInteractive
                // Bleeds 1pt like the layers under it, and keeps a radius only
                // because a GlassView draws its own outline: one point larger
                // than the pill's so the two arcs stay concentric, the clip
                // trimming the overshoot.
                style={{
                  position: 'absolute',
                  top: -1,
                  right: -1,
                  bottom: -1,
                  left: -1,
                  borderRadius: PHONE_DOCK_RADIUS + 1,
                  zIndex: 0,
                }}
              />
            ) : null}
            {indicatorMetrics && selectedIndex >= 0 && selectedIndex < items.length ? (
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: PHONE_ACTIVE_INDICATOR_VERTICAL_INSET,
                  bottom: PHONE_ACTIVE_INDICATOR_VERTICAL_INSET,
                  left: PHONE_DOCK_END_PADDING + indicatorMetrics.indicatorInset,
                  width: indicatorMetrics.indicatorWidth,
                  borderRadius: PHONE_ACTIVE_INDICATOR_RADIUS,
                  // Translucent white, not a solid fill: on the reference it is
                  // a paler patch of the same glass, so the content behind the
                  // dock shows through the capsule too.
                  backgroundColor: palette.navigationDockIndicator,
                  transform: [{ translateX: markerTranslate }, { scaleX: markerStretch }],
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
                  // Still no per-tab opacity: the tab reports the tap and the
                  // whole plate answers it. See `animateDock`.
                  onPress={() => onSelect(index)}
                  onPressIn={() => animateDock(1)}
                  onPressOut={() => animateDock(0)}
                  style={{
                    minWidth: 48,
                    minHeight: PHONE_DOCK_HEIGHT,
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 2,
                    zIndex: 1,
                  }}
                >
                  <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                    <AppIcon
                      color={palette.navigationDockIcon}
                      name={active ? item.activeIcon : item.icon}
                      size={27}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
      {stageDismiss ? (
        // Filling this root rather than being wrapped around it: the root is
        // `position: absolute` with no `top`, so its box IS the dock's
        // footprint, and an absolute-fill child covers exactly that and nothing
        // else. A Pressable wrapped AROUND the dock would become the parent its
        // absolute positioning resolves against, and drop it out of the corner.
        //
        // Last child, so it is over the buttons without needing a zIndex; the
        // root is `box-none`, which passes touches to children like this one.
        <Pressable
          accessible={false}
          onPressIn={stageDismiss}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
      ) : null}
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
    // The text block centres on the back button whether or not there is a
    // subtitle. Top-aligning the two-line version left the chevron sitting
    // against the title with the order number hanging below it, so the pair
    // read as two separate things rather than one heading.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
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
      <View style={{ minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        {/* No gap: the two lines belong to each other, and the leading built
            into each line already separates them. */}
        <View style={{ minWidth: 0, flex: 1 }}>
          {/* 600, not the scale's 700. A screen title is already the largest
              thing on the screen; bold on top of that made it the only thing. */}
          {titleContent ?? (
            <Text accessibilityRole="header" selectable style={[typeScale.hero, { fontWeight: '600' }, centerTitle ? { textAlign: 'center' } : null]}>{title}</Text>
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
  onTouchOutsideStickyContent,
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
  // Lets the dock go inert too - it is mounted a level up, beside the pager.
  usePublishPrimaryTabStage(onTouchOutsideStickyContent ?? null);
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
  // A pinned header pays for its own top inset instead of letting the shell
  // stack a separate SafeAreaView spacer above it. Two views in the same colour
  // still meet at a seam, and the hairline that shows through it is exactly
  // what a header separator is meant to be, drawn in the wrong place. Reaching
  // the top of the display deletes the join outright.
  const headerOwnsTopInset = scroll && stickyHeading && !immersive;
  const pinnedHeading = scroll && stickyHeading ? (
    <View
      style={{
        alignItems: 'center',
        paddingHorizontal: horizontalPadding,
        paddingTop: (headerOwnsTopInset ? insets.top : 0) + spacing.lg,
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
      {immersive || headerOwnsTopInset ? null : (
        <SafeAreaView
          edges={isTablet ? ['top', 'right'] : ['top', 'left', 'right']}
          style={{ backgroundColor: screenBackground }}
        />
      )}
      {pinnedHeading}
      {main}
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
