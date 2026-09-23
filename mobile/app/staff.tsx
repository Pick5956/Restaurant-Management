import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Share, useWindowDimensions, View } from 'react-native';

import { getRoles } from '@/src/api/auth';
import {
  listAuditLogs,
  listMembers,
  listPendingInvitations,
  revokeInvitation,
} from '@/src/api/restaurant';
import { AppIcon } from '@/src/components/app-icon';
import { AppRefreshControl, AppScreen, type AppScreenScrollControl } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { HeadingAction } from '@/src/components/heading-action';
import { CardHeading, ReportCard } from '@/src/components/reports/parts';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { ActivityRow, GhostButton, MemberRow, RoleRow, shortDateTime, StaffTabs, TeamStats } from '@/src/components/staff/parts';
import { Button, EmptyState, Feedback } from '@/src/components/ui';
import {
  allowedRoleOptions,
  auditAttribution,
  auditMessage,
  canAccessTeam,
  canGrantRole,
  canManageInvitations,
  canManageMembers,
  canManageRoles,
  canManageTarget,
  canViewTeamAudit,
  isInvitationUsableAt,
  roleLabel,
  staffStatusLabel,
  teamActivityCopy,
  teamRoleGroups,
  userDisplayName,
} from '@/src/lib/staff-workflow';
import { invitationUrl } from '@/src/lib/public-web-url';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import type {
  AdminInvitation,
  Membership,
  RestaurantAuditLog,
  Role,
} from '@/src/types/restaurant';

// Staff and permissions, redrawn on 15 ก.ย. 2569 from the three-screens design.
// Members, invitations, roles and activity had been stacked down one page, the
// roles button floated beside the members heading, and the assistant's menu
// switches showed as the raw key "ai_set_menu_availability". Now a phone gets
// three tabs — members, invitations, activity — and a tablet shows members,
// invitations and roles on the left with the activity beside them, no tabs.
//
// The members tab first carried the latest three activities too, the same rows
// the activity tab opens with. The owner chose design B instead the same day:
// the team's counts, and every role in the shop with who holds it — empty
// roles included, since "เชฟ · ยังไม่มีใคร" is the useful thing to see.

const auditPageSize = 10;

type StaffTab = 'members' | 'invitations' | 'activity';

function formatDateTime(value: string | undefined, language: 'th' | 'en') {
  if (!value) return language === 'th' ? 'ไม่ระบุเวลา' : 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return language === 'th' ? 'ไม่ระบุเวลา' : 'Time unavailable';
  }
  return date.toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function StaffScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership, user } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const restaurantId = activeMembership?.restaurant_id;
  const actorRole = activeMembership?.role?.name;
  const allowed = canAccessTeam(activeMembership);
  const canInvite = canManageInvitations(activeMembership);
  const canEditStatuses = canManageMembers(activeMembership);
  const canEditRoles = canManageRoles(activeMembership);
  const canViewAudit = canViewTeamAudit(activeMembership);
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [auditLogs, setAuditLogs] = useState<RestaurantAuditLog[]>([]);
  const [auditHasMore, setAuditHasMore] = useState(false);
  const [auditOffset, setAuditOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadedRestaurantId, setLoadedRestaurantId] = useState<number | null>(null);
  const [loadingMoreAudit, setLoadingMoreAudit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [tab, setTab] = useState<StaffTab>('members');
  const scrollControlRef = useRef<AppScreenScrollControl | null>(null);
  const tablet = width >= breakpoints.tabletWorkspace;
  const activityCopy = teamActivityCopy(language);
  const hasLoadedTeam = restaurantId != null && loadedRestaurantId === restaurantId;
  const initialLoading = loading && !hasLoadedTeam;

  const load = useCallback(async () => {
    if (!restaurantId || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [memberResponse, invitationResponse, auditResponse, roleResponse] = await Promise.all([
        listMembers(restaurantId),
        canInvite ? listPendingInvitations(restaurantId) : Promise.resolve({ invitations: [] }),
        canViewAudit
          ? listAuditLogs(restaurantId, auditPageSize, 0)
          : Promise.resolve({ logs: [], has_more: false, next_offset: 0 }),
        // The roles card can still draw from the members' own roles without this.
        getRoles().catch(() => ({ data: [] as Role[] })),
      ]);
      setMembers(memberResponse.members || []);
      setRoles(roleResponse.data || []);
      setInvitations(invitationResponse.invitations || []);
      setAuditLogs(auditResponse.logs || []);
      setAuditHasMore(Boolean(auditResponse.has_more));
      setAuditOffset(auditResponse.next_offset || auditResponse.logs.length);
      setLoadedRestaurantId(restaurantId);
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : copy('โหลดข้อมูลทีมงานไม่สำเร็จ', 'Unable to load team data'));
    } finally {
      setLoading(false);
    }
  }, [allowed, canInvite, canViewAudit, copy, restaurantId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  async function loadMoreAudit() {
    if (!restaurantId || !canViewAudit || loadingMoreAudit || !auditHasMore) return;
    setLoadingMoreAudit(true);
    setError(null);
    try {
      const response = await listAuditLogs(restaurantId, auditPageSize, auditOffset);
      setAuditLogs((current) => [...current, ...(response.logs || [])]);
      setAuditHasMore(Boolean(response.has_more));
      setAuditOffset(response.next_offset || auditOffset + response.logs.length);
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : copy('โหลดประวัติทีมงานไม่สำเร็จ', 'Unable to load team history'));
    } finally {
      setLoadingMoreAudit(false);
    }
  }

  async function revoke(invitation: AdminInvitation) {
    if (!restaurantId || !canInvite) return;
    if (confirmRevokeId !== invitation.ID) {
      setConfirmRevokeId(invitation.ID);
      return;
    }
    try {
      await revokeInvitation(restaurantId, invitation.ID);
      setConfirmRevokeId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : copy('ยกเลิกคำเชิญไม่สำเร็จ', 'Unable to revoke invitation'));
    }
  }

  async function share(invitation: AdminInvitation) {
    if (!isInvitationUsableAt(invitation)) return;
    const restaurantName = activeMembership?.restaurant?.name
      || copy('ร้านอาหาร', 'Restaurant');
    const link = invitationUrl(invitation.token);
    await Share.share({
      title: copy(
        `คำเชิญเข้าร่วมร้าน ${restaurantName} บน Dishy`,
        `Invitation to join ${restaurantName} on Dishy`,
      ),
      message: copy(
        `คุณได้รับคำเชิญเข้าร่วมร้าน ${restaurantName} ในบทบาท ${roleLabel(invitation.role, language)}\n${link}`,
        `You have been invited to join ${restaurantName} as ${roleLabel(invitation.role, language)}.\n${link}`,
      ),
    });
  }

  if (!allowed) {
    return (
      <AppScreen title={copy('พนักงานและสิทธิ์', 'Staff & permissions')} topLevel={false} centerTitle>
        <EmptyState
          title={copy('ไม่มีสิทธิ์จัดการทีม', 'No team management access')}
          detail={copy(
            'ต้องได้รับสิทธิ์อย่างน้อยหนึ่งด้านในการดูแลทีมงาน',
            'You need at least one team administration permission.',
          )}
        />
      </AppScreen>
    );
  }

  const inviteStaff = () => router.push('/staff/invite' as never);
  const openRoles = () => router.push('/staff/roles' as never);
  const activeCount = members.filter((member) => member.status === 'active').length;
  const teamSummary = copy(
    `${members.length} คนในทีม, ใช้งาน ${activeCount}`,
    `${members.length} in the team, ${activeCount} active`,
  );

  // ---------------------------------------------------------------- members

  const memberRows = members.map((member, index) => {
    const canEditAccess = canEditRoles && member.role
      ? canGrantRole(activeMembership, member.role)
      : false;
    const hasTargetAction = canEditStatuses || canEditAccess;
    const manageable = hasTargetAction && canManageTarget(
      actorRole,
      member.role?.name,
      member.user_id === user?.ID,
      hasTargetAction,
    );
    const displayName = userDisplayName(member.user, language);
    const displayRole = roleLabel(member.role, language);
    const displayStatus = staffStatusLabel(member.status, language);
    return (
      <MemberRow
        key={member.ID}
        seed={member.user_id ?? member.ID}
        first={index === 0}
        name={displayName}
        email={member.user?.email}
        role={displayRole}
        status={member.status}
        statusLabel={displayStatus}
        label={`${displayName}, ${displayRole}, ${displayStatus}${manageable ? '' : `, ${copy('ดูข้อมูลเท่านั้น', 'View only')}`}`}
        onPress={manageable
          ? () => router.push({ pathname: '/staff/member' as never, params: { id: String(member.ID) } } as never)
          : undefined}
      />
    );
  });
  const membersCard = (
    <ReportCard>
      {tablet ? <CardHeading title={copy('สมาชิก', 'Members')} detail={teamSummary} /> : null}
      {members.length ? memberRows : (
        <Text style={{ paddingHorizontal: 16, paddingVertical: 18, fontSize: 13.5, color: palette.placeholder }}>
          {canInvite ? copy('ยังไม่มีสมาชิกในทีม · แตะเชิญเพื่อเพิ่มพนักงาน', 'No team members yet · tap Invite to add staff') : copy('ยังไม่มีสมาชิกในทีม', 'No team members yet')}
        </Text>
      )}
    </ReportCard>
  );

  // ---------------------------------------------------------------- roles

  const roleGroups = teamRoleGroups(roles, members);
  const rolesCard = roleGroups.length ? (
    <ReportCard>
      <CardHeading
        title={copy('บทบาทในร้าน', 'Roles in the shop')}
        detail={canEditRoles ? copy('แตะบทบาทเพื่อดูและแก้สิทธิ์', 'Tap a role to see its permissions') : copy('แต่ละบทบาทมีใครบ้าง', 'Who holds each role')}
        trailing={canEditRoles ? <GhostButton icon="settings-outline" label={copy('จัดการ', 'Manage')} onPress={openRoles} /> : undefined}
      />
      {roleGroups.map((group, index) => {
        const editable = canEditRoles
          && allowedRoleOptions(actorRole, [group.role], true).length > 0
          && canGrantRole(activeMembership, group.role);
        return (
          <RoleRow
            key={group.role.ID}
            first={index === 0}
            title={roleLabel(group.role, language)}
            people={group.members.map((member) => ({ seed: member.user_id ?? member.ID, name: userDisplayName(member.user, language) }))}
            onPress={editable ? () => router.push({ pathname: '/staff/role' as never, params: { id: String(group.role.ID) } } as never) : undefined}
            language={language}
          />
        );
      })}
    </ReportCard>
  ) : null;
  const suspendedCount = members.filter((member) => member.status === 'suspended').length;
  const teamStats = (
    <TeamStats
      stats={[
        { key: 'active', label: copy('ใช้งาน', 'Active'), value: activeCount, tone: 'good' },
        { key: 'suspended', label: copy('ระงับ', 'Suspended'), value: suspendedCount },
        ...(canInvite ? [{ key: 'invites', label: copy('คำเชิญรอ', 'Invites waiting'), value: invitations.length, tone: 'wait' as const }] : []),
      ]}
    />
  );

  // ---------------------------------------------------------------- invitations

  const invitationRows = invitations.map((invitation, index) => {
    const usable = isInvitationUsableAt(invitation);
    const confirming = confirmRevokeId === invitation.ID;
    return (
      <View key={invitation.ID} style={{ gap: spacing.sm, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: index ? 1 : 0, borderTopColor: palette.divider }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E0F2FE' }}>
            <AppIcon name="mail-outline" size={19} color="#0369A1" />
          </View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <Text selectable numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: palette.textStrong }}>
              {invitation.email || copy('ลิงก์เชิญทั่วไป', 'General invitation link')}
            </Text>
            <Text selectable numberOfLines={2} style={{ fontSize: 12, lineHeight: 17, color: palette.placeholder }}>
              {roleLabel(invitation.role, language)}, {invitation.expires_at
                ? copy(`หมดอายุ ${formatDateTime(invitation.expires_at, language)}`, `Expires ${formatDateTime(invitation.expires_at, language)}`)
                : copy('ไม่หมดอายุ', 'Never expires')}
            </Text>
          </View>
          <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: usable ? palette.successSoft : palette.warningSoft }}>
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: usable ? palette.success : palette.warning }}>
              {usable ? copy('พร้อมแชร์', 'Ready to share') : copy('หมดอายุแล้ว', 'Expired')}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm }}>
          {usable && !confirming ? <GhostButton icon="share-social-outline" label={copy('แชร์ลิงก์', 'Share link')} onPress={() => share(invitation)} /> : null}
          {confirming ? <GhostButton icon="close-outline" label={copy('เก็บลิงก์ไว้', 'Keep link')} onPress={() => setConfirmRevokeId(null)} /> : null}
          {confirming
            ? <Button compact variant="danger" icon="trash-outline" label={copy('ยืนยันยกเลิก', 'Confirm revoke')} onPress={() => revoke(invitation)} />
            : <GhostButton tone="danger" icon="close-circle-outline" label={copy('ยกเลิกลิงก์', 'Revoke link')} onPress={() => revoke(invitation)} />}
        </View>
      </View>
    );
  });
  const invitationsEmpty = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FFFAF5', borderTopWidth: tablet ? 1 : 0, borderTopColor: palette.divider }}>
      <AppIcon name="mail-outline" size={19} color={palette.primaryInk} />
      <Text style={{ flex: 1, fontSize: 13, lineHeight: 19, color: palette.muted }}>
        {copy('ยังไม่มีคำเชิญค้างอยู่ · สร้างลิงก์เชิญแล้วส่งให้พนักงานได้เลย', 'No pending invitations · create a link and send it to your staff')}
      </Text>
      {!tablet ? <GhostButton icon="person-add-outline" label={copy('เชิญ', 'Invite')} onPress={inviteStaff} /> : null}
    </View>
  );
  const invitationsCard = (
    <ReportCard>
      {tablet ? <CardHeading title={copy('คำเชิญที่รอรับ', 'Pending invitations')} detail={invitations.length ? copy(`${invitations.length} ลิงก์`, `${invitations.length} links`) : copy('ยังไม่มี', 'None')} /> : null}
      {invitations.length ? invitationRows : invitationsEmpty}
    </ReportCard>
  );

  // ---------------------------------------------------------------- activity

  const activityRows = (logs: RestaurantAuditLog[]) => logs.map((log, index) => (
    <ActivityRow
      key={log.ID}
      first={index === 0}
      action={log.action}
      message={auditMessage(log, language)}
      attribution={auditAttribution(log, language)}
      when={shortDateTime(log.CreatedAt, language)}
    />
  ));
  const activityEmpty = (
    <View style={{ minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 14, paddingVertical: spacing.md }}>
      <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: palette.surfaceSubtle }}>
        <AppIcon color={palette.primaryInk} name="time-outline" size={20} />
      </View>
      <View style={{ minWidth: 0, flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{activityCopy.emptyTitle}</Text>
        <Text style={{ fontSize: 12, color: palette.placeholder }}>{activityCopy.emptyDetail}</Text>
      </View>
    </View>
  );
  const loadMore = auditHasMore ? (
    <View style={{ padding: 14, borderTopWidth: auditLogs.length ? 1 : 0, borderTopColor: palette.divider }}>
      <Button variant="secondary" icon="time-outline" label={copy('ดูเหตุการณ์ก่อนหน้า', 'View earlier activity')} onPress={loadMoreAudit} loading={loadingMoreAudit} />
    </View>
  ) : null;
  const activityCard = (
    <ReportCard>
      {tablet ? <CardHeading title={activityCopy.sectionTitle} detail={copy('ใครทำอะไรกับทีมและร้าน · ล่าสุดก่อน', 'Who changed what · newest first')} /> : null}
      {auditLogs.length ? activityRows(auditLogs) : activityEmpty}
      {loadMore}
    </ReportCard>
  );

  // ---------------------------------------------------------------- layout

  const tabs: { key: StaffTab; label: string }[] = [
    { key: 'members', label: copy(`สมาชิก ${members.length}`, `Members ${members.length}`) },
    ...(canInvite ? [{ key: 'invitations' as const, label: copy(`คำเชิญ ${invitations.length}`, `Invites ${invitations.length}`) }] : []),
    ...(canViewAudit ? [{ key: 'activity' as const, label: copy('กิจกรรม', 'Activity') }] : []),
  ];
  const shownTab = tabs.some((item) => item.key === tab) ? tab : 'members';

  // The compact bar's row (23 ก.ย. 2569): the same tabs, on the same state, so
  // a reader deep in the members or the activity can switch without scrolling
  // back up. A switch from there starts the new tab from the top - the tabs
  // differ in length, and left where it was, iOS strands the offset past the
  // end of a shorter one. The tab already shown just glides back to its start.
  const selectTabFromBar = (key: StaffTab) => {
    scrollControlRef.current?.scrollTo(0, key === shownTab);
    setTab(key);
  };
  // Phone only, and only while the page shows its own tabs: the tablet lays
  // every section out at once.
  const compactTabs = !tablet && hasLoadedTeam && tabs.length > 1
    ? <StaffTabs<StaffTab> compact tabs={tabs} value={shownTab} onChange={selectTabFromBar} />
    : undefined;

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดทีมงาน', 'Loading team')} style={{ gap: spacing.md }}>
      {tablet ? (
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <View style={{ flex: 1, gap: spacing.md }}>
            <Bone height={240} radius={18} />
            <Bone height={96} radius={18} />
          </View>
          <View style={{ flex: 1.1 }}><Bone height={420} radius={18} /></View>
        </View>
      ) : (
        <>
          <Bone height={40} radius={999} />
          <Bone height={220} radius={18} />
          <Bone height={180} radius={18} />
        </>
      )}
    </SkeletonReveal>
  );

  const phoneBody = shownTab === 'members' ? (
    <>
      {teamStats}
      {membersCard}
      {rolesCard}
    </>
  ) : shownTab === 'invitations' ? invitationsCard : activityCard;

  const tabletBody = (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ flex: 1, fontSize: 14, color: palette.muted }}>{teamSummary}</Text>
        {canInvite ? <HeadingAction compact={false} icon="person-add-outline" label={copy('เชิญพนักงาน', 'Invite staff')} onPress={inviteStaff} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ flex: 1, minWidth: 0, gap: spacing.lg }}>
          {membersCard}
          {canInvite ? invitationsCard : null}
          {rolesCard}
        </View>
        {canViewAudit ? <View style={{ flex: 1.1, minWidth: 0 }}>{activityCard}</View> : null}
      </View>
    </View>
  );

  return (
    <AppScreen
      title={copy('พนักงานและสิทธิ์', 'Staff & permissions')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? 1180 : undefined}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      // The compact bar repeats this: it is a push, so a second copy is harmless.
      action={canInvite && !tablet ? <HeadingAction compact icon="person-add-outline" label={copy('เชิญพนักงาน', 'Invite staff')} onPress={inviteStaff} /> : undefined}
      scrollControlRef={scrollControlRef}
      compactRow={compactTabs}
    >
      {error ? (
        <Feedback title={copy('ทำรายการไม่ได้', 'Unable to complete action')} detail={error} tone="danger" />
      ) : null}
      {initialLoading ? skeleton : hasLoadedTeam ? (
        tablet ? tabletBody : (
          <View style={{ gap: spacing.md }}>
            {tabs.length > 1 ? <StaffTabs<StaffTab> tabs={tabs} value={shownTab} onChange={setTab} /> : null}
            {phoneBody}
          </View>
        )
      ) : null}
    </AppScreen>
  );
}
