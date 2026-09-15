import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { appNavigation, AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ToolRow } from '@/src/components/tool-row';
import { groupMoreItems, MORE_DETAILS, restaurantMark, type MoreGroupKey } from '@/src/lib/more-screen';
import { getWorkModeCopy } from '@/src/lib/work-mode';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';

// "เพิ่มเติม", redrawn on 15 ก.ย. 2569 (design B). It had been three plain
// lists whose two columns on a tablet ended a row apart, every row the same
// thin icon and name, and nothing saying which shop this was. Now: the shop at
// the top, then two groups of four — so on a tablet the columns end level —
// each row with a tinted icon and a line saying what is inside.

const CARD_EDGE = '#EFE7DF';

/** Shop tools in the brand's tint; people, numbers and the account in a quiet one. */
function rowLook(groupKey: MoreGroupKey, itemKey: string) {
  if (itemKey === 'ai') return { wash: palette.surfaceStrong, ink: palette.primary, title: palette.primary };
  if (groupKey === 'shop') return { wash: palette.surfaceSubtle, ink: palette.primaryInk, title: palette.textStrong };
  return { wash: '#F3F0ED', ink: '#5B3A2B', title: palette.textStrong };
}

export default function MoreScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership, memberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const available = appNavigation.managementNavigation.filter((item) => appNavigation.isAllowed(item, activeMembership));
  const groups = groupMoreItems(available);
  const columns = width >= breakpoints.tabletWorkspace;

  const restaurant = activeMembership?.restaurant;
  const shopName = restaurant?.name?.trim() || copy('ร้านของฉัน', 'My restaurant');
  const branch = restaurant?.branch_name?.trim();
  // The same role word the overview's chip shows; a shop that renamed the role
  // sees its own name for it.
  const workTitle = getWorkModeCopy(activeMembership).title;
  const roleEn: Record<string, string> = { โหมดครัว: 'Kitchen', โหมดหน้าร้าน: 'Front of house', โหมดแคชเชียร์: 'Cashier', โหมดเจ้าของร้าน: 'Owner', โหมดทำงาน: 'Staff' };
  const role = activeMembership?.role?.display_name_override?.trim()
    || copy(workTitle.replace(/^โหมด/, '').trim(), roleEn[workTitle] || workTitle);

  const shopCard = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 22, borderCurve: 'continuous', backgroundColor: palette.surfaceSubtle, paddingVertical: columns ? 18 : 14, paddingHorizontal: columns ? 20 : 14 }}>
      <LinearGradient
        colors={[palette.primary, '#EF7A35']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff' }}>{restaurantMark(shopName)}</Text>
      </LinearGradient>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text accessibilityRole="header" numberOfLines={1} style={{ fontSize: 20, lineHeight: 26, fontWeight: '700', color: palette.textStrong }}>
          {shopName}{branch ? <Text style={{ fontSize: 15, fontWeight: '500', color: palette.muted }}>{` · ${branch}`}</Text> : null}
        </Text>
        {role ? (
          <View style={{ alignSelf: 'flex-start', marginTop: 3, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.accentMuted }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: palette.primaryInk }}>{role}</Text>
          </View>
        ) : null}
      </View>
      {memberships.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/restaurants' as never)}
          hitSlop={6}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.accentMuted, opacity: pressed ? 0.7 : 1 })}
        >
          <AppIcon name="swap-horizontal" size={16} color={palette.primaryInk} />
          <Text style={{ fontSize: 13, fontWeight: '600', color: palette.primaryInk }}>{copy('สลับร้าน', 'Switch')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const groupViews = groups.map((group) => (
    <View key={group.key} style={{ flex: columns ? 1 : undefined, minWidth: 0, gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '600', color: palette.placeholder, paddingHorizontal: 6 }}>
        {group.key === 'shop' ? copy('งานร้าน', 'Shop') : copy('ข้อมูลและบัญชี', 'Insights and account')}
      </Text>
      <View style={{ borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }}>
        {group.items.map((item, index) => {
          const detail = MORE_DETAILS[item.key];
          return (
            <ToolRow
              key={item.key}
              first={index === 0}
              icon={item.icon as AppIconName}
              title={language === 'th' ? item.label : item.labelEn}
              detail={detail ? (language === 'th' ? detail.th : detail.en) : undefined}
              look={rowLook(group.key, item.key)}
              onPress={() => router.push(item.href as never)}
            />
          );
        })}
      </View>
    </View>
  ));

  return (
    // The title stays the screen's name for screen readers but is not drawn:
    // it repeated the tab that opened it, and the shop card leads the page.
    <AppScreen hideTitle title={copy('เพิ่มเติม', 'More')} topLevel contentMaxWidth={columns ? 980 : undefined}>
      <View style={{ gap: columns ? spacing.xl : spacing.lg }}>
        {shopCard}
        {columns ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>{groupViews}</View>
        ) : groupViews}
      </View>
    </AppScreen>
  );
}
