import { Redirect, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AuthScreen } from '@/src/components/auth-screen';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { Button, EmptyState, Feedback } from '@/src/components/ui';
import { restaurantMark } from '@/src/lib/more-screen';
import { roleLabel } from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette, spacing } from '@/src/theme';
import type { Membership } from '@/src/types/restaurant';

// Redrawn 16 ก.ย. 2569. It was two thin lists under headings that counted and
// explained themselves - "2 ร้าน", "สร้างร้านของคุณหรือเข้าร่วมทีมที่มีอยู่" -
// over a lot of empty page. A shop is now a card carrying its own mark, the way
// it reads on "เพิ่มเติม", and the two ways to add one sit underneath as rows.

const CARD_EDGE = '#EFE7DF';

function ShopCard({ membership, active, onPress, currentLabel, language }: {
  membership: Membership;
  active: boolean;
  onPress: () => void;
  currentLabel: string;
  language: 'th' | 'en';
}) {
  const name = membership.restaurant?.name?.trim()
    || (language === 'th' ? `ร้าน #${membership.restaurant_id}` : `Restaurant #${membership.restaurant_id}`);
  const branch = membership.restaurant?.branch_name?.trim();
  const role = roleLabel(membership.role, language);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={language === 'th' ? `เลือกร้าน ${name}` : `Choose ${name}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 22,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: active ? palette.accentMuted : CARD_EDGE,
        backgroundColor: active ? palette.surfaceSubtle : palette.surface,
        paddingVertical: 14,
        paddingHorizontal: 14,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <LinearGradient
        colors={active ? [palette.primary, '#EF7A35'] : ['#E7DCD2', '#D8C9BC']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: 52, height: 52, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: active ? '#fff' : palette.textStrong }}>
          {restaurantMark(name)}
        </Text>
      </LinearGradient>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.textStrong }}>{name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: palette.muted }}>
          {[branch, role].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {active ? (
        <View style={{ borderRadius: 999, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.accentMuted, paddingVertical: 2, paddingHorizontal: 10 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: palette.primaryInk }}>{currentLabel}</Text>
        </View>
      ) : (
        <AppIcon name="chevron-forward" size={19} color={palette.placeholder} />
      )}
    </Pressable>
  );
}

function AddRow({ icon, title, first, onPress }: {
  icon: AppIconName;
  title: string;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 56,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.divider,
        backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
      })}
    >
      <View style={{ width: 38, height: 38, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
        <AppIcon name={icon} size={21} color={palette.primaryInk} />
      </View>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, fontWeight: '500', color: palette.textStrong }}>{title}</Text>
      <AppIcon name="chevron-forward" size={19} color={palette.placeholder} />
    </Pressable>
  );
}

export default function RestaurantsScreen() {
  const {
    activeMembership,
    memberships,
    membershipsLoadError,
    refreshMemberships,
    selectRestaurant,
    user,
  } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const [retrying, setRetrying] = useState(false);

  if (!user) return <Redirect href="/login" />;

  async function retryMemberships() {
    setRetrying(true);
    try {
      await refreshMemberships();
    } catch {
      // The provider keeps the contextual error visible for another retry.
    } finally {
      setRetrying(false);
    }
  }

  return (
    <AuthScreen title={copy('เลือกร้าน', 'Choose a restaurant')}>
      <View style={{ gap: spacing.lg }}>
        {membershipsLoadError ? (
          <>
            <Feedback
              title={copy('โหลดร้านของคุณไม่สำเร็จ', 'Could not load your restaurants')}
              detail={copy(
                'บัญชีของคุณยังอยู่ในระบบ ข้อมูลนี้ไม่ได้หมายความว่าคุณไม่มีร้าน',
                'You are still signed in. This does not mean that you have no restaurants.',
              )}
              tone="warning"
            />
            <Button
              variant="secondary"
              label={copy('ลองอีกครั้ง', 'Try again')}
              onPress={retryMemberships}
              loading={retrying}
            />
          </>
        ) : null}

        {memberships.length ? (
          <View style={{ gap: spacing.md }}>
            {memberships.map((membership) => (
              <ShopCard
                key={membership.ID}
                membership={membership}
                active={activeMembership?.restaurant_id === membership.restaurant_id}
                currentLabel={copy('ร้านปัจจุบัน', 'Current')}
                language={language}
                onPress={() => selectRestaurant(membership)}
              />
            ))}
          </View>
        ) : !membershipsLoadError ? (
          <EmptyState
            title={copy('ยังไม่มีร้าน', 'No restaurants yet')}
            detail={copy(
              'สร้างร้านใหม่หรือเปิดคำเชิญจากเจ้าของร้าน',
              'Create a restaurant or open an invitation from the owner.',
            )}
          />
        ) : null}

        {!membershipsLoadError || memberships.length ? (
          <View style={{ borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }}>
            <AddRow
              first
              icon="add-outline"
              title={copy('สร้างร้านใหม่', 'Create restaurant')}
              onPress={() => router.push('/create-restaurant' as never)}
            />
            <AddRow
              first={false}
              icon="mail-open-outline"
              title={copy('เปิดคำเชิญ', 'Open invitation')}
              onPress={() => router.push('/invite/manual' as never)}
            />
          </View>
        ) : null}
      </View>
    </AuthScreen>
  );
}
