import { router } from 'expo-router';
import { useWindowDimensions, View } from 'react-native';

import { appNavigation, AppScreen } from '@/src/components/app-shell';
import { EdgeRow, EdgeSection, EdgeSectionHeader } from '@/src/components/ui';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, spacing } from '@/src/theme';

const toolGroups = [
  { key: 'restaurant', itemKeys: ['menu', 'inventory', 'tables-manage'] },
  { key: 'team', itemKeys: ['staff', 'reports', 'expenses', 'ai'] },
  { key: 'account', itemKeys: ['settings'] },
] as const;

export default function MoreScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const available = appNavigation.managementNavigation.filter((item) => appNavigation.isAllowed(item, activeMembership));
  const columns = width >= breakpoints.tabletWorkspace;

  return (
    // The title is kept as the screen's name for screen readers but not drawn:
    // it repeated the tab that opened it, and the three group headings below say
    // what is actually on the page. They lead it now.
    <AppScreen hideTitle title={copy('เพิ่มเติม', 'More')} topLevel>
      <View style={{ alignItems: 'flex-start', flexDirection: columns ? 'row' : 'column', flexWrap: 'wrap', gap: spacing.xxl }}>
        {toolGroups.map((group) => {
          const items = available.filter((item) => group.itemKeys.includes(item.key as never));
          if (!items.length) return null;
          const title = group.key === 'restaurant'
            ? copy('จัดการร้าน', 'Restaurant setup')
            : group.key === 'team'
              ? copy('ทีมและข้อมูล', 'Team and insights')
              : copy('บัญชีและการแสดงผล', 'Account and display');
          return (
            <View
              key={group.key}
              style={[
                { gap: spacing.sm },
                {
                  width: columns ? '48.5%' : '100%',
                  flexGrow: 1,
                  flexBasis: columns ? 360 : undefined,
                },
              ]}
            >
              <EdgeSectionHeader prominent title={title} />
              <EdgeSection>
                {items.map((item) => (
                  <EdgeRow
                    icon={item.icon}
                    key={item.key}
                    onPress={() => router.push(item.href as never)}
                    title={language === 'th' ? item.label : item.labelEn}
                  />
                ))}
              </EdgeSection>
            </View>
          );
        })}
      </View>
    </AppScreen>
  );
}
