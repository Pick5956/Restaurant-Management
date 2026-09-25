import { router } from 'expo-router';

import { appNavigation } from '@/src/components/app-shell';
import { HubStage } from '@/src/components/hub/hub-stage';
import { useHubData, useHubLoaderPlan } from '@/src/hooks/use-hub-data';
import { branchLabel } from '@/src/lib/hub-data';
import type { HubGroupKey, HubLayoutProps, HubNavItem, HubRowKey } from '@/src/lib/hub-types';
import { groupMoreItems, MORE_TITLES, restaurantMark } from '@/src/lib/more-screen';
import { getWorkModeCopy } from '@/src/lib/work-mode';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';

// The hub every session lands on (the phone dock went on 2026-09-23). The owner
// picked layout B "เวที" over A "กระดานกะ", and on 2026-09-24 asked for the
// A/B switch at the foot of the page to go.

export default function MoreScreen() {
  const { activeMembership, memberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const data = useHubData();
  const plan = useHubLoaderPlan();

  const allowed = [
    ...appNavigation.primaryNavigation.filter((item) => item.key !== 'more'),
    ...appNavigation.managementNavigation,
  ].filter((item) => appNavigation.isAllowed(item, activeMembership));
  const items: HubNavItem[] = groupMoreItems(allowed).flatMap((group) => group.items.map((item) => {
    const override = MORE_TITLES[item.key];
    return {
      key: item.key as HubRowKey,
      title: override
        ? (language === 'th' ? override.th : override.en)
        : (language === 'th' ? item.label : item.labelEn),
      icon: item.icon,
      href: item.href,
      group: group.key as HubGroupKey,
    };
  }));

  const restaurant = activeMembership?.restaurant;
  const shopName = restaurant?.name?.trim() || copy('ร้านของฉัน', 'My restaurant');
  // The same role word the overview's chip shows; a shop that renamed the role
  // sees its own name for it.
  const workTitle = getWorkModeCopy(activeMembership).title;
  const roleEn: Record<string, string> = { โหมดครัว: 'Kitchen', โหมดหน้าร้าน: 'Front of house', โหมดแคชเชียร์: 'Cashier', โหมดเจ้าของร้าน: 'Owner', โหมดทำงาน: 'Staff' };
  const role = activeMembership?.role?.display_name_override?.trim()
    || copy(workTitle.replace(/^โหมด/, '').trim(), roleEn[workTitle] || workTitle);

  const props: HubLayoutProps = {
    shop: {
      name: shopName,
      branch: branchLabel(restaurant?.branch_name, language),
      role,
      mark: restaurantMark(shopName),
      logoUrl: restaurant?.logo?.trim() || null,
      coverUrl: restaurant?.cover_image?.trim() || null,
      canSwitch: memberships.length > 1,
      onSwitch: () => router.push('/restaurants' as never),
    },
    items,
    data,
    showTakings: plan.takings,
    onOpen: (item) => {
      data.noteOpened(item.key);
      router.push(item.href as never);
    },
  };

  return <HubStage {...props} />;
}
