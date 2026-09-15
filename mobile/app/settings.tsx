import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ToolRow } from '@/src/components/tool-row';
import { can } from '@/src/lib/rbac';
import { canAccessTeam, memberInitials, roleLabel, userDisplayName } from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { usePrinter } from '@/src/providers/printer-provider';
import { breakpoints, palette, spacing } from '@/src/theme';

// Settings, redrawn on 15 ก.ย. 2569 from the three-screens design. It had been
// bare rows on white, each about 90pt tall, with "ร้านที่ใช้งาน" a heading you
// could not tap and signing out the last row with nothing setting it apart.
// Now: who is signed in at the top (tap to edit the account), two groups in
// the "เพิ่มเติม" screen's rows — each saying what it is set to — and signing
// out in a card of its own. On a tablet the groups sit side by side.

const CARD_EDGE = '#EFE7DF';
const ACCOUNT_LOOK = { wash: palette.surfaceSubtle, ink: palette.primaryInk, title: palette.textStrong };
const SHOP_LOOK = { wash: '#F3F0ED', ink: '#5B3A2B', title: palette.textStrong };
const DANGER_LOOK = { wash: palette.dangerSoft, ink: palette.danger, title: palette.danger };

type Row = { key: string; icon: AppIconName; title: string; detail: string; onPress: () => void };

export default function SettingsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership, signOut, user } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const columns = width >= breakpoints.tabletWorkspace;
  const canManageRestaurant = can(activeMembership, 'manage_restaurant_settings');
  const canManageTeam = canAccessTeam(activeMembership);
  const { selectedPrinter, supported: printerSupported } = usePrinter();

  const name = userDisplayName(user, language);
  const shopName = activeMembership?.restaurant?.name?.trim() || copy('ร้านของฉัน', 'My restaurant');
  const role = activeMembership?.role ? roleLabel(activeMembership.role, language) : '';
  const printerDetail = !printerSupported
    ? copy('รองรับเฉพาะ Android', 'Android only')
    : selectedPrinter?.name || copy('ยังไม่ได้เลือกเครื่องพิมพ์', 'No printer selected');
  const version = Constants.expoConfig?.version;

  const accountRows: Row[] = [
    { key: 'display', icon: 'text-outline', title: copy('การแสดงผล', 'Display'), detail: copy('ภาษา · ไทย', 'Language · English'), onPress: () => router.push('/settings/display' as never) },
    { key: 'printer', icon: 'print-outline', title: copy('เครื่องพิมพ์ใบเสร็จ', 'Receipt printer'), detail: printerDetail, onPress: () => router.push('/settings/printer' as never) },
  ];
  const shopRows: Row[] = [
    ...(canManageRestaurant ? [{ key: 'restaurant', icon: 'storefront-outline' as const, title: copy('ข้อมูลร้าน', 'Restaurant'), detail: copy(`${shopName} · บิล · QR สั่งอาหาร`, `${shopName} · bills · ordering QR`), onPress: () => router.push('/settings/restaurant' as never) }] : []),
    ...(canManageTeam ? [{ key: 'team', icon: 'people-outline' as const, title: copy('ทีมและสิทธิ์', 'Team and access'), detail: copy('สมาชิก บทบาท คำเชิญ', 'Members, roles, invitations'), onPress: () => router.push('/staff' as never) }] : []),
    { key: 'switch', icon: 'swap-horizontal-outline', title: copy('สลับร้าน', 'Switch restaurant'), detail: copy(`ตอนนี้: ${shopName}`, `Now: ${shopName}`), onPress: () => router.push('/restaurants' as never) },
  ];

  const group = (title: string, rows: Row[], look: { wash: string; ink: string; title: string }) => (
    <View style={{ gap: spacing.sm }}>
      <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '600', color: palette.placeholder, paddingHorizontal: 6 }}>{title}</Text>
      <View style={{ borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }}>
        {rows.map((row, index) => (
          <ToolRow key={row.key} first={index === 0} icon={row.icon} title={row.title} detail={row.detail} look={look} onPress={row.onPress} />
        ))}
      </View>
    </View>
  );

  const accountCard = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copy(`${name}, ${user?.email ?? ''} แตะเพื่อแก้บัญชี`, `${name}, ${user?.email ?? ''}, tap to edit your account`)}
      onPress={() => router.push('/settings/account' as never)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 22, borderCurve: 'continuous', backgroundColor: palette.surfaceSubtle, paddingVertical: columns ? 18 : 14, paddingHorizontal: columns ? 20 : 14, opacity: pressed ? 0.8 : 1 })}
    >
      <LinearGradient
        colors={[palette.primary, '#EF7A35']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 19, fontWeight: '700', color: '#fff' }}>{memberInitials(name)}</Text>
      </LinearGradient>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 18, lineHeight: 24, fontWeight: '700', color: palette.textStrong }}>{name}</Text>
        {user?.email ? (
          <Text numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 17, color: palette.muted }}>
            {user.email}{user.auth_provider === 'google' ? copy(' · เข้าด้วย Google', ' · Google sign-in') : ''}
          </Text>
        ) : null}
        <View style={{ alignSelf: 'flex-start', marginTop: 4, borderRadius: 999, paddingVertical: 1, paddingHorizontal: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.accentMuted }}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: palette.primaryInk }}>{role ? `${role} · ${shopName}` : shopName}</Text>
        </View>
      </View>
      <AppIcon name="chevron-forward" size={20} color={palette.placeholder} />
    </Pressable>
  );

  const signOutCard = (
    <View style={{ gap: spacing.sm }}>
      <View style={{ borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }}>
        <ToolRow first icon="log-out-outline" title={copy('ออกจากระบบ', 'Sign out')} detail={user?.email} look={DANGER_LOOK} onPress={signOut} showChevron={false} />
      </View>
      {version ? <Text style={{ fontSize: 11.5, color: palette.placeholder, textAlign: 'center' }}>{`Dishy ${version}`}</Text> : null}
    </View>
  );

  const accountGroup = group(copy('บัญชี', 'Account'), accountRows, ACCOUNT_LOOK);
  const shopGroup = group(copy('ร้าน', 'Restaurant'), shopRows, SHOP_LOOK);

  return (
    <AppScreen title={copy('ตั้งค่า', 'Settings')} topLevel={false} centerTitle contentMaxWidth={columns ? 980 : undefined}>
      <View style={{ gap: columns ? spacing.xl : spacing.lg }}>
        {accountCard}
        {columns ? (
          // Signing out goes under the account group: two rows and a card
          // there, three rows on the right, so the columns end level.
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
            <View style={{ flex: 1, minWidth: 0, gap: spacing.lg }}>
              {accountGroup}
              {signOutCard}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>{shopGroup}</View>
          </View>
        ) : (
          <>
            {accountGroup}
            {shopGroup}
            {signOutCard}
          </>
        )}
      </View>
    </AppScreen>
  );
}
