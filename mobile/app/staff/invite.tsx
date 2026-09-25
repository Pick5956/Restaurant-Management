import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Share, useWindowDimensions, View } from 'react-native';

import { getRoles } from '@/src/api/auth';
import { createInvitation } from '@/src/api/restaurant';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChips, Field, FORM_MAX_WIDTH, FormBody, FormCard, Note, PillTabs, SaveDock } from '@/src/components/form/parts';
import { GhostButton } from '@/src/components/staff/parts';
import { ActionDock, Button, EmptyState, Feedback } from '@/src/components/ui';
import { parsePermissionsForRole } from '@/src/lib/permissions';
import {
  allowedRoleOptions,
  canGrantRole,
  canManageInvitations,
  DEFAULT_INVITATION_EXPIRY_DAYS,
  invitationExpiryLabel,
  INVITATION_EXPIRY_DAY_OPTIONS,
  roleLabel,
  roleListMeta,
  staffFailureDetail,
} from '@/src/lib/staff-workflow';
import { invitationUrl } from '@/src/lib/public-web-url';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing } from '@/src/theme';
import type { Role } from '@/src/types/restaurant';

// Invite staff, redrawn on 15 ก.ย. 2569: the role comes first and the chosen
// one says what it can do, the link's lifetime is one pill with the real
// expiry date under it, and a link that was made stays on this page in a
// green card with Share — with "เชิญอีกคน" to make the next one.

function expiryDate(days: number, language: 'th' | 'en'): string {
  if (!days) return language === 'th' ? 'ไม่หมดอายุ' : 'Never expires';
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at.toLocaleString(language === 'th' ? 'th-TH' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

export default function InviteStaffScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const restaurantId = activeMembership?.restaurant_id;
  const actorRole = activeMembership?.role?.name;
  const allowed = canManageInvitations(activeMembership);
  const tablet = width >= breakpoints.tabletWorkspace;
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState(0);
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(DEFAULT_INVITATION_EXPIRY_DAYS);
  const [link, setLink] = useState('');
  const [linkRole, setLinkRole] = useState('');
  const [linkExpiry, setLinkExpiry] = useState('');
  const [shareTitle, setShareTitle] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingRoles, setLoadingRoles] = useState(true);
  // A step's own title, and the app's line under it when there is one - never
  // the server's words.
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);

  useEffect(() => {
    if (!allowed || !restaurantId) {
      setLoadingRoles(false);
      return;
    }
    setLoadingRoles(true);
    getRoles()
      .then((response) => {
        const available = allowedRoleOptions(actorRole, response.data || [], allowed)
          .filter((role) => canGrantRole(activeMembership, role));
        setRoles(available);
        setRoleId(
          available.find((role) => role.name === 'waiter')?.ID
            || available[0]?.ID
            || 0,
        );
      })
      .catch((err) => {
        setError({ title: copy('โหลดบทบาทไม่สำเร็จ', 'Unable to load roles'), detail: staffFailureDetail(err, 'load', language) });
      })
      .finally(() => setLoadingRoles(false));
  }, [activeMembership, actorRole, allowed, copy, language, restaurantId]);

  const selectedRole = roles.find((role) => role.ID === roleId);
  const roleSummary = useMemo(() => {
    if (!selectedRole) return '';
    const keys = parsePermissionsForRole(selectedRole.permissions, selectedRole.name);
    const meta = roleListMeta(selectedRole, language);
    return copy(`${roleLabel(selectedRole, language)} · ${meta.permissionLabel}${keys.length ? ' · แก้ได้ทีหลังที่ข้อมูลพนักงาน' : ''}`, `${roleLabel(selectedRole, language)} · ${meta.permissionLabel}${keys.length ? ' · adjustable later on the staff page' : ''}`);
  }, [copy, language, selectedRole]);

  async function create() {
    if (!restaurantId || !roleId) {
      setError({ title: copy('สร้างคำเชิญไม่ได้', 'Unable to create invitation'), detail: copy('เลือกบทบาทก่อนสร้างคำเชิญ', 'Choose a role before creating an invitation.') });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const invitation = await createInvitation(restaurantId, {
        role_id: roleId,
        email: email.trim().toLowerCase() || undefined,
        expires_in_days: days,
      });
      const invitationLink = invitationUrl(invitation.token);
      const restaurantName = activeMembership?.restaurant?.name || copy('ร้านอาหาร', 'Restaurant');
      setLink(invitationLink);
      setLinkRole(roleLabel(selectedRole, language));
      setLinkExpiry(expiryDate(days, language));
      setShareTitle(copy(`คำเชิญเข้าร่วมร้าน ${restaurantName} บน Dishy`, `Invitation to join ${restaurantName} on Dishy`));
      setShareMessage(copy(
        `คุณได้รับคำเชิญเข้าร่วมร้าน ${restaurantName} ในบทบาท ${roleLabel(selectedRole, language)}\n${invitationLink}`,
        `You have been invited to join ${restaurantName} as ${roleLabel(selectedRole, language)}.\n${invitationLink}`,
      ));
    } catch (err) {
      setError({ title: copy('สร้างคำเชิญไม่สำเร็จ', 'Unable to create invitation'), detail: staffFailureDetail(err, 'create_invitation', language) });
    } finally {
      setSaving(false);
    }
  }

  const title = copy('เชิญพนักงาน', 'Invite staff');

  if (!allowed) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <EmptyState title={copy('ไม่มีสิทธิ์สร้างคำเชิญ', 'No invitation access')} detail={copy('บัญชีนี้ไม่ได้รับสิทธิ์สร้างและจัดการคำเชิญ', 'This account cannot create or manage invitations.')} />
      </AppScreen>
    );
  }

  const share = () => Share.share({ title: shareTitle, message: shareMessage || link });
  const another = () => { setLink(''); setShareMessage(''); setEmail(''); };

  if (link) {
    return (
      <AppScreen
        title={title}
        topLevel={false}
        centerTitle
        contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
        footer={!tablet ? (
          <ActionDock separated={false}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button variant="secondary" icon="person-add-outline" label={copy('เชิญอีกคน', 'Invite another')} onPress={another} /></View>
              <View style={{ flex: 1 }}><Button icon="checkmark" label={copy('เสร็จสิ้น', 'Done')} onPress={() => router.back()} /></View>
            </View>
          </ActionDock>
        ) : undefined}
      >
        <View style={{ gap: spacing.md }}>
          <FormCard style={{ borderColor: '#A7F3D0' }} title={copy('ลิงก์พร้อมส่ง', 'Link ready to send')} detail={copy(`${linkRole} · ${days ? `ใช้ได้ถึง ${linkExpiry}` : linkExpiry}`, `${linkRole} · ${days ? `valid until ${linkExpiry}` : linkExpiry}`)} icon="checkmark-circle-outline">
            <FormBody>
              <View style={{ borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.accentMuted, backgroundColor: '#FFFAF5', paddingVertical: 10, paddingHorizontal: 12 }}>
                <Text selectable style={{ fontSize: 12.5, lineHeight: 18, color: palette.primaryInk }}>{link}</Text>
              </View>
              <Button icon="share-social-outline" label={copy('แชร์ลิงก์เชิญ', 'Share the link')} onPress={share} />
              {tablet ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}><Button variant="secondary" icon="person-add-outline" label={copy('เชิญอีกคน', 'Invite another')} onPress={another} /></View>
                  <View style={{ flex: 1 }}><Button variant="secondary" icon="checkmark" label={copy('เสร็จสิ้น', 'Done')} onPress={() => router.back()} /></View>
                </View>
              ) : null}
            </FormBody>
          </FormCard>
          <Note text={copy('ลิงก์นี้อยู่ในแท็บ "คำเชิญ" จนกว่าจะมีคนรับหรือคุณยกเลิก', 'This link stays in the Invitations tab until someone accepts it or you revoke it')} />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={title}
      subtitle={copy('ส่งลิงก์ให้พนักงานเปิดในแอป Dishy', 'Send a link for staff to open in the Dishy app')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
      footer={!tablet ? <SaveDock icon="link-outline" label={copy('สร้างลิงก์เชิญ', 'Create the link')} onPress={create} loading={saving || loadingRoles} disabled={!roleId} /> : undefined}
    >
      {error ? <Feedback title={error.title} detail={error.detail} tone="danger" /> : null}
      <View style={{ gap: spacing.md }}>
        <FormCard title={copy('บทบาทที่จะได้รับ', 'Role they will get')}>
          <FormBody>
            {roles.length ? (
              <>
                <ChoiceChips options={roles.map((role) => ({ key: role.ID, label: roleLabel(role, language) }))} value={roleId} onChange={setRoleId} />
                {roleSummary ? <Note icon="shield-checkmark-outline" text={roleSummary} /> : null}
              </>
            ) : !loadingRoles ? (
              <Text style={{ fontSize: 13.5, color: palette.placeholder }}>{copy('บัญชีนี้มอบได้เฉพาะบทบาทที่มีสิทธิ์ไม่เกินของตัวเอง ตอนนี้ไม่มีบทบาทแบบนั้น', 'You can only invite to roles within your own permissions, and there are none right now')}</Text>
            ) : (
              <Text style={{ fontSize: 13.5, color: palette.placeholder }}>{copy('กำลังโหลดบทบาท…', 'Loading roles…')}</Text>
            )}
          </FormBody>
        </FormCard>

        <FormCard title={copy('ลิงก์', 'The link')}>
          <FormBody>
            <Field label={copy('อีเมลผู้รับ (ไม่บังคับ)', 'Recipient email (optional)')} value={email} onChangeText={setEmail} keyboardType="email-address" icon="mail-outline" placeholder={copy('ผูกลิงก์กับบัญชีนี้เท่านั้น', 'Ties the link to this account only')} />
            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{copy('อายุลิงก์', 'Link lifetime')}</Text>
              <PillTabs role="radiogroup" tabs={INVITATION_EXPIRY_DAY_OPTIONS.map((value) => ({ key: value, label: value ? invitationExpiryLabel(value, language) : copy('ไม่หมด', 'Never') }))} value={days} onChange={setDays} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 2 }}>
              <Text style={{ fontSize: 13, color: palette.muted }}>{copy('หมดอายุ', 'Expires')}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: palette.textStrong }}>{expiryDate(days, language)}</Text>
            </View>
            {tablet ? <Button icon="link-outline" label={copy('สร้างลิงก์เชิญ', 'Create the link')} onPress={create} loading={saving || loadingRoles} disabled={!roleId} /> : null}
          </FormBody>
        </FormCard>
        {!tablet ? null : <View style={{ flexDirection: 'row', justifyContent: 'center' }}><GhostButton icon="chevron-back" label={copy('กลับไปหน้าทีม', 'Back to the team')} onPress={() => router.back()} /></View>}
      </View>
    </AppScreen>
  );
}
