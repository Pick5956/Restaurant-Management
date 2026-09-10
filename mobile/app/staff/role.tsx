import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
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
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { AppScreen } from '@/src/components/app-shell';
import {
  AnimatedCollapse,
  AnimatedDisclosureIcon,
  MotionCrossfade,
} from '@/src/components/motion';
import {
  ActionDock,
  Button,
  EmptyState,
  Feedback,
  SectionHeader,
  Surface,
} from '@/src/components/ui';
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
  resolvePermissionGroupTransition,
  roleEditorHeading,
  roleLabel,
  roleSaveFailureMessage,
} from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type { Role } from '@/src/types/restaurant';

export default function RoleEditorScreen() {
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const roleId = Number(id || 0);
  const editing = roleId > 0;
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const actorRole = activeMembership?.role?.name;
  const allowed = canManageRoles(activeMembership);
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
  const nameInputRef = useRef<NativeTextInput>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState('');
  const [editingName, setEditingName] = useState(!editing);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [expandedPermissionGroup, setExpandedPermissionGroup] = useState(0);

  useEffect(() => {
    if (!editing || !allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getRoles()
      .then((response) => {
        const editableRoles = allowedRoleOptions(actorRole, response.data || [], allowed)
          .filter((item) => canGrantRole(activeMembership, item));
        const next = editableRoles.find((item) => item.ID === roleId) || null;
        const nextName = next ? roleLabel(next, language) : '';
        setRole(next);
        setName(nextName);
        setInitialName(nextName);
        setPermissions(parsePermissionsForRole(next?.permissions, next?.name));
      })
      .catch((err) => {
        setError(err instanceof Error
          ? err.message
          : copy('โหลดบทบาทไม่สำเร็จ', 'Unable to load role'));
      })
      .finally(() => setLoading(false));
  }, [activeMembership, actorRole, allowed, copy, editing, language, roleId]);
  const permissionGroups = permissionGroupsFor(language);
  const heading = roleEditorHeading(editing, role, language);
  const grantablePermissions = useMemo(() => new Set(
    (allPermissions as readonly string[]).filter((permission) => (
      can(activeMembership, permission)
    )),
  ), [activeMembership]);
  const deleteConfirmationMessage = role?.is_system
    ? copy(
      'บทบาทนี้จะถูกซ่อนเมื่อไม่มีสมาชิกหรือคำเชิญใช้อยู่',
      'This role will be hidden when no staff or invitations use it.',
    )
    : copy(
      'บทบาทนี้จะถูกลบเมื่อไม่มีสมาชิกหรือคำเชิญใช้อยู่',
      'This role will be deleted when no staff or invitations use it.',
    );

  useEffect(() => {
    if (!confirmDelete || Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(deleteError || deleteConfirmationMessage);
  }, [confirmDelete, deleteConfirmationMessage, deleteError]);

  function toggle(key: string) {
    if (!permissionCanBeGranted(key, grantablePermissions)) return;
    setPermissions((current) => togglePermissionSelection(current, key));
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
    if (!confirmDelete) {
      setDeleteError(null);
      setConfirmDelete(true);
      return;
    }
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

  if (!allowed) {
    return (
      <AppScreen
        title={editing
          ? copy('แก้ไขบทบาท', 'Edit role')
          : copy('เพิ่มบทบาท', 'Add role')}
        topLevel={false}
      >
        <EmptyState
          title={copy('ไม่มีสิทธิ์จัดการบทบาท', 'No role management access')}
          detail={copy(
            'บัญชีนี้ไม่ได้รับสิทธิ์จัดการบทบาทและสิทธิ์ของทีม',
            'This account cannot manage team roles and permissions.',
          )}
        />
      </AppScreen>
    );
  }

  if (editing && loading) {
    return (
      <AppScreen
        title={copy('แก้ไขบทบาท', 'Edit role')}
        subtitle={copy('กำลังโหลดข้อมูลบทบาท', 'Loading role details')}
        topLevel={false}
      >
        <View
          accessible
          accessibilityLabel={copy('กำลังโหลดบทบาท', 'Loading role')}
          accessibilityLiveRegion="polite"
          style={{ minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}
        >
          <ActivityIndicator color={palette.accent} />
          <Text style={[typeScale.body, { color: palette.muted }]}>
            {copy('กำลังโหลดบทบาท', 'Loading role')}
          </Text>
        </View>
      </AppScreen>
    );
  }

  if (editing && !role) {
    return (
      <AppScreen title={copy('แก้ไขบทบาท', 'Edit role')} topLevel={false}>
        <EmptyState
          title={error
            ? copy('โหลดบทบาทไม่สำเร็จ', 'Unable to load role')
            : copy('จัดการบทบาทนี้ไม่ได้', 'This role cannot be managed')}
          detail={error || copy(
            'บทบาทนี้อยู่นอกลำดับสิทธิ์ของคุณหรือถูกนำออกจากร้านแล้ว',
            'This role is outside your permission hierarchy or was removed.',
          )}
        />
      </AppScreen>
    );
  }

  const deleteActions = editing ? (
    <View style={{ gap: spacing.sm }}>
      <AnimatedCollapse expanded={confirmDelete}>
        <View
          accessible
          accessibilityLabel={deleteError || deleteConfirmationMessage}
          accessibilityLiveRegion={deleteError ? 'assertive' : 'polite'}
          style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs }}
        >
          <AppIcon color={palette.danger} name="alert-circle-outline" size={20} />
          <Text style={[typeScale.caption, { minWidth: 0, flex: 1, color: palette.danger }]}>
            {deleteError || deleteConfirmationMessage}
          </Text>
        </View>
      </AnimatedCollapse>
      <MotionCrossfade
        active={confirmDelete}
        inactiveContent={(
          <Button
            icon="trash-outline"
            variant="secondary"
            label={role?.is_system
              ? copy('ซ่อนบทบาท', 'Hide role')
              : copy('ลบบทบาท', 'Delete role')}
            onPress={remove}
            loading={saving}
          />
        )}
        activeContent={(
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              variant="secondary"
              label={copy('เก็บบทบาทไว้', 'Keep role')}
              onPress={() => {
                setDeleteError(null);
                setConfirmDelete(false);
              }}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <Button
              variant="danger"
              icon="trash-outline"
              label={role?.is_system
                ? copy('ยืนยันซ่อน', 'Confirm hide')
                : copy('ยืนยันลบ', 'Confirm delete')}
              onPress={remove}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        )}
      />
    </View>
  ) : null;

  const displayRoleName = name.trim() || heading.title;
  const roleTitleContent = (
    <View style={{ minWidth: 0, minHeight: 44, flex: 1, justifyContent: 'center' }}>
      {editingName ? (
        <TextInput
          ref={nameInputRef}
          accessibilityHint={copy(
            'แก้ชื่อแล้วกดเครื่องหมายถูก จากนั้นกดบันทึกบทบาทด้านล่าง',
            'Edit the name, tap Done, then save the role below.',
          )}
          accessibilityLabel={copy('ชื่อบทบาท', 'Role name')}
          autoCapitalize="words"
          autoCorrect
          autoFocus
          editable={!saving}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          onSubmitEditing={finishNameEditing}
          placeholder={copy('ชื่อบทบาท', 'Role name')}
          placeholderTextColor={palette.placeholder}
          returnKeyType="done"
          selectionColor={palette.accent}
          submitBehavior="submit"
          style={[
            typeScale.hero,
            {
              width: '100%',
              minHeight: 44,
              borderWidth: 0,
              backgroundColor: 'transparent',
              paddingHorizontal: 0,
              paddingVertical: 0,
            },
          ]}
          value={name}
        />
      ) : (
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          selectable
          style={[typeScale.hero, { minHeight: 44, textAlignVertical: 'center' }]}
        >
          {displayRoleName}
        </Text>
      )}
    </View>
  );
  const roleNameAction = (
    <Pressable
      accessibilityHint={editingName
        ? copy('กลับไปดูชื่อบทบาทก่อนบันทึก', 'Finish editing before saving.')
        : copy('แก้ชื่อบทบาทที่แสดงในร้านนี้', 'Edit the role name shown in this restaurant.')}
      accessibilityLabel={editingName
        ? copy('เสร็จสิ้นการแก้ชื่อ', 'Finish editing name')
        : copy('แก้ชื่อบทบาท', 'Edit role name')}
      accessibilityRole="button"
      disabled={saving}
      hitSlop={4}
      onPress={() => {
        if (editingName) {
          finishNameEditing();
          return;
        }
        setEditingName(true);
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: saving ? 0.45 : pressed ? 0.55 : 1,
      })}
    >
      <AppIcon
        color={editingName ? palette.accent : palette.textStrong}
        name={editingName ? 'checkmark' : 'create-outline'}
        size={editingName ? 25 : 22}
      />
    </Pressable>
  );

  return (
    <AppScreen
      action={roleNameAction}
      title={displayRoleName}
      titleContent={roleTitleContent}
      subtitle={heading.subtitle}
      topLevel={false}
      footer={!tabletWorkspace ? (
        <ActionDock separated={false}>
          <Button
            icon="checkmark"
            label={editing ? copy('บันทึกบทบาท', 'Save role') : copy('เพิ่มบทบาท', 'Add role')}
            onPress={save}
            loading={saving}
          />
        </ActionDock>
      ) : undefined}
    >
      {error ? (
        <Feedback
          title={copy('ทำรายการไม่ได้', 'Unable to complete action')}
          detail={error}
          tone="danger"
        />
      ) : null}

      <Surface>
        <SectionHeader
          title={copy('สิทธิ์', 'Permissions')}
          detail={copy(
            `เลือกแล้ว ${permissions.length.toLocaleString('th-TH')} สิทธิ์`,
            `${permissions.length.toLocaleString('en-US')} selected`,
          )}
        />
        <View
          style={{
            flexDirection: tabletWorkspace ? 'row' : 'column',
            flexWrap: tabletWorkspace ? 'wrap' : 'nowrap',
            gap: tabletWorkspace ? spacing.md : 0,
          }}
        >
          {permissionGroups.map((group, groupIndex) => {
            const expanded = tabletWorkspace || expandedPermissionGroup === groupIndex;
            const selectedCount = group.rows.filter((row) => permissions.includes(row.key)).length;
            return (
              <View
                key={group.title}
                style={{
                  minWidth: 0,
                  flexGrow: 1,
                  flexBasis: tabletWorkspace ? '46%' : '100%',
                  borderTopWidth: tabletWorkspace ? 0 : groupIndex ? 1 : 0,
                  borderTopColor: palette.border,
                }}
              >
                <Pressable
                  accessible={!tabletWorkspace}
                  accessibilityLabel={`${group.title}, ${selectedCount}/${group.rows.length}`}
                  accessibilityRole={tabletWorkspace ? undefined : 'button'}
                  accessibilityState={tabletWorkspace ? undefined : { expanded }}
                  disabled={tabletWorkspace}
                  onPress={() => setExpandedPermissionGroup((current) => (
                    resolvePermissionGroupTransition(current, groupIndex)
                  ))}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    paddingVertical: spacing.sm,
                    opacity: pressed ? 0.72 : 1,
                  })}
                >
                  <Text style={[typeScale.cardTitle, { flex: 1 }]}>{group.title}</Text>
                  <Text style={[typeScale.caption, { color: palette.muted }]}>
                    {selectedCount}/{group.rows.length}
                  </Text>
                  {!tabletWorkspace ? (
                    <AnimatedDisclosureIcon expanded={expanded} color={palette.muted} size={17} />
                  ) : null}
                </Pressable>
                <AnimatedCollapse expanded={expanded}>
                  {group.rows.map((row) => {
                    const active = permissions.includes(row.key);
                    const grantable = permissionCanBeGranted(row.key, grantablePermissions);
                    return (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active, disabled: !grantable }}
                        disabled={!grantable}
                        key={row.key}
                        onPress={() => toggle(row.key)}
                        style={({ pressed }) => ({
                          minHeight: 50,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: spacing.md,
                          backgroundColor: pressed ? palette.surfaceSubtle : palette.surface,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.sm,
                          opacity: !grantable ? 0.5 : pressed ? 0.75 : 1,
                        })}
                      >
                        <Text style={{
                          flex: 1,
                          color: palette.text,
                          fontSize: 14,
                          fontWeight: '600',
                        }}>
                          {row.label}
                        </Text>
                        <AppIcon
                          color={active ? palette.accent : palette.muted}
                          name={active ? 'checkbox' : 'square-outline'}
                          size={22}
                        />
                      </Pressable>
                    );
                  })}
                </AnimatedCollapse>
              </View>
            );
          })}
        </View>
      </Surface>

      {tabletWorkspace || editing ? <View style={{ gap: spacing.md }}>
        {tabletWorkspace ? <Button
          icon="checkmark"
          label={editing
            ? copy('บันทึกบทบาท', 'Save role')
            : copy('เพิ่มบทบาท', 'Add role')}
          onPress={save}
          loading={saving}
        /> : null}
        {deleteActions}
      </View> : null}
    </AppScreen>
  );
}
