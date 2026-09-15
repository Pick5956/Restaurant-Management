import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  useWindowDimensions,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';

import {
  createRole,
  deleteRole,
  getRoles,
  updateRole,
  updateRolePermissions,
} from '@/src/api/auth';
import { listMembers } from '@/src/api/restaurant';
import { GlassButton } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { AppScreen } from '@/src/components/app-shell';
import { DangerAction, Field, FormBody, FormCard, Note, PermissionGroups, SaveDock } from '@/src/components/form/parts';
import { HeadingAction } from '@/src/components/heading-action';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { EmptyState, Feedback } from '@/src/components/ui';
import {
  allPermissions,
  normalizePermissionSelection,
  parsePermissionsForRole,
  permissionCanBeGranted,
  permissionGroupsFor,
  togglePermissionSelection,
} from '@/src/lib/permissions';
import { can } from '@/src/lib/rbac';
import {
  allowedRoleOptions,
  canFinishRoleNameEdit,
  canGrantRole,
  canManageRoles,
  roleEditorHeading,
  roleLabel,
  roleSaveFailureMessage,
} from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type { Membership, Role } from '@/src/types/restaurant';

// The role editor, redrawn on 15 ก.ย. 2569. The permission groups had been
// folded shut, showing only "2/2" until each was opened, and "ซ่อนบทบาท" was a
// full-width button that read as the main action. Now: the role's name is the
// title with a glass pencil beside it; two figures (permissions on, people
// holding it); every group open as a card with a switch per permission and
// "เลือกทั้งกลุ่ม"; hiding the role a quiet red line at the foot. A tablet
// puts the role's card on the left and the groups in two columns.

export default function RoleEditorScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const roleId = Number(id || 0);
  const editing = roleId > 0;
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const actorRole = activeMembership?.role?.name;
  const restaurantId = activeMembership?.restaurant_id;
  const allowed = canManageRoles(activeMembership);
  const tablet = width >= breakpoints.tabletWorkspace;
  const nameInputRef = useRef<NativeTextInput>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [holders, setHolders] = useState<Membership[]>([]);
  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState('');
  const [editingName, setEditingName] = useState(!editing);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([
      getRoles(),
      restaurantId ? listMembers(restaurantId).catch(() => ({ members: [] as Membership[] })) : Promise.resolve({ members: [] as Membership[] }),
    ])
      .then(([response, memberResponse]) => {
        const editableRoles = allowedRoleOptions(actorRole, response.data || [], allowed)
          .filter((item) => canGrantRole(activeMembership, item));
        const next = editableRoles.find((item) => item.ID === roleId) || null;
        const nextName = next ? roleLabel(next, language) : '';
        setRole(next);
        setName(nextName);
        setInitialName(nextName);
        setPermissions(parsePermissionsForRole(next?.permissions, next?.name));
        setHolders((memberResponse.members || []).filter((member) => member.status !== 'removed' && (member.role?.ID ?? member.role_id) === roleId));
      })
      .catch((err) => {
        setError(err instanceof Error
          ? err.message
          : copy('โหลดบทบาทไม่สำเร็จ', 'Unable to load role'));
      })
      .finally(() => setLoading(false));
  }, [activeMembership, actorRole, allowed, copy, editing, language, restaurantId, roleId]);

  const permissionGroups = permissionGroupsFor(language);
  const heading = roleEditorHeading(editing, role, language);
  const grantablePermissions = useMemo(() => new Set(
    (allPermissions as readonly string[]).filter((permission) => (
      can(activeMembership, permission)
    )),
  ), [activeMembership]);
  const grantable = (key: string) => permissionCanBeGranted(key, grantablePermissions);
  const deleteConfirmationMessage = role?.is_system
    ? copy(
      'บทบาทมาตรฐานลบไม่ได้ แต่จะถูกซ่อนจากรายการเมื่อไม่มีสมาชิกหรือคำเชิญใช้อยู่',
      'A standard role cannot be deleted; it is hidden from the list once no staff or invitation uses it.',
    )
    : copy(
      'บทบาทนี้จะถูกลบเมื่อไม่มีสมาชิกหรือคำเชิญใช้อยู่',
      'This role is deleted once no staff or invitation uses it.',
    );

  useEffect(() => {
    if (!confirmDelete || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(deleteError || deleteConfirmationMessage);
  }, [confirmDelete, deleteConfirmationMessage, deleteError]);

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

  function finishNameEditing(): boolean {
    if (!canFinishRoleNameEdit(name)) {
      setError(copy('กรอกชื่อบทบาทก่อน', 'Enter a role name first.'));
      setEditingName(true);
      requestAnimationFrame(() => nameInputRef.current?.focus());
      return false;
    }
    nameInputRef.current?.blur();
    setEditingName(false);
    return true;
  }

  async function save() {
    if (!allowed || (editing && !role)) return;
    if (!canFinishRoleNameEdit(name)) {
      finishNameEditing();
      return;
    }
    setSaving(true);
    setError(null);
    const editablePermissions = normalizePermissionSelection(permissions);
    let nameSaved = false;
    try {
      if (editing) {
        const nextName = name.trim();
        if (nextName !== initialName.trim()) {
          const response = await updateRole(roleId, { display_name: nextName });
          nameSaved = true;
          setRole(response.role);
          setInitialName(nextName);
        }
        await updateRolePermissions(roleId, editablePermissions);
        if (roleId === activeMembership?.role_id) {
          await refreshMemberships().catch(() => undefined);
        }
      } else {
        await createRole({ display_name: name.trim(), permissions: editablePermissions });
      }
      router.back();
    } catch (err) {
      setError(roleSaveFailureMessage(
        nameSaved,
        err instanceof Error ? err.message : '',
        language,
      ));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!role || !editing) return;
    setSaving(true);
    setError(null);
    setDeleteError(null);
    try {
      await deleteRole(roleId);
      router.back();
    } catch (err) {
      setDeleteError(err instanceof Error
        ? err.message
        : copy('ลบบทบาทไม่สำเร็จ', 'Unable to delete role'));
      setSaving(false);
    }
  }

  const screenTitle = editing ? copy('แก้ไขบทบาท', 'Edit role') : copy('เพิ่มบทบาท', 'Add role');

  if (!allowed) {
    return (
      <AppScreen title={screenTitle} topLevel={false} centerTitle>
        <EmptyState
          title={copy('ไม่มีสิทธิ์จัดการบทบาท', 'No role management access')}
          detail={copy('บัญชีนี้ไม่ได้รับสิทธิ์จัดการบทบาทและสิทธิ์ของทีม', 'This account cannot manage team roles and permissions.')}
        />
      </AppScreen>
    );
  }

  if (editing && loading) {
    return (
      <AppScreen title={screenTitle} topLevel={false} centerTitle>
        <SkeletonReveal label={copy('กำลังโหลดบทบาท', 'Loading role')} style={{ gap: spacing.md }}>
          <View style={{ flexDirection: 'row', gap: 8 }}><Bone height={58} radius={16} style={{ flex: 1 }} /><Bone height={58} radius={16} style={{ flex: 1 }} /></View>
          <Bone height={160} radius={18} />
          <Bone height={160} radius={18} />
        </SkeletonReveal>
      </AppScreen>
    );
  }

  if (editing && !role) {
    return (
      <AppScreen title={screenTitle} topLevel={false} centerTitle>
        <EmptyState
          title={error ? copy('โหลดบทบาทไม่สำเร็จ', 'Unable to load role') : copy('จัดการบทบาทนี้ไม่ได้', 'This role cannot be managed')}
          detail={error || copy('บทบาทนี้อยู่นอกลำดับสิทธิ์ของคุณหรือถูกนำออกจากร้านแล้ว', 'This role is outside your permission hierarchy or was removed.')}
        />
      </AppScreen>
    );
  }

  const displayRoleName = name.trim() || heading.title;
  const th = language === 'th';
  const holderCount = holders.length;

  // The title is the role's name; the pencil turns it into a field in place.
  const titleContent = editingName ? (
    <TextInput
      ref={nameInputRef}
      accessibilityHint={copy('แก้ชื่อแล้วกดเครื่องหมายถูก จากนั้นกดบันทึกบทบาทด้านล่าง', 'Edit the name, tap Done, then save the role below.')}
      accessibilityLabel={copy('ชื่อบทบาท', 'Role name')}
      autoCapitalize="words"
      autoCorrect
      autoFocus
      editable={!saving}
      onChangeText={(value) => { setName(value); setError(null); }}
      onSubmitEditing={finishNameEditing}
      placeholder={copy('ชื่อบทบาท', 'Role name')}
      placeholderTextColor={palette.placeholder}
      returnKeyType="done"
      selectionColor={palette.accent}
      submitBehavior="submit"
      style={[typeScale.hero, { width: '100%', minHeight: 44, fontWeight: '600', textAlign: 'center', borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 0 }]}
      value={name}
    />
  ) : (
    <Text accessibilityRole="header" numberOfLines={1} selectable style={[typeScale.hero, { fontWeight: '600', textAlign: 'center', minHeight: 44, textAlignVertical: 'center' }]}>{displayRoleName}</Text>
  );
  const nameAction = (
    <GlassButton
      icon={editingName ? 'checkmark' : 'create-outline'}
      label={editingName ? copy('เสร็จสิ้นการแก้ชื่อ', 'Finish editing name') : copy('แก้ชื่อบทบาท', 'Edit role name')}
      active={editingName}
      onPress={() => { if (editingName) finishNameEditing(); else setEditingName(true); }}
    />
  );

  const figures = (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View accessible accessibilityLabel={th ? `เปิด ${permissions.length} จาก ${allPermissions.length} สิทธิ์` : `${permissions.length} of ${allPermissions.length} permissions on`} style={{ flex: 1, borderRadius: 16, borderWidth: 1, borderColor: '#E4D8CD', backgroundColor: palette.surface, paddingVertical: 7, paddingHorizontal: 12 }}>
        <Text style={{ fontSize: 12, color: palette.placeholder }}>{th ? 'สิทธิ์ที่เปิด' : 'Permissions on'}</Text>
        <Text style={{ fontSize: 21, lineHeight: 27, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
          {permissions.length}<Text style={{ fontSize: 12.5, fontWeight: '500', color: palette.placeholder }}>{th ? ` จาก ${allPermissions.length}` : ` of ${allPermissions.length}`}</Text>
        </Text>
      </View>
      {editing ? (
        <View accessible accessibilityLabel={th ? `${holderCount} คนถือบทบาทนี้` : `${holderCount} people hold this role`} style={{ flex: 1, borderRadius: 16, borderWidth: 1, borderColor: '#E4D8CD', backgroundColor: palette.surface, paddingVertical: 7, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 12, color: palette.placeholder }}>{th ? 'คนที่ถือบทบาทนี้' : 'People with this role'}</Text>
          <Text style={{ fontSize: 21, lineHeight: 27, fontWeight: '700', color: holderCount ? palette.textStrong : palette.warning, fontVariant: ['tabular-nums'] }}>{holderCount}</Text>
        </View>
      ) : null}
    </View>
  );

  const groups = (
    <PermissionGroups
      groups={permissionGroups}
      selected={permissions}
      grantable={grantable}
      onToggle={toggle}
      onToggleGroup={toggleGroup}
      columns={tablet}
      language={language}
    />
  );

  const deleteBlock = editing ? (
    <DangerAction
      icon="trash-outline"
      label={role?.is_system ? copy('ซ่อนบทบาทนี้จากรายการ', 'Hide this role from the list') : copy('ลบบทบาทนี้', 'Delete this role')}
      confirmLabel={role?.is_system ? copy('ยืนยันซ่อน', 'Confirm hide') : copy('ยืนยันลบ', 'Confirm delete')}
      cancelLabel={copy('เก็บบทบาทไว้', 'Keep role')}
      message={deleteConfirmationMessage}
      error={deleteError}
      open={confirmDelete}
      onOpen={() => { setDeleteError(null); setConfirmDelete(true); }}
      onCancel={() => { setDeleteError(null); setConfirmDelete(false); }}
      onConfirm={remove}
      loading={saving}
    />
  ) : null;

  const saveLabel = editing ? copy('บันทึกบทบาท', 'Save role') : copy('เพิ่มบทบาท', 'Add role');

  return (
    <AppScreen
      title={displayRoleName}
      titleContent={titleContent}
      subtitle={editing ? (role?.is_system ? copy('บทบาทมาตรฐาน · แตะดินสอเพื่อเปลี่ยนชื่อ', 'Standard role · tap the pencil to rename') : copy('บทบาทที่ร้านสร้าง · แตะดินสอเพื่อเปลี่ยนชื่อ', 'Custom role · tap the pencil to rename')) : copy('ตั้งชื่อแล้วเปิดสิทธิ์ที่ต้องการ', 'Name it, then switch on what it may do')}
      topLevel={false}
      centerTitle
      action={tablet ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {nameAction}
          <HeadingAction compact={false} icon="checkmark" label={saveLabel} onPress={save} />
        </View>
      ) : nameAction}
      contentMaxWidth={tablet ? 1180 : undefined}
      footer={!tablet && !confirmDelete ? <SaveDock label={saveLabel} onPress={save} loading={saving} /> : undefined}
    >
      {error ? <Feedback title={copy('ทำรายการไม่ได้', 'Unable to complete action')} detail={error} tone="danger" /> : null}
      {!editing && !tablet ? (
        <FormCard title={copy('ชื่อบทบาท', 'Role name')}>
          <FormBody>
            <Field value={name} onChangeText={(value) => { setName(value); setError(null); }} placeholder={copy('เช่น หัวหน้ากะ', 'e.g. Shift lead')} icon="key-outline" autoCapitalize="words" />
          </FormBody>
        </FormCard>
      ) : null}
      {tablet ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg }}>
          <View style={{ width: 340, gap: spacing.md }}>
            <FormCard>
              <View style={{ alignItems: 'center', gap: 6, padding: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
                  <AppIcon name="key-outline" size={26} color={palette.primaryInk} />
                </View>
                {!editing ? <Field value={name} onChangeText={(value) => { setName(value); setError(null); }} placeholder={copy('ชื่อบทบาท', 'Role name')} autoCapitalize="words" grow /> : <Text style={{ fontSize: 20, fontWeight: '700', color: palette.textStrong }}>{displayRoleName}</Text>}
              </View>
              <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>{figures}</View>
            </FormCard>
            {editing && holderCount ? <Note icon="alert-circle-outline" tone="warning" text={copy(`สิทธิ์ที่ปิดตรงนี้จะหายจากทั้ง ${holderCount} คนที่ถือบทบาทนี้ทันทีที่บันทึก เว้นแต่คนนั้นตั้ง "กำหนดเอง" ไว้`, `Anything switched off here disappears for all ${holderCount} people with this role as soon as you save, unless they have custom permissions`)} /> : null}
            {deleteBlock}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>{groups}</View>
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {figures}
          {editing && holderCount ? <Note icon="alert-circle-outline" tone="warning" text={copy(`สิทธิ์ที่ปิดตรงนี้จะหายจากทั้ง ${holderCount} คนที่ถือบทบาทนี้ทันทีที่บันทึก`, `Anything switched off here disappears for all ${holderCount} people with this role as soon as you save`)} /> : null}
          {groups}
          <View style={{ paddingTop: spacing.sm }}>{deleteBlock}</View>
        </View>
      )}
    </AppScreen>
  );
}
