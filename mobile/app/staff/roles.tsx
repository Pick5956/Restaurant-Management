import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { getRoles } from '@/src/api/auth';
import { listMembers } from '@/src/api/restaurant';
import { AppScreen } from '@/src/components/app-shell';
import { FORM_MAX_WIDTH, Note } from '@/src/components/form/parts';
import { HeadingAction } from '@/src/components/heading-action';
import { ReportCard } from '@/src/components/reports/parts';
import { Bone, ContentReveal, SkeletonReveal } from '@/src/components/skeleton';
import { RoleRow } from '@/src/components/staff/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import {
  allowedRoleOptions,
  canGrantRole,
  canManageRoles,
  roleLabel,
  roleListMeta,
  staffFailureDetail,
  teamRoleGroups,
  userDisplayName,
} from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, spacing } from '@/src/theme';
import type { Membership, Role } from '@/src/types/restaurant';

// Roles and permissions, redrawn on 15 ก.ย. 2569: one card of roles, each row
// with the same key tile and faces as the team card on the staff screen, so
// "มาตรฐาน · 18 สิทธิ์ · ยังไม่มีใคร" reads at a glance. The add button is the
// round orange one on the heading.

export default function RolesScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const actorRole = activeMembership?.role?.name;
  const restaurantId = activeMembership?.restaurant_id;
  const allowed = canManageRoles(activeMembership);
  const [roles, setRoles] = useState<Role[]>([]);
  const [members, setMembers] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  // The app's line under "โหลดบทบาทไม่ได้" when there is one, never the server's words.
  const [error, setError] = useState<{ detail?: string } | null>(null);
  const tablet = width >= breakpoints.tabletWorkspace;

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [roleResponse, memberResponse] = await Promise.all([
        getRoles(),
        restaurantId ? listMembers(restaurantId).catch(() => ({ members: [] as Membership[] })) : Promise.resolve({ members: [] as Membership[] }),
      ]);
      setRoles(
        allowedRoleOptions(actorRole, roleResponse.data || [], allowed)
          .filter((role) => canGrantRole(activeMembership, role)),
      );
      setMembers(memberResponse.members || []);
    } catch (err) {
      setError({ detail: staffFailureDetail(err, 'load', language) });
    } finally {
      setLoading(false);
    }
  }, [activeMembership, actorRole, allowed, language, restaurantId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const title = copy('บทบาทและสิทธิ์', 'Roles & permissions');

  if (!allowed) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <EmptyState
          title={copy('ไม่มีสิทธิ์จัดการบทบาท', 'No role management access')}
          detail={copy('บัญชีนี้ไม่ได้รับสิทธิ์จัดการบทบาทและสิทธิ์ของทีม', 'This account cannot manage team roles and permissions.')}
        />
      </AppScreen>
    );
  }

  // Only the roles this person may edit are listed, so the owner role is not
  // here; the members holding each role come along for the faces and count.
  const groups = teamRoleGroups(roles, members.filter((member) => roles.some((role) => role.ID === (member.role?.ID ?? member.role_id))));

  return (
    <AppScreen
      title={title}
      subtitle={copy('เจ้าของร้านมีทุกสิทธิ์ แก้ไม่ได้', 'The owner has every permission and cannot be edited')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
      action={<HeadingAction compact={!tablet} icon="add" label={copy('เพิ่มบทบาท', 'Add role')} onPress={() => router.push('/staff/role' as never)} />}
    >
      {error ? <Feedback title={copy('โหลดบทบาทไม่ได้', 'Unable to load roles')} detail={error.detail} tone="danger" /> : null}
      {loading && !roles.length ? (
        <SkeletonReveal label={copy('กำลังโหลดบทบาท', 'Loading roles')} style={{ gap: spacing.md }}>
          <Bone height={280} radius={18} />
        </SkeletonReveal>
      ) : (
        <ContentReveal style={{ gap: spacing.md }}>
          {groups.length ? (
            <ReportCard>
              {groups.map((group, index) => {
                const meta = roleListMeta(group.role, language);
                return (
                  <RoleRow
                    key={group.role.ID}
                    first={index === 0}
                    title={roleLabel(group.role, language)}
                    detail={`${meta.typeLabel} · ${meta.permissionLabel}`}
                    people={group.members.map((member) => ({ seed: member.user_id ?? member.ID, name: userDisplayName(member.user, language) }))}
                    onPress={() => router.push({ pathname: '/staff/role' as never, params: { id: String(group.role.ID) } } as never)}
                    language={language}
                  />
                );
              })}
            </ReportCard>
          ) : (
            <EmptyState title={copy('ยังไม่มีบทบาทที่จัดการได้', 'No manageable roles yet')} detail={copy('เพิ่มบทบาทใหม่สำหรับงานของร้านนี้', 'Add a new role for this restaurant.')} />
          )}
          <Note text={copy('บทบาทมาตรฐานเปลี่ยนชื่อและสิทธิ์ได้ แต่ซ่อนได้เท่านั้น ลบไม่ได้ · บทบาทที่สร้างเองลบได้เมื่อไม่มีใครถืออยู่', 'Standard roles can be renamed and re-permissioned but only hidden, never deleted · a role you created can be deleted once nobody holds it')} />
        </ContentReveal>
      )}
    </AppScreen>
  );
}
