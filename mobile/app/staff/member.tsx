import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { getRoles } from '@/src/api/auth';
import {
  listMembers,
  updateMemberPermissions,
  updateMemberRole,
  updateMemberStatus,
} from '@/src/api/restaurant';
import { AppText as Text } from '@/src/components/app-text';
import { AppScreen } from '@/src/components/app-shell';
import { ChoiceChips, FORM_MAX_WIDTH, FormBody, FormCard, Note, PermissionGroups, PillTabs, SaveDock } from '@/src/components/form/parts';
import { HeadingAction } from '@/src/components/heading-action';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { Button, EmptyState, Feedback } from '@/src/components/ui';
import {
  allPermissions,
  normalizePermissionSelection,
  parsePermissionsForRole,
  permissionCanBeGranted,
  permissionGroupsFor,
  shouldUpdateMemberPermissions,
  togglePermissionSelection,
} from '@/src/lib/permissions';
import { can } from '@/src/lib/rbac';
import {
  allowedRoleOptions,
  canGrantRole,
  canManageMembers,
  canManageRoles,
  canManageTarget,
  memberInitials,
  roleLabel,
  staffFailureDetail,
  staffStatusLabel,
  userDisplayName,
  type StaffFailureStep,
} from '@/src/lib/staff-workflow';
import { parsePositiveRouteId } from '@/src/lib/route-id';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import type { Membership, MembershipStatus, Role } from '@/src/types/restaurant';

// Staff details, redrawn on 15 ก.ย. 2569: the person as a card at the top
// (initials, name, email, when they joined, status), the role as chips with
// the "changing the role clears custom access" warning right under them, the
// permissions behind a "ตามบทบาท | กำหนดเอง" pill with the same switch cards
// the role editor uses, and the status last.

export default function StaffMemberScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = parsePositiveRouteId(id);
  const memberId = routeId.kind === 'valid' ? routeId.id : null;
  const { activeMembership, user } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const restaurantId = activeMembership?.restaurant_id;
  const actorRole = activeMembership?.role?.name;
  const canEditStatus = canManageMembers(activeMembership);
  const canEditRole = canManageRoles(activeMembership);
  const allowed = canEditStatus || canEditRole;
  const tablet = width >= breakpoints.tabletWorkspace;
  const [member, setMember] = useState<Membership | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState(0);
  const [status, setStatus] = useState<MembershipStatus>('active');
  const [useRolePermissions, setUseRolePermissions] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<MembershipStatus | null>(null);
  // `error` is the member failing to load, and gates the not-found screen: the
  // app's line under the title when there is one, never the server's words.
  // Save reports through a toast (14 ก.ย.).
  const [error, setError] = useState<{ detail?: string } | null>(null);
  const { showToast } = useToast();
  const actionFailed = (title: string, detail?: string) => showToast({ tone: 'error', title, message: detail });

  useEffect(() => {
    if (!restaurantId || !allowed || memberId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setMember(null);
    setError(null);
    Promise.all([
      listMembers(restaurantId),
      canEditRole ? getRoles() : Promise.resolve({ data: [] as Role[] }),
    ])
      .then(([memberResponse, roleResponse]) => {
        const next = memberResponse.members.find((item) => item.ID === memberId) || null;
        setMember(next);
        setRoles(
          allowedRoleOptions(actorRole, roleResponse.data || [], canEditRole)
            .filter((role) => canGrantRole(activeMembership, role)),
        );
        setRoleId(next?.role_id || 0);
        setStatus(next?.status || 'active');
        setUseRolePermissions(next?.permissions_override == null);
        setPermissions(parsePermissionsForRole(
          next?.permissions_override ?? next?.role?.permissions,
          next?.role?.name,
        ));
      })
      .catch((err) => {
        setError({ detail: staffFailureDetail(err, 'load', language) });
      })
      .finally(() => setLoading(false));
  }, [activeMembership, actorRole, allowed, canEditRole, language, memberId, restaurantId]);

  const manageable = Boolean(
    (canEditStatus || (canEditRole && member?.role && canGrantRole(activeMembership, member.role)))
    && member
    && canManageTarget(
      actorRole,
      member.role?.name,
      member.user_id === user?.ID,
      canEditStatus || canEditRole,
    ),
  );
  const canEditMemberRole = Boolean(
    canEditRole
    && member?.role
    && canGrantRole(activeMembership, member.role),
  );
  const roleOptions = useMemo(
    () => roles.map((role) => ({ label: roleLabel(role, language), value: role.ID })),
    [language, roles],
  );
  const permissionGroups = useMemo(() => permissionGroupsFor(language), [language]);
  const grantablePermissions = useMemo(() => new Set(
    (allPermissions as readonly string[]).filter((permission) => (
      can(activeMembership, permission)
    )),
  ), [activeMembership]);

  function changeRole(nextRoleId: number) {
    if (!canEditMemberRole) return;
    setRoleId(nextRoleId);
    if (useRolePermissions) {
      const nextRole = roles.find((role) => role.ID === nextRoleId);
      setPermissions(parsePermissionsForRole(nextRole?.permissions, nextRole?.name));
    }
  }

  const grantable = (key: string) => canEditMemberRole && permissionCanBeGranted(key, grantablePermissions);

  function toggle(key: string) {
    if (!grantable(key)) return;
    setPermissions((current) => togglePermissionSelection(current, key));
  }

  function toggleGroup(keys: string[], on: boolean) {
    setPermissions((current) => {
      if (on) return normalizePermissionSelection([...current, ...keys]);
      return keys.reduce((selection, key) => (selection.includes(key) ? togglePermissionSelection(selection, key) : selection), current);
    });
  }

  async function save() {
    if (!restaurantId || memberId === null || !member || !manageable) return;
    const riskyStatusChange = status !== member.status && status !== 'active';
    if (riskyStatusChange && confirmStatus !== status) {
      setConfirmStatus(status);
      return;
    }

    const roleChanged = canEditMemberRole && roleId !== member.role_id;
    const previousPermissions = parsePermissionsForRole(
      member.permissions_override ?? member.role?.permissions,
      member.role?.name,
    );
    const updatePermissions = canEditMemberRole && shouldUpdateMemberPermissions({
      roleChanged,
      previousUsesRolePermissions: member.permissions_override == null,
      useRolePermissions,
      previousPermissions,
      selectedPermissions: permissions,
    });
    const editablePermissions = normalizePermissionSelection(permissions);
    if (
      updatePermissions
      && !useRolePermissions
      && editablePermissions.some((permission) => (
        !(allPermissions as readonly string[]).includes(permission)
        || !can(activeMembership, permission)
      ))
    ) {
      actionFailed(copy('ทำรายการไม่ได้', 'Unable to complete action'), copy(
        'บันทึกสิทธิ์ไม่ได้ เพราะมีสิทธิ์ที่บัญชีนี้มอบต่อไม่ได้ กรุณาให้ผู้มีสิทธิ์สูงกว่าเป็นผู้แก้ไข',
        'These permissions exceed your grant scope. Ask a higher-privileged account to edit them.',
      ));
      return;
    }

    setSaving(true);
    // Which request a failure came from: bringing a removed member back is
    // the one that can find their role deleted.
    let step: StaffFailureStep = 'save_member';
    try {
      let updated = member;
      if (roleChanged) {
        updated = (await updateMemberRole(restaurantId, updated.ID, roleId)).member;
        setMember(updated);
      }
      if (canEditStatus && status !== updated.status) {
        if (updated.status === 'removed') step = 'restore_member';
        updated = (await updateMemberStatus(restaurantId, updated.ID, status)).member;
        step = 'save_member';
        setMember(updated);
      }
      if (updatePermissions) {
        updated = (
          await updateMemberPermissions(
            restaurantId,
            updated.ID,
            useRolePermissions ? null : editablePermissions,
          )
        ).member;
      }
      setMember(updated);
      setRoleId(updated.role_id);
      setStatus(updated.status);
      setUseRolePermissions(updated.permissions_override == null);
      setPermissions(parsePermissionsForRole(
        updated.permissions_override ?? updated.role?.permissions,
        updated.role?.name,
      ));
      setConfirmStatus(null);
      showToast({ title: copy('บันทึกข้อมูลพนักงานแล้ว', 'Staff details saved') });
    } catch (err) {
      actionFailed(copy('บันทึกพนักงานไม่สำเร็จ', 'Unable to save staff details'), staffFailureDetail(err, step, language));
    } finally {
      setSaving(false);
    }
  }

  const title = copy('ข้อมูลพนักงาน', 'Staff details');
  const goBack = <Button variant="secondary" label={copy('ย้อนกลับ', 'Go back')} onPress={() => router.back()} />;

  if (routeId.kind !== 'valid') {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <EmptyState title={copy('ไม่พบพนักงาน', 'Staff member not found')} detail={copy('ลิงก์พนักงานนี้ไม่ถูกต้อง กรุณากลับไปเลือกรายการจากหน้าทีมงาน', 'This staff link is invalid. Go back and choose a member from the team list.')} action={goBack} />
      </AppScreen>
    );
  }

  if (!allowed) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <EmptyState title={copy('ไม่มีสิทธิ์จัดการทีม', 'No team management access')} detail={copy('บัญชีนี้ไม่ได้รับสิทธิ์จัดการสถานะหรือบทบาทของพนักงาน', 'This account cannot manage staff status or roles.')} />
      </AppScreen>
    );
  }

  if (!loading && !error && (!member || !manageable)) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <EmptyState
          title={member ? copy('จัดการสมาชิกคนนี้ไม่ได้', 'This member cannot be managed') : copy('ไม่พบพนักงาน', 'Staff member not found')}
          detail={member
            ? copy('แก้ไขตนเอง เจ้าของร้าน ผู้จัดการ หรือสิทธิ์ที่สูงกว่าขอบเขตของบัญชีนี้ไม่ได้', 'You cannot edit yourself, protected managers, owners, or access above your grant scope.')
            : copy('พนักงานอาจถูกนำออกหรือไม่ได้อยู่ในร้านนี้', 'This staff member may have been removed or is not in this restaurant.')}
          action={goBack}
        />
      </AppScreen>
    );
  }

  const selectedRole = roles.find((role) => role.ID === roleId);
  const roleChanged = Boolean(canEditMemberRole && member && roleId !== member.role_id);
  const saveLabel = confirmStatus ? copy('ยืนยันบันทึก', 'Confirm save') : copy('บันทึกข้อมูลพนักงาน', 'Save staff details');
  const saveVariant = confirmStatus === 'removed' ? 'danger' : 'primary';
  const statusOptions: { key: MembershipStatus; label: string }[] = [
    { key: 'active', label: copy('ใช้งาน', 'Active') },
    { key: 'suspended', label: copy('ระงับ', 'Suspended') },
    { key: 'removed', label: copy('นำออกจากร้าน', 'Remove from shop') },
  ];
  const joined = member?.joined_at ? new Date(member.joined_at) : null;
  const joinedLabel = joined && !Number.isNaN(joined.getTime())
    ? joined.toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
    : '';
  const statusLook = member?.status === 'active'
    ? { wash: palette.successSoft, ink: palette.success }
    : member?.status === 'suspended' ? { wash: palette.warningSoft, ink: palette.warning } : { wash: '#F3F4F6', ink: '#4B5563' };

  const personCard = member ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 22, borderCurve: 'continuous', backgroundColor: palette.surfaceSubtle, paddingVertical: 14, paddingHorizontal: 14 }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F0ED' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#5B3A2B' }}>{memberInitials(userDisplayName(member.user, language))}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 18, lineHeight: 24, fontWeight: '700', color: palette.textStrong }}>{userDisplayName(member.user, language)}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted }}>{[member.user?.email, joinedLabel ? copy(`เข้าร่วม ${joinedLabel}`, `joined ${joinedLabel}`) : ''].filter(Boolean).join(' · ')}</Text>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, backgroundColor: statusLook.wash }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusLook.ink }} />
          <Text style={{ fontSize: 11.5, fontWeight: '600', color: statusLook.ink }}>{staffStatusLabel(member.status, language)}</Text>
        </View>
      </View>
    </View>
  ) : null;

  const roleCard = member ? (
    <FormCard title={copy('บทบาท', 'Role')} detail={canEditMemberRole ? undefined : copy('บัญชีนี้เปลี่ยนบทบาทของคนนี้ไม่ได้', 'This account cannot change the role of this person')}>
      <FormBody>
        {canEditMemberRole ? (
          <ChoiceChips options={roles.map((role) => ({ key: role.ID, label: roleLabel(role, language) }))} value={roleId} onChange={changeRole} />
        ) : (
          <Text style={{ fontSize: 15, fontWeight: '600', color: palette.textStrong }}>{roleLabel(member.role, language)}</Text>
        )}
        {roleChanged && member.permissions_override != null ? (
          <Note icon="alert-circle-outline" tone="warning" text={copy('เปลี่ยนบทบาทแล้วสิทธิ์ที่กำหนดเองไว้จะถูกล้าง กลับไปใช้ของบทบาทใหม่ ถ้าเลือก "กำหนดเอง" ด้านล่าง รายการนั้นจะถูกบันทึกเป็นชุดใหม่', 'Changing the role clears the custom permissions and uses the new role defaults; if Custom is chosen below, that list is saved as the new set')} />
        ) : null}
      </FormBody>
    </FormCard>
  ) : null;

  const permissionCard = member && canEditMemberRole ? (
    <FormCard
      title={copy('สิทธิ์การใช้งาน', 'Permissions')}
      detail={useRolePermissions
        ? copy(`ตอนนี้: ตามบทบาท ${roleLabel(selectedRole, language)}`, `Now: the ${roleLabel(selectedRole, language)} role defaults`)
        : copy(`กำหนดเอง · เปิด ${permissions.length} สิทธิ์`, `Custom · ${permissions.length} on`)}
    >
      <FormBody>
        <PillTabs
          role="radiogroup"
          tabs={[{ key: 'role', label: copy('ตามบทบาท', 'Role defaults') }, { key: 'custom', label: copy('กำหนดเอง', 'Custom') }]}
          value={useRolePermissions ? 'role' : 'custom'}
          onChange={(value) => {
            const useRole = value === 'role';
            setUseRolePermissions(useRole);
            if (!useRole) setPermissions(parsePermissionsForRole(selectedRole?.permissions, selectedRole?.name));
          }}
        />
      </FormBody>
    </FormCard>
  ) : null;

  const permissionGroupCards = member && canEditMemberRole && !useRolePermissions ? (
    <PermissionGroups groups={permissionGroups} selected={permissions} grantable={grantable} onToggle={toggle} onToggleGroup={toggleGroup} columns={tablet} language={language} />
  ) : null;

  const statusCard = member && canEditStatus ? (
    <FormCard title={copy('สถานะ', 'Status')} detail={copy('ระงับ = เข้าแอปไม่ได้จนกว่าจะเปิดกลับ · นำออก = ต้องเชิญใหม่', 'Suspended = locked out until reactivated · removed = must be invited again')}>
      <FormBody>
        <ChoiceChips options={statusOptions} value={status} onChange={(value) => { setStatus(value); setConfirmStatus(null); }} />
        {confirmStatus ? (
          <Note icon="alert-circle-outline" tone={confirmStatus === 'removed' ? 'danger' : 'warning'} text={confirmStatus === 'removed'
            ? copy('กดบันทึกอีกครั้งเพื่อนำพนักงานออกจากร้าน คนนี้จะเข้าร้านไม่ได้จนกว่าจะได้รับคำเชิญใหม่', 'Tap save again to remove this person; they cannot open the shop until invited again')
            : copy('กดบันทึกอีกครั้งเพื่อระงับ คนนี้จะเข้าร้านไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง', 'Tap save again to suspend; they cannot open the shop until reactivated')} />
        ) : null}
      </FormBody>
    </FormCard>
  ) : null;

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดข้อมูลพนักงาน', 'Loading staff details')} style={{ gap: spacing.md }}>
      <Bone height={84} radius={22} />
      <Bone height={120} radius={18} />
      <Bone height={100} radius={18} />
    </SkeletonReveal>
  );

  return (
    <AppScreen
      title={title}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? 1180 : undefined}
      action={tablet && member ? <HeadingAction compact={false} icon={confirmStatus === 'removed' ? 'person-remove-outline' : 'checkmark'} label={saveLabel} onPress={save} /> : undefined}
      footer={!tablet && member ? <SaveDock icon={confirmStatus === 'removed' ? 'person-remove-outline' : 'checkmark'} variant={saveVariant} label={saveLabel} onPress={save} loading={saving} /> : undefined}
    >
      {error ? <Feedback title={copy('โหลดข้อมูลพนักงานไม่สำเร็จ', 'Unable to load staff details')} detail={error.detail} tone="danger" /> : null}
      {!member ? (loading ? skeleton : null) : tablet ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
          <View style={{ width: 360, gap: spacing.md }}>
            {personCard}
            {roleCard}
            {statusCard}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.md }}>
            {permissionCard}
            {permissionGroupCards}
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.md, maxWidth: FORM_MAX_WIDTH, width: '100%', alignSelf: 'center' }}>
          {personCard}
          {roleCard}
          {permissionCard}
          {permissionGroupCards}
          {statusCard}
        </View>
      )}
    </AppScreen>
  );
}
